import { $, escapeHtml, state, switchView, openWorkspace, updateTitlebar } from './state.js';
import { worktreeTag } from '../worktree-info.js';
import {
  showBranchContextMenu, showTagContextMenu, showRemoteBranchContextMenu,
  showRemoteContextMenu, showRemotesSectionContextMenu, confirmCheckout,
} from './context-menu.js';
import { icon } from '../icons.js';
import { refreshHistory } from './history.js';
import { trackingFor, trackingChips, updateSyncBadges } from './sync.js';
import { isCollapsed, toggleFolder, slide, settleWhenOpen } from './sections.js';

// Adding a remote is rare enough — most repositories arrive with origin
// already set by the clone that made them — that it does not earn a
// permanent button the way adding a repository does. A right-click on the
// section header, same as every other row-level action in this sidebar,
// keeps it out of the way until it is wanted.
export function setupRemotesSection(refresh) {
  const header = $('#remotes-section-header');
  if (!header) return;
  header.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showRemotesSectionContextMenu(e, state.remotes, refresh);
  });
}

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

// Switching repositories leaves the previous one's branches, tags and remotes
// on screen until each list has re-fetched. Ghost rows instead, matching the
// history skeleton on the other side of the window.
export function resetSidebar() {
  const sections = [['#branches-list', 4], ['#worktrees-list', 1], ['#tags-list', 2], ['#remotes-list', 2]];
  for (const [sel, count] of sections) {
    const list = $(sel);
    if (!list) continue;
    let html = '';
    for (let i = 0; i < count; i++) {
      const w = 40 + ((i * 23) % 35);
      html += `<div class="skeleton-side-row">
        <div class="skeleton-line skeleton-dot"></div>
        <div class="skeleton-line" style="width:${w}%"></div>
      </div>`;
    }
    list.innerHTML = html;
  }
}

// Branch names are paths, and the sidebar draws them the way Tower does: every
// part before the last is a folder, so "claude/fix-login" is a row called
// "fix-login" inside a folder called "claude". A folder takes the place of its
// first branch, which keeps git's alphabetical order. Git will not let "a" and
// "a/b" both exist, so a name is never both a branch and a folder.
function pathTree(items, nameOf) {
  const root = [];
  const folders = new Map();
  for (const item of items) {
    const parts = nameOf(item).split('/');
    let level = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join('/');
      let folder = folders.get(path);
      if (!folder) {
        folder = { name: parts[i], path, children: [] };
        folders.set(path, folder);
        level.push(folder);
      }
      level = folder.children;
    }
    level.push({ name: parts[parts.length - 1], item });
  }
  return root;
}

// Appends what pathTree() built to `list`. `leaf(item, name, depth)` makes a
// branch's row; the folders are made here, and remember being folded under
// "<keyBase>/<their path>".
function appendTree(list, nodes, depth, keyBase, leaf) {
  for (const node of nodes) {
    if (!node.children) {
      list.appendChild(leaf(node.item, node.name, depth));
      continue;
    }
    const { group, children } = foldingRow(node.name, depth, `${keyBase}/${node.path}`, 'folder', 'folder-item');
    appendTree(children, node.children, depth + 1, keyBase, leaf);
    list.appendChild(group);
  }
}

// A row that opens and closes the rows under it: a remote, or a folder of
// branches. Which ones are folded is kept with the sections' (sections.js), so
// a refresh, which rebuilds every row, puts them back the way they were.
function foldingRow(label, depth, key, glyph, className) {
  const open = !isCollapsed(key);
  const group = document.createElement('div');
  group.className = 'tree-group' + (open ? '' : ' collapsed');
  const row = document.createElement('div');
  row.className = className;
  setDepth(row, depth);
  row.innerHTML = `
    <span class="tree-arrow expand-arrow${open ? ' open' : ''}">${icon('chevron', 12)}</span>
    ${icon(glyph, 14)}
    <span>${escapeHtml(label)}</span>
  `;
  const children = document.createElement('div');
  children.className = 'tree-children';
  settleWhenOpen(group, children);
  row.addEventListener('click', () => {
    const folded = toggleFolder(key);
    row.querySelector('.tree-arrow').classList.toggle('open', !folded);
    slide(group, folded);
  });
  group.append(row, children);
  return { group, row, children };
}

// How many levels in a row sits; styles.css turns it into indentation.
function setDepth(row, depth) {
  if (depth) row.style.setProperty('--depth', depth);
}

// `preloaded` is a branch list someone has already read (opening a repository
// starts that read early, alongside its others), so it is not read twice.
export async function refreshBranches(refresh, preloaded) {
  if (preloaded) state.branchList = preloaded;
  else try { state.branchList = await window.git.branches(state.repoPath); } catch { state.branchList = []; }
  renderBranches(refresh);
}

