// What ends up inside the .app.
//
// electron-builder's `files` is an allowlist, not a filter: a new main-process
// module works under `npm start` — which runs from the source tree — and is
// simply absent from the packaged build, where it becomes "Cannot find module"
// on a white screen at launch. Nothing else in the suite runs the packaged app,
// so this walks the require graph instead and insists every file it reaches is
// one electron-builder was told to copy.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { build } = require('../package.json');

// Only the shapes this project's `files` list actually uses: a bare filename
// and a directory glob. Enough to answer "would this path be copied?".
function copied(relPath) {
  return build.files.some((pattern) => {
    if (pattern === relPath) return true;
    const dir = pattern.match(/^(.+?)\/\*\*\/\*$/);
    return Boolean(dir) && relPath.startsWith(dir[1] + '/');
  });
}

// Relative requires only — a bare specifier is a node_modules dependency, which
// electron-builder resolves from package.json rather than from `files`.
function localRequires(file) {
  const source = fs.readFileSync(file, 'utf-8');
  return [...source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)].map((m) => m[1]);
}

function reachableFrom(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of localRequires(file)) {
      const resolved = require.resolve(path.resolve(path.dirname(file), spec));
      if (!resolved.includes('node_modules')) queue.push(resolved);
    }
  }
  return [...seen];
}

test('packaging: every module main.js requires is in build.files', () => {
  for (const file of reachableFrom(path.join(ROOT, 'main.js'))) {
    const rel = path.relative(ROOT, file);
    assert.ok(copied(rel), `${rel} is required at runtime but missing from package.json build.files`);
  }
});

test('packaging: the preload and its requires are in build.files too', () => {
  for (const file of reachableFrom(path.join(ROOT, 'preload.js'))) {
    const rel = path.relative(ROOT, file);
    assert.ok(copied(rel), `${rel} is required at runtime but missing from package.json build.files`);
  }
});

// The updater is the one dependency that has to survive packaging, and it is
// the only reason `dependencies` exists — listing it under devDependencies
// would leave the packaged app without it.
test('packaging: electron-updater is a real dependency, not a dev one', () => {
  const pkg = require('../package.json');

  assert.ok(pkg.dependencies && pkg.dependencies['electron-updater']);
  assert.ok(!(pkg.devDependencies || {})['electron-updater']);
});

// Squirrel.Mac cannot read a DMG, so a mac release without a zip publishes a
// feed the updater can see and nothing it can install.
//
// The arches have to be declared here rather than passed as --arm64 --x64,
// which is the subtle half. Flags split the build into one electron-builder run
// per arch, and each run overwrites the previous one's latest-mac.yml: the feed
// ends up naming a single arch, and electron-updater's filterFilesForArch finds
// nothing at all on the other one. Nothing about the artifacts looks wrong — the
// dmg and zip for both arches are sitting right there in the release.
test('packaging: macOS ships both formats for both arches in one feed', () => {
  const targets = build.mac.target;
  assert.ok(Array.isArray(targets), 'mac.target should list its formats');

  for (const format of ['dmg', 'zip']) {
    const target = targets.find((t) => t && t.target === format);
    assert.ok(target, `macOS should build a ${format}`);
    assert.ok(
      Array.isArray(target.arch) && target.arch.includes('x64') && target.arch.includes('arm64'),
      `${format} must declare both arches, or the feed will name only one`,
    );
  }
});

// The same rule, from the other side: the workflow must not reintroduce the
// flags, which would override the config above and split the build again.
test('packaging: CI does not pass arch flags that would split the mac feed', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/build.yml'), 'utf-8');
  const macArgs = workflow.match(/args: --mac.*/g) || [];

  assert.ok(macArgs.length > 0, 'the macOS build args should still be there');
  for (const line of macArgs) {
    assert.doesNotMatch(line, /--(arm64|x64|universal)/, `${line.trim()} splits latest-mac.yml per arch`);
  }
});

// Without a publish block electron-builder writes no app-update.yml into the
// bundle, and the updater has no idea where to look.
test('packaging: the update feed points at the GitHub releases', () => {
  assert.partialDeepStrictEqual(build.publish, { provider: 'github', owner: 'yarism', repo: 'keep' });
});
