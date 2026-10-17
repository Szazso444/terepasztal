/**
 * Walkers on roads (#477): the drawn position of a walker on a road tile follows the road's centre
 * line (roadShape.ts), and everywhere else, and in the simulation, nothing moves.
 */
import { describe, expect, it } from 'vitest';
import { Container, Rectangle, Texture, TextureSource } from 'pixi.js';
import type { AtlasRegistry, FrameInfo } from '../engine/atlas';
import { DIRS, DIR_DX, DIR_DY } from '../engine/iso';
import type { Rng } from '../engine/rng';
import type { PeopleSim, Person } from '../sim/people';
import { forAll, SEEDS } from '../testing/property';
import { emptyMap } from '../world/mapgen';
import { PeopleRenderer } from './peopleRenderer';
import {
  ROAD_HALF,
  ROAD_REACH,
  roadCode,
  roadShape,
  roadSides,
  shapeDistance,
  type RoadShape,
} from './roadShape';
import { EDGE_RAMP, FOLLOW_GONE, ROAD_SIDE, RoadWalk, turn } from './roadWalk';

const W = 9,
  H = 9;

/** A road network on a W x H map at world origin (ox, oy): its codes, as the painter is handed. */
function network(roads: ReadonlySet<number>, ox: number, oy: number) {
  const hasRoad = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < W && y < H && roads.has(y * W + x);
  const code = (x: number, y: number) =>
    hasRoad(x, y) ? roadCode(roadSides(hasRoad, [], x, y), 0) : -1;
  const walk = new RoadWalk(
    () => ({ w: W, h: H, originX: ox, originY: oy }),
    (x, y) => code(x, y),
  );
  /** The distance from tile point (x, y) to the nearest centre line of the tile and its neighbours. */
  const distance = (x: number, y: number) => {
    const tx = Math.round(x),
      ty = Math.round(y);
    let best = Infinity;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const c = code(tx + dx, ty + dy);
        if (c < 0) continue;
        const shape: RoadShape = roadShape(c, tx + dx + ox, ty + dy + oy);
        best = Math.min(best, shapeDistance(shape, x - tx - dx, y - ty - dy));
      }
    return best;
  };
  return { hasRoad, code, walk, distance };
}

const key = (x: number, y: number) => y * W + x;

describe('a walker on a road piece', () => {
  it('stays within the road along every leg of every piece and turn, whichever way it goes', () => {
    let samples = 0,
      outside = 0,
      worst = 0;
    forAll(
      (rng) => ({
        // the piece in the middle: any of the 15 sets of sides but none
        sides: rng.int(1, 15),
        ox: rng.int(-40, 40),
        oy: rng.int(-40, 40),
      }),
      ({ sides, ox, oy }) => {
        const roads = new Set([key(4, 4)]);
        for (const d of DIRS) if (sides & (1 << d)) roads.add(key(4 + DIR_DX[d], 4 + DIR_DY[d]));
        const { walk, distance } = network(roads, ox, oy);
        const arms = DIRS.filter((d) => sides & (1 << d));
        for (const a of arms)
          for (const b of arms) {
            // in from the neighbour on side a, already facing in, through the middle, out to the
            // neighbour on side b (back along a, if b is a), as the renderer turns it
            const face = { hx: -DIR_DX[a], hy: -DIR_DY[a] },
              path = [
                [4 + DIR_DX[a], 4 + DIR_DY[a]],
                [4, 4],
                [4 + DIR_DX[b], 4 + DIR_DY[b]],
              ];
            let [x, y] = path[0];
            for (let leg = 1; leg < path.length; leg++) {
              const [x0, y0] = [x, y],
                [x1, y1] = path[leg],
                n = Math.round(Math.hypot(x1 - x0, y1 - y0) / 0.025);
              for (let i = 1; i <= n; i++) {
                const nx = x0 + ((x1 - x0) * i) / n,
                  ny = y0 + ((y1 - y0) * i) / n;
                turn(face, nx - x, ny - y);
                [x, y] = [nx, ny];
                const at = walk.place(x, y, face.hx, face.hy),
                  d = distance(at.x, at.y);
                worst = Math.max(worst, d);
                samples++;
                if (d > ROAD_HALF) outside++;
                expect(d, `${x},${y} drawn ${at.x},${at.y}`).toBeLessThanOrEqual(ROAD_REACH);
              }
            }
          }
      },
      { seeds: SEEDS.slice(0, 40), format: (c) => JSON.stringify(c) },
    );
    expect(samples).toBeGreaterThan(10_000);
    // it is brought to the centre line, not merely kept in the road: at the middle of a sharp
    // turn, where the path turns at a stroke and it has not yet turned, it can stray a hair past
    // the road's half width, and nowhere else
    expect(outside / samples).toBeLessThan(0.001);
    expect(worst).toBeLessThan(ROAD_HALF + 0.03);
  }, 60_000);

  it('keeps its place along the road: it moves only across the way it faces', () => {
    forAll(
      (rng) => {
        const roads = new Set<number>();
        for (let i = 0; i < 30; i++) roads.add(key(rng.int(2, 6), rng.int(2, 6)));
        const angle = rng.range(0, 2 * Math.PI);
        return {
          roads: [...roads],
          x: rng.range(1.5, 7.5),
          y: rng.range(1.5, 7.5),
          hx: Math.cos(angle),
          hy: Math.sin(angle),
          ox: rng.int(-30, 30),
        };
      },
      ({ roads, x, y, hx, hy, ox }) => {
        const { walk } = network(new Set(roads), ox, -ox);
        const at = walk.place(x, y, hx, hy);
        expect((at.x - x) * hx + (at.y - y) * hy).toBeCloseTo(0, 9);
      },
    );
  });

  it('keeps to the right of the line as it faces, whichever way it faces', () => {
    // a straight along x: the centre line runs from edge to edge, the right of +x is +y
    const roads = new Set([key(3, 4), key(4, 4), key(5, 4)]);
    forAll(
      (rng) => ({ ox: rng.int(-50, 50), oy: rng.int(-50, 50) }),
      ({ ox, oy }) => {
        const { walk } = network(roads, ox, oy);
        const line = walk.place(4, 4, 1, 0),
          other = walk.place(4, 4, -1, 0);
        // both are on the line's two sides, the same 2 x SIDE apart, +y of it going toward +x
        expect(line.x).toBeCloseTo(4, 9);
        expect(other.x).toBeCloseTo(4, 9);
        expect(line.y - other.y).toBeCloseTo(2 * ROAD_SIDE, 9);
      },
    );
  });
});

