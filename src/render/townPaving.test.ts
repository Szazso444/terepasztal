import { describe, expect, it } from 'vitest';
import { Dir, DIR_DX, DIR_DY } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { forAll, shrinkArray } from '../testing/property';
import {
  doorstepChanges,
  doorstepTiles,
  PAVING_DEEP,
  PAVING_FRINGE,
  PAVING_SOLID,
  pavingDoorsteps,
  settAt,
  TownPaving,
  type PavingDoor,
} from './townPaving';

/** A small map's paved tiles and street doors, with the map points a property reads. */
interface Town {
  w: number;
  h: number;
  originX: number;
  originY: number;
  paved: number[];
  doors: { x: number; y: number; side: Dir }[];
  points: [number, number][];
}
function town(rng: Rng, points = 200): Town {
  const w = rng.int(3, 12),
    h = rng.int(3, 12),
    density = rng.range(0.2, 0.9),
    paved: number[] = [],
    doors: Town['doors'] = [];
  for (let k = 0; k < w * h; k++) if (rng.chance(density)) paved.push(k);
  for (let n = rng.int(0, 6); n > 0; n--)
    doors.push({ x: rng.int(0, w - 1), y: rng.int(0, h - 1), side: rng.int(0, 3) as Dir });
  return {
    w,
    h,
    originX: rng.int(-3000, 3000),
    originY: rng.int(-3000, 3000),
    paved,
    doors,
    points: Array.from({ length: points }, () => [
      rng.range(-0.5, w - 0.5),
      rng.range(-0.5, h - 0.5),
    ]),
  };
}
function* shrinkTown(c: Town): Iterable<Town> {
  for (const points of shrinkArray(c.points)) yield { ...c, points };
  for (const doors of shrinkArray(c.doors)) yield { ...c, doors };
  for (const paved of shrinkArray(c.paved)) yield { ...c, paved };
}
const doorsOf = (c: Town): PavingDoor[] => c.doors.map((d) => ({ tile: d, side: d.side }));
function paving(c: Town) {
  const paved = new Set(c.paved);
  const steps = pavingDoorsteps(doorsOf(c), (k) => paved.has(k), c.w, c.h);
  return new TownPaving(c.w, c.h, c.originX, c.originY, c.paved, steps);
}
/** The range of `distance` the picture depends on: beyond it the fringe or the wear has ended. */
const felt = (d: number) => Math.max(-PAVING_FRINGE, Math.min(PAVING_DEEP, d));
/** How much `distance` may change per tile travelled: the outline's 1 and its wobble's 1.2. */
const SLOPE = 2.2;

describe('the town paving outline', () => {
  it('changes no faster than the way travelled, so no tile or chunk edge shows a seam', () => {
    forAll(
      (rng) => town(rng),
      (c) => {
        const p = paving(c);
        for (const [x, y] of c.points) {
          // a step across the nearest tile edge, either way
          const ex = Math.round(x) + 0.5 - x < 0.5 ? Math.round(x) + 0.5 : Math.round(x) - 0.5,
            ey = Math.round(y) + 0.5 - y < 0.5 ? Math.round(y) + 0.5 : Math.round(y) - 0.5;
          for (const [u, v] of [
            [ex - 0.004, y],
            [x, ey - 0.004],
            [ex - 0.004, ey - 0.004],
          ]) {
            const step = 0.008,
              u2 = u + (u === x ? 0 : step),
              v2 = v + (v === y ? 0 : step);
            // the painter reads the map only
            if (u < -0.5 || v < -0.5 || u2 >= c.w - 0.5 || v2 >= c.h - 0.5) continue;
            const a = felt(p.distance(u, v)),
              b = felt(p.distance(u2, v2)),
              travelled = Math.hypot(u2 - u, v2 - v);
            if (Math.abs(a - b) > SLOPE * travelled + 1e-9) return false;
          }
        }
        return true;
      },
      { shrink: shrinkTown },
    );
  });

  it('covers a paved tile from 0.4 tile in, and leaves ground 0.3 tile from any paving bare', () => {
    forAll(
      (rng) => town(rng),
      (c) => {
        const p = paving(c),
          paved = new Set(c.paved);
        const steps = pavingDoorsteps(doorsOf(c), (k) => paved.has(k), c.w, c.h);
        for (const [x, y] of c.points) {
          // distance to the nearest paved tile, and to the nearest tile that is not (or off the map)
          let toPaved = Infinity,
            toBare = Infinity;
          for (let j = -1; j <= c.h; j++)
            for (let i = -1; i <= c.w; i++) {
              const d = Math.hypot(
                Math.max(0, Math.abs(x - i) - 0.5),
                Math.max(0, Math.abs(y - j) - 0.5),
              );
              const on = i >= 0 && j >= 0 && i < c.w && j < c.h && paved.has(j * c.w + i);
              if (on) toPaved = Math.min(toPaved, d);
              else toBare = Math.min(toBare, d);
            }
          for (let at = 0; at < steps.length; at += 4)
            toPaved = Math.min(
              toPaved,
              Math.hypot(
                Math.max(0, Math.abs(x - steps[at]) - steps[at + 2]),
                Math.max(0, Math.abs(y - steps[at + 1]) - steps[at + 3]),
              ),
            );
          const d = p.distance(x, y);
          if (toBare >= 0.4 && !(d > 0)) return false;
          if (toPaved >= 0.3 && d > -PAVING_FRINGE) return false;
        }
        return true;
      },
      { shrink: shrinkTown },
    );
  });

  it('reaches no tile it does not flag as near', () => {
    forAll(
      (rng) => town(rng),
      (c) => {
        const p = paving(c);
        for (const [x, y] of c.points) {
          const k = Math.round(y) * c.w + Math.round(x);
          if (!p.near(k) && p.distance(x, y) > -PAVING_FRINGE) return false;
        }
        return true;
      },
      { shrink: shrinkTown },
    );
  });
});

