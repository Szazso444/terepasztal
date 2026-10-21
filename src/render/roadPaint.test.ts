/**
 * The roads as the painter reads them (#329, roadPaint.ts): the weight of the road across its
 * width, where it reaches, that tiles join without a seam, and its colour under the seasons.
 */
import { describe, expect, it } from 'vitest';
import { DIRS, DIR_DX, DIR_DY } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { PAL } from '../art/palette';
import { forAll } from '../testing/property';
import { ROAD_GRAVEL, RoadPaint, paintedRoads, pavingFade, roadRag, roadWeight } from './roadPaint';
import {
  ROAD_FEATHER,
  ROAD_HALF,
  ROAD_ON_DECK,
  ROAD_RADIUS_MAX,
  ROAD_RADIUS_MIN,
  ROAD_RAG,
  ROAD_REACH,
  ROAD_WANDER,
  ROAD_WIDTH,
  roadCode,
  roadPath,
  roadShape,
  roadSides,
} from './roadShape';

/**
 * The codes the renderer works out for the roads on `tiles` of a `w` x `h` map: their sides, and a
 * level crossing on the tiles `crossing` names (its road along x).
 */
function codesOf(w: number, h: number, tiles: Set<number>, crossing = new Set<number>()) {
  const has = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && tiles.has(y * w + x);
  const isCrossing = (x: number, y: number) => has(x, y) && crossing.has(y * w + x);
  const codes = new Map<number, number>();
  for (const k of tiles) {
    const x = k % w,
      y = Math.floor(k / w),
      sides = roadSides(has, [], x, y);
    let pinned = 0;
    for (const d of DIRS) if (isCrossing(x + DIR_DX[d], y + DIR_DY[d])) pinned |= 1 << d;
    codes.set(k, roadCode(sides, pinned, isCrossing(x, y) ? 'x' : null));
  }
  return codes;
}
/**
 * The roads on `tiles` of a `w` x `h` map at world origin (ox, oy), as the renderer hands them
 * over (`paintedRoads`): those on the tiles `decks` names stand on bridge platforms.
 */
function paintOf(
  w: number,
  h: number,
  tiles: Set<number>,
  {
    ox = 0,
    oy = 0,
    crossing = new Set<number>(),
    paved = new Set<number>(),
    decks = new Set<number>(),
  } = {},
) {
  const list = paintedRoads(codesOf(w, h, tiles, crossing), (k) => decks.has(k));
  return new RoadPaint(w, h, ox, oy, list, (k) => paved.has(k));
}
const weightAt = (p: RoadPaint, x: number, y: number) =>
  p.weigh(x, y, Math.round(y) * p.w + Math.round(x));

