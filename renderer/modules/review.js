// Reviewing a pull request: reading what others left on the diff, drafting your
// own, and submitting the lot as one verdict.
//
// Draft comments live here and nowhere else until the moment you submit. GitHub
// can create and submit a review in a single request, so Keep never opens a
// server-side pending review — which means closing the app mid-review leaves no
// half-finished review sitting on the repository, and no state on GitHub that
// this window would have to stay in step with. The cost is that the drafts are
// Keep's to keep, so they are written into settings.json as they are typed: a
// review is too much work to lose to a quit.
//
// Anchoring is the fiddly part. A comment is not attached to a line of text but
// to a position in a diff — a file, a side, and a line number on that side —
// and renderDiff hands those out as it renders (see its `annotate` option).
import { $, escapeHtml, state } from './state.js';
import { busyToast } from './toast.js';
import { icon } from '../icons.js';

let _forge = null;
let _pr = null;
let _threads = [];
let _pending = [];
let _onChange = () => {};
let _savedReviews = null;   // every repo's drafts, as settings.json holds them

const keyFor = (path, side, line) => `${path} ${side} ${line}`;
const draftKey = () => `${state.repoPath}#${_pr ? _pr.number : ''}`;

export function pendingCount() {
  return _pending.length;
}

export function onReviewChange(fn) {
  _onChange = fn || (() => {});
}

// ── Drafts, as they survive a quit ──

async function loadDrafts() {
  if (!_savedReviews) {
    try {
      const settings = await window.git.loadSettings();
      _savedReviews = settings.pendingReviews || {};
    } catch { _savedReviews = {}; }
  }
  _pending = (_savedReviews[draftKey()] || []).slice();
}

function saveDrafts() {
  if (!_savedReviews) _savedReviews = {};
  if (_pending.length) _savedReviews[draftKey()] = _pending;
  else delete _savedReviews[draftKey()];
  window.git.saveSettings({ pendingReviews: _savedReviews });
}

// ── What is already on the diff ──

export async function setPullRequest(forge, pr) {
  _forge = forge;
  _pr = pr;
  _threads = [];
  await loadDrafts();
  _onChange();
}

export async function loadThreads() {
  if (!_forge || !_pr) return;
  try {
    const result = await window.git.reviewComments(state.repoPath, _forge, _pr.number);
    _threads = result.ok ? result.threads : [];
  } catch { _threads = []; }
  _onChange();
}

const threadsAt = (path, side, line) =>
  _threads.filter(t => !t.outdated && keyFor(t.path, t.side, t.line) === keyFor(path, side, line));
const pendingAt = (path, side, line) =>
  _pending.filter(p => keyFor(p.path, p.side, p.line) === keyFor(path, side, line));

// Comments whose line has drifted out of the diff. They cannot be hung on a
// row, and dropping them would quietly hide a review someone wrote.
const outdatedIn = (path) => _threads.filter(t => t.outdated && t.path === path);

// ── What the file row says before you open it ──

export function fileBadge(file) {
  const own = _pending.filter(p => p.path === file.filePath).length;
  const theirs = _threads.filter(t => t.path === file.filePath).length;
  const parts = [];
  if (theirs) parts.push(`${theirs} comment${theirs !== 1 ? 's' : ''}`);
  if (own) parts.push(`${own} pending`);
  return parts.join(' · ') || null;
}

export function fileNote(file) {
  const stale = outdatedIn(file.filePath);
  if (!stale.length) return null;
  const box = document.createElement('div');
  box.className = 'review-outdated';
  const title = document.createElement('div');
  title.className = 'review-outdated-title';
  title.textContent = `${stale.length} comment${stale.length !== 1 ? 's' : ''} on lines that have since changed`;
  box.appendChild(title);
  // Whole threads, not just the comment that started them: an answer to a
  // question is the half worth reading, and it is no less lost than the
  // question when the line it hung on goes away.
  stale.forEach(t => box.appendChild(threadEl(t, { outdated: true })));
  return box;
}

// ── Hanging comments off the diff ──

