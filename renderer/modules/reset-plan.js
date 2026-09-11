// Which commits a reset would take off the current branch.
//
// Context menus are built synchronously and cannot go and ask git first (the
// same reason state.remotes exists), so the answer comes from the history slice
// already on screen. That is exact whenever the target is in the slice: git
// hands history over child before parent, so every commit sitting between HEAD
// and the target has already been loaded above it.
//
// `commits` is that slice, newest first, each row carrying `hash` and
// `parents`. Returns the hashes that would leave the branch, in the order they
// appear in the slice, or null when the slice cannot answer the question:
// either end missing, a walk that runs past the loaded rows, or a target that
// is not an ancestor of HEAD and would therefore move the branch sideways onto
// unrelated history rather than backwards along its own.
export function commitsRemovedByReset(commits, headHash, targetHash) {
  const byHash = new Map(commits.map(c => [c.hash, c]));
  if (!headHash || !targetHash) return null;
  if (!byHash.has(headHash) || !byHash.has(targetHash)) return null;
  if (headHash === targetHash) return [];

  // Everything the target keeps: itself and its own ancestors. Nothing here can
  // also be a descendant of the target, so a walk from HEAD that arrives at one
  // of these has left the part of history the reset touches.
  const kept = new Set();
  const keptWalk = [targetHash];
  while (keptWalk.length) {
    const hash = keptWalk.pop();
    if (kept.has(hash)) continue;
    kept.add(hash);
    const commit = byHash.get(hash);
    if (commit) keptWalk.push(...commit.parents);
  }

  // Everything HEAD reaches that the target does not, a merged-in side branch
  // included, since resetting past the merge takes its commits off too.
  const dropped = new Set();
  const seen = new Set();
  const walk = [headHash];
  let reachesTarget = false;
  while (walk.length) {
    const hash = walk.pop();
    if (seen.has(hash)) continue;
    seen.add(hash);
    if (hash === targetHash) { reachesTarget = true; continue; }
    if (kept.has(hash)) continue;
    // A commit that would come off but is not on screen means the walk ran out
    // of loaded history, and any count from here would be short.
    const commit = byHash.get(hash);
    if (!commit) return null;
    dropped.add(hash);
    walk.push(...commit.parents);
  }
  if (!reachesTarget) return null;

  return commits.filter(c => dropped.has(c.hash)).map(c => c.hash);
}
