// Self-updating, from the same GitHub releases the README points people at.
//
// electron-builder already publishes there, so all that was missing was a
// client. electron-updater reads latest-mac.yml / latest.yml from the newest
// release, compares it against this build's version and downloads the matching
// artifact. Two things it needs that a DMG-only release does not have live
// elsewhere: a .zip target on macOS (Squirrel.Mac cannot read a DMG) in
// package.json, and those .yml files uploaded alongside the installers in the
// release workflow. Without either, this module checks and finds nothing.

const { app, ipcMain, BrowserWindow } = require('electron');

// Keep is a window that stays open for days, so a check that only ran at launch
// would in practice rarely run at all.
const RECHECK_MS = 6 * 60 * 60 * 1000;
// Let the first paint finish before a network call competes with it.
const LAUNCH_DELAY_MS = 4000;

let updater = null;
let manual = false;
let inFlight = false;
let state = { status: 'idle', current: null };

// The renderer subscribes once its modules have loaded, which is after the
// launch check may already have fired. Every state is therefore kept here and
// handed over on request, so a late subscriber still sees where things stand.
function broadcast(patch) {
  state = { status: patch.status, current: app.getVersion(), manual, ...patch };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('update-state', state);
  }
}

// An unpackaged build has no version to compare against and no signature to
// verify, so electron-updater throws rather than returning nothing. Say so
// plainly instead of surfacing that as an error.
function supported() {
  return app.isPackaged;
}

function attach() {
  if (updater) return updater;
  ({ autoUpdater: updater } = require('electron-updater'));

  // Download without asking. The alternative is a prompt for something the
  // answer to is always yes, and the blockmap means a patch release usually
  // transfers a fraction of the full app.
  updater.autoDownload = true;
  // A download nobody clicks Restart on still lands, on the next quit.
  updater.autoInstallOnAppQuit = true;

  updater.on('checking-for-update', () => broadcast({ status: 'checking' }));
  updater.on('update-available', (info) => broadcast({ status: 'available', version: info.version }));
  updater.on('download-progress', (p) => broadcast({
    status: 'downloading',
    version: state.version,
    percent: Math.round(p.percent),
  }));
  updater.on('update-downloaded', (info) => {
    inFlight = false;
    broadcast({ status: 'ready', version: info.version });
  });
  updater.on('update-not-available', () => {
    inFlight = false;
    broadcast({ status: 'current' });
  });
  updater.on('error', (err) => {
    inFlight = false;
    broadcast({ status: 'error', message: String((err && err.message) || err) });
  });

  return updater;
}

async function check({ fromMenu = false } = {}) {
  if (!supported()) {
    manual = fromMenu;
    broadcast({ status: 'unsupported' });
    return state;
  }
  // A second check while the first is still downloading would restart the
  // transfer from zero, and one after it has finished would download the same
  // version again. Either way the answer is already on screen.
  if (inFlight || state.status === 'ready') return state;
  manual = fromMenu;
  inFlight = true;
  try {
    await attach().checkForUpdates();
  } catch (err) {
    // Thrown rather than emitted when the request itself fails — an offline
    // laptop takes this path, and a silent check should stay silent about it.
    inFlight = false;
    broadcast({ status: 'error', message: String((err && err.message) || err) });
  }
  return state;
}

function install() {
  if (state.status !== 'ready') return false;
  // The window's own close handler writes its bounds first, so the size the
  // updated app opens at is the size it was quit at.
  updater.quitAndInstall();
  return true;
}

function initUpdater() {
  ipcMain.handle('update-state', () => state);
  ipcMain.handle('update-check', () => check({ fromMenu: true }));
  ipcMain.handle('update-install', () => install());

  if (!supported()) return;
  setTimeout(() => check(), LAUNCH_DELAY_MS);
  setInterval(() => check(), RECHECK_MS);
}

module.exports = { initUpdater, checkForUpdates: () => check({ fromMenu: true }) };
