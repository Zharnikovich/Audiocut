// Audiocut - Application Constants

export const ENV = {
  DESKTOP: 'desktop', // Running inside PyWebView native wrapper
  MODERN: 'modern',   // Running in Chrome/Edge with File System Access API
  LEGACY: 'legacy'    // Running in Safari/Firefox (ZIP download fallback)
};

export const SUPPORTED_AUDIO_EXTENSIONS = [
  'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'webm', 'mp4', 'aiff', 'aif', 'caf'
];

export const CONVERTER_FORMATS = {
  MP3: { id: 'mp3', name: 'MP3', ext: 'mp3', mime: 'audio/mp3', desc: 'MPEG Audio Layer III (Universal)' },
  WAV: { id: 'wav', name: 'WAV', ext: 'wav', mime: 'audio/wav', desc: 'Lossless PCM Audio (Uncompressed)' },
  M4A: { id: 'm4a', name: 'M4A', ext: 'm4a', mime: 'audio/mp4', desc: 'Advanced Audio Coding (Apple/AAC)' },
  OGG: { id: 'ogg', name: 'OGG', ext: 'ogg', mime: 'audio/ogg', desc: 'Ogg Opus / Open Audio Format' },
  AIFF: { id: 'aiff', name: 'AIFF', ext: 'aiff', mime: 'audio/aiff', desc: 'Apple Interchange File Format' }
};
