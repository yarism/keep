import { $, $$, state, switchView } from './modules/state.js';
import { setupRepoList, showRepoList } from './modules/repos.js';
import { setupContextMenu } from './modules/context-menu.js';
import { showModal } from './modules/modal.js';
import { refreshStatus, setupCommitBox } from './modules/working-copy.js';
import { refreshHistory } from './modules/history.js';
import { setupSidebarResize, refreshBranches, refreshTags, refreshRemotes, refreshStashes } from './modules/sidebar.js';

// ── Refresh all data ──
async function refresh() {
  if (!state.repoPath) return;
  await Promise.all([
    refreshStatus(),
    refreshHistory(refresh),
    refreshBranches(refresh),
    refreshTags(),
    refreshRemotes(refresh),
    refreshStashes(),
  ]);
}

// ── Enter workspace mode ──
async function enterWorkspace(path) {
  state.repoPath = path;
  const name = path.split('/').pop();
  $('#repo-list-section').hidden = true;
  $('#workspace-nav').hidden = false;
  $('#breadcrumb-sep').hidden = false;
  $('#breadcrumb-repo').hidden = false;
  $('#breadcrumb-repo-name').textContent = name;
  $('#repo-name').textContent = name;
  $$('#toolbar button').forEach(b => b.disabled = false);
  switchView('working-copy');
  await refresh();
}

// ── Navigation ──
function setupNavigation() {
  document.addEventListener('click', (e) => {
    const navItem = e.target.closest('.nav-item');
    if (!navItem || !state.repoPath) return;
    switchView(navItem.dataset.view);
  });
}

// ── Toolbar ──
function setupToolbar() {
  $('#btn-fetch').addEventListener('click', async () => {
    try { await window.git.fetch(state.repoPath); await refresh(); } catch (e) { alert(e.message); }
  });
  $('#btn-pull').addEventListener('click', async () => {
    try { await window.git.pull(state.repoPath); await refresh(); } catch (e) { alert(e.message); }
  });
  $('#btn-push').addEventListener('click', async () => {
    try { await window.git.push(state.repoPath); await refresh(); } catch (e) { alert(e.message); }
  });
  $('#btn-stash').addEventListener('click', async () => {
    const msg = await showModal('Save Stash', 'Stash message (optional)');
    if (msg === null) return;
    try { await window.git.stashSave(state.repoPath, msg); await refresh(); } catch (e) { alert(e.message); }
  });
  $('#btn-stash-apply').addEventListener('click', async () => {
    try { await window.git.stashApply(state.repoPath, 0); await refresh(); } catch (e) { alert(e.message); }
  });
  $('#btn-merge').addEventListener('click', async () => {
    const name = await showModal('Merge', 'Branch name to merge into current');
    if (!name) return;
    try { await window.git.merge(state.repoPath, name); await refresh(); } catch (e) { alert(e.message); }
  });
  $('#btn-rebase').addEventListener('click', async () => {
    const name = await showModal('Rebase', 'Branch name to rebase onto');
    if (!name) return;
    try { await window.git.rebase(state.repoPath, name); await refresh(); } catch (e) { alert(e.message); }
  });
}

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  state.repositories = await window.git.loadRepos();
  const settings = await window.git.loadSettings();
  if (settings.sidebarWidth) {
    $('#sidebar').style.width = settings.sidebarWidth + 'px';
  }
  setupSidebarResize();
  setupRepoList(enterWorkspace);
  setupNavigation();
  setupToolbar();
  setupContextMenu();
  setupCommitBox(refresh);
  showRepoList();
});
