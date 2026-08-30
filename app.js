// Audiocut - Core JavaScript Logic

// --- App State ---
let audioFile = null;
let audioBuffer = null;
let selectedFolderHandle = null; // Browser File System Access API
let desktopOutputPath = null;    // PyWebView Desktop API
let isProcessing = false;
let shouldCancel = false;
let generatedSlices = [];         // List of { name, blob, duration, size }
let currentAudioContext = null;

// --- DOM Elements ---
const envBadgeText = document.getElementById('envBadgeText');
const envBadgeDot = document.getElementById('envBadgeDot');
const envBadge = document.getElementById('envBadge');

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileInfoCard = document.getElementById('fileInfoCard');
const removeFileBtn = document.getElementById('removeFileBtn');
const fileStatusBadge = document.getElementById('fileStatusBadge');

const infoFileName = document.getElementById('infoFileName');
const infoFileSize = document.getElementById('infoFileSize');
const infoDuration = document.getElementById('infoDuration');
const infoSampleRate = document.getElementById('infoSampleRate');
const infoChannels = document.getElementById('infoChannels');

const durationValueInput = document.getElementById('durationValue');
const durationUnitSelect = document.getElementById('durationUnit');
const splitPreview = document.getElementById('splitPreview');

const chooseFolderBtn = document.getElementById('chooseFolderBtn');
const outputPathDisplay = document.getElementById('outputPathDisplay');
const folderAccessNoticeText = document.getElementById('folderAccessNoticeText');

const cutBtn = document.getElementById('cutBtn');
const progressWidget = document.getElementById('progressWidget');
const progressStatus = document.getElementById('progressStatus');
const progressPercent = document.getElementById('progressPercent');
const progressBar = document.getElementById('progressBar');
const progressDetailed = document.getElementById('progressDetailed');
const cancelBtn = document.getElementById('cancelBtn');

const slicesEmptyState = document.getElementById('slicesEmptyState');
const slicesList = document.getElementById('slicesList');
const slicesCountBadge = document.getElementById('slicesCountBadge');
const slicesFooter = document.getElementById('slicesFooter');
const downloadAllBtn = document.getElementById('downloadAllBtn');
const openFolderBtn = document.getElementById('openFolderBtn');

// --- Environment Detection ---
const ENV = {
  DESKTOP: 'desktop',   // Running inside PyWebView
  MODERN: 'modern',     // Running in Chrome/Edge with File System Access
  LEGACY: 'legacy'      // Running in Firefox/Safari (Fallback to ZIP)
};
let currentEnv = ENV.LEGACY;

function detectEnvironment() {
  if (window.pywebview) {
    setEnvironment(ENV.DESKTOP);
  } else {
    // If running in browser, check for showDirectoryPicker support
    if ('showDirectoryPicker' in window) {
      setEnvironment(ENV.MODERN);
    } else {
      setEnvironment(ENV.LEGACY);
    }
  }
}

function setEnvironment(env) {
  currentEnv = env;
  
  // Update badge UI
  envBadgeDot.className = 'w-2.5 h-2.5 rounded-none border-2 border-black inline-block';
  
  if (env === ENV.DESKTOP) {
    envBadgeDot.classList.add('bg-neoBlue');
    envBadgeText.textContent = 'Desktop App';
    folderAccessNoticeText.textContent = 'Files will be saved directly into the folder of your choice using system access.';
    chooseFolderBtn.classList.remove('hidden');
    openFolderBtn.classList.remove('hidden');
  } else if (env === ENV.MODERN) {
    envBadgeDot.classList.add('bg-neoGreen');
    envBadgeText.textContent = 'Web (Direct Save Support)';
    folderAccessNoticeText.textContent = 'Google Chrome / Edge API allows saving directly to your chosen folder.';
    chooseFolderBtn.classList.remove('hidden');
    openFolderBtn.classList.add('hidden'); // Cannot open folder explorer from browser
  } else {
    envBadgeDot.classList.add('bg-neoOrange');
    envBadgeText.textContent = 'Web (ZIP Download)';
    folderAccessNoticeText.textContent = 'Slices will be downloaded in a ZIP archive when completed (Safari/Firefox fallback).';
    chooseFolderBtn.classList.add('hidden'); // Disable choose folder button since we can't save directly
    outputPathDisplay.textContent = 'Standard Downloads Folder (via ZIP)';
    openFolderBtn.classList.add('hidden');
  }
}

