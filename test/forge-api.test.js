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
  user: { login: 'yarism' },
  draft: false,
  head: { ref: 'pr-support', repo: { full_name: 'yarism/keep' } },
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
    author: 'yarism',
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

  await api.listPullRequests('/repo', GH, { token: 'ghp_x', fetchImpl });

  assert.strictEqual(fetchImpl.calls[0].init.headers.Authorization, 'Bearer ghp_x');
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

test('parseCredential: reads git\'s key=value answer, including a password with an "=" in it', () => {
  const out = 'protocol=https\nhost=github.com\nusername=yarism\npassword=ghp_a=b=c\n';

  assert.deepStrictEqual(api.parseCredential(out), {
    protocol: 'https', host: 'github.com', username: 'yarism', password: 'ghp_a=b=c',
  });
});

test('parseCredential: an empty or malformed answer yields no fields rather than junk', () => {
  assert.deepStrictEqual(api.parseCredential(''), {});
  assert.deepStrictEqual(api.parseCredential('no-equals-sign\n=leading\n'), {});
});
