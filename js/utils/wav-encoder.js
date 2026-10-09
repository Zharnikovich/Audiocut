// Audiocut - Lossless 16-Bit / 24-Bit PCM WAV Encoder

export function bufferToWav(buffer, offset = 0, length = null, options = {}) {
  const bitDepth = options.bitDepth === 24 ? 24 : 16;
  const requestedChannels = options.channels || buffer.numberOfChannels;
  const numOfChan = Math.min(requestedChannels, 2); // Cap at stereo
  const sampleRate = options.sampleRate || buffer.sampleRate;
  const actualLength = length !== null ? length : buffer.length - offset;
  
  let result;
  if (numOfChan === 2 && buffer.numberOfChannels >= 2) {
    result = interleave(buffer.getChannelData(0), buffer.getChannelData(1), offset, actualLength);
  } else if (numOfChan === 2 && buffer.numberOfChannels === 1) {
    // Mono to stereo interleave
    result = interleave(buffer.getChannelData(0), buffer.getChannelData(0), offset, actualLength);
  } else {
    result = buffer.getChannelData(0).subarray(offset, offset + actualLength);
  }
  
  return writeWavFile(result, numOfChan, sampleRate, bitDepth);
}

function interleave(inputL, inputR, offset, length) {
  const result = new Float32Array(length * 2);
  let index = 0;
  const end = offset + length;
  
  for (let i = offset; i < end; i++) {
    result[index++] = (i < inputL.length) ? inputL[i] : 0;
    result[index++] = (i < inputR.length) ? inputR[i] : 0;
  }
  return result;
}

function writeWavFile(samples, numOfChan, sampleRate, bitDepth) {
  const bytesPerSample = bitDepth / 8;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  
  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* file length */
  view.setUint32(4, 36 + dataSize, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (1 = raw PCM) */
  view.setUint16(20, 1, true);
  /* channel count */
  view.setUint16(22, numOfChan, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * numOfChan * bytesPerSample, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, numOfChan * bytesPerSample, true);
  /* bits per sample */
  view.setUint16(34, bitDepth, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, dataSize, true);
  
  // Write PCM samples
  if (bitDepth === 24) {
    floatTo24BitPCM(view, 44, samples);
  } else {
    floatTo16BitPCM(view, 44, samples);
  }
  
  return new Blob([view], { type: 'audio/wav' });
}

function floatTo16BitPCM(output, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
}

function floatTo24BitPCM(output, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 3) {
    const s = Math.max(-1, Math.min(1, input[i]));
    const intVal = s < 0 ? s * 0x800000 : s * 0x7FFFFF;
    const clamped = Math.floor(intVal);
    output.setUint8(offset, clamped & 0xFF);
    output.setUint8(offset + 1, (clamped >> 8) & 0xFF);
    output.setUint8(offset + 2, (clamped >> 16) & 0xFF);
  }
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
