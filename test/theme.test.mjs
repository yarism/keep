// Tests for renderer/themes.js and renderer/icons.js — the two pure modules
// behind the app's appearance. Neither touches the DOM, so both load straight
// into Node; what they need protecting from is drift: a theme that forgets a
// token, an icon name referenced from markup that no longer exists, or a colour
// written literally into the stylesheet where no theme can reach it.
import test from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';

import { loadEsm } from './helpers/esm.mjs';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, ROOT), 'utf-8');

const {
  THEMES, TOKENS, DEFAULT_THEME_ID, getTheme, resolveTheme, swatch, validateTheme,
} = await loadEsm('renderer/themes.js');

const { icon, iconNames, hasIcon, STROKE_WIDTH } = await loadEsm('renderer/icons.js');

// ── Themes ──

test('themes: ids and names are unique', () => {
  const ids = THEMES.map(t => t.id);
  const names = THEMES.map(t => t.name);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.strictEqual(new Set(names).size, names.length);
});

test('themes: every theme defines exactly the documented token set', () => {
  for (const theme of THEMES) {
    const { missing, extra } = validateTheme(theme);
    assert.deepStrictEqual(missing, [], `${theme.id} is missing tokens`);
    assert.deepStrictEqual(extra, [], `${theme.id} defines unknown tokens`);
  }
});

test('themes: no token is left blank', () => {
  for (const theme of THEMES) {
    for (const token of TOKENS) {
      const value = theme.tokens[token];
      assert.ok(typeof value === 'string' && value.trim() !== '', `${theme.id}/${token}`);
    }
  }
});

test('themes: the default theme exists', () => {
  assert.ok(getTheme(DEFAULT_THEME_ID));
});

test('themes: an unknown id falls back to the default instead of returning nothing', () => {
  // A theme can be removed while a settings file still names it; the app must
  // still paint something.
  assert.strictEqual(getTheme('no-such-theme'), null);
  assert.strictEqual(resolveTheme('no-such-theme').id, DEFAULT_THEME_ID);
  assert.strictEqual(resolveTheme(undefined).id, DEFAULT_THEME_ID);
});

test('themes: swatch previews four colours', () => {
  for (const theme of THEMES) {
    const colours = swatch(theme);
    assert.strictEqual(colours.length, 4);
    colours.forEach(c => assert.ok(c, `${theme.id} swatch has a hole`));
  }
});

// ── Icons ──

test('icons: render a themeable, uniformly-sized svg', () => {
  const svg = icon('branch', 14);
  assert.match(svg, /^<svg /);
  assert.match(svg, /viewBox="0 0 24 24"/);
  assert.match(svg, /width="14" height="14"/);
  assert.match(svg, /stroke="currentColor"/, 'colour must come from the theme');
  assert.match(svg, new RegExp(`stroke-width="${STROKE_WIDTH}"`));
});

test('icons: an unknown name renders nothing rather than throwing', () => {
  assert.strictEqual(icon('not-an-icon'), '');
  assert.strictEqual(hasIcon('not-an-icon'), false);
});

