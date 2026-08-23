// renderer/ is written as ES modules and loaded by the browser as
// <script type="module">, but the root package.json says "type": "commonjs",
// so plain `import '../renderer/...'` makes Node parse those files as CommonJS
// and fail. Rather than add a nested package.json (which ends up inside the
// packaged app), the tests read the source and evaluate it as an ES module.
//
// Paths are relative to the repo root. Only works for modules with no relative
// imports of their own — a data: URL has no base to resolve them against.
// state.js qualifies; anything importing './state.js' would need a real loader.
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../../', import.meta.url);

export async function loadEsm(pathFromRoot) {
  const source = await readFile(new URL(pathFromRoot, ROOT), 'utf-8');
  const url = 'data:text/javascript;base64,' + Buffer.from(source, 'utf-8').toString('base64');
  return import(url);
}
