import { readFileSync } from 'node:fs';
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

const WATERSIDE = ['mangrove', 'willow'].flatMap((kind) =>
  [0, 1, 2].map((v) => `props/${kind}_${v}`),
);
/** The packed paintings these frames fall back from (partial, so the generator covers them). */
const painted = JSON.parse(readFileSync('public/assets/props.json', 'utf8')) as {
  resolution: number;
  partial: boolean;
  frames: Record<string, FrameDef>;
};
const luma = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe('waterside tree fallbacks', () => {
  it('cover every waterside frame the partial props atlas paints', () => {
    expect(painted.partial).toBe(true);
    const keys = Object.keys(painted.frames).filter((k) => /^props\/(mangrove|willow)_/.test(k));
    expect(keys.sort()).toEqual([...WATERSIDE].sort());
    for (const key of WATERSIDE) expect(frames[key], key).toBeDefined();
  });

  it('stand where the paintings stand: the same size and anchor within a world px', () => {
    for (const key of WATERSIDE) {
      const f = frames[key];
      const p = painted.frames[key];
      const r = painted.resolution;
      for (const [got, want, what] of [
        [f.w, p.w / r, 'w'],
        [f.h, p.h / r, 'h'],
        [f.ax, p.ax / r, 'ax'],
        [f.ay, p.ay / r, 'ay'],
      ] as const)
        expect(Math.abs(got - want), `${key} ${what} ${got} against ${want}`).toBeLessThanOrEqual(
          1,
        );
    }
  });

  it('keep every colour under the cursor white and weaker than the selection amber', () => {
    for (const key of WATERSIDE)
      for (const { rgba } of ink(key)) {
        const [r, g, b] = rgba;
        expect(r >= PAL.white[0] && g >= PAL.white[1] && b >= PAL.white[2], `${key} ${rgba}`).toBe(
          false,
        );
        expect(r >= PAL.amber[0] && g >= PAL.amber[1] && b >= PAL.amber[2], `${key} ${rgba}`).toBe(
          false,
        );
      }
  });

  it('keep every colour weaker than the selection amber by the packer`s measure too', () => {
    // #465: as strong as the amber is hue 25 to 50 degrees, saturation 0.62 or more and value
    // 0.85 or more; the packed paintings are held under it, so their fallbacks are as well
    const strong = ([r, g, b]: readonly number[]) => {
      const max = Math.max(r, g, b);
      const d = max - Math.min(r, g, b);
      if (!d) return false;
      const h =
        max === r
          ? 60 * ((g - b) / d)
          : max === g
            ? 60 * (2 + (b - r) / d)
            : 60 * (4 + (r - g) / d);
      const hue = h < 0 ? h + 360 : h;
      return hue >= 25 && hue <= 50 && d / max >= 0.62 && max / 255 >= 0.85;
    };
    expect(strong(PAL.amber), 'the amber itself').toBe(true);
    for (const key of WATERSIDE)
      for (const { rgba } of ink(key)) expect(strong(rgba), `${key} ${rgba}`).toBe(false);
  });

  it('take the light from the upper left: the left half is lighter than the right', () => {
    for (const key of WATERSIDE) {
      const f = frames[key];
      const half = (left: boolean) => {
        const px = ink(key).filter(
          ({ x, rgba }) => rgba[3] === 255 && (left ? x < f.w / 2 : x >= f.w / 2),
        );
        return px.reduce((s, { rgba }) => s + luma(rgba), 0) / px.length;
      };
      expect(half(true), key).toBeGreaterThan(half(false));
    }
  });

  it('touch their ground: a willow`s shadow under its trunk foot, a mangrove`s root tips at the waterline', () => {
    for (const key of WATERSIDE) {
      const f = frames[key];
      const px = ink(key);
      if (key.includes('willow')) {
        // the trunk foot on the anchor row, and a soft shadow right under it
        expect(
          px.some(({ x, y, rgba }) => y === f.ay && Math.abs(x - f.ax) <= 1 && rgba[3] === 255),
          key,
        ).toBe(true);
        expect(
          px.some(({ x, y, rgba }) => y === f.ay + 1 && Math.abs(x - f.ax) <= 1 && rgba[3] < 255),
          key,
        ).toBe(true);
      } else {
        // opaque root tips reach the anchor's row, on both sides of it, and nothing opaque lies
        // more than the frame's last rows below it
        const tips = px.filter(({ y, rgba }) => Math.abs(y - f.ay) <= 1 && rgba[3] === 255);
        expect(
          tips.some(({ x }) => x < f.ax - 2),
          `${key} left tips`,
        ).toBe(true);
        expect(
          tips.some(({ x }) => x > f.ax + 2),
          `${key} right tips`,
        ).toBe(true);
        expect(
          Math.max(...px.filter(({ rgba }) => rgba[3] === 255).map(({ y }) => y)),
        ).toBeLessThan(f.h);
      }
    }
  });

  it('grow from variant to variant', () => {
    for (const kind of ['mangrove', 'willow']) {
      const [a, b, c] = [0, 1, 2].map((v) => frames[`props/${kind}_${v}`]);
      expect(a.h).toBeLessThan(b.h);
      expect(b.h).toBeLessThan(c.h);
      expect(a.w).toBeLessThan(b.w);
      expect(b.w).toBeLessThan(c.w);
    }
  });
});
