// Read-side coverage for git.js: the functions that shell out to git and then
// parse its output. The parsing is where the bugs live, so each test sets up a
// repo in a specific shape and checks the objects the UI actually receives.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');

const git = require('../git');
const h = require('./helpers/repo');

test.after(() => h.cleanup());

// ── status ──

test('status: reports an untracked file', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'new.txt', 'hello\n');

  const files = await git.status(repo);

  assert.deepStrictEqual(files, [
    { filePath: 'new.txt', oldPath: null, status: 'untracked', staged: false, x: '?', y: '?' },
  ]);
});

test('status: reports an unstaged modification', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'README.md', '# changed\n');

  const files = await git.status(repo);

  assert.strictEqual(files.length, 1);
  assert.partialDeepStrictEqual(files[0], {
    filePath: 'README.md', status: 'modified', staged: false,
  });
});

test('status: reports a staged addition', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'added.txt', 'x\n');
  h.git(repo, 'add', 'added.txt');

  const files = await git.status(repo);

  assert.strictEqual(files.length, 1);
  assert.partialDeepStrictEqual(files[0], {
    filePath: 'added.txt', status: 'added', staged: true,
  });
});

test('status: a file staged and then modified again yields two entries', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'README.md', '# staged\n');
  h.git(repo, 'add', 'README.md');
  h.write(repo, 'README.md', '# staged then edited again\n');

  const files = await git.status(repo);

  assert.strictEqual(files.length, 2, 'index-vs-HEAD and tree-vs-index are separate rows');
  const staged = files.find(f => f.staged);
  const unstaged = files.find(f => !f.staged);
  assert.partialDeepStrictEqual(staged, { filePath: 'README.md', status: 'modified' });
  assert.partialDeepStrictEqual(unstaged, { filePath: 'README.md', status: 'modified' });
});

test('status: reports deletions on both sides', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'gone.txt', 'bye\n');
  h.write(repo, 'staged-gone.txt', 'bye\n');
  h.commitAll(repo, 'add files to delete');

  h.remove(repo, 'gone.txt');            // deleted in the working tree only
  h.git(repo, 'rm', '-q', 'staged-gone.txt'); // deleted and staged

  const files = await git.status(repo);

  assert.partialDeepStrictEqual(
    files.find(f => f.filePath === 'gone.txt'),
    { status: 'deleted', staged: false },
  );
  assert.partialDeepStrictEqual(
    files.find(f => f.filePath === 'staged-gone.txt'),
    { status: 'deleted', staged: true },
  );
});

test('status: reports a staged rename', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'old-name.txt', 'contents that stay identical\n');
  h.commitAll(repo, 'add file to rename');
  h.git(repo, 'mv', 'old-name.txt', 'new-name.txt');

  const files = await git.status(repo);

  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0].status, 'renamed');
  assert.strictEqual(files[0].staged, true);
  assert.strictEqual(files[0].filePath, 'new-name.txt');
});

// git's non-z porcelain packs a rename into one "old -> new" field, which is
// useless to every path-taking command (stage, discard, trash, show-in-finder).
// status() reads the -z form instead, where the paths are separate fields.
test('status: a rename reports the new path, with the old one alongside', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'old-name.txt', 'contents that stay identical\n');
  h.commitAll(repo, 'add file to rename');
  h.git(repo, 'mv', 'old-name.txt', 'new-name.txt');

  const [renamed] = await git.status(repo);

  assert.strictEqual(renamed.filePath, 'new-name.txt', 'the path that exists on disk');
  assert.strictEqual(renamed.oldPath, 'old-name.txt');
  assert.strictEqual(renamed.status, 'renamed');
});

test('status: a rename with an unstaged edit on top keeps both paths on both rows', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'old-name.txt', 'contents that stay identical\n');
  h.commitAll(repo, 'add file to rename');
  h.git(repo, 'mv', 'old-name.txt', 'new-name.txt');
  h.write(repo, 'new-name.txt', 'contents that stay identical\nplus an edit\n');

  const files = await git.status(repo);

  assert.strictEqual(files.length, 2, 'RM produces a staged row and an unstaged row');
  for (const f of files) {
    assert.strictEqual(f.filePath, 'new-name.txt');
    assert.strictEqual(f.oldPath, 'old-name.txt');
  }
  assert.deepStrictEqual(files.map(f => f.staged), [true, false]);
});

