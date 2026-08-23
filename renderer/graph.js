// Commit graph lane assignment.
//
// Turns the flat, newest-first list `git log` returns into what a drawing needs:
// which column ("lane") each commit sits in, and which line segments cross each
// row. It is a pure function of the commit list — no DOM, no colours, no pixel
// sizes — so the layout can be tested on its own and the renderer stays a
// matter of turning lanes into coordinates.
//
// The rule is the one every git GUI uses: a lane is reserved by the first child
// that claims a commit, and a commit's *first* parent inherits the lane it was
// drawn in, so the mainline stays a straight column and side branches get lanes
// of their own. Lanes are freed the moment nothing is waiting on them, and the
// freed slot is reused, which keeps the graph narrow instead of growing a
// column per branch ever created.

function firstFree(lanes) {
  const i = lanes.indexOf(null);
  return i === -1 ? lanes.length : i;
}

function trimTrailing(lanes) {
  while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
}

// commits: [{ hash, parents: [hash, …] }, …], newest first (git log order).
// Returns { rows, laneCount } where rows[i] describes commits[i]:
//   lane     the column the commit's node sits in
//   isMerge  it has more than one parent
//   top      segments in the upper half of the row: { from, to, color }
//   bottom   segments in the lower half
// `from`/`to` are lane indices — `from` at the row's edge, `to` at the node's
// vertical centre for `top`, the other way round for `bottom` — and `color` is
// the lane whose identity the segment carries, which is the end furthest from
// the node so a line keeps one colour along its whole length.
export function buildGraph(commits) {
  let lanes = [];  // lanes[i] = the hash that lane is waiting to draw, or null
  const rows = [];
  let laneCount = 0;

  for (const commit of commits) {
    const before = lanes.slice();
    const parents = commit.parents || [];

    // A commit with no child in view starts a lane; otherwise it takes the one
    // its first-seen child reserved.
    let lane = lanes.indexOf(commit.hash);
    if (lane === -1) lane = firstFree(lanes);

    // Other lanes waiting on the same commit are its other children: they end
    // here, converging into this node.
    lanes = lanes.map((h, i) => (i !== lane && h === commit.hash ? null : h));

    // The first parent continues this lane. The rest fork off into lanes of
    // their own — unless some lane is already waiting on that parent, in which
    // case this is a merge and the line joins the existing lane.
    lanes[lane] = parents.length ? parents[0] : null;
    const forks = [];
    for (let k = 1; k < parents.length; k++) {
      let pl = lanes.indexOf(parents[k]);
      if (pl === -1) { pl = firstFree(lanes); lanes[pl] = parents[k]; }
      forks.push(pl);
    }

    trimTrailing(lanes);
    const after = lanes.slice();

    const top = [];
    before.forEach((h, i) => {
      if (!h) return;
      // Enters the node, or passes it by.
      top.push(h === commit.hash ? { from: i, to: lane, color: i } : { from: i, to: i, color: i });
    });

    const bottom = [];
    after.forEach((h, i) => {
      if (!h) return;
      if (i === lane) bottom.push({ from: lane, to: lane, color: lane });
      else if (before[i] === h) bottom.push({ from: i, to: i, color: i });
    });
    // Drawn after the pass-throughs so a fork line lands on top of them.
    forks.forEach(i => bottom.push({ from: lane, to: i, color: i }));

    laneCount = Math.max(laneCount, before.length, after.length, lane + 1);
    rows.push({ hash: commit.hash, lane, isMerge: parents.length > 1, top, bottom });
  }

  return { rows, laneCount };
}
