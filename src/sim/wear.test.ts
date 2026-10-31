import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Dir } from '../engine/iso';
import { TrackGraph, makePiece, type TrackClass } from '../world/track';
import { simWorld, type SimWorld } from '../testing/simWorld';
import { content } from '../data/content';
import { rules, DEFAULT_RULES, daySeconds } from './rules';
import { SimStep } from './step';
import { Station } from './stations';
import { Train, type TickCtx } from './trains';
import { TrackWear, lineWearMul, maxHp, stateOf, wearsAtAll } from './wear';

describe('health on a piece', () => {
  it('starts full, one wear object for each piece', () => {
    const g = new TrackGraph(20, 20);
    g.place(2, 2, 'straight', 1, 'branch');
    g.place(3, 2, 'straight', 1, 'branch');
    expect(g.get(2, 2)!.wear).toEqual({ health: 1 });
    expect(g.get(2, 2)!.wear).not.toBe(g.get(3, 2)!.wear);
    expect(makePiece('curve', 0, 'narrow').wear).toEqual({ health: 1 });
  });

  it('every tile of a multi-tile piece shares one wear', () => {
    const g = new TrackGraph(20, 20);
    const tiles = g.place(5, 5, 'curve', 0, 'main');
    expect(tiles.length).toBeGreaterThan(1);
    const first = g.get(tiles[0].x, tiles[0].y)!.wear;
    for (const t of tiles) expect(g.get(t.x, t.y)!.wear).toBe(first);
  });

  it('a crossing has one wear and takes max HP from its bigger line', () => {
    const g = new TrackGraph(20, 20);
    g.place(5, 5, 'crossing', 0, 'branch', 'trunk');
    expect(maxHp(g.get(5, 5)!)).toBe(3500);
    g.place(7, 5, 'crossing', 0, 'trunk', 'branch');
    expect(maxHp(g.get(7, 5)!)).toBe(3500);
    g.place(9, 5, 'crossing', 0, 'narrow', 'branch');
    expect(maxHp(g.get(9, 5)!)).toBe(1000);
  });

  it('gives each line its HP and wear multiplier from the rules', () => {
    const hp: [TrackClass, number][] = [
      ['narrow', 600],
      ['branch', 1000],
      ['main', 2000],
      ['trunk', 3500],
    ];
    for (const [cls, n] of hp) expect(maxHp(makePiece('straight', 0, cls)), cls).toBe(n);
    expect(lineWearMul('narrow')).toBe(1);
    expect(lineWearMul('branch')).toBe(1);
    expect(lineWearMul('main')).toBe(1.3);
    expect(lineWearMul('trunk')).toBe(1.6);
  });

  it('states follow the thresholds', () => {
    const p = makePiece('straight', 0, 'branch');
    p.wear.health = 0.31;
    expect(stateOf(p)).toBe('healthy');
    p.wear.health = 0.29;
    expect(stateOf(p)).toBe('degraded');
    p.wear.health = 0;
    expect(stateOf(p)).toBe('unusable');
    p.wear.health = 1;
    expect(stateOf(p)).toBe('healthy');
  });

  it('reads the degraded share from the rules', () => {
    const was = rules.trackDegradedAt;
    try {
      const p = makePiece('straight', 0, 'branch');
      p.wear.health = 0.4;
      expect(stateOf(p)).toBe('healthy');
      rules.trackDegradedAt = 0.5;
      expect(stateOf(p)).toBe('degraded');
    } finally {
      rules.trackDegradedAt = was;
    }
  });

  it('Maglev and Hyperloop do not wear', () => {
    expect(wearsAtAll(makePiece('straight', 0, 'maglev'))).toBe(false);
    expect(wearsAtAll(makePiece('straight', 0, 'hyperloop'))).toBe(false);
    expect(wearsAtAll(makePiece('straight', 0, 'narrow'))).toBe(true);
    expect(wearsAtAll(makePiece('straight', 0, 'trunk'))).toBe(true);
    // either axis of a crossing counts
    expect(wearsAtAll(makePiece('crossing', 0, 'branch', 'maglev'))).toBe(false);
    expect(wearsAtAll(makePiece('crossing', 0, 'hyperloop', 'branch'))).toBe(false);
    expect(wearsAtAll(makePiece('crossing', 0, 'branch', 'trunk'))).toBe(true);
  });

  it('a worn switch stays worn when its form changes', () => {
    const g = new TrackGraph(20, 20);
    g.place(4, 4, 'switch', 1, 'branch');
    expect(g.get(4, 4)!.form ?? 'turn').toBe('turn');
    g.get(4, 4)!.wear.health = 0.5;
    // lay track past the S exit, so the switch re-forms
    const e = g.switchExit(4, 4, 1, 'branch', 'parallel');
    g.place(e.x, e.y, 'straight', e.out === Dir.N || e.out === Dir.S ? 0 : 1, 'branch');
    const changed = g.refreshSwitchForms([e]);
    expect(changed.length).toBe(4);
    expect(g.get(4, 4)!.form).toBe('parallel');
    const wear = g.get(4, 4)!.wear;
    expect(wear.health).toBe(0.5);
    for (const t of g.unitTiles(4, 4)) expect(g.get(t.x, t.y)!.wear).toBe(wear);
  });
});