test('status: the record after a rename is not swallowed by its old-path field', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'old-name.txt', 'contents that stay identical\n');
  h.commitAll(repo, 'add file to rename');
  h.git(repo, 'mv', 'old-name.txt', 'new-name.txt');
  h.write(repo, 'zz-after.txt', 'x\n');

  const files = await git.status(repo);

  assert.deepStrictEqual(
    files.map(f => f.filePath).sort(),
    ['new-name.txt', 'zz-after.txt'],
  );
});

// Without -z git C-quotes any path with a space or a non-ASCII byte, and the
// quotes and \NNN escapes were being handed back to the UI as if they were part
// of the filename.
test('status: paths with spaces and non-ASCII characters come back verbatim', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'sp ace.txt', 'x\n');
  h.write(repo, 'caf\u00e9.txt', 'x\n');

  const files = await git.status(repo);

  assert.deepStrictEqual(
    files.map(f => f.filePath).sort(),
    ['caf\u00e9.txt', 'sp ace.txt'],
  );
});

test('status: a renamed path containing a space is still split correctly', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'old name.txt', 'contents that stay identical\n');
  h.commitAll(repo, 'add file to rename');
  h.git(repo, 'mv', 'old name.txt', 'new name.txt');

  const [renamed] = await git.status(repo);

  assert.strictEqual(renamed.filePath, 'new name.txt');
  assert.strictEqual(renamed.oldPath, 'old name.txt');
});

test('status: includes files inside untracked directories (-uall)', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'nested/deep/file.txt', 'x\n');

  const files = await git.status(repo);

  assert.deepStrictEqual(files.map(f => f.filePath), ['nested/deep/file.txt']);
});

test('status: a clean repo returns an empty list', async () => {
  const repo = h.makeRepo();
  assert.deepStrictEqual(await git.status(repo), []);
});

// ── log ──

test('log: parses commits newest-first with all five fields', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'a.txt', 'a\n');
  h.commitAll(repo, 'second commit');

  const commits = await git.log(repo);

  assert.strictEqual(commits.length, 2);
  assert.strictEqual(commits[0].subject, 'second commit');
  assert.strictEqual(commits[1].subject, 'initial');
  assert.match(commits[0].hash, /^[0-9a-f]{40}$/);
  assert.strictEqual(commits[0].author, 'Test Author');
  assert.strictEqual(commits[0].email, 'author@example.com');
  assert.match(commits[0].date, /^\d{4}-\d{2}-\d{2}T/);
});

test('log: honours the limit argument', async () => {
  const repo = h.makeRepo();
  for (let i = 0; i < 4; i++) {
    h.write(repo, `f${i}.txt`, 'x\n');
    h.commitAll(repo, `commit ${i}`);
  }

  const commits = await git.log(repo, null, 2);

  assert.strictEqual(commits.length, 2);
  assert.strictEqual(commits[0].subject, 'commit 3');
});

test('log: scoped to a branch shows only that branch', async () => {
  const repo = h.makeRepo();
  h.git(repo, 'checkout', '-q', '-b', 'feature');
  h.write(repo, 'feature.txt', 'x\n');
  h.commitAll(repo, 'feature work');
  h.git(repo, 'checkout', '-q', 'main');

  const onMain = await git.log(repo, 'main');
  const onFeature = await git.log(repo, 'feature');

  assert.deepStrictEqual(onMain.map(c => c.subject), ['initial']);
  assert.deepStrictEqual(onFeature.map(c => c.subject), ['feature work', 'initial']);
});

