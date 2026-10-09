# Audiocut Studio - Smart Client-Side Audio Suite

Audiocut Studio is a beautiful, modern, high-performance audio suite that runs 100% in the browser or as a standalone desktop application. It lets you slice, trim, merge, convert, and adjust audio tracks, keeping each file's original sample rate.

Because it runs entirely client-side using the browser's built-in **Web Audio API**, it handles audio decoding and manipulation without needing any server back-end or external heavy binaries (like `ffmpeg`). **Your audio files never leave your computer.**

---

## 🧰 Studio Features

- **🔄 Audio Converter**: Batch convert single or multiple audio files between **MP3, WAV, M4A (AAC), OGG (Opus), and AIFF** with custom bitrate (128-320 kbps), bit depth (16/24-bit), channel routing, and sample rate resampling.
- **✂️ Split Audio**: Slice long audio into equal-interval chunks (by minutes or seconds) with live preview and instant ZIP or directory export.
- **⏱️ Trim & Cut**: Precision interactive audio trimmer featuring a real-time **visual sound waveform**, draggable `[S]` start and `[E]` end handles, draggable selection region, live playhead preview, and multi-format export (**MP3, WAV, M4A, OGG, AIFF**).
- **🔗 Merge Audio**: Combine multiple audio tracks sequentially with customizable silence gaps, reordering, and lossless mixing.
- **🔊 Volume & Speed**: Boost gain (up to 300%), peak normalize audio with 1 click, or change speed (0.5x - 2.0x) with real-time preview, either keeping the original pitch (time-stretch) or tape-style.
- **Format Versatility**: Supports MP3, WAV, M4A, FLAC, OGG, and AAC (virtually any format your browser can decode).
- **100% Client-Side & Offline**: Processes audio in memory, entirely on your machine. All libraries are bundled in `vendor/`, so no internet connection is needed.
- **Original Sample Rate**: Files are decoded at their native rate (e.g. 44.1 kHz stays 44.1 kHz). MP3 and M4A exports are resampled only when the encoder cannot handle the rate (e.g. 96 kHz).
- **Direct Save & ZIP Support**: Save directly to disk (Desktop App or Chrome/Edge File System Access API), with automatic ZIP fallback for Safari and Firefox.
- **Multi-platform Desktop App**: Run natively as a standalone desktop window on macOS and Windows powered by `pywebview`.

---

## Project Structure

```text
Audiocut/
├── index.html            # Main UI & layout (Tailwind CSS, Lucide Icons)
├── app.js                # App entry point (initializes modules)
├── js/
│   ├── constants.js      # App constants & supported audio formats
│   ├── components/
│   │   └── navigation.js # Sidebar navigation & global audio coordinator
│   ├── services/
│   │   └── storage.js    # Desktop & browser storage, FileSystem API, ZIP
│   ├── utils/
│   │   ├── formatters.js # Time, bytes, base64, HTML-escaping utilities
│   │   ├── audio-decode.js# Native sample-rate decoding (header sniffing)
│   │   ├── audio-buffer.js# Slicing, resampling, split segmentation helpers
│   │   ├── time-stretch.js# Pitch-preserving tempo change (WSOLA)
│   │   ├── wav-encoder.js# Lossless 16/24-bit PCM WAV audio encoder
│   │   ├── aiff-encoder.js# Apple AIFF PCM audio encoder
│   │   ├── mp3-encoder.js# LAME pure-JS MP3 encoder
│   │   ├── m4a-encoder.js# AAC M4A encoder (WebCodecs & MP4Muxer)
│   │   └── ogg-encoder.js# OGG Opus audio encoder
│   └── modules/
│       ├── converter.js  # Batch multi-format converter workflow
│       ├── splitter.js   # Interval audio splitting workflow
│       ├── trimmer.js    # Precision start/end range audio trimmer
│       ├── merger.js     # Sequential track joiner & mixer
│       └── effects.js    # Volume gain booster & tempo adjuster
├── vendor/               # Pinned third-party libraries (Tailwind, Lucide, JSZip, LAME, MP4 muxer)
├── tests/                # Browser unit tests: serve the project and open /tests/
├── app.py                # Desktop application wrapper (Python + PyWebView)
├── requirements.txt      # Python desktop dependencies
└── README.md             # Documentation
```

