import { describe, expect, it } from 'vitest';
import { groundFrames, groundOf, type FrameGround } from '../art/buildingGround';
import { PAL } from '../art/palette';
import { DIR_DX, DIR_DY, Dir } from '../engine/iso';
import { forAll } from '../testing/property';
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

  // Slow: reads about a thousand points round each of 100 buildings (about two seconds alone).
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
  });

  // Slow: as above.
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
  });

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