test('log: carries the parent hashes the graph is drawn from', async () => {
  const repo = h.makeRepo();
  h.git(repo, 'checkout', '-q', '-b', 'side');
  h.write(repo, 'side.txt', 'x\n');
  h.commitAll(repo, 'side work');
  h.git(repo, 'checkout', '-q', 'main');
  h.write(repo, 'main.txt', 'x\n');
  h.commitAll(repo, 'main work');
  h.git(repo, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');

  const commits = await git.log(repo);
  const merge = commits[0];

  assert.strictEqual(merge.subject, 'merge side');
  assert.strictEqual(merge.parents.length, 2, 'a merge reports both parents');
  const [first, second] = merge.parents;
  assert.strictEqual(commits.find(c => c.hash === first).subject, 'main work',
    'the first parent is the branch the merge was made on');
  assert.strictEqual(commits.find(c => c.hash === second).subject, 'side work');
  assert.deepStrictEqual(commits[commits.length - 1].parents, [],
    'the root commit has no parents');
});

test('log: labels the refs sitting on a commit', async () => {
  const repo = h.makeRepo();
  h.git(repo, 'tag', 'v1');

  const [head] = await git.log(repo);

  assert.deepStrictEqual(head.refs.slice().sort((a, b) => a.type.localeCompare(b.type)), [
    { name: 'main', type: 'head' },
    { name: 'v1', type: 'tag' },
  ]);
});

test('log: a branch with a slash in its name is not mistaken for a remote', async () => {
  const repo = h.makeRepo();
  const remote = h.makeRepo();
  h.git(repo, 'remote', 'add', 'origin', remote);
  h.git(repo, 'fetch', '-q', 'origin');
  h.git(repo, 'branch', 'feature/thing');

  const [head] = await git.log(repo);
  const byName = Object.fromEntries(head.refs.map(r => [r.name, r.type]));

  assert.strictEqual(byName['feature/thing'], 'branch');
  assert.strictEqual(byName['origin/main'], 'remote');
});

test('log: a subject containing the field separator characters still parses', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'a.txt', 'a\n');
  h.commitAll(repo, 'fix: a, b -> c | tag: not-a-tag');

  const [head] = await git.log(repo);

  assert.strictEqual(head.subject, 'fix: a, b -> c | tag: not-a-tag');
  assert.strictEqual(head.author, 'Test Author');
});

test('log: all-branches mode includes commits no branch has merged', async () => {
  const repo = h.makeRepo();
  h.git(repo, 'checkout', '-q', '-b', 'spike');
  h.write(repo, 'spike.txt', 'x\n');
  h.commitAll(repo, 'spike work');
  h.git(repo, 'checkout', '-q', 'main');
  h.write(repo, 'main.txt', 'x\n');
  h.commitAll(repo, 'main work');

  const scoped = await git.log(repo, 'main');
  const all = await git.log(repo, 'main', 100, { all: true });

  assert.ok(!scoped.some(c => c.subject === 'spike work'),
    "main's ancestry cannot see an unmerged branch");
  assert.deepStrictEqual(
    all.map(c => c.subject).sort(),
    ['initial', 'main work', 'spike work'],
    'every ref shows up regardless of the branch argument');
});

// ── unpushed ──

test('unpushed: lists the commits no remote-tracking branch contains', async () => {
  const repo = h.makeRepo();
  const remote = h.makeRepo();
  h.git(repo, 'remote', 'add', 'origin', remote);
  h.git(repo, 'fetch', '-q', 'origin');
  h.git(repo, 'branch', '--set-upstream-to=origin/main', 'main');
  h.write(repo, 'local.txt', 'x\n');
  const local = h.commitAll(repo, 'not pushed yet');

  const hashes = await git.unpushed(repo, 'main');

  assert.deepStrictEqual(hashes, [local],
    'only the commit made after the fetch counts as unpushed');
});

test('unpushed: all-branches mode covers every local branch, not just one', async () => {
  const repo = h.makeRepo();
  const remote = h.makeRepo();
  h.git(repo, 'remote', 'add', 'origin', remote);
  h.git(repo, 'fetch', '-q', 'origin');
  h.git(repo, 'checkout', '-q', '-b', 'spike');
  h.write(repo, 'spike.txt', 'x\n');
  const spike = h.commitAll(repo, 'spike work');
  h.git(repo, 'checkout', '-q', 'main');
  h.write(repo, 'main.txt', 'x\n');
  const main = h.commitAll(repo, 'main work');

  const scoped = await git.unpushed(repo, 'main');
  const all = await git.unpushed(repo, null, 500, { all: true });

  assert.deepStrictEqual(scoped, [main]);
  assert.deepStrictEqual(all.slice().sort(), [main, spike].sort(),
    'the work sitting on the other branch is unpushed too');
});

test('unpushed: a repo with no remote at all reports nothing', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'a.txt', 'a\n');
  h.commitAll(repo, 'second');

  // Every commit is technically unpushed here, but marking the whole history
  // as local would be noise, not information.
  assert.deepStrictEqual(await git.unpushed(repo, 'main'), []);
});

// ── branches ──

