// The application menu.
//
// Keep drew its own toolbar and let Electron's stock menu stand, which was fine
// until there was something that belongs in a menu and nowhere else: checking
// for updates is not a repository action, so it has no place in the toolbar.
// Everything else here is a stock role, so the menu behaves exactly as it did.

const { app, Menu, shell } = require('electron');

const REPO_URL = 'https://github.com/yarism/keep';

function template(actions) {
  const isMac = process.platform === 'darwin';
  const checkForUpdates = {
    label: 'Check for Updates…',
    click: () => actions.checkForUpdates(),
  };

  return [
    // macOS puts this under the app's own name, where every other Mac app keeps
    // it. Elsewhere there is no such menu, so it goes under Help below.
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        checkForUpdates,
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Keep on GitHub', click: () => shell.openExternal(REPO_URL) },
        ...(isMac ? [] : [{ type: 'separator' }, checkForUpdates]),
      ],
    },
  ];
}

function buildMenu(actions) {
  Menu.setApplicationMenu(Menu.buildFromTemplate(template(actions)));
}

module.exports = { buildMenu };
