import { $, escapeHtml, state, updateTitlebar } from './state.js';
import { renderChangeset } from './changeset.js';
import { showCommitContextMenu } from './context-menu.js';
import { buildGraph } from '../graph.js';
import { trackingFor, trackingChips, headTracking } from './sync.js';

// Graph geometry. The row height is fixed and shared with the stylesheet
// (--commit-row-h) because each row draws its own half of every line: if a row
// were a pixel taller than the SVG inside it, the column would come apart at
// every seam.
const ROW_H = 52;
const LANE_W = 14;
const GRAPH_PAD = 12;
const MAX_LANES = 8;      // beyond this, lanes pile up in the last column
const LANE_COLORS = 6;    // --lane-0 … --lane-5 in styles.css

let _refresh = null;
let _searchTimeout = null;

// ── Paging ──
//
// History is unbounded, so the list asks for a page at a time and fetches the
// next one as it is scrolled — a fixed cap silently answered "your repo has
// 200 commits". `_depth` is how far the list currently reaches: a poll tick
// re-reads that many commits rather than snapping back to the first page under
// someone who has scrolled past it.
const PAGE_SIZE = 200;
let _depth = PAGE_SIZE;
let _atEnd = false;
let _loadingMore = false;
// Which ref the loaded pages belong to. Switching branch or scope asks a
// different question, and the depth reached in the old answer means nothing.
let _pagedRef = null;

function refKey(branch, all) {
  return all ? '*all*' : (branch || '*head*');
}

// Rows are 52px; start fetching a few screens before the end so the next page
// is usually there by the time the scroll reaches it.
const PAGE_TRIGGER_PX = 800;

export function setupHistoryPaging(refresh) {
  _refresh = refresh;
  const list = $('#history-list');
  if (!list) return;
  list.addEventListener('scroll', () => {
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - PAGE_TRIGGER_PX) loadMore();
  });
}

async function loadMore() {
  if (_loadingMore || _atEnd || !state.repoPath) return;
  _loadingMore = true;
  try {
    const { branch, all } = historyRef();
    const skip = state.commits.length;
    const query = $('#search-input').value.trim();
    const page = state.searching && query
      ? await window.git.searchLog(state.repoPath, query, $('#search-field').value, branch, PAGE_SIZE, { all, skip })
      : await window.git.log(state.repoPath, all ? null : branch, PAGE_SIZE, { all, skip });
    // A short page is the end of history; the same commits coming back again
    // means the log shifted under us, and appending them would duplicate rows.
    if (page.length < PAGE_SIZE) _atEnd = true;
    const seen = new Set(state.commits.map(c => c.hash));
    const fresh = page.filter(c => !seen.has(c.hash));
    if (!fresh.length) { _atEnd = true; return; }
    state.commits = state.commits.concat(fresh);
    _depth = state.commits.length;
    renderCommitList(_refresh);
    updateTitlebar();
  } catch (e) {
    console.error('[history] load more failed:', e);
    _atEnd = true;
  } finally {
    _loadingMore = false;
  }
}

export function setupHistorySearch(refresh) {
  _refresh = refresh;
  const input = $('#search-input');
  const field = $('#search-field');
  const clearBtn = $('#search-clear');

  input.addEventListener('input', () => {
    clearBtn.style.display = input.value ? 'flex' : 'none';
    clearTimeout(_searchTimeout);
    _searchTimeout = setTimeout(() => doSearch(), 300);
  });
  field.addEventListener('change', () => {
    if (input.value) doSearch();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(_searchTimeout); doSearch(); }
    if (e.key === 'Escape') { clearSearch(); }
  });
  clearBtn.addEventListener('click', clearSearch);
}

