import { beforeEach, describe, expect, it } from 'vitest';
import { Dir } from '../engine/iso';
import { content } from '../data/content';
import { findPath } from '../world/pathfinding';
import { makePiece, pieceLinks, TrackGraph, type TrackKind } from '../world/track';
import { line, simWorld, type SimWorld } from '../testing/simWorld';
import { rules, DEFAULT_RULES } from './rules';
import { Station } from './stations';
import { Train, defaultStop, type StopPlan, type TickCtx } from './trains';
import { stateOf } from './wear';

beforeEach(() => Object.assign(rules, DEFAULT_RULES));

const ROW = 20;
const GDT = 0.05;
const CRAWL = () => rules.trackCrawlSpeed + 1e-9;

/** Fails the piece at (x, y) the way play does, and closes it to traffic. */
function fail(w: SimWorld, ...tiles: [number, number][]) {
  for (const [x, y] of tiles) {
    const p = w.track.get(x, y)!;
    p.wear.health = 1e-9;
    w.builder.wear.hit(x, y, p.links[0][0], 100);
    expect(stateOf(p)).toBe('unusable');
  }
  w.builder.wear.flush();
}
/** Mends the piece at (x, y). The Repair tool arrives later; a track edit tells the trains as it will. */
function repair(w: SimWorld, x: number, y: number) {
  w.track.get(x, y)!.wear.health = 1;
  w.track.version++;
}
/** A stop where the train calls and moves on at once. */
const call = (s: Station): StopPlan => ({ ...defaultStop(s.id), waitFull: false });

/** A quarry whose platform is the tile (x, ROW), and whose building stands north of it. */
function quarry(w: SimWorld, x: number) {
  const st = new Station('quarry', x, ROW - 1);
  w.builder.stations.push(st);
  return st;
}
/** `units` locos set off from head tile (x, y), entered through `entry`, bound for `stops`. */
function placed(
  w: SimWorld,
  x: number,
  y: number,
  entry: Dir,
  stops: Station | Station[],
  loco: string,
  units = 1,
) {
  const def = content.locomotives.find((d) => d.id === loco)!;
  const t = new Train(Array.from({ length: units }, (_, i) => ({ uid: i + 1, level: 0, def })));
  expect(t.spawnAt(w.track, x, y, entry)).toBe(true);
  t.schedule = [stops].flat().map(call);
  t.oil = t.oilCap;
  w.fleet.trains.push(t);
  expect(t.dispatch(w.track, w.builder, w.map)).toBe(true);
  t.onPathReady({ builder: w.builder });
  return t;
}
/** `units` F7s set off along ROW from head tile x, running west, bound for `stops`. */
function westbound(w: SimWorld, x: number, stops: Station[], units = 1) {
  return placed(w, x, ROW, Dir.E, stops, 'f7', units);
}
/**
 * A narrow line along ROW from x 4 to 40 with a loop south of it from a switch at x 20 to one at
 * x 30, and a narrow diesel running east from x 8 to a quarry at x 36.
 */
