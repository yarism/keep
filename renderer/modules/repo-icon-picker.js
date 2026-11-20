// The dialog behind a repository row's "Change Icon…": pictures the repository
// already has, a grid of emoji, or any image on disk. Picking one closes it at
// once; there is nothing to confirm about a picture that can be changed back.
import { $ } from './state.js';
import { EMOJI, ICON_SIZE, rankIconCandidates, validIcon } from '../repo-icon.js';
import { toast } from './toast.js';

// Resolves to the new icon, to null for "back to the folder", or to undefined
// when the dialog was dismissed and nothing should change.
export function pickRepoIcon(repo) {
  return new Promise(resolve => {
    const overlay = $('#repo-icon-overlay');
    const found = $('#repo-icon-found');
    const foundLabel = $('#repo-icon-found-label');
    const grid = $('#repo-icon-emoji');
    const reset = $('#repo-icon-reset');
    const current = validIcon(repo.icon);
    let done = false;

    $('#repo-icon-title').textContent = `Icon for ${repo.name}`;
    reset.hidden = !current;

    grid.innerHTML = '';
    EMOJI.forEach(emoji => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'repo-icon-choice repo-icon-emoji' + (current?.emoji === emoji ? ' selected' : '');
      b.textContent = emoji;
      b.addEventListener('click', () => finish({ emoji }));
      grid.appendChild(b);
    });

    found.innerHTML = '';
    foundLabel.hidden = false;
    found.hidden = false;
    found.textContent = 'Looking for an icon in this repository…';
    found.classList.add('searching');
    fillFound(repo.path, found, foundLabel, () => done, async (dataUrl) => {
      finish(await asIcon(dataUrl));
    });

    function finish(value) {
      if (done) return;
      done = true;
      overlay.hidden = true;
      $('#repo-icon-choose').removeEventListener('click', onChoose);
      $('#repo-icon-cancel').removeEventListener('click', onCancel);
      reset.removeEventListener('click', onReset);
      overlay.removeEventListener('mousedown', onBackdrop);
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    }
    async function onChoose() {
      const dataUrl = await window.git.chooseRepoIcon(repo.path);
      if (!dataUrl) return;
      const icon = await asIcon(dataUrl);
      if (icon) finish(icon);
    }
    function onCancel() { finish(undefined); }
    function onReset() { finish(null); }
    function onBackdrop(e) { if (e.target === overlay) finish(undefined); }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(undefined); }
    }

    $('#repo-icon-choose').addEventListener('click', onChoose);
    $('#repo-icon-cancel').addEventListener('click', onCancel);
    reset.addEventListener('click', onReset);
    overlay.addEventListener('mousedown', onBackdrop);
    document.addEventListener('keydown', onKey, true);
    overlay.hidden = false;
    (grid.querySelector('.selected') || grid.firstElementChild)?.focus();
  });
}

// The search runs while the dialog is already up: the emoji do not wait on it,
// and a repository with no icon of its own just says so.
async function fillFound(repoPath, found, label, closed, onPick) {
  let candidates = [];
  try { candidates = rankIconCandidates(await window.git.repoIconFiles(repoPath)); } catch {}
  const urls = await Promise.all(candidates.map(c =>
    window.git.readRepoIcon(repoPath, c.path).catch(() => null)));
  // Only pictures the browser can actually draw make it into the row: an .ico
  // with nothing but a PNG-less legacy bitmap, say, is dropped here rather
  // than shown as a broken image.
  const drawable = (await Promise.all(candidates.map(async (c, i) =>
    urls[i] && await loads(urls[i]) ? { ...c, url: urls[i] } : null))).filter(Boolean);
  if (closed()) return;
  found.classList.remove('searching');
  found.innerHTML = '';
  if (!drawable.length) {
    found.textContent = 'No favicon or app icon found in this repository.';
    return;
  }
  drawable.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'repo-icon-choice repo-icon-image';
    b.title = c.path;
    const img = document.createElement('img');
    img.src = c.url;
    img.alt = '';
    b.appendChild(img);
    b.addEventListener('click', () => onPick(c.url));
    found.appendChild(b);
  });
}

function load(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('unreadable image'));
    img.src = url;
  });
}

async function loads(url) {
  try { await load(url); return true; } catch { return false; }
}

// Scales any drawable picture into the ICON_SIZE square PNG that is kept,
// letterboxed rather than cropped: an app icon is square already, and a wide
// logo cut down to its middle is no longer the logo.
async function asIcon(dataUrl) {
  let img;
  try { img = await load(dataUrl); }
  catch { toast('That image could not be read.', { type: 'error' }); return undefined; }
  // An SVG drawn without a width or height has no natural size; it scales to
  // whatever it is drawn at.
  const w = img.naturalWidth || ICON_SIZE;
  const h = img.naturalHeight || ICON_SIZE;
  const scale = Math.min(ICON_SIZE / w, ICON_SIZE / h);
  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (ICON_SIZE - dw) / 2, (ICON_SIZE - dh) / 2, dw, dh);
  return validIcon({ image: canvas.toDataURL('image/png') }) || undefined;
}
