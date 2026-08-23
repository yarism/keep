const { execFile } = require('child_process');

function run(repoPath, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

// The network commands write everything a user would want to read — "Everything
// up-to-date", the ref updates, the transfer summary — to stderr, so resolving
// stdout alone hands the UI an empty string for exactly the commands whose
// result it needs to report.
function runReporting(repoPath, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve([stdout, stderr].filter(s => s && s.trim()).join('\n'));
    });
  });
}

exports.status = async (repoPath) => {
  // -z gives NUL-terminated records and turns off C-style quoting, so paths with
  // spaces or non-ASCII characters arrive verbatim instead of as `"sp ace.txt"`
  // or `"caf\303\251.txt"`. It also splits a rename into two fields rather than
  // packing them into one "old -> new" string.
  const out = await run(repoPath, ['status', '--porcelain=v1', '-uall', '-z']);
  const results = [];
  const fields = out.split('\0');
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (entry.length < 4) continue;
    const x = entry[0], y = entry[1];
    const filePath = entry.substring(3);
    if (!filePath) continue;

    // A rename or copy is followed by a second field holding the original path.
    // Under -z the new path comes first, so `filePath` above is already the one
    // that exists on disk — the one every path-taking git command wants.
    let oldPath = null;
    if (x === 'R' || x === 'C') oldPath = fields[++i] || null;

    // Staged change (index vs HEAD)
    if (x !== ' ' && x !== '?') {
      let status = 'modified';
      if (x === 'A') status = 'added';
      else if (x === 'D') status = 'deleted';
      else if (x === 'R') status = 'renamed';
      results.push({ filePath, oldPath, status, staged: true, x, y });
    }

    // Unstaged change (working tree vs index)
    if (y === 'M' || y === 'D') {
      let status = y === 'D' ? 'deleted' : 'modified';
      results.push({ filePath, oldPath, status, staged: false, x, y });
    }

    // Untracked
    if (x === '?' && y === '?') {
      results.push({ filePath, oldPath, status: 'untracked', staged: false, x, y });
    }
  }
  return results;
};

// One record per commit, fields separated by US (0x1f) and records by RS
// (0x1e). The old newline-per-field format could not carry %D — a decoration
// list holds commas and spaces but the fixed field count is what breaks first
// once any field may be empty, and %D is empty for most commits.
const LOG_FORMAT = '%H%x1f%an%x1f%ae%x1f%aI%x1f%P%x1f%D%x1f%s%x1e';

// "HEAD -> main, origin/main, tag: v1.0" — what %D gives, turned into something
// the UI can label. Remote names are asked for rather than guessed from the
// slash, since a local branch may well be called `feature/thing`.
function parseDecoration(decoration, remoteNames) {
  if (!decoration) return [];
  return decoration.split(',').map(s => s.trim()).filter(Boolean).map(ref => {
    if (ref.startsWith('tag: ')) return { name: ref.slice(5), type: 'tag' };
    if (ref.startsWith('HEAD -> ')) return { name: ref.slice(8), type: 'head' };
    if (ref === 'HEAD') return { name: 'HEAD', type: 'head' };
    if (remoteNames.some(r => ref.startsWith(r + '/'))) return { name: ref, type: 'remote' };
    return { name: ref, type: 'branch' };
  });
}

function parseLog(out, remoteNames) {
  return out.split('\x1e')
    .map(rec => rec.replace(/^[\r\n]+/, ''))
    .filter(rec => rec.trim())
    .map(rec => {
      const f = rec.split('\x1f');
      return {
        hash: f[0],
        author: f[1],
        email: f[2],
        date: f[3],
        // First parent first — the graph draws it as the lane that carries on.
        parents: f[4] ? f[4].split(' ').filter(Boolean) : [],
        refs: parseDecoration(f[5], remoteNames),
        subject: f[6] || '',
      };
    });
}

// Cheap and network-free; the decoration parser needs it to tell origin/main
// from a local branch that merely has a slash in its name.
async function remoteNames(repoPath) {
  try {
    return (await run(repoPath, ['remote'])).split('\n').map(s => s.trim()).filter(Boolean);
  } catch { return []; }
}

