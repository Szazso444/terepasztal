import { describe, expect, it } from 'vitest';
import { groundFrames, groundOf, type FrameGround } from '../art/buildingGround';
import { PAL } from '../art/palette';
import { DIR_DX, DIR_DY, Dir } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { forAll, shrinkArray } from '../testing/property';
import { structureScale } from './assetScale';
import {
  BuildingYards,
  KERB_OUT,
  YARD_COLOURS,
  YARD_MARGIN,
  buildingYard,
  footprintTiles,
  hasKerb,
  yardKind,
  yardTiles,
  type Yard,
  type YardKind,
} from './buildingYard';

/** The map the yards stand on in these tests. */
const W = 40,
  H = 40;
const FRAMES = groundFrames();
/** How far past its foot's outline a yard's edge can wobble and fade (tiles), beyond its margin. */
const FADE = 0.07 + 0.06 + 0.025;

/** A surface sheet whose ten cells are each one flat colour: the yards' texture factor is 1. */
function sheet(size = 8) {
  const out = new Uint8ClampedArray(size * size * 10 * 4);
  for (let m = 0; m < 10; m++)
    for (let k = 0; k < size * size; k++)
      out.set([60 + m * 12, 140 - m * 6, 70, 255], (m * size * size + k) * 4);
  return out;
}
const SHEET = sheet();

/** A building of `frame` with its footprint's corner on tile (cx, cy): its anchor and its yard. */
function standing(
  frame: string,
  cx: number,
  cy: number,
  opts: {
    scale?: number;
    sandy?: boolean;
    doors?: Parameters<typeof buildingYard>[3];
    road?: (x: number, y: number) => boolean;
  } = {},
) {
  const ground = groundOf(frame)!;
  let mx = 0,
    my = 0;
  for (const [dx, dy] of ground.footprint) {
    mx += dx / ground.footprint.length;
    my += dy / ground.footprint.length;
  }
  const site = { x: cx + mx, y: cy + my, scale: opts.scale ?? 1, sandy: opts.sandy ?? false };
  const yard = buildingYard(frame, ground, site, opts.doors ?? [], opts.road ?? (() => false));
  return { ground, site, yard };
}
/** The yard's weight at map point (x, y), as the painter reads it there. */
function weigh(p: BuildingYards, x: number, y: number) {
  return p.weigh(x, y, Math.round(y) * W + Math.round(x));
}

/** Signed distance (tiles, negative inside) from (x, y) to the convex quadrilateral `q` (x, y pairs). */
function outside(q: readonly number[], x: number, y: number) {
  let best = Infinity,
    pos = 0,
    neg = 0;
  for (let i = 0; i < 4; i++) {
    const ax = q[i * 2],
      ay = q[i * 2 + 1],
      bx = q[((i + 1) % 4) * 2],
      by = q[((i + 1) % 4) * 2 + 1];
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cross > 0) pos++;
    if (cross < 0) neg++;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2),
      ),
    );
    best = Math.min(best, Math.hypot(x - ax - (bx - ax) * t, y - ay - (by - ay) * t));
  }
  return pos === 4 || neg === 4 ? -best : best;
}
/** Distance from (x, y) to the segment from (ax, ay) to (bx, by). */
function toSegment(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const t = Math.max(
    0,
    Math.min(
      1,
      ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1),
    ),
  );
  return Math.hypot(x - ax - (bx - ax) * t, y - ay - (by - ay) * t);
}

/** A building of any frame with ground data, somewhere on the map, at any scale, and points round it. */
function site(rng: {
  pick<T>(a: readonly T[]): T;
  int(a: number, b: number): number;
  range(a: number, b: number): number;
  chance(p: number): boolean;
}) {
  return {
    frame: rng.pick(FRAMES),
    cx: rng.int(6, 30),
    cy: rng.int(6, 30),
    scale: rng.range(0.6, 1.5),
    sandy: rng.chance(0.3),
    origin: [rng.int(-60, 60), rng.int(-60, 60)] as const,
    points: Array.from(
      { length: 160 },
      () => [rng.range(-2.6, 3.6), rng.range(-2.6, 3.6)] as const,
    ),
  };
}

