// Tests for renderer/modules/state.js — the only renderer module with logic
// worth pinning down independently of the DOM: escaping, the titlebar string,
// and the rule that decides when a pinned branch/tag stops being honoured.
//
// state.js only touches `document` inside functions, so it imports fine without
// a DOM; updateTitlebar() gets the smallest stub that satisfies it.
import test from 'node:test';
import assert from 'node:assert';

import { loadEsm } from './helpers/esm.mjs';

const {
  state, escapeHtml, updateTitlebar, reconcileSelectedBranch, resetHeadTracking,
} = await loadEsm('renderer/modules/state.js');

const DEFAULTS = {
  repoPath: null, currentView: 'welcome', selectedFile: null, selectedCommit: null,
  selectedBranch: null, statusFiles: [], commits: [], branchList: [], tagList: [],
  repositories: [],
};

// The module exports a single shared object, so every test starts from scratch.
function reset(overrides = {}) {
  Object.assign(state, structuredClone(DEFAULTS), overrides);
  resetHeadTracking();
}

// ── escapeHtml ──

test('escapeHtml: escapes the three characters that can break out of markup', () => {
  assert.strictEqual(escapeHtml('<script>'), '&lt;script&gt;');
  assert.strictEqual(escapeHtml('a & b'), 'a &amp; b');
  assert.strictEqual(escapeHtml('&lt;'), '&amp;lt;', 'ampersands are escaped first, so no double-decoding');
});

test('escapeHtml: leaves ordinary diff text untouched', () => {
  assert.strictEqual(escapeHtml('+  const x = 1;'), '+  const x = 1;');
  assert.strictEqual(escapeHtml(''), '');
});

// ── updateTitlebar ──

// Minimal stand-ins for the two elements updateTitlebar() reads.
function stubTitlebar() {
  const icon = { style: { display: '' } };
  const title = { hidden: true, querySelector: () => icon };
  const text = { textContent: '' };
  globalThis.document = {
    querySelector: (sel) => ({ '#titlebar-title': title, '#titlebar-title-text': text }[sel] ?? null),
  };
  return { icon, title, text };
}

test('updateTitlebar: shows "Repositories" and hides the icon with no repo open', () => {
  reset();
  const { icon, text, title } = stubTitlebar();

  updateTitlebar();

  assert.strictEqual(text.textContent, 'Repositories');
  assert.strictEqual(icon.style.display, 'none');
  assert.strictEqual(title.hidden, false);
});

test('updateTitlebar: names the repo, view and current branch', () => {
  reset({
    repoPath: '/Users/someone/code/keep',
    currentView: 'working-copy',
    branchList: [{ name: 'main', current: true }],
  });
  const { text, icon } = stubTitlebar();

  updateTitlebar();

  assert.strictEqual(text.textContent, 'keep – Working Copy (main)');
  assert.strictEqual(icon.style.display, '', 'the icon comes back once a repo is open');
});

test('updateTitlebar: pluralises the changed-file count', () => {
  reset({
    repoPath: '/tmp/keep',
    currentView: 'working-copy',
    branchList: [{ name: 'main', current: true }],
    statusFiles: [{ filePath: 'a' }],
  });
  const { text } = stubTitlebar();

  updateTitlebar();
  assert.match(text.textContent, /1 Changed File\)$/);

  state.statusFiles = [{ filePath: 'a' }, { filePath: 'b' }];
  updateTitlebar();
  assert.match(text.textContent, /2 Changed Files\)$/);
});

test('updateTitlebar: counts commits in the history view', () => {
  reset({
    repoPath: '/tmp/keep',
    currentView: 'history',
    branchList: [{ name: 'main', current: true }],
    commits: [{}, {}, {}],
    statusFiles: [{ filePath: 'ignored-in-this-view' }],
  });
  const { text } = stubTitlebar();

  updateTitlebar();

  assert.strictEqual(text.textContent, 'keep – History (main (3 Commits))');
});

test('updateTitlebar: marks a detached HEAD', () => {
  reset({
    repoPath: '/tmp/keep',
    currentView: 'history',
    branchList: [{ name: 'a1b2c3d', current: true, detached: true }],
  });
  const { text } = stubTitlebar();

  updateTitlebar();

  assert.match(text.textContent, /a1b2c3d \(detached\)/);
});

test('updateTitlebar: falls back to the raw view name for unlabelled views', () => {
  reset({ repoPath: '/tmp/keep', currentView: 'welcome', branchList: [] });
  const { text } = stubTitlebar();

  updateTitlebar();

  assert.strictEqual(text.textContent, 'keep – welcome ()');
});