async function doSearch() {
  const query = $('#search-input').value.trim();
  if (!query) { clearSearch(); return; }
  const field = $('#search-field').value;
  const { branch, all } = historyRef();
  state.searching = true;
  _depth = PAGE_SIZE;
  _atEnd = false;
  _pagedRef = null;
  try {
    state.commits = await window.git.searchLog(state.repoPath, query, field, branch, _depth, { all });
    _atEnd = state.commits.length < _depth;
    console.log('[search] found', state.commits.length, 'commits for', field, ':', query);
    // The rows still mark what has not been pushed, so the set has to cover
    // whatever the search may have turned up.
    state.unpushed = new Set(await window.git.unpushed(state.repoPath, all ? null : branch, { all }).catch(() => []));
  } catch (e) {
    console.error('[search] error:', e);
    state.commits = [];
  }
  renderCommitList(_refresh);
}

function clearSearch() {
  $('#search-input').value = '';
  $('#search-clear').style.display = 'none';
  state.searching = false;
  if (_refresh) refreshHistory(_refresh);
}

// "This branch" vs "All branches". The choice outlives the session because it
// is a way of working, not a per-visit decision.
export function setupHistoryScope(refresh, settings) {
  state.historyScope = settings.historyScope === 'all' ? 'all' : 'branch';
  const group = $('#history-scope');
  if (!group) return;
  syncScopeButtons();
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-scope]');
    if (!btn || btn.dataset.scope === state.historyScope) return;
    state.historyScope = btn.dataset.scope;
    // A branch pinned from the sidebar is a statement about which branch to
    // look at, which "all branches" contradicts — and its highlight would
    // otherwise sit there pointing at nothing in particular.
    if (state.historyScope === 'all') state.selectedBranch = null;
    window.git.saveSettings({ historyScope: state.historyScope });
    syncScopeButtons();
    refresh();
  });
}

