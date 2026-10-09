// Audiocut - Feature 5: Multi-Format Audio Converter Module
import { ENV, CONVERTER_FORMATS } from '../constants.js';
import { formatBytes, formatTime, getAudioExtensionMatch, escapeHtml } from '../utils/formatters.js';
import { bufferToWav } from '../utils/wav-encoder.js';
import { bufferToAiff } from '../utils/aiff-encoder.js';
import { bufferToMp3 } from '../utils/mp3-encoder.js';
import { bufferToM4a } from '../utils/m4a-encoder.js';
import { bufferToOgg } from '../utils/ogg-encoder.js';
import { decodeAudioFile } from '../utils/audio-decode.js';
import { resampleBuffer, encoderSampleRate } from '../utils/audio-buffer.js';
import {
  getCurrentEnv,
  getDesktopOutputPath,
  getSelectedFolderHandle,
  chooseOutputFolder,
  saveOrDownloadFile
} from '../services/storage.js';
import { registerAudioStopper } from '../components/navigation.js';

let converterQueue = [];
let isConverting = false;
let shouldCancel = false;

export function initConverter() {
  const convertDropZone = document.getElementById('convertDropZone');
  const convertFileInput = document.getElementById('convertFileInput');
  const convertClearAllBtn = document.getElementById('convertClearAllBtn');
  const convertFormatSelect = document.getElementById('convertFormatSelect');
  const convertBitrateSelect = document.getElementById('convertBitrateSelect');
  const convertBitDepthSelect = document.getElementById('convertBitDepthSelect');
  const convertChannelsSelect = document.getElementById('convertChannelsSelect');
  const convertSampleRateSelect = document.getElementById('convertSampleRateSelect');
  const convertChooseFolderBtn = document.getElementById('convertChooseFolderBtn');
  const convertStartBtn = document.getElementById('convertStartBtn');
  const convertCancelBtn = document.getElementById('convertCancelBtn');
  const convertDownloadZipBtn = document.getElementById('convertDownloadZipBtn');

  // Register audio stopper
  registerAudioStopper(() => {
    // Audio previews stop
  });

  // Drag & Drop
  if (convertDropZone && convertFileInput) {
    convertDropZone.addEventListener('click', () => convertFileInput.click());
    convertDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      convertDropZone.classList.add('border-solid', 'bg-neoYellow/15');
    });
    convertDropZone.addEventListener('dragleave', () => {
      convertDropZone.classList.remove('border-solid', 'bg-neoYellow/15');
    });
    convertDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      convertDropZone.classList.remove('border-solid', 'bg-neoYellow/15');
      if (e.dataTransfer.files.length > 0) {
        addFilesToQueue(Array.from(e.dataTransfer.files));
      }
    });

    convertFileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        addFilesToQueue(Array.from(e.target.files));
        convertFileInput.value = '';
      }
    });
  }

  // Clear queue
  if (convertClearAllBtn) {
    convertClearAllBtn.addEventListener('click', () => {
      if (isConverting) return;
      converterQueue = [];
      renderConverterQueue();
    });
  }

  // Format selection change
  if (convertFormatSelect) {
    convertFormatSelect.addEventListener('change', updateFormatOptionsUI);
  }

  // Destination folder choice
  if (convertChooseFolderBtn) {
    convertChooseFolderBtn.addEventListener('click', handleFolderChoice);
  }

  // Convert button
  if (convertStartBtn) {
    convertStartBtn.addEventListener('click', startBatchConversion);
  }

  // Cancel button
  if (convertCancelBtn) {
    convertCancelBtn.addEventListener('click', () => {
      shouldCancel = true;
    });
  }

  // Download all as ZIP
  if (convertDownloadZipBtn) {
    convertDownloadZipBtn.addEventListener('click', () => downloadAllConvertedZip());
  }

  updateFormatOptionsUI();
}

