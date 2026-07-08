#!/usr/bin/env python3
"""Run after any deploy-worthy change, before committing/pushing.

Bumps version.json and every `?v=...` query string on local <script>/<link>
tags in index.html and anime.html, so the cache-check script in each file's
<head> notices the change and the iOS home-screen app (which otherwise
stays suspended between opens instead of re-fetching) picks up fresh files.
"""
import json
import re
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
new_version = time.strftime("%Y-%m-%d-%H%M%S")

(ROOT / "version.json").write_text(json.dumps({"version": new_version}) + "\n")

for name in ["index.html", "anime.html"]:
    path = ROOT / name
    text = path.read_text()
    text, n = re.subn(r'(\.(?:js|css)\?v=)[^"]*(")', rf"\g<1>{new_version}\g<2>", text)
    path.write_text(text)
    print(f"{name}: bumped {n} asset reference(s)")

print(f"version.json -> {new_version}")
