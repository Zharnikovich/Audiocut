// Audiocut - Lossless 16-Bit / 24-Bit PCM AIFF Encoder (Apple Audio Interchange File Format)

export function bufferToAiff(buffer, offset = 0, length = null, options = {}) {
  const bitDepth = options.bitDepth === 24 ? 24 : 16;
  const requestedChannels = options.channels || buffer.numberOfChannels;
  const numOfChan = Math.min(requestedChannels, 2); // Cap at stereo
  const sampleRate = options.sampleRate || buffer.sampleRate;
  const actualLength = length !== null ? length : buffer.length - offset;

  let result;
  if (numOfChan === 2 && buffer.numberOfChannels >= 2) {
    result = interleave(buffer.getChannelData(0), buffer.getChannelData(1), offset, actualLength);
  } else if (numOfChan === 2 && buffer.numberOfChannels === 1) {
    result = interleave(buffer.getChannelData(0), buffer.getChannelData(0), offset, actualLength);
  } else {
    result = buffer.getChannelData(0).subarray(offset, offset + actualLength);
  }

  return writeAiffFile(result, numOfChan, sampleRate, bitDepth, actualLength);
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

function writeAiffFile(samples, numOfChan, sampleRate, bitDepth, numFrames) {
  const bytesPerSample = bitDepth / 8;
  const dataSize = samples.length * bytesPerSample;
  const commSize = 18;
  const ssndSize = 8 + dataSize;
  const formSize = 4 + (8 + commSize) + (8 + ssndSize);

  const buffer = new ArrayBuffer(8 + formSize);
  const view = new DataView(buffer);

  // FORM Header
  writeString(view, 0, 'FORM');
  view.setUint32(4, formSize, false); // Big-Endian
  writeString(view, 8, 'AIFF');

  // COMM Chunk
  writeString(view, 12, 'COMM');
  view.setUint32(16, commSize, false);
  view.setUint16(20, numOfChan, false);
  view.setUint32(22, numFrames, false);
  view.setUint16(26, bitDepth, false);
  writeExtended80(view, 28, sampleRate);

  // SSND Chunk
  const ssndOffset = 38;
  writeString(view, ssndOffset, 'SSND');
  view.setUint32(ssndOffset + 4, ssndSize, false);
  view.setUint32(ssndOffset + 8, 0, false); // offset = 0
  view.setUint32(ssndOffset + 12, 0, false); // blockSize = 0

  // Write PCM samples (Big Endian)
  const dataOffset = ssndOffset + 16;
  if (bitDepth === 24) {
    floatTo24BitAiffPCM(view, dataOffset, samples);
  } else {
    floatTo16BitAiffPCM(view, dataOffset, samples);
  }

  return new Blob([view], { type: 'audio/aiff' });
}

function floatTo16BitAiffPCM(output, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
    output.setInt16(offset, val, false); // Big-Endian
  }
}

function floatTo24BitAiffPCM(output, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 3) {
    const s = Math.max(-1, Math.min(1, input[i]));
    const intVal = s < 0 ? s * 0x800000 : s * 0x7FFFFF;
    const clamped = Math.floor(intVal);
    output.setUint8(offset, (clamped >> 16) & 0xFF);
    output.setUint8(offset + 1, (clamped >> 8) & 0xFF);
    output.setUint8(offset + 2, clamped & 0xFF);
  }
}

// Writes an IEEE 754 80-bit extended floating-point number (10 bytes, Big-Endian)
function writeExtended80(view, offset, value) {
  if (value === 0) {
    view.setUint16(offset, 0, false);
    view.setUint32(offset + 2, 0, false);
    view.setUint32(offset + 6, 0, false);
    return;
  }
  let exp = 0;
  let val = value;
  while (val >= 2.0) {
    val /= 2.0;
    exp++;
  }
  while (val < 1.0) {
    val *= 2.0;
    exp--;
  }
  const exponent = exp + 16383;
  view.setUint16(offset, exponent, false);
  const hi = Math.floor(val * 0x80000000);
  const lo = Math.floor((val * 0x80000000 - hi) * 0x100000000);
  view.setUint32(offset + 2, hi, false);
  view.setUint32(offset + 6, lo, false);
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
