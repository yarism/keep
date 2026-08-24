// release.js runs a command Keep did not write. The parts worth testing are the
// ones that keep that from going wrong: what it reads out of a repository, and
// how a command that fails, hangs or asks a question is reported.
const test = require('node:test');
const assert = require('node:assert');

const release = require('../release');
const h = require('./helpers/repo');

test.after(() => h.cleanup());

// ── inspect ──

test('inspect: reads the version and scripts out of package.json', () => {
  const repo = h.makeRepo();
  h.write(repo, 'package.json', JSON.stringify({
    name: 'thing', version: '2.3.4', scripts: { preversion: 'npm test' },
  }));

  const { packageJson, files } = release.inspect(repo);

  assert.strictEqual(packageJson.name, 'thing');
  assert.strictEqual(packageJson.version, '2.3.4');
  assert.deepStrictEqual(packageJson.scripts, { preversion: 'npm test' });
  assert.ok(files.includes('package.json'));
});

test('inspect: notices the lockfile and the changeset directory', () => {
  const repo = h.makeRepo();
  h.write(repo, 'pnpm-lock.yaml', '');
  h.write(repo, '.changeset/config.json', '{}');

  const { files } = release.inspect(repo);

  assert.ok(files.includes('pnpm-lock.yaml'));
  assert.ok(files.includes('.changeset'));
});

// A repository with no package.json is not an error — it is most of them.
test('inspect: a repository without package.json reads as one', () => {
  const repo = h.makeRepo();

  const { packageJson, files } = release.inspect(repo);

  assert.strictEqual(packageJson, null);
  assert.deepStrictEqual(files, []);
});

// A package.json halfway through an edit must not take the panel down with it.
test('inspect: a broken package.json is simply no version', () => {
  const repo = h.makeRepo();
  h.write(repo, 'package.json', '{ "name": "half-w');

  assert.strictEqual(release.inspect(repo).packageJson, null);
});

// ── running ──

test('run: streams output and reports success', async () => {
  const repo = h.makeRepo();
  const chunks = [];

  const result = await release.run(repo, 'echo one; echo two', (c) => chunks.push(c.text));

  assert.strictEqual(result.ok, true);
  assert.match(chunks.join(''), /one[\s\S]*two/);
  assert.match(result.output, /two/);
});

test('run: the command runs in the repository, not wherever Keep was launched', async () => {
  const repo = h.makeRepo();

  const result = await release.run(repo, 'cat README.md');

  assert.match(result.output, /# Test repo/);
});

// A failed command's last line is usually the point of it.
test('run: a failure is a result to show, not an exception', async () => {
  const repo = h.makeRepo();

  const result = await release.run(repo, 'echo "nope: it did not work" >&2; exit 3');

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 3);
  assert.match(result.message, /nope: it did not work/);
});

// The whole point of giving the child no stdin: a command that asks a question
// gets EOF and fails in a moment, instead of waiting forever behind a window
// that looks frozen.
test('run: a command that asks a question fails instead of hanging', async () => {
  const repo = h.makeRepo();

  const result = await release.run(repo, 'read answer');

  assert.strictEqual(result.ok, false);
});

test('run: two releases cannot run at once', async () => {
  const repo = h.makeRepo();
  const first = release.run(repo, 'sleep 0.4');
  const second = await release.run(repo, 'echo hello');

  assert.strictEqual(second.ok, false);
  assert.match(second.message, /already running/);
  await first;
});

test('run: cancelling stops it, and says so', async () => {
  const repo = h.makeRepo();
  const running = release.run(repo, 'sleep 30');

  // The child has to exist before it can be killed.
  await new Promise(r => setTimeout(r, 250));
  assert.strictEqual(release.isRunning(), true);
  release.cancel();

  const result = await running;
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.cancelled, true);
  assert.strictEqual(release.isRunning(), false);
});

test('run: an empty command is refused rather than run', async () => {
  const result = await release.run(h.makeRepo(), '   ');

  assert.strictEqual(result.ok, false);
  assert.match(result.message, /No command/);
});

// ── the PATH the command runs with ──
//
// An app launched from Finder inherits launchd's environment, where npm is not
// on the PATH and never will be. The login shell is asked for its own, and this
// is the fragile half of that: a profile is free to print things, and its
// chatter must not be read as the answer.

test('parseShellPath: the answer survives a profile that talks', () => {
  const stdout = 'nvm: using v22.3.0\nWelcome back!\n\n' +
    '__KEEP_PATH__/Users/someone/.n/bin:/usr/bin:/bin__KEEP_END__\n';

  assert.strictEqual(release.parseShellPath(stdout), '/Users/someone/.n/bin:/usr/bin:/bin');
});

test('parseShellPath: a shell that never answered is not an empty PATH', () => {
  assert.strictEqual(release.parseShellPath('command not found: -lic\n'), null);
  assert.strictEqual(release.parseShellPath('__KEEP_PATH____KEEP_END__'), null);
  assert.strictEqual(release.parseShellPath(''), null);
});

// ── explaining a failure ──
//
// Three failures whose own wording sends you looking in the wrong place. Pure,
// so they are tested without running anything.

test('explainFailure: a missing binary names the PATH, which is the real cause', () => {
  const message = release.explainFailure('pnpm version patch',
    'sh: pnpm: command not found\n', 127);

  assert.match(message, /pnpm/);
  assert.match(message, /PATH/);
});

test('explainFailure: a dirty working copy is named as one', () => {
  const message = release.explainFailure('npm version patch',
    'npm error Git working directory not clean.\n', 1);

  assert.match(message, /uncommitted changes/);
});

// A release usually ends in a push, and a push that cannot ask for a password
// fails with a message about terminal prompts that explains nothing.
test('explainFailure: a push that could not authenticate says what to do', () => {
  const message = release.explainFailure('npm version patch',
    'fatal: could not read Username for https://github.com: terminal prompts disabled\n', 1);

  assert.match(message, /credential/i);
});

// npm signs off with four lines of bookkeeping. Reporting the path to its debug
// log as the reason the release failed is how a real run of this looked.
test('explainFailure: npm\u2019s sign-off is not the reason it failed', () => {
  const message = release.explainFailure('npm version patch', [
    'npm error Missing script: "test"',
    'npm error',
    'npm error To see a list of scripts, run:',
    'npm error   npm run',
    'npm error code 1',
    'npm error path /tmp/demo',
    'npm error command failed',
    'npm error command sh -c npm test',
    'npm error A complete log of this run can be found in:',
    '/Users/someone/.npm/_logs/2026-08-24T21_35_01_037Z-debug-0.log',
  ].join('\n'), 1);

  assert.strictEqual(message, 'npm error Missing script: "test"');
});

test('explainFailure: anything else keeps the last line the command printed', () => {
  const message = release.explainFailure('./release.sh',
    'building\ntagging\nrefusing to tag a dirty tree\n', 1);

  assert.strictEqual(message, 'refusing to tag a dirty tree');
});
