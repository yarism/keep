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
// Nothing here decides what a release *is*: release-plan.js suggests, the
// field below it is editable, and what the user leaves in that field is
// remembered per repository. Keep's opinion is a starting point, not a rule.

import { $, state, escapeHtml } from './state.js';
import { toast } from './toast.js';
import { icon } from '../icons.js';
import { forgeForBranch, releasesUrl } from './forge.js';
import { watchBuild } from './build-watch.js';
import {
  BUMPS, BUMP_MEANING, nextVersion, isSemver, detectCommand, takesBump,
  fillCommand, lifecycleSteps, blockedByWorkingCopy, versionFromOutput,
} from '../release-plan.js';

let refreshAll = null;

// What the panel is currently set up for. Null while it is closed.
let session = null;

export function setupRelease(refresh) {
  refreshAll = refresh;
  $('#btn-release').addEventListener('click', openRelease);
  $('#release-close').addEventListener('click', onCloseButton);
  $('#release-go').addEventListener('click', start);
  $('#release-command').addEventListener('input', () => {
    if (!session || session.running) return;
    session.command = $('#release-command').value;
    renderChoices();
  });
  document.addEventListener('keydown', (e) => {
    if (!session || $('#release-overlay').hidden) return;
    // While something is running there is a process to think about, so Escape
    // is not a way out — Stop is, and it says so.
    if (e.key === 'Escape' && !session.running) close();
    if (e.key === 'Enter' && !session.running && !session.blocked) start();
  });
  window.release.onOutput(append);
}

// ── Opening ──

async function openRelease() {
  if (!state.repoPath) return;
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

  $('#release-setup').hidden = false;
  $('#release-run').hidden = true;
  $('#release-output').textContent = '';
  $('#release-result').hidden = true;
  $('#release-close').textContent = 'Cancel';
  $('#release-go').hidden = false;
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

  $('#release-setup').hidden = true;
  $('#release-run').hidden = false;
  $('#release-run-label').textContent = command;
  $('#release-spinner').hidden = false;
  $('#release-go').hidden = true;
  $('#release-close').textContent = 'Stop';
  $('#release-output').textContent = '';

  const result = await window.release.run(session.repoPath, command);
  session.running = false;
  $('#release-spinner').hidden = true;
  $('#release-close').textContent = 'Close';

  // The refs moved, or the working copy did — either way the window behind this
  // panel is now describing the repository as it was a minute ago.
  if (refreshAll) { try { await refreshAll(); } catch {} }

  finish(result);
}

function finish(result) {
  const el = $('#release-result');
  el.hidden = false;
  el.className = `release-result ${result.ok ? 'ok' : 'bad'}`;

  if (!result.ok) {
    el.innerHTML = `<div class="release-result-text">${escapeHtml(result.message || 'The command failed.')}</div>`;
    if (!result.cancelled) toast(result.message || 'Release failed', { type: 'error', prose: true });
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
  // was the user's, and it may have tagged differently or not at all.
  const tag = (state.tagList || []).find(t => t.replace(/^v/, '') === version) || null;
  const watching = tag && watchBuild({
    repoPath: session.repoPath,
    repoName: (session.pkg && session.pkg.name) || session.repoPath.split('/').pop(),
    tag,
    forge,
  });

  const next = watching
    ? ' GitHub is building the installers — the card in the corner says when they are ready.'
    : '';
  el.innerHTML = `<div class="release-result-text">${escapeHtml(done + next)}</div>` +
    (url ? `<button type="button" class="release-link" id="release-open">${icon('cloud', 14)}<span>View releases</span></button>` : '');
  if (url) {
    $('#release-open').addEventListener('click', () => window.git.openExternal(url));
  }
  toast(done, { prose: true });
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

function onCloseButton() {
  if (session && session.running) { window.release.cancel(); return; }
  close();
}

function close() {
  $('#release-overlay').hidden = true;
  session = null;
}
