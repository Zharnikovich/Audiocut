// Audiocut - M4A / AAC Audio Encoder (WebCodecs + MP4 Muxer with MediaRecorder Fallback)

export async function bufferToM4a(buffer, options = {}, onProgress = null) {
  const requestedChannels = options.channels || buffer.numberOfChannels;
  const channels = Math.min(requestedChannels, 2);
  const sampleRate = options.sampleRate || buffer.sampleRate;
  const kbps = options.bitrate || 192;

  // 1. Try WebCodecs + MP4Muxer (fastest, offline, precision AAC encoding)
  if (typeof window !== 'undefined' && window.AudioEncoder && window.AudioData && window.Mp4Muxer) {
    try {
      return await encodeWithWebCodecs(buffer, channels, sampleRate, kbps, onProgress);
    } catch (err) {
      console.warn('WebCodecs AAC encoding failed, attempting MediaRecorder fallback:', err);
    }
  }

  // 2. Try MediaRecorder fallback (for Safari/WebKit)
  if (typeof window !== 'undefined' && window.MediaRecorder) {
    const mimeTypes = ['audio/mp4', 'audio/aac'];
    const supportedMime = mimeTypes.find(m => window.MediaRecorder.isTypeSupported(m));
    if (supportedMime) {
      return await encodeWithMediaRecorder(buffer, supportedMime, kbps, onProgress);
    }
  }

  throw new Error('M4A (AAC) encoding is not supported in this browser. Please use Chrome, Edge, Safari 17+, or choose MP3/WAV/AIFF format.');
}

async function encodeWithWebCodecs(buffer, channels, sampleRate, kbps, onProgress) {
  const muxer = new window.Mp4Muxer.Muxer({
    target: new window.Mp4Muxer.ArrayBufferTarget(),
    audio: {
      codec: 'aac',
      numberOfChannels: channels,
      sampleRate: sampleRate
    },
    fastStart: 'in-memory'
  });

  let encoderError = null;
  const encoder = new window.AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => { encoderError = e; }
  });

  await encoder.configure({
    codec: 'mp4a.40.2', // AAC-LC
    sampleRate: sampleRate,
    numberOfChannels: channels,
    bitrate: kbps * 1000
  });

  const frameSize = 1024;
  const totalLength = buffer.length;

  for (let i = 0; i < totalLength; i += frameSize) {
    if (encoderError) throw encoderError;

    const chunkLen = Math.min(frameSize, totalLength - i);
    const planar = new Float32Array(chunkLen * channels);

    for (let ch = 0; ch < channels; ch++) {
      const srcChannel = ch < buffer.numberOfChannels ? buffer.getChannelData(ch) : buffer.getChannelData(0);
      planar.set(srcChannel.subarray(i, i + chunkLen), ch * chunkLen);
    }

    const audioData = new window.AudioData({
      format: 'f32-planar',
      sampleRate: sampleRate,
      numberOfFrames: chunkLen,
      numberOfChannels: channels,
      timestamp: Math.round((i / sampleRate) * 1_000_000), // in microseconds
      data: planar
    });

    encoder.encode(audioData);
    audioData.close();

    if (onProgress && i % (frameSize * 25) === 0) {
      onProgress(Math.min(0.95, i / totalLength));
      await new Promise(r => setTimeout(r, 0));
    }
  }

  await encoder.flush();
  encoder.close();
  muxer.finalize();

  if (onProgress) onProgress(1.0);

  const rawBuffer = muxer.target.buffer;
  return new Blob([rawBuffer], { type: 'audio/mp4' });
}

function encodeWithMediaRecorder(buffer, mimeType, kbps, onProgress) {
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
        resolve(new Blob(chunks, { type: mimeType }));
      };

      recorder.onerror = (e) => {
        audioCtx.close();
        reject(e.error || new Error('MediaRecorder error during M4A conversion.'));
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