describe('the yard a building wears into the ground', () => {
  it('is of the ground its kind of building wears', () => {
    const kinds: Record<string, YardKind> = {
      'structures/farm_1': 'earth',
      'structures/windmill': 'earth',
      'structures/grinder_r1': 'earth',
      'structures/pump_2': 'sand',
      'structures/station_3': 'gravel',
      'structures/warehouse_1_r2': 'gravel',
      'structures/town_2': 'gravel',
      'structures/townhouse_s0': 'gravel',
      'structures/townhouse_3': 'gravel',
      'structures/depot_r0_lv2': 'cinder',
      'structures/depot_narrow_r1': 'cinder',
      'structures/water_tower': 'cinder',
      'structures/fuel_stop_r1': 'cinder',
      'structures/substation': 'cinder',
      'structures/quarry_4': 'grit',
    };
    for (const [frame, kind] of Object.entries(kinds)) {
      expect(groundOf(frame), frame).toBeDefined();
      expect(yardKind(frame, false), frame).toBe(kind);
    }
    // on sand and desert a farm's earth is packed sand; stone yards stay stone
    expect(yardKind('structures/farm_3', true)).toBe('sand');
    expect(yardKind('structures/station_1', true)).toBe('gravel');
    // stations and warehouses end their platform in a kerb, no other building does
    expect(FRAMES.filter(hasKerb).every((f) => /\/(station|warehouse)_/.test(f))).toBe(true);
    expect(FRAMES.some(hasKerb)).toBe(true);
    for (const kind of Object.keys(YARD_MARGIN) as YardKind[]) {
      expect(YARD_MARGIN[kind], kind).toBeGreaterThanOrEqual(0.1);
      expect(YARD_MARGIN[kind], kind).toBeLessThanOrEqual(0.2);
    }
  });

  // Slow: reads about a thousand points round each of 100 buildings (about 0.35 s alone; the
  // limit is 10 s).
  it('lies whole under its foot, and paints nothing off the tiles placing the building repaints', () => {
    forAll(site, (c) => {
      const { site: at, yard } = standing(c.frame, c.cx, c.cy, {
        scale: c.scale,
        sandy: c.sandy,
        road: () => c.sandy,
      });
      const painter = new BuildingYards(W, H, c.origin[0], c.origin[1], [yard]),
        repainted = new Set(yardTiles(yard, W, H)),
        // the painter reads a tile's yards from the tile; through the anchor's own tile, which
        // lists this yard, it reads the yard's whole shape at any point, cut by no tile
        home = Math.round(at.y) * W + Math.round(at.x);
      expect(repainted.has(home)).toBe(true);
      const read = (x: number, y: number) => {
        const k = Math.round(y) * W + Math.round(x);
        painter.weigh(x, y, home);
        if (!repainted.has(k)) expect(painter.touched, `${c.frame} at ${x}, ${y}`).toBe(false);
        if (outside(yard.foot, x, y) < -0.1)
          expect(painter.weight, `${c.frame} at ${x}, ${y}`).toBe(1);
      };
      for (const [dx, dy] of c.points) read(c.cx + dx, c.cy + dy);
      // where it ends: out from its foot's outline as far as its edge can reach, round each door
      // path's end and along the kerb
      const mx = (yard.foot[0] + yard.foot[2] + yard.foot[4] + yard.foot[6]) / 4,
        my = (yard.foot[1] + yard.foot[3] + yard.foot[5] + yard.foot[7]) / 4;
      for (let i = 0; i < 4; i++)
        for (let t = 0; t <= 1; t += 1 / 16) {
          const j = (i + 1) % 4,
            ex = yard.foot[i * 2] + (yard.foot[j * 2] - yard.foot[i * 2]) * t,
            ey = yard.foot[i * 2 + 1] + (yard.foot[j * 2 + 1] - yard.foot[i * 2 + 1]) * t,
            l = Math.hypot(ex - mx, ey - my) || 1;
          for (let out = 0.02; out < yard.margin + FADE + 0.02; out += 0.03)
            read(ex + ((ex - mx) / l) * out, ey + ((ey - my) / l) * out);
        }
      for (const p of yard.paths)
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 8)
          for (const r of [0.04, 0.08, 0.12])
            read(p.x + p.dx * p.length + Math.cos(a) * r, p.y + p.dy * p.length + Math.sin(a) * r);
      const kb = yard.kerb;
      if (kb)
        for (let along = kb.from - 0.3; along <= kb.to + 0.3; along += 0.05)
          for (const e of [-0.06, -0.02, 0.01, 0.03, 0.05])
            read(
              kb.x + kb.dx * (kb.at + e) - kb.dy * along,
              kb.y + kb.dy * (kb.at + e) + kb.dx * along,
            );
    });
  }, 10_000);

  // Slow: reads 160 points round each of 100 buildings, and a ring round each (about 0.3 s
  // alone; the limit is 10 s).
  it('reaches its margin, 0.1 to 0.2 tile past its foot, and fades out into the ground beyond', () => {
    let near = 0,
      nearWeight = 0;
    forAll(site, (c) => {
      if (hasKerb(c.frame)) return;
      const { yard } = standing(c.frame, c.cx, c.cy, { scale: c.scale, sandy: c.sandy });
      const painter = new BuildingYards(W, H, c.origin[0], c.origin[1], [yard]);
      // away from its door paths
      const offPath = (x: number, y: number) =>
        yard.paths.every(
          (p) => toSegment(x, y, p.x, p.y, p.x + p.dx * p.length, p.y + p.dy * p.length) > 0.2,
        );
      for (const [dx, dy] of c.points) {
        const x = c.cx + dx,
          y = c.cy + dy;
        if (!offPath(x, y)) continue;
        weigh(painter, x, y);
        if (outside(yard.foot, x, y) > yard.margin + FADE)
          expect(painter.weight, `${c.frame} at ${x}, ${y}`).toBe(0);
      }
      // a ring 0.04 tile out round the foot, from its middle out through its outline
      const mx = (yard.foot[0] + yard.foot[2] + yard.foot[4] + yard.foot[6]) / 4,
        my = (yard.foot[1] + yard.foot[3] + yard.foot[5] + yard.foot[7]) / 4;
      for (let i = 0; i < 4; i++)
        for (const t of [0.2, 0.4, 0.6, 0.8]) {
          const j = (i + 1) % 4,
            ex = yard.foot[i * 2] + (yard.foot[j * 2] - yard.foot[i * 2]) * t,
            ey = yard.foot[i * 2 + 1] + (yard.foot[j * 2 + 1] - yard.foot[i * 2 + 1]) * t,
            l = Math.hypot(ex - mx, ey - my) || 1,
            x = ex + ((ex - mx) / l) * 0.04,
            y = ey + ((ey - my) / l) * 0.04;
          if (!offPath(x, y) || outside(yard.foot, x, y) <= 0) continue;
          near++;
          nearWeight += weigh(painter, x, y);
        }
    });
    // just past the foot most of the ground is yard, broken up here and there
    expect(near).toBeGreaterThan(500);
    expect(nearWeight / near).toBeGreaterThan(0.6);
  }, 10_000);

  it('runs a worn path out of each door the picture shows, on to the road where one is next door', () => {
    let doors = 0;
    for (const frame of FRAMES) {
      const ground = groundOf(frame)!;
      if (!ground.doors.length) continue;
      for (const road of [false, true]) {
        const { yard } = standing(frame, 12, 12, { road: () => road });
        const painter = new BuildingYards(W, H, 0, 0, [yard]);
        expect(yard.paths, frame).toHaveLength(ground.doors.length);
        ground.doors.forEach((d, i) => {
          doors++;
          const p = yard.paths[i],
            side = { N: Dir.N, E: Dir.E, S: Dir.S, W: Dir.W }[d.side];
          // out of the door, toward the tile its door reaches
          expect([p.dx, p.dy], frame).toEqual([DIR_DX[side], DIR_DY[side]]);
          expect(p.open, frame).toBe(road);
          const rx = 12 + d.reach[0],
            ry = 12 + d.reach[1];
          if (road)
            // on to the road's tile, its middle
            expect((rx - p.x) * p.dx + (ry - p.y) * p.dy - p.length, frame).toBeCloseTo(0.05, 9);
          else expect(p.length, frame).toBeCloseTo(yard.margin + 0.16, 9);
          // whole along its middle, where no kerb cuts it
          for (const u of [0.05, 0.3, 0.6]) {
            const x = p.x + p.dx * p.length * u,
              y = p.y + p.dy * p.length * u;
            if (
              yard.kerb &&
              (x - yard.kerb.x) * yard.kerb.dx + (y - yard.kerb.y) * yard.kerb.dy >
                yard.kerb.at - 0.1
            )
              continue;
            weigh(painter, x, y);
            expect(painter.weight, `${frame} door ${i}, ${u} out`).toBe(1);
          }
        });
      }
    }
    expect(doors).toBeGreaterThan(100);
  });

  it("runs a path from a street door the picture does not show, from the middle of its tile's wall", () => {
    // a station's street door is on its back (N at rotation 0), a wall the camera does not see
    const frame = 'structures/station_1',
      ground = groundOf(frame)!;
    expect(ground.doors.some((d) => d.kind === 'street')).toBe(false);
    const door = { tile: { x: 12, y: 12 }, side: Dir.N };
    for (const road of [false, true]) {
      const { yard } = standing(frame, 12, 12, {
        doors: [door],
        road: (x, y) => road && x === 12 && y === 11,
      });
      expect(yard.paths, `road ${road}`).toHaveLength(1);
      const [p] = yard.paths;
      expect([p.dx, p.dy, p.open]).toEqual([0, -1, road]);
      // it starts on the foot's N wall (n to e), level with the tile's middle along it
      const [nx, ny, ex, ey] = yard.foot;
      expect(toSegment(p.x, p.y, nx, ny, ex, ey)).toBeLessThan(1e-9);
      expect(p.x).toBeCloseTo(Math.max(Math.min(nx, ex), Math.min(12, Math.max(nx, ex))), 9);
      // and reaches the road tile's middle, or a little past the yard
      if (road) expect(p.y - p.length).toBeCloseTo(11.05, 9);
      else expect(p.length).toBeCloseTo(yard.margin + 0.16, 9);
    }
    // a door on another building's tile is not this one's
    const { yard } = standing(frame, 12, 12, { doors: [{ tile: { x: 13, y: 12 }, side: Dir.N }] });
    expect(yard.paths).toEqual([]);
  });

  it("ends a station's and a warehouse's platform in a straight kerb at the track's ballast", () => {
    const tone = (c: number[]) => c[0] + c[1] + c[2];
    for (const frame of FRAMES.filter(hasKerb)) {
      const { ground, site: at, yard } = standing(frame, 12, 12);
      const kb = yard.kerb!;
      const side = { N: Dir.N, E: Dir.E, S: Dir.S, W: Dir.W }[ground.front.side];
      expect([kb.dx, kb.dy], frame).toEqual([DIR_DX[side], DIR_DY[side]]);
      // KERB_OUT past the footprint's own edge on that side
      const edge = Math.max(
        ...footprintTiles(ground, at.x, at.y).map(
          (t) => (t.x - at.x) * kb.dx + (t.y - at.y) * kb.dy + 0.5,
        ),
      );
      expect(kb.at, frame).toBeCloseTo(edge + KERB_OUT, 9);
      const painter = new BuildingYards(W, H, 0, 0, [yard]);
      const point = (e: number, along: number) =>
        [
          at.x + kb.dx * (kb.at + e) - kb.dy * along,
          at.y + kb.dy * (kb.at + e) + kb.dx * along,
        ] as const;
      const ground0 = [110, 125, 69];
      // pale coping stones just inside the line, brighter than the platform's gravel behind them
      let coping = 0,
        gravel = 0;
      const span = kb.to - kb.from;
      for (let n = 0; n < 24; n++) {
        const along = kb.from + span * (0.15 + (0.7 * n) / 23),
          a = [...ground0],
          b = [...ground0];
        const [cx, cy] = point(-0.045, along),
          [gx, gy] = point(-0.2, along);
        weigh(painter, cx, cy);
        painter.paint(cx, cy, a, 1, 0xffffff, SHEET, [0, 0, 0]);
        weigh(painter, gx, gy);
        painter.paint(gx, gy, b, 1, 0xffffff, SHEET, [0, 0, 0]);
        coping += tone(a) / 24;
        gravel += tone(b) / 24;
      }
      expect(coping, `${frame} coping`).toBeGreaterThan(gravel + 60);
      for (const along of [(kb.from + kb.to) / 2, kb.from + 0.15, kb.to - 0.15]) {
        // straight: nothing of the yard, nor of a door path, past it
        for (const e of [0.05, 0.08, 0.2]) {
          const [x, y] = point(e, along);
          weigh(painter, x, y);
          expect(painter.weight, `${frame} ${e} past the kerb`).toBe(0);
        }
        // a kerb facing the camera has its face, and a dark line at its foot on the ground
        const [fx, fy] = point(kb.face ? 0.028 : 0.012, along);
        weigh(painter, fx, fy);
        const foot = [...ground0];
        painter.paint(fx, fy, foot, 1, 0xffffff, SHEET, [0, 0, 0]);
        expect(tone(foot), `${frame} foot line`).toBeLessThan(tone(ground0) * 0.75);
      }
    }
  });

  it('keeps a stone yard out of the season tint, while earth and sand take it with the ground', () => {
    const tint = 0xd8c8a0,
      ground0 = [110, 125, 69];
    for (const [frame, stone] of [
      ['structures/station_2', true],
      ['structures/water_tower', true],
      ['structures/quarry_2', true],
      ['structures/farm_2', false],
      ['structures/pump_1', false],
    ] as const) {
      const { yard } = standing(frame, 12, 12);
      const painter = new BuildingYards(W, H, 0, 0, [yard]);
      // the middle of the foot, where the yard is whole
      const x = (yard.foot[0] + yard.foot[4]) / 2,
        y = (yard.foot[1] + yard.foot[5]) / 2;
      weigh(painter, x, y);
      expect(painter.weight, frame).toBe(1);
      const plain = [...ground0],
        tinted = [...ground0];
      painter.paint(x, y, plain, 1, 0xffffff, SHEET, [0, 0, 0]);
      painter.paint(x, y, tinted, 1, tint, SHEET, [0, 0, 0]);
      // what shows: the painter multiplies the ground by the tint after the yard is in it
      const shown = tinted.map((c, i) => (c * ((tint >> (16 - i * 8)) & 255)) / 255);
      for (let i = 0; i < 3; i++)
        if (stone) expect(shown[i], frame).toBeCloseTo(plain[i], 6);
        else expect(tinted[i], frame).toBeCloseTo(plain[i], 6);
    }
  });

  // Slow: paints 160 points round each of 100 buildings.
  it('stays below the semantic colours, the selection amber and the cursor white', () => {
    const limit = Math.min(PAL.amber[0], PAL.white[0]);
    for (const c of Object.values(YARD_COLOURS)) expect(Math.max(...c)).toBeLessThan(limit - 40);
    forAll(site, (c) => {
      const { yard } = standing(c.frame, c.cx, c.cy, { scale: c.scale, sandy: c.sandy });
      const painter = new BuildingYards(W, H, c.origin[0], c.origin[1], [yard]);
      for (const [dx, dy] of c.points) {
        const x = c.cx + dx,
          y = c.cy + dy;
        weigh(painter, x, y);
        if (!painter.touched) continue;
        const colour = [150, 160, 90];
        painter.paint(x, y, colour, 1, 0xffffff, SHEET, [0, 0, 0]);
        expect(Math.max(...colour), `${c.frame} at ${x}, ${y}`).toBeLessThan(limit);
      }
    });
  });

  it('is the same picture whatever chunk asks, and the strongest yard where two meet', () => {
    const a = standing('structures/townhouse', 10, 10).yard,
      b = standing('structures/station_2', 11, 10).yard;
    const one = new BuildingYards(W, H, 3, -4, [a, b]),
      again = new BuildingYards(W, H, 3, -4, [a, b]),
      alone = new BuildingYards(W, H, 3, -4, [a]);
    for (let y = 9; y <= 11.5; y += 0.07)
      for (let x = 9; x <= 12.5; x += 0.07) {
        const w1 = weigh(one, x, y),
          w2 = weigh(again, x, y),
          w0 = weigh(alone, x, y);
        expect(w1).toBe(w2);
        expect(w1).toBeGreaterThanOrEqual(w0);
      }
  });
});

