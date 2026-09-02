import { $, state, suspendTitlebarDrag } from './state.js';
import { showModal, showConfirm } from './modal.js';
import {
  forgeForBranch, remoteBranchName, forgeLabel, pullRequestNoun, pullRequestsNoun,
  newPullRequestUrl, branchUrl, commitUrl, pullRequestsUrl,
} from './forge.js';
import { watchBuild } from './build-watch.js';

async function hasDirtyFiles() {
  try {
    const files = await window.git.status(state.repoPath);
    return files.length > 0;
  } catch { return false; }
}

export async function confirmCheckout(target, refresh) {
  if (await hasDirtyFiles()) {
    const ok = await showConfirm('Uncommitted Changes', `You have uncommitted changes. Checking out "${target}" may discard them.\n\nContinue?`);
    if (!ok) return;
  }
  try { await window.git.checkout(state.repoPath, target); await refresh(); } catch (err) { alert(err.message); }
}

export function setupContextMenu() {
  document.addEventListener('click', () => hideContextMenu());
}

export function showContextMenu(e, items) {
  const menu = $('#context-menu');
  const menuItems = $('#context-menu-items');
  menuItems.innerHTML = '';
  items.forEach(item => {
    if (item.separator) {
      const s = document.createElement('div');
      s.className = 'context-menu-separator';
      menuItems.appendChild(s);
      return;
    }
    const el = document.createElement('div');
    el.className = 'context-menu-item' + (item.disabled ? ' disabled' : '');
    el.textContent = item.label;
    if (!item.disabled) el.addEventListener('click', () => { hideContextMenu(); item.action(); });
    menuItems.appendChild(el);
  });
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.hidden = false;
  suspendTitlebarDrag('context-menu', true);
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 4) + 'px';
  });
}

function hideContextMenu() {
  $('#context-menu').hidden = true;
  suspendTitlebarDrag('context-menu', false);
}

// ── Links out to the hosting forge ──
//
// Keep holds no account and asks the forge nothing; these items only build a
// URL and hand it to the browser. They are absent, rather than disabled, when
// the repository has no remote Keep recognises — a menu that grows an inert
// "GitHub" row on a repo that lives on a company GitLab is worse than one that
// says nothing.
function openExternal(url) {
  if (url) window.git.openExternal(url);
}

function forgeBranchItems(branch) {
  if (branch.detached) return [];
  const f = forgeForBranch(state.remotes, branch.upstream);
  if (!f) return [];
  const where = forgeLabel(f);
  // A pull request is a comparison between two branches the server can see, so
  // an unpublished branch has nothing to open one from, and its /tree/ page
  // does not exist yet. Push comes first; the item stays visible to say so.
  const published = Boolean(branch.upstream);
  const ref = remoteBranchName(state.remotes, branch.upstream, branch.name);
  return [
    { separator: true },
    { label: `Create ${pullRequestNoun(f)} on ${where}...`, disabled: !published, action: () => openExternal(newPullRequestUrl(f, ref)) },
    { label: `View ${pullRequestsNoun(f)} on ${where}`, action: () => openExternal(pullRequestsUrl(f)) },
    { label: `View Branch on ${where}`, disabled: !published, action: () => openExternal(branchUrl(f, ref)) },
  ];
}

function forgeCommitItems(commit) {
  const f = forgeForBranch(state.remotes, null);
  if (!f) return [];
  // History already knows which commits no remote has — the same set that draws
  // them as hollow nodes — so an unpushed commit's page is known to be a 404
  // before the browser is opened.
  const pushed = !state.unpushed.has(commit.hash);
  const short = commit.hash.substring(0, 7);
  return [
    { separator: true },
    { label: `View Commit on ${forgeLabel(f)}`, disabled: !pushed, action: () => openExternal(commitUrl(f, commit.hash)) },
    // A commit no remote has cannot have been built, and the card would sit
    // waiting for a run that was never asked for.
    ...(f.kind === 'github' ? [{ label: `Watch the Build for "${short}"`, disabled: !pushed, action: () => {
      watchBuild({ repoPath: state.repoPath, repoName: state.repoPath.split('/').pop(), sha: commit.hash, forge: f, asked: true });
    } }] : []),
  ];
}

