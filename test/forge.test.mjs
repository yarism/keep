// Tests for renderer/modules/forge.js — the mapping from a git remote URL to
// the forge's own web pages.
//
// It is pure string work with no DOM and no relative imports, so it loads
// straight through the ESM helper. What it protects is a class of bug that is
// invisible until someone clicks: a URL that is merely plausible. Every
// expectation here is a real path shape on the real forge, not a guess.
import test from 'node:test';
import assert from 'node:assert';

import { loadEsm } from './helpers/esm.mjs';

const {
  parseRemote, forgeForBranch, remoteForBranch, remoteBranchName,
  forgeLabel, pullRequestNoun, pullRequestsNoun,
  repoUrl, branchUrl, commitUrl, pullRequestsUrl, newPullRequestUrl,
} = await loadEsm('renderer/modules/forge.js');

const GH = parseRemote('git@github.com:yarism/keep.git');
const GL = parseRemote('https://gitlab.com/group/sub/proj.git');
const BB = parseRemote('https://bitbucket.org/team/repo.git');

// ── parseRemote ──

test('parseRemote: reads the scp-style form git actually writes for SSH remotes', () => {
  assert.deepStrictEqual(parseRemote('git@github.com:yarism/keep.git'), {
    kind: 'github', host: 'github.com', owner: 'yarism', repo: 'keep',
    base: 'https://github.com/yarism/keep',
  });
});

test('parseRemote: reads https, ssh:// and a missing .git suffix alike', () => {
  const expected = 'https://github.com/yarism/keep';
  for (const url of [
    'https://github.com/yarism/keep.git',
    'https://github.com/yarism/keep',
    'ssh://git@github.com/yarism/keep.git',
    'https://yarism@github.com/yarism/keep.git',
  ]) {
    assert.strictEqual(parseRemote(url).base, expected, url);
  }
});

test('parseRemote: a nested GitLab group is all owner, and only the last segment is the repo', () => {
  assert.strictEqual(GL.owner, 'group/sub');
  assert.strictEqual(GL.repo, 'proj');
});

test('parseRemote: an unrecognised host is null, so no menu item is offered for it', () => {
  assert.strictEqual(parseRemote('https://git.example.com/a/b.git'), null);
  assert.strictEqual(parseRemote('/Users/me/repos/local.git'), null);
  assert.strictEqual(parseRemote(''), null);
  assert.strictEqual(parseRemote(null), null);
});

test('parseRemote: a file: URL is not a forge, whatever the path looks like', () => {
  assert.strictEqual(parseRemote('file:///srv/github.com/a/b.git'), null);
});

test('parseRemote: a host prefixed github./gitlab. is taken as self-hosted', () => {
  assert.strictEqual(parseRemote('git@github.acme.com:org/repo.git').kind, 'github');
  assert.strictEqual(parseRemote('https://gitlab.acme.com/org/repo.git').kind, 'gitlab');
  // …but the convention is not extended to a host that merely mentions one.
  assert.strictEqual(parseRemote('https://acme-github.com/org/repo.git'), null);
});

test('parseRemote: a host with no owner/repo pair yields nothing to link to', () => {
  assert.strictEqual(parseRemote('https://github.com/yarism'), null);
});

// ── URL shapes ──

test('URLs: GitHub', () => {
  assert.strictEqual(repoUrl(GH), 'https://github.com/yarism/keep');
  assert.strictEqual(branchUrl(GH, 'main'), 'https://github.com/yarism/keep/tree/main');
  assert.strictEqual(commitUrl(GH, 'abc123'), 'https://github.com/yarism/keep/commit/abc123');
  assert.strictEqual(pullRequestsUrl(GH), 'https://github.com/yarism/keep/pulls');
  assert.strictEqual(newPullRequestUrl(GH, 'topic'), 'https://github.com/yarism/keep/compare/topic?expand=1');
});

test('URLs: GitLab keeps everything under the /-/ prefix and calls it a merge request', () => {
  assert.strictEqual(branchUrl(GL, 'main'), 'https://gitlab.com/group/sub/proj/-/tree/main');
  assert.strictEqual(commitUrl(GL, 'abc123'), 'https://gitlab.com/group/sub/proj/-/commit/abc123');
  assert.strictEqual(pullRequestsUrl(GL), 'https://gitlab.com/group/sub/proj/-/merge_requests');
  assert.strictEqual(
    newPullRequestUrl(GL, 'topic'),
    'https://gitlab.com/group/sub/proj/-/merge_requests/new?merge_request[source_branch]=topic',
  );
});

