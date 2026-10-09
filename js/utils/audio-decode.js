// Audiocut - Native Sample-Rate Audio Decoding
//
// decodeAudioData() resamples everything to the sample rate of the context it is called on
// (a realtime AudioContext runs at the sound card's rate, e.g. 48 kHz). To keep audio at its
// original rate we sniff the rate from the file header and decode with an OfflineAudioContext
// created at that rate. Unknown formats fall back to the browser's default context.

const MIN_RATE = 8000;
const MAX_RATE = 384000;

export async function decodeAudioFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const nativeRate = detectSampleRate(arrayBuffer);
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;

  if (nativeRate && OfflineCtx) {
    try {
      const ctx = new OfflineCtx(1, 1, nativeRate);
      // decodeAudioData detaches its input, so pass a copy in case we need the fallback
      return await ctx.decodeAudioData(arrayBuffer.slice(0));
    } catch (err) {
      console.warn(`Native-rate decode at ${nativeRate} Hz failed, using default context:`, err);
    }
  }

  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    return await ctx.decodeAudioData(arrayBuffer);
  } finally {
    ctx.close();
  }
}

// Returns the sample rate stored in the file header, or null when it cannot be determined
export function detectSampleRate(arrayBuffer) {
  try {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    const rate =
      detectWav(bytes, view) ??
      detectAiff(bytes, view) ??
      detectFlac(bytes) ??
      detectOgg(bytes, view) ??
      detectMp4(bytes, view) ??
      detectMpegStream(bytes);
    return rate && rate >= MIN_RATE && rate <= MAX_RATE ? Math.round(rate) : null;
  } catch (err) {
    return null;
  }
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function detectWav(bytes, view) {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') return null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') return view.getUint32(offset + 12, true);
    offset += 8 + size + (size % 2);
  }
  return null;
}

function detectAiff(bytes, view) {
  if (ascii(bytes, 0, 4) !== 'FORM') return null;
  const type = ascii(bytes, 8, 4);
  if (type !== 'AIFF' && type !== 'AIFC') return null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, false);
    if (id === 'COMM') return readExtended80(view, offset + 16);
    offset += 8 + size + (size % 2);
  }
  return null;
}

// IEEE 754 80-bit extended float (big-endian), as used by AIFF
function readExtended80(view, offset) {
  const exponent = view.getUint16(offset, false) & 0x7FFF;
  const hi = view.getUint32(offset + 2, false);
  const lo = view.getUint32(offset + 6, false);
  if (exponent === 0 && hi === 0 && lo === 0) return 0;
  return (hi * 2 ** 32 + lo) * 2 ** (exponent - 16383 - 63);
}

function detectFlac(bytes) {
  if (ascii(bytes, 0, 4) !== 'fLaC') return null;
  // STREAMINFO is always the first metadata block; its data starts at byte 8
  return (bytes[18] << 12) | (bytes[19] << 4) | (bytes[20] >> 4);
}

function detectOgg(bytes, view) {
  if (ascii(bytes, 0, 4) !== 'OggS') return null;
  const packet = 27 + bytes[26];
  if (ascii(bytes, packet, 8) === 'OpusHead') return 48000; // Opus always decodes at 48 kHz
  if (bytes[packet] === 1 && ascii(bytes, packet + 1, 6) === 'vorbis') {
    return view.getUint32(packet + 12, true);
  }
  return null;
}

// MP4 / M4A: walk moov > trak > mdia > minf > stbl > stsd and read the audio sample entry
function detectMp4(bytes, view) {
  if (ascii(bytes, 4, 4) !== 'ftyp') return null;
  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);
  let trackTimescale = 0; // From the current track's mdhd, which precedes its stsd

  const walk = (start, end) => {
    let offset = start;
    while (offset + 8 <= end) {
      let size = view.getUint32(offset, false);
      const type = ascii(bytes, offset + 4, 4);
      let header = 8;
      if (size === 1) {
        size = Number(view.getBigUint64(offset + 8, false));
        header = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < header) return null;

      if (containers.has(type)) {
        const found = walk(offset + header, Math.min(end, offset + size));
        if (found) return found;
      } else if (type === 'mdhd') {
        const version = bytes[offset + header];
        trackTimescale = view.getUint32(offset + header + (version === 1 ? 20 : 12), false);
      } else if (type === 'stsd') {
        // Full box header (4) + entry count (4), then the first sample entry
        const entry = offset + header + 8;
        const codec = ascii(bytes, entry + 4, 4);
        if (codec === 'Opus') return 48000;
        if (codec === 'mp4a' || codec === 'alac' || codec === 'fLaC') {
          // Audio tracks use the sample rate as their timescale. The sample entry's own
          // 16.16 rate field (32 bytes in) cannot hold rates above 65535, so it is only a fallback.
          const rate = (trackTimescale >= MIN_RATE && trackTimescale <= MAX_RATE)
            ? trackTimescale
            : view.getUint16(entry + 32, false);
          // HE-AAC may store the core (half) rate while decoding at double; let the browser pick
          if (codec === 'mp4a' && rate < 32000) return null;
          return rate;
        }
      }
      offset += size;
    }
    return null;
  };

  return walk(0, bytes.length);
}

const MPEG_RATES = {
  3: [44100, 48000, 32000], // MPEG-1
  2: [22050, 24000, 16000], // MPEG-2
  0: [11025, 12000, 8000]   // MPEG-2.5
};
const ADTS_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

// Raw MP3 or ADTS AAC streams: skip any ID3v2 tag, then read the first frame header
function detectMpegStream(bytes) {
  let offset = 0;
  if (ascii(bytes, 0, 3) === 'ID3') {
    const tagSize = ((bytes[6] & 0x7F) << 21) | ((bytes[7] & 0x7F) << 14) | ((bytes[8] & 0x7F) << 7) | (bytes[9] & 0x7F);
    offset = 10 + tagSize + ((bytes[5] & 0x10) ? 10 : 0);
  }

  const limit = Math.min(bytes.length - 4, offset + 65536);
  for (let i = offset; i < limit; i++) {
    if (bytes[i] !== 0xFF || (bytes[i + 1] & 0xE0) !== 0xE0) continue;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];

    if ((b1 & 0xF6) === 0xF0) {
      // ADTS (AAC): the header holds the core rate, which is half the output rate for HE-AAC
      const rate = ADTS_RATES[(b2 >> 2) & 0x0F];
      return rate && rate >= 32000 ? rate : null;
    }

    const version = (b1 >> 3) & 0x03;
    const layer = (b1 >> 1) & 0x03;
    const rateIndex = (b2 >> 2) & 0x03;
    const bitrateIndex = b2 >> 4;
    if (version === 1 || layer === 0 || rateIndex === 3 || bitrateIndex === 0 || bitrateIndex === 15) continue;
    return MPEG_RATES[version][rateIndex];
  }
  return null;
}