export function annotateFor(file) {
  return (row, anchor) => {
    const existing = threadsAt(file.filePath, anchor.side, anchor.line);
    const drafts = pendingAt(file.filePath, anchor.side, anchor.line);
    // Every line can be commented on, but only the ones with something to show
    // get a slot up front — a wrapper per row would multiply the node count of
    // a large diff for nothing.
    row.classList.add('commentable');
    const add = document.createElement('button');
    add.className = 'review-add-btn';
    add.type = 'button';
    add.title = 'Comment on this line';
    add.textContent = '+';
    add.addEventListener('click', (e) => {
      e.stopPropagation();
      openComposer(row, file, anchor);
    });
    row.appendChild(add);

    if (!existing.length && !drafts.length) return;
    const slot = slotFor(row);
    existing.forEach(t => slot.appendChild(threadEl(t)));
    drafts.forEach(d => slot.appendChild(pendingEl(d, row, file, anchor)));
  };
}

// The strip under a row where everything about that line goes, made on demand.
function slotFor(row) {
  if (row.nextElementSibling && row.nextElementSibling.classList.contains('review-slot')) {
    return row.nextElementSibling;
  }
  const slot = document.createElement('div');
  slot.className = 'review-slot';
  row.after(slot);
  return slot;
}

function commentEl(c, { outdated = false } = {}) {
  const el = document.createElement('div');
  el.className = 'review-comment' + (outdated ? ' outdated' : '');
  el.innerHTML = `
    <div class="review-comment-head">
      <span class="review-author">${escapeHtml(c.author)}</span>
      <span class="review-when">${escapeHtml(when(c.createdAt))}</span>
      ${outdated && c.originalLine ? `<span class="review-chip">was line ${c.originalLine}</span>` : ''}
    </div>
    <div class="review-comment-body"></div>
  `;
  // Comment bodies are other people's prose and may contain anything at all,
  // so they are set as text rather than built into the markup above.
  el.querySelector('.review-comment-body').textContent = c.body;
  return el;
}

function threadEl(thread, { outdated = false } = {}) {
  const el = document.createElement('div');
  el.className = 'review-thread';
  el.appendChild(commentEl(thread, { outdated }));
  (thread.replies || []).forEach(r => {
    const reply = commentEl(r, { outdated });
    reply.classList.add('review-reply');
    el.appendChild(reply);
  });
  // Replying and resolving belong to GitHub, not to Keep. The link goes to the
  // thread itself rather than to the pull request, so the answer lands in the
  // right place.
  if (thread.url) {
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'review-thread-link';
    link.textContent = 'Reply on GitHub';
    link.addEventListener('click', () => window.git.openExternal(thread.url));
    el.appendChild(link);
  }
  return el;
}

function pendingEl(draft, row, file, anchor) {
  const el = document.createElement('div');
  el.className = 'review-comment pending';
  el.innerHTML = `
    <div class="review-comment-head">
      <span class="review-author">You</span>
      <span class="review-chip pending">pending</span>
    </div>
    <div class="review-comment-body"></div>
    <div class="review-comment-actions">
      <button type="button" data-edit>Edit</button>
      <button type="button" data-delete>Delete</button>
    </div>
  `;
  el.querySelector('.review-comment-body').textContent = draft.body;
  el.querySelector('[data-edit]').addEventListener('click', () => {
    el.remove();
    openComposer(row, file, anchor, draft);
  });
  el.querySelector('[data-delete]').addEventListener('click', () => {
    _pending = _pending.filter(p => p.key !== draft.key);
    saveDrafts();
    el.remove();
    _onChange();
  });
  return el;
}

// The box you type into. One at a time per line, and Escape abandons it.
function openComposer(row, file, anchor, editing) {
  const slot = slotFor(row);
  if (slot.querySelector('.review-composer')) return;
  const box = document.createElement('div');
  box.className = 'review-composer';
  box.innerHTML = `
    <textarea rows="3" placeholder="Leave a comment on line ${anchor.line}"></textarea>
    <div class="review-composer-actions">
      <span class="review-composer-where"></span>
      <button type="button" data-cancel>Cancel</button>
      <button type="button" class="primary" data-save>Add to review</button>
    </div>
  `;
  box.querySelector('.review-composer-where').textContent = `${file.filePath}:${anchor.line}`;
  const textarea = box.querySelector('textarea');
  if (editing) textarea.value = editing.body;
  slot.appendChild(box);
  textarea.focus();

  const close = () => box.remove();
  const restore = (draft) => slotFor(row).appendChild(pendingEl(draft, row, file, anchor));
  const save = () => {
    const body = textarea.value.trim();
    if (!body) { close(); if (editing) restore(editing); return; }
    const draft = editing
      ? { ...editing, body }
      : {
        key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        path: file.filePath, side: anchor.side, line: anchor.line, body,
      };
    _pending = _pending.filter(p => p.key !== draft.key).concat(draft);
    saveDrafts();
    close();
    restore(draft);
    _onChange();
  };

  box.querySelector('[data-save]').addEventListener('click', save);
  box.querySelector('[data-cancel]').addEventListener('click', () => { close(); if (editing) restore(editing); });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); if (editing) restore(editing); }
    // Enter alone is a newline: a review comment is prose, not a field.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
  });
}

