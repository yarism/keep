// A repository's own picture in the repository list, so a row can be found by
// eye rather than read. Three kinds, stored on the repository's entry in
// repositories.json under `icon`:
//
//   { emoji: '🦊' }                         one of the cute set below
//   { image: 'data:image/png;base64,...' }  a picture, scaled down to 64px
//   (absent)                                the folder, as before
//
// Pictures are kept as small PNGs in the entry itself rather than as a path to
// the original: the original may be a 1024px app icon, it may move, and the
// list must not wait on a file read per row.

export const ICON_SIZE = 64;

export const EMOJI = [
  '🦊', '🐱', '🐶', '🐼', '🐨', '🐯', '🦁', '🐸',
  '🐵', '🐧', '🦉', '🐢', '🐙', '🦄', '🐝', '🐞',
  '🦋', '🐳', '🦖', '🐉', '🐌', '🦔', '🐰', '🐻',
  '🌵', '🌸', '🌻', '🍀', '🍄', '🌈', '⭐', '🌙',
  '☀️', '⚡', '🔥', '💧', '❄️', '🌊', '🍎', '🍋',
  '🍉', '🍓', '🍒', '🥑', '🍩', '🍪', '🧁', '☕',
  '🚀', '🛸', '🎈', '🎮', '🎨', '🎸', '📚', '💎',
  '🔮', '🧩', '🏰', '⚓', '🎯', '🧪', '🔑', '🏔️',
];

// What a stored value is allowed to be. Anything else reads as no icon, so a
// hand-edited or half-written entry falls back to the folder instead of
// putting arbitrary markup in the list.
export function validIcon(icon) {
  if (!icon || typeof icon !== 'object') return null;
  if (typeof icon.emoji === 'string' && icon.emoji.length > 0 && icon.emoji.length <= 16) {
    return { emoji: icon.emoji };
  }
  if (typeof icon.image === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(icon.image)) {
    return { image: icon.image };
  }
  return null;
}

// ── Finding the repository's own icon ──
//
// The search reads the file list git already has (tracked, plus untracked
// files that are not ignored, so a freshly generated favicon counts) and ranks
// the pictures in it by how much they look like the project's face: a favicon
// or an app icon first, a logo after, anything merely named "icon" last. The
// renderer shows the best few and lets the eye decide, so the ranking only has
// to put the right one near the top, not pick it.

// The formats an <img> can draw. .icns is left out: Chromium cannot read it,
// and a project that has one has the .iconset or a PNG next to it.
export const IMAGE_EXTENSIONS = ['png', 'svg', 'ico', 'jpg', 'jpeg', 'webp', 'gif'];

const IMAGE_RE = new RegExp(`\\.(${IMAGE_EXTENSIONS.join('|')})$`, 'i');

// Folders whose pictures are someone else's, or are pictures of the app rather
// than its face: dependencies, build output, test fixtures, documentation.
const SKIP_DIR_RE = /(^|\/)(node_modules|vendor|vendors|third[_-]?party|Pods|Carthage|\.build|DerivedData|dist|out|coverage|__snapshots__|fixtures?|test|tests|__tests__|spec|e2e|screenshots?|docs?|examples?|\.next|\.nuxt|\.git)\//i;

// Where a web or app project keeps its face. Being here is worth a little, not
// a lot: the name says far more than the folder.
const HOME_DIR_RE = /^((public|static|assets|app|src|src\/app|resources|res|build|web|www|images?|img|media|\.github|branding|brand)\/)*[^/]+$/i;

export function isImagePath(file) {
  return IMAGE_RE.test(file);
}

function nameScore(base, file) {
  const name = base.toLowerCase();
  if (/^favicon(\.|-|_)/.test(name)) return 100;
  if (/^apple-touch-icon/.test(name)) return 92;
  // An Xcode asset catalog's app icon, whatever the PNGs inside are called.
  if (/(^|\/)appicon[^/]*\.appiconset\//i.test(file)) return 90;
  if (/^(app[-_]?icon|appicon)(\.|-|_|@)/.test(name)) return 88;
  if (/^ic_launcher(_round)?\./.test(name)) return 86;
  if (/^icon(\.|@)/.test(name)) return 84;
  if (/^(android-chrome|mstile|pwa|maskable)[-_]/.test(name)) return 80;
  // A macOS .iconset's members: icon_512x512@2x.png.
  if (/^icon[-_]\d/.test(name)) return 78;
  if (/^logo(\.|-|_|@)/.test(name)) return 70;
  if (/logo/.test(name)) return 50;
  if (/^icon[-_]/.test(name)) return 40;
  return 0;
}

// Bigger is better, since every picture is scaled down to the same 64px: of an
// iconset's ten sizes the one that survives scaling best is the largest. An
// SVG has no size and every size, so it counts as large.
function sizeHint(base) {
  if (/\.svg$/i.test(base)) return 6;
  const nums = (base.match(/\d{2,4}/g) || []).map(Number);
  let n = nums.length ? Math.max(...nums) : 0;
  if (/@3x/.test(base)) n *= 3;
  else if (/@2x/.test(base)) n *= 2;
  if (n >= 512) return 6;
  if (n >= 180) return 4;
  if (n >= 64) return 2;
  if (n > 0 && n < 32) return -4;
  return 0;
}

// Android says size with the folder instead: mipmap-xxxhdpi holds the largest
// copy of the same launcher icon.
function densityHint(file) {
  const m = file.match(/(^|\/)(?:mipmap|drawable)-(x{0,3})hdpi\//i);
  return m ? 1 + m[2].length * 2 : 0;
}

// Ranks `files` (paths relative to the repository root) and returns the best
// `limit` as { path, score }, best first. Pictures that do not look like an
// icon at all are left out, rather than padding the list with screenshots.
export function rankIconCandidates(files, limit = 6) {
  const ranked = [];
  for (const file of files) {
    if (!isImagePath(file) || SKIP_DIR_RE.test(file)) continue;
    const base = file.slice(file.lastIndexOf('/') + 1);
    const named = nameScore(base, file);
    if (named === 0) continue;
    const depth = file.split('/').length - 1;
    let score = named + sizeHint(base) + densityHint(file) - depth * 2;
    if (HOME_DIR_RE.test(file)) score += 6;
    // A folder of many icons is a UI icon set (icons/arrow.svg, icons/close.svg)
    // and not one face.
    if (/(^|\/)icons\//i.test(file) && named < 84) score -= 30;
    ranked.push({ path: file, score });
  }
  ranked.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
  // The same picture in several sizes is one choice, and the largest of them
  // already sorted first. Several sizes look like: an iconset's or asset
  // catalog's members, Android's mipmap-hdpi … mipmap-xxxhdpi copies, and
  // favicon.ico next to favicon-32x32.png.
  const seen = new Set();
  const out = [];
  for (const c of ranked) {
    const key = familyKey(c.path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length === limit) break;
  }
  return out;
}

function familyKey(file) {
  const slash = file.lastIndexOf('/');
  const dir = file.slice(0, slash + 1);
  const base = file.slice(slash + 1);
  if (/\.(app)?iconset\/$/i.test(dir)) return dir;
  const stem = base.toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/@\dx$/, '')
    .replace(/[-_]?\d+(x\d+)?$/, '');
  const folder = dir.replace(/(^|\/)mipmap-[^/]+\/$/i, '$1mipmap/');
  return folder + stem;
}
