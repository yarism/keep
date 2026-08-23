import { $, escapeHtml, state } from './state.js';
import { renderDiff } from './diff.js';
import { showCommitContextMenu } from './context-menu.js';
import { icon } from '../icons.js';
import { buildGraph } from '../graph.js';
import { trackingFor, trackingChips } from './sync.js';

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

export function setupHistorySearch(refresh) {
  _refresh = refresh;
  const input = $('#search-input');
  const field = $('#search-field');
  const clearBtn = $('#search-clear');

  input.addEventListener('input', () => {
    clearBtn.style.display = input.value ? 'block' : 'none';
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
  const branchName = (state.branchList.find(b => b.current) || {}).name || null;
  state.searching = true;
  try {
    state.commits = await window.git.searchLog(state.repoPath, query, field, branchName, 200);
    console.log('[search] found', state.commits.length, 'commits for', field, ':', query);
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

export async function refreshHistory(refresh, branchOverride) {
  _refresh = refresh;
  if ($('#search-input').value.trim()) return;
  const currentBranch = state.branchList.find(b => b.current);
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
  try {
    // Both in one round trip: the commits, and which of them no remote has.
    const [commits, unpushed] = await Promise.all([
      window.git.log(state.repoPath, branchName, 200),
      window.git.unpushed(state.repoPath, branchName).catch(() => []),
    ]);
    state.commits = commits;
    state.unpushed = new Set(unpushed);
    const displayLabel = currentBranch && currentBranch.detached && branchName === 'HEAD'
      ? `HEAD (${currentBranch.name})`
      : (branchName || 'History');
    $('#history-branch-label').textContent = displayLabel;
  } catch { state.commits = []; state.unpushed = new Set(); }
  renderTracking(branchName);
  renderCommitList(refresh);
}

// The line in the History header: what this branch tracks, and how far it has
// drifted from it.
function renderTracking(branchName) {
  const el = $('#history-tracking');
  if (!el) return;
  const t = trackingFor(branchName);
  if (!t) { el.hidden = true; el.innerHTML = ''; return; }
  const upstream = t.upstream ? `<span class="track-upstream">${escapeHtml(t.upstream)}</span>` : '';
  el.innerHTML = upstream + trackingChips(t, { showSynced: true });
  el.hidden = !el.innerHTML;
}

function renderCommitList(refresh) {
  const list = $('#history-list');
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
        if (next) { next.focus(); next.click(); }
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
      requestAnimationFrame(() => item.focus());
    }
  });
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
  try {
    const d = await window.git.commitDetail(state.repoPath, c.hash);
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
      <div style="margin-top:12px;font-size:var(--fs-xl);font-weight:600">${escapeHtml(d.subject)}</div>
    `;

    // Render changeset with expandable files
    const files = await window.git.commitFiles(state.repoPath, c.hash);
    renderChangeset(c.hash, files);
  } catch (e) {
    $('#commit-info').innerHTML = `<div style="padding:16px;color:var(--red)">${escapeHtml(e.message)}</div>`;
  }
}

function renderChangeset(hash, files) {
  const container = $('#commit-changeset');
  container.innerHTML = '';

  const adds = files.filter(f => f.status === 'added').length;
  const dels = files.filter(f => f.status === 'deleted').length;
  const mods = files.length - adds - dels;
  const summary = document.createElement('div');
  summary.className = 'changeset-summary';
  const parts = [];
  if (mods) parts.push(`${mods} modified`);
  if (adds) parts.push(`${adds} added`);
  if (dels) parts.push(`${dels} deleted`);
  summary.textContent = `${files.length} changed file${files.length !== 1 ? 's' : ''} (${parts.join(', ')})`;
  container.appendChild(summary);

  files.forEach(f => {
    const fileEl = document.createElement('div');
    fileEl.className = 'changeset-file';

    const header = document.createElement('div');
    header.className = 'changeset-file-header';
    const statusLabel = f.statusCode;
    header.innerHTML = `
      <span class="expand-arrow">${icon('chevron', 12)}</span>
      <span class="file-status ${f.status}">${statusLabel}</span>
      <span class="file-name">${escapeHtml(f.filePath.split('/').pop())}</span>
      <span class="file-path">${escapeHtml(f.filePath.includes('/') ? f.filePath.substring(0, f.filePath.lastIndexOf('/')) : '')}</span>
    `;

    const diffContainer = document.createElement('div');
    diffContainer.className = 'changeset-file-diff';
    let loaded = false;

    header.addEventListener('click', async () => {
      const arrow = header.querySelector('.expand-arrow');
      const isOpen = diffContainer.style.display === 'block';
      if (isOpen) {
        diffContainer.style.display = 'none';
        arrow.classList.remove('open');
      } else {
        if (!loaded) {
          try {
            const diff = await window.git.commitFileDiff(state.repoPath, hash, f.filePath);
            renderDiff(diff, diffContainer, null);
            loaded = true;
          } catch (e) {
            diffContainer.innerHTML = `<div style="padding:8px 16px;color:var(--red)">${escapeHtml(e.message)}</div>`;
          }
        }
        diffContainer.style.display = 'block';
        arrow.classList.add('open');
      }
    });

    fileEl.appendChild(header);
    fileEl.appendChild(diffContainer);
    container.appendChild(fileEl);
  });
}