describe('doorsteps', () => {
  /** One paved tile in the middle of a 5 x 5 map, with a door on the side `side`. */
  const lone = (side: Dir, door = true) => {
    const tiles = [12];
    const steps = door
      ? pavingDoorsteps([{ tile: { x: 2, y: 2 }, side }], (k) => k === 12, 5, 5)
      : [];
    return new TownPaving(5, 5, 40, -70, tiles, steps);
  };

  it('pave the ground in front of a door on a paved tile, out over the tile it faces', () => {
    for (const side of [Dir.N, Dir.E, Dir.S, Dir.W]) {
      const x = 2 + DIR_DX[side] * 0.66,
        y = 2 + DIR_DY[side] * 0.66;
      expect(lone(side, false).distance(x, y), `side ${side}, no door`).toBeLessThan(0);
      expect(lone(side).distance(x, y), `side ${side}`).toBeGreaterThan(0);
      // beside the doorstep the edge is where it was
      const bx = x + DIR_DY[side] * 0.45,
        by = y + DIR_DX[side] * 0.45;
      expect(lone(side).distance(bx, by)).toBe(lone(side, false).distance(bx, by));
    }
  });

  it('are laid only for doors on paved tiles on the map', () => {
    const doors: PavingDoor[] = [
      { tile: { x: 1, y: 1 }, side: Dir.S },
      { tile: { x: 2, y: 1 }, side: Dir.E },
      { tile: { x: -1, y: 0 }, side: Dir.S },
      { tile: { x: 3, y: 3 }, side: Dir.N },
    ];
    const steps = pavingDoorsteps(doors, (k) => k === 1 * 4 + 1 || k === 3 * 4 + 3, 4, 4);
    expect(steps).toHaveLength(8);
    expect(steps.slice(0, 2)).toEqual([1, 1.56]);
    expect(steps.slice(4, 6)).toEqual([3, 2.44]);
  });

  it('repaint the tiles of the doorsteps laid or taken up, and nothing when none changed', () => {
    const w = 6,
      h = 6;
    const a = pavingDoorsteps([{ tile: { x: 2, y: 2 }, side: Dir.S }], () => true, w, h);
    const b = pavingDoorsteps(
      [
        { tile: { x: 2, y: 2 }, side: Dir.S },
        { tile: { x: 4, y: 1 }, side: Dir.E },
      ],
      () => true,
      w,
      h,
    );
    expect(doorstepChanges(a, a, w, h).size).toBe(0);
    expect([...doorstepChanges(a, b, w, h)].sort((p, q) => p - q)).toEqual(
      doorstepTiles(b, 4, w, h).sort((p, q) => p - q),
    );
    expect([...doorstepChanges(b, a, w, h)].sort((p, q) => p - q)).toEqual(
      doorstepTiles(b, 4, w, h).sort((p, q) => p - q),
    );
    // the door's tile and the tile it faces
    expect(doorstepTiles(b, 4, w, h).sort((p, q) => p - q)).toEqual([1 * w + 4, 1 * w + 5]);
  });
});

