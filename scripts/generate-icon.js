// Rasterises the app icon into assets/: icon.png, the .iconset, and the .icns
// electron-builder seals into the bundle.
//
// The drawing itself lives in renderer/icon-art.js, which the running app uses
// too, so the icon in the Dock is the same picture as the icon in Finder rather
// than a second one that looks like it. This script only ever renders the
// default palette: the .icns is what ships, and switching colours is a choice
// made per install, not per build.
//
// renderer/ is written as ES modules while package.json says "type":
// "commonjs", so the source is evaluated as a data URL, the same trick and for
// the same reason as test/helpers/esm.mjs.

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const assetsDir = path.join(__dirname, '..', 'assets');

async function loadEsm(file) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf-8');
  return import('data:text/javascript;base64,' + Buffer.from(source, 'utf-8').toString('base64'));
}

async function main() {
  const { drawKeepIcon, getIconPalette, DEFAULT_ICON_ID } = await loadEsm('renderer/icon-art.js');
  const palette = getIconPalette(DEFAULT_ICON_ID);

  function drawIcon(size) {
    const canvas = createCanvas(size, size);
    drawKeepIcon(canvas.getContext('2d'), size, palette);
    return canvas;
  }

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
}

main().catch(e => { console.error(e); process.exit(1); });
