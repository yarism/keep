// Tests for forge-api.js — the only part of Keep that speaks HTTP.
//
// `fetch` is injected, so nothing here touches the network or a keychain. What
// is worth pinning down is the shape handed to the renderer, and the fact that
// every failure comes back as a sentence with a reason attached rather than as
// an exception: "no token" and "offline" are ordinary states of this feature,
// and each of them has a different thing for the user to do about it.
const test = require('node:test');
const assert = require('node:assert');

const api = require('../forge-api');

const GH = { kind: 'github', host: 'github.com', owner: 'yarism', repo: 'keep' };
const GHE = { kind: 'github', host: 'github.acme.com', owner: 'infra', repo: 'tooling' };

// A stand-in for whatever fetch returned, recording what it was asked for.
function fakeFetch(response) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  };
  impl.calls = calls;
  return impl;
}

function reply(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  };
}

const PR = {
  number: 12,
  title: 'Add pull request support',
  user: { login: 'yarism', avatar_url: 'https://avatars.example/u/1' },
  body: 'Adds a Pull Requests view.',
  draft: false,
  head: { ref: 'pr-support', sha: 'deadbee', repo: { full_name: 'yarism/keep' } },
  base: { ref: 'main', repo: { full_name: 'yarism/keep' } },
  html_url: 'https://github.com/yarism/keep/pull/12',
  updated_at: '2026-08-24T10:00:00Z',
  comments: 2,
  review_comments: 3,
};

// ── the happy path ──

test('listPullRequests: reduces GitHub\'s response to the fields the UI shows', async () => {
  const fetchImpl = fakeFetch(reply(200, [PR]));

  const result = await api.listPullRequests('/repo', GH, { token: 'tok', fetchImpl });

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.pulls, [{
    number: 12,
    title: 'Add pull request support',
    body: 'Adds a Pull Requests view.',
    author: 'yarism',
    avatar: 'https://avatars.example/u/1',
    headSha: 'deadbee',
    draft: false,
    head: 'pr-support',
    base: 'main',
    fromFork: false,
    headRepo: 'yarism/keep',
    url: 'https://github.com/yarism/keep/pull/12',
    updatedAt: '2026-08-24T10:00:00Z',
    comments: 5,
  }]);
});

test('listPullRequests: asks for open pull requests, newest activity first', async () => {
  const fetchImpl = fakeFetch(reply(200, []));

  await api.listPullRequests('/repo', GH, { token: 'tok', fetchImpl });

  const { url } = fetchImpl.calls[0];
  assert.match(url, /^https:\/\/api\.github\.com\/repos\/yarism\/keep\/pulls\?/);
  assert.match(url, /state=open/);
  assert.match(url, /sort=updated/);
});

test('listPullRequests: a GitHub Enterprise host is its own API, under /api/v3', async () => {
  const fetchImpl = fakeFetch(reply(200, []));

  await api.listPullRequests('/repo', GHE, { token: 'tok', fetchImpl });

  assert.match(fetchImpl.calls[0].url, /^https:\/\/github\.acme\.com\/api\/v3\/repos\/infra\/tooling\/pulls\?/);
});

test('listPullRequests: a pull request from a fork is marked as one', async () => {
  const forked = { ...PR, head: { ref: 'patch', repo: { full_name: 'someone/keep' } } };
  const fetchImpl = fakeFetch(reply(200, [forked]));

  const result = await api.listPullRequests('/repo', GH, { token: 'tok', fetchImpl });

  assert.strictEqual(result.pulls[0].fromFork, true);
  assert.strictEqual(result.pulls[0].headRepo, 'someone/keep');
});

test('listPullRequests: a deleted fork leaves no repo to compare, and is not called one', async () => {
  const orphan = { ...PR, head: { ref: 'patch', repo: null } };
  const fetchImpl = fakeFetch(reply(200, [orphan]));

  const result = await api.listPullRequests('/repo', GH, { token: 'tok', fetchImpl });

  assert.strictEqual(result.pulls[0].fromFork, false);
  assert.strictEqual(result.pulls[0].head, 'patch');
});

// A hundred back means there may be more, and a list that silently stops at a
// hundred looks exactly like a repository with a hundred pull requests.
test('listPullRequests: says when the first page is full rather than implying it is all of them', async () => {
  const full = Array.from({ length: 100 }, (_, i) => ({ ...PR, number: i + 1 }));

  const result = await api.listPullRequests('/repo', GH, { token: 'tok', fetchImpl: fakeFetch(reply(200, full)) });
  assert.strictEqual(result.truncated, true);

  const short = await api.listPullRequests('/repo', GH, { token: 'tok', fetchImpl: fakeFetch(reply(200, [PR])) });
  assert.strictEqual(short.truncated, false);
});

