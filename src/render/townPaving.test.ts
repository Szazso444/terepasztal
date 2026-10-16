import { describe, expect, it } from 'vitest';
import { Dir, DIR_DX, DIR_DY } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { forAll, shrinkArray } from '../testing/property';
import { doorsOf as placeDoors, type PlaceDef } from '../sim/doors';
import {
  doorstepChanges,
  doorstepTiles,
  FRINGE_EARTH,
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
  });
});

/** What the painter takes from the paving at map point (x, y): its distance and colour there. */
function picture(p: TownPaving, x: number, y: number) {
  const d = p.near(Math.round(y) * p.w + Math.round(x)) ? p.distance(x, y) : -9;
  if (d <= -PAVING_FRINGE) return [];
  if (d <= 0) return [d, p.fringe(x, y, d)];
  const out = [0, 0, 0];
  p.paint(x, y, d, [70, 190, 60], 1, out);
  return [d, ...out];
}

describe('the town paving picture, wherever it is asked for', () => {
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
  });

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
  });
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