// Check for pywebview API inject
window.addEventListener('pywebviewready', () => {
  setEnvironment(ENV.DESKTOP);
});

// Run detection on page load
detectEnvironment();

// --- Event Listeners ---

// Drag & Drop
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
  dropZone.classList.remove('border-primary-500', 'bg-primary-500/5');
  if (e.dataTransfer.files.length > 0) {
    handleFileSelection(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    handleFileSelection(fileInput.files[0]);
  }
});

removeFileBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  resetFileSelection();
});

// Slices Settings Change
durationValueInput.addEventListener('input', updateSplitPreview);
durationUnitSelect.addEventListener('change', updateSplitPreview);

// Folder Selector
chooseFolderBtn.addEventListener('click', async () => {
  if (currentEnv === ENV.DESKTOP) {
    try {
      const path = await window.pywebview.api.select_folder();
      if (path) {
        desktopOutputPath = path;
        outputPathDisplay.textContent = path;
        outputPathDisplay.title = path;
      }
    } catch (err) {
      console.error('Desktop folder selection error:', err);
      alert('Error choosing folder. Please try again.');
    }
  } else if (currentEnv === ENV.MODERN) {
    try {
      const handle = await window.showDirectoryPicker({
        mode: 'readwrite'
      });
      if (handle) {
        selectedFolderHandle = handle;
        outputPathDisplay.textContent = handle.name + '/';
        outputPathDisplay.title = handle.name;
      }
    } catch (err) {
      // User cancelled or browser rejected
      console.log('Browser directory choice ignored or cancelled', err);
    }
  }
});

// Cut Action Button
cutBtn.addEventListener('click', startAudioSlicing);

// Cancel Button
cancelBtn.addEventListener('click', () => {
  shouldCancel = true;
  progressStatus.textContent = 'Cancelling operation...';
  cancelBtn.disabled = true;
});

// Download All / ZIP trigger
downloadAllBtn.addEventListener('click', downloadAllAsZip);

// Open folder (Desktop only)
openFolderBtn.addEventListener('click', () => {
  if (currentEnv === ENV.DESKTOP && desktopOutputPath) {
    window.pywebview.api.open_folder(desktopOutputPath);
  }
});

// --- Logic Implementation ---

// Handle selected file
async function handleFileSelection(file) {
  if (isProcessing) return;
  
  // Quick validation
  if (!file.type.startsWith('audio/') && !getAudioExtensionMatch(file.name)) {
    alert('Please select a valid audio file (MP3, WAV, M4A, OGG, etc.)');
    return;
  }
  
  audioFile = file;
  
  // Show Loading Info
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
    // Decode Audio Data using Web Audio API
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
          
          // Update details UI
          infoDuration.textContent = formatTime(audioBuffer.duration);
          infoSampleRate.textContent = (audioBuffer.sampleRate / 1000).toFixed(1) + ' kHz';
          infoChannels.textContent = audioBuffer.numberOfChannels === 1 ? 'Mono' : audioBuffer.numberOfChannels === 2 ? 'Stereo' : `${audioBuffer.numberOfChannels} Ch`;
          
          fileStatusBadge.textContent = 'Ready';
          fileStatusBadge.className = 'px-3 py-1 text-xs font-black uppercase tracking-widest border-2 border-black text-black bg-neoGreen shadow-[2px_2px_0px_0px_#000]';
          
          updateSplitPreview();
          enableCutButtonIfValid();
        }, (error) => {
          console.error('Decoding error:', error);
          alert('Failed to decode audio. The file might be corrupted or the browser doesn\'t support this specific audio codec.');
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
  dropZone.classList.remove('hidden');
  fileInfoCard.classList.add('hidden');
  fileStatusBadge.classList.add('hidden');
  fileInput.value = '';
  splitPreview.innerHTML = '<span class="text-slate-500">Select an audio file and duration to see split preview.</span>';
  disableCutButton();
}

