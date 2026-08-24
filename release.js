// Running the one command that cuts a release.
//
// Everything else in Keep runs `git` and nothing else. This runs whatever the
// repository's release command happens to be, which brings two problems git
// never had.
//
// The first is PATH. An app launched from Finder inherits the launchd
// environment, not a shell's — /usr/bin:/bin:/usr/sbin:/sbin and nothing more.
// `git` is there because the command line tools put it there; `npm` almost
// never is, because nvm, fnm, Homebrew and Volta all install it somewhere a
// shell profile adds later. So the login shell is asked once for its PATH and
// the answer is reused, which is why the command that works in your terminal
// works here.
//
// The second is that nobody is watching. The child gets no stdin, so a command
// that decides to ask a question reads EOF and gives up rather than waiting
// forever behind a window that looks frozen — and git's own prompts are
// switched off the same way every network command in git.js switches them off,
// because a release usually ends in a push.

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { nonInteractiveEnv } = require('./git');

// Long enough for a test suite and a push over a bad connection; short enough
// that a wedged command gives the window back the same afternoon.
const TIMEOUT_MS = 15 * 60 * 1000;

const isWindows = process.platform === 'win32';

// ── What this repository looks like ──

// Files worth knowing about by name. Read once, cheaply — a directory listing
// of the repository root, filtered to the handful that mean something.
const SIGNAL_FILES = [
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  'bun.lockb', 'bun.lock', '.yarnrc.yml', '.changeset',
];

function readPackageJson(repoPath) {
  try {
    const raw = fs.readFileSync(path.join(repoPath, 'package.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      name: typeof parsed.name === 'string' ? parsed.name : null,
      version: typeof parsed.version === 'string' ? parsed.version : null,
      packageManager: typeof parsed.packageManager === 'string' ? parsed.packageManager : null,
      scripts: parsed.scripts && typeof parsed.scripts === 'object' ? parsed.scripts : {},
    };
  } catch {
    // A malformed package.json is not this panel's business to report — it
    // simply means there is no version to read here.
    return null;
  }
}

exports.inspect = (repoPath) => {
  let entries = [];
  try { entries = fs.readdirSync(repoPath); } catch {}
  return {
    packageJson: readPackageJson(repoPath),
    files: SIGNAL_FILES.filter(f => entries.includes(f)),
  };
};

// ── The environment the command runs in ──

let cachedPath = null;

// Ask the user's own shell what its PATH is. `-l` sources the login profile and
// `-i` the interactive one, because nvm and fnm are conventionally set up in
// .zshrc, which only an interactive shell reads. The sentinel is there because
// a profile is free to print things, and its chatter must not be mistaken for
// the answer.
function loginPath() {
  if (cachedPath) return Promise.resolve(cachedPath);
  if (isWindows) {
    cachedPath = process.env.PATH || '';
    return Promise.resolve(cachedPath);
  }
  return new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh';
    const script = 'printf "\\n__KEEP_PATH__%s__KEEP_END__\\n" "$PATH"';
    execFile(shell, ['-lic', script],
      { timeout: 5000, env: { ...process.env, TERM: 'dumb' } },
      (_err, stdout) => {
        cachedPath = parseShellPath(stdout) || fallbackPath();
        resolve(cachedPath);
      });
  });
};

// The answer, pulled out from between the sentinels. A profile is free to
// print things — a version-manager banner, a fortune, an `echo` someone left in
// — and its chatter must not be mistaken for the answer. Null when the shell
// never got as far as printing one.
//
// Pure, so the parsing can be tested against a profile that talks.
function parseShellPath(stdout) {
  const found = /__KEEP_PATH__([\s\S]*?)__KEEP_END__/.exec(String(stdout || ''));
  const value = found ? found[1].trim() : '';
  return value || null;
}

// A shell that would not answer still leaves the two places a Mac most often
// keeps node, which beats giving up.
function fallbackPath() {
  return [process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean).join(':');
}

exports.parseShellPath = parseShellPath;

async function childEnv() {
  return {
    ...nonInteractiveEnv(),
    PATH: await loginPath(),
    // Progress bars and colour are written for a terminal. There isn't one, and
    // the panel showing this output is not going to interpret escape codes.
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    npm_config_color: 'false',
    npm_config_progress: 'false',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
  };
}

// ── Running it ──

let current = null;

exports.isRunning = () => current !== null;

// Kills the whole tree rather than the shell that fronts it: `npm version` is
// several processes deep by the time a test suite is running, and killing only
// the top one orphans the rest.
function killTree(child) {
  if (isWindows) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); }
  catch { try { child.kill('SIGTERM'); } catch {} }
}

