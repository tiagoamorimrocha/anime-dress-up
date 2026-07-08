"""Dev server for the dress-up game.

Serves the project like `python3 -m http.server` but additionally:
- sends no-cache headers (edits show up on plain reload)
- accepts POST /save-manifest from the anime-mode edit mode and writes
  assets/png/manifest.json + manifest.js to disk

Run: python3 tools/dev_server.py [port]
"""
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PNG_DIR = os.path.join(ROOT, "assets", "png")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        if self.path != "/save-manifest":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            manifest = json.loads(self.rfile.read(length))
            with open(os.path.join(PNG_DIR, "manifest.json"), "w") as f:
                json.dump(manifest, f, indent=2)
            with open(os.path.join(PNG_DIR, "manifest.js"), "w") as f:
                f.write(f"window.DOLL_MANIFEST = {json.dumps(manifest, indent=2)};\n")
            self.send_response(204)
            self.end_headers()
            print("manifest saved")
        except Exception as e:  # noqa: BLE001 — report any save failure to the client
            print("save failed:", e)
            self.send_error(500, str(e))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8437
    print(f"serving {ROOT} on http://localhost:{port}")
    ThreadingHTTPServer(("", port), Handler).serve_forever()
