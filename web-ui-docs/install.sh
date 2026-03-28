#!/usr/bin/env bash
# install.sh — installs web UI documentation into docs/web-ui/
# Run from the root of the bdralph repo:
#   bash install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="$(pwd)/docs/web-ui"

echo "bdralph — installing web UI docs..."
echo "Target: $TARGET"
echo ""

# Check we're in the right place
if [ ! -f "package.json" ] || ! grep -q "bdralph" package.json 2>/dev/null; then
  echo "ERROR: Run this script from the root of the bdralph repo."
  exit 1
fi

mkdir -p "$TARGET"

# Copy all docs (excluding this script)
for f in "$SCRIPT_DIR"/*.md "$SCRIPT_DIR"/*.html; do
  [ -f "$f" ] || continue
  fname="$(basename "$f")"
  cp "$f" "$TARGET/$fname"
  echo "  copied: docs/web-ui/$fname"
done

echo ""
echo "Done. Files installed in docs/web-ui/"
echo ""
echo "Next step: commit and push"
echo "  git add docs/web-ui/"
echo "  git commit -m 'docs: web UI design reference (mockups + specs)'"
echo "  git push origin HEAD"
