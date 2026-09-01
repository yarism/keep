// Colour themes.
//
// A theme is nothing but a map of CSS custom properties, applied to
// <html> by renderer/modules/theme.js. styles.css never hard-codes a colour —
// it only ever reads these tokens — so adding a theme means adding an entry
// here and nothing else.
//
// This module is deliberately free of DOM access so it stays unit-testable.

// Every token a theme must define. A theme missing one would silently fall back
// to whatever :root has, which is how a light theme ends up with one stray dark
// panel, so validateTheme() is used by the tests to keep the set complete.
export const TOKENS = [
  // surfaces, back to front
  'bg', 'bg-surface', 'bg-elevated', 'bg-hover', 'bg-active',
  // lines
  'border', 'border-strong',
  // type
  'text', 'text-dim', 'text-mute',
  // the one colour that carries emphasis, and what stays legible on top of it
  'accent', 'accent-hover', 'on-accent',
  // semantic colours, plus the text colour that survives sitting on them
  'green', 'red', 'yellow', 'blue', 'on-status',
  // diffs
  'diff-add-bg', 'diff-add-text', 'diff-del-bg', 'diff-del-text',
  'diff-hunk-bg', 'diff-hunk-text',
  // chrome
  'shadow-menu', 'shadow-modal', 'scrollbar', 'overlay',
];