/** Every yard reads from its frame's ground data the corners it was measured with, scaled. */
describe('a yard from its ground data', () => {
  it('stands its foot where the data puts it, at the scale the picture is drawn', () => {
    const ground = groundOf('structures/townhouse') as FrameGround;
    for (const scale of [0.7, 1, 1.3]) {
      const { site: at, yard } = standing('structures/townhouse', 5, 7, { scale });
      ground.foot.forEach(([px, py], i) => {
        // world px from the anchor on the ground, back to map tiles
        expect(yard.foot[i * 2]).toBeCloseTo(at.x + (px / 64 + py / 32) * scale, 9);
        expect(yard.foot[i * 2 + 1]).toBeCloseTo(at.y + (py / 32 - px / 64) * scale, 9);
      });
    }
  });
});

/** A point (map tile coordinates) the painter reads, on the tile it lies on. */
type At = readonly [number, number];
/** One building of `frame` standing with its footprint's corner on tile (cx, cy), and points. */
interface Case {
  frame: string;
  cx: number;
  cy: number;
  scale: number;
  sandy: boolean;
  origin: At;
  points: At[];
}
/** Shrinks a case by its points only: the building it is about stays as it failed. */
const shrinkPoints = (c: Case) =>
  [...shrinkArray(c.points)].map((points) => ({ ...c, points }) as Case);
