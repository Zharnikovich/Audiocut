# Audiocut - Smart Client-Side Audio Splitter

Audiocut is a beautiful, modern, high-performance **audio splitter** that runs 100% in the browser or as a standalone desktop application. It lets you select an audio file, specify a split duration (e.g., 1 minute, 30 seconds), choose an output directory, and slice the audio into clean, high-quality, lossless 16-bit PCM WAV chunks.

Because it runs entirely client-side using the browser's built-in **Web Audio API**, it handles audio decoding and slicing without needing any server back-end or external heavy binaries (like `ffmpeg`). **Your audio files never leave your computer.**

---

## Features

- **Format Versatility**: Supports MP3, WAV, M4A, FLAC, OGG, and AAC (virtually any format your system browser can play).
- **100% Client-Side**: Slices audio locally in milliseconds. Zero server lag, secure, and privacy-first.
- **Dynamic Previews**: Live updates showing exactly how many slices will be generated before you click Cut.
- **Direct Save (W3C File System Access API)**: Save sliced audio files straight into any local directory in Chrome/Edge.
- **ZIP Download Fallback**: Automatically bundles slices into an uncompressed ZIP archive on Firefox and Safari.
- **Built-in Audio Player**: Listen to and audit sliced fragments individually right inside the output panel before or after saving them.
- **Multi-platform Native App**: Packages into a lightweight standalone Windows `.exe` and macOS `.app`.

---

## Project Structure

```text
Audiocut/
├── index.html        # Front-end UI (built with Tailwind CSS and Lucide Icons)
├── app.js            # Core audio engine (WAV encoder, Web Audio API slicer)
├── app.py            # Desktop application wrapper (Python + PyWebView)
├── requirements.txt  # Python desktop dependencies
└── README.md         # Documentation
```

---

## 🌐 Web App Deployment (GitHub Pages)

Since the frontend is built entirely using standard HTML, CSS, and modern JavaScript, you can host the Web version directly on **GitHub Pages** for free!

### Deploy Steps:
1. Create a new repository on GitHub.
2. Push `index.html` and `app.js` directly to the `main` or `gh-pages` branch.
3. In your repository settings, go to **Pages**.
4. Select **Deploy from a branch** and choose your branch (e.g., `main`), then click **Save**.
5. Your web app will be live at `https://<your-username>.github.io/<your-repo-name>/`!

*Tip: You can also run the web app locally by simply double-clicking the `index.html` file in your browser, or serving it with a simple server:*
```bash
python3 -m http.server 8000
```

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
pyinstaller --onefile --windowed --name "Audiocut" --add-data "index.html:." --add-data "app.js:." app.py
```
This produces:
- `dist/Audiocut.app` (The double-clickable macOS bundle).
- `dist/Audiocut` (The standalone Unix executable).

### 🪟 On Windows (Generates `.exe`)
Open command prompt or PowerShell and run:
```bash
pyinstaller --onefile --windowed --name "Audiocut" --add-data "index.html;." --add-data "app.js;." app.py
```
*(Notice the separator is a semicolon `;` on Windows instead of a colon `:` on macOS)*

This produces:
- `dist/Audiocut.exe` (The standalone double-clickable Windows application).

---

## How the Audio Slicer Engine Works

1. **Decoding**: It uses a standard `FileReader` to load the audio file as an `ArrayBuffer`. This raw buffer is passed to `AudioContext.decodeAudioData()`, which calls the operating system's hardware-accelerated audio codecs to decode the audio into raw PCM Float32 samples (`AudioBuffer`).
2. **Slicing**: For each segment (determined by the split duration), the engine copies the exact segment range of samples into a temporary subarray for each channel.
3. **WAV Encoding**: A custom, lightweight, high-performance WAV Encoder (written in `app.js`) writes a 44-byte standard **WAV RIFF header** (configuring format, sample rate, bit depth, channel count, byte rate, and data size) followed by the Float32 samples clamped and scaled down to **16-bit signed PCM** integers.
4. **Saving**:
   - On Desktop, it sends the byte arrays back to Python as base64 strings to write straight to disk.
   - On Chrome/Edge, it writes them directly to disk using W3C writable file descriptors.
   - On Safari/Firefox, it adds them to a `JSZip` object and triggers a ZIP download of all files.
