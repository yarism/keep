import { $, $$, escapeHtml, state, switchView } from './state.js';

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
  $('#repo-list-section').hidden = false;
  $('#workspace-nav').hidden = true;
  $('#breadcrumb-sep').hidden = true;
  $('#breadcrumb-repo').hidden = true;
  $('#repo-name').textContent = '';
  $$('#toolbar button:not(#btn-open)').forEach(b => b.disabled = true);
  switchView('welcome');
  renderRepoList();
}

function renderRepoList() {
  const list = $('#repo-list');
  list.innerHTML = '';
  if (state.repositories.length === 0) {
    list.innerHTML = '<div style="padding:30px;color:var(--text-dim);text-align:center;font-size:12px">No repositories.<br>Click + to add one.</div>';
    return;
  }
  state.repositories.forEach((r, i) => {
    const item = document.createElement('div');
    item.className = 'repo-item' + (state.repoPath === r.path ? ' active' : '');
    item.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
      <span>${escapeHtml(r.name)}</span>
      <button class="repo-item-remove" title="Remove">×</button>
    `;
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('repo-item-remove')) return;
      if (_onSelectRepo) _onSelectRepo(r.path);
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

async function openRepo() {
  const path = await window.git.openRepo();
  if (!path) return;
  if (!state.repositories.find(r => r.path === path)) {
    state.repositories.push({ name: path.split('/').pop(), path });
    window.git.saveRepos(state.repositories);
  }
  if (_onSelectRepo) _onSelectRepo(path);
}