// ── reconcileSelectedBranch ──
//
// The pin is what the sidebar sets when you click a branch or tag. These tests
// call reconcile twice: once to establish where HEAD was, once for the tick
// under test — which is exactly how the poller drives it.

test('reconcile: keeps a pin on a branch that still exists while HEAD sits still', () => {
  reset({ branchList: [{ name: 'main', current: true }, { name: 'feature' }] });
  reconcileSelectedBranch();

  state.selectedBranch = 'feature';
  reconcileSelectedBranch();

  assert.strictEqual(state.selectedBranch, 'feature');
});

test('reconcile: drops a pin whose branch was deleted', () => {
  reset({ branchList: [{ name: 'main', current: true }, { name: 'feature' }] });
  reconcileSelectedBranch();
  state.selectedBranch = 'feature';

  state.branchList = [{ name: 'main', current: true }];
  reconcileSelectedBranch();

  assert.strictEqual(state.selectedBranch, null);
});

test('reconcile: drops a pin when HEAD checks out something else', () => {
  reset({ branchList: [{ name: 'main', current: true }, { name: 'feature' }] });
  reconcileSelectedBranch();
  state.selectedBranch = 'feature';

  // A checkout elsewhere — in the app or in a terminal.
  state.branchList = [{ name: 'main' }, { name: 'feature' }, { name: 'other', current: true }];
  reconcileSelectedBranch();

  assert.strictEqual(state.selectedBranch, null, 'history follows HEAD again');
});

test('reconcile: keeps the pin when HEAD moves onto the pinned branch', () => {
  reset({ branchList: [{ name: 'main', current: true }, { name: 'feature' }] });
  reconcileSelectedBranch();
  state.selectedBranch = 'feature';

  state.branchList = [{ name: 'main' }, { name: 'feature', current: true }];
  reconcileSelectedBranch();

  assert.strictEqual(state.selectedBranch, 'feature', 'the pin and HEAD agree, nothing to drop');
});

test('reconcile: a new commit on the same branch leaves the pin alone', () => {
  reset({ branchList: [{ name: 'main', current: true }, { name: 'feature' }] });
  reconcileSelectedBranch();
  state.selectedBranch = 'feature';

  reconcileSelectedBranch(); // poll tick with an unchanged branch list
  reconcileSelectedBranch();

  assert.strictEqual(state.selectedBranch, 'feature');
});

test('reconcile: keeps a pin on a tag, which is not in branchList', () => {
  reset({
    branchList: [{ name: 'main', current: true }],
    tagList: ['v1.0.0', 'v2.0.0'],
  });
  reconcileSelectedBranch();
  state.selectedBranch = 'v1.0.0';

  reconcileSelectedBranch();

  assert.strictEqual(state.selectedBranch, 'v1.0.0');
});

test('reconcile: drops a pin on a tag that was deleted', () => {
  reset({ branchList: [{ name: 'main', current: true }], tagList: ['v1.0.0'] });
  reconcileSelectedBranch();
  state.selectedBranch = 'v1.0.0';

  state.tagList = [];
  reconcileSelectedBranch();

  assert.strictEqual(state.selectedBranch, null);
});

test('reconcile: a pinned tag is dropped when HEAD checks out elsewhere', () => {
  reset({ branchList: [{ name: 'main', current: true }], tagList: ['v1.0.0'] });
  reconcileSelectedBranch();
  state.selectedBranch = 'v1.0.0';

  state.branchList = [{ name: 'main' }, { name: 'feature', current: true }];
  reconcileSelectedBranch();

  assert.strictEqual(state.selectedBranch, null);
});

test('reconcile: no pin set is a no-op', () => {
  reset({ branchList: [{ name: 'main', current: true }] });

  reconcileSelectedBranch();

  assert.strictEqual(state.selectedBranch, null);
});

test('reconcile: tolerates a detached HEAD, where no branch is current', () => {
  reset({ branchList: [{ name: 'main' }, { name: 'feature' }] });
  reconcileSelectedBranch();
  state.selectedBranch = 'feature';

  // Detaching means headName goes from null to null here — nothing moved.
  reconcileSelectedBranch();

  assert.strictEqual(state.selectedBranch, 'feature');
});

test('resetHeadTracking: makes the next tick drop a pin that is not HEAD', () => {
  // Opening a repo resets tracking, so the first reconcile has no "previous
  // HEAD" to compare against and any stale pin is cleared.
  reset({ branchList: [{ name: 'main', current: true }, { name: 'feature' }] });
  state.selectedBranch = 'feature';

  reconcileSelectedBranch();

  assert.strictEqual(state.selectedBranch, null);
});
