// The Worktrees section of the sidebar: every working copy of the open
// repository, and the ways in and out of them.
//
// A repository can have several working copies checked out at once (one per
// branch, all sharing the same refs), and AI coding agents make them freely:
// Claude Code under <repo>/.claude/worktrees/, Copilot under its own home
// folder. Before this section Keep saw none of that. The agent's branch sat in
// the list looking checkoutable and failed when tried, and its uncommitted work
// was nowhere on screen.
//
// Reading is git's (`git worktree list`, in git.js); this file decides what a
// row says and what right-clicking it offers. Switching to a worktree re-enters
// the workspace on that folder, exactly as opening a repository does, so every
// view simply shows that working copy: the same refs, a different checkout.
import { $, escapeHtml, state, openWorkspace } from './state.js';
import { icon } from '../icons.js';
import { showContextMenu } from './context-menu.js';
import { showConfirm, showModal, showSelect } from './modal.js';
import { toast } from './toast.js';
import { worktreeLabel, worktreeTag, defaultWorktreeFolder } from '../worktree-info.js';

export function resetWorktrees() {
  state.worktrees = { main: null, current: null, list: [] };
}

// `preloaded` is a list someone has already read (opening a repository starts
// that read early, alongside its others), so it is not read twice.
export async function refreshWorktrees(refresh, preloaded) {
  if (preloaded) state.worktrees = preloaded;
  else try { state.worktrees = await window.git.worktrees(state.repoPath); } catch { resetWorktrees(); }
  renderWorktrees(refresh);
}

// Rendering is separate from reading so a repository can be painted from what
// it looked like last time, before git has answered anything.
export function renderWorktrees(refresh) {
  const list = $('#worktrees-list');
  if (!list) return;
  list.innerHTML = '';
  const { main, list: worktrees } = state.worktrees;
  worktrees.forEach(wt => {
    const item = document.createElement('div');
    item.className = 'worktree-item'
      + (wt.isCurrent ? ' current' : '')
      + (wt.detached ? ' detached' : '')
      + (wt.prunable ? ' prunable' : '');
    item.title = describeWorktree(wt);
    // The row is the working copy, not the branch: the branch (or the commit a
    // detached HEAD sits on) is its label, and the folder it lives in, or the
    // agent that made it, is the word on the right.
    item.innerHTML = `
      ${icon('worktree', 14)}
      <span class="worktree-item-name">${escapeHtml(worktreeLabel(wt))}</span>
      <span class="worktree-item-badge" hidden></span>
      <span class="worktree-item-tag">${escapeHtml(worktreeTag(wt, main))}</span>
    `;
    fillDirtyBadge(item, wt);
    // Double-click, as checking out a branch is: switching replaces every
    // view in the window with another working copy, which is not something a
    // stray click while scrolling the sidebar should do. Single click only
    // marks the row, so the keyboard and the context menu have a target.
    item.tabIndex = 0;
    item.addEventListener('click', () => {
      list.querySelectorAll('.worktree-item.selected').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
    });
    item.addEventListener('dblclick', () => {
      if (wt.isCurrent || wt.prunable) return;
      openWorkspace(wt.path);
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !wt.isCurrent && !wt.prunable) openWorkspace(wt.path);
    });
    item.addEventListener('contextmenu', (e) => { e.preventDefault(); showWorktreeContextMenu(e, wt, refresh); });
    list.appendChild(item);
  });
}

function describeWorktree(wt) {
  const lines = [wt.path];
  if (wt.locked) lines.push(`Locked: ${wt.locked}`);
  if (wt.prunable) lines.push(`Folder missing: ${wt.prunable}`);
  return lines.join('\n');
}

// Uncommitted work in a worktree is the thing an agent leaves behind and the
// reason to go there, so each row says how much of it there is. The open
// worktree's count is already known; the others are a status read each, which
// fill in as they answer rather than holding the list up.
async function fillDirtyBadge(item, wt) {
  let count;
  if (wt.isCurrent) count = state.statusFiles.length;
  else {
    try { count = (await window.git.status(wt.path)).length; }
    catch { return; }
  }
  if (!count) return;
  const badge = item.querySelector('.worktree-item-badge');
  if (!badge) return;
  badge.textContent = count;
  badge.hidden = false;
}

export function setupWorktreesSection(refresh) {
  $('#btn-add-worktree').addEventListener('click', () => addWorktree(refresh));
  // Pruning has no row to hang off (its subjects are the worktrees whose
  // folders are gone), so, like adding a remote, it lives on the header.
  $('#worktrees-section-header').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!state.repoPath) return;
    showContextMenu(e, [
      { label: 'Add Worktree...', action: () => addWorktree(refresh) },
      { label: 'Prune Stale Worktrees', action: () => prune(refresh) },
    ]);
  });
}

