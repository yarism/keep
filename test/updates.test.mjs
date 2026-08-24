// The update banner's copy, and — more to the point — its silence.
//
// A check runs at launch and every six hours afterwards, so the states nobody
// asked about must produce nothing at all. A regression here is not a wrong
// word on screen, it is Keep interrupting a commit to say it is up to date.
import test from 'node:test';
import assert from 'node:assert';

import { loadEsm } from './helpers/esm.mjs';

const { describeUpdate, explainUpdateError } = await loadEsm('renderer/update-view.js');

test('updates: a background check that finds nothing says nothing', () => {
  const { banner, toast } = describeUpdate({ status: 'current', current: '1.0.8', manual: false });

  assert.strictEqual(banner, null);
  assert.strictEqual(toast, null);
});

test('updates: a menu check that finds nothing answers the question', () => {
  const { banner, toast } = describeUpdate({ status: 'current', current: '1.0.8', manual: true });

  assert.strictEqual(banner, null);
  assert.strictEqual(toast.type, 'success');
  assert.match(toast.text, /1\.0\.8/);
});

test('updates: a background failure stays quiet, a requested one does not', () => {
  const quiet = describeUpdate({ status: 'error', message: 'net::ERR_INTERNET_DISCONNECTED', manual: false });
  assert.strictEqual(quiet.toast, null);
  assert.strictEqual(quiet.banner, null);

  const asked = describeUpdate({ status: 'error', message: 'net::ERR_INTERNET_DISCONNECTED', manual: true });
  assert.strictEqual(asked.toast.type, 'error');
  assert.match(asked.toast.text, /github\.com/);
});

// The real message electron-updater raises when the release predates the feed —
// four hundred characters of headers and stack behind a one-line cause.
const REAL_404 = `Cannot find latest-mac.yml in the latest release artifacts \
(https://github.com/yarism/keep/releases/download/v1.0.8/latest-mac.yml): HttpError: 404
"method: GET url: https://github.com/yarism/keep/releases/download/v1.0.8/latest-mac.yml"
Headers: {
  "cache-control": "no-cache",
  "content-encoding": "gzip",
  "x-github-request-id": "EE2D:CB65A:102B1D9:C42779:6A8C1B7F"
}
    at createHttpError (.../httpExecutor.js:53:12)`;

test('updates: an HTTP dump becomes a sentence, not a log', () => {
  const text = explainUpdateError(REAL_404);

  assert.ok(text.length < 120, `still a dump: ${text.length} chars`);
  assert.doesNotMatch(text, /Headers|cache-control|httpExecutor|\bat \w/);
  assert.match(text, /release/i);
});

test('updates: the failures worth naming are named', () => {
  assert.match(explainUpdateError('Error: net::ERR_NAME_NOT_RESOLVED'), /github\.com/);
  assert.match(explainUpdateError('getaddrinfo ENOTFOUND github.com'), /github\.com/);
  assert.match(explainUpdateError('Could not get code signature for running application'), /not signed/);
});

test('updates: anything unrecognised keeps its first line and drops the rest', () => {
  const text = explainUpdateError('Something new went wrong\nHeaders: {\n  "x": "y"\n}');

  assert.strictEqual(text, 'Something new went wrong');
});

test('updates: an error with no message still says something', () => {
  assert.ok(explainUpdateError(undefined).length > 0);
  assert.ok(explainUpdateError('').length > 0);
});

test('updates: only a requested check shows that it is checking', () => {
  assert.strictEqual(describeUpdate({ status: 'checking', manual: false }).banner, null);
  assert.match(describeUpdate({ status: 'checking', manual: true }).banner.text, /Checking/);
});

test('updates: an available version is named and shows a bar at zero', () => {
  const { banner } = describeUpdate({ status: 'available', version: '1.0.9' });

  assert.match(banner.text, /Keep 1\.0\.9/);
  assert.strictEqual(banner.percent, 0);
  assert.ok(!banner.restart);
});

test('updates: progress carries through to the bar', () => {
  const { banner } = describeUpdate({ status: 'downloading', version: '1.0.9', percent: 42 });

  assert.strictEqual(banner.percent, 42);
});

// The first download-progress event can arrive before any version is known.
test('updates: a missing version degrades to a generic line rather than "Keep undefined"', () => {
  const { banner } = describeUpdate({ status: 'downloading', percent: 7 });

  assert.doesNotMatch(banner.text, /undefined/);
  assert.strictEqual(banner.percent, 7);
});

test('updates: a percent-less progress event does not blank the bar with NaN', () => {
  const { banner } = describeUpdate({ status: 'downloading', version: '1.0.9' });

  assert.strictEqual(banner.percent, 0);
});

test('updates: a downloaded update offers the restart', () => {
  const { banner, toast } = describeUpdate({ status: 'ready', version: '1.0.9' });

  assert.strictEqual(banner.restart, true);
  assert.strictEqual(toast, null);
  assert.ok(!Number.isFinite(banner.percent));
});

test('updates: running from source is only worth saying when asked', () => {
  assert.strictEqual(describeUpdate({ status: 'unsupported', manual: false }).toast, null);
  assert.match(describeUpdate({ status: 'unsupported', manual: true }).toast.text, /from source/);
});

test('updates: an unknown or idle state renders nothing', () => {
  for (const status of ['idle', undefined, 'something-new']) {
    const r = describeUpdate({ status });
    assert.strictEqual(r.banner, null, status);
    assert.strictEqual(r.toast, null, status);
  }
  assert.deepStrictEqual(describeUpdate(null), { banner: null, toast: null });
});