// ── the token ──

test('listPullRequests: sends the token as a bearer credential when there is one', async () => {
  const fetchImpl = fakeFetch(reply(200, []));

  await api.listPullRequests('/repo', GH, { token: 'fake-token', fetchImpl });

  assert.strictEqual(fetchImpl.calls[0].init.headers.Authorization, 'Bearer fake-token');
});

// Public repositories are readable without one, which is the case that needs no
// setup at all — so no token must mean no header, not no request.
test('listPullRequests: with no token it still asks, just without an Authorization header', async () => {
  const fetchImpl = fakeFetch(reply(200, [PR]));

  const result = await api.listPullRequests('/repo', GH, { token: null, fetchImpl });

  assert.strictEqual(fetchImpl.calls[0].init.headers.Authorization, undefined);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.authenticated, false);
});

// ── failures, each of which the sidebar has to explain ──

test('listPullRequests: 404 without a token reads as "private", not as "no such repository"', async () => {
  const result = await api.listPullRequests('/repo', GH, { token: null, fetchImpl: fakeFetch(reply(404, {})) });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'no-token');
  assert.match(result.message, /private/i);
});

test('listPullRequests: 404 with a token means the token cannot see it', async () => {
  const result = await api.listPullRequests('/repo', GH, { token: 'tok', fetchImpl: fakeFetch(reply(404, {})) });

  assert.strictEqual(result.reason, 'not-found');
  assert.match(result.message, /yarism\/keep/);
});

test('listPullRequests: a rejected token says so, rather than blaming the network', async () => {
  const result = await api.listPullRequests('/repo', GH, { token: 'stale', fetchImpl: fakeFetch(reply(401, {})) });

  assert.strictEqual(result.reason, 'auth');
  assert.match(result.message, /expired|access/i);
});

// 403 is both "forbidden" and "you have used up your requests", and the answer
// to each is different — the header is the only thing that tells them apart.
test('listPullRequests: a spent rate limit is reported as one', async () => {
  const limited = reply(403, {}, { 'x-ratelimit-remaining': '0' });

  const result = await api.listPullRequests('/repo', GH, { token: null, fetchImpl: fakeFetch(limited) });

  assert.strictEqual(result.reason, 'rate-limit');
  assert.match(result.message, /rate limit/i);
});

test('listPullRequests: a 403 that is not a rate limit is an auth problem', async () => {
  const result = await api.listPullRequests('/repo', GH, {
    token: 'tok', fetchImpl: fakeFetch(reply(403, {}, { 'x-ratelimit-remaining': '57' })),
  });

  assert.strictEqual(result.reason, 'auth');
});

test('listPullRequests: an unreachable host is reported without throwing', async () => {
  const result = await api.listPullRequests('/repo', GH, {
    token: 'tok', fetchImpl: fakeFetch(new Error('getaddrinfo ENOTFOUND')),
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'network');
  assert.match(result.message, /github\.com/);
});

test('listPullRequests: a timeout says it timed out', async () => {
  const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });

  const result = await api.listPullRequests('/repo', GH, { token: 'tok', fetchImpl: fakeFetch(timeout) });

  assert.strictEqual(result.reason, 'network');
  assert.match(result.message, /did not answer/);
});

test('listPullRequests: nonsense in place of JSON is a failure, not a crash', async () => {
  const broken = { status: 200, ok: true, headers: { get: () => null }, json: async () => { throw new Error('bad'); } };

  const result = await api.listPullRequests('/repo', GH, { token: 'tok', fetchImpl: fakeFetch(broken) });

  assert.strictEqual(result.reason, 'http');
});

test('listPullRequests: a non-GitHub forge is declined before any request is made', async () => {
  const fetchImpl = fakeFetch(reply(200, []));

  const result = await api.listPullRequests('/repo', { kind: 'gitlab', host: 'gitlab.com' }, { fetchImpl });

  assert.strictEqual(result.reason, 'unsupported');
  assert.strictEqual(fetchImpl.calls.length, 0, 'nothing was asked of gitlab.com');
});

// ── the credential protocol ──

