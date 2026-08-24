// The update banner, and the toast a manual check gets back.
//
// All of the wording lives in update-view.js; this file is the wiring — which
// element each field lands in, and the one piece of state the description
// cannot know: whether the banner was dismissed.

import { $ } from './state.js';
import { toast } from './toast.js';
import { describeUpdate } from '../update-view.js';

// Dismissal is per status, not permanent. Waving away a download in progress
// should not also hide the "ready to install" line it turns into.
let dismissedAt = null;
let lastStatus = null;

function hide() {
  $('#update-banner').hidden = true;
}

function paint(banner) {
  const el = $('#update-banner');
  const progress = $('#update-banner-progress');
  const restart = $('#update-restart');

  el.hidden = false;
  $('#update-banner-text').textContent = banner.text;

  const hasPercent = Number.isFinite(banner.percent);
  progress.hidden = !hasPercent;
  if (hasPercent) $('#update-banner-bar').style.width = `${banner.percent}%`;

  restart.hidden = !banner.restart;
}

function render(state) {
  const { banner, toast: message } = describeUpdate(state);

  // A repeat of the same status is the same answer; only a new one clears the
  // dismissal or is worth another toast.
  const changed = state.status !== lastStatus;
  lastStatus = state.status;
  if (changed && state.status !== dismissedAt) dismissedAt = null;

  if (message && changed) toast(message.text, { type: message.type, prose: true });

  if (!banner || state.status === dismissedAt) hide();
  else paint(banner);
}

export function setupUpdates() {
  // Absent when the page is opened outside Electron; the rest of the app is
  // equally dependent on preload, but there is no reason to throw from here.
  if (!window.updates) return;

  $('#update-dismiss').addEventListener('click', () => {
    dismissedAt = lastStatus;
    hide();
  });
  $('#update-restart').addEventListener('click', () => window.updates.install());

  window.updates.onState(render);
  // The launch check can finish before this module runs, so start from whatever
  // main already knows rather than waiting for the next event.
  window.updates.state().then(render);
}