describe("the road's width and edge", () => {
  it('are the decided ones: 0.32 tile wide, a soft edge about 0.05 tile, a wander of 0.1', () => {
    expect(ROAD_WIDTH).toBe(0.32);
    expect(ROAD_HALF).toBe(0.16);
    expect(ROAD_FEATHER).toBeGreaterThanOrEqual(0.04);
    expect(ROAD_FEATHER).toBeLessThanOrEqual(0.06);
    expect(ROAD_WANDER).toBe(0.1);
    expect([ROAD_RADIUS_MIN, ROAD_RADIUS_MAX]).toEqual([0.23, 0.43]);
    // the ragged edge moves the edge outward only, by less than the soft edge is wide
    expect(ROAD_RAG).toBeGreaterThan(0);
    expect(ROAD_RAG).toBeLessThanOrEqual(ROAD_FEATHER);
    expect(ROAD_REACH).toBeCloseTo(ROAD_HALF + ROAD_FEATHER / 2 + ROAD_RAG, 12);
  });

  it('weighs 1 inside the soft edge, a half at the edge the ragged line moves, 0 past it', () => {
    // a straight along x through the middle of the map's row 1: two level crossings beside a
    // plain tile hold its centre line to the middle, so it lies on y = 1 the whole way
    const w = 7,
      tiles = new Set([7, 8, 9, 10, 11, 12, 13]),
      p = paintOf(w, 3, tiles, { ox: 31, oy: -12, crossing: new Set([7, 8, 9, 10, 11, 12, 13]) });
    let inside = 0,
      rim = 0,
      outside = 0;
    for (let x = 1; x <= 5; x += 0.013)
      for (const s of [-1, 1]) {
        // 1 inside 0.16 - feather / 2
        for (let d = 0; d <= ROAD_HALF - ROAD_FEATHER / 2; d += 0.01) {
          expect(weightAt(p, x, 1 + s * d), `${x}, ${d}`).toBe(1);
          inside++;
        }
        // a half at 0.16, moved out by the ragged line, never in, and by at most ROAD_RAG
        const atEdge = weightAt(p, x, 1 + s * ROAD_HALF),
          moved = weightAt(p, x, 1 + s * (ROAD_HALF + ROAD_RAG));
        expect(atEdge, `${x}`).toBeGreaterThanOrEqual(0.45);
        expect(moved, `${x}`).toBeLessThanOrEqual(0.55);
        // the ragged line's own move there, which leaves a half at the edge where it is none
        expect(atEdge).toBeCloseTo(roadWeight(0, roadRag(x + 31, 1 + s * ROAD_HALF - 12)), 9);
        rim++;
        // 0 past 0.16 + feather, ragged line and all
        for (let d = ROAD_HALF + ROAD_FEATHER / 2 + ROAD_RAG; d < 0.5; d += 0.01) {
          expect(weightAt(p, x, 1 + s * d), `${x}, ${d}`).toBe(0);
          outside++;
        }
      }
    expect([inside > 1000, rim > 500, outside > 1000]).toEqual([true, true, true]);
    expect(roadWeight(0, 0)).toBe(0.5);
  });

  it('moves the edge by the ragged line along its length, by up to ROAD_RAG', () => {
    let low = 1,
      high = 0;
    for (let x = 0; x < 40; x += 0.017) {
      const rag = roadRag(x, 3.7);
      low = Math.min(low, rag);
      high = Math.max(high, rag);
    }
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(ROAD_RAG);
    expect(high - low).toBeGreaterThan(ROAD_RAG / 2);
  });
});

/** A random road layout on a map up to 10 x 10, with level crossings on some of its tiles. */
function layout(rng: Rng) {
  const w = rng.int(2, 10),
    h = rng.int(2, 10),
    tiles = new Set<number>(),
    crossing = new Set<number>();
  for (let n = rng.int(1, w * h); n > 0; n--) tiles.add(rng.int(0, w * h - 1));
  for (const k of tiles) if (rng.chance(0.1)) crossing.add(k);
  return { w, h, tiles, crossing, ox: rng.int(-200, 200), oy: rng.int(-200, 200) };
}

