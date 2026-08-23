// Write-side coverage for git.js: staging, committing, branching, stashing and
// the hunk-level patch operations. Each test asserts the resulting repo state
// rather than the command's stdout, since stdout is not what the UI relies on.
const test = require('node:test');
const assert = require('node:assert');

const git = require('../git');
const h = require('./helpers/repo');

test.after(() => h.cleanup());

// Read back what git.status() would show for one path.
const statusOf = async (repo, filePath) =>
  (await git.status(repo)).filter(f => f.filePath === filePath);

// ── staging ──

test('stage: moves an untracked file into the index', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'new.txt', 'x\n');

  await git.stage(repo, 'new.txt');

  assert.partialDeepStrictEqual(await statusOf(repo, 'new.txt'), [
    { status: 'added', staged: true },
  ]);
});

test('stage: handles a path that looks like an option', async () => {
  const repo = h.makeRepo();
  h.write(repo, '--weird-name.txt', 'x\n');

  // stage() passes `--` before the path, so this must not be read as a flag.
  await git.stage(repo, '--weird-name.txt');

  assert.partialDeepStrictEqual(await statusOf(repo, '--weird-name.txt'), [
    { status: 'added', staged: true },
  ]);
});

test('unstage: returns a staged file to the working tree', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'README.md', '# edited\n');
  await git.stage(repo, 'README.md');

  await git.unstage(repo, 'README.md');

  assert.partialDeepStrictEqual(await statusOf(repo, 'README.md'), [
    { status: 'modified', staged: false },
  ]);
});

test('unstage: fully unstages a rename, not just the new path', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'old.txt', 'a long enough body for rename detection to fire\n');
  h.commitAll(repo, 'add old.txt');
  h.git(repo, 'mv', 'old.txt', 'new.txt');
  const [renamed] = await git.status(repo);

  await git.unstage(repo, renamed.filePath, renamed.oldPath);

  // Dropping only the new path would leave "D old.txt" staged. Fully unstaged,
  // a rename reads as an unstaged deletion plus an untracked file.
  const files = await git.status(repo);
  assert.ok(files.every(f => !f.staged), 'nothing is left in the index');
  assert.partialDeepStrictEqual(
    files.find(f => f.filePath === 'old.txt'), { status: 'deleted', staged: false },
  );
  assert.partialDeepStrictEqual(
    files.find(f => f.filePath === 'new.txt'), { status: 'untracked' },
  );
});

test('unstage: without an old path behaves exactly as before', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'a.txt', 'x\n');
  await git.stage(repo, 'a.txt');

  await git.unstage(repo, 'a.txt', null);

  assert.partialDeepStrictEqual(await statusOf(repo, 'a.txt'), [{ status: 'untracked' }]);
});

test('stageAll: stages modifications, additions and deletions together', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'doomed.txt', 'contents of the doomed file\n');
  h.commitAll(repo, 'add doomed.txt');
  h.write(repo, 'README.md', '# edited\n');
  // Distinct contents, or git pairs the delete and the add into one rename.
  h.write(repo, 'brand-new.txt', 'contents of the brand new file\n');
  h.remove(repo, 'doomed.txt');

  await git.stageAll(repo);

  const files = await git.status(repo);
  assert.ok(files.every(f => f.staged), 'nothing is left unstaged');
  assert.deepStrictEqual(
    files.map(f => f.filePath).sort(),
    ['README.md', 'brand-new.txt', 'doomed.txt'],
  );
});

// ── commit ──

test('commit: records the staged changes under the given message', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'a.txt', 'a\n');
  await git.stage(repo, 'a.txt');

  await git.commit(repo, 'a commit from the app');

  const [head] = await git.log(repo, null, 1);
  assert.strictEqual(head.subject, 'a commit from the app');
  assert.deepStrictEqual(await git.status(repo), []);
});

test('commit: leaves unstaged work alone', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'staged.txt', 'x\n');
  await git.stage(repo, 'staged.txt');
  h.write(repo, 'not-staged.txt', 'x\n');

  await git.commit(repo, 'only the staged file');

  assert.partialDeepStrictEqual(await git.status(repo), [
    { filePath: 'not-staged.txt', status: 'untracked' },
  ]);
});

