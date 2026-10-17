/**
 * Walkers on roads (#477): the drawn position of a walker on a road tile follows the road's centre
 * line (roadShape.ts), and everywhere else, and in the simulation, nothing moves.
 */
import { describe, expect, it } from 'vitest';
import { Container, Rectangle, Texture, TextureSource } from 'pixi.js';
import type { AtlasRegistry, FrameInfo } from '../engine/atlas';
import { DIRS, DIR_DX, DIR_DY, tileToWorld } from '../engine/iso';
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
import {
  EDGE_RAMP,
  FOLLOW_GONE,
  ROAD_SIDE,
  RoadWalk,
  TURN_DISTANCE,
  roadWalks,
  turn,
  type Heading,
} from './roadWalk';
import { walkerDepth } from './walkerGround';

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
  // slow because 40 seeds walk every pair of arms of every piece in 0.025-tile steps: 0.78 s alone,
  // so a limit of 30 s
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
  }, 30_000);

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

  // slow because every seeded walk is drawn through the renderer in 0.004-tile steps, over 100 000
  // steps in all: 6.1 s alone, so a limit of 120 s
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
  }, 120_000);

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

// ------------------------------------------------------------------ added by Verification (#477)

/** A network the test can edit under a long-lived RoadWalk: roads laid and lifted, the origin moved. */
function editable() {
  const roads = new Set<number>();
  const at = { ox: 0, oy: 0 };
  const hasRoad = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < W && y < H && roads.has(y * W + x);
  const code = (x: number, y: number) =>
    hasRoad(x, y) ? roadCode(roadSides(hasRoad, [], x, y), 0) : -1;
  const map = () => ({ w: W, h: H, originX: at.ox, originY: at.oy });
  return { roads, at, walk: new RoadWalk(map, code), fresh: () => new RoadWalk(map, code) };
}

