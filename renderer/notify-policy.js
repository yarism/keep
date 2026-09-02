// Which events earn an OS notification, and the words on it.
//
// The rule has two halves. While the window is front, the toasts, badges and
// cards say everything, so a notification only ever describes what finished
// while you were somewhere else: that half is enforced in the main process, at
// show time, against the real focus state. This half decides what is worth
// saying at all, and is pure so the decisions can be tested without a window.
//
// The repository's name rides on every title: the app's own name and icon are
// on the notification already, but which repository it is about is not, and a
// build notice can arrive ten minutes after you switched to another one.

// Toolbar actions worth hearing about from another window. Fetch is left out
// on purpose: the background fetch is silent by design, and a fetch that found
// something new speaks through the behind notice instead. The others missing
// here (merge, rebase, stashes) are local and quick, over before anyone has
// had time to switch away.
const NOTIFYING_ACTIONS = new Set(['Pull', 'Push', 'Publish']);

const withRepo = (title, repoName) => (repoName ? `${title} - ${repoName}` : title);

export function actionNotice(label, ok, message, repoName) {
  if (!NOTIFYING_ACTIONS.has(label)) return null;
  return {
    title: withRepo(`${label} ${ok ? 'finished' : 'failed'}`, repoName),
    body: String(message || ''),
  };
}

// One notice per fall behind: the first new commits are news, the ones piling
// on after them are not. Catching up (behind back at zero) arms the next one.
// An unknown previous count stays silent: the first read after opening a repo
// or switching branches is the badge's moment, not a notification's.
export function behindTransition(prev, next) {
  return prev === 0 && next > 0;
}

export function behindNotice(tracking, repoName) {
  const count = tracking.behind === 1 ? '1 commit' : `${tracking.behind} commits`;
  return {
    title: withRepo(`New commits on ${tracking.upstream}`, repoName),
    body: `${tracking.name} is now ${count} behind.`,
  };
}

// The build card's own words, relayed. Only a settled answer is worth one:
// waiting and running are what the card is for, and "unknown" means the build
// could not be read about, not that it failed.
export function buildNotice(described, repoName) {
  if (described.state !== 'done' && described.state !== 'failed') return null;
  return { title: withRepo(described.title, repoName), body: described.detail || '' };
}

export function releaseNotice(ok, message, repoName) {
  return {
    title: withRepo(ok ? 'Release finished' : 'Release failed', repoName),
    body: String(message || ''),
  };
}