---

## 🌐 Web App Deployment (GitHub Pages)

Since the frontend is built entirely using standard HTML, CSS, and modern JavaScript, you can host the Web version directly on **GitHub Pages** for free!

### Deploy Steps:
1. Create a new repository on GitHub.
2. Push `index.html`, `app.js` **and the `js/` and `vendor/` folders** to the `main` or `gh-pages` branch (the app is split into ES modules under `js/` and loads its libraries from `vendor/`; it will not work without them).
3. In your repository settings, go to **Pages**.
4. Select **Deploy from a branch** and choose your branch (e.g., `main`), then click **Save**.
5. Your web app will be live at `https://<your-username>.github.io/<your-repo-name>/`!

*To run the web app locally, serve the project folder over HTTP and open http://localhost:8000. Opening `index.html` directly (double-clicking, `file://`) does not work, because browsers block ES modules on `file://` pages:*
```bash
python3 -m http.server 8000
```

To run the unit tests, start the same server and open http://localhost:8000/tests/.

---

## 💻 Desktop App (Windows & macOS)

The desktop version runs the exact same front-end inside a lightweight native webview wrapper powered by Python's `pywebview`. It allows selecting native output folders on Windows/Mac and writing files directly to your hard drive.

### Local Installation & Running:
Ensure you have Python 3 installed. Then, open your terminal/command prompt and run:

1. **Install Dependencies**:
   ```bash
   pip3 install -r requirements.txt
   ```
2. **Launch the Desktop App**:
   ```bash
   python3 app.py
   ```

---

## 🛠 Compiling standalone `.exe` or `.app`

You can compile `app.py` and its assets into a single standalone executable using **PyInstaller**. This bundles the Python environment, dependencies, and frontend assets into a single double-clickable file.

### 🍎 On macOS (Generates `.app` and Unix Executable)
In your terminal, run:
```bash
pyinstaller --onefile --windowed --name "Audiocut" --add-data "index.html:." --add-data "app.js:." --add-data "js:js" --add-data "vendor:vendor" app.py
```
This produces:
- `dist/Audiocut.app` (The double-clickable macOS bundle).
- `dist/Audiocut` (The standalone Unix executable).

### 🪟 On Windows (Generates `.exe`)
Open command prompt or PowerShell and run:
```bash
pyinstaller --onefile --windowed --name "Audiocut" --add-data "index.html;." --add-data "app.js;." --add-data "js;js" --add-data "vendor;vendor" app.py
```
*(Notice the separator is a semicolon `;` on Windows instead of a colon `:` on macOS)*

This produces:
- `dist/Audiocut.exe` (The standalone double-clickable Windows application).

---

## How the Audio Slicer Engine Works

1. **Decoding**: The file is read as an `ArrayBuffer`, and its real sample rate is read from the header (WAV, AIFF, FLAC, MP3, Ogg, AAC/M4A). It is then decoded with an `OfflineAudioContext` at that rate, because `decodeAudioData()` resamples everything to the rate of the context it runs on. Unknown formats fall back to the browser's default rate.
2. **Slicing**: Slice boundaries are computed in whole samples, so consecutive slices never overlap or skip samples, and each slice's samples are copied out of the decoded buffer.
3. **WAV Encoding**: A custom, lightweight, high-performance WAV Encoder (`js/utils/wav-encoder.js`) writes a 44-byte standard **WAV RIFF header** (configuring format, sample rate, bit depth, channel count, byte rate, and data size) followed by the Float32 samples clamped and scaled down to **16-bit signed PCM** integers.
4. **Saving**:
   - On Desktop, it sends the byte arrays back to Python as base64 strings to write straight to disk.
   - On Chrome/Edge, it writes them directly to the chosen folder using the File System Access API (or offers a ZIP download if no folder is picked).
   - On Safari/Firefox, it adds them to a `JSZip` object and triggers a ZIP download of all files.
