// Applies a theme from themes.js to the document and owns the theme picker.
//
// The chosen theme lives in two places on purpose: settings.json is the record
// of truth, but it is read over async IPC, which would mean a frame of the
// wrong colours on every launch. localStorage is synchronous, so it is written
// alongside and read first to paint the right theme immediately.

import { $, escapeHtml, suspendTitlebarDrag } from './state.js';
import {
  DEFAULT_THEME_ID, isSystemTheme, resolveTheme, swatchFor,
  quickSelections, restThemes, themeGroups,
} from '../themes.js';
import { icon } from '../icons.js';

const STORAGE_KEY = 'keep.theme';

// The selection in force. A selection rather than a theme, which means it can
// be 'system'. There used to be a second one alongside it, because hovering the
// picker painted a theme without choosing it and the tick had to stay behind;
// now that nothing changes under a moving pointer, what is on screen and what
// was chosen are the same thing.
let savedId = DEFAULT_THEME_ID;

// What the OS appearance is set to, which only the system selection cares
// about. The media query is the answer at first paint, but it is not always
// the OS's: pointing the window chrome at a dark theme forces the whole app's
// appearance dark, and the query then reports that back to us. So it is only
// trusted while the system selection is the one in charge — the rest of the
// time main hands back the real value, which it can read for the same reason.
let systemDark = readSystemDark();

function readSystemDark() {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; }
}

function setSystemDark(dark) {
  if (typeof dark !== 'boolean' || dark === systemDark) return;
  systemDark = dark;
  if (isSystemTheme(savedId)) applyTheme(savedId);
}

export function currentThemeId() {
  return savedId;
}

// Paints a selection. Nothing else — no persistence, no menu redraw — so the
// OS flipping appearance under the system theme costs a repaint and no more.
export function applyTheme(id) {
  const theme = resolveTheme(id, systemDark);
  // Both halves matter: the same selection can resolve to the other theme when
  // the OS flips underneath it.
  if (id === savedId && document.documentElement.dataset.theme === theme.id) return;
  const root = document.documentElement;
  for (const [token, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(`--${token}`, value);
  }
  // Lets the OS style native widgets (scrollbars, form controls, the window
  // chrome behind the traffic lights) to match.
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
  root.dataset.theme = theme.id;
  savedId = id;
  // The window frame is macOS's, not ours, so it has to be told separately —
  // otherwise a light theme sits inside a dark outline. Sent on preview too:
  // the frame is part of what the theme looks like.
  windowChrome(id);
}

// The two things the main process needs to match the window to the theme.
function chromeOf(id) {
  const theme = resolveTheme(id, systemDark);
  const chrome = { background: theme.tokens['bg'], dark: theme.dark };
  if (isSystemTheme(id)) {
    // In system mode main decides which of the two to use, because at launch
    // it has to colour the window before the renderer exists to say what the
    // OS is set to. So it gets both to choose from.
    chrome.system = true;
    chrome.backgrounds = {
      light: resolveTheme(id, false).tokens['bg'],
      dark: resolveTheme(id, true).tokens['bg'],
    };
  }
  return chrome;
}

function windowChrome(id) {
  let sent;
  try { sent = window.git.setWindowChrome(chromeOf(id)); } catch { return; }
  if (!isSystemTheme(id) || !sent || !sent.then) return;
  // Main replies with the appearance it ended up following. In system mode it
  // has just handed the override back to the OS, so that answer is the OS's.
  sent.then(r => setSystemDark(r && r.dark)).catch(() => {});
}

// Paints a theme and records it as the choice.
function selectTheme(id, { persist = true } = {}) {
  applyTheme(id);
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, savedId); } catch {}
    // The chrome goes to disk alongside the id so the next launch can colour
    // the window before the renderer exists to say what the theme is.
    window.git.saveSettings({ theme: savedId, themeChrome: chromeOf(savedId) });
  }
  renderThemeMenu();
}

// Called before first paint, from the synchronously-available cache.
export function initTheme() {
  let stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch {}
  selectTheme(stored || DEFAULT_THEME_ID, { persist: false });
  watchSystemAppearance();
}

