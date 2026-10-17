// Collapsible sidebar sections.
//
// Every section in the sidebar (Repositories, Workspace, Branches, Tags,
// Remotes) folds away from its own header, the way Tower's do: the arrow sits
// at the right end of the header and only shows while the pointer is over it,
// and the whole header is the click target. Which ones are folded is
// remembered in settings.json so the sidebar comes back the way it was left.
//
// Folders inside a section (a remote, a group of branches sharing a prefix)
// fold the same way and are remembered in the same map, under a key that is a
// path below the section's own: "branches/feature", "remotes/origin".
//
// Folding slides; styles.css draws that, and what it needs from here is to
// know which lists are opening because someone clicked (see slide()).

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
  if (toggle) toggle.setAttribute('aria-expanded', String(!isCollapsed));
  const arrow = el.querySelector('.section-header > .expand-arrow');
  if (arrow) arrow.classList.toggle('open', !isCollapsed);
}

// At startup a section takes its saved state where it stands rather than
// sliding into it, which it would otherwise do for the one already on screen.
function paintAtRest(el, isCollapsed) {
  const list = el.querySelector('.section-list');
  if (list) list.style.transition = 'none';
  paint(el, isCollapsed);
  if (!list) return;
  void list.offsetHeight;
  list.style.transition = '';
}

function save() {
  window.git.saveSettings({ [SETTING_KEY]: { ...collapsed } });
}

// Folds or opens `owner`, a section or a folder's group, with the slide in
// styles.css. A list that was not drawn at all can only grow from nothing if
// it is marked .opening, which is why only a click goes through here: a folder
// rebuilt by a refresh is made already in its state, and appears in place.
export function slide(owner, folded) {
  owner.classList.toggle('opening', !folded);
  owner.classList.toggle('collapsed', folded);
}

// Once per list: the mark comes off when the list has finished opening, and
// with it the clipping that only the movement needed. Any of the list's own
// transitions will do, since they end together, and an empty list has only
// the fade. Its rows' hover fades bubble up here too, hence the target check.
export function settleWhenOpen(owner, list) {
  list.addEventListener('transitionend', (e) => {
    if (e.target === list) owner.classList.remove('opening');
  });
}

export function isCollapsed(key) {
  return !!collapsed[key];
}

export function setCollapsed(key, value, { persist = true } = {}) {
  const el = sectionEl(key);
  if (!el) return;
  if (value) collapsed[key] = true;
  else delete collapsed[key];
  slide(el, value);
  paint(el, value);
  if (persist) save();
}

// A folder draws itself (sidebar.js rebuilds them on every refresh), so this
// only flips and remembers the state, and says which way it went.
export function toggleFolder(key) {
  const value = !collapsed[key];
  if (value) collapsed[key] = true;
  else delete collapsed[key];
  save();
  return value;
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
    paintAtRest(el, !!collapsed[key]);
    const list = el.querySelector('.section-list');
    if (list) settleWhenOpen(el, list);
    const header = el.querySelector('.section-header');
    if (!header) return;
    // The toggle button's own clicks, keyboard ones included, bubble up here.
    // A "+" in the header does its own thing and leaves the section be.
    header.addEventListener('click', (e) => {
      if (e.target.closest('.sidebar-add-btn')) return;
      setCollapsed(key, !collapsed[key]);
    });
  });
}
