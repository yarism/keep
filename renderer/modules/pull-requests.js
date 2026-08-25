// Open pull requests, and what each one changes.
//
// Two halves that meet in the middle. The list comes from GitHub's API (see
// forge-api.js, which is the only part of Keep that speaks HTTP) because a pull
// request's number, title and author exist nowhere else. The diff does not:
// GitHub publishes every PR's head as a ref on the origin repository, so one
// ordinary fetch puts the branch in the local object store and the changeset
// below is the same local `git diff` that History renders for a commit.
//
// Read-only. Nothing here approves, comments or merges.
import { $, escapeHtml, state, switchView } from './state.js';
import { renderChangeset, summarize } from './changeset.js';
import { createUnicodeToggle } from './diff.js';
import { forgeForBranch, forgeLabel, pullRequestsNoun, pullRequestsUrl } from './forge.js';
import { icon } from '../icons.js';
import { commentCard } from './comment.js';
import { reactionsEl } from './reactions.js';
import {
  setPullRequest, loadThreads, annotateFor, fileBadge, fileNote,
  reviewBarEl, onReviewChange, resetReview,
} from './review.js';
import { busyToast } from './toast.js';

// A pull request list costs a network round trip and counts against a rate
// limit, so unlike everything else in the sidebar it is not refreshed by the
// three-second poll. It loads when the view is opened, and again on demand.
const STALE_AFTER_MS = 60000;
let _loadedAt = 0;
let _loading = false;

export function forgeForRepo() {
  return forgeForBranch(state.remotes, null);
}

// The nav item is present only where it leads somewhere: a repository on
// GitLab, Bitbucket or a plain server keeps the link-out menu items and gets no
// Pull Requests view at all.
export function syncPullRequestNav() {
  const item = document.querySelector('.nav-item[data-view="pull-requests"]');
  if (!item) return;
  const forge = forgeForRepo();
  const supported = Boolean(forge && forge.kind === 'github');
  item.hidden = !supported;
  if (!supported && state.currentView === 'pull-requests') switchView('working-copy');
  const badge = $('#pr-badge');
  if (badge) {
    const n = state.pullRequests.length;
    badge.hidden = !supported || !n;
    badge.textContent = String(n);
  }
}

export function setupPullRequests() {
  const refreshBtn = $('#pr-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', () => loadPullRequests({ force: true }));
  const openBtn = $('#pr-open-web');
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      const url = pullRequestsUrl(forgeForRepo());
      if (url) window.git.openExternal(url);
    });
  }
}

// Called when the view is opened. Cheap to call repeatedly: it only goes to the
// network if what is on screen has gone stale.
export async function loadPullRequests({ force = false } = {}) {
  const forge = forgeForRepo();
  if (!forge || forge.kind !== 'github') return;
  if (_loading) return;
  if (!force && _loadedAt && Date.now() - _loadedAt < STALE_AFTER_MS) return;
  _loading = true;
  setListMessage('Loading…');
  try {
    const result = await window.git.pullRequests(state.repoPath, forge);
    if (result.ok) {
      state.pullRequests = result.pulls;
      _loadedAt = Date.now();
      renderList(result);
    } else {
      state.pullRequests = [];
      renderProblem(result, forge);
    }
  } catch (e) {
    state.pullRequests = [];
    setListMessage(e.message);
  } finally {
    _loading = false;
    syncPullRequestNav();
  }
}

export function resetPullRequests() {
  _loadedAt = 0;
  resetReview();
  state.pullRequests = [];
  state.selectedPr = null;
  const list = $('#pr-list');
  if (list) list.innerHTML = '';
  const info = $('#pr-info');
  if (info) info.innerHTML = '';
  const changeset = $('#pr-changeset');
  if (changeset) changeset.innerHTML = '';
}

function setListMessage(text) {
  const list = $('#pr-list');
  if (list) list.innerHTML = `<div class="pr-message">${escapeHtml(text)}</div>`;
}