test('branches: marks the checked-out branch as current', async () => {
  const repo = h.makeRepo();
  h.git(repo, 'branch', 'other');

  const branches = await git.branches(repo);

  assert.deepStrictEqual(
    branches.map(b => b.name).sort(),
    ['main', 'other'],
  );
  assert.strictEqual(branches.find(b => b.name === 'main').current, true);
  assert.strictEqual(branches.find(b => b.name === 'other').current, false);
});

test('branches: reports upstream and flags origin/* as remote', async () => {
  const repo = h.makeRepo();
  const remote = h.makeRepo();
  h.git(repo, 'remote', 'add', 'origin', remote);
  // A bare push target isn't needed: fetching from a normal repo is enough to
  // create origin/main, which is what the sidebar keys off.
  h.git(repo, 'fetch', '-q', 'origin');
  h.git(repo, 'branch', '--set-upstream-to=origin/main', 'main');

  const branches = await git.branches(repo);
  const local = branches.find(b => b.name === 'main');
  const tracking = branches.find(b => b.name === 'origin/main');

  assert.strictEqual(local.upstream, 'origin/main');
  assert.strictEqual(local.isRemote, false);
  assert.ok(tracking, 'the remote-tracking branch is listed too');
  assert.strictEqual(tracking.isRemote, true);
  assert.strictEqual(tracking.upstream, null);
});

test('branches: counts how far a branch is ahead of and behind its upstream', async () => {
  const repo = h.makeRepo();
  const remote = h.makeRepo();
  h.write(remote, 'remote.txt', 'x\n');
  h.commitAll(remote, 'remote work');
  h.git(repo, 'remote', 'add', 'origin', remote);
  h.git(repo, 'fetch', '-q', 'origin');
  h.git(repo, 'branch', '--set-upstream-to=origin/main', 'main');
  h.write(repo, 'local.txt', 'x\n');
  h.commitAll(repo, 'local work');

  const main = (await git.branches(repo)).find(b => b.name === 'main');

  assert.strictEqual(main.ahead, 1, 'one commit to push');
  assert.strictEqual(main.behind, 1, 'one commit to pull');
  assert.strictEqual(main.gone, false);
});

test('branches: a branch with no upstream is neither ahead nor behind', async () => {
  const repo = h.makeRepo();

  const main = (await git.branches(repo)).find(b => b.name === 'main');

  assert.strictEqual(main.upstream, null);
  assert.strictEqual(main.ahead, 0);
  assert.strictEqual(main.behind, 0);
  assert.strictEqual(main.gone, false);
});

test('branches: an upstream deleted on the remote is reported as gone', async () => {
  const repo = h.makeRepo();
  const remote = h.makeRepo();
  h.git(repo, 'remote', 'add', 'origin', remote);
  h.git(repo, 'fetch', '-q', 'origin');
  h.git(repo, 'branch', '--set-upstream-to=origin/main', 'main');
  // What a pruned or deleted remote branch leaves behind: a tracking config
  // pointing at a ref that no longer exists.
  h.git(repo, 'update-ref', '-d', 'refs/remotes/origin/main');

  const main = (await git.branches(repo)).find(b => b.name === 'main');

  assert.strictEqual(main.gone, true);
  assert.strictEqual(main.upstream, 'origin/main');
});

test('branches: a detached HEAD becomes a current, detached pseudo-branch', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'a.txt', 'a\n');
  const second = h.commitAll(repo, 'second');
  h.git(repo, 'checkout', '-q', '--detach', second);

  const branches = await git.branches(repo);

  assert.strictEqual(branches[0].detached, true, 'the detached entry is unshifted to the front');
  assert.strictEqual(branches[0].current, true);
  assert.ok(second.startsWith(branches[0].name), 'named by the short hash of HEAD');
  assert.ok(!branches.some(b => b.name.startsWith('(HEAD')),
    'the "(HEAD detached at …)" pseudo-ref is filtered out');
  assert.ok(!branches.slice(1).some(b => b.current), 'no real branch claims to be current');
});

// ── tags ──

test('tags: lists tag names, newest creatordate first', async () => {
  const repo = h.makeRepo();
  const tag = (name, date) => execFileSync('git', ['tag', '-a', name, '-m', name], {
    cwd: repo, encoding: 'utf-8',
    env: { ...h.ENV, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date },
  });
  tag('v1.0.0', '2024-01-01T00:00:00+00:00');
  tag('v2.0.0', '2024-06-01T00:00:00+00:00');
  tag('v1.5.0', '2024-03-01T00:00:00+00:00');

  assert.deepStrictEqual(await git.tags(repo), ['v2.0.0', 'v1.5.0', 'v1.0.0']);
});