// The value below is deliberately not shaped like a real token. A fixture that
// mimics one — a `ghp_` prefix, a plausible username — is a credential as far
// as a secret scanner is concerned, and an alert that is always a false alarm
// trains everyone to ignore the next one. What the test is actually about is
// the "=" inside the value, which a naive split on "=" would truncate.
test('parseCredential: reads git\'s key=value answer, including a password with an "=" in it', () => {
  const out = 'protocol=https\nhost=github.com\nusername=example\npassword=fake-value-a=b=c\n';

  assert.deepStrictEqual(api.parseCredential(out), {
    protocol: 'https', host: 'github.com', username: 'example', password: 'fake-value-a=b=c',
  });
});

test('parseCredential: an empty or malformed answer yields no fields rather than junk', () => {
  assert.deepStrictEqual(api.parseCredential(''), {});
  assert.deepStrictEqual(api.parseCredential('no-equals-sign\n=leading\n'), {});
});

// ── reading a review ──

const COMMENT = {
  id: 900,
  in_reply_to_id: null,
  path: 'forge-api.js',
  side: 'RIGHT',
  line: 42,
  original_line: 40,
  user: { login: 'octocat', avatar_url: 'https://avatars.example/u/2' },
  diff_hunk: '@@ -1,3 +1,4 @@\n const a = 1;\n+const token = findToken(host);',
  body: 'Should this be cached per host?',
  created_at: '2026-08-24T09:00:00Z',
  html_url: 'https://github.com/yarism/keep/pull/12#discussion_r900',
};

test('listReviewComments: reduces a comment to where it hangs in the diff', async () => {
  const fetchImpl = fakeFetch(reply(200, [COMMENT]));

  const result = await api.listReviewComments('/repo', GH, { number: 12, token: 'tok', fetchImpl });

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.threads, [{
    id: 900,
    replyTo: null,
    replies: [],
    path: 'forge-api.js',
    side: 'RIGHT',
    line: 42,
    originalLine: 40,
    outdated: false,
    author: 'octocat',
    avatar: 'https://avatars.example/u/2',
    reactions: [],
    diffHunk: '@@ -1,3 +1,4 @@\n const a = 1;\n+const token = findToken(host);',
    body: 'Should this be cached per host?',
    createdAt: '2026-08-24T09:00:00Z',
    url: 'https://github.com/yarism/keep/pull/12#discussion_r900',
  }]);
});

// A comment whose line has moved out of the diff comes back with line: null.
// It is still worth reading — it is just no longer a row in the file.
test('listReviewComments: a comment on a line that no longer exists is marked outdated', async () => {
  const stale = { ...COMMENT, line: null, original_line: 40 };

  const result = await api.listReviewComments('/repo', GH, {
    number: 12, token: 'tok', fetchImpl: fakeFetch(reply(200, [stale])),
  });

  assert.strictEqual(result.threads[0].outdated, true);
  assert.strictEqual(result.threads[0].line, null);
  assert.strictEqual(result.threads[0].originalLine, 40);
});

test('listReviewComments: a reply is folded into the comment it answers', async () => {
  const replyComment = { ...COMMENT, id: 901, in_reply_to_id: 900, user: { login: 'yarism' } };

  const result = await api.listReviewComments('/repo', GH, {
    number: 12, token: 'tok', fetchImpl: fakeFetch(reply(200, [COMMENT, replyComment])),
  });

  assert.strictEqual(result.threads.length, 1, 'a reply is not a thread of its own');
  assert.strictEqual(result.threads[0].id, 900);
  assert.deepStrictEqual(result.threads[0].replies.map(r => r.author), ['yarism']);
});

// ── grouping, on its own ──

const c = (id, replyTo = null) => ({ id, replyTo, path: 'a.js', side: 'RIGHT', line: 1, author: 'x', body: '', replies: undefined });

// A reply names its immediate parent, so a three-deep chain would leave the
// last one dangling if grouping only looked one level up.
test('groupThreads: a reply to a reply still lands in the thread that started it', () => {
  const threads = api.groupThreads([c(1), c(2, 1), c(3, 2)]);

  assert.strictEqual(threads.length, 1);
  assert.deepStrictEqual(threads[0].replies.map(r => r.id), [2, 3]);
});

test('groupThreads: separate roots stay separate threads, in the order given', () => {
  const threads = api.groupThreads([c(1), c(2), c(3, 1)]);

  assert.deepStrictEqual(threads.map(t => t.id), [1, 2]);
  assert.deepStrictEqual(threads[0].replies.map(r => r.id), [3]);
  assert.deepStrictEqual(threads[1].replies, []);
});

