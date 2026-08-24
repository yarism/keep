// build-status.js turns one GitHub workflow run into the two lines the card in
// the corner can hold. Pure — a run in, wording out. See test/README.md for why
// the module is loaded through the esm helper.
import test from 'node:test';
import assert from 'node:assert';
import { loadEsm } from './helpers/esm.mjs';

const B = await loadEsm('renderer/build-status.js');

const running = (...names) => names.map(name => ({ name, status: 'in_progress' }));

// ── naming a stage ──

// A matrix job carries every value in its entry: the runner, the label and the
// arguments. The runner is the half a person recognises.
test('stageLabel: a matrix job is named for its runner, not its recipe', () => {
  assert.strictEqual(B.stageLabel('build (macos-latest, macos, --mac)'), 'build (macos-latest)');
  assert.strictEqual(B.stageLabel('build (windows-latest, windows, --win nsis --x64)'),
    'build (windows-latest)');
});

test('stageLabel: an ordinary job keeps its name', () => {
  assert.strictEqual(B.stageLabel('test'), 'test');
  assert.strictEqual(B.stageLabel('release'), 'release');
});

// ── the wait before the wait ──

// Seconds pass between a tag arriving and a run being filed, and during them
// the API truthfully reports no such run. That is not "no build".
test('describeBuild: no run yet is waiting, not missing', () => {
  const d = B.describeBuild(null, { label: 'v1.0.17' });

  assert.strictEqual(d.state, 'waiting');
  assert.match(d.title, /v1\.0\.17/);
  assert.strictEqual(B.isFinished(d), false);
});

test('describeBuild: queued says what it is waiting for', () => {
  const d = B.describeBuild({ status: 'queued' }, { label: 'v1.0.17' });

  assert.strictEqual(d.state, 'waiting');
  assert.match(d.detail, /runner/i);
});

// ── while it runs ──

test('describeBuild: running names the stages actually running', () => {
  const d = B.describeBuild({
    status: 'in_progress',
    jobs: [
      { name: 'test', status: 'completed', conclusion: 'success' },
      ...running('build (macos-latest, macos)', 'build (windows-latest, windows)'),
    ],
  }, { label: 'v1.0.17' });

  assert.strictEqual(d.state, 'running');
  assert.strictEqual(d.detail, 'build (macos-latest), build (windows-latest)');
});

test('describeBuild: a long matrix is summarised rather than listed', () => {
  const d = B.describeBuild({
    status: 'in_progress',
    jobs: running('one', 'two', 'three', 'four'),
  }, { label: 'v2' });

  assert.match(d.detail, /and 2 more/);
});

// A run whose jobs have not been read yet must still say something.
test('describeBuild: running with nothing started yet still speaks', () => {
  const d = B.describeBuild({ status: 'in_progress', jobs: [] }, { label: 'v1.0.17' });

  assert.strictEqual(d.state, 'running');
  assert.ok(d.detail);
});

// ── how it ends ──

// The point of the whole wait is not that the workflow ended — it is that there
// is something to download.
test('describeBuild: success is about the installers, not the workflow', () => {
  const d = B.describeBuild({ status: 'completed', conclusion: 'success' }, { label: 'v1.0.17' });

  assert.strictEqual(d.state, 'done');
  assert.strictEqual(d.title, 'v1.0.17 published');
  assert.strictEqual(B.isFinished(d), true);
});

// "completed" alone says nothing about whether it worked, and treating it as
// success would announce a release that does not exist.
test('describeBuild: completed is not the same as succeeded', () => {
  const d = B.describeBuild({
    status: 'completed',
    conclusion: 'failure',
    jobs: [
      { name: 'test', status: 'completed', conclusion: 'success' },
      { name: 'build (macos-latest, macos)', status: 'completed', conclusion: 'failure' },
    ],
  }, { label: 'v1.0.17' });

  assert.strictEqual(d.state, 'failed');
  assert.match(d.detail, /build \(macos-latest\)/);
  assert.strictEqual(B.isFinished(d), true);
});

test('describeBuild: a skipped job is not a failed one', () => {
  const d = B.describeBuild({
    status: 'completed',
    conclusion: 'failure',
    jobs: [
      { name: 'build (macos-latest, macos)', status: 'completed', conclusion: 'failure' },
      { name: 'release', status: 'completed', conclusion: 'skipped' },
    ],
  }, { label: 'v1' });

  assert.doesNotMatch(d.detail, /release/);
});

test('describeBuild: cancelled and timed out are told apart', () => {
  assert.match(B.describeBuild({ status: 'completed', conclusion: 'cancelled' }, { label: 'v1' }).title,
    /cancelled/);
  assert.match(B.describeBuild({ status: 'completed', conclusion: 'timed_out' }, { label: 'v1' }).title,
    /timed out/);
});

// A push to main builds the same installers and cuts no release, so saying it
// was "published" would send someone to a release page that does not exist.
test('describeBuild: a commit build is built, not published', () => {
  const d = B.describeBuild({ status: 'completed', conclusion: 'success' },
    { label: 'a1b2c3d', kind: 'commit' });

  assert.strictEqual(d.state, 'done');
  assert.strictEqual(d.title, 'a1b2c3d built');
  assert.match(d.detail, /artifacts/);
});

// ── a call that never got there ──

// Reload re-reads the renderer from disk and leaves the main process as it
// was, so the window ends up calling a handler that does not exist yet. The
// raw wording reads like a broken feature rather than a stale process.
test('explainCallFailure: a stale main process is named as one', () => {
  const message = B.explainCallFailure(
    "Error invoking remote method 'forge-workflow-run': Error: No handler registered for 'forge-workflow-run'");

  assert.match(message, /Quit Keep and start it again/);
  assert.doesNotMatch(message, /invoking remote method/);
});

test('explainCallFailure: anything else keeps its own sentence, unwrapped', () => {
  assert.strictEqual(
    B.explainCallFailure("Error invoking remote method 'forge-workflow-run': Error: Could not reach github.com."),
    'Could not reach github.com.');
  assert.strictEqual(B.explainCallFailure('Could not reach github.com.'), 'Could not reach github.com.');
  assert.match(B.explainCallFailure(''), /could not be read/);
});

// ── the clock ──

test('elapsed: minutes and seconds, then hours', () => {
  assert.strictEqual(B.elapsed(0, 254_000), '4:14');
  assert.strictEqual(B.elapsed(0, 9_000), '0:09');
  assert.strictEqual(B.elapsed(0, 3_723_000), '1:02');
});

// Unauthenticated requests are rationed at sixty an hour; a ten-minute build
// polled every fifteen seconds would spend two thirds of that on one release.
test('pollInterval: an unauthenticated watch asks far less often', () => {
  assert.ok(B.pollInterval(false) >= 4 * B.pollInterval(true));
});
