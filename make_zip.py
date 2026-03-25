#!/usr/bin/env python3
"""
Generates bdralph-full.zip at the project root, excluding:
  - node_modules/ (at any level)
  - .git/
  - dist/ and build/
  - .env and variations (.env.local, .env.production, etc.) — preserves .env.example
  - artifacts/ runtime outputs (except task.md and iteration-log)
  - logs/

Run at the project root:
  python3 make_zip.py
"""

import zipfile
import os
from pathlib import Path

ROOT = Path(".").resolve()
OUTPUT = ROOT / "bdralph-full.zip"

PRUNE_DIRS = {"node_modules", ".git", "dist", "build"}
EXCLUDE_DIR_PATHS = {"artifacts/bdralph/traces", "logs"}

def is_env_file(name: str) -> bool:
    if name == ".env":
        return True
    if name.startswith(".env.") and not name.endswith(".example"):
        return True
    return False

files = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in PRUNE_DIRS]

    rel_dir = Path(dirpath).relative_to(ROOT)
    rel_str = str(rel_dir).replace("\\", "/")

    skip = False
    for excl in EXCLUDE_DIR_PATHS:
        if rel_str == excl or rel_str.startswith(excl + "/"):
            skip = True
            break
    if skip:
        dirnames[:] = []
        continue

    for fname in filenames:
        if is_env_file(fname):
            continue
        if fname.endswith('.zip'):
            continue
        files.append(Path(dirpath) / fname)

files = [f for f in files if f != OUTPUT]
files.sort()

print(f"Collected {len(files)} files. Generating zip...")

with zipfile.ZipFile(OUTPUT, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    for path in files:
        rel = path.relative_to(ROOT)
        zf.write(path, Path("bdralph") / rel)

size_mb = OUTPUT.stat().st_size / 1024 / 1024
print(f"✓ {len(files)} files | {size_mb:.1f} MB | {OUTPUT}")
