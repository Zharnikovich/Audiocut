// Audiocut - Feature 1: Interval Splitter Module
import { ENV } from '../constants.js';
import { formatBytes, formatTime, sleep, blobToBase64, getAudioExtensionMatch } from '../utils/formatters.js';
import { bufferToWav } from '../utils/wav-encoder.js';
import { 
  getCurrentEnv, 
  getSelectedFolderHandle, 
  getDesktopOutputPath, 
  chooseOutputFolder,
  triggerDownload 
} from '../services/storage.js';
import { registerAudioStopper } from '../components/navigation.js';

let audioFile = null;
let audioBuffer = null;
let isProcessing = false;
let shouldCancel = false;
let generatedSlices = [];
let currentAudioContext = null;

export function initSplitter() {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const removeFileBtn = document.getElementById('removeFileBtn');
  const durationValueInput = document.getElementById('durationValue');
  const durationUnitSelect = document.getElementById('durationUnit');
  const chooseFolderBtn = document.getElementById('chooseFolderBtn');
  const cutBtn = document.getElementById('cutBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const openFolderBtn = document.getElementById('openFolderBtn');

  // Register audio stopper
  registerAudioStopper(() => {
    // Slices audio preview stopper handled via window.currentlyPlayingAudio
  });

  // Drag & Drop
  if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('border-solid', 'bg-neoYellow/15');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('border-solid', 'bg-neoYellow/15');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('border-solid', 'bg-neoYellow/15');
      if (e.dataTransfer.files.length > 0) {
        handleFileSelection(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        handleFileSelection(fileInput.files[0]);
      }
    });
  }

  if (removeFileBtn) {
    removeFileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      resetFileSelection();
    });
  }

  // Duration settings change
  if (durationValueInput && durationUnitSelect) {
    durationValueInput.addEventListener('input', updateSplitPreview);
    durationUnitSelect.addEventListener('change', updateSplitPreview);
  }

  // Choose Folder Button
  if (chooseFolderBtn) {
    chooseFolderBtn.addEventListener('click', async () => {
      try {
        await chooseOutputFolder();
      } catch (err) {
        console.error('Folder selection error:', err);
        alert('Error choosing folder. Please try again.');
      }
    });
  }

  // Cut Button
  if (cutBtn) {
    cutBtn.addEventListener('click', startAudioSlicing);
  }

  // Cancel Button
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      shouldCancel = true;
      const progressStatus = document.getElementById('progressStatus');
      if (progressStatus) progressStatus.textContent = 'Cancelling operation...';
      cancelBtn.disabled = true;
    });
  }

  // Open Folder (Desktop only)
  if (openFolderBtn) {
    openFolderBtn.addEventListener('click', () => {
      const desktopOutputPath = getDesktopOutputPath();
      if (getCurrentEnv() === ENV.DESKTOP && desktopOutputPath && window.pywebview) {
        window.pywebview.api.open_folder(desktopOutputPath);
      }
    });
  }
}

