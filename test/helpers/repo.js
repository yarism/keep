// Helpers for building throwaway git repositories on disk.
//
// git.js is a thin wrapper over the `git` binary, so the only tests worth having
// are ones that run real git. Every repo is created under a fresh temp dir and
// removed again by cleanup(), and the git environment is pinned (no global
// config, fixed identity, fixed default branch) so results don't depend on
// whatever is in the developer's ~/.gitconfig.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const created = [];

const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Test Author',
  GIT_AUTHOR_EMAIL: 'author@example.com',
  GIT_COMMITTER_NAME: 'Test Committer',
  GIT_COMMITTER_EMAIL: 'committer@example.com',
  GIT_AUTHOR_DATE: '2024-01-01T12:00:00+00:00',
  GIT_COMMITTER_DATE: '2024-01-01T12:00:00+00:00',
};

function git(repoPath, ...args) {
  return execFileSync('git', args, { cwd: repoPath, env: ENV, encoding: 'utf-8' });
}

// A repo with one commit ("initial") containing README.md, on branch `main`.
function makeRepo() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-test-'));
  created.push(repoPath);
  git(repoPath, 'init', '-q', '-b', 'main');
  git(repoPath, 'config', 'user.name', 'Test Committer');
  git(repoPath, 'config', 'user.email', 'committer@example.com');
  git(repoPath, 'config', 'commit.gpgsign', 'false');
  write(repoPath, 'README.md', '# Test repo\n');
  git(repoPath, 'add', '-A');
  git(repoPath, 'commit', '-q', '-m', 'initial');
  return repoPath;
}

// An initialised repo with no commits at all — the edge case several git.js
// functions have to survive (rev-parse HEAD fails there).
function makeEmptyRepo() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-test-empty-'));
  created.push(repoPath);
  git(repoPath, 'init', '-q', '-b', 'main');
  git(repoPath, 'config', 'user.name', 'Test Committer');
  git(repoPath, 'config', 'user.email', 'committer@example.com');
  return repoPath;
}

function write(repoPath, filePath, contents) {
  const full = path.join(repoPath, filePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return full;
}

function read(repoPath, filePath) {
  return fs.readFileSync(path.join(repoPath, filePath), 'utf-8');
}

function remove(repoPath, filePath) {
  fs.rmSync(path.join(repoPath, filePath), { recursive: true, force: true });
}

function exists(repoPath, filePath) {
  return fs.existsSync(path.join(repoPath, filePath));
}

// Commit whatever is in the working tree, and return the new commit's full sha.
function commitAll(repoPath, message) {
  git(repoPath, 'add', '-A');
  git(repoPath, 'commit', '-q', '-m', message);
  return git(repoPath, 'rev-parse', 'HEAD').trim();
}

function cleanup() {
  while (created.length) {
    fs.rmSync(created.pop(), { recursive: true, force: true });
  }
}

module.exports = { git, makeRepo, makeEmptyRepo, write, read, remove, exists, commitAll, cleanup, ENV };