test('tags: a repo with no tags returns an empty array', async () => {
  const repo = h.makeRepo();
  assert.deepStrictEqual(await git.tags(repo), []);
});

// ── remotes ──

test('remotes: collapses the fetch/push pair into one entry per remote', async () => {
  const repo = h.makeRepo();
  h.git(repo, 'remote', 'add', 'origin', 'https://example.com/origin.git');
  h.git(repo, 'remote', 'add', 'upstream', 'https://example.com/upstream.git');

  const remotes = await git.remotes(repo);

  assert.deepStrictEqual(remotes, [
    { name: 'origin', url: 'https://example.com/origin.git' },
    { name: 'upstream', url: 'https://example.com/upstream.git' },
  ]);
});

test('remotes: a repo with no remotes returns an empty array', async () => {
  const repo = h.makeRepo();
  assert.deepStrictEqual(await git.remotes(repo), []);
});

// ── stashes ──

test('stashes: splits each entry into ref and message', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'README.md', '# first stash\n');
  h.git(repo, 'stash', 'push', '-q', '-m', 'first');
  h.write(repo, 'README.md', '# second stash\n');
  h.git(repo, 'stash', 'push', '-q', '-m', 'second');

  const stashes = await git.stashes(repo);

  assert.strictEqual(stashes.length, 2);
  assert.strictEqual(stashes[0].ref, 'stash@{0}');
  assert.match(stashes[0].message, /second/);
  assert.strictEqual(stashes[1].ref, 'stash@{1}');
  assert.match(stashes[1].message, /first/);
});

test('stashes: no stashes returns an empty array', async () => {
  const repo = h.makeRepo();
  assert.deepStrictEqual(await git.stashes(repo), []);
});

// ── diff ──

test('diff: returns the unstaged diff for a file', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'README.md', '# edited\n');

  const out = await git.diff(repo, 'README.md', false);

  assert.match(out, /^diff --git/m);
  assert.match(out, /^\+# edited$/m);
  assert.match(out, /^-# Test repo$/m);
});

test('diff: staged=true returns the index diff, not the working-tree one', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'README.md', '# staged version\n');
  h.git(repo, 'add', 'README.md');
  h.write(repo, 'README.md', '# working tree version\n');

  const staged = await git.diff(repo, 'README.md', true);

  assert.match(staged, /^\+# staged version$/m);
  assert.ok(!/working tree version/.test(staged));
});

test('diff: falls back to the other side when the requested one is empty', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'README.md', '# only staged\n');
  h.git(repo, 'add', 'README.md');

  // Nothing is unstaged, so asking for the unstaged diff falls back to --cached.
  const out = await git.diff(repo, 'README.md', false);

  assert.match(out, /^\+# only staged$/m);
});

test('diff: with no file path diffs the whole working tree', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'a.txt', 'a\n');
  h.write(repo, 'b.txt', 'b\n');
  h.commitAll(repo, 'add a and b');
  h.write(repo, 'a.txt', 'a changed\n');
  h.write(repo, 'b.txt', 'b changed\n');

  const out = await git.diff(repo, null, false);

  assert.match(out, /a\.txt/);
  assert.match(out, /b\.txt/);
});

// ── commit detail / diff / files ──

test('commitDetail: splits the fixed-format header into fields', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'a.txt', 'a\n');
  const hash = h.commitAll(repo, 'subject line');
  h.git(repo, 'tag', 'v9');

  const detail = await git.commitDetail(repo, hash);

  assert.strictEqual(detail.hash, hash);
  assert.strictEqual(detail.author, 'Test Author');
  assert.strictEqual(detail.authorEmail, 'author@example.com');
  assert.strictEqual(detail.committer, 'Test Committer');
  assert.strictEqual(detail.committerEmail, 'committer@example.com');
  assert.match(detail.authorDate, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(detail.refs, /tag: v9/);
  assert.match(detail.parents, /^[0-9a-f]{40}$/);
  assert.match(detail.tree, /^[0-9a-f]{40}$/);
  assert.strictEqual(detail.subject, 'subject line');
});

