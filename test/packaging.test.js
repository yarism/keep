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
test('packaging: macOS ships the zip the updater needs alongside the dmg', () => {
  const targets = build.mac.target;

  assert.ok(Array.isArray(targets), 'mac.target should list both formats');
  assert.ok(targets.includes('zip'), 'macOS auto-update needs a zip target');
  assert.ok(targets.includes('dmg'), 'first-time downloads still want a dmg');
});

// Without a publish block electron-builder writes no app-update.yml into the
// bundle, and the updater has no idea where to look.
test('packaging: the update feed points at the GitHub releases', () => {
  assert.partialDeepStrictEqual(build.publish, { provider: 'github', owner: 'yarism', repo: 'keep' });
});