exports.log = async (repoPath, branch, limit = 100) => {
  const args = ['log', '--format=' + LOG_FORMAT, '-n', String(limit)];
  if (branch) args.push(branch);
  const [out, remotes] = await Promise.all([run(repoPath, args), remoteNames(repoPath)]);
  return parseLog(out, remotes);
};

// The commits on `ref` that no remote-tracking branch contains — i.e. what a
// push would send. Reported per commit rather than as a count so history can
// mark each unpushed row, and empty in a repo with no remotes at all, where
// every commit would otherwise qualify and the whole list would light up.
exports.unpushed = async (repoPath, ref, limit = 500) => {
  const hasRemote = await run(repoPath, ['for-each-ref', '--count=1', 'refs/remotes']).catch(() => '');
  if (!hasRemote.trim()) return [];
  const out = await run(repoPath, [
    'rev-list', '--max-count=' + String(limit), ref || 'HEAD', '--not', '--remotes',
  ]).catch(() => '');
  return out.trim().split('\n').filter(Boolean);
};

// "[ahead 2, behind 1]", "[behind 3]", "[gone]", or empty when in sync — the
// one place git will tell us how far a branch has drifted from its upstream
// without a second command per branch.
function parseTrack(track) {
  const ahead = /\bahead (\d+)/.exec(track || '');
  const behind = /\bbehind (\d+)/.exec(track || '');
  return {
    ahead: ahead ? Number(ahead[1]) : 0,
    behind: behind ? Number(behind[1]) : 0,
    gone: /\[gone\]/.test(track || ''),
  };
}
exports.parseTrack = parseTrack;

exports.branches = async (repoPath) => {
  // Tab-separated: %(upstream:track) contains spaces and commas, so the old
  // split-on-space parse would have read "[ahead" as the upstream name.
  const format = '%(refname:short)%09%(HEAD)%09%(upstream:short)%09%(upstream:track)';
  const out = await run(repoPath, ['branch', '-a', '--format=' + format]);
  const branches = [];
  let detachedHead = false;
  const remotes = await remoteNames(repoPath);
  out.split('\n').filter(Boolean).forEach(line => {
    const [name, head, upstreamRaw, track] = line.split('\t');
    const current = head === '*';
    const upstream = upstreamRaw || null;
    const isRemote = remotes.some(r => name.startsWith(r + '/'));
    // Detect detached HEAD — git outputs "(HEAD" as the name
    if (name.startsWith('(HEAD')) {
      detachedHead = true;
      return; // skip this pseudo-branch
    }
    branches.push({ name, current, upstream, isRemote, ...parseTrack(track) });
  });
  // If detached, find the current commit hash
  if (detachedHead) {
    try {
      const hash = (await run(repoPath, ['rev-parse', '--short', 'HEAD'])).trim();
      branches.unshift({ name: hash, current: true, upstream: null, isRemote: false, detached: true, ahead: 0, behind: 0, gone: false });
    } catch {}
  }
  return branches;
};

// A cheap snapshot of everything the UI keys off: where HEAD points and what
// every ref resolves to. The poller compares this between ticks so changes made
// outside the app (a terminal commit, a checkout, a fetch) get picked up instead
// of leaving the sidebar and history frozen at whatever they were on open.
// Cheap "is this path still a working copy?" check, used before reopening the
// repository the app was last left in — the folder may have been moved,
// deleted, or had its .git removed since.
exports.isRepo = async (repoPath) => {
  try {
    const out = await run(repoPath, ['rev-parse', '--is-inside-work-tree']);
    return out.trim() === 'true';
  } catch { return false; }
};

