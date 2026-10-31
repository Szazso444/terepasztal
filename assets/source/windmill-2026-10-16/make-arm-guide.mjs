import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const p = new PNG({ width: 1024, height: 1024 });
for (let y = 0; y < p.height; y++)
  for (let x = 0; x < p.width; x++) {
    const u = (x - 512 - (y - 512)) / Math.SQRT2;
    const v = (x - 512 + (y - 512)) / Math.SQRT2;
    const bar = u >= 0 && u <= 470 && Math.abs(v) <= 12;
    const plate = Math.abs(u) <= 42 && Math.abs(v) <= 42;
    if (!bar && !plate) continue;
    const i = (y * p.width + x) * 4;
    p.data[i] = p.data[i + 1] = p.data[i + 2] = plate ? 110 : 150;
    p.data[i + 3] = 255;
  }
const folder = new URL('guides/', import.meta.url);
mkdirSync(folder, { recursive: true });
writeFileSync(new URL('sail-arm.png', folder), PNG.sync.write(p));
