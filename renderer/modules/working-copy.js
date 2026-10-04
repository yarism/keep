import { $, escapeHtml, state } from './state.js';
import { renderDiff, renderConflict } from './diff.js';
import { showContextMenu } from './context-menu.js';
import { showConfirm } from './modal.js';
import { toast } from './toast.js';
import { offerChess } from './chess.js';
import {
  bannerText, conflictCaption, conflictsFirst, describeConflict, describeSides, nextConflict, sideActions,
} from './conflicts.js';

// Set by setupCommitBox so the banner's Abort/Continue can rebuild everything —
// they move HEAD, which nothing short of a full refresh survives.
let _refresh = null;

let _selectedIndices = new Set();
let _lastClickedIndex = null;

// `preloaded` is a status someone has already read: opening a repository reads
// it up front to choose the view, and the refresh that follows reuses it.
export async function refreshStatus(preloaded) {
  const [files, repoState] = await Promise.all([
    preloaded || window.git.status(state.repoPath).catch(() => []),
    window.git.repoState(state.repoPath)
      .catch(() => ({ kind: null, conflicts: [], branch: null, step: 0, total: 0 })),
  ]);
  const before = state.statusFiles;
  state.statusFiles = conflictsFirst(files);
  state.repoState = repoState;
  followSelection(before);
  landOnFirstConflict();
  renderStatus();
  await refreshSelectedDiff();
}

// The selection is kept as row numbers, and rows move: a resolved conflict
// leaves the group at the top, a staged file changes halves. So after every
// read the numbers are worked out again from the files they stood for, by the
// exact row first and by path for a file whose row has changed kind.
function followSelection(before) {
  const follow = (indices) => {
    const keys = new Set(), paths = new Set();
    indices.forEach(i => {
      const f = before[i];
      if (f) { keys.add(fileKey(f)); paths.add(f.filePath); }
    });
    const now = new Set();
    state.statusFiles.forEach((f, i) => {
      if (keys.has(fileKey(f))) { now.add(i); paths.delete(f.filePath); }
    });
    state.statusFiles.forEach((f, i) => {
      if (paths.has(f.filePath)) { now.add(i); paths.delete(f.filePath); }
    });
    return now;
  };
  _selectedIndices = follow(_selectedIndices);
  const [anchor] = _lastClickedIndex === null ? [] : follow([_lastClickedIndex]);
  _lastClickedIndex = anchor === undefined ? null : anchor;
}

// Conflicts arriving are not something to be found by scrolling: the first one
// is opened at the moment there start being any. Once, and only when nothing
// else is selected, so letting go of the file or picking another one is
// respected for as long as the conflicts last.
let _hadConflicts = false;

function landOnFirstConflict() {
  const first = state.statusFiles.findIndex(f => f.conflicted);
  const arrived = first >= 0 && !_hadConflicts;
  _hadConflicts = first >= 0;
  if (!arrived || state.selectedFile || _selectedIndices.size) return;
  _selectedIndices = new Set([first]);
  _lastClickedIndex = first;
  state.selectedFile = fileKey(state.statusFiles[first]);
}