exports.repoFingerprint = async (repoPath) => {
  const [head, refs] = await Promise.all([
    // `rev-parse HEAD --abbrev-ref HEAD` prints the sha, then the branch name
    // (or literally "HEAD" when detached). Fails in a repo with no commits yet.
    run(repoPath, ['rev-parse', 'HEAD', '--abbrev-ref', 'HEAD']).catch(() => ''),
    run(repoPath, ['for-each-ref', '--format=%(objectname) %(refname)']).catch(() => ''),
  ]);
  const [hash = '', ref = ''] = head.trim().split('\n');
  return {
    hash,
    branch: ref === 'HEAD' || !ref ? null : ref,
    fingerprint: head + refs,
  };
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
// A staged rename is two index entries — dropping the new path alone would
// leave the deletion of the old one staged, so pass both when there is a pair.
exports.unstage = (repoPath, filePath, oldPath) => {
  const paths = oldPath && oldPath !== filePath ? [filePath, oldPath] : [filePath];
  return run(repoPath, ['reset', 'HEAD', '--', ...paths]);
};
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
exports.merge = (repoPath, branch) => runReporting(repoPath, ['merge', branch]);
exports.rebase = (repoPath, branch) => runReporting(repoPath, ['rebase', branch]);
exports.pull = (repoPath) => runReporting(repoPath, ['pull']);
exports.push = (repoPath) => runReporting(repoPath, ['push']);
exports.fetch = (repoPath) => runReporting(repoPath, ['fetch', '--all']);
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
// Local only — deleting the remote tag is a separate, far more destructive
// operation and is deliberately not exposed here.
exports.deleteTag = (repoPath, name) => run(repoPath, ['tag', '-d', name]);

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
  // -M turns on rename detection (diff.renames is not honoured by diff-tree, so
  // without this a rename always arrives as a delete plus an add). -z keeps
  // paths unquoted and separates the two paths of a rename into their own
  // fields, which is what makes the R record parseable at all.
  const out = await run(repoPath, ['diff-tree', '--no-commit-id', '-r', '-M', '-z', '--name-status', hash]);
  const fields = out.split('\0').filter(Boolean);
  const files = [];
  for (let i = 0; i < fields.length;) {
    const code = fields[i++];
    let statusName = 'modified';
    if (code[0] === 'A') statusName = 'added';
    else if (code[0] === 'D') statusName = 'deleted';
    else if (code[0] === 'R') statusName = 'renamed';
    // R and C spell out both paths: the original first, then the new one.
    const oldPath = (code[0] === 'R' || code[0] === 'C') ? fields[i++] : null;
    const filePath = fields[i++];
    if (!filePath) break;
    files.push({ filePath, oldPath, status: statusName, statusCode: code[0] });
  }
  return files;
};

exports.commitFileDiff = async (repoPath, hash, filePath) => {
  return run(repoPath, ['diff-tree', '-p', hash, '--', filePath]);
};

exports.searchLog = async (repoPath, query, field, branch, limit = 200) => {
  const args = ['log', '--format=%H%n%an%n%ae%n%aI%n%s', '-n', String(limit)];
  if (field === 'message') {
    if (branch) args.push(branch);
    args.push('--grep=' + query, '-i');
  } else if (field === 'author') {
    if (branch) args.push(branch);
    args.push('--author=' + query, '-i');
  } else if (field === 'hash') {
    // For hash search, just show that single commit
    args.length = 0;
    args.push('log', '--format=%H%n%an%n%ae%n%aI%n%s', '-n', '1', query);
  } else if (field === 'file') {
    if (branch) args.push(branch);
    // Wrap in quotes-safe glob: match filename anywhere in the tree
    const safeQuery = query.replace(/[[\]{}()\\]/g, '\\$&');
    args.push('--', ':(glob)**/*' + safeQuery + '*');
  }
  console.log('[git.searchLog] running: git', args.join(' '));
  const out = await run(repoPath, args);
  if (!out.trim()) return [];
  const lines = out.trim().split('\n');
  const commits = [];
  for (let i = 0; i < lines.length; i += 5) {
    if (!lines[i]) break;
    commits.push({ hash: lines[i], author: lines[i+1], email: lines[i+2], date: lines[i+3], subject: lines[i+4] });
  }
  return commits;
};
