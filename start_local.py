#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os, webbrowser, threading

ROOT=Path(__file__).resolve().parent
os.chdir(ROOT)
host="127.0.0.1"; port=8765
url=f"http://{host}:{port}/"
print("My Vocabulary v4")
print(url)
threading.Timer(0.7, lambda: webbrowser.open(url)).start()
ThreadingHTTPServer((host,port),SimpleHTTPRequestHandler).serve_forever()
