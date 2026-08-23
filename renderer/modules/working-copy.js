import { $, escapeHtml, state } from './state.js';
import { renderDiff, renderConflict } from './diff.js';
import { showContextMenu } from './context-menu.js';
import { toast } from './toast.js';

// Set by setupCommitBox so the banner's Abort/Continue can rebuild everything —
// they move HEAD, which nothing short of a full refresh survives.
let _refresh = null;

let _selectedIndices = new Set();
let _lastClickedIndex = null;

export async function refreshStatus() {
  try { state.statusFiles = await window.git.status(state.repoPath); }
  catch { state.statusFiles = []; }
  try { state.repoState = await window.git.repoState(state.repoPath); }
  catch { state.repoState = { kind: null, conflicts: [], branch: null, step: 0, total: 0 }; }
  const badge = $('#wc-badge');
  if (state.statusFiles.length > 0) { badge.textContent = state.statusFiles.length; badge.hidden = false; }
  else { badge.hidden = true; }
  // An unresolved conflict is not just another changed file, so the count stops
  // looking like an ordinary one.
  badge.classList.toggle('conflict', conflictCount() > 0);
  renderOpBanner();
  renderFileList();
}

function conflictCount() {
  return state.statusFiles.filter(f => f.conflicted).length;
}

// What is in progress, how far through it you are, and the two ways out.
const OP_LABELS = {
  merge: 'Merging',
  rebase: 'Rebasing',
  'cherry-pick': 'Cherry-picking',
  revert: 'Reverting',
};

function renderOpBanner() {
  const banner = $('#op-banner');
  if (!banner) return;
  const { kind, branch, step, total } = state.repoState;
  const conflicts = conflictCount();
  // A stash pop can leave conflicts with no operation in flight; there is
  // nothing to abort or continue there, but they still have to be announced.
  if (!kind && !conflicts) { banner.hidden = true; return; }
  banner.hidden = false;
  banner.classList.toggle('resolved', conflicts === 0);

  const what = kind ? OP_LABELS[kind] : 'Conflicts';
  $('#op-banner-title').textContent = branch ? `${what} ${branch}` : what;

  const bits = [];
  if (kind === 'rebase' && total) bits.push(`commit ${step} of ${total}`);
  bits.push(conflicts
    ? `${conflicts} conflicted file${conflicts !== 1 ? 's' : ''} to resolve`
    : 'all conflicts resolved');
  $('#op-banner-detail').textContent = bits.join(' \u00b7 ');

  const cont = $('#op-continue');
  cont.textContent = kind === 'merge' ? 'Commit Merge' : 'Continue';
  cont.hidden = !kind;
  // Continuing with a file still unmerged just fails, so the button says so by
  // being unavailable rather than by erroring after the click.
  cont.disabled = conflicts > 0;
  $('#op-abort').hidden = !kind;
}

export function setupOpBanner(refresh) {
  _refresh = refresh;
  $('#op-abort').addEventListener('click', () => runOp('Abort', 'abortOperation'));
  $('#op-continue').addEventListener('click', () => runOp(
    state.repoState.kind === 'merge' ? 'Commit merge' : 'Continue', 'continueOperation'));
}

