// The card in the bottom-left corner that watches a release get built.
//
// Pushing the tag takes half a minute; what follows takes ten. The half minute
// was never the part worth watching — "is it out?" is answered by a workflow
// run on GitHub, and until now the only way to see it was to go and look. This
// asks on a timer and says what it finds.
//
// It sits opposite the toasts on purpose. A toast is something that has
// happened and will stop being interesting; this is something still happening,
// and it stays until it is over or dismissed.
//
// The watch outlives the panel that started it, the repository being looked at,
// and — since a build is long enough to quit an app in the middle of — the
// session itself: it is written to settings and picked up again at launch.

import { $ } from './state.js';
import { icon } from '../icons.js';
import {
  describeBuild, isFinished, elapsed, pollInterval, explainCallFailure, GIVE_UP_MS,
} from '../build-status.js';

// A watch older than this is not resumed. A build takes minutes; anything still
// unfinished hours later was abandoned, and reviving it at launch would put a
// spinner on screen for a release that shipped or died long ago.
const STALE_MS = 3 * 60 * 60 * 1000;

let watch = null;      // { repoPath, repoName, tag, forge, startedAt }
let timer = null;
let clock = null;
let lastRun = null;
let authenticated = false;

export function setupBuildWatch(settings) {
  $('#build-dismiss').addEventListener('click', stop);
  $('#build-open').addEventListener('click', openOnGitHub);

  const saved = settings && settings.buildWatch;
  if (saved && (saved.tag || saved.sha) && saved.repoPath && Date.now() - (saved.startedAt || 0) < STALE_MS) {
    begin(saved, { remember: false });
  }
}

// Started by the Release panel when a run leaves a tag behind, and by the
// context menus for any tag or pushed commit. Only GitHub is asked about
// builds; everything else has nothing to answer with.
//
// `label` is what the card calls it — the tag, or a short hash — and `kind`
// decides what success means: a tag cuts a release, a commit leaves artifacts.
//
// A ref whose tree has no workflow files cannot set off a run at all, since
// GitHub only files push builds for refs that carry the workflow themselves.
// The repository knows this before GitHub is ever asked, and the two callers
// want it told differently: the release panel simply keeps its card-free
// ending, while a menu item that was clicked owes an answer (that is `asked`),
// because silence after a click reads as a broken menu, not an absent build.
export async function watchBuild({ repoPath, repoName, tag = null, sha = null, forge, asked = false }) {
  if (!forge || forge.kind !== 'github' || (!tag && !sha)) return false;
  const next = {
    repoPath,
    repoName,
    tag,
    sha,
    label: tag || String(sha).slice(0, 7),
    kind: tag ? 'tag' : 'commit',
    forge,
    startedAt: Date.now(),
  };

  if (!(await hasWorkflows(repoPath, tag ? `refs/tags/${tag}` : sha))) {
    if (asked) answerNothingToWatch(next);
    return false;
  }

  begin(next, { remember: true });
  return true;
}

// Fail open: a check that cannot be run should fall back to asking GitHub the
// way the card always has, not quietly suppress it.
async function hasWorkflows(repoPath, ref) {
  try { return await window.git.hasWorkflows(repoPath, ref); }
  catch { return true; }
}

// The card, already settled: no timers, nothing remembered, just the answer.
// The open button still leads somewhere useful, since with no run to point at
// it falls back to the Actions page, which is where a workflow would be added.
function answerNothingToWatch(next) {
  clearTimers();
  watch = { ...next, forge: next.forge || null };
  lastRun = null;
  authenticated = false;
  save(null);
  render({
    state: 'unknown',
    title: `${next.label} · no build`,
    detail: 'It has no workflow files, so GitHub will not build it.',
  });
  $('#build-card').hidden = false;
}

function begin(next, { remember }) {
  clearTimers();
  watch = { ...next, forge: next.forge || null };
  lastRun = null;
  authenticated = false;
  if (remember) save(watch);
  render(describeBuild(null, described()));
  $('#build-card').hidden = false;
  clock = setInterval(tickClock, 1000);
  poll();
}

async function poll() {
  if (!watch) return;
  let result;
  try {
    result = await window.git.workflowRun(watch.repoPath, watch.forge, { tag: watch.tag, sha: watch.sha });
  } catch (e) {
    result = { ok: false, message: explainCallFailure(e.message) };
  }
  if (!watch) return;

  if (!result.ok) {
    // A build that cannot be read about is not a build that failed, and saying
    // so is the difference between going to look and going to fix.
    render({ state: 'unknown', title: `${watch.label} · not visible`, detail: result.message });
    settle();
    return;
  }

  authenticated = Boolean(result.authenticated);
  lastRun = result.run;
  const shown = describeBuild(result.run, described());

  // A tag pushed to a repository whose workflow ignores tags would wait for a
  // run that is never filed. Say so rather than spinning all afternoon.
  if (!result.run && Date.now() - watch.startedAt > GIVE_UP_MS) {
    render({
      state: 'unknown',
      title: `${watch.label} · no build`,
      detail: 'Nothing was filed for it after five minutes.',
    });
    settle();
    return;
  }

  render(shown);
  if (isFinished(shown)) { settle(); return; }
  timer = setTimeout(poll, pollInterval(authenticated));
}

// Done asking, but not done showing: the answer is the thing the person walked
// away to find out, so it stays until they dismiss it.
function settle() {
  clearInterval(clock); clock = null;
  clearTimeout(timer); timer = null;
  save(null);
}

// What describeBuild needs to know about the thing being watched.
const described = () => ({ label: watch.label, kind: watch.kind });

function tickClock() {
  if (!watch) return;
  $('#build-elapsed').textContent = elapsed(watch.startedAt, Date.now());
}

function render(described) {
  const card = $('#build-card');
  card.dataset.state = described.state;
  $('#build-mark').innerHTML = MARKS[described.state] || MARKS.running;
  $('#build-title').textContent = described.title;
  $('#build-detail').textContent = described.detail;
  $('#build-elapsed').textContent = elapsed(watch.startedAt, Date.now());
  $('#build-open').title = openUrl() ? 'Show it on GitHub' : described.detail;
}

const MARKS = {
  waiting: '<span class="spinner"></span>',
  running: '<span class="spinner"></span>',
  done: icon('check', 15),
  failed: icon('alert', 15),
  unknown: icon('alert', 15),
};

// A finished build is worth opening at its release; an unfinished one at the
// run, where the log is.
function openUrl() {
  if (!watch) return null;
  const base = watch.forge && watch.forge.base;
  const released = watch.kind === 'tag' && lastRun
    && lastRun.status === 'completed' && lastRun.conclusion === 'success';
  if (released && base) return `${base}/releases/tag/${encodeURIComponent(watch.tag)}`;
  if (lastRun && lastRun.url) return lastRun.url;
  return base ? `${base}/actions` : null;
}

function openOnGitHub() {
  const url = openUrl();
  if (url) window.git.openExternal(url);
}

function stop() {
  clearTimers();
  watch = null;
  lastRun = null;
  $('#build-card').hidden = true;
  save(null);
}

function clearTimers() {
  clearTimeout(timer); timer = null;
  clearInterval(clock); clock = null;
}

function save(w) {
  const value = w
    ? {
      repoPath: w.repoPath, repoName: w.repoName, tag: w.tag, sha: w.sha,
      label: w.label, kind: w.kind, forge: w.forge, startedAt: w.startedAt,
    }
    : null;
  try { window.git.saveSettings({ buildWatch: value }); } catch { /* a resumed watch is a convenience */ }
}