test('icons: nothing in the set hard-codes a colour', () => {
  for (const name of iconNames()) {
    const svg = icon(name);
    assert.doesNotMatch(svg, /#[0-9a-fA-F]{3}/, `${name} contains a literal colour`);
    assert.doesNotMatch(svg, /fill="(?!none|currentColor)/, `${name} has a non-theme fill`);
  }
});

test('icons: every name used in markup or modules is defined', async () => {
  const sources = await Promise.all([
    'renderer/index.html',
    'renderer/app.js',
    'renderer/modules/sidebar.js',
    'renderer/modules/repos.js',
    'renderer/modules/history.js',
    'renderer/modules/theme.js',
  ].map(read));

  const used = new Set();
  for (const src of sources) {
    for (const m of src.matchAll(/data-icon="([\w-]+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/\bicon\(\s*'([\w-]+)'/g)) used.add(m[1]);
  }

  assert.ok(used.size > 0, 'the scan found no icon references at all');
  for (const name of used) {
    assert.ok(hasIcon(name), `markup references a missing icon: ${name}`);
  }
});

test('icons: no stray inline svg is left behind in the renderer', async () => {
  // Icons used to be pasted into each call site, which is how three different
  // stroke weights ended up on one toolbar. Everything now goes through icons.js.
  for (const file of ['renderer/index.html', 'renderer/modules/sidebar.js', 'renderer/modules/repos.js']) {
    const src = await read(file);
    assert.doesNotMatch(src, /<svg /, `${file} still builds an svg by hand`);
  }
});

// ── The rule that makes theming work at all ──

test('styles.css keeps every colour in a custom property', async () => {
  const css = await read('renderer/styles.css');
  // The :root block holds the default palette; everything after it must read
  // tokens, or that rule can never be re-themed.
  const afterRoot = css.slice(css.indexOf('}', css.indexOf(':root {')) + 1);
  const literals = afterRoot.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g) || [];
  assert.deepStrictEqual(literals, [], 'literal colours cannot be themed');
});

test('styles.css sizes every piece of text from the type scale', async () => {
  const css = await read('renderer/styles.css');
  // Same argument as the colours above: a literal px size outside :root is a
  // size nothing can adjust, and it drifts out of step with the scale.
  const afterRoot = css.slice(css.indexOf('}', css.indexOf(':root {')) + 1);
  const literals = afterRoot.match(/font-size:\s*[\d.]+px/g) || [];
  assert.deepStrictEqual(literals, [], 'font sizes belong to the --fs-* scale');
});

test('styles.css defines a default for every token a theme sets', async () => {
  const css = await read('renderer/styles.css');
  const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  for (const token of TOKENS) {
    assert.ok(rootBlock.includes(`--${token}:`), `styles.css has no fallback for --${token}`);
  }
});

// ── git output, as shown to the user ──

const { summarizeGitOutput, describeResult } = await loadEsm('renderer/git-output.js');

test('git output: drops the progress chatter and keeps the result', () => {
  const raw = [
    'Fetching origin',
    'remote: Enumerating objects: 12, done.',
    'remote: Counting objects:  50% (6/12)\rremote: Counting objects: 100% (12/12), done.',
    'remote: Total 12 (delta 4), reused 0',
    'From github.com:yarism/keep',
    '   07b2e9a..214ab7e  main -> origin/main',
  ].join('\n');
  assert.strictEqual(
    summarizeGitOutput(raw),
    'Fetching origin\nFrom github.com:yarism/keep\n07b2e9a..214ab7e  main -> origin/main',
  );
});

test('git output: a carriage-returned progress line keeps only its final state', () => {
  assert.strictEqual(summarizeGitOutput('Receiving: 1%\rDone thing'), 'Done thing');
});

test('git output: caps the number of lines and says how many were dropped', () => {
  const raw = ['a', 'b', 'c', 'd', 'e'].join('\n');
  assert.strictEqual(summarizeGitOutput(raw, { max: 2 }), 'a\nb\n…and 3 more lines');
});

test('git output: empty and whitespace-only output summarise to nothing', () => {
  assert.strictEqual(summarizeGitOutput(''), '');
  assert.strictEqual(summarizeGitOutput('\n  \n'), '');
  assert.strictEqual(summarizeGitOutput(undefined), '');
});

test('git output: a silent success still gets described', () => {
  // This is the case that made the buttons feel dead: git succeeds and prints
  // nothing, so there has to be something to say anyway.
  assert.strictEqual(describeResult('Push', ''), 'Everything up-to-date');
  assert.strictEqual(describeResult('Fetch', '   \n'), 'Already up to date');
  assert.strictEqual(describeResult('Merge', ''), 'Merge finished');
});

test('git output: real output wins over the canned line', () => {
  assert.strictEqual(describeResult('Pull', 'Already up to date.'), 'Already up to date.');
  assert.strictEqual(describeResult('Push', 'To github.com:yarism/keep.git'), 'To github.com:yarism/keep.git');
});
