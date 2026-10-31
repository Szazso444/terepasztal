import { beforeEach, describe, expect, it } from 'vitest';
import { content } from '../data/content';
import { Dir } from '../engine/iso';
import { STR } from '../strings';
import { depotWith } from '../testing/storeFixtures';
import { line, simWorld, type SimWorld } from '../testing/simWorld';
import { pieceCost } from '../world/track';
import { rules, DEFAULT_RULES } from './rules';
import { Train } from './trains';
import { stateOf } from './wear';

beforeEach(() => Object.assign(rules, DEFAULT_RULES));

const GOODS = { wood: 1000, stone: 1000, iron: 1000 };
const held = (w: SimWorld, depot: { get(k: string): number }) =>
  Object.keys(GOODS).map((k) => depot.get(k));

/** A grass world with a stocked depot at (4, 4) and one Branch straight at (10, 20), at `health`. */
function worn(health: number, goods: Record<string, number> = GOODS) {
  const w = simWorld({ terrain: 'grass', size: 96 });
  const depot = depotWith(w, goods, { x: 4, y: 4 });
  w.track.place(10, 20, 'straight', 1, 'branch');
  w.track.get(10, 20)!.wear.health = health;
  return { w, depot };
}

describe('hand repair', () => {
  it('is instant and costs twice the train price', () => {
    const { w, depot } = worn(0.5);
    const before = held(w, depot);
    const list = pieceCost('straight', 'branch');
    // 40 % of the build cost for 100 % of the HP, twice that by hand, for the missing half
    const want = Object.fromEntries(
      Object.entries(list).map(([k, v]) => [k, Math.ceil(v * 0.4 * 2 * 0.5 - 1e-9)]),
    );
    const check = w.builder.checkRepair([{ x: 10, y: 20 }]);
    expect(check.ok).toBe(true);
    expect(check.cost).toEqual(want);
    expect(check.pieces).toEqual([{ x: 10, y: 20 }]);
    expect(w.builder.repairTrack([{ x: 10, y: 20 }])).toBe(true);
    expect(w.track.get(10, 20)!.wear.health).toBe(1);
    const after = held(w, depot);
    Object.keys(GOODS).forEach((k, i) => expect(before[i] - after[i], k).toBe(want[k] ?? 0));
  });

  it('follows the tuning: a train pays the base price, a hand repair its multiple', () => {
    const { w } = worn(0.5);
    const p = w.track.get(10, 20)!;
    const list = pieceCost('straight', 'branch');
    const of = (mul: number) =>
      Object.fromEntries(Object.entries(list).map(([k, v]) => [k, Math.ceil(v * mul - 1e-9)]));
    expect(w.builder.wear.repairCost(p, 0.5, false)).toEqual(of(0.4 * 0.5));
    rules.trackHandRepairMul = 3;
    rules.buildCostMul = 2;
    expect(w.builder.wear.repairCost(p, 0.5, true)).toEqual(of(0.4 * 0.5 * 3 * 2));
  });

  it('a store past buildReach pays', () => {
    const { w, depot } = worn(0.2);
    const dist = Math.max(Math.abs(10 - 4), Math.abs(20 - 4));
    // far from the depot, as the tuning has it: building here would find no store
    rules.buildReach = dist - 1;
    expect(w.builder.affordable({ wood: 1 }, 10, 20).ok).toBe(false);
    const before = held(w, depot);
    expect(w.builder.repairTrack([{ x: 10, y: 20 }])).toBe(true);
    expect(w.track.get(10, 20)!.wear.health).toBe(1);
    expect(held(w, depot)).not.toEqual(before);
  });

  it('no store can pay: refused with the reason, health unchanged', () => {
    const { w, depot } = worn(0.5, { wood: 0, stone: 0, iron: 0 });
    const check = w.builder.checkRepair([{ x: 10, y: 20 }]);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/^No store holds /);
    expect(check.reason).toContain('wood');
    expect(w.builder.repairTrack([{ x: 10, y: 20 }])).toBe(false);
    expect(w.track.get(10, 20)!.wear.health).toBe(0.5);
    expect(held(w, depot)).toEqual([0, 0, 0]);
  });

  it('a multi-tile piece repaired from any of its tiles is charged once', () => {
    const w = simWorld({ terrain: 'grass', size: 96 });
    const depot = depotWith(w, GOODS, { x: 4, y: 4 });
    const tiles = w.track.place(30, 30, 'curve', 0, 'main');
    expect(tiles.length).toBeGreaterThan(1);
    const piece = w.track.get(30, 30)!;
    piece.wear.health = 0.5;
    const all = w.builder.checkRepair(tiles);
    const one = w.builder.checkRepair([tiles[tiles.length - 1]]);
    expect(all.pieces).toHaveLength(1);
    expect(all.cost).toEqual(one.cost);
    expect(all.cost).toEqual(w.builder.wear.repairCost(piece, 0.5, true));
    const before = held(w, depot);
    expect(w.builder.repairTrack(tiles)).toBe(true);
    expect(piece.wear.health).toBe(1);
    // every tile shares the one health, so a second stroke over them mends and charges nothing
    expect(w.builder.repairTrack(tiles)).toBe(false);
    const spent = before.map((v, i) => v - held(w, depot)[i]);
    expect(spent).toEqual(Object.keys(GOODS).map((k) => all.cost[k] ?? 0));
  });

  it('a piece under a train can be repaired, and opens to traffic', () => {
    const w = simWorld({ terrain: 'grass', size: 96 });
    depotWith(w, GOODS, { x: 4, y: 4 });
    line(w, 40, 30, 50);
    const def = content.locomotives.find((d) => d.id === 'f7')!;
    const t = new Train([{ uid: 1, level: 0, def }]);
    expect(t.spawnAt(w.track, 45, 30, Dir.E)).toBe(true);
    w.fleet.trains.push(t);
    const piece = w.track.get(45, 30)!;
    piece.wear.health = 1e-9;
    w.builder.wear.hit(45, 30, Dir.E, 100);
    w.builder.wear.flush();
    expect(stateOf(piece)).toBe('unusable');
    expect(w.builder.wear.unusable.has(30 * w.track.w + 45)).toBe(true);
    const version = w.track.version;
    expect(t.headTile).toEqual({ x: 45, y: 30 });
    expect(w.builder.repairTrack([{ x: 45, y: 30 }])).toBe(true);
    expect(piece.wear.health).toBe(1);
    expect(w.builder.wear.unusable.has(30 * w.track.w + 45)).toBe(false);
    expect(w.track.version).toBeGreaterThan(version);
  });

  it('mending an unusable piece tells the trains once, a worn one not at all', () => {
    const { w } = worn(0.5);
    const v = w.track.version;
    w.builder.repairTrack([{ x: 10, y: 20 }]);
    expect(w.track.version).toBe(v);
    w.track.get(10, 20)!.wear.health = 0;
    w.track.version++;
    const after = w.track.version;
    w.builder.repairTrack([{ x: 10, y: 20 }]);
    expect(w.track.version).toBe(after + 1);
  });

  it('a depot gate, a full piece and a Maglev piece offer nothing to repair', () => {
    const { w } = worn(1);
    const depot = w.builder.depots()[0];
    const gate = depot.gateTiles()[0];
    line(w, gate.x, gate.y, gate.x);
    w.track.get(gate.x, gate.y)!.wear.health = 0.5;
    w.track.place(60, 60, 'straight', 1, 'maglev');
    w.track.get(60, 60)!.wear.health = 0.5;
    for (const at of [{ x: 10, y: 20 }, gate, { x: 60, y: 60 }, { x: 70, y: 70 }]) {
      const check = w.builder.checkRepair([at]);
      expect(check.ok).toBe(false);
      expect(check.pieces).toEqual([]);
      expect(check.cost).toEqual({});
      expect(check.reason).toBe(STR.build.repairNothing);
      expect(w.builder.repairTrack([at])).toBe(false);
    }
    expect(w.track.get(gate.x, gate.y)!.wear.health).toBe(0.5);
  });

  it('a stroke over several pieces adds them up and mends them all', () => {
    const w = simWorld({ terrain: 'grass', size: 96 });
    const depot = depotWith(w, GOODS, { x: 4, y: 4 });
    line(w, 30, 40, 33);
    const run = [30, 31, 32, 33].map((x) => ({ x, y: 40 }));
    for (const t of run) w.track.get(t.x, t.y)!.wear.health = 0.5;
    w.track.get(33, 40)!.wear.health = 1;
    const check = w.builder.checkRepair(run);
    expect(check.pieces).toHaveLength(3);
    const one = w.builder.checkRepair([run[0]]).cost;
    expect(check.cost.wood ?? 0).toBe(3 * (one.wood ?? 0));
    const before = held(w, depot);
    expect(w.builder.repairTrack(run)).toBe(true);
    expect(run.every((t) => w.track.get(t.x, t.y)!.wear.health === 1)).toBe(true);
    expect(before[0] - depot.get('wood')).toBe(check.cost.wood ?? 0);
  });

  it('is never needed in the level editor, where nothing wears', () => {
    const { w } = worn(0.5);
    w.builder.free = true;
    expect(w.builder.checkRepair([{ x: 10, y: 20 }]).pieces).toEqual([]);
  });
});
