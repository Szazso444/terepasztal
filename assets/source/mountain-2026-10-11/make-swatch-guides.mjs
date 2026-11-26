import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const geometry = {
  projection: '2:1 orthographic isometric, 30 degrees down',
  gameTile: [64, 32],
  requestedCanvas: [1024, 1024],
  centre: [512, 512],
  sourceTile: [330, 165],
  tileOffsetToScreen: ['512 + 165 * (x - y)', '512 + 82.5 * (x + y)'],
  scaleCardCorners: [
    [512, 430],
    [677, 512],
    [512, 594],
    [347, 512],
  ],
  stoneOneTenthTileWidth: 33,
  reviewSquareWidth: 199,
  note: 'Scale card only. Never attach this guide to a generation or paint its diamond.',
};
fs.mkdirSync(path.join(dir, 'guides'), { recursive: true });
const png = new PNG({ width: 1024, height: 1024 });
for (let i = 0; i < png.data.length; i += 4) {
  png.data.set([128, 128, 128, 255], i);
}
for (let edge = 0; edge < 4; edge++) {
  const a = geometry.scaleCardCorners[edge];
  const b = geometry.scaleCardCorners[(edge + 1) % 4];
  const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  for (let step = 0; step <= steps; step++) {
    const x = Math.round(a[0] + ((b[0] - a[0]) * step) / steps);
    const y = Math.round(a[1] + ((b[1] - a[1]) * step) / steps);
    png.data.set([220, 220, 220, 255], (y * 1024 + x) * 4);
  }
}
fs.writeFileSync(path.join(dir, 'guides/swatch-scale.png'), PNG.sync.write(png));
fs.writeFileSync(path.join(dir, 'swatch-geometry.json'), `${JSON.stringify(geometry, null, 2)}\n`);
