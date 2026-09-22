// macOS blocks Keep from a protected folder and git says "Unable to read
// current working directory". Every visible symptom points somewhere else: the
// repository opens, the folder is plainly there, and the branch, tag, remote
// and file lists are all simply empty — the state a repository with nothing in
// it would be in.
//
// These tests hold the one place that difference is detectable. Pure strings
// in, strings out, so nothing here has to revoke a permission to run.
import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const { explainAccessError } = createRequire(import.meta.url)('../git.js');

const HOME = process.env.HOME;
const DESKTOP_REPO = `${HOME}/Desktop/dev/keep`;

// Verbatim, from a notarized build launched without the folder granted.
const REAL = 'fatal: Unable to read current working directory: Operation not permitted\n';

test('access: the real denial is recognised and explained', () => {
  const text = explainAccessError(DESKTOP_REPO, REAL);

  assert.ok(text, 'a permission denial should produce a message');
  assert.match(text, /macOS is blocking/);
  assert.match(text, /Privacy & Security/);
});

test('access: the message names which folder to look for', () => {
  assert.match(explainAccessError(`${HOME}/Desktop/dev/keep`, REAL), /Desktop folder/);
  assert.match(explainAccessError(`${HOME}/Documents/work`, REAL), /Documents folder/);
  assert.match(explainAccessError(`${HOME}/Downloads/thing`, REAL), /Downloads folder/);
});

// Outside the protected three the diagnosis still holds — the folder could be
// on an external volume — but there is no folder name to send anyone looking for.
test('access: a path outside the protected folders stays vague rather than wrong', () => {
  const text = explainAccessError('/Volumes/Work/repo', REAL);

  assert.match(text, /this folder/);
  assert.doesNotMatch(text, /Desktop|Documents|Downloads/);
});

test('access: EPERM and Operation not permitted are both caught', () => {
  assert.ok(explainAccessError(DESKTOP_REPO, "EPERM: operation not permitted, scandir '/x'"));
  assert.ok(explainAccessError(DESKTOP_REPO, 'fatal: Operation not permitted'));
});

// The whole point is to be quiet about failures that are not this one.
test('access: an ordinary git failure is not dressed up as a permission problem', () => {
  assert.strictEqual(explainAccessError(DESKTOP_REPO, 'fatal: not a git repository'), null);
  assert.strictEqual(explainAccessError(DESKTOP_REPO, "fatal: pathspec 'x' did not match"), null);
  assert.strictEqual(explainAccessError(DESKTOP_REPO, ''), null);
  assert.strictEqual(explainAccessError(DESKTOP_REPO, undefined), null);
});

// SSH says "Permission denied (publickey)" for something explainNetworkError
// already handles, and sending that to System Settings would be a dead end.
test('access: a rejected SSH key is left to the network explainer', () => {
  const text = explainAccessError(DESKTOP_REPO, 'git@github.com: Permission denied (publickey).');

  assert.strictEqual(text, null);
});

// Apple's /usr/bin/git is a stub that runs git from Xcode or the Command Line
// Tools. After an Xcode update it refuses until the new license is accepted,
// and the window goes empty in exactly the way a blocked folder makes it. The
// fix is a Terminal command, so the message has to name it.
const { explainToolchainError } = createRequire(import.meta.url)('../git.js');

test('toolchain: an unaccepted Xcode license names the command that accepts it', () => {
  const text = explainToolchainError(
    'You have not agreed to the Xcode license agreements. Please run \'sudo xcodebuild -license\' from within a Terminal window to review and agree to the Xcode and Apple SDKs license.\n');

  assert.match(text, /sudo xcodebuild -license accept/);
});

test('toolchain: missing Command Line Tools point at xcode-select', () => {
  const text = explainToolchainError(
    'xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools), missing xcrun at: /Library/Developer/CommandLineTools/usr/bin/xcrun\n');

  assert.match(text, /xcode-select --install/);
});

test('toolchain: ordinary git failures and folder denials are left alone', () => {
  assert.strictEqual(explainToolchainError('fatal: not a git repository'), null);
  assert.strictEqual(explainToolchainError(REAL), null);
  assert.strictEqual(explainToolchainError(undefined), null);
});
