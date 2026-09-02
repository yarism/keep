// What a build looks like from outside.
//
// Pushing a tag is where a release stops being local. Everything after it —
// tests on a runner, an installer per platform, the release itself being cut —
// happens on GitHub, takes minutes rather than seconds, and used to be visible
// only by going to look. This turns one workflow run into the two lines a small
// card can hold.
//
// The vocabulary is GitHub's: a run has a `status` (queued, in_progress,
// completed) and, once completed, a `conclusion` (success, failure, cancelled,
// timed_out, …). Both matter — "completed" alone says nothing about whether the
// thing you can download exists.
//
// Pure, so the wording can be tested without a network.

// A matrix job is named for every value in its matrix entry:
// "build (macos-latest, macos, --mac)". The first is the runner, which is the
// one worth showing; the rest is the recipe.
export function stageLabel(name) {
  const text = String(name || '').trim();
  const matrix = /^(.+?)\s*\(([^)]*)\)\s*$/.exec(text);
  if (!matrix) return text;
  const first = matrix[2].split(',')[0].trim();
  return first ? `${matrix[1]} (${first})` : matrix[1];
}

const list = (names) => {
  const kept = names.slice(0, 2).join(', ');
  return names.length > 2 ? `${kept}, and ${names.length - 2} more` : kept;
};

export function describeBuild(run, { label = 'the build', kind = 'tag' } = {}) {
  const tag = label;
  // Pushing a tag and GitHub queueing the run are seconds apart, and during
  // those seconds the API truthfully reports that no such run exists. That is
  // not "no build" — it is a build that has not been filed yet.
  if (!run) {
    return {
      state: 'waiting',
      title: `${tag} - waiting`,
      detail: 'GitHub has not filed the build yet.',
    };
  }

  const jobs = run.jobs || [];
  const named = (predicate) => jobs.filter(predicate).map(j => stageLabel(j.name));

  if (run.status === 'queued' || run.status === 'pending') {
    return { state: 'waiting', title: `${tag} - queued`, detail: 'Waiting for a runner.' };
  }

  if (run.status !== 'completed') {
    const running = named(j => j.status === 'in_progress');
    return {
      state: 'running',
      title: `${tag} - building`,
      detail: running.length ? list(running) : 'Starting.',
    };
  }

  if (run.conclusion === 'success') {
    // The point of the whole wait is not that the workflow ended — it is that
    // something exists at the end of it. What that something is depends on what
    // set the build off: a tag cuts a release, an ordinary push leaves the
    // installers on the run as artifacts.
    return kind === 'tag'
      ? { state: 'done', title: `${tag} published`, detail: 'The installers are on the release page.' }
      : { state: 'done', title: `${tag} built`, detail: 'The installers are on the run, as artifacts.' };
  }

  if (run.conclusion === 'cancelled') {
    return { state: 'failed', title: `${tag} - cancelled`, detail: 'The build was stopped.' };
  }

  // Naming the job that failed is the difference between "go and look" and
  // knowing whether it was the Mac signing step again.
  const failed = named(j => j.conclusion && j.conclusion !== 'success' && j.conclusion !== 'skipped');
  const why = run.conclusion === 'timed_out' ? 'timed out'
    : run.conclusion === 'action_required' ? 'needs approval'
      : 'failed';
  return {
    state: 'failed',
    title: `${tag} - ${why}`,
    detail: failed.length ? `${list(failed)} did not pass.` : 'The build did not pass.',
  };
}

export const isFinished = (d) => d.state === 'done' || d.state === 'failed';

// mm:ss up to an hour, then h:mm — a build is minutes, but a queue can be long.
export function elapsed(sinceMs, nowMs) {
  const total = Math.max(0, Math.round((nowMs - sinceMs) / 1000));
  const m = Math.floor(total / 60), s = total % 60;
  if (m < 60) return `${m}:${String(s).padStart(2, '0')}`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

// A call that never reached GitHub at all.
//
// Electron wraps whatever the main process threw in "Error invoking remote
// method 'x': ", which buries the sentence that matters. One failure is worth
// naming outright: a window reloaded onto newer code than the process running
// it has no such handler to call, which happens every time Reload is used
// instead of a relaunch, and reads like a broken feature rather than a stale
// process.
//
// Pure, so it can be tested without an IPC bridge.
export function explainCallFailure(raw) {
  const text = String(raw || '');
  const unwrapped = /Error invoking remote method '[^']*':\s*([\s\S]*)$/.exec(text);
  const message = (unwrapped ? unwrapped[1] : text).replace(/^Error:\s*/, '').trim();

  if (/No handler registered/i.test(message)) {
    return 'This window was reloaded onto a newer Keep than the process running it. '
      + 'Quit Keep and start it again.';
  }
  return message || 'The build could not be read.';
}

// How often to ask. Unauthenticated requests are rationed at sixty an hour, and
// a ten-minute build polled every fifteen seconds would spend two thirds of
// that on one release.
export const pollInterval = (authenticated) => (authenticated ? 15000 : 60000);

// A tag pushed to a repository with no workflow at all would otherwise wait for
// a build that is never coming.
export const GIVE_UP_MS = 5 * 60 * 1000;
