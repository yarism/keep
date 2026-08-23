// Shared application state and DOM helpers
export const state = {
  repoPath: null,
  currentView: 'welcome',
  selectedFile: null,
  selectedCommit: null,
  selectedBranch: null,
  statusFiles: [],
  commits: [],
  branchList: [],
  tagList: [],
  repositories: [],
};

export const $ = (s) => document.querySelector(s);
export const $$ = (s) => document.querySelectorAll(s);

export function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const viewLabels = {
  'working-copy': 'Working Copy',
  'history': 'History',
  'stashes': 'Stashes',
  'settings': 'Settings',
};

export function updateTitlebar() {
  const titleEl = $('#titlebar-title');
  const textEl = $('#titlebar-title-text');
  const iconEl = titleEl ? titleEl.querySelector('.titlebar-title-icon') : null;
  if (!titleEl || !textEl) return;
  titleEl.hidden = false;

  if (!state.repoPath) {
    if (iconEl) iconEl.style.display = 'none';
    textEl.textContent = 'Repositories';
    return;
  }

  if (iconEl) iconEl.style.display = '';
  const repoName = state.repoPath.split('/').pop();
  const viewLabel = viewLabels[state.currentView] || state.currentView;
  const currentBranch = state.branchList.find(b => b.current);
  const branchName = currentBranch
    ? (currentBranch.detached ? `${currentBranch.name} (detached)` : currentBranch.name)
    : '';

  let detail = branchName;
  if (state.currentView === 'working-copy' && state.statusFiles.length > 0) {
    detail += ` \u2013 ${state.statusFiles.length} Changed File${state.statusFiles.length !== 1 ? 's' : ''}`;
  } else if (state.currentView === 'history' && state.commits.length > 0) {
    detail += ` (${state.commits.length} Commits)`;
  }

  textEl.textContent = `${repoName} \u2013 ${viewLabel} (${detail})`;
}

// The branch we last saw HEAD pointing at. Clicking a branch or tag in the sidebar pins
// history to it via state.selectedBranch, and that pin used to survive forever —
// so after a checkout (in the app or in a terminal) history kept rendering the
// old branch and only re-opening the repo would clear it. Comparing HEAD against
// this lets us drop the pin exactly when HEAD moves somewhere else.
let _lastHeadBranch = null;

export function resetHeadTracking() {
  _lastHeadBranch = null;
}

// Call after branchList is refreshed, before history renders.
export function reconcileSelectedBranch() {
  const current = state.branchList.find(b => b.current);
  const headName = current ? current.name : null;

  if (state.selectedBranch) {
    // The pin can be a branch or a tag; a tag is not in branchList, so checking
    // only branches here would clear a pinned tag on the very next poll tick.
    const stillExists = state.branchList.some(b => b.name === state.selectedBranch)
      || state.tagList.includes(state.selectedBranch);
    const headMovedElsewhere = headName !== _lastHeadBranch && state.selectedBranch !== headName;
    // Drop the pin if its branch is gone (deleted/renamed) or HEAD checked out
    // something else — in both cases history should follow HEAD again.
    if (!stillExists || headMovedElsewhere) state.selectedBranch = null;
  }

  _lastHeadBranch = headName;
}

export function switchView(view) {
  state.currentView = view;
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  $$('.view').forEach(v => v.classList.remove('active'));
  const el = $(`#${view}-view`);
  if (el) el.classList.add('active');
  const searchBar = $('#history-search-bar');
  if (searchBar) searchBar.hidden = (view !== 'history');
  updateTitlebar();
}
