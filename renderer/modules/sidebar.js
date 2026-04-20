import { $, escapeHtml, state, switchView } from './state.js';
import { showBranchContextMenu } from './context-menu.js';
import { refreshHistory } from './history.js';

function highlightBranch(name) {
  document.querySelectorAll('.branch-item.selected-branch').forEach(el => el.classList.remove('selected-branch'));
  document.querySelectorAll('.branch-item[data-branch]').forEach(el => {
    if (el.dataset.branch === name) el.classList.add('selected-branch');
  });
}

export function setupSidebarResize() {
  const handle = $('#sidebar-resize');
  const sidebar = $('#sidebar');
  let startX, startWidth;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    handle.classList.add('dragging');
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', onDragEnd);
  });

  function onDrag(e) {
    const newWidth = Math.min(500, Math.max(160, startWidth + (e.clientX - startX)));
    sidebar.style.width = newWidth + 'px';
  }

  function onDragEnd() {
    handle.classList.remove('dragging');
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', onDragEnd);
    window.git.saveSettings({ sidebarWidth: sidebar.offsetWidth });
  }
}

export async function refreshBranches(refresh) {
  try { state.branchList = await window.git.branches(state.repoPath); } catch { state.branchList = []; }
  const list = $('#branches-list');
  list.innerHTML = '';
  state.branchList.filter(b => !b.isRemote).forEach(b => {
    const item = document.createElement('div');
    item.className = 'branch-item' + (b.current ? ' current' : '');
    item.dataset.branch = b.name;
    item.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 01-9 9"/></svg>
      <span>${escapeHtml(b.name)}</span>
      ${b.current ? '<span class="head-badge">HEAD</span>' : ''}
    `;
    item.addEventListener('click', async () => {
      switchView('history');
      state.selectedBranch = b.name;
      highlightBranch(b.name);
      refreshHistory(refresh, b.name);
    });
    item.addEventListener('contextmenu', (e) => { e.preventDefault(); showBranchContextMenu(e, b, refresh); });
    item.addEventListener('dblclick', async () => {
      if (b.current) return;
      try { await window.git.checkout(state.repoPath, b.name); await refresh(); } catch (e) { alert(e.message); }
    });
    list.appendChild(item);
  });
}

export async function refreshTags() {
  try {
    const tags = await window.git.tags(state.repoPath);
    const list = $('#tags-list');
    list.innerHTML = '';
    tags.forEach(t => {
      const item = document.createElement('div');
      item.className = 'tag-item';
      item.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg><span>${escapeHtml(t)}</span>`;
      list.appendChild(item);
    });
  } catch {}
}

export async function refreshRemotes(refresh) {
  try {
    const remotes = await window.git.remotes(state.repoPath);
    const remoteBranches = state.branchList.filter(b => b.isRemote);
    const list = $('#remotes-list');
    list.innerHTML = '';
    remotes.forEach(r => {
      // Remote header (collapsible)
      const remoteEl = document.createElement('div');
      remoteEl.className = 'remote-group';

      const header = document.createElement('div');
      header.className = 'remote-item';
      header.innerHTML = `
        <span class="expand-arrow open">▶</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
        <span>${escapeHtml(r.name)}</span>
      `;

      const branchContainer = document.createElement('div');
      branchContainer.className = 'remote-branches';

      // Filter branches for this remote
      const prefix = r.name + '/';
      remoteBranches.filter(b => b.name.startsWith(prefix)).forEach(b => {
        const shortName = b.name.substring(prefix.length);
        if (shortName === 'HEAD') return; // skip origin/HEAD
        const branchEl = document.createElement('div');
        branchEl.className = 'branch-item remote-branch-item';
        branchEl.dataset.branch = b.name;
        branchEl.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 01-9 9"/></svg>
          <span>${escapeHtml(shortName)}</span>
        `;
        branchEl.addEventListener('click', () => {
          switchView('history');
          state.selectedBranch = b.name;
          highlightBranch(b.name);
          refreshHistory(refresh, b.name);
        });
        branchContainer.appendChild(branchEl);
      });

      header.addEventListener('click', () => {
        const arrow = header.querySelector('.expand-arrow');
        const isOpen = arrow.classList.contains('open');
        arrow.classList.toggle('open');
        branchContainer.hidden = isOpen;
      });

      remoteEl.appendChild(header);
      remoteEl.appendChild(branchContainer);
      list.appendChild(remoteEl);
    });
  } catch {}
}

export async function refreshStashes() {
  try {
    const stashes = await window.git.stashes(state.repoPath);
    const list = $('#stash-list');
    list.innerHTML = '';
    if (stashes.length === 0) { list.innerHTML = '<div style="padding:20px;color:var(--text-dim);text-align:center">No stashes</div>'; return; }
    stashes.forEach((s, i) => {
      const item = document.createElement('div');
      item.className = 'commit-item';
      item.innerHTML = `
        <div class="commit-item-header">
          <span class="commit-hash">${escapeHtml(s.ref)}</span>
          <div class="stash-item-actions">
            <button data-action="apply">Apply</button>
            <button data-action="drop">Drop</button>
          </div>
        </div>
        <div class="commit-subject-text">${escapeHtml(s.message)}</div>
      `;
      item.querySelector('[data-action="apply"]').addEventListener('click', async () => {
        try { await window.git.stashApply(state.repoPath, i); } catch (e) { alert(e.message); }
      });
      item.querySelector('[data-action="drop"]').addEventListener('click', async () => {
        try { await window.git.stashDrop(state.repoPath, i); } catch (e) { alert(e.message); }
      });
      list.appendChild(item);
    });
  } catch {}
}