/** A case for a failure message, its numbers to four places. */
const brief = (c: unknown) =>
  JSON.stringify(c, (_k, v: unknown) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v));
/** The yard of a case's building. */
const yardOf = (c: Case) =>
  standing(c.frame, c.cx, c.cy, { scale: c.scale, sandy: c.sandy, road: () => c.sandy }).yard;

describe('the share of the ground a yard is given', () => {
  /**
   * Any building, one with a platform's kerb half the time, and points round it: anywhere near
   * it, and across its kerb, where the kerb's coping, face and foot line are painted.
   */
  function sharing(rng: Rng): Case {
    const kerbed = FRAMES.filter(hasKerb),
      rest = FRAMES.filter((f) => !hasKerb(f));
    const c: Case = {
      frame: rng.chance(0.5) ? rng.pick(kerbed) : rng.pick(rest),
      cx: rng.int(6, 30),
      cy: rng.int(6, 30),
      scale: rng.range(0.6, 1.5),
      sandy: rng.chance(0.3),
      origin: [rng.int(-60, 60), rng.int(-60, 60)],
      points: [],
    };
    for (let i = 0; i < 80; i++)
      c.points.push([c.cx + rng.range(-1.5, 2.5), c.cy + rng.range(-1.5, 2.5)]);
    const kb = yardOf(c).kerb;
    if (kb)
      for (let i = 0; i < 80; i++) {
        const e = kb.at + rng.range(-0.1, 0.1),
          along = rng.range(kb.from - 0.2, kb.to + 0.2);
        c.points.push([kb.x + kb.dx * e - kb.dy * along, kb.y + kb.dy * e + kb.dx * along]);
      }
    return c;
  }

  // The painter gives a yard no share of a point that is all water, or on a steep bank
  // (landscape.worker.ts: `(1 - waterWeight) * (1 - bank)`): it keeps out of them.
  it('paints nothing where it is given no share of the ground: water, a steep bank', () => {
    forAll(
      sharing,
      (c) => {
        const painter = new BuildingYards(W, H, c.origin[0], c.origin[1], [yardOf(c)]);
        for (const [x, y] of c.points) {
          weigh(painter, x, y);
          if (!painter.touched) continue;
          const ground = [110, 125, 69];
          painter.paint(x, y, ground, 0, 0xd8e8c0, SHEET, [0, 0, 0]);
          expect(ground, `${c.frame} at ${x}, ${y}`).toEqual([110, 125, 69]);
        }
      },
      { shrink: shrinkPoints, format: brief },
    );
  });
});