function loopLine() {
  const w = simWorld({ terrain: 'grass', size: 64 });
  const piece = (x: number, y: number, kind: TrackKind, a: Dir, b: Dir, c?: Dir) => {
    const rot = [...Array(8).keys()].find((r) => {
      const links = pieceLinks(kind, r);
      const has = (p: Dir, q: Dir) =>
        links.some(([m, n]) => (m === p && n === q) || (m === q && n === p));
      return has(a, b) && (c === undefined || has(a, c));
    })!;
    w.track.set(x, y, makePiece(kind, rot, 'narrow'));
  };
  for (let x = 4; x <= 40; x++) if (x !== 20 && x !== 30) piece(x, ROW, 'straight', Dir.E, Dir.W);
  piece(20, ROW, 'switch', Dir.W, Dir.E, Dir.S);
  piece(30, ROW, 'switch', Dir.E, Dir.W, Dir.S);
  for (const x of [20, 30])
    for (let y = ROW + 1; y < ROW + 3; y++) piece(x, y, 'straight', Dir.N, Dir.S);
  piece(20, ROW + 3, 'curve', Dir.N, Dir.E);
  piece(30, ROW + 3, 'curve', Dir.N, Dir.W);
  for (let x = 21; x < 30; x++) piece(x, ROW + 3, 'straight', Dir.E, Dir.W);
  const def = content.locomotives.find((d) => d.gauge === 'narrow' && d.type === 'diesel')!;
  const t = placed(w, 8, ROW, Dir.W, quarry(w, 36), def.id);
  return { w, t, c: clock(w) };
}
/** Steps the fleet as the game does. */
function clock(w: SimWorld) {
  let now = 0;
  const step = () => w.fleet.tick(GDT, (now += GDT));
  return {
    step,
    /** Steps until `done` holds, for at most `seconds`; `each` sees every step. */
    until(done: () => boolean, seconds: number, each?: () => void) {
      for (let i = 0; i < seconds / GDT && !done(); i++) {
        step();
        each?.();
      }
      return done();
    },
  };
}
const standsOnFailed = (w: SimWorld, t: Train) =>
  t.occupancyKeys(w.track.w).some((k) => w.builder.wear.unusable.has(k));
const headFailed = (w: SimWorld, t: Train) => {
  const head = t.headTile!;
  return stateOf(w.track.get(head.x, head.y)!) === 'unusable';
};

