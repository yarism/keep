import { $, escapeHtml, state } from './state.js';
import { renderDiff } from './diff.js';
import { showContextMenu } from './context-menu.js';

export async function refreshStatus() {
  try { state.statusFiles = await window.git.status(state.repoPath); }
  catch { state.statusFiles = []; }
  const badge = $('#wc-badge');
  if (state.statusFiles.length > 0) { badge.textContent = state.statusFiles.length; badge.hidden = false; }
  else { badge.hidden = true; }
  renderFileList();
}

function renderFileList() {
  const list = $('#wc-file-list');
  list.innerHTML = '';
  if (state.statusFiles.length === 0) {
    list.innerHTML = '<div style="padding:20px;color:var(--text-dim);text-align:center">No changes</div>';
    return;
  }
  state.statusFiles.forEach(f => {
    const item = document.createElement('div');
    const key = f.filePath + (f.staged ? ':staged' : ':unstaged');
    item.className = 'file-item' + (state.selectedFile === key ? ' selected' : '');
    item.innerHTML = `
      <input type="checkbox" class="file-checkbox" ${f.staged ? 'checked' : ''}>
      <span class="file-status ${f.status}">${f.status[0].toUpperCase()}</span>
      <span class="file-name" title="${f.filePath}">${f.filePath.split('/').pop()}</span>
      <span class="file-path">${f.filePath.includes('/') ? f.filePath.substring(0, f.filePath.lastIndexOf('/')) : ''}</span>
    `;
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('file-checkbox')) return;
      state.selectedFile = key;
      renderFileList();
      selectFile(f);
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
      showFileContextMenu(e, f);
    });
    list.appendChild(item);
  });
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
  // Listen for refresh-status events from diff hunk buttons
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