// Window scope fallback for inline button triggers in slice cards
window.triggerDownloadBlobUrl = function(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

async function handleFileSelection(file) {
  if (isProcessing) return;
  
  if (!file.type.startsWith('audio/') && !getAudioExtensionMatch(file.name)) {
    alert('Please select a valid audio file (MP3, WAV, M4A, OGG, etc.)');
    return;
  }
  
  audioFile = file;
  
  const dropZone = document.getElementById('dropZone');
  const fileInfoCard = document.getElementById('fileInfoCard');
  const fileStatusBadge = document.getElementById('fileStatusBadge');
  const infoFileName = document.getElementById('infoFileName');
  const infoFileSize = document.getElementById('infoFileSize');
  const infoDuration = document.getElementById('infoDuration');
  const infoSampleRate = document.getElementById('infoSampleRate');
  const infoChannels = document.getElementById('infoChannels');
  const cutBtn = document.getElementById('cutBtn');

  dropZone.classList.add('hidden');
  fileInfoCard.classList.remove('hidden');
  fileStatusBadge.classList.remove('hidden');
  fileStatusBadge.textContent = 'Decoding...';
  fileStatusBadge.className = 'px-3 py-1 text-xs font-black uppercase tracking-widest border-2 border-black text-black bg-neoOrange shadow-[2px_2px_0px_0px_#000] animate-pulse';
  
  infoFileName.textContent = file.name;
  infoFileSize.textContent = formatBytes(file.size);
  infoDuration.textContent = 'Loading...';
  infoSampleRate.textContent = '-';
  infoChannels.textContent = '-';
  
  cutBtn.disabled = true;
  cutBtn.className = 'w-full py-5 bg-slate-300 text-slate-500 border-4 border-black font-black uppercase tracking-widest text-lg shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] transition-all flex items-center justify-center gap-3 cursor-not-allowed';
  
  try {
    if (currentAudioContext) {
      await currentAudioContext.close();
    }
    currentAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    const fileReader = new FileReader();
    fileReader.onload = async (e) => {
      try {
        const arrayBuffer = e.target.result;
        currentAudioContext.decodeAudioData(arrayBuffer, (decodedBuffer) => {
          audioBuffer = decodedBuffer;
          
          infoDuration.textContent = formatTime(audioBuffer.duration);
          infoSampleRate.textContent = (audioBuffer.sampleRate / 1000).toFixed(1) + ' kHz';
          infoChannels.textContent = audioBuffer.numberOfChannels === 1 ? 'Mono' : audioBuffer.numberOfChannels === 2 ? 'Stereo' : `${audioBuffer.numberOfChannels} Ch`;
          
          fileStatusBadge.textContent = 'Ready';
          fileStatusBadge.className = 'px-3 py-1 text-xs font-black uppercase tracking-widest border-2 border-black text-black bg-neoGreen shadow-[2px_2px_0px_0px_#000]';
          
          updateSplitPreview();
          enableCutButtonIfValid();
        }, (error) => {
          console.error('Decoding error:', error);
          alert('Failed to decode audio. The file might be corrupted or codec unsupported.');
          resetFileSelection();
        });
      } catch (err) {
        console.error(err);
        alert('An error occurred while loading the file.');
        resetFileSelection();
      }
    };
    fileReader.readAsArrayBuffer(file);
    
  } catch (err) {
    console.error('AudioContext creation error:', err);
    alert('Browser doesn\'t support Web Audio API!');
    resetFileSelection();
  }
}

function resetFileSelection() {
  audioFile = null;
  audioBuffer = null;
  const dropZone = document.getElementById('dropZone');
  const fileInfoCard = document.getElementById('fileInfoCard');
  const fileStatusBadge = document.getElementById('fileStatusBadge');
  const fileInput = document.getElementById('fileInput');
  const splitPreview = document.getElementById('splitPreview');

  dropZone.classList.remove('hidden');
  fileInfoCard.classList.add('hidden');
  fileStatusBadge.classList.add('hidden');
  fileInput.value = '';
  if (splitPreview) {
    splitPreview.innerHTML = '<span class="text-slate-500">Select an audio file and duration to see split preview.</span>';
  }
  disableCutButton();
}

function enableCutButtonIfValid() {
  const cutBtn = document.getElementById('cutBtn');
  if (audioBuffer && !isProcessing && cutBtn) {
    cutBtn.disabled = false;
    cutBtn.className = 'w-full py-5 bg-neoGreen hover:bg-black hover:text-white text-black border-4 border-black font-black uppercase tracking-widest text-lg shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all cursor-pointer flex items-center justify-center gap-3';
  }
}

function disableCutButton() {
  const cutBtn = document.getElementById('cutBtn');
  if (cutBtn) {
    cutBtn.disabled = true;
    cutBtn.className = 'w-full py-5 bg-slate-300 text-slate-500 border-4 border-black font-black uppercase tracking-widest text-lg shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] transition-all flex items-center justify-center gap-3 cursor-not-allowed';
  }
}

function getSplitSegments() {
  if (!audioBuffer) return [];
  const durationValueInput = document.getElementById('durationValue');
  const durationUnitSelect = document.getElementById('durationUnit');
  
  const val = parseFloat(durationValueInput.value);
  if (isNaN(val) || val <= 0) return [];
  
  const unitFactor = parseFloat(durationUnitSelect.value);
  const splitDuration = val * unitFactor;
  const totalDuration = audioBuffer.duration;
  const segments = [];
  
  let currentStart = 0;
  while (currentStart < totalDuration) {
    let currentEnd = currentStart + splitDuration;
    if (currentEnd > totalDuration) {
      currentEnd = totalDuration;
    }
    segments.push({
      start: currentStart,
      end: currentEnd,
      duration: currentEnd - currentStart
    });
    currentStart = currentEnd;
  }
  return segments;
}

function updateSplitPreview() {
  const splitPreview = document.getElementById('splitPreview');
  if (!splitPreview) return;

  if (!audioBuffer) {
    splitPreview.innerHTML = '<span class="text-slate-500">Select an audio file and duration to see split preview.</span>';
    return;
  }
  
  const segments = getSplitSegments();
  if (segments.length === 0) {
    splitPreview.innerHTML = '<span class="text-red-400 font-medium">Please enter a valid positive duration.</span>';
    return;
  }
  
  const firstDuration = segments[0].duration;
  const lastDuration = segments[segments.length - 1].duration;
  
  let text = '';
  if (segments.length === 1) {
    text = `The split duration is longer than the file. It will create <strong class="text-black">1 single slice</strong> of ${formatTime(firstDuration)}.`;
  } else if (firstDuration === lastDuration) {
    text = `This will slice the file into <strong class="text-black">${segments.length} equal parts</strong> of ${formatTime(firstDuration)} each.`;
  } else {
    text = `This will slice the file into <strong class="text-black">${segments.length} parts</strong>: <br/>`;
    text += `&bull; <strong class="text-black">${segments.length - 1} full slices</strong> of ${formatTime(firstDuration)}<br/>`;
    text += `&bull; <strong class="text-black">1 final slice</strong> of ${formatTime(lastDuration)}`;
  }
  
  splitPreview.innerHTML = text;
}

async function startAudioSlicing() {
  if (!audioBuffer || isProcessing) return;
  
  const segments = getSplitSegments();
  if (segments.length === 0) return;
  
  const currentEnv = getCurrentEnv();
  let useZip = currentEnv === ENV.LEGACY;

  if (currentEnv === ENV.DESKTOP && !getDesktopOutputPath()) {
    if (!(await chooseOutputFolder())) return;
  } else if (currentEnv === ENV.MODERN && !getSelectedFolderHandle()) {
    if (!(await chooseOutputFolder())) {
      if (!confirm('No folder selected. Download the slices as a ZIP archive instead?')) return;
      useZip = true;
    }
  }

  // Read these after any folder prompt above so the new choice is used
  const desktopOutputPath = getDesktopOutputPath();
  const selectedFolderHandle = useZip ? null : getSelectedFolderHandle();

  if (useZip && !window.JSZip) {
    alert('The ZIP library failed to load, so slices cannot be bundled. Check your internet connection and reload.');
    return;
  }
  
  isProcessing = true;
  shouldCancel = false;
  generatedSlices = [];
  
  const slicesList = document.getElementById('slicesList');
  const slicesEmptyState = document.getElementById('slicesEmptyState');
  const slicesCountBadge = document.getElementById('slicesCountBadge');
  const slicesFooter = document.getElementById('slicesFooter');
  const cancelBtn = document.getElementById('cancelBtn');
  const durationValueInput = document.getElementById('durationValue');
  const durationUnitSelect = document.getElementById('durationUnit');
  const chooseFolderBtn = document.getElementById('chooseFolderBtn');
  const removeFileBtn = document.getElementById('removeFileBtn');
  const progressWidget = document.getElementById('progressWidget');
  const downloadAllBtn = document.getElementById('downloadAllBtn');

  slicesList.innerHTML = '';
  slicesEmptyState.classList.remove('hidden');
  slicesList.classList.add('hidden');
  slicesCountBadge.textContent = '0';
  slicesFooter.classList.add('hidden');
  cancelBtn.disabled = false;
  
  disableCutButton();
  durationValueInput.disabled = true;
  durationUnitSelect.disabled = true;
  chooseFolderBtn.disabled = true;
  removeFileBtn.disabled = true;
  
  progressWidget.classList.remove('hidden');
  updateProgress(0, 'Slicing...', 'Preparing audio workspace...');
  
  const fileBaseName = audioFile.name.substring(0, audioFile.name.lastIndexOf('.')) || audioFile.name;
  const sampleRate = audioBuffer.sampleRate;
  
  await sleep(100);
  
  const zip = useZip ? new JSZip() : null;
  
  try {
    for (let i = 0; i < segments.length; i++) {
      if (shouldCancel) {
        throw new Error('CancelledByUser');
      }
      
      const segment = segments[i];
      const sliceIndex = i + 1;
      const progressPercentValue = Math.round((i / segments.length) * 100);
      
      updateProgress(
        progressPercentValue, 
        `Processing slice ${sliceIndex} of ${segments.length}`, 
        `Slicing from ${formatTime(segment.start)} to ${formatTime(segment.end)}...`
      );
      
      await sleep(15);
      
      const startSample = Math.floor(segment.start * sampleRate);
      const sampleLength = Math.floor(segment.duration * sampleRate);
      const wavBlob = bufferToWav(audioBuffer, startSample, sampleLength);
      const paddedIndex = String(sliceIndex).padStart(2, '0');
      const filename = `${fileBaseName}_part_${paddedIndex}.wav`;
      
      if (currentEnv === ENV.DESKTOP && window.pywebview) {
        const base64Data = await blobToBase64(wavBlob);
        const saveResult = await window.pywebview.api.save_slice(desktopOutputPath, filename, base64Data);
        if (!saveResult.success) {
          throw new Error(`Desktop Save Error: ${saveResult.error}`);
        }
      } else if (currentEnv === ENV.MODERN && selectedFolderHandle) {
        const fileHandle = await selectedFolderHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(wavBlob);
        await writable.close();
      } else if (zip) {
        zip.file(filename, wavBlob);
      }
      
      const sliceData = {
        name: filename,
        blob: wavBlob,
        duration: segment.duration,
        size: wavBlob.size,
        url: URL.createObjectURL(wavBlob)
      };
      generatedSlices.push(sliceData);
      appendSliceToUI(sliceData, sliceIndex);
    }
    
    if (zip) {
      updateProgress(98, 'Packaging archive...', 'Zipping cut audio clips together...');
      await sleep(50);
      const zipBlob = await zip.generateAsync({ type: "blob" });
      
      if (downloadAllBtn) {
        downloadAllBtn.onclick = () => {
          triggerDownload(zipBlob, `${fileBaseName}_cut_slices.zip`);
        };
      }
      triggerDownload(zipBlob, `${fileBaseName}_cut_slices.zip`);
    }
    
    updateProgress(100, 'Cutting Completed!', `Successfully generated ${segments.length} slices.`);
    
    slicesFooter.classList.remove('hidden');
    if (zip && downloadAllBtn) {
      downloadAllBtn.classList.remove('hidden');
    } else if (downloadAllBtn) {
      downloadAllBtn.classList.add('hidden');
    }
    
  } catch (err) {
    console.error('Slicing error:', err);
    if (err.message === 'CancelledByUser') {
      updateProgress(0, 'Cancelled', 'Operation was stopped by the user.', true);
    } else {
      updateProgress(0, 'Slicing Failed', err.message || 'An error occurred during slicing.', true);
      alert('Slicing failed: ' + (err.message || 'Unknown error'));
    }
  } finally {
    isProcessing = false;
    durationValueInput.disabled = false;
    durationUnitSelect.disabled = false;
    chooseFolderBtn.disabled = false;
    removeFileBtn.disabled = false;
    enableCutButtonIfValid();
  }
}

function appendSliceToUI(slice, index) {
  const slicesEmptyState = document.getElementById('slicesEmptyState');
  const slicesList = document.getElementById('slicesList');
  const slicesCountBadge = document.getElementById('slicesCountBadge');

  slicesEmptyState.classList.add('hidden');
  slicesList.classList.remove('hidden');
  slicesCountBadge.textContent = generatedSlices.length;
  
  const item = document.createElement('div');
  item.className = 'p-4 bg-white border-3 border-black shadow-[4px_4px_0px_0px_#000] flex items-center justify-between space-x-3 text-xs transition-all hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[5px_5px_0px_0px_#000] rounded-none';
  
  const playButtonId = `playBtn_${index}`;
  const iconId = `playIcon_${index}`;
  
  item.innerHTML = `
    <div class="flex items-center space-x-3 min-w-0 flex-1">
      <button id="${playButtonId}" class="w-9 h-9 border-2 border-black bg-white hover:bg-neoYellow text-black flex items-center justify-center transition-all shrink-0 shadow-[2px_2px_0px_0px_#000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_0px_#000] rounded-none">
        <i data-lucide="play" id="${iconId}" class="w-4 h-4 fill-current stroke-[2.5]"></i>
      </button>
      <div class="truncate leading-tight">
        <p class="font-extrabold text-black truncate text-sm" title="${slice.name}">${slice.name}</p>
        <p class="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">${formatTime(slice.duration)} &bull; ${formatBytes(slice.size)}</p>
      </div>
    </div>
    <button class="bg-white hover:bg-neoBlue text-black p-2 border-2 border-black shadow-[2px_2px_0px_0px_#000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_0px_#000] transition-all shrink-0 rounded-none" onclick="triggerDownloadBlobUrl('${slice.url}', '${slice.name}')" title="Download slice">
      <i data-lucide="download" class="w-4 h-4 stroke-[2.5]"></i>
    </button>
  `;
  
  slicesList.appendChild(item);
  if (window.lucide) {
    window.lucide.createIcons({ attrs: { class: 'w-3.5 h-3.5' } });
  }
  
  let audio = null;
  const playBtn = item.querySelector(`#${playButtonId}`);
  const playIcon = item.querySelector(`#${iconId}`);
  
  playBtn.addEventListener('click', () => {
    document.querySelectorAll('[id^="playIcon_"]').forEach(icon => {
      if (icon.id !== iconId) {
        icon.setAttribute('data-lucide', 'play');
      }
    });
    if (window.lucide) window.lucide.createIcons();
    
    if (audio && !audio.paused) {
      audio.pause();
    } else {
      if (!audio) {
        audio = new Audio(slice.url);
        audio.addEventListener('ended', () => {
          playIcon.setAttribute('data-lucide', 'play');
          if (window.lucide) window.lucide.createIcons();
        });
      }
      
      if (window.currentlyPlayingAudio && window.currentlyPlayingAudio !== audio) {
        window.currentlyPlayingAudio.pause();
      }
      
      audio.play();
      window.currentlyPlayingAudio = audio;
      
      playIcon.setAttribute('data-lucide', 'pause');
      if (window.lucide) window.lucide.createIcons();
    }
  });
}

function updateProgress(percent, title, detail = '', isError = false) {
  const progressBar = document.getElementById('progressBar');
  const progressPercent = document.getElementById('progressPercent');
  const progressStatus = document.getElementById('progressStatus');
  const progressDetailed = document.getElementById('progressDetailed');

  if (progressBar) progressBar.style.width = `${percent}%`;
  if (progressPercent) progressPercent.textContent = `${percent}%`;
  if (progressStatus) progressStatus.textContent = title;
  if (progressDetailed) progressDetailed.textContent = detail;
  
  if (isError && progressBar) {
    progressBar.classList.add('bg-[#FF6B6B]');
    progressStatus.className = 'text-sm font-black uppercase tracking-wider text-[#FF6B6B]';
  } else if (percent === 100 && progressBar) {
    progressBar.classList.remove('bg-neoOrange');
    progressBar.classList.add('bg-neoGreen');
    progressStatus.className = 'text-sm font-black uppercase tracking-wider text-black';
  } else if (progressBar) {
    progressBar.classList.add('bg-neoOrange');
    progressStatus.className = 'text-sm font-black uppercase tracking-wider text-black';
  }
}
