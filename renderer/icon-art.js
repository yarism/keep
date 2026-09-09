// The app icon, as code.
//
// The icon has always been drawn rather than painted (scripts/generate-icon.js
// rasterises it into assets/ at build time), so the only thing standing between
// one icon and eight was that the colours were written into the drawing. They
// are a parameter here instead, and the drawing itself moved out of the build
// script so that the app can run it too: the same function fills the .icns that
// ships and the Dock icon you switch to at runtime, which is the only way the
// two can be guaranteed to be the same picture.
//
// Both callers matter to how this file is written. node-canvas (the build) and
// the browser (the app) implement the same 2D context API, so the drawing below
// touches nothing else, no DOM and no fs, and takes the context it is given.
//
// It also has no relative imports, and must keep none: the build script loads
// it the way test/helpers/esm.mjs does, by evaluating the source as a data URL,
// which leaves nothing for a relative specifier to resolve against.

// A palette is three points on the diagonal: the light corner, the colour the
// icon actually reads as, and the near-black it sinks into.
//
// They are not picked by eye. Indigo is the one that was drawn and tuned, so it
// is the reference, and every other palette takes its lightness and its chroma
// from indigo's three stops and changes only the hue. That is the whole rule,
// and it is the reason the set looks like a set: a palette that drifts lighter
// or greyer than indigo reads as washed out the moment the two sit side by side,
// which is exactly what the first attempt at this did.
//
// It also decides which hues can be here at all. Orange peaks in colourfulness
// around lightness 0.76 and yellow-green around 0.94, both far too pale to hold
// a white castle; forced down to indigo's 0.51 they turn to brown and olive. So
// the warm end is represented by copper, at the last hue that stays a colour
// when it goes deep, and there is no yellow. Onyx is the other exception, a
// near-neutral by design rather than a hue with the chroma squeezed out.
//
// The two shadows the drawing casts are derived from the dark stop, which is
// what keeps a palette down to three colours. A palette may name them instead,
// and indigo does: the derived pair lands a few points off the values the
// original drawing used, and the icon that has always shipped should still be
// the icon that ships.
export const ICON_PALETTES = [
  // Indigo is the icon Keep has always had, so its stops are the literal ones
  // from the original drawing rather than anything derived. Anyone who never
  // opens the picker keeps exactly this, to the pixel.
  {
    id: 'indigo', name: 'Indigo', stops: ['#7a86f5', '#4f46e5', '#1e1b4b'],
    shadow: 'rgba(15, 10, 50, 0.4)', shade: 'rgba(10, 5, 40, 0.28)',
  },
  { id: 'plum', name: 'Plum', stops: ['#c76ac5', '#a50ba6', '#381038'] },
  { id: 'rose', name: 'Rose', stops: ['#e56268', '#c00030', '#440b11'] },
  { id: 'copper', name: 'Copper', stops: ['#eb8561', '#b9491c', '#3b190d'] },
  { id: 'green', name: 'Green', stops: ['#45ac4e', '#007c1f', '#002d05'] },
  { id: 'forest', name: 'Forest', stops: ['#00ab8d', '#007862', '#002b22'] },
  { id: 'teal', name: 'Teal', stops: ['#00a2ce', '#007191', '#002836'] },
  { id: 'ocean', name: 'Ocean', stops: ['#3995f3', '#0067ba', '#002447'] },
  { id: 'onyx', name: 'Onyx', stops: ['#484d57', '#222428', '#070709'] },
];
// What the app ships with, and what an install that has never chosen looks
// like. Changing this changes nobody's icon on its own: a choice is only ever
// recorded when it is made, so an absent one still lands here.
export const DEFAULT_ICON_ID = 'indigo';

export function getIconPalette(id) {
  return ICON_PALETTES.find(p => p.id === id) || null;
}

// The one door in. An id can arrive from settings.json stale or hand-edited,
// and the drawing has no sensible answer for a palette that isn't there.
export function normalizeIconId(id) {
  return getIconPalette(id) ? id : DEFAULT_ICON_ID;
}

export function isDefaultIcon(id) {
  return normalizeIconId(id) === DEFAULT_ICON_ID;
}

// ── Colour helpers ──

function channels(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
}

