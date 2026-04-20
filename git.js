const { execFile } = require('child_process');

function run(repoPath, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

exports.status = async (repoPath) => {
  const out = await run(repoPath, ['status', '--porcelain=v1', '-uall']);
  const results = [];
  // Split on newline but do NOT trim the whole output — leading spaces are significant
  const lines = out.split('\n').filter(l => l.length >= 4);
  lines.forEach(line => {
    const x = line[0], y = line[1];
    const filePath = line.substring(3);
    if (!filePath) return;

    // Staged change (index vs HEAD)
    if (x !== ' ' && x !== '?') {
      let status = 'modified';
      if (x === 'A') status = 'added';
      else if (x === 'D') status = 'deleted';
      else if (x === 'R') status = 'renamed';
      results.push({ filePath, status, staged: true, x, y });
    }

    // Unstaged change (working tree vs index)
    if (y === 'M' || y === 'D') {
      let status = y === 'D' ? 'deleted' : 'modified';
      results.push({ filePath, status, staged: false, x, y });
    }

    // Untracked
    if (x === '?' && y === '?') {
      results.push({ filePath, status: 'untracked', staged: false, x, y });
    }
  });
  return results;
};

exports.log = async (repoPath, branch, limit = 100) => {
  const args = ['log', '--format=%H%n%an%n%ae%n%aI%n%s', '-n', String(limit)];
  if (branch) args.push(branch);
  const out = await run(repoPath, args);
  const lines = out.trim().split('\n');
  const commits = [];
  for (let i = 0; i < lines.length; i += 5) {
    if (!lines[i]) break;
    commits.push({
      hash: lines[i],
      author: lines[i + 1],
      email: lines[i + 2],
      date: lines[i + 3],
      subject: lines[i + 4],
    });
  }
  return commits;
};

exports.branches = async (repoPath) => {
  const out = await run(repoPath, ['branch', '-a', '--format=%(refname:short) %(HEAD) %(upstream:short)']);
  return out.trim().split('\n').filter(Boolean).map(line => {
    const parts = line.trim().split(' ');
    const name = parts[0];
    const current = parts[1] === '*';
    const upstream = parts[2] || null;
    const isRemote = name.startsWith('origin/');
    return { name, current, upstream, isRemote };
  });
};

exports.tags = async (repoPath) => {
  const out = await run(repoPath, ['tag', '--sort=-creatordate']);
  return out.trim().split('\n').filter(Boolean);
};

exports.remotes = async (repoPath) => {
  const out = await run(repoPath, ['remote', '-v']);
  const map = {};
  out.trim().split('\n').filter(Boolean).forEach(line => {
    const [name, url] = line.split(/\s+/);
    map[name] = url;
  });
  return Object.entries(map).map(([name, url]) => ({ name, url }));
};

exports.stashes = async (repoPath) => {
  const out = await run(repoPath, ['stash', 'list', '--format=%gd %s']);
  return out.trim().split('\n').filter(Boolean).map(line => {
    const idx = line.indexOf(' ');
    return { ref: line.substring(0, idx), message: line.substring(idx + 1) };
  });
};

exports.diff = async (repoPath, filePath, staged) => {
  const args = ['diff'];
  if (staged) args.push('--cached');
  if (filePath) args.push('--', filePath);
  console.log('[git.diff] running: git', args.join(' '), 'in', repoPath);
  const result = await run(repoPath, args);
  console.log('[git.diff] result length:', result.length, 'first 100:', JSON.stringify(result.slice(0, 100)));
  // If the requested diff is empty, try the other one
  if (!result.trim()) {
    const fallbackArgs = ['diff'];
    if (!staged) fallbackArgs.push('--cached');
    if (filePath) fallbackArgs.push('--', filePath);
    console.log('[git.diff] fallback: git', fallbackArgs.join(' '));
    return run(repoPath, fallbackArgs);
  }
  return result;
};

exports.commitDetail = async (repoPath, hash) => {
  const fmt = '%H%n%an%n%ae%n%aI%n%cn%n%ce%n%cI%n%D%n%P%n%T%n%s%n%b';
  const out = await run(repoPath, ['show', '--format=' + fmt, '--stat', hash]);
  const lines = out.split('\n');
  return {
    hash: lines[0], author: lines[1], authorEmail: lines[2], authorDate: lines[3],
    committer: lines[4], committerEmail: lines[5], committerDate: lines[6],
    refs: lines[7], parents: lines[8], tree: lines[9],
    subject: lines[10], body: lines.slice(11).join('\n'),
  };
};

exports.commitDiff = async (repoPath, hash) => {
  return run(repoPath, ['diff-tree', '-p', '--stat', hash]);
};

exports.stage = (repoPath, filePath) => run(repoPath, ['add', '--', filePath]);
exports.unstage = (repoPath, filePath) => run(repoPath, ['reset', 'HEAD', '--', filePath]);
exports.stageAll = (repoPath) => run(repoPath, ['add', '-A']);
exports.commit = (repoPath, message) => run(repoPath, ['commit', '-m', message]);
exports.checkout = (repoPath, branch) => run(repoPath, ['checkout', branch]);
exports.createBranch = (repoPath, name, from) => {
  const args = ['checkout', '-b', name];
  if (from) args.push(from);
  return run(repoPath, args);
};
exports.deleteBranch = (repoPath, name) => run(repoPath, ['branch', '-d', name]);
exports.renameBranch = (repoPath, oldName, newName) => run(repoPath, ['branch', '-m', oldName, newName]);
exports.merge = (repoPath, branch) => run(repoPath, ['merge', branch]);
exports.rebase = (repoPath, branch) => run(repoPath, ['rebase', branch]);
exports.pull = (repoPath) => run(repoPath, ['pull']);
exports.push = (repoPath) => run(repoPath, ['push']);
exports.fetch = (repoPath) => run(repoPath, ['fetch', '--all']);
exports.stashSave = (repoPath, message) => {
  const args = ['stash', 'push'];
  if (message) args.push('-m', message);
  return run(repoPath, args);
};
exports.stashApply = (repoPath, index) => run(repoPath, ['stash', 'apply', `stash@{${index}}`]);
exports.stashDrop = (repoPath, index) => run(repoPath, ['stash', 'drop', `stash@{${index}}`]);
exports.revert = (repoPath, hash) => run(repoPath, ['revert', '--no-edit', hash]);
exports.createTag = (repoPath, name, ref) => {
  const args = ['tag', name];
  if (ref) args.push(ref);
  return run(repoPath, args);
};
exports.stageHunk = async (repoPath, filePath, hunkHeader) => {
  // Use git apply to stage a specific hunk
  const diff = await run(repoPath, ['diff', '--', filePath]);
  const hunks = diff.split(/(?=^@@)/m);
  const header = hunks[0]; // diff --git header
  const targetHunk = hunks.find(h => h.startsWith(hunkHeader));
  if (!targetHunk) throw new Error('Hunk not found');
  const patch = header + targetHunk;
  return new Promise((resolve, reject) => {
    const { execFile: ef } = require('child_process');
    const proc = ef('git', ['apply', '--cached', '-'], { cwd: repoPath }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
    proc.stdin.write(patch);
    proc.stdin.end();
  });
};

exports.discardHunk = async (repoPath, filePath, hunkHeader) => {
  const diff = await run(repoPath, ['diff', '--', filePath]);
  const hunks = diff.split(/(?=^@@)/m);
  const header = hunks[0];
  const targetHunk = hunks.find(h => h.startsWith(hunkHeader));
  if (!targetHunk) throw new Error('Hunk not found');
  const patch = header + targetHunk;
  return new Promise((resolve, reject) => {
    const { execFile: ef } = require('child_process');
    const proc = ef('git', ['apply', '--reverse', '-'], { cwd: repoPath }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
    proc.stdin.write(patch);
    proc.stdin.end();
  });
};

exports.discardFile = (repoPath, filePath) => run(repoPath, ['checkout', '--', filePath]);
exports.trashFile = async (repoPath, filePath) => {
  const fullPath = require('path').join(repoPath, filePath);
  const { shell } = require('electron');
  await shell.trashItem(fullPath);
};
exports.showInFinder = (repoPath, filePath) => {
  const fullPath = require('path').join(repoPath, filePath);
  require('electron').shell.showItemInFolder(fullPath);
};

exports.commitFiles = async (repoPath, hash) => {
  const out = await run(repoPath, ['diff-tree', '--no-commit-id', '-r', '--name-status', hash]);
  return out.trim().split('\n').filter(Boolean).map(line => {
    const parts = line.split('\t');
    const status = parts[0];
    const filePath = parts[1];
    let statusName = 'modified';
    if (status === 'A') statusName = 'added';
    else if (status === 'D') statusName = 'deleted';
    else if (status.startsWith('R')) statusName = 'renamed';
    return { filePath, status: statusName, statusCode: status[0] };
  });
};

exports.commitFileDiff = async (repoPath, hash, filePath) => {
  return run(repoPath, ['diff-tree', '-p', hash, '--', filePath]);
};

exports.searchLog = async (repoPath, query, field, branch, limit = 200) => {
  const args = ['log', '--format=%H%n%an%n%ae%n%aI%n%s', '-n', String(limit)];
  if (branch) args.push(branch);
  if (field === 'message') args.push('--grep=' + query, '-i');
  else if (field === 'author') args.push('--author=' + query, '-i');
  else if (field === 'hash') args.push(query);
  else if (field === 'file') args.push('--', query);
  const out = await run(repoPath, args);
  const lines = out.trim().split('\n');
  const commits = [];
  for (let i = 0; i < lines.length; i += 5) {
    if (!lines[i]) break;
    commits.push({ hash: lines[i], author: lines[i+1], email: lines[i+2], date: lines[i+3], subject: lines[i+4] });
  }
  return commits;
};
