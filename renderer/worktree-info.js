// What the sidebar says about a worktree, worked out from nothing but its path
// and what git recorded about it. Pure, so it is tested without a DOM or a
// repository, the same way notify-policy.js and release-plan.js are.
//
// A worktree is one working copy of a repository that has several. The list
// comes from git (`git worktree list`), so where the folder sits never decides
// whether Keep sees it; the path only decides what the row is called.

// The agents known to make worktrees, by where they put them. Claude Code
// keeps them inside the repository (hidden from the working copy through
// .git/info/exclude); Copilot keeps them under its own home folder. Anything
// else is named after its folder.
const AGENTS = [
  { pattern: /\/\.claude\/worktrees\//, name: 'Claude Code' },
  { pattern: /\/\.copilot\/repos\/copilot-worktrees\//, name: 'Copilot' },
];

export function worktreeSource(path) {
  const p = String(path || '');
  const hit = AGENTS.find(a => a.pattern.test(p));
  return hit ? hit.name : null;
}

// The last path segment. Paths come from git with forward slashes on every
// platform; a trailing slash (a typed path) must not yield an empty name.
export function basename(path) {
  return String(path || '').replace(/\/+$/, '').split('/').pop();
}

// What the row is called: the branch checked out there, or, for a detached
// HEAD, the commit it sits on, said the way the branch list says it.
export function worktreeLabel(wt) {
  if (wt.branch) return wt.branch;
  if (wt.head) return `${wt.head.slice(0, 7)} (detached)`;
  return basename(wt.path);
}

// The short word on the right of a worktree row, and in the badge on a branch
// another worktree holds: the repository's folder for the main worktree, the
// agent for one an agent made, the folder name for anything else. Short on
// purpose, since it shares the row with the branch name.
export function worktreeTag(wt, mainPath) {
  if (wt.isMain || (mainPath && wt.path === mainPath)) return basename(mainPath || wt.path);
  return worktreeSource(wt.path) || basename(wt.path);
}

// The folder a `git checkout` refused over, or null when it refused for some
// other reason. Two wordings: "is already checked out at" through git 2.49,
// "is already used by worktree at" from 2.50.
export function parseCheckoutRefusal(message) {
  const m = /already (?:used by worktree|checked out) at '([^']+)'/.exec(String(message || ''));
  return m ? m[1] : null;
}

// Where a new worktree is offered to go: next to the repository, named after
// it and the branch, which is where people put them by hand ("keep" and
// "keep-fix-login" side by side). The branch is flattened to something a
// folder name can hold.
export function defaultWorktreeFolder(mainPath, branch) {
  const root = String(mainPath || '').replace(/\/+$/, '');
  const parent = root.slice(0, root.lastIndexOf('/'));
  const slug = String(branch || 'worktree').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'worktree';
  return `${parent}/${basename(root)}-${slug}`;
}

// The tooltip on a repository's dirty badge, now that the count covers every
// worktree: `elsewhere` is [{ tag, count }] for the linked worktrees with
// uncommitted work, so the number can be traced to where the work is.
export function dirtyBadgeTitle(total, elsewhere = []) {
  const changes = (n) => `${n} uncommitted ${n === 1 ? 'change' : 'changes'}`;
  const others = elsewhere.filter(e => e.count > 0);
  if (!others.length) return changes(total);
  const away = others.reduce((sum, e) => sum + e.count, 0);
  if (others.length === 1) {
    const [{ tag, count }] = others;
    return count === total
      ? `${changes(total)}, all in the ${tag} worktree`
      : `${changes(total)}, ${count} in the ${tag} worktree`;
  }
  const breakdown = others.map(e => `${e.tag} ${e.count}`).join(', ');
  return away === total
    ? `${changes(total)}, all in other worktrees (${breakdown})`
    : `${changes(total)}, ${away} in other worktrees (${breakdown})`;
}
