# Keep

A Git GUI client inspired by [Tower](https://www.git-tower.com/), built with Electron.

![Keep](assets/icon.png)

## Features

- Visual working copy with staged/unstaged changes
- Inline diffs with hunk-level staging and discarding
- Commit history browser with full commit details and changesets
- Branch management — create, rename, delete, checkout
- Remote branches visible under each remote
- Stash support — save, apply, drop
- Merge, rebase, and revert operations
- Tag creation
- Multi-repository support
- Detached HEAD state handling
- Context menus throughout (right-click on branches, commits, files)

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

### 3. Build a distributable .dmg (macOS)

```bash
npm run dist
```

The `.dmg` file will be in the `dist/` folder. Open it and drag Keep to your Applications folder — no terminal needed after that.

## Installing Without Terminal

If someone sends you the `.dmg` file:

1. Double-click the `.dmg` to mount it
2. Drag **Keep** into your **Applications** folder
3. Open it from Applications or Spotlight
4. On first launch, macOS may block it since it's unsigned — right-click the app → **Open** → click **Open** in the dialog

## Project Structure

```
keep/
├── main.js              # Electron main process
├── preload.js           # IPC bridge between main and renderer
├── git.js               # All git operations (child_process)
├── renderer/
│   ├── index.html       # App shell
│   ├── app.js           # App initialization and navigation
│   ├── styles.css       # All styles
│   └── modules/
│       ├── state.js         # Shared state and DOM helpers
│       ├── working-copy.js  # Working copy / staging view
│       ├── history.js       # Commit history view
│       ├── sidebar.js       # Sidebar (branches, tags, remotes)
│       ├── context-menu.js  # Right-click context menus
│       ├── diff.js          # Diff rendering
│       ├── modal.js         # Modal dialogs
│       └── repos.js         # Repository list management
├── assets/
│   ├── icon.icns        # macOS app icon
│   ├── icon.png         # App icon (1024x1024)
│   └── icon.svg         # Icon source
└── package.json
```

## License

ISC