test('URLs: Bitbucket', () => {
  assert.strictEqual(branchUrl(BB, 'main'), 'https://bitbucket.org/team/repo/src/main');
  assert.strictEqual(commitUrl(BB, 'abc123'), 'https://bitbucket.org/team/repo/commits/abc123');
  assert.strictEqual(pullRequestsUrl(BB), 'https://bitbucket.org/team/repo/pull-requests');
  assert.strictEqual(newPullRequestUrl(BB, 'topic'), 'https://bitbucket.org/team/repo/pull-requests/new?source=topic');
});

// A slash in a branch name is a path separator in the page URL but an ordinary
// character in a query parameter — encoding both the same way breaks one of them.
test('URLs: a slashed branch name stays a path in the path, and is escaped in a query', () => {
  assert.strictEqual(branchUrl(GH, 'feature/x'), 'https://github.com/yarism/keep/tree/feature/x');
  assert.strictEqual(newPullRequestUrl(GH, 'feature/x'), 'https://github.com/yarism/keep/compare/feature/x?expand=1');
  assert.strictEqual(
    newPullRequestUrl(BB, 'feature/x'),
    'https://bitbucket.org/team/repo/pull-requests/new?source=feature%2Fx',
  );
});

test('URLs: a branch name with a space or a hash is escaped, not passed through', () => {
  assert.strictEqual(branchUrl(GH, 'feat/a b'), 'https://github.com/yarism/keep/tree/feat/a%20b');
  assert.strictEqual(branchUrl(GH, 'feat/a#b'), 'https://github.com/yarism/keep/tree/feat/a%23b');
});

test('URLs: nothing is built without a forge or a ref', () => {
  assert.strictEqual(branchUrl(null, 'main'), null);
  assert.strictEqual(branchUrl(GH, ''), null);
  assert.strictEqual(newPullRequestUrl(null, 'main'), null);
  assert.strictEqual(commitUrl(GH, null), null);
});

// ── naming ──

test('naming: GitLab says merge request, and an unknown forge says neither', () => {
  assert.strictEqual(pullRequestNoun(GH), 'Pull Request');
  assert.strictEqual(pullRequestNoun(GL), 'Merge Request');
  assert.strictEqual(pullRequestsNoun(GL), 'Merge Requests');
  assert.strictEqual(forgeLabel(GL), 'GitLab');
  assert.strictEqual(forgeLabel(BB), 'Bitbucket');
  assert.strictEqual(forgeLabel(null), 'Remote');
});

// ── picking a remote ──

const REMOTES = [
  { name: 'origin', url: 'git@github.com:yarism/keep.git' },
  { name: 'fork', url: 'git@github.com:someone/keep.git' },
];

test('remote: the upstream decides which remote a branch belongs to', () => {
  assert.strictEqual(forgeForBranch(REMOTES, 'fork/topic').owner, 'someone');
  assert.strictEqual(forgeForBranch(REMOTES, 'origin/main').owner, 'yarism');
});

test('remote: without an upstream, origin wins over declaration order', () => {
  const reordered = [REMOTES[1], REMOTES[0]];
  assert.strictEqual(forgeForBranch(reordered, null).owner, 'yarism');
});

test('remote: a remote whose own name contains a slash is not shadowed by a shorter one', () => {
  const remotes = [
    { name: 'team', url: 'git@github.com:a/x.git' },
    { name: 'team/staging', url: 'git@github.com:b/x.git' },
  ];
  assert.strictEqual(remoteForBranch(remotes, 'team/staging/main').name, 'team/staging');
});

test('remote: a repo with no hosted remote at all offers no forge', () => {
  assert.strictEqual(forgeForBranch([{ name: 'origin', url: '/srv/git/x.git' }], null), null);
  assert.strictEqual(forgeForBranch([], null), null);
  assert.strictEqual(forgeForBranch(undefined, null), null);
});

test('remote: an unhosted origin does not hide a hosted fork', () => {
  const remotes = [
    { name: 'origin', url: '/srv/git/mirror.git' },
    { name: 'gh', url: 'git@github.com:yarism/keep.git' },
  ];
  assert.strictEqual(forgeForBranch(remotes, null).owner, 'yarism');
});

// ── the name on the server ──

test('server name: the upstream is the authority when it disagrees with the local name', () => {
  assert.strictEqual(remoteBranchName(REMOTES, 'origin/release/2.0', 'local-name'), 'release/2.0');
});

test('server name: an unpushed branch falls back to what it is called here', () => {
  assert.strictEqual(remoteBranchName(REMOTES, null, 'topic'), 'topic');
});
