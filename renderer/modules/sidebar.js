import { $, escapeHtml, state, switchView } from './state.js';
import { showBranchContextMenu, showTagContextMenu, confirmCheckout } from './context-menu.js';
import { icon } from '../icons.js';
import { refreshHistory } from './history.js';
import { trackingFor, trackingChips, updateSyncBadges } from './sync.js';

// Matches on the data-branch attribute rather than a class so this covers local
// branches, remote branches and tags — anything the sidebar can pin history to.
function highlightBranch(name) {
  document.querySelectorAll('.selected-branch').forEach(el => el.classList.remove('selected-branch'));
  document.querySelectorAll('[data-branch]').forEach(el => {
    if (el.dataset.branch === name) el.classList.add('selected-branch');
  });
}

export function setupPanelResize(handleId, panelId, settingsKey, { minWidth = 160, maxWidth = 800 } = {}) {
  const handle = $(`#${handleId}`);
  const panel = $(`#${panelId}`);
  let startX, startWidth;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = panel.offsetWidth;
    handle.classList.add('dragging');
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', onDragEnd);
  });

  function onDrag(e) {
    const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + (e.clientX - startX)));
    panel.style.width = newWidth + 'px';
  }

  function onDragEnd() {
    handle.classList.remove('dragging');
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', onDragEnd);
    window.git.saveSettings({ [settingsKey]: panel.offsetWidth });
  }
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
    item.className = 'branch-item' + (b.current ? ' current' : '') + (b.detached ? ' detached' : '');
    item.dataset.branch = b.name;
    const glyph = icon(b.detached ? 'alert' : 'branch', 14);
    const label = b.detached ? `(HEAD detached at ${b.name})` : b.name;
    // The ahead/behind chips are what make a stale branch visible without
    // checking it out — the sidebar is where you look before deciding to.
    const chips = trackingChips(trackingFor(b.name), { showUnpublished: b.current });
    item.innerHTML = `
      ${glyph}
      <span class="branch-name">${escapeHtml(label)}</span>
      ${chips}
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
      confirmCheckout(b.name, refresh);
    });
    list.appendChild(item);
  });
  // Rebuilding the list drops the class, so restore it from state
  if (state.selectedBranch) highlightBranch(state.selectedBranch);
  // The toolbar reads the same numbers, and branchList has just been refreshed.
  updateSyncBadges();
}

export async function refreshTags(refresh) {
  try {
    const tags = await window.git.tags(state.repoPath);
    state.tagList = tags;
    const list = $('#tags-list');
    list.innerHTML = '';
    tags.forEach(t => {
      const item = document.createElement('div');
      item.className = 'tag-item';
      item.dataset.branch = t;
      item.innerHTML = `${icon('tag', 14)}<span>${escapeHtml(t)}</span>`;
      // Same behaviour as a branch row: show that ref's history
      item.addEventListener('click', () => {
        switchView('history');
        state.selectedBranch = t;
        highlightBranch(t);
        refreshHistory(refresh, t);
      });
      item.addEventListener('contextmenu', (e) => { e.preventDefault(); showTagContextMenu(e, t, refresh); });
      list.appendChild(item);
    });
    if (state.selectedBranch) highlightBranch(state.selectedBranch);
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
        <span class="expand-arrow open">${icon('chevron', 12)}</span>
        ${icon('cloud', 14)}
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
          ${icon('branch', 14)}
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
    if (state.selectedBranch) highlightBranch(state.selectedBranch);
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
        try { await window.git.stashApply(state.repoPath, i); await refreshStashes(); } catch (e) { alert(e.message); }
      });
      item.querySelector('[data-action="drop"]').addEventListener('click', async () => {
        try { await window.git.stashDrop(state.repoPath, i); await refreshStashes(); } catch (e) { alert(e.message); }
      });
      list.appendChild(item);
    });
  } catch {}
}