test('commit: rejects when there is nothing staged', async () => {
  const repo = h.makeRepo();
  await assert.rejects(() => git.commit(repo, 'empty'));
});

// ── branches ──

test('createBranch: creates the branch and checks it out', async () => {
  const repo = h.makeRepo();

  await git.createBranch(repo, 'feature/x');

  const branches = await git.branches(repo);
  assert.strictEqual(branches.find(b => b.name === 'feature/x').current, true);
});

test('createBranch: can branch from an explicit start point', async () => {
  const repo = h.makeRepo();
  const base = h.git(repo, 'rev-parse', 'HEAD').trim();
  h.write(repo, 'later.txt', 'x\n');
  h.commitAll(repo, 'a later commit');

  await git.createBranch(repo, 'from-base', base);

  const [head] = await git.log(repo, 'from-base', 1);
  assert.strictEqual(head.hash, base);
});

test('createBranch: rejects a name that already exists', async () => {
  const repo = h.makeRepo();
  await assert.rejects(() => git.createBranch(repo, 'main'));
});

test('checkout: switches HEAD to another branch', async () => {
  const repo = h.makeRepo();
  h.git(repo, 'branch', 'other');

  await git.checkout(repo, 'other');

  assert.strictEqual((await git.repoFingerprint(repo)).branch, 'other');
});

test('deleteBranch: removes a merged branch', async () => {
  const repo = h.makeRepo();
  h.git(repo, 'branch', 'scratch');

  await git.deleteBranch(repo, 'scratch');

  assert.ok(!(await git.branches(repo)).some(b => b.name === 'scratch'));
});

test('deleteBranch: refuses an unmerged branch (-d, not -D)', async () => {
  const repo = h.makeRepo();
  await git.createBranch(repo, 'unmerged');
  h.write(repo, 'work.txt', 'x\n');
  h.commitAll(repo, 'unmerged work');
  await git.checkout(repo, 'main');

  await assert.rejects(() => git.deleteBranch(repo, 'unmerged'), /not fully merged/i);
  assert.ok((await git.branches(repo)).some(b => b.name === 'unmerged'),
    'the branch survives the refusal');
});

test('renameBranch: renames without moving HEAD off it', async () => {
  const repo = h.makeRepo();

  await git.renameBranch(repo, 'main', 'trunk');

  const branches = await git.branches(repo);
  assert.deepStrictEqual(branches.map(b => b.name), ['trunk']);
  assert.strictEqual(branches[0].current, true);
});

// ── merge / rebase ──

test('merge: fast-forwards main onto the feature branch', async () => {
  const repo = h.makeRepo();
  await git.createBranch(repo, 'feature');
  h.write(repo, 'f.txt', 'x\n');
  const featureHead = h.commitAll(repo, 'feature work');
  await git.checkout(repo, 'main');

  await git.merge(repo, 'feature');

  const [head] = await git.log(repo, 'main', 1);
  assert.strictEqual(head.hash, featureHead);
});

test('merge: rejects on a conflict and leaves the repo mid-merge', async () => {
  const repo = h.makeRepo();
  await git.createBranch(repo, 'feature');
  h.write(repo, 'README.md', '# feature version\n');
  h.commitAll(repo, 'feature edit');
  await git.checkout(repo, 'main');
  h.write(repo, 'README.md', '# main version\n');
  h.commitAll(repo, 'main edit');

  await assert.rejects(() => git.merge(repo, 'feature'));
  assert.match(h.read(repo, 'README.md'), /<<<<<<</, 'conflict markers are written out');
});

test('rebase: replays commits onto the target branch', async () => {
  const repo = h.makeRepo();
  await git.createBranch(repo, 'feature');
  h.write(repo, 'f.txt', 'x\n');
  h.commitAll(repo, 'feature work');
  await git.checkout(repo, 'main');
  h.write(repo, 'm.txt', 'x\n');
  const mainHead = h.commitAll(repo, 'main work');
  await git.checkout(repo, 'feature');

  await git.rebase(repo, 'main');

  const subjects = (await git.log(repo, 'feature')).map(c => c.subject);
  assert.deepStrictEqual(subjects, ['feature work', 'main work', 'initial']);
  const detail = await git.commitDetail(repo, (await git.log(repo, 'feature', 1))[0].hash);
  assert.strictEqual(detail.parents, mainHead, 'replayed on top of main');
});