exports.cancel = () => {
  if (!current) return false;
  current.cancelled = true;
  // Cancelled before there is anything to kill — asking the shell for its PATH
  // is the one thing that happens first, and it takes a moment.
  if (current.child) killTree(current.child);
  return true;
};

// `onChunk` is called with output as it arrives; the promise settles when the
// command is done. Resolves either way — a command that failed is a result to
// show, not an exception to throw.
exports.run = async (repoPath, command, onChunk) => {
  if (current) return { ok: false, message: 'A release is already running.' };
  const text = String(command || '').trim();
  if (!text) return { ok: false, message: 'No command to run.' };

  // Claimed before the first await, not after it: resolving the environment
  // takes long enough for a second click to get past a check made later.
  const state = { child: null, cancelled: false, timedOut: false, output: '' };
  current = state;

  const env = await childEnv();
  if (state.cancelled) { current = null; return { ok: false, cancelled: true, message: 'Stopped.', output: '' }; }

  const [file, args] = isWindows
    ? [process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', text]]
    : ['/bin/sh', ['-c', text]];

  const child = spawn(file, args, {
    cwd: repoPath,
    env,
    // No stdin at all: a prompt reads EOF and the command fails in a second
    // instead of hanging with nothing on screen to say why.
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group, so cancelling can take the children with it.
    detached: !isWindows,
  });

  state.child = child;

  const timer = setTimeout(() => {
    state.timedOut = true;
    killTree(child);
  }, TIMEOUT_MS);

  const collect = (stream) => (data) => {
    const chunk = data.toString();
    state.output += chunk;
    if (onChunk) onChunk({ stream, text: chunk });
  };
  child.stdout.on('data', collect('out'));
  child.stderr.on('data', collect('err'));

  return new Promise((resolve) => {
    const settle = (result) => {
      clearTimeout(timer);
      current = null;
      resolve({ ...result, output: state.output });
    };

    child.on('error', (err) => settle({
      ok: false,
      message: err.code === 'ENOENT'
        ? 'Could not start a shell to run the command.'
        : err.message,
    }));

    child.on('close', (code) => {
      if (state.timedOut) {
        return settle({
          ok: false,
          message: `Stopped after ${Math.round(TIMEOUT_MS / 60000)} minutes with no result. ` +
            'The command may be waiting for an answer Keep cannot give it.',
        });
      }
      if (state.cancelled) return settle({ ok: false, cancelled: true, message: 'Stopped.' });
      if (code === 0) return settle({ ok: true, code });
      settle({ ok: false, code, message: explainFailure(text, state.output, code) });
    });
  });
};

// The last line of a failed command is usually the point of it, but three
// failures are worth naming outright because their own wording sends you
// looking in the wrong place.
//
// Pure, so it can be tested without running anything.
function explainFailure(command, output, code) {
  const text = String(output || '');
  const name = String(command || '').trim().split(/\s+/)[0] || 'The command';

  if (/(^|\n)[^\n]*(command not found|: not found|is not recognized)/i.test(text)) {
    return `${name} was not found on the PATH Keep got from your shell.\n` +
      'Install it, or edit the command to give the full path to it.';
  }
  if (/Git working directory not clean|working tree is dirty|uncommitted changes/i.test(text)) {
    return 'The working copy has uncommitted changes, and the release command will not run against one.';
  }
  if (/terminal prompts disabled|could not read Username|Authentication failed|Permission denied \(publickey/i.test(text)) {
    return 'The push at the end could not authenticate.\n' +
      'Keep cannot prompt for credentials — store them with a credential helper, or run the push once in a terminal.';
  }

  return lastMeaningfulLine(text) || `${name} exited with code ${code}.`;
}

// The last line a command prints is usually the point of it — unless it is npm,
// which signs off with four lines of bookkeeping (an exit code, the directory,
// the command it just ran, and twice the path to a debug log). Taking the true
// last line there reports the log's filename as the reason the release failed.
const EPILOGUE = [
  /^npm (error|ERR!) A complete log of this run/i,
  /^\/.*\.log$/,                              // ...and the path on the line after it
  /^npm (error|ERR!) (code|path|command|errno|syscall|signal|argv)\b/i,
  /^npm (error|ERR!)$/i,
];

// npm is also the wrong way round: it states the cause first and follows it
// with advice ("To see a list of scripts, run:"). So npm's output is read from
// the top and everything else from the bottom, where a last line still is the
// point.
function lastMeaningfulLine(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const substantive = lines.filter(l => !EPILOGUE.some(p => p.test(l)));
  if (substantive.length === 0) return lines.pop() || '';
  const npm = lines.some(l => /^npm (error|ERR!)\b/i.test(l));
  return npm ? substantive[0] : substantive[substantive.length - 1];
}

exports.explainFailure = explainFailure;
