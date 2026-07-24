#!/usr/bin/env bash
# Builds the Linux AppImage.
#
# `tauri build --bundles appimage` cannot finish on its own on a current Arch
# system. Both reasons are bugs in linuxdeploy's bundled tooling, not in this
# project:
#
#   1. linuxdeploy ships an old `strip` that cannot read ELF files containing
#      a .relr.dyn section, which is most of a modern distro's libraries.
#      NO_STRIP=1 skips that step.
#   2. linuxdeploy-plugin-gtk copies /usr/lib/gdk-pixbuf-2.0/2.10.0, a
#      directory gdk-pixbuf 2.44 no longer ships. Skipping the plugin means
#      GTK is not bundled and the host's copy is used instead — fine for any
#      machine that runs Steam, but it does make the AppImage less portable
#      than one built on an older distro.
#
# So: let Tauri compile the binary and lay out the AppDir, then run linuxdeploy
# ourselves with those two adjustments.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/tauri"
APPIMAGE_DIR="src-tauri/target/release/bundle/appimage"
VERSION="$(node -p "require('./package.json').version")"
OUTPUT_NAME="zed-launcher_${VERSION}_amd64.AppImage"

# Expected to fail at the linuxdeploy step. Everything before it — the release
# binary, the AppDir, and downloading the linuxdeploy tools — is what we want.
echo "==> Building release binary and AppDir"
npm run tauri build -- --bundles appimage || true

APPDIR="$(find "$APPIMAGE_DIR" -maxdepth 1 -name '*.AppDir' | head -1)"
if [ -z "$APPDIR" ]; then
  echo "error: tauri did not produce an AppDir under $APPIMAGE_DIR" >&2
  exit 1
fi

if [ ! -x "$CACHE/linuxdeploy-x86_64.AppImage" ]; then
  chmod +x "$CACHE"/*.AppImage 2>/dev/null || true
fi
if [ ! -f "$CACHE/linuxdeploy-x86_64.AppImage" ]; then
  echo "error: linuxdeploy was not downloaded to $CACHE" >&2
  exit 1
fi

echo "==> Packing $OUTPUT_NAME"
cd "$ROOT/$APPIMAGE_DIR"
PATH="$CACHE:$PATH" \
OUTPUT="$OUTPUT_NAME" \
APPIMAGE_EXTRACT_AND_RUN=1 \
NO_STRIP=1 \
  "$CACHE/linuxdeploy-x86_64.AppImage" \
    --appdir "$(basename "$APPDIR")" \
    --output appimage

echo
echo "Built $ROOT/$APPIMAGE_DIR/$OUTPUT_NAME"
