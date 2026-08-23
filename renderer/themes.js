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
    // Keep's original palette, kept as a theme so nobody loses the look they
    // already had.
    id: 'midnight',
    name: 'Midnight',
    dark: true,
    tokens: {
      'bg': '#1e1e2e',
      'bg-surface': '#252536',
      'bg-elevated': '#2b2b3f',
      'bg-hover': '#2e2e42',
      'bg-active': '#363650',
      'border': '#3a3a52',
      'border-strong': '#4a4a66',
      'text': '#cdd6f4',
      'text-dim': '#8888aa',
      'text-mute': '#6c6c8a',
      'accent': '#89b4fa',
      'accent-hover': '#a3c6fb',
      'on-accent': '#1e1e2e',
      'green': '#a6e3a1',
      'red': '#f38ba8',
      'yellow': '#f9e2af',
      'blue': '#89b4fa',
      'on-status': '#1e1e2e',
      'diff-add-bg': 'rgba(166, 227, 161, 0.12)',
      'diff-add-text': '#a6e3a1',
      'diff-del-bg': 'rgba(243, 139, 168, 0.12)',
      'diff-del-text': '#f38ba8',
      'diff-hunk-bg': 'rgba(137, 180, 250, 0.12)',
      'diff-hunk-text': '#89b4fa',
      'shadow-menu': '0 10px 28px rgba(0, 0, 0, 0.45)',
      'shadow-modal': '0 20px 50px rgba(0, 0, 0, 0.55)',
      'scrollbar': '#3a3a52',
      'overlay': 'rgba(10, 10, 18, 0.55)',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    dark: true,
    tokens: {
      'bg': '#2e3440',
      'bg-surface': '#333b48',
      'bg-elevated': '#3b4252',
      'bg-hover': '#3b4252',
      'bg-active': '#464f61',
      'border': '#3b4252',
      'border-strong': '#4c566a',
      'text': '#e5e9f0',
      'text-dim': '#9aa6b8',
      'text-mute': '#788196',
      'accent': '#88c0d0',
      'accent-hover': '#9fd0dd',
      'on-accent': '#2e3440',
      'green': '#a3be8c',
      'red': '#bf616a',
      'yellow': '#ebcb8b',
      'blue': '#81a1c1',
      'on-status': '#2e3440',
      'diff-add-bg': 'rgba(163, 190, 140, 0.14)',
      'diff-add-text': '#b7cfa3',
      'diff-del-bg': 'rgba(191, 97, 106, 0.16)',
      'diff-del-text': '#d98d94',
      'diff-hunk-bg': 'rgba(136, 192, 208, 0.12)',
      'diff-hunk-text': '#88c0d0',
      'shadow-menu': '0 10px 28px rgba(0, 0, 0, 0.42)',
      'shadow-modal': '0 20px 50px rgba(0, 0, 0, 0.52)',
      'scrollbar': '#4c566a',
      'overlay': 'rgba(20, 24, 32, 0.55)',
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

export const DEFAULT_THEME_ID = 'graphite-light';

export function getTheme(id) {
  return THEMES.find(t => t.id === id) || null;
}

// Falls back to the default rather than leaving the app unstyled when settings
// name a theme that no longer exists.
export function resolveTheme(id) {
  return getTheme(id) || getTheme(DEFAULT_THEME_ID);
}

// The four colours the picker shows as a preview of a theme.
export function swatch(theme) {
  return [theme.tokens['bg'], theme.tokens['bg-surface'], theme.tokens['accent'], theme.tokens['green']];
}

// Returns the token names a theme is missing or defines but shouldn't.
export function validateTheme(theme) {
  const defined = Object.keys(theme.tokens);
  return {
    missing: TOKENS.filter(t => !defined.includes(t)),
    extra: defined.filter(t => !TOKENS.includes(t)),
  };
}
