// Applies a theme from themes.js to the document and owns the theme picker.
//
// The chosen theme lives in two places on purpose: settings.json is the record
// of truth, but it is read over async IPC, which would mean a frame of the
// wrong colours on every launch. localStorage is synchronous, so it is written
// alongside and read first to paint the right theme immediately.

import { $, escapeHtml } from './state.js';
import { THEMES, DEFAULT_THEME_ID, resolveTheme, swatch } from '../themes.js';
import { icon } from '../icons.js';

const STORAGE_KEY = 'keep.theme';

let currentId = DEFAULT_THEME_ID;

export function currentThemeId() {
  return currentId;
}

export function applyTheme(id, { persist = false } = {}) {
  const theme = resolveTheme(id);
  const root = document.documentElement;
  for (const [token, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(`--${token}`, value);
  }
  // Lets the OS style native widgets (scrollbars, form controls, the window
  // chrome behind the traffic lights) to match.
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
  root.dataset.theme = theme.id;
  currentId = theme.id;

  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, theme.id); } catch {}
    window.git.saveSettings({ theme: theme.id });
  }
  renderThemeMenu();
}

// Called before first paint, from the synchronously-available cache.
export function initTheme() {
  let stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch {}
  applyTheme(stored || DEFAULT_THEME_ID);
}

// Called once settings.json has been read; only does work if the two disagree.
export function syncThemeFromSettings(settings) {
  const id = settings && settings.theme;
  if (!id || id === currentId) return;
  applyTheme(id);
  try { localStorage.setItem(STORAGE_KEY, currentId); } catch {}
}

// ── Picker ──

// Hovering a row previews it; leaving the menu without picking puts the old
// theme back, so browsing the list costs nothing.
let previewFrom = null;

function renderThemeMenu() {
  const list = $('#theme-menu-items');
  if (!list) return;
  list.innerHTML = THEMES.map(t => `
    <div class="theme-item${t.id === currentId ? ' active' : ''}" data-theme-id="${t.id}" role="menuitemradio" aria-checked="${t.id === currentId}" tabindex="0">
      <span class="theme-swatch" aria-hidden="true">
        ${swatch(t).map(c => `<i style="background:${c}"></i>`).join('')}
      </span>
      <span class="theme-name">${escapeHtml(t.name)}</span>
      <span class="theme-check">${t.id === currentId ? icon('check', 14) : ''}</span>
    </div>
  `).join('');
}

function openThemeMenu() {
  const menu = $('#theme-menu');
  previewFrom = currentId;
  renderThemeMenu();
  menu.hidden = false;
  $('#btn-theme').classList.add('active');
}

function closeThemeMenu({ restore = false } = {}) {
  const menu = $('#theme-menu');
  if (!menu || menu.hidden) return;
  if (restore && previewFrom && previewFrom !== currentId) applyTheme(previewFrom);
  previewFrom = null;
  menu.hidden = true;
  $('#btn-theme').classList.remove('active');
}

export function setupThemePicker() {
  const btn = $('#btn-theme');
  const menu = $('#theme-menu');
  if (!btn || !menu) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.hidden) openThemeMenu(); else closeThemeMenu({ restore: true });
  });

  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = e.target.closest('.theme-item');
    if (!item) return;
    previewFrom = null;
    applyTheme(item.dataset.themeId, { persist: true });
    closeThemeMenu();
  });

  menu.addEventListener('mouseover', (e) => {
    const item = e.target.closest('.theme-item');
    if (item && item.dataset.themeId !== currentId) applyTheme(item.dataset.themeId);
  });

  menu.addEventListener('keydown', (e) => {
    const item = e.target.closest('.theme-item');
    if (!item) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      previewFrom = null;
      applyTheme(item.dataset.themeId, { persist: true });
      closeThemeMenu();
    }
  });

  // Leaving the list restores what was showing before the preview started.
  menu.addEventListener('mouseleave', () => {
    if (previewFrom && previewFrom !== currentId) applyTheme(previewFrom);
  });

  document.addEventListener('click', () => closeThemeMenu({ restore: true }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeThemeMenu({ restore: true });
  });
}
