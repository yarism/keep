const { execFile } = require('child_process');

// Nothing here has a terminal. `execFile` gives git no TTY, so a command that
// decides to ask for a password, a passphrase, or approval of an unknown host
// key has nobody to ask and simply waits — forever, with the window frozen and
// not a word on screen. Every command that can reach the network therefore runs
// with the asking switched off, so git fails in a second instead of hanging;
// explainNetworkError() below turns that failure into something actionable.
//
// Setups that already work keep working: this only suppresses *prompts*, so a
// configured credential helper and a key held by ssh-agent are still consulted
// as usual.
// Keep polls the working copy every few seconds, and `git status` does not just
// read the index — it writes the refreshed stat cache back, which means taking
// .git/index.lock. A poll that lands on the same moment as a `git commit` or
// `git add` typed in a terminal makes that command fail outright with "Unable to
// create '.../index.lock': File exists", for a repository nobody else is using.
// GIT_OPTIONAL_LOCKS=0 drops exactly the locks git takes as a side effect and
// keeps the ones an operation actually needs, so Keep's own add/commit/reset
// still work while the terminal stays usable alongside the app.
function gitEnv() {
  return {
    ...process.env,
    GIT_OPTIONAL_LOCKS: '0',
  };
}

function nonInteractiveEnv() {
  return {
    ...gitEnv(),
    GIT_TERMINAL_PROMPT: '0',   // no username/password prompt on https
    GIT_ASKPASS: 'echo',        // ...nor through a helper
    SSH_ASKPASS: 'echo',
    GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -oStrictHostKeyChecking=accept-new',
  };
}

// Long enough for a real transfer over a poor connection, short enough that a
// wedged command gives the window back rather than owning it for good.
const NETWORK_TIMEOUT_MS = 120000;

// A prompt refused and a prompt answered wrongly produce the same class of
// unhelpful output — "could not read Username", "Authentication failed",
// "Permission denied (publickey)" — none of which says what to do next. Since
// Keep has no credential UI, saying so plainly, and naming the fix that lives
// outside Keep, is the whole of the help it can offer.
//
// Pure, so it can be tested without a repo or a network.
function explainNetworkError(action, message, { timedOut = false } = {}) {
  const text = String(message || '');
  const lead = `${action} failed`;

  if (timedOut) {
    return `${lead}: no response after ${Math.round(NETWORK_TIMEOUT_MS / 1000)} seconds, so it was stopped.\n` +
      'The remote may be unreachable, or it may be waiting for a credential Keep cannot supply.';
  }
  if (/could not read (Username|Password)|Authentication failed|Invalid username or password|terminal prompts disabled/i.test(text)) {
    return `${lead}: the remote asked for a username and password.\n` +
      'Keep cannot prompt for them. Store them once with a credential helper — ' +
      '`git config --global credential.helper osxkeychain`, then run the command once in a terminal — ' +
      'or switch the remote to SSH.';
  }
  if (/Permission denied \(publickey|Could not open a connection to your authentication agent|no such identity/i.test(text)) {
    return `${lead}: the remote rejected your SSH key.\n` +
      'Add the key to the agent with `ssh-add` (or `ssh-add --apple-use-keychain` on macOS) and try again.';
  }
  if (/Enter passphrase|passphrase for key/i.test(text)) {
    return `${lead}: your SSH key is passphrase-protected and Keep cannot ask for the passphrase.\n` +
      'Unlock the key once with `ssh-add --apple-use-keychain` and it will stay unlocked.';
  }
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(text)) {
    return `${lead}: the host key was not accepted.\n` +
      'Connect once from a terminal to review and accept it.';
  }
  if (/Could not resolve host|unable to access|Network is unreachable|Connection refused|Operation timed out/i.test(text)) {
    return `${lead}: the remote could not be reached. Check your connection and the remote's URL.`;
  }
  return text.trim() || `${lead}.`;
}

