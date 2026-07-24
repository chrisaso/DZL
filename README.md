# ZedLauncher

A GUI DayZ launcher for Linux (and Windows later), built with Tauri, React and
Rust. It does what [dayz-ctl](https://github.com/WoozyMasta/dayz-ctl) does from
the terminal — browse servers, install the mods a server needs, and launch the
game with the right arguments — without the terminal.

## What it does

**Servers**
- Full DZSA server list with a 5 minute cache, filtered by name, mod, map,
  version, official/community, Linux/Windows host, in-game day/night, player
  count, 1PP/3PP, BattlEye, VAC and password
- All / Saved / Recently played views; recently played servers that have gone
  offline are still listed
- Live ping and player counts queried straight from each server's query port
  (A2S), for the rows currently on screen
- Detail panel with per-mod install state, live player count, host country and
  a BattleMetrics link

**Joining**
- Preflight that tells you exactly what is missing before anything happens
- Downloads the mods a server requires through steamcmd, with live progress,
  then symlinks them into the game directory
- Shuts Steam down for the download and restarts it afterwards, because Steam
  and steamcmd fight over the content pipeline
- Password servers, "update every mod first", and closing a running DayZ
- Without steamcmd it falls back to opening the Workshop pages so the Steam
  client installs the mods instead

**Mods**
- Every installed mod with its size, whether the launcher or a Steam
  subscription installed it, and whether its symlink is intact
- Multi-select update and delete, delete only launcher-installed mods, remove
  all symlinks, and relink everything

**Settings**
- System report: Steam, steamcmd, DayZ install and `vm.max_map_count`, with a
  one-click fix for the kernel limit
- Anything unfinished is called out on the page, on the section, and on the
  field itself
- Full launch-option editor (21 DayZ parameters) plus free-form arguments

## Requirements

- Steam with DayZ installed
- `steamcmd` for automatic mod downloads
- `vm.max_map_count` ≥ 1048576 — the launcher offers to set it
- Optional: `geoiplookup` or `whois` for server country lookup

### Steam sign-in

DayZ workshop content **cannot** be downloaded by steamcmd's anonymous login, so
the launcher needs a Steam account name. Your password never touches this app —
sign in to steamcmd once in a terminal and it caches its own login token:

```sh
steamcmd +login your_account_name
```

Then put the account name in Settings and hit **Test login**. If you would
rather not use steamcmd at all, turn it off in Settings and the launcher will
send you to the Steam Workshop to subscribe instead.

## Running it

The release build is a single self-contained binary — the web UI is compiled
into it, so nothing else needs to be running:

```sh
npm run tauri build                              # ~2 min
./src-tauri/target/release/zed-launcher
```

That also writes `.deb` and `.rpm` packages to
`src-tauri/target/release/bundle/`.

For a portable single file:

```sh
npm run build:appimage
./src-tauri/target/release/bundle/appimage/zed-launcher_0.1.0_amd64.AppImage
```

`npm run build:appimage` exists because plain `tauri build --bundles appimage`
fails on current Arch: linuxdeploy's bundled `strip` cannot read libraries with
`.relr.dyn` sections, and its GTK plugin copies a gdk-pixbuf directory that
2.44 no longer ships. The script works around both — see the comments in
`scripts/build-appimage.sh`. The trade-off is that GTK is not bundled, so the
AppImage uses the host's copy. That is fine on any machine that runs Steam,
but it is less portable than an AppImage built on an older distro.

### Desktop entry

To get it in your application menu:

```sh
mkdir -p ~/.local/bin ~/.local/share/applications
cp src-tauri/target/release/bundle/appimage/zed-launcher_0.1.0_amd64.AppImage \
   ~/.local/bin/zed-launcher
chmod +x ~/.local/bin/zed-launcher

cat > ~/.local/share/applications/zed-launcher.desktop <<'EOF'
[Desktop Entry]
Name=ZedLauncher
Comment=DayZ server browser and mod launcher
Exec=/home/YOUR_USER/.local/bin/zed-launcher
Icon=steam_icon_221100
Terminal=false
Type=Application
Categories=Game;
EOF
```

### Wayland

WebKitGTK crashes at startup on a Wayland session
(`Error 71 (Protocol error)`) and renders blank on some GPUs, so the app puts
itself on XWayland and disables the DMA-BUF renderer automatically. Both are
only applied when you have not set `GDK_BACKEND` or
`WEBKIT_DISABLE_DMABUF_RENDERER` yourself, so `GDK_BACKEND=wayland zed-launcher`
still overrides it.

## Development

```sh
npm install
npm run tauri dev     # run the app against the Vite dev server
npm test              # frontend tests
npm run build         # typecheck + production bundle

cd src-tauri
cargo test            # backend tests
cargo clippy --all-targets
```

`bundle.targets` in `src-tauri/tauri.conf.json` is set to `["deb", "rpm"]`
because this is Linux-first; a Windows build will need `nsis`/`msi` added.

State lives in the Tauri store (`config.json`) for settings, and in
localStorage for favourites and recently played servers. Mods this launcher
installs are marked with a `.zed-launcher` file so cleanup never touches mods
you subscribed to in Steam.
