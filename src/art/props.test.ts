import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FrameDef } from '../engine/atlas';
import { HALF_H, HALF_W } from '../engine/iso';
import { PAL } from './palette';
import { generatePropsAtlas } from './props';

/** Node has no ImageData or canvas: a stand-in that keeps the pixels the packer puts down. */
class FakeImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  constructor(a: Uint8ClampedArray | number, b: number, c?: number) {
    this.width = typeof a === 'number' ? a : b;
    this.height = typeof a === 'number' ? b : (c ?? a.length / 4 / b);
    this.data = typeof a === 'number' ? new Uint8ClampedArray(a * b * 4) : a;
  }
}

let frames: Record<string, FrameDef> = {};
const placed: { img: FakeImageData; x: number; y: number }[] = [];

beforeAll(() => {
  vi.stubGlobal('ImageData', FakeImageData);
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        putImageData: (img: FakeImageData, x: number, y: number) => placed.push({ img, x, y }),
      }),
    }),
  });
  frames = generatePropsAtlas().frames;
});
afterAll(() => {
  vi.unstubAllGlobals();
});

/** Every opaque pixel of a frame: x, y, [r, g, b, a]. */
function ink(key: string) {
  const f = frames[key];
  const p = placed.find((q) => q.x === f.x && q.y === f.y)!;
  const out: { x: number; y: number; rgba: number[] }[] = [];
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      const i = (y * f.w + x) * 4;
      if (p.img.data[i + 3]) out.push({ x, y, rgba: [...p.img.data.subarray(i, i + 4)] });
    }
  return out;
}

const WHEAT = [0, 1, 2].map((v) => `props/wheat_${v}`);
const AMBER = PAL.amber;

describe('wheat field frames', () => {
  it('are the three variants of the wheat prop kind', () => {
    for (const key of WHEAT) expect(frames[key], key).toBeDefined();
  });

  it('keep every colour under the selection amber and the cursor white', () => {
    // the palette itself, then what was painted from it
    for (const c of [...PAL.wheat, ...PAL.wheatGreen, PAL.furrow])
      expect(c[0], `${c}`).toBeLessThan(AMBER[0]);
    for (const key of WHEAT)
      for (const { rgba } of ink(key)) {
        const dominatesAmber = rgba[0] >= AMBER[0] && rgba[1] >= AMBER[1] && rgba[2] >= AMBER[2];
        expect(dominatesAmber, `${key} ${rgba}`).toBe(false);
        expect(rgba[0], `${key} ${rgba}`).toBeLessThan(PAL.white[0]);
      }
  });

  it('are anchored on the tile centre and lie over the tile, stalks aside', () => {
    for (const key of WHEAT) {
      const f = frames[key];
      // the ground contact of every column is a point of the tile, near the edge at most
      const lowest = new Map<number, number>();
      for (const { x, y } of ink(key)) lowest.set(x, Math.max(lowest.get(x) ?? -1, y));
      for (const [x, y] of lowest) {
        const px = (x + 0.5 - f.ax) / HALF_W;
        const py = (y + 0.5 - f.ay) / HALF_H;
        const tx = (px + py) / 2;
        const ty = (py - px) / 2;
        // 0.46 tile at most (the farm's rows reach 0.42, ragged out to 0.46), and a contour pixel
        expect(Math.max(Math.abs(tx), Math.abs(ty)), `${key} column ${x}`).toBeLessThan(0.5);
      }
      expect(f.ax).toBeGreaterThan(0);
      expect(f.ax).toBeLessThan(f.w);
    }
  });

  it('stand over the ground: they reach above the diamond they cover', () => {
    for (const key of WHEAT) {
      const f = frames[key];
      // the back corner of a flat diamond 0.42 tile out lies 0.84 * HALF_H over the centre; a
      // raised patch has its heads at least two px higher than that along the back
      expect(f.ay, key).toBeGreaterThanOrEqual(Math.floor(0.84 * HALF_H));
    }
  });

  it('differ from each other in shape', () => {
    const shapes = WHEAT.map((key) =>
      ink(key)
        .map(({ x, y }) => `${x},${y}`)
        .join(';'),
    );
    expect(new Set(shapes).size).toBe(3);
  });
});