function updateFormatOptionsUI() {
  const formatSelect = document.getElementById('convertFormatSelect');
  const bitrateBox = document.getElementById('convertBitrateBox');
  const bitDepthBox = document.getElementById('convertBitDepthBox');
  const formatDescText = document.getElementById('convertFormatDescText');

  if (!formatSelect) return;
  const targetFmt = formatSelect.value;
  const fmtInfo = CONVERTER_FORMATS[targetFmt.toUpperCase()];

  if (fmtInfo && formatDescText) {
    formatDescText.textContent = fmtInfo.desc;
  }

  // Lossless vs Lossy options
  const isLossless = (targetFmt === 'wav' || targetFmt === 'aiff');
  if (bitrateBox && bitDepthBox) {
    if (isLossless) {
      bitrateBox.classList.add('hidden');
      bitDepthBox.classList.remove('hidden');
    } else {
      bitrateBox.classList.remove('hidden');
      bitDepthBox.classList.add('hidden');
    }
  }

  updateQueueEstimatedTargets();
}

async function handleFolderChoice() {
  try {
    await chooseOutputFolder();
  } catch (err) {
    console.error('Folder selection error:', err);
    alert('Error choosing folder. Please try again.');
  }
}

async function addFilesToQueue(files) {
  const validFiles = files.filter(f => getAudioExtensionMatch(f.name));
  if (validFiles.length === 0) {
    alert('Please select valid audio files (MP3, WAV, M4A, OGG, FLAC, AIFF, etc.).');
    return;
  }

  for (const file of validFiles) {
    const origExt = file.name.split('.').pop().toLowerCase();
    const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;

    const item = {
      id: 'conv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      file: file,
      baseName: baseName,
      origName: file.name,
      origExt: origExt,
      size: file.size,
      decodable: false, // Decoded audio is not kept in memory; it is decoded again at conversion time
      duration: 0,
      sampleRate: 0,
      channels: 0,
      status: 'loading', // loading, ready, converting, done, error
      progress: 0,
      errorMsg: null,
      convertedBlob: null,
      outFilename: null
    };

    converterQueue.push(item);
    renderConverterQueue();

    // Decode once to validate the file and read its details
    try {
      const decodedBuffer = await decodeAudioFile(file);
      item.decodable = true;
      item.duration = decodedBuffer.duration;
      item.sampleRate = decodedBuffer.sampleRate;
      item.channels = decodedBuffer.numberOfChannels;
      item.status = 'ready';
    } catch (err) {
      console.warn('Could not decode file for conversion:', file.name, err);
      item.status = 'error';
      item.errorMsg = 'Could not decode audio data (unsupported codec, corrupted, or too large for browser memory)';
    }

    renderConverterQueue();
  }
}