export const THEMES = [
  {
    id: 'graphite-light',
    name: 'Graphite Light',
    dark: false,
    tokens: {
      'bg': '#ffffff',
      'bg-surface': '#f1f1f4',
      'bg-elevated': '#ffffff',
      'bg-hover': '#e7e7ec',
      'bg-active': '#dadae2',
      'border': '#e0e0e6',
      'border-strong': '#c6c6cf',
      'text': '#1c1c22',
      'text-dim': '#6a6a76',
      'text-mute': '#9494a0',
      'accent': '#2f6fe4',
      'accent-hover': '#2560cd',
      'on-accent': '#ffffff',
      'green': '#2f9e44',
      'red': '#d13d4b',
      'yellow': '#bd8500',
      'blue': '#2f6fe4',
      'on-status': '#ffffff',
      'diff-add-bg': '#e7f7ec',
      'diff-add-text': '#14682f',
      'diff-del-bg': '#fdeaed',
      'diff-del-text': '#a3212f',
      'diff-hunk-bg': '#eef2fa',
      'diff-hunk-text': '#2f6fe4',
      'shadow-menu': '0 10px 28px rgba(22, 22, 34, 0.14)',
      'shadow-modal': '0 20px 50px rgba(22, 22, 34, 0.22)',
      'scrollbar': '#cdcdd6',
      'overlay': 'rgba(28, 28, 34, 0.28)',
    },
  },
  {
    id: 'graphite-dark',
    name: 'Graphite Dark',
    dark: true,
    tokens: {
      'bg': '#1b1b1f',
      'bg-surface': '#232328',
      'bg-elevated': '#2a2a30',
      'bg-hover': '#2e2e35',
      'bg-active': '#3a3a44',
      'border': '#32323a',
      'border-strong': '#45454f',
      'text': '#e6e6ec',
      'text-dim': '#9797a3',
      'text-mute': '#71717c',
      'accent': '#5b93ff',
      'accent-hover': '#7aa8ff',
      'on-accent': '#0e1119',
      'green': '#7bd88f',
      'red': '#ff6b7f',
      'yellow': '#e7c46b',
      'blue': '#5b93ff',
      'on-status': '#14161c',
      'diff-add-bg': 'rgba(123, 216, 143, 0.13)',
      'diff-add-text': '#9de5ac',
      'diff-del-bg': 'rgba(255, 107, 127, 0.13)',
      'diff-del-text': '#ffa2af',
      'diff-hunk-bg': 'rgba(91, 147, 255, 0.12)',
      'diff-hunk-text': '#8db2ff',
      'shadow-menu': '0 10px 28px rgba(0, 0, 0, 0.45)',
      'shadow-modal': '0 20px 50px rgba(0, 0, 0, 0.55)',
      'scrollbar': '#3d3d47',
      'overlay': 'rgba(0, 0, 0, 0.5)',
    },
  },
  {
    // Claude Code's own dark palette: warm near-black neutrals that read as
    // grey until you put a real grey next to them, clay for anything you can
    // click, and diff colours bright enough to find at a glance against it.
    id: 'claude',
    name: 'Claude',
    dark: true,
    tokens: {
      'bg': '#0f0f0e',
      'bg-surface': '#161615',
      'bg-elevated': '#1c1b1a',
      'bg-hover': '#222120',
      'bg-active': '#2e2c28',
      'border': '#232220',
      'border-strong': '#38352f',
      'text': '#f5f4ef',
      'text-dim': '#a8a49b',
      'text-mute': '#7d7973',
      'accent': '#d97757',
      'accent-hover': '#e89075',
      'on-accent': '#0f0f0e',
      'green': '#4ec97a',
      'red': '#f4696d',
      'yellow': '#e5b84b',
      'blue': '#6fa8d6',
      'on-status': '#0f0f0e',
      'diff-add-bg': 'rgba(78, 201, 122, 0.14)',
      'diff-add-text': '#6fdb96',
      'diff-del-bg': 'rgba(244, 105, 109, 0.14)',
      'diff-del-text': '#ff8c8f',
      'diff-hunk-bg': 'rgba(217, 119, 87, 0.13)',
      'diff-hunk-text': '#e59a7d',
      'shadow-menu': '0 10px 28px rgba(0, 0, 0, 0.6)',
      'shadow-modal': '0 20px 50px rgba(0, 0, 0, 0.7)',
      'scrollbar': '#38352f',
      'overlay': 'rgba(0, 0, 0, 0.65)',
    },
  },
  {
    // The warm dark one: charcoal that has been left near a fire. Everything
    // sits on the orange side of neutral, so the amber accent reads as part of
    // the surface rather than a sticker on top of it.
    id: 'ember',
    name: 'Ember',
    dark: true,
    tokens: {
      'bg': '#1a1614',
      'bg-surface': '#221d1a',
      'bg-elevated': '#2a2320',
      'bg-hover': '#2f2825',
      'bg-active': '#3c322d',
      'border': '#332b27',
      'border-strong': '#4a3e37',
      'text': '#f0e6df',
      'text-dim': '#a89a90',
      'text-mute': '#7f736b',
      'accent': '#e08a4c',
      'accent-hover': '#f0a066',
      'on-accent': '#1a1614',
      'green': '#8ec07c',
      'red': '#f07a6a',
      'yellow': '#e8c06a',
      'blue': '#7fb0c8',
      'on-status': '#1a1614',
      'diff-add-bg': 'rgba(142, 192, 124, 0.13)',
      'diff-add-text': '#a9d197',
      'diff-del-bg': 'rgba(240, 122, 106, 0.13)',
      'diff-del-text': '#f5a396',
      'diff-hunk-bg': 'rgba(224, 138, 76, 0.12)',
      'diff-hunk-text': '#eda971',
      'shadow-menu': '0 10px 28px rgba(12, 7, 4, 0.5)',
      'shadow-modal': '0 20px 50px rgba(12, 7, 4, 0.6)',
      'scrollbar': '#4a3e37',
      'overlay': 'rgba(14, 9, 7, 0.55)',
    },
  },
  {
    // The cool light one: grey with a green cast, like paper in a room full of
    // plants. Deep teal does the pointing, which keeps it out of the way of the
    // green a diff needs.
    //
    // The diff inks run darker here than in the other light themes, because
    // this theme's added text sits on a tint of its own hue: green on green
    // washes out at a lightness that would read fine on neutral paper, and a
    // long all-added file is a page of exactly that.
    id: 'sage',
    name: 'Sage',
    dark: false,
    tokens: {
      'bg': '#fbfcfa',
      'bg-surface': '#eef1ec',
      'bg-elevated': '#ffffff',
      'bg-hover': '#e4e9e2',
      'bg-active': '#d5ddd2',
      'border': '#e0e6de',
      'border-strong': '#c2ccbf',
      'text': '#121a14',
      'text-dim': '#5e6b62',
      'text-mute': '#8b978f',
      'accent': '#2f7d6a',
      'accent-hover': '#266657',
      'on-accent': '#ffffff',
      'green': '#37793f',
      'red': '#b4433f',
      'yellow': '#9a7519',
      'blue': '#33648f',
      'on-status': '#ffffff',
      'diff-add-bg': '#e8f2e6',
      'diff-add-text': '#0d240f',
      'diff-del-bg': '#f8eae8',
      'diff-del-text': '#3a100e',
      'diff-hunk-bg': '#e7f0ee',
      'diff-hunk-text': '#26685a',
      'shadow-menu': '0 10px 28px rgba(32, 45, 38, 0.14)',
      'shadow-modal': '0 20px 50px rgba(32, 45, 38, 0.22)',
      'scrollbar': '#c7d0c4',
      'overlay': 'rgba(28, 38, 32, 0.28)',
    },
  },
  {
    // The restrained one: warm paper, espresso ink, bronze for anything you can
    // click. Nothing in it is fully saturated.
    id: 'ivory',
    name: 'Ivory',
    dark: false,
    tokens: {
      'bg': '#fffdf9',
      'bg-surface': '#f3efe6',
      'bg-elevated': '#fffdf9',
      'bg-hover': '#eae3d6',
      'bg-active': '#ddd4c2',
      'border': '#e7e0d2',
      'border-strong': '#cdc4b0',
      'text': '#2b2620',
      'text-dim': '#6c6255',
      'text-mute': '#9a9083',
      'accent': '#9c6634',
      'accent-hover': '#84542a',
      'on-accent': '#fffdf9',
      'green': '#4b7a45',
      'red': '#a8443c',
      'yellow': '#a97f2a',
      'blue': '#456b8c',
      'on-status': '#fffdf9',
      'diff-add-bg': '#ecf2e7',
      'diff-add-text': '#3a5c34',
      'diff-del-bg': '#f9eae7',
      'diff-del-text': '#8d342b',
      'diff-hunk-bg': '#f4ede1',
      'diff-hunk-text': '#8a5c2c',
      'shadow-menu': '0 10px 28px rgba(74, 60, 38, 0.16)',
      'shadow-modal': '0 20px 50px rgba(74, 60, 38, 0.24)',
      'scrollbar': '#d9d0be',
      'overlay': 'rgba(62, 52, 36, 0.28)',
    },
  },
  {
    // The loud one. Saturation is spent on the accents and the diff, never on
    // the surfaces, or a day of reading it would be unbearable.
    id: 'synthwave',
    name: 'Synthwave',
    dark: true,
    tokens: {
      'bg': '#16132b',
      'bg-surface': '#1e1a3b',
      'bg-elevated': '#252048',
      'bg-hover': '#2c2555',
      'bg-active': '#3a3072',
      'border': '#2f2860',
      'border-strong': '#463b88',
      'text': '#ece7ff',
      'text-dim': '#a99fd8',
      'text-mute': '#7f75b2',
      'accent': '#ff5fd2',
      'accent-hover': '#ff86de',
      'on-accent': '#16132b',
      'green': '#4ef2c0',
      'red': '#ff5e7a',
      'yellow': '#ffd75f',
      'blue': '#5fd0ff',
      'on-status': '#16132b',
      'diff-add-bg': 'rgba(78, 242, 192, 0.13)',
      'diff-add-text': '#7df5d0',
      'diff-del-bg': 'rgba(255, 94, 122, 0.14)',
      'diff-del-text': '#ff93a6',
      'diff-hunk-bg': 'rgba(95, 208, 255, 0.13)',
      'diff-hunk-text': '#82d8ff',
      'shadow-menu': '0 10px 28px rgba(8, 4, 30, 0.6)',
      'shadow-modal': '0 20px 50px rgba(8, 4, 30, 0.7)',
      'scrollbar': '#463b88',
      'overlay': 'rgba(9, 5, 28, 0.6)',
    },
  },
];

