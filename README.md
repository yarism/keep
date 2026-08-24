# Keep

A Git GUI client inspired by [Tower](https://www.git-tower.com/), built with Electron.

[![Build](https://github.com/yarism/keep/actions/workflows/build.yml/badge.svg)](https://github.com/yarism/keep/actions/workflows/build.yml)

![Working Copy](screenshots/working_copy.png)

![History](screenshots/history.png)

## Download

Always the latest release:

| Platform | |
|---|---|
| [**macOS — Apple Silicon**](https://github.com/yarism/keep/releases/latest/download/Keep-mac-arm64.dmg) | M1 and later |
| [**macOS — Intel**](https://github.com/yarism/keep/releases/latest/download/Keep-mac-x64.dmg) | |
| [**Windows**](https://github.com/yarism/keep/releases/latest/download/Keep-win-x64.exe) | 64-bit installer |

Or browse [all releases](https://github.com/yarism/keep/releases). No Linux
download — build that one.

### Or build it yourself

The macOS builds are signed and notarized. The Windows installer is not, so
SmartScreen warns on first run. To skip that, or to run Keep on Linux, build it:

```bash
git clone https://github.com/yarism/keep.git
cd keep
npm install
npm run dist          # macOS .dmg — or dist:win, or dist:linux
```

The installer lands in `dist/`. A local build has no quarantine flag, so neither
warning appears.

## Features

- Visual working copy with staged/unstaged changes
- Inline diffs with hunk-level staging and discarding
- Commit history browser with a commit graph, full details and changesets
- Local vs remote at a glance — ahead/behind counts on branches and on the
  Pull and Push buttons, and unpushed commits drawn as hollow nodes
- History scoped to one branch or to every branch at once
- Commit subjects and descriptions, amending, and publishing a new branch
- Conflict handling — merge and rebase state, per-file resolution, abort
- Branch management — create, rename, delete, checkout
- Remote branches visible under each remote
- Stash support — save, apply, drop
- Merge, rebase, and revert operations
- Tag creation
- Multi-repository support
- Detached HEAD state handling
- Context menus throughout (right-click on branches, commits, files)
- Six colour themes, switchable from the toolbar
- Progress and results reported for every toolbar command

## Fetching

Keep fetches in the background every ten minutes, so the ahead/behind counts
mean something without you pressing Fetch first. It never touches the working
copy — only the remote-tracking refs — and it runs non-interactively, so a
repository that would ask for a password is skipped rather than left hanging.
The Fetch button's tooltip says when the last one got through.

To change the interval, or switch it off, set `autoFetchMinutes` in
`settings.json` (`0` disables it). The file lives in Electron's user-data
directory — `~/Library/Application Support/Keep` on macOS.

## Themes

Click the palette button at the right of the toolbar to switch themes. Hovering
a theme previews it live without committing to it — the tick stays on the one
you actually chose — and the preview is undone if you leave the list. The choice
is remembered between launches.

| Theme | |
|---|---|
| **Graphite Light** | the default — neutral greys, blue accent |
| **Graphite Dark** | the same palette after dark |
| **Midnight** | Keep's original purple-tinted dark theme |
| **Nord** | cool blue-greys |
| **Ivory** | warm paper, espresso ink, bronze — the restrained one |
| **Synthwave** | deep indigo with magenta and mint — the loud one |

A theme is just a map of CSS custom properties in `renderer/themes.js` — no
colour is written literally in `styles.css`, so adding one means adding an entry
to that file and nothing else. `test/theme.test.mjs` enforces both halves of
that rule.

## Requirements

- [Node.js](https://nodejs.org/) (v18 or later)
- [Git](https://git-scm.com/) installed and available in your PATH

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/yarism/keep.git
cd keep
npm install
```

### 2. Run in development mode

```bash
npm start
```

### 3. Build distributables

```bash
# macOS (.dmg)
npm run dist

# Windows (.exe installer)
npm run dist:win

# Linux (.AppImage)
npm run dist:linux

# All platforms
npm run dist:all
```

Output goes to the `dist/` folder.

## Releasing

One command:

```bash
npm version patch   # 1.0.0 -> 1.0.1  a fix
npm version minor   # 1.0.0 -> 1.1.0  a new feature
npm version major   # 1.0.0 -> 2.0.0  a breaking change
```

Tests run first and abort on failure, then the version is bumped, committed,
tagged and pushed. GitHub Actions builds on macOS and Windows runners and
publishes the release itself, with notes from the commits since the last tag.
Nothing to approve — the links above point at it a few minutes later.

Pushes to `main` build the same installers as workflow
[artifacts](https://github.com/yarism/keep/actions) without releasing them.

### Updating

Installed copies update themselves from those same releases, so a new version
is not a trip back to this page. Keep checks a few seconds after launch and
every six hours it stays open, downloads anything newer in the background, and
puts a strip above the workspace when it is ready: **Restart to Update**.
Ignoring the strip costs nothing — the update installs the next time Keep quits.
**Keep → Check for Updates…** asks on demand, and is the only path that says
anything when the answer is no.

Three things have to be true for that to work, and all three are configured:

- macOS builds a `.zip` as well as the `.dmg`, because Squirrel.Mac — the
  updater underneath — cannot read a DMG. The DMG is still what a first-time
  download gets.
- The release carries `latest-mac.yml` / `latest.yml` next to the installers.
  That file *is* the update feed; without it the app finds a release and
  nothing to compare against. The `.blockmap` beside it is why a patch release
  usually transfers a fraction of the app rather than all 110 MB.
- The two macOS arches are declared per target in `package.json`, never as
  `--arm64 --x64` on the command line. Flags split the build into a run per
  arch, and each run overwrites the previous one's `latest-mac.yml`, leaving a
  feed that names one arch and an updater that finds nothing on the other. The
  release looks complete either way, which is what makes it worth a test.
- macOS refuses to install an update that is not signed by the same Developer
  ID as the running app, so this depends on the certificate below.

Windows updates work the same way but are unsigned, so each one shows a
SmartScreen warning. Releases from v1.0.8 and earlier have no feed file and
cannot be updated from — that generation has to be replaced by hand, once.

### Signing

macOS builds are signed and notarized in CI from five repository secrets:

| Secret | Where it comes from |
|---|---|
| `MAC_CERT_P12` | Developer ID Application certificate, `base64 -i cert.p12` |
| `MAC_CERT_PASSWORD` | the password used to export it |
| `APPLE_ID` | your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | appleid.apple.com → Sign-In and Security |
| `APPLE_TEAM_ID` | developer.apple.com → Membership |

Without `MAC_CERT_P12` a tagged build fails instead of shipping a DMG macOS
refuses to open. Windows installers are still unsigned.

## Installing Without Terminal

### macOS

1. Double-click the `.dmg` to mount it
2. Drag **Keep** into your **Applications** folder
3. Open it — the builds are signed and notarized, so Gatekeeper stays quiet

### Windows

1. Run the `.exe` installer
2. The installer is unsigned, so SmartScreen warns — **More info** → **Run anyway**
3. Follow the setup wizard, then launch Keep from the Start Menu

### Linux

1. Make the `.AppImage` executable: `chmod +x Keep-*.AppImage`
2. Double-click it or run it from the terminal

## Project Structure

```
keep/
├── main.js              # Electron main process
├── preload.js           # IPC bridge between main and renderer
├── git.js               # All git operations (child_process)
├── renderer/
│   ├── index.html       # App shell
│   ├── app.js           # App initialization and navigation
│   ├── styles.css       # All styles (colours come from themes.js)
│   ├── themes.js        # Colour themes as CSS custom property maps
│   ├── icons.js         # The app's icon set
│   ├── git-output.js    # Turns raw git output into a readable line or two
│   └── modules/
│       ├── state.js         # Shared state and DOM helpers
│       ├── working-copy.js  # Working copy / staging view
│       ├── history.js       # Commit history view
│       ├── sidebar.js       # Sidebar (branches, tags, remotes)
│       ├── context-menu.js  # Right-click context menus
│       ├── diff.js          # Diff rendering
│       ├── modal.js         # Modal dialogs
│       ├── theme.js         # Theme switching and the picker
│       ├── toast.js         # Transient status messages
│       └── repos.js         # Repository list management
├── assets/
│   ├── icon.icns        # macOS app icon
│   ├── icon.png         # App icon (1024x1024)
│   └── icon.svg         # Icon source
└── package.json
```

## License

ISC
