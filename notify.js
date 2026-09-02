// Local notifications, decided at the moment of showing.
//
// Everything Keep has to say already lands somewhere in the window: toasts,
// badges, the build card. While the window is front those are the better
// messengers, closer to the work and in the app's own voice. A notification is
// for what finishes after you have gone somewhere else: a push, a release, a
// build. So the renderer fires unconditionally, and the decision is made here
// against the real focus state, which only the main process can read at the
// moment it matters.
//
// Clicking one asks for the window back, so that is what it does.

const { app, ipcMain, Notification, BrowserWindow } = require('electron');

function anyWindowFocused() {
  return BrowserWindow.getAllWindows().some((win) => !win.isDestroyed() && win.isFocused());
}

function initNotify() {
  // Windows files notifications under an AppUserModelID. The installer stamps
  // the appId on the shortcut; a dev run has no shortcut, so it must be said
  // out loud or nothing shows at all.
  if (process.platform === 'win32') app.setAppUserModelId('com.keep.app');

  ipcMain.handle('notify', (event, payload) => {
    const title = payload ? String(payload.title || '').trim() : '';
    const body = payload ? String(payload.body || '').trim() : '';
    if (!title || !Notification.isSupported()) return false;
    if (anyWindowFocused()) return false;

    const notification = new Notification({ title, body });
    notification.on('click', () => {
      const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getAllWindows()[0];
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });
    notification.show();
    return true;
  });
}

module.exports = { initNotify };