// ── stash ──

test('stashSave: stows working-tree changes and records the message', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'README.md', '# work in progress\n');

  await git.stashSave(repo, 'wip on the readme');

  assert.deepStrictEqual(await git.status(repo), [], 'the tree is clean again');
  const stashes = await git.stashes(repo);
  assert.strictEqual(stashes.length, 1);
  assert.match(stashes[0].message, /wip on the readme/);
});

test('stashSave: works without a message', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'README.md', '# wip\n');

  await git.stashSave(repo);

  const stashes = await git.stashes(repo);
  assert.strictEqual(stashes.length, 1);
  assert.match(stashes[0].message, /WIP on main/);
});

test('stashApply: restores the changes and keeps the stash entry', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'README.md', '# stashed content\n');
  await git.stashSave(repo, 'wip');

  await git.stashApply(repo, 0);

  assert.strictEqual(h.read(repo, 'README.md'), '# stashed content\n');
  assert.strictEqual((await git.stashes(repo)).length, 1, 'apply does not pop');
});

test('stashDrop: removes the entry at the given index', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'README.md', '# first\n');
  await git.stashSave(repo, 'first');
  h.write(repo, 'README.md', '# second\n');
  await git.stashSave(repo, 'second');

  await git.stashDrop(repo, 0); // drops the newest, "second"

  const stashes = await git.stashes(repo);
  assert.strictEqual(stashes.length, 1);
  assert.match(stashes[0].message, /first/);
});

test('stashDrop: rejects an index that does not exist', async () => {
  const repo = h.makeRepo();
  await assert.rejects(() => git.stashDrop(repo, 3));
});

// ── revert / tag ──

test('revert: adds an inverse commit without prompting for a message', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'oops.txt', 'a mistake\n');
  const bad = h.commitAll(repo, 'add a mistake');

  await git.revert(repo, bad);

  assert.ok(!h.exists(repo, 'oops.txt'), 'the file is gone again');
  const [head] = await git.log(repo, null, 1);
  assert.match(head.subject, /^Revert "add a mistake"$/);
});

test('createTag: tags HEAD when no ref is given', async () => {
  const repo = h.makeRepo();

  await git.createTag(repo, 'v1.0.0');

  assert.deepStrictEqual(await git.tags(repo), ['v1.0.0']);
  assert.strictEqual(
    h.git(repo, 'rev-parse', 'v1.0.0').trim(),
    h.git(repo, 'rev-parse', 'HEAD').trim(),
  );
});

test('createTag: tags an explicit ref', async () => {
  const repo = h.makeRepo();
  const base = h.git(repo, 'rev-parse', 'HEAD').trim();
  h.write(repo, 'later.txt', 'x\n');
  h.commitAll(repo, 'later');

  await git.createTag(repo, 'v0.1.0', base);

  assert.strictEqual(h.git(repo, 'rev-parse', 'v0.1.0').trim(), base);
});

test('createTag: rejects a duplicate tag name', async () => {
  const repo = h.makeRepo();
  await git.createTag(repo, 'v1.0.0');
  await assert.rejects(() => git.createTag(repo, 'v1.0.0'), /already exists/i);
});

// ── discard ──

test('discardFile: restores a modified file from the index', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'README.md', '# unwanted edit\n');

  await git.discardFile(repo, 'README.md');

  assert.strictEqual(h.read(repo, 'README.md'), '# Test repo\n');
  assert.deepStrictEqual(await git.status(repo), []);
});

test('discardFile: rejects for an untracked file', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'untracked.txt', 'x\n');

  // `git checkout -- <path>` has nothing to restore from, so this surfaces as an
  // error rather than silently doing nothing.
  await assert.rejects(() => git.discardFile(repo, 'untracked.txt'));
  assert.ok(h.exists(repo, 'untracked.txt'));
});

// ── hunk-level operations ──

