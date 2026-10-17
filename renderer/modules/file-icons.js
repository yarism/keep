// File-type icons for the rows of the file list, as Finder draws them, the way
// Tower shows them. The main process asks macOS; this side keeps what came
// back, by extension, because every .js file has the same icon and a list of
// fifty of them should cost one round trip rather than fifty.
//
// The list is redrawn on every status refresh, so an icon already known is
// handed over synchronously and goes straight into the markup. Waiting on a
// promise even for those would blank every icon for a frame on each redraw.

const ready = new Map();    // key → data URL, for icons that have arrived
const pending = new Map();  // key → promise of a data URL or null

function keyFor(filePath) {
  const name = filePath.split('/').pop();
  const dot = name.lastIndexOf('.');
  // No extension, or a dotfile: the icon can be the file's own, so it is
  // looked up by path rather than shared.
  return dot > 0 ? `ext:${name.slice(dot + 1).toLowerCase()}` : `path:${filePath}`;
}

// The icon if it is already here, or null. Safe to put in an src attribute: a
// data URL from nativeImage holds no quotes.
export function fileIconNow(filePath) {
  return ready.get(keyFor(filePath)) || null;
}

function fetchIcon(repoPath, filePath) {
  const key = keyFor(filePath);
  if (ready.has(key)) return Promise.resolve(ready.get(key));
  if (pending.has(key)) return pending.get(key);
  const request = Promise.resolve()
    .then(() => window.git.fileIcon(repoPath, filePath))
    .then((icon) => {
      pending.delete(key);
      if (!icon || !icon.url) return null;
      // A deleted file only gets the generic icon, which must not go on to
      // stand for every other file of its type.
      if (icon.exists) ready.set(key, icon.url);
      return icon.url;
    })
    // An app started before this existed has no handler for it until it is
    // relaunched; the list simply goes without icons until then.
    .catch(() => { pending.delete(key); return null; });
  pending.set(key, request);
  return request;
}

// Fills in an <img class="file-icon"> that was drawn before its icon arrived.
export function paintFileIcon(img, repoPath, filePath) {
  if (!img || img.getAttribute('src')) return;
  fetchIcon(repoPath, filePath).then((url) => { if (url) img.src = url; });
}