// The page holds a hundred comments; the parent of one of them may be on the
// next page. Showing it alone beats dropping it.
test('groupThreads: a reply whose parent is missing becomes a thread rather than vanishing', () => {
  const threads = api.groupThreads([c(5, 999)]);

  assert.deepStrictEqual(threads.map(t => t.id), [5]);
});

// Nothing on GitHub produces this, but a cycle would hang the walk — and the
// first version of the fix for that dropped both comments on the floor, which
// is the quieter half of the same bug.
test('groupThreads: a cycle terminates, and loses nobody\'s comment doing it', () => {
  const threads = api.groupThreads([c(1, 2), c(2, 1)]);

  const seen = threads.flatMap(t => [t.id, ...t.replies.map(r => r.id)]);
  assert.deepStrictEqual(seen.sort(), [1, 2]);
});

test('groupThreads: no comments, no threads', () => {
  assert.deepStrictEqual(api.groupThreads([]), []);
});

// ── submitting one ──

const REVIEW = {
  number: 12,
  headSha: 'abc123',
  event: 'APPROVE',
  body: 'Looks good.',
  comments: [{ path: 'git.js', side: 'RIGHT', line: 10, body: 'nice' }],
};

test('submitReview: posts the verdict, the message and the comments in one request', async () => {
  const fetchImpl = fakeFetch(reply(200, { html_url: 'https://github.com/yarism/keep/pull/12#pullrequestreview-1', id: 1 }));

  const result = await api.submitReview('/repo', GH, REVIEW, { token: 'tok', fetchImpl });

  assert.strictEqual(result.ok, true);
  const { url, init } = fetchImpl.calls[0];
  assert.strictEqual(url, 'https://api.github.com/repos/yarism/keep/pulls/12/reviews');
  assert.strictEqual(init.method, 'POST');
  assert.deepStrictEqual(JSON.parse(init.body), {
    commit_id: 'abc123',
    body: 'Looks good.',
    event: 'APPROVE',
    comments: [{ path: 'git.js', line: 10, side: 'RIGHT', body: 'nice' }],
  });
});

// Reading a public repository needs no token; writing to one always does, and
// finding that out from a 401 after typing a review is the wrong moment.
test('submitReview: refuses before sending anything when there is no token', async () => {
  const fetchImpl = fakeFetch(reply(200, {}));

  const result = await api.submitReview('/repo', GH, REVIEW, { token: null, fetchImpl });

  assert.strictEqual(result.reason, 'no-token');
  assert.match(result.message, /needs a token/);
  assert.strictEqual(fetchImpl.calls.length, 0);
});

test('submitReview: an approval may be wordless, but a rejection may not', async () => {
  const fetchImpl = fakeFetch(reply(200, {}));

  const bare = { number: 12, headSha: 'abc', event: 'APPROVE', body: '', comments: [] };
  assert.strictEqual((await api.submitReview('/repo', GH, bare, { token: 't', fetchImpl })).ok, true);

  const silent = { ...bare, event: 'REQUEST_CHANGES' };
  const result = await api.submitReview('/repo', GH, silent, { token: 't', fetchImpl });
  assert.strictEqual(result.reason, 'rejected');
  assert.match(result.message, /needs a message/);
});

test('submitReview: a comment carries the review even with no message of its own', async () => {
  const fetchImpl = fakeFetch(reply(200, {}));
  const onlyComments = {
    number: 12, headSha: 'abc', event: 'COMMENT', body: '',
    comments: [{ path: 'a.js', side: 'RIGHT', line: 3, body: 'here' }],
  };

  assert.strictEqual((await api.submitReview('/repo', GH, onlyComments, { token: 't', fetchImpl })).ok, true);
});

test('submitReview: an unknown verdict never reaches GitHub', async () => {
  const fetchImpl = fakeFetch(reply(200, {}));

  const result = await api.submitReview('/repo', GH, { ...REVIEW, event: 'MERGE' }, { token: 't', fetchImpl });

  assert.strictEqual(result.reason, 'rejected');
  assert.strictEqual(fetchImpl.calls.length, 0);
});