describe('a walker along a whole road network', () => {
  // slow because every seeded road network is walked in 40 steps along each of up to 12 legs: 2.8 s
  // alone, so a limit of 60 s
  it('stays within the road along every road a walk follows, tile to tile', () => {
    let samples = 0,
      outside = 0,
      worst = 0;
    forAll(
      (rng) => {
        // a connected set of road tiles grown from one tile, and a walk along it
        const roads = new Set<number>([key(rng.int(2, 6), rng.int(2, 6))]);
        for (let i = 0; i < rng.int(4, 24); i++) {
          const at = rng.pick([...roads]),
            d = rng.pick([...DIRS]),
            x = (at % W) + DIR_DX[d],
            y = Math.floor(at / W) + DIR_DY[d];
          if (x >= 0 && y >= 0 && x < W && y < H) roads.add(key(x, y));
        }
        const start = rng.pick([...roads]),
          way = [[start % W, Math.floor(start / W)]];
        for (let i = 0; i < 12; i++) {
          const [x, y] = way[way.length - 1],
            to = DIRS.map((d) => [x + DIR_DX[d], y + DIR_DY[d]]).filter(([nx, ny]) =>
              roads.has(key(nx, ny)),
            );
          if (to.length) way.push(rng.pick(to));
        }
        return { roads: [...roads], way, ox: rng.int(-40, 40), oy: rng.int(-40, 40) };
      },
      ({ roads, way, ox, oy }) => {
        const { walk, distance } = network(new Set(roads), ox, oy),
          face: Heading = { hx: 0, hy: 0 };
        let [x, y] = way[0];
        for (let leg = 1; leg < way.length; leg++) {
          const [x1, y1] = way[leg],
            x0 = x,
            y0 = y,
            n = 40;
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
      },
    );
    expect(samples).toBeGreaterThan(3000);
    expect(outside / samples).toBeLessThan(0.001);
    expect(worst).toBeLessThan(ROAD_HALF + 0.03);
  }, 60_000);

  // slow because 100 seeds of 30 edits and 12 probes each are set against a fresh build: 0.52 s alone,
  // so a limit of 30 s
  it('is the same on a walk that has seen roads laid, lifted and moved as on one built after', () => {
    // the cache of a tile's centre line must follow its code and its place in the world
    forAll(
      (rng) => ({
        edits: Array.from({ length: 30 }, () => ({
          kind: rng.pick(['lay', 'lift', 'lay', 'move'] as const),
          x: rng.int(0, W - 1),
          y: rng.int(0, H - 1),
          d: rng.int(-20, 20),
        })),
        probes: Array.from({ length: 12 }, () => ({
          x: rng.range(-0.5, W - 0.5001),
          y: rng.range(-0.5, H - 0.5001),
          a: rng.range(0, 2 * Math.PI),
        })),
      }),
      ({ edits, probes }) => {
        const net = editable();
        for (const e of edits) {
          if (e.kind === 'lay') net.roads.add(key(e.x, e.y));
          else if (e.kind === 'lift') net.roads.delete(key(e.x, e.y));
          else {
            net.at.ox = e.d;
            net.at.oy = -e.d;
          }
          // the long-lived walk is asked after every edit, so its cache is full of stale lines
          const reference = net.fresh();
          for (const p of probes) {
            const got = net.walk.place(p.x, p.y, Math.cos(p.a), Math.sin(p.a)),
              want = reference.place(p.x, p.y, Math.cos(p.a), Math.sin(p.a));
            expect([got.x, got.y]).toEqual([want.x, want.y]);
          }
        }
      },
    );
  }, 30_000);

  it('gives the same answer every time it is asked, whatever `out` held', () => {
    forAll(
      (rng) => {
        const roads = new Set<number>();
        for (let i = 0; i < 25; i++) roads.add(key(rng.int(1, 7), rng.int(1, 7)));
        return {
          roads: [...roads],
          x: rng.range(0.5, 7.5),
          y: rng.range(0.5, 7.5),
          a: rng.range(0, 2 * Math.PI),
          k: rng.pick([0, 0.4, 1]),
        };
      },
      ({ roads, x, y, a, k }) => {
        const { walk } = network(new Set(roads), 5, -9),
          hx = Math.cos(a) * k,
          hy = Math.sin(a) * k,
          first = { ...walk.place(x, y, hx, hy) },
          dirty = { x: 123, y: -456 },
          back = walk.place(x, y, hx, hy, dirty);
        expect(back).toBe(dirty);
        expect([dirty.x, dirty.y]).toEqual([first.x, first.y]);
      },
    );
  });

  it("moves a lone road tile's walker by the side offset alone, scaled by how far it has set off", () => {
    // a lone tile's centre line is the tile middle: at the middle there is nothing to pull
    forAll(
      (rng) => ({
        a: rng.range(0, 2 * Math.PI),
        k: rng.range(0.05, 1),
        ox: rng.int(-50, 50),
        oy: rng.int(-50, 50),
      }),
      ({ a, k, ox, oy }) => {
        const { walk } = network(new Set([key(4, 4)]), ox, oy),
          hx = Math.cos(a) * k,
          hy = Math.sin(a) * k,
          at = walk.place(4, 4, hx, hy),
          dx = at.x - 4,
          dy = at.y - 4;
        // it is ROAD_SIDE x k to the right of the way it faces, whichever way that is
        expect(Math.hypot(dx, dy)).toBeCloseTo(ROAD_SIDE * k, 9);
        expect(dx * hx + dy * hy).toBeCloseTo(0, 9);
        expect(hx * dy - hy * dx).toBeCloseTo(ROAD_SIDE * k * k, 9);
        // and one that has not moved is not moved aside
        const still = walk.place(4, 4, 0, 0);
        expect([still.x, still.y]).toEqual([4, 4]);
      },
    );
  });
});

describe("turning a walker's heading", () => {
  const start = (rng: Rng): Heading => {
    const a = rng.range(0, 2 * Math.PI),
      k = rng.pick([0, 0.3, 1]);
    return { hx: Math.cos(a) * k, hy: Math.sin(a) * k };
  };

  it('keeps a heading inside the unit disc and leaves it be when nothing has moved', () => {
    forAll(
      (rng) => ({
        h: start(rng),
        moves: Array.from({ length: 40 }, () => {
          const a = rng.range(0, 2 * Math.PI),
            d = rng.pick([0, 1e-12, 0.001, 0.02, 0.2, 3]);
          return [Math.cos(a) * d, Math.sin(a) * d];
        }),
      }),
      ({ h, moves }) => {
        for (const [dx, dy] of moves) {
          const before = { ...h };
          turn(h, dx, dy);
          if (Math.hypot(dx, dy) <= 1e-9) expect(h).toEqual(before);
          expect(Math.hypot(h.hx, h.hy)).toBeLessThanOrEqual(1 + 1e-12);
        }
      },
    );
  });

  it('depends on the distance walked, not on how many steps it was walked in', () => {
    forAll(
      (rng) => ({ h: start(rng), a: rng.range(0, 2 * Math.PI), d: rng.range(0.01, 0.5) }),
      ({ h, a, d }) => {
        const one = { ...h },
          many = { ...h },
          dx = Math.cos(a) * d,
          dy = Math.sin(a) * d;
        turn(one, dx, dy);
        for (let i = 0; i < 10; i++) turn(many, dx / 10, dy / 10);
        // ten short steps in one direction land where one long step does
        expect(many.hx).toBeCloseTo(one.hx, 9);
        expect(many.hy).toBeCloseTo(one.hy, 9);
      },
    );
  });

  it('turns most of the way over TURN_DISTANCE and the whole way in the end', () => {
    forAll(
      (rng) => ({ a: rng.range(0, 2 * Math.PI), b: rng.range(0, 2 * Math.PI) }),
      ({ a, b }) => {
        // facing a, then walking along b: after TURN_DISTANCE the way is 1 - 1/e of the way round
        const h = { hx: Math.cos(a), hy: Math.sin(a) },
          gap = Math.cos(b) - Math.cos(a);
        turn(h, Math.cos(b) * TURN_DISTANCE, Math.sin(b) * TURN_DISTANCE);
        if (Math.abs(gap) > 0.1)
          expect((h.hx - Math.cos(a)) / gap).toBeCloseTo(1 - Math.exp(-1), 9);
        for (let i = 0; i < 100; i++) turn(h, Math.cos(b) * 0.05, Math.sin(b) * 0.05);
        expect(h.hx).toBeCloseTo(Math.cos(b), 6);
        expect(h.hy).toBeCloseTo(Math.sin(b), 6);
      },
    );
  });
});

describe('the people renderer on roads, beyond what it moves', () => {
  const sim = (p: Person) => ({ map: emptyMap(1, W, H), persons: [p] }) as unknown as PeopleSim;
  // (+ 0 turns a negative zero into a zero)
  const spot = (layer: Container) => [
    layer.children[0].position.x + 0,
    layer.children[0].position.y + 0,
  ];
  /** An L of road whose turn is the tile (4, 4): the pull to the centre line there is a few pixels. */
  const ell = () => network(new Set([key(4, 4), key(5, 4), key(4, 5)]), 7, -3);

  // slow because 100 seeds of up to 175 frames each go through the renderer: 0.62 s alone, so a limit
  // of 30 s
  it('draws a walker, its depth and its ground at the place the road walk gives', () => {
    // the oracle: the road walk run by hand, on the heading worked from the walker's displacements
    forAll(
      (rng) => {
        const roads = new Set<number>();
        for (let i = 0; i < 20; i++) roads.add(key(rng.int(1, 7), rng.int(1, 7)));
        const way = [[rng.int(1, 7), rng.int(1, 7)]];
        for (let i = 0; i < 6; i++) {
          const [x, y] = way[way.length - 1],
            d = rng.pick([...DIRS]);
          if (x + DIR_DX[d] >= 0 && y + DIR_DY[d] >= 0 && x + DIR_DX[d] < W && y + DIR_DY[d] < H)
            way.push([x + DIR_DX[d], y + DIR_DY[d]]);
        }
        return { roads: [...roads], way, ox: rng.int(-30, 30), oy: rng.int(-30, 30) };
      },
      ({ roads, way, ox, oy }) => {
        const { walk } = network(new Set(roads), ox, oy),
          layer = new Container(),
          ground = (x: number, y: number) => 3 * x - 2 * y,
          drawer = new PeopleRenderer(ATLAS, layer, ground, walk),
          p = person(way[0][0], way[0][1]),
          face = { hx: 0, hy: 0 };
        let [lx, ly] = way[0];
        for (let leg = 0; leg < way.length; leg++) {
          const [x0, y0] = way[Math.max(0, leg - 1)],
            [x1, y1] = way[leg];
          for (let i = 1; i <= 25; i++) {
            p.x = x0 + ((x1 - x0) * i) / 25;
            p.y = y0 + ((y1 - y0) * i) / 25;
            const s = sim(p);
            drawer.update(s, 1 / 60);
            // the first frame a walker is seen it faces no way
            if (leg > 0 || i > 1) turn(face, p.x - lx, p.y - ly);
            [lx, ly] = [p.x, p.y];
            const at = walk.place(p.x, p.y, face.hx, face.hy),
              w = tileToWorld(at.x, at.y);
            expect(spot(layer)).toEqual([
              Math.round(w.x) + 0,
              Math.round(w.y + ground(at.x, at.y)) + 0,
            ]);
            expect(layer.children[0].zIndex).toBe(walkerDepth(s.map, at.x, at.y));
          }
        }
      },
    );
  }, 30_000);

  it('finds the road walk registered for its layer when it is given none, and only for that layer', () => {
    const { walk } = ell(),
      registered = new Container(),
      other = new Container(),
      given = new Container(),
      bare = new Container();
    roadWalks.set(registered, walk);
    const drawers: [Container, PeopleRenderer][] = [
      [registered, new PeopleRenderer(ATLAS, registered, () => 0)],
      [other, new PeopleRenderer(ATLAS, other, () => 0)],
      [given, new PeopleRenderer(ATLAS, given, () => 0, walk)],
      [bare, new PeopleRenderer(ATLAS, bare, () => 0)],
    ];
    for (const [, drawer] of drawers) {
      const p = person(3.9, 4);
      drawer.update(sim(p), 0);
      p.x = 4;
      drawer.update(sim(p), 0);
    }
    expect(spot(registered)).toEqual(spot(given));
    expect(spot(other)).toEqual(spot(bare));
    // and the road walk made a difference to see
    expect(spot(given)).not.toEqual(spot(bare));
  });

  it('forgets which way a walker faced once it has been out of sight', () => {
    const { walk } = ell(),
      used = new Container(),
      fresh = new Container(),
      a = new PeopleRenderer(ATLAS, used, () => 0, walk),
      b = new PeopleRenderer(ATLAS, fresh, () => 0, walk);
    a.update(sim(person(3.8, 4)), 0);
    a.update(sim(person(3.9, 4)), 0);
    // indoors for a frame, then out again a little on
    a.update(sim(person(3.95, 4, 'inside')), 0);
    a.update(sim(person(4, 4)), 0);
    b.update(sim(person(4, 4)), 0);
    expect(spot(used)).toEqual(spot(fresh));
  });

  it('draws a walker put somewhere new where it is, not dragged round from where it was', () => {
    const { walk } = network(
        new Set([key(1, 1), key(2, 1), key(6, 6), key(7, 6), key(6, 7)]),
        0,
        0,
      ),
      a = new Container(),
      b = new Container(),
      moving = new PeopleRenderer(ATLAS, a, () => 0, walk),
      newcomer = new PeopleRenderer(ATLAS, b, () => 0, walk);
    moving.update(sim(person(1.8, 1)), 0);
    moving.update(sim(person(1.9, 1)), 0);
    moving.update(sim(person(6, 6)), 0);
    newcomer.update(sim(person(6, 6)), 0);
    expect(spot(a)).toEqual(spot(b));
  });
});

describe('where a road runs into the town paving', () => {
  // No road is painted on the paving, so a road tile whose side leads into it has a centre line
  // that runs to the edge and stops there: the move must be nothing at that edge, or a walker
  // stepping onto the paving pops.
  const inside = 1e-6;
  const HEADINGS = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [0.7, 0.7],
    [-0.7, 0.7],
    [0.3, 0],
  ];

  /** Roads and paving: the road codes see the paving as a neighbour, the road walk draws none on it. */
  function paved(roads: ReadonlySet<number>, paving: ReadonlySet<number>, ox: number, oy: number) {
    const seen = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < W && y < H && (roads.has(y * W + x) || paving.has(y * W + x));
    const code = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < W && y < H && roads.has(y * W + x)
        ? roadCode(roadSides(seen, [], x, y), 0)
        : -1;
    return new RoadWalk(() => ({ w: W, h: H, originX: ox, originY: oy }), code);
  }

  it('is not moved at the edge of a road tile that leads onto it', () => {
    let checked = 0,
      reached = 0;
    forAll(
      (rng) => {
        const roads = new Set<number>(),
          paving = new Set<number>();
        for (let i = 0; i < rng.int(1, 10); i++)
          roads.add(key(rng.int(1, W - 2), rng.int(1, H - 2)));
        for (let i = 0; i < rng.int(1, 4); i++) {
          const at = rng.pick([...roads]),
            d = rng.pick([...DIRS]),
            n = key((at % W) + DIR_DX[d], Math.floor(at / W) + DIR_DY[d]);
          if (!roads.has(n)) paving.add(n);
        }
        return {
          roads: [...roads],
          paving: [...paving],
          ox: rng.int(-30, 30),
          oy: rng.int(-30, 30),
        };
      },
      ({ roads, paving, ox, oy }) => {
        const walk = paved(new Set(roads), new Set(paving), ox, oy);
        for (const r of roads) {
          const tx = r % W,
            ty = Math.floor(r / W);
          for (const d of DIRS) {
            if (!paving.includes(key(tx + DIR_DX[d], ty + DIR_DY[d]))) continue;
            for (const t of [-0.3, -0.15, 0, 0.15, 0.3]) {
              // the point of the tile at the edge on side d, `t` along it
              const x = tx + (DIR_DX[d] ? DIR_DX[d] * (0.5 - inside) : t),
                y = ty + (DIR_DY[d] ? DIR_DY[d] * (0.5 - inside) : t);
              for (const [hx, hy] of HEADINGS) {
                const at = walk.place(x, y, hx, hy);
                expect(
                  Math.hypot(at.x - x, at.y - y),
                  `${x},${y} heading ${hx},${hy}`,
                ).toBeLessThan(1e-3);
                checked++;
              }
              // and it is moved a little way in from the edge, where the road line is, so the
              // check above is not met by a walk that never moves anything
              const bx = x - DIR_DX[d] * 0.3,
                by = y - DIR_DY[d] * 0.3,
                inward = walk.place(bx, by, 0.7, 0.7);
              if (Math.hypot(inward.x - bx, inward.y - by) > 0.01) reached++;
            }
          }
        }
      },
    );
    expect(checked).toBeGreaterThan(1000);
    expect(reached).toBeGreaterThan(100);
  });
});

