#!/usr/bin/env bash
# DZL installer.
#
# Installs the launcher into ~/.local (no root needed): the executable, an
# icon, and a desktop entry so it shows up in your application menu.
# Builds from source first if there is nothing built yet.
#
#   ./scripts/install.sh              install, building if needed
#   ./scripts/install.sh --binary     install the small binary instead of the
#                                     AppImage (uses your system's WebKitGTK)
#   ./scripts/install.sh --no-build   fail rather than build
#   ./scripts/install.sh --uninstall  remove it again
#   ./scripts/install.sh --uninstall --purge   also delete saved settings
#
# PREFIX=/some/where overrides the install location.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREFIX="${PREFIX:-$HOME/.local}"
BIN_DIR="$PREFIX/bin"
DESKTOP_DIR="$PREFIX/share/applications"
ICON_DIR="$PREFIX/share/icons/hicolor"
APP_ID="dzl"
DESKTOP_FILE="$DESKTOP_DIR/$APP_ID.desktop"
CONFIG_DIR="$HOME/.local/share/com.dzl.launcher"

FLAVOUR="appimage"
BUILD=1
UNINSTALL=0
PURGE=0

for arg in "$@"; do
  case "$arg" in
    --binary) FLAVOUR="binary" ;;
    --no-build) BUILD=0 ;;
    --uninstall) UNINSTALL=1 ;;
    --purge) PURGE=1 ;;
    -h|--help) sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1;32m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$1" >&2; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; exit 1; }

refresh_caches() {
  command -v update-desktop-database >/dev/null 2>&1 &&
    update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
  command -v gtk-update-icon-cache >/dev/null 2>&1 &&
    gtk-update-icon-cache -f -t "$ICON_DIR" 2>/dev/null || true
}

if [ "$UNINSTALL" = 1 ]; then
  say "Removing DZL"
  rm -f "$BIN_DIR/$APP_ID" "$DESKTOP_FILE"
  find "$ICON_DIR" -name "$APP_ID.png" -delete 2>/dev/null || true
  refresh_caches

  if [ "$PURGE" = 1 ]; then
    rm -rf "$CONFIG_DIR"
    echo "Removed saved settings from $CONFIG_DIR"
  else
    echo "Settings kept in $CONFIG_DIR (use --purge to remove them)."
  fi
  echo "Installed mods and their symlinks were left alone."
  say "Done"
  exit 0
fi

# --- locate or build the artifact ------------------------------------------

APPIMAGE="$(find "$ROOT/src-tauri/target/release/bundle/appimage" -maxdepth 1 \
  -name '*.AppImage' 2>/dev/null | head -1 || true)"
BINARY="$ROOT/src-tauri/target/release/$APP_ID"

needs_build() {
  if [ "$FLAVOUR" = "appimage" ]; then
    [ -z "$APPIMAGE" ]
  else
    [ ! -x "$BINARY" ]
  fi
}

if needs_build; then
  [ "$BUILD" = 1 ] || die "nothing built yet, and --no-build was given"
  command -v npm >/dev/null 2>&1 || die "npm is required to build (install nodejs)"
  command -v cargo >/dev/null 2>&1 || die "cargo is required to build (install rust)"

  cd "$ROOT"
  [ -d node_modules ] || { say "Installing npm dependencies"; npm install; }

  if [ "$FLAVOUR" = "appimage" ]; then
    say "Building the AppImage (a few minutes on a cold build)"
    npm run build:appimage
    APPIMAGE="$(find "$ROOT/src-tauri/target/release/bundle/appimage" -maxdepth 1 \
      -name '*.AppImage' | head -1)"
  else
    say "Building the release binary"
    npm run tauri build
  fi
fi

if [ "$FLAVOUR" = "appimage" ]; then
  SOURCE="$APPIMAGE"
else
  SOURCE="$BINARY"
fi
[ -f "$SOURCE" ] || die "build finished but $SOURCE is missing"

# --- install ---------------------------------------------------------------

say "Installing to $BIN_DIR/$APP_ID"
mkdir -p "$BIN_DIR" "$DESKTOP_DIR"
install -m 755 "$SOURCE" "$BIN_DIR/$APP_ID"

for size in 32 128; do
  icon="$ROOT/src-tauri/icons/${size}x${size}.png"
  [ -f "$icon" ] || continue
  mkdir -p "$ICON_DIR/${size}x${size}/apps"
  install -m 644 "$icon" "$ICON_DIR/${size}x${size}/apps/$APP_ID.png"
done

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=DZL
GenericName=DayZ Launcher
Comment=Browse DayZ servers, install mods, and launch the game
Exec=$BIN_DIR/$APP_ID
Icon=$APP_ID
Terminal=false
Categories=Game;
Keywords=dayz;steam;server;mods;
StartupWMClass=$APP_ID
EOF
chmod 644 "$DESKTOP_FILE"

refresh_caches

# --- report ----------------------------------------------------------------

say "Installed"
echo "  launcher : $BIN_DIR/$APP_ID"
echo "  entry    : $DESKTOP_FILE"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) warn "$BIN_DIR is not on your PATH — the app menu entry works, but the
           '$APP_ID' command will not until you add it." ;;
esac

command -v steam >/dev/null 2>&1 || warn "Steam was not found on PATH."
if ! command -v steamcmd >/dev/null 2>&1; then
  warn "steamcmd was not found — install it to download mods automatically,
           or turn steamcmd off in Settings and subscribe on the Workshop."
fi

echo
echo "Run it from your application menu, or:  $BIN_DIR/$APP_ID"
echo "First run: set your in-game name and Steam account name in Settings."
