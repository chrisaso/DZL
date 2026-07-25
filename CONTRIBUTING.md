# Contributing

Contributions are welcome. This is a small project, so there is no process to
speak of. Fork it, open a pull request, and we will sort out the details there.

## Getting set up

Install the build dependencies for your distro from the
[Build dependencies](README.md#build-dependencies) section of the README, then:

```sh
git clone https://github.com/YOUR-USERNAME/DZL.git && cd DZL
npm install
npm run tauri dev
```

`npm run tauri dev` runs the app against the Vite dev server, so frontend edits
reload as you save. Rust changes need a restart.

Only Arch is verified for building. The dependency lists for Debian, Ubuntu and
Fedora are what the documentation says they should be, not something that has
been run end to end. If one of them is wrong, saying so is itself a useful
contribution.

## Before you open a pull request

Run what CI runs, so you find out locally rather than in the PR:

```sh
npm test                                  # frontend suite
npm run build                             # typecheck, then the production bundle
cd src-tauri
cargo test
cargo clippy --all-targets -- -D warnings
```

Clippy is gated on `-D warnings` because the tree is currently clean, so a new
warning will fail the build. `cargo fmt` is not gated, because the existing
source does not satisfy it and reformatting everything would bury real changes
in noise.
Match the surrounding style instead.

CI runs both suites on every pull request. The first time you contribute, a
maintainer has to approve the workflow run before it starts; that is a GitHub
default for outside contributors, not something you did wrong.

## Testing without DayZ

Most of the app can be exercised without the game installed. The Steam library
path is a setting, so you can point it at a directory you made up:

```sh
S=~/faketest/steamapps
mkdir -p $S/common/DayZ $S/workshop/content/221100/1559212036
printf 'name = "CF";\ntimestamp = 1700000000;\n' > $S/workshop/content/221100/1559212036/meta.cpp
touch $S/workshop/content/221100/1559212036/.dzl
ln -s $S/workshop/content/221100/1559212036 $S/common/DayZ/@1559212036
```

Put that path in **Settings → Steam library** and the Mods tab will treat it as
a real library: the `.dzl` marker is what flags a mod as installed by the
launcher rather than by a Workshop subscription, and the symlink under
`common/DayZ` is what the linked/unlinked state reads.

The server list, its filters, live ping and player counts, the tray and the
system report all work with no Steam or DayZ present at all. What you cannot
test this way is anything past the join button: real steamcmd downloads need a
Steam login, and launching needs the game.

## Branches and commits

Work on a topic branch named for what it does, and write commit subjects in the
imperative with a conventional prefix:

```
feat/server-list-sorting      feat: sort the server list by player count
fix/tray-icon-on-kde          fix: the tray icon vanished on a KDE restart
docs/contributing-guide       docs: add a contributing guide
ci/pull-request-checks        ci: run both test suites on pull requests
chore/bump-tauri              chore: bump Tauri to 2.9
```

One topic per branch. A pull request that fixes a bug and reorganises three
files is hard to review and harder to revert.

## Scope

DZL is Linux-first and that is the priority. A Windows build is plausible, and
`bundle.targets` in `src-tauri/tauri.conf.json` would only need `nsis`/`msi`
adding, but it is a large piece of work touching path handling, process
management and the Steam integration throughout. Open an issue and let us agree on the shape
before writing any of it.

Bug reports are welcome regardless of whether you intend to fix them. Include
your distro, your desktop session (X11 or Wayland), and how you installed DZL;
those three explain most of what goes wrong.

## Layout

```
src/                     React frontend
  components/            UI, including SettingsPage and ModsPage
  pages/                 Launcher and ServerList
  store/                 zustand state
src-tauri/src/
  commands/              the Rust backend, one module per area:
                           a2s        server queries
                           config     settings, persisted in the Tauri store
                           join       preflight, symlinks and launching
                           mods       the installed-mod library
                           steamcmd   downloads
                           system     Steam, DayZ and kernel-limit detection
                           updates    Workshop version checks
  tray_sni.rs            the system tray, a StatusNotifierItem over D-Bus
```

Settings live in the Tauri store (`config.json`); favourites and recently played
servers live in localStorage.

## Licence

By contributing you agree that your work is licensed under the
[MIT Licence](LICENSE), the same as the rest of the project.
