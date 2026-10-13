import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Rng } from '../engine/rng';
import { forAll } from '../testing/property';
import {
  bakedShadow,
  contactShadow,
  feetOf,
  FOOT_RUN,
  footContour,
  footGround,
  footprint,
  footScatter,
  footShade,
  SCATTER,
  SHADE_ALPHA,
  SHADE_BAND,
  SHADOW_RGB,
  SOLID,
  type Picture,
  type Placement,
} from './groundFit';
import { Material } from './landscapeModel';

/**
 * A generated test building: a wall standing on two ground lines that meet at its front corner
 * (`fx`, `fy` in world px), `left` and `right` px to each side, `height` px tall, drawn at
 * `density` texels per world px. Beside it, two things whose lowest pixels are not on the ground:
 * a sail (a thin bar) and a tank (a thick block well above the ground lines).
 */
interface Building {
  density: number;
  fx: number;
  fy: number;
  left: number;
  right: number;
  height: number;
  scale: number;
}
function building(rng: Rng): Building {
  const left = rng.int(4, 16),
    right = rng.int(4, 16),
    height = rng.int(FOOT_RUN + 2, 20);
  return {
    density: rng.pick([1, 2, 4]),
    fx: left + 2,
    fy: Math.max(height + 4, Math.ceil(right / 2) + 18) + rng.int(0, 4),
    left,
    right,
    height,
    scale: rng.pick([0.5, 0.7, 1, 1.2, 1.5]),
  };
}
const wallFoot = (b: Building, X: number) => b.fy - Math.floor(Math.abs(X - b.fx) / 2);
const sailAt = (b: Building, X: number) => X >= b.fx + b.right + 2 && X <= b.fx + b.right + 8;
const tankAt = (b: Building, X: number) => X >= b.fx + b.right + 10 && X <= b.fx + b.right + 14;
/**
 * The world column's paint: its opaque rows [top, bottom], or null. The building is a box: its far
 * side is its feet turned half round, and its walls rise `height` above that.
 */
function paint(b: Building, X: number): [number, number] | null {
  const l = b.fx - b.left,
    r = b.fx + b.right;
  if (X >= l && X <= r)
    return [wallFoot(b, l) + wallFoot(b, r) - wallFoot(b, l + r - X) - b.height, wallFoot(b, X)];
  if (sailAt(b, X)) {
    const bottom = wallFoot(b, b.fx + b.right) - 1;
    return [bottom - 1, bottom];
  }
  if (tankAt(b, X)) {
    const bottom = b.fy - Math.ceil((X - b.fx) / 2) - 4;
    return [bottom - 6, bottom];
  }
  return null;
}
/** Its picture: world px drawn as `density` x `density` texel blocks, opaque but not all alike. */
function pictureOf(b: Building): Picture {
  const d = b.density,
    W = b.fx + b.right + 16,
    H = b.fy + 3,
    data = new Uint8ClampedArray(W * d * H * d * 4);
  for (let y = 0; y < H * d; y++)
    for (let x = 0; x < W * d; x++) {
      const rows = paint(b, Math.floor(x / d)),
        Y = Math.floor(y / d);
      if (!rows || Y < rows[0] || Y > rows[1]) continue;
      const k = (y * W * d + x) * 4;
      data.set([200, 180, 150, 200 + ((x * 7 + y * 13) % 56)], k);
    }
  return { data, width: W * d, height: H * d, density: d };
}
const placementOf = (b: Building): Placement => ({
  anchorX: (b.fx + 0.5) * b.density,
  anchorY: (b.fy - 6) * b.density,
  scale: b.scale,
});

describe('a building picture standing on the ground', () => {
  it("keeps each wall column's lowest opaque texel as its foot, and no foot under a sail or a tank", () => {
    forAll(building, (b) => {
      const p = pictureOf(b),
        foot = footContour(p),
        d = b.density;
      for (let x = 0; x < p.width; x++) {
        const X = Math.floor(x / d);
        if (X >= b.fx - b.left && X <= b.fx + b.right)
          expect(foot[x], `column ${x}`).toBe((wallFoot(b, X) + 1) * d - 1);
        else expect(foot[x], `column ${x}`).toBe(-1);
      }
    });
  });

  it('finds the same feet at every density', () => {
    forAll(building, (b) => {
      const one = footContour(pictureOf({ ...b, density: 1 })),
        d = b.density,
        many = footContour(pictureOf(b));
      for (let x = 0; x < many.length; x++) {
        const f = one[Math.floor(x / d)];
        expect(many[x], `column ${x}`).toBe(f < 0 ? -1 : (f + 1) * d - 1);
      }
    });
  });

  it('has no foot where nothing stands', () => {
    const empty = { data: new Uint8ClampedArray(8 * 8 * 4), width: 8, height: 8, density: 1 };
    expect([...footContour(empty)].every((f) => f === -1)).toBe(true);
    expect(footShade(empty, footContour(empty))).toBeNull();
    expect(contactShadow(empty, footContour(empty), { anchorX: 4, anchorY: 6, scale: 1 })).toBe(
      null,
    );
  });
});

