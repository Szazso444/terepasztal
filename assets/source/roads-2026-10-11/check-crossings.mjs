import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(process.env.ROAD_TOOLING ? `${process.env.ROAD_TOOLING}/package.json` : import.meta.url);
const sharp = require('sharp');
const root = fileURLToPath(new URL('.', import.meta.url));
const geometry = JSON.parse(readFileSync(`${root}/crossing-geometry.json`));
const report = [], layers = [];
mkdirSync(`${root}/review`, { recursive: true });
for (let n = 0; n < geometry.pieces.length; n++) {
  const piece = geometry.pieces[n];
  const file = `${root}/${piece.id}.png`;
  const meta = await sharp(file).metadata();
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let outsideDiamond = 0, outsideRoadBand = 0, alphaIntermediate = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const alpha = data[(y * info.width + x) * 4 + 3];
    if (!alpha) continue;
    if (alpha < 255) alphaIntermediate++;
    const a = ((x + 0.5) * 1024 / info.width - 512) / 256;
    const b = ((y + 0.5) * 1024 / info.height - 832) / 128;
    const tx = (a + b) / 2, ty = (b - a) / 2;
    if (Math.max(Math.abs(tx), Math.abs(ty)) > 0.5) outsideDiamond++;
    if (Math.abs(piece.rotation === 0 ? ty : tx) > 0.25) outsideRoadBand++;
  }
  report.push({ id: piece.id, width: meta.width, height: meta.height, channels: meta.channels, outsideDiamond, outsideRoadBand, alphaIntermediate, accepted: meta.width === 1024 && meta.height === 1024 && meta.channels === 4 && outsideRoadBand === 0 && outsideDiamond === 0 && alphaIntermediate === 0 });
  await sharp(file).resize(64, 64).png().toFile(`${root}/review/${piece.id}-canvas-64.png`);
  const tile = await sharp(file).resize(128, 128).extract({ left: 32, top: 88, width: 64, height: 32 }).png().toBuffer();
  await sharp(tile).png().toFile(`${root}/review/${piece.id}-tile-64.png`);
  layers.push({ input: await sharp(tile).resize(512, 256, { kernel: 'nearest' }).png().toBuffer(), left: (n % 2) * 560 + 24, top: Math.floor(n / 2) * 312 + 40 });
  const label = Buffer.from(`<svg width="560" height="32"><text x="24" y="24" font-family="sans-serif" font-size="22" fill="#e4d5b5">${piece.id} (draft)</text></svg>`);
  layers.push({ input: label, left: (n % 2) * 560, top: Math.floor(n / 2) * 312 });
}
await sharp({ create: { width: 1120, height: 624, channels: 4, background: '#39443b' } }).composite(layers).png().toFile(`${root}/review/crossings-sheet.png`);
writeFileSync(`${root}/crossing-check.json`, JSON.stringify({ status: 'drafts; exact geometry and alpha fail', visualFindings: ['Correction removed metallic railheads and fixed rotation-0 groove direction.', 'Generated bands and deck extents drift from guides.', 'Narrow r1 includes paving on approaches instead of the requested gravel.', 'Exact groove offsets remain unverified; do not pack as accepted production artwork.'], report }, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