// The body is what the detail pane shows under the subject, so it has to end
// where the message ends — no stat block, no trailing blank lines.
test('commitDetail: keeps the whole body and nothing after it', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'a.txt', 'a\n');
  const hash = h.commitAll(repo, 'subject line\n\nfirst body line\nsecond body line\n');

  const detail = await git.commitDetail(repo, hash);

  assert.strictEqual(detail.subject, 'subject line');
  assert.strictEqual(detail.body, 'first body line\nsecond body line');
});

test('commitDetail: a subject-only commit has an empty body', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'a.txt', 'a\n');
  const hash = h.commitAll(repo, 'subject line');

  assert.strictEqual((await git.commitDetail(repo, hash)).body, '');
});

test('commitDetail: the root commit has no parents', async () => {
  const repo = h.makeRepo();
  const root = h.git(repo, 'rev-parse', 'HEAD').trim();

  const detail = await git.commitDetail(repo, root);

  assert.strictEqual(detail.parents, '');
  assert.strictEqual(detail.subject, 'initial');
});

test('commitDiff: contains the patch and the stat for the commit', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'a.txt', 'first line\n');
  const hash = h.commitAll(repo, 'add a.txt');

  const out = await git.commitDiff(repo, hash);

  assert.match(out, /a\.txt/);
  assert.match(out, /^\+first line$/m);
});

test('commitFiles: maps A/M/D/R status codes to names', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'keep.txt', 'keep\n');
  h.write(repo, 'drop.txt', 'drop\n');
  h.write(repo, 'move-me.txt', 'a fairly long body so rename detection is confident\n');
  h.commitAll(repo, 'setup');

  h.write(repo, 'added.txt', 'new\n');
  h.write(repo, 'keep.txt', 'keep, modified\n');
  h.remove(repo, 'drop.txt');
  h.git(repo, 'mv', 'move-me.txt', 'moved.txt');
  const hash = h.commitAll(repo, 'a bit of everything');

  const files = await git.commitFiles(repo, hash);
  const byPath = Object.fromEntries(files.map(f => [f.filePath, f]));

  assert.partialDeepStrictEqual(byPath['added.txt'], { status: 'added', statusCode: 'A' });
  assert.partialDeepStrictEqual(byPath['keep.txt'], { status: 'modified', statusCode: 'M' });
  assert.partialDeepStrictEqual(byPath['drop.txt'], { status: 'deleted', statusCode: 'D' });
  assert.partialDeepStrictEqual(byPath['moved.txt'],
    { status: 'renamed', statusCode: 'R', oldPath: 'move-me.txt' });
  assert.strictEqual(files.length, 4);
});

test('commitFiles: detects a rename as a single renamed entry', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'move-me.txt', 'a fairly long body so rename detection is confident\n');
  h.commitAll(repo, 'setup');
  h.git(repo, 'mv', 'move-me.txt', 'moved.txt');
  const hash = h.commitAll(repo, 'rename');

  const files = await git.commitFiles(repo, hash);

  assert.deepStrictEqual(files, [
    { filePath: 'moved.txt', oldPath: 'move-me.txt', status: 'renamed', statusCode: 'R' },
  ]);
});

test('commitFiles: a rename does not shift the entries that follow it', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'move-me.txt', 'a fairly long body so rename detection is confident\n');
  h.commitAll(repo, 'setup');
  h.git(repo, 'mv', 'move-me.txt', 'moved.txt');
  h.write(repo, 'zz-after.txt', 'x\n');
  const hash = h.commitAll(repo, 'rename plus another file');

  const files = await git.commitFiles(repo, hash);

  assert.deepStrictEqual(
    files.map(f => [f.filePath, f.status]).sort(),
    [['moved.txt', 'renamed'], ['zz-after.txt', 'added']],
  );
});

test('commitFiles: paths with spaces and non-ASCII characters come back verbatim', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'sp ace.txt', 'x\n');
  h.write(repo, 'caf\u00e9.txt', 'x\n');
  const hash = h.commitAll(repo, 'awkward names');

  const files = await git.commitFiles(repo, hash);

  assert.deepStrictEqual(
    files.map(f => f.filePath).sort(),
    ['caf\u00e9.txt', 'sp ace.txt'],
  );
});