describe('the shade over a foot', () => {
  it("darkens only the picture's own texels, most at the foot, and is gone a band above it", () => {
    forAll(building, (b) => {
      const p = pictureOf(b),
        before = new Uint8ClampedArray(p.data as Uint8ClampedArray),
        foot = footContour(p),
        band = footShade(p, foot)!,
        d = b.density;
      const wrong: string[] = [];
      // the picture is read, never written
      for (let k = 0; k < before.length; k++) if (p.data[k] !== before[k]) wrong.push(`byte ${k}`);
      for (let j = 0; j < band.rows; j++)
        for (let x = 0; x < p.width; x++) {
          const y = band.top + j,
            k = (j * p.width + x) * 4,
            a = band.data[k + 3],
            own = p.data[(y * p.width + x) * 4 + 3];
          if (!a) continue;
          if (SHADOW_RGB.some((c, n) => band.data[k + n] !== c)) wrong.push(`${x},${y} colour`);
          if (a > Math.round(SHADE_ALPHA * own) + 1) wrong.push(`${x},${y} over its own alpha`);
          if (foot[x] < y || foot[x] - y >= SHADE_BAND * d) wrong.push(`${x},${y} off the band`);
        }
      // every foot is darkened at its own row, by its own alpha
      for (let x = 0; x < p.width; x++)
        if (
          foot[x] >= 0 &&
          band.data[((foot[x] - band.top) * p.width + x) * 4 + 3] !==
            Math.round(SHADE_ALPHA * p.data[(foot[x] * p.width + x) * 4 + 3])
        )
          wrong.push(`foot ${x}`);
      expect(wrong.slice(0, 5)).toEqual([]);
    });
  });
});

describe('the shadow a building casts', () => {
  /** World px from the anchor of shadow texel (i, j), and the picture texel under it. */
  function under(p: Picture, at: Placement, l: NonNullable<ReturnType<typeof contactShadow>>) {
    const k = at.scale / p.density;
    return (i: number, j: number) => {
      const x = l.x + (i + 0.5) / l.resolution,
        y = l.y + (j + 0.5) / l.resolution,
        px = Math.floor(x / k + at.anchorX),
        py = Math.floor(y / k + at.anchorY),
        inside = px >= 0 && py >= 0 && px < p.width && py < p.height;
      return { x, y, alpha: inside ? p.data[(py * p.width + px) * 4 + 3] : 0 };
    };
  }

  it('falls from the ground under the building, closed by its far side', () => {
    forAll(building, (b) => {
      const p = pictureOf(b),
        g = footprint(p, footContour(p), placementOf(b)),
        tol = 1e-9;
      expect(g.first).toBeGreaterThanOrEqual(0);
      // no depth at the outermost feet, the same depth at a column and its mirror, never negative
      expect(Math.abs(g.front[g.first] - g.back[g.first])).toBeLessThan(tol);
      expect(Math.abs(g.front[g.last] - g.back[g.last])).toBeLessThan(tol);
      for (let c = g.first; c <= g.last; c++) {
        const m = g.first + g.last - c;
        expect(g.front[c] - g.back[c]).toBeGreaterThanOrEqual(0);
        expect(Math.abs(g.front[c] - g.back[c] - (g.front[m] - g.back[m]))).toBeLessThan(1e-6);
      }
    });
  });

  it('is a cool slate, never shows through the picture and falls to the lower right', () => {
    forAll(building, (b) => {
      const p = pictureOf(b),
        at = placementOf(b),
        foot = footContour(p),
        layer = contactShadow(p, foot, at)!,
        at2 = under(p, at, layer);
      let sum = 0,
        sx = 0,
        sy = 0;
      const wrong: string[] = [];
      for (let j = 0; j < layer.height; j++)
        for (let i = 0; i < layer.width; i++) {
          const k = (j * layer.width + i) * 4,
            a = layer.data[k + 3];
          if (SHADOW_RGB.some((c, n) => layer.data[k + n] !== c)) wrong.push(`${i},${j} colour`);
          if (!a) continue;
          const q = at2(i, j);
          // never through a wall's texel; through a soft edge only by what the edge lets through
          if (q.alpha >= SOLID || a > 255 - q.alpha + 1) wrong.push(`${i},${j} over ${q.alpha}`);
          sum += a;
          sx += a * q.x;
          sy += a * q.y;
        }
      expect(wrong.slice(0, 5)).toEqual([]);
      // a cool slate: blue over green over red, never olive
      expect(SHADOW_RGB[2]).toBeGreaterThanOrEqual(SHADOW_RGB[1]);
      expect(SHADOW_RGB[1]).toBeGreaterThanOrEqual(SHADOW_RGB[0]);
      const feet = feetOf(p, foot, at),
        fx = feet.reduce((s, f) => s + f.x, 0) / feet.length,
        fy = feet.reduce((s, f) => s + f.y, 0) / feet.length;
      expect(sum).toBeGreaterThan(0);
      expect(sx / sum, 'right of the feet').toBeGreaterThan(fx);
      expect(sy / sum, 'below the feet').toBeGreaterThan(fy);
    });
  });

  it('reaches as far past the feet at any scale the building is drawn at', () => {
    forAll(building, (b) => {
      const p = pictureOf(b),
        foot = footContour(p),
        reach = (scale: number) => {
          const at = { ...placementOf(b), scale },
            l = contactShadow(p, foot, at)!,
            last = Math.max(...feetOf(p, foot, at).map((f) => f.x));
          let right = -Infinity;
          for (let j = 0; j < l.height; j++)
            for (let i = 0; i < l.width; i++)
              if (l.data[(j * l.width + i) * 4 + 3] > 8)
                right = Math.max(right, l.x + (i + 0.5) / l.resolution);
          return right - last;
        };
      expect(Math.abs(reach(1) - reach(2))).toBeLessThanOrEqual(1.5);
    });
  });
});

