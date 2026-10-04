// The words for a conflict: what is paused, what the two versions in play are
// called, and what choosing either one does to a file.
//
// Pure functions over what git.js reports, kept away from the DOM so the
// wording can be tested without a repository or a window.

const OPERATIONS = {
  merge: 'Merge',
  rebase: 'Rebase',
  'cherry-pick': 'Cherry-pick',
  revert: 'Revert',
};

// Conflicted files lead the list: they are what stands between the rest of it
// and a commit. Within each group the order is left as git reported it.
export function conflictsFirst(files) {
  return [...files.filter(f => f.conflicted), ...files.filter(f => !f.conflicted)];
}

// The banner. The count is the headline, because the conflicts are the news.
// The operation they interrupted is the line under it, said as paused: the
// "Rebasing main" that used to head the banner read as something still running.
export function bannerText(repoState, conflicts) {
  const { kind, branch, step, total } = repoState;
  const op = OPERATIONS[kind];
  if (conflicts) {
    const title = `${conflicts} ${conflicts === 1 ? 'file has' : 'files have'} conflicts`;
    // A stash applied over changes it does not fit leaves conflicts with no
    // operation in flight, so there is nothing to continue afterwards.
    if (!op) return { title, detail: 'Resolve each file to clear them.' };
    const what = branch ? `${op} of ${branch}` : op;
    const where = kind === 'rebase' && total ? ` at commit ${step} of ${total}` : '';
    const then = kind === 'merge' ? 'commit the merge' : 'continue';
    return { title, detail: `${what} paused${where}. Resolve each file, then ${then}.` };
  }
  const what = `${(op || '').toLowerCase()}${branch ? ` of ${branch}` : ''}`;
  return {
    title: 'All conflicts resolved',
    detail: kind === 'merge' ? `Commit the ${what} to finish.` : `Continue to finish the ${what}.`,
  };
}

const commitLine = (commit) => (commit ? `${commit.hash} ${commit.subject}` : '');

// What to call each side of a conflict, and a line saying what it is.
//
// git calls them "ours" and "theirs", which is only what they sound like in a
// merge. In a rebase "ours" is the branch being rebased onto and "theirs" is
// the commit being replayed, usually the user's own work, so taking "ours"
// there throws their change away. Neither word reaches the screen: each side
// is named as the branch or commit it is, from what git.js found in `sides`.
export function describeSides(repoState) {
  const { kind, branch } = repoState;
  const { ours = {}, theirs = {} } = repoState.sides || {};
  const hash = (side) => (side.commit ? side.commit.hash : '');
  const here = { name: ours.ref || 'This Branch', detail: 'The branch you are on' };

  if (kind === 'rebase') {
    const commit = theirs.commit;
    return {
      ours: {
        name: ours.ref || hash(ours) || 'The New Base',
        detail: ours.pulled ? 'What you pulled' : 'What you are rebasing onto',
      },
      theirs: {
        // Usually the user's own commit, but a rebased branch can carry anyone's.
        name: !commit ? 'Replayed Commit' : (commit.mine ? 'Your Commit' : `Commit by ${commit.author}`),
        detail: commitLine(commit),
      },
    };
  }
  if (kind === 'merge') {
    return {
      ours: here,
      theirs: {
        name: theirs.ref || branch || hash(theirs) || 'The Other Branch',
        detail: theirs.pulled ? 'What you pulled' : 'What you are merging in',
      },
    };
  }
  if (kind === 'cherry-pick') {
    return { ours: here, theirs: { name: 'Picked Commit', detail: commitLine(theirs.commit) } };
  }
  if (kind === 'revert') {
    return {
      ours: here,
      theirs: { name: 'The Revert', detail: theirs.commit ? `Undoing ${commitLine(theirs.commit)}` : '' },
    };
  }
  // Nothing in flight: the conflict came from applying a stash.
  return { ours: here, theirs: { name: 'Stashed Changes', detail: 'What the stash holds' } };
}

// Which side still has the file, ours first, for each kind of conflict git can
// report. Taking a side that has no file means the file goes.
const HAS_FILE = {
  'both modified': [true, true],
  'both added': [true, true],
  'deleted by them': [true, false],
  'added by us': [true, false],
  'deleted by us': [false, true],
  'added by them': [false, true],
  'both deleted': [false, false],
};

// What taking each side does to the file: 'use' when both sides have a version
// and this is one of them, 'keep' when this is the only side that has the file,
// 'remove' when this side deleted it or never had it.
export function sideActions(conflictKind) {
  const [ours, theirs] = HAS_FILE[conflictKind] || [true, true];
  const action = (has, otherHas) => (!has ? 'remove' : (otherHas ? 'use' : 'keep'));
  return { ours: action(ours, theirs), theirs: action(theirs, ours) };
}

// How many conflicts are still marked in a file's text: lines opening with
// seven "<", the same test renderConflict tints them by.
export function conflictRegions(text) {
  if (!text) return 0;
  return text.split('\n').filter(line => line.startsWith('<<<<<<<')).length;
}

// A sentence or two on what happened to a file, for above its two sides.
// `details` is what git.js conflictDetails found on disk, and `sides` is
// describeSides' answer, for the names.
export function describeConflict(file, details, sides) {
  const ours = sides.ours.name, theirs = sides.theirs.name;
  switch (file.conflictKind) {
    case 'deleted by them': return `${theirs} deleted this file, ${ours} changed it.`;
    case 'deleted by us': return `${ours} deleted this file, ${theirs} changed it.`;
    case 'added by us': return `Only ${ours} has this file.`;
    case 'added by them': return `Only ${theirs} has this file.`;
    case 'both deleted': return 'Both sides removed this file.';
  }
  const what = file.conflictKind === 'both added' ? 'Both sides added this file' : 'Both sides changed this file';
  if (details.text === null) return `${what}. It is not on disk any more.`;
  const regions = conflictRegions(details.text);
  if (regions) {
    const where = regions === 1 ? 'the marked region' : `the ${regions} marked regions`;
    return `${what}. Pick a version, or edit ${where} and mark it resolved.`;
  }
  // Which one is on disk is said on the side itself, where its name already is.
  if (details.onDisk) return `${what}, and git could not combine them: only one version is on disk.`;
  return `${what}. The copy on disk has no conflict markers left in it.`;
}

// The line right above the pane's content, saying what that content is.
export function conflictCaption(details) {
  const regions = conflictRegions(details.text);
  if (regions) return `${regions} conflicting region${regions !== 1 ? 's' : ''} in the file`;
  if (details.sidesDiff) return 'Where the two versions differ';
  return details.text === null ? '' : 'The file as it is on disk';
}

// Where to go once `done` are resolved: the next conflicted file further down
// the list, or failing that the first one still left, or null when these were
// the last. Matched by path, because a list that has been read again holds new
// objects.
export function nextConflict(files, done) {
  const gone = new Set(done.map(f => f.filePath));
  let last = -1;
  files.forEach((f, i) => { if (gone.has(f.filePath)) last = i; });
  const open = (f) => f.conflicted && !gone.has(f.filePath);
  return files.find((f, i) => i > last && open(f)) || files.find(open) || null;
}