// macOS gates ~/Desktop, ~/Documents and ~/Downloads per app. An app that has
// not been granted the folder gets EPERM on everything inside it, and git
// reports that as "Unable to read current working directory" — which reads like
// a broken repository rather than a permission that was never asked for.
//
// Worth naming precisely, because every symptom points the wrong way: the repo
// opens, the folder plainly exists, and every list in the window is simply
// empty. The only clue is a word in git's stderr.
//
// Pure, so it can be tested without revoking anything.
function explainAccessError(repoPath, message) {
  const text = String(message || '');

  if (!/Operation not permitted|EPERM|Permission denied|Unable to read current working directory/i.test(text)) {
    return null;
  }
  // "Permission denied" is also what a genuinely unreadable file says, so keep
  // the ordinary filesystem case out of the macOS-privacy explanation.
  if (/Permission denied \(publickey/i.test(text)) return null;

  const folder = protectedFolder(repoPath);
  const where = folder ? `your ${folder} folder` : 'this folder';
  return `macOS is blocking Keep from reading ${where}, so none of this repository can be loaded.\n` +
    'Give Keep access in System Settings → Privacy & Security → Files and Folders ' +
    '(or Full Disk Access), then reopen the repository.';
}

// The three folders macOS protects by default. Named in the message because
// "grant access to the folder" is useless without knowing which one to look for
// in a settings list.
function protectedFolder(repoPath) {
  const home = process.env.HOME || '';
  for (const name of ['Desktop', 'Documents', 'Downloads']) {
    if (home && String(repoPath || '').startsWith(`${home}/${name}/`)) return name;
  }
  return null;
}

function run(repoPath, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: repoPath, env: gitEnv(), maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
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
    execFile('git', args, { cwd: repoPath, env: gitEnv(), maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve([stdout, stderr].filter(s => s && s.trim()).join('\n'));
    });
  });
}

// runReporting for the commands that touch a remote: same output handling, but
// unable to hang and able to explain itself when it fails. `action` is the word
// the UI put on the button, so the message reads as an answer to what was asked.
function runNetwork(repoPath, args, action) {
  return new Promise((resolve, reject) => {
    execFile('git', args,
      { cwd: repoPath, env: nonInteractiveEnv(), timeout: NETWORK_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          // execFile kills a timed-out child with a signal; that, not the
          // message, is what distinguishes "too slow" from "refused".
          const timedOut = Boolean(err.killed || err.signal);
          reject(new Error(explainNetworkError(action, stderr || err.message, { timedOut })));
        } else {
          resolve([stdout, stderr].filter(s => s && s.trim()).join('\n'));
        }
      });
  });
}

// The seven unmerged states porcelain v1 can report, and what each one means
// in words a person can act on. Anything else with an x or y of 'U' cannot
// occur, but see isConflict() below for the belt-and-braces check.
const CONFLICT_KINDS = {
  DD: 'both deleted',
  AU: 'added by us',
  UD: 'deleted by them',
  UA: 'added by them',
  DU: 'deleted by us',
  AA: 'both added',
  UU: 'both modified',
};

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

    // An unmerged path is neither staged nor unstaged: both sides of the
    // conflict are sitting in the index at once. Reporting it as "staged,
    // modified" — which is what the plain x/y reading below produces for "UU" —
    // tells the user a conflict they have not looked at is ready to commit.
    const conflictKind = CONFLICT_KINDS[x + y];
    if (conflictKind) {
      results.push({
        filePath, oldPath, status: 'conflicted', conflicted: true,
        conflictKind, staged: false, x, y,
      });
      continue;
    }

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
    // origin/HEAD is a pointer at the remote's default branch, not a branch
    // anyone works on — it would just double every origin/main chip.
    if (remoteNames.some(r => ref === r + '/HEAD')) return null;
    if (remoteNames.some(r => ref.startsWith(r + '/'))) return { name: ref, type: 'remote' };
    return { name: ref, type: 'branch' };
  }).filter(Boolean);
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

// `all` widens the view from one branch's ancestry to every ref in the repo —
// local branches, remote-tracking branches and tags — which is the only way
// unmerged work shows up at all. --date-order interleaves them by date while
// keeping every parent below its children, so the lanes stay drawable.
exports.log = async (repoPath, branch, limit = 100, opts = {}) => {
  const args = ['log', '--format=' + LOG_FORMAT, '-n', String(limit)];
  if (opts.all) args.push('--all', '--date-order');
  else if (branch) args.push(branch);
  const [out, remotes] = await Promise.all([run(repoPath, args), remoteNames(repoPath)]);
  return parseLog(out, remotes);
};

