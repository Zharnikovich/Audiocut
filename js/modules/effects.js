// Audiocut - Feature 4: Volume & Speed Controller Module
import { formatBytes, formatTime, getAudioExtensionMatch } from '../utils/formatters.js';
import { bufferToWav } from '../utils/wav-encoder.js';
import { decodeAudioFile } from '../utils/audio-decode.js';
import { createAudioBuffer } from '../utils/audio-buffer.js';
import { timeStretch } from '../utils/time-stretch.js';
import { saveOrDownloadWav } from '../services/storage.js';
import { registerAudioStopper } from '../components/navigation.js';

let effectsAudioFile = null;
let effectsAudioBuffer = null;
let effectsFileUrl = null;
let effectsFileUrlIsWav = false; // True once we fell back to a WAV render the <audio> element can play
let effectsAudioCtx = null;   // One shared context for previews (created on first play)
let effectsPreviewEl = null;  // <audio> element: supports pitch-preserving playback rates
let effectsGainNode = null;   // Routes the preview through Web Audio so gain can exceed 100%
let decodeToken = 0;

function getSpeed() {
  return parseFloat(document.getElementById('effectsSpeedSlider')?.value || 1.0);
}

function getVolume() {
  return parseFloat(document.getElementById('effectsVolumeSlider')?.value || 100) / 100;
}

function getPreservePitch() {
  return document.getElementById('effectsPreservePitch')?.checked !== false;
}

function setPreviewUI(isPlaying) {
  const playText = document.getElementById('effectsPlayText');
  // Lucide replaces icon elements on every createIcons() call, so always look the icon up fresh
  const playIcon = document.getElementById('effectsPlayIcon');
  if (playText) playText.textContent = isPlaying ? 'Stop Preview' : 'Live Preview';
  if (playIcon) playIcon.setAttribute('data-lucide', isPlaying ? 'square' : 'play');
  if (window.lucide) window.lucide.createIcons();
}

function applyPreviewSettings() {
  if (effectsPreviewEl) {
    effectsPreviewEl.preservesPitch = getPreservePitch();
    effectsPreviewEl.webkitPreservesPitch = getPreservePitch();
    effectsPreviewEl.playbackRate = getSpeed();
  }
  if (effectsGainNode) {
    effectsGainNode.gain.value = getVolume();
  }
}

function stopPreview() {
  if (effectsPreviewEl) {
    effectsPreviewEl.pause();
    effectsPreviewEl.currentTime = 0;
  }
  setPreviewUI(false);
}

export function initEffects() {
  const effectsDropZone = document.getElementById('effectsDropZone');
  const effectsFileInput = document.getElementById('effectsFileInput');
  const effectsRemoveFileBtn = document.getElementById('effectsRemoveFileBtn');
  const effectsVolumeSlider = document.getElementById('effectsVolumeSlider');
  const effectsNormalizeBtn = document.getElementById('effectsNormalizeBtn');
  const effectsResetVolumeBtn = document.getElementById('effectsResetVolumeBtn');
  const effectsSpeedSlider = document.getElementById('effectsSpeedSlider');
  const effectsPreservePitch = document.getElementById('effectsPreservePitch');
  const effectsPlayPauseBtn = document.getElementById('effectsPlayPauseBtn');
  const effectsExportBtn = document.getElementById('effectsExportBtn');

  // Register audio stopper
  registerAudioStopper(stopPreview);

  if (effectsDropZone && effectsFileInput) {
    effectsDropZone.addEventListener('click', () => effectsFileInput.click());
    effectsDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      effectsDropZone.classList.add('border-solid', 'bg-neoYellow/15');
    });
    effectsDropZone.addEventListener('dragleave', () => {
      effectsDropZone.classList.remove('border-solid', 'bg-neoYellow/15');
    });
    effectsDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      effectsDropZone.classList.remove('border-solid', 'bg-neoYellow/15');
      if (e.dataTransfer.files.length > 0) {
        handleEffectsFileSelection(e.dataTransfer.files[0]);
      }
    });

    effectsFileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleEffectsFileSelection(e.target.files[0]);
      }
    });
  }

  if (effectsRemoveFileBtn) {
    effectsRemoveFileBtn.addEventListener('click', resetEffectsFileSelection);
  }

  // Volume Controls
  if (effectsVolumeSlider) {
    effectsVolumeSlider.addEventListener('input', () => {
      const effectsVolumeDisplay = document.getElementById('effectsVolumeDisplay');
      if (effectsVolumeDisplay) effectsVolumeDisplay.textContent = `${effectsVolumeSlider.value}%`;
      applyPreviewSettings();
    });
  }

  if (effectsNormalizeBtn) {
    effectsNormalizeBtn.addEventListener('click', normalizePeak);
  }

  if (effectsResetVolumeBtn) {
    effectsResetVolumeBtn.addEventListener('click', () => {
      if (effectsVolumeSlider) effectsVolumeSlider.value = 100;
      const effectsVolumeDisplay = document.getElementById('effectsVolumeDisplay');
      if (effectsVolumeDisplay) effectsVolumeDisplay.textContent = '100%';
      applyPreviewSettings();
    });
  }

  // Speed Controls
  if (effectsSpeedSlider) {
    effectsSpeedSlider.addEventListener('input', () => {
      const effectsSpeedDisplay = document.getElementById('effectsSpeedDisplay');
      if (effectsSpeedDisplay) effectsSpeedDisplay.textContent = `${getSpeed().toFixed(2)}x`;
      applyPreviewSettings();
    });
  }

  document.querySelectorAll('.effects-speed-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const speed = parseFloat(btn.getAttribute('data-speed'));
      if (effectsSpeedSlider) effectsSpeedSlider.value = speed;
      const effectsSpeedDisplay = document.getElementById('effectsSpeedDisplay');
      if (effectsSpeedDisplay) effectsSpeedDisplay.textContent = `${speed.toFixed(2)}x`;
      applyPreviewSettings();
    });
  });

  if (effectsPreservePitch) {
    effectsPreservePitch.addEventListener('change', applyPreviewSettings);
  }

  // Live Preview
  if (effectsPlayPauseBtn) {
    effectsPlayPauseBtn.addEventListener('click', toggleLivePreview);
  }

  // Export
  if (effectsExportBtn) {
    effectsExportBtn.addEventListener('click', exportProcessedAudio);
  }
}