describe('yards that meet', () => {
  /** Two or three buildings of any frame on neighbouring tiles, and points over all of them. */
  function crowd(rng: Rng) {
    const sites = Array.from({ length: rng.int(2, 3) }, () => ({
      frame: rng.pick(FRAMES),
      cx: rng.int(11, 13),
      cy: rng.int(11, 13),
      scale: rng.range(0.6, 1.5),
      sandy: rng.chance(0.3),
    }));
    return {
      sites,
      origin: [rng.int(-60, 60), rng.int(-60, 60)] as At,
      points: Array.from({ length: 120 }, () => [rng.range(10, 15), rng.range(10, 15)] as At),
    };
  }

  // Slow: weighs 120 points with five painters for each of 100 crowds (about 0.25 s alone).
  it('weigh as much as the strongest of them alone, in whatever order they are listed', () => {
    forAll(
      crowd,
      ({ sites, origin, points }) => {
        const yards = sites.map(
          (s) => standing(s.frame, s.cx, s.cy, { scale: s.scale, sandy: s.sandy }).yard,
        );
        const all = new BuildingYards(W, H, origin[0], origin[1], yards),
          reversed = new BuildingYards(W, H, origin[0], origin[1], [...yards].reverse()),
          alone = yards.map((y) => new BuildingYards(W, H, origin[0], origin[1], [y]));
        for (const [x, y] of points) {
          const strongest = Math.max(...alone.map((p) => weigh(p, x, y)));
          expect(weigh(all, x, y), `at ${x}, ${y}`).toBe(strongest);
          expect(weigh(reversed, x, y), `at ${x}, ${y}, listed the other way`).toBe(strongest);
        }
      },
      {
        shrink: (c) => [...shrinkArray(c.points)].map((points) => ({ ...c, points })),
        format: brief,
      },
    );
  }, 30_000);
});

