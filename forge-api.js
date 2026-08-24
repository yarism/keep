// Reading pull requests from GitHub.
//
// This is the one place in Keep that speaks HTTP. Everything else shells out to
// git, and the reason for the exception is that a pull request is not a git
// object: the branch is (see git.fetchPullRequest), but its number, title,
// author and state live only behind an API.
//
// Reading needs no account at all on a public repository. Submitting a review
// does — it writes to someone else's repository under the user's name — so
// submitReview() below refuses rather than guesses when no token is found, and
// says which of the two things is missing when GitHub turns it down.
//
// Merging a pull request is deliberately still absent. Reviewing is a judgement
// Keep can carry; merging is the irreversible half, and it stays where the
// branch protection rules and the required checks are visible.
//
// GitHub only, for now. GitLab and Bitbucket keep the link-out menu items from
// renderer/modules/forge.js; an abstraction over three different review models
// is worth writing once there are two implementations to abstract, not before.
const { execFile } = require('child_process');

const TIMEOUT_MS = 15000;
const CREDENTIAL_TIMEOUT_MS = 5000;
const PER_PAGE = 100;

// ── Finding a token ──
//
// Keep has no credential UI and does not want one (see the note in git.js), so
// it asks the two places a token already lives on a developer's machine, in
// order of how little they assume:
//
//   1. git's own credential helper, which the README already tells people to
//      configure and which the osxkeychain helper answers from the keychain.
//      Host-scoped by construction: asking for github.com cannot return a
//      credential stored for anywhere else.
//   2. the GitHub CLI, if it is installed and logged in.
//
// Neither is required. A public repository's pull requests are readable with no
// token at all, which is the case that needs no setup whatsoever.

// `git credential fill` answers in git's key=value protocol, one per line.
// Pure, so the parse is testable without a keychain.
function parseCredential(out) {
  const fields = {};
  String(out || '').split('\n').forEach(line => {
    const eq = line.indexOf('=');
    if (eq > 0) fields[line.slice(0, eq)] = line.slice(eq + 1);
  });
  return fields;
}

function runCapture(command, args, { cwd, input, env, timeout = CREDENTIAL_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = execFile(command, args, { cwd, env, timeout }, (err, stdout) => {
        resolve(err ? null : String(stdout));
      });
    } catch {
      return resolve(null);
    }
    // A missing binary (no gh installed) arrives as an error event, not a throw.
    child.on('error', () => resolve(null));
    if (input !== undefined && child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
  });
}

async function tokenFromCredentialHelper(repoPath, host) {
  const out = await runCapture('git', ['credential', 'fill'], {
    cwd: repoPath,
    input: `protocol=https\nhost=${host}\n\n`,
    // Without this, a machine with no helper configured makes git try to ask a
    // terminal that is not there — the hang git.js exists to prevent.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', GIT_CONFIG_NOSYSTEM: '0' },
  });
  if (!out) return null;
  const { password } = parseCredential(out);
  return password || null;
}

async function tokenFromGhCli(host) {
  // Only for github.com itself. `gh auth token` hands back the token for the
  // user's GitHub account, and a remote URL is not a trustworthy instruction
  // about where to send it: a repository could name a remote on
  // github.something-else.example, which parseRemote's `github.` convention
  // accepts as self-hosted. The credential helper above cannot be fooled that
  // way — it only answers for a host the user stored a credential for — but
  // this can, so it is pinned to the one host it is definitely about.
  if (host !== 'github.com') return null;
  const out = await runCapture('gh', ['auth', 'token']);
  const token = out && out.trim();
  return token || null;
}

// Cached per host for the life of the process: this shells out twice, and the
// PR list is refreshed on every poll of the repository.
const tokenCache = new Map();

async function findToken(repoPath, host) {
  if (tokenCache.has(host)) return tokenCache.get(host);
  const found = (await tokenFromCredentialHelper(repoPath, host))
    || (await tokenFromGhCli(host))
    || null;
  tokenCache.set(host, found);
  return found;
}

exports.forgetTokens = () => tokenCache.clear();
exports.parseCredential = parseCredential;

// ── The API ──

// GitHub Enterprise Server puts the same API under /api/v3 on its own host.
function apiBase(host) {
  return host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
}

// One pull request, reduced to what the UI shows. Everything else in GitHub's
// response is left behind rather than passed through, so what the renderer can
// depend on is visible here in one place.
function normalize(pr) {
  const head = pr.head || {};
  const base = pr.base || {};
  const headRepo = (head.repo && head.repo.full_name) || null;
  const baseRepo = (base.repo && base.repo.full_name) || null;
  return {
    number: pr.number,
    title: pr.title || '',
    body: pr.body || '',
    author: (pr.user && pr.user.login) || 'unknown',
    // The commit a review is anchored to. Comments are positions in a diff, and
    // a diff is only meaningful against the revision it was taken from.
    headSha: head.sha || null,
    draft: Boolean(pr.draft),
    head: head.ref || '',
    base: base.ref || '',
    // A pull request from a fork has a head branch this repository does not
    // have and never will; the row says so rather than looking like a branch
    // that failed to appear in the sidebar.
    fromFork: Boolean(headRepo && baseRepo && headRepo !== baseRepo),
    headRepo,
    url: pr.html_url || '',
    updatedAt: pr.updated_at || null,
    comments: (pr.comments || 0) + (pr.review_comments || 0),
  };
}

