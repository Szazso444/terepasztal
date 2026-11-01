import { describe, it, expect, afterEach } from 'vitest';
import { TrackGraph, type TrackClass, type TrackPiece } from '../world/track';
import { findPath } from '../world/pathfinding';
import { Dir, DIR_DX, DIR_DY, opposite } from '../engine/iso';
import { content } from '../data/content';
import { classRank, lineToll, pieceClassFor } from './compat';
import { rules, DEFAULT_RULES } from './rules';
import { Traffic } from './traffic';
import { Train } from './trains';
import type { Builder } from './build';

const loco = (id: string) => content.locomotives.find((d) => d.id === id)!;

afterEach(() => {
  rules.smallOnBigLine = DEFAULT_RULES.smallOnBigLine;
});

describe('route cost by line size', () => {
  it('charges a smaller train 25 % per line size above its own, and nothing on its own line', () => {
    expect(lineToll('frigate', 'branch')).toBe(1);
    expect(lineToll('frigate', 'main')).toBe(1.25);
    expect(lineToll('frigate', 'trunk')).toBe(1.5);
    expect(lineToll('destroyer', 'main')).toBe(1);
    expect(lineToll('destroyer', 'trunk')).toBe(1.25);
    expect(lineToll('cruiser', 'trunk')).toBe(1);
    expect(lineToll('carrier', 'trunk')).toBe(1);
  });

  it('charges nothing off the standard network or for an empty consist', () => {
    expect(lineToll('corvette', 'narrow')).toBe(1);
    expect(lineToll('hydrofoil', 'maglev')).toBe(1);
    expect(lineToll('submarine', 'hyperloop')).toBe(1);
    expect(lineToll(null, 'trunk')).toBe(1);
  });

  it('follows the tuning', () => {
    rules.smallOnBigLine = 0.5;
    expect(lineToll('frigate', 'trunk')).toBe(2);
    rules.smallOnBigLine = 0;
    expect(lineToll('frigate', 'trunk')).toBe(1);
  });

  it("gives a train its class's toll", () => {
    const piece = (cls: TrackClass) =>
      ({ kind: 'straight', cls, links: [] }) as unknown as TrackPiece;
    const f7 = new Train([{ uid: 1, level: 0, def: loco('f7') }]);
    const sd40 = new Train([{ uid: 2, level: 0, def: loco('sd40') }]);
    expect(f7.trainClass).toBe('frigate');
    expect(sd40.trainClass).toBe('destroyer');
    expect(f7.tollOf(piece('main'), Dir.W)).toBe(1.25);
    expect(sd40.tollOf(piece('main'), Dir.W)).toBe(1);
    expect(sd40.tollOf(piece('trunk'), Dir.W)).toBe(1.25);
  });
});

/**
 * Two roads from a branch junction at (0, 1) to a target at (4, 1): east along row 1 on Main
 * Line (4 tiles of length 1), or north and round on Branch Line (6 tiles of length 0.7).
 */
function forkedRoutes() {
  const lines = new Map<
    string,
    { cls: TrackClass; len: number; exits: Partial<Record<Dir, Dir[]>> }
  >();
  const at = (
    x: number,
    y: number,
    cls: TrackClass,
    len: number,
    exits: Partial<Record<Dir, Dir[]>>,
  ) => lines.set(`${x},${y}`, { cls, len, exits });
  at(0, 1, 'branch', 1, { [Dir.W]: [Dir.E, Dir.N] });
  for (const x of [1, 2, 3]) at(x, 1, 'main', 1, { [Dir.W]: [Dir.E] });
  at(4, 1, 'main', 1, { [Dir.W]: [Dir.E], [Dir.N]: [Dir.E] });
  at(0, 0, 'branch', 0.7, { [Dir.S]: [Dir.E] });
  for (const x of [1, 2, 3]) at(x, 0, 'branch', 0.7, { [Dir.W]: [Dir.E] });
  at(4, 0, 'branch', 0.7, { [Dir.W]: [Dir.S] });
  const track = {
    w: 8,
    get: (x: number, y: number) => {
      const l = lines.get(`${x},${y}`);
      return l ? ({ kind: 'straight', cls: l.cls, links: [] } as unknown as TrackPiece) : undefined;
    },
    exits: (x: number, y: number, d: Dir) => lines.get(`${x},${y}`)?.exits[d] ?? [],
    connected: (x: number, y: number, out: Dir) =>
      !!lines.get(`${x + DIR_DX[out]},${y + DIR_DY[out]}`)?.exits[opposite(out)],
    segLength: (x: number, y: number) => lines.get(`${x},${y}`)!.len,
  } as unknown as TrackGraph;
  const route = (toll?: (p: TrackPiece, entry: Dir) => number) =>
    findPath(
      track,
      { x: 0, y: 1, in: Dir.W },
      (x, y) => x === 4 && y === 1,
      1000,
      undefined,
      undefined,
      toll,
    )!
      .map((s) => `${s.x},${s.y}`)
      .join(' ');
  return route;
}

