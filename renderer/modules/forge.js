// Turning a remote URL into the web pages that sit behind it.
//
// Keep talks to git and nothing else — no HTTP client, no token, no account.
// What it can do for free is stop being the reason you go hunting for a browser
// tab: a remote URL already names the host, the owner and the repository, and
// every forge builds its page URLs from those three by a fixed rule. So this
// module is pure string work, and everything it produces is opened in the
// user's browser rather than fetched.
//
// Known hosts only. A self-hosted forge is indistinguishable from any other
// server by its URL alone, so `github.`/`gitlab.` prefixes are honoured as a
// convention (github.acme.com) and anything else returns null — no menu item
// beats one that leads to a 404.
const HOSTS = [
  { kind: 'github', match: (h) => h === 'github.com' || h.startsWith('github.') },
  { kind: 'gitlab', match: (h) => h === 'gitlab.com' || h.startsWith('gitlab.') },
  { kind: 'bitbucket', match: (h) => h === 'bitbucket.org' },
];

// scp-style (git@host:owner/repo.git) is not a URL and `new URL` rejects it,
// so it is matched first and rewritten into one.
const SCP = /^(?:([^@/]+)@)?([^:/]+):(.+)$/;

export function parseRemote(url) {
  if (!url) return null;
  let host, pathname;
  const scp = !url.includes('://') && SCP.exec(url.trim());
  if (scp) {
    host = scp[2];
    pathname = scp[3];
  } else {
    try {
      const u = new URL(url.trim());
      if (!/^(https?|ssh|git):$/.test(u.protocol)) return null;
      host = u.hostname;
      pathname = u.pathname;
    } catch { return null; }
  }
  const forge = HOSTS.find(f => f.match(host.toLowerCase()));
  if (!forge) return null;

  // owner may be several segments deep — GitLab nests groups arbitrarily — so
  // the repository is the last segment and the owner is everything before it.
  const parts = pathname.replace(/^\/+/, '').replace(/\.git$/, '').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const repo = parts[parts.length - 1];
  const owner = parts.slice(0, -1).join('/');
  return { kind: forge.kind, host, owner, repo, base: `https://${host}/${owner}/${repo}` };
}

// A branch name may contain slashes (feature/x) and the forges all want those
// left as path separators — so encode per segment, not the whole string.
const encodePath = (ref) => ref.split('/').map(encodeURIComponent).join('/');

const NAMES = {
  github: { label: 'GitHub', pr: 'Pull Request', prs: 'Pull Requests' },
  gitlab: { label: 'GitLab', pr: 'Merge Request', prs: 'Merge Requests' },
  bitbucket: { label: 'Bitbucket', pr: 'Pull Request', prs: 'Pull Requests' },
};

export const forgeLabel = (f) => (f && NAMES[f.kind] ? NAMES[f.kind].label : 'Remote');
export const pullRequestNoun = (f) => (f && NAMES[f.kind] ? NAMES[f.kind].pr : 'Pull Request');
export const pullRequestsNoun = (f) => (f && NAMES[f.kind] ? NAMES[f.kind].prs : 'Pull Requests');

export function repoUrl(f) {
  return f ? f.base : null;
}

export function branchUrl(f, branch) {
  if (!f || !branch) return null;
  const ref = encodePath(branch);
  if (f.kind === 'gitlab') return `${f.base}/-/tree/${ref}`;
  if (f.kind === 'bitbucket') return `${f.base}/src/${ref}`;
  return `${f.base}/tree/${ref}`;
}

export function commitUrl(f, hash) {
  if (!f || !hash) return null;
  const h = encodeURIComponent(hash);
  if (f.kind === 'gitlab') return `${f.base}/-/commit/${h}`;
  if (f.kind === 'bitbucket') return `${f.base}/commits/${h}`;
  return `${f.base}/commit/${h}`;
}

export function pullRequestsUrl(f) {
  if (!f) return null;
  if (f.kind === 'gitlab') return `${f.base}/-/merge_requests`;
  if (f.kind === 'bitbucket') return `${f.base}/pull-requests`;
  return `${f.base}/pulls`;
}

// The "open a pull request" page, pre-filled with this branch as the source.
// Each forge spells that differently; none of them need the base branch, which
// is what keeps this honest — the forge picks its own default and shows the
// user the form rather than Keep guessing.
export function newPullRequestUrl(f, branch) {
  if (!f || !branch) return null;
  if (f.kind === 'gitlab') {
    return `${f.base}/-/merge_requests/new?merge_request[source_branch]=${encodeURIComponent(branch)}`;
  }
  if (f.kind === 'bitbucket') {
    return `${f.base}/pull-requests/new?source=${encodeURIComponent(branch)}`;
  }
  return `${f.base}/compare/${encodePath(branch)}?expand=1`;
}

// Which remote a branch belongs to. The upstream carries it ("origin/feature"),
// but a remote may itself be named with a slash, so the longest matching name
// wins. Without an upstream there is nothing to be sure of: fall back to the
// conventional name, then to whichever remote is a forge at all.
export function remoteForBranch(remotes, upstream) {
  if (!remotes || !remotes.length) return null;
  if (upstream) {
    const named = remotes
      .filter(r => upstream === r.name || upstream.startsWith(r.name + '/'))
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (named) return named;
  }
  return remotes.find(r => r.name === 'origin') || remotes[0] || null;
}

// The forge behind a branch, or null when nothing about this repo is hosted
// somewhere Keep recognises.
export function forgeForBranch(remotes, upstream) {
  const remote = remoteForBranch(hostedRemotes(remotes), upstream);
  return remote ? parseRemote(remote.url) : null;
}

// What the branch is called on the server, which is not always what it is
// called here — `git push origin local:other` sets an upstream that disagrees.
// The upstream is the authority; the local name is only a fallback for a branch
// that has never been pushed, where there is no server-side name to be right
// about anyway.
export function remoteBranchName(remotes, upstream, fallback) {
  const remote = remoteForBranch(hostedRemotes(remotes), upstream);
  if (upstream && remote && upstream.startsWith(remote.name + '/')) {
    return upstream.slice(remote.name.length + 1);
  }
  return fallback;
}

function hostedRemotes(remotes) {
  return (remotes || []).filter(r => parseRemote(r.url));
}