function rgba(hex, alpha) {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Toward black, for the two shadows. They were hand-picked indigo values in the
// original and are derived here instead, because eight palettes' worth of
// hand-picked near-blacks is eight chances to get one wrong, and a shadow that
// disagrees with its icon by a few points of blue is not something anyone can
// see.
function darken(hex, amount) {
  const [r, g, b] = channels(hex).map(c => Math.round(c * (1 - amount)));
  return `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

// ── The drawing ──
//
// Everything is expressed as a fraction of `size`, so the same code fills a
// 16px iconset entry and a 1024px master.
export function drawKeepIcon(ctx, size, palette) {
  const p = typeof palette === 'string' ? getIconPalette(normalizeIconId(palette)) : palette;
  const [light, mid, dark] = p.stops;

  // macOS convention: icon body fills ~80% of canvas, the rest is transparent bleed.
  const pad = size * 0.10;
  const inner = size - pad * 2;
  const left = pad;
  const top = pad;
  const cx = size / 2;
  const cy = size / 2;
  const cornerR = inner * 0.2237; // Apple's standard corner radius ratio

  // Background gradient: richer colour, no bright highlight in the corner.
  ctx.beginPath();
  ctx.roundRect(left, top, inner, inner, cornerR);
  const bg = ctx.createLinearGradient(left, top, left + inner, top + inner);
  bg.addColorStop(0, light);
  bg.addColorStop(0.55, mid);
  bg.addColorStop(1, dark);
  ctx.fillStyle = bg;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(left, top, inner, inner, cornerR);
  ctx.clip();

  // Gentle top sheen, centered and much softer so it doesn't blow out the corner.
  const hi = ctx.createRadialGradient(cx, top + inner * 0.08, 0, cx, top + inner * 0.3, inner * 0.7);
  hi.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
  hi.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = hi;
  ctx.fillRect(left, top, inner, inner);

  // Darken toward the bottom for weight.
  const sh = ctx.createLinearGradient(0, top + inner * 0.55, 0, top + inner);
  sh.addColorStop(0, 'rgba(0, 0, 0, 0)');
  sh.addColorStop(1, p.shade || rgba(darken(dark, 0.5), 0.28));
  ctx.fillStyle = sh;
  ctx.fillRect(left, top, inner, inner);

  // === Castle Keep (relative to inner box) ===
  const tW = inner * 0.46;
  const tX = left + (inner - tW) / 2;
  const tTop = top + inner * 0.335;
  const tBot = top + inner * 0.775;
  const mH = inner * 0.08;
  const u = tW / 5;

  const dW = inner * 0.11;
  const archR = dW / 2;
  const archCY = tBot - inner * 0.105;

  const slitW = inner * 0.032;
  const slitH = inner * 0.10;
  const archTop = archCY - archR;
  const slitY = tTop + (archTop - tTop - slitH) * 0.5;

  ctx.shadowColor = p.shadow || rgba(dark, 0.4);
  ctx.shadowBlur = inner * 0.028;
  ctx.shadowOffsetY = inner * 0.006;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.97)';

  ctx.beginPath();

  // Tower body + crenellations (clockwise from bottom-right).
  ctx.moveTo(tX + tW, tBot);
  ctx.lineTo(tX, tBot);
  ctx.lineTo(tX, tTop);

  ctx.lineTo(tX, tTop - mH);
  ctx.lineTo(tX + u, tTop - mH);
  ctx.lineTo(tX + u, tTop);
  ctx.lineTo(tX + 2 * u, tTop);
  ctx.lineTo(tX + 2 * u, tTop - mH);
  ctx.lineTo(tX + 3 * u, tTop - mH);
  ctx.lineTo(tX + 3 * u, tTop);
  ctx.lineTo(tX + 4 * u, tTop);
  ctx.lineTo(tX + 4 * u, tTop - mH);
  ctx.lineTo(tX + tW, tTop - mH);
  ctx.lineTo(tX + tW, tTop);

  ctx.lineTo(tX + tW, tBot);
  ctx.closePath();

  // Arched door (evenodd cutout).
  ctx.moveTo(cx - archR, tBot);
  ctx.lineTo(cx - archR, archCY);
  ctx.arc(cx, archCY, archR, Math.PI, 0, false);
  ctx.lineTo(cx + archR, tBot);
  ctx.closePath();

  // Arrow slit (evenodd cutout).
  ctx.roundRect(cx - slitW / 2, slitY, slitW, slitH, slitW / 2);

  ctx.fill('evenodd');

  ctx.restore();
  return ctx;
}
