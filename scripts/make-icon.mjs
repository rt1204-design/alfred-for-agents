// Builds the app icons from Alfred's head in assets/alfred.png.
// Run with: npm run icon
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SRC = 'assets/alfred.png';
// Box around the head in the source drawing. Its bottom edge cuts through the
// neck, and the icon seats it on the card's bottom edge like a portrait.
const HEAD = { left: 578, top: 310, width: 232, height: 210 };
const INK = [20, 20, 20];
const PAPER = '#ffffff';

// Ink coverage (0-255) of the head. `grow` thickens strokes by that many
// source pixels so they survive downscaling; `gain` turns the drawing's faint
// anti-aliased edges into solid ink.
async function inkLayer(grow, gain) {
  const { data, info } = await sharp(SRC)
    .flatten({ background: PAPER })
    .extract(HEAD)
    .greyscale()
    .negate()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  let a = new Uint8Array(W * H);
  // Ignore near-white specks from the scan, then amplify the real ink.
  for (let i = 0; i < W * H; i++) a[i] = Math.min(255, Math.max(0, data[i * C] - 40) * gain);
  // Thicken strokes with a disc-shaped max filter of radius `grow`.
  if (grow > 0) {
    const out = new Uint8Array(W * H);
    const offs = [];
    for (let dy = -grow; dy <= grow; dy++)
      for (let dx = -grow; dx <= grow; dx++) if (dx * dx + dy * dy <= grow * grow + grow) offs.push([dx, dy]);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let m = 0;
        for (const [dx, dy] of offs) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H && a[yy * W + xx] > m) m = a[yy * W + xx];
        }
        out[y * W + x] = m;
      }
    a = out;
  }
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba.set(INK, i * 4);
    rgba[i * 4 + 3] = a[i];
  }
  return sharp(rgba, { raw: { width: W, height: H, channels: 4 } });
}

async function icon(size, file, { grow = 0, gain = 2, pad = 0.04, radius = 0.22 }) {
  const w = Math.round(size * (1 - pad * 2));
  const h = Math.round((w * HEAD.height) / HEAD.width);
  const ink = await (await inkLayer(grow, gain)).resize(w, h, { kernel: 'lanczos3' }).png().toBuffer();
  const r = Math.round(size * radius);
  const rect = (fill) =>
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="${fill}"/></svg>`);
  const out = await sharp(rect(PAPER))
    .composite([
      { input: ink, left: Math.round((size - w) / 2), top: size - h },
      { input: rect('#000'), blend: 'dest-in' }, // keep the neck inside the rounded corners
    ])
    .png()
    .toBuffer();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out);
  console.log(`Wrote ${file} (${size}px)`);
}

await icon(512, 'build/icon.png', { grow: 1, gain: 2.5 }); // installer, taskbar, desktop, Start menu
await icon(32, 'build/tray.png', { grow: 6, gain: 3, pad: 0.01, radius: 0.18 }); // system tray
await icon(64, 'public/favicon.png', { grow: 4, gain: 3, pad: 0.02 }); // window title bar, browser tab
await icon(96, 'public/alfred-head.png', { grow: 3, gain: 2.5, pad: 0.03 }); // sidebar mark