describe('the roads of a map', () => {
  it('reach only their own tiles and the tiles beside them', () => {
    forAll(layout, ({ w, h, tiles, crossing, ox, oy }) => {
      const p = paintOf(w, h, tiles, { ox, oy, crossing });
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const k = y * w + x,
            beside = DIRS.some((d) => {
              const nx = x + DIR_DX[d],
                ny = y + DIR_DY[d];
              return nx >= 0 && ny >= 0 && nx < w && ny < h && tiles.has(ny * w + nx);
            });
          expect(p.near(k), `${x},${y}`).toBe(tiles.has(k) || beside);
          if (p.near(k)) continue;
          for (let v = -0.45; v <= 0.45; v += 0.15)
            for (let u = -0.45; u <= 0.45; u += 0.15) expect(weightAt(p, x + u, y + v)).toBe(0);
        }
    });
  });

  // Slow: reads both sides of every edge of 100 maps (about 0.5 s alone), so the limit is 10 s.
  it('join without a seam: the weight is the same either side of every edge', () => {
    let road = 0;
    forAll(layout, ({ w, h, tiles, crossing, ox, oy }) => {
      const p = paintOf(w, h, tiles, { ox, oy, crossing });
      const e = 1e-7;
      let worst = 0,
        where = '';
      const step = (a: number, b: number, at: string) => {
        if (Math.abs(a - b) > worst) {
          worst = Math.abs(a - b);
          where = at;
        }
        if (a > 0.5) road++;
      };
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          for (let s = -0.5; s <= 0.5; s += 0.006) {
            // the edge to the east, and the edge to the south
            if (x + 1 < w)
              step(
                weightAt(p, x + 0.5 - e, y + s),
                weightAt(p, x + 0.5 + e, y + s),
                `east of ${x},${y} at ${s}`,
              );
            if (y + 1 < h)
              step(
                weightAt(p, x + s, y + 0.5 - e),
                weightAt(p, x + s, y + 0.5 + e),
                `south of ${x},${y} at ${s}`,
              );
          }
      expect(worst, where).toBeLessThan(1e-4);
    });
    expect(road).toBeGreaterThan(2000);
  }, 10_000);

  it('keeps every road off a paved tile, its own and the arms of its neighbours alike', () => {
    // a cross of roads, its middle paved
    const tiles = new Set([7, 11, 12, 13, 17]),
      p = paintOf(5, 5, tiles, { paved: new Set([12]) }),
      bare = paintOf(5, 5, tiles);
    // the paved tile's own road is gone; only the arms beside it reach in, past its edge
    for (let v = -0.5; v <= 0.5; v += 0.02)
      for (let u = -0.5; u <= 0.5; u += 0.02) {
        const own = Math.max(Math.abs(u), Math.abs(v));
        if (own < 0.5 - ROAD_REACH) expect(weightAt(p, 2 + u, 2 + v), `${u},${v}`).toBe(0);
      }
    expect(weightAt(bare, 2, 2)).toBe(1);
    // the tiles round it keep theirs
    expect(weightAt(p, 2, 1)).toBe(1);
  });

  it('paints the same at the same world point on a map that has grown round it', () => {
    // the same three roads on a 6 x 6 map, and on a 9 x 8 map grown by 2 and 1 to the west and north
    const at = [8, 9, 10, 15, 21],
      small = paintOf(6, 6, new Set(at), { ox: 10, oy: 20 }),
      grown = paintOf(9, 8, new Set(at.map((k) => (Math.floor(k / 6) + 1) * 9 + (k % 6) + 2)), {
        ox: 8,
        oy: 19,
      });
    const a = [0, 0, 0],
      b = [0, 0, 0];
    let painted = 0;
    for (let y = 0.6; y < 4.4; y += 0.03)
      for (let x = 0.6; x < 5.4; x += 0.03) {
        const wa = weightAt(small, x, y),
          wb = weightAt(grown, x + 2, y + 1);
        expect(wb, `${x},${y}`).toBeCloseTo(wa, 12);
        if (!wa) continue;
        a.fill(100);
        b.fill(100);
        small.paint(x, y, a, 1, 0xffffff);
        grown.paint(x + 2, y + 1, b, 1, 0xffffff);
        for (let c = 0; c < 3; c++) expect(b[c]).toBeCloseTo(a[c], 9);
        painted++;
      }
    expect(painted).toBeGreaterThan(500);
  });

  it('keeps tufts and stones off the core and lets them stand on the soft edge', () => {
    const p = paintOf(3, 3, new Set([3, 4, 5]), { crossing: new Set([3, 4, 5]) }),
      core = (x: number, y: number) => p.onCore(x, y, Math.round(y) * 3 + Math.round(x));
    // along the middle tile and up to the short arm's end on the last (no road beyond it)
    for (let x = 0.5; x < 2.28; x += 0.05) {
      expect(core(x, 1)).toBe(true);
      expect(core(x, 1 + ROAD_HALF - ROAD_FEATHER / 2 - 0.001)).toBe(true);
      expect(core(x, 1 + ROAD_HALF)).toBe(false);
      expect(core(x, 1 - ROAD_HALF - 0.01)).toBe(false);
    }
  });
});

