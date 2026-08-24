// Applies a theme from themes.js to the document and owns the theme picker.
//
// The chosen theme lives in two places on purpose: settings.json is the record
// of truth, but it is read over async IPC, which would mean a frame of the
// wrong colours on every launch. localStorage is synchronous, so it is written
// alongside and read first to paint the right theme immediately.

import { $, escapeHtml, suspendTitlebarDrag } from './state.js';
import { THEMES, DEFAULT_THEME_ID, resolveTheme, swatch } from '../themes.js';
import { icon } from '../icons.js';

const STORAGE_KEY = 'keep.theme';

// What is on screen, and what the user actually chose. Hovering the picker
// moves the first without touching the second — otherwise the tick would follow
// the pointer and every preview would look like a decision already made.
let currentId = DEFAULT_THEME_ID;
let savedId = DEFAULT_THEME_ID;

export function currentThemeId() {
  return currentId;
}

export function savedThemeId() {
  return savedId;
}

// Paints a theme. Nothing else — no persistence, no menu redraw — so it is
// cheap enough to call on every hover.
export function applyTheme(id) {
  const theme = resolveTheme(id);
  if (theme.id === currentId && document.documentElement.dataset.theme === theme.id) return;
  const root = document.documentElement;
  for (const [token, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(`--${token}`, value);
  }
  // Lets the OS style native widgets (scrollbars, form controls, the window
  // chrome behind the traffic lights) to match.
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
  root.dataset.theme = theme.id;
  currentId = theme.id;
  // The window frame is macOS's, not ours, so it has to be told separately —
  // otherwise a light theme sits inside a dark outline. Sent on preview too:
  // the frame is part of what the theme looks like.
  windowChrome(theme);
}

// The two things the main process needs to match the window to the theme.
function chromeOf(theme) {
  return { background: theme.tokens.bg, dark: theme.dark };
}

function windowChrome(theme) {
  try { window.git.setWindowChrome(chromeOf(theme)); } catch {}
}

// Paints a theme and records it as the choice.
function selectTheme(id, { persist = true } = {}) {
  applyTheme(id);
  savedId = currentId;
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, savedId); } catch {}
    // The chrome goes to disk alongside the id so the next launch can colour
    // the window before the renderer exists to say what the theme is.
    window.git.saveSettings({ theme: savedId, themeChrome: chromeOf(resolveTheme(savedId)) });
  }
  renderThemeMenu();
}

// Called before first paint, from the synchronously-available cache.
export function initTheme() {
  let stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch {}
  selectTheme(stored || DEFAULT_THEME_ID, { persist: false });
}

// Called once settings.json has been read; only does work if the two disagree.
export function syncThemeFromSettings(settings) {
  const id = settings && settings.theme;
  if (!id || id === savedId) return;
  applyTheme(id);
  savedId = currentId;
  try { localStorage.setItem(STORAGE_KEY, savedId); } catch {}
  window.git.saveSettings({ themeChrome: chromeOf(resolveTheme(savedId)) });
  renderThemeMenu();
}

// ── Picker ──

function renderThemeMenu() {
  const list = $('#theme-menu-items');
  if (!list) return;
  list.innerHTML = THEMES.map(t => `
    <div class="theme-item${t.id === savedId ? ' active' : ''}" data-theme-id="${t.id}" role="menuitemradio" aria-checked="${t.id === savedId}" tabindex="0">
      <span class="theme-swatch" aria-hidden="true">
        ${swatch(t).map(c => `<i style="background:${c}"></i>`).join('')}
      </span>
      <span class="theme-name">${escapeHtml(t.name)}</span>
      <span class="theme-check">${t.id === savedId ? icon('check', 14) : ''}</span>
    </div>
  `).join('');
}

function openThemeMenu() {
  renderThemeMenu();
  $('#theme-menu').hidden = false;
  $('#btn-theme').classList.add('active');
  suspendTitlebarDrag('theme-menu', true);
}

// Anything that closes the menu without a click on a row is a cancelled
// preview, so the saved theme goes back up.
function closeThemeMenu() {
  const menu = $('#theme-menu');
  if (!menu || menu.hidden) return;
  applyTheme(savedId);
  menu.hidden = true;
  $('#btn-theme').classList.remove('active');
  suspendTitlebarDrag('theme-menu', false);
}

export function setupThemePicker() {
  const btn = $('#btn-theme');
  const menu = $('#theme-menu');
  if (!btn || !menu) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.hidden) openThemeMenu(); else closeThemeMenu();
  });

  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = e.target.closest('.theme-item');
    if (!item) return;
    selectTheme(item.dataset.themeId);
    menu.hidden = true;
    btn.classList.remove('active');
    suspendTitlebarDrag('theme-menu', false);
  });

  menu.addEventListener('mouseover', (e) => {
    const item = e.target.closest('.theme-item');
    if (item) applyTheme(item.dataset.themeId);
  });

  // Leaving the list is not a choice, so the saved theme comes back.
  menu.addEventListener('mouseleave', () => applyTheme(savedId));

  menu.addEventListener('keydown', (e) => {
    const item = e.target.closest('.theme-item');
    if (!item) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectTheme(item.dataset.themeId);
      menu.hidden = true;
      btn.classList.remove('active');
      suspendTitlebarDrag('theme-menu', false);
    }
  });
  menu.addEventListener('focusin', (e) => {
    const item = e.target.closest('.theme-item');
    if (item) applyTheme(item.dataset.themeId);
  });

  document.addEventListener('click', closeThemeMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeThemeMenu(); });
}
