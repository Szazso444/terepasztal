import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { loopStrip, solidRows } from './track-materials.mjs';

/** A strip whose every texel holds its own column number in red, its row in green. */
function ramp(width, height) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      png.data[i] = x % 256;
      png.data[i + 1] = y;
      png.data[i + 2] = 0;
      png.data[i + 3] = 255;
    }
  return png;
}

describe('packing the painted track materials', () => {
  it('cuts a strip to one period and closes its seam with the painting itself', () => {
    const src = ramp(512, 4);
    const out = loopStrip(src, 256);
    expect([out.width, out.height]).toEqual([256, 4]);
    const red = (x, y = 0) => out.data[(y * 256 + x) * 4];
    // column 0 continues column 255 as the painting does: it is the painting's column 256
    expect(red(0)).toBe(256 % 256);
    // past the cross-fade the tile is the painting's own first period
    for (const x of [24, 100, 255]) expect(red(x)).toBe(x);
    // rows keep their place
    expect(out.data[(3 * 256 + 50) * 4 + 1]).toBe(3);
  });

  it('finds the rows of a strip painted solid inside its fade', () => {
    const png = ramp(8, 6);
    const alphas = [0, 40, 200, 255, 120, 0];
    for (let y = 0; y < 6; y++)
      for (let x = 0; x < 8; x++) png.data[(y * 8 + x) * 4 + 3] = alphas[y];
    expect(solidRows(png)).toEqual([2, 3]);
  });

  it('ships a bed, an edge and a sleeper for every standard line and Narrow Gauge', () => {
    const dir = 'public/assets/track-materials';
    const index = JSON.parse(fs.readFileSync(`${dir}/materials.json`, 'utf8'));
    expect(index.pxPerTile).toBe(256);
    for (const line of ['narrow', 'branch', 'main', 'trunk'])
      for (const name of ['bed', 'edge', 'sleeper']) {
        const png = PNG.sync.read(fs.readFileSync(`${dir}/${line}/${name}.png`));
        expect([png.width, png.height], `${line}/${name}`).toEqual(index.lines[line][name]);
        if (name !== 'sleeper') {
          expect(png.width, `${line}/${name}`).toBe(256);
          const [a, b] = index.lines[line].solid[name];
          expect(0 <= a && a < b && b < png.height, `${line}/${name} solid`).toBe(true);
        }
      }
  });
});
