import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(process.env.ROAD_TOOLING ? `${process.env.ROAD_TOOLING}/package.json` : import.meta.url);
const sharp = require('sharp');
const root = fileURLToPath(new URL('.', import.meta.url));
const geometry = JSON.parse(readFileSync(`${root}/geometry.json`));
const generations = JSON.parse(readFileSync(`${root}/generations.json`)).slice(0, 15);
mkdirSync(`${root}/review`, { recursive: true });
const report = [];
const layers = [];
for (let n = 0; n < generations.length; n++) {
  const entry = generations[n];
  const source = `${root}/${entry.file}`;
  const meta = await sharp(source).metadata();
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = new Array(256).fill(0);
  let outsideDiamond = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const a = data[(y * info.width + x) * 4 + 3];
    alpha[a]++;
    const u = ((x + 0.5) * 1024 / info.width - 512) / 256;
    const v = ((y + 0.5) * 1024 / info.height - 832) / 128;
    if (a > 0 && Math.max(Math.abs((u + v) / 2), Math.abs((v - u) / 2)) > 0.5) outsideDiamond++;
  }
  const joins = {};
  const piece = geometry.pieces.find(p => p.id === entry.id);
  for (const edge of piece.edges) {
    const [cx, cy] = geometry.edges[edge];
    const sign = ['ne', 'sw'].includes(edge) ? 1 : -1;
    const occupied = [];
    for (let t = -0.5; t <= 0.5001; t += 1 / 512) {
      // Sample just inside the diamond, along the corresponding tile edge.
      const ix = Math.round((cx + 256 * t - (edge === 'se' ? 1 : edge === 'nw' ? -1 : 0)) * info.width / 1024);
      const iy = Math.round((cy + sign * 128 * t - (edge === 'sw' ? 1 : edge === 'ne' ? -1 : 0)) * info.height / 1024);
      if (ix < 0 || iy < 0 || ix >= info.width || iy >= info.height) continue;
      const offset = (iy * info.width + ix) * 4;
      if (data[offset + 3] >= 128) occupied.push(t);
    }
    joins[edge] = occupied.length ? { start: occupied[0], end: occupied.at(-1), widthTiles: occupied.at(-1) - occupied[0] } : null;
  }
  report.push({ id: entry.id, width: meta.width, height: meta.height, channels: meta.channels, alphaZero: alpha[0], alphaOpaque: alpha[255], alphaIntermediate: alpha.slice(1, 255).reduce((a, b) => a + b, 0), outsideDiamond, joins, passes: meta.width === 1024 && meta.height === 1024 && outsideDiamond === 0 && alpha.slice(1, 255).every(a => a === 0) });
  await sharp(source).resize(64, 64).png().toFile(`${root}/review/${entry.id}-canvas-64.png`);
  const tile = await sharp(source).resize(128, 128).extract({ left: 32, top: 88, width: 64, height: 32 }).png().toBuffer();
  await sharp(tile).png().toFile(`${root}/review/${entry.id}-tile-64.png`);
  const col = n % 3, row = Math.floor(n / 3);
  layers.push({ input: await sharp(tile).resize(384, 192, { kernel: 'nearest' }).png().toBuffer(), left: col * 420 + 18, top: row * 244 + 40 });
  const label = Buffer.from(`<svg width="420" height="32"><text x="18" y="24" font-family="sans-serif" font-size="19" fill="#e4d5b5">${entry.id}</text></svg>`);
  layers.push({ input: label, left: col * 420, top: row * 244 });
}
await sharp({ create: { width: 1260, height: 1220, channels: 4, background: '#39443b' } }).composite(layers).png().toFile(`${root}/review/raw-sheet.png`);
writeFileSync(`${root}/raw-check.json`, JSON.stringify({ status: 'drafts fail exact output requirements; finishing authorization pending', report }, null, 2) + '\n');
console.log(JSON.stringify(report.map(({ id, width, height, outsideDiamond, joins }) => ({ id, width, height, outsideDiamond, joins })), null, 2));