describe('route choice by line size', () => {
  const viaMain = '0,1 1,1 2,1 3,1 4,1';
  const viaBranch = '0,1 0,0 1,0 2,0 3,0 4,0 4,1';
  it('keeps a Frigate on its Branch Line when Main Line is less than 25 % shorter', () => {
    const route = forkedRoutes();
    expect(route()).toBe(viaMain);
    expect(route((p, e) => lineToll('frigate', pieceClassFor(p, e)))).toBe(viaBranch);
  });
  it('lets a Destroyer take its Main Line', () => {
    const route = forkedRoutes();
    expect(route((p, e) => lineToll('destroyer', pieceClassFor(p, e)))).toBe(viaMain);
  });
});

/** A stand-in for a train moving east or west along row 5 on the path `xs`. */
function moving(id: number, xs: number[], occupied: number[], w: number, cls: string, speed = 0) {
  const east = xs.at(-1)! > xs[0];
  const path = xs.map((x, i) => ({
    x,
    y: 5,
    in: east ? Dir.W : Dir.E,
    out: east ? Dir.E : Dir.W,
    arc: i,
  }));
  return {
    id,
    name: `Train ${id}`,
    state: 'moving',
    poses: [{ x: xs[0], y: 5 }],
    holding: false,
    pathProgress: 0,
    length: 1,
    yieldCount: 0,
    weight: 10,
    trainClass: cls,
    stopDistance: (speed * speed) / 2.2,
    claimLimit: Infinity,
    claimBlocker: null,
    pathAhead: () => path,
    occupancyKeys: () => occupied.map((x) => 5 * w + x),
    resumeAfterLoad: () => {},
    cancelRetreat() {},
  } as unknown as Train;
}

/**
 * Row 5 from x = 1 to 14 with platforms at x = 4 and x = 10: a section 5..9 between them that
 * an eastbound train from x = 2 and a westbound one from x = 12 both want.
 */
function contested() {
  const g = new TrackGraph(24, 24);
  for (let x = 1; x <= 14; x++) g.place(x, 5, 'straight', 1, 'branch');
  const traffic = new Traffic(g, {
    stations: [
      {
        gateTiles: () => [
          { x: 4, y: 5 },
          { x: 10, y: 5 },
        ],
      },
    ],
  } as unknown as Builder);
  traffic.rebuildSections();
  return { g, traffic, key: (x: number) => 5 * g.w + x };
}
const EAST = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const WEST = [12, 11, 10, 9, 8, 7, 6, 5];

