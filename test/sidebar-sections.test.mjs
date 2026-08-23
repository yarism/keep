// Tests for the collapsible sidebar sections.
//
// The behaviour lives in renderer/modules/sections.js, which is pure DOM work
// and so can't be loaded here (see helpers/esm.mjs). What can drift silently,
// and what these tests pin down, is the contract between the three files: the
// markup declares the sections, the module keys off `data-section`, and the
// stylesheet is the only thing that actually hides a collapsed one.
import test from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, ROOT), 'utf-8');

const html = await read('renderer/index.html');
const css = await read('renderer/styles.css');
const sections = await read('renderer/modules/sections.js');

// Each `<div class="sidebar-section" data-section="key"> … </div>` block, from
// its opening tag to the start of the next one (or the end of the sidebar).
function sectionBlocks() {
  const opens = [...html.matchAll(/<div class="sidebar-section" data-section="([^"]+)"/g)];
  return opens.map((m, i) => ({
    key: m[1],
    markup: html.slice(m.index, i + 1 < opens.length ? opens[i + 1].index : html.length),
  }));
}

test('sidebar: the sections the module expects are all declared in the markup', () => {
  const keys = sectionBlocks().map(s => s.key);
  assert.deepStrictEqual(
    keys.sort(),
    ['branches', 'remotes', 'repositories', 'tags', 'workspace'],
  );
  assert.strictEqual(new Set(keys).size, keys.length, 'section keys must be unique');
});

test('sidebar: every section has a toggle, and it controls a real element', () => {
  for (const { key, markup } of sectionBlocks()) {
    const toggle = markup.match(/<button type="button" class="section-toggle"[^>]*>/);
    assert.ok(toggle, `${key} has no collapse toggle`);

    const controls = toggle[0].match(/aria-controls="([^"]+)"/);
    assert.ok(controls, `${key}'s toggle names no controlled element`);
    assert.ok(
      new RegExp(`id="${controls[1]}"[^>]*class="[^"]*section-list`).test(markup)
      || new RegExp(`class="[^"]*section-list[^"]*"[^>]*id="${controls[1]}"`).test(markup),
      `${key} controls #${controls[1]}, which is not a .section-list inside it`,
    );

    // The arrow starts pointing down; sections.js turns it when it collapses.
    assert.ok(
      /class="icon expand-arrow open" data-icon="chevron"/.test(markup),
      `${key}'s toggle has no disclosure arrow`,
    );
  }
});

test('sidebar: collapsing is what actually hides a section body', () => {
  assert.match(css, /\.sidebar-section\.collapsed > \.section-list\s*{\s*display:\s*none/);
  // The class the stylesheet keys off is the one the module sets.
  assert.match(sections, /classList\.toggle\('collapsed'/);
});

test('sidebar: the collapsed set is persisted under one settings key', () => {
  const key = sections.match(/const SETTING_KEY = '([^']+)'/);
  assert.ok(key, 'sections.js no longer names the setting it writes');
  assert.match(sections, new RegExp(`saveSettings\\(\\{ \\[SETTING_KEY\\]`),
    'the collapsed set must go through saveSettings');
});