// 422 is how a comment on a line outside the diff comes back, and GitHub's own
// wording names the field — which is the only clue to which comment it was.
test('submitReview: a rejected anchor is reported in GitHub\'s own words', async () => {
  const body = { message: 'Validation Failed', errors: [{ message: 'line must be part of the diff' }] };

  const result = await api.submitReview('/repo', GH, REVIEW, {
    token: 't', fetchImpl: fakeFetch(reply(422, body)),
  });

  assert.strictEqual(result.reason, 'rejected');
  assert.match(result.message, /Validation Failed — line must be part of the diff/);
});

test('submitReview: a token that cannot write says so rather than blaming the review', async () => {
  const result = await api.submitReview('/repo', GH, REVIEW, {
    token: 'readonly', fetchImpl: fakeFetch(reply(403, {}, { 'x-ratelimit-remaining': '55' })),
  });

  assert.strictEqual(result.reason, 'auth');
  assert.match(result.message, /not be allowed/);
});

test('submitReview: an unreachable host does not throw mid-submit', async () => {
  const result = await api.submitReview('/repo', GH, REVIEW, {
    token: 't', fetchImpl: fakeFetch(new Error('ECONNRESET')),
  });

  assert.strictEqual(result.reason, 'network');
});

// ── reactions ──
//
// The counts ride along on every comment, so showing them costs no request.
// Only the ones somebody actually used are worth a chip.

test('reactions: only the ones with a count survive, in GitHub\'s own order', async () => {
  const reacted = {
    ...COMMENT,
    reactions: { '+1': 3, '-1': 0, laugh: 0, hooray: 1, confused: 0, heart: 0, rocket: 0, eyes: 2, total_count: 6 },
  };

  const result = await api.listReviewComments('/repo', GH, {
    number: 12, token: 'tok', fetchImpl: fakeFetch(reply(200, [reacted])),
  });

  assert.deepStrictEqual(result.threads[0].reactions.map(r => [r.key, r.count]), [['+1', 3], ['hooray', 1], ['eyes', 2]]);
  assert.ok(result.threads[0].reactions.every(r => r.emoji), 'every chip has something to draw');
});

test('reactions: a comment with none, or with no summary at all, has no chips', async () => {
  const bare = { ...COMMENT, reactions: undefined };

  const result = await api.listReviewComments('/repo', GH, {
    number: 12, token: 'tok', fetchImpl: fakeFetch(reply(200, [bare])),
  });

  assert.deepStrictEqual(result.threads[0].reactions, []);
});

const COMMENT_TARGET = { type: 'comment', id: 900 };
const ISSUE_TARGET = { type: 'issue', number: 12 };

test('react: adds one to a review comment, and refuses without a token', async () => {
  const fetchImpl = fakeFetch(reply(201, { id: 7, content: '+1' }));

  const added = await api.react('/repo', GH, { target: COMMENT_TARGET, content: '+1', token: 'tok', fetchImpl });
  assert.strictEqual(added.ok, true);
  assert.strictEqual(fetchImpl.calls[0].init.method, 'POST');
  assert.deepStrictEqual(JSON.parse(fetchImpl.calls[0].init.body), { content: '+1' });
  assert.match(fetchImpl.calls[0].url, /\/pulls\/comments\/900\/reactions$/);

  const refused = await api.react('/repo', GH, { target: COMMENT_TARGET, content: '+1', token: null, fetchImpl });
  assert.strictEqual(refused.reason, 'no-token');
});

// The pull request's description is the body of an issue as far as the API is
// concerned, and neither the pulls list nor a single pull carries a reaction
// summary — only the issue view of the same number does.
test('react: the description reacts through the issue of the same number', async () => {
  const fetchImpl = fakeFetch(reply(201, { id: 9, content: 'heart' }));

  await api.react('/repo', GH, { target: ISSUE_TARGET, content: 'heart', token: 'tok', fetchImpl });

  assert.match(fetchImpl.calls[0].url, /\/repos\/yarism\/keep\/issues\/12\/reactions$/);
  assert.doesNotMatch(fetchImpl.calls[0].url, /pulls/);
});

// A DELETE answers 204 with an empty body, which is not JSON — taking that as a
// failure would report a reaction that did come off as one that did not.
test('reactToComment: removing one treats an empty answer as success', async () => {
  const noContent = { status: 204, ok: true, headers: { get: () => null }, json: async () => { throw new Error('empty'); } };

  const result = await api.react('/repo', GH, {
    target: COMMENT_TARGET, reactionId: 7, remove: true, token: 'tok', fetchImpl: fakeFetch(noContent),
  });

  assert.strictEqual(result.ok, true);
});