describe('the paving picture', () => {
  const GROUND = [70, 190, 60];
  const OTHER = [200, 40, 210];

  it('reads no ground from PAVING_SOLID in, and no sett is missing from PAVING_DEEP in', () => {
    forAll(
      (rng) => town(rng),
      (c) => {
        const p = paving(c),
          a = [0, 0, 0],
          b = [0, 0, 0];
        for (const [x, y] of c.points) {
          const d = p.distance(x, y);
          if (d < PAVING_SOLID) continue;
          p.paint(x, y, d, GROUND, 1, a);
          p.paint(x, y, d, OTHER, 1, b);
          if (a.some((v, i) => v !== b[i])) return false;
          if (d < PAVING_DEEP) continue;
          // the fast path skips the sett's centre: it must lie where no wear reaches either
          const sett = settAt(x + c.originX, y + c.originY);
          if (p.distance(sett.u - c.originX, sett.v - c.originY) < PAVING_SOLID) return false;
        }
        return true;
      },
      { shrink: shrinkTown },
    );
  });

  it('is warm sandstone in one value band, and wears into the ground at its edge', () => {
    let near = 0,
      nearN = 0,
      deep = 0,
      deepN = 0;
    const out = [0, 0, 0];
    forAll(
      (rng) => town(rng, 400),
      (c) => {
        const p = paving(c);
        for (const [x, y] of c.points) {
          const d = p.distance(x, y);
          if (d <= 0) continue;
          p.paint(x, y, d, GROUND, 2, out);
          const off = Math.hypot(out[0] - GROUND[0], out[1] - GROUND[1], out[2] - GROUND[2]);
          if (d < 0.04) {
            near += off;
            nearN++;
          } else if (d >= PAVING_SOLID) {
            deep += off;
            deepN++;
            const [r, g, b] = out;
            if (!(r >= g && g >= b && b >= 90 && r <= 200)) return false;
          }
        }
        return true;
      },
    );
    expect(nearN).toBeGreaterThan(50);
    expect(deepN).toBeGreaterThan(500);
    expect(near / nearN).toBeLessThan((deep / deepN) * 0.5);
  });

  it('is the same at a world point whatever the map around it, so a grown map keeps it', () => {
    forAll(
      (rng) => {
        const c = town(rng, 100);
        return { c, dx: rng.int(0, 5), dy: rng.int(0, 5) };
      },
      ({ c, dx, dy }) => {
        // the same town on a map grown by dx, dy tiles at its west and north ends
        const inner = { ...c, w: c.w + 4, h: c.h + 4 };
        const shift = (k: number, w: number, by: number, bx: number) =>
          (Math.floor(k / c.w) + by) * w + (k % c.w) + bx;
        const a: Town = {
          ...inner,
          paved: c.paved.map((k) => shift(k, inner.w, 2, 2)),
          doors: c.doors.map((d) => ({ ...d, x: d.x + 2, y: d.y + 2 })),
        };
        const grown: Town = {
          ...a,
          w: a.w + dx,
          h: a.h + dy,
          originX: a.originX - dx,
          originY: a.originY - dy,
          paved: a.paved.map((k) => (Math.floor(k / a.w) + dy) * (a.w + dx) + (k % a.w) + dx),
          doors: a.doors.map((d) => ({ ...d, x: d.x + dx, y: d.y + dy })),
        };
        const p = paving(a),
          q = paving(grown),
          u = [0, 0, 0],
          v = [0, 0, 0];
        for (const [x0, y0] of c.points) {
          // (world coordinates summed the other way round may differ in their last bit)
          const x = x0 + 2,
            y = y0 + 2,
            d = p.distance(x, y),
            e = q.distance(x + dx, y + dy);
          if (Math.abs(d - e) > 1e-9) return false;
          if (d <= 0) continue;
          p.paint(x, y, d, GROUND, 1, u);
          q.paint(x + dx, y + dy, e, GROUND, 1, v);
          if (u.some((n, i) => Math.abs(n - v[i]) > 1e-6)) return false;
        }
        return true;
      },
    );
  });
});
