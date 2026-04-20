const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const size = 1024;
const c = createCanvas(size, size);
const ctx = c.getContext('2d');

// Rounded rect background with gradient
const r = 220;
ctx.beginPath();
ctx.moveTo(r, 0);
ctx.lineTo(size - r, 0);
ctx.quadraticCurveTo(size, 0, size, r);
ctx.lineTo(size, size - r);
ctx.quadraticCurveTo(size, size, size - r, size);
ctx.lineTo(r, size);
ctx.quadraticCurveTo(0, size, 0, size - r);
ctx.lineTo(0, r);
ctx.quadraticCurveTo(0, 0, r, 0);
ctx.closePath();

const grad = ctx.createLinearGradient(0, 0, size, size);
grad.addColorStop(0, '#6366f1');
grad.addColorStop(1, '#8b5cf6');
ctx.fillStyle = grad;
ctx.fill();

// Draw git branch icon centered
ctx.save();
ctx.translate(size / 2, size / 2);
ctx.scale(16, 16);
ctx.strokeStyle = 'white';
ctx.lineWidth = 2.8;
ctx.lineCap = 'round';
ctx.lineJoin = 'round';

// Main vertical line
ctx.beginPath();
ctx.moveTo(-8, -22);
ctx.lineTo(-8, 10);
ctx.stroke();

// Bottom circle
ctx.beginPath();
ctx.arc(-8, 17, 6, 0, Math.PI * 2);
ctx.stroke();

// Top-right circle
ctx.beginPath();
ctx.arc(14, -16, 6, 0, Math.PI * 2);
ctx.stroke();

// Branch curve
ctx.beginPath();
ctx.moveTo(14, -10);
ctx.bezierCurveTo(14, 4, -8, 4, -8, 10);
ctx.stroke();

ctx.restore();

// Save
const out = path.join(__dirname, '..', 'assets', 'icon.png');
fs.writeFileSync(out, c.toBuffer('image/png'));
console.log('Icon saved to', out);