describe("the road's colour", () => {
  /** Paints map point (x, y) of `p` at full weight over a mid grey under `tint`, as shown. */
  function shown(p: RoadPaint, x: number, y: number, tint: number) {
    const out = [90, 120, 60];
    p.weigh(x, y, Math.round(y) * p.w + Math.round(x));
    p.paint(x, y, out, 1, tint);
    // the painter puts the season's tint on afterwards
    return out.map((c, i) => (c * ((tint >> (16 - i * 8)) & 255)) / 255);
  }

  it("keeps the gravel's colour under any season's tint", () => {
    const p = paintOf(6, 3, new Set([6, 7, 8, 9, 10, 11]), { ox: -5, oy: 4 });
    for (const tint of [0xd8e8c0, 0xc0d0e8, 0xffe0b0, 0x909090])
      for (let x = 0.5; x < 5.5; x += 0.07) {
        if (weightAt(p, x, 1) < 1) continue;
        const white = shown(p, x, 1, 0xffffff),
          tinted = shown(p, x, 1, tint);
        for (let c = 0; c < 3; c++) expect(tinted[c]).toBeCloseTo(white[c], 6);
      }
  });

  // Slow: paints some 90 000 points of a 12 x 12 road (about 0.8 s alone), so the limit is 20 s.
  it('is the measured gravel on the whole, and stays under the semantic colours', () => {
    const p = paintOf(12, 12, new Set(Array.from({ length: 144 }, (_, k) => k)), { ox: 3 }),
      r: number[] = [],
      g: number[] = [],
      b: number[] = [];
    for (let y = 0; y < 11.5; y += 0.037)
      for (let x = 0; x < 11.5; x += 0.041) {
        if (weightAt(p, x, y) < 1) continue;
        const [cr, cg, cb] = shown(p, x, y, 0xffffff);
        r.push(cr);
        g.push(cg);
        b.push(cb);
        // under the cursor white in some channel, and never as strong as the selection amber
        expect(cr < PAL.white[0] || cg < PAL.white[1] || cb < PAL.white[2]).toBe(true);
        expect(Math.max(cr, cg, cb) - Math.min(cr, cg, cb)).toBeLessThan(
          Math.max(...PAL.amber) - Math.min(...PAL.amber),
        );
      }
    const median = (a: number[]) => a.sort((m, n) => m - n)[a.length >> 1];
    expect(r.length).toBeGreaterThan(5000);
    for (const [c, v] of [median(r), median(g), median(b)].entries())
      expect(Math.abs(v - ROAD_GRAVEL[c])).toBeLessThan(8);
  }, 20_000);

  it('fades out over the paving fringe, short of the outline', () => {
    expect(pavingFade(-9)).toBe(1);
    expect(pavingFade(-0.17)).toBe(1);
    expect(pavingFade(-0.03)).toBe(0);
    expect(pavingFade(0.2)).toBe(0);
    for (let d = -0.17; d < -0.03; d += 0.01)
      expect(pavingFade(d)).toBeGreaterThan(pavingFade(d + 0.01));
  });
});

describe('the road read for the town paving (#476)', () => {
  it("gives the distance to the centre line weigh leaves, and the axis a straight's road runs along", () => {
    const w = 7,
      // a straight along x on row 1
      along = paintOf(w, 3, new Set([7, 8, 9, 10, 11, 12, 13]), { ox: 5, oy: 9 });
    // the ends of a line are ends: the axis is that of their arm; the middle ones are straights
    for (const k of [7, 8, 9, 10, 11, 12, 13]) expect(along.axis(k % w, 1, k), `${k}`).toBe(1);
    // a straight along y down the middle column
    const column = paintOf(3, 7, new Set([1, 4, 7, 10, 13, 16, 19]), { ox: -3, oy: 4 });
    for (const k of [1, 4, 7, 10, 13, 16, 19]) expect(column.axis(1, Math.floor(k / 3), k)).toBe(2);
    for (let x = 0.7; x < 5.8; x += 0.07)
      for (let y = 0.6; y < 1.4; y += 0.05) {
        const k = Math.round(y) * w + Math.round(x);
        along.weigh(x, y, k);
        expect(along.centre(x, y, k), `${x}, ${y}`).toBe(along.dist);
      }
  });

  it('knows no distance off its reach, and at a junction runs toward the arm the point lies to', () => {
    // a cross in the middle of a 3 x 3 map
    const p = paintOf(3, 3, new Set([1, 3, 4, 5, 7]));
    expect(p.axis(1.4, 1.1, 4)).toBe(1);
    expect(p.axis(1.1, 1.4, 4)).toBe(2);
    expect(p.axis(0.6, 0.95, 4)).toBe(1);
    expect(p.axis(1.05, 0.6, 4)).toBe(2);
    // a corner tile no road is beside
    const far = paintOf(5, 5, new Set([0, 1]));
    expect(far.centre(4, 4, 24)).toBe(Infinity);
  });
});