describe('health in the stored track', () => {
  it('writes health only below 1, and keeps a crossing with no second line in place', () => {
    const g = new TrackGraph(30, 30);
    g.place(2, 2, 'straight', 1, 'branch');
    g.place(5, 5, 'curve', 0, 'main');
    g.place(12, 8, 'crossing', 0, 'branch', 'branch');
    g.get(5, 5)!.wear.health = 0.5;
    g.get(12, 8)!.wear.health = 0.25;
    const tuples = g.tuples();
    expect(tuples).toHaveLength(3);
    expect(tuples.find((t) => t[0] === 2)).toEqual([2, 2, 'straight', 1, 'branch', undefined]);
    expect(tuples.find((t) => t[0] === 5)).toEqual([5, 5, 'curve', 0, 'main', null, 0.5]);
    expect(tuples.find((t) => t[0] === 12)).toEqual([
      12,
      8,
      'crossing',
      0,
      'branch',
      'branch',
      0.25,
    ]);
  });

  it('rounds health to four places and writes none for a piece that rounds to full', () => {
    const g = new TrackGraph(20, 20);
    g.place(2, 2, 'straight', 1, 'branch');
    g.place(4, 2, 'straight', 1, 'branch');
    g.get(2, 2)!.wear.health = 0.123456;
    g.get(4, 2)!.wear.health = 0.99999;
    const tuples = g.tuples();
    expect(tuples.find((t) => t[0] === 2)![6]).toBe(0.1235);
    expect(tuples.find((t) => t[0] === 4)).toHaveLength(6);
  });

  it('places a piece with the health it was saved with, through JSON', () => {
    const a = new TrackGraph(30, 30);
    a.place(5, 5, 'curve', 0, 'main');
    a.place(12, 8, 'crossing', 0, 'branch', 'branch');
    a.get(5, 5)!.wear.health = 0.5;
    a.get(12, 8)!.wear.health = 0.25;
    const stored = JSON.parse(JSON.stringify(a.tuples())) as ReturnType<TrackGraph['tuples']>;
    const b = new TrackGraph(30, 30);
    for (const t of stored) b.placeTuple(t);
    expect(b.get(5, 5)!.wear.health).toBe(0.5);
    expect(b.get(12, 8)!.wear.health).toBe(0.25);
    expect(b.get(12, 8)!.cls2).toBe('branch');
    // the whole curve shares the one value
    const curve = b.unitTiles(5, 5);
    expect(curve.length).toBeGreaterThan(1);
    for (const t of curve) expect(b.get(t.x, t.y)!.wear).toBe(b.get(5, 5)!.wear);
  });

  it('reads a damaged health as the nearest sound one, and a missing one as full', () => {
    const g = new TrackGraph(20, 20);
    g.placeTuple([2, 2, 'straight', 1, 'branch', null, -3]);
    g.placeTuple([4, 2, 'straight', 1, 'branch', null, 7]);
    g.placeTuple([6, 2, 'straight', 1, 'branch', null, Number.NaN]);
    g.placeTuple([8, 2, 'straight', 1, 'branch']);
    expect(g.get(2, 2)!.wear.health).toBe(0);
    expect(g.get(4, 2)!.wear.health).toBe(1);
    expect(g.get(6, 2)!.wear.health).toBe(1);
    expect(g.get(8, 2)!.wear.health).toBe(1);
  });

  it('keeps a worn switch worn when the load re-forms it', () => {
    const a = new TrackGraph(20, 20);
    a.place(4, 4, 'switch', 1, 'branch');
    const e = a.switchExit(4, 4, 1, 'branch', 'parallel');
    a.place(e.x, e.y, 'straight', e.out === Dir.N || e.out === Dir.S ? 0 : 1, 'branch');
    a.get(4, 4)!.wear.health = 0.4;
    const b = new TrackGraph(20, 20);
    for (const t of a.tuples()) b.placeTuple(t);
    b.refreshSwitchForms();
    expect(b.get(4, 4)!.form).toBe('parallel');
    expect(b.get(4, 4)!.wear.health).toBe(0.4);
  });
});