describe("a door's worn path", () => {
  /** The scales a frame is tested at: its data's own, and the one the game draws it at. */
  const scales = (frame: string) => [...new Set([1, structureScale(frame)])];
  /** The yard's edge band begins this far (tiles) inside its margin (`EDGE` in buildingYard.ts). */
  const EDGE_BAND = 0.07;

  it("runs from each door out past the yard's edge, whole while the yard round it is", () => {
    const short: string[] = [];
    let paths = 0;
    for (const frame of FRAMES) {
      if (!groundOf(frame)!.doors.length) continue;
      for (const scale of scales(frame)) {
        const { yard } = standing(frame, 12, 12, { scale }),
          painter = new BuildingYards(W, H, 7, -3, [yard]),
          kb = yard.kerb;
        for (const p of yard.paths) {
          paths++;
          const where = `${frame} at scale ${scale}, the path out of ${p.x}, ${p.y}`;
          // it ends past the yard's margin (PATH_PAST past it), or (on a platform) on its kerb
          const end = [p.x + p.dx * p.length, p.y + p.dy * p.length] as const,
            onKerb = !!kb && (end[0] - kb.x) * kb.dx + (end[1] - kb.y) * kb.dy > kb.at - 0.1,
            out = outside(yard.foot, ...end);
          if (!onKerb && out <= yard.margin)
            short.push(
              `${where} (${-outside(yard.foot, p.x, p.y)} inside the foot) ends ${out} past ` +
                `the foot, inside the yard's margin of ${yard.margin}`,
            );
          // and no gap in it while the yard round it is whole: outside the foot the yard breaks
          // up into the ground, but its path does not
          let least = 1,
            at = 0;
          for (let u = 0; u <= 1; u += 1 / 64) {
            const x = p.x + p.dx * p.length * u,
              y = p.y + p.dy * p.length * u;
            if (outside(yard.foot, x, y) > yard.margin - EDGE_BAND) break;
            if (kb && (x - kb.x) * kb.dx + (y - kb.y) * kb.dy > kb.at - 0.1) break;
            const w = weigh(painter, x, y);
            if (w < least) [least, at] = [w, u];
          }
          if (least < 0.95) short.push(`${where} is broken to ${least}, ${at} along it`);
        }
      }
    }
    expect(paths).toBeGreaterThan(120);
    expect(short, `${short.length} door paths fall short`).toEqual([]);
  });

  /** A door path's half width at the door (tiles; `PATH_HALF` in buildingYard.ts). */
  const MOUTH = 0.075;
  /** The foot's corners (n, e, s, w) each side's wall runs between. */
  const WALL = { N: [0, 1], E: [1, 2], S: [2, 3], W: [3, 0] } as const;

  // A door the picture shows stands on its wall; its `point` is where its opening meets the
  // ground in the picture, a step's height or more above the wall's foot line. The door's place
  // on the ground is the foot of its wall straight below that point, in the picture.
  it('comes out of the wall its door is on, with the door in its mouth', () => {
    const off: string[] = [];
    let doors = 0;
    for (const frame of FRAMES) {
      const ground = groundOf(frame)!;
      for (const scale of scales(frame))
        for (const road of [false, true]) {
          const { site: at, yard } = standing(frame, 12, 12, { scale, road: () => road });
          ground.doors.forEach((d, i) => {
            doors++;
            const [a, b] = WALL[d.side],
              [ax, ay] = ground.foot[a],
              [bx, by] = ground.foot[b],
              t = (d.point[0] - ax) / (bx - ax);
            // the door lies along its wall, between the wall's two corners
            expect(t, `${frame} door ${i}`).toBeGreaterThanOrEqual(0);
            expect(t, `${frame} door ${i}`).toBeLessThanOrEqual(1);
            // world px on the ground from the anchor, to map tiles (2:1, 64 x 32 px a tile)
            const sx = d.point[0] * scale,
              sy = (ay + (by - ay) * t) * scale,
              door = [at.x + sx / 64 + sy / 32, at.y + sy / 32 - sx / 64] as const,
              p = yard.paths[i],
              miss = toSegment(...door, p.x, p.y, p.x + p.dx * p.length, p.y + p.dy * p.length);
            if (miss > MOUTH)
              off.push(
                `${frame} at scale ${scale}${road ? ', a road next door' : ''}, door ${i} on ` +
                  `its ${d.side} wall at ${door.map((v) => v.toFixed(3))}: the path out of ` +
                  `${p.x.toFixed(3)}, ${p.y.toFixed(3)} passes ${miss.toFixed(3)} tile from it`,
              );
          });
        }
    }
    expect(doors).toBeGreaterThan(240);
    expect(off, `${off.length} door paths miss their door`).toEqual([]);
  });

  it("runs whole on to the middle of the road's tile where one is next door", () => {
    let paths = 0;
    for (const frame of FRAMES) {
      const ground = groundOf(frame)!;
      for (const scale of scales(frame)) {
        const { yard } = standing(frame, 12, 12, { scale, road: () => true }),
          painter = new BuildingYards(W, H, 7, -3, [yard]),
          kb = yard.kerb;
        ground.doors.forEach((d, i) => {
          const p = yard.paths[i];
          paths++;
          const where = `${frame} at ${scale}, door ${i}`;
          expect(p.open, where).toBe(true);
          // its end is on the road's tile, the one across the door's side, about its middle
          const ex = p.x + p.dx * p.length,
            ey = p.y + p.dy * p.length,
            rx = 12 + d.reach[0],
            ry = 12 + d.reach[1];
          expect([Math.round(ex), Math.round(ey)], where).toEqual([rx, ry]);
          expect(Math.abs((ex - rx) * p.dx + (ey - ry) * p.dy), where).toBeLessThan(0.1);
          for (let u = 0; u <= 1; u += 1 / 32) {
            const x = p.x + p.dx * p.length * u,
              y = p.y + p.dy * p.length * u;
            if (kb && (x - kb.x) * kb.dx + (y - kb.y) * kb.dy > kb.at - 0.1) break;
            expect(weigh(painter, x, y), `${where}, ${u} along it`).toBe(1);
          }
        });
      }
    }
    expect(paths).toBeGreaterThan(120);
  });
});

