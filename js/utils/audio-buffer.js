// Audiocut - AudioBuffer Helpers (slicing, remixing, resampling, encoder rate limits)

// Sample rates each lossy encoder accepts; WAV/AIFF take any rate and Opus resamples internally
const ENCODER_RATES = {
  mp3: [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000], // LAME (MPEG 1/2/2.5)
  m4a: [44100, 48000] // AAC rates supported by every WebCodecs backend
};

// Returns the closest rate the target encoder supports, preferring the same rate family
export function encoderSampleRate(format, sampleRate) {
  const supported = ENCODER_RATES[format];
  if (!supported || supported.includes(sampleRate)) return sampleRate;
  return sampleRate % 11025 === 0 ? 44100 : 48000;
}

export function createAudioBuffer(numberOfChannels, length, sampleRate) {
  return new AudioBuffer({ numberOfChannels, length: Math.max(1, length), sampleRate });
}

// Copies [startSample, startSample + length) into a new AudioBuffer
export function sliceBuffer(buffer, startSample, length) {
  const sliced = createAudioBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    sliced.copyToChannel(buffer.getChannelData(ch).subarray(startSample, startSample + length), ch);
  }
  return sliced;
}

// Remixes to `channels` and resamples to `sampleRate`; returns the input untouched when nothing changes
export async function resampleBuffer(buffer, channels, sampleRate) {
  if (channels === buffer.numberOfChannels && sampleRate === buffer.sampleRate) {
    return buffer;
  }

  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const length = Math.max(1, Math.round(buffer.duration * sampleRate));
  const offlineCtx = new OfflineCtx(channels, length, sampleRate);

  const src = offlineCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(offlineCtx.destination);
  src.start(0);

  return await offlineCtx.startRendering();
}

export const MIN_SPLIT_SECONDS = 0.1;
export const MAX_SPLIT_SLICES = 2000;

// Splits `totalSamples` into consecutive slices of `splitSeconds`, working in whole samples so
// slices never overlap or skip samples. Returns [] for an invalid duration.
export function computeSplitSegments(totalSamples, sampleRate, splitSeconds) {
  if (!(splitSeconds >= MIN_SPLIT_SECONDS) || totalSamples <= 0) return [];

  const segments = [];
  const count = Math.ceil(totalSamples / (splitSeconds * sampleRate) - 1e-9);
  for (let i = 0; i < count; i++) {
    const startSample = Math.round(i * splitSeconds * sampleRate);
    const endSample = Math.min(totalSamples, Math.round((i + 1) * splitSeconds * sampleRate));
    if (endSample <= startSample) break;
    segments.push({
      startSample,
      length: endSample - startSample,
      start: startSample / sampleRate,
      end: endSample / sampleRate,
      duration: (endSample - startSample) / sampleRate
    });
  }
  return segments;
}