// A file whose two edits are far enough apart that git emits two hunks.
function twoHunkFile(repo) {
  const original = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  h.write(repo, 'many.txt', original);
  h.commitAll(repo, 'add many.txt');

  const edited = original
    .replace('line 2\n', 'line 2 EDITED AT TOP\n')
    .replace('line 29\n', 'line 29 EDITED AT BOTTOM\n');
  h.write(repo, 'many.txt', edited);
}

// git.js identifies a hunk by the leading "@@ ... @@" of its header.
async function hunkHeaders(repo, filePath) {
  const diff = await git.diff(repo, filePath, false);
  return diff.split('\n')
    .filter(l => l.startsWith('@@'))
    .map(l => l.split('@@').slice(0, 2).join('@@') + '@@');
}

test('stageHunk: stages only the requested hunk', async () => {
  const repo = h.makeRepo();
  twoHunkFile(repo);
  const [firstHunk] = await hunkHeaders(repo, 'many.txt');

  await git.stageHunk(repo, 'many.txt', firstHunk);

  const staged = await git.diff(repo, 'many.txt', true);
  assert.match(staged, /EDITED AT TOP/);
  assert.ok(!/EDITED AT BOTTOM/.test(staged), 'the second hunk stays unstaged');

  const files = await statusOf(repo, 'many.txt');
  assert.strictEqual(files.length, 2, 'the file is now both staged and modified');
});

test('stageHunk: rejects an unknown hunk header', async () => {
  const repo = h.makeRepo();
  twoHunkFile(repo);

  await assert.rejects(
    () => git.stageHunk(repo, 'many.txt', '@@ -999,1 +999,1 @@'),
    /Hunk not found/,
  );
});

test('discardHunk: reverts only the requested hunk in the working tree', async () => {
  const repo = h.makeRepo();
  twoHunkFile(repo);
  const [firstHunk] = await hunkHeaders(repo, 'many.txt');

  await git.discardHunk(repo, 'many.txt', firstHunk);

  const contents = h.read(repo, 'many.txt');
  assert.ok(!/EDITED AT TOP/.test(contents), 'the discarded edit is gone');
  assert.match(contents, /EDITED AT BOTTOM/, 'the other edit survives');
});

test('discardHunk: rejects an unknown hunk header', async () => {
  const repo = h.makeRepo();
  twoHunkFile(repo);

  await assert.rejects(
    () => git.discardHunk(repo, 'many.txt', '@@ -999,1 +999,1 @@'),
    /Hunk not found/,
  );
});

// ── conflicts ──
//
// Every test here builds the same shape: two branches that changed the same
// line, so merging one into the other stops with an unmerged path.

function conflictingRepo(repoPath) {
  const repo = repoPath || h.makeRepo();
  h.write(repo, 'shared.txt', 'original\n');
  h.commitAll(repo, 'add shared');
  h.git(repo, 'checkout', '-q', '-b', 'theirs');
  h.write(repo, 'shared.txt', 'their version\n');
  h.commitAll(repo, 'their change');
  h.git(repo, 'checkout', '-q', 'main');
  h.write(repo, 'shared.txt', 'our version\n');
  h.commitAll(repo, 'our change');
  return repo;
}

async function startConflict(repo) {
  // The merge is expected to fail — that failure is the state under test.
  await assert.rejects(() => git.merge(repo, 'theirs'));
}

test('status: an unmerged path is reported as conflicted, not as staged', async () => {
  const repo = conflictingRepo();
  await startConflict(repo);

  const files = await git.status(repo);

  assert.strictEqual(files.length, 1, 'one entry, not a staged/unstaged pair');
  const [file] = files;
  assert.strictEqual(file.filePath, 'shared.txt');
  assert.strictEqual(file.status, 'conflicted');
  assert.strictEqual(file.conflicted, true);
  assert.strictEqual(file.conflictKind, 'both modified');
  assert.strictEqual(file.staged, false,
    'a conflict the user has not looked at must never look ready to commit');
});

test('repoState: reports the merge in progress and what is unresolved', async () => {
  const repo = conflictingRepo();
  await startConflict(repo);

  const s = await git.repoState(repo);

  assert.strictEqual(s.kind, 'merge');
  assert.strictEqual(s.branch, 'theirs', 'named after the branch being merged');
  assert.deepStrictEqual(s.conflicts, ['shared.txt']);
});

