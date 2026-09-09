// The app icon's colour, and the row of them in the theme popover.
//
// Same shape as the theme (modules/theme.js), for the same reason: the choice
// is written to settings.json, which is the record, and to localStorage, which
// is the copy that can be read before the first frame. It is also why the
// colleague you share the app with keeps hers. settings.json lives in the
// user's own data directory, so an install that never opens the picker has no
// entry at all and gets the icon the bundle shipped with.
//
// What can and cannot change is worth being precise about. macOS reads the
// Finder, Spotlight and quit-app icon out of the .icns sealed inside the app
// bundle, which is signed and notarised. Writing a new one in would break the
// signature, so that icon stays indigo whatever is chosen here. What does
// change is app.dock.setIcon, the icon of the running app, which is the one
// that is on screen all day.

import { $ } from './state.js';
import {
  ICON_PALETTES, DEFAULT_ICON_ID, getIconPalette, normalizeIconId, isDefaultIcon,
  drawKeepIcon,
} from '../icon-art.js';

const STORAGE_KEY = 'keep.appIcon';

// What the Dock is handed. Larger than the Dock draws even on a retina display,
// and small enough that redrawing it on every click is not something you can
// feel. The 1024 master is for the .icns, which has print-sized entries to
// fill and all the time in the world to fill them.
const DOCK_SIZE = 512;

// The size of one square in the picker.
const SWATCH_SIZE = 30;

let savedId = DEFAULT_ICON_ID;

export function currentIconId() {
  return savedId;
}

function render(size, palette, scale = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size * scale);
  canvas.height = Math.round(size * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  drawKeepIcon(ctx, size, palette);
  return canvas;
}

// Draws the chosen palette and hands it to main, which is the only side that
// can talk to the Dock. The id travels with the picture so main can tell one
// choice from another without comparing half a megabyte of base64, and so it
// knows when to throw its cached copy away.
function pushToDock(id) {
  const palette = getIconPalette(normalizeIconId(id));
  let png;
  try { png = render(DOCK_SIZE, palette).toDataURL('image/png'); } catch { return; }
  try { window.git.setAppIcon({ id: palette.id, png, isDefault: isDefaultIcon(id) }); } catch {}
}

function selectIcon(id, { persist = true } = {}) {
  savedId = normalizeIconId(id);
  pushToDock(savedId);
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, savedId); } catch {}
    // Null rather than the id when it is the default, so that main has one
    // question to ask at launch (is there a chosen icon?) instead of having to
    // know which of the eight the default is.
    window.git.saveSettings({ appIcon: isDefaultIcon(savedId) ? null : savedId });
  }
  renderIconPicker();
}

// Called before first paint, from the synchronously-available cache. The Dock
// icon is already right by this point, since main set it from its own cached
// copy while the renderer was still starting, so this is the frame that
// confirms it rather than the one that fixes it.
export function initAppIcon() {
  let stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch {}
  selectIcon(stored || DEFAULT_ICON_ID, { persist: false });
}

// Called once settings.json has been read, and only does work if the two stores
// disagree: a launch after the file was edited by hand, or written by another
// window.
export function syncAppIconFromSettings(settings) {
  const id = normalizeIconId(settings && settings.appIcon);
  if (id === savedId) return;
  savedId = id;
  pushToDock(savedId);
  try { localStorage.setItem(STORAGE_KEY, savedId); } catch {}
  renderIconPicker();
}

// ── The picker ──
//
// A grid of the icon itself rather than a row of coloured dots. There are only
// eight, they are the same drawing at 30px that the Dock gets at 512, and the
// thing being chosen is a picture: a swatch would be describing it instead of
// showing it. Which is also why the chosen one is ringed rather than ticked.
// A tick would sit on top of the very picture it is pointing at.
function renderIconPicker() {
  const grid = $('#app-icon-items');
  if (!grid) return;
  const scale = window.devicePixelRatio || 1;
  grid.innerHTML = '';
  for (const palette of ICON_PALETTES) {
    const chosen = palette.id === savedId;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = `app-icon-swatch${chosen ? ' active' : ''}`;
    cell.dataset.iconId = palette.id;
    cell.setAttribute('role', 'radio');
    cell.setAttribute('aria-checked', String(chosen));
    cell.title = palette.name;
    cell.setAttribute('aria-label', palette.name);
    cell.appendChild(render(SWATCH_SIZE, palette, scale));
    grid.appendChild(cell);
  }
}

export function setupAppIconPicker() {
  const grid = $('#app-icon-items');
  if (!grid) return;
  renderIconPicker();
  // The popover stays open on a click. Picking a colour here is usually picking
  // two or three before one of them is right, and the thing you are judging is
  // in the Dock rather than under the pointer, so closing the menu would only
  // mean opening it again.
  grid.addEventListener('click', (e) => {
    const cell = e.target.closest('.app-icon-swatch');
    if (cell) selectIcon(cell.dataset.iconId);
  });
}
