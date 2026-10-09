// Audiocut - MP3 Audio Encoder (powered by LAME)

export async function bufferToMp3(buffer, options = {}, onProgress = null) {
  if (typeof window === 'undefined' || !window.lamejs || !window.lamejs.Mp3Encoder) {
    throw new Error('MP3 encoder library (lamejs) is not loaded.');
  }

  const requestedChannels = options.channels || buffer.numberOfChannels;
  const channels = Math.min(requestedChannels, 2);
  const sampleRate = options.sampleRate || buffer.sampleRate;
  const kbps = options.bitrate || 192;

  const mp3Encoder = new window.lamejs.Mp3Encoder(channels, sampleRate, kbps);
  const mp3Data = [];
  const sampleBlockSize = 1152; // LAME standard frame size
  const totalLength = buffer.length;

  if (channels === 2) {
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;

    for (let i = 0; i < totalLength; i += sampleBlockSize) {
      const chunkLen = Math.min(sampleBlockSize, totalLength - i);
      const leftChunk = new Int16Array(chunkLen);
      const rightChunk = new Int16Array(chunkLen);

      for (let j = 0; j < chunkLen; j++) {
        const sL = Math.max(-1, Math.min(1, left[i + j]));
        leftChunk[j] = sL < 0 ? sL * 0x8000 : sL * 0x7FFF;

        const sR = Math.max(-1, Math.min(1, right[i + j]));
        rightChunk[j] = sR < 0 ? sR * 0x8000 : sR * 0x7FFF;
      }

      const mp3buf = mp3Encoder.encodeBuffer(leftChunk, rightChunk);
      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      }

      if (onProgress && i % (sampleBlockSize * 15) === 0) {
        onProgress(Math.min(0.95, i / totalLength));
        // Yield momentarily to main thread so UI updates smoothly
        await new Promise(r => setTimeout(r, 0));
      }
    }
  } else {
    const mono = buffer.getChannelData(0);

    for (let i = 0; i < totalLength; i += sampleBlockSize) {
      const chunkLen = Math.min(sampleBlockSize, totalLength - i);
      const monoChunk = new Int16Array(chunkLen);

      for (let j = 0; j < chunkLen; j++) {
        const s = Math.max(-1, Math.min(1, mono[i + j]));
        monoChunk[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      const mp3buf = mp3Encoder.encodeBuffer(monoChunk);
      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      }

      if (onProgress && i % (sampleBlockSize * 15) === 0) {
        onProgress(Math.min(0.95, i / totalLength));
        await new Promise(r => setTimeout(r, 0));
      }
    }
  }

  const flushBuf = mp3Encoder.flush();
  if (flushBuf.length > 0) {
    mp3Data.push(flushBuf);
  }

  if (onProgress) onProgress(1.0);

  return new Blob(mp3Data, { type: 'audio/mp3' });
}