// Failures are returned, not thrown. Every one of them is a state the sidebar
// has to render as a sentence — "no token", "not found", "offline" are all
// ordinary outcomes here, not exceptions.
const fail = (reason, message) => ({ ok: false, reason, message });

exports.listPullRequests = async (repoPath, forge, opts = {}) => {
  const doFetch = opts.fetchImpl || globalThis.fetch;
  if (!forge || forge.kind !== 'github') {
    return fail('unsupported', 'Keep can only list pull requests on GitHub so far.');
  }
  const token = opts.token !== undefined ? opts.token : await findToken(repoPath, forge.host);
  const url = `${apiBase(forge.host)}/repos/${forge.owner}/${forge.repo}/pulls`
    + `?state=open&sort=updated&direction=desc&per_page=${PER_PAGE}`;

  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Keep',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await doFetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return fail('network', timedOut
      ? `${forge.host} did not answer within ${Math.round(TIMEOUT_MS / 1000)} seconds.`
      : `Could not reach ${forge.host}.`);
  }

  if (res.status === 401 || res.status === 403) {
    // 403 is also how the API reports a spent rate limit, which is a different
    // problem with a different answer — the remaining count tells them apart.
    const remaining = res.headers && res.headers.get && res.headers.get('x-ratelimit-remaining');
    if (remaining === '0') {
      return fail('rate-limit', token
        ? 'GitHub rate limit reached. It resets within the hour.'
        : 'GitHub rate limit reached for unauthenticated requests. Signing in raises it a long way — '
          + 'store a token with `gh auth login`, or with a git credential helper.');
    }
    return fail('auth', token
      ? 'GitHub rejected the stored token. It may have expired, or lack access to this repository.'
      : noTokenMessage());
  }
  if (res.status === 404) {
    // A private repository is indistinguishable from a missing one when you
    // cannot see it, and saying "not found" to someone looking at a repo they
    // have open is the least useful of the two readings.
    return fail(token ? 'not-found' : 'no-token', token
      ? `No repository ${forge.owner}/${forge.repo} on ${forge.host}, or the token cannot see it.`
      : noTokenMessage());
  }
  if (!res.ok) {
    return fail('http', `${forge.host} answered ${res.status}.`);
  }

  let body;
  try { body = await res.json(); } catch { return fail('http', `${forge.host} sent something that is not JSON.`); }
  if (!Array.isArray(body)) return fail('http', `${forge.host} sent something unexpected.`);

  return {
    ok: true,
    authenticated: Boolean(token),
    // Nothing pages past the first hundred, so say so rather than quietly
    // showing a hundred and calling it the list.
    truncated: body.length === PER_PAGE,
    pulls: body.map(normalize),
  };
};

function noTokenMessage() {
  return 'This repository is private, or needs a token to read. Keep looks for one in your git '
    + 'credential helper and in the GitHub CLI — `gh auth login` is the shortest way to provide it.';
}

// ── Reading a review ──

// Everything one request can say about the state of the API call, shared by the
// endpoints below so each one does not invent its own vocabulary for "your
// token has expired".
async function request(url, { token, method = 'GET', body, host, fetchImpl } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Keep',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await doFetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return fail('network', timedOut
      ? `${host} did not answer within ${Math.round(TIMEOUT_MS / 1000)} seconds.`
      : `Could not reach ${host}.`);
  }
  if (res.status === 401 || res.status === 403) {
    const remaining = res.headers && res.headers.get && res.headers.get('x-ratelimit-remaining');
    if (remaining === '0') return fail('rate-limit', 'GitHub rate limit reached. It resets within the hour.');
    return fail('auth', token
      ? 'GitHub rejected the token. It may have expired, or may not be allowed to do this.'
      : noTokenMessage());
  }
  if (res.status === 404) return fail('not-found', `${host} has no such pull request, or the token cannot see it.`);
  if (res.status === 422) {
    // The one status worth reading the body for: 422 is how GitHub reports a
    // comment anchored to a line that is not part of the diff, and its message
    // names the offending field.
    let detail = '';
    try {
      const parsed = await res.json();
      detail = [parsed.message, ...(parsed.errors || []).map(e => e.message || e.field).filter(Boolean)]
        .filter(Boolean).join(' — ');
    } catch { /* keep the generic wording below */ }
    return fail('rejected', detail || 'GitHub would not accept the review.');
  }
  if (!res.ok) return fail('http', `${host} answered ${res.status}.`);

  let parsed = null;
  try { parsed = await res.json(); } catch { return fail('http', `${host} sent something that is not JSON.`); }
  return { ok: true, body: parsed };
}