export function showWorktreeContextMenu(e, wt, refresh) {
  const label = worktreeLabel(wt);
  const gone = Boolean(wt.prunable);
  showContextMenu(e, [
    { label: `Switch to Worktree "${label}"`, disabled: wt.isCurrent || gone, action: () => openWorkspace(wt.path) },
    { separator: true },
    { label: 'Reveal in Finder', disabled: gone, action: () => window.git.showInFinder(wt.path, '') },
    { label: 'Open in Terminal', disabled: gone, action: async () => {
      const ok = await window.git.openInTerminal(wt.path);
      if (!ok) toast('No terminal could be opened there', { type: 'error' });
    } },
    { label: 'Copy Path to Clipboard', action: () => navigator.clipboard.writeText(wt.path) },
    { separator: true },
    // The main worktree is the repository itself: git will neither lock nor
    // remove it, so neither is offered.
    ...(wt.isMain ? [] : [
      { label: wt.locked ? 'Unlock Worktree' : 'Lock Worktree', disabled: gone, action: async () => {
        try { await window.git.lockWorktree(state.repoPath, wt.path, !wt.locked); await refresh(); }
        catch (err) { alert(err.message); }
      } },
      { label: `Remove Worktree "${label}"...`, action: () => removeWorktree(wt, refresh) },
    ]),
    { label: 'Prune Stale Worktrees', action: () => prune(refresh) },
  ]);
}

// Removing deletes the folder, so the confirmation says what goes with it.
// Uncommitted work is the only thing that cannot be got back; the branch and
// its commits are the repository's and stay. git refuses a dirty worktree
// without --force, which is sent only once that loss has been agreed to.
async function removeWorktree(wt, refresh) {
  let dirty = 0;
  try { dirty = (await window.git.status(wt.path)).length; } catch {}
  const stays = wt.branch
    ? `The branch "${wt.branch}" and its commits stay.`
    : 'Commits already made stay in the repository.';
  const loss = dirty
    ? `It has ${dirty} uncommitted ${dirty === 1 ? 'change' : 'changes'}, which will be lost. `
    : 'The folder is deleted. ';
  const ok = await showConfirm('Remove Worktree', `Remove the worktree at ${wt.path}?\n\n${loss}${stays}`);
  if (!ok) return;
  // The folder on screen cannot be the one being deleted: step back to the
  // main worktree first, then remove from there.
  if (wt.isCurrent && state.worktrees.main) await openWorkspace(state.worktrees.main);
  try {
    await window.git.removeWorktree(state.repoPath, wt.path, { force: dirty > 0 });
    await refresh();
  } catch (err) { alert(err.message); }
}

async function prune(refresh) {
  try {
    const out = await window.git.pruneWorktrees(state.repoPath);
    await refresh();
    toast(out.trim() ? 'Pruned the stale worktrees' : 'No stale worktrees to prune', { type: 'info' });
  } catch (err) { alert(err.message); }
}

// A value no branch can be called: `*` is not allowed in a ref name.
const NEW_BRANCH = '*new*';

// A worktree checks out one branch, and a branch can be checked out in one
// place, so the choice is among the branches no worktree holds (the one open
// here included), or a new branch from HEAD. The folder is picked last, with
// a suggestion next to the repository named after it and the branch.
async function addWorktree(refresh) {
  if (!state.repoPath) return;
  const main = state.worktrees.main || state.repoPath;
  const free = state.branchList.filter(b => !b.isRemote && !b.detached && !b.current && !b.worktree);
  const choice = await showSelect('Add Worktree', [
    { value: NEW_BRANCH, label: 'New branch from HEAD…' },
    ...free.map(b => ({ value: b.name, label: b.name, group: 'Existing branches' })),
  ]);
  if (choice === null) return;
  let branch = choice;
  let newBranch = null;
  if (choice === NEW_BRANCH) {
    newBranch = await showModal('New Branch', 'Branch name for the new worktree');
    if (!newBranch) return;
    branch = newBranch;
  }
  const folder = await window.git.chooseWorktreeFolder(defaultWorktreeFolder(main, branch));
  if (!folder) return;
  try {
    await window.git.addWorktree(state.repoPath, folder, newBranch ? { newBranch } : { branch });
  } catch (err) { alert(err.message); await refresh(); return; }
  // The new working copy is almost always where the next thing happens.
  await openWorkspace(folder);
}
