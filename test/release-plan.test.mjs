// release-plan.js works out what "release" means in a repository Keep did not
// set up. It is pure — signals in, a suggestion out — so these are plain data
// tests. See test/README.md for why the module is loaded through the esm helper.
import test from 'node:test';
import assert from 'node:assert';
import { loadEsm } from './helpers/esm.mjs';

const P = await loadEsm('renderer/release-plan.js');

// ── nextVersion ──

test('nextVersion: counts the way semver counts', () => {
  assert.strictEqual(P.nextVersion('1.0.16', 'patch'), '1.0.17');
  assert.strictEqual(P.nextVersion('1.0.16', 'minor'), '1.1.0');
  assert.strictEqual(P.nextVersion('1.0.16', 'major'), '2.0.0');
});

// The rule that is easy to get wrong by hand, and the reason the number is
// shown before the command runs: a prerelease is finished by the bump it was
// already anticipating rather than moved past it.
test('nextVersion: a prerelease is completed, not stepped over', () => {
  assert.strictEqual(P.nextVersion('1.2.3-beta.1', 'patch'), '1.2.3');
  assert.strictEqual(P.nextVersion('1.2.0-rc.1', 'minor'), '1.2.0');
  assert.strictEqual(P.nextVersion('2.0.0-rc.1', 'major'), '2.0.0');
  // ...but only the bump it anticipated. 1.2.3-beta is not on its way to 1.3.0.
  assert.strictEqual(P.nextVersion('1.2.3-beta', 'minor'), '1.3.0');
  assert.strictEqual(P.nextVersion('1.2.3-beta', 'major'), '2.0.0');
});

test('nextVersion: a leading v is tolerated, and never handed back', () => {
  assert.strictEqual(P.nextVersion('v1.0.16', 'patch'), '1.0.17');
});

test('nextVersion: anything that is not a version counts to nothing', () => {
  assert.strictEqual(P.nextVersion('release-2024-06', 'patch'), null);
  assert.strictEqual(P.nextVersion('', 'patch'), null);
  assert.strictEqual(P.nextVersion('1.0.0', 'sideways'), null);
});

// ── which package manager ──

test('packageManager: the packageManager field is believed first', () => {
  assert.strictEqual(P.packageManager({
    packageJson: { packageManager: 'pnpm@9.1.0' },
    files: ['yarn.lock'],
  }), 'pnpm');
});

test('packageManager: a lockfile is the next best evidence', () => {
  assert.strictEqual(P.packageManager({ files: ['pnpm-lock.yaml'] }), 'pnpm');
  assert.strictEqual(P.packageManager({ files: ['bun.lockb'] }), 'bun');
  assert.strictEqual(P.packageManager({ files: ['package-lock.json'] }), 'npm');
  assert.strictEqual(P.packageManager({ files: [] }), 'npm');
});

// Classic yarn and berry spell the same command differently, so they cannot
// share a suggestion. .yarnrc.yml is what tells them apart in a repo whose
// package.json says nothing.
test('packageManager: yarn classic and berry are told apart', () => {
  assert.strictEqual(P.packageManager({ files: ['yarn.lock'] }), 'yarn');
  assert.strictEqual(P.packageManager({ files: ['yarn.lock', '.yarnrc.yml'] }), 'yarn-berry');
  assert.strictEqual(P.packageManager({ packageJson: { packageManager: 'yarn@4.1.0' } }), 'yarn-berry');
});

// ── the suggestion ──

test('detectCommand: an ordinary npm project gets npm version', () => {
  const { command } = P.detectCommand({
    packageJson: { version: '1.0.16', scripts: { preversion: 'npm test' } },
    files: ['package.json', 'package-lock.json'],
  });
  assert.strictEqual(command, 'npm version {bump}');
});

test('detectCommand: the package manager carries into the suggestion', () => {
  assert.strictEqual(P.detectCommand({ packageJson: {}, files: ['pnpm-lock.yaml'] }).command,
    'pnpm version {bump}');
  assert.strictEqual(P.detectCommand({ packageJson: {}, files: ['yarn.lock'] }).command,
    'yarn version --{bump}');
});

test('detectCommand: a repository with its own release script gets that', () => {
  const { command } = P.detectCommand({
    packageJson: { scripts: { release: 'release-it' } },
    files: ['package.json'],
  });
  assert.strictEqual(command, 'npm run release');
});

// Changesets decides the number itself, so the suggestion must not pretend
// there is a bump to pick.
test('detectCommand: Changesets wins, and takes no bump', () => {
  const { command } = P.detectCommand({
    packageJson: { version: '1.0.0', scripts: {} },
    files: ['package.json', '.changeset'],
  });
  assert.strictEqual(command, 'npx changeset version');
  assert.strictEqual(P.takesBump(command), false);
});

test('detectCommand: with no package.json, a release is a tag', () => {
  const { command } = P.detectCommand({ files: [], tagPrefix: 'v' });
  assert.match(command, /^git tag -a v\{version\}/);
  assert.strictEqual(P.takesBump(command), true);
});

