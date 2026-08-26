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
  quickSelections, restThemes, themeGroups,
  DEFAULT_PINS, MAX_PINS, normalizePins, togglePin, isPinned, pinsAreFull,
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

test('picker: the popover lists the pinned themes and nothing else', () => {
  DEFAULT_PINS.forEach(id => assert.ok(getTheme(id), `pinned theme ${id} does not exist`));
  const ids = quickSelections(SYSTEM_THEME_ID).map(s => s.id);
  assert.deepStrictEqual(ids, [SYSTEM_THEME_ID, ...DEFAULT_PINS]);
  const pins = ['ember', 'ivory'];
  assert.deepStrictEqual(
    quickSelections(SYSTEM_THEME_ID, pins).map(s => s.id),
    [SYSTEM_THEME_ID, 'ember', 'ivory'],
  );
});

test('picker: the popover does not grow when a theme is added', () => {
  // The whole point of the gallery. A new theme lands there, not on the toolbar.
  assert.ok(THEMES.length > DEFAULT_PINS.length, 'this stops proving anything otherwise');
  for (const id of DEFAULT_PINS.concat(SYSTEM_THEME_ID)) {
    assert.strictEqual(quickSelections(id).length, DEFAULT_PINS.length + 1);
  }
});

test('picker: choosing a theme never moves the rows', () => {
  // This is why the list is pinned rather than ordered by what was picked
  // lately: a menu whose rows rearrange as you use it puts something else under
  // the pointer each time, and a theme you like can be pushed off it by one you
  // were only trying.
  const before = quickSelections(SYSTEM_THEME_ID).map(s => s.id);
  for (const selection of SELECTIONS) {
    const after = quickSelections(selection.id).map(s => s.id);
    assert.deepStrictEqual(after.filter(id => before.includes(id)), before,
      `choosing ${selection.id} disturbed the pinned rows`);
  }
});

test('picker: a theme chosen from the gallery joins the rows, in its declared place', () => {
  // Otherwise the tick would be nowhere to be seen while it is in force.
  const outsider = THEMES.find(t => !DEFAULT_PINS.includes(t.id));
  const ids = quickSelections(outsider.id).map(s => s.id);
  assert.ok(ids.includes(outsider.id));
  const order = [SYSTEM_THEME_ID, ...THEMES.map(t => t.id)];
  const ranks = ids.map(id => order.indexOf(id));
  assert.deepStrictEqual(ranks, [...ranks].sort((a, b) => a - b), 'listed out of order');
});

test('picker: every selection has a visible tick without opening the gallery', () => {
  for (const selection of SELECTIONS) {
    assert.ok(quickSelections(selection.id).some(s => s.id === selection.id), selection.id);
    assert.ok(quickSelections(selection.id, []).some(s => s.id === selection.id), selection.id);
  }
});

test('picker: an unknown selection leaves the rows alone rather than a hole', () => {
  const ids = quickSelections('no-such-theme').map(s => s.id);
  assert.deepStrictEqual(ids, [SYSTEM_THEME_ID, ...DEFAULT_PINS]);
});

