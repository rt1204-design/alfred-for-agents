// Cuts the line-art pieces the UI uses out of Alfred's drawing in
// assets/alfred.png. Each piece is saved as ink-only alpha (no paper), so the
// UI can use it as a CSS mask and tint it with any theme color.
// Run with: node scripts/make-art.mjs
import sharp from 'sharp';

const SRC = 'assets/alfred.png';
const OUT = 'public/art';
// `box` is the crop, `clear` paints over neighbouring bits of the drawing
// (both in source pixels).
const PIECES = {
  // Just the head, for the brand mark.
  'alfred-head': { box: { left: 578, top: 310, width: 232, height: 210 } },
  // The owner's handwritten "Alfred".
  'alfred-signature': { box: { left: 322, top: 688, width: 276, height: 90 } },
};

const flat = await sharp(SRC).flatten({ background: '#ffffff' }).toBuffer();

for (const [name, { box, clear = [] }] of Object.entries(PIECES)) {
  const patches = clear.map((c) => ({
    input: { create: { width: c.width, height: c.height, channels: 3, background: '#ffffff' } },
    left: c.left,
    top: c.top,
  }));
  const cleaned = await sharp(flat).composite(patches).toBuffer();
  const { data, info } = await sharp(cleaned)
    .extract(box)
    .greyscale()
    .negate()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // Drop faint scan specks, then firm up the anti-aliased stroke edges.
  const alpha = Buffer.alloc(info.width * info.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = Math.min(255, Math.max(0, data[i * info.channels] - 30) * 1.6);
  await sharp({ create: { width: info.width, height: info.height, channels: 3, background: '#000000' } })
    .joinChannel(alpha, { raw: { width: info.width, height: info.height, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toFile(`${OUT}/${name}.png`);
  console.log(name, info.width, 'x', info.height);
}
