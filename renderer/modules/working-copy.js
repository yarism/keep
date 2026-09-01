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
  syncAmendAvailability();
  renderFileList();
  await refreshSelectedDiff();
}

// Switching repositories leaves the previous one's changed files on screen
// until status has been read. Ghost rows instead, in the same geometry as the
// real ones, matching the history and sidebar skeletons.
export function resetWorkingCopy() {
  state.statusFiles = [];
  _selectedIndices.clear();
  _lastClickedIndex = null;
  // The skeletons below bypass renderFileList, so its notion of what is on
  // screen must not survive into the next repository.
  _listSig = null;
  const list = $('#wc-file-list');
  if (!list) return;
  let html = '';
  for (let i = 0; i < 5; i++) {
    const w = 45 + ((i * 29) % 40);
    html += `<div class="skeleton-side-row">
      <div class="skeleton-line skeleton-dot"></div>
      <div class="skeleton-line" style="width:${w}%"></div>
    </div>`;
  }
  list.innerHTML = html;
}

// Amending is a rewrite. That is fine on work that has never left the machine
// and a nuisance for everyone else once it has, so the box says which case this
// is rather than refusing or staying quiet.
async function renderAmendWarning() {
  const warn = $('#amend-warning');
  if (!warn) return;
  if (!$('#chk-amend').checked) { warn.hidden = true; return; }
  let pushed = false;
  try { pushed = (await window.git.unpushed(state.repoPath, 'HEAD')).length === 0; }
  catch { pushed = false; }
  warn.hidden = !pushed;
  warn.textContent = pushed
    ? 'This commit is already on a remote — amending rewrites it, and the next push will be rejected unless forced.'
    : '';
}

// Mid-merge or mid-rebase, HEAD is not yours to rewrite: amending would fold
// the operation's own commit into something else.
function syncAmendAvailability() {
  const amend = $('#chk-amend');
  const label = $('#amend-toggle');
  if (!amend || !label) return;
  const busy = !!state.repoState.kind;
  // An initialised repo with no commits has no refs at all — and nothing to
  // amend. (state.commits is the History list, which lags a tick behind.)
  const empty = state.branchList.length === 0;
  amend.disabled = busy || empty;
  label.classList.toggle('disabled', amend.disabled);
  label.title = busy
    ? `Not while a ${state.repoState.kind} is in progress`
    : (empty ? 'Nothing to amend yet' : 'Replace the last commit instead of adding a new one');
  if (amend.disabled && amend.checked) {
    amend.checked = false;
    amend.dispatchEvent(new Event('change'));
  }
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

// What rows the list is currently showing, same idea as the diff pane's guard
// below: the poll redraws every few seconds, and tearing rows down just to
// build identical ones back makes the row under the cursor drop its hover for
// a frame, a visible blink. Selection is deliberately not part of this: it
// changes on every click and arrow key, and repainting it on the rows that
// already exist keeps the hover (and focus) where they were.
let _listSig = null;

function renderFileList() {
  const list = $('#wc-file-list');
  // Clean up indices that are out of range
  _selectedIndices.forEach(i => { if (i >= state.statusFiles.length) _selectedIndices.delete(i); });

  const sig = state.statusFiles.map(f =>
    `${f.filePath}\0${f.status}\0${f.staged ? 1 : 0}\0${f.conflicted ? 1 : 0}\0${f.conflictKind || ''}\0${f.oldPath || ''}`
  ).join('\n');
  if (sig === _listSig) {
    list.querySelectorAll('.file-item').forEach((item, i) => {
      item.classList.toggle('selected', _selectedIndices.has(i));
      // A click flips a checkbox before git has agreed to the stage. When the
      // command fails, the full rebuild used to put the box right on the next
      // poll; without this line the in-place path would leave it lying.
      const box = item.querySelector('.file-checkbox');
      if (box) box.checked = state.statusFiles[i].staged;
    });
    return;
  }
  _listSig = sig;

  // Rebuilding takes focus with it. Remember whether it was in the list, so it
  // can be put back on the selected row afterwards; when it was elsewhere (the
  // commit message, say), it stays there instead of being yanked into the list.
  const hadFocus = list.contains(document.activeElement);

  list.innerHTML = '';
  if (state.statusFiles.length === 0) {
    list.innerHTML = '<div style="padding:20px;color:var(--text-dim);text-align:center">No changes</div>';
    return;
  }

  state.statusFiles.forEach((f, idx) => {
    const item = document.createElement('div');
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

    // preventScroll: pulling the selected row into view here would scroll the
    // list under a resting cursor, which reads as the hover jumping rows.
    if (hadFocus && isSelected && _selectedIndices.size === 1) requestAnimationFrame(() => item.focus({ preventScroll: true }));
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
  state.selectedFile = fileKey(f);
  $('#diff-filename').textContent = f.filePath;
  renderConflictActions(f);
  // A click means "show me this", so it draws even if the text is unchanged —
  // the pane may have been emptied by something else since.
  await renderFileDiff(f, { force: true });
}

// What the diff pane is currently showing, so a poll can tell a file that has
// actually changed from the same file read again.
let _shown = null;

async function renderFileDiff(f, { force = false } = {}) {
  const pane = $('#diff-content');
  const key = fileKey(f);
  let sig, draw;
  try {
    if (f.conflicted) {
      // `git diff` on an unmerged path prints a combined diff that reads as
      // noise. What you actually need to look at is the file with its markers
      // in place.
      const text = await window.git.fileContents(state.repoPath, f.filePath);
      sig = 'conflict\0' + text;
      draw = () => renderConflict(text, pane, f);
    } else if (f.status === 'untracked') {
      // `git diff` has nothing to say about an untracked file, so the pane sat
      // on "No diff available" until the file was staged. Diffed against
      // nothing instead, the file reads as one all-added hunk. No per-hunk
      // buttons: there is no tracked baseline to cut a hunk from, and the
      // row's checkbox already stages the whole file.
      const text = await window.git.untrackedDiff(state.repoPath, f.filePath);
      sig = 'diff\0' + text;
      draw = () => renderDiff(text, pane, null);
    } else {
      const own = await window.git.diff(state.repoPath, f.filePath, f.staged);
      // A change that sits entirely on the other side shows up as nothing here;
      // the other side beats an empty pane.
      const text = own && own.trim()
        ? own
        : await window.git.diff(state.repoPath, f.filePath, !f.staged);
      sig = 'diff\0' + text;
      draw = () => renderDiff(text, pane, f.staged ? null : f.filePath);
    }
  } catch (e) {
    sig = 'error\0' + e.message;
    draw = () => { pane.innerHTML = `<div style="padding:20px;color:var(--red)">${escapeHtml(e.message)}</div>`; };
  }
  // Redrawing identical text every few seconds would throw away the scroll
  // position, any text selection, and the focus ring for nothing.
  if (!force && _shown && _shown.key === key && _shown.sig === sig) return;
  const top = pane.scrollTop;
  const sameFile = _shown && _shown.key === key;
  draw();
  // The file moved on under the user, but they were reading a particular part
  // of it, so stay where they were.
  if (sameFile && !force) pane.scrollTop = top;
  _shown = { key, sig };
}

// The file on screen keeps changing after it was clicked — edited in an editor,
// staged from a context menu, committed away. The poll that refreshes the file
// list refreshes what the diff pane is showing too, instead of leaving it on a
// picture of the file as it was when it was clicked.
async function refreshSelectedDiff() {
  const selected = state.selectedFile;
  if (!selected) { _shown = null; return; }
  const path = selected.slice(0, selected.lastIndexOf(':'));
  const f = state.statusFiles.find(x => fileKey(x) === selected)
    // Staging a file moves its row to the other half of the list. The pane
    // follows it there rather than sitting on a diff that no longer exists.
    || state.statusFiles.find(x => x.filePath === path);
  if (!f) {
    // Committed, discarded, or reverted by hand: there is no longer a change to
    // show, and a stale diff claims there is.
    state.selectedFile = null;
    _shown = null;
    $('#diff-filename').textContent = 'No file selected';
    $('#diff-content').innerHTML = '';
    const bar = $('#conflict-actions');
    if (bar) bar.hidden = true;
    return;
  }
  state.selectedFile = fileKey(f);
  $('#diff-filename').textContent = f.filePath;
  renderConflictActions(f);
  await renderFileDiff(f);
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
      // Nothing is selected any more, or the refresh below would pull the file
      // straight back into the pane as a now-resolved diff.
      state.selectedFile = null;
      $('#diff-content').innerHTML = '';
      $('#diff-filename').textContent = 'No file selected';
      bar.hidden = true;
      await refreshStatus();
    } catch (err) { toast(err.message, { type: 'error' }); }
  });
}