async function handleEffectsFileSelection(file) {
  if (!getAudioExtensionMatch(file.name)) {
    alert('Please select a valid audio file.');
    return;
  }

  const effectsFileName = document.getElementById('effectsFileName');
  const effectsFileMeta = document.getElementById('effectsFileMeta');
  const effectsDropZone = document.getElementById('effectsDropZone');
  const effectsWorkspace = document.getElementById('effectsWorkspace');
  const effectsStatusBadge = document.getElementById('effectsStatusBadge');
  const effectsVolumeSlider = document.getElementById('effectsVolumeSlider');
  const effectsVolumeDisplay = document.getElementById('effectsVolumeDisplay');
  const effectsSpeedSlider = document.getElementById('effectsSpeedSlider');
  const effectsSpeedDisplay = document.getElementById('effectsSpeedDisplay');

  // Stop and release the previous file's preview before loading a new one
  releasePreview();
  const token = ++decodeToken;

  effectsAudioFile = file;
  effectsAudioBuffer = null;
  if (effectsFileName) effectsFileName.textContent = file.name;
  if (effectsFileMeta) effectsFileMeta.textContent = 'Decoding audio...';
  if (effectsDropZone) effectsDropZone.classList.add('hidden');
  if (effectsWorkspace) effectsWorkspace.classList.remove('hidden');
  if (effectsStatusBadge) effectsStatusBadge.classList.remove('hidden');

  try {
    const decoded = await decodeAudioFile(file);
    if (token !== decodeToken) return;
    effectsAudioBuffer = decoded;
    effectsFileUrl = URL.createObjectURL(file);

    if (effectsFileMeta) {
      effectsFileMeta.textContent = `${formatTime(effectsAudioBuffer.duration)} • ${effectsAudioBuffer.sampleRate} Hz • ${effectsAudioBuffer.numberOfChannels} ch • ${formatBytes(file.size)}`;
    }

    if (effectsVolumeSlider) effectsVolumeSlider.value = 100;
    if (effectsVolumeDisplay) effectsVolumeDisplay.textContent = '100%';
    if (effectsSpeedSlider) effectsSpeedSlider.value = 1.0;
    if (effectsSpeedDisplay) effectsSpeedDisplay.textContent = '1.00x';
  } catch (err) {
    if (token !== decodeToken) return;
    console.error('Effects decode error:', err);
    alert('Could not decode audio for volume/speed adjustment.');
    resetEffectsFileSelection();
  }
}

function releasePreview() {
  if (effectsPreviewEl) {
    effectsPreviewEl.pause();
    effectsPreviewEl.removeAttribute('src');
    effectsPreviewEl.load();
  }
  if (effectsFileUrl) {
    URL.revokeObjectURL(effectsFileUrl);
    effectsFileUrl = null;
  }
  effectsFileUrlIsWav = false;
  setPreviewUI(false);
}

function resetEffectsFileSelection() {
  decodeToken++;
  releasePreview();
  effectsAudioFile = null;
  effectsAudioBuffer = null;

  const effectsDropZone = document.getElementById('effectsDropZone');
  const effectsWorkspace = document.getElementById('effectsWorkspace');
  const effectsStatusBadge = document.getElementById('effectsStatusBadge');
  const effectsFileInput = document.getElementById('effectsFileInput');

  if (effectsDropZone) effectsDropZone.classList.remove('hidden');
  if (effectsWorkspace) effectsWorkspace.classList.add('hidden');
  if (effectsStatusBadge) effectsStatusBadge.classList.add('hidden');
  if (effectsFileInput) effectsFileInput.value = '';
}

