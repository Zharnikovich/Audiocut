// Audiocut - Feature 2: Interactive Audio Trimmer with Sound Waveform & Multi-Format Export
import { formatBytes, formatTime, getAudioExtensionMatch } from '../utils/formatters.js';
import { CONVERTER_FORMATS } from '../constants.js';
import { bufferToWav } from '../utils/wav-encoder.js';
import { bufferToAiff } from '../utils/aiff-encoder.js';
import { bufferToMp3 } from '../utils/mp3-encoder.js';
import { bufferToM4a } from '../utils/m4a-encoder.js';
import { bufferToOgg } from '../utils/ogg-encoder.js';
import { decodeAudioFile } from '../utils/audio-decode.js';
import { sliceBuffer, resampleBuffer, encoderSampleRate } from '../utils/audio-buffer.js';
import { saveOrDownloadFile } from '../services/storage.js';
import { registerAudioStopper } from '../components/navigation.js';

let trimAudioFile = null;
let trimAudioBuffer = null;
let trimAudioContext = null;
let trimSourceNode = null;
let trimIsPlaying = false;
let trimPlayStartTime = 0;
let trimPlayStartOffset = 0;
let trimPlayEndTime = 0;
let trimAnimFrameId = null;
let currentPlayheadTime = 0;

// Waveform & Dragging State
let waveformPeaks = null;
let isDragging = null; // 'start', 'end', 'region'
let dragStartX = 0;
let dragInitStart = 0;
let dragInitEnd = 0;

