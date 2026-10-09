// Audiocut - Feature 3: Audio Merger & Joiner Module
import { formatBytes, formatTime, getAudioExtensionMatch, escapeHtml } from '../utils/formatters.js';
import { bufferToWav } from '../utils/wav-encoder.js';
import { decodeAudioFile } from '../utils/audio-decode.js';
import { saveOrDownloadWav } from '../services/storage.js';

let mergeTracks = [];

export function initMerger() {
  const mergeDropZone = document.getElementById('mergeDropZone');
  const mergeFileInput = document.getElementById('mergeFileInput');
  const mergeClearAllBtn = document.getElementById('mergeClearAllBtn');
  const mergeSilenceGap = document.getElementById('mergeSilenceGap');
  const mergeExecuteBtn = document.getElementById('mergeExecuteBtn');

  if (mergeDropZone && mergeFileInput) {
    mergeDropZone.addEventListener('click', () => mergeFileInput.click());
    mergeDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      mergeDropZone.classList.add('border-solid', 'bg-neoYellow/15');
    });
    mergeDropZone.addEventListener('dragleave', () => {
      mergeDropZone.classList.remove('border-solid', 'bg-neoYellow/15');
    });
    mergeDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      mergeDropZone.classList.remove('border-solid', 'bg-neoYellow/15');
      if (e.dataTransfer.files.length > 0) {
        addMergeFiles(Array.from(e.dataTransfer.files));
      }
    });

    mergeFileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        addMergeFiles(Array.from(e.target.files));
        // Reset so picking the same file again (e.g. after Clear) still fires 'change'
        mergeFileInput.value = '';
      }
    });
  }

  if (mergeClearAllBtn) {
    mergeClearAllBtn.addEventListener('click', () => {
      mergeTracks = [];
      renderMergeTracksList();
    });
  }

  if (mergeSilenceGap) {
    mergeSilenceGap.addEventListener('change', renderMergeTracksList);
  }

  if (mergeExecuteBtn) {
    mergeExecuteBtn.addEventListener('click', executeMerge);
  }
}

async function addMergeFiles(files) {
  const validFiles = files.filter(f => getAudioExtensionMatch(f.name));
  if (validFiles.length === 0) {
    alert('Please select valid audio files.');
    return;
  }

  const failedNames = [];
  for (const file of validFiles) {
    try {
      const buffer = await decodeAudioFile(file);
      mergeTracks.push({
        id: 'track_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        file: file,
        buffer: buffer,
        name: file.name,
        duration: buffer.duration,
        size: file.size
      });
    } catch (err) {
      console.warn('Could not decode file for merging:', file.name, err);
      failedNames.push(file.name);
    }
  }

  renderMergeTracksList();

  if (failedNames.length > 0) {
    alert(`Could not decode ${failedNames.length} file(s), so they were not added:\n\n${failedNames.join('\n')}`);
  }
}

