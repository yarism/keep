const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // macOS convention: icon body fills ~80% of canvas, the rest is transparent bleed.
  const pad = size * 0.10;
  const inner = size - pad * 2;
  const left = pad;
  const top = pad;
  const cx = size / 2;
  const cy = size / 2;
  const cornerR = inner * 0.2237; // Apple's standard corner radius ratio

  // Background gradient — richer indigo, no bright highlight in the corner.
  ctx.beginPath();
  ctx.roundRect(left, top, inner, inner, cornerR);
  const bg = ctx.createLinearGradient(left, top, left + inner, top + inner);
  bg.addColorStop(0, '#7a86f5');   // indigo-400-ish (toned down from periwinkle)
  bg.addColorStop(0.55, '#4f46e5'); // indigo-600
  bg.addColorStop(1, '#1e1b4b');   // indigo-950 — near-black navy from app chrome
  ctx.fillStyle = bg;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(left, top, inner, inner, cornerR);
  ctx.clip();

  // Gentle top sheen — centered and much softer so it doesn't blow out the corner.
  const hi = ctx.createRadialGradient(cx, top + inner * 0.08, 0, cx, top + inner * 0.3, inner * 0.7);
  hi.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
  hi.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = hi;
  ctx.fillRect(left, top, inner, inner);

  // Darken toward the bottom for weight.
  const sh = ctx.createLinearGradient(0, top + inner * 0.55, 0, top + inner);
  sh.addColorStop(0, 'rgba(0, 0, 0, 0)');
  sh.addColorStop(1, 'rgba(10, 5, 40, 0.28)');
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

  ctx.shadowColor = 'rgba(15, 10, 50, 0.4)';
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
  return canvas;
}

const assetsDir = path.join(__dirname, '..', 'assets');
fs.writeFileSync(path.join(assetsDir, 'icon.png'), drawIcon(1024).toBuffer('image/png'));

const iconsetDir = path.join(assetsDir, 'icon.iconset');
if (!fs.existsSync(iconsetDir)) fs.mkdirSync(iconsetDir, { recursive: true });

const sizes = [16, 32, 64, 128, 256, 512];
sizes.forEach(s => {
  fs.writeFileSync(path.join(iconsetDir, `icon_${s}x${s}.png`), drawIcon(s).toBuffer('image/png'));
  fs.writeFileSync(path.join(iconsetDir, `icon_${s}x${s}@2x.png`), drawIcon(s * 2).toBuffer('image/png'));
});

try {
  execSync(`iconutil -c icns "${iconsetDir}" -o "${path.join(assetsDir, 'icon.icns')}"`);
  console.log('Built icon.icns');
} catch (e) {
  console.warn('iconutil failed (non-macOS?), skipping .icns');
}

console.log('Done');
