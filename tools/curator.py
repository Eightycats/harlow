#!/usr/bin/env python3
"""Harlow Portfolio Image Curator — entry point.

Starts an HTTP server on port 8888 and opens the browser.
Run from anywhere: python3 tools/curator.py
"""

import os
import sys
import webbrowser
from http.server import HTTPServer
from pathlib import Path

# Ensure tools/ is on the path so api/processor imports work
TOOLS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS_DIR))

# Project root is one level up from tools/
PROJECT_ROOT = TOOLS_DIR.parent

# Check dependencies before importing
_missing = []
for _mod in ["cv2", "numpy", "imagehash", "PIL"]:
    try:
        __import__(_mod)
    except ImportError:
        _missing.append(_mod)
if _missing:
    print(f"Missing dependencies: {', '.join(_missing)}")
    print(f"Install with: pip3 install -r {TOOLS_DIR / 'requirements.txt'}")
    print(f"Or create a venv: python3 -m venv .venv && .venv/bin/pip install -r {TOOLS_DIR / 'requirements.txt'}")
    sys.exit(1)

import api
api.PROJECT_ROOT = str(PROJECT_ROOT)

HOST = "127.0.0.1"
PORT = 8888


def main():
    os.chdir(PROJECT_ROOT)
    print(f"Project root: {PROJECT_ROOT}")
    print(f"Starting curator server on http://{HOST}:{PORT}")

    server = HTTPServer((HOST, PORT), api.CuratorHandler)

    webbrowser.open(f"http://{HOST}:{PORT}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