test('commitFiles: the reported rename path is usable with commitFileDiff', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'move-me.txt', 'a fairly long body so rename detection is confident\n');
  h.commitAll(repo, 'setup');
  h.git(repo, 'mv', 'move-me.txt', 'moved.txt');
  const hash = h.commitAll(repo, 'rename');

  const [renamed] = await git.commitFiles(repo, hash);
  const diff = await git.commitFileDiff(repo, hash, renamed.filePath);

  assert.match(diff, /moved\.txt/, 'the UI can fetch a diff for what the list showed');
});

test('commitFileDiff: is scoped to the requested path', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'a.txt', 'contents of a\n');
  h.write(repo, 'b.txt', 'contents of b\n');
  const hash = h.commitAll(repo, 'add both');

  const out = await git.commitFileDiff(repo, hash, 'a.txt');

  assert.match(out, /^\+contents of a$/m);
  assert.ok(!/contents of b/.test(out), 'the other file is excluded');
});

// ── searchLog ──

test('searchLog: matches commit messages case-insensitively', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'a.txt', 'a\n');
  h.commitAll(repo, 'Fix the parser');
  h.write(repo, 'b.txt', 'b\n');
  h.commitAll(repo, 'unrelated work');

  const found = await git.searchLog(repo, 'fix the', 'message');

  assert.deepStrictEqual(found.map(c => c.subject), ['Fix the parser']);
});

test('searchLog: matches by author', async () => {
  const repo = h.makeRepo();
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'by someone else'], {
    cwd: repo, encoding: 'utf-8',
    env: { ...h.ENV, GIT_AUTHOR_NAME: 'Wilma', GIT_AUTHOR_EMAIL: 'wilma@example.com' },
  });

  const found = await git.searchLog(repo, 'wilma', 'author');

  assert.deepStrictEqual(found.map(c => c.subject), ['by someone else']);
});

test('searchLog: hash search returns exactly that commit, ignoring the branch', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'a.txt', 'a\n');
  const target = h.commitAll(repo, 'the one we want');
  h.write(repo, 'b.txt', 'b\n');
  h.commitAll(repo, 'a later commit');

  const found = await git.searchLog(repo, target, 'hash', 'main');

  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].hash, target);
  assert.strictEqual(found[0].subject, 'the one we want');
});

test('searchLog: file search finds commits touching a matching path', async () => {
  const repo = h.makeRepo();
  h.write(repo, 'src/parser.js', 'x\n');
  h.commitAll(repo, 'touch the parser');
  h.write(repo, 'src/other.js', 'y\n');
  h.commitAll(repo, 'touch something else');

  const found = await git.searchLog(repo, 'parser', 'file');

  assert.deepStrictEqual(found.map(c => c.subject), ['touch the parser']);
});

test('searchLog: no matches returns an empty array', async () => {
  const repo = h.makeRepo();
  assert.deepStrictEqual(await git.searchLog(repo, 'nothing matches this', 'message'), []);
});

test('searchLog: honours the branch scope for message search', async () => {
  const repo = h.makeRepo();
  h.git(repo, 'checkout', '-q', '-b', 'feature');
  h.write(repo, 'f.txt', 'x\n');
  h.commitAll(repo, 'searchable feature commit');
  h.git(repo, 'checkout', '-q', 'main');

  assert.deepStrictEqual(await git.searchLog(repo, 'searchable', 'message', 'main'), []);
  assert.strictEqual((await git.searchLog(repo, 'searchable', 'message', 'feature')).length, 1);
});

// ── repoFingerprint ──

test('repoFingerprint: reports the current hash and branch', async () => {
  const repo = h.makeRepo();
  const hash = h.git(repo, 'rev-parse', 'HEAD').trim();

  const fp = await git.repoFingerprint(repo);

  assert.strictEqual(fp.hash, hash);
  assert.strictEqual(fp.branch, 'main');
  assert.ok(fp.fingerprint.length > 0);
});

test('repoFingerprint: branch is null when HEAD is detached', async () => {
  const repo = h.makeRepo();
  h.git(repo, 'checkout', '-q', '--detach', 'HEAD');

  const fp = await git.repoFingerprint(repo);

  assert.strictEqual(fp.branch, null);
  assert.match(fp.hash, /^[0-9a-f]{40}$/);
});

test('repoFingerprint: changes when a commit is made', async () => {
  const repo = h.makeRepo();
  const before = await git.repoFingerprint(repo);

  h.write(repo, 'a.txt', 'a\n');
  h.commitAll(repo, 'moves HEAD');
  const after = await git.repoFingerprint(repo);

  assert.notStrictEqual(before.fingerprint, after.fingerprint);
  assert.notStrictEqual(before.hash, after.hash);
});