// Every failure the API module can report is a different thing for the reader
// to do, so each one keeps its own words and — where there is one — its own way
// out. A missing token is the common case and the one worth a button.
function renderProblem(result, forge) {
  const list = $('#pr-list');
  if (!list) return;
  const canSignIn = result.reason === 'no-token' || result.reason === 'auth';
  list.innerHTML = `
    <div class="pr-message">
      <div>${escapeHtml(result.message)}</div>
      ${canSignIn ? `<div class="pr-message-hint">Keep never asks for the token itself — it reads whatever
        the GitHub CLI or your git credential helper already holds.</div>` : ''}
      <button class="pr-message-action" data-open-web>Open ${escapeHtml(pullRequestsNoun(forge))} on ${escapeHtml(forgeLabel(forge))}</button>
    </div>`;
  const btn = list.querySelector('[data-open-web]');
  if (btn) btn.addEventListener('click', () => window.git.openExternal(pullRequestsUrl(forge)));
}

function renderList(result) {
  const list = $('#pr-list');
  if (!list) return;
  list.innerHTML = '';
  if (!state.pullRequests.length) {
    setListMessage('No open pull requests.');
    return;
  }
  state.pullRequests.forEach(pr => {
    const item = document.createElement('div');
    item.className = 'commit-item pr-item' + (state.selectedPr === pr.number ? ' selected' : '');
    item.tabIndex = 0;
    item.innerHTML = `
      <div class="pr-item-header">
        <span class="pr-number">#${pr.number}</span>
        ${pr.draft ? '<span class="pr-chip draft">draft</span>' : ''}
        ${pr.fromFork ? '<span class="pr-chip fork">fork</span>' : ''}
        <span class="pr-author">${escapeHtml(pr.author)}</span>
        <span class="pr-updated">${escapeHtml(shortDate(pr.updatedAt))}</span>
      </div>
      <div class="pr-title">${escapeHtml(pr.title)}</div>
      <div class="pr-branches">${escapeHtml(pr.head)} <span class="pr-arrow">→</span> ${escapeHtml(pr.base)}</div>
    `;
    item.addEventListener('click', () => selectPullRequest(pr));
    list.appendChild(item);
  });
  if (result && result.truncated) {
    const note = document.createElement('div');
    note.className = 'pr-message';
    note.textContent = 'Showing the 100 most recently updated. There may be more.';
    list.appendChild(note);
  }
  if (!state.pullRequests.some(p => p.number === state.selectedPr)) {
    selectPullRequest(state.pullRequests[0]);
  }
}

function shortDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-CA'); } catch { return ''; }
}

// Fetching the head ref is the only network work here, and it is why this shows
// a toast: on a large pull request it is the one part that takes a moment.
// Adding or dropping a draft changes the review bar and the file badges, both
// of which sit outside the row that changed — so the pane is rebuilt rather
// than patched in three places. Expanded diffs collapse, which is the price; a
// review has only a handful of these moments.
let _rerenderChangeset = () => {};
onReviewChange(() => { if (state.currentView === 'pull-requests') _rerenderChangeset(); });

async function selectPullRequest(pr) {
  if (!pr) return;
  // Until the new pull request has loaded there is nothing to repaint, and the
  // closure still standing here belongs to the last one.
  _rerenderChangeset = () => {};
  state.selectedPr = pr.number;
  renderList();
  renderInfo(pr);
  const changeset = $('#pr-changeset');
  changeset.innerHTML = '<div class="pr-message">Fetching…</div>';

  const remote = remoteName();
  const status = busyToast(`Fetching pull request #${pr.number}…`);
  try {
    // Three things at once, and only the first is required: the branch itself,
    // the comments already on it, and the drafts this machine has for it.
    await setPullRequest(forgeForRepo(), pr);
    const [head] = await Promise.all([
      window.git.fetchPullRequest(state.repoPath, remote, pr.number),
      loadThreads(),
    ]);
    // The base as this repository last saw it. Comparing against the local
    // remote-tracking ref rather than the local branch is what makes the
    // changeset match GitHub's: a stale or checked-out `main` of your own is
    // not what the pull request is proposing to merge into.
    const base = `${remote}/${pr.base}`;
    const [files, commits] = await Promise.all([
      window.git.rangeFiles(state.repoPath, base, head),
      window.git.rangeCommits(state.repoPath, base, head).catch(() => []),
    ]);
    status.done(`Pull request #${pr.number} ready`);
    renderInfo(pr, commits);
    if (state.selectedPr !== pr.number) return;   // clicked away while fetching
    _rerenderChangeset = () => {
      renderChangeset(changeset, files,
        (f) => window.git.rangeFileDiff(state.repoPath, base, head, f.filePath),
        { annotate: annotateFor, fileBadge, fileNote, summary: false });
      changeset.prepend(reviewBarEl(summarize(files), createUnicodeToggle(changeset)));
    };
    _rerenderChangeset();
  } catch (e) {
    status.fail(e.message.trim() || `Could not fetch pull request #${pr.number}`);
    changeset.innerHTML = `<div class="pr-message">${escapeHtml(e.message)}</div>`;
  }
}


