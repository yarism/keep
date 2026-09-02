// The Release panel.
//
// Cutting a release is one command typed in a terminal, and the reason it is
// worth a panel is not the typing — it is everything around it. The command is
// different in every repository, the number it produces is easy to get wrong by
// hand, it refuses to run against a dirty working copy, and it takes as long as
// the test suite does while printing the only evidence that it is working at
// all. So the panel shows the command it is about to run before running it,
// counts the next version itself, and puts the output on screen as it arrives.
//
// It happens in two rooms. Setting a release up is a modal: three bump choices
// and a command line are a question, and a question is fine to answer before
// anything else moves. Running it is not. The modal closes and the command
// runs in a terminal rising over the bottom of the list column, the way an
// IDE raises one, so the half minute of npm test is something the window
// shows rather than something it is locked behind. Only that column: the
// detail pane keeps its full height, and the window never feels taken over.
//
// Nothing here decides what a release *is*: release-plan.js suggests, the
// field below it is editable, and what the user leaves in that field is
// remembered per repository. Keep's opinion is a starting point, not a rule.

import { $, state, escapeHtml } from './state.js';
import { toast } from './toast.js';
import { notifyRelease } from './notify.js';
import { icon } from '../icons.js';
import { forgeForBranch, releasesUrl } from './forge.js';
import { watchBuild } from './build-watch.js';
import {
  BUMPS, BUMP_MEANING, nextVersion, isSemver, detectCommand, takesBump,
  fillCommand, lifecycleSteps, blockedByWorkingCopy, versionFromOutput,
} from '../release-plan.js';

let refreshAll = null;

// What the release flow is currently about: set while the setup modal is open
// and, once Release is pressed, for as long as the run panel stays up. Null
// after the panel is closed, or the modal cancelled unstarted.
let session = null;

// How tall the run panel stands, remembered across releases like the sidebar's
// width. Clamped on every use: a height saved on a big display must not
// swallow a small one.
let panelHeight = 280;
const clampHeight = (h) =>
  Math.max(160, Math.min(Math.round(window.innerHeight * 0.75), Math.round(h) || 280));

// The columns the panel can hang under: whichever of the views' list columns
// is on screen. The panel follows that column's width, divider drags and view
// switches included, so it covers the list and nothing else. A view without a
// list column (the stashes) leaves the last width standing, which reads
// better than a jump to full bleed.
const LIST_COLUMNS = ['#wc-files-panel', '#history-list-panel', '#pr-list-panel'];

function syncPanelWidth() {
  const col = LIST_COLUMNS.map(s => $(s)).find(el => el && el.offsetWidth > 0);
  if (col) $('#release-panel').style.setProperty('--release-w', col.offsetWidth + 'px');
}

export function setupRelease(refresh) {
  refreshAll = refresh;
  $('#btn-release').addEventListener('click', openRelease);
  $('#release-cancel').addEventListener('click', closeModal);
  $('#release-go').addEventListener('click', start);
  $('#release-panel-close').addEventListener('click', onPanelButton);
  $('#release-command').addEventListener('input', () => {
    if (!session || session.running) return;
    session.command = $('#release-command').value;
    renderChoices();
  });
  document.addEventListener('keydown', (e) => {
    if (!session) return;
    if (!$('#release-overlay').hidden) {
      // The setup modal owns the window while it is up, as modals do.
      if (e.key === 'Escape') closeModal();
      if (e.key === 'Enter' && !session.blocked) start();
      return;
    }
    // The run panel does not own the window, so Escape only means it when
    // aimed at it, or at nothing at all. And never mid-run: there is a
    // process to think about, so Escape is not a way out. Stop is, and it
    // says so.
    if (e.key !== 'Escape' || session.running) return;
    if (e.target === document.body || $('#release-panel').contains(e.target)) closePanel();
  });
  setupResize();
  // A ResizeObserver reports each column the moment observation starts and on
  // every size change after, including to zero when its view is switched away,
  // so the width is simply re-read from whichever column is visible.
  const columns = new ResizeObserver(syncPanelWidth);
  LIST_COLUMNS.forEach(s => { const el = $(s); if (el) columns.observe(el); });
  window.release.onOutput(append);
}

// The poller asks before refreshing: a release is running git operations of
// its own, and a refresh mid-run would report a repository mid-mutation.
export const releaseRunning = () => Boolean(session && session.running);

// Dragged taller the same way the sidebar is dragged wider, and remembered the
// same way.
function setupResize() {
  const handle = $('#release-resize');
  const panel = $('#release-panel');
  let startY, startHeight;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startY = e.clientY;
    startHeight = panel.offsetHeight;
    handle.classList.add('dragging');
    panel.classList.add('dragging');
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', onDragEnd);
  });

  function onDrag(e) {
    panelHeight = clampHeight(startHeight + (startY - e.clientY));
    panel.style.setProperty('--release-h', panelHeight + 'px');
  }

  function onDragEnd() {
    handle.classList.remove('dragging');
    panel.classList.remove('dragging');
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', onDragEnd);
    window.git.saveSettings({ releasePanelHeight: panelHeight });
  }
}

