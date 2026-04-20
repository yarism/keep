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
  repositories: [],
};

export const $ = (s) => document.querySelector(s);
export const $$ = (s) => document.querySelectorAll(s);

export function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function switchView(view) {
  state.currentView = view;
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  $$('.view').forEach(v => v.classList.remove('active'));
  const el = $(`#${view}-view`);
  if (el) el.classList.add('active');
  // Show search bar only on history view
  const searchBar = $('#history-search-bar');
  if (searchBar) searchBar.hidden = (view !== 'history');
}