function enableCutButtonIfValid() {
  if (audioBuffer && !isProcessing) {
    cutBtn.disabled = false;
    cutBtn.className = 'w-full py-5 bg-neoGreen text-black border-4 border-black font-black uppercase tracking-widest text-lg shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all cursor-pointer flex items-center justify-center gap-3';
  }
}

function disableCutButton() {
  cutBtn.disabled = true;
  cutBtn.className = 'w-full py-5 bg-slate-300 text-slate-500 border-4 border-black font-black uppercase tracking-widest text-lg shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] transition-all flex items-center justify-center gap-3 cursor-not-allowed';
}

function getAudioExtensionMatch(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'webm', 'mp4', 'aiff', 'caf'].includes(ext);
}

// Calculate the splits
function getSplitSegments() {
  if (!audioBuffer) return [];
  
  const val = parseFloat(durationValueInput.value);
  if (isNaN(val) || val <= 0) return [];
  
  const unitFactor = parseFloat(durationUnitSelect.value); // 60 for minutes, 1 for seconds
  const splitDuration = val * unitFactor; // in seconds
  
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

// Live preview text generator
function updateSplitPreview() {
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
    text = `The split duration is longer than the file. It will create <strong class="text-slate-200">1 single slice</strong> of ${formatTime(firstDuration)}.`;
  } else if (firstDuration === lastDuration) {
    text = `This will slice the file into <strong class="text-slate-200">${segments.length} equal parts</strong> of ${formatTime(firstDuration)} each.`;
  } else {
    text = `This will slice the file into <strong class="text-slate-200">${segments.length} parts</strong>: <br/>`;
    text += `&bull; <strong class="text-slate-200">${segments.length - 1} full slices</strong> of ${formatTime(firstDuration)}<br/>`;
    text += `&bull; <strong class="text-slate-200">1 final slice</strong> of ${formatTime(lastDuration)}`;
  }
  
  splitPreview.innerHTML = text;
}