test('repoState: a clean repository is in the middle of nothing', async () => {
  const repo = h.makeRepo();

  const s = await git.repoState(repo);

  assert.strictEqual(s.kind, null);
  assert.deepStrictEqual(s.conflicts, []);
});

test('repoState: reports a rebase, with its position in the sequence', async () => {
  const repo = conflictingRepo();
  await assert.rejects(() => git.rebase(repo, 'theirs'));

  const s = await git.repoState(repo);

  assert.strictEqual(s.kind, 'rebase');
  assert.deepStrictEqual(s.conflicts, ['shared.txt']);
  assert.ok(s.total >= 1, 'knows how many commits the rebase has to replay');
});

test('useOurs: keeps this branch\'s version and marks the file resolved', async () => {
  const repo = conflictingRepo();
  await startConflict(repo);

  await git.useOurs(repo, 'shared.txt');

  assert.strictEqual(h.read(repo, 'shared.txt'), 'our version\n');
  assert.deepStrictEqual((await git.repoState(repo)).conflicts, [],
    'nothing is left unmerged');
});

test('useTheirs: takes the incoming version instead', async () => {
  const repo = conflictingRepo();
  await startConflict(repo);

  await git.useTheirs(repo, 'shared.txt');

  assert.strictEqual(h.read(repo, 'shared.txt'), 'their version\n');
  assert.deepStrictEqual((await git.repoState(repo)).conflicts, []);
});

test('markResolved: accepts a hand-edited file and clears the conflict', async () => {
  const repo = conflictingRepo();
  await startConflict(repo);
  h.write(repo, 'shared.txt', 'a bit of both\n');

  await git.markResolved(repo, 'shared.txt');

  const files = await git.status(repo);
  assert.ok(!files.some(f => f.conflicted), 'no conflict remains');
  assert.deepStrictEqual((await git.repoState(repo)).conflicts, []);
});

test('continueOperation: finishes a resolved merge without opening an editor', async () => {
  const repo = conflictingRepo();
  await startConflict(repo);
  await git.useOurs(repo, 'shared.txt');

  await git.continueOperation(repo, 'merge');

  const s = await git.repoState(repo);
  assert.strictEqual(s.kind, null, 'the merge is over');
  const [head] = await git.log(repo, 'main');
  assert.match(head.subject, /Merge branch/);
  assert.strictEqual(head.parents.length, 2, 'and it really is a merge commit');
});

test('continueOperation: replays the rest of a resolved rebase', async () => {
  const repo = conflictingRepo();
  await assert.rejects(() => git.rebase(repo, 'theirs'));
  await git.useTheirs(repo, 'shared.txt');

  await git.continueOperation(repo, 'rebase');

  assert.strictEqual((await git.repoState(repo)).kind, null);
});

test('abortOperation: puts the working copy back the way it was', async () => {
  const repo = conflictingRepo();
  const before = await git.log(repo, 'main');
  await startConflict(repo);

  await git.abortOperation(repo, 'merge');

  const s = await git.repoState(repo);
  assert.strictEqual(s.kind, null);
  assert.deepStrictEqual(s.conflicts, []);
  assert.strictEqual(h.read(repo, 'shared.txt'), 'our version\n');
  assert.deepStrictEqual((await git.log(repo, 'main')).map(c => c.hash), before.map(c => c.hash),
    'and history is exactly where it started');
});

test('status: a delete/modify conflict is named as such', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'doomed.txt', 'original\n');
  h.commitAll(repo, 'add doomed');
  h.git(repo, 'checkout', '-q', '-b', 'theirs');
  h.remove(repo, 'doomed.txt');
  h.git(repo, 'add', '-A');
  h.git(repo, 'commit', '-q', '-m', 'delete it');
  h.git(repo, 'checkout', '-q', 'main');
  h.write(repo, 'doomed.txt', 'edited\n');
  h.commitAll(repo, 'edit it');
  await assert.rejects(() => git.merge(repo, 'theirs'));

  const [file] = await git.status(repo);

  assert.strictEqual(file.status, 'conflicted');
  assert.strictEqual(file.conflictKind, 'deleted by them');
});