// macOS switches appearance on its own — at sunset, or when the user flips it
// in System Settings — so the system theme has to follow while the app is open.
// Two sources say so: the media query, and main, which notices the same change
// a level down. Either is enough; both are idempotent.
function watchSystemAppearance() {
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (isSystemTheme(savedId)) setSystemDark(e.matches);
    });
  } catch {}
  try { window.git.onSystemTheme((s) => setSystemDark(s && s.dark)); } catch {}
}

// Called once settings.json has been read; only does work if the two disagree.
export function syncThemeFromSettings(settings) {
  const id = settings && settings.theme;
  if (!id || id === savedId) return;
  applyTheme(id);
  try { localStorage.setItem(STORAGE_KEY, savedId); } catch {}
  window.git.saveSettings({ themeChrome: chromeOf(savedId) });
  renderThemeMenu();
}


// ── The popover ──
//
// A short list, not a catalogue: the system entry, a fixed handful of themes,
// the one in force if it is not among them, and a row that opens the gallery.
// Adding a theme to themes.js therefore adds nothing to the toolbar — it lands
// in the gallery, and only ever appears up here while it is the chosen one.

// The gallery row keeps the swatch's shape so the labels line up. What it does
// not keep is a set of borrowed accents: four colours taken from four unrelated
// themes are four colours nobody chose to put together, and it showed. It gets
// a spectrum of the current theme's own semantic colours instead — a palette by
// construction, and painted from tokens in the stylesheet rather than here.
function themeRow(id, name, swatchColours, { checked = false, more = false } = {}) {
  const swatch = more ? '' : swatchColours.map(c => `<i style="background:${c}"></i>`).join('');
  return `
    <div class="theme-item${checked ? ' active' : ''}${more ? ' theme-more' : ''}"
         ${more ? 'data-theme-more' : `data-theme-id="${id}"`}
         role="${more ? 'menuitem' : 'menuitemradio'}"${more ? '' : ` aria-checked="${checked}"`} tabindex="0">
      <span class="theme-swatch" aria-hidden="true">${swatch}</span>
      <span class="theme-name">${escapeHtml(name)}</span>
      <span class="theme-check">${checked ? icon('check', 14) : ''}${more ? icon('chevron', 13) : ''}</span>
    </div>`;
}

function renderThemeMenu() {
  const list = $('#theme-menu-items');
  if (!list) return;
  const rows = quickSelections(savedId)
    .map(t => themeRow(t.id, t.name, swatchFor(t.id), { checked: t.id === savedId }));
  // The row that hands over to the gallery, counting what it holds. Left out
  // entirely when there is nothing more to show.
  const rest = restThemes(savedId);
  if (rest.length) {
    rows.push('<div class="theme-menu-sep"></div>');
    rows.push(themeRow(null, `More themes (${rest.length})`, null, { more: true }));
  }
  list.innerHTML = rows.join('');
}

function openThemeMenu() {
  renderThemeMenu();
  $('#theme-menu').hidden = false;
  $('#btn-theme').classList.add('active');
  suspendTitlebarDrag('theme-menu', true);
}

