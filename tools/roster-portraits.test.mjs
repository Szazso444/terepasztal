import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import {
  OUTPUT_DIR,
  SIZE,
  SOURCES,
  bodyBounds,
  buildPortrait,
  opaqueBounds,
  portraitWindow,
} from './roster-portraits.mjs';

describe('roster portraits tool', () => {
  it('has a shipped portrait for every source and no other', () => {
    const shipped = readdirSync(OUTPUT_DIR).filter((f) => f.endsWith('.png'));
    expect(shipped.sort()).toEqual(
      Object.keys(SOURCES)
        .map((id) => `${id}.png`)
        .sort(),
    );
  });

  it('keeps the 3:2 window around the body and inside the canvas', () => {
    for (const bounds of [
      { x0: 600, y0: 400, x1: 900, y1: 600 },
      { x0: 10, y0: 100, x1: 1530, y1: 900 },
      { x0: 0, y0: 0, x1: 300, y1: 200 },
    ]) {
      const w = portraitWindow(bounds, 1536, 1024);
      expect(w.w / w.h).toBeCloseTo(SIZE.width / SIZE.height);
      expect(w.x).toBeGreaterThanOrEqual(0);
      expect(w.y).toBeGreaterThanOrEqual(0);
      expect(w.x + w.w).toBeLessThanOrEqual(1536 + 1e-9);
      expect(w.y + w.h).toBeLessThanOrEqual(1024 + 1e-9);
      expect(w.x).toBeLessThanOrEqual(bounds.x0);
      expect(w.x + w.w).toBeGreaterThanOrEqual(bounds.x1);
    }
  });

  it('finds a bright body on a dark ground and builds a SIZE picture', () => {
    const png = new PNG({ width: 300, height: 200 });
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 300; x++) {
        const i = (y * 300 + x) * 4;
        const body = x >= 100 && x < 200 && y >= 80 && y < 120;
        png.data[i] = png.data[i + 1] = png.data[i + 2] = body ? 200 : 8;
        png.data[i + 3] = 255;
      }
    const rgb = new Uint8Array(300 * 200 * 3);
    for (let p = 0; p < 300 * 200; p++) rgb.fill(png.data[p * 4], p * 3, p * 3 + 3);
    expect(bodyBounds(rgb, 300, 200)).toEqual({ x0: 100, y0: 80, x1: 200, y1: 120 });
    const built = PNG.sync.read(buildPortrait(png).png);
    expect([built.width, built.height]).toEqual([SIZE.width, SIZE.height]);
    expect(opaqueBounds(png)).toBeNull();
  });

  it('finds a dark body on a transparent ground by its alpha', () => {
    const png = new PNG({ width: 300, height: 200 });
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 300; x++) {
        const i = (y * 300 + x) * 4;
        const body = x >= 100 && x < 200 && y >= 80 && y < 120;
        png.data[i] = png.data[i + 1] = png.data[i + 2] = body ? 20 : 0;
        png.data[i + 3] = body ? 255 : 0;
      }
    expect(opaqueBounds(png)).toEqual({ x0: 100, y0: 80, x1: 200, y1: 120 });
  });
});
