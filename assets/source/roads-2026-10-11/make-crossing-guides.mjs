import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FOOTPRINTS, project } from '../../../tools/building-kit.mjs';

const require = createRequire(process.env.ROAD_TOOLING ? `${process.env.ROAD_TOOLING}/package.json` : import.meta.url);
const sharp = require('sharp');
const root = fileURLToPath(new URL('.', import.meta.url));
const pieces = ['regular', 'narrow'].flatMap(gauge => [0, 1].map(rotation => ({
  id: `crossing-${gauge}-r${rotation}`, gauge, rotation,
  railOffset: gauge === 'regular' ? 0.16 : 0.08,
})));
mkdirSync(`${root}/guides`, { recursive: true });
for (const piece of pieces) {
  const data = Buffer.alloc(1024 * 1024 * 4);
  const { rotation: r, railOffset: g } = piece;
  piece.rails = [-g, g].map(offset => [-0.5, 0.5].map(along => project(FOOTPRINTS.t1, ...(r === 0 ? [offset, along] : [along, offset]))));
  piece.roadEdges = r === 0 ? ['nw', 'se'] : ['ne', 'sw'];
  for (let py = 704; py < 960; py++) for (let px = 256; px < 768; px++) {
    const a = (px + 0.5 - 512) / 256, b = (py + 0.5 - 832) / 128;
    const x = (a + b) / 2, y = (b - a) / 2;
    if (Math.max(Math.abs(x), Math.abs(y)) > 0.5) continue;
    const along = r === 0 ? y : x, across = r === 0 ? x : y;
    const road = Math.abs(along) <= 0.25;
    const deck = road && Math.abs(across) <= g + 0.1;
    const rail = Math.abs(Math.abs(across) - g) <= 0.0035;
    const outline = Math.max(Math.abs(x), Math.abs(y)) >= 0.495;
    if (!road && !rail && !outline) continue;
    const grey = rail ? 95 : deck ? 188 : road ? 216 : 235;
    data.set([grey, grey, grey, 255], (py * 1024 + px) * 4);
  }
  await sharp(data, { raw: { width: 1024, height: 1024, channels: 4 } }).png().toFile(`${root}/guides/${piece.id}.png`);
}
writeFileSync(`${root}/crossing-geometry.json`, JSON.stringify({ footprint: FOOTPRINTS.t1, anchor: [512, 832], gameAnchor: [32, 16], roadWidth: 0.5, deckOutsideRail: 0.1, pieces }, null, 2) + '\n');
console.log(`Wrote ${pieces.length} crossing guides.`);