describe("a platform's kerb", () => {
  /** r + g + b of a colour. */
  const tone = (c: readonly number[]) => c[0] + c[1] + c[2];
  /** The colour painted over grass at `e` tiles past a yard's kerb line and `along` it. */
  function painted(yard: Yard, e: number, along: number) {
    const kb = yard.kerb!,
      painter = new BuildingYards(W, H, 0, 0, [yard]),
      x = kb.x + kb.dx * (kb.at + e) - kb.dy * along,
      y = kb.y + kb.dy * (kb.at + e) + kb.dx * along,
      ground = [110, 125, 69];
    weigh(painter, x, y);
    painter.paint(x, y, ground, 1, 0xffffff, SHEET, [0, 0, 0]);
    return ground;
  }

  // Its coping is the 0.05 tile just inside its line: stones with a darker joint between each two.
  // Slow: paints about 40 000 points along the 40 kerbs (about 0.3 s alone; the limit is 10 s).
  it('lays its coping in stones, a darker joint between each two', () => {
    let kerbs = 0;
    for (const frame of FRAMES.filter(hasKerb)) {
      const { yard } = standing(frame, 12, 12),
        kb = yard.kerb!;
      kerbs++;
      // the coping's tone along its middle, a thousandth of a tile apart, off its faded ends
      const tones: number[] = [];
      for (let along = kb.from + 0.1; along <= kb.to - 0.1; along += 0.001)
        tones.push(tone(painted(yard, -0.045, along)));
      const light = Math.max(...tones),
        joints: number[] = [];
      tones.forEach((t, i) => {
        if (t < light * 0.92 && !(i > 0 && tones[i - 1] < light * 0.92)) joints.push(i * 0.001);
      });
      const span = (tones.length - 1) * 0.001;
      expect(joints.length, `${frame}: joints along ${span} tile`).toBeGreaterThanOrEqual(
        Math.floor(span * 6),
      );
      for (let i = 1; i < joints.length; i++)
        expect(joints[i] - joints[i - 1], `${frame}: a stone between joints`).toBeGreaterThan(0.1);
    }
    expect(kerbs).toBeGreaterThanOrEqual(40);
  }, 10_000);

  // The light comes from the upper left: a kerb toward S turns its face to it, one toward E has
  // its face in its own shade, and one toward N or W shows none (the camera sees its back).
  it('shows a lit face toward S, a shaded one toward E, and none toward N or W', () => {
    /** Per side: the tone at the kerb's line over the platform's gravel, and over its coping. */
    const faces: Record<string, { gravel: number; coping: number }[]> = {
      S: [],
      E: [],
      N: [],
      W: [],
    };
    for (const frame of FRAMES.filter(hasKerb)) {
      const { ground, yard } = standing(frame, 12, 12),
        kb = yard.kerb!,
        side = ground.front.side;
      expect(kb.face, frame).toBe(side === 'S' || side === 'E');
      // along its middle half: the gravel behind it, its coping, and its face where there is one,
      // the 0.03 tile about its line
      let gravel = 0,
        coping = 0,
        face = 0;
      for (let n = 0; n < 40; n++) {
        const along = kb.from + ((kb.to - kb.from) * (n + 20)) / 80;
        gravel += tone(painted(yard, -0.2, along));
        coping += tone(painted(yard, -0.045, along));
        face += tone(painted(yard, -0.003, along));
      }
      faces[side].push({ gravel: face / gravel, coping: face / coping });
    }
    for (const side of ['S', 'E', 'N', 'W']) expect(faces[side].length, side).toBeGreaterThan(5);
    const lit = Math.min(...faces.S.map((f) => f.gravel));
    // toward S, a face brighter than the platform behind it, and not its coping
    expect(lit).toBeGreaterThan(1.05);
    for (const f of faces.S) expect(f.coping).toBeLessThan(0.95);
    // toward E, a face well darker than that
    for (const f of faces.E) expect(f.gravel).toBeLessThan(lit * 0.9);
    // toward N or W the coping runs on to the line: no face shows there
    for (const f of [...faces.N, ...faces.W]) expect(f.coping).toBeCloseTo(1, 1);
  });
});

