import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FOOTPRINTS, project } from '../../../tools/building-kit.mjs';

// Pass a tooling package directory when this isolated checkout has no node_modules.
const require = createRequire(process.env.ROAD_TOOLING ? `${process.env.ROAD_TOOLING}/package.json` : import.meta.url);
const sharp = require('sharp');
const root = fileURLToPath(new URL('.', import.meta.url));
const edges = { ne: [0, -0.5], se: [0.5, 0], sw: [0, 0.5], nw: [-0.5, 0] };
export const pieces = [
  { id: 'road-straight-x', edges: ['nw', 'se'] },
  { id: 'road-straight-y', edges: ['ne', 'sw'] },
  ...[['ne', 'se'], ['se', 'sw'], ['sw', 'nw'], ['nw', 'ne']].map(e => ({ id: `road-curve-${e.join('-')}`, edges: e, corner: [edges[e[0]][0] + edges[e[1]][0], edges[e[0]][1] + edges[e[1]][1]] })),
  ...Object.keys(edges).map(e => ({ id: `road-tee-closed-${e}`, edges: Object.keys(edges).filter(k => k !== e) })),
  ...Object.keys(edges).map(e => ({ id: `road-end-${e}`, edges: [e] })),
  { id: 'road-cross', edges: Object.keys(edges) },
];

export function distance(piece, x, y) {
  if (piece.corner) return Math.abs(Math.hypot(x - piece.corner[0], y - piece.corner[1]) - 0.5);
  return Math.min(...piece.edges.map(e => {
    const [a, b] = edges[e];
    const t = Math.max(0, Math.min(1, (x * a + y * b) / (a * a + b * b)));
    return Math.hypot(x - t * a, y - t * b);
  }));
}

mkdirSync(`${root}/guides`, { recursive: true });
for (const piece of pieces) {
  const data = Buffer.alloc(1024 * 1024 * 4);
  for (let py = 703; py <= 961; py++) for (let px = 255; px <= 769; px++) {
    const a = (px + 0.5 - 512) / 256, b = (py + 0.5 - 832) / 128;
    const x = (a + b) / 2, y = (b - a) / 2;
    if (Math.max(Math.abs(x), Math.abs(y)) > 0.5) continue;
    const outline = Math.max(Math.abs(x), Math.abs(y)) >= 0.495;
    const band = distance(piece, x, y) <= 0.25;
    if (!outline && !band) continue;
    const i = (py * 1024 + px) * 4;
    const grey = band ? 210 : 235;
    data.set([grey, grey, grey, 255], i);
  }
  await sharp(data, { raw: { width: 1024, height: 1024, channels: 4 } }).png().toFile(`${root}/guides/${piece.id}.png`);
}
writeFileSync(`${root}/geometry.json`, JSON.stringify({ footprint: FOOTPRINTS.t1, anchor: [512, 832], gameAnchor: [32, 16], bandWidth: 0.5, vergeMaximum: 0.03, edges: Object.fromEntries(Object.entries(edges).map(([k, v]) => [k, project(FOOTPRINTS.t1, ...v)])), pieces }, null, 2) + '\n');
console.log(`Wrote ${pieces.length} guides.`);