describe('the warnings kept in a save', () => {
  it('start clear and come back as saved', () => {
    const w = simWorld({ terrain: 'grass', size: 32 });
    expect(w.builder.wear).toBeInstanceOf(TrackWear);
    expect(w.builder.wear.toJSON()).toEqual({ degraded: false, unusable: false });
    w.builder.wear.degradedShown = true;
    const stored = JSON.parse(JSON.stringify(w.builder.wear.toJSON())) as unknown;
    const again = simWorld({ terrain: 'grass', size: 32 });
    again.builder.wear.fromJSON(stored as { degraded: boolean; unusable: boolean });
    expect(again.builder.wear.toJSON()).toEqual({ degraded: true, unusable: false });
    again.builder.wear.fromJSON(undefined);
    expect(again.builder.wear.toJSON()).toEqual({ degraded: false, unusable: false });
  });
});

beforeEach(() => Object.assign(rules, DEFAULT_RULES));

/** A world with one Branch straight at (5, 5), and its wear. */
function branchWorld() {
  const w = simWorld({ terrain: 'grass', size: 32 });
  w.track.place(5, 5, 'straight', 1, 'branch');
  return { w, wear: w.builder.wear, piece: w.track.get(5, 5)! };
}

describe('wear from trains', () => {
  it('a 150 t train takes 2.25 HP from Branch', () => {
    const { wear, piece } = branchWorld();
    wear.hit(5, 5, Dir.W, 150);
    expect(piece.wear.health).toBeCloseTo(1 - 2.25 / 1000);
  });

  it('degraded track wears twice as fast', () => {
    const { wear, piece } = branchWorld();
    piece.wear.health = 0.2;
    wear.hit(5, 5, Dir.W, 150);
    expect(0.2 - piece.wear.health).toBeCloseTo(0.0045);
  });

  it('both axes of a crossing wear the same HP, each with its own multiplier', () => {
    const w = simWorld({ terrain: 'grass', size: 32 });
    w.track.place(5, 5, 'crossing', 0, 'branch', 'trunk');
    const p = w.track.get(5, 5)!;
    w.builder.wear.hit(5, 5, Dir.N, 150);
    expect(1 - p.wear.health).toBeCloseTo((150 * 0.015 * 1.0) / 3500);
    p.wear.health = 1;
    w.builder.wear.hit(5, 5, Dir.E, 150);
    expect(1 - p.wear.health).toBeCloseTo((150 * 0.015 * 1.6) / 3500);
  });

  it('a depot gate never loses health', () => {
    const w = simWorld({ terrain: 'grass', size: 32 });
    const depot = new Station('depot', 8, 8);
    w.builder.stations.push(depot);
    const gate = depot.gateTiles()[0];
    w.track.place(gate.x, gate.y, 'straight', 1, 'branch');
    w.track.place(gate.x + 4, gate.y, 'straight', 1, 'branch');
    expect(w.builder.wear.exempt(gate.x, gate.y)).toBe(true);
    expect(w.builder.wear.exempt(gate.x + 4, gate.y)).toBe(false);
    w.builder.wear.hit(gate.x, gate.y, Dir.W, 150);
    w.builder.wear.daily();
    expect(w.track.get(gate.x, gate.y)!.wear.health).toBe(1);
    expect(w.track.get(gate.x + 4, gate.y)!.wear.health).toBeLessThan(1);
  });

  it('a free builder wears nothing', () => {
    const { w, wear, piece } = branchWorld();
    w.builder.free = true;
    wear.hit(5, 5, Dir.W, 150);
    wear.daily();
    expect(piece.wear.health).toBe(1);
  });

  it('Maglev and Hyperloop never wear', () => {
    const w = simWorld({ terrain: 'grass', size: 32 });
    w.track.place(5, 5, 'straight', 1, 'maglev');
    w.track.place(7, 5, 'straight', 1, 'hyperloop');
    for (const x of [5, 7]) {
      w.builder.wear.hit(x, 5, Dir.W, 500);
      w.builder.wear.daily();
      expect(w.track.get(x, 5)!.wear.health).toBe(1);
    }
  });

  it('daily takes 0.4 % and twice that once degraded, never below 0', () => {
    const w = simWorld({ terrain: 'grass', size: 32 });
    w.track.place(5, 5, 'straight', 1, 'branch');
    w.track.place(7, 5, 'straight', 1, 'trunk');
    w.track.place(9, 5, 'straight', 1, 'branch');
    w.track.place(11, 5, 'straight', 1, 'branch');
    w.track.get(9, 5)!.wear.health = 0.2;
    w.track.get(11, 5)!.wear.health = 0.005;
    w.builder.wear.daily();
    // a share of max HP, whatever the line
    expect(w.track.get(5, 5)!.wear.health).toBeCloseTo(0.996);
    expect(w.track.get(7, 5)!.wear.health).toBeCloseTo(0.996);
    expect(w.track.get(9, 5)!.wear.health).toBeCloseTo(0.192);
    expect(w.track.get(11, 5)!.wear.health).toBe(0);
    w.builder.wear.daily();
    expect(w.track.get(11, 5)!.wear.health).toBe(0);
  });

  it('a multi-tile piece loses its time wear once a day', () => {
    const w = simWorld({ terrain: 'grass', size: 32 });
    w.track.place(10, 10, 'curve', 0, 'trunk');
    w.builder.wear.daily();
    expect(w.track.get(10, 10)!.wear.health).toBeCloseTo(0.996);
  });

  it('trackWearMul 0 leaves every piece full', () => {
    const { wear, piece } = branchWorld();
    rules.trackWearMul = 0;
    wear.hit(5, 5, Dir.W, 150);
    wear.daily();
    expect(piece.wear.health).toBe(1);
  });

  it('SimStep takes the time wear once at each day change', () => {
    const { w, piece } = branchWorld();
    const step = new SimStep(w);
    const ctx = { mode: 'play', weather: false } as const;
    w.clock.time = daySeconds() * 1 + 1;
    step.run(0.05, ctx);
    expect(piece.wear.health).toBeCloseTo(0.996);
    step.run(0.05, ctx);
    expect(piece.wear.health).toBeCloseTo(0.996);
    w.clock.time = daySeconds() * 2 + 1;
    step.run(0.05, ctx);
    expect(piece.wear.health).toBeCloseTo(0.992);
  });
});

