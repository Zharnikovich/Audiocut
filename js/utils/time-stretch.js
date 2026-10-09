// Audiocut - Pitch-Preserving Time Stretch (WSOLA: Waveform Similarity Overlap-Add)
//
// Output frames are Hann-windowed and overlap by 50%, so they sum back to unity gain. Each frame
// is read from near its nominal input position (output position * tempo), nudged within ±SEEK
// samples to the spot whose waveform best continues the previous frame. This changes duration
// without the pitch shift that a plain playback-rate change causes.

const FRAME = 2048;
const HOP = FRAME / 2;
const SEEK = 256;
const COARSE_STEP = 8;
const CORR_STRIDE = 8;

const WINDOW = new Float32Array(FRAME);
for (let n = 0; n < FRAME; n++) {
  WINDOW[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / FRAME);
}

// Returns one Float32Array per channel, round(buffer.length / tempo) samples long
export async function timeStretch(buffer, tempo, onProgress = null) {
  const channels = buffer.numberOfChannels;
  const inLen = buffer.length;
  const input = [];
  for (let ch = 0; ch < channels; ch++) input.push(buffer.getChannelData(ch));

  // Similarity search runs on a mono mix; the chosen offset is applied to every channel
  let guide = input[0];
  if (channels > 1) {
    guide = new Float32Array(inLen);
    for (let ch = 0; ch < channels; ch++) {
      const data = input[ch];
      for (let i = 0; i < inLen; i++) guide[i] += data[i] / channels;
    }
  }

  const outLen = Math.max(1, Math.round(inLen / tempo));
  const output = Array.from({ length: channels }, () => new Float32Array(outLen));

  // Frame k is centred on output sample k * HOP and spans [centre - HOP, centre + HOP)
  const frameCount = Math.ceil(outLen / HOP) + 1;
  let prevCentre = 0;

  for (let k = 0; k < frameCount; k++) {
    const nominal = Math.round(k * HOP * tempo);
    const centre = k === 0 ? 0 : findBestCentre(guide, inLen, prevCentre, nominal);
    const outStart = k * HOP - HOP;
    const inStart = centre - HOP;

    for (let ch = 0; ch < channels; ch++) {
      const src = input[ch];
      const dst = output[ch];
      for (let n = 0; n < FRAME; n++) {
        const o = outStart + n;
        const i = inStart + n;
        if (o >= 0 && o < outLen && i >= 0 && i < inLen) {
          dst[o] += src[i] * WINDOW[n];
        }
      }
    }
    prevCentre = centre;

    if (onProgress && k % 256 === 0) {
      onProgress(k / frameCount);
      await new Promise(r => setTimeout(r, 0));
    }
  }

  if (onProgress) onProgress(1);
  return output;
}

// The overlap region should continue the previous frame naturally, i.e. match the input that
// directly follows it (guide[prevCentre + m]). Coarse search over ±SEEK, then refine.
function findBestCentre(guide, inLen, prevCentre, nominal) {
  const lo = Math.max(0, nominal - SEEK);
  const hi = nominal + SEEK;

  const score = (cand) => {
    let dot = 0;
    let energy = 0;
    const candStart = cand - HOP;
    for (let m = 0; m < HOP; m += CORR_STRIDE) {
      const ri = prevCentre + m;
      const ci = candStart + m;
      const r = ri < inLen ? guide[ri] : 0;
      const c = ci >= 0 && ci < inLen ? guide[ci] : 0;
      dot += r * c;
      energy += c * c;
    }
    return dot / Math.sqrt(energy + 1e-9);
  };

  // Start from the nominal position so silence or ties do not drift the timing
  let best = Math.max(lo, nominal);
  let bestScore = score(best);
  for (let cand = lo; cand <= hi; cand += COARSE_STEP) {
    const s = score(cand);
    if (s > bestScore) { bestScore = s; best = cand; }
  }
  const coarseBest = best;
  for (let cand = Math.max(lo, coarseBest - COARSE_STEP + 1); cand <= Math.min(hi, coarseBest + COARSE_STEP - 1); cand++) {
    const s = score(cand);
    if (s > bestScore) { bestScore = s; best = cand; }
  }
  return best;
}
