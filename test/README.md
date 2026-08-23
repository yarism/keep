# Tests

```bash
npm test
```

No test framework and no new dependencies — everything runs on Node's built-in
`node:test` and `node:assert`. Node 18+ and a `git` binary on PATH are all that's
needed. `npm run test:watch` reruns on change.

## What's covered

| File | Covers |
| --- | --- |
| `git-read.test.js` | `git.js` read paths: status/log/branch/tag/remote/stash/diff parsing, commit detail and file lists, log search, the repo fingerprint |
| `git-write.test.js` | `git.js` write paths: stage/unstage/commit, branch create-delete-rename, merge/rebase, stash, revert, tag, discard, hunk staging |
| `state.test.mjs` | `renderer/modules/state.js`: HTML escaping, the titlebar string, and the branch/tag pin reconciliation rules |

## How the git tests work

`git.js` is a thin wrapper over the `git` binary, so mocking `child_process`
would only assert that the arguments haven't changed. Instead each test builds a
real repository in a temp directory (`test/helpers/repo.js`), runs the real
command, and checks the resulting repo state.

Repos are created with `GIT_CONFIG_GLOBAL=/dev/null`, a fixed identity and a
fixed default branch, so results don't depend on the developer's `~/.gitconfig`.
They're removed in an `after` hook.

Not covered: `pull`, `push` and `fetch` (network), and `trashFile` /
`showInFinder` (require an Electron runtime).

## Renderer modules

`renderer/` is written as ES modules, but the root `package.json` says
`"type": "commonjs"`, so Node parses those files as CommonJS and a plain import
fails. `test/helpers/esm.mjs` reads the source and evaluates it as an ES module
instead, which keeps the workaround inside the test tree rather than adding a
nested `package.json` to the packaged app.

That trick only handles modules with no relative imports of their own. The other
renderer modules import `./state.js` and drive real DOM nodes, so testing them
would mean adding a DOM implementation (e.g. jsdom) as a dev dependency.
