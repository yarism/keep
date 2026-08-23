// One icon set for the whole app.
//
// Every icon is drawn on the same 24x24 grid with the same stroke weight, cap
// and join, so a row of them lines up optically instead of looking like it was
// assembled from three different libraries. Icons are plain strings of SVG
// children — `icon()` wraps them in the <svg> shell, and colour always comes
// from `currentColor` so themes work without touching this file.
//
// Static markup uses <span class="icon" data-icon="name" data-size="16"></span>
// placeholders, which hydrateIcons() fills in once at startup.

export const STROKE_WIDTH = 1.75;

const PATHS = {
  // ── Files & repositories ──
  folder: '<path d="M3 7.5A2 2 0 0 1 5 5.5h3.6a2 2 0 0 1 1.6.8l1 1.35h7.8a2 2 0 0 1 2 2v8.85a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',

  // The repository list. A drive rather than a globe: a globe is what a remote
  // is, and one glyph cannot mean two things in the same window.
  drive: '<path d="M5.6 5.35 2.75 11.5v5.75a2 2 0 0 0 2 2h14.5a2 2 0 0 0 2-2V11.5l-2.85-6.15a2 2 0 0 0-1.8-1.1H7.4a2 2 0 0 0-1.8 1.1Z"/><path d="M2.75 11.5h18.5"/><path d="M6.4 15.6h.01"/><path d="M9.9 15.6h.01"/>',
  cloud: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10Z"/>',

  // ── Views ──
  clock: '<circle cx="12" cy="12" r="8.25"/><path d="M12 7.25V12l3.1 1.85"/>',

  // ── Remote operations ──
  // Fetch reads as "sync": two arcs chasing each other, like Tower's.
  fetch: '<path d="M19.5 9.5A8 8 0 0 0 5.6 6.9L4 8.5"/><path d="M4.5 14.5a8 8 0 0 0 13.9 2.6l1.6-1.6"/><path d="M4 4.5v4h4"/><path d="M20 19.5v-4h-4"/>',
  pull: '<path d="M12 3.75v11"/><path d="m7.5 10.25 4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>',
  push: '<path d="M12 20.25v-11"/><path d="m7.5 13.75 4.5-4.5 4.5 4.5"/><path d="M5 4.5h14"/>',

  // ── Stashes ──
  stash: '<path d="M9 4.5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-12a2 2 0 0 0-2-2h-2"/><rect x="9" y="2.75" width="6" height="3.5" rx="1.25"/>',
  'stash-save': '<path d="M9 4.5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-12a2 2 0 0 0-2-2h-2"/><rect x="9" y="2.75" width="6" height="3.5" rx="1.25"/><path d="M12 15v-4.75"/><path d="m9.9 12.35 2.1-2.1 2.1 2.1"/>',
  'stash-apply': '<path d="M9 4.5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-12a2 2 0 0 0-2-2h-2"/><rect x="9" y="2.75" width="6" height="3.5" rx="1.25"/><path d="M12 10.25v4.75"/><path d="m9.9 12.9 2.1 2.1 2.1-2.1"/>',

  // ── Branch topology ──
  branch: '<circle cx="7" cy="6" r="2.5"/><circle cx="7" cy="18" r="2.5"/><circle cx="17" cy="6" r="2.5"/><path d="M7 8.5v7"/><path d="M17 8.5v3a6.5 6.5 0 0 1-6.5 6.5H9.5"/>',
  merge: '<circle cx="7" cy="6" r="2.5"/><circle cx="17" cy="18" r="2.5"/><path d="M7 8.5v11.5"/><path d="M7 11.5a6.5 6.5 0 0 0 6.5 6.5h1"/>',
  rebase: '<circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="6" r="2.5"/><path d="M6.5 15.5V4"/><path d="M17.5 8.5v3.5a4 4 0 0 1-4 4h-2.5"/><path d="m13.25 13.75-2.5 2.25 2.5 2.25"/>',
  tag: '<path d="M11.6 3.75H5.25a1.5 1.5 0 0 0-1.5 1.5v6.35c0 .4.16.78.44 1.06l7.6 7.6a1.5 1.5 0 0 0 2.12 0l6.35-6.35a1.5 1.5 0 0 0 0-2.12l-7.6-7.6a1.5 1.5 0 0 0-1.06-.44Z"/><circle cx="8" cy="8" r="1.15"/>',

  // ── Chrome ──
  search: '<circle cx="10.75" cy="10.75" r="6.25"/><path d="m19.5 19.5-4.3-4.3"/>',
  palette: '<path d="M12 3.75a8.25 8.25 0 1 0 0 16.5 1.7 1.7 0 0 0 1.7-1.7c0-.44-.17-.84-.44-1.14a1.7 1.7 0 0 1 1.25-2.85h2A3.75 3.75 0 0 0 20.25 10.8C19.8 6.8 16.3 3.75 12 3.75Z"/><circle cx="8" cy="11.75" r="1.05" fill="currentColor" stroke="none"/><circle cx="11" cy="7.9" r="1.05" fill="currentColor" stroke="none"/><circle cx="15.5" cy="9.4" r="1.05" fill="currentColor" stroke="none"/>',
  check: '<path d="m5.25 12.5 4.5 4.5 9-10"/>',
  chevron: '<path d="m9.75 5.75 6.25 6.25-6.25 6.25"/>',
  plus: '<path d="M12 5.25v13.5"/><path d="M5.25 12h13.5"/>',
  close: '<path d="m6.75 6.75 10.5 10.5"/><path d="m17.25 6.75-10.5 10.5"/>',
  alert: '<circle cx="12" cy="12" r="8.25"/><path d="M12 7.75v4.75"/><path d="M12 15.85h.01"/>',
};

export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(PATHS, name);
}

export function iconNames() {
  return Object.keys(PATHS);
}

// Returns the SVG markup for `name`. Unknown names render nothing rather than
// throwing — a missing icon should not take a panel down with it.
export function icon(name, size = 16, className = '') {
  const body = PATHS[name];
  if (!body) return '';
  const cls = className ? ` ${className}` : '';
  return `<svg class="icon-svg${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"` +
    ` stroke="currentColor" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"` +
    ` aria-hidden="true">${body}</svg>`;
}

// Fills every <span data-icon="..."> under `root` that hasn't been filled yet.
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => {
    if (el.firstElementChild) return;
    const size = parseInt(el.dataset.size, 10) || 16;
    el.innerHTML = icon(el.dataset.icon, size);
  });
}
