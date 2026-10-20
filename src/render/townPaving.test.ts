import { describe, expect, it } from 'vitest';
import { Dir, DIR_DX, DIR_DY } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { forAll, shrinkArray } from '../testing/property';
import { picture } from '../testing/townPaving';
import { doorsOf as placeDoors, type PlaceDef } from '../sim/doors';
import { ROAD_FEATHER, ROAD_HALF, ROAD_RAG, ROAD_REACH } from './roadShape';
import { roadWeight } from './roadPaint';
import {
  courseAt,
  doorstepChanges,
  doorstepTiles,
  FRINGE_EARTH,
  LANE_FADE,
  LANE_FULL,
  LANE_REACH,
  laneWeight,
  PAVING_DEEP,
  PAVING_FRINGE,
  PAVING_SOLID,
  pavingDoorsteps,
  settAt,
  streetWeight,
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

/** Is tile (i, j) paved? Off the map counts as bare ground, as it does for the painter. */
const pavedAt = (c: Town, paved: ReadonlySet<number>, i: number, j: number) =>
  i >= 0 && j >= 0 && i < c.w && j < c.h && paved.has(j * c.w + i);
/** Distance from (x, y) to the segment from (ax, ay) to (bx, by). */
function toSegment(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const ux = bx - ax,
    uy = by - ay,
    t = Math.max(0, Math.min(1, ((x - ax) * ux + (y - ay) * uy) / (ux * ux + uy * uy || 1)));
  return Math.hypot(x - ax - t * ux, y - ay - t * uy);
}
/** A tile's corners, as the directions out of it there. */
const CORNERS = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const;
/**
 * The oracle: signed distance (inside positive) from (x, y) to the paved tiles with every convex
 * corner rounded to a quarter circle of radius r and every concave one left sharp, worked out piece
 * by piece from the sides between paved and bare tiles and the arcs at the corners. Pieces of tiles
 * more than two from the point's own lie a tile away, beyond anything the paving shows.
 */
function roundedTiles(c: Town, paved: ReadonlySet<number>, r: number, x: number, y: number) {
  const at = (i: number, j: number) => pavedAt(c, paved, i, j);
  // a convex corner: the tiles beside the paved tile on both sides of the corner are bare
  const convex = (i: number, j: number, sx: number, sy: number) => !at(i + sx, j) && !at(i, j + sy);
  const i0 = Math.round(x),
    j0 = Math.round(y);
  let edge = Infinity;
  for (let j = j0 - 2; j <= j0 + 2; j++)
    for (let i = i0 - 2; i <= i0 + 2; i++) {
      if (!at(i, j)) continue;
      for (const [sx, sy] of CORNERS) {
        if (!convex(i, j, sx, sy)) continue;
        // the arc from side to side, its centre r in from the corner on both
        const vx = x - (i + sx * (0.5 - r)),
          vy = y - (j + sy * (0.5 - r));
        edge = Math.min(
          edge,
          vx * sx >= 0 && vy * sy >= 0
            ? Math.abs(Math.hypot(vx, vy) - r)
            : Math.min(Math.hypot(vx - sx * r, vy), Math.hypot(vx, vy - sy * r)),
        );
      }
      // the sides facing bare ground, cut back by r where they end in a convex corner
      for (const s of [-1, 1]) {
        if (!at(i + s, j)) {
          const a = j - 0.5 + (convex(i, j, s, -1) ? r : 0),
            b = j + 0.5 - (convex(i, j, s, 1) ? r : 0);
          edge = Math.min(edge, toSegment(x, y, i + s * 0.5, a, i + s * 0.5, b));
        }
        if (!at(i, j + s)) {
          const a = i - 0.5 + (convex(i, j, -1, s) ? r : 0),
            b = i + 0.5 - (convex(i, j, 1, s) ? r : 0);
          edge = Math.min(edge, toSegment(x, y, a, j + s * 0.5, b, j + s * 0.5));
        }
      }
    }
  // inside: on a paved tile, and not in the part a convex corner of it cuts off
  let inside = at(i0, j0);
  for (const [sx, sy] of CORNERS)
    if (inside && convex(i0, j0, sx, sy)) {
      const a = (i0 + sx * 0.5 - x) * sx,
        b = (j0 + sy * 0.5 - y) * sy;
      if (a < r && b < r && Math.hypot(r - a, r - b) > r) inside = false;
    }
  return inside ? edge : -edge;
}
/** Inside distance of (x, y) from the doorstep at `at` in `steps` (`pavingDoorsteps`), as a box. */
function stepBox(steps: readonly number[], at: number, x: number, y: number) {
  const qx = Math.abs(x - steps[at]) - steps[at + 2],
    qy = Math.abs(y - steps[at + 1]) - steps[at + 3];
  return -Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - Math.min(Math.max(qx, qy), 0);
}
/** The most a gentle wobble may move the outline (tiles). */
const WOBBLE = 0.08;
/** A convex corner's radius lies between these (tiles); a doorstep's corners round under 0.1. */
const ROUND_MIN = 0.2,
  ROUND_MAX = 0.35,
  STEP_ROUND_MAX = 0.1;
/**
 * The least and the most the outline's unwobbled distance may be at (x, y): the paved tiles rounded
 * with the largest and the smallest corner radius allowed, joined with the doorsteps' boxes (with
 * the most and the least rounding of theirs).
 */
function outlineBounds(
  c: Town,
  paved: ReadonlySet<number>,
  steps: readonly number[],
  x: number,
  y: number,
) {
  let lo = roundedTiles(c, paved, ROUND_MAX, x, y),
    hi = roundedTiles(c, paved, ROUND_MIN, x, y);
  for (let at = 0; at + 3 < steps.length; at += 4) {
    const box = stepBox(steps, at, x, y);
    hi = Math.max(hi, box);
    lo = Math.max(lo, box - STEP_ROUND_MAX * (Math.SQRT2 - 1));
  }
  return { lo, hi };
}
function stepsOf(c: Town, doors = c.doors) {
  const paved = new Set(c.paved);
  return pavingDoorsteps(
    doors.map((d) => ({ tile: d, side: d.side })),
    (k) => paved.has(k),
    c.w,
    c.h,
  );
}
/** A town with half its points within a third of a tile of a tile corner, where corners show. */
function cornered(rng: Rng): Town {
  const c = town(rng, 150);
  for (let n = 0; n < 150; n++)
    c.points.push([
      rng.int(0, c.w - 2) + 0.5 + rng.range(-0.33, 0.33),
      rng.int(0, c.h - 2) + 0.5 + rng.range(-0.33, 0.33),
    ]);
  return c;
}

describe('the town paving outline, against the shape worked out piece by piece', () => {
  // Slow: works the shape out twice per point for 30 000 points (about a second alone).
  it('is the paved tiles, convex corners rounded and concave ones sharp, and the doorsteps', () => {
    forAll(
      cornered,
      (c) => {
        const p = paving(c),
          paved = new Set(c.paved),
          steps = stepsOf(c);
        for (const [x, y] of c.points) {
          const { lo, hi } = outlineBounds(c, paved, steps, x, y),
            d = felt(p.distance(x, y)),
            at = `at ${x}, ${y}: ${d}, not ${lo} to ${hi} give or take the wobble`;
          expect(d, at).toBeGreaterThanOrEqual(felt(lo - WOBBLE) - 1e-9);
          expect(d, at).toBeLessThanOrEqual(felt(hi + WOBBLE) + 1e-9);
        }
      },
      { shrink: shrinkTown },
    );
  }, 20_000);

  // slow because 150 points of each seeded town are set against the outline worked out piece by
  // piece: 0.33 s alone, so a limit of 30 s
  it('wobbles both ways along a straight edge', () => {
    let least = 0,
      most = 0;
    forAll(cornered, (c) => {
      const p = paving(c),
        paved = new Set(c.paved),
        steps = stepsOf(c);
      for (const [x, y] of c.points) {
        const { lo, hi } = outlineBounds(c, paved, steps, x, y);
        // near an edge whose place no corner or doorstep decides, the wobble alone moves it
        if (Math.abs(hi - lo) > 1e-9 || Math.abs(hi) > 0.15) continue;
        least = Math.min(least, p.distance(x, y) - hi);
        most = Math.max(most, p.distance(x, y) - hi);
      }
    });
    expect(least).toBeLessThan(-0.03);
    expect(most).toBeGreaterThan(0.03);
  }, 30_000);
});

describe('the town paving picture, wherever it is asked for', () => {
  // slow because each seeded town's 200 points are painted forward and again backward on a paving
  // of its own: 0.32 s alone, so a limit of 30 s
  it('is the same at a point whatever was painted before it, as in two chunks', () => {
    forAll(
      (rng) => town(rng),
      (c) => {
        const first = paving(c),
          forward = c.points.map(([x, y]) => picture(first, x, y));
        // the other way round, on a paving of its own, with other setts asked for in between
        const p = paving(c);
        for (let n = c.points.length - 1; n >= 0; n--) {
          const [x, y] = c.points[n];
          settAt(c.originX + y * 1.7, c.originY - x * 0.9);
          expect(picture(p, x, y), `point ${n} at ${x}, ${y}`).toEqual(forward[n]);
        }
      },
      { shrink: shrinkTown },
    );
  }, 30_000);

  // slow because each seeded town is painted at 200 points before and after its doors come and go:
  // 0.49 s alone, so a limit of 30 s
  it('changes, when doors come and go, only on the tiles doorstepChanges repaints', () => {
    forAll(
      (rng) => {
        const c = town(rng);
        const after = c.doors.filter(() => rng.chance(0.5));
        for (let n = rng.int(0, 4); n > 0; n--)
          after.push({
            x: rng.int(0, c.w - 1),
            y: rng.int(0, c.h - 1),
            side: rng.int(0, 3) as Dir,
          });
        // and points round the doors, where the change is
        for (const d of [...c.doors, ...after])
          for (let n = 0; n < 40; n++)
            c.points.push([
              Math.max(-0.5, Math.min(c.w - 0.501, d.x + rng.range(-1.5, 1.5))),
              Math.max(-0.5, Math.min(c.h - 0.501, d.y + rng.range(-1.5, 1.5))),
            ]);
        return { ...c, after };
      },
      (c) => {
        const before = stepsOf(c),
          now = stepsOf(c, c.after),
          was = new TownPaving(c.w, c.h, c.originX, c.originY, c.paved, before),
          is = new TownPaving(c.w, c.h, c.originX, c.originY, c.paved, now),
          repainted = doorstepChanges(before, now, c.w, c.h);
        for (const [x, y] of c.points) {
          const k = Math.round(y) * c.w + Math.round(x);
          if (repainted.has(k)) continue;
          expect(picture(is, x, y), `tile ${k}, at ${x}, ${y}`).toEqual(picture(was, x, y));
        }
      },
      {
        shrink: function* (c) {
          for (const after of shrinkArray(c.after)) yield { ...c, after };
          for (const t of shrinkTown(c)) yield { ...c, ...t };
        },
      },
    );
  }, 30_000);
});

describe('doorsteps of the simulation doors', () => {
  // a house, a square station, a long one and a depot, as src/sim/doors.ts gives them doors
  const defs = {
    house: {},
    station: { accepts: [], size: 2 },
    long: { accepts: [], long: true },
    depot: { accepts: [], depot: true, size: 2 },
  } as unknown as Record<string, PlaceDef>;

  it('lie across the side each door faces, out over the tile it reaches', () => {
    for (const [name, def] of Object.entries(defs))
      for (let rot = 0; rot < 4; rot++)
        for (const door of placeDoors(def, 3, 3, rot)) {
          const at = `${name} at rotation ${rot}, its ${door.kind} door`,
            steps = pavingDoorsteps([door], () => true, 8, 8);
          expect(steps, at).toHaveLength(4);
          const [cx, cy, hx, hy] = steps,
            ux = door.reach.x - door.tile.x,
            uy = door.reach.y - door.tile.y,
            along = ux ? hy : hx,
            out = ux ? hx : hy,
            centre = (cx - door.tile.x) * ux + (cy - door.tile.y) * uy;
          // the middle of the door's side is on it, centred there, and it is narrower than the side
          expect(Math.abs(door.tile.x + ux / 2 - cx) < hx, at).toBe(true);
          expect(Math.abs(door.tile.y + uy / 2 - cy) < hy, at).toBe(true);
          expect(ux ? cy - door.tile.y : cx - door.tile.x, at).toBe(0);
          expect(along, at).toBeLessThan(0.5);
          // it reaches out over the reach tile, short of its middle, and not back to the door's
          expect(centre + out, at).toBeGreaterThan(0.6);
          expect(centre + out, at).toBeLessThanOrEqual(1);
          expect(centre - out, at).toBeGreaterThan(0);
        }
  });
});

describe('the wear at the paving edge', () => {
  /** The share of the ground in the colour paint gives at (x, y) for `d`: it is affine in it. */
  function groundShare(p: TownPaving, x: number, y: number, d: number, scale: number) {
    const dark = [0, 0, 0],
      light = [0, 0, 0];
    p.paint(x, y, d, [0, 0, 0], scale, dark);
    p.paint(x, y, d, [255, 255, 255], scale, light);
    return (light[1] - dark[1]) / 255;
  }

  it('shows no less of the ground at a spot the nearer it lies to the outline', () => {
    forAll(
      (rng) => town(rng, 40),
      (c) => {
        const p = paving(c);
        for (const [x, y] of c.points) {
          if (!(p.distance(x, y) > 0)) continue;
          let before = Infinity;
          for (let d = 0.002; d < PAVING_DEEP; d += 0.02) {
            const share = groundShare(p, x, y, d, 2);
            if (share > before + 1e-12 || (d >= PAVING_SOLID && share !== 0))
              throw new Error(`at ${x}, ${y}, ${d} in: ${share} of the ground, ${before} nearer`);
            before = share;
          }
        }
      },
    );
  });

  it('loses setts whole toward the outline, fewer farther in, and none deep inside', () => {
    // points well inside a sett, clear of its joint, where only a missing sett shows the ground,
    // by how far inside the paving they lie: up to 0.05, 0.1, 0.15 and 0.2
    const bands = [0.05, 0.1, 0.15, 0.2],
      seen = [0, 0, 0, 0],
      gone = [0, 0, 0, 0];
    let deep = 0;
    forAll(
      (rng) => town(rng, 400),
      (c) => {
        const p = paving(c);
        for (const [x, y] of c.points) {
          const d = p.distance(x, y);
          if (!(d > 0) || settAt(x + c.originX, y + c.originY).inside < 0.03) continue;
          const share = groundShare(p, x, y, d, 4),
            band = bands.findIndex((b) => d < b);
          if (band >= 0) {
            seen[band]++;
            if (share > 0.2) gone[band]++;
          } else if (d >= PAVING_DEEP) {
            deep++;
            if (share !== 0) throw new Error(`at ${x}, ${y}, ${d} in: ${share} of the ground`);
          }
        }
      },
    );
    const missing = seen.map((n, i) => gone[i] / n);
    expect(Math.min(...seen)).toBeGreaterThan(80);
    expect(deep).toBeGreaterThan(500);
    expect(missing[0]).toBeGreaterThan(0.5);
    for (let i = 1; i < bands.length; i++) expect(missing[i]).toBeLessThan(missing[i - 1]);
    expect(missing[bands.length - 1]).toBeGreaterThan(0);
  });

  it('meets a fringe of packed earth outside that fades into the ground by PAVING_FRINGE', () => {
    expect(FRINGE_EARTH[0] >= FRINGE_EARTH[1] && FRINGE_EARTH[1] >= FRINGE_EARTH[2]).toBe(true);
    forAll(
      (rng) => town(rng, 60),
      (c) => {
        const p = paving(c);
        for (const [x, y] of c.points) {
          let before = p.fringe(x, y, 0);
          if (!(before > 0.5 && before <= 1))
            throw new Error(`at ${x}, ${y}, on the outline: ${before} earth`);
          // a hundredth of a tile farther out, a little less earth: it fades, with no edge of its own
          for (let d = -0.01; d > -0.3; d -= 0.01) {
            const share = p.fringe(x, y, d);
            if (
              share > before ||
              share < before - 0.1 ||
              share < 0 ||
              (d <= -PAVING_FRINGE && share !== 0)
            )
              throw new Error(`at ${x}, ${y}, ${-d} out: ${share} earth, ${before} nearer`);
            before = share;
          }
        }
      },
    );
  });
});

describe('the setts', () => {
  /** Directions the extent of a sett is measured in, and the step along each (tiles). */
  const RAYS = 24,
    STEP = 0.004;
  /**
   * The sett at world point (u, v), measured from its centre: how far it reaches in each of RAYS
   * directions (where `settAt` first names another sett), its farthest reach and the side of a
   * square of its area. Undefined for a sett the scale in front covers at its centre.
   */
  function measure(u: number, v: number) {
    const sett = settAt(u, v);
    if (settAt(sett.u, sett.v).id !== sett.id) return undefined;
    let area = 0,
      far = 0;
    for (let n = 0; n < RAYS; n++) {
      const a = (n / RAYS) * 2 * Math.PI;
      let r = 0;
      while (r < 1 && settAt(sett.u + Math.cos(a) * r, sett.v + Math.sin(a) * r).id === sett.id)
        r += STEP;
      area += (r * r * Math.PI) / RAYS;
      far = Math.max(far, r);
    }
    return { far, side: Math.sqrt(area) };
  }

  it('are about a tenth of a tile, none larger than a fifth of one across, with no hole between them', () => {
    let measured = 0,
      sides = 0;
    forAll(
      (rng) => Array.from({ length: 20 }, () => [rng.range(-3000, 3000), rng.range(-3000, 3000)]),
      (points) => {
        for (const [u, v] of points) {
          // a point no scale of the fan covers gets the fallback: itself as the centre, no inside
          const sett = settAt(u, v);
          if (sett.u === u && sett.v === v && sett.inside === 0)
            throw new Error(`no sett at ${u}, ${v}`);
          const m = measure(u, v);
          if (!m) continue;
          if (m.far > 0.1 + STEP) throw new Error(`the sett at ${u}, ${v} reaches ${m.far}`);
          if (m.side < 0.05 || m.side > 0.15)
            throw new Error(`the sett at ${u}, ${v} is ${m.side} across`);
          measured++;
          sides += m.side;
        }
      },
      { shrink: (points) => shrinkArray(points) },
    );
    // most setts show whole; their size, on average
    expect(measured).toBeGreaterThan(1600);
    expect(sides / measured).toBeGreaterThan(0.08);
    expect(sides / measured).toBeLessThan(0.13);
  });
});

describe('the light on the setts', () => {
  it('falls from the upper left: a sett is lighter along its -x rim than its +x rim', () => {
    let lighter = 0,
      setts = 0;
    forAll(
      (rng) => town(rng, 150),
      (c) => {
        const p = paving(c);
        for (const [x, y] of c.points) {
          if (p.distance(x, y) < PAVING_DEEP + 0.4) continue;
          const sett = settAt(x + c.originX, y + c.originY);
          /** The sett's last point clear of its joint from its centre along x, toward `dir`. */
          const rim = (dir: number) => {
            let last: number | undefined;
            for (let t = 0; t < 0.2; t += 0.001) {
              const here = settAt(sett.u + dir * t, sett.v);
              if (here.id !== sett.id) break;
              if (here.inside >= 0.016) last = sett.u + dir * t;
            }
            return last;
          };
          const west = rim(-1),
            east = rim(1);
          if (west === undefined || east === undefined) continue;
          const light = (u: number) => {
            const out = [0, 0, 0],
              mx = u - c.originX,
              my = sett.v - c.originY;
            p.paint(mx, my, p.distance(mx, my), null, 4, out);
            return out[0] + out[1] + out[2];
          };
          setts++;
          if (light(west) > light(east)) lighter++;
        }
      },
    );
    expect(setts).toBeGreaterThan(200);
    expect(lighter / setts).toBeGreaterThan(0.75);
  });
});

describe('the lane of a road across the paving', () => {
  const PAVED_RAG = 0.04;

  it('weighs 1 on the centre line, falls smoothly out and is gone by LANE_REACH', () => {
    expect(laneWeight(0, 0)).toBe(1);
    expect(laneWeight(LANE_FULL, 0)).toBe(1);
    expect(laneWeight(LANE_FULL + LANE_FADE, 0)).toBe(0);
    forAll(
      (rng) => ({
        d: rng.range(0, 0.6),
        e: rng.range(0, 0.1),
        rag: rng.range(-PAVED_RAG, PAVED_RAG),
      }),
      ({ d, e, rag }) => {
        const w = laneWeight(d, rag);
        // a weight, no more the farther out, and none from LANE_REACH on whatever the ragged line
        if (!(w >= 0 && w <= 1)) return false;
        if (laneWeight(d + e, rag) > w + 1e-12) return false;
        if (d >= LANE_REACH && w !== 0) return false;
        // a ragged line moved outward takes some of it away, never gives any
        return laneWeight(d, rag + e) <= w + 1e-12;
      },
    );
  });

  it('lays its setts over the road width the gravel road has, and no wider than its dust', () => {
    forAll(
      (rng) => ({ d: rng.range(0, 0.5), rag: rng.range(0, ROAD_RAG) }),
      ({ d, rag }) => {
        const street = streetWeight(d, rag);
        if (street !== roadWeight(d - ROAD_HALF, rag)) return false;
        // setts in courses are always dusty ones: the street lies inside the lane's reach
        return street === 0 || laneWeight(d, PAVED_RAG) > 0;
      },
    );
    expect(streetWeight(0, 0)).toBe(1);
    expect(streetWeight(ROAD_HALF, 0)).toBe(0.5);
  });

  it('puts setts in straight courses 0.1 tile deep, along x or along y', () => {
    forAll(
      (rng) => ({ u: rng.range(-500, 500), v: rng.range(-500, 500) }),
      ({ u, v }) => {
        const a = courseAt(u, v);
        // a course is 0.1 tile deep: its setts' centres lie on its middle, and the point in the sett
        const row = Math.floor(v / 0.1);
        if (Math.abs(a.v - (row + 0.5) * 0.1) > 1e-9) return false;
        // (the rounded corners of its rectangle leave a hair of joint just outside it)
        if (Math.abs(v - a.v) > 0.05 + 1e-9 || a.inside < -0.022) return false;
        // along y it is the same laid with the axes swapped
        const b = courseAt(v, u, true);
        return b.id === a.id && Math.abs(b.u - a.v) < 1e-9 && Math.abs(b.v - a.u) < 1e-9;
      },
    );
  });

  it('cuts each course into setts of about a tenth of a tile, offset from the next course', () => {
    const lengths: number[] = [];
    const starts = new Set<number>();
    for (let row = 0; row < 40; row++) {
      const v = (row + 0.5) * 0.1;
      // the first sett is cut short by where the scan starts
      let run = -1,
        last = courseAt(-30, v).id;
      for (let u = -30; u < -28; u += 0.002) {
        const here = courseAt(u, v);
        if (here.id === last) run += 0.002;
        else {
          if (run > 0) lengths.push(run);
          starts.add(Math.round(((u + 30) % 0.13) * 1000));
          run = 0.002;
          last = here.id;
        }
      }
    }
    expect(lengths.length).toBeGreaterThan(400);
    expect(Math.min(...lengths)).toBeGreaterThan(0.045);
    expect(Math.max(...lengths)).toBeLessThan(0.22);
    expect(lengths.reduce((a, b) => a + b) / lengths.length).toBeCloseTo(0.13, 1);
    // the courses do not line their joints up
    expect(starts.size).toBeGreaterThan(20);
  });

  describe('painted', () => {
    // a square of paved tiles, the points in it well inside the paving
    const w = 10,
      paved = Array.from({ length: w * w }, (_, k) => k),
      p = new TownPaving(w, w, 120, -40, paved);
    const points: [number, number][] = [];
    for (let y = 2.1; y < 7.9; y += 0.063)
      for (let x = 2.1; x < 7.9; x += 0.061) points.push([x, y]);
    const paint = (x: number, y: number, lane?: number, axis?: number) => {
      const out = [0, 0, 0];
      p.paint(x, y, p.distance(x, y), null, 2, out, lane, axis);
      return out;
    };
    const mean = (f: (x: number, y: number) => number) =>
      points.reduce((sum, [x, y]) => sum + f(x, y), 0) / points.length;
    const luma = (c: number[]) => c[0] + c[1] + c[2];

    // Slow: paints 8 000 points four times with matchers (about 0.35 s alone), so the limit is 10 s.
    it('is the plain paving anywhere the lane does not reach', () => {
      for (const [x, y] of points) {
        const plain = paint(x, y);
        expect(paint(x, y, Infinity, 2)).toEqual(plain);
        expect(paint(x, y, LANE_REACH, 1)).toEqual(plain);
        expect(paint(x, y, 0.9, 2)).toEqual(plain);
      }
    }, 10_000);

    it('reads no ground, as the plain paving does not, from PAVING_SOLID in', () => {
      for (const [x, y] of points) {
        const d = p.distance(x, y),
          a = [0, 0, 0],
          b = [0, 0, 0];
        p.paint(x, y, d, [70, 190, 60], 2, a, 0.05, 1);
        p.paint(x, y, d, [200, 40, 210], 2, b, 0.05, 1);
        expect(a).toEqual(b);
      }
    });

    it('is a little darker on the centre line, and dustier toward it', () => {
      const dust = [160, 142, 110];
      const away = (c: number[]) => Math.hypot(c[0] - dust[0], c[1] - dust[1], c[2] - dust[2]);
      const plain = mean((x, y) => luma(paint(x, y)));
      const onLine = mean((x, y) => luma(paint(x, y, 0, 1)));
      const beside = mean((x, y) => luma(paint(x, y, 0.22, 1)));
      expect(onLine).toBeLessThan(beside);
      expect(beside).toBeLessThan(plain);
      // a little: a few percent, not a different paving
      expect(onLine).toBeGreaterThan(plain * 0.9);
      expect(mean((x, y) => away(paint(x, y, 0, 1)))).toBeLessThan(
        mean((x, y) => away(paint(x, y))),
      );
    });

    it('lays its setts in courses on the line: the joints follow courseAt, not the fan', () => {
      for (const alongV of [false, true]) {
        let joint = 0,
          jointN = 0,
          top = 0,
          topN = 0;
        for (const [x, y] of points) {
          const sett = courseAt(x + 120, y - 40, alongV);
          const l = luma(paint(x, y, 0, alongV ? 2 : 1));
          if (sett.inside < 0.004) {
            joint += l;
            jointN++;
          } else if (sett.inside > 0.03) {
            top += l;
            topN++;
          }
        }
        expect(jointN).toBeGreaterThan(300);
        expect(topN).toBeGreaterThan(300);
        // the joint is darker than the sett's top where the courses are laid, 2 or 3 percent at least
        expect(joint / jointN).toBeLessThan((top / topN) * 0.97);
      }
    });

    // Slow: paints 2 000 points along 90 steps each (about 0.7 s alone), so the limit is 20 s.
    it('meets the plain paving without a jump: the courses fade out over the road width', () => {
      let step = 0;
      for (const [x, y] of points) {
        let last = paint(x, y, 0.1, 1);
        for (let lane = 0.1; lane < LANE_REACH + 0.05; lane += 0.004) {
          const here = paint(x, y, lane, 1);
          step = Math.max(step, Math.abs(luma(here) - luma(last)));
          last = here;
        }
      }
      // across the road's soft edge the courses give way to the fan, and a sett differs from a
      // joint by a few tens: no jump of a whole palette
      expect(step).toBeLessThan(120);
    }, 20_000);
  });
});

describe('the lane painted, as properties of every point (#476)', () => {
  const w = 12,
    paved = Array.from({ length: w * w }, (_, k) => k);
  /** A paint call: where, how far inside the paving, and the lane's distance and axis. */
  interface Call {
    x: number;
    y: number;
    d: number;
    scale: number;
    lane: number;
    axis: number;
  }
  const call = (rng: Rng): Call => ({
    x: rng.range(1, 10),
    y: rng.range(1, 10),
    // across the whole of the paving, from the outline in to its solid part
    d: rng.chance(0.5) ? rng.range(0.001, PAVING_DEEP) : rng.range(PAVING_DEEP, 2),
    scale: rng.pick([1, 2, 4]),
    lane: rng.chance(0.15) ? Infinity : rng.range(0, LANE_REACH + 0.05),
    axis: rng.pick([1, 2]),
  });
  const GROUND = [90, 130, 60];
  const run = (p: TownPaving, c: Call) => {
    const out = [-1, -1, -1];
    p.paint(c.x, c.y, c.d, GROUND, c.scale, out, c.lane, c.axis);
    return out;
  };

  it('is a colour, finite and within a byte, at any depth, scale, lane and axis', () => {
    const p = new TownPaving(w, w, 37, -91, paved);
    forAll(call, (c) => {
      const out = run(p, c);
      return out.every((v) => Number.isFinite(v) && v >= 0 && v <= 255);
    });
  });

  it('is a function of its arguments alone: the order of the calls, and the lane before, change nothing', () => {
    const p = new TownPaving(w, w, 5, 12, paved);
    forAll(
      (rng) => Array.from({ length: 40 }, () => call(rng)),
      (calls) => {
        const first = calls.map((c) => run(p, c));
        // the same calls backwards, each after a different call that leaves its own sett behind
        const back = calls.map((c) => c).reverse();
        const again = back.map((c, i) => {
          run(p, { ...c, lane: 0.05, axis: 3 - c.axis, x: c.x + 0.7 + i * 0.01 });
          return run(p, c);
        });
        again.reverse();
        return first.every((out, i) => out.every((v, c) => v === again[i][c]));
      },
      { shrink: (calls) => shrinkArray(calls) },
    );
  });

  it('keeps its picture when the map grows: the same world point, whole tiles of origin apart, is the same colour', () => {
    forAll(
      (rng) => ({ c: call(rng), dx: rng.int(-80, 80), dy: rng.int(-80, 80) }),
      ({ c, dx, dy }) => {
        // deep inside the paving no wear reads where the tiles lie, only the world point does
        const deep = { ...c, d: PAVING_DEEP + 0.3 };
        const a = new TownPaving(w, w, 0, 0, paved),
          b = new TownPaving(w, w, dx, dy, paved);
        const at = run(a, { ...deep, x: deep.x + dx, y: deep.y + dy }),
          there = run(b, deep);
        return at.every((v, i) => Math.abs(v - there[i]) < 1e-9);
      },
    );
  });

  it('lays its courses alike along x and along y: the same mean colour on the line', () => {
    const p = new TownPaving(w, w, 0, 0, paved),
      sum = [0, 0];
    forAll(
      (rng) => ({ x0: rng.range(1, 6), y0: rng.range(1, 6) }),
      ({ x0, y0 }) => {
        const lum = [0, 0];
        let n = 0;
        for (let i = 0; i < 90; i++)
          for (let j = 0; j < 90; j++) {
            const x = x0 + i * 0.037,
              y = y0 + j * 0.037;
            for (const axis of [1, 2]) {
              const out = run(p, { x, y, d: 1.5, scale: 2, lane: 0, axis });
              lum[axis - 1] += out[0] + out[1] + out[2];
            }
            n++;
          }
        sum[0] += lum[0] / n;
        sum[1] += lum[1] / n;
        // mean colour of a few thousand points of a laying differs by under a percent
        return Math.abs(lum[0] - lum[1]) / lum[0] < 0.01;
      },
      { seeds: [1, 2, 3, 4, 5, 6, 7, 8] },
    );
    expect(sum[0]).toBeGreaterThan(0);
  });

  // Slow: paints 17 000 points 14 times (about 0.4 s alone), so the limit is 10 s.
  it('gets no darker the farther from the line, is the plain paving at the reach of the lane, and is dustier on the line', () => {
    const p = new TownPaving(w, w, 0, 0, paved);
    const pts: [number, number][] = [];
    for (let x = 2; x < 9; x += 0.049) for (let y = 2; y < 9; y += 0.053) pts.push([x, y]);
    const dust = [160, 142, 110];
    const mean = (lane: number, axis: number) => {
      let l = 0,
        away = 0;
      for (const [x, y] of pts) {
        const out = run(p, { x, y, d: 1.5, scale: 2, lane, axis });
        l += out[0] + out[1] + out[2];
        away += Math.hypot(out[0] - dust[0], out[1] - dust[1], out[2] - dust[2]);
      }
      return [l / pts.length, away / pts.length];
    };
    for (const axis of [1, 2]) {
      // from the line out to the edge of the lane's reach, in steps wide enough for the mean to
      // be clear of the sampling: never darker the farther out (the distance to the dust is not
      // monotone, the courses' joints being darker than the fan's)
      let last = mean(0, axis);
      for (const lane of [0.08, 0.16, 0.24, 0.32, LANE_REACH]) {
        const here = mean(lane, axis);
        expect(here[0], `axis ${axis}, lane ${lane}: lighter`).toBeGreaterThan(last[0] - 0.5);
        last = here;
      }
      // the whole way is a real change, more than a unit of colour, ends in the plain paving, and
      // is nearer the dust on the line than in the plain paving
      expect(last[0] - mean(0, axis)[0]).toBeGreaterThan(5);
      expect(last).toEqual(mean(Infinity, axis));
      expect(mean(0, axis)[1]).toBeLessThan(last[1]);
    }
  }, 10_000);

  it('mixes the packed earth into the joints the more the nearer the line: each joint is nearer the earth, never farther', () => {
    const p = new TownPaving(w, w, 7, 3, paved),
      earth = [160 * 0.9, 142 * 0.9, 110 * 0.9],
      away = (c: number[]) => Math.hypot(c[0] - earth[0], c[1] - earth[1], c[2] - earth[2]);
    let joints = 0;
    forAll(
      (rng) => ({ x: rng.range(2, 9), y: rng.range(2, 9) }),
      ({ x, y }) => {
        // a point well inside a joint of the fan (past the street, which is laid in courses), where
        // a joint is made of nothing but its own colour and the earth the lane mixes in
        if (settAt(x + 7, y + 3).inside > 0.004) return true;
        joints++;
        let last = Infinity;
        for (const lane of [LANE_REACH, 0.3, 0.27, 0.25, ROAD_REACH + 0.001]) {
          const here = away(run(p, { x, y, d: 1.5, scale: 2, lane, axis: 1 }));
          if (here > last + 1e-9) return false;
          last = here;
        }
        // and the lane has mixed some in
        return last < away(run(p, { x, y, d: 1.5, scale: 2, lane: Infinity, axis: 1 })) - 0.01;
      },
      { seeds: Array.from({ length: 600 }, (_, i) => i + 1) },
    );
    expect(joints).toBeGreaterThan(60);
  });

  it('lays the joints of a course off those of the next: few of them within a hundredth of a tile', () => {
    // the joints of course `row`, from scanning along it
    const joints = (row: number, from: number) => {
      const out: number[] = [];
      let last = courseAt(from, (row + 0.5) * 0.1).id;
      for (let u = from; u < from + 30; u += 0.002) {
        const id = courseAt(u, (row + 0.5) * 0.1).id;
        if (id !== last) out.push(u);
        last = id;
      }
      return out;
    };
    let joints0 = 0,
      close = 0;
    for (const row of [3, 40, 91, -17, -300, 250, 17, 64]) {
      const a = joints(row, 5),
        b = joints(row + 1, 5);
      for (const u of a) {
        joints0++;
        if (b.some((v) => Math.abs(u - v) < 0.01)) close++;
      }
    }
    expect(joints0).toBeGreaterThan(1000);
    // random joints would meet one in seven, and a bond that lines them up much more
    expect(close / joints0).toBeLessThan(0.2);
  });

  // Slow: paints 10 000 points four times over twice (about 0.4 s alone), so the limit is 10 s.
  it('lays the courses over the road width and the fan outside it: the axis matters inside the road, not past its edge', () => {
    const p = new TownPaving(w, w, 3, 9, paved);
    forAll(
      (rng) => ({ x: rng.range(2, 9), y: rng.range(2, 9) }),
      ({ x, y }) => {
        // past the road's reach (it and its ragged edge) the street weighs nothing: the axis is
        // not read, and the paving is the fan with the lane's dust over it
        for (const lane of [ROAD_REACH, ROAD_REACH + 0.03, LANE_REACH - 0.01]) {
          const a = run(p, { x, y, d: 1.5, scale: 2, lane, axis: 1 }),
            b = run(p, { x, y, d: 1.5, scale: 2, lane, axis: 2 });
          if (a.some((v, i) => v !== b[i])) return false;
        }
        return true;
      },
    );
    // how much the way the courses run matters at a lane distance is how much street there is:
    // all of it inside the road's soft edge, about half at the edge the ragged line moves, none past it
    const matters = (lane: number) => {
      let sum = 0,
        n = 0;
      for (let x = 2; x < 9; x += 0.071)
        for (let y = 2; y < 9; y += 0.073) {
          const a = run(p, { x, y, d: 1.5, scale: 2, lane, axis: 1 }),
            b = run(p, { x, y, d: 1.5, scale: 2, lane, axis: 2 });
          sum += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
          n++;
        }
      return sum / n;
    };
    const whole = matters(0);
    expect(whole).toBeGreaterThan(3);
    expect(matters(ROAD_HALF - ROAD_FEATHER / 2 - 0.001)).toBeGreaterThan(whole * 0.9);
    // the edge, moved out by the ragged line, is about 0.02 tile past the road's half width
    const edge = matters(ROAD_HALF + ROAD_RAG / 2) / whole;
    expect(edge).toBeGreaterThan(0.25);
    expect(edge).toBeLessThan(0.7);
    expect(matters(ROAD_HALF + 0.04)).toBeLessThan(whole * 0.15);
    expect(matters(ROAD_REACH)).toBe(0);
  }, 10_000);

  it('cuts every course into setts that tile it: one centre per sett, within its half length of every point', () => {
    forAll(
      (rng) => ({
        s0: rng.range(-300, 300),
        across: rng.range(-300, 300),
        alongV: rng.chance(0.5),
      }),
      ({ s0, across, alongV }) => {
        // walking along one course (x, or y when `alongV`): the sett is the same for as long as
        // its centre is, the centres only rise, and a point is never farther from its sett's centre
        // than half the longest sett (SETT_LONG 0.13 and its jitter 0.6, so 0.104)
        let id = NaN,
          centre = -Infinity;
        for (let i = 0; i < 1200; i++) {
          const s = s0 + i * 0.004,
            sett = alongV ? courseAt(across, s, true) : courseAt(s, across),
            pos = alongV ? sett.v : sett.u;
          if (Math.abs(s - pos) > 0.1045) return false;
          if (sett.id === id) {
            if (pos !== centre) return false;
          } else {
            if (pos < centre) return false;
            id = sett.id;
            centre = pos;
          }
        }
        return true;
      },
    );
  });
});
