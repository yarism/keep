const { app, BrowserWindow, ipcMain, dialog, nativeTheme, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const git = require('./git');
const { windowBounds } = require('./window-bounds');
const { initUpdater, checkForUpdates } = require('./updater');
const { buildMenu } = require('./menu');

let mainWindow;
const reposFile = path.join(app.getPath('userData'), 'repositories.json');

function loadRepos() {
  try { return JSON.parse(fs.readFileSync(reposFile, 'utf-8')); }
  catch { return []; }
}

function saveRepos(repos) {
  fs.writeFileSync(reposFile, JSON.stringify(repos, null, 2));
}

app.setName('Keep');

// Override the dock tooltip and icon in dev mode on macOS. Only in dev: the
// bundle being patched is whichever one is running, and when that is the real
// Keep.app the patch points its icon at a keep.icns that packaging never puts
// there — assets/icon.icns is not in the build's file list, so the copy below
// is skipped while the rewritten plist survives, and macOS falls back to the
// generic app icon.
if (process.platform === 'darwin' && !app.isPackaged) {
  const plistPath = path.join(path.dirname(process.execPath), '..', 'Info.plist');
  const resourcesDir = path.join(path.dirname(process.execPath), '..', 'Resources');
  try {
    let plist = fs.readFileSync(plistPath, 'utf-8');
    let changed = false;
    if (plist.includes('<string>Electron</string>')) {
      plist = plist.replace(/<key>CFBundleName<\/key>\s*<string>Electron<\/string>/,
        '<key>CFBundleName</key>\n\t<string>Keep</string>');
      plist = plist.replace(/<key>CFBundleDisplayName<\/key>\s*<string>Electron<\/string>/,
        '<key>CFBundleDisplayName</key>\n\t<string>Keep</string>');
      changed = true;
    }
    if (!plist.includes('<string>keep.icns</string>')) {
      plist = plist.replace(/<key>CFBundleIconFile<\/key>\s*<string>[^<]*<\/string>/,
        '<key>CFBundleIconFile</key>\n\t<string>keep.icns</string>');
      changed = true;
    }
    if (changed) fs.writeFileSync(plistPath, plist);
    // Copy icon into app bundle
    const destIcon = path.join(resourcesDir, 'keep.icns');
    const srcIcon = path.join(__dirname, 'assets', 'icon.icns');
    if (fs.existsSync(srcIcon) && !fs.existsSync(destIcon)) {
      fs.copyFileSync(srcIcon, destIcon);
    }
  } catch {}
}

// The window itself has a colour: the rounded corners, the hairline at the
// edges and the strip behind the traffic lights are drawn by macOS, not by the
// page. Left alone they follow the system appearance, which is what puts a dark
// outline around a light theme. Both are pointed at the theme instead — the
// window's own background at its --bg, and the native appearance at whether the
// theme is dark — so the frame disappears into the app.
//
// The system theme is the exception: there the override is handed back rather
// than forced, since the point is to follow the OS. That is also the only
// state in which shouldUseDarkColors reports what the user set in System
// Settings — while an override is in place it reports the override — so the
// answer is returned to the renderer, which has no other way to ask.
let followingSystem = false;
function applyWindowChrome(win, chrome) {
  // No settings yet means a first launch, and the default is to follow the OS.
  // These two are the Graphite backgrounds; they are only used for the frames
  // before the renderer writes the real ones to settings.
  const c = chrome || { system: true, backgrounds: { light: '#ffffff', dark: '#1b1b1f' } };
  followingSystem = !!c.system;
  nativeTheme.themeSource = c.system ? 'system' : (c.dark ? 'dark' : 'light');
  const dark = c.system ? nativeTheme.shouldUseDarkColors : !!c.dark;
  const background = (c.system && c.backgrounds ? c.backgrounds[dark ? 'dark' : 'light'] : c.background) || '#ffffff';
  if (win && !win.isDestroyed()) win.setBackgroundColor(background);
  return { dark, background };
}

// macOS flips appearance on its own, at sunset or when the user changes it.
// Only worth passing on while the window is following the OS: with a theme
// picked, the change is the override going in, which is our own doing.
function watchSystemAppearance() {
  nativeTheme.on('updated', () => {
    if (!followingSystem || !mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('system-theme', { dark: nativeTheme.shouldUseDarkColors });
  });
}

// Writing on every resize event would hammer the disk while the mouse moves, so
// let the drag settle first. The close handler writes straight away, since there
// may be no later tick to settle into.
let rememberTimer = null;
function rememberWindow(win) {
  if (!win || win.isDestroyed()) return;
  // A maximized window reports the whole screen; getNormalBounds is the shape it
  // returns to, which is the one worth keeping.
  saveSettings({ window: { ...win.getNormalBounds(), maximized: win.isMaximized() } });
}
function scheduleRemember(win) {
  clearTimeout(rememberTimer);
  rememberTimer = setTimeout(() => rememberWindow(win), 400);
}

function createWindow() {
  // Read from settings rather than defaulted, so a dark theme does not launch
  // through one white frame (and a light one through one dark frame).
  const settings = loadSettings();
  const chrome = applyWindowChrome(null, settings.themeChrome);

  // Open on whichever screen the pointer is on — on a desk with two monitors
  // that is the one being looked at.
  const active = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const bounds = windowBounds(
    settings.window,
    active.workArea,
    screen.getAllDisplays().map((d) => d.workArea),
  );

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    ...(Number.isFinite(bounds.x) ? { x: bounds.x, y: bounds.y } : { center: true }),
    minWidth: 900,
    minHeight: 600,
    backgroundColor: chrome.background || '#ffffff',
    titleBarStyle: 'hiddenInset',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (bounds.maximized) mainWindow.maximize();

  mainWindow.on('resize', () => scheduleRemember(mainWindow));
  mainWindow.on('move', () => scheduleRemember(mainWindow));
  mainWindow.on('maximize', () => scheduleRemember(mainWindow));
  mainWindow.on('unmaximize', () => scheduleRemember(mainWindow));
  mainWindow.on('close', () => { clearTimeout(rememberTimer); rememberWindow(mainWindow); });

  mainWindow.webContents.session.clearCache().then(() => {
    mainWindow.loadFile('renderer/index.html');
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    const { nativeImage } = require('electron');
    app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')));
  }
  buildMenu({ checkForUpdates });
  watchSystemAppearance();
  createWindow();
  initUpdater();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── IPC Handlers ──

ipcMain.handle('open-repo', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('load-repos', () => loadRepos());
ipcMain.handle('save-repos', (_, repos) => { saveRepos(repos); return true; });

const settingsFile = path.join(app.getPath('userData'), 'settings.json');
function loadSettings() { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf-8')); } catch { return {}; } }
// Callers send a patch, not the whole settings object — the sidebar saves its
// width and the theme picker saves the theme, and neither knows about the
// other — so merge instead of overwriting.
function saveSettings(patch) {
  const merged = { ...loadSettings(), ...patch };
  fs.writeFileSync(settingsFile, JSON.stringify(merged, null, 2));
  return merged;
}
ipcMain.handle('load-settings', () => loadSettings());
ipcMain.handle('save-settings', (_, s) => { saveSettings(s); return true; });
ipcMain.handle('set-window-chrome', (_, chrome) => applyWindowChrome(mainWindow, chrome));

ipcMain.handle('git-status', (_, repoPath) => git.status(repoPath));
ipcMain.handle('git-log', (_, repoPath, branch, limit, opts) => git.log(repoPath, branch, limit, opts));
ipcMain.handle('git-branches', (_, repoPath) => git.branches(repoPath));
ipcMain.handle('git-unpushed', (_, repoPath, ref, opts) => git.unpushed(repoPath, ref, 500, opts));
ipcMain.handle('git-repo-state', (_, repoPath) => git.repoState(repoPath));
ipcMain.handle('git-mark-resolved', (_, repoPath, filePath) => git.markResolved(repoPath, filePath));
ipcMain.handle('git-use-ours', (_, repoPath, filePath) => git.useOurs(repoPath, filePath));
ipcMain.handle('git-use-theirs', (_, repoPath, filePath) => git.useTheirs(repoPath, filePath));
ipcMain.handle('git-keep-file', (_, repoPath, filePath) => git.keepFile(repoPath, filePath));
ipcMain.handle('git-remove-file', (_, repoPath, filePath) => git.removeFile(repoPath, filePath));
ipcMain.handle('git-file-contents', (_, repoPath, filePath) => git.fileContents(repoPath, filePath));
ipcMain.handle('git-continue-operation', (_, repoPath, kind) => git.continueOperation(repoPath, kind));
ipcMain.handle('git-abort-operation', (_, repoPath, kind) => git.abortOperation(repoPath, kind));
ipcMain.handle('git-repo-fingerprint', (_, repoPath) => git.repoFingerprint(repoPath));
ipcMain.handle('git-is-repo', (_, repoPath) => git.isRepo(repoPath));
ipcMain.handle('git-access-problem', (_, repoPath) => git.accessProblem(repoPath));
ipcMain.handle('git-tags', (_, repoPath) => git.tags(repoPath));
ipcMain.handle('git-remotes', (_, repoPath) => git.remotes(repoPath));
ipcMain.handle('git-stashes', (_, repoPath) => git.stashes(repoPath));
ipcMain.handle('git-diff', async (_, repoPath, filePath, staged) => {
  console.log('[main] git-diff called:', filePath, 'staged:', staged);
  try {
    const result = await git.diff(repoPath, filePath, staged);
    console.log('[main] git-diff result length:', result ? result.length : 0);
    return result;
  } catch (e) {
    console.error('[main] git-diff error:', e.message);
    throw e;
  }
});
ipcMain.handle('git-commit-detail', (_, repoPath, hash) => git.commitDetail(repoPath, hash));
ipcMain.handle('git-commit-diff', (_, repoPath, hash) => git.commitDiff(repoPath, hash));
ipcMain.handle('git-commit-files', (_, repoPath, hash) => git.commitFiles(repoPath, hash));
ipcMain.handle('git-commit-file-diff', (_, repoPath, hash, filePath) => git.commitFileDiff(repoPath, hash, filePath));
ipcMain.handle('git-search-log', (_, repoPath, query, field, branch, limit, opts) => git.searchLog(repoPath, query, field, branch, limit, opts));
ipcMain.handle('git-stage', (_, repoPath, filePath) => git.stage(repoPath, filePath));
ipcMain.handle('git-unstage', (_, repoPath, filePath, oldPath) => git.unstage(repoPath, filePath, oldPath));
ipcMain.handle('git-stage-all', (_, repoPath) => git.stageAll(repoPath));
ipcMain.handle('git-commit', (_, repoPath, message, opts) => git.commit(repoPath, message, opts));
ipcMain.handle('git-head-message', (_, repoPath) => git.headMessage(repoPath));
ipcMain.handle('git-checkout', (_, repoPath, branch) => git.checkout(repoPath, branch));
ipcMain.handle('git-create-branch', (_, repoPath, name, from) => git.createBranch(repoPath, name, from));
ipcMain.handle('git-delete-branch', (_, repoPath, name) => git.deleteBranch(repoPath, name));
ipcMain.handle('git-rename-branch', (_, repoPath, oldName, newName) => git.renameBranch(repoPath, oldName, newName));
ipcMain.handle('git-merge', (_, repoPath, branch) => git.merge(repoPath, branch));
ipcMain.handle('git-rebase', (_, repoPath, branch) => git.rebase(repoPath, branch));
ipcMain.handle('git-pull', (_, repoPath) => git.pull(repoPath));
ipcMain.handle('git-push', (_, repoPath, opts) => git.push(repoPath, opts));
ipcMain.handle('git-fetch', (_, repoPath) => git.fetch(repoPath));
ipcMain.handle('git-fetch-quiet', (_, repoPath) => git.fetchQuiet(repoPath));
ipcMain.handle('git-stash-save', (_, repoPath, message) => git.stashSave(repoPath, message));
ipcMain.handle('git-stash-apply', (_, repoPath, index) => git.stashApply(repoPath, index));
ipcMain.handle('git-stash-drop', (_, repoPath, index) => git.stashDrop(repoPath, index));
ipcMain.handle('git-revert', (_, repoPath, hash) => git.revert(repoPath, hash));
ipcMain.handle('git-cherry-pick', (_, repoPath, hash) => git.cherryPick(repoPath, hash));
ipcMain.handle('git-create-tag', (_, repoPath, name, ref) => git.createTag(repoPath, name, ref));
ipcMain.handle('git-delete-tag', (_, repoPath, name) => git.deleteTag(repoPath, name));
ipcMain.handle('git-stage-hunk', (_, repoPath, filePath, hunkHeader, index) => git.stageHunk(repoPath, filePath, hunkHeader, index));
ipcMain.handle('git-discard-hunk', (_, repoPath, filePath, hunkHeader, index) => git.discardHunk(repoPath, filePath, hunkHeader, index));
ipcMain.handle('git-discard-file', (_, repoPath, filePath) => git.discardFile(repoPath, filePath));
ipcMain.handle('git-trash-file', (_, repoPath, filePath) => git.trashFile(repoPath, filePath));
ipcMain.handle('git-show-in-finder', (_, repoPath, filePath) => git.showInFinder(repoPath, filePath));
