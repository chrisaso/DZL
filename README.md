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

## Development

```sh
npm install
npm run tauri dev     # run the app
npm test              # frontend tests
npm run build         # typecheck + production bundle

cd src-tauri
cargo test            # backend tests
cargo clippy --all-targets
```

State lives in the Tauri store (`config.json`) for settings, and in
localStorage for favourites and recently played servers. Mods this launcher
installs are marked with a `.zed-launcher` file so cleanup never touches mods
you subscribed to in Steam.