// One inline comment, as the diff needs it: which file, which side, which line.
//
// `line` is null once a comment has gone stale — the line it was left on is no
// longer part of the diff, because the branch moved on underneath it. GitHub
// keeps `original_line` in that case, and the comment is still worth showing;
// it just cannot be pinned to a row. `outdated` is what the UI reads to decide.
function normalizeComment(c) {
  return {
    id: c.id,
    replyTo: c.in_reply_to_id || null,
    path: c.path || '',
    side: c.side === 'LEFT' ? 'LEFT' : 'RIGHT',
    line: typeof c.line === 'number' ? c.line : null,
    originalLine: typeof c.original_line === 'number' ? c.original_line : null,
    outdated: typeof c.line !== 'number',
    author: (c.user && c.user.login) || 'unknown',
    body: c.body || '',
    createdAt: c.created_at || null,
    url: c.html_url || '',
  };
}

// GitHub returns a flat list in which a reply names the comment it answers, so
// a thread is rebuilt by walking each reply back to the comment that started
// it. Walking rather than one lookup: a reply to a reply names its immediate
// parent, not the root of the thread.
function groupThreads(comments) {
  const byId = new Map(comments.map(c => [c.id, c]));
  const roots = [];
  const repliesFor = new Map();
  comments.forEach(c => {
    if (!c.replyTo) { roots.push(c); return; }
    let parent = byId.get(c.replyTo);
    const seen = new Set([c.id]);
    while (parent && parent.replyTo && !seen.has(parent.id)) {
      seen.add(parent.id);
      parent = byId.get(parent.replyTo);
    }
    // Two ways the walk can end without a root: the parent is on a page this
    // request did not fetch, or the chain loops. Either way the comment itself
    // is real and someone wrote it, so it stands alone rather than vanishing
    // into a thread that does not exist.
    if (!parent || parent.replyTo) { roots.push(c); return; }
    const list = repliesFor.get(parent.id) || [];
    list.push(c);
    repliesFor.set(parent.id, list);
  });
  return roots.map(r => ({ ...r, replies: repliesFor.get(r.id) || [] }));
}
exports.groupThreads = groupThreads;

exports.listReviewComments = async (repoPath, forge, opts = {}) => {
  if (!forge || forge.kind !== 'github') return fail('unsupported', 'Not a GitHub repository.');
  const token = opts.token !== undefined ? opts.token : await findToken(repoPath, forge.host);
  const url = `${apiBase(forge.host)}/repos/${forge.owner}/${forge.repo}/pulls/${opts.number}/comments?per_page=${PER_PAGE}`;
  const result = await request(url, { token, host: forge.host, fetchImpl: opts.fetchImpl });
  if (!result.ok) return result;
  if (!Array.isArray(result.body)) return fail('http', `${forge.host} sent something unexpected.`);
  return { ok: true, threads: groupThreads(result.body.map(normalizeComment)) };
};

// ── Submitting one ──

const EVENTS = new Set(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']);

// GitHub can create and submit a review in a single request, which is why Keep
// keeps its draft comments locally rather than as a server-side pending review:
// nothing exists on GitHub until the user submits, so there is no half-written
// review of theirs sitting in a browser tab contradicting this one, and closing
// Keep mid-review leaves no trace on the repository.
exports.submitReview = async (repoPath, forge, review, opts = {}) => {
  if (!forge || forge.kind !== 'github') return fail('unsupported', 'Not a GitHub repository.');
  if (!EVENTS.has(review.event)) return fail('rejected', `Not a review verdict: ${review.event}`);
  // GitHub rejects an empty REQUEST_CHANGES or COMMENT, and the message it
  // returns for it is about a missing field rather than about what to do.
  if (review.event !== 'APPROVE' && !String(review.body || '').trim() && !(review.comments || []).length) {
    return fail('rejected', 'A review that is not an approval needs a message or at least one comment.');
  }

  const token = opts.token !== undefined ? opts.token : await findToken(repoPath, forge.host);
  if (!token) {
    return fail('no-token', 'Submitting a review needs a token — reading one does not. Keep reads whatever '
      + 'the GitHub CLI or your git credential helper holds; `gh auth login` is the shortest way to provide it.');
  }

  const url = `${apiBase(forge.host)}/repos/${forge.owner}/${forge.repo}/pulls/${review.number}/reviews`;
  const result = await request(url, {
    token,
    host: forge.host,
    method: 'POST',
    fetchImpl: opts.fetchImpl,
    body: {
      commit_id: review.headSha || undefined,
      body: review.body || '',
      event: review.event,
      comments: (review.comments || []).map(c => ({
        path: c.path,
        line: c.line,
        side: c.side,
        body: c.body,
      })),
    },
  });
  if (!result.ok) return result;
  return { ok: true, url: (result.body && result.body.html_url) || '', id: result.body && result.body.id };
};