test('repoFingerprint: changes when a branch is created, even though HEAD stays put', async () => {
  const repo = h.makeRepo();
  const before = await git.repoFingerprint(repo);

  h.git(repo, 'branch', 'created-elsewhere');
  const after = await git.repoFingerprint(repo);

  assert.strictEqual(before.hash, after.hash);
  assert.notStrictEqual(before.fingerprint, after.fingerprint,
    'ref changes must be visible or the sidebar would never refresh');
});

test('repoFingerprint: is stable across calls with no changes', async () => {
  const repo = h.makeRepo();
  assert.deepStrictEqual(await git.repoFingerprint(repo), await git.repoFingerprint(repo));
});

test('repoFingerprint: survives a repo with no commits', async () => {
  const repo = h.makeEmptyRepo();

  const fp = await git.repoFingerprint(repo);

  assert.strictEqual(fp.hash, '');
  assert.strictEqual(fp.branch, null);
});

// ── searchLog ──

test('searchLog: searching a branch does not reach into another one', async () => {
  const repo = h.makeRepo();
  h.git(repo, 'checkout', '-q', '-b', 'other');
  h.write(repo, 'o.txt', 'x\n');
  h.commitAll(repo, 'widget on the other branch');
  h.git(repo, 'checkout', '-q', 'main');
  h.write(repo, 'm.txt', 'x\n');
  h.commitAll(repo, 'widget on main');

  const onMain = await git.searchLog(repo, 'widget', 'message', 'main');

  assert.deepStrictEqual(onMain.map(c => c.subject), ['widget on main']);
});

test('searchLog: all-branches mode searches every ref', async () => {
  const repo = h.makeRepo();
  h.git(repo, 'checkout', '-q', '-b', 'other');
  h.write(repo, 'o.txt', 'x\n');
  h.commitAll(repo, 'widget on the other branch');
  h.git(repo, 'checkout', '-q', 'main');
  h.write(repo, 'm.txt', 'x\n');
  h.commitAll(repo, 'widget on main');

  const all = await git.searchLog(repo, 'widget', 'message', 'main', 200, { all: true });

  assert.deepStrictEqual(all.map(c => c.subject).sort(),
    ['widget on main', 'widget on the other branch']);
});

test('searchLog: results carry the same fields the list renders from', async () => {
  const repo = h.makeRepo();
  h.git(repo, 'tag', 'v9');

  const [hit] = await git.searchLog(repo, 'initial', 'message', 'main');

  assert.deepStrictEqual(hit.parents, [], 'parents, for the graph');
  assert.ok(hit.refs.some(r => r.name === 'v9' && r.type === 'tag'), 'and refs, for the chips');
});

// ── error propagation ──

test('a git failure rejects with git\'s stderr', async () => {
  const repo = h.makeRepo();
  await assert.rejects(
    () => git.commitDetail(repo, 'nosuchcommit'),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /nosuchcommit|unknown revision|bad revision/i);
      return true;
    },
  );
});

// ── the index lock ──

// `git status` refreshes the index as a side effect, and to write it back it
// takes .git/index.lock. Keep polls status every few seconds, so without
// GIT_OPTIONAL_LOCKS=0 a poll can land on a `git commit` typed in a terminal and
// break it with "Unable to create '.../index.lock': File exists". The env var is
// the whole fix, so the test is that it reaches git — checked with a stand-in
// `git` on PATH that reports the environment it was handed.
test('git runs with optional locks off, so a terminal can commit alongside Keep', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-test-bin-'));
  const record = path.join(binDir, 'env.txt');
  fs.writeFileSync(path.join(binDir, 'git'),
    `#!/bin/sh\nprintf '%s' "$GIT_OPTIONAL_LOCKS" > ${JSON.stringify(record)}\n`);
  fs.chmodSync(path.join(binDir, 'git'), 0o755);

  const realPath = process.env.PATH;
  process.env.PATH = `${binDir}:${realPath}`;
  let handed;
  try {
    await git.status(binDir);
    handed = fs.readFileSync(record, 'utf-8');
  } finally {
    process.env.PATH = realPath;
    fs.rmSync(binDir, { recursive: true, force: true });
  }

  assert.strictEqual(handed, '0', 'GIT_OPTIONAL_LOCKS reaches git');
});