function renderMergeTracksList() {
  const mergeWorkspace = document.getElementById('mergeWorkspace');
  const mergeCountBadge = document.getElementById('mergeCountBadge');
  const mergeTracksList = document.getElementById('mergeTracksList');
  const mergeSilenceGap = document.getElementById('mergeSilenceGap');
  const mergeTotalDuration = document.getElementById('mergeTotalDuration');

  if (!mergeWorkspace) return;

  if (mergeTracks.length === 0) {
    mergeWorkspace.classList.add('hidden');
    if (mergeCountBadge) mergeCountBadge.textContent = '0 Tracks';
    return;
  }

  mergeWorkspace.classList.remove('hidden');
  if (mergeCountBadge) {
    mergeCountBadge.textContent = `${mergeTracks.length} Track${mergeTracks.length > 1 ? 's' : ''}`;
  }
  if (mergeTracksList) {
    mergeTracksList.innerHTML = '';
  }

  let totalSec = 0;
  const gap = parseFloat(mergeSilenceGap?.value || 0);

  mergeTracks.forEach((track, index) => {
    totalSec += track.duration + (index < mergeTracks.length - 1 ? gap : 0);

    const row = document.createElement('div');
    row.className = 'p-3 bg-white border-2 border-black shadow-[3px_3px_0px_0px_#000] flex items-center justify-between gap-3 text-xs';
    
    row.innerHTML = `
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <span class="w-6 h-6 bg-neoYellow border-2 border-black font-black text-center flex items-center justify-center text-xs shrink-0">${index + 1}</span>
        <div class="truncate">
          <p class="font-extrabold text-black truncate text-sm" title="${escapeHtml(track.name)}">${escapeHtml(track.name)}</p>
          <p class="text-[10px] text-slate-600 font-bold uppercase mt-0.5">${formatTime(track.duration)} • ${track.buffer.sampleRate} Hz • ${formatBytes(track.size)}</p>
        </div>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <button class="merge-move-up p-1.5 bg-white hover:bg-black hover:text-white text-black border border-black shadow-[1px_1px_0px_0px_#000] ${index === 0 ? 'opacity-30 cursor-not-allowed' : ''}" data-index="${index}" title="Move Up">
          <i data-lucide="arrow-up" class="w-3.5 h-3.5"></i>
        </button>
        <button class="merge-move-down p-1.5 bg-white hover:bg-black hover:text-white text-black border border-black shadow-[1px_1px_0px_0px_#000] ${index === mergeTracks.length - 1 ? 'opacity-30 cursor-not-allowed' : ''}" data-index="${index}" title="Move Down">
          <i data-lucide="arrow-down" class="w-3.5 h-3.5"></i>
        </button>
        <button class="merge-remove p-1.5 bg-[#FF6B6B] hover:bg-black hover:text-white text-black border border-black shadow-[1px_1px_0px_0px_#000]" data-index="${index}" title="Remove Track">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    `;

    if (mergeTracksList) mergeTracksList.appendChild(row);
  });

  if (mergeTotalDuration) {
    mergeTotalDuration.textContent = `Total Combined Duration: ${formatTime(totalSec)}`;
  }
  if (window.lucide) window.lucide.createIcons();

  // Attach button events
  if (mergeTracksList) {
    mergeTracksList.querySelectorAll('.merge-move-up').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-index'));
        if (idx > 0) {
          const temp = mergeTracks[idx];
          mergeTracks[idx] = mergeTracks[idx - 1];
          mergeTracks[idx - 1] = temp;
          renderMergeTracksList();
        }
      });
    });

    mergeTracksList.querySelectorAll('.merge-move-down').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-index'));
        if (idx < mergeTracks.length - 1) {
          const temp = mergeTracks[idx];
          mergeTracks[idx] = mergeTracks[idx + 1];
          mergeTracks[idx + 1] = temp;
          renderMergeTracksList();
        }
      });
    });

    mergeTracksList.querySelectorAll('.merge-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-index'));
        mergeTracks.splice(idx, 1);
        renderMergeTracksList();
      });
    });
  }
}

async function executeMerge() {
  if (mergeTracks.length < 2) {
    alert('Please add at least 2 audio tracks to merge.');
    return;
  }

  const mergeExecuteBtn = document.getElementById('mergeExecuteBtn');
  const mergeSilenceGap = document.getElementById('mergeSilenceGap');

  if (mergeExecuteBtn) {
    mergeExecuteBtn.disabled = true;
    mergeExecuteBtn.innerHTML = '<span class="animate-spin inline-block mr-2">⏳</span> Rendering merged audio...';
  }

  try {
    const gapSeconds = parseFloat(mergeSilenceGap?.value || 0);
    
    let maxSampleRate = 0;
    let maxChannels = 1;
    mergeTracks.forEach(t => {
      if (t.buffer.sampleRate > maxSampleRate) maxSampleRate = t.buffer.sampleRate;
      if (t.buffer.numberOfChannels > maxChannels) maxChannels = t.buffer.numberOfChannels;
    });

    let totalDurationSec = 0;
    mergeTracks.forEach((t, i) => {
      totalDurationSec += t.duration;
      if (i < mergeTracks.length - 1) totalDurationSec += gapSeconds;
    });

    const totalLengthSamples = Math.ceil(totalDurationSec * maxSampleRate);
    const offlineCtx = new OfflineAudioContext(maxChannels, totalLengthSamples, maxSampleRate);

    let currentStartTime = 0;
    mergeTracks.forEach((t, i) => {
      const source = offlineCtx.createBufferSource();
      source.buffer = t.buffer;
      source.connect(offlineCtx.destination);
      source.start(currentStartTime);

      currentStartTime += t.duration;
      if (i < mergeTracks.length - 1) {
        currentStartTime += gapSeconds;
      }
    });

    const renderedBuffer = await offlineCtx.startRendering();
    const wavBlob = bufferToWav(renderedBuffer, 0, renderedBuffer.length);
    const outFilename = `merged_${mergeTracks.length}_tracks_${Date.now()}.wav`;

    await saveOrDownloadWav(wavBlob, outFilename);

  } catch (err) {
    console.error('Error during audio merge:', err);
    alert('Error during audio merge: ' + err.message);
  } finally {
    if (mergeExecuteBtn) {
      mergeExecuteBtn.disabled = false;
      mergeExecuteBtn.innerHTML = '<i data-lucide="layers" class="w-6 h-6 stroke-[3]"></i><span>Merge & Download Joined Audio</span>';
    }
    if (window.lucide) window.lucide.createIcons();
  }
}