describe('the centre line and axis the town paving lays its lane by, against an oracle (#476)', () => {
  /**
   * A random network of road tiles on a 6 x 6 map at a random world origin: its painter and, for
   * the oracle, the tile-local polylines of every tile's centre line (`roadPath`, which samples
   * the same primitives `compileRoad` compiles) with each tile's piece kind.
   */
  function network(rng: Rng) {
    const w = 6,
      h = 6,
      ox = rng.int(-60, 60),
      oy = rng.int(-60, 60),
      tiles = new Set<number>();
    for (let k = 0; k < w * h; k++) if (rng.chance(0.5)) tiles.add(k);
    const has = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < w && y < h && tiles.has(y * w + x);
    const list: number[] = [],
      lines = new Map<number, [number, number][][]>(),
      kinds = new Map<number, string>();
    for (const k of tiles) {
      const x = k % w,
        y = Math.floor(k / w),
        code = roadCode(roadSides(has, [], x, y), 0, null),
        shape = roadShape(code, x + ox, y + oy);
      list.push(k, code);
      lines.set(k, roadPath(shape, 64));
      kinds.set(k, shape.piece.kind);
    }
    return { w, h, p: new RoadPaint(w, h, ox, oy, list, () => false), lines, kinds };
  }
  /** The nearest the centre lines near map point (x, y) come to it, and the axis (1 x, 2 y) there. */
  function nearest(lines: Map<number, [number, number][][]>, w: number, x: number, y: number) {
    let best = Infinity,
      axis = 0;
    for (const [k, paths] of lines) {
      const u = x - (k % w),
        v = y - Math.floor(k / w);
      if (Math.abs(u) > 1 || Math.abs(v) > 1) continue;
      for (const line of paths)
        for (let s = 0; s + 1 < line.length; s++) {
          const [ax, ay] = line[s],
            [bx, by] = line[s + 1],
            ex = bx - ax,
            ey = by - ay,
            t = Math.max(
              0,
              Math.min(1, ((u - ax) * ex + (v - ay) * ey) / (ex * ex + ey * ey || 1)),
            );
          const d = Math.hypot(u - ax - ex * t, v - ay - ey * t);
          if (d < best) {
            best = d;
            axis = Math.abs(ex) > Math.abs(ey) ? 1 : 2;
          }
        }
    }
    return { best, axis };
  }
  /** The most a tee's or a cross's smooth minimum takes off the distance: a quarter of its join. */
  const SMOOTH = 0.12 / 4;

  // Slow: reads 100 networks of 300 points against every line near them (about 0.5 s alone), so the
  // limit is 10 s.
  it('centre() is the distance to the nearest drawn centre line, junctions rounded in by a smooth minimum', () => {
    let junction = 0,
      plain = 0;
    forAll(
      (rng) => ({ rng, net: network(rng) }),
      ({ rng, net: { w, h, p, lines, kinds } }) => {
        for (let n = 0; n < 300; n++) {
          const x = rng.range(0, w - 1),
            y = rng.range(0, h - 1),
            k = Math.round(y) * w + Math.round(x);
          if (!p.near(k)) {
            expect(p.centre(x, y, k), `off reach ${x}, ${y}`).toBe(Infinity);
            continue;
          }
          const { best } = nearest(lines, w, x, y),
            c = p.centre(x, y, k);
          if (best >= 0.3) continue;
          // are there junctions among the tiles the point can read
          let near = false;
          for (let j = Math.max(0, Math.round(y) - 1); j <= Math.min(h - 1, Math.round(y) + 1); j++)
            for (
              let i = Math.max(0, Math.round(x) - 1);
              i <= Math.min(w - 1, Math.round(x) + 1);
              i++
            )
              if (['tee', 'cross'].includes(kinds.get(j * w + i) ?? '')) near = true;
          // a smooth minimum only takes away, by at most a quarter of the join (JOIN_MAX 0.12)
          expect(c, `at ${x}, ${y}: oracle ${best}`).toBeLessThanOrEqual(best + 5e-3);
          expect(c, `at ${x}, ${y}: oracle ${best}`).toBeGreaterThanOrEqual(best - SMOOTH - 5e-3);
          if (near) junction++;
          else {
            plain++;
            expect(c, `at ${x}, ${y}, no junction: oracle ${best}`).toBeCloseTo(best, 2);
          }
        }
      },
      { shrinkBudget: 0, format: () => 'a random 6 x 6 network of road tiles' },
    );
    // both kinds of neighbourhood were read, many times
    expect(plain).toBeGreaterThan(2000);
    expect(junction).toBeGreaterThan(1000);
  }, 10_000);

  // Slow: reads 100 networks of 400 points against every line near them (about 0.5 s alone), so the
  // limit is 10 s.
  it('axis() is the direction of the centre line the point is on, outside the middle of a junction', () => {
    let read = 0;
    forAll(
      (rng) => ({ rng, net: network(rng) }),
      ({ rng, net: { w, p, lines } }) => {
        for (let n = 0; n < 400; n++) {
          const x = rng.range(0, w - 1),
            y = rng.range(0, w - 1),
            k = Math.round(y) * w + Math.round(x);
          if (!p.near(k)) continue;
          const { best, axis } = nearest(lines, w, x, y),
            i = k % w,
            j = Math.floor(k / w);
          // on the road, and out of the middle of the tile where wander and joins make the way
          // ambiguous: the way the nearest line runs
          if (best >= ROAD_HALF || Math.max(Math.abs(x - i), Math.abs(y - j)) <= 0.3) continue;
          read++;
          expect(p.axis(x, y, k), `at ${x}, ${y}`).toBe(axis);
        }
      },
      { shrinkBudget: 0, format: () => 'a random 6 x 6 network of road tiles' },
    );
    expect(read).toBeGreaterThan(2000);
  }, 10_000);
});