// Which remote to fetch the pull ref from — the one the forge was recognised
// from, so a repo with both an origin and a fork remote asks the right server.
function remoteName() {
  const forge = forgeForRepo();
  const match = state.remotes.find(r => forge && r.url.includes(`${forge.owner}/${forge.repo}`));
  return (match && match.name) || 'origin';
}

function renderInfo(pr, commits) {
  const info = $('#pr-info');
  if (!info) return;
  const forge = forgeForRepo();
  // Title and the one sentence that says what this proposes, then the author's
  // own words. The commit list is a disclosure rather than a band: it is
  // reference, wanted occasionally, and it was pushing the code further down
  // the pane every time it was not.
  const commitCount = commits ? commits.length : 0;
  info.innerHTML = `
    <div class="pr-detail-header">
      <div class="pr-detail-top">
        <div class="pr-detail-title">${escapeHtml(pr.title)}</div>
        <button class="pr-web-link" type="button">${icon('cloud', 13)}Review on ${escapeHtml(forgeLabel(forge))}</button>
      </div>
      <div class="pr-detail-sub">
        <span class="pr-number">#${pr.number}</span>
        ${pr.draft ? '<span class="pr-chip draft">draft</span>' : ''}
        <span>${escapeHtml(pr.author)} wants to merge
          <strong>${escapeHtml(pr.fromFork && pr.headRepo ? `${pr.headRepo}:${pr.head}` : pr.head)}</strong>
          into <strong>${escapeHtml(pr.base)}</strong></span>
        ${commitCount ? `<button class="pr-commits-toggle" type="button" aria-expanded="false">
          <span class="expand-arrow">${icon('chevron', 11)}</span>${commitCount} commit${commitCount !== 1 ? 's' : ''}</button>` : ''}
        ${pr.comments ? `<span class="pr-commit-count">${pr.comments} comment${pr.comments !== 1 ? 's' : ''}</span>` : ''}
      </div>
      ${commitCount ? `<div class="pr-commits" hidden>${commits.map(c => `
        <div class="pr-commit">
          <span class="commit-hash">${c.hash.substring(0, 7)}</span>
          <span class="pr-commit-subject">${escapeHtml(c.subject)}</span>
          <span class="pr-commit-author">${escapeHtml(c.author)}</span>
        </div>`).join('')}</div>` : ''}
      <div class="pr-description-slot"></div>
    </div>
  `;
  // The description is a comment — the first one on the pull request — and it
  // is drawn as one, over the author's name, so it does not read as a caption
  // the tool wrote about the branch.
  if (pr.body) {
    info.querySelector('.pr-description-slot').appendChild(commentCard({
      author: pr.author,
      avatar: pr.avatar,
      at: pr.updatedAt,
      body: pr.body,
      verb: 'commented',
      className: 'pr-description',
      // The description is a comment, so it is reacted to like one — the API
      // just keeps it somewhere else, under the issue of the same number.
      footer: reactionsEl({ type: 'issue', number: pr.number }, forge, null),
    }));
  }
  const toggle = info.querySelector('.pr-commits-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const list = info.querySelector('.pr-commits');
      const open = list.hidden;
      list.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.querySelector('.expand-arrow').classList.toggle('open', open);
    });
  }
  const link = info.querySelector('.pr-web-link');
  // Reviewing still happens on the web: Keep can show the change but has no
  // way to approve it, and pretending otherwise would be the wrong kind of
  // helpful.
  if (link) link.addEventListener('click', () => window.git.openExternal(pr.url));
}