export function showBranchContextMenu(e, branch, refresh) {
  showContextMenu(e, [
    { label: `Check Out "${branch.name}"`, disabled: branch.current, action: () => confirmCheckout(branch.name, refresh) },
    { separator: true },
    { label: 'Pull...', action: async () => { try { await window.git.pull(state.repoPath); await refresh(); } catch (err) { alert(err.message); } }},
    { label: 'Push...', action: async () => { try { await window.git.push(state.repoPath); await refresh(); } catch (err) { alert(err.message); } }},
    ...forgeBranchItems(branch),
    { separator: true },
    { label: 'Merge With Revision...', disabled: branch.current, action: async () => { try { await window.git.merge(state.repoPath, branch.name); await refresh(); } catch (err) { alert(err.message); } }},
    { label: 'Rebase On Revision...', disabled: branch.current, action: async () => { try { await window.git.rebase(state.repoPath, branch.name); await refresh(); } catch (err) { alert(err.message); } }},
    { separator: true },
    { label: `Rename "${branch.name}"...`, action: async () => { const n = await showModal('Rename Branch', `New name for "${branch.name}"`, branch.name); if (n) { try { await window.git.renameBranch(state.repoPath, branch.name, n); await refresh(); } catch (err) { alert(err.message); } } }},
    { label: `Delete "${branch.name}"...`, disabled: branch.current, action: async () => { if (confirm(`Delete branch "${branch.name}"?`)) { try { await window.git.deleteBranch(state.repoPath, branch.name); await refresh(); } catch (err) { alert(err.message); } } }},
    { separator: true },
    { label: `Create New Branch from "${branch.name}"...`, action: async () => { const n = await showModal('Create Branch', `Branch name (from "${branch.name}")`); if (n) { try { await window.git.createBranch(state.repoPath, n, branch.name); await refresh(); } catch (err) { alert(err.message); } } }},
    { label: `Create New Tag from "${branch.name}"...`, action: async () => { const n = await showModal('Create Tag', `Tag name (from "${branch.name}")`); if (n) { try { await window.git.createTag(state.repoPath, n, branch.name); await refresh(); } catch (err) { alert(err.message); } } }},
  ]);
}

export function showTagContextMenu(e, tag, refresh) {
  // Only GitHub is asked about builds, so the item is absent rather than dead
  // everywhere else.
  const forge = forgeForBranch(state.remotes, null);
  const buildable = forge && forge.kind === 'github';

  showContextMenu(e, [
    { label: 'Copy Tag Name to Clipboard', action: () => navigator.clipboard.writeText(tag) },
    ...(buildable ? [{ label: `Watch the Build for "${tag}"`, action: () => {
      watchBuild({
        repoPath: state.repoPath,
        repoName: state.repoPath.split('/').pop(),
        tag,
        forge,
        asked: true,
      });
    } }] : []),
    { separator: true },
    // Checking out a tag detaches HEAD; confirmCheckout already warns about
    // uncommitted changes first, and the sidebar renders the detached state.
    { label: `Check Out "${tag}"`, action: () => confirmCheckout(tag, refresh) },
    { label: `Create New Branch from "${tag}"...`, action: async () => {
      const n = await showModal('Create Branch', `Branch name (from "${tag}")`);
      if (!n) return;
      try { await window.git.createBranch(state.repoPath, n, tag); await refresh(); }
      catch (err) { alert(err.message); }
    }},
    { separator: true },
    { label: `Delete "${tag}"...`, action: async () => {
      const ok = await showConfirm('Delete Tag', `Delete the local tag "${tag}"?\n\nThis does not delete it from the remote.`);
      if (!ok) return;
      try { await window.git.deleteTag(state.repoPath, tag); await refresh(); }
      catch (err) { alert(err.message); }
    }},
  ]);
}

export function showCommitContextMenu(e, commit, refresh) {
  const h = commit.hash.substring(0, 7);
  showContextMenu(e, [
    { label: 'Copy Commit Hash to Clipboard', action: () => navigator.clipboard.writeText(commit.hash) },
    { label: 'Copy Commit Info to Clipboard', action: () => navigator.clipboard.writeText(`${commit.hash} ${commit.subject}\nAuthor: ${commit.author}\nDate: ${commit.date}`) },
    { separator: true },
    { label: `Check Out "${h}"`, action: () => confirmCheckout(commit.hash, refresh) },
    { separator: true },
    // Onto whatever is checked out now — which is the one thing a hash in a
    // list does not tell you, so the branch is named in the question.
    { label: `Cherry-Pick "${h}"...`, action: async () => {
      const onto = (state.branchList.find(b => b.current) || {}).name;
      const ok = await showConfirm('Cherry-Pick Commit', onto
        ? `Apply the changes from "${h}" as a new commit on "${onto}"?`
        : `Apply the changes from "${h}" as a new commit on the current branch?`);
      if (!ok) return;
      try { await window.git.cherryPick(state.repoPath, commit.hash); await refresh(); }
      catch (err) { alert(err.message); await refresh(); }
    }},
    { label: `Revert "${h}"...`, action: async () => { const ok = await showConfirm('Revert Commit', `Create a new commit that undoes changes from "${h}"?`); if (!ok) return; try { await window.git.revert(state.repoPath, commit.hash); await refresh(); } catch (err) { alert(err.message); } }},
    { separator: true },
    { label: `Create New Branch from "${h}"...`, action: async () => { const n = await showModal('Create Branch', `Branch name (from ${h})`); if (n) { try { await window.git.createBranch(state.repoPath, n, commit.hash); await refresh(); } catch (err) { alert(err.message); } } }},
    { label: `Create New Tag from "${h}"...`, action: async () => { const n = await showModal('Create Tag', `Tag name (from ${h})`); if (n) { try { await window.git.createTag(state.repoPath, n, commit.hash); await refresh(); } catch (err) { alert(err.message); } } }},
    ...forgeCommitItems(commit),
  ]);
}
