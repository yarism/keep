// renderer/modules/reset-plan.js answers "what would this reset take off the
// branch?" from the history slice already on screen. It is pure, so these tests
// are data in, data out, with no repo and no DOM. See test/README.md for why
// the module is loaded through the esm helper.
import test from 'node:test';
import assert from 'node:assert';
import { loadEsm } from './helpers/esm.mjs';

const { commitsRemovedByReset } = await loadEsm('renderer/modules/reset-plan.js');

// Newest first, the order git log prints them in.
const commits = (...pairs) => pairs.map(([hash, ...parents]) => ({ hash, parents }));

test('reset plan: a linear history drops everything between HEAD and the target', () => {
  const slice = commits(['d', 'c'], ['c', 'b'], ['b', 'a'], ['a']);

  assert.deepStrictEqual(commitsRemovedByReset(slice, 'd', 'b'), ['d', 'c']);
});

test('reset plan: resetting to the parent of the tip drops the tip alone', () => {
  const slice = commits(['c', 'b'], ['b', 'a'], ['a']);

  assert.deepStrictEqual(commitsRemovedByReset(slice, 'c', 'b'), ['c']);
});

test('reset plan: the target itself stays, so resetting to HEAD drops nothing', () => {
  const slice = commits(['b', 'a'], ['a']);

  assert.deepStrictEqual(commitsRemovedByReset(slice, 'b', 'b'), []);
});

test('reset plan: a merged side branch comes off together with the merge', () => {
  //   m ── merge of mainline d and side branch s
  //   d
  //   s   (branched off a, merged back in m)
  //   a
  const slice = commits(['m', 'd', 's'], ['d', 'a'], ['s', 'a'], ['a']);

  assert.deepStrictEqual(commitsRemovedByReset(slice, 'm', 'a'), ['m', 'd', 's']);
});

test('reset plan: resetting onto the mainline keeps the merged side branch out of it', () => {
  const slice = commits(['m', 'd', 's'], ['d', 'a'], ['s', 'a'], ['a']);

  // Only m and s leave: d is the commit being reset onto, and it never had s.
  assert.deepStrictEqual(commitsRemovedByReset(slice, 'm', 'd'), ['m', 's']);
});

test('reset plan: a commit on another branch is refused, not reset onto', () => {
  //   HEAD is b; x is on a branch of its own, so moving onto it is not a rewind
  const slice = commits(['b', 'a'], ['x', 'a'], ['a']);

  assert.strictEqual(commitsRemovedByReset(slice, 'b', 'x'), null);
});

test('reset plan: a descendant of HEAD is refused too', () => {
  const slice = commits(['c', 'b'], ['b', 'a'], ['a']);

  assert.strictEqual(commitsRemovedByReset(slice, 'b', 'c'), null);
});

test('reset plan: refuses when either end is off the loaded slice', () => {
  const slice = commits(['c', 'b'], ['b', 'a'], ['a']);

  assert.strictEqual(commitsRemovedByReset(slice, 'c', 'older'), null);
  assert.strictEqual(commitsRemovedByReset(slice, 'unloaded', 'b'), null);
  assert.strictEqual(commitsRemovedByReset(slice, 'c', null), null);
});

test('reset plan: refuses when a commit that would come off is not loaded', () => {
  // The side branch merged in at m was never paged in, so counting what leaves
  // the branch from this slice alone would come up short.
  const slice = commits(['m', 'd', 'unloaded'], ['d', 'a'], ['a']);

  assert.strictEqual(commitsRemovedByReset(slice, 'm', 'a'), null);
});