// --- Audio Slicing Engine ---
async function startAudioSlicing() {
  if (!audioBuffer || isProcessing) return;
  
  const segments = getSplitSegments();
  if (segments.length === 0) return;
  
  // Check output directory requirements
  if (currentEnv === ENV.DESKTOP && !desktopOutputPath) {
    alert('Please choose an output folder first.');
    return;
  }
  if (currentEnv === ENV.MODERN && !selectedFolderHandle) {
    // Attempt directory choosing directly
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      if (handle) {
        selectedFolderHandle = handle;
        outputPathDisplay.textContent = handle.name + '/';
      } else {
        return;
      }
    } catch (e) {
      alert('A target directory must be selected to save output directly, or select standard fallback (downloads).');
      return;
    }
  }
  
  // Set lock flags
  isProcessing = true;
  shouldCancel = false;
  generatedSlices = [];
  
  // Reset outputs
  slicesList.innerHTML = '';
  slicesEmptyState.classList.remove('hidden');
  slicesList.classList.add('hidden');
  slicesCountBadge.textContent = '0';
  slicesFooter.classList.add('hidden');
  cancelBtn.disabled = false;
  
  // Disable configuration triggers
  disableCutButton();
  durationValueInput.disabled = true;
  durationUnitSelect.disabled = true;
  chooseFolderBtn.disabled = true;
  removeFileBtn.disabled = true;
  
  // Show progress widget
  progressWidget.classList.remove('hidden');
  updateProgress(0, 'Slicing...', 'Preparing audio workspace...');
  
  const fileBaseName = audioFile.name.substring(0, audioFile.name.lastIndexOf('.')) || audioFile.name;
  const sampleRate = audioBuffer.sampleRate;
  
  // Let DOM render transition
  await sleep(100);
  
  const zip = (currentEnv === ENV.LEGACY) ? new JSZip() : null;
  
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
      
      // Let the UI tick so the screen doesn't freeze
      await sleep(15);
      
      // Slice & write WAV
      const startSample = Math.floor(segment.start * sampleRate);
      const sampleLength = Math.floor(segment.duration * sampleRate);
      
      // Generate WAV Blob
      const wavBlob = bufferToWav(audioBuffer, startSample, sampleLength);
      const paddedIndex = String(sliceIndex).padStart(2, '0');
      const filename = `${fileBaseName}_part_${paddedIndex}.wav`;
      
      // Save based on Environment
      if (currentEnv === ENV.DESKTOP) {
        // Save via Python API
        const base64Data = await blobToBase64(wavBlob);
        const saveResult = await window.pywebview.api.save_slice(desktopOutputPath, filename, base64Data);
        if (!saveResult.success) {
          throw new Error(`Desktop Save Error: ${saveResult.error}`);
        }
      } else if (currentEnv === ENV.MODERN && selectedFolderHandle) {
        // Save via File System Access API
        const fileHandle = await selectedFolderHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(wavBlob);
        await writable.close();
      } else if (zip) {
        // Fallback: Add to Zip
        zip.file(filename, wavBlob);
      }
      
      // Keep reference for output display
      const sliceData = {
        name: filename,
        blob: wavBlob,
        duration: segment.duration,
        size: wavBlob.size,
        url: URL.createObjectURL(wavBlob)
      };
      generatedSlices.push(sliceData);
      
      // Add slice to list immediately for real-time visualization!
      appendSliceToUI(sliceData, sliceIndex);
    }
    
    // Finalize Slicing Process
    if (zip) {
      updateProgress(98, 'Packaging archive...', 'Zipping cut audio clips together...');
      await sleep(50);
      const zipBlob = await zip.generateAsync({ type: "blob" });
      
      // Save ZIP blob on the download button
      downloadAllBtn.onclick = () => {
        triggerDownload(zipBlob, `${fileBaseName}_cut_slices.zip`);
      };
      
      // Trigger instant automatic download
      triggerDownload(zipBlob, `${fileBaseName}_cut_slices.zip`);
    }
    
    // Complete State UI
    updateProgress(100, 'Cutting Completed!', `Successfully generated ${segments.length} slices.`);
    
    // Display slices list footer & setup open/actions buttons
    slicesFooter.classList.remove('hidden');
    if (currentEnv === ENV.LEGACY) {
      downloadAllBtn.classList.remove('hidden');
    } else {
      downloadAllBtn.classList.add('hidden'); // No need for zip download when direct saved!
    }
    
  } catch (err) {
    console.error('Slicing error:', err);
    if (err.message === 'CancelledByUser') {
      updateProgress(0, 'Cancelled', 'Operation was stopped by the user.', true);
      // Delete any files created? In zip mode, nothing was saved yet. In direct mode, what was saved is saved.
    } else {
      updateProgress(0, 'Slicing Failed', err.message || 'An error occurred during slicing.', true);
      alert('Slicing failed: ' + (err.message || 'Unknown error'));
    }
  } finally {
    // Unlock UI controls
    isProcessing = false;
    durationValueInput.disabled = false;
    durationUnitSelect.disabled = false;
    chooseFolderBtn.disabled = false;
    removeFileBtn.disabled = false;
    enableCutButtonIfValid();
  }
}

// --- DOM Builders & Helpers ---