describe('a failed piece', () => {
  it('no train enters an unusable piece from sound track', () => {
    const w = simWorld({ terrain: 'grass', size: 64 });
    line(w, 4, ROW, 40);
    const st = quarry(w, 6);
    const t = westbound(w, 36, [st]);
    fail(w, [20, ROW]);
    const piece = w.track.get(20, ROW)!;
    expect(t.canUse(piece, Dir.E)).toBe(false);
    expect(t.canUse(w.track.get(21, ROW)!, Dir.E)).toBe(true);
    const ahead = t.headSeg!;
    const to = (x: number, y: number) => x === 6 && y === ROW;
    expect(findPath(w.track, ahead, to, 100000, undefined, t.canUse)).toBeNull();
    const c = clock(w);
    const reached = c.until(
      () => t.state === 'noRoute',
      60,
      () => expect(t.headTile!.x).toBeGreaterThan(20),
    );
    expect(reached).toBe(true);
    c.until(
      () => false,
      20,
      () => expect(t.headTile!.x).toBeGreaterThan(20),
    );
  });

  it('a train takes another way when there is one', () => {
    const { w, t, c } = loopLine();
    fail(w, [25, ROW]);
    let south = false;
    const arrived = c.until(
      () => t.state === 'loading',
      120,
      () => {
        south ||= t.headTile!.y === ROW + 3;
        expect(t.headTile).not.toEqual({ x: 25, y: ROW });
      },
    );
    expect(arrived).toBe(true);
    expect(south).toBe(true);
    expect(t.reversed).toBe(false);
  });

  it('a train with no other way waits in noRoute and leaves after the repair', () => {
    const w = simWorld({ terrain: 'grass', size: 64 });
    line(w, 4, ROW, 40);
    const st = quarry(w, 6);
    const t = westbound(w, 36, [st]);
    const c = clock(w);
    c.until(() => t.headTile!.x === 30, 30);
    fail(w, [20, ROW]);
    expect(c.until(() => t.state === 'noRoute', 60)).toBe(true);
    // it ran on as far as the last sound piece
    expect(t.headTile).toEqual({ x: 21, y: ROW });
    expect(t.speed).toBe(0);
    c.until(() => false, 30);
    expect(t.state).toBe('noRoute');
    expect(t.headTile).toEqual({ x: 21, y: ROW });
    repair(w, 20, ROW);
    expect(c.until(() => t.state === 'moving', 6)).toBe(true);
    expect(c.until(() => t.state === 'loading', 60)).toBe(true);
    expect(t.atStation).toBe(st);
  });

  it('a train on a failed piece crawls off and stops on sound track', () => {
    const w = simWorld({ terrain: 'grass', size: 64 });
    line(w, 4, ROW, 40);
    const st = quarry(w, 6);
    const t = westbound(w, 36, [st]);
    const c = clock(w);
    c.until(() => t.headTile!.x === 30, 30);
    fail(w, [30, ROW], [29, ROW]);
    let crawled = 0;
    const stopped = c.until(
      () => t.state === 'noRoute',
      60,
      () => {
        if (!standsOnFailed(w, t)) return;
        crawled += 1;
        expect(t.speed).toBeLessThanOrEqual(CRAWL());
      },
    );
    expect(stopped).toBe(true);
    expect(crawled).toBeGreaterThan(0);
    expect(t.headTile!.x).toBeLessThan(29);
    expect(headFailed(w, t)).toBe(false);
    expect(standsOnFailed(w, t)).toBe(false);
    // and from sound track it dispatches on, to its stop
    expect(c.until(() => t.state === 'loading', 60)).toBe(true);
  });

  it('a train keeps crawling until its last vehicle is off', () => {
    const w = simWorld({ terrain: 'grass', size: 64 });
    line(w, 4, ROW, 40);
    const st = quarry(w, 6);
    const t = westbound(w, 36, [st], 3);
    expect(t.length).toBeGreaterThan(2);
    const c = clock(w);
    c.until(() => t.headTile!.x === 30, 30);
    fail(w, [30, ROW]);
    let headOff = 0;
    const each = () => {
      if (!standsOnFailed(w, t)) return;
      expect(t.speed).toBeLessThanOrEqual(CRAWL());
      if (!headFailed(w, t)) headOff += 1;
    };
    expect(c.until(() => !standsOnFailed(w, t), 60, each)).toBe(true);
    // the head stood on sound track for as long as the tail took to clear the piece
    expect(headOff * GDT * rules.trackCrawlSpeed).toBeGreaterThan(t.length - 1);
    expect(t.state).toBe('moving');
  });

  it('a piece that fails under the tail slows the train without taking its way', () => {
    const w = simWorld({ terrain: 'grass', size: 64 });
    line(w, 4, ROW, 56);
    const st = quarry(w, 6);
    const t = westbound(w, 50, [st], 3);
    const c = clock(w);
    c.until(() => t.headTile!.x === 30, 30);
    const fast = t.speed;
    expect(fast).toBeGreaterThan(CRAWL());
    fail(w, [31, ROW]);
    expect(standsOnFailed(w, t)).toBe(true);
    c.step();
    // it brakes as for any lower limit: a train that plans again would stand for a moment
    expect(t.speed).toBeGreaterThan(fast / 2);
    expect(t.state).toBe('moving');
    expect(c.until(() => t.speed <= CRAWL(), 10)).toBe(true);
    expect(
      c.until(
        () => !standsOnFailed(w, t),
        60,
        () => expect(t.speed).toBeLessThanOrEqual(CRAWL()),
      ),
    ).toBe(true);
    expect(c.until(() => t.speed > CRAWL() * 2, 10)).toBe(true);
    expect(t.state).toBe('moving');
  });

  it('a failure elsewhere does not stop a train still crawling off', () => {
    const w = simWorld({ terrain: 'grass', size: 64 });
    line(w, 4, ROW, 40);
    const island = new Station('quarry', 50, 49);
    line(w, 46, 50, 54);
    w.builder.stations.push(island);
    const st = quarry(w, 6);
    const t = westbound(w, 36, [st], 3);
    const c = clock(w);
    c.until(() => t.headTile!.x === 30, 30);
    fail(w, [30, ROW]);
    c.until(() => !headFailed(w, t), 60);
    expect(standsOnFailed(w, t)).toBe(true);
    // nothing past here is on its way any more: it runs on to clear the piece all the same
    t.schedule = [call(island)];
    fail(w, [50, 50]);
    expect(c.until(() => t.state !== 'moving' || !standsOnFailed(w, t), 60)).toBe(true);
    expect(standsOnFailed(w, t)).toBe(false);
  });

  it('a train with no way on stops with its head on sound track, its tail where it is', () => {
    const w = simWorld({ terrain: 'grass', size: 64 });
    line(w, 4, ROW, 40);
    const st = quarry(w, 5);
    const t = westbound(w, 36, [st], 3);
    const c = clock(w);
    c.until(() => t.headTile!.x === 7, 30);
    fail(w, [7, ROW], [6, ROW]);
    expect(c.until(() => t.state === 'noRoute', 60)).toBe(true);
    expect(t.headTile).toEqual({ x: 4, y: ROW });
    expect(standsOnFailed(w, t)).toBe(true);
    // the end of the track holds it; it stands, and tries again
    c.until(() => false, 20);
    expect(t.state).toBe('noRoute');
    expect(t.headTile).toEqual({ x: 4, y: ROW });
  });

  it('a train stops short of a second failed piece past sound track', () => {
    const w = simWorld({ terrain: 'grass', size: 64 });
    line(w, 4, ROW, 40);
    const st = quarry(w, 6);
    const t = westbound(w, 36, [st]);
    const c = clock(w);
    c.until(() => t.headTile!.x === 30, 30);
    fail(w, [30, ROW], [28, ROW]);
    expect(c.until(() => t.state === 'noRoute', 60)).toBe(true);
    expect(t.headTile).toEqual({ x: 29, y: ROW });
  });

  it('leaveBroken refuses a head on sound track, and one with no sound tile ahead', () => {
    const w = simWorld({ terrain: 'grass', size: 64 });
    line(w, 4, ROW, 40);
    const t = westbound(w, 36, [quarry(w, 6)]);
    const c = clock(w);
    c.until(() => t.headTile!.x === 20, 30);
    const ctx = (w.fleet as unknown as { ctx(n: number, s: number): TickCtx }).ctx(0, 1);
    expect(t.leaveBroken(ctx)).toBe(false);
    // from x 20 west every piece failed
    for (let x = 4; x <= 20; x++) fail(w, [x, ROW]);
    expect(t.leaveBroken(ctx)).toBe(false);
  });

  it('a train on a failed multi-tile curve crawls off it the way it was going', () => {
    const w = simWorld({ terrain: 'grass', size: 48 });
    // from the east along y = 13, round a 4 x 4 Trunk curve, and north up x = 10 to the quarry
    for (let x = 14; x <= 40; x++) w.track.place(x, 13, 'straight', 1, 'trunk');
    for (let y = 3; y <= 9; y++) w.track.place(10, y, 'straight', 0, 'trunk');
    w.track.place(10, 10, 'curve', 0, 'trunk');
    const st = new Station('quarry', 10, 2);
    w.builder.stations.push(st);
    const t = placed(w, 38, 13, Dir.E, st, 'f7');
    const c = clock(w);
    const curve = w.track.get(10, 10)!;
    c.until(() => w.track.get(t.headTile!.x, t.headTile!.y)?.wear === curve.wear, 60);
    fail(w, [10, 10]);
    const each = () => {
      if (standsOnFailed(w, t)) expect(t.speed).toBeLessThanOrEqual(CRAWL());
    };
    expect(c.until(() => !standsOnFailed(w, t), 120, each)).toBe(true);
    expect(c.until(() => t.state === 'loading', 120)).toBe(true);
    expect(t.atStation).toBe(st);
  });

  it('on a failed switch a train keeps to the way its path goes', () => {
    const { w, t, c } = loopLine();
    fail(w, [25, ROW]);
    // its path leaves the switch south; straight on, the sound tile leads to the failed one
    expect(c.until(() => t.headTile!.x === 20 && t.headTile!.y === ROW, 60)).toBe(true);
    fail(w, [20, ROW]);
    expect(c.until(() => t.headTile!.y === ROW + 1, 60)).toBe(true);
    expect(c.until(() => t.state === 'loading', 120)).toBe(true);
  });

  it('a queue at a break waits in noRoute, no train stuck, and all leave after the repair', () => {
    const w = simWorld({ terrain: 'grass', size: 64 });
    line(w, 4, ROW, 60);
    const st = quarry(w, 6);
    const queue = [36, 44, 52].map((x) => westbound(w, x, [st]));
    const c = clock(w);
    fail(w, [24, ROW]);
    c.until(() => false, 120);
    for (const t of queue) expect(t.state).toBe('noRoute');
    expect(queue[0].headTile).toEqual({ x: 25, y: ROW });
    expect(w.fleet.traffic.stuckTrains(0)).toEqual([]);
    expect(w.fleet.traffic.counters.deadlocks).toBe(0);
    repair(w, 24, ROW);
    const past = new Set<number>();
    const each = () => {
      for (const t of queue) if (t.headTile!.x < 24) past.add(t.id);
    };
    expect(c.until(() => past.size === queue.length, 180, each)).toBe(true);
  });

  /**
   * `units` F7s loading at x 16 and bound on for x 6, once the piece under their tail and the piece
   * at `cut` on their way have failed: at rest in noRoute after running off.
   */
  function tailOnFailed(cut: number, units = 3) {
    const w = simWorld({ terrain: 'grass', size: 64 });
    line(w, 4, ROW, 40);
    const here = quarry(w, 16);
    const next = quarry(w, 6);
    const t = westbound(w, 36, [here, next], units);
    const c = clock(w);
    expect(c.until(() => t.state === 'loading', 60)).toBe(true);
    fail(w, [17, ROW], [cut, ROW]);
    expect(c.until(() => t.state === 'moving', 120)).toBe(true);
    const crawl = () => {
      if (standsOnFailed(w, t)) expect(t.speed).toBeLessThanOrEqual(CRAWL());
    };
    expect(c.until(() => t.state === 'noRoute', 60, crawl)).toBe(true);
    return { w, t, c, next };
  }

  it('a train with only its tail on a failed piece runs clear when sound track lies ahead', () => {
    const { w, t, c, next } = tailOnFailed(8, 2);
    expect(standsOnFailed(w, t)).toBe(false);
    expect(t.headTile!.x).toBeGreaterThan(8);
    repair(w, 8, ROW);
    expect(c.until(() => t.atStation === next, 60)).toBe(true);
  });

  it('a train too long for the sound track ahead runs on as far as it can and stands', () => {
    const { w, t, c, next } = tailOnFailed(10);
    expect(t.headTile).toEqual({ x: 11, y: ROW });
    expect(standsOnFailed(w, t)).toBe(true);
    c.until(
      () => false,
      30,
      () => {
        expect(t.state).toBe('noRoute');
        expect(t.headTile).toEqual({ x: 11, y: ROW });
      },
    );
    repair(w, 10, ROW);
    expect(c.until(() => t.atStation === next, 60)).toBe(true);
  });

  it('a train in noRoute takes its tail off a failed piece that fails under it', () => {
    const w = simWorld({ terrain: 'grass', size: 64 });
    line(w, 4, ROW, 40);
    const t = westbound(w, 36, [quarry(w, 6)], 3);
    const c = clock(w);
    fail(w, [20, ROW]);
    expect(c.until(() => t.state === 'noRoute', 60)).toBe(true);
    expect(t.headTile).toEqual({ x: 21, y: ROW });
    // the way opens as far as x 11, and the piece under the tail goes
    repair(w, 20, ROW);
    fail(w, [10, ROW], [23, ROW]);
    expect(standsOnFailed(w, t)).toBe(true);
    expect(c.until(() => !standsOnFailed(w, t), 120)).toBe(true);
    expect(c.until(() => t.state === 'noRoute', 60)).toBe(true);
    expect(t.headTile!.x).toBeGreaterThan(10);
  });

  it('with no room ahead a train with its tail on a failed piece stands still', () => {
    const w = simWorld({ terrain: 'grass', size: 64 });
    line(w, 4, ROW, 40);
    const here = quarry(w, 16);
    const t = westbound(w, 36, [here, quarry(w, 6)], 3);
    const c = clock(w);
    expect(c.until(() => t.state === 'loading', 60)).toBe(true);
    fail(w, [17, ROW], [15, ROW]);
    expect(c.until(() => t.state === 'noRoute', 120)).toBe(true);
    const head = t.headTile;
    c.until(
      () => false,
      30,
      () => {
        expect(t.state).toBe('noRoute');
        expect(t.headTile).toEqual(head);
      },
    );
  });

  it('a train on a failed piece behind a train standing on its way waits for room', () => {
    const w = simWorld({ terrain: 'grass', size: 64 });
    line(w, 4, ROW, 60);
    const st = quarry(w, 6);
    const lead = westbound(w, 36, [st]);
    const next = westbound(w, 41, [st]);
    const c = clock(w);
    fail(w, [24, ROW]);
    expect(c.until(() => lead.state === 'noRoute' && lead.speed === 0, 60)).toBe(true);
    expect(c.until(() => next.state === 'noRoute', 60)).toBe(true);
    const x = next.headTile!.x;
    fail(w, [x, ROW]);
    // the train ahead leaves it no room to run off: it stands, and does not go to and fro
    c.until(
      () => false,
      30,
      () => {
        expect(next.state).toBe('noRoute');
        expect(next.headTile!.x).toBe(x);
      },
    );
    expect(w.fleet.traffic.stuckTrains(0)).toEqual([]);
    repair(w, 24, ROW);
    expect(c.until(() => next.headTile!.x < x, 60)).toBe(true);
  });

  it('a train loading on a platform whose other tile fails finishes and leaves', () => {
    const w = simWorld({ terrain: 'grass', size: 64 });
    line(w, 4, ROW, 40);
    const here = quarry(w, 16);
    const next = quarry(w, 6);
    const t = westbound(w, 36, [here, next], 3);
    const c = clock(w);
    expect(c.until(() => t.state === 'loading', 60)).toBe(true);
    expect(t.atStation).toBe(here);
    fail(w, [17, ROW]);
    expect(standsOnFailed(w, t)).toBe(true);
    c.step();
    expect(t.state).toBe('loading');
    expect(
      c.until(
        () => t.state === 'moving',
        120,
        () => expect(t.state).toBe(t.atStation ? 'loading' : 'moving'),
      ),
    ).toBe(true);
    expect(
      c.until(
        () => !standsOnFailed(w, t),
        60,
        () => expect(t.speed).toBeLessThanOrEqual(CRAWL()),
      ),
    ).toBe(true);
    expect(c.until(() => t.atStation === next, 60)).toBe(true);
  });

  it('a train at a platform whose failed piece has no way on finishes and crawls off', () => {
    const w = simWorld({ terrain: 'grass', size: 64 });
    line(w, 4, ROW, 40);
    const here = quarry(w, 16);
    const next = quarry(w, 6);
    const t = westbound(w, 36, [here, next]);
    const c = clock(w);
    expect(c.until(() => t.state === 'loading', 60)).toBe(true);
    fail(w, [16, ROW], [15, ROW]);
    expect(c.until(() => t.state !== 'loading', 120)).toBe(true);
    expect(t.state).toBe('moving');
    expect(c.until(() => !headFailed(w, t), 60)).toBe(true);
    expect(c.until(() => t.atStation === next, 60)).toBe(true);
  });
});

