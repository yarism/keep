const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const git = require('./git');

let mainWindow;
const reposFile = path.join(app.getPath('userData'), 'repositories.json');

function loadRepos() {
  try { return JSON.parse(fs.readFileSync(reposFile, 'utf-8')); }
  catch { return []; }
}

function saveRepos(repos) {
  fs.writeFileSync(reposFile, JSON.stringify(repos, null, 2));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.webContents.session.clearCache().then(() => {
    mainWindow.loadFile('renderer/index.html');
  });
}

app.whenReady().then(createWindow);
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
function saveSettings(s) { fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2)); }
ipcMain.handle('load-settings', () => loadSettings());
ipcMain.handle('save-settings', (_, s) => { saveSettings(s); return true; });

ipcMain.handle('git-status', (_, repoPath) => git.status(repoPath));
ipcMain.handle('git-log', (_, repoPath, branch, limit) => git.log(repoPath, branch, limit));
ipcMain.handle('git-branches', (_, repoPath) => git.branches(repoPath));
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
ipcMain.handle('git-search-log', (_, repoPath, query, field, branch, limit) => git.searchLog(repoPath, query, field, branch, limit));
ipcMain.handle('git-stage', (_, repoPath, filePath) => git.stage(repoPath, filePath));
ipcMain.handle('git-unstage', (_, repoPath, filePath) => git.unstage(repoPath, filePath));
ipcMain.handle('git-stage-all', (_, repoPath) => git.stageAll(repoPath));
ipcMain.handle('git-commit', (_, repoPath, message) => git.commit(repoPath, message));
ipcMain.handle('git-checkout', (_, repoPath, branch) => git.checkout(repoPath, branch));
ipcMain.handle('git-create-branch', (_, repoPath, name, from) => git.createBranch(repoPath, name, from));
ipcMain.handle('git-delete-branch', (_, repoPath, name) => git.deleteBranch(repoPath, name));
ipcMain.handle('git-rename-branch', (_, repoPath, oldName, newName) => git.renameBranch(repoPath, oldName, newName));
ipcMain.handle('git-merge', (_, repoPath, branch) => git.merge(repoPath, branch));
ipcMain.handle('git-rebase', (_, repoPath, branch) => git.rebase(repoPath, branch));
ipcMain.handle('git-pull', (_, repoPath) => git.pull(repoPath));
ipcMain.handle('git-push', (_, repoPath) => git.push(repoPath));
ipcMain.handle('git-fetch', (_, repoPath) => git.fetch(repoPath));
ipcMain.handle('git-stash-save', (_, repoPath, message) => git.stashSave(repoPath, message));
ipcMain.handle('git-stash-apply', (_, repoPath, index) => git.stashApply(repoPath, index));
ipcMain.handle('git-stash-drop', (_, repoPath, index) => git.stashDrop(repoPath, index));
ipcMain.handle('git-revert', (_, repoPath, hash) => git.revert(repoPath, hash));
ipcMain.handle('git-create-tag', (_, repoPath, name, ref) => git.createTag(repoPath, name, ref));
ipcMain.handle('git-stage-hunk', (_, repoPath, filePath, hunkHeader) => git.stageHunk(repoPath, filePath, hunkHeader));
ipcMain.handle('git-discard-hunk', (_, repoPath, filePath, hunkHeader) => git.discardHunk(repoPath, filePath, hunkHeader));
ipcMain.handle('git-discard-file', (_, repoPath, filePath) => git.discardFile(repoPath, filePath));
ipcMain.handle('git-trash-file', (_, repoPath, filePath) => git.trashFile(repoPath, filePath));
ipcMain.handle('git-show-in-finder', (_, repoPath, filePath) => git.showInFinder(repoPath, filePath));
