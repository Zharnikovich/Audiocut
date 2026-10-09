// Audiocut - Feature 4: Volume & Speed Controller Module
import { formatBytes, formatTime, getAudioExtensionMatch } from '../utils/formatters.js';
import { bufferToWav } from '../utils/wav-encoder.js';
import { saveOrDownloadWav } from '../services/storage.js';
import { registerAudioStopper } from '../components/navigation.js';

let effectsAudioFile = null;
let effectsAudioBuffer = null;
let effectsAudioCtx = null;
let effectsSourceNode = null;
let effectsGainNode = null;
let effectsIsPlaying = false;

export function initEffects() {
  const effectsDropZone = document.getElementById('effectsDropZone');
  const effectsFileInput = document.getElementById('effectsFileInput');
  const effectsRemoveFileBtn = document.getElementById('effectsRemoveFileBtn');
  const effectsVolumeSlider = document.getElementById('effectsVolumeSlider');
  const effectsNormalizeBtn = document.getElementById('effectsNormalizeBtn');
  const effectsResetVolumeBtn = document.getElementById('effectsResetVolumeBtn');
  const effectsSpeedSlider = document.getElementById('effectsSpeedSlider');
  const effectsPlayPauseBtn = document.getElementById('effectsPlayPauseBtn');
  const effectsExportBtn = document.getElementById('effectsExportBtn');

  // Register audio stopper
  registerAudioStopper(() => {
    if (effectsSourceNode) {
      try { effectsSourceNode.stop(); } catch(e) {}
      effectsSourceNode = null;
    }
    effectsIsPlaying = false;
    const playText = document.getElementById('effectsPlayText');
    const playIcon = document.getElementById('effectsPlayIcon');
    if (playText) playText.textContent = 'Live Preview';
    if (playIcon) playIcon.setAttribute('data-lucide', 'play');
    if (window.lucide) window.lucide.createIcons();
  });

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
      const val = effectsVolumeSlider.value;
      const effectsVolumeDisplay = document.getElementById('effectsVolumeDisplay');
      if (effectsVolumeDisplay) effectsVolumeDisplay.textContent = `${val}%`;
      if (effectsGainNode) {
        effectsGainNode.gain.value = val / 100;
      }
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
      if (effectsGainNode) {
        effectsGainNode.gain.value = 1.0;
      }
    });
  }

  // Speed Controls
  if (effectsSpeedSlider) {
    effectsSpeedSlider.addEventListener('input', () => {
      const val = parseFloat(effectsSpeedSlider.value).toFixed(2);
      const effectsSpeedDisplay = document.getElementById('effectsSpeedDisplay');
      if (effectsSpeedDisplay) effectsSpeedDisplay.textContent = `${val}x`;
      if (effectsSourceNode) {
        effectsSourceNode.playbackRate.value = parseFloat(val);
      }
    });
  }

  document.querySelectorAll('.effects-speed-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const speed = parseFloat(btn.getAttribute('data-speed'));
      if (effectsSpeedSlider) effectsSpeedSlider.value = speed;
      const effectsSpeedDisplay = document.getElementById('effectsSpeedDisplay');
      if (effectsSpeedDisplay) effectsSpeedDisplay.textContent = `${speed.toFixed(2)}x`;
      if (effectsSourceNode) {
        effectsSourceNode.playbackRate.value = speed;
      }
    });
  });

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

  effectsAudioFile = file;
  if (effectsFileName) effectsFileName.textContent = file.name;
  if (effectsFileMeta) effectsFileMeta.textContent = 'Decoding audio...';
  if (effectsDropZone) effectsDropZone.classList.add('hidden');
  if (effectsWorkspace) effectsWorkspace.classList.remove('hidden');
  if (effectsStatusBadge) effectsStatusBadge.classList.remove('hidden');

  try {
    const arrayBuffer = await file.arrayBuffer();
    effectsAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    effectsAudioBuffer = await effectsAudioCtx.decodeAudioData(arrayBuffer);

    if (effectsFileMeta) {
      effectsFileMeta.textContent = `${formatTime(effectsAudioBuffer.duration)} • ${effectsAudioBuffer.sampleRate} Hz • ${effectsAudioBuffer.numberOfChannels} ch • ${formatBytes(file.size)}`;
    }

    if (effectsVolumeSlider) effectsVolumeSlider.value = 100;
    if (effectsVolumeDisplay) effectsVolumeDisplay.textContent = '100%';
    if (effectsSpeedSlider) effectsSpeedSlider.value = 1.0;
    if (effectsSpeedDisplay) effectsSpeedDisplay.textContent = '1.0x';
  } catch (err) {
    console.error('Effects decode error:', err);
    alert('Could not decode audio for volume/speed adjustment.');
    resetEffectsFileSelection();
  }
}

