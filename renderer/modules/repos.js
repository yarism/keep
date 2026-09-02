import { $, $$, escapeHtml, state, switchView } from './state.js';
import { icon } from '../icons.js';
import { updateSyncBadges } from './sync.js';
import { showAccess } from './access.js';
import { syncReleasePanel } from './release.js';

let _onSelectRepo = null;

export function setupRepoList(onSelectRepo) {
  _onSelectRepo = onSelectRepo;
  $('#btn-open').addEventListener('click', openRepo);
  $('#btn-open-welcome').addEventListener('click', openRepo);
  $('#btn-add-repo').addEventListener('click', openRepo);
  $('#breadcrumb-repos').addEventListener('click', showRepoList);
}

export function showRepoList() {
  state.repoPath = null;
  // Whatever the last repository could not do is no longer on screen.
  showAccess(null);
  // Going back to the list is a decision about where to start next time, too
  window.git.saveSettings({ lastRepo: null });
  $('#repo-list-section').hidden = false;
  $('#workspace-nav').hidden = true;
  $('#breadcrumb-sep').hidden = true;
  $('#breadcrumb-repo').hidden = true;
  $$('#toolbar .toolbar-group button:not(#btn-open)').forEach(b => b.disabled = true);
  // No repository, nothing to push or pull — the counts must not linger on the
  // buttons from whatever was open a moment ago.
  state.branchList = [];
  updateSyncBadges();
  switchView('welcome');
  // A release terminal belongs to its repository, and no repository is open
  // here: the run, if one is going, carries on out of sight.
  syncReleasePanel();
  renderRepoList();
}

function renderRepoList() {
  const list = $('#repo-list');
  list.innerHTML = '';
  if (state.repositories.length === 0) {
    list.innerHTML = '<div style="padding:30px;color:var(--text-dim);text-align:center;font-size:var(--fs-base)">No repositories.<br>Click + to add one.</div>';
    return;
  }
  state.repositories.forEach((r, i) => {
    const item = document.createElement('div');
    item.className = 'repo-item' + (state.repoPath === r.path ? ' active' : '');
    item.tabIndex = 0;
    item.innerHTML = `
      ${icon('folder', 14)}
      <span class="repo-item-name">${escapeHtml(r.name)}</span>
      <span class="repo-item-badge" hidden></span>
      <button class="repo-item-remove" title="Remove" tabindex="-1">${icon('close', 12)}</button>
    `;
    fillDirtyBadge(item, r.path);
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('repo-item-remove')) return;
      if (_onSelectRepo) _onSelectRepo(r.path);
    });
    item.addEventListener('keydown', (e) => {
      const items = list.querySelectorAll('.repo-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = items[i + 1];
        if (next) next.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = items[i - 1];
        if (prev) prev.focus();
      } else if (e.key === 'Enter') {
        if (_onSelectRepo) _onSelectRepo(r.path);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        state.repositories.splice(i, 1);
        window.git.saveRepos(state.repositories);
        renderRepoList();
      }
    });
    item.querySelector('.repo-item-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      state.repositories.splice(i, 1);
      window.git.saveRepos(state.repositories);
      renderRepoList();
    });
    list.appendChild(item);
  });
}

// The list should not wait on a dozen `git status` calls, so the rows render
// with their badges hidden and each one fills in when its repository answers.
// A repository that cannot answer (moved, no access) just keeps a bare row —
// the access story belongs to opening it, not to the list.
async function fillDirtyBadge(item, path) {
  let count;
  try { count = (await window.git.status(path)).length; }
  catch { return; }
  if (count === 0) return;
  // If the list re-rendered meanwhile this writes to a detached row: harmless.
  const badge = item.querySelector('.repo-item-badge');
  badge.textContent = count;
  badge.title = `${count} uncommitted ${count === 1 ? 'change' : 'changes'}`;
  badge.hidden = false;
}

async function openRepo() {
  const path = await window.git.openRepo();
  if (!path) return;
  if (!state.repositories.find(r => r.path === path)) {
    state.repositories.push({ name: path.split('/').pop(), path });
    window.git.saveRepos(state.repositories);
  }
  if (_onSelectRepo) _onSelectRepo(path);
}