function renderConverterQueue() {
  const workspace = document.getElementById('convertWorkspace');
  const countBadge = document.getElementById('convertCountBadge');
  const queueList = document.getElementById('convertQueueList');
  const startBtn = document.getElementById('convertStartBtn');
  const downloadZipBtn = document.getElementById('convertDownloadZipBtn');

  if (!workspace) return;

  if (converterQueue.length === 0) {
    workspace.classList.add('hidden');
    if (countBadge) countBadge.textContent = '0 Files';
    if (startBtn) startBtn.disabled = true;
    return;
  }

  workspace.classList.remove('hidden');
  if (countBadge) {
    countBadge.textContent = `${converterQueue.length} File${converterQueue.length > 1 ? 's' : ''}`;
  }

  if (queueList) {
    queueList.innerHTML = '';
  }

  const targetFormat = document.getElementById('convertFormatSelect')?.value || 'mp3';
  let hasReady = false;
  let doneCount = 0;

  converterQueue.forEach((item, index) => {
    if (item.status === 'ready' || item.status === 'done') hasReady = true;
    if (item.status === 'done') doneCount++;

    const row = document.createElement('div');
    row.className = 'p-3.5 bg-white border-2 border-black shadow-[3px_3px_0px_0px_#000] space-y-2.5';

    let statusBadgeHtml = '';
    if (item.status === 'loading') {
      statusBadgeHtml = `<span class="px-2 py-0.5 bg-neoYellow border border-black font-black text-[10px] uppercase animate-pulse">Reading...</span>`;
    } else if (item.status === 'ready') {
      statusBadgeHtml = `<span class="px-2 py-0.5 bg-neoGreen border border-black font-black text-[10px] uppercase">Ready</span>`;
    } else if (item.status === 'converting') {
      statusBadgeHtml = `<span class="px-2 py-0.5 bg-neoOrange text-white border border-black font-black text-[10px] uppercase">Converting ${(item.progress * 100).toFixed(0)}%</span>`;
    } else if (item.status === 'done') {
      statusBadgeHtml = `<span class="px-2 py-0.5 bg-neoGreen text-black border border-black font-black text-[10px] uppercase">Converted</span>`;
    } else {
      statusBadgeHtml = `<span class="px-2 py-0.5 bg-[#FF6B6B] text-black border border-black font-black text-[10px] uppercase">Error</span>`;
    }

    const outExt = targetFormat.toLowerCase();
    const targetName = `${item.baseName}.${outExt}`;

    let actionBtnHtml = '';
    if (item.status === 'done' && item.convertedBlob) {
      actionBtnHtml = `
        <button class="conv-download-btn px-2.5 py-1 bg-neoYellow hover:bg-black hover:text-white text-black text-[10px] font-black uppercase border-2 border-black shadow-[1px_1px_0px_0px_#000] flex items-center gap-1 transition-all" data-id="${item.id}">
          <i data-lucide="download" class="w-3 h-3 stroke-[2.5]"></i>
          <span>Save</span>
        </button>
      `;
    }

    row.innerHTML = `
      <div class="flex items-center justify-between gap-3 text-xs">
        <div class="flex items-center gap-2 min-w-0">
          <span class="w-5 h-5 bg-neoCream border border-black flex items-center justify-center font-mono font-black text-[10px] shrink-0">${index + 1}</span>
          <div class="truncate">
            <p class="font-black uppercase tracking-wider text-black truncate" title="${escapeHtml(item.origName)}">${escapeHtml(item.origName)}</p>
            <p class="text-[10px] font-bold text-slate-500 uppercase mt-0.5">
              ${formatBytes(item.size)} &bull; ${item.duration ? formatTime(item.duration) : '--'} &bull; 
              <span class="font-mono text-black font-black">${escapeHtml(item.origExt.toUpperCase())} &rarr; ${outExt.toUpperCase()}</span>
            </p>
            ${item.status === 'error' && item.errorMsg ? `<p class="text-[10px] font-bold text-[#B91C1C] mt-0.5 whitespace-normal">${escapeHtml(item.errorMsg)}</p>` : ''}
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          ${statusBadgeHtml}
          ${actionBtnHtml}
          <button class="conv-remove-btn text-black hover:bg-[#FF6B6B] p-1 border border-black transition-colors" data-id="${item.id}" ${isConverting ? 'disabled' : ''}>
            <i data-lucide="x" class="w-3.5 h-3.5 stroke-[2.5]"></i>
          </button>
        </div>
      </div>
      ${item.status === 'converting' ? `
        <div class="w-full bg-slate-100 border border-black h-2 overflow-hidden">
          <div class="bg-neoOrange h-full transition-all duration-150" style="width: ${Math.round(item.progress * 100)}%"></div>
        </div>
      ` : ''}
    `;

    queueList.appendChild(row);
  });

  // Attach individual item action listeners
  queueList.querySelectorAll('.conv-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      converterQueue = converterQueue.filter(item => item.id !== id);
      renderConverterQueue();
    });
  });

  queueList.querySelectorAll('.conv-download-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const item = converterQueue.find(q => q.id === id);
      if (item && item.convertedBlob) {
        saveOrDownloadFile(item.convertedBlob, item.outFilename).catch(err => {
          alert('Save failed: ' + err.message);
        });
      }
    });
  });

  if (startBtn) {
    startBtn.disabled = isConverting || !hasReady;
    if (isConverting) {
      startBtn.className = 'w-full py-5 bg-slate-300 text-slate-500 border-4 border-black font-black uppercase tracking-widest text-lg shadow-[8px_8px_0px_0px_#000] cursor-not-allowed';
    } else {
      startBtn.className = 'w-full py-5 bg-neoGreen hover:bg-black hover:text-white text-black border-4 border-black font-black uppercase tracking-widest text-lg shadow-[8px_8px_0px_0px_#000] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[10px_10px_0px_0px_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0px_0px_#000] transition-all cursor-pointer flex items-center justify-center gap-3';
    }
  }

  if (downloadZipBtn) {
    if (doneCount > 1) {
      downloadZipBtn.classList.remove('hidden');
    } else {
      downloadZipBtn.classList.add('hidden');
    }
  }

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function updateQueueEstimatedTargets() {
  renderConverterQueue();
}