// Not a theme but a selection: it follows the operating system's appearance,
// switching between the two Graphite themes. It has no tokens of its own, so
// everything downstream of resolveTheme() still deals in real themes only.
export const SYSTEM_THEME_ID = 'system';

// The pair the system theme switches between.
export const SYSTEM_PAIR = { light: 'graphite-light', dark: 'graphite-dark' };

export const DEFAULT_THEME_ID = SYSTEM_THEME_ID;

// What the picker lists: the system entry first, then the themes themselves.
export const SELECTIONS = [
  { id: SYSTEM_THEME_ID, name: 'System' },
  ...THEMES.map(t => ({ id: t.id, name: t.name })),
];

export function isSystemTheme(id) {
  return id === SYSTEM_THEME_ID;
}

export function getTheme(id) {
  return THEMES.find(t => t.id === id) || null;
}

// Turns a selection into the theme to paint. `prefersDark` is what the OS is
// set to, and only matters for the system selection. Falls back to the default
// rather than leaving the app unstyled when settings name a theme that no
// longer exists.
export function resolveTheme(id, prefersDark = false) {
  if (isSystemTheme(id)) return getTheme(prefersDark ? SYSTEM_PAIR.dark : SYSTEM_PAIR.light);
  return getTheme(id) || resolveTheme(DEFAULT_THEME_ID, prefersDark);
}

// The four colours the picker shows as a preview of a theme.
export function swatch(theme) {
  return [theme.tokens['bg'], theme.tokens['bg-surface'], theme.tokens['accent'], theme.tokens['green']];
}

// The same preview, for a selection rather than a theme. The system entry gets
// half of each side of the pair, so it reads as "either" instead of as a
// sixth palette.
export function swatchFor(id) {
  if (!isSystemTheme(id)) return swatch(resolveTheme(id));
  const light = getTheme(SYSTEM_PAIR.light).tokens;
  const dark = getTheme(SYSTEM_PAIR.dark).tokens;
  return [light['bg'], light['accent'], dark['bg'], dark['accent']];
}

