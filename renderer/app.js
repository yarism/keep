import { $, $$, state, switchView, updateTitlebar, reconcileSelectedBranch, resetHeadTracking } from './modules/state.js';
import { setupRepoList, showRepoList } from './modules/repos.js';
import { setupContextMenu } from './modules/context-menu.js';
import { showModal } from './modules/modal.js';
import { refreshStatus, setupCommitBox } from './modules/working-copy.js';
import { refreshHistory, setupHistorySearch } from './modules/history.js';
import { setupSidebarResize, refreshBranches, refreshTags, refreshRemotes, refreshStashes } from './modules/sidebar.js';

// ── Refresh all data ──
async function refresh() {
  if (!state.repoPath) return;
  // Branches must load first since remotes and history depend on branchList
  await refreshBranches(refresh);
  // ...and the pin must be settled before history decides what to render
  reconcileSelectedBranch();
  await Promise.all([
    refreshStatus(),
    refreshHistory(refresh),
    refreshTags(),
    refreshRemotes(refresh),
    refreshStashes(),
  ]);
  updateTitlebar();
  // Re-baseline so our own writes don't read as an external change next tick
  await captureFingerprint();
}

// ── Enter workspace mode ──
let _pollTimer = null;

async function enterWorkspace(path) {
  state.repoPath = path;
  state.selectedBranch = null;
  resetHeadTracking();
  _lastFingerprint = null;
  state.selectedFile = null;
  state.selectedCommit = null;
  const name = path.split('/').pop();
  $('#repo-list-section').hidden = true;
  $('#workspace-nav').hidden = false;
  $('#breadcrumb-sep').hidden = false;
  $('#breadcrumb-repo').hidden = false;
  $('#breadcrumb-repo-name').textContent = name;
  $('#diff-filename').textContent = 'No file selected';
  $('#diff-content').innerHTML = '';
  $('#commit-subject').value = '';
  $$('#toolbar button').forEach(b => b.disabled = false);
  switchView('working-copy');
  await refresh();
  startPolling();
}

let _lastFingerprint = null;
let _polling = false;

async function captureFingerprint() {
  try {
    const fp = await window.git.repoFingerprint(state.repoPath);
    _lastFingerprint = fp.fingerprint;
  } catch { _lastFingerprint = null; }
}

function startPolling() {
  stopPolling();
  _pollTimer = setInterval(async () => {
    if (!state.repoPath) return;
    // Don't refresh while user is typing a commit message or a modal is open
    if (document.activeElement && document.activeElement.id === 'commit-subject') return;
    if (!$('#modal-overlay').hidden) return;
    // A slow refresh must not stack up behind the next tick
    if (_polling) return;
    _polling = true;
    try {
      // The working copy changes on every keystroke in an editor, so it always
      // gets refreshed. HEAD and the refs only move on an actual git operation —
      // when they do, everything else (sidebar, history, tags, stashes) is stale
      // too and needs the full refresh, which is what used to be missing here.
      let fp = null;
      try { fp = await window.git.repoFingerprint(state.repoPath); } catch {}
      if (fp && _lastFingerprint !== null && fp.fingerprint !== _lastFingerprint) {
        await refresh();
      } else {
        if (fp) _lastFingerprint = fp.fingerprint;
        await refreshStatus();
        updateTitlebar();
      }
    } finally {
      _polling = false;
    }
  }, 3000);
}

function stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

// ── Navigation ──
function setupNavigation() {
  document.addEventListener('click', (e) => {
    const navItem = e.target.closest('.nav-item');
    if (!navItem || !state.repoPath) return;
    switchView(navItem.dataset.view);
  });
}

// ── Toolbar ──
function setupToolbar() {
  $('#btn-fetch').addEventListener('click', async () => {
    try { await window.git.fetch(state.repoPath); await refresh(); } catch (e) { alert(e.message); }
  });
  $('#btn-pull').addEventListener('click', async () => {
    try { await window.git.pull(state.repoPath); await refresh(); } catch (e) { alert(e.message); }
  });
  $('#btn-push').addEventListener('click', async () => {
    try { await window.git.push(state.repoPath); await refresh(); } catch (e) { alert(e.message); }
  });
  $('#btn-stash').addEventListener('click', async () => {
    const msg = await showModal('Save Stash', 'Stash message (optional)', '', { allowEmpty: true });
    if (msg === null) return;
    try { await window.git.stashSave(state.repoPath, msg); await refresh(); } catch (e) { alert(e.message); }
  });
  $('#btn-stash-apply').addEventListener('click', async () => {
    try {
      const stashes = await window.git.stashes(state.repoPath);
      if (stashes.length === 0) { alert('No stashes to apply.'); return; }
      // Build a simple picker using the modal with a select
      const overlay = $('#modal-overlay');
      const modal = overlay.querySelector('.modal');
      $('#modal-title').textContent = 'Apply Stash';
      // Replace input with a select temporarily
      const input = $('#modal-input');
      const select = document.createElement('select');
      select.id = 'stash-select';
      select.className = input.className;
      select.style.cssText = input.style.cssText;
      stashes.forEach((s, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = s.message;
        select.appendChild(opt);
      });
      input.style.display = 'none';
      input.parentNode.insertBefore(select, input);
      overlay.hidden = false;
      select.focus();

      await new Promise(resolve => {
        function cleanup() {
          overlay.hidden = true;
          select.remove();
          input.style.display = '';
          $('#modal-ok').removeEventListener('click', onOk);
          $('#modal-cancel').removeEventListener('click', onCancel);
          select.removeEventListener('keydown', onKey);
        }
        async function onOk() {
          const idx = parseInt(select.value);
          cleanup();
          try { await window.git.stashApply(state.repoPath, idx); await refresh(); }
          catch (err) { alert(err.message); }
          resolve();
        }
        function onCancel() { cleanup(); resolve(); }
        function onKey(e) { if (e.key === 'Enter') onOk(); if (e.key === 'Escape') onCancel(); }
        $('#modal-ok').addEventListener('click', onOk);
        $('#modal-cancel').addEventListener('click', onCancel);
        select.addEventListener('keydown', onKey);
      });
    } catch (e) { alert(e.message); }
  });
  $('#btn-merge').addEventListener('click', async () => {
    const name = await showModal('Merge', 'Branch name to merge into current');
    if (!name) return;
    try { await window.git.merge(state.repoPath, name); await refresh(); } catch (e) { alert(e.message); }
  });
  $('#btn-rebase').addEventListener('click', async () => {
    const name = await showModal('Rebase', 'Branch name to rebase onto');
    if (!name) return;
    try { await window.git.rebase(state.repoPath, name); await refresh(); } catch (e) { alert(e.message); }
  });
}

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  state.repositories = await window.git.loadRepos();
  const settings = await window.git.loadSettings();
  if (settings.sidebarWidth) {
    $('#sidebar').style.width = settings.sidebarWidth + 'px';
  }
  setupSidebarResize();
  setupRepoList(enterWorkspace);
  setupNavigation();
  setupToolbar();
  setupContextMenu();
  setupCommitBox(refresh);
  setupHistorySearch(refresh);
  showRepoList();
});