async function runOp(label, method) {
  const kind = state.repoState.kind;
  if (!kind) return;
  try {
    const out = await window.git[method](state.repoPath, kind);
    toast(out && out.trim() ? out.trim().split('\n')[0] : `${label} done`, { type: 'success' });
  } catch (e) {
    toast(e.message.trim() || `${label} failed`, { type: 'error' });
  }
  if (_refresh) await _refresh();
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
    item.className = 'file-item' + (isSelected ? ' selected' : '') + (f.conflicted ? ' conflicted' : '');
    item.tabIndex = 0;
    item.dataset.index = idx;
    // A conflicted file has no checkbox: ticking one would mean `git add`, which
    // marks a conflict resolved — too big a thing to hang off a checkbox that
    // means "stage" on every other row.
    item.innerHTML = `
      ${f.conflicted
        ? '<span class="file-checkbox-slot"></span>'
        : `<input type="checkbox" class="file-checkbox" ${f.staged ? 'checked' : ''} tabindex="-1">`}
      <span class="file-status ${f.status}">${f.conflicted ? '!' : f.status[0].toUpperCase()}</span>
      <span class="file-name" title="${f.filePath}">${f.filePath.split('/').pop()}</span>
      <span class="file-path">${f.filePath.includes('/') ? f.filePath.substring(0, f.filePath.lastIndexOf('/')) : ''}</span>
      ${f.conflicted ? `<span class="conflict-kind">${f.conflictKind}</span>` : ''}
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
        const box = item.querySelector('.file-checkbox');
        if (box) box.click();
      }
    });
    if (!f.conflicted) item.querySelector('.file-checkbox').addEventListener('change', async (e) => {
      e.stopPropagation();
      try {
        if (f.staged) await window.git.unstage(state.repoPath, f.filePath, f.oldPath);
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
  renderConflictActions(f);
  if (f.conflicted) {
    // `git diff` on an unmerged path prints a combined diff that reads as noise.
    // What you actually need to look at is the file with its markers in place.
    try {
      const text = await window.git.fileContents(state.repoPath, f.filePath);
      renderConflict(text, $('#diff-content'), f);
    } catch (e) {
      $('#diff-content').innerHTML = `<div style="padding:20px;color:var(--red)">${escapeHtml(e.message)}</div>`;
    }
    return;
  }
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

// Take Ours / Take Theirs / Mark Resolved, above the file they apply to. Ours
// and theirs need both sides to still have a file, so a delete conflict gets
// keep/remove instead.
function renderConflictActions(f) {
  const bar = $('#conflict-actions');
  if (!bar) return;
  bar.hidden = !f || !f.conflicted;
  if (bar.hidden) return;
  const deletion = f.conflictKind.includes('deleted');
  const [ours, theirs, resolved] = bar.querySelectorAll('button');
  ours.textContent = deletion ? 'Keep File' : 'Take Ours';
  theirs.textContent = deletion ? 'Remove File' : 'Take Theirs';
  ours.dataset.resolve = deletion ? 'keep' : 'ours';
  theirs.dataset.resolve = deletion ? 'remove' : 'theirs';
  resolved.disabled = deletion;
  bar.dataset.file = f.filePath;
}

const RESOLVERS = {
  ours: 'useOurs', theirs: 'useTheirs',
  keep: 'keepFile', remove: 'removeFile',
  resolved: 'markResolved',
};

function setupConflictActions() {
  const bar = $('#conflict-actions');
  if (!bar) return;
  bar.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-resolve]');
    if (!btn) return;
    try {
      await window.git[RESOLVERS[btn.dataset.resolve]](state.repoPath, bar.dataset.file);
      $('#diff-content').innerHTML = '';
      $('#diff-filename').textContent = 'No file selected';
      bar.hidden = true;
      await refreshStatus();
    } catch (err) { toast(err.message, { type: 'error' }); }
  });
}

export function setupCommitBox(refresh) {
  _refresh = refresh;
  setupConflictActions();
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
      if (allStaged) { for (const f of state.statusFiles) await window.git.unstage(state.repoPath, f.filePath, f.oldPath); }
      else { await window.git.stageAll(state.repoPath); }
      await refreshStatus();
    } catch (e) { alert(e.message); }
  });
}

function getSelectedFiles() {
  return [..._selectedIndices].sort((a, b) => a - b).map(i => state.statusFiles[i]).filter(Boolean);
}

// Nothing on the ordinary file menu applies mid-conflict — staging is what
// resolving *is*, and discarding one side of a merge is not a thing git offers.
function showConflictContextMenu(e, f, name) {
  const deletion = f.conflictKind.includes('deleted');
  const act = (method) => async () => {
    try { await window.git[method](state.repoPath, f.filePath); await refreshStatus(); }
    catch (err) { toast(err.message, { type: 'error' }); }
  };
  showContextMenu(e, [
    { label: `Conflict: ${f.conflictKind}`, disabled: true },
    { separator: true },
    { label: deletion ? 'Keep the File' : 'Take Ours (this branch)', action: act(deletion ? 'keepFile' : 'useOurs') },
    { label: deletion ? 'Remove the File' : 'Take Theirs (incoming)', action: act(deletion ? 'removeFile' : 'useTheirs') },
    { label: `Mark "${name}" Resolved`, disabled: deletion, action: act('markResolved') },
    { separator: true },
    { label: 'Reveal in Finder', action: () => window.git.showInFinder(state.repoPath, f.filePath) },
  ]);
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
        for (const f of files.filter(f2 => f2.staged)) await window.git.unstage(state.repoPath, f.filePath, f.oldPath);
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
  if (f.conflicted) { showConflictContextMenu(e, f, name); return; }
  showContextMenu(e, [
    { label: 'Reveal in Finder', action: () => window.git.showInFinder(state.repoPath, f.filePath) },
    { separator: true },
    { label: f.staged ? `Unstage "${name}"` : `Stage "${name}"`, action: async () => {
      try {
        if (f.staged) await window.git.unstage(state.repoPath, f.filePath, f.oldPath);
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
