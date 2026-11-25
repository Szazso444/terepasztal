import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const folder = fileURLToPath(new URL('./', import.meta.url));
const geometry = {
  canvas: [1024, 1024],
  gameTile: [64, 32],
  sourceTile: [330, 165],
  centre: [512, 512],
  tileOffset: 'screen = (512 + 165*(x-y), 512 + 82.5*(x+y))',
  guideCorners: [
    [512, 430],
    [677, 512],
    [512, 594],
    [347, 512],
  ],
  tenthTilePebble: 33,
  twentiethTilePebble: 17,
  reviewWidth: 199,
  referenceCrop: { x: [0.25, 0.75], y: [0.3, 0.7] },
};
for (const dir of ['guides', 'refs']) mkdirSync(`${folder}${dir}`, { recursive: true });
const guide = new PNG({ width: 1024, height: 1024 });
for (let i = 0; i < guide.data.length; i += 4) guide.data.set([128, 128, 128, 255], i);
for (let edge = 0; edge < 4; edge++) {
  const a = geometry.guideCorners[edge];
  const b = geometry.guideCorners[(edge + 1) % 4];
  const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  for (let step = 0; step <= steps; step++) {
    const x = Math.round(a[0] + ((b[0] - a[0]) * step) / steps);
    const y = Math.round(a[1] + ((b[1] - a[1]) * step) / steps);
    guide.data.set([220, 220, 220, 255], (y * 1024 + x) * 4);
  }
}
writeFileSync(`${folder}guides/swatch-scale.png`, PNG.sync.write(guide));
writeFileSync(`${folder}swatch-geometry.json`, `${JSON.stringify(geometry, null, 2)}\n`);
for (const material of ['water', 'sand']) {
  const source = PNG.sync.read(
    readFileSync(new URL(`../base-v1/terrain-${material}.png`, import.meta.url)),
  );
  const x0 = Math.floor(source.width * 0.25);
  const x1 = Math.floor(source.width * 0.75);
  const y0 = Math.floor(source.height * 0.3);
  const y1 = Math.floor(source.height * 0.7);
  const crop = new PNG({ width: x1 - x0, height: y1 - y0 });
  PNG.bitblt(source, crop, x0, y0, crop.width, crop.height, 0, 0);
  writeFileSync(`${folder}refs/ref-${material}.png`, PNG.sync.write(crop));
}
