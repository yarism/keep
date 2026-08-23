// renderer/graph.js turns a flat commit list into lanes. It is pure, so these
// tests are plain data in, data out — no repo and no DOM. See test/README.md
// for why the module is loaded through the esm helper.
import test from 'node:test';
import assert from 'node:assert';
import { loadEsm } from './helpers/esm.mjs';

const { buildGraph } = await loadEsm('renderer/graph.js');

// Commits are newest first, the order git log prints them in.
const commits = (...pairs) => pairs.map(([hash, ...parents]) => ({ hash, parents }));

test('graph: a linear history is one lane, every node in it', () => {
  const { rows, laneCount } = buildGraph(commits(['c', 'b'], ['b', 'a'], ['a']));

  assert.strictEqual(laneCount, 1);
  assert.deepStrictEqual(rows.map(r => r.lane), [0, 0, 0]);
  assert.ok(rows.every(r => !r.isMerge));
});

test('graph: the newest commit has no line above it and the oldest none below', () => {
  const { rows } = buildGraph(commits(['b', 'a'], ['a']));

  assert.deepStrictEqual(rows[0].top, []);
  assert.deepStrictEqual(rows[0].bottom, [{ from: 0, to: 0, color: 0 }]);
  assert.deepStrictEqual(rows[1].top, [{ from: 0, to: 0, color: 0 }]);
  assert.deepStrictEqual(rows[1].bottom, []);
});

test('graph: a merge forks a second lane and the branch point joins it back', () => {
  //   m ── merge of mainline d and side branch b
  //   d
  //   b   (side)
  //   a   (both descend from here)
  const { rows, laneCount } = buildGraph(
    commits(['m', 'd', 'b'], ['d', 'a'], ['b', 'a'], ['a']));
  const [m, d, b, a] = rows;

  assert.strictEqual(laneCount, 2, 'the side branch gets a lane of its own');
  assert.strictEqual(m.isMerge, true);
  assert.strictEqual(m.lane, 0, 'the merge stays on the mainline');
  assert.ok(m.bottom.some(e => e.from === 0 && e.to === 1),
    'a line leaves the merge for the second parent\'s lane');
  assert.strictEqual(d.lane, 0, 'the first parent inherits the lane');
  assert.strictEqual(b.lane, 1, 'the second parent sits in the forked lane');
  assert.strictEqual(a.lane, 0);
  assert.ok(a.top.some(e => e.from === 1 && e.to === 0),
    'the shared ancestor draws the side lane back into the node');
  assert.deepStrictEqual(a.bottom, [], 'and nothing carries on below it');
});

test('graph: a line colour is the lane furthest from the node, so it never changes mid-line', () => {
  const { rows } = buildGraph(commits(['m', 'd', 'b'], ['d', 'a'], ['b', 'a'], ['a']));

  const fork = rows[0].bottom.find(e => e.to === 1);
  assert.strictEqual(fork.color, 1, 'leaving the node it is already the new lane\'s colour');
  const rejoin = rows[3].top.find(e => e.from === 1);
  assert.strictEqual(rejoin.color, 1, 'and arriving it is still that lane\'s colour');
});

test('graph: a lane is reused once nothing is waiting on it', () => {
  // Two side branches, one after the other. The second must take lane 1 back
  // rather than opening lane 2, or the graph widens with every merge ever made.
  const { laneCount } = buildGraph(commits(
    ['m2', 'd2', 'b2'], ['d2', 'x'], ['b2', 'x'], ['x', 'm1'],
    ['m1', 'd1', 'b1'], ['d1', 'a'], ['b1', 'a'], ['a'],
  ));

  assert.strictEqual(laneCount, 2);
});

test('graph: a parent outside the window keeps its lane open downwards', () => {
  // What the 200-commit limit produces: the last row still has a parent, and
  // the line has to run off the bottom rather than stopping dead.
  const { rows } = buildGraph(commits(['b', 'a']));

  assert.deepStrictEqual(rows[0].bottom, [{ from: 0, to: 0, color: 0 }]);
});

test('graph: an empty list draws nothing', () => {
  assert.deepStrictEqual(buildGraph([]), { rows: [], laneCount: 0 });
});