// The draft the user had typed before ticking Amend, so unticking gives it back
// rather than leaving them staring at the previous commit's message.
let _draft = null;

export function setupCommitBox(refresh) {
  _refresh = refresh;
  setupConflictActions();
  document.addEventListener('refresh-status', () => refreshStatus());

  const subject = $('#commit-subject');
  const body = $('#commit-body');
  const amend = $('#chk-amend');
  const btn = $('#btn-commit');

  const sync = () => { btn.disabled = !subject.value.trim(); };
  subject.addEventListener('input', sync);

  // ⌘⏎ from either field: the message is two fields now, and reaching for the
  // mouse between typing and committing is the kind of thing you notice fifty
  // times a day.
  const onKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); commit(); }
  };
  subject.addEventListener('keydown', onKey);
  body.addEventListener('keydown', onKey);

  amend.addEventListener('change', async () => {
    if (amend.checked) {
      _draft = { subject: subject.value, body: body.value };
      try {
        const last = await window.git.headMessage(state.repoPath);
        subject.value = last.subject;
        body.value = last.body;
      } catch { /* no commits yet — leave the box alone */ }
    } else if (_draft) {
      subject.value = _draft.subject;
      body.value = _draft.body;
      _draft = null;
    }
    sync();
    renderAmendWarning();
  });

  btn.addEventListener('click', commit);

  async function commit() {
    const head = subject.value.trim();
    if (!head) return;
    // Subject, blank line, body — the shape every git tool expects, built here
    // so the user does not have to remember to leave the line blank.
    const message = body.value.trim() ? `${head}\n\n${body.value.trim()}` : head;
    try {
      await window.git.commit(state.repoPath, message, { amend: amend.checked });
      subject.value = '';
      body.value = '';
      amend.checked = false;
      _draft = null;
      btn.disabled = true;
      renderAmendWarning();
      await refresh();
    } catch (e) { toast(e.message.trim() || 'Commit failed', { type: 'error' }); }
  }
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