describe('a walker off the road', () => {
  it('is drawn where the simulation has it on any tile without a road', () => {
    forAll(
      (rng) => {
        const roads = new Set<number>();
        for (let i = 0; i < rng.int(0, 40); i++)
          roads.add(key(rng.int(0, W - 1), rng.int(0, H - 1)));
        const angle = rng.range(0, 2 * Math.PI);
        return {
          roads: [...roads],
          x: rng.range(-0.5, W - 0.5001),
          y: rng.range(-0.5, H - 0.5001),
          hx: Math.cos(angle) * rng.pick([0, 0.5, 1]),
          hy: Math.sin(angle) * rng.pick([0, 0.5, 1]),
          ox: rng.int(-30, 30),
        };
      },
      ({ roads, x, y, hx, hy, ox }) => {
        const net = network(new Set(roads), ox, ox + 3),
          tx = Math.round(x),
          ty = Math.round(y);
        if (net.hasRoad(tx, ty)) return;
        const at = net.walk.place(x, y, hx, hy);
        expect([at.x, at.y]).toEqual([x, y]);
      },
    );
  });

  it('is drawn where the simulation has it on the road a tile is crossed by', () => {
    // across a straight along x, from one side of the road to the other
    const { walk } = network(new Set([key(3, 4), key(4, 4), key(5, 4)]), 0, 0);
    for (let i = 0; i <= 100; i++) {
      const y = 3.6 + (0.8 * i) / 100,
        at = walk.place(4, y, 0, 1);
      // facing +y, across the line: it keeps its place across the road, and moves only along it
      expect(at.y).toBeCloseTo(y, 9);
      expect(Math.abs(at.x - 4)).toBeLessThan(0.15);
    }
  });

  it('is not moved at all more than FOLLOW_GONE from the centre line', () => {
    const { walk, distance } = network(new Set([key(4, 4)]), 3, 5);
    for (let i = 0; i < 200; i++) {
      const x = 3.5 + (i % 20) / 20,
        y = 3.5 + Math.floor(i / 20) / 10;
      if (distance(x, y) < FOLLOW_GONE + 0.01) continue;
      const at = walk.place(x, y, 1, 0);
      expect([at.x, at.y]).toEqual([x, y]);
    }
  });

  it('is drawn where the simulation has it at the edge of a road tile with no road beside it', () => {
    // a lone end of road: its far edges are the edges of a tile with no road on the other side
    const roads = new Set([key(3, 4), key(4, 4)]);
    const { walk } = network(roads, 11, -7);
    for (const [x, y, hx, hy] of [
      [4.5, 4, 1, 0],
      [4, 3.5, 0, -1],
      [4, 4.5, 0, 1],
    ]) {
      const at = walk.place(x, y, hx, hy);
      expect([at.x, at.y]).toEqual([x, y]);
    }
    // and eases into the road over EDGE_RAMP from there
    const near = walk.place(4.5 - EDGE_RAMP / 2, 4, 1, 0),
      far = walk.place(4.5 - EDGE_RAMP, 4, 1, 0);
    expect(Math.abs(near.y - 4)).toBeLessThanOrEqual(Math.abs(far.y - 4) + 1e-9);
  });

  it('is drawn where the simulation has it on a tile the town paving covers', () => {
    const walk = new RoadWalk(
      () => ({ w: W, h: H, originX: 0, originY: 0 }),
      () => -1,
    );
    const at = walk.place(4.1, 3.9, 1, 0);
    expect([at.x, at.y]).toEqual([4.1, 3.9]);
  });
});

// ------------------------------------------------------------------ the renderer