// The commits on `ref` that no remote-tracking branch contains — i.e. what a
// push would send. Reported per commit rather than as a count so history can
// mark each unpushed row, and empty in a repo with no remotes at all, where
// every commit would otherwise qualify and the whole list would light up.
exports.unpushed = async (repoPath, ref, limit = 500, opts = {}) => {
  const hasRemote = await run(repoPath, ['for-each-ref', '--count=1', 'refs/remotes']).catch(() => '');
  if (!hasRemote.trim()) return [];
  // Matching the log above: one branch, or every local branch at once. Only
  // local ones — a remote-tracking branch is by definition already pushed.
  const scope = opts.all ? '--branches' : (ref || 'HEAD');
  const out = await run(repoPath, [
    'rev-list', '--max-count=' + String(limit), scope, '--not', '--remotes',
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
    // refs/remotes/origin/HEAD shortens to plain "origin", which is neither a
    // branch nor named like a remote one — left alone it shows up in the
    // sidebar as a local branch called "origin" that nobody created.
    if (remotes.includes(name)) return;
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

// Is the repository in the middle of something — a merge, a rebase, a
// cherry-pick, a revert — and what is still in the way? Both halves matter: the
// files tell you what to fix, the operation tells you how to get out, and
// neither is discoverable from a file list alone.
//
// git has no plumbing command for "what am I in the middle of"; the answer is
// which files exist in the git directory, which is what git's own prompt script
// reads too.
const _gitDirs = new Map();

async function gitDir(repoPath) {
  if (_gitDirs.has(repoPath)) return _gitDirs.get(repoPath);
  const dir = (await run(repoPath, ['rev-parse', '--absolute-git-dir'])).trim();
  _gitDirs.set(repoPath, dir);
  return dir;
}

exports.repoState = async (repoPath) => {
  const fs = require('fs');
  const path = require('path');
  let dir;
  try { dir = await gitDir(repoPath); }
  catch { return { kind: null, conflicts: [], branch: null, step: 0, total: 0 }; }

  const has = (p) => fs.existsSync(path.join(dir, p));
  const read = (p) => { try { return fs.readFileSync(path.join(dir, p), 'utf-8').trim(); } catch { return ''; } };

  let kind = null, branch = null, step = 0, total = 0;
  if (has('rebase-merge') || has('rebase-apply')) {
    kind = 'rebase';
    const d = has('rebase-merge') ? 'rebase-merge' : 'rebase-apply';
    branch = read(d + '/head-name').replace(/^refs\/heads\//, '') || null;
    step = Number(read(d + '/msgnum')) || 0;
    total = Number(read(d + '/end')) || 0;
  } else if (has('MERGE_HEAD')) {
    kind = 'merge';
    // The branch being merged is not stored as a ref anywhere — MERGE_MSG's
    // "Merge branch 'x'" is the only place its name survives.
    const m = /'([^']+)'/.exec(read('MERGE_MSG'));
    branch = m ? m[1] : null;
  } else if (has('CHERRY_PICK_HEAD')) {
    kind = 'cherry-pick';
  } else if (has('REVERT_HEAD')) {
    kind = 'revert';
  }

  // Listed even with no operation in flight: `git stash pop` can leave conflicts
  // behind without any of the files above existing.
  const out = await run(repoPath, ['diff', '--name-only', '--diff-filter=U', '-z']).catch(() => '');
  return { kind, conflicts: out.split('\0').filter(Boolean), branch, step, total };
};

// Resolving a conflict is, to git, just staging the file — but "git add" is a
// poor name for "I have dealt with this", so the intent gets its own verb.
exports.markResolved = (repoPath, filePath) => run(repoPath, ['add', '--', filePath]);

// Take one side wholesale. --ours is what the branch you are on had, --theirs
// is what the branch you are merging in has; both only make sense when both
// sides still have the file, which is why the delete conflicts get keep/remove
// instead (see the context menu).
exports.useOurs = async (repoPath, filePath) => {
  await run(repoPath, ['checkout', '--ours', '--', filePath]);
  return run(repoPath, ['add', '--', filePath]);
};
exports.useTheirs = async (repoPath, filePath) => {
  await run(repoPath, ['checkout', '--theirs', '--', filePath]);
  return run(repoPath, ['add', '--', filePath]);
};
// The two ways out of a delete/modify conflict.
exports.keepFile = (repoPath, filePath) => run(repoPath, ['add', '--', filePath]);
exports.removeFile = (repoPath, filePath) => run(repoPath, ['rm', '-f', '--', filePath]);

// The working-tree file as it stands, conflict markers and all. A conflicted
// file has no useful `git diff`: what you need to read is the merged text.
exports.fileContents = async (repoPath, filePath) => {
  const fs = require('fs');
  const path = require('path');
  return fs.promises.readFile(path.join(repoPath, filePath), 'utf-8');
};

// core.editor=true short-circuits the editor git would otherwise open for the
// commit message — `true` is a command that exits 0 having done nothing, so the
// message it already prepared is taken as-is.
const NO_EDITOR = ['-c', 'core.editor=true'];

exports.continueOperation = (repoPath, kind) => {
  if (kind === 'rebase') return runReporting(repoPath, [...NO_EDITOR, 'rebase', '--continue']);
  if (kind === 'cherry-pick') return runReporting(repoPath, [...NO_EDITOR, 'cherry-pick', '--continue']);
  if (kind === 'revert') return runReporting(repoPath, [...NO_EDITOR, 'revert', '--continue']);
  // A merge has nothing to "continue": it finishes by committing what the
  // resolution produced, with the message git already wrote into MERGE_MSG.
  return runReporting(repoPath, ['commit', '--no-edit']);
};

exports.abortOperation = (repoPath, kind) => {
  const verb = kind === 'merge' ? 'merge' : kind;
  return runReporting(repoPath, [verb, '--abort']);
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

// Null when the repository is readable. Otherwise the sentence to put on screen.
// Separate from isRepo because the two questions have different answers: a
// folder Keep cannot read is still a repository, and saying "not a repository"
// sends you looking for the wrong problem.
exports.accessProblem = async (repoPath) => {
  try {
    await run(repoPath, ['rev-parse', '--git-dir']);
    return null;
  } catch (e) {
    return explainAccessError(repoPath, e.message);
  }
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

// -s keeps the diff and the stat out of it: the body is everything after the
// subject line, and anything git appends below would land in it. The file list
// comes from commitFiles() anyway.
exports.commitDetail = async (repoPath, hash) => {
  const fmt = '%H%n%an%n%ae%n%aI%n%cn%n%ce%n%cI%n%D%n%P%n%T%n%s%n%b';
  const out = await run(repoPath, ['show', '-s', '--format=' + fmt, hash]);
  const lines = out.split('\n');
  return {
    hash: lines[0], author: lines[1], authorEmail: lines[2], authorDate: lines[3],
    committer: lines[4], committerEmail: lines[5], committerDate: lines[6],
    refs: lines[7], parents: lines[8], tree: lines[9],
    subject: lines[10], body: lines.slice(11).join('\n').replace(/\s+$/, ''),
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
// A message may be a subject and a body; -m takes the whole thing, blank line
// and all. --amend replaces the last commit rather than adding one, which is a
// rewrite — the caller is expected to have said so out loud (see the warning in
// the commit box when the commit is already on a remote).
exports.commit = (repoPath, message, opts = {}) => {
  const args = ['commit'];
  if (opts.amend) args.push('--amend');
  return runReporting(repoPath, [...args, '-m', message]);
};

// The message of the commit being amended, so the box can be filled with it
// instead of asking the user to retype what git already knows.
exports.headMessage = async (repoPath) => {
  const out = await run(repoPath, ['log', '-1', '--format=%B']).catch(() => '');
  const text = out.replace(/\n+$/, '');
  const split = text.indexOf('\n');
  return split === -1
    ? { subject: text, body: '' }
    : { subject: text.slice(0, split), body: text.slice(split + 1).replace(/^\n/, '') };
};
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
exports.pull = (repoPath) => runNetwork(repoPath, ['pull'], 'Pull');
// A branch with no upstream cannot just be pushed — git refuses and explains
// how, which is a poor first experience for "I made a branch and want it on the
// server". `publish` is that explanation carried out.
exports.push = async (repoPath, opts = {}) => {
  if (!opts.setUpstream) return runNetwork(repoPath, ['push'], 'Push');
  const remote = (await remoteNames(repoPath))[0] || 'origin';
  const branch = (await run(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  return runNetwork(repoPath, ['push', '--set-upstream', remote, branch], 'Publish');
};
exports.fetch = (repoPath) => runNetwork(repoPath, ['fetch', '--all'], 'Fetch');

// The same fetch, but for a timer with nobody watching. It shares the
// non-interactive environment with every other network command, and differs in
// the two things that follow from having no audience: a shorter leash, and no
// way to raise an alarm. Failure is expected and ordinary here — being offline
// is not an error worth interrupting anyone for — so this resolves either way
// and reports which it was, leaving the explaining to the buttons a person
// actually pressed.
exports.fetchQuiet = (repoPath) => new Promise((resolve) => {
  execFile('git', ['fetch', '--all', '--quiet'],
    { cwd: repoPath, env: nonInteractiveEnv(), timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
    (err) => resolve({ ok: !err, error: err ? (err.message || '').trim() : null }));
});
exports.stashSave = (repoPath, message) => {
  const args = ['stash', 'push'];
  if (message) args.push('-m', message);
  return run(repoPath, args);
};
exports.stashApply = (repoPath, index) => run(repoPath, ['stash', 'apply', `stash@{${index}}`]);
exports.stashDrop = (repoPath, index) => run(repoPath, ['stash', 'drop', `stash@{${index}}`]);
exports.revert = (repoPath, hash) => run(repoPath, ['revert', '--no-edit', hash]);
// Copy one commit onto the current branch. Reporting, because a cherry-pick
// that stops on a conflict says why on stderr, and that sentence is the whole
// explanation the UI has to offer before the conflict banner takes over.
exports.cherryPick = (repoPath, hash) => runReporting(repoPath, ['cherry-pick', hash]);
exports.createTag = (repoPath, name, ref) => {
  const args = ['tag', name];
  if (ref) args.push(ref);
  return run(repoPath, args);
};
// Local only — deleting the remote tag is a separate, far more destructive
// operation and is deliberately not exposed here.
exports.deleteTag = (repoPath, name) => run(repoPath, ['tag', '-d', name]);

// Cut a one-hunk patch out of a file's diff.
//
// The hunk is identified by *where* it was in the diff, and the header is then
// checked against it. Position alone would silently act on the wrong hunk once
// the file changed under the UI; the header alone was the previous approach,
// and while ranges make it unique within one diff, that is only true of the
// diff it came from — by the time the click lands, the diff may be a different
// one. Both together mean a stale click fails loudly instead of editing code
// the user never looked at.
//
// (Splitting on a line-initial "@@" is safe: every line of a diff body carries
// a one-character prefix, so nothing but a hunk header starts at column zero.)
function cutHunk(diff, hunkHeader, index) {
  const parts = diff.split(/(?=^@@)/m);
  const preamble = parts[0];   // "diff --git", index, ---, +++
  const hunks = parts.slice(1);

  let hunk = null;
  if (Number.isInteger(index) && hunks[index] && hunks[index].startsWith(hunkHeader)) {
    hunk = hunks[index];
  } else {
    // No position given (or it no longer holds): fall back to the header, but
    // only when exactly one hunk answers to it.
    const matches = hunks.filter(h => h.startsWith(hunkHeader));
    if (matches.length === 1) hunk = matches[0];
  }
  if (!hunk) {
    throw new Error('Hunk not found — the file has changed since it was shown. '
      + 'Reselect the file and try again.');
  }
  return preamble + hunk;
}

function applyPatch(repoPath, patch, args) {
  return new Promise((resolve, reject) => {
    const { execFile: ef } = require('child_process');
    const proc = ef('git', ['apply', ...args, '-'], { cwd: repoPath, env: gitEnv() }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
    proc.stdin.write(patch);
    proc.stdin.end();
  });
}

exports.stageHunk = async (repoPath, filePath, hunkHeader, index) => {
  const diff = await run(repoPath, ['diff', '--', filePath]);
  return applyPatch(repoPath, cutHunk(diff, hunkHeader, index), ['--cached']);
};

exports.discardHunk = async (repoPath, filePath, hunkHeader, index) => {
  const diff = await run(repoPath, ['diff', '--', filePath]);
  return applyPatch(repoPath, cutHunk(diff, hunkHeader, index), ['--reverse']);
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

// `--name-status -z` output, from either diff-tree or diff. -z keeps paths
// unquoted and separates the two paths of a rename into their own fields, which
// is what makes the R record parseable at all.
function parseNameStatus(out) {
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
}

exports.commitFiles = async (repoPath, hash) => {
  // -M turns on rename detection (diff.renames is not honoured by diff-tree, so
  // without this a rename always arrives as a delete plus an add).
  const out = await run(repoPath, ['diff-tree', '--no-commit-id', '-r', '-M', '-z', '--name-status', hash]);
  return parseNameStatus(out);
};

exports.commitFileDiff = async (repoPath, hash, filePath) => {
  return run(repoPath, ['diff-tree', '-p', hash, '--', filePath]);
};

// ── Comparing two refs ──
//
// What a pull request shows is not `base..head` but the diff from their merge
// base to head: the three-dot form. The difference between them is everything
// that landed on base after the branch left it — with two dots those commits
// read as the branch *removing* them, which is how a review ends up arguing
// about code nobody in it touched.
const mergeBaseRange = (base, head) => `${base}...${head}`;

exports.rangeFiles = async (repoPath, base, head) => {
  const out = await run(repoPath, ['diff', '--name-status', '-M', '-z', mergeBaseRange(base, head)]);
  return parseNameStatus(out);
};

exports.rangeFileDiff = async (repoPath, base, head, filePath) => {
  return run(repoPath, ['diff', mergeBaseRange(base, head), '--', filePath]);
};

// A pull request's own commits: the ones head has and base does not. Two dots
// here, deliberately — the question is which commits belong to the branch, not
// what its net effect on the files is.
exports.rangeCommits = async (repoPath, base, head, limit = 200) => {
  const [out, remotes] = await Promise.all([
    run(repoPath, ['log', '--format=' + LOG_FORMAT, '-n', String(limit), `${base}..${head}`]),
    remoteNames(repoPath),
  ]);
  return parseLog(out, remotes);
};

// GitHub publishes every pull request as a read-only ref on the origin
// repository, so the head of a PR — including one from a fork Keep has no
// remote for — is one ordinary fetch away. Nothing is checked out and no local
// branch is created: the ref lands under refs/keep/, clear of the user's own
// refs and of everything the sidebar lists.
//
// The number is interpolated into a refspec, so it is checked rather than
// trusted, even coming from the API.
exports.fetchPullRequest = async (repoPath, remote, number) => {
  const n = String(number);
  if (!/^[0-9]{1,9}$/.test(n)) throw new Error(`Not a pull request number: ${number}`);
  const local = `refs/keep/pr/${n}`;
  // Leading + so a force-pushed branch updates the ref instead of failing.
  await runNetwork(repoPath, ['fetch', remote, `+refs/pull/${n}/head:${local}`], 'Fetch pull request');
  return local;
};

exports.searchLog = async (repoPath, query, field, branch, limit = 200, opts = {}) => {
  const args = ['log', '--format=' + LOG_FORMAT, '-n', String(limit)];
  // Search whatever the list is showing: the branch it is pinned to, or every
  // ref when it is showing all branches. Searching HEAD's branch regardless —
  // which is what this did — quietly answered a different question than the one
  // on screen.
  const scope = () => {
    if (opts.all) args.push('--all');
    else if (branch) args.push(branch);
  };
  if (field === 'message') {
    scope();
    args.push('--grep=' + query, '-i');
  } else if (field === 'author') {
    scope();
    args.push('--author=' + query, '-i');
  } else if (field === 'hash') {
    // For hash search, just show that single commit
    args.length = 0;
    args.push('log', '--format=' + LOG_FORMAT, '-n', '1', query);
  } else if (field === 'file') {
    scope();
    // Wrap in quotes-safe glob: match filename anywhere in the tree
    const safeQuery = query.replace(/[[\]{}()\\]/g, '\\$&');
    args.push('--', ':(glob)**/*' + safeQuery + '*');
  }
  const [out, remotes] = await Promise.all([run(repoPath, args), remoteNames(repoPath)]);
  return parseLog(out, remotes);
};

exports.explainNetworkError = explainNetworkError;
exports.explainAccessError = explainAccessError;
exports.NETWORK_TIMEOUT_MS = NETWORK_TIMEOUT_MS;