export function initTrimmer() {
  const trimDropZone = document.getElementById('trimDropZone');
  const trimFileInput = document.getElementById('trimFileInput');
  const trimRemoveFileBtn = document.getElementById('trimRemoveFileBtn');
  const trimPlayPauseBtn = document.getElementById('trimPlayPauseBtn');
  const trimPlayRangeBtn = document.getElementById('trimPlayRangeBtn');
  const trimStopBtn = document.getElementById('trimStopBtn');
  const trimStartSec = document.getElementById('trimStartSec');
  const trimEndSec = document.getElementById('trimEndSec');
  const trimSetStartToCurrent = document.getElementById('trimSetStartToCurrent');
  const trimSetEndToCurrent = document.getElementById('trimSetEndToCurrent');
  const trimFormatSelect = document.getElementById('trimFormatSelect');
  const trimQualitySelect = document.getElementById('trimQualitySelect');
  const trimExecuteBtn = document.getElementById('trimExecuteBtn');
  const trimWaveformCanvas = document.getElementById('trimWaveformCanvas');

  // Register audio stopper for tab switching
  registerAudioStopper(() => {
    stopPlayback();
  });

  // Drag & drop file upload
  if (trimDropZone && trimFileInput) {
    trimDropZone.addEventListener('click', () => trimFileInput.click());
    trimDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      trimDropZone.classList.add('border-solid', 'bg-neoYellow/15');
    });
    trimDropZone.addEventListener('dragleave', () => {
      trimDropZone.classList.remove('border-solid', 'bg-neoYellow/15');
    });
    trimDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      trimDropZone.classList.remove('border-solid', 'bg-neoYellow/15');
      if (e.dataTransfer.files.length > 0) {
        handleTrimFileSelection(e.dataTransfer.files[0]);
      }
    });

    trimFileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleTrimFileSelection(e.target.files[0]);
      }
    });
  }

  if (trimRemoveFileBtn) {
    trimRemoveFileBtn.addEventListener('click', resetTrimFileSelection);
  }

  // Playback Buttons
  if (trimPlayPauseBtn) {
    trimPlayPauseBtn.addEventListener('click', togglePlayFull);
  }
  if (trimPlayRangeBtn) {
    trimPlayRangeBtn.addEventListener('click', playSelectedRange);
  }
  if (trimStopBtn) {
    trimStopBtn.addEventListener('click', stopPlayback);
  }

  // Numerical inputs
  if (trimStartSec) {
    trimStartSec.addEventListener('input', () => {
      syncFromInputs();
      drawWaveform();
    });
    trimStartSec.addEventListener('change', normalizeRangeInputs);
  }
  if (trimEndSec) {
    trimEndSec.addEventListener('input', () => {
      syncFromInputs();
      drawWaveform();
    });
    trimEndSec.addEventListener('change', normalizeRangeInputs);
  }

  // Nudge buttons
  document.querySelectorAll('.trim-nudge').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-target');
      const delta = parseFloat(btn.getAttribute('data-delta'));
      const input = target === 'start' ? trimStartSec : trimEndSec;
      if (input && trimAudioBuffer) {
        const val = Math.max(0, Math.min(trimAudioBuffer.duration, (parseFloat(input.value) || 0) + delta));
        input.value = val.toFixed(2);
        syncFromInputs();
        drawWaveform();
      }
    });
  });

  // Set to Playhead
  if (trimSetStartToCurrent) {
    trimSetStartToCurrent.addEventListener('click', () => {
      if (trimStartSec && trimAudioBuffer) {
        const curEnd = parseFloat(trimEndSec?.value) || trimAudioBuffer.duration;
        trimStartSec.value = Math.min(currentPlayheadTime, curEnd - 0.05).toFixed(2);
        syncFromInputs();
        drawWaveform();
      }
    });
  }

  if (trimSetEndToCurrent) {
    trimSetEndToCurrent.addEventListener('click', () => {
      if (trimEndSec && trimAudioBuffer) {
        const curStart = parseFloat(trimStartSec?.value) || 0;
        trimEndSec.value = Math.max(currentPlayheadTime, curStart + 0.05).toFixed(2);
        syncFromInputs();
        drawWaveform();
      }
    });
  }

  // Interactive Waveform Pointer Events
  if (trimWaveformCanvas) {
    setupWaveformInteractions(trimWaveformCanvas);
  }

  // Redraw when switching back to trimmer view
  window.addEventListener('viewchanged', (e) => {
    if (e.detail && e.detail.viewId === 'viewTrimmer' && trimAudioBuffer) {
      setTimeout(drawWaveform, 20);
      setTimeout(drawWaveform, 100);
    }
  });

  window.addEventListener('resize', () => {
    if (trimAudioBuffer) {
      drawWaveform();
    }
  });

  // Format & Quality selector change
  if (trimFormatSelect) {
    trimFormatSelect.addEventListener('change', updateTrimExportUI);
  }
  if (trimQualitySelect) {
    trimQualitySelect.addEventListener('change', updateTrimSummary);
  }

  // Execute Trim
  if (trimExecuteBtn) {
    trimExecuteBtn.addEventListener('click', executeTrim);
  }

  updateTrimExportUI();
}

async function handleTrimFileSelection(file) {
  if (!getAudioExtensionMatch(file.name)) {
    alert('Please select a valid audio file format.');
    return;
  }

  const trimFileName = document.getElementById('trimFileName');
  const trimFileMeta = document.getElementById('trimFileMeta');
  const trimDropZone = document.getElementById('trimDropZone');
  const trimWorkspace = document.getElementById('trimWorkspace');
  const trimStatusBadge = document.getElementById('trimStatusBadge');
  const trimStartSec = document.getElementById('trimStartSec');
  const trimEndSec = document.getElementById('trimEndSec');

  stopPlayback();
  trimAudioFile = file;
  if (trimFileName) trimFileName.textContent = file.name;
  if (trimFileMeta) trimFileMeta.textContent = 'Decoding audio and analyzing sound wave...';
  if (trimDropZone) trimDropZone.classList.add('hidden');
  if (trimWorkspace) trimWorkspace.classList.remove('hidden');
  if (trimStatusBadge) trimStatusBadge.classList.remove('hidden');

  try {
    trimAudioBuffer = await decodeAudioFile(file);

    if (trimFileMeta) {
      trimFileMeta.textContent = `${formatTime(trimAudioBuffer.duration)} • ${trimAudioBuffer.sampleRate} Hz • ${trimAudioBuffer.numberOfChannels} ch • ${formatBytes(file.size)}`;
    }

    currentPlayheadTime = 0;

    // Set initial range: 0.00 to min(30, duration)
    const initialEnd = Math.min(30, trimAudioBuffer.duration);
    if (trimStartSec) {
      trimStartSec.value = '0.00';
      trimStartSec.max = trimAudioBuffer.duration.toFixed(2);
    }
    if (trimEndSec) {
      trimEndSec.value = initialEnd.toFixed(2);
      trimEndSec.max = trimAudioBuffer.duration.toFixed(2);
    }

    // Extract peaks and render sound wave
    generateWaveformData(trimAudioBuffer);
    syncFromInputs();
    updatePlaybackTimeDisplay();
    updateTrimSummary();

    // Trigger draws to ensure rendering across browser layout phases
    drawWaveform();
    requestAnimationFrame(drawWaveform);
    setTimeout(drawWaveform, 60);
    setTimeout(drawWaveform, 180);

  } catch (err) {
    console.error('Trim decoding error:', err);
    alert('Failed to decode audio file for trimming: ' + (err.message || 'Unknown error'));
    resetTrimFileSelection();
  }
}