describe('a walker setting out from anywhere in a tile', () => {
  /** A walker on a road network, walking a straight line from (x0, y0) to (tx, ty) at a steady heading. */
  interface Setout {
    roads: number[];
    ox: number;
    oy: number;
    x0: number;
    y0: number;
    tx: number;
    ty: number;
  }
  const STEP = 0.004;
  /** The biggest change in how far the walker is drawn from where it is, in pixels, between two steps. */
  function worstPop(c: Setout) {
    const { walk } = network(new Set(c.roads), c.ox, c.oy),
      len = Math.hypot(c.tx - c.x0, c.ty - c.y0),
      hx = (c.tx - c.x0) / len,
      hy = (c.ty - c.y0) / len,
      n = Math.floor(len / STEP);
    let px = 0,
      py = 0,
      worst = 0,
      where = '';
    for (let i = 0; i <= n; i++) {
      const x = c.x0 + hx * STEP * i,
        y = c.y0 + hy * STEP * i,
        at = walk.place(x, y, hx, hy),
        drawn = tileToWorld(at.x, at.y),
        sim = tileToWorld(x, y),
        dx = drawn.x - sim.x,
        dy = drawn.y - sim.y;
      if (i > 0) {
        const jump = Math.max(Math.abs(dx - px), Math.abs(dy - py));
        if (jump > worst) {
          worst = jump;
          where = `${x},${y}`;
        }
      }
      px = dx;
      py = dy;
    }
    return { worst, where };
  }

  // slow because 100 seeds of up to 350 steps each are drawn through the renderer: 0.29 s alone, so a
  // limit of 30 s
  it('is drawn without a pop of more than a pixel between 0.004-tile steps, on the road or off it', () => {
    // Walkers set out from a door's front (up to 0.4 tile off a tile's middle) toward the middle of
    // the tile beside or across a corner, and are at a steady heading once they are under way.
    let steps = 0;
    forAll(
      (rng): Setout => {
        const roads = new Set<number>();
        for (let r = 0; r < 4; r++) {
          let x = rng.int(1, W - 2),
            y = rng.int(1, H - 2);
          for (let i = 0; i < 8; i++) {
            roads.add(key(x, y));
            if (rng.chance(0.5)) x = Math.max(0, Math.min(W - 1, x + rng.pick([-1, 1])));
            else y = Math.max(0, Math.min(H - 1, y + rng.pick([-1, 1])));
          }
        }
        const x0 = rng.range(0.6, W - 1.6),
          y0 = rng.range(0.6, H - 1.6),
          d = rng.pick([...DIRS]),
          diag = rng.chance(0.3);
        return {
          roads: [...roads],
          ox: rng.int(-30, 30),
          oy: rng.int(-30, 30),
          x0,
          y0,
          tx: Math.round(x0) + (diag ? rng.pick([-1, 1]) : DIR_DX[d]),
          ty: Math.round(y0) + (diag ? rng.pick([-1, 1]) : DIR_DY[d]),
        };
      },
      (c) => {
        steps += Math.floor(Math.hypot(c.tx - c.x0, c.ty - c.y0) / STEP);
        const { worst, where } = worstPop(c);
        expect(worst, `a ${worst.toFixed(2)} px pop at ${where}`).toBeLessThanOrEqual(1);
      },
      {
        // fewer roads first, then the walk shortened to the tile centre it heads for
        shrink: function* (c) {
          for (let i = 0; i < c.roads.length; i++)
            yield { ...c, roads: c.roads.filter((_, j) => j !== i) };
          yield { ...c, ox: 0, oy: 0 };
        },
        format: (c) => JSON.stringify(c),
      },
    );
    expect(steps).toBeGreaterThan(10_000);
  }, 30_000);

  it('is drawn without a pop where the tile it leaves has fewer strokes than the one it enters', () => {
    // An end piece beside a turn (three primitives of one line) and beside a tee (two lines): the
    // strokes the end piece lacks must not pull the walker on one side of their shared edge.
    for (const roads of [
      [44, 53, 52],
      [44, 53, 62, 52],
    ]) {
      const c: Setout = {
        roads,
        ox: 16,
        oy: -12,
        x0: 7.255085933115334,
        y0: 4.773050808813423,
        tx: 8,
        ty: 5,
      };
      const { worst, where } = worstPop(c);
      expect(worst, `a ${worst.toFixed(2)} px pop at ${where}`).toBeLessThanOrEqual(1);
    }
  });

  it('is drawn without a pop in the cases the default seeds miss (seeds 577 to 2846 of the setting-out property)', () => {
    // The smallest failing case of each seed in 1 to 3000 that the 100 default seeds do not reach:
    // a straight pair of road tiles ([57, 58], [31, 22]), an L of three, a U of four. Each is a walk
    // along or across the edge of road tiles with different strokes, none a tee or a cross.
    const cases: Setout[] = [
      {
        roads: [58, 57, 66, 67],
        ox: -7,
        oy: -10,
        x0: 3.4413987684063616,
        y0: 6.27988854907453,
        tx: 4,
        ty: 6,
      },
      {
        roads: [64, 73, 72, 63],
        ox: 11,
        oy: -23,
        x0: 1.1211179006844758,
        y0: 7.369477455411107,
        tx: 0,
        ty: 8,
      },
      {
        roads: [57, 58],
        ox: 10,
        oy: 1,
        x0: 3.2672690398059787,
        y0: 5.737952897045761,
        tx: 4,
        ty: 6,
      },
      { roads: [31, 22], ox: 0, oy: 0, x0: 4.002468342799694, y0: 2.563243911601603, tx: 5, ty: 4 },
      {
        roads: [19, 10, 9],
        ox: -1,
        oy: 4,
        x0: 0.6530653115361928,
        y0: 1.4489269059151413,
        tx: 0,
        ty: 1,
      },
      {
        roads: [38, 29, 30],
        ox: -10,
        oy: -12,
        x0: 2.7284072755835953,
        y0: 2.9445528332144026,
        tx: 2,
        ty: 4,
      },
      {
        roads: [46, 37, 38],
        ox: 0,
        oy: 0,
        x0: 1.7331354040652514,
        y0: 5.415239459555596,
        tx: 1,
        ty: 4,
      },
      {
        roads: [67, 66, 57],
        ox: 9,
        oy: 27,
        x0: 3.5602301165461543,
        y0: 7.138918268959969,
        tx: 3,
        ty: 6,
      },
    ];
    const popped = cases
      .map((c) => ({ c, ...worstPop(c) }))
      .filter((r) => r.worst > 1)
      .map((r) => `${JSON.stringify(r.c)}: ${r.worst.toFixed(2)} px at ${r.where}`);
    expect(popped).toEqual([]);
  });
});
