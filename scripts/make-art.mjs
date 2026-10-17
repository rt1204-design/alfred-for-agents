// Cuts the line-art pieces the UI uses out of Alfred's drawing in
// assets/alfred.png. Each piece is saved as ink-only alpha (no paper), so the
// UI can use it as a CSS mask and tint it with any theme color.
// Run with: node scripts/make-art.mjs
import sharp from 'sharp';

const SRC = 'assets/alfred.png';
const OUT = 'public/art';
const SIGNATURE = { left: 320, top: 686, width: 290, height: 100 };
// `box` is the crop, `clear` paints over neighbouring bits of the drawing
// (both in source pixels).
const PIECES = {
  // Alfred holding the tray of robots, without the signature.
  'alfred-scene': { box: { left: 95, top: 28, width: 880, height: 680 }, clear: [SIGNATURE] },
  // Alfred alone, from the head to the shoulders.
  'alfred-bust': {
    box: { left: 420, top: 312, width: 560, height: 392 },
    clear: [{ left: 380, top: 280, width: 165, height: 200 }, SIGNATURE],
  },
  // Just the head, for the brand mark.
  'alfred-head': { box: { left: 578, top: 310, width: 232, height: 210 } },
  // The owner's handwritten "Alfred".
  'alfred-signature': { box: { left: 322, top: 688, width: 276, height: 90 } },
  // One robot from the tray, used as the staff (agent) portrait.
  robot: {
    box: { left: 236, top: 30, width: 160, height: 138 },
    clear: [{ left: 236, top: 138, width: 20, height: 32 }, { left: 381, top: 140, width: 17, height: 30 }],
  },
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