function resetTrimFileSelection() {
  stopPlayback();
  trimAudioFile = null;
  trimAudioBuffer = null;
  waveformPeaks = null;
  currentPlayheadTime = 0;

  const trimDropZone = document.getElementById('trimDropZone');
  const trimWorkspace = document.getElementById('trimWorkspace');
  const trimStatusBadge = document.getElementById('trimStatusBadge');
  const trimFileInput = document.getElementById('trimFileInput');

  if (trimDropZone) trimDropZone.classList.remove('hidden');
  if (trimWorkspace) trimWorkspace.classList.add('hidden');
  if (trimStatusBadge) trimStatusBadge.classList.add('hidden');
  if (trimFileInput) trimFileInput.value = '';
}

// Compute peak amplitudes across channels for high-definition waveform
function generateWaveformData(buffer) {
  const numSamples = buffer.length;
  const numChannels = buffer.numberOfChannels;
  const channelData0 = buffer.getChannelData(0);
  const channelData1 = numChannels > 1 ? buffer.getChannelData(1) : null;

  const numPoints = 800;
  const step = Math.max(1, Math.floor(numSamples / numPoints));
  const peaks = new Float32Array(numPoints);

  let globalMax = 0;
  for (let i = 0; i < numPoints; i++) {
    const startIdx = i * step;
    const endIdx = Math.min(startIdx + step, numSamples);
    let maxAmp = 0;

    const innerStride = Math.max(1, Math.floor((endIdx - startIdx) / 40));
    for (let j = startIdx; j < endIdx; j += innerStride) {
      const s0 = Math.abs(channelData0[j]);
      if (s0 > maxAmp) maxAmp = s0;
      if (channelData1) {
        const s1 = Math.abs(channelData1[j]);
        if (s1 > maxAmp) maxAmp = s1;
      }
    }

    peaks[i] = maxAmp;
    if (maxAmp > globalMax) globalMax = maxAmp;
  }

  // Normalize peaks so loud moments reach near full height
  if (globalMax > 0) {
    for (let i = 0; i < numPoints; i++) {
      peaks[i] = peaks[i] / globalMax;
    }
  }

  waveformPeaks = peaks;
}

