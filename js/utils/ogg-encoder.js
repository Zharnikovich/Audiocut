// Audiocut - OGG Audio Encoder (WebCodecs Opus with RFC 7845 Ogg Muxer & MediaRecorder Fallback)

const OGG_CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let r = i << 24;
  for (let j = 0; j < 8; j++) {
    if (r & 0x80000000) {
      r = ((r << 1) ^ 0x04c11db7) >>> 0;
    } else {
      r = (r << 1) >>> 0;
    }
  }
  OGG_CRC_TABLE[i] = r >>> 0;
}

function calcOggCRC(data) {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc = (((crc << 8) >>> 0) ^ OGG_CRC_TABLE[((crc >>> 24) & 0xff) ^ data[i]]) >>> 0;
  }
  return crc >>> 0;
}

export async function bufferToOgg(buffer, options = {}, onProgress = null) {
  const requestedChannels = options.channels || buffer.numberOfChannels;
  const channels = Math.min(requestedChannels, 2);
  const sampleRate = options.sampleRate || buffer.sampleRate;
  const kbps = options.bitrate || 160;

  // 1. Try WebCodecs AudioEncoder with 'opus' + Ogg Opus muxer
  if (typeof window !== 'undefined' && window.AudioEncoder && window.AudioData) {
    try {
      return await encodeWithWebCodecsOgg(buffer, channels, sampleRate, kbps, onProgress);
    } catch (err) {
      console.warn('WebCodecs Opus encoding failed, attempting MediaRecorder fallback:', err);
    }
  }

  // 2. MediaRecorder fallback
  if (typeof window !== 'undefined' && window.MediaRecorder) {
    const mimeTypes = ['audio/ogg; codecs=opus', 'audio/ogg', 'audio/webm; codecs=opus', 'audio/webm'];
    const supportedMime = mimeTypes.find(m => window.MediaRecorder.isTypeSupported(m));
    if (supportedMime) {
      return await encodeWithMediaRecorderOgg(buffer, supportedMime, kbps, onProgress);
    }
  }

  throw new Error('OGG (Opus) encoding is not supported in this browser. Please use Chrome, Edge, or choose MP3/WAV/AIFF format.');
}

async function encodeWithWebCodecsOgg(buffer, channels, sampleRate, kbps, onProgress) {
  const packets = [];
  let encoderError = null;

  const encoder = new window.AudioEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      packets.push({
        data,
        timestamp: chunk.timestamp,
        duration: chunk.duration
      });
    },
    error: (e) => { encoderError = e; }
  });

  await encoder.configure({
    codec: 'opus',
    sampleRate: 48000, // Opus standard
    numberOfChannels: channels,
    bitrate: kbps * 1000
  });

  // Prepare input buffer (resample to 48kHz for Opus if needed)
  let renderBuf = buffer;
  if (buffer.sampleRate !== 48000) {
    const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
      channels,
      Math.round(buffer.duration * 48000),
      48000
    );
    const src = offlineCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(offlineCtx.destination);
    src.start(0);
    renderBuf = await offlineCtx.startRendering();
  }

  const frameSize = 960; // 20ms at 48kHz
  const totalLength = renderBuf.length;

  for (let i = 0; i < totalLength; i += frameSize) {
    if (encoderError) throw encoderError;

    const chunkLen = Math.min(frameSize, totalLength - i);
    const planar = new Float32Array(chunkLen * channels);

    for (let ch = 0; ch < channels; ch++) {
      const srcChannel = ch < renderBuf.numberOfChannels ? renderBuf.getChannelData(ch) : renderBuf.getChannelData(0);
      planar.set(srcChannel.subarray(i, i + chunkLen), ch * chunkLen);
    }

    const audioData = new window.AudioData({
      format: 'f32-planar',
      sampleRate: 48000,
      numberOfFrames: chunkLen,
      numberOfChannels: channels,
      timestamp: Math.round((i / 48000) * 1_000_000),
      data: planar
    });

    encoder.encode(audioData);
    audioData.close();

    if (onProgress && i % (frameSize * 25) === 0) {
      onProgress(Math.min(0.92, i / totalLength));
      await new Promise(r => setTimeout(r, 0));
    }
  }

  await encoder.flush();
  encoder.close();

  // Mux raw Opus packets into RFC 7845 Ogg Opus pages
  const oggBlob = muxOggOpus(packets, channels, 48000);
  if (onProgress) onProgress(1.0);
  return oggBlob;
}