// Rendering is separate from reading so a repository can be painted from what
// it looked like last time, before git has answered anything.
export function renderBranches(refresh) {
  const list = $('#branches-list');
  list.innerHTML = '';
  const local = state.branchList.filter(b => !b.isRemote);
  appendTree(list, pathTree(local, b => b.name), 0, 'branches', (b, name, depth) => {
    const item = document.createElement('div');
    item.className = 'branch-item' + (b.current ? ' current' : '') + (b.detached ? ' detached' : '');
    item.dataset.branch = b.name;
    setDepth(item, depth);
    const glyph = icon(b.detached ? 'alert' : 'branch', 14);
    const label = b.detached ? `(HEAD detached at ${b.name})` : name;
    // The ahead/behind chips are what make a stale branch visible without
    // checking it out — the sidebar is where you look before deciding to.
    const chips = trackingChips(trackingFor(b.name), { showUnpublished: b.current });
    // A branch another worktree holds cannot be checked out here. The badge
    // says where it is, in the place HEAD would sit, and double-click goes
    // there instead of asking git to refuse.
    const held = b.worktree ? worktreeFor(b.worktree) : null;
    const badge = held
      ? `<span class="worktree-badge" title="Checked out in ${escapeHtml(b.worktree).replace(/"/g, '&quot;')}">${icon('worktree', 11)}<span>${escapeHtml(worktreeTag(held, state.worktrees.main))}</span></span>`
      : '';
    item.innerHTML = `
      ${glyph}
      <span class="branch-name">${escapeHtml(label)}</span>
      ${chips}
      ${b.current ? '<span class="head-badge">HEAD</span>' : badge}
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
      if (b.worktree) { openWorkspace(b.worktree); return; }
      confirmCheckout(b.name, refresh);
    });
    return item;
  });
  // Rebuilding the list drops the class, so restore it from state
  if (state.selectedBranch) highlightBranch(state.selectedBranch);
  // The toolbar reads the same numbers, and branchList has just been refreshed.
  updateSyncBadges();
}

// The worktree row for a path, or a stand-in when the list has not been read
// yet (the branch list can land first), so the badge still has a folder name.
function worktreeFor(path) {
  return state.worktrees.list.find(w => w.path === path) || { path, isMain: false };
}

export async function refreshTags(refresh) {
  try {
    state.tagList = await window.git.tags(state.repoPath);
  } catch {
    // A failed read must still take the skeleton (or the previous repo's
    // tags) off screen — an empty section is the honest answer.
    state.tagList = [];
  }
  renderTags(refresh);
}

export function renderTags(refresh) {
  const list = $('#tags-list');
  if (!list) return;
  list.innerHTML = '';
  state.tagList.forEach(t => {
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
}

export async function refreshRemotes(refresh, preloaded) {
  if (preloaded) state.remotes = preloaded;
  else try { state.remotes = await window.git.remotes(state.repoPath); } catch { state.remotes = []; }
  renderRemotes(refresh);
}

export function renderRemotes(refresh) {
  const list = $('#remotes-list');
  if (!list) return;
  const remotes = state.remotes;
  const remoteBranches = state.branchList.filter(b => b.isRemote);
  list.innerHTML = '';
  remotes.forEach(r => {
    // The remote is a folder of its branches, one level in from the section,
    // and its branches' own folders go in from there.
    const key = `remotes/${r.name}`;
    const { group, row, children } = foldingRow(r.name, 0, key, 'cloud', 'remote-item');
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); showRemoteContextMenu(e, r, refresh); });

    const prefix = r.name + '/';
    const mine = remoteBranches.filter(b => b.name.startsWith(prefix) && b.name !== prefix + 'HEAD');
    appendTree(children, pathTree(mine, b => b.name.substring(prefix.length)), 1, key, (b, name, depth) => {
      const branchEl = document.createElement('div');
      branchEl.className = 'branch-item remote-branch-item';
      branchEl.dataset.branch = b.name;
      setDepth(branchEl, depth);
      branchEl.innerHTML = `
        ${icon('branch', 14)}
        <span>${escapeHtml(name)}</span>
      `;
      branchEl.addEventListener('click', () => {
        switchView('history');
        state.selectedBranch = b.name;
        highlightBranch(b.name);
        refreshHistory(refresh, b.name);
      });
      branchEl.addEventListener('contextmenu', (e) => { e.preventDefault(); showRemoteBranchContextMenu(e, b, refresh); });
      return branchEl;
    });

    list.appendChild(group);
  });
  if (state.selectedBranch) highlightBranch(state.selectedBranch);
}

export async function refreshStashes() {
  try {
    const stashes = await window.git.stashes(state.repoPath);
    state.stashCount = stashes.length;
    updateTitlebar();
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
