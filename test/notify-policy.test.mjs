// notify-policy.js decides which events earn an OS notification and what it
// says. Pure: events in, wording or silence out. The other half of the rule,
// showing nothing while the window is front, lives in the main process and is
// not tested here. See test/README.md for why the module is loaded through the
// esm helper.
import test from 'node:test';
import assert from 'node:assert';
import { loadEsm } from './helpers/esm.mjs';

const P = await loadEsm('renderer/notify-policy.js');

// ── toolbar actions ──

test('actionNotice: pull, push and publish are worth telling another window about', () => {
  for (const label of ['Pull', 'Push', 'Publish']) {
    const n = P.actionNotice(label, true, 'Already up to date', 'keep');
    assert.strictEqual(n.title, `${label} finished - keep`);
    assert.strictEqual(n.body, 'Already up to date');
  }
});

test('actionNotice: a failure says so and carries the error', () => {
  const n = P.actionNotice('Push', false, 'Could not reach github.com.', 'keep');
  assert.strictEqual(n.title, 'Push failed - keep');
  assert.strictEqual(n.body, 'Could not reach github.com.');
});

// Fetch is silent by design: the background fetch says nothing, and what a
// fetch finds speaks through the behind notice. The local operations are over
// before anyone has had time to switch away.
test('actionNotice: fetch and the local operations stay quiet', () => {
  for (const label of ['Fetch', 'Merge', 'Rebase', 'Save Stash', 'Apply Stash']) {
    assert.strictEqual(P.actionNotice(label, true, 'done', 'keep'), null);
    assert.strictEqual(P.actionNotice(label, false, 'broke', 'keep'), null);
  }
});

test('actionNotice: no repository name still reads as a title', () => {
  assert.strictEqual(P.actionNotice('Pull', true, 'ok', null).title, 'Pull finished');
});

// ── falling behind ──

test('behindTransition: up to date turning behind is the one notifying moment', () => {
  assert.strictEqual(P.behindTransition(0, 1), true);
  assert.strictEqual(P.behindTransition(0, 5), true);
});

test('behindTransition: a count that keeps growing does not nag', () => {
  assert.strictEqual(P.behindTransition(5, 6), false);
  assert.strictEqual(P.behindTransition(1, 99), false);
});

test('behindTransition: the first read of a branch stays silent', () => {
  assert.strictEqual(P.behindTransition(undefined, 4), false);
});

test('behindTransition: catching up says nothing but re-arms the next one', () => {
  assert.strictEqual(P.behindTransition(5, 0), false);
  assert.strictEqual(P.behindTransition(0, 0), false);
  // The re-arming itself: zero on record, then commits arrive again.
  assert.strictEqual(P.behindTransition(0, 2), true);
});

test('behindNotice: the count reads as words, singular included', () => {
  const one = P.behindNotice({ name: 'main', upstream: 'origin/main', behind: 1 }, 'keep');
  assert.strictEqual(one.title, 'New commits on origin/main - keep');
  assert.strictEqual(one.body, 'main is now 1 commit behind.');

  const many = P.behindNotice({ name: 'main', upstream: 'origin/main', behind: 3 }, 'keep');
  assert.strictEqual(many.body, 'main is now 3 commits behind.');
});

// ── builds ──

test('buildNotice: only a settled build is worth a notification', () => {
  assert.strictEqual(P.buildNotice({ state: 'waiting', title: 'v1 - waiting' }, 'keep'), null);
  assert.strictEqual(P.buildNotice({ state: 'running', title: 'v1 - building' }, 'keep'), null);
  assert.strictEqual(P.buildNotice({ state: 'unknown', title: 'v1 - not visible' }, 'keep'), null);
});

test('buildNotice: done and failed relay the card wording', () => {
  const done = P.buildNotice(
    { state: 'done', title: 'v1.0.35 published', detail: 'The installers are on the release page.' },
    'keep',
  );
  assert.strictEqual(done.title, 'v1.0.35 published - keep');
  assert.strictEqual(done.body, 'The installers are on the release page.');

  const failed = P.buildNotice(
    { state: 'failed', title: 'v1.0.35 - failed', detail: 'build (macos-latest) did not pass.' },
    'keep',
  );
  assert.strictEqual(failed.title, 'v1.0.35 - failed - keep');
  assert.strictEqual(failed.body, 'build (macos-latest) did not pass.');
});

// ── releases ──

test('releaseNotice: both endings are named and carry their message', () => {
  const ok = P.releaseNotice(true, 'Released 1.0.35.', 'keep');
  assert.strictEqual(ok.title, 'Release finished - keep');
  assert.strictEqual(ok.body, 'Released 1.0.35.');

  const bad = P.releaseNotice(false, 'npm test failed', 'keep');
  assert.strictEqual(bad.title, 'Release failed - keep');
  assert.strictEqual(bad.body, 'npm test failed');
});