const SOURCE = new TextureSource({ width: 64, height: 64 });
const FRAME: FrameInfo = {
  image: undefined as never,
  texture: new Texture({
    source: SOURCE,
    frame: new Rectangle(0, 0, 6, 12),
    orig: new Rectangle(0, 0, 6, 12),
  }),
  anchorX: 0.5,
  anchorY: 11 / 12,
  w: 6,
  h: 12,
};
const ATLAS = { has: () => true, get: () => FRAME } as unknown as AtlasRegistry;

function person(x: number, y: number, state: Person['state'] = 'walk'): Person {
  return {
    id: 1,
    x,
    y,
    home: 'house',
    outfit: 0,
    profession: 'passenger',
    carrying: false,
    state,
    timer: 0,
    path: [],
    step: 0,
    transient: false,
    stationId: null,
  };
}

describe('the people renderer on roads', () => {
  /** A random road network, and a walk of tile centres through it, on and off the road. */
  function walkOver(rng: Rng) {
    const roads = new Set<number>();
    // a few random runs of road
    for (let r = 0; r < 4; r++) {
      let x = rng.int(1, W - 2),
        y = rng.int(1, H - 2);
      for (let i = 0; i < 8; i++) {
        roads.add(key(x, y));
        if (rng.chance(0.5)) x = Math.max(0, Math.min(W - 1, x + rng.pick([-1, 1])));
        else y = Math.max(0, Math.min(H - 1, y + rng.pick([-1, 1])));
      }
    }
    // the walk: along the road where it can, a step off it or a diagonal now and then
    const at = [...roads][rng.int(0, roads.size - 1)];
    let x = at % W,
      y = Math.floor(at / W);
    const way = [[x, y]];
    for (let i = 0; i < 14; i++) {
      const dir = rng.chance(0.7) ? rng.pick([...DIRS]) : -1;
      const [nx, ny] =
        dir >= 0
          ? [x + DIR_DX[dir], y + DIR_DY[dir]]
          : [x + rng.pick([-1, 1]), y + rng.pick([-1, 1])];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      way.push([nx, ny]);
      x = nx;
      y = ny;
    }
    return { roads: [...roads], way, ox: rng.int(-30, 30), oy: rng.int(-30, 30) };
  }

  it('moves a walker along its way at most a pixel a short step, on the road and off it', () => {
    let steps = 0;
    forAll(walkOver, ({ roads, way, ox, oy }) => {
      const { walk } = network(new Set(roads), ox, oy),
        layer = new Container(),
        drawer = new PeopleRenderer(ATLAS, layer, () => 0, walk),
        p = person(way[0][0], way[0][1]),
        sim = { map: emptyMap(1, W, H), persons: [p] } as unknown as PeopleSim;
      let last: { x: number; y: number } | undefined;
      for (let leg = 1; leg < way.length; leg++) {
        const [x0, y0] = way[leg - 1],
          [x1, y1] = way[leg],
          n = Math.round(Math.hypot(x1 - x0, y1 - y0) / 0.004);
        for (let i = 0; i <= n; i++) {
          p.x = x0 + ((x1 - x0) * i) / n;
          p.y = y0 + ((y1 - y0) * i) / n;
          drawer.update(sim, 1 / 60);
          const at = layer.children[0].position;
          if (last)
            expect(
              Math.max(Math.abs(at.x - last.x), Math.abs(at.y - last.y)),
              `leg ${leg} (${x0},${y0}) to (${x1},${y1}) at ${p.x},${p.y}`,
            ).toBeLessThanOrEqual(1);
          last = { x: at.x, y: at.y };
          steps++;
        }
      }
    });
    expect(steps).toBeGreaterThan(100_000);
  }, 60_000);

  it('never changes where the simulation has a walker', () => {
    forAll(walkOver, ({ roads, way, ox, oy }) => {
      const { walk } = network(new Set(roads), ox, oy),
        drawer = new PeopleRenderer(ATLAS, new Container(), () => 0, walk),
        p = person(way[0][0], way[0][1]),
        sim = { map: emptyMap(1, W, H), persons: [p] } as unknown as PeopleSim;
      for (const [x, y] of way) {
        p.x = x;
        p.y = y;
        const before = JSON.stringify(p);
        drawer.update(sim, 1 / 60);
        expect(JSON.stringify(p)).toBe(before);
      }
    });
  });

  it('draws a walker at the tile middle off the road as it always has, with a road walk at hand', () => {
    const { walk } = network(new Set([key(1, 1)]), 0, 0);
    for (const [x, y] of [
      [5, 5],
      [6.2, 3.1],
    ]) {
      const layer = new Container();
      new PeopleRenderer(ATLAS, layer, () => 0, walk).update(
        { map: emptyMap(1, W, H), persons: [person(x, y)] } as unknown as PeopleSim,
        0,
      );
      const bare = new Container();
      new PeopleRenderer(ATLAS, bare, () => 0).update(
        { map: emptyMap(1, W, H), persons: [person(x, y)] } as unknown as PeopleSim,
        0,
      );
      expect([layer.children[0].position.x, layer.children[0].position.y]).toEqual([
        bare.children[0].position.x,
        bare.children[0].position.y,
      ]);
    }
  });
});