function when(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-CA'); } catch { return ''; }
}

// ── Submitting ──

// The modal is the confirmation step, and it is deliberately explicit about
// what is about to happen and where: a review is published under the user's
// name on someone else's repository, and it cannot be taken back.
function askVerdict(count) {
  return new Promise(resolve => {
    const overlay = $('#modal-overlay');
    const input = $('#modal-input');
    $('#modal-title').textContent = `Submit review on ${_forge.owner}/${_forge.repo} #${_pr.number}`;

    const box = document.createElement('div');
    box.className = 'review-submit';
    box.innerHTML = `
      <label class="review-verdict"><input type="radio" name="verdict" value="COMMENT" checked><span><strong>Comment</strong> — feedback without a verdict</span></label>
      <label class="review-verdict"><input type="radio" name="verdict" value="APPROVE"><span><strong>Approve</strong> — this can be merged</span></label>
      <label class="review-verdict"><input type="radio" name="verdict" value="REQUEST_CHANGES"><span><strong>Request changes</strong> — this needs work first</span></label>
      <textarea class="review-submit-body" rows="4" placeholder="Message (optional for an approval)"></textarea>
      <div class="review-submit-note">${count
        ? `${count} line comment${count !== 1 ? 's' : ''} will be posted with it.`
        : 'No line comments — this posts the message alone.'}</div>
    `;
    input.style.display = 'none';
    input.parentNode.insertBefore(box, input);
    overlay.hidden = false;
    box.querySelector('textarea').focus();

    function cleanup() {
      overlay.hidden = true;
      box.remove();
      input.style.display = '';
      $('#modal-ok').removeEventListener('click', onOk);
      $('#modal-cancel').removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
    }
    function onOk() {
      const event = box.querySelector('input[name=verdict]:checked').value;
      const body = box.querySelector('textarea').value.trim();
      cleanup();
      resolve({ event, body });
    }
    function onCancel() { cleanup(); resolve(null); }
    // No Enter-to-submit: this one posts in public, and a newline in the
    // message box is worth more than the shortcut.
    function onKey(e) { if (e.key === 'Escape') onCancel(); }
    $('#modal-ok').addEventListener('click', onOk);
    $('#modal-cancel').addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
  });
}

export async function submitReview({ onSubmitted } = {}) {
  if (!_forge || !_pr) return;
  const verdict = await askVerdict(_pending.length);
  if (!verdict) return;

  const status = busyToast('Submitting review…');
  const result = await window.git.submitReview(state.repoPath, _forge, {
    number: _pr.number,
    headSha: _pr.headSha,
    event: verdict.event,
    body: verdict.body,
    comments: _pending.map(({ path, side, line, body }) => ({ path, side, line, body })),
  }).catch(e => ({ ok: false, message: e.message }));

  if (!result.ok) {
    // The drafts are kept. A rejected review is usually one bad anchor out of
    // several comments, and throwing the rest away to punish it would be a
    // strange way to help.
    status.fail(result.message || 'GitHub would not accept the review.');
    return;
  }
  _pending = [];
  saveDrafts();
  status.done(`Review submitted on #${_pr.number}`);
  await loadThreads();
  if (onSubmitted) onSubmitted();
}

// The bar above the changeset: what is drafted, and the way to send it.
export function reviewBarEl() {
  const el = document.createElement('div');
  el.className = 'review-bar';
  const count = _pending.length;
  const label = document.createElement('span');
  label.className = 'review-bar-count';
  label.textContent = count
    ? `${count} pending comment${count !== 1 ? 's' : ''}`
    : 'Click + on any line to comment';
  el.appendChild(label);

  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'review-submit-btn';
  submit.innerHTML = `${icon('check', 13)}Submit review`;
  submit.addEventListener('click', () => submitReview({ onSubmitted: _onChange }));
  el.appendChild(submit);
  return el;
}

export function resetReview() {
  _forge = null;
  _pr = null;
  _threads = [];
  _pending = [];
}