describe("a yard's edge", () => {
  /** A building with no kerb at any scale, its noise at any origin, and points along its foot. */
  function rim(rng: Rng) {
    return {
      frame: rng.pick(FRAMES.filter((f) => !hasKerb(f))),
      scale: rng.range(0.6, 1.5),
      origin: [rng.int(-60, 60), rng.int(-60, 60)] as At,
      along: Array.from({ length: 160 }, () => rng.range(0.1, 0.9)),
    };
  }

  // A clean fade would weigh every point at its margin alike: half yard, half ground.
  it('breaks up where it meets the ground: at its margin some of it is whole and some gone', () => {
    let low = 0,
      high = 0,
      all = 0;
    forAll(
      rim,
      ({ frame, scale, origin, along }) => {
        const { yard } = standing(frame, 12, 12, { scale }),
          painter = new BuildingYards(W, H, origin[0], origin[1], [yard]),
          F = yard.foot,
          mx = (F[0] + F[2] + F[4] + F[6]) / 4,
          my = (F[1] + F[3] + F[5] + F[7]) / 4,
          weights: number[] = [];
        along.forEach((t, n) => {
          // out from a point of one of its foot's walls, square to the wall, by the margin
          const i = n % 4,
            j = (i + 1) % 4,
            ex = F[i * 2] + (F[j * 2] - F[i * 2]) * t,
            ey = F[i * 2 + 1] + (F[j * 2 + 1] - F[i * 2 + 1]) * t;
          let nx = F[j * 2 + 1] - F[i * 2 + 1],
            ny = F[i * 2] - F[j * 2];
          if ((ex - mx) * nx + (ey - my) * ny < 0) [nx, ny] = [-nx, -ny];
          const l = Math.hypot(nx, ny),
            x = ex + (nx / l) * yard.margin,
            y = ey + (ny / l) * yard.margin;
          // where that wall is the nearest of its foot, and off its door paths
          if (Math.abs(outside(F, x, y) - yard.margin) > 1e-6) return;
          const onPath = yard.paths.some(
            (p) => toSegment(x, y, p.x, p.y, p.x + p.dx * p.length, p.y + p.dy * p.length) < 0.25,
          );
          if (!onPath) weights.push(weigh(painter, x, y));
        });
        all += weights.length;
        low += weights.filter((w) => w < 0.25).length;
        high += weights.filter((w) => w > 0.75).length;
        // no yard's rim is even, as a clean fade's would be, or one that only breaks up
        expect(Math.max(...weights) - Math.min(...weights), frame).toBeGreaterThan(0.3);
      },
      { format: brief },
    );
    expect(all).toBeGreaterThan(10_000);
    expect(low / all, 'the share of the margin gone').toBeGreaterThan(0.1);
    expect(high / all, 'the share of the margin whole').toBeGreaterThan(0.05);
  });
});