describe('the unusable set', () => {
  it('a batch of failures in one tick raises track.version once', () => {
    const w = simWorld({ terrain: 'grass', size: 96 });
    line(w, 4, ROW, 80);
    for (let x = 10; x < 60; x++) w.track.get(x, ROW)!.wear.health = 1e-9;
    const wear = w.builder.wear;
    const before = w.track.version;
    wear.daily();
    expect(w.track.version).toBe(before);
    wear.flush();
    expect(w.track.version).toBe(before + 1);
    expect(wear.unusable.size).toBe(50);
    wear.flush();
    expect(w.track.version).toBe(before + 1);
    // the fleet flushes at the end of its tick
    w.track.get(70, ROW)!.wear.health = 1e-9;
    wear.daily();
    w.fleet.tick(GDT, GDT);
    expect(w.track.version).toBe(before + 2);
  });

  it('a state change that closes nothing leaves the version alone', () => {
    const w = simWorld({ terrain: 'grass', size: 32 });
    line(w, 4, ROW, 10);
    w.track.get(5, ROW)!.wear.health = rules.trackDegradedAt + 1e-6;
    const seen: { x: number; y: number }[][] = [];
    w.builder.wear.onChange = (tiles) => seen.push(tiles);
    const before = w.track.version;
    w.builder.wear.daily();
    w.builder.wear.flush();
    expect(w.track.version).toBe(before);
    expect(seen).toEqual([[{ x: 5, y: ROW }]]);
  });

  it('holds every tile of a multi-tile piece, and tells onChange of them all', () => {
    const w = simWorld({ terrain: 'grass', size: 32 });
    const tiles = w.track.place(10, 10, 'curve', 0, 'trunk');
    const wear = w.builder.wear;
    const seen: { x: number; y: number }[][] = [];
    wear.onChange = (t) => seen.push(t);
    w.track.get(10, 10)!.wear.health = 1e-9;
    wear.daily();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(tiles.length);
    expect(wear.unusable.size).toBe(tiles.length);
    for (const t of tiles) expect(wear.unusable.has(w.track.key(t.x, t.y))).toBe(true);
  });

  it('forgets a failed piece taken up, or replaced by a new one', () => {
    const w = simWorld({ terrain: 'grass', size: 32 });
    line(w, 4, ROW, 10);
    fail(w, [5, ROW], [6, ROW]);
    expect(w.builder.wear.unusable.size).toBe(2);
    w.track.removeAt(5, ROW);
    w.track.place(6, ROW, 'straight', 1, 'branch');
    expect(w.builder.wear.unusable.size).toBe(0);
  });

  it('finds a failed piece in a loaded track', () => {
    const w = simWorld({ terrain: 'grass', size: 32 });
    const saved = new TrackGraph(32, 32);
    saved.place(5, ROW, 'straight', 1, 'branch');
    saved.get(5, ROW)!.wear.health = 0;
    for (const tuple of saved.tuples()) w.track.placeTuple(tuple);
    expect(w.builder.wear.unusable.has(w.track.key(5, ROW))).toBe(true);
  });

  it('a train in a loaded game crawls off a failed piece', () => {
    const w = simWorld({ terrain: 'grass', size: 64 });
    line(w, 4, ROW, 40);
    const st = quarry(w, 6);
    const t = westbound(w, 36, [st]);
    const c = clock(w);
    c.until(() => t.headTile!.x === 30, 30);
    fail(w, [30, ROW], [29, ROW]);
    const loaded = Train.fromJSON(JSON.parse(JSON.stringify(t.toJSON())), w.track);
    w.fleet.trains[0] = loaded;
    expect(c.until(() => !headFailed(w, loaded), 60)).toBe(true);
    expect(c.until(() => loaded.state === 'loading', 60)).toBe(true);
  });
});
