// Tests for renderer/worktree-info.js: what a worktree row is called, which
// agent made it, where a refused checkout points, and the folder a new one is
// offered. Pure functions, loaded the way state.js is.
import test from 'node:test';
import assert from 'node:assert';

import { loadEsm } from './helpers/esm.mjs';

const {
  worktreeSource, basename, worktreeLabel, worktreeTag, parseCheckoutRefusal,
  defaultWorktreeFolder, dirtyBadgeTitle,
} = await loadEsm('renderer/worktree-info.js');

test('worktreeSource: recognises the two agents by where they keep worktrees', () => {
  assert.strictEqual(worktreeSource('/Users/j/dev/StepSaga/.claude/worktrees/pensive-lamport-240e8b'), 'Claude Code');
  assert.strictEqual(worktreeSource('/Users/j/.copilot/repos/copilot-worktrees/pros-admin/joakim-5-volvo'), 'Copilot');
  assert.strictEqual(worktreeSource('/Users/j/dev/keep-fix-login'), null);
  assert.strictEqual(worktreeSource(null), null);
});

test('basename: last segment, trailing slash or not', () => {
  assert.strictEqual(basename('/Users/j/dev/keep'), 'keep');
  assert.strictEqual(basename('/Users/j/dev/keep/'), 'keep');
  assert.strictEqual(basename(''), '');
});

test('worktreeLabel: the branch, or the commit for a detached HEAD', () => {
  assert.strictEqual(worktreeLabel({ branch: 'claude/pensive-lamport', head: 'abc' }), 'claude/pensive-lamport');
  assert.strictEqual(worktreeLabel({ branch: null, head: 'a13d8a9f00000000', path: '/x/y' }), 'a13d8a9 (detached)');
  assert.strictEqual(worktreeLabel({ branch: null, head: null, path: '/x/bare.git' }), 'bare.git');
});

test('worktreeTag: the repository folder for the main worktree, the agent or folder for the rest', () => {
  const main = '/Users/j/dev/StepSaga';
  assert.strictEqual(worktreeTag({ path: main, isMain: true }, main), 'StepSaga');
  assert.strictEqual(worktreeTag({ path: main, isMain: false }, main), 'StepSaga', 'the path alone identifies main too');
  assert.strictEqual(worktreeTag({ path: `${main}/.claude/worktrees/pensive-lamport-240e8b` }, main), 'Claude Code');
  assert.strictEqual(worktreeTag({ path: '/Users/j/.copilot/repos/copilot-worktrees/StepSaga/volvo' }, main), 'Copilot');
  assert.strictEqual(worktreeTag({ path: '/Users/j/dev/StepSaga-fix-login' }, main), 'StepSaga-fix-login');
  assert.strictEqual(worktreeTag({ path: '/a/b', isMain: false }, null), 'b', 'no main known yet');
});

test('parseCheckoutRefusal: both wordings git has used, and nothing else', () => {
  assert.strictEqual(
    parseCheckoutRefusal("fatal: 'feat' is already used by worktree at '/tmp/wt-probe/feat'\n"),
    '/tmp/wt-probe/feat');
  assert.strictEqual(
    parseCheckoutRefusal("fatal: 'feat' is already checked out at '/Users/j/dev/keep-feat'"),
    '/Users/j/dev/keep-feat');
  assert.strictEqual(parseCheckoutRefusal('error: pathspec \'nope\' did not match any file(s) known to git'), null);
  assert.strictEqual(parseCheckoutRefusal(''), null);
});

test('defaultWorktreeFolder: a sibling named after the repository and the branch', () => {
  assert.strictEqual(defaultWorktreeFolder('/Users/j/dev/keep', 'fix-login'), '/Users/j/dev/keep-fix-login');
  assert.strictEqual(defaultWorktreeFolder('/Users/j/dev/keep/', 'feature/login form'), '/Users/j/dev/keep-feature-login-form');
  assert.strictEqual(defaultWorktreeFolder('/Users/j/dev/keep', ''), '/Users/j/dev/keep-worktree');
});

test('dirtyBadgeTitle: the plain count when the work is all in the main worktree', () => {
  assert.strictEqual(dirtyBadgeTitle(1), '1 uncommitted change');
  assert.strictEqual(dirtyBadgeTitle(4, []), '4 uncommitted changes');
  assert.strictEqual(dirtyBadgeTitle(4, [{ tag: 'Copilot', count: 0 }]), '4 uncommitted changes');
});

test('dirtyBadgeTitle: says where the work is when some or all of it is in other worktrees', () => {
  assert.strictEqual(dirtyBadgeTitle(4, [{ tag: 'Claude Code', count: 2 }]),
    '4 uncommitted changes, 2 in the Claude Code worktree');
  assert.strictEqual(dirtyBadgeTitle(2, [{ tag: 'Claude Code', count: 2 }]),
    '2 uncommitted changes, all in the Claude Code worktree');
  assert.strictEqual(dirtyBadgeTitle(5, [{ tag: 'Claude Code', count: 2 }, { tag: 'keep-feat', count: 1 }]),
    '5 uncommitted changes, 3 in other worktrees (Claude Code 2, keep-feat 1)');
  assert.strictEqual(dirtyBadgeTitle(3, [{ tag: 'Claude Code', count: 2 }, { tag: 'keep-feat', count: 1 }]),
    '3 uncommitted changes, all in other worktrees (Claude Code 2, keep-feat 1)');
});