// Render sound wave on canvas
function drawWaveform() {
  const canvas = document.getElementById('trimWaveformCanvas');
  if (!canvas || !trimAudioBuffer || !waveformPeaks) return;

  const rect = canvas.getBoundingClientRect();
  const width = Math.floor(rect.width) || canvas.clientWidth || 700;
  const height = Math.floor(rect.height) || canvas.clientHeight || 128;

  if (width <= 0 || height <= 0) {
    requestAnimationFrame(drawWaveform);
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const pixelWidth = Math.floor(width * dpr);
  const pixelHeight = Math.floor(height * dpr);

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Background
  ctx.fillStyle = '#FFFDF9';
  ctx.fillRect(0, 0, width, height);

  const duration = trimAudioBuffer.duration;
  const startSec = Math.max(0, parseFloat(document.getElementById('trimStartSec')?.value) || 0);
  const endSec = Math.min(duration, parseFloat(document.getElementById('trimEndSec')?.value) || duration);

  const startX = (startSec / duration) * width;
  const endX = (endSec / duration) * width;
  const centerY = height / 2;

  // 1. Draw Unselected Background Shading (left and right)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
  if (startX > 0) {
    ctx.fillRect(0, 0, startX, height);
  }
  if (endX < width) {
    ctx.fillRect(endX, 0, width - endX, height);
  }

  // 2. Draw Selected Range Highlight (neoYellow)
  ctx.fillStyle = 'rgba(255, 230, 0, 0.32)';
  ctx.fillRect(startX, 0, Math.max(2, endX - startX), height);

  // 3. Draw Center Guideline
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();

  // 4. Draw Waveform Bars
  const numPoints = waveformPeaks.length;
  const barSpacing = width / numPoints;
  const barWidth = Math.max(1.2, barSpacing - 0.5);
  const maxBarHeight = (height / 2) * 0.88;

  for (let i = 0; i < numPoints; i++) {
    const x = i * barSpacing;
    const amp = waveformPeaks[i];
    const barHeight = Math.max(2, amp * maxBarHeight);
    const isInside = (x >= startX && x <= endX);

    if (isInside) {
      if (amp >= 0.72) {
        ctx.fillStyle = '#FF5C00'; // neoOrange for loud peaks
      } else {
        ctx.fillStyle = '#000000'; // Solid black for selected range
      }
    } else {
      ctx.fillStyle = '#94A3B8'; // Slate-400 for unselected
    }

    ctx.fillRect(x, centerY - barHeight, barWidth, barHeight * 2);
  }

  // 5. Draw Selected Region Top & Bottom Border
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(startX, 0, Math.max(2, endX - startX), height);

  // 6. Draw Start Handle [S]
  drawHandle(ctx, startX, height, width, 'start');

  // 7. Draw End Handle [E]
  drawHandle(ctx, endX, height, width, 'end');

  // 8. Draw Moving Playhead Line
  if (currentPlayheadTime >= 0 && currentPlayheadTime <= duration) {
    const playheadX = (currentPlayheadTime / duration) * width;

    ctx.strokeStyle = '#FF5C00';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();

    ctx.fillStyle = '#FF5C00';
    ctx.beginPath();
    ctx.moveTo(playheadX - 6, 0);
    ctx.lineTo(playheadX + 6, 0);
    ctx.lineTo(playheadX, 9);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function drawHandle(ctx, x, height, totalWidth, type) {
  const isStart = (type === 'start');
  const label = isStart ? 'S' : 'E';
  const tagColor = isStart ? '#FF5C00' : '#00E5FF';

  // Handle Vertical Line
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.stroke();

  // Top Handle Flag Badge (clamped inside bounds)
  const badgeW = 24;
  const badgeH = 20;
  let badgeX = isStart ? (x - badgeW) : x;
  if (badgeX < 0) badgeX = x;
  if (badgeX + badgeW > totalWidth) badgeX = x - badgeW;

  ctx.fillStyle = tagColor;
  ctx.fillRect(badgeX, 0, badgeW, badgeH);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.strokeRect(badgeX, 0, badgeW, badgeH);

  ctx.fillStyle = '#000000';
  ctx.font = '900 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, badgeX + badgeW / 2, badgeH / 2);

  // Center Grip Pill
  const pillW = 8;
  const pillH = 24;
  const pillX = x - (pillW / 2);
  const pillY = (height / 2) - (pillH / 2);
  ctx.fillStyle = tagColor;
  ctx.fillRect(pillX, pillY, pillW, pillH);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(pillX, pillY, pillW, pillH);

  // Grip dots
  ctx.fillStyle = '#000000';
  ctx.fillRect(x - 1, (height / 2) - 6, 2, 2);
  ctx.fillRect(x - 1, (height / 2), 2, 2);
  ctx.fillRect(x - 1, (height / 2) + 6, 2, 2);
}

function setupWaveformInteractions(canvas) {
  const hoverBadge = document.getElementById('trimWaveformHover');

  const getCanvasCoords = (e) => {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    return { x, width: rect.width };
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (!trimAudioBuffer) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}

    const { x, width } = getCanvasCoords(e);
    const duration = trimAudioBuffer.duration;

    const startSec = parseFloat(document.getElementById('trimStartSec')?.value) || 0;
    const endSec = parseFloat(document.getElementById('trimEndSec')?.value) || duration;

    const startX = (startSec / duration) * width;
    const endX = (endSec / duration) * width;
    const hitThreshold = 18; // Grab tolerance

    if (Math.abs(x - startX) <= hitThreshold) {
      isDragging = 'start';
    } else if (Math.abs(x - endX) <= hitThreshold) {
      isDragging = 'end';
    } else if (x > startX && x < endX) {
      isDragging = 'region';
      dragStartX = x;
      dragInitStart = startSec;
      dragInitEnd = endSec;
    } else {
      // Clicked outside: seek playhead directly
      const clickedTime = (x / width) * duration;
      seekPlayhead(clickedTime);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!trimAudioBuffer) return;
    const { x, width } = getCanvasCoords(e);
    const duration = trimAudioBuffer.duration;
    const hoverTime = (x / width) * duration;

    // Update hover tooltip
    if (hoverBadge) {
      hoverBadge.classList.remove('hidden');
      hoverBadge.textContent = formatTime(hoverTime);
    }

    const startSec = parseFloat(document.getElementById('trimStartSec')?.value) || 0;
    const endSec = parseFloat(document.getElementById('trimEndSec')?.value) || duration;
    const startX = (startSec / duration) * width;
    const endX = (endSec / duration) * width;
    const hitThreshold = 18;

    if (!isDragging) {
      if (Math.abs(x - startX) <= hitThreshold || Math.abs(x - endX) <= hitThreshold) {
        canvas.style.cursor = 'ew-resize';
      } else if (x > startX && x < endX) {
        canvas.style.cursor = 'grab';
      } else {
        canvas.style.cursor = 'crosshair';
      }
      return;
    }

    const trimStartSec = document.getElementById('trimStartSec');
    const trimEndSec = document.getElementById('trimEndSec');

    if (isDragging === 'start') {
      canvas.style.cursor = 'ew-resize';
      const newStart = Math.max(0, Math.min(endSec - 0.05, hoverTime));
      if (trimStartSec) trimStartSec.value = newStart.toFixed(2);
      syncFromInputs();
      drawWaveform();
    } else if (isDragging === 'end') {
      canvas.style.cursor = 'ew-resize';
      const newEnd = Math.min(duration, Math.max(startSec + 0.05, hoverTime));
      if (trimEndSec) trimEndSec.value = newEnd.toFixed(2);
      syncFromInputs();
      drawWaveform();
    } else if (isDragging === 'region') {
      canvas.style.cursor = 'grabbing';
      const deltaSec = ((x - dragStartX) / width) * duration;
      const windowLen = dragInitEnd - dragInitStart;

      let newStart = dragInitStart + deltaSec;
      let newEnd = dragInitEnd + deltaSec;

      if (newStart < 0) {
        newStart = 0;
        newEnd = windowLen;
      }
      if (newEnd > duration) {
        newEnd = duration;
        newStart = duration - windowLen;
      }

      if (trimStartSec) trimStartSec.value = newStart.toFixed(2);
      if (trimEndSec) trimEndSec.value = newEnd.toFixed(2);
      syncFromInputs();
      drawWaveform();
    }
  });

  const stopDrag = (e) => {
    if (isDragging) {
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      isDragging = null;
      canvas.style.cursor = 'default';
      drawWaveform();
    }
  };

  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);
  canvas.addEventListener('mouseleave', () => {
    if (hoverBadge) hoverBadge.classList.add('hidden');
    if (!isDragging) canvas.style.cursor = 'default';
  });
}