// A repository that tags without the v keeps tagging without it.
test('detectCommand: the tag suggestion follows the prefix already in use', () => {
  const { command } = P.detectCommand({ files: [], tagPrefix: '' });
  assert.match(command, /^git tag -a \{version\}/);
});

// ── filling the template in ──

test('fillCommand: both placeholders are replaced', () => {
  assert.strictEqual(P.fillCommand('npm version {bump}', 'minor', '1.1.0'), 'npm version minor');
  assert.strictEqual(
    P.fillCommand('git tag -a v{version} -m "v{version}"', 'patch', '1.0.17'),
    'git tag -a v1.0.17 -m "v1.0.17"');
});

test('fillCommand: a command with no placeholders is run as written', () => {
  assert.strictEqual(P.fillCommand('npx changeset version', 'patch', '1.0.17'), 'npx changeset version');
});

// ── what else the command will do ──

test('lifecycleSteps: the npm lifecycle scripts, in the order they run', () => {
  const steps = P.lifecycleSteps(
    { preversion: 'npm test', postversion: 'git push --follow-tags', build: 'tsc' },
    'npm version {bump}');
  assert.deepStrictEqual(steps, [
    { name: 'preversion', command: 'npm test' },
    { name: 'postversion', command: 'git push --follow-tags' },
  ]);
});

// Those scripts belong to `npm version`. A repository releasing some other way
// runs them only if its own command does, which Keep cannot know.
test('lifecycleSteps: nothing is promised for a command that is not a version bump', () => {
  assert.deepStrictEqual(P.lifecycleSteps({ preversion: 'npm test' }, 'npm run release'), []);
  assert.deepStrictEqual(P.lifecycleSteps({ preversion: 'npm test' }, 'npx changeset version'), []);
});

// ── the working copy ──

test('blockedByWorkingCopy: uncommitted changes are named before the wait', () => {
  const message = P.blockedByWorkingCopy([
    { filePath: 'git.js', status: 'modified' },
    { filePath: 'README.md', status: 'modified' },
  ]);
  assert.match(message, /git\.js/);
  assert.match(message, /README\.md/);
});

// npm's own check ignores untracked files, so a stray scratch file must not
// stop a release that would have worked.
test('blockedByWorkingCopy: untracked files do not block', () => {
  assert.strictEqual(P.blockedByWorkingCopy([{ filePath: 'notes.txt', status: 'untracked' }]), null);
  assert.strictEqual(P.blockedByWorkingCopy([]), null);
});

// A file staged *and* modified appears twice in a status list, and counting
// entries rather than paths would report one file as two.
test('blockedByWorkingCopy: a file changed twice over is still one file', () => {
  const message = P.blockedByWorkingCopy([
    { filePath: 'git.js', status: 'modified', staged: true },
    { filePath: 'git.js', status: 'modified', staged: false },
  ]);
  assert.doesNotMatch(message, /and \d+ more/);
});

// ── reading the result back ──

test('versionFromOutput: the version the command actually landed on', () => {
  assert.strictEqual(P.versionFromOutput('v1.0.17\n', '1.0.17'), '1.0.17');
  assert.strictEqual(
    P.versionFromOutput('> keep@1.0.16 preversion\n> node --test\n\nv1.0.17\n', '1.0.17'),
    '1.0.17');
});

// The command is the user's, and it may not have bumped what we expected.
test('versionFromOutput: silence falls back to what was asked for', () => {
  assert.strictEqual(P.versionFromOutput('', '1.0.17'), '1.0.17');
  assert.strictEqual(P.versionFromOutput('done\n', null), null);
});

// The run that named the release after npm: `npm version` prints v1.0.22 near
// the top, and npm's own upgrade notice trails it with four numbers of its own.
test('versionFromOutput: npm’s upgrade notice is not the release', () => {
  const output = [
    '> postversion', '> git push --follow-tags', '',
    'To https://github.com/yarism/keep.git',
    '   c4fd899..254906e  main -> main',
    ' * [new tag]         v1.0.22 -> v1.0.22',
    'v1.0.22',
    'npm notice',
    'npm notice New minor version of npm available! 11.6.2 -> 11.19.0',
    'npm notice Changelog: https://github.com/npm/cli/releases/tag/v11.19.0',
    'npm notice To update run: npm install -g npm@11.19.0',
    'npm notice', '',
  ].join('\n');
  assert.strictEqual(P.versionFromOutput(output, '1.0.22'), '1.0.22');
  // And with nothing to confirm against, the notice still does not win.
  assert.strictEqual(P.versionFromOutput(output, null), '1.0.22');
});

// A command that bumped to something other than what the panel predicted is
// still read back honestly rather than reported as the guess.
test('versionFromOutput: an unexpected bump beats the expectation', () => {
  assert.strictEqual(P.versionFromOutput('v2.0.0\n', '1.0.17'), '2.0.0');
});
