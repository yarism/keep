import { $, $$, state, switchView, updateTitlebar, reconcileSelectedBranch, resetHeadTracking } from './modules/state.js';
import { setupRepoList, showRepoList } from './modules/repos.js';
import { setupContextMenu } from './modules/context-menu.js';
import { showModal, showConfirm, showSelect } from './modules/modal.js';
import { refreshStatus, setupCommitBox, setupOpBanner } from './modules/working-copy.js';
import { refreshHistory, setupHistorySearch, setupHistoryScope, setupHistoryPaging } from './modules/history.js';
import { setupPullRequests, loadPullRequests, syncPullRequestNav, resetPullRequests } from './modules/pull-requests.js';
import { setupSidebarResize, setupPanelResize, refreshBranches, refreshTags, refreshRemotes, refreshStashes } from './modules/sidebar.js';
import { initTheme, syncThemeFromSettings, setupThemePicker } from './modules/theme.js';
import { setupCollapsibleSections } from './modules/sections.js';
import { setupUpdates } from './modules/updates.js';
import { setupRelease } from './modules/release.js';
import { setupBuildWatch } from './modules/build-watch.js';
import { checkAccess } from './modules/access.js';
import { headTracking } from './modules/sync.js';
import { busyToast, toast } from './modules/toast.js';
import { describeResult } from './git-output.js';
import { hydrateIcons } from './icons.js';
import { createUnicodeToggle } from './modules/diff.js';

// Before anything renders: the stored theme, read synchronously, so the window
// never flashes the default palette on the way to the chosen one.
initTheme();
hydrateIcons();

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
    refreshTags(refresh),
    refreshRemotes(refresh),
    refreshStashes(),
  ]);
  // refreshRemotes has just settled state.remotes, which is what decides
  // whether this repository has pull requests at all.
  syncPullRequestNav();
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
  state.unpushed = new Set();
  // Stale remotes would put the previous repo's forge in this one's menus.
  state.remotes = [];
  resetPullRequests();
  state.searching = false;
  const name = path.split('/').pop();
  $('#repo-list-section').hidden = true;
  $('#workspace-nav').hidden = false;
  $('#breadcrumb-sep').hidden = false;
  $('#breadcrumb-repo').hidden = false;
  $('#breadcrumb-repo-name').textContent = name;
  $('#diff-filename').textContent = 'No file selected';
  $('#diff-content').innerHTML = '';
  $('#commit-subject').value = '';
  $$('#toolbar .toolbar-group button').forEach(b => b.disabled = false);
  switchView('working-copy');
  // So the next launch can come straight back here
  window.git.saveSettings({ lastRepo: path });
  // Before the refresh, so an unreadable folder explains itself rather than
  // rendering four empty panes and leaving the reason to guesswork.
  await checkAccess(path);
  await refresh();
  startPolling();
  startAutoFetch();
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
    // The release panel holds a command being edited, and then a command being
    // run. Neither wants the window redrawn underneath it.
    if (!$('#release-overlay').hidden) return;
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

// ── Fetching in the background ──
//
// Ahead/behind is only as truthful as the last fetch, and until now the only
// fetch was one you pressed a button for — so a branch could sit there claiming
// to be up to date for a week. This keeps the remote-tracking refs current on a
// timer. Nothing about the working copy is touched, so there is nothing to
// interrupt: the ref changes land in the fingerprint the poller already watches
// and the UI refreshes itself.
//
// Set `autoFetchMinutes` to 0 in settings.json to turn it off.
const DEFAULT_AUTO_FETCH_MINUTES = 10;
let _autoFetchMinutes = DEFAULT_AUTO_FETCH_MINUTES;
let _fetchTimer = null;
let _lastFetch = null;
let _fetching = false;

function startAutoFetch() {
  stopAutoFetch();
  if (!_autoFetchMinutes) return;
  // Once shortly after opening — the counts on screen when you sit down are the
  // ones most likely to be stale — and on the interval after that.
  setTimeout(autoFetch, 4000);
  _fetchTimer = setInterval(autoFetch, _autoFetchMinutes * 60 * 1000);
}

function stopAutoFetch() {
  if (_fetchTimer) { clearInterval(_fetchTimer); _fetchTimer = null; }
}