// Everything refreshStatus draws, from state alone, so a repository can be
// painted from what it looked like last time before git has answered.
export function renderStatus() {
  const badge = $('#wc-badge');
  if (state.statusFiles.length > 0) { badge.textContent = state.statusFiles.length; badge.hidden = false; }
  else { badge.hidden = true; }
  // An unresolved conflict is not just another changed file, so the count stops
  // looking like an ordinary one.
  badge.classList.toggle('conflict', conflictCount() > 0);
  renderOpBanner();
  syncAmendAvailability();
  renderFileList();
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
  // Nor must a conflict the previous repository had in the pane.
  _hadConflicts = false;
  _bulk = false;
  showConflictPanel([], null);
  renderListHeader();
  const pane = $('#diff-content');
  if (pane) pane.classList.remove('two-sided');
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

// What is in the way, what it interrupted, and the two ways out.
function renderOpBanner() {
  const banner = $('#op-banner');
  if (!banner) return;
  const { kind } = state.repoState;
  const conflicts = conflictCount();
  // Nothing can be committed over an unmerged file, and Stage All here would
  // mark every conflict resolved, markers and all. So the commit box steps
  // aside until the conflicts are dealt with, which also gives the list of
  // them its room.
  const box = $('#commit-box');
  if (box) box.hidden = conflicts > 0;
  // A stash pop can leave conflicts with no operation in flight; there is
  // nothing to abort or continue there, but they still have to be announced.
  if (!kind && !conflicts) { banner.hidden = true; return; }
  banner.hidden = false;
  banner.classList.toggle('resolved', conflicts === 0);

  const { title, detail } = bannerText(state.repoState, conflicts);
  $('#op-banner-title').textContent = title;
  $('#op-banner-detail').textContent = detail;

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

// The header over the list names what leads it. With conflicts in the list that
// is them: how many are left, and a way to select them all at once.
function renderListHeader() {
  const title = $('#wc-list-title');
  if (!title) return;
  const conflicts = conflictCount();
  title.textContent = conflicts ? 'Conflicts' : 'Changed Files';
  const count = $('#wc-conflict-count');
  count.textContent = conflicts;
  count.hidden = !conflicts;
  const button = $('#btn-select-conflicts');
  button.hidden = conflicts < 2;
  // With every one of them selected, the same button lets go of them again.
  button.textContent = allConflictsSelected() ? 'Deselect All' : 'Select All';
}

function allConflictsSelected() {
  return conflictCount() > 0
    && state.statusFiles.every((f, idx) => !f.conflicted || _selectedIndices.has(idx));
}

function renderFileList() {
  const list = $('#wc-file-list');
  renderListHeader();
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

  const conflicts = conflictCount();
  state.statusFiles.forEach((f, idx) => {
    // The conflicts come first (see conflictsFirst), so this is where they end.
    if (conflicts && idx === conflicts) {
      const divider = document.createElement('div');
      divider.className = 'file-list-divider';
      divider.textContent = 'Changed Files';
      list.appendChild(divider);
    }
    const item = document.createElement('div');
    const isSelected = _selectedIndices.has(idx);
    item.className = 'file-item' + (isSelected ? ' selected' : '') + (f.conflicted ? ' conflicted' : '');
    item.tabIndex = 0;
    item.dataset.index = idx;
    // On a conflicted row the box is never ticked, an unmerged file being
    // neither staged nor unstaged, and ticking it marks the file resolved, the
    // way it does in Tower. That is `git add` and nothing more, so
    // resolveConflicts asks first when the file still has markers in it.
    item.innerHTML = `
      <input type="checkbox" class="file-checkbox" ${f.staged ? 'checked' : ''} tabindex="-1"${f.conflicted ? ' title="Mark resolved"' : ''}>
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
    item.querySelector('.file-checkbox').addEventListener('change', async (e) => {
      e.stopPropagation();
      if (f.conflicted) { resolveConflicts([f], 'resolved'); return; }
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

// Every row at once: what Select All means while the list, rather than a diff,
// is where the user is standing. The diff pane stays on the file it was
// showing, unless that took in several conflicts, which it then turns to as a
// group.
export function selectAllFiles() {
  state.statusFiles.forEach((_, idx) => _selectedIndices.add(idx));
  renderFileList();
  showBulkConflicts();
}

// Every conflicted row and nothing else, from the button in the list's header:
// the step before taking one side for all of them. Pressed again while they
// are all selected, it is Deselect All (see renderListHeader) and lets go.
function toggleAllConflicts() {
  if (allConflictsSelected()) { deselectAll(); return; }
  _selectedIndices = new Set();
  state.statusFiles.forEach((f, idx) => { if (f.conflicted) _selectedIndices.add(idx); });
  _lastClickedIndex = null;
  renderFileList();
  showBulkConflicts();
}

// A click in the panel that lands on no file lets go of them all, the way a
// click on the empty part of any list does. That includes the file in the diff
// pane: left standing, it would be a detail with no row to belong to. The
// commit box is not part of this. Clicking into it is how a message gets
// typed, and that is no reason to lose the files picked out for it. Nor is the
// header's Select All, which exists to pick files out.
function setupDeselect() {
  $('#wc-files-panel').addEventListener('click', (e) => {
    if (e.target.closest('.file-item, #commit-box, #btn-select-conflicts')) return;
    if (!_selectedIndices.size && !state.selectedFile) return;
    deselectAll();
  });
}

function deselectAll() {
  _selectedIndices.clear();
  _lastClickedIndex = null;
  renderFileList();
  showNoFile();
}

async function selectFile(f) {
  // Several conflicted files picked together are one decision to make, so the
  // pane is about all of them rather than about the one clicked last.
  if (showBulkConflicts()) return;
  _bulk = false;
  state.selectedFile = fileKey(f);
  $('#diff-filename').textContent = f.filePath;
  // A click means "show me this", so it draws even if the text is unchanged:
  // the pane may have been emptied by something else since.
  await renderFileDiff(f, { force: true });
}

// The conflicted files among the selected rows.
function selectedConflicts() {
  return getSelectedFiles().filter(f => f.conflicted);
}

// Whether the pane is on a group of conflicts rather than on one file.
let _bulk = false;

// With two or more conflicted files selected the pane stops being about a
// file: it offers the two sides once, for the whole group. Thirty translation
// files that all want the same answer are one decision, not thirty. Says
// whether that is what the pane is now showing.
function showBulkConflicts() {
  const files = selectedConflicts();
  if (files.length < 2) return false;
  _bulk = true;
  state.selectedFile = null;
  _shown = null;
  $('#diff-filename').textContent = `${files.length} conflicted files selected`;
  const pane = $('#diff-content');
  pane.innerHTML = '';
  pane.classList.remove('two-sided');
  showConflictPanel(files, null);
  return true;
}

// What the diff pane is currently showing, so a poll can tell a file that has
// actually changed from the same file read again.
let _shown = null;

async function renderFileDiff(f, { force = false } = {}) {
  const pane = $('#diff-content');
  const key = fileKey(f);
  let sig, draw, conflict = null;
  try {
    if (f.conflicted) {
      // `git diff` on an unmerged path prints a combined diff that reads as
      // noise. What you actually need to look at is the file with its markers
      // in place, or, where git wrote none, the two versions set against each
      // other.
      const details = await window.git.conflictDetails(state.repoPath, f.filePath);
      conflict = details;
      sig = `conflict\0${details.sidesDiff}\0${details.text}`;
      draw = () => drawConflict(details, pane);
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
  // An answer to a question nobody is asking any more: another file was
  // clicked, or all of them let go of, while git was still reading this one.
  if (state.selectedFile !== key) return;
  // Unlike the file under it, the panel is brought up to date every time: what
  // it says depends on the rest of the list (which conflict comes next) as
  // much as on this file, and setting the same words again costs nothing.
  showConflictPanel(conflict ? [f] : [], conflict);
  // Redrawing identical text every few seconds would throw away the scroll
  // position, any text selection, and the focus ring for nothing.
  if (!force && _shown && _shown.key === key && _shown.sig === sig) return;
  const top = pane.scrollTop;
  const sameFile = _shown && _shown.key === key;
  draw();
  pane.classList.toggle('two-sided', !!(conflict && conflict.sidesDiff));
  // The file moved on under the user, but they were reading a particular part
  // of it, so stay where they were.
  if (sameFile && !force) pane.scrollTop = top;
  _shown = { key, sig };
}

// The body of the pane for a conflicted file. With markers in it that is the
// file itself, since those lines are what gets edited. Without them there is
// nothing in the file to point at, so the two versions are set against each
// other instead: a diff from one side to the other, in the sides' colours.
function drawConflict(details, pane) {
  if (details.sidesDiff) renderDiff(details.sidesDiff, pane, null);
  else if (details.text !== null) renderConflict(details.text, pane);
  else pane.innerHTML = '<div style="padding:20px;color:var(--text-dim)">This file is not on disk</div>';
}

// The file on screen keeps changing after it was clicked — edited in an editor,
// staged from a context menu, committed away. The poll that refreshes the file
// list refreshes what the diff pane is showing too, instead of leaving it on a
// picture of the file as it was when it was clicked.
async function refreshSelectedDiff() {
  if (showBulkConflicts()) return;
  if (_bulk) {
    // The group has shrunk under the pane, resolved one way or another. One
    // file still selected is worth showing; otherwise there is nothing left
    // for the pane to be about.
    _bulk = false;
    const rest = getSelectedFiles();
    if (!state.selectedFile && rest.length === 1) state.selectedFile = fileKey(rest[0]);
    if (!state.selectedFile) { showNoFile(); return; }
  }
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
    showNoFile();
    return;
  }
  state.selectedFile = fileKey(f);
  $('#diff-filename').textContent = f.filePath;
  await renderFileDiff(f);
}

// The pane with no file in it.
function showNoFile() {
  state.selectedFile = null;
  _shown = null;
  _bulk = false;
  $('#diff-filename').textContent = 'No file selected';
  const pane = $('#diff-content');
  pane.innerHTML = '';
  pane.classList.remove('two-sided');
  showConflictPanel([], null);
}

const baseName = (filePath) => filePath.split('/').pop();

// What each side's button says, by what taking that side does to the file.
const SIDE_BUTTONS = { use: 'Use This Version', keep: 'Keep the File', remove: 'Remove the File' };

// The panel between the pane's header and the file: the two versions by name,
// a button to take each, and a line on what happened. `files` is what those
// buttons act on, either the one file in the pane (with what conflictDetails
// found for it) or every conflicted file in the selection. None hides it.
function showConflictPanel(files, details) {
  const panel = $('#conflict-panel');
  const footer = $('#conflict-footer');
  if (!panel || !footer) return;
  panel.hidden = footer.hidden = files.length === 0;
  if (!files.length) return;

  const bulk = files.length > 1;
  const sides = describeSides(state.repoState);
  const actions = bulk ? null : sideActions(files[0].conflictKind);
  for (const side of ['ours', 'theirs']) {
    const card = panel.querySelector(`.conflict-side.${side}`);
    const name = card.querySelector('.conflict-side-name');
    const detail = card.querySelector('.conflict-side-detail');
    name.textContent = name.title = sides[side].name;
    detail.textContent = detail.title = sides[side].detail;
    // Where git could not write both versions into the file, this is the one
    // it left there, which is also what Mark Resolved would keep.
    card.querySelector('.conflict-side-ondisk').hidden = bulk || details.onDisk !== side;
    card.querySelector('button').textContent = bulk
      ? `Use for All ${files.length}`
      : SIDE_BUTTONS[actions[side]];
  }
  $('#conflict-note').textContent = bulk
    ? 'One choice applies to all of them.'
    : describeConflict(files[0], details, sides);
  const caption = $('#conflict-caption');
  caption.textContent = bulk ? '' : conflictCaption(details);
  caption.hidden = !caption.textContent;

  const next = bulk ? null : nextConflict(state.statusFiles, files);
  $('#conflict-next').textContent = bulk ? '' : (next ? `Next: ${baseName(next.filePath)}` : 'Last one');
  const resolved = footer.querySelector('button');
  resolved.textContent = bulk ? 'Mark All Resolved' : 'Mark Resolved';
  // With no file on disk there is nothing for `git add` to pick up.
  resolved.disabled = !bulk && details.text === null;
}

// What the panel's buttons act on: the group when the pane is on one,
// otherwise the conflicted file it is showing.
function conflictTargets() {
  const picked = selectedConflicts();
  if (picked.length > 1) return picked;
  const shown = state.statusFiles.find(f => fileKey(f) === state.selectedFile);
  return shown && shown.conflicted ? [shown] : [];
}

// Marking a file resolved is `git add`, which stages a file with its conflict
// markers still in it as readily as one without. That is occasionally meant
// and usually a slip, so it gets asked about.
async function confirmLeftoverMarkers(paths) {
  let marked;
  // Not being able to look is no reason to refuse what was asked for.
  try { marked = await window.git.conflictMarkers(state.repoPath, paths); }
  catch { return true; }
  if (!marked.length) return true;
  return showConfirm('Mark Resolved', paths.length === 1
    ? `"${baseName(paths[0])}" still has conflict markers in it.\n\nMark it resolved anyway?`
    : `${marked.length} of these ${paths.length} files still have conflict markers in them.\n\nMark them all resolved anyway?`);
}

// One resolution at a time. Each one moves the pane on to the next conflict
// and leaves the same button under the cursor, so a double click would
// otherwise answer for a file that was never looked at.
let _resolving = false;

// Every way of resolving ends up here: the buttons in the pane, a row's
// checkbox, the context menu. `how` is a side to take ('ours' or 'theirs', in
// git's words, which describeSides turns into names) or 'resolved', which
// keeps each file as it stands on disk.
async function resolveConflicts(files, how) {
  if (_resolving || !files.length) return;
  _resolving = true;
  try {
    const paths = files.map(f => f.filePath);
    if (how === 'resolved' && !(await confirmLeftoverMarkers(paths))) {
      // A ticked checkbox may be what asked, and the answer was no.
      renderFileList();
      return;
    }
    try {
      if (how === 'resolved') await window.git.markResolved(state.repoPath, paths);
      else await window.git[how === 'theirs' ? 'useTheirs' : 'useOurs'](state.repoPath, paths);
      moveOnFrom(paths);
    } catch (err) { toast(err.message, { type: 'error' }); }
    await refreshStatus();
  } finally {
    _resolving = false;
  }
}

// After resolving, on to the next conflict rather than back to an empty pane:
// with a list of them to get through, the next one is what there is to look
// at. Only when the pane or the selection was on what just got resolved,
// though. A checkbox ticked further down the list leaves the file being read,
// and whatever else is selected, alone. Runs before the list is read again,
// and refreshStatus then follows the selection to wherever the rows end up.
function moveOnFrom(paths) {
  const taken = new Set(paths);
  const files = state.statusFiles;
  const wasShown = files.some(f => taken.has(f.filePath) && fileKey(f) === state.selectedFile);
  let wasSelected = false;
  files.forEach((f, i) => {
    if (taken.has(f.filePath) && _selectedIndices.delete(i)) wasSelected = true;
  });
  // Others of a group are still selected, so the pane stays on those.
  if (!wasShown && (!wasSelected || selectedConflicts().length)) return;
  const next = nextConflict(files, files.filter(f => taken.has(f.filePath)));
  if (!next) {
    _selectedIndices.clear();
    _lastClickedIndex = null;
    showNoFile();
    return;
  }
  const at = files.indexOf(next);
  _selectedIndices = new Set([at]);
  _lastClickedIndex = at;
  _bulk = false;
  state.selectedFile = fileKey(next);
}

function setupConflictActions() {
  $('#wc-diff-panel').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-resolve]');
    if (btn) resolveConflicts(conflictTargets(), btn.dataset.resolve);
  });
  $('#btn-select-conflicts').addEventListener('click', toggleAllConflicts);
}

// The draft the user had typed before ticking Amend, so unticking gives it back
// rather than leaving them staring at the previous commit's message.
let _draft = null;

export function setupCommitBox(refresh) {
  _refresh = refresh;
  setupConflictActions();
  setupDeselect();
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
      // The commit earned a move in the world's chess game. Not awaited:
      // the game is a guest here and the commit flow is done.
      offerChess();
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

// Nothing on the ordinary file menu applies mid-conflict: staging is what
// resolving is, and discarding one side of a merge is not a thing git offers.
// So a conflicted file gets the pane's choices instead, and so do several at
// once, with the sides under the same names the pane gives them.
function showConflictContextMenu(e, files) {
  const sides = describeSides(state.repoState);
  const [one] = files;
  const many = files.length > 1;
  const actions = sideActions(one.conflictKind);
  const take = (side) => {
    const name = sides[side].name;
    if (many) return `Use ${name} for ${files.length} Files`;
    if (actions[side] === 'use') return `Use ${name}`;
    return `${SIDE_BUTTONS[actions[side]]} (${name})`;
  };
  showContextMenu(e, [
    { label: many ? `${files.length} Conflicted Files` : `Conflict: ${one.conflictKind}`, disabled: true },
    { separator: true },
    { label: take('ours'), action: () => resolveConflicts(files, 'ours') },
    { label: take('theirs'), action: () => resolveConflicts(files, 'theirs') },
    {
      label: many ? `Mark ${files.length} Files Resolved` : `Mark "${baseName(one.filePath)}" Resolved`,
      // Both sides deleted it: there is no file left to keep as it is.
      disabled: !many && one.conflictKind === 'both deleted',
      action: () => resolveConflicts(files, 'resolved'),
    },
    ...(many ? [] : [
      { separator: true },
      { label: 'Reveal in Finder', action: () => window.git.showInFinder(state.repoPath, one.filePath) },
    ]),
  ]);
}

function showMultiFileContextMenu(e) {
  const files = getSelectedFiles();
  // Conflicts in the selection are what there is to act on: Stage would mark
  // them resolved under another name, and nothing else here applies to them.
  const conflicts = files.filter(f => f.conflicted);
  if (conflicts.length) { showConflictContextMenu(e, conflicts); return; }
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
  if (f.conflicted) { showConflictContextMenu(e, [f]); return; }
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
