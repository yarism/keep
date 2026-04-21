import { $, escapeHtml, state } from './state.js';
import { renderDiff } from './diff.js';
import { showContextMenu } from './context-menu.js';

let _selectedIndices = new Set();
let _lastClickedIndex = null;

export async function refreshStatus() {
  try { state.statusFiles = await window.git.status(state.repoPath); }
  catch { state.statusFiles = []; }
  const badge = $('#wc-badge');
  if (state.statusFiles.length > 0) { badge.textContent = state.statusFiles.length; badge.hidden = false; }
  else { badge.hidden = true; }
  renderFileList();
}

function fileKey(f) {
  return f.filePath + (f.staged ? ':staged' : ':unstaged');
}

function renderFileList() {
  const list = $('#wc-file-list');
  list.innerHTML = '';
  if (state.statusFiles.length === 0) {
    list.innerHTML = '<div style="padding:20px;color:var(--text-dim);text-align:center">No changes</div>';
    _selectedIndices.clear();
    return;
  }
  // Clean up indices that are out of range
  _selectedIndices.forEach(i => { if (i >= state.statusFiles.length) _selectedIndices.delete(i); });

  state.statusFiles.forEach((f, idx) => {
    const item = document.createElement('div');
    const key = fileKey(f);
    const isSelected = _selectedIndices.has(idx);
    item.className = 'file-item' + (isSelected ? ' selected' : '');
    item.tabIndex = 0;
    item.dataset.index = idx;
    item.innerHTML = `
      <input type="checkbox" class="file-checkbox" ${f.staged ? 'checked' : ''} tabindex="-1">
      <span class="file-status ${f.status}">${f.status[0].toUpperCase()}</span>
      <span class="file-name" title="${f.filePath}">${f.filePath.split('/').pop()}</span>
      <span class="file-path">${f.filePath.includes('/') ? f.filePath.substring(0, f.filePath.lastIndexOf('/')) : ''}</span>
    `;
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('file-checkbox')) return;
      handleFileClick(idx, e);
      // Show diff for the clicked file
      state.selectedFile = key;
      selectFile(f);
    });
    item.addEventListener('keydown', (e) => {
      const items = list.querySelectorAll('.file-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = items[idx + 1];
        if (next) { next.focus(); next.click(); }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = items[idx - 1];
        if (prev) { prev.focus(); prev.click(); }
      } else if (e.key === ' ') {
        e.preventDefault();
        item.querySelector('.file-checkbox').click();
      }
    });
    item.querySelector('.file-checkbox').addEventListener('change', async (e) => {
      e.stopPropagation();
      try {
        if (f.staged) await window.git.unstage(state.repoPath, f.filePath);
        else await window.git.stage(state.repoPath, f.filePath);
        await refreshStatus();
      } catch (err) { alert(err.message); }
    });
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // If right-clicking an unselected file, select only that one
      if (!_selectedIndices.has(idx)) {
        _selectedIndices.clear();
        _selectedIndices.add(idx);
        _lastClickedIndex = idx;
        renderFileList();
      }
      if (_selectedIndices.size > 1) {
        showMultiFileContextMenu(e);
      } else {
        showFileContextMenu(e, f);
      }
    });
    list.appendChild(item);

    if (isSelected && _selectedIndices.size === 1) requestAnimationFrame(() => item.focus());
  });
}

function handleFileClick(idx, e) {
  if (e.shiftKey && _lastClickedIndex !== null) {
    // Range select
    const start = Math.min(_lastClickedIndex, idx);
    const end = Math.max(_lastClickedIndex, idx);
    if (!e.metaKey && !e.ctrlKey) _selectedIndices.clear();
    for (let i = start; i <= end; i++) _selectedIndices.add(i);
  } else if (e.metaKey || e.ctrlKey) {
    // Toggle select
    if (_selectedIndices.has(idx)) _selectedIndices.delete(idx);
    else _selectedIndices.add(idx);
  } else {
    // Single select
    _selectedIndices.clear();
    _selectedIndices.add(idx);
  }
  _lastClickedIndex = idx;
  renderFileList();
}

async function selectFile(f) {
  $('#diff-filename').textContent = f.filePath;
  try {
    const diff = await window.git.diff(state.repoPath, f.filePath, f.staged);
    if (!diff || !diff.trim()) {
      const fallback = await window.git.diff(state.repoPath, f.filePath, !f.staged);
      renderDiff(fallback, 'diff-content', !f.staged ? f.filePath : null);
    } else {
      renderDiff(diff, 'diff-content', !f.staged ? f.filePath : null);
    }
  } catch (e) {
    $('#diff-content').innerHTML = `<div style="padding:20px;color:var(--red)">${escapeHtml(e.message)}</div>`;
  }
}