function normalizePeak() {
  if (!effectsAudioBuffer) return;
  const effectsVolumeSlider = document.getElementById('effectsVolumeSlider');
  const effectsVolumeDisplay = document.getElementById('effectsVolumeDisplay');

  let peak = 0;
  for (let c = 0; c < effectsAudioBuffer.numberOfChannels; c++) {
    const data = effectsAudioBuffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
  }

  if (peak > 0) {
    const targetPercent = Math.min(300, Math.round((0.98 / peak) * 100));
    if (effectsVolumeSlider) effectsVolumeSlider.value = targetPercent;
    if (effectsVolumeDisplay) effectsVolumeDisplay.textContent = `${targetPercent}%`;
    applyPreviewSettings();
    alert(`Peak normalized to ${targetPercent}% gain (original peak was ${(peak * 100).toFixed(1)}%).`);
  }
}

function toggleLivePreview() {
  if (!effectsAudioBuffer || !effectsFileUrl) return;

  if (effectsPreviewEl && !effectsPreviewEl.paused) {
    stopPreview();
    return;
  }

  if (!effectsAudioCtx) {
    effectsAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // A context created before any user gesture (e.g. a drag & drop) starts suspended
  if (effectsAudioCtx.state === 'suspended') {
    effectsAudioCtx.resume();
  }

  if (!effectsPreviewEl) {
    // A media element can only be connected to Web Audio once, so it is created once and reused
    effectsPreviewEl = new Audio();
    effectsGainNode = effectsAudioCtx.createGain();
    effectsAudioCtx.createMediaElementSource(effectsPreviewEl).connect(effectsGainNode);
    effectsGainNode.connect(effectsAudioCtx.destination);
    effectsPreviewEl.addEventListener('ended', () => setPreviewUI(false));
  }

  startPreviewPlayback();
}

function startPreviewPlayback() {
  if (effectsPreviewEl.getAttribute('src') !== effectsFileUrl) {
    effectsPreviewEl.src = effectsFileUrl;
  }
  applyPreviewSettings();
  effectsPreviewEl.currentTime = 0;
  effectsPreviewEl.play().catch(err => {
    // Some formats decode fine but cannot play in an <audio> element (e.g. AIFF in Chrome)
    if (err.name === 'NotSupportedError' && !effectsFileUrlIsWav && effectsAudioBuffer) {
      URL.revokeObjectURL(effectsFileUrl);
      effectsFileUrl = URL.createObjectURL(bufferToWav(effectsAudioBuffer));
      effectsFileUrlIsWav = true;
      startPreviewPlayback();
      return;
    }
    console.error('Preview playback failed:', err);
    setPreviewUI(false);
  });
  setPreviewUI(true);
}

async function renderWithSpeed(buffer, speed, volume, preservePitch, onProgress) {
  if (preservePitch && speed !== 1) {
    // Time-stretch keeps the pitch; gain is applied to the stretched samples
    const stretched = await timeStretch(buffer, speed, onProgress);
    const out = createAudioBuffer(stretched.length, stretched[0].length, buffer.sampleRate);
    stretched.forEach((data, ch) => {
      if (volume !== 1) {
        for (let i = 0; i < data.length; i++) data[i] *= volume;
      }
      out.copyToChannel(data, ch);
    });
    return out;
  }

  // Tape-style: playback rate changes speed and pitch together
  const targetLength = Math.max(1, Math.round(buffer.length / speed));
  const offlineCtx = new OfflineAudioContext(buffer.numberOfChannels, targetLength, buffer.sampleRate);

  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = speed;

  const gain = offlineCtx.createGain();
  gain.gain.value = volume;

  source.connect(gain);
  gain.connect(offlineCtx.destination);
  source.start(0);

  return await offlineCtx.startRendering();
}

async function exportProcessedAudio() {
  if (!effectsAudioBuffer) return;

  const effectsExportBtn = document.getElementById('effectsExportBtn');
  const setButtonText = (text) => {
    if (effectsExportBtn) effectsExportBtn.innerHTML = `<span class="animate-spin inline-block mr-2">⏳</span> ${text}`;
  };

  if (effectsExportBtn) effectsExportBtn.disabled = true;
  setButtonText('Processing audio...');

  try {
    const volumeMultiplier = getVolume();
    const speedMultiplier = getSpeed();
    const preservePitch = getPreservePitch();

    const renderedBuffer = await renderWithSpeed(
      effectsAudioBuffer,
      speedMultiplier,
      volumeMultiplier,
      preservePitch,
      (p) => setButtonText(`Processing audio... ${Math.round(p * 100)}%`)
    );
    const wavBlob = bufferToWav(renderedBuffer, 0, renderedBuffer.length);

    const baseName = effectsAudioFile.name.replace(/\.[^/.]+$/, '');
    const outFilename = `${baseName}_vol${Math.round(volumeMultiplier * 100)}_speed${speedMultiplier.toFixed(2)}x.wav`;

    await saveOrDownloadWav(wavBlob, outFilename);
  } catch (err) {
    console.error('Effects export error:', err);
    alert('Error exporting processed audio: ' + err.message);
  } finally {
    if (effectsExportBtn) {
      effectsExportBtn.disabled = false;
      effectsExportBtn.innerHTML = '<i data-lucide="download" class="w-6 h-6 stroke-[3]"></i><span>Export Processed Audio</span>';
    }
    if (window.lucide) window.lucide.createIcons();
  }
}