function appendSliceToUI(slice, index) {
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
  lucide.createIcons({ attrs: { class: 'w-3.5 h-3.5' } });
  
  // Custom Audio Preview Control
  let audio = null;
  const playBtn = item.querySelector(`#${playButtonId}`);
  const playIcon = item.querySelector(`#${iconId}`);
  
  playBtn.addEventListener('click', () => {
    // Stop all other playing audios
    document.querySelectorAll('[id^="playIcon_"]').forEach(icon => {
      if (icon.id !== iconId) {
        icon.setAttribute('data-lucide', 'play');
        icon.classList.remove('text-primary-400');
      }
    });
    lucide.createIcons();
    
    // Play/Pause toggler
    if (audio && !audio.paused) {
      audio.pause();
    } else {
      if (!audio) {
        audio = new Audio(slice.url);
        audio.addEventListener('ended', () => {
          playIcon.setAttribute('data-lucide', 'play');
          lucide.createIcons();
        });
      }
      
      // Stop currently playing audios on window state
      if (window.currentlyPlayingAudio && window.currentlyPlayingAudio !== audio) {
        window.currentlyPlayingAudio.pause();
      }
      
      audio.play();
      window.currentlyPlayingAudio = audio;
      
      playIcon.setAttribute('data-lucide', 'pause');
      lucide.createIcons();
    }
  });
}

function updateProgress(percent, title, detail = '', isError = false) {
  progressBar.style.width = `${percent}%`;
  progressPercent.textContent = `${percent}%`;
  progressStatus.textContent = title;
  progressDetailed.textContent = detail;
  
  // Re-sync progress bar styling classes for Neo-Brutalist states
  progressBar.className = 'h-full border-r-2 border-black transition-all duration-300';
  
  if (isError) {
    progressBar.classList.add('bg-[#FF6B6B]'); // Neo-brutalist neon red/pink
    progressStatus.className = 'text-sm font-black uppercase tracking-wider text-[#FF6B6B]';
  } else if (percent === 100) {
    progressBar.classList.add('bg-neoGreen'); // Neo-brutalist neon green
    progressStatus.className = 'text-sm font-black uppercase tracking-wider text-black';
  } else {
    progressBar.classList.add('bg-neoOrange'); // Neo-brutalist solid orange
    progressStatus.className = 'text-sm font-black uppercase tracking-wider text-black';
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Window scope fallback for inline button triggers
window.triggerDownloadBlobUrl = function(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

async function downloadAllAsZip() {
  // Triggers zip re-download if they close it
  alert('Preparing download archive...');
}

// Format utilities
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  
  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  }
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}.${ms}s`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// File helper: Converts a blob into a Base64 string for Webview communication
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// --- WAV Encoder Helpers (Pure JS) ---

function bufferToWav(buffer, offset, length) {
  const numOfChan = Math.min(buffer.numberOfChannels, 2); // Cap at stereo
  const sampleRate = buffer.sampleRate;
  const format = 1; // 1 = Raw PCM (16-bit)
  const bitDepth = 16;
  
  let result;
  if (numOfChan === 2) {
    result = interleave(buffer.getChannelData(0), buffer.getChannelData(1), offset, length);
  } else {
    result = buffer.getChannelData(0).subarray(offset, offset + length);
  }
  
  return writeWavFile(result, numOfChan, sampleRate, bitDepth);
}

function interleave(inputL, inputR, offset, length) {
  const result = new Float32Array(length * 2);
  let index = 0;
  const end = offset + length;
  
  // Safe bounds check
  for (let i = offset; i < end; i++) {
    // If we exceed bounds of either channel due to tiny offset issues, write 0
    result[index++] = (i < inputL.length) ? inputL[i] : 0;
    result[index++] = (i < inputR.length) ? inputR[i] : 0;
  }
  return result;
}

function writeWavFile(samples, numOfChan, sampleRate, bitDepth) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  
  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* file length */
  view.setUint32(4, 36 + samples.length * 2, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw) */
  view.setUint16(20, 1, true);
  /* channel count */
  view.setUint16(22, numOfChan, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * numOfChan * (bitDepth / 8), true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, numOfChan * (bitDepth / 8), true);
  /* bits per sample */
  view.setUint16(34, bitDepth, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, samples.length * 2, true);
  
  // Write PCM samples
  floatTo16BitPCM(view, 44, samples);
  
  return new Blob([view], { type: 'audio/wav' });
}

function floatTo16BitPCM(output, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