// ── Opening ──

async function openRelease() {
  if (!state.repoPath) return;
  // A run in flight already has the panel up, and the toolbar button is not a
  // way to start a second one.
  if (releaseRunning()) return;
  // A finished run still on screen makes way for the next setup.
  if (session) closePanel();
  const repoPath = state.repoPath;

  let info, status, settings;
  try {
    [info, status, settings] = await Promise.all([
      window.release.inspect(repoPath),
      window.git.status(repoPath).catch(() => []),
      window.git.loadSettings(),
    ]);
  } catch (e) {
    toast(e.message || 'Could not read this repository', { type: 'error', prose: true });
    return;
  }

  const pkg = info.packageJson;
  // The newest tag that looks like a version, which is the only version a
  // repository without a package.json has.
  const tag = (state.tagList || []).find(t => isSemver(t)) || null;
  const tagPrefix = tag && tag.startsWith('v') ? 'v' : '';
  const version = (pkg && pkg.version) || (tag ? tag.replace(/^v/, '') : null);

  const detected = detectCommand({ packageJson: pkg, files: info.files, tagPrefix });
  const saved = (settings.releaseCommands || {})[repoPath];
  panelHeight = clampHeight(settings.releasePanelHeight || panelHeight);

  session = {
    repoPath,
    pkg,
    version,
    source: pkg && pkg.version ? 'package.json' : (tag ? `the newest tag, ${tag}` : null),
    detected: detected.command,
    reason: saved ? 'Saved for this repository.' : detected.reason,
    command: saved || detected.command,
    bump: 'patch',
    blocked: blockedByWorkingCopy(status),
    running: false,
  };

  $('#release-title').textContent = pkg && pkg.name ? `Release ${pkg.name}` : 'Release';
  $('#release-current').textContent = session.version
    ? `Currently ${session.version}${session.source ? `, from ${session.source}` : ''}.`
    : 'No version found in this repository yet.';
  $('#release-command').value = session.command;
  $('#release-reason').textContent = session.reason;

  const block = $('#release-block');
  block.hidden = !session.blocked;
  block.textContent = session.blocked || '';

  renderChoices();

  $('#release-overlay').hidden = false;
  $('#release-command').blur();
}

// The three bumps, each labelled with the number it actually produces — the
// whole reason not to type this by hand. A command with no {bump} or {version}
// in it decides the number for itself, so there is nothing here to choose and
// the row goes away rather than lying about having a say.
function renderChoices() {
  const row = $('#release-bumps');
  const wants = takesBump(session.command);
  const canCount = wants && session.version && isSemver(session.version);

  row.hidden = !wants;
  if (wants && !canCount) {
    row.hidden = false;
    row.innerHTML = `<div class="release-nonsemver">${escapeHtml(
      session.version
        ? `"${session.version}" is not a version this can count from, so patch, minor and major cannot be worked out here.`
        : 'There is no current version to count from, so the command will have to spell the number out itself.',
    )}</div>`;
  } else if (wants) {
    row.innerHTML = BUMPS.map(bump => {
      const next = nextVersion(session.version, bump);
      const selected = bump === session.bump ? ' selected' : '';
      return `<button type="button" class="release-bump${selected}" data-bump="${bump}">
        <span class="release-bump-version">${escapeHtml(next)}</span>
        <span class="release-bump-name">${bump} · ${BUMP_MEANING[bump]}</span>
      </button>`;
    }).join('');
    row.querySelectorAll('.release-bump').forEach(btn => {
      btn.addEventListener('click', () => { session.bump = btn.dataset.bump; renderChoices(); });
    });
  }

  renderSteps();
  $('#release-go').disabled = Boolean(session.blocked) || !session.command.trim();
}

// What the command will do on its way past. A release that takes forty seconds
// is nearly always a `preversion` running the whole test suite, and a run whose
// first step was never named is a run that looks stuck.
function renderSteps() {
  const el = $('#release-steps');
  const steps = lifecycleSteps(session.pkg && session.pkg.scripts, session.command);
  if (steps.length === 0) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = '<div class="release-steps-title">It will also run</div>' + steps.map(s =>
    `<div class="release-step"><span class="release-step-name">${escapeHtml(s.name)}</span>` +
    `<code>${escapeHtml(s.command)}</code></div>`).join('');
}

// ── Running ──

