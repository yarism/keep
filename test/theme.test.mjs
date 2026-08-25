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
  THEMES, TOKENS, DEFAULT_THEME_ID, SYSTEM_THEME_ID, SYSTEM_PAIR, SELECTIONS,
  isSystemTheme, getTheme, resolveTheme, swatch, swatchFor, validateTheme,
  quickSelections, restThemes, themeGroups, FEATURED,
} = await loadEsm('renderer/themes.js');

const { icon, iconNames, hasIcon, STROKE_WIDTH } = await loadEsm('renderer/icons.js');

// ── Themes ──

test('themes: ids and names are unique', () => {
  const ids = SELECTIONS.map(t => t.id);
  const names = SELECTIONS.map(t => t.name);
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

test('themes: the system selection is not a theme, and every selection resolves to one', () => {
  // It has no tokens of its own, so nothing downstream of resolveTheme() ever
  // has to know it exists.
  assert.strictEqual(getTheme(SYSTEM_THEME_ID), null);
  assert.ok(isSystemTheme(DEFAULT_THEME_ID), 'a fresh install follows the OS');
  for (const selection of SELECTIONS) {
    assert.ok(resolveTheme(selection.id), `${selection.id} resolves to nothing`);
  }
});

test('themes: the system selection follows the OS, and the rest ignore it', () => {
  assert.strictEqual(resolveTheme(SYSTEM_THEME_ID, false).id, SYSTEM_PAIR.light);
  assert.strictEqual(resolveTheme(SYSTEM_THEME_ID, true).id, SYSTEM_PAIR.dark);
  assert.strictEqual(resolveTheme(SYSTEM_PAIR.light, true).id, SYSTEM_PAIR.light);
  assert.strictEqual(resolveTheme('ember', false).id, 'ember');
});

test('themes: the pair the system selection switches between is a light one and a dark one', () => {
  assert.strictEqual(getTheme(SYSTEM_PAIR.light).dark, false);
  assert.strictEqual(getTheme(SYSTEM_PAIR.dark).dark, true);
});

test('themes: an unknown id falls back to the default instead of returning nothing', () => {
  // A theme can be removed while a settings file still names it; the app must
  // still paint something.
  assert.strictEqual(getTheme('no-such-theme'), null);
  assert.strictEqual(resolveTheme('no-such-theme').id, SYSTEM_PAIR.light);
  assert.strictEqual(resolveTheme('no-such-theme', true).id, SYSTEM_PAIR.dark);
  assert.strictEqual(resolveTheme(undefined).id, SYSTEM_PAIR.light);
});

test('themes: swatch previews four colours', () => {
  for (const theme of THEMES) {
    const colours = swatch(theme);
    assert.strictEqual(colours.length, 4);
    colours.forEach(c => assert.ok(c, `${theme.id} swatch has a hole`));
  }
});

test('themes: every picker row has a four-colour swatch, the system one drawn from both sides', () => {
  for (const selection of SELECTIONS) {
    const colours = swatchFor(selection.id);
    assert.strictEqual(colours.length, 4);
    colours.forEach(c => assert.ok(c, `${selection.id} swatch has a hole`));
  }
  const system = swatchFor(SYSTEM_THEME_ID);
  assert.ok(system.includes(getTheme(SYSTEM_PAIR.light).tokens['bg']));
  assert.ok(system.includes(getTheme(SYSTEM_PAIR.dark).tokens['bg']));
});

// ── What the picker shows ──

test('picker: the popover lists the featured themes and nothing else', () => {
  FEATURED.forEach(id => assert.ok(getTheme(id), `featured theme ${id} does not exist`));
  const ids = quickSelections(SYSTEM_THEME_ID).map(s => s.id);
  assert.deepStrictEqual(ids, [SYSTEM_THEME_ID, ...FEATURED]);
});

test('picker: the popover does not grow when a theme is added', () => {
  // The whole point of the gallery. A new theme lands there, not on the toolbar.
  assert.ok(THEMES.length > FEATURED.length, 'this stops proving anything otherwise');
  for (const id of FEATURED.concat(SYSTEM_THEME_ID)) {
    assert.strictEqual(quickSelections(id).length, FEATURED.length + 1);
  }
});

test('picker: choosing a theme never moves the rows', () => {
  // This is why the list is fixed rather than ordered by what was picked
  // lately: a menu whose rows rearrange as you use it puts something else under
  // the pointer each time, and a theme you like can be pushed off it by one you
  // were only trying.
  const before = quickSelections(SYSTEM_THEME_ID).map(s => s.id);
  for (const selection of SELECTIONS) {
    const after = quickSelections(selection.id).map(s => s.id);
    assert.deepStrictEqual(after.filter(id => before.includes(id)), before,
      `choosing ${selection.id} disturbed the fixed rows`);
  }
});

test('picker: a theme chosen from the gallery joins the rows, in its declared place', () => {
  // Otherwise the tick would be nowhere to be seen while it is in force.
  const outsider = THEMES.find(t => !FEATURED.includes(t.id));
  const ids = quickSelections(outsider.id).map(s => s.id);
  assert.ok(ids.includes(outsider.id));
  const order = [SYSTEM_THEME_ID, ...THEMES.map(t => t.id)];
  const ranks = ids.map(id => order.indexOf(id));
  assert.deepStrictEqual(ranks, [...ranks].sort((a, b) => a - b), 'listed out of order');
});

test('picker: every selection has a visible tick without opening the gallery', () => {
  for (const selection of SELECTIONS) {
    assert.ok(quickSelections(selection.id).some(s => s.id === selection.id), selection.id);
  }
});

test('picker: an unknown selection leaves the rows alone rather than a hole', () => {
  const ids = quickSelections('no-such-theme').map(s => s.id);
  assert.deepStrictEqual(ids, [SYSTEM_THEME_ID, ...FEATURED]);
});

test('picker: the gallery row offers exactly what the popover left out', () => {
  for (const selection of SELECTIONS) {
    const shown = quickSelections(selection.id).map(s => s.id);
    const rest = restThemes(selection.id).map(t => t.id);
    assert.strictEqual(shown.length + rest.length, SELECTIONS.length);
    rest.forEach(id => assert.ok(!shown.includes(id), `${id} is offered twice`));
  }
});

test('picker: the gallery holds every theme, split into light and dark', () => {
  const groups = themeGroups();
  const listed = groups.flatMap(g => g.themes.map(t => t.id));
  assert.deepStrictEqual([...listed].sort(), THEMES.map(t => t.id).sort());
  assert.strictEqual(new Set(listed).size, listed.length);
  for (const group of groups) {
    assert.ok(group.themes.length > 0, 'an empty heading is not a group');
    const dark = group.label === 'Dark';
    group.themes.forEach(t => assert.strictEqual(t.dark, dark, `${t.id} is in the wrong group`));
  }
  // Following the OS is a mode, not a palette — it is pinned in the popover
  // instead, so it must not turn up in here as an extra theme.
  assert.ok(!listed.includes(SYSTEM_THEME_ID));
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
