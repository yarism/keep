// Where the window opens. Two behaviours worth protecting: a fresh install
// should scale to the screen it lands on, and a remembered window should come
// back — but never somewhere the user cannot reach it.
const test = require('node:test');
const assert = require('node:assert');

const { windowBounds, MIN, MAX } = require('../window-bounds');

const LAPTOP = { x: 0, y: 25, width: 1728, height: 1092 };
const PANEL = { x: 0, y: 25, width: 2560, height: 1415 };
const SMALL = { x: 0, y: 25, width: 1280, height: 775 };

// ── first launch ──

test('first launch: takes a share of the screen, not a fixed size', () => {
  const laptop = windowBounds(null, LAPTOP);
  const panel = windowBounds(null, PANEL);

  assert.ok(panel.width > laptop.width, 'a bigger screen should get a bigger window');
  assert.ok(laptop.width < LAPTOP.width && laptop.height < LAPTOP.height, 'it should not fill the screen');
});

test('first launch: never larger than the screen it opens on', () => {
  for (const area of [LAPTOP, PANEL, SMALL]) {
    const b = windowBounds(null, area);
    assert.ok(b.width <= Math.max(area.width, MIN.width), `too wide for ${area.width}`);
    assert.ok(b.height <= Math.max(area.height, MIN.height), `too tall for ${area.height}`);
  }
});

test('first launch: an ultrawide gets a window, not a stretched band', () => {
  const b = windowBounds(null, { x: 0, y: 0, width: 3440, height: 1415 });
  assert.strictEqual(b.width, MAX.width);
});

test('first launch: opens centred, with no remembered position', () => {
  const b = windowBounds(null, LAPTOP);
  assert.strictEqual(b.x, undefined);
  assert.strictEqual(b.maximized, false);
});

// ── a window that was resized before ──

test('remembered: reopens at the size it was left', () => {
  const b = windowBounds({ x: 100, y: 80, width: 1200, height: 800 }, LAPTOP);
  assert.deepStrictEqual(b, { width: 1200, height: 800, x: 100, y: 80, maximized: false });
});

test('remembered: a size from a bigger monitor is cut down to the screen at hand', () => {
  const b = windowBounds({ x: 0, y: 25, width: 2400, height: 1300 }, LAPTOP);
  assert.ok(b.width <= LAPTOP.width && b.height <= LAPTOP.height);
});

test('remembered: a window left on an unplugged monitor comes back on screen', () => {
  // Saved at x: 2600 — off the right edge of a laptop running on its own.
  const b = windowBounds({ x: 2600, y: 200, width: 1200, height: 800 }, LAPTOP, [LAPTOP]);
  assert.strictEqual(b.x, undefined, 'position should be dropped so the window centres');
  assert.strictEqual(b.width, 1200, 'but the size it was left at still stands');
});

test('remembered: a second monitor that is still plugged in keeps its position', () => {
  const second = { x: 1728, y: 0, width: 2560, height: 1415 };
  const b = windowBounds({ x: 2000, y: 200, width: 1200, height: 800 }, LAPTOP, [LAPTOP, second]);
  assert.strictEqual(b.x, 2000);
});

test('remembered: a barely-visible sliver counts as off screen', () => {
  // 40px of the window pokes onto the display — not enough to grab.
  const b = windowBounds({ x: LAPTOP.width - 40, y: 200, width: 1200, height: 800 }, LAPTOP, [LAPTOP]);
  assert.strictEqual(b.x, undefined);
});

test('remembered: maximized is carried across', () => {
  const b = windowBounds({ x: 0, y: 25, width: 1200, height: 800, maximized: true }, LAPTOP);
  assert.strictEqual(b.maximized, true);
});

// ── settings.json is a file on disk, so it can be anything ──

test('junk in settings falls back to the default size', () => {
  const fresh = windowBounds(null, LAPTOP);
  for (const junk of [undefined, {}, { width: 0, height: 0 }, { width: 'wide', height: null }, { width: NaN, height: 900 }]) {
    const b = windowBounds(junk, LAPTOP);
    assert.strictEqual(b.width, fresh.width, `${JSON.stringify(junk)} should not be trusted`);
  }
});

test('a size with no position still opens, centred', () => {
  const b = windowBounds({ width: 1300, height: 850 }, LAPTOP);
  assert.strictEqual(b.width, 1300);
  assert.strictEqual(b.x, undefined);
});

test('a window is never smaller than it can usefully be', () => {
  const b = windowBounds({ x: 0, y: 0, width: 200, height: 100 }, LAPTOP);
  assert.deepStrictEqual([b.width, b.height], [MIN.width, MIN.height]);
});