async function start() {
  if (!session || session.running || session.blocked) return;

  const template = $('#release-command').value.trim();
  if (!template) return;
  const next = takesBump(template) ? nextVersion(session.version, session.bump) : null;
  const command = fillCommand(template, session.bump, next);

  session.running = true;
  session.expected = next;
  session.command = template;
  rememberCommand(template);

  // The question is answered, so the modal goes, and the watching happens in
  // the docked panel with the window alive above it.
  $('#release-overlay').hidden = true;
  $('#release-panel-title').textContent = session.pkg && session.pkg.name
    ? `Release ${session.pkg.name}` : 'Release';
  $('#release-run-label').textContent = command;
  $('#release-spinner').hidden = false;
  $('#release-panel-close').textContent = 'Stop';
  $('#release-output').textContent = '';
  $('#release-result').hidden = true;
  openPanel();

  const result = await window.release.run(session.repoPath, command);
  session.running = false;
  $('#release-spinner').hidden = true;
  $('#release-panel-close').textContent = 'Close';

  // The refs moved, or the working copy did — either way the window above this
  // panel is now describing the repository as it was a minute ago.
  if (refreshAll) { try { await refreshAll(); } catch {} }

  await finish(result);
}

async function finish(result) {
  const repoName = (session.pkg && session.pkg.name) || session.repoPath.split('/').pop();
  const el = $('#release-result');
  el.hidden = false;
  el.className = `release-result ${result.ok ? 'ok' : 'bad'}`;

  // A cancelled run is not an ending worth announcing: the person who pressed
  // Stop is the one person guaranteed to know already.
  if (!result.ok) {
    el.innerHTML = `<div class="release-result-text">${escapeHtml(result.message || 'The command failed.')}</div>`;
    if (!result.cancelled) {
      toast(result.message || 'Release failed', { type: 'error', prose: true });
      notifyRelease(false, result.message || 'Release failed', repoName);
    }
    return;
  }

  const version = versionFromOutput(result.output, session.expected);
  const done = version ? `Released ${version}.` : 'The release command finished.';
  const forge = forgeForBranch(state.remotes, null);
  const url = releasesUrl(forge);

  // The local half is over; the half that decides whether anyone can download
  // anything is only starting. Hand it to the card in the corner, which will
  // still be watching long after this panel is closed.
  //
  // The tag is read back from the repository rather than assumed: the command
  // was the user's, and it may have tagged differently or not at all. Asked of
  // git directly rather than read from the sidebar's copy — the tag was made
  // seconds ago, and whether a refresh has caught up with it is not something
  // this should quietly depend on.
  //
  // The card may decline: a repository with no workflow files has no build
  // coming, and then "Released" plus the link below is the whole story.
  const tag = await tagFor(version);
  const watching = tag && await watchBuild({
    repoPath: session.repoPath,
    repoName,
    tag,
    forge,
  });

  const next = watching
    ? ' GitHub is building the installers. The build card will say when they are ready.'
    : '';

  // No link to the releases page while the build is still running: the release
  // it would show is the previous one, since this version is not published
  // until the workflow finishes. The card in the corner is the honest answer
  // for those ten minutes, and it opens the run itself.
  const linkable = url && !watching;
  el.innerHTML = `<div class="release-result-text">${escapeHtml(done + next)}</div>` +
    (linkable ? `<button type="button" class="release-link" id="release-open">${icon('cloud', 14)}<span>View releases</span></button>` : '');
  if (linkable) {
    $('#release-open').addEventListener('click', () => window.git.openExternal(url));
  }
  toast(done, { prose: true });
  notifyRelease(true, done + (watching ? ' GitHub is building the installers.' : ''), repoName);
}

async function tagFor(version) {
  if (!version) return null;
  try {
    const tags = await window.git.tags(session.repoPath);
    return tags.find(t => t.replace(/^v/, '') === version) || null;
  } catch { return null; }
}

// Remember the command only when it differs from what Keep would have
// suggested. Storing the suggestion back would freeze it: a repository that
// later grows a `release` script, or switches to pnpm, should be re-read rather
// than kept on the answer that was right the first time it was opened.
async function rememberCommand(command) {
  try {
    const settings = await window.git.loadSettings();
    const map = { ...(settings.releaseCommands || {}) };
    if (command === session.detected) delete map[session.repoPath];
    else map[session.repoPath] = command;
    await window.git.saveSettings({ releaseCommands: map });
  } catch { /* a remembered command is a convenience, not a result */ }
}

function append(chunk) {
  if (!session || !session.running) return;
  const out = $('#release-output');
  // The output was written for a terminal that is not there: colour codes have
  // nothing to colour, and a carriage return meant to rewrite a progress line
  // in place has no line to rewrite.
  const text = String(chunk.text || '')
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\r\n?/g, '\n');
  const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 24;
  out.appendChild(document.createTextNode(text));
  if (atBottom) out.scrollTop = out.scrollHeight;
}

// ── Closing ──

function closeModal() {
  $('#release-overlay').hidden = true;
  session = null;
}

function openPanel() {
  const panel = $('#release-panel');
  syncPanelWidth();
  panel.style.setProperty('--release-h', panelHeight + 'px');
  panel.classList.add('open');
}

// Stop while the command runs, Close once it is done: the same button, saying
// which of the two it currently is.
function onPanelButton() {
  if (session && session.running) { window.release.cancel(); return; }
  closePanel();
}

function closePanel() {
  $('#release-panel').classList.remove('open');
  session = null;
}
