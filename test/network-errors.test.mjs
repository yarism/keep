// git.js turns a failed network command into the sentence the UI shows. The
// commands themselves need a remote, but the explaining does not: it is a pure
// function over git's stderr, so these tests are plain strings in, strings out.
//
// What they protect is the promise the fix rests on — that a repository which
// would have asked for a credential now says so, and says what to do about it,
// instead of freezing the window in silence.
import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const { explainNetworkError, NETWORK_TIMEOUT_MS } = createRequire(import.meta.url)('../git.js');

test('network errors: an https credential prompt names the credential helper', () => {
  const msg = explainNetworkError('Push', "fatal: could not read Username for 'https://github.com': terminal prompts disabled");

  assert.match(msg, /^Push failed/);
  assert.match(msg, /username and password/);
  assert.match(msg, /credential\.helper/);
});

test('network errors: a rejected key points at ssh-add, not at git', () => {
  const msg = explainNetworkError('Pull', 'git@github.com: Permission denied (publickey).');

  assert.match(msg, /^Pull failed/);
  assert.match(msg, /SSH key/);
  assert.match(msg, /ssh-add/);
});

test('network errors: a locked key is distinguished from a rejected one', () => {
  const msg = explainNetworkError('Fetch', 'Enter passphrase for key /Users/x/.ssh/id_ed25519:');

  assert.match(msg, /passphrase/);
  assert.match(msg, /ssh-add/);
});

test('network errors: an unverified host key sends you to a terminal', () => {
  const msg = explainNetworkError('Fetch', 'Host key verification failed.');

  assert.match(msg, /host key/i);
  assert.match(msg, /terminal/);
});

test('network errors: being offline reads as being offline', () => {
  const msg = explainNetworkError('Fetch', "fatal: unable to access 'https://github.com/x.git': Could not resolve host: github.com");

  assert.match(msg, /could not be reached/);
});

test('network errors: a timeout says how long it waited and why it might have', () => {
  const msg = explainNetworkError('Push', '', { timedOut: true });

  assert.match(msg, new RegExp(`${Math.round(NETWORK_TIMEOUT_MS / 1000)} seconds`));
  assert.match(msg, /credential/);
});

test('network errors: the action names the button that was pressed', () => {
  const msg = explainNetworkError('Publish', 'fatal: could not read Username: terminal prompts disabled');

  assert.match(msg, /^Publish failed/);
});

// An ordinary rejection — a non-fast-forward push, a merge conflict on pull —
// is already written for a person. Rewriting it would only lose detail.
test('network errors: an ordinary git failure is passed through untouched', () => {
  const raw = 'error: failed to push some refs\nhint: Updates were rejected because the tip is behind';
  assert.strictEqual(explainNetworkError('Push', raw), raw);
});

test('network errors: a failure with nothing to say still says something', () => {
  assert.strictEqual(explainNetworkError('Fetch', '   '), 'Fetch failed.');
});