// Once the user commits a value, clamp both inputs to the file and swap them if reversed
function normalizeRangeInputs() {
  const trimStartSec = document.getElementById('trimStartSec');
  const trimEndSec = document.getElementById('trimEndSec');
  if (!trimAudioBuffer || !trimStartSec || !trimEndSec) return;

  const duration = trimAudioBuffer.duration;
  let start = Math.max(0, Math.min(duration, parseFloat(trimStartSec.value) || 0));
  let end = Math.max(0, Math.min(duration, parseFloat(trimEndSec.value) || duration));
  if (start > end) [start, end] = [end, start];

  trimStartSec.value = start.toFixed(2);
  trimEndSec.value = end.toFixed(2);
  syncFromInputs();
  drawWaveform();
}

function syncFromInputs() {
  const trimStartSec = document.getElementById('trimStartSec');
  const trimEndSec = document.getElementById('trimEndSec');
  const trimRangeDurationText = document.getElementById('trimRangeDurationText');

  if (!trimAudioBuffer) return;
  const duration = trimAudioBuffer.duration;

  let start = parseFloat(trimStartSec?.value) || 0;
  let end = parseFloat(trimEndSec?.value) || duration;

  if (start < 0) start = 0;
  if (end > duration) end = duration;
  if (start > end) start = end;

  const diff = Math.max(0, end - start);
  if (trimRangeDurationText) {
    trimRangeDurationText.textContent = `${diff.toFixed(2)}s`;
  }

  updateTrimSummary();
}

