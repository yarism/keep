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
    id: 'gruvbox',
    name: 'Gruvbox',
    dark: true,
    tokens: {
      'bg': '#282828',
      'bg-surface': '#32302f',
      'bg-elevated': '#3c3836',
      'bg-hover': '#3c3836',
      'bg-active': '#504945',
      'border': '#3c3836',
      'border-strong': '#504945',
      'text': '#ebdbb2',
      'text-dim': '#a89984',
      'text-mute': '#928374',
      'accent': '#83a598',
      'accent-hover': '#9cb8ad',
      'on-accent': '#282828',
      'green': '#b8bb26',
      'red': '#fb4934',
      'yellow': '#fabd2f',
      'blue': '#83a598',
      'on-status': '#282828',
      'diff-add-bg': 'rgba(184, 187, 38, 0.14)',
      'diff-add-text': '#c3c65a',
      'diff-del-bg': 'rgba(251, 73, 52, 0.14)',
      'diff-del-text': '#fb7a6b',
      'diff-hunk-bg': 'rgba(131, 165, 152, 0.14)',
      'diff-hunk-text': '#83a598',
      'shadow-menu': '0 10px 28px rgba(0, 0, 0, 0.45)',
      'shadow-modal': '0 20px 50px rgba(0, 0, 0, 0.55)',
      'scrollbar': '#504945',
      'overlay': 'rgba(0, 0, 0, 0.5)',
    },
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    dark: false,
    tokens: {
      'bg': '#fdf6e3',
      'bg-surface': '#f4ecd8',
      'bg-elevated': '#fdf6e3',
      'bg-hover': '#eee8d5',
      'bg-active': '#e2dac2',
      'border': '#e6dfc8',
      'border-strong': '#cfc6ab',
      'text': '#073642',
      'text-dim': '#69807f',
      'text-mute': '#93a1a1',
      'accent': '#268bd2',
      'accent-hover': '#1f76b4',
      'on-accent': '#fdf6e3',
      'green': '#657b00',
      'red': '#dc322f',
      'yellow': '#b58900',
      'blue': '#268bd2',
      'on-status': '#fdf6e3',
      'diff-add-bg': 'rgba(133, 153, 0, 0.16)',
      'diff-add-text': '#4f6100',
      'diff-del-bg': 'rgba(220, 50, 47, 0.13)',
      'diff-del-text': '#af2724',
      'diff-hunk-bg': 'rgba(38, 139, 210, 0.12)',
      'diff-hunk-text': '#1f6f9e',
      'shadow-menu': '0 10px 28px rgba(70, 60, 30, 0.16)',
      'shadow-modal': '0 20px 50px rgba(70, 60, 30, 0.24)',
      'scrollbar': '#d8d0b8',
      'overlay': 'rgba(60, 52, 30, 0.28)',
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