describe('a road on a bridge deck (#506)', () => {
  /** A random road layout with some of its tiles on bridge platforms. */
  function decked(rng: Rng) {
    const l = layout(rng),
      decks = new Set<number>();
    for (const k of l.tiles) if (rng.chance(0.3)) decks.add(k);
    return { ...l, decks };
  }
  /** The tile beside tile `k` of a `w` x `h` map across side `d`, -1 off the map. */
  const beside = (w: number, h: number, k: number, d: number) => {
    const x = (k % w) + DIR_DX[d],
      y = Math.floor(k / w) + DIR_DY[d];
    return x >= 0 && y >= 0 && x < w && y < h ? y * w + x : -1;
  };

  it('is handed over marked as a deck, and every road keeps its tile and its code', () => {
    forAll(decked, ({ w, h, tiles, crossing, decks }) => {
      const codes = codesOf(w, h, tiles, crossing),
        list = paintedRoads(codes, (k) => decks.has(k));
      expect(list.length).toBe(2 * codes.size);
      const order = [...codes];
      for (let i = 0; i < order.length; i++) {
        const [k, code] = order[i];
        expect(list[2 * i]).toBe(k);
        expect(list[2 * i + 1] & ~ROAD_ON_DECK).toBe(code);
        expect((list[2 * i + 1] & ROAD_ON_DECK) !== 0, `tile ${k}`).toBe(decks.has(k));
      }
    });
  });

  it('is a bit no road code carries of its own', () => {
    for (let sides = 0; sides < 16; sides++)
      for (let pinned = 0; pinned < 16; pinned++)
        for (const crossing of ['x', 'y', null] as const)
          expect(roadCode(sides, pinned, crossing) & ROAD_ON_DECK).toBe(0);
  });

  it('is not painted, and no road beside it reaches over the edge on to it', () => {
    forAll(decked, ({ w, h, tiles, crossing, ox, oy, decks }) => {
      const p = paintOf(w, h, tiles, { ox, oy, crossing, decks });
      for (const k of decks) {
        expect(p.near(k), `tile ${k}`).toBe(false);
        const x = k % w,
          y = Math.floor(k / w);
        for (let v = -0.49; v <= 0.49; v += 0.07)
          for (let u = -0.49; u <= 0.49; u += 0.07) {
            expect(weightAt(p, x + u, y + v)).toBe(0);
            expect(p.onCore(x + u, y + v, k)).toBe(false);
          }
      }
    });
  });

  it('leaves the roads off the decks as they were, less what the decks reached over to paint', () => {
    forAll(decked, ({ w, h, tiles, crossing, ox, oy, decks }) => {
      const p = paintOf(w, h, tiles, { ox, oy, crossing, decks }),
        bare = paintOf(w, h, tiles, { ox, oy, crossing });
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (decks.has(y * w + x)) continue;
          for (let v = -0.48; v <= 0.48; v += 0.08)
            for (let u = -0.48; u <= 0.48; u += 0.08)
              expect(weightAt(p, x + u, y + v)).toBeLessThanOrEqual(
                weightAt(bare, x + u, y + v) + 1e-12,
              );
        }
    });
  });

  it('meets the road beside it whole at their shared edge', () => {
    let met = 0;
    forAll(decked, ({ w, h, tiles, crossing, ox, oy, decks }) => {
      const p = paintOf(w, h, tiles, { ox, oy, crossing, decks }),
        codes = codesOf(w, h, tiles, crossing);
      for (const [k, code] of codes) {
        if (decks.has(k)) continue;
        const x = k % w,
          y = Math.floor(k / w),
          shape = roadShape(code, x + ox, y + oy);
        for (const d of DIRS) {
          const n = beside(w, h, k, d);
          // (a level crossing runs no arm out to a side along its track)
          if (n < 0 || !decks.has(n) || shape.ends[d] !== 0.5) continue;
          // where its arm crosses the edge, just inside its own tile: the whole road, to the edge
          const along = 0.5 - 1e-6,
            u = DIR_DX[d] ? DIR_DX[d] * along : shape.offsets[d],
            v = DIR_DY[d] ? DIR_DY[d] * along : shape.offsets[d];
          expect(weightAt(p, x + u, y + v), `${x},${y} side ${d}`).toBe(1);
          met++;
        }
      }
    });
    expect(met).toBeGreaterThan(100);
  });

  it('has the road beside it cover the painted bank toward it, and nowhere else', () => {
    let toward = 0;
    forAll(decked, ({ w, h, tiles, crossing, ox, oy, decks }) => {
      const p = paintOf(w, h, tiles, { ox, oy, crossing, decks });
      for (let k = 0; k < w * h; k++) {
        const x = k % w,
          y = Math.floor(k / w),
          sides = DIRS.filter((d) => {
            const n = beside(w, h, k, d);
            return tiles.has(k) && !decks.has(k) && n >= 0 && decks.has(n);
          });
        // none in the middle of any tile, none on a tile that is no road beside a deck
        expect(p.abutment(x, y, k)).toBe(0);
        if (!sides.length)
          for (let v = -0.49; v <= 0.49; v += 0.07)
            for (let u = -0.49; u <= 0.49; u += 0.07) expect(p.abutment(x + u, y + v, k)).toBe(0);
        for (const d of sides) {
          // more and more on the way out to the edge, and all of it there
          let last = 0;
          for (let a = 0; a <= 0.5; a += 0.02) {
            const now = p.abutment(x + DIR_DX[d] * a, y + DIR_DY[d] * a, k);
            expect(now).toBeGreaterThanOrEqual(last);
            last = now;
          }
          expect(p.abutment(x + DIR_DX[d] * 0.499, y + DIR_DY[d] * 0.499, k)).toBe(1);
          toward++;
        }
      }
    });
    expect(toward).toBeGreaterThan(100);
  });

  it("keeps the gravel's colour where it covers painted water, under any season's tint", () => {
    const p = paintOf(6, 3, new Set([6, 7, 8, 9, 10, 11]), { ox: 3, oy: -2, decks: new Set([9]) });
    let painted = 0;
    for (const tint of [0xd8e8c0, 0xc0d0e8, 0xffe0b0, 0x909090])
      for (const water of [0, 0.3, 0.8, 1])
        for (let x = 0.5; x < 2.5; x += 0.07) {
          if (weightAt(p, x, 1) < 1) continue;
          const shown = (t: number) => {
            const out = [40, 90, 120];
            p.weigh(x, 1, 6 + Math.round(x));
            p.paint(x, 1, out, 1, t, water);
            // the painter keeps the season's tint off the water's share of the point
            return out.map(
              (c, i) => c * (water + ((1 - water) * ((t >> (16 - i * 8)) & 255)) / 255),
            );
          };
          const white = shown(0xffffff),
            tinted = shown(tint);
          for (let c = 0; c < 3; c++) expect(tinted[c]).toBeCloseTo(white[c], 6);
          painted++;
        }
    expect(painted).toBeGreaterThan(50);
  });
});