describe('priority at a contested section', () => {
  it('ranks the classes by the line they need', () => {
    expect(
      ['corvette', 'frigate', 'destroyer', 'cruiser', 'carrier'].map((c) => classRank(c as never)),
    ).toEqual([1, 1, 2, 3, 3]);
  });

  it('serves the bigger train first when both reach the section at once', () => {
    const { g, traffic, key } = contested();
    const frigate = moving(1, EAST, [2], g.w, 'frigate');
    const destroyer = moving(2, WEST, [12], g.w, 'destroyer');
    traffic.assign([frigate, destroyer], 0);
    expect(traffic.claims.get(key(7))).toBe(2);
    expect(frigate.claimBlocker).toBe(2);
    expect(frigate.claimLimit).toBe(3);
  });

  it('serves the lower id first between equal classes, as before', () => {
    const { g, traffic, key } = contested();
    const a = moving(1, EAST, [2], g.w, 'frigate');
    const b = moving(2, WEST, [12], g.w, 'frigate');
    traffic.assign([a, b], 0);
    expect(traffic.claims.get(key(7))).toBe(1);
    expect(b.claimBlocker).toBe(1);
  });

  it('takes over a stretch a smaller train claimed but can still stop short of', () => {
    const { g, traffic, key } = contested();
    const frigate = moving(1, EAST, [2], g.w, 'frigate', 1);
    const destroyer = moving(2, WEST, [12], g.w, 'destroyer');
    destroyer.state = 'waiting';
    traffic.assign([frigate, destroyer], 0);
    expect(traffic.claims.get(key(7))).toBe(1);
    destroyer.state = 'moving';
    traffic.assign([frigate, destroyer], 1);
    expect(traffic.claims.get(key(7))).toBe(2);
    expect(frigate.claimBlocker).toBe(2);
    // the frigate keeps what it can still use, up to the platform before the section
    expect(traffic.claims.get(key(4))).toBe(1);
    expect(frigate.claimLimit).toBe(3);
  });

  it('leaves the stretch to a smaller train that could not stop short of it', () => {
    const { g, traffic, key } = contested();
    const frigate = moving(1, EAST, [2], g.w, 'frigate', 3);
    const destroyer = moving(2, WEST, [12], g.w, 'destroyer');
    destroyer.state = 'waiting';
    traffic.assign([frigate, destroyer], 0);
    destroyer.state = 'moving';
    traffic.assign([frigate, destroyer], 1);
    expect(traffic.claims.get(key(7))).toBe(1);
    expect(destroyer.claimBlocker).toBe(1);
  });

  it('never takes a stretch from a train of the same or a bigger class', () => {
    for (const cls of ['destroyer', 'cruiser']) {
      const { g, traffic, key } = contested();
      const holder = moving(1, EAST, [2], g.w, cls);
      const destroyer = moving(2, WEST, [12], g.w, 'destroyer');
      destroyer.state = 'waiting';
      traffic.assign([holder, destroyer], 0);
      destroyer.state = 'moving';
      traffic.assign([holder, destroyer], 1);
      expect(traffic.claims.get(key(7)), cls).toBe(1);
    }
  });

  it('never takes a stretch a smaller train already stands on', () => {
    const { g, traffic, key } = contested();
    const frigate = moving(1, [6, 7, 8, 9, 10, 11], [6], g.w, 'frigate');
    const destroyer = moving(2, WEST, [12], g.w, 'destroyer');
    destroyer.state = 'waiting';
    traffic.assign([frigate, destroyer], 0);
    destroyer.state = 'moving';
    traffic.assign([frigate, destroyer], 1);
    expect(traffic.claims.get(key(7))).toBe(1);
    expect(destroyer.claimBlocker).toBe(1);
  });
});

describe('priority of a maintenance train at a contested section', () => {
  const onJob = (t: Train, tier: 0 | 1 | 2) => {
    t.maint = { ax: 20, ay: 5, tier, x: 20, y: 5 };
    return t;
  };

  it('serves one bound for an unusable piece before the biggest class', () => {
    const { g, traffic, key } = contested();
    const cruiser = moving(1, EAST, [2], g.w, 'cruiser');
    const worker = onJob(moving(2, WEST, [12], g.w, 'frigate'), 0);
    traffic.assign([cruiser, worker], 0);
    expect(traffic.claims.get(key(7))).toBe(2);
    expect(cruiser.claimBlocker).toBe(2);
  });

  it('takes the stretch of the biggest class for an unusable piece', () => {
    const { g, traffic, key } = contested();
    const cruiser = moving(1, EAST, [2], g.w, 'cruiser', 1);
    const worker = onJob(moving(2, WEST, [12], g.w, 'frigate'), 0);
    worker.state = 'waiting';
    traffic.assign([cruiser, worker], 0);
    expect(traffic.claims.get(key(7))).toBe(1);
    worker.state = 'moving';
    traffic.assign([cruiser, worker], 1);
    expect(traffic.claims.get(key(7))).toBe(2);
  });

  it('serves one bound for a degraded piece after the smallest class', () => {
    for (const tier of [1, 2] as const) {
      const { g, traffic, key } = contested();
      const worker = onJob(moving(1, EAST, [2], g.w, 'frigate'), tier);
      const corvette = moving(2, WEST, [12], g.w, 'corvette');
      traffic.assign([worker, corvette], 0);
      expect(traffic.claims.get(key(7))).toBe(2);
      expect(worker.claimBlocker).toBe(2);
    }
  });

  it('lets the smallest class take a stretch from one bound for a degraded piece', () => {
    const { g, traffic, key } = contested();
    const worker = onJob(moving(1, EAST, [2], g.w, 'frigate', 1), 1);
    const corvette = moving(2, WEST, [12], g.w, 'corvette');
    corvette.state = 'waiting';
    traffic.assign([worker, corvette], 0);
    expect(traffic.claims.get(key(7))).toBe(1);
    corvette.state = 'moving';
    traffic.assign([worker, corvette], 1);
    expect(traffic.claims.get(key(7))).toBe(2);
  });
});