function syncScopeButtons() {
  document.querySelectorAll('#history-scope button[data-scope]').forEach(b => {
    const on = b.dataset.scope === state.historyScope;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

// What the History list is currently showing. refreshHistory decides it and
// search has to agree, or searching quietly answers a different question than
// the one on screen.
export function historyRef() {
  const current = state.branchList.find(b => b.current);
  if (state.historyScope === 'all') return { branch: null, all: true };
  if (state.selectedBranch) return { branch: state.selectedBranch, all: false };
  if (current) return { branch: current.detached ? 'HEAD' : current.name, all: false };
  return { branch: null, all: false };
}

// Switching repositories reuses the same list, the same paging depth and the
// same search box. None of it means anything in the next repository, and the
// old rows would sit on screen until its history finished loading.
export function resetHistory() {
  clearTimeout(_searchTimeout);
  state.commits = [];
  state.unpushed = new Set();
  state.searching = false;
  _depth = PAGE_SIZE;
  _atEnd = false;
  _loadingMore = false;
  _pagedRef = null;
  const input = $('#search-input');
  if (input) input.value = '';
  const clearBtn = $('#search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  const list = $('#history-list');
  if (list) { list.innerHTML = skeletonRows(list); list.scrollTop = 0; }
  const label = $('#history-branch-label');
  if (label) label.textContent = 'History';
  const tracking = $('#history-tracking');
  if (tracking) { tracking.hidden = true; tracking.innerHTML = ''; }
  const info = $('#commit-info');
  if (info) info.innerHTML = skeletonDetail();
  const changeset = $('#commit-changeset');
  if (changeset) changeset.innerHTML = '';
}

// Ghost rows to stand in for the commit list while it loads. Widths vary in a
// fixed pattern rather than randomly so the shimmer doesn't reshuffle on every
// repository switch.
function skeletonRows(list) {
  // The reset runs before the History view becomes the active one, so the
  // hidden list measures 0 — the window height is close enough, and a row or
  // two extra just scrolls out of sight.
  const count = Math.max(6, Math.ceil((list.clientHeight || window.innerHeight) / ROW_H));
  let html = '';
  for (let i = 0; i < count; i++) {
    const top = 30 + ((i * 17) % 25);
    const bottom = 55 + ((i * 29) % 35);
    html += `<div class="skeleton-row">
      <div class="skeleton-line" style="width:${top}%"></div>
      <div class="skeleton-line" style="width:${bottom}%"></div>
    </div>`;
  }
  return html;
}

// ...and the same for the detail pane, roughly the shape of the metadata table.
function skeletonDetail() {
  const widths = [45, 30, 45, 30, 25, 60, 60, 60];
  return `<div class="skeleton-detail">${
    widths.map(w => `<div class="skeleton-line" style="width:${w}%"></div>`).join('')
  }</div>`;
}

export async function refreshHistory(refresh, branchOverride) {
  _refresh = refresh;
  if ($('#search-input').value.trim()) return;
  const currentBranch = state.branchList.find(b => b.current);
  // Clicking a branch or tag is a request to see that ref, so it takes the
  // list back out of "all branches".
  if (branchOverride !== undefined && state.historyScope === 'all') {
    state.historyScope = 'branch';
    window.git.saveSettings({ historyScope: 'branch' });
    syncScopeButtons();
  }
  let branchName;
  if (branchOverride !== undefined) {
    state.selectedBranch = branchOverride;
    branchName = branchOverride;
  } else if (state.selectedBranch) {
    branchName = state.selectedBranch;
  } else if (currentBranch) {
    branchName = currentBranch.detached ? 'HEAD' : currentBranch.name;
  } else {
    branchName = null;
  }
  state.searching = false;
  const all = state.historyScope === 'all';
  // A new ref starts at the first page again; the same one keeps however deep
  // the list has already been scrolled.
  const key = refKey(branchName, all);
  if (key !== _pagedRef) { _depth = PAGE_SIZE; _atEnd = false; }
  _pagedRef = key;
  try {
    // Both in one round trip: the commits, and which of them no remote has.
    const [commits, unpushed] = await Promise.all([
      window.git.log(state.repoPath, all ? null : branchName, _depth, { all }),
      window.git.unpushed(state.repoPath, all ? null : branchName, { all }).catch(() => []),
    ]);
    state.commits = commits;
    _atEnd = commits.length < _depth;
    state.unpushed = new Set(unpushed);
    const displayLabel = currentBranch && currentBranch.detached && branchName === 'HEAD'
      ? `HEAD (${currentBranch.name})`
      : (branchName || 'History');
    $('#history-branch-label').textContent = all ? 'All branches' : displayLabel;
  } catch { state.commits = []; state.unpushed = new Set(); _atEnd = true; }
  // Across all branches there is no one branch the list is "about", so the
  // header falls back to reporting where HEAD stands.
  renderTracking(all ? null : branchName);
  renderCommitList(refresh);
}

// The line in the History header: what this branch tracks, and how far it has
// drifted from it.
function renderTracking(branchName) {
  const el = $('#history-tracking');
  if (!el) return;
  const t = branchName === null ? headTracking() : trackingFor(branchName);
  if (!t) { el.hidden = true; el.innerHTML = ''; return; }
  const upstream = t.upstream ? `<span class="track-upstream">${escapeHtml(t.upstream)}</span>` : '';
  el.innerHTML = upstream + trackingChips(t, { showSynced: true, showUnpublished: true });
  el.hidden = !el.innerHTML;
}

function renderCommitList(refresh) {
  const list = $('#history-list');
  // Every render rebuilds the rows, which would otherwise drop a scrolled list
  // back to the top — including the render that appends a freshly loaded page.
  const scrollTop = list.scrollTop;
  list.innerHTML = '';
  // Search results are matches scattered through history, not a contiguous
  // slice of it, so lanes drawn between two rows would connect commits that are
  // not actually adjacent. Rows keep their refs and their unpushed marker; only
  // the graph steps aside.
  const graph = state.searching ? null : buildGraph(state.commits);
  const laneCount = graph ? Math.min(graph.laneCount, MAX_LANES) : 0;
  const graphWidth = graph ? GRAPH_PAD * 2 + (laneCount - 1) * LANE_W : 0;

  state.commits.forEach((c, idx) => {
    const item = document.createElement('div');
    const unpushed = state.unpushed.has(c.hash);
    item.className = 'commit-item'
      + (state.selectedCommit === c.hash ? ' selected' : '')
      + (unpushed ? ' unpushed' : '');
    item.tabIndex = 0;
    if (unpushed) item.title = 'Not on any remote yet — a push would send this commit';
    const date = new Date(c.date).toLocaleDateString('en-CA');
    const row = graph ? graph.rows[idx] : null;
    item.innerHTML = `
      ${row ? graphSvg(row, graphWidth, unpushed) : ''}
      <div class="commit-body">
        <div class="commit-item-header">
          <span class="commit-author">${escapeHtml(c.author)}</span>
          <span class="commit-hash">${c.hash.substring(0, 7)}</span>
          ${unpushed ? '<span class="commit-local">local</span>' : ''}
          <span class="commit-date">${date}</span>
        </div>
        <div class="commit-subject-text">${refChips(c.refs)}${escapeHtml(c.subject)}</div>
      </div>
    `;
    item.addEventListener('click', () => selectCommit(c, refresh));
    item.addEventListener('keydown', (e) => {
      const items = list.querySelectorAll('.commit-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = items[idx + 1];
        // Arrowing off the bottom of the loaded pages asks for the next one,
        // the same as scrolling there would.
        if (next) { next.focus(); next.click(); } else loadMore();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = items[idx - 1];
        if (prev) { prev.focus(); prev.click(); }
      }
    });
    item.addEventListener('contextmenu', (e) => { e.preventDefault(); showCommitContextMenu(e, c, refresh); });
    list.appendChild(item);
    // Keep the keyboard on the selected row across re-renders, but never pull
    // focus out of whatever the user is actually using — a poll tick or the
    // auto-selection below must not steal the caret from the commit box.
    if (state.selectedCommit === c.hash && keyboardIsIdleIn(list)) {
      // preventScroll: holding on to focus should not also drag the viewport
      // back to the selected row while someone is scrolling further down.
      requestAnimationFrame(() => item.focus({ preventScroll: true }));
    }
  });
  list.scrollTop = scrollTop;
  ensureSelection(refresh);
}

// The branch and tag names sitting on a commit, as chips on the row itself —
// without them the only way to see where a branch points is to click every
// commit and read the detail pane.
function refChips(refs) {
  if (!refs || !refs.length) return '';
  return refs.map(r => `<span class="commit-ref ${r.type}">${escapeHtml(r.name)}</span>`).join('');
}

// ── The graph column ──
//
// Each row draws only its own slice: every line runs from the row's top edge to
// the node, or from the node to the bottom edge, so consecutive rows join into
// continuous lines without any row needing to know its neighbours.

function laneX(lane) {
  return GRAPH_PAD + Math.min(lane, MAX_LANES - 1) * LANE_W;
}

function segment(x1, y1, x2, y2) {
  if (x1 === x2) return `M${x1} ${y1}V${y2}`;
  // A vertical-tangent cubic, so a line leaves and arrives parallel to the
  // lanes it connects instead of cutting the corner diagonally.
  const mid = (y1 + y2) / 2;
  return `M${x1} ${y1}C${x1} ${mid},${x2} ${mid},${x2} ${y2}`;
}

function graphSvg(row, width, unpushed) {
  const mid = ROW_H / 2;
  const paths = [];
  row.top.forEach(e => paths.push(lanePath(segment(laneX(e.from), 0, laneX(e.to), mid), e.color)));
  row.bottom.forEach(e => paths.push(lanePath(segment(laneX(e.from), mid, laneX(e.to), ROW_H), e.color)));
  const cls = ['graph-node', `lane-${row.lane % LANE_COLORS}`];
  if (row.isMerge) cls.push('merge');
  // Hollow means "not on a remote": the commit exists here and nowhere else.
  if (unpushed) cls.push('unpushed');
  const node = `<circle cx="${laneX(row.lane)}" cy="${mid}" r="${row.isMerge ? 5 : 4.25}" class="${cls.join(' ')}"/>`;
  return `<svg class="commit-graph" width="${width}" height="${ROW_H}" `
    + `viewBox="0 0 ${width} ${ROW_H}" aria-hidden="true">${paths.join('')}${node}</svg>`;
}

function lanePath(d, color) {
  return `<path d="${d}" class="lane lane-${color % LANE_COLORS}"/>`;
}

function keyboardIsIdleIn(list) {
  const active = document.activeElement;
  return !active || active === document.body || list.contains(active);
}

// Opening History — or any list that arrives with nothing selected, such as
// after switching branches — should show a commit, not an empty detail pane.
// The first row is the newest commit, which is what you came to look at.
function ensureSelection(refresh) {
  if (state.commits.length === 0) {
    state.selectedCommit = null;
    $('#commit-info').innerHTML = '';
    $('#commit-changeset').innerHTML = '';
    return;
  }
  const stillListed = state.commits.some(c => c.hash === state.selectedCommit);
  // selectCommit() re-renders, and by then the selection is valid, so this
  // recurses exactly once.
  if (!stillListed) selectCommit(state.commits[0], refresh);
}

async function selectCommit(c, refresh) {
  state.selectedCommit = c.hash;
  renderCommitList(refresh);
  // Everything below arrives later. By then the user may have opened another
  // repository or clicked another commit, and this answer must not paint over
  // that one's.
  const repoPath = state.repoPath;
  const stale = () => state.repoPath !== repoPath || state.selectedCommit !== c.hash;
  try {
    const d = await window.git.commitDetail(repoPath, c.hash);
    if (stale()) return;
    const refsHtml = d.refs ? d.refs.split(',').map(r => {
      r = r.trim(); if (!r) return '';
      if (r.includes('HEAD')) return `<span class="commit-ref head">HEAD</span>`;
      if (r.includes('tag:')) return `<span class="commit-ref tag">${escapeHtml(r.replace('tag:','').trim())}</span>`;
      return `<span class="commit-ref branch">${escapeHtml(r)}</span>`;
    }).join(' ') : '';
    $('#commit-info').innerHTML = `
      <table>
        <tr><td>Author</td><td>${escapeHtml(d.author)} &lt;${escapeHtml(d.authorEmail)}&gt;</td></tr>
        <tr><td>Author Date</td><td>${d.authorDate}</td></tr>
        <tr><td>Committer</td><td>${escapeHtml(d.committer)} &lt;${escapeHtml(d.committerEmail)}&gt;</td></tr>
        <tr><td>Committer Date</td><td>${d.committerDate}</td></tr>
        <tr><td>Refs</td><td>${refsHtml || '—'}</td></tr>
        <tr><td>Commit Hash</td><td style="font-family:monospace">${d.hash}</td></tr>
        <tr><td>Parent Hash</td><td style="font-family:monospace">${d.parents || '—'}</td></tr>
        <tr><td>Tree Hash</td><td style="font-family:monospace">${d.tree || '—'}</td></tr>
      </table>
      <div class="commit-message">
        <div class="commit-message-subject">${escapeHtml(d.subject)}</div>
        ${d.body ? `<div class="commit-message-body">${escapeHtml(d.body)}</div>` : ''}
      </div>
    `;

    // Render changeset with expandable files
    const files = await window.git.commitFiles(repoPath, c.hash);
    if (stale()) return;
    renderChangeset($('#commit-changeset'), files,
      (f) => window.git.commitFileDiff(repoPath, c.hash, f.filePath));
  } catch (e) {
    if (stale()) return;
    $('#commit-info').innerHTML = `<div style="padding:16px;color:var(--red)">${escapeHtml(e.message)}</div>`;
  }
}