function muxOggOpus(packets, channels, sampleRate) {
  const serial = (Math.random() * 0xFFFFFFFF) >>> 0;
  let pageSeq = 0;
  const pages = [];

  // Page 0: OpusHead
  const headPacket = createOpusHeadPacket(channels, sampleRate);
  pages.push(createOggPage(2, 0n, serial, pageSeq++, [headPacket])); // BOS = 2

  // Page 1: OpusTags
  const tagsPacket = createOpusTagsPacket('Audiocut Studio');
  pages.push(createOggPage(0, 0n, serial, pageSeq++, [tagsPacket]));

  // Subsequent Audio Pages
  const preSkip = 3840n; // Standard Opus pre-skip
  let samplesEncoded = 0n;

  for (let i = 0; i < packets.length; i++) {
    const isLast = (i === packets.length - 1);
    const headerType = isLast ? 4 : 0; // 4 = EOS
    const pkt = packets[i];

    // Estimate 20ms (960 samples at 48kHz) per frame
    samplesEncoded += 960n;
    const granulePos = samplesEncoded + preSkip;

    pages.push(createOggPage(headerType, granulePos, serial, pageSeq++, [pkt.data]));
  }

  return new Blob(pages, { type: 'audio/ogg' });
}

function createOpusHeadPacket(channels, sampleRate) {
  const buf = new Uint8Array(19);
  const view = new DataView(buf.buffer);

  // 'OpusHead' (8 bytes)
  const magic = [79, 112, 117, 115, 72, 101, 97, 100];
  buf.set(magic, 0);

  buf[8] = 1; // version = 1
  buf[9] = channels; // channels
  view.setUint16(10, 3840, true); // pre-skip
  view.setUint32(12, sampleRate, true); // original sample rate
  view.setInt16(16, 0, true); // gain = 0
  buf[18] = 0; // channel mapping family

  return buf;
}

function createOpusTagsPacket(vendorString) {
  const encoder = new TextEncoder();
  const vendorBytes = encoder.encode(vendorString);
  const buf = new Uint8Array(8 + 4 + vendorBytes.length + 4);
  const view = new DataView(buf.buffer);

  // 'OpusTags' (8 bytes)
  const magic = [79, 112, 117, 115, 84, 97, 103, 115];
  buf.set(magic, 0);

  view.setUint32(8, vendorBytes.length, true);
  buf.set(vendorBytes, 12);
  view.setUint32(12 + vendorBytes.length, 0, true); // 0 user comments

  return buf;
}

function createOggPage(headerType, granulePos, serial, pageSeq, packets) {
  const segments = [];
  let bodySize = 0;

  for (const pkt of packets) {
    let len = pkt.byteLength;
    bodySize += len;
    while (len >= 255) {
      segments.push(255);
      len -= 255;
    }
    segments.push(len);
  }

  const headerSize = 27 + segments.length;
  const pageBuffer = new Uint8Array(headerSize + bodySize);
  const view = new DataView(pageBuffer.buffer);

  // Header
  pageBuffer.set([79, 103, 103, 83], 0); // 'OggS'
  pageBuffer[4] = 0; // version
  pageBuffer[5] = headerType; // header type
  view.setBigInt64(6, BigInt(granulePos), true); // granule position
  view.setUint32(14, serial, true);
  view.setUint32(18, pageSeq, true);
  view.setUint32(22, 0, true); // CRC placeholder
  pageBuffer[26] = segments.length;
  pageBuffer.set(segments, 27);

  // Body
  let bodyOffset = headerSize;
  for (const pkt of packets) {
    pageBuffer.set(pkt, bodyOffset);
    bodyOffset += pkt.byteLength;
  }

  // Calculate CRC-32 over complete page
  const crc = calcOggCRC(pageBuffer);
  view.setUint32(22, crc, true);

  return pageBuffer;
}

function encodeWithMediaRecorderOgg(buffer, mimeType, kbps, onProgress) {
  return new Promise((resolve, reject) => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const dest = audioCtx.createMediaStreamDestination();
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(dest);

      const recorder = new window.MediaRecorder(dest.stream, {
        mimeType: mimeType,
        audioBitsPerSecond: kbps * 1000
      });

      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        audioCtx.close();
        if (onProgress) onProgress(1.0);
        resolve(new Blob(chunks, { type: 'audio/ogg' }));
      };

      recorder.onerror = (e) => {
        audioCtx.close();
        reject(e.error || new Error('MediaRecorder error during OGG conversion.'));
      };

      const duration = buffer.duration;
      const startTime = Date.now();
      const progressTimer = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        if (onProgress) onProgress(Math.min(0.95, elapsed / duration));
      }, 200);

      source.onended = () => {
        clearInterval(progressTimer);
        setTimeout(() => {
          if (recorder.state !== 'inactive') recorder.stop();
        }, 150);
      };

      recorder.start(100);
      source.start(0);
    } catch (err) {
      reject(err);
    }
  });
}