async function autoFetch() {
  if (!state.repoPath || _fetching) return;
  _fetching = true;
  try {
    const result = await window.git.fetchQuiet(state.repoPath);
    if (result.ok) _lastFetch = Date.now();
    describeLastFetch(result);
  } catch { /* a background job has nobody to tell */ }
  finally { _fetching = false; }
}

// The only visible trace: the Fetch button says when it last managed one.
function describeLastFetch(result) {
  const btn = $('#btn-fetch');
  if (!btn) return;
  if (result && !result.ok) {
    btn.title = 'Fetch — the last automatic fetch did not get through';
    return;
  }
  btn.title = _lastFetch ? `Fetch — last fetched ${ago(_lastFetch)}` : 'Fetch';
}

function ago(when) {
  const mins = Math.round((Date.now() - when) / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return 'a minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
}

// ── Navigation ──
function setupNavigation() {
  document.addEventListener('click', (e) => {
    const navItem = e.target.closest('.nav-item');
    if (!navItem || !state.repoPath) return;
    switchView(navItem.dataset.view);
    // The one view that costs a network request to fill, so it is filled on
    // arrival rather than on every poll tick.
    if (navItem.dataset.view === 'pull-requests') loadPullRequests();
  });
}

// ── Toolbar ──

// Every toolbar command runs through here so that all of them behave the same:
// the button shows it is working and refuses a second click, and the outcome —
// git's own words, or its error — always lands somewhere visible.
async function runAction(selector, label, work) {
  const btn = $(selector);
  if (btn.dataset.busy) return;
  btn.dataset.busy = '1';
  btn.classList.add('busy');
  const status = busyToast(`${label}\u2026`);
  try {
    const output = await work();
    await refresh();
    status.done(describeResult(label, output));
  } catch (e) {
    status.fail(e.message.trim() || `${label} failed`);
    // A merge or rebase that stops on a conflict *fails* — and leaves the repo
    // in a state the UI has to show. Refreshing only on success left the app
    // looking like nothing had happened until the next poll tick.
    await refresh();
  } finally {
    delete btn.dataset.busy;
    btn.classList.remove('busy');
  }
}

// Every branch the repo has is already known here, so "which branch?" is a
// choice to be picked rather than a name to be spelled correctly from memory.
// The branch you are on is left out: neither merge nor rebase can take it.
function otherBranches() {
  const current = state.branchList.find(b => b.current);
  return state.branchList
    .filter(b => !b.detached && b.name !== (current && current.name))
    .map(b => ({ value: b.name, label: b.name, group: b.isRemote ? 'Remote' : 'Local' }));
}

// The branch you are on is the other half of both operations, and each puts it
// on a different side: a merge brings the chosen branch *into* it, a rebase
// moves it *onto* the chosen one. Naming it in the title is what keeps those
// two apart. A detached HEAD has no name worth quoting, so it gets none.
function headName() {
  const current = state.branchList.find(b => b.current);
  return current && !current.detached ? current.name : null;
}

function setupToolbar() {
  $('#btn-fetch').addEventListener('click', () =>
    runAction('#btn-fetch', 'Fetch', async () => {
      const out = await window.git.fetch(state.repoPath);
      _lastFetch = Date.now();
      describeLastFetch(null);
      return out;
    }));
  $('#btn-pull').addEventListener('click', () =>
    runAction('#btn-pull', 'Pull', () => window.git.pull(state.repoPath)));
  $('#btn-push').addEventListener('click', async () => {
    // A branch with no upstream cannot simply be pushed: git refuses and prints
    // the --set-upstream incantation. Offer to do that instead of relaying the
    // refusal, since publishing the branch is plainly what was meant.
    const t = headTracking();
    if (t && !t.upstream) {
      const ok = await showConfirm('Publish Branch',
        `"${t.name}" is not on any remote yet.\n\nPush it and set it to track the remote branch?`);
      if (!ok) return;
      return runAction('#btn-push', 'Publish', () => window.git.push(state.repoPath, { setUpstream: true }));
    }
    runAction('#btn-push', 'Push', () => window.git.push(state.repoPath));
  });
  $('#btn-stash').addEventListener('click', async () => {
    const msg = await showModal('Save Stash', 'Stash message (optional)', '', { allowEmpty: true });
    if (msg === null) return;
    runAction('#btn-stash', 'Save Stash', () => window.git.stashSave(state.repoPath, msg));
  });
  $('#btn-stash-apply').addEventListener('click', async () => {
    try {
      const stashes = await window.git.stashes(state.repoPath);
      if (stashes.length === 0) { toast('No stashes to apply', { type: 'info' }); return; }
      const choice = await showSelect('Apply Stash',
        stashes.map((s, i) => ({ value: String(i), label: s.message })));
      if (choice === null) return;
      await runAction('#btn-stash-apply', 'Apply Stash',
        () => window.git.stashApply(state.repoPath, parseInt(choice, 10)));
    } catch (e) { toast(e.message, { type: 'error' }); }
  });
  $('#btn-merge').addEventListener('click', async () => {
    const options = otherBranches();
    if (options.length === 0) { toast('No other branch to merge', { type: 'info' }); return; }
    const head = headName();
    const name = await showSelect(head ? `Merge into "${head}"` : 'Merge', options);
    if (!name) return;
    runAction('#btn-merge', 'Merge', () => window.git.merge(state.repoPath, name));
  });
  $('#btn-rebase').addEventListener('click', async () => {
    const options = otherBranches();
    if (options.length === 0) { toast('No other branch to rebase onto', { type: 'info' }); return; }
    const head = headName();
    const name = await showSelect(head ? `Rebase "${head}" onto` : 'Rebase', options);
    if (!name) return;
    runAction('#btn-rebase', 'Rebase', () => window.git.rebase(state.repoPath, name));
  });
}

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  hydrateIcons();
  setupThemePicker();
  state.repositories = await window.git.loadRepos();
  const settings = await window.git.loadSettings();
  // Minutes between background fetches; 0 turns them off entirely.
  const configured = Number(settings.autoFetchMinutes);
  _autoFetchMinutes = Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_AUTO_FETCH_MINUTES;
  syncThemeFromSettings(settings);
  if (settings.sidebarWidth) {
    $('#sidebar').style.width = settings.sidebarWidth + 'px';
  }
  if (settings.wcFilesWidth) {
    $('#wc-files-panel').style.width = settings.wcFilesWidth + 'px';
  }
  if (settings.historyListWidth) {
    $('#history-list-panel').style.width = settings.historyListWidth + 'px';
  }
  if (settings.prListWidth) {
    $('#pr-list-panel').style.width = settings.prListWidth + 'px';
  }
  setupCollapsibleSections(settings);
  setupSidebarResize();
  setupPanelResize('wc-resize', 'wc-files-panel', 'wcFilesWidth', { minWidth: 220, maxWidth: 600 });
  setupPanelResize('history-resize', 'history-list-panel', 'historyListWidth', { minWidth: 300, maxWidth: 800 });
  setupPanelResize('pr-resize', 'pr-list-panel', 'prListWidth', { minWidth: 260, maxWidth: 800 });
  setupRepoList(enterWorkspace);
  setupNavigation();
  setupToolbar();
  setupContextMenu();
  setupUpdates();
  setupRelease(refresh);
  setupBuildWatch(settings);
  setupCommitBox(refresh);
  setupOpBanner(refresh);
  setupHistorySearch(refresh);
  setupHistoryPaging(refresh);
  setupHistoryScope(refresh, settings);
  setupPullRequests();
  $('#wc-diff-panel .panel-header').appendChild(createUnicodeToggle($('#diff-content')));
  await restoreLastRepo(settings);
});

// Reopen whatever repository the app was last left in. It has to still be in
// the list and still be a working copy — a folder can be moved or deleted
// between launches, and falling back to the repository list beats opening a
// workspace onto nothing.
async function restoreLastRepo(settings) {
  const last = settings.lastRepo;
  if (last && state.repositories.some(r => r.path === last)) {
    let ok = false;
    try { ok = await window.git.isRepo(last); } catch {}
    if (ok) { await enterWorkspace(last); return; }
    // Fall back to the list, but say why: a repository Keep is not allowed to
    // read looks exactly like one that was moved or deleted.
    showRepoList();
    await checkAccess(last);
    return;
  }
  showRepoList();
}
