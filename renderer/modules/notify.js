// The renderer's side of OS notifications: what just happened, handed to the
// main process, which decides whether anyone is away and needs telling.
// notify-policy.js holds the wording and the rules; this holds the state that
// has to live somewhere, and the off switch.
//
// Set `notifications` to false in settings.json to turn all of it off.

import { state } from './state.js';
import { headTracking } from './sync.js';
import {
  actionNotice, behindTransition, behindNotice, buildNotice, releaseNotice,
} from '../notify-policy.js';

let enabled = true;

export function setupNotifications(settings) {
  enabled = !settings || settings.notifications !== false;
}

function show(notice) {
  if (!enabled || !notice) return;
  try { window.notify.show(notice); }
  catch { /* a notification is a courtesy, not a result */ }
}

const repoName = () => (state.repoPath ? state.repoPath.split('/').pop() : null);

export function notifyAction(label, ok, message) {
  show(actionNotice(label, ok, message, repoName()));
}

export function notifyBuild(described, name) {
  show(buildNotice(described, name));
}

export function notifyRelease(ok, message, name) {
  show(releaseNotice(ok, message, name));
}

// The behind count as it stood when last looked at, per branch, so a count
// that keeps growing does not keep notifying. In memory only: after a relaunch
// the first read lands in the unknown case and stays silent, which is right,
// since by then the badges are on screen saying the same thing.
const lastBehind = new Map();

export function checkBehindUpstream() {
  if (!state.repoPath) return;
  const t = headTracking();
  if (!t || !t.upstream || t.gone) return;
  const key = [state.repoPath, t.name, t.upstream].join('\n');
  const prev = lastBehind.get(key);
  lastBehind.set(key, t.behind);
  if (behindTransition(prev, t.behind)) show(behindNotice(t, repoName()));
}
