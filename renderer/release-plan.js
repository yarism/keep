// What "release" means in a repository Keep did not set up.
//
// `npm version patch` is only one project's answer. Another uses pnpm, or yarn,
// or a `release` script, or Changesets, or is not a Node project at all and
// releases by tagging. So nothing here is hard-coded: the repository is read
// for signals, a command is *suggested* from them, and the suggestion is a
// plain string the user can rewrite and Keep will remember.
//
// The command is a template. `{bump}` is replaced with patch/minor/major and
// `{version}` with the version that bump produces — a template holding neither
// is simply run as written, and the version choices disappear from the panel,
// because a flow like Changesets decides the number for itself.
//
// Pure functions, so the interesting decisions can be tested without a repo.

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export const BUMPS = ['patch', 'minor', 'major'];

// What each bump is *for*, in the words the README already uses.
export const BUMP_MEANING = {
  patch: 'a fix',
  minor: 'a new feature',
  major: 'a breaking change',
};

// semver's own rules, which are not "add one to the last number": a
// prerelease is *finished* by the bump it already anticipates, so 1.2.3-beta
// patches to 1.2.3 rather than to 1.2.4. Getting this wrong would put a number
// on screen that npm then disagrees with, which is worse than showing none.
export function nextVersion(version, bump) {
  const m = SEMVER.exec(String(version || '').trim());
  if (!m) return null;
  let major = Number(m[1]), minor = Number(m[2]), patch = Number(m[3]);
  const pre = m[4];

  if (bump === 'major') {
    if (!(pre && minor === 0 && patch === 0)) major++;
    minor = 0; patch = 0;
  } else if (bump === 'minor') {
    if (!(pre && patch === 0)) minor++;
    patch = 0;
  } else if (bump === 'patch') {
    if (!pre) patch++;
  } else return null;

  return `${major}.${minor}.${patch}`;
}

// Whether a version string is one this panel can count from. A tag like
// "release-2024-06" is a fine tag and a hopeless starting point for a bump.
export const isSemver = (version) => SEMVER.test(String(version || '').trim());

// Which package manager the repository is actually using. The `packageManager`
// field is the one deliberate statement of it; a lockfile is the next best
// evidence, and is what most repositories have instead.
export function packageManager({ packageJson, files } = {}) {
  const declared = packageJson && typeof packageJson.packageManager === 'string'
    ? /^([a-z]+)@?(\d+)?/.exec(packageJson.packageManager.trim())
    : null;
  if (declared) {
    const name = declared[1];
    if (name === 'yarn') return Number(declared[2]) >= 2 ? 'yarn-berry' : 'yarn';
    if (['npm', 'pnpm', 'bun'].includes(name)) return name;
  }
  const has = (f) => Array.isArray(files) && files.includes(f);
  if (has('bun.lockb') || has('bun.lock')) return 'bun';
  if (has('pnpm-lock.yaml')) return 'pnpm';
  // Berry keeps its settings in .yarnrc.yml; classic yarn has no such file and
  // spells the same command differently, so the two cannot share a suggestion.
  if (has('yarn.lock')) return has('.yarnrc.yml') ? 'yarn-berry' : 'yarn';
  return 'npm';
}

const VERSION_COMMAND = {
  npm: 'npm version {bump}',
  pnpm: 'pnpm version {bump}',
  bun: 'bun pm version {bump}',
  'yarn-berry': 'yarn version {bump}',
  yarn: 'yarn version --{bump}',   // classic wants it as a flag
};

// The suggestion, and — just as important — why it was suggested, so the field
// below it is obviously a guess that can be corrected rather than a setting
// that must be right.
export function detectCommand(signals = {}) {
  const { packageJson, files = [], tagPrefix = 'v' } = signals;
  const pm = packageManager(signals);
  const scripts = (packageJson && packageJson.scripts) || {};

  if (files.includes('.changeset')) {
    return {
      command: 'npx changeset version',
      reason: 'This repository uses Changesets, which works out the number itself.',
    };
  }
  if (scripts.release) {
    const run = pm === 'npm' ? 'npm run release' : `${pm.replace('-berry', '')} release`;
    return { command: run, reason: 'Running the repository’s own "release" script.' };
  }
  if (packageJson) {
    return {
      command: VERSION_COMMAND[pm],
      reason: pm === 'npm'
        ? 'From package.json.'
        : `From package.json, using ${pm.replace('-berry', '')}.`,
    };
  }
  // No package.json at all. A release here is a tag, which is the one thing
  // every repository in this window has in common.
  return {
    command: `git tag -a ${tagPrefix}{version} -m "${tagPrefix}{version}" && git push --follow-tags`,
    reason: 'No package.json, so a release here is a tag.',
  };
}

export const takesBump = (command) => /\{bump\}|\{version\}/.test(String(command || ''));

export function fillCommand(command, bump, version) {
  return String(command || '')
    .replace(/\{bump\}/g, bump || '')
    .replace(/\{version\}/g, version || '');
}

// The lifecycle scripts an `npm version` (or pnpm/yarn equivalent) will run on
// its way past, in the order they happen. Worth spelling out: the reason this
// takes half a minute rather than an instant is usually a `preversion` running
// the whole test suite, and a run that looks stuck is only a run whose first
// step was never named.
export function lifecycleSteps(scripts = {}, command = '') {
  if (!/\bversion\b/.test(command) || !takesBump(command)) return [];
  return ['preversion', 'version', 'postversion']
    .filter(name => scripts && scripts[name])
    .map(name => ({ name, command: scripts[name] }));
}

// npm refuses to bump a dirty working copy, and says so only after you have
// waited for the tests. Untracked files are fine by it, so they are fine here.
export function blockedByWorkingCopy(status) {
  const changed = (status || []).filter(f => f.status !== 'untracked');
  if (changed.length === 0) return null;
  const names = [...new Set(changed.map(f => f.filePath))];
  const list = names.slice(0, 3).join(', ');
  const rest = names.length > 3 ? `, and ${names.length - 3} more` : '';
  return `Commit or stash first — the working copy has uncommitted changes (${list}${rest}). ` +
    'Most release commands refuse to run against one.';
}

// The version a finished run landed on, read back from what it printed rather
// than assumed: the command is the user's, and it may not have bumped what we
// expected — or anything at all.
//
// npm ends a good many runs with a notice that a new npm is available, and that
// notice is full of version numbers — npm's, not this project's. Left in, they
// are the last thing printed, and the release gets announced under npm's
// version. So the notice goes, and the version we asked for wins if the output
// confirms it anywhere; the last match is only for a command that bumped to
// something we did not predict.
export function versionFromOutput(output, fallback) {
  const text = String(output || '')
    .split('\n')
    .filter(line => !/^\s*npm notice\b/.test(line))
    .join('\n');
  const matches = text.match(/v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g);
  if (!matches || matches.length === 0) return fallback || null;
  const found = matches.map(m => m.replace(/^v/, ''));
  if (fallback && found.includes(fallback)) return fallback;
  return found[found.length - 1];
}
