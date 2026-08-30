#!/usr/bin/env python3
import os
import sys
import base64
import socket
import threading
import http.server
import socketserver
import tkinter as tk
from tkinter import filedialog
import platform
import subprocess
import webview

# Resolve asset path dynamically to support PyInstaller's self-extracting temporary directory (_MEIPASS)
def get_resource_path():
    if hasattr(sys, '_MEIPASS'):
        return getattr(sys, '_MEIPASS')
    return os.path.dirname(os.path.abspath(__file__))

# Find an available port on local interface
def get_free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port

# Silently run Python's built-in HTTP server to serve the front-end assets
def start_server(port, directory):
    class SilentHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, format, *args):
            pass # Suppress standard HTTP request logging in terminal
            
        def translate_path(self, path):
            # Resolve requested paths relative to our assets directory
            path = super().translate_path(path)
            rel = os.path.relpath(path, os.getcwd())
            return os.path.join(directory, rel)

    # Allow port re-use
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", port), SilentHTTPRequestHandler) as httpd:
        httpd.serve_forever()

# JS API Exposed to Webview
class Api:
    def select_folder(self):
        try:
            # Create hidden root window for file dialogue to ensure proper thread integration and window lifting
            root = tk.Tk()
            root.withdraw()
            root.lift()
            root.attributes('-topmost', True)
            
            folder_path = filedialog.askdirectory(title="Select Output Folder")
            root.destroy()
            
            if folder_path:
                return os.path.abspath(folder_path)
            return None
        except Exception as e:
            print(f"Error choosing folder: {e}", file=sys.stderr)
            return None

    def save_slice(self, folder_path, filename, base64_data):
        try:
            if not os.path.exists(folder_path):
                os.makedirs(folder_path, exist_ok=True)
                
            full_path = os.path.join(folder_path, filename)
            file_bytes = base64.b64decode(base64_data)
            
            with open(full_path, "wb") as f:
                f.write(file_bytes)
                
            return {"success": True, "path": full_path}
        except Exception as e:
            print(f"Error saving file {filename}: {e}", file=sys.stderr)
            return {"success": False, "error": str(e)}

    def open_folder(self, path):
        try:
            abs_path = os.path.abspath(path)
            if not os.path.exists(abs_path):
                return False
                
            current_os = platform.system()
            if current_os == "Windows":
                os.startfile(abs_path)
            elif current_os == "Darwin": # macOS
                subprocess.Popen(["open", abs_path])
            else: # Linux
                subprocess.Popen(["xdg-open", abs_path])
            return True
        except Exception as e:
            print(f"Error opening folder {path}: {e}", file=sys.stderr)
            return False

if __name__ == '__main__':
    # Determine directory containing front-end assets (index.html, app.js, style.css, etc.)
    assets_dir = get_resource_path()
    
    # Find free port and boot local HTTP server
    port = get_free_port()
    server_thread = threading.Thread(
        target=start_server, 
        args=(port, assets_dir), 
        daemon=True
    )
    server_thread.start()
    
    # Instantiate Python API and create PyWebView instance
    api = Api()
    
    window = webview.create_window(
        title='Audiocut - Smart Audio Splitter',
        url=f'http://127.0.0.1:{port}',
        js_api=api,
        width=1024,
        height=720,
        resizable=True,
        min_size=(800, 600)
    )
    
    # Boot the Webview event loop (blocks until window is closed)
    webview.start()
