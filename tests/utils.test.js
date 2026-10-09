// Audiocut - Unit tests for pure audio utilities (run via tests/index.html)
import { detectSampleRate } from '../js/utils/audio-decode.js';
import { computeSplitSegments, encoderSampleRate } from '../js/utils/audio-buffer.js';
import { escapeHtml } from '../js/utils/formatters.js';
import { timeStretch } from '../js/utils/time-stretch.js';
import { bufferToWav } from '../js/utils/wav-encoder.js';
import { bufferToAiff } from '../js/utils/aiff-encoder.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

// Minimal AudioBuffer stand-in filled with a sine per channel
function mockBuffer(channels, length, sampleRate, freq = 440) {
  const data = Array.from({ length: channels }, (_, ch) => {
    const arr = new Float32Array(length);
    for (let i = 0; i < length; i++) arr[i] = 0.5 * Math.sin((2 * Math.PI * freq * (ch + 1) * i) / sampleRate);
    return arr;
  });
  return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: ch => data[ch] };
}

function zeroCrossingFreq(samples, sampleRate) {
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i - 1] < 0) !== (samples[i] < 0)) crossings++;
  }
  return crossings / 2 / (samples.length / sampleRate);
}

export const tests = [
  {
    name: 'detectSampleRate reads WAV files written by the WAV encoder',
    async fn() {
      for (const rate of [22050, 44100, 96000]) {
        const bytes = await bufferToWav(mockBuffer(2, 1000, rate)).arrayBuffer();
        assertEqual(detectSampleRate(bytes), rate, `WAV @ ${rate}`);
      }
    }
  },
  {
    name: 'detectSampleRate reads AIFF files written by the AIFF encoder',
    async fn() {
      for (const rate of [32000, 48000, 88200]) {
        const bytes = await bufferToAiff(mockBuffer(1, 1000, rate)).arrayBuffer();
        assertEqual(detectSampleRate(bytes), rate, `AIFF @ ${rate}`);
      }
    }
  },
  {
    name: 'detectSampleRate reads MP3 frame headers after an ID3 tag',
    fn() {
      // 10-byte ID3v2 header declaring a 4-byte tag, then an MPEG-1 Layer III 32 kHz frame header
      const bytes = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0xFF, 0xFB, 0x98, 0x00, 0, 0]);
      assertEqual(detectSampleRate(bytes.buffer), 32000, 'MP3 rate');
    }
  },
  {
    name: 'detectSampleRate returns null for unknown data',
    fn() {
      assertEqual(detectSampleRate(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).buffer), null, 'garbage');
      assertEqual(detectSampleRate(new ArrayBuffer(0)), null, 'empty');
    }
  },
  {
    name: 'computeSplitSegments covers every sample exactly once',
    fn() {
      for (const [seconds, rate, split] of [[30, 44100, 0.1], [10, 48000, 0.3], [3600, 48000, 0.7], [181.37, 44100, 60]]) {
        const total = Math.round(seconds * rate);
        const segments = computeSplitSegments(total, rate, split);
        let expectedStart = 0;
        segments.forEach((seg, i) => {
          assertEqual(seg.startSample, expectedStart, `segment ${i} start (${seconds}s / ${split}s)`);
          assert(seg.length > 0, `segment ${i} is empty`);
          expectedStart += seg.length;
        });
        assertEqual(expectedStart, total, `total samples (${seconds}s / ${split}s)`);
        assertEqual(segments.length, Math.ceil(total / (split * rate) - 1e-9), `slice count (${seconds}s / ${split}s)`);
      }
    }
  },
  {
    name: 'computeSplitSegments rejects durations below the minimum',
    fn() {
      assertEqual(computeSplitSegments(44100, 44100, 0.01).length, 0, 'too short');
      assertEqual(computeSplitSegments(44100, 44100, NaN).length, 0, 'NaN');
    }
  },
  {
    name: 'encoderSampleRate maps unsupported rates for MP3/M4A only',
    fn() {
      assertEqual(encoderSampleRate('mp3', 96000), 48000, 'mp3 96k');
      assertEqual(encoderSampleRate('mp3', 88200), 44100, 'mp3 88.2k');
      assertEqual(encoderSampleRate('mp3', 22050), 22050, 'mp3 22.05k');
      assertEqual(encoderSampleRate('m4a', 22050), 44100, 'm4a 22.05k');
      assertEqual(encoderSampleRate('wav', 96000), 96000, 'wav untouched');
    }
  },
  {
    name: 'escapeHtml neutralises markup in file names',
    fn() {
      assertEqual(escapeHtml(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;', 'escaped');
    }
  },
  {
    name: 'timeStretch changes duration but keeps pitch and level',
    async fn() {
      const rate = 44100;
      for (const tempo of [0.5, 1.5]) {
        const [left] = await timeStretch(mockBuffer(2, rate * 2, rate), tempo);
        assertEqual(left.length, Math.round((rate * 2) / tempo), `length @ ${tempo}x`);
        const middle = left.subarray(4096, left.length - 4096);
        const freq = zeroCrossingFreq(middle, rate);
        assert(Math.abs(freq - 440) < 2, `pitch @ ${tempo}x was ${freq.toFixed(1)} Hz`);
        const rms = Math.sqrt(middle.reduce((sum, v) => sum + v * v, 0) / middle.length);
        assert(Math.abs(rms - 0.3536) < 0.01, `level @ ${tempo}x was ${rms.toFixed(3)}`);
      }
    }
  }
];
