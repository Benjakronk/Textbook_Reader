"""Local development server for Textbook Reader.

Serves static/ as the site root and content/ as /content/. Run `python build.py`
first (or `python build.py --watch` in another terminal). Production deployments
should use any static host pointing at static/ + content/.
"""
from __future__ import annotations

import argparse
import http.server
import os
import socketserver
import webbrowser
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
CONTENT_DIR = ROOT / "content"


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        rel = path.split("?", 1)[0].split("#", 1)[0]
        if rel.startswith("/content/"):
            target = (CONTENT_DIR / rel[len("/content/"):]).resolve()
            try:
                target.relative_to(CONTENT_DIR.resolve())
            except ValueError:
                return str(STATIC_DIR / "404")
            return str(target)
        target = (STATIC_DIR / rel.lstrip("/")).resolve()
        try:
            target.relative_to(STATIC_DIR.resolve())
        except ValueError:
            return str(STATIC_DIR / "404")
        return str(target)

    def end_headers(self):
        # Disable caching during development so reloads always pick up new builds.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main() -> int:
    ap = argparse.ArgumentParser(description="Textbook dev server")
    ap.add_argument("--port", type=int, default=8770)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--no-open", action="store_true")
    args = ap.parse_args()

    os.chdir(ROOT)
    with socketserver.TCPServer((args.host, args.port), Handler) as httpd:
        url = f"http://{args.host}:{args.port}/"
        print(f"Server kjører på {url} — Ctrl+C for å avslutte.")
        if not args.no_open:
            webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nAvsluttet.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
