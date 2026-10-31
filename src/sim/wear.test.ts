import { describe, it, expect } from 'vitest';
import { Dir } from '../engine/iso';
import { TrackGraph, makePiece, type TrackClass } from '../world/track';
import { simWorld } from '../testing/simWorld';
import { rules } from './rules';
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