test('picker: the gallery row offers exactly what the popover left out', () => {
  for (const pins of [undefined, [], DEFAULT_PINS, THEMES.map(t => t.id)]) {
    for (const selection of SELECTIONS) {
      const shown = quickSelections(selection.id, pins).map(s => s.id);
      const rest = restThemes(selection.id, pins).map(t => t.id);
      assert.strictEqual(shown.length + rest.length, SELECTIONS.length);
      rest.forEach(id => assert.ok(!shown.includes(id), `${id} is offered twice`));
    }
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

// ── Pins ──

test('pins: a stored list is cleaned up rather than trusted', () => {
  // settings.json can name a theme that has since been removed, or the same one
  // twice; neither should reach the popover.
  assert.deepStrictEqual(normalizePins(['ember', 'no-such-theme', 'ember']), ['ember']);
  assert.deepStrictEqual(normalizePins([]), []);
  assert.deepStrictEqual(normalizePins(['no-such-theme']), []);
  // The system entry is a mode, not a theme, so it cannot be pinned or unpinned.
  assert.deepStrictEqual(normalizePins([SYSTEM_THEME_ID]), []);
});

test('pins: an absent list means a fresh install, not an empty menu', () => {
  for (const absent of [undefined, null, 'ember', 42]) {
    assert.deepStrictEqual(normalizePins(absent), DEFAULT_PINS);
  }
  // ...but an empty one was somebody unpinning everything, and is left alone.
  assert.deepStrictEqual(quickSelections(SYSTEM_THEME_ID, []).map(s => s.id), [SYSTEM_THEME_ID]);
  assert.strictEqual(restThemes(SYSTEM_THEME_ID, []).length, THEMES.length);
});

test('pins: the order is the declared one, whatever order they were pinned in', () => {
  // Otherwise the rows would sit in the order they were clicked, and the
  // popover would read differently on two machines with the same four pins.
  const order = THEMES.map(t => t.id);
  const pinned = ['synthwave', 'graphite-light', 'ivory'];
  const ids = normalizePins(pinned);
  assert.deepStrictEqual(ids, [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
  assert.deepStrictEqual(normalizePins([...pinned].reverse()), ids);
});

test('pins: pinning and unpinning are the same gesture, and it round-trips', () => {
  // One short of the limit, so there is somewhere for the next pin to go.
  const pins = DEFAULT_PINS.slice(0, MAX_PINS - 1);
  const outsider = THEMES.find(t => !pins.includes(t.id)).id;
  assert.strictEqual(isPinned(pins, outsider), false);

  const added = togglePin(pins, outsider);
  assert.ok(isPinned(added, outsider));
  assert.ok(quickSelections(SYSTEM_THEME_ID, added).some(s => s.id === outsider));

  const removed = togglePin(added, outsider);
  assert.deepStrictEqual(removed, normalizePins(pins));
  // The list handed in is never modified — the caller decides what to keep.
  assert.deepStrictEqual(pins, DEFAULT_PINS.slice(0, MAX_PINS - 1));
});

test('pins: unpinning the theme in force keeps it on the menu while it is on', () => {
  // The tick has to be somewhere, so the row survives its own unpinning — and
  // is gone the next time something else is chosen.
  const pins = togglePin(DEFAULT_PINS, 'claude');
  assert.ok(!isPinned(pins, 'claude'));
  assert.ok(quickSelections('claude', pins).some(s => s.id === 'claude'));
  assert.ok(!quickSelections('sage', pins).some(s => s.id === 'claude'));
});

test('pins: an unknown id cannot be pinned', () => {
  assert.deepStrictEqual(togglePin(DEFAULT_PINS, 'no-such-theme'), normalizePins(DEFAULT_PINS));
});

test('pins: the popover cannot be turned back into the gallery', () => {
  // The limit is the point of the popover: pin everything and it is a second
  // gallery on the toolbar, one you have to read rather than aim at.
  assert.ok(THEMES.length > MAX_PINS, 'this stops proving anything otherwise');
  assert.ok(DEFAULT_PINS.length <= MAX_PINS, 'a fresh install starts over the limit');
  // Five rows, counting the system entry pinned above them.
  assert.strictEqual(quickSelections(SYSTEM_THEME_ID).length, MAX_PINS + 1);
  const all = normalizePins(THEMES.map(t => t.id));
  assert.strictEqual(all.length, MAX_PINS);
  assert.strictEqual(quickSelections(SYSTEM_THEME_ID, all).length, MAX_PINS + 1);
  assert.ok(restThemes(SYSTEM_THEME_ID, all).length > 0, 'the gallery row must survive');
});

test('pins: a full set refuses the next one rather than dropping one of its own', () => {
  // Which one it would have dropped is not a decision to make for somebody.
  const full = normalizePins(THEMES.map(t => t.id));
  assert.ok(pinsAreFull(full));
  const outsider = THEMES.find(t => !full.includes(t.id)).id;
  assert.deepStrictEqual(togglePin(full, outsider), full);
  // Unpinning still works at the limit, and makes room for exactly one.
  const room = togglePin(full, full[0]);
  assert.ok(!pinsAreFull(room));
  assert.ok(isPinned(togglePin(room, outsider), outsider));
});

test('pins: a fresh install is already full, so pinning a fifth is a swap', () => {
  // The popover ships at the size it stays: five rows with the system entry.
  assert.strictEqual(DEFAULT_PINS.length, MAX_PINS);
  assert.ok(pinsAreFull(DEFAULT_PINS));
  const outsider = THEMES.find(t => !DEFAULT_PINS.includes(t.id)).id;
  const swapped = togglePin(togglePin(DEFAULT_PINS, DEFAULT_PINS[3]), outsider);
  assert.ok(isPinned(swapped, outsider));
  assert.ok(!isPinned(swapped, DEFAULT_PINS[3]));
  assert.strictEqual(swapped.length, MAX_PINS);
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