async function startBatchConversion() {
  if (isConverting) return;
  const readyItems = converterQueue.filter(item => item.decodable);
  if (readyItems.length === 0) {
    alert('No ready audio files to convert.');
    return;
  }

  // Desktop builds can only write through the Python API, so ask for the folder once up front
  if (getCurrentEnv() === ENV.DESKTOP && !getDesktopOutputPath() && !(await chooseOutputFolder())) {
    return;
  }

  isConverting = true;
  shouldCancel = false;

  const progressWidget = document.getElementById('convertProgressWidget');
  const progressStatus = document.getElementById('convertProgressStatus');
  const progressPercent = document.getElementById('convertProgressPercent');
  const progressBar = document.getElementById('convertProgressBar');
  const progressDetailed = document.getElementById('convertProgressDetailed');

  if (progressWidget) progressWidget.classList.remove('hidden');

  const targetFormat = document.getElementById('convertFormatSelect')?.value || 'mp3';
  const bitrate = parseInt(document.getElementById('convertBitrateSelect')?.value || '192', 10);
  const bitDepth = parseInt(document.getElementById('convertBitDepthSelect')?.value || '16', 10);
  const channelOption = document.getElementById('convertChannelsSelect')?.value || 'original';
  const sampleRateOption = document.getElementById('convertSampleRateSelect')?.value || 'original';

  const totalFiles = readyItems.length;
  let directSaveSuccessCount = 0;
  const convertedThisRun = [];

  // Write each file straight to disk when a destination is available; otherwise the batch is
  // delivered at the end as one download (a single file, or a ZIP) instead of one per file
  const env = getCurrentEnv();
  const canSaveDirect = env === ENV.DESKTOP || (env === ENV.MODERN && !!getSelectedFolderHandle());

  for (let i = 0; i < totalFiles; i++) {
    if (shouldCancel) {
      break;
    }

    const item = readyItems[i];
    item.status = 'converting';
    item.progress = 0;
    renderConverterQueue();

    if (progressStatus) progressStatus.textContent = `Converting ${i + 1} of ${totalFiles}...`;
    if (progressDetailed) progressDetailed.textContent = item.origName;

    try {
      // 1. Decode, then remix channels and/or resample as requested and as the encoder requires
      const decodedBuffer = await decodeAudioFile(item.file);
      const processedBuffer = await prepareAudioBuffer(decodedBuffer, channelOption, sampleRateOption, targetFormat);

      // 2. Encode to target format
      const outExt = targetFormat.toLowerCase();
      const outFilename = `${item.baseName}.${outExt}`;
      item.outFilename = outFilename;

      const encoderOptions = {
        bitrate: bitrate,
        bitDepth: bitDepth,
        channels: processedBuffer.numberOfChannels,
        sampleRate: processedBuffer.sampleRate
      };

      const fileProgressCb = (p) => {
        item.progress = p;
        const overall = ((i + p) / totalFiles) * 100;
        if (progressBar) progressBar.style.width = `${overall}%`;
        if (progressPercent) progressPercent.textContent = `${Math.round(overall)}%`;
        renderConverterQueue();
      };

      let convertedBlob = null;
      if (targetFormat === 'mp3') {
        convertedBlob = await bufferToMp3(processedBuffer, encoderOptions, fileProgressCb);
      } else if (targetFormat === 'wav') {
        convertedBlob = bufferToWav(processedBuffer, 0, null, encoderOptions);
        fileProgressCb(1.0);
      } else if (targetFormat === 'aiff') {
        convertedBlob = bufferToAiff(processedBuffer, 0, null, encoderOptions);
        fileProgressCb(1.0);
      } else if (targetFormat === 'm4a') {
        convertedBlob = await bufferToM4a(processedBuffer, encoderOptions, fileProgressCb);
      } else if (targetFormat === 'ogg') {
        convertedBlob = await bufferToOgg(processedBuffer, encoderOptions, fileProgressCb);
      } else {
        throw new Error(`Unsupported target format: ${targetFormat}`);
      }

      item.convertedBlob = convertedBlob;
      item.status = 'done';
      item.progress = 1.0;
      convertedThisRun.push(item);

      // 3. Save directly when possible
      if (canSaveDirect) {
        const saveResult = await saveOrDownloadFile(convertedBlob, outFilename, { silent: true });
        if (saveResult && saveResult.direct) {
          directSaveSuccessCount++;
        }
      }
    } catch (err) {
      console.error(`Error converting ${item.origName}:`, err);
      item.status = 'error';
      item.errorMsg = err.message || 'Conversion failed';
    }

    renderConverterQueue();
  }

  isConverting = false;

  if (!canSaveDirect && convertedThisRun.length === 1) {
    const only = convertedThisRun[0];
    await saveOrDownloadFile(only.convertedBlob, only.outFilename, { silent: true });
  } else if (!canSaveDirect && convertedThisRun.length > 1) {
    await downloadAllConvertedZip(convertedThisRun);
  }

  if (progressBar) progressBar.style.width = '100%';
  if (progressPercent) progressPercent.textContent = '100%';

  if (progressStatus) {
    if (shouldCancel) {
      progressStatus.textContent = 'Conversion cancelled.';
    } else {
      progressStatus.textContent = 'All conversions completed!';
      if (directSaveSuccessCount > 0) {
        alert(`Successfully saved ${directSaveSuccessCount} converted file(s) to chosen destination!`);
      }
    }
  }

  setTimeout(() => {
    if (progressWidget && !isConverting) {
      progressWidget.classList.add('hidden');
    }
  }, 4000);

  renderConverterQueue();
}

