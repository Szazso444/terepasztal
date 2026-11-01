import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const p = new PNG({ width: 1024, height: 1024 });
for (let y = 0; y < 1024; y++)
  for (let x = 0; x < 1024; x++) {
    const u = (x - 512 + (y - 512)) / Math.SQRT2;
    const v = (y - 512 - (x - 512)) / Math.SQRT2;
    const stock =
      (Math.abs(u) <= 470 && Math.abs(v) <= 12) || (Math.abs(v) <= 470 && Math.abs(u) <= 12);
    const plate = Math.abs(u) <= 42 && Math.abs(v) <= 42;
    if (stock || plate) {
      const i = (y * 1024 + x) * 4;
      p.data[i] = p.data[i + 1] = p.data[i + 2] = plate ? 110 : 150;
      p.data[i + 3] = 255;
    }
  }
const folder = new URL('guides/', import.meta.url);
mkdirSync(folder, { recursive: true });
writeFileSync(new URL('sails-front.png', folder), PNG.sync.write(p));
