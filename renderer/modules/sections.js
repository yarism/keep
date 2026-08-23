// Collapsible sidebar sections.
//
// Every section in the sidebar — Repositories, Workspace, Branches, Tags,
// Remotes — folds away from its own header, and which ones are folded is
// remembered in settings.json so the sidebar comes back the way it was left.

import { $$ } from './state.js';

const SETTING_KEY = 'collapsedSections';

// Section key -> collapsed?. Only `true` entries are meaningful; a section
// missing from the map is open.
let collapsed = {};

function sectionEl(key) {
  return document.querySelector(`.sidebar-section[data-section="${key}"]`);
}

function paint(el, isCollapsed) {
  el.classList.toggle('collapsed', isCollapsed);
  const toggle = el.querySelector('.section-toggle');
  if (!toggle) return;
  toggle.setAttribute('aria-expanded', String(!isCollapsed));
  const arrow = toggle.querySelector('.expand-arrow');
  if (arrow) arrow.classList.toggle('open', !isCollapsed);
}

export function isCollapsed(key) {
  return !!collapsed[key];
}

export function setCollapsed(key, value, { persist = true } = {}) {
  const el = sectionEl(key);
  if (!el) return;
  if (value) collapsed[key] = true;
  else delete collapsed[key];
  paint(el, value);
  if (persist) window.git.saveSettings({ [SETTING_KEY]: { ...collapsed } });
}

// `settings` is the object already loaded at startup, so nothing here waits on
// a second round-trip.
export function setupCollapsibleSections(settings = {}) {
  const stored = settings[SETTING_KEY];
  collapsed = {};
  if (stored && typeof stored === 'object') {
    for (const [key, value] of Object.entries(stored)) {
      if (value) collapsed[key] = true;
    }
  }

  $$('.sidebar-section').forEach(el => {
    const key = el.dataset.section;
    if (!key) return;
    paint(el, !!collapsed[key]);
    const toggle = el.querySelector('.section-toggle');
    if (!toggle) return;
    toggle.addEventListener('click', () => setCollapsed(key, !collapsed[key]));
  });
}