export function setupCommitBox(refresh) {
  document.addEventListener('refresh-status', () => refreshStatus());

  const input = $('#commit-subject');
  const btn = $('#btn-commit');
  input.addEventListener('input', () => { btn.disabled = !input.value.trim(); });
  btn.addEventListener('click', async () => {
    const msg = input.value.trim();
    if (!msg) return;
    try { await window.git.commit(state.repoPath, msg); input.value = ''; btn.disabled = true; await refresh(); }
    catch (e) { alert(e.message); }
  });
  $('#btn-stage-all').addEventListener('click', async () => {
    const allStaged = state.statusFiles.length > 0 && state.statusFiles.every(f => f.staged);
    try {
      if (allStaged) { for (const f of state.statusFiles) await window.git.unstage(state.repoPath, f.filePath); }
      else { await window.git.stageAll(state.repoPath); }
      await refreshStatus();
    } catch (e) { alert(e.message); }
  });
}

function getSelectedFiles() {
  return [..._selectedIndices].sort((a, b) => a - b).map(i => state.statusFiles[i]).filter(Boolean);
}

function showMultiFileContextMenu(e) {
  const files = getSelectedFiles();
  const count = files.length;
  const hasUnstaged = files.some(f => !f.staged);
  const hasStaged = files.some(f => f.staged);
  const discardable = files.filter(f => !f.staged && f.status !== 'untracked');
  const trashable = files.filter(f => f.status === 'untracked');

  showContextMenu(e, [
    { label: `Stage ${count} Files`, disabled: !hasUnstaged, action: async () => {
      try {
        for (const f of files.filter(f2 => !f2.staged)) await window.git.stage(state.repoPath, f.filePath);
        await refreshStatus();
      } catch (err) { alert(err.message); }
    }},
    { label: `Unstage ${count} Files`, disabled: !hasStaged, action: async () => {
      try {
        for (const f of files.filter(f2 => f2.staged)) await window.git.unstage(state.repoPath, f.filePath);
        await refreshStatus();
      } catch (err) { alert(err.message); }
    }},
    { separator: true },
    { label: `Discard Changes in ${discardable.length} File${discardable.length !== 1 ? 's' : ''}...`, disabled: discardable.length === 0, action: async () => {
      if (!confirm(`Discard all local changes in ${discardable.length} file${discardable.length !== 1 ? 's' : ''}? This cannot be undone.`)) return;
      try {
        for (const f of discardable) await window.git.discardFile(state.repoPath, f.filePath);
        _selectedIndices.clear();
        await refreshStatus();
      } catch (err) { alert(err.message); }
    }},
    { label: `Move ${trashable.length || count} File${(trashable.length || count) !== 1 ? 's' : ''} to Trash...`, action: async () => {
      const targets = trashable.length > 0 ? trashable : files;
      if (!confirm(`Move ${targets.length} file${targets.length !== 1 ? 's' : ''} to Trash?`)) return;
      try {
        for (const f of targets) await window.git.trashFile(state.repoPath, f.filePath);
        _selectedIndices.clear();
        await refreshStatus();
      } catch (err) { alert(err.message); }
    }},
  ]);
}

function showFileContextMenu(e, f) {
  const name = f.filePath.split('/').pop();
  const isUntracked = f.status === 'untracked';
  showContextMenu(e, [
    { label: 'Reveal in Finder', action: () => window.git.showInFinder(state.repoPath, f.filePath) },
    { separator: true },
    { label: f.staged ? `Unstage "${name}"` : `Stage "${name}"`, action: async () => {
      try {
        if (f.staged) await window.git.unstage(state.repoPath, f.filePath);
        else await window.git.stage(state.repoPath, f.filePath);
        await refreshStatus();
      } catch (err) { alert(err.message); }
    }},
    { separator: true },
    { label: 'Move to Trash', action: async () => {
      if (!confirm(`Move "${name}" to Trash?`)) return;
      try { await window.git.trashFile(state.repoPath, f.filePath); await refreshStatus(); }
      catch (err) { alert(err.message); }
    }},
    { separator: true },
    { label: 'Discard Local Changes...', disabled: isUntracked || f.staged, action: async () => {
      if (!confirm(`Discard all local changes to "${name}"? This cannot be undone.`)) return;
      try { await window.git.discardFile(state.repoPath, f.filePath); await refreshStatus(); }
      catch (err) { alert(err.message); }
    }},
  ]);
}