// Nothing to undo on the way out: a row only ever changes the theme when it is
// clicked, so closing the menu leaves whatever is on screen alone.
function closeThemeMenu() {
  const menu = $('#theme-menu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  $('#btn-theme').classList.remove('active');
  suspendTitlebarDrag('theme-menu', false);
}

// ── The gallery ──
//
// Every theme at once, split into light and dark because that is the half of
// the decision you have already made when you open it. Each card is a small
// mock of the window rather than a strip of colours: a palette only tells you
// what a theme looks like once the colours are in the places they will be in.
//
// Clicking is the try, here as in the popover: nothing repaints under a moving
// pointer, and a click puts the theme on for real. The gallery then stays open
// rather than closing, because picking here is usually picking twice.

function galleryCard(theme) {
  const t = theme.tokens;
  const active = theme.id === savedId;
  const line = (colour, width) => `<i class="theme-mini-line" style="background:${colour};width:${width}"></i>`;
  return `
    <div class="theme-card${active ? ' active' : ''}" data-theme-id="${theme.id}"
         role="menuitemradio" aria-checked="${active}" tabindex="0">
      <div class="theme-mini" style="background:${t['bg']};border-color:${t['border-strong']}" aria-hidden="true">
        <div class="theme-mini-bar" style="background:${t['bg-surface']};border-color:${t['border']}">
          ${line(t['text-dim'], '18px')}
          <i class="theme-mini-pill" style="background:${t['accent']}"></i>
        </div>
        <div class="theme-mini-body">
          <div class="theme-mini-side" style="background:${t['bg-surface']};border-color:${t['border']}">
            ${line(t['text-mute'], '70%')}
            ${line(t['accent'], '55%')}
            ${line(t['text-mute'], '80%')}
            ${line(t['text-mute'], '45%')}
          </div>
          <div class="theme-mini-main">
            ${line(t['text-dim'], '72%')}
            ${line(t['text-mute'], '48%')}
            <div class="theme-mini-diff" style="background:${t['diff-add-bg']}">${line(t['diff-add-text'], '60%')}</div>
            <div class="theme-mini-diff" style="background:${t['diff-del-bg']}">${line(t['diff-del-text'], '44%')}</div>
          </div>
        </div>
      </div>
      <div class="theme-card-label">
        <span class="theme-name">${escapeHtml(theme.name)}</span>
        <span class="theme-check">${active ? icon('check', 14) : ''}</span>
      </div>
    </div>`;
}

// `focusId` puts the keyboard back where it was: picking a theme redraws the
// grid, which throws away the card the user was standing on.
function renderThemeGallery(focusId = null) {
  const body = $('#theme-gallery-body');
  if (!body) return;
  body.innerHTML = themeGroups().map(group => `
    <div class="theme-gallery-group">
      <div class="popover-header">${escapeHtml(group.label)}</div>
      <div class="theme-gallery-grid">${group.themes.map(galleryCard).join('')}</div>
    </div>
  `).join('');
  if (focusId) {
    const card = body.querySelector(`.theme-card[data-theme-id="${focusId}"]`);
    if (card) card.focus();
  }
}

function openThemeGallery() {
  const overlay = $('#theme-gallery');
  if (!overlay) return;
  renderThemeGallery();
  overlay.hidden = false;
  suspendTitlebarDrag('theme-gallery', true);
}

// Nothing to undo on the way out: every theme in here was put on by a click,
// which is a choice rather than a preview. Note the gallery holds no system
// entry — following the OS is a mode, not a palette, so it stays pinned to the
// top of the popover where it is one click away rather than sitting in here
// pretending to be an eighth theme.
function closeThemeGallery() {
  const overlay = $('#theme-gallery');
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  suspendTitlebarDrag('theme-gallery', false);
}

function galleryIsOpen() {
  const overlay = $('#theme-gallery');
  return !!overlay && !overlay.hidden;
}

export function setupThemePicker() {
  const btn = $('#btn-theme');
  const menu = $('#theme-menu');
  if (!btn || !menu) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.hidden) openThemeMenu(); else closeThemeMenu();
  });

  // A row is either a theme, or the one that hands over to the gallery.
  function chooseFromMenu(item) {
    if (item.hasAttribute('data-theme-more')) {
      closeThemeMenu();
      openThemeGallery();
      return;
    }
    selectTheme(item.dataset.themeId);
    closeThemeMenu();
  }

  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = e.target.closest('.theme-item');
    if (item) chooseFromMenu(item);
  });

  menu.addEventListener('keydown', (e) => {
    const item = e.target.closest('.theme-item');
    if (!item) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      chooseFromMenu(item);
    }
  });

  const overlay = $('#theme-gallery');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = e.target.closest('.theme-card');
      if (card) {
        // Redrawn rather than closed: picking here is usually picking twice,
        // and the tick has to move to show the first one landed.
        selectTheme(card.dataset.themeId);
        renderThemeGallery();
        return;
      }
      // A click on the backdrop, or on the close button, is a way out.
      if (e.target === overlay || e.target.closest('#theme-gallery-close')) closeThemeGallery();
    });
    overlay.addEventListener('keydown', (e) => {
      const card = e.target.closest('.theme-card');
      if (!card || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      selectTheme(card.dataset.themeId);
      renderThemeGallery(card.dataset.themeId);
    });
  }

  document.addEventListener('click', closeThemeMenu);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // The gallery sits on top of the menu, so it is what Escape means first.
    if (galleryIsOpen()) closeThemeGallery(); else closeThemeMenu();
  });
}
