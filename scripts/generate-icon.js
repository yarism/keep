const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  const pad = size * 0.09;
  const bw = size - pad * 2;
  const r = bw * 0.22;

  // Deep navy background
  const bg = ctx.createLinearGradient(pad, pad, pad + bw, pad + bw);
  bg.addColorStop(0, '#080d28');
  bg.addColorStop(1, '#160c38');
  ctx.beginPath();
  ctx.roundRect(pad, pad, bw, bw, r);
  ctx.fillStyle = bg;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(pad, pad, bw, bw, r);
  ctx.clip();

  // Subtle inner glow behind the keep
  const glow = ctx.createRadialGradient(size * 0.5, size * 0.48, 0, size * 0.5, size * 0.5, size * 0.5);
  glow.addColorStop(0, 'rgba(70, 100, 230, 0.22)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // === Castle Keep ===
  const tW = size * 0.56;
  const tX = (size - tW) / 2;
  const tTop = size * 0.305;
  const tBot = size * 0.83;
  const mH = size * 0.10;
  const u = tW / 5;

  // Arched doorway
  const dW = size * 0.13;
  const archR = dW / 2;
  const archCY = tBot - size * 0.13;

  // Arrow slit
  const slitW = size * 0.038;
  const slitH = size * 0.115;
  const archTop = archCY - archR;
  const slitY = tTop + (archTop - tTop - slitH) * 0.5;

  ctx.shadowColor = 'rgba(180, 200, 255, 0.28)';
  ctx.shadowBlur = size * 0.05;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.93)';

  ctx.beginPath();

  // Tower body + crenellations (clockwise from bottom-right)
  ctx.moveTo(tX + tW, tBot);
  ctx.lineTo(tX, tBot);
  ctx.lineTo(tX, tTop);

  // Left merlon
  ctx.lineTo(tX, tTop - mH);
  ctx.lineTo(tX + u, tTop - mH);
  ctx.lineTo(tX + u, tTop);
  // Gap 1
  ctx.lineTo(tX + 2 * u, tTop);
  // Middle merlon
  ctx.lineTo(tX + 2 * u, tTop - mH);
  ctx.lineTo(tX + 3 * u, tTop - mH);
  ctx.lineTo(tX + 3 * u, tTop);
  // Gap 2
  ctx.lineTo(tX + 4 * u, tTop);
  // Right merlon
  ctx.lineTo(tX + 4 * u, tTop - mH);
  ctx.lineTo(tX + tW, tTop - mH);
  ctx.lineTo(tX + tW, tTop);

  ctx.lineTo(tX + tW, tBot);
  ctx.closePath();

  // Arched door (evenodd cutout)
  ctx.moveTo(size / 2 - archR, tBot);
  ctx.lineTo(size / 2 - archR, archCY);
  ctx.arc(size / 2, archCY, archR, Math.PI, 0, false);
  ctx.lineTo(size / 2 + archR, tBot);
  ctx.closePath();

  // Arrow slit (evenodd cutout)
  ctx.roundRect(size / 2 - slitW / 2, slitY, slitW, slitH, slitW / 2);

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
