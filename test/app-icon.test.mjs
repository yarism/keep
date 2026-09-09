// Tests for renderer/icon-art.js, the drawing behind the app icon and the
// palettes it can be drawn in.
//
// Two things are worth holding still here. The first is the default: it is what
// every install that never opens the picker wears, and what the .icns shipping
// inside the bundle was rasterised from, so a change to it is a change to
// somebody else's icon. The second is that the drawing stays drawable by both
// callers: the build script rasterising a 1024px master through node-canvas,
// and the app drawing a 30px swatch in the browser. Which mostly means it must
// keep using nothing but the 2D context it is handed.
import test from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';

import { loadEsm } from './helpers/esm.mjs';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, ROOT), 'utf-8');

const {
  ICON_PALETTES, DEFAULT_ICON_ID, getIconPalette, normalizeIconId, isDefaultIcon,
  drawKeepIcon,
} = await loadEsm('renderer/icon-art.js');

// A stand-in for a canvas context that answers every call and remembers what it
// was asked. Enough to run the drawing without either canvas implementation,
// which is the point: the test is about the shape of the calls, not the pixels.
function fakeContext() {
  const calls = [];
  const gradient = { addColorStop: (offset, colour) => calls.push(['stop', offset, colour]) };
  const record = (name) => (...args) => { calls.push([name, ...args]); };
  return {
    calls,
    colours: () => calls.filter(c => c[0] === 'stop').map(c => c[2]),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arc: record('arc'),
    roundRect: record('roundRect'),
    fill: record('fill'),
    fillRect: record('fillRect'),
    save: record('save'),
    restore: record('restore'),
    clip: record('clip'),
    scale: record('scale'),
  };
}

test('icon palettes: ids and names are unique', () => {
  const ids = ICON_PALETTES.map(p => p.id);
  const names = ICON_PALETTES.map(p => p.name);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.strictEqual(new Set(names).size, names.length);
});

test('icon palettes: every one is three hex stops', () => {
  for (const palette of ICON_PALETTES) {
    assert.strictEqual(palette.stops.length, 3, `${palette.id} should have three stops`);
    for (const stop of palette.stops) {
      assert.match(stop, /^#[0-9a-f]{6}$/, `${palette.id} has a stop that is not a six-digit hex`);
    }
  }
});

// The gradient runs light to dark along the diagonal. A palette with them the
// other way round would draw a legible icon and the wrong one.
test('icon palettes: stops darken from first to last', () => {
  const luminance = (hex) => [1, 3, 5]
    .map(i => parseInt(hex.slice(i, i + 2), 16))
    .reduce((sum, c, k) => sum + c * [0.299, 0.587, 0.114][k], 0);
  for (const { id, stops } of ICON_PALETTES) {
    const [light, mid, dark] = stops.map(luminance);
    assert.ok(light > mid && mid > dark, `${id} does not run light to dark`);
  }
});

test('icon palettes: the default is one of them', () => {
  assert.ok(getIconPalette(DEFAULT_ICON_ID));
  assert.ok(isDefaultIcon(DEFAULT_ICON_ID));
});

// The icon Keep has always had. Written out rather than read from the palette,
// because the point of the test is to notice if the palette changes: this is
// the picture assets/icon.icns holds, and the one an install that never opens
// the picker keeps.
test('icon palettes: the shipped indigo is unchanged', () => {
  const indigo = getIconPalette('indigo');
  assert.deepStrictEqual(indigo.stops, ['#7a86f5', '#4f46e5', '#1e1b4b']);
  assert.strictEqual(indigo.shadow, 'rgba(15, 10, 50, 0.4)');
  assert.strictEqual(indigo.shade, 'rgba(10, 5, 40, 0.28)');
  assert.strictEqual(DEFAULT_ICON_ID, 'indigo');
});

test('normalizeIconId: an unknown or absent id falls back to the default', () => {
  assert.strictEqual(normalizeIconId('teal'), 'teal');
  assert.strictEqual(normalizeIconId('chartreuse'), DEFAULT_ICON_ID);
  assert.strictEqual(normalizeIconId(null), DEFAULT_ICON_ID);
  assert.strictEqual(normalizeIconId(undefined), DEFAULT_ICON_ID);
  assert.strictEqual(normalizeIconId(42), DEFAULT_ICON_ID);
});

test('drawKeepIcon: takes a palette or the id of one', () => {
  const byObject = fakeContext();
  const byId = fakeContext();
  drawKeepIcon(byObject, 512, getIconPalette('copper'));
  drawKeepIcon(byId, 512, 'copper');
  assert.deepStrictEqual(byId.colours(), byObject.colours());
});

test('drawKeepIcon: an unknown id still draws, in the default', () => {
  const unknown = fakeContext();
  const fallback = fakeContext();
  drawKeepIcon(unknown, 512, 'chartreuse');
  drawKeepIcon(fallback, 512, DEFAULT_ICON_ID);
  assert.deepStrictEqual(unknown.colours(), fallback.colours());
});

test('drawKeepIcon: the palette is what reaches the gradient', () => {
  for (const palette of ICON_PALETTES) {
    const ctx = fakeContext();
    drawKeepIcon(ctx, 512, palette);
    for (const stop of palette.stops) {
      assert.ok(ctx.colours().includes(stop), `${palette.id} did not paint ${stop}`);
    }
  }
});

// Every dimension in the drawing is a fraction of the size it is given, so the
// same code fills a 16px iconset entry and a 1024px master. A literal would
// only show up as an icon that is subtly wrong at one size.
test('drawKeepIcon: geometry scales with the size it is given', () => {
  const small = fakeContext();
  const large = fakeContext();
  drawKeepIcon(small, 100, 'indigo');
  drawKeepIcon(large, 400, 'indigo');

  const points = (ctx) => ctx.calls
    .filter(c => c[0] === 'moveTo' || c[0] === 'lineTo')
    .flatMap(c => c.slice(1));
  const from100 = points(small).map(v => v * 4);
  assert.ok(from100.length > 0);
  assert.deepStrictEqual(points(large), from100);
});

// The two callers are a Node build script and a browser, and the drawing is
// only shared by both because it reaches for nothing either one lacks.
test('icon-art: touches neither the DOM nor the filesystem', async () => {
  const source = await read('renderer/icon-art.js');
  const code = source.replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of ['document', 'window', 'require(', 'localStorage']) {
    assert.ok(!code.includes(forbidden), `icon-art.js should not reference ${forbidden}`);
  }
});

// The trick the build script uses to load this module evaluates it as a data
// URL, which leaves a relative specifier with no base to resolve against.
test('icon-art: has no relative imports, which the build script could not resolve', async () => {
  const source = await read('renderer/icon-art.js');
  assert.doesNotMatch(source, /^\s*import\s/m);
});