function updatePlaybackTimeDisplay() {
  const trimCurrentTimeDisplay = document.getElementById('trimCurrentTimeDisplay');
  if (!trimCurrentTimeDisplay || !trimAudioBuffer) return;
  const cur = currentPlayheadTime;
  const total = trimAudioBuffer.duration;
  trimCurrentTimeDisplay.textContent = `${formatTime(cur)} / ${formatTime(total)}`;
}

function seekPlayhead(targetSec) {
  if (!trimAudioBuffer) return;
  currentPlayheadTime = Math.max(0, Math.min(trimAudioBuffer.duration, targetSec));
  updatePlaybackTimeDisplay();

  if (trimIsPlaying) {
    playAudioSegment(currentPlayheadTime, trimPlayEndTime);
  } else {
    drawWaveform();
  }
}

// Web Audio API playback engine
function playAudioSegment(startTime, endTime) {
  if (!trimAudioBuffer) return;

  if (!trimAudioContext) {
    trimAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (trimAudioContext.state === 'suspended') {
    trimAudioContext.resume();
  }

  if (trimSourceNode) {
    try { trimSourceNode.stop(); } catch (_) {}
    trimSourceNode = null;
  }
  if (trimAnimFrameId) {
    cancelAnimationFrame(trimAnimFrameId);
    trimAnimFrameId = null;
  }

  const duration = trimAudioBuffer.duration;
  const start = Math.max(0, Math.min(duration, startTime));
  const end = Math.max(start, Math.min(duration, endTime));
  const playDuration = Math.max(0.01, end - start);

  trimSourceNode = trimAudioContext.createBufferSource();
  trimSourceNode.buffer = trimAudioBuffer;
  trimSourceNode.connect(trimAudioContext.destination);

  trimPlayStartTime = trimAudioContext.currentTime;
  trimPlayStartOffset = start;
  trimPlayEndTime = end;
  trimIsPlaying = true;
  currentPlayheadTime = start;

  trimSourceNode.onended = () => {
    if (trimIsPlaying && (currentPlayheadTime >= end - 0.05)) {
      stopPlayback();
    }
  };

  trimSourceNode.start(0, start, playDuration);
  updatePlayButtonsUI();

  function animLoop() {
    if (!trimIsPlaying || !trimAudioContext) return;
    const elapsed = trimAudioContext.currentTime - trimPlayStartTime;
    currentPlayheadTime = trimPlayStartOffset + elapsed;

    if (currentPlayheadTime >= trimPlayEndTime) {
      stopPlayback();
      return;
    }

    updatePlaybackTimeDisplay();
    drawWaveform();
    trimAnimFrameId = requestAnimationFrame(animLoop);
  }

  trimAnimFrameId = requestAnimationFrame(animLoop);
}

function togglePlayFull() {
  if (!trimAudioBuffer) return;
  if (trimIsPlaying) {
    stopPlayback();
  } else {
    const startFrom = (currentPlayheadTime >= trimAudioBuffer.duration - 0.1) ? 0 : currentPlayheadTime;
    playAudioSegment(startFrom, trimAudioBuffer.duration);
  }
}

function playSelectedRange() {
  if (!trimAudioBuffer) return;
  const start = Math.max(0, parseFloat(document.getElementById('trimStartSec')?.value) || 0);
  const end = Math.min(trimAudioBuffer.duration, parseFloat(document.getElementById('trimEndSec')?.value) || trimAudioBuffer.duration);

  if (start >= end) {
    alert('Start time must be less than end time.');
    return;
  }

  playAudioSegment(start, end);
}

function stopPlayback() {
  if (trimAnimFrameId) {
    cancelAnimationFrame(trimAnimFrameId);
    trimAnimFrameId = null;
  }
  if (trimSourceNode) {
    try { trimSourceNode.stop(); } catch (_) {}
    trimSourceNode = null;
  }
  trimIsPlaying = false;
  updatePlayButtonsUI();
  updatePlaybackTimeDisplay();
  drawWaveform();
}

function updatePlayButtonsUI() {
  const playText = document.getElementById('trimPlayPauseText');
  const playIcon = document.getElementById('trimPlayPauseIcon');

  if (playText) {
    playText.textContent = trimIsPlaying ? 'Pause' : 'Play Full';
  }
  if (playIcon) {
    playIcon.setAttribute('data-lucide', trimIsPlaying ? 'pause' : 'play');
  }
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function updateTrimExportUI() {
  const formatSelect = document.getElementById('trimFormatSelect');
  const qualitySelect = document.getElementById('trimQualitySelect');
  const qualityLabel = document.getElementById('trimQualityLabel');
  const formatDescText = document.getElementById('trimFormatDescText');

  if (!formatSelect || !qualitySelect) return;
  const targetFmt = formatSelect.value;
  const fmtInfo = CONVERTER_FORMATS[targetFmt.toUpperCase()];

  if (fmtInfo && formatDescText) {
    formatDescText.textContent = fmtInfo.desc;
  }

  const isLossless = (targetFmt === 'wav' || targetFmt === 'aiff');
  qualitySelect.innerHTML = '';

  if (isLossless) {
    if (qualityLabel) qualityLabel.textContent = 'PCM Bit Depth';
    qualitySelect.innerHTML = `
      <option value="16" selected>16-Bit PCM (CD Quality)</option>
      <option value="24">24-Bit PCM (Studio Master)</option>
    `;
  } else {
    if (qualityLabel) qualityLabel.textContent = 'Bitrate / Quality';
    qualitySelect.innerHTML = `
      <option value="128">128 kbps (Standard)</option>
      <option value="192" selected>192 kbps (High Quality)</option>
      <option value="256">256 kbps (Very High)</option>
      <option value="320">320 kbps (Maximum)</option>
    `;
  }

  updateTrimSummary();
}

function updateTrimSummary() {
  const trimSummaryText = document.getElementById('trimSummaryText');
  const trimSummaryFormatBadge = document.getElementById('trimSummaryFormatBadge');
  const trimStartSec = document.getElementById('trimStartSec');
  const trimEndSec = document.getElementById('trimEndSec');
  const formatSelect = document.getElementById('trimFormatSelect');
  const qualitySelect = document.getElementById('trimQualitySelect');

  if (!trimSummaryText || !trimAudioBuffer) return;

  const start = Math.max(0, parseFloat(trimStartSec?.value) || 0);
  const end = Math.min(trimAudioBuffer.duration, parseFloat(trimEndSec?.value) || trimAudioBuffer.duration);
  const diff = Math.max(0, end - start);

  trimSummaryText.textContent = `Selected: ${formatTime(start)} → ${formatTime(end)} • Length: ${diff.toFixed(2)}s`;

  if (trimSummaryFormatBadge && formatSelect && qualitySelect) {
    const fmt = formatSelect.value.toUpperCase();
    const isLossless = (fmt === 'WAV' || fmt === 'AIFF');
    const qualityVal = qualitySelect.value;
    const qualityLabel = isLossless ? `${qualityVal}-Bit` : `${qualityVal} kbps`;
    trimSummaryFormatBadge.textContent = `${fmt} • ${qualityLabel}`;
  }
}

async function executeTrim() {
  if (!trimAudioBuffer) return;

  const trimStartSec = document.getElementById('trimStartSec');
  const trimEndSec = document.getElementById('trimEndSec');
  const trimFormatSelect = document.getElementById('trimFormatSelect');
  const trimQualitySelect = document.getElementById('trimQualitySelect');
  const trimExecuteBtn = document.getElementById('trimExecuteBtn');
  const trimExecuteBtnText = document.getElementById('trimExecuteBtnText');

  const start = Math.max(0, parseFloat(trimStartSec.value) || 0);
  const end = Math.min(trimAudioBuffer.duration, parseFloat(trimEndSec.value) || trimAudioBuffer.duration);

  if (start >= end) {
    alert('Start time must be strictly less than end time.');
    return;
  }

  const targetFormat = trimFormatSelect ? trimFormatSelect.value : 'mp3';
  const qualityVal = parseInt(trimQualitySelect ? trimQualitySelect.value : '192', 10);
  const isLossless = (targetFormat === 'wav' || targetFormat === 'aiff');

  trimExecuteBtn.disabled = true;
  if (trimExecuteBtnText) trimExecuteBtnText.textContent = `Exporting ${targetFormat.toUpperCase()}...`;

  try {
    const sampleRate = trimAudioBuffer.sampleRate;
    const startSample = Math.floor(start * sampleRate);
    const sampleLength = Math.max(1, Math.floor((end - start) * sampleRate));
    let exportBuffer = sliceBuffer(trimAudioBuffer, startSample, sampleLength);

    // MP3/AAC only support certain rates (e.g. no 96 kHz), so resample when needed
    const outputRate = encoderSampleRate(targetFormat, sampleRate);
    if (outputRate !== sampleRate) {
      exportBuffer = await resampleBuffer(exportBuffer, exportBuffer.numberOfChannels, outputRate);
    }

    const encoderOptions = {
      bitrate: isLossless ? 192 : qualityVal,
      bitDepth: isLossless ? qualityVal : 16,
      channels: exportBuffer.numberOfChannels,
      sampleRate: exportBuffer.sampleRate
    };

    let exportedBlob = null;
    if (targetFormat === 'wav') {
      exportedBlob = bufferToWav(exportBuffer, 0, null, encoderOptions);
    } else if (targetFormat === 'aiff') {
      exportedBlob = bufferToAiff(exportBuffer, 0, null, encoderOptions);
    } else if (targetFormat === 'mp3') {
      exportedBlob = await bufferToMp3(exportBuffer, encoderOptions);
    } else if (targetFormat === 'm4a') {
      exportedBlob = await bufferToM4a(exportBuffer, encoderOptions);
    } else if (targetFormat === 'ogg') {
      exportedBlob = await bufferToOgg(exportBuffer, encoderOptions);
    }

    const baseName = trimAudioFile.name.replace(/\.[^/.]+$/, '');
    const outFilename = `${baseName}_trimmed_${start.toFixed(1)}s_to_${end.toFixed(1)}s.${targetFormat}`;

    await saveOrDownloadFile(exportedBlob, outFilename);
  } catch (err) {
    console.error('Error trimming audio:', err);
    alert('Error exporting audio clip: ' + err.message);
  } finally {
    trimExecuteBtn.disabled = false;
    if (trimExecuteBtnText) trimExecuteBtnText.textContent = 'Trim & Export Audio';
    if (window.lucide) window.lucide.createIcons();
  }
}