function resetEffectsFileSelection() {
  if (effectsSourceNode) {
    try { effectsSourceNode.stop(); } catch(e) {}
    effectsSourceNode = null;
  }
  effectsIsPlaying = false;
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
    if (effectsGainNode) {
      effectsGainNode.gain.value = targetPercent / 100;
    }
    alert(`Peak normalized to ${targetPercent}% gain (original peak was ${(peak * 100).toFixed(1)}%).`);
  }
}

function toggleLivePreview() {
  if (!effectsAudioBuffer) return;
  const effectsPlayText = document.getElementById('effectsPlayText');
  const effectsPlayIcon = document.getElementById('effectsPlayIcon');
  const effectsSpeedSlider = document.getElementById('effectsSpeedSlider');
  const effectsVolumeSlider = document.getElementById('effectsVolumeSlider');

  if (effectsIsPlaying) {
    if (effectsSourceNode) {
      try { effectsSourceNode.stop(); } catch(e) {}
      effectsSourceNode = null;
    }
    effectsIsPlaying = false;
    if (effectsPlayText) effectsPlayText.textContent = 'Live Preview';
    if (effectsPlayIcon) effectsPlayIcon.setAttribute('data-lucide', 'play');
    if (window.lucide) window.lucide.createIcons();
  } else {
    if (!effectsAudioCtx) {
      effectsAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    effectsSourceNode = effectsAudioCtx.createBufferSource();
    effectsSourceNode.buffer = effectsAudioBuffer;
    effectsSourceNode.playbackRate.value = parseFloat(effectsSpeedSlider?.value || 1.0);

    effectsGainNode = effectsAudioCtx.createGain();
    effectsGainNode.gain.value = (parseFloat(effectsVolumeSlider?.value || 100)) / 100;

    effectsSourceNode.connect(effectsGainNode);
    effectsGainNode.connect(effectsAudioCtx.destination);

    effectsSourceNode.onended = () => {
      effectsIsPlaying = false;
      if (effectsPlayText) effectsPlayText.textContent = 'Live Preview';
      if (effectsPlayIcon) effectsPlayIcon.setAttribute('data-lucide', 'play');
      if (window.lucide) window.lucide.createIcons();
    };

    effectsSourceNode.start(0);
    effectsIsPlaying = true;
    if (effectsPlayText) effectsPlayText.textContent = 'Stop Preview';
    if (effectsPlayIcon) effectsPlayIcon.setAttribute('data-lucide', 'square');
    if (window.lucide) window.lucide.createIcons();
  }
}

async function exportProcessedAudio() {
  if (!effectsAudioBuffer) return;

  const effectsExportBtn = document.getElementById('effectsExportBtn');
  const effectsVolumeSlider = document.getElementById('effectsVolumeSlider');
  const effectsSpeedSlider = document.getElementById('effectsSpeedSlider');

  if (effectsExportBtn) {
    effectsExportBtn.disabled = true;
    effectsExportBtn.innerHTML = '<span class="animate-spin inline-block mr-2">⏳</span> Processing audio...';
  }

  try {
    const volumeMultiplier = (parseFloat(effectsVolumeSlider?.value || 100)) / 100;
    const speedMultiplier = parseFloat(effectsSpeedSlider?.value || 1.0);

    const channels = effectsAudioBuffer.numberOfChannels;
    const sampleRate = effectsAudioBuffer.sampleRate;
    const originalLength = effectsAudioBuffer.length;
    const targetLength = Math.max(1, Math.round(originalLength / speedMultiplier));

    const offlineCtx = new OfflineAudioContext(channels, targetLength, sampleRate);

    const source = offlineCtx.createBufferSource();
    source.buffer = effectsAudioBuffer;
    source.playbackRate.value = speedMultiplier;

    const gain = offlineCtx.createGain();
    gain.gain.value = volumeMultiplier;

    source.connect(gain);
    gain.connect(offlineCtx.destination);
    source.start(0);

    const renderedBuffer = await offlineCtx.startRendering();
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
