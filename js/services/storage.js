// Audiocut - Storage & Environment Service
import { ENV } from '../constants.js';
import { blobToBase64 } from '../utils/formatters.js';

let currentEnv = ENV.LEGACY;
let selectedFolderHandle = null;
let desktopOutputPath = null;

export function getCurrentEnv() {
  return currentEnv;
}

export function getSelectedFolderHandle() {
  return selectedFolderHandle;
}

export function setSelectedFolderHandle(handle) {
  selectedFolderHandle = handle;
}

export function getDesktopOutputPath() {
  return desktopOutputPath;
}

export function setDesktopOutputPath(path) {
  desktopOutputPath = path;
}

export function setEnvironment(env) {
  currentEnv = env;
  
  const envBadgeDot = document.getElementById('envBadgeDot');
  const envBadgeText = document.getElementById('envBadgeText');
  const folderAccessNoticeText = document.getElementById('folderAccessNoticeText');
  const chooseFolderBtn = document.getElementById('chooseFolderBtn');
  const openFolderBtn = document.getElementById('openFolderBtn');
  const outputPathDisplay = document.getElementById('outputPathDisplay');

  if (envBadgeDot) {
    envBadgeDot.className = 'w-2.5 h-2.5 rounded-none border-2 border-black inline-block';
  }

  if (env === ENV.DESKTOP) {
    if (envBadgeDot) envBadgeDot.classList.add('bg-neoBlue');
    if (envBadgeText) envBadgeText.textContent = 'Desktop App';
    if (folderAccessNoticeText) folderAccessNoticeText.textContent = 'Files will be saved directly into the folder of your choice using system access.';
    if (chooseFolderBtn) chooseFolderBtn.classList.remove('hidden');
    if (openFolderBtn) openFolderBtn.classList.remove('hidden');
  } else if (env === ENV.MODERN) {
    if (envBadgeDot) envBadgeDot.classList.add('bg-neoGreen');
    if (envBadgeText) envBadgeText.textContent = 'Web (Direct Save Support)';
    if (folderAccessNoticeText) folderAccessNoticeText.textContent = 'Google Chrome / Edge API allows saving directly to your chosen folder.';
    if (chooseFolderBtn) chooseFolderBtn.classList.remove('hidden');
    if (openFolderBtn) openFolderBtn.classList.add('hidden');
  } else {
    if (envBadgeDot) envBadgeDot.classList.add('bg-neoOrange');
    if (envBadgeText) envBadgeText.textContent = 'Web (ZIP Download)';
    if (folderAccessNoticeText) folderAccessNoticeText.textContent = 'Slices will be downloaded in a ZIP archive when completed (Safari/Firefox fallback).';
    if (chooseFolderBtn) chooseFolderBtn.classList.add('hidden');
    if (outputPathDisplay) outputPathDisplay.textContent = 'Standard Downloads Folder (via ZIP)';
    if (openFolderBtn) openFolderBtn.classList.add('hidden');
  }
}

export function initEnvironment() {
  if (window.pywebview) {
    setEnvironment(ENV.DESKTOP);
  } else if ('showDirectoryPicker' in window) {
    setEnvironment(ENV.MODERN);
  } else {
    setEnvironment(ENV.LEGACY);
  }

  window.addEventListener('pywebviewready', () => {
    setEnvironment(ENV.DESKTOP);
  });
}

// Prompts for an output folder (desktop: native dialog, Chrome/Edge: directory picker).
// Returns true when a folder was chosen, false when cancelled or unsupported.
export async function chooseOutputFolder() {
  if (currentEnv === ENV.DESKTOP && window.pywebview) {
    const path = await window.pywebview.api.select_folder();
    if (!path) return false;
    desktopOutputPath = path;
    updateOutputPathDisplays(path, path);
    return true;
  }

  if (currentEnv === ENV.MODERN && 'showDirectoryPicker' in window) {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      selectedFolderHandle = handle;
      updateOutputPathDisplays(handle.name + '/', handle.name);
      return true;
    } catch (err) {
      console.log('Browser directory choice cancelled:', err);
      return false;
    }
  }

  return false;
}

function updateOutputPathDisplays(text, title) {
  ['outputPathDisplay', 'convertOutputPathDisplay'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = text;
      el.title = title;
    }
  });
}

export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function saveOrDownloadFile(blob, filename, options = {}) {
  const silent = !!options.silent;

  // The desktop webview blocks browser downloads, so files must go through the Python API
  if (currentEnv === ENV.DESKTOP && window.pywebview) {
    if (!desktopOutputPath && !(await chooseOutputFolder())) {
      return { success: false, cancelled: true };
    }
    const base64Data = await blobToBase64(blob);
    const res = await window.pywebview.api.save_slice(desktopOutputPath, filename, base64Data);
    if (!res || !res.success) {
      throw new Error(`Could not save ${filename}: ${(res && res.error) || 'unknown error'}`);
    }
    if (!silent) {
      alert(`Saved successfully to: ${res.path}`);
    }
    return { success: true, path: res.path, direct: true };
  }

  if (currentEnv === ENV.MODERN && selectedFolderHandle) {
    try {
      const fileHandle = await selectedFolderHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      if (!silent) {
        alert(`File saved directly to chosen folder: ${filename}`);
      }
      return { success: true, filename, direct: true };
    } catch (e) {
      console.warn('Folder handle write failed, using browser download:', e);
    }
  }

  triggerDownload(blob, filename);
  return { success: true, filename, direct: false };
}

export async function saveOrDownloadWav(blob, filename) {
  return await saveOrDownloadFile(blob, filename, { silent: false });
}
