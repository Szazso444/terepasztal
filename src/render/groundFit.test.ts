import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateStructuresAtlas } from '../art/structures';
import type { FrameDef } from '../engine/atlas';
import { HALF_H, HALF_W } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
import { scaleReference } from './assetScale';
import {
  bakedShadow,
  contactShadow,
  feetOf,
  FOOT_RUN,
  FOOT_TOLERANCE,
  footContour,
  footGround,
  footprint,
  footScatter,
  footShade,
  frontCorner,
  ISO_SLOPE,
  LIGHT,
  SCATTER,
  SHADE_ALPHA,
  SHADE_BAND,
  SHADOW_ALPHA,
  SHADOW_REACH,
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
/** The highest front corner a building of this size can have and still stand in its picture. */
const lowestFy = (b: Building) => Math.max(b.height + 4, Math.ceil(b.right / 2) + 18);
/**
 * Smaller buildings of the same kind, for forAll to shrink a failure with: density and scale
 * toward 1, each size toward its least, the front corner as high as the building allows.
 */
function* shrinkBuilding(b: Building): Iterable<Building> {
  const fit = (c: Building) => ({ ...c, fx: c.left + 2, fy: Math.max(c.fy, lowestFy(c)) });
  if (b.density !== 1) yield { ...b, density: 1 };
  if (b.scale !== 1) yield { ...b, scale: 1 };
  for (const left of shrinkInt(b.left, 4)) yield fit({ ...b, left });
  for (const right of shrinkInt(b.right, 4)) yield fit({ ...b, right });
  for (const height of shrinkInt(b.height, FOOT_RUN + 2)) yield fit({ ...b, height });
  for (const fy of shrinkInt(b.fy, lowestFy(b))) yield { ...b, fy };
}
/** The cast shadow's alpha at world px (x, y) from the anchor; 0 off the layer. */
function shadowAt(l: NonNullable<ReturnType<typeof contactShadow>>, x: number, y: number) {
  const i = Math.floor((x - l.x) * l.resolution),
    j = Math.floor((y - l.y) * l.resolution);
  return i >= 0 && j >= 0 && i < l.width && j < l.height ? l.data[(j * l.width + i) * 4 + 3] : 0;
}

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

  it('finds the same feet behind a yard painted on the ground, opaque rim and all', () => {
    type Case = { b: Building; depth: number; paint: number; rim: number };
    function* shrink(c: Case): Iterable<Case> {
      for (const b of shrinkBuilding(c.b)) yield { ...c, b };
      for (const depth of shrinkInt(c.depth, 1)) yield { ...c, depth };
    }
    forAll(
      (rng): Case => ({
        b: building(rng),
        depth: rng.int(1, 6),
        paint: rng.int(1, SOLID - 1),
        rim: rng.int(SOLID, 255),
      }),
      ({ b, depth, paint, rim }) => {
        const p = pictureOf(b),
          d = b.density,
          q = withMargins(p, 0, 0, 0, (depth + 1) * d),
          data = q.data as Uint8ClampedArray;
        // under each wall `depth` px of translucent paint, then a rim one px thick, as
        // PixelBuf.outline draws round a baked yard
        for (let x = 0; x < q.width; x++) {
          const X = Math.floor(x / d);
          if (X < b.fx - b.left || X > b.fx + b.right) continue;
          const below = (wallFoot(b, X) + 1) * d;
          for (let y = below; y < below + (depth + 1) * d; y++)
            data.set([30, 40, 30, y < below + depth * d ? paint : rim], (y * q.width + x) * 4);
        }
        expect([...footContour(q)]).toEqual([...footContour(p)]);
      },
      { shrink },
    );
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

  // slow because each seeded building casts its shadow at several scales: 0.35 s alone, so a limit
  // of 30 s
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
  }, 30_000);
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

/** `p` with `l`, `t`, `r` and `b` blank texels added on its left, top, right and bottom. */
function withMargins(p: Picture, l: number, t: number, r: number, b: number): Picture {
  const w = p.width + l + r,
    data = new Uint8ClampedArray(w * (p.height + t + b) * 4),
    from = p.data as Uint8ClampedArray;
  for (let y = 0; y < p.height; y++)
    data.set(from.subarray(y * p.width * 4, (y + 1) * p.width * 4), ((y + t) * w + l) * 4);
  return { data, width: w, height: p.height + t + b, density: p.density };
}
/** The shade's alpha over picture texel (x, y); 0 outside its rows. */
function shadeAt(band: NonNullable<ReturnType<typeof footShade>>, w: number, x: number, y: number) {
  const j = y - band.top;
  return j >= 0 && j < band.rows ? band.data[(j * w + x) * 4 + 3] : 0;
}

describe('the ground fit of any picture', () => {
  it('reads the picture and never writes it', () => {
    forAll(
      building,
      (b) => {
        const p = pictureOf(b),
          at = placementOf(b),
          before = Uint8ClampedArray.from(p.data as Uint8ClampedArray),
          foot = footContour(p);
        frontCorner(foot);
        footShade(p, foot);
        feetOf(p, foot, at);
        footprint(p, foot, at);
        contactShadow(p, foot, at);
        bakedShadow(p);
        expect(
          before.findIndex((v, k) => p.data[k] !== v),
          'first byte written',
        ).toBe(-1);
      },
      { shrink: shrinkBuilding },
    );
  });

  // slow because each seeded building is fitted to the ground again with a blank margin added to
  // its picture: 0.36 s alone, so a limit of 30 s
  it('lands in the same place on the ground whatever blank margin the picture has', () => {
    type Case = { b: Building; l: number; t: number; r: number; bottom: number };
    function* shrink(c: Case): Iterable<Case> {
      for (const b of shrinkBuilding(c.b)) yield { ...c, b };
      for (const k of ['l', 't', 'r', 'bottom'] as const)
        for (const n of shrinkInt(c[k])) yield { ...c, [k]: n };
    }
    forAll(
      (rng): Case => ({
        // a scale whose texel is a power of two in world px: a sample on a column's very edge
        // then falls on the same side in both pictures, not by float rounding of the anchor
        b: { ...building(rng), scale: rng.pick([0.5, 1, 2]) },
        l: rng.int(0, 9),
        t: rng.int(0, 9),
        r: rng.int(0, 9),
        bottom: rng.int(0, 9),
      }),
      ({ b, l, t, r, bottom }) => {
        const p = pictureOf(b),
          at = placementOf(b),
          q = withMargins(p, l, t, r, bottom),
          atQ = { ...at, anchorX: at.anchorX + l, anchorY: at.anchorY + t },
          foot = footContour(p),
          footQ = footContour(q);
        // the same feet, moved with the picture
        expect([...footQ]).toEqual([
          ...Array<number>(l).fill(-1),
          ...[...foot].map((f) => (f < 0 ? -1 : f + t)),
          ...Array<number>(r).fill(-1),
        ]);
        // in world px from the anchor: the same feet, ground and shadow
        expect(feetOf(q, footQ, atQ)).toEqual(feetOf(p, foot, at));
        const g = footprint(p, foot, at),
          gQ = footprint(q, footQ, atQ);
        expect([gQ.first - l, gQ.last - l]).toEqual([g.first, g.last]);
        expect([...gQ.front.subarray(l, l + p.width)]).toEqual([...g.front]);
        expect([...gQ.back.subarray(l, l + p.width)]).toEqual([...g.back]);
        const c = contactShadow(p, foot, at)!,
          cQ = contactShadow(q, footQ, atQ)!;
        expect([cQ.x, cQ.y, cQ.width, cQ.height, cQ.resolution]).toEqual([
          c.x,
          c.y,
          c.width,
          c.height,
          c.resolution,
        ]);
        expect(
          cQ.data.findIndex((v, k) => c.data[k] !== v),
          'first shadow byte that differs',
        ).toBe(-1);
        // the same shade over the same texels, and none over the margin
        const s = footShade(p, foot)!,
          sQ = footShade(q, footQ)!,
          wrong: string[] = [];
        for (let y = 0; y < q.height; y++)
          for (let x = 0; x < q.width; x++) {
            const inside = x >= l && y >= t && x < l + p.width && y < t + p.height,
              want = inside ? shadeAt(s, p.width, x - l, y - t) : 0;
            if (shadeAt(sQ, q.width, x, y) !== want) wrong.push(`${x},${y}`);
          }
        expect(wrong.slice(0, 5)).toEqual([]);
      },
      { shrink },
    );
  }, 30_000);
});

describe('a ground shadow baked into a picture, told apart', () => {
  /** A generated picture: an opaque block and 15 x 5 px of translucent `rgba` below it. */
  function withPatch(rgba: readonly number[]): Picture {
    const w = 30,
      h = 20,
      data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (x < 15 && y < 15) data.set([180, 160, 120, 255], (y * w + x) * 4);
        else if (x < 15) data.set(rgba, (y * w + x) * 4);
    return { data, width: w, height: h, density: 1 };
  }
  it('is not mistaken for other translucent paint: dark smoke, glass or water', () => {
    for (const rgba of [
      [70, 70, 70, 90],
      [40, 60, 90, 100],
      [60, 90, 140, 60],
    ])
      expect(bakedShadow(withPatch(rgba)), `${rgba}`).toBe(false);
    expect(bakedShadow(withPatch([30, 40, 30, 70]))).toBe(true);
  });
});

describe('the shade over a foot, upward', () => {
  it("fades from the foot up: never darker, for the picture's alpha, higher up a column", () => {
    forAll(
      building,
      (b) => {
        const p = pictureOf(b),
          foot = footContour(p),
          band = footShade(p, foot)!,
          own = (x: number, y: number) => p.data[(y * p.width + x) * 4 + 3],
          wrong: string[] = [];
        for (let x = 0; x < p.width; x++)
          for (let y = band.top; y < foot[x]; y++) {
            // shade over own alpha, never more above than below, but for rounding to whole bytes
            const a = shadeAt(band, p.width, x, y),
              below = shadeAt(band, p.width, x, y + 1);
            if (a * own(x, y + 1) > below * own(x, y) + (own(x, y) + own(x, y + 1)) / 2)
              wrong.push(`${x},${y}: ${a} over ${below}`);
          }
        expect(wrong.slice(0, 5)).toEqual([]);
      },
      { shrink: shrinkBuilding },
    );
  });
});

describe('the shadow a building casts, edge and reach', () => {
  it('is whole inside its layer: it fades to nothing before the layer ends', () => {
    forAll(
      building,
      (b) => {
        const p = pictureOf(b),
          l = contactShadow(p, footContour(p), placementOf(b))!,
          wrong: string[] = [];
        for (let j = 0; j < l.height; j++)
          for (let i = 0; i < l.width; i++)
            if (
              (i === 0 || j === 0 || i === l.width - 1 || j === l.height - 1) &&
              l.data[(j * l.width + i) * 4 + 3]
            )
              wrong.push(`${i},${j}`);
        expect(wrong.slice(0, 5), `layer ${l.width}x${l.height}`).toEqual([]);
      },
      { shrink: shrinkBuilding },
    );
  });

  it('is soft: clear of the picture it rises from nothing to its darkest over two world px or more', () => {
    forAll(
      building,
      (b) => {
        const p = pictureOf(b),
          at = placementOf(b),
          l = contactShadow(p, footContour(p), at)!,
          k = at.scale / p.density,
          alpha = (i: number, j: number) => l.data[(j * l.width + i) * 4 + 3],
          clear = (i: number, j: number) => {
            const px = Math.floor((l.x + (i + 0.5) / l.resolution) / k + at.anchorX),
              py = Math.floor((l.y + (j + 0.5) / l.resolution) / k + at.anchorY);
            return px < 0 || py < 0 || px >= p.width || py >= p.height
              ? true
              : !p.data[(py * p.width + px) * 4 + 3];
          };
        let darkest = 0;
        for (let n = 0; n < l.width * l.height; n++) darkest = Math.max(darkest, l.data[n * 4 + 3]);
        // two world px are 2 * resolution texels: no step between neighbours above its share
        const most = darkest / (2 * l.resolution) + 1,
          wrong: string[] = [];
        for (let j = 0; j < l.height; j++)
          for (let i = 0; i < l.width; i++) {
            if (!clear(i, j)) continue;
            for (const [di, dj] of [
              [1, 0],
              [0, 1],
            ]) {
              const i2 = i + di,
                j2 = j + dj;
              if (i2 >= l.width || j2 >= l.height || !clear(i2, j2)) continue;
              const step = Math.abs(alpha(i, j) - alpha(i2, j2));
              if (step > most) wrong.push(`${i},${j}->${i2},${j2}: ${step} of ${darkest}`);
            }
          }
        expect(darkest).toBeGreaterThan(0);
        expect(wrong.slice(0, 5)).toEqual([]);
      },
      { shrink: shrinkBuilding },
    );
  });

  /**
   * A footprint alone: the left, front and right corners of a diamond as its only three feet, on
   * a blank picture, so nothing is erased and the seams under those feet are far from the middle
   * of its edges, where the cast is sampled. `left` and `right` are its front edges' world px.
   */
  interface Diamond {
    density: number;
    scale: number;
    left: number;
    right: number;
  }
  function diamond(c: Diamond) {
    const cols = (px: number) => 2 * Math.round((px * c.density) / c.scale / 2),
      L = cols(c.left),
      R = cols(c.right),
      w = L + R + 1,
      front = L / 2 + R / 2 + 4,
      foot = new Int32Array(w).fill(-1),
      p: Picture = {
        data: new Uint8ClampedArray(w * (front + 2) * 4),
        width: w,
        height: front + 2,
        density: c.density,
      };
    foot[0] = front - L / 2;
    foot[L] = front;
    foot[w - 1] = front - R / 2;
    const at = { anchorX: L + 0.5, anchorY: front + 1, scale: c.scale },
      k = c.scale / c.density,
      // world px from the anchor: the front corner is at (0, 0)
      right = { x: R * k, y: (-R / 2) * k },
      left = { x: -L * k, y: (-L / 2) * k };
    return {
      layer: contactShadow(p, foot, at)!,
      right,
      left,
      back: { x: left.x + right.x, y: left.y + right.y },
    };
  }
  /** One tile along the light, in world px on screen. */
  const v = { x: (LIGHT.x - LIGHT.y) * HALF_W, y: (LIGHT.x + LIGHT.y) * HALF_H },
    /** The outward normals of a diamond's edges on screen (the ground lines slope 1 in 2). */
    normal = (x: number, y: number) => ({ x: x / Math.sqrt(5), y: y / Math.sqrt(5) }),
    /**
     * World px a soft edge may spread past where the shadow ends: the blur's 3, a shadow texel
     * and a picture column.
     */
    SOFT_EDGE = 5,
    /** Half way along its reach, at least a sixth of its darkest is left (of 255). */
    HALF_MIN = Math.round((SHADOW_ALPHA * 255) / 6);

  function* shrinkDiamond(c: Diamond): Iterable<Diamond> {
    if (c.density !== 1) yield { ...c, density: 1 };
    if (c.scale !== 1) yield { ...c, scale: 1 };
    for (const left of shrinkInt(c.left, 14)) yield { ...c, left };
    for (const right of shrinkInt(c.right, 14)) yield { ...c, right };
  }

  // a cast shadow for each of a hundred footprints up to 80 world px across
  it('falls SHADOW_REACH tiles along the light from the ground under it, fading, and none against the light', () => {
    forAll(
      (rng): Diamond => ({
        density: rng.pick([1, 2, 4]),
        scale: rng.pick([0.5, 0.7, 1, 1.2, 1.5]),
        left: rng.int(14, 40),
        right: rng.int(14, 40),
      }),
      (c) => {
        const { layer, right, left, back } = diamond(c),
          /** The shadow at `o` moved `s` tiles along the light and `d` px along `n`. */
          at = (o: { x: number; y: number }, s: number, n = { x: 0, y: 0 }, d = 0) =>
            shadowAt(layer, o.x + s * v.x + d * n.x, o.y + s * v.y + d * n.y),
          // the middle of each edge with its outward normal: the front two face the light's way
          frontRight = { x: right.x / 2, y: right.y / 2 },
          frontLeft = { x: left.x / 2, y: left.y / 2 },
          backLeft = { x: (left.x + back.x) / 2, y: (left.y + back.y) / 2 },
          backRight = { x: (right.x + back.x) / 2, y: (right.y + back.y) / 2 },
          profile = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((f) =>
            at(frontRight, f * SHADOW_REACH),
          ),
          says = `profile ${profile.join(',')}`;
        // along the light it fades, and is still there half way
        for (let n = 1; n < profile.length; n++)
          expect(profile[n], says).toBeLessThanOrEqual(profile[n - 1] + 1);
        expect(profile[4], says).toBeGreaterThanOrEqual(HALF_MIN);
        expect(profile[1], says).toBeGreaterThan(profile[7]);
        // it ends a soft edge past its reach
        expect(at(frontRight, SHADOW_REACH, normal(1, 2), SOFT_EDGE), 'past its reach').toBe(0);
        expect(at(frontLeft, SHADOW_REACH, normal(-1, 2), SOFT_EDGE), 'past its reach').toBe(0);
        // and against the light there is nothing past a soft edge
        expect(at(backLeft, 0, normal(-1, -2), SOFT_EDGE), 'against the light').toBe(0);
        expect(at(backRight, 0, normal(1, -2), SOFT_EDGE), 'against the light').toBe(0);
      },
      { shrink: shrinkDiamond },
    );
  }, 10_000);
});

/** Node has no ImageData: a stand-in that keeps the pixels a generator hands the atlas packer. */
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

/**
 * The building pictures the game draws, as the atlas registry layers them: the shipped
 * illustrated frames (`public/assets/structures.*`, `partial`) over the generated ones, so every
 * generated frame the file does not replace is drawn too, the turns of illustrated buildings
 * among them. Node has no canvas: the generators' own pixels are kept by stand-ins for ImageData
 * and the packer's canvas, as src/art/atlasFrames.test.ts does.
 */
describe('the building pictures the game draws', () => {
  interface Drawn {
    key: string;
    picture: Picture;
    at: Placement;
    generated: boolean;
  }
  const drawn: Drawn[] = [];
  /** Smallest picture first, so a failure names the smallest case first. */
  const bySize = (a: Drawn, b: Drawn) =>
    a.picture.width * a.picture.height - b.picture.width * b.picture.height ||
    (a.key < b.key ? -1 : 1);
  /**
   * Texels of the generators' ground shadow (`SHADOW` under `shadowRect` and `shadowEllipse` in
   * src/art/industry.ts): exactly its colour, at partial alpha.
   */
  const generatorShadow = ({ data }: Picture) => {
    let n = 0;
    for (let k = 0; k < data.length; k += 4)
      if (data[k + 3] > 0 && data[k + 3] < 255) {
        if (data[k] === 30 && data[k + 1] === 40 && data[k + 2] === 30) n++;
      }
    return n;
  };

  // generating the structures atlas and reading its shipped sheet take about a second alone
  beforeAll(() => {
    const puts = new WeakMap<object, Map<string, FakeImageData>>();
    vi.stubGlobal('ImageData', FakeImageData);
    vi.stubGlobal('document', {
      createElement: () => {
        const placed = new Map<string, FakeImageData>(),
          context = new Proxy(
            {},
            {
              get: (_, name) =>
                name === 'putImageData'
                  ? (img: FakeImageData, x: number, y: number) => placed.set(`${x},${y}`, img)
                  : name === 'getImageData'
                    ? (_x: number, _y: number, w: number, h: number) => new FakeImageData(w, h)
                    : () => undefined,
              set: () => true,
            },
          ),
          canvas = { width: 0, height: 0, getContext: () => context };
        puts.set(canvas, placed);
        return canvas;
      },
    });
    let generated: { image: object; frames: Record<string, FrameDef> };
    try {
      generated = generateStructuresAtlas();
    } finally {
      vi.unstubAllGlobals();
    }
    const placed = puts.get(generated.image)!,
      file = JSON.parse(readFileSync('public/assets/structures.json', 'utf8')) as {
        frames: Record<string, FrameDef>;
        resolution?: number;
        partial?: boolean;
      },
      sheet = PNG.sync.read(readFileSync('public/assets/structures.png')),
      resolution = file.resolution ?? 1,
      names = { has: (k: string) => k in file.frames || k in generated.frames };
    expect(file.partial, 'the shipped file layers over the generator').toBe(true);
    for (const [key, f] of Object.entries(generated.frames)) {
      const ref = scaleReference(names, key);
      if (!ref || key in file.frames) continue;
      const img = placed.get(`${f.x},${f.y}`)!;
      drawn.push({
        key,
        picture: { data: img.data, width: img.width, height: img.height, density: 1 },
        at: { anchorX: f.ax, anchorY: f.ay, scale: ref.scale },
        generated: true,
      });
    }
    for (const [key, f] of Object.entries(file.frames)) {
      const ref = scaleReference(names, key, f.h / resolution);
      if (!ref) continue;
      const data = new Uint8ClampedArray(f.w * f.h * 4);
      for (let y = 0; y < f.h; y++) {
        const from = ((f.y + y) * sheet.width + f.x) * 4;
        data.set(sheet.data.subarray(from, from + f.w * 4), y * f.w * 4);
      }
      drawn.push({
        key,
        picture: { data, width: f.w, height: f.h, density: resolution },
        at: { anchorX: f.ax, anchorY: f.ay, scale: ref.scale },
        generated: false,
      });
    }
    drawn.sort(bySize);
  }, 30_000);

  it('are many, generated and illustrated', () => {
    expect(drawn.filter((d) => d.generated).length).toBeGreaterThan(100);
    expect(drawn.filter((d) => !d.generated).length).toBeGreaterThan(50);
  });

  it('each stand on the ground: every building has a foot, so its shade and weeds', () => {
    const footless = drawn
      .filter((d) => !footContour(d.picture).some((f) => f >= 0))
      .map((d) => `${d.key} (${d.picture.width}x${d.picture.height})`);
    expect(footless, 'buildings with no foot, smallest first').toEqual([]);
  });

  it('cast no shadow of their own where the generator baked one, and only there', () => {
    const wrong = drawn
      .map((d) => ({
        d,
        baked: bakedShadow(d.picture),
        texels: d.generated ? generatorShadow(d.picture) : 0,
      }))
      .filter(({ baked, texels }) => baked !== texels > 0)
      .map(({ d, baked, texels }) => `${d.key}: baked ${baked}, ${texels} shadow texels`);
    expect(wrong, 'smallest first').toEqual([]);
  });

  // a cast shadow for each of some two hundred pictures
  it('keep their cast shadow inside its layer, under no wall, and their shade on their own alpha', () => {
    const wrong: string[] = [];
    for (const { key, picture: p, at } of drawn) {
      const foot = footContour(p);
      if (!foot.some((f) => f >= 0)) continue;
      const band = footShade(p, foot)!;
      for (let x = 0; x < p.width; x++)
        for (let j = 0; j < band.rows; j++) {
          const a = band.data[(j * p.width + x) * 4 + 3],
            own = p.data[((band.top + j) * p.width + x) * 4 + 3];
          if (a > Math.round(SHADE_ALPHA * own) + 1) wrong.push(`${key}: shade ${x},${j}`);
        }
      if (bakedShadow(p)) continue;
      const l = contactShadow(p, foot, at)!,
        k = at.scale / p.density;
      for (let j = 0; j < l.height; j++)
        for (let i = 0; i < l.width; i++) {
          const a = l.data[(j * l.width + i) * 4 + 3];
          if (!a) continue;
          if (i === 0 || j === 0 || i === l.width - 1 || j === l.height - 1)
            wrong.push(`${key}: shadow cut at ${i},${j}`);
          const px = Math.floor((l.x + (i + 0.5) / l.resolution) / k + at.anchorX),
            py = Math.floor((l.y + (j + 0.5) / l.resolution) / k + at.anchorY);
          if (px >= 0 && py >= 0 && px < p.width && py < p.height)
            if (p.data[(py * p.width + px) * 4 + 3] >= SOLID)
              wrong.push(`${key}: shadow under a wall at ${i},${j}`);
        }
    }
    expect(wrong.slice(0, 5), `${wrong.length} in all`).toEqual([]);
  }, 10_000);
});

/**
 * A picture as its columns, each from the bottom up as runs of texels of one kind: opaque (`O`,
 * `SOLID` and over), translucent (`T`) or clear (`E`), `n` texels of `alpha`. Nothing is painted
 * above a column's runs.
 */
type Run = { kind: 'O' | 'T' | 'E'; n: number; alpha: number };
interface Columns {
  density: number;
  columns: Run[][];
}
function columnsOf(rng: Rng): Columns {
  const density = rng.pick([1, 2, 4]),
    m = FOOT_RUN * density,
    run = (): Run => {
      const kind = rng.pick(['O', 'O', 'T', 'E'] as const);
      if (kind === 'E') return { kind, n: rng.int(1, 3 * density), alpha: 0 };
      if (kind === 'T')
        return {
          kind,
          n: rng.int(1, 3 * density),
          alpha: rng.pick([1, SOLID - 1, rng.int(1, SOLID - 1)]),
        };
      // a rim or a sail thinner than a wall, or a wall
      const n = rng.chance(0.5) ? rng.int(1, m - 1) : rng.int(m, m + 6);
      return { kind, n, alpha: rng.pick([SOLID, 255, rng.int(SOLID, 255)]) };
    };
  return {
    density,
    columns: Array.from({ length: rng.int(1, 9) }, () =>
      Array.from({ length: rng.int(0, 6) }, run),
    ),
  };
}
/** Lower density, fewer columns, fewer and shorter runs. */
function* shrinkColumns(c: Columns): Iterable<Columns> {
  if (c.density !== 1) yield { ...c, density: 1 };
  const shrinkRun = function* (r: Run): Iterable<Run> {
    for (const n of shrinkInt(r.n, 1)) yield { ...r, n };
  };
  for (const columns of shrinkArray(c.columns, (runs) => shrinkArray(runs, shrinkRun)))
    yield { ...c, columns };
}
const formatColumns = (c: Columns) =>
  `density ${c.density}, columns bottom up: ` +
  c.columns
    .map((runs) => runs.map((r) => `${r.kind}${r.alpha}x${r.n}`).join(' ') || '-')
    .join(' | ');
function pictureOfColumns({ density, columns }: Columns): Picture {
  const w = columns.length,
    h = Math.max(1, ...columns.map((runs) => runs.reduce((s, r) => s + r.n, 0))),
    data = new Uint8ClampedArray(w * h * 4);
  columns.forEach((runs, x) => {
    let y = h - 1;
    for (const r of runs)
      for (let i = 0; i < r.n; i++, y--) data.set([120, 110, 90, r.alpha], (y * w + x) * 4);
  });
  return { data, width: w, height: h, density };
}
/**
 * footContour's rule read slowly, as its comment states it. Each column from the bottom up is a
 * word of O, T and E. It stands on the ground where, past the clear and translucent texels under
 * its paint, each of its thin opaque runs has translucent paint over it, up to a run `FOOT_RUN`
 * world px tall whose lowest texel is the foot. Of those feet only the ones on or below the ground
 * lines through the front corner, within `FOOT_TOLERANCE`, are kept.
 */
function slowFootContour({ data, width: w, height: h, density: d }: Picture): Int32Array {
  const m = FOOT_RUN * d,
    standing = new RegExp(`^[TE]*(?:O{1,${m - 1}}T+)*(?=O{${m}})`),
    raw = Int32Array.from({ length: w }, (_, x) => {
      let word = '';
      for (let y = h - 1; y >= 0; y--) {
        const a = data[(y * w + x) * 4 + 3];
        word += a >= SOLID ? 'O' : a > 0 ? 'T' : 'E';
      }
      const under = standing.exec(word);
      return under ? h - 1 - under[0].length : -1;
    }),
    low = Math.max(-1, ...raw);
  if (low < 0) return raw;
  const lowest = [...raw.keys()].filter((x) => raw[x] === low),
    apex = Math.floor((lowest[0] + lowest[lowest.length - 1]) / 2);
  return raw.map((f, x) =>
    f >= 0 && f >= low - ISO_SLOPE * Math.abs(x - apex) - FOOT_TOLERANCE * d ? f : -1,
  );
}

describe('the feet of any picture, against the rule read slowly', () => {
  // five hundred small pictures of rims, paint, gaps, sails and walls
  it('are the feet footContour finds', () => {
    forAll(
      columnsOf,
      (c) => {
        const p = pictureOfColumns(c);
        expect([...footContour(p)]).toEqual([...slowFootContour(p)]);
      },
      {
        seeds: Array.from({ length: 500 }, (_, i) => i + 1),
        shrink: shrinkColumns,
        format: formatColumns,
      },
    );
  });

  it('give a thin run with a clear texel or the picture edge over it no foot, paint or not', () => {
    for (const d of [1, 2, 4]) {
      const m = FOOT_RUN * d,
        O = (n: number): Run => ({ kind: 'O', n, alpha: 255 }),
        T = (n: number): Run => ({ kind: 'T', n, alpha: 100 }),
        E = (n: number): Run => ({ kind: 'E', n, alpha: 0 }),
        foot = (...runs: Run[]) =>
          footContour(pictureOfColumns({ density: d, columns: [runs] }))[0];
      // a sail; a sail over paint; a rim and its paint under a gap; a rim at the picture's top
      expect(foot(O(m - 1), E(1), O(m)), `density ${d}`).toBe(-1);
      expect(foot(T(2), O(m - 1), E(1), O(m)), `density ${d}`).toBe(-1);
      expect(foot(O(1), T(3), E(1), O(m)), `density ${d}`).toBe(-1);
      expect(foot(O(1), T(3), O(m - 1)), `density ${d}`).toBe(-1);
      // the rim of a yard, its paint and the wall behind: the wall's lowest texel
      expect(foot(O(1), T(3), O(m)), `density ${d}`).toBe(m - 1);
      expect(foot(E(2), O(2), T(1), O(1), T(2), O(m + 3)), `density ${d}`).toBe(m + 2);
    }
  });
});

describe('the feet the weeds grow from', () => {
  it('stand on the contour about one world px apart, the front corner among them', () => {
    forAll(
      building,
      (b) => {
        const p = pictureOf(b),
          at = placementOf(b),
          foot = footContour(p),
          feet = feetOf(p, foot, at),
          k = at.scale / p.density,
          front = frontCorner(foot),
          wrong: string[] = [];
        // each is a column's foot: the bottom edge of its foot texel, in world px from the anchor
        const cols = feet.map((f) => Math.round(f.x / k + at.anchorX - 0.5));
        feet.forEach((f, n) => {
          const c = cols[n];
          if (foot[c] < 0) wrong.push(`foot ${n} on footless column ${c}`);
          if (Math.abs(f.x - (c + 0.5 - at.anchorX) * k) > 1e-9) wrong.push(`foot ${n} x`);
          if (Math.abs(f.y - (foot[c] + 1 - at.anchorY) * k) > 1e-9) wrong.push(`foot ${n} y`);
          if (f.right !== c > front) wrong.push(`foot ${n} right ${f.right}`);
          if (n > 0 && (cols[n] - cols[n - 1]) * k < 0.5 - 1e-9)
            wrong.push(`feet ${n - 1} and ${n} under half a world px apart`);
        });
        if (!cols.includes(front)) wrong.push(`front corner ${front} not among them`);
        // and never a world px and a half of the ground without one
        for (let c = 0; c < foot.length; c++)
          if (foot[c] >= 0 && !cols.some((q) => Math.abs(q - c) * k < 1.5))
            wrong.push(`column ${c} far from every foot`);
        expect(wrong.slice(0, 5)).toEqual([]);
      },
      { shrink: shrinkBuilding },
    );
  });
});