describe('a ground shadow baked into a picture', () => {
  /** A generated picture: an opaque block and, when `shadow`, a patch of the generators' shadow. */
  function generated(shadow: boolean, density = 1): Picture {
    const w = 30 * density,
      h = 20 * density,
      data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = (y * w + x) * 4;
        if (x < 15 * density && y < 15 * density) data.set([180, 160, 120, 255], k);
        else if (shadow && y >= 15 * density) data.set([30, 40, 30, 70], k);
      }
    return { data, width: w, height: h, density };
  }
  it('is found in a generated picture that has one, and in none without', () => {
    expect(bakedShadow(generated(true))).toBe(true);
    expect(bakedShadow(generated(false))).toBe(false);
  });
  it('is never assumed in an illustrated picture, whose soft dark edges only look like one', () => {
    expect(bakedShadow(generated(true, 4))).toBe(false);
  });
});

describe('weeds and pebbles at a foot', () => {
  afterEach(() => vi.restoreAllMocks());
  const row = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      x: i - n / 2,
      y: 4 - Math.abs(i - n / 2) / 2,
      right: i > n / 2,
    }));

  it('come from the tile alone: the same every time, and never from Math.random', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random');
    });
    const feet = row(60);
    expect(footScatter(feet, 12, 34, 'grass')).toEqual(footScatter(feet, 12, 34, 'grass'));
    expect(footScatter(feet, 12, 34, 'grass')).not.toEqual(footScatter(feet, 13, 34, 'grass'));
  });

  it('stand on the ground in front of the foot, at their sizes, in their share', () => {
    forAll(
      (rng) => ({
        tx: rng.int(-500, 500),
        ty: rng.int(-500, 500),
        ground: rng.pick(['grass', 'dry', 'stony'] as const),
      }),
      ({ tx, ty, ground }) => {
        const feet = row(400),
          items = footScatter(feet, tx, ty, ground);
        for (const it of items) {
          const f = feet.find((q) => q.x === it.x)!;
          expect(it.y).toBeGreaterThanOrEqual(f.y);
          if (it.kind === 'tuft') {
            expect(it.h).toBeGreaterThanOrEqual(1.9);
            expect(it.h).toBeLessThanOrEqual(3.7);
            expect(it.dark).toBe(f.right);
          } else {
            expect(it.s).toBeGreaterThanOrEqual(0.7);
            expect(it.s).toBeLessThanOrEqual(1.4);
          }
        }
        const tufts = items.filter((i) => i.kind === 'tuft').length / feet.length,
          pebbles = items.filter((i) => i.kind === 'pebble').length / feet.length;
        expect(Math.abs(tufts - SCATTER[ground].tuft)).toBeLessThan(0.1);
        expect(Math.abs(pebbles - SCATTER[ground].pebble)).toBeLessThan(0.1);
      },
      { seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    );
  });

  it('grow on no paving and in no water', () => {
    const feet = row(100);
    expect(footGround(Material.Grass, true)).toBe('none');
    expect(footGround(Material.Water, false)).toBe('none');
    expect(footScatter(feet, 3, 4, 'none')).toEqual([]);
    expect(footGround(Material.Desert, false)).toBe('dry');
    expect(footGround(Material.Rock, false)).toBe('stony');
    expect(footGround(Material.Forest, false)).toBe('grass');
  });
});