async function prepareAudioBuffer(inputBuffer, channelOption, sampleRateOption, targetFormat) {
  let targetSampleRate = inputBuffer.sampleRate;
  if (sampleRateOption === '44100') targetSampleRate = 44100;
  if (sampleRateOption === '48000') targetSampleRate = 48000;
  // MP3/AAC only support certain rates (e.g. no 96 kHz), so map to the nearest supported one
  targetSampleRate = encoderSampleRate(targetFormat, targetSampleRate);

  let targetChannels = Math.min(inputBuffer.numberOfChannels, 2);
  if (channelOption === '1') targetChannels = 1;
  if (channelOption === '2') targetChannels = 2;

  return await resampleBuffer(inputBuffer, targetChannels, targetSampleRate);
}

async function downloadAllConvertedZip(items = null) {
  const doneItems = items || converterQueue.filter(item => item.status === 'done' && item.convertedBlob);
  if (doneItems.length === 0) return;

  if (typeof window.JSZip === 'undefined') {
    alert('The ZIP library failed to load. Use the Save button on each file instead.');
    return;
  }

  const zip = new window.JSZip();
  doneItems.forEach(item => {
    zip.file(item.outFilename, item.convertedBlob);
  });

  const content = await zip.generateAsync({ type: 'blob' });
  try {
    await saveOrDownloadFile(content, 'converted_audio_bundle.zip');
  } catch (err) {
    alert('Save failed: ' + err.message);
  }
}