test('listReactions: reports who left each one, so yours can be taken back', async () => {
  const body = [
    { id: 7, content: '+1', user: { login: 'yarism' } },
    { id: 8, content: 'eyes', user: { login: 'octocat' } },
    { id: 9, content: '+1', user: { login: 'octocat' } },
  ];

  const result = await api.listReactions('/repo', GH, { target: COMMENT_TARGET, token: 'tok', fetchImpl: fakeFetch(reply(200, body)) });

  assert.deepStrictEqual(result.reactions.map(r => [r.id, r.content, r.user]), [
    [7, '+1', 'yarism'], [8, 'eyes', 'octocat'], [9, '+1', 'octocat'],
  ]);
  // Counts derived from the same answer, which is how the description gets its
  // chips without a summary to draw them from.
  assert.deepStrictEqual(result.counts.map(c => [c.key, c.count]), [['+1', 2], ['eyes', 1]]);
});

// ── resolved conversations ──

const threadsPayload = (nodes) => ({
  data: { repository: { pullRequest: { reviewThreads: { nodes } } } },
});

// Routes by URL, because the resolved state is a second call to a second API
// and the two answers are nothing alike.
function routedFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const match = Object.keys(routes).find(k => url.includes(k));
    if (!match) throw new Error(`no route for ${url}`);
    const r = routes[match];
    if (r instanceof Error) throw r;
    return r;
  };
  impl.calls = calls;
  return impl;
}

test('listThreadState: keys resolution on the comment that opened the thread', async () => {
  const fetchImpl = fakeFetch(reply(200, threadsPayload([
    { isResolved: true, isOutdated: false, comments: { nodes: [{ databaseId: 900 }] } },
    { isResolved: false, isOutdated: true, comments: { nodes: [{ databaseId: 901 }] } },
  ])));

  const result = await api.listThreadState('/repo', GH, { number: 12, token: 'tok', fetchImpl });

  assert.deepStrictEqual(result.threads, [
    { rootId: 900, resolved: true, outdated: false },
    { rootId: 901, resolved: false, outdated: true },
  ]);
  assert.strictEqual(fetchImpl.calls[0].url, 'https://api.github.com/graphql');
});

// GraphQL refuses anonymous requests where REST serves a public repository to
// anyone, which is the whole reason this cannot replace the REST call.
test('listThreadState: without a token it declines rather than asking', async () => {
  const fetchImpl = fakeFetch(reply(200, {}));

  const result = await api.listThreadState('/repo', GH, { number: 12, token: null, fetchImpl });

  assert.strictEqual(result.reason, 'no-token');
  assert.strictEqual(fetchImpl.calls.length, 0);
});

// GraphQL answers 200 with an errors array rather than an HTTP status, so a
// failure looks like success unless it is checked for.
test('listThreadState: an errors array is a failure, not an empty result', async () => {
  const fetchImpl = fakeFetch(reply(200, { errors: [{ message: 'Bad credentials' }] }));

  const result = await api.listThreadState('/repo', GH, { number: 12, token: 'tok', fetchImpl });

  assert.strictEqual(result.ok, false);
  assert.match(result.message, /Bad credentials/);
});

test('listReviewComments: marks the threads GraphQL says are resolved', async () => {
  const fetchImpl = routedFetch({
    '/pulls/12/comments': reply(200, [COMMENT]),
    '/graphql': reply(200, threadsPayload([
      { isResolved: true, isOutdated: false, comments: { nodes: [{ databaseId: 900 }] } },
    ])),
  });

  const result = await api.listReviewComments('/repo', GH, { number: 12, token: 'tok', fetchImpl });

  assert.strictEqual(result.threads[0].resolved, true);
  assert.strictEqual(result.resolutionKnown, true);
});

// The comments are the point; their resolution state is an annotation. Losing
// the annotation must not lose the conversation.
test('listReviewComments: still returns the comments when GraphQL will not answer', async () => {
  const fetchImpl = routedFetch({
    '/pulls/12/comments': reply(200, [COMMENT]),
    '/graphql': reply(401, {}),
  });

  const result = await api.listReviewComments('/repo', GH, { number: 12, token: 'tok', fetchImpl });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.threads.length, 1);
  assert.strictEqual(result.resolutionKnown, false);
  assert.strictEqual(result.threads[0].resolved, undefined, 'unknown is not the same as open');
});