/** A lone f7 started on the track at (x, y) facing `dir`, bound for a quarry at (qx, qy). */
function runner(w: SimWorld, [x, y]: [number, number], dir: Dir, [qx, qy]: [number, number]) {
  const t = new Train([{ uid: 1, level: 0, def: content.locomotives.find((d) => d.id === 'f7')! }]);
  t.spawnAt(w.track, x, y, dir);
  const st = new Station('quarry', qx, qy);
  w.builder.stations.push(st);
  t.route = [st.id];
  t.oil = t.oilCap;
  w.fleet.trains.push(t);
  expect(t.dispatch(w.track, w.builder, w.map)).toBe(true);
  const ctx = (w.fleet as unknown as { ctx(n: number, s: number): TickCtx }).ctx(0, 1);
  t.onPathReady(ctx);
  return { t, ctx };
}

describe('a train on the track', () => {
  it('one pass over a multi-tile curve is one hit', () => {
    const w = simWorld({ terrain: 'grass', size: 48 });
    // from the east along y = 13, round a 4 x 4 Trunk curve, and north up x = 10 to the quarry
    for (let x = 14; x <= 40; x++) w.track.place(x, 13, 'straight', 1, 'trunk');
    for (let y = 3; y <= 9; y++) w.track.place(10, y, 'straight', 0, 'trunk');
    w.track.place(10, 10, 'curve', 0, 'trunk');
    const { t, ctx } = runner(w, [38, 13], Dir.W, [10, 2]);
    const curve = w.track.get(10, 10)!;
    const before = w.track.get(30, 13)!;
    const hits = vi.spyOn(w.builder.wear, 'hit');
    for (let i = 0; i < 20 * 60 && t.state !== 'loading'; i++) t.tick(0.05, ctx);
    expect(t.state).toBe('loading');
    // the curve is one hit, however many tiles its path crosses
    const onCurve = hits.mock.calls.filter(([x, y]) => w.track.get(x, y)!.wear === curve.wear);
    expect(onCurve).toHaveLength(1);
    const hit = (t.mass * rules.trackWearPerTonne * rules.trackWearTrunk) / 3500;
    expect(1 - curve.wear.health).toBeCloseTo(hit, 8);
    expect(1 - before.wear.health).toBeCloseTo(hit, 8);
  });
});