// Returns the token names a theme is missing or defines but shouldn't.
export function validateTheme(theme) {
  const defined = Object.keys(theme.tokens);
  return {
    missing: TOKENS.filter(t => !defined.includes(t)),
    extra: defined.filter(t => !TOKENS.includes(t)),
  };
}

// ── What the picker shows ──

// The themes the popover lists when nothing has been pinned: the two Graphite
// themes the system entry switches between, then one dark and one light with a
// character of their own.
//
// A default rather than a fixed set, because which four you want up there is
// exactly the sort of thing only you know. What it is not is a most-recently-
// used list: rows that reorder as you use them put something else under the
// pointer each time, and a theme you like gets pushed off by one you were only
// trying. The popover is a place you reach for without looking, so it only
// moves when you move it.
//
// Ordering THEMES itself would do the same job for the default, but that order
// is the gallery's, and the gallery is grouped by light and dark — the two
// lists want different things.
export const DEFAULT_PINS = ['graphite-light', 'graphite-dark', 'claude', 'sage'];

// How many will fit up there. A limit rather than a scrolling list, because the
// popover's whole job is to be shorter than the gallery — pin everything and
// you have built a second gallery on the toolbar, one you have to read rather
// than aim at. Four, which is five rows with the system entry above them: a
// menu you can take in without moving your eyes.
//
// It is also exactly what a fresh install has pinned, so the popover never
// grows: pinning a fifth theme means giving up one of the four, which is the
// trade the toolbar is making anyway.
export const MAX_PINS = 4;

// Pins are stored as a list of ids, which can arrive from settings.json stale,
// duplicated or in any order. This is the only door into the rest of the
// module: unknown ids are dropped rather than rendered as a hole, duplicates
// collapse, and the order becomes the declared one so the popover reads the
// same way whichever order they were pinned in.
export function normalizePins(pins) {
  if (!Array.isArray(pins)) return [...DEFAULT_PINS];
  const wanted = new Set(pins.filter(id => getTheme(id)));
  // Trimmed as well as cleaned: a hand-edited settings file can name more than
  // fit, and the popover has to stay the length it promises.
  return THEMES.filter(t => wanted.has(t.id)).map(t => t.id).slice(0, MAX_PINS);
}

export function pinsAreFull(pins) {
  return normalizePins(pins).length >= MAX_PINS;
}

export function isPinned(pins, id) {
  return normalizePins(pins).includes(id);
}

// Pinning and unpinning are the same gesture, so they are the same function.
// Returns a new list; the caller decides whether it is worth persisting.
export function togglePin(pins, id) {
  const current = normalizePins(pins);
  if (!getTheme(id)) return current;
  if (current.includes(id)) return current.filter(x => x !== id);
  // At the limit the pin does nothing rather than quietly dropping somebody
  // else's: which one it would have been is not a decision to make on your
  // behalf, so the gallery greys the rest out and says so instead.
  if (current.length >= MAX_PINS) return current;
  return normalizePins([...current, id]);
}

// The rows the popover shows: the pinned themes, plus the one in force when it
// is not among them, so the tick is always on screen without opening the
// gallery. That extra row sits in its declared position rather than on the end,
// which keeps the pinned ones where they always are.
export function quickSelections(savedId = DEFAULT_THEME_ID, pins = DEFAULT_PINS) {
  const ids = normalizePins(pins);
  if (getTheme(savedId) && !ids.includes(savedId)) ids.push(savedId);
  const order = THEMES.map(t => t.id);
  ids.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  // The system entry is pinned above them: it is the default, and a mode rather
  // than a palette anyone browses to. It is also the reason unpinning
  // everything is allowed — the popover still has something in it.
  return [SYSTEM_THEME_ID, ...ids].map(id => SELECTIONS.find(s => s.id === id));
}

// The gallery, split the way you actually choose: you know whether you want a
// light one or a dark one before you know which. A group with nothing in it is
// left out rather than rendered as an empty heading.
export function themeGroups() {
  return [
    { label: 'Light', themes: THEMES.filter(t => !t.dark) },
    { label: 'Dark', themes: THEMES.filter(t => t.dark) },
  ].filter(g => g.themes.length > 0);
}

// The themes the popover is not showing — what is behind the row that opens the
// gallery, and the number on it.
export function restThemes(savedId = DEFAULT_THEME_ID, pins = DEFAULT_PINS) {
  const shown = new Set(quickSelections(savedId, pins).map(s => s.id));
  return THEMES.filter(t => !shown.has(t.id));
}
