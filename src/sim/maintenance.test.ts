import { describe, it, expect, beforeEach, vi } from 'vitest';
import { content } from '../data/content';
import { levelMul } from '../gacha/items';
import { STR } from '../strings';
import { depotWith } from '../testing/storeFixtures';
import { line, simWorld, station, type SimWorld } from '../testing/simWorld';
import { Dir } from '../engine/iso';
import { findPath } from '../world/pathfinding';
import { classRank, consistAccess, consistGauge, gaugeOf, trafficRank } from './compat';
import { Commands } from './commands';
import type { Contract } from './contracts';
import { daySeconds, DEFAULT_RULES, rules } from './rules';
import { SimStep, startStock, type StepContext } from './step';
import { defaultStop, Train, type RouteMode, type StopPlan } from './trains';
import { locoDef, wagonDef } from '../gacha/items';
import type { Station } from './stations';

vi.mock('../world/pathfinding', async (importOriginal) => {
  const real = await importOriginal<typeof import('../world/pathfinding')>();
  return { ...real, findPath: vi.fn(real.findPath) };
});

beforeEach(() => Object.assign(rules, DEFAULT_RULES));

describe('the maintenance wagon behind a locomotive', () => {
  const wagons = content.wagons.filter((w) => w.maintenance);

  it('may go behind any locomotive of its network', () => {
    expect(wagons.length).toBeGreaterThan(0);
    for (const wagon of wagons) {
      const locos = content.locomotives.filter((l) => gaugeOf(l) === gaugeOf(wagon));
      expect(locos.length, wagon.id).toBeGreaterThan(0);
      for (const loco of locos) {
        const why = `${loco.id} + ${wagon.id}`;
        expect(consistGauge([loco, wagon]), why).toBe(gaugeOf(wagon));
        // the consist still runs on some line, and the engine can pull the empty wagon
        expect(
          consistAccess([locoDef(loco.id), wagonDef(wagon.id)]).classes.size,
          why,
        ).toBeGreaterThan(0);
        expect(wagon.weight, why).toBeLessThanOrEqual(loco.power);
      }
    }
  });

  it('stays on its gauge: a locomotive of the other gauge cannot take it', () => {
    const narrow = wagons.find((w) => gaugeOf(w) === 'narrow')!;
    const regular = content.locomotives.find((l) => gaugeOf(l) === 'regular')!;
    expect(consistGauge([regular, narrow])).toBe('mixed');
  });
});

/**
 * A town with a farm in its reach, a warehouse at the far end of the line and a depot at its west
 * end; a train of an Adler, a flatbed and (or not) a Branch maintenance wagon runs farm, warehouse,
 * waiting for full wagons at the farm.
 */
function farmLine(withMaintenanceWagon: boolean) {
  const w = simWorld({ terrain: 'grass', size: 96 });
  const stock = startStock();
  stock.wheat = 0;
  depotWith(w, stock, { x: 4, y: 30 });
  line(w, 6, 30, 90);
  const hall = station(w, 'town', 20, 29);
  const farm = station(w, 'farm', 25, 29);
  const warehouse = station(w, 'warehouse', 80, 29);
  w.stores.townStore(hall.x, hall.y)!.add('wheat', 500);
  const loco = w.inventory.add('adler', 0);
  const flat = w.inventory.add('flatbed', 0);
  const wagons = [flat.uid];
  if (withMaintenanceWagon) wagons.push(w.inventory.add('maint_wagon_branch', 0).uid);
  const stop = (id: number): StopPlan => ({ ...defaultStop(id), unload: 'none', waitFull: true });
  const t = w.fleet.create([loco.uid], wagons, [stop(farm.id), stop(warehouse.id)]);
  if (typeof t === 'string') throw new Error(`fleet.create: ${t}`);
  return { w, farm, t };
}

/** Steps the world until the train has called at the farm and left it; how long it stood there. */
function dwellAt(w: SimWorld, t: Train, farm: Station): number {
  const step = new SimStep(w);
  const ctx: StepContext = { mode: 'play', weather: false };
  let arrived: number | null = null;
  for (let i = 0; i < 30000; i++) {
    w.clock.run((gdt) => step.run(gdt, ctx));
    if (t.atStation === farm) arrived ??= w.clock.time;
    else if (arrived !== null) return w.clock.time - arrived;
  }
  throw new Error('the train never left the farm');
}

describe('a wagon that holds nothing, at a stop that waits for full wagons', () => {
  const SLOW = { timeout: 60_000 };

  it('is not waited on: the train leaves as soon as the other wagons are full', SLOW, () => {
    const plain = farmLine(false);
    const alone = dwellAt(plain.w, plain.t, plain.farm);
    const mixed = farmLine(true);
    expect(mixed.t.wagons.map((x) => x.def.id)).toEqual(['flatbed', 'maint_wagon_branch']);
    const dwell = dwellAt(mixed.w, mixed.t, mixed.farm);
    const flat = mixed.t.wagons[0];
    expect(flat.cargo).toBe('wheat');
    expect(flat.amount).toBeCloseTo(flat.def.capacity * levelMul(flat.level), 6);
    // the same dwell as without the wagon, far below the longest wait for a full load
    expect(dwell).toBeCloseTo(alone, 0);
    expect(dwell).toBeLessThan(120);
    expect(mixed.t.wagons[1].cargo).toBeNull();
  });
});

describe('the Maintenance mode in a save', () => {
  it('comes back as it was saved', () => {
    const w = simWorld({ terrain: 'grass', size: 96 });
    const t = new Train([{ uid: 1, level: 1, def: locoDef('adler') }]);
    t.wagons = [
      {
        uid: 2,
        def: wagonDef('maint_wagon_branch'),
        level: 1,
        cargo: null,
        amount: 0,
        origin: null,
      },
    ];
    t.mode = 'maintenance';
    expect(Train.fromJSON(t.toJSON(), w.track).mode).toBe('maintenance');
    t.mode = 'freight';
    expect(Train.fromJSON(t.toJSON(), w.track).mode).toBe('freight');
  });
});

/** A depot at the west end of a straight Branch line nothing else wears, its goods as given. */
function workLine(goods: Record<string, number> = { wood: 1000, stone: 1000, iron: 1000 }) {
  rules.trackWearMul = 0;
  const w = simWorld({ terrain: 'grass', size: 96 });
  const store = depotWith(w, { ...startStock(), ...goods }, { x: 4, y: 30 });
  line(w, 6, 30, 90);
  const stops = [station(w, 'warehouse', 12, 29).id, station(w, 'warehouse', 17, 29).id];
  return { w, store, stops };
}
/** A depot at the west end of a Branch line, a failed piece at 40, every stop past it. */
function brokenLine() {
  rules.trackWearMul = 0;
  const w = simWorld({ terrain: 'grass', size: 96 });
  depotWith(w, { ...startStock(), wood: 1000, stone: 1000, iron: 1000 }, { x: 4, y: 30 });
  line(w, 6, 30, 90);
  station(w, 'warehouse', 70, 29);
  station(w, 'warehouse', 80, 29);
  wearDown(w, 40, 0);
  const loco = w.inventory.add('adler', 0).uid;
  const wagon = w.inventory.add('maint_wagon_branch', 0).uid;
  return { w, loco, wagon };
}
/** A locomotive and a Branch maintenance wagon rolled out of the depot, on the mode given. */
function maintTrain(w: SimWorld, stops: number[], mode: RouteMode = 'maintenance') {
  const loco = w.inventory.add('adler', 0);
  const wagon = w.inventory.add('maint_wagon_branch', 0);
  const t = w.fleet.create([loco.uid], [wagon.uid], stops, undefined, mode);
  if (typeof t === 'string') throw new Error(`fleet.create: ${t}`);
  return t;
}
const wearDown = (w: SimWorld, x: number, health: number) =>
  w.builder.wear.setHealth(x, 30, health);
const healthAt = (w: SimWorld, x: number) => w.track.get(x, 30)!.wear.health;
function cut(w: SimWorld, x: number) {
  w.builder.free = true;
  w.builder.removeTrack(x, 30);
  w.builder.free = false;
}
/** The tile of the depot gate the line of `workLine` starts at. */
const GATE = 6;
/** A train on no track at all: it looks on the board, and finds a piece claimed or not. */
const onlooker = () => new Train([{ uid: 90, level: 1, def: locoDef('adler') }]);
/** Steps the world until `done` holds; throws after `limit` game seconds. */
function until(w: SimWorld, done: () => boolean, limit = 300) {
  const step = new SimStep(w);
  const ctx: StepContext = { mode: 'play', weather: false };
  const end = w.clock.time + limit;
  while (!done()) {
    if (w.clock.time > end) throw new Error(`nothing came of it in ${limit} game seconds`);
    w.clock.run((gdt) => step.run(gdt, ctx));
  }
}
const repairing = (t: Train) => () => t.state === 'repairing';

describe('a maintenance train leaving a depot', () => {
  it('rolls out with every stop past the break, and repairs the piece', () => {
    const { w, loco, wagon } = brokenLine();
    // no other train could: there is no way to its stops
    expect(w.fleet.dispatchCheck([loco], [wagon], [], null).reason).not.toBeNull();
    const check = w.fleet.dispatchCheck([loco], [wagon], [], null, 'maintenance');
    expect(check.reason).toBeNull();
    expect(check.gate).not.toBeNull();
    const t = w.fleet.create([loco], [wagon], [], undefined, 'maintenance');
    if (typeof t === 'string') throw new Error(t);
    expect(t.headTile).toEqual(check.gate);
    expect(t.maint).toMatchObject({ ax: 40, x: 39 });
    until(w, repairing(t));
    expect(t.headTile).toEqual({ x: 39, y: 30 });
    until(w, () => healthAt(w, 40) >= 1);
    expect(t.maint).toBeNull();
  });

  it('needs no stop at all', () => {
    rules.trackWearMul = 0;
    const w = simWorld({ terrain: 'grass', size: 96 });
    depotWith(w, startStock(), { x: 4, y: 30 });
    line(w, 6, 30, 50);
    wearDown(w, 30, 0.2);
    const t = maintTrain(w, []);
    expect(t.route.length).toBeLessThan(2);
    until(w, repairing(t));
    expect(t.headTile).toEqual({ x: 30, y: 30 });
    // with no stops of its own it leaves the mode for freight
    t.wagons = [];
    until(w, () => t.mode === 'freight');
  });

  it('still needs its wagon', () => {
    const { w, loco } = brokenLine();
    const why = STR.fleet.needMaintenanceWagon;
    expect(w.fleet.dispatchCheck([loco], [], [], null, 'maintenance').reason).toBe(why);
    expect(w.fleet.create([loco], [], [], undefined, 'maintenance')).toBe(why);
  });

  it('still needs a gate it can run out through', () => {
    const { w, loco, wagon } = brokenLine();
    cut(w, 7);
    const check = w.fleet.dispatchCheck([loco], [wagon], [], null, 'maintenance');
    expect(check.gate).toBeNull();
    expect(check.reason).not.toBeNull();
    expect(w.fleet.create([loco], [wagon], [], undefined, 'maintenance')).toBe(check.reason);
  });

  /** A depot in the middle of the map with a line of its own out of each side. */
  function twoLines() {
    rules.trackWearMul = 0;
    const w = simWorld({ terrain: 'grass', size: 96 });
    depotWith(w, startStock(), { x: 30, y: 30 });
    line(w, 10, 30, 29);
    line(w, 32, 30, 60);
    const loco = w.inventory.add('adler', 0).uid;
    const wagon = w.inventory.add('maint_wagon_branch', 0).uid;
    return { w, loco, wagon };
  }
  const send = (w: SimWorld, loco: number, wagon: number) => {
    const t = w.fleet.create([loco], [wagon], [], undefined, 'maintenance');
    if (typeof t === 'string') throw new Error(t);
    return t;
  };

  it('takes the gate its work lies beyond', () => {
    for (const x of [45, 20]) {
      const { w, loco, wagon } = twoLines();
      wearDown(w, x, 0);
      const gate = w.fleet.dispatchCheck([loco], [wagon], [], null, 'maintenance').gate!;
      expect(Math.sign(gate.x - 30.5)).toBe(Math.sign(x - 30.5));
      const t = send(w, loco, wagon);
      expect(t.maint?.ax).toBe(x);
      until(w, () => healthAt(w, x) >= 1);
    }
  });

  it('goes for the most urgent work beyond its gates', () => {
    for (const [broken, worn] of [
      [45, 20],
      [20, 45],
    ]) {
      const { w, loco, wagon } = twoLines();
      wearDown(w, worn, 0.2);
      wearDown(w, broken, 0);
      expect(send(w, loco, wagon).maint?.ax).toBe(broken);
    }
  });

  it('with no work in reach takes the first gate it can run out through', () => {
    const { w, loco, wagon } = twoLines();
    expect(w.fleet.dispatchCheck([loco], [wagon], [], null, 'maintenance').gate).not.toBeNull();
    expect(send(w, loco, wagon).maint).toBeNull();
  });

  it('claims nothing by asking', () => {
    const { w, loco, wagon } = twoLines();
    wearDown(w, 45, 0);
    w.fleet.dispatchCheck([loco], [wagon], [], null, 'maintenance');
    expect(w.fleet.maintenance.pick(onlooker(), w.track)).toBeNull();
    expect(send(w, loco, wagon).maint?.ax).toBe(45);
  });

  it('asks the preview the same question', () => {
    const { w, loco } = brokenLine();
    expect(w.fleet.previewSpawn([loco], [], null).gate).toBeNull();
    expect(w.fleet.previewSpawn([loco], [], null, 'maintenance').gate).not.toBeNull();
  });
});

describe('a maintenance train choosing work', () => {
  it('takes unusable before degraded before close to degraded', () => {
    const { w, stops } = workLine();
    const t = maintTrain(w, stops);
    wearDown(w, 20, 0.4);
    wearDown(w, 30, 0.2);
    wearDown(w, 40, 0);
    const board = w.fleet.maintenance;
    expect(board.pick(t, w.track)?.job).toMatchObject({ ax: 40, tier: 0, x: 39, y: 30 });
    wearDown(w, 40, 1);
    expect(board.pick(t, w.track)?.job).toMatchObject({ ax: 30, tier: 1, x: 30, y: 30 });
    wearDown(w, 30, 1);
    expect(board.pick(t, w.track)?.job).toMatchObject({ ax: 20, tier: 2, x: 20, y: 30 });
  });

  it('within a tier takes the nearest', () => {
    const { w, stops } = workLine();
    const t = maintTrain(w, stops);
    wearDown(w, 50, 0.2);
    wearDown(w, 20, 0.2);
    wearDown(w, 30, 0.2);
    expect(w.fleet.maintenance.pick(t, w.track)?.job.ax).toBe(20);
  });

  it('two trains never claim one piece', () => {
    const { w, stops } = workLine();
    wearDown(w, 40, 0.2);
    wearDown(w, 50, 0.2);
    const first = maintTrain(w, stops);
    expect(first.maint?.ax).toBe(40);
    until(w, () => first.headTile!.x > 20);
    const second = maintTrain(w, stops);
    expect(second.maint?.ax).toBe(50);
    expect(w.fleet.maintenance.pick(onlooker(), w.track)).toBeNull();
  });

  it('a job released goes back on the board, and so does a recalled train', () => {
    const { w, stops } = workLine();
    wearDown(w, 40, 0.2);
    const first = maintTrain(w, stops);
    until(w, () => first.headTile!.x > 20);
    const second = maintTrain(w, stops);
    expect(second.maint).toBeNull();
    const board = w.fleet.maintenance;
    board.release(first);
    expect(first.maint).toBeNull();
    expect(board.pick(second, w.track)?.job.ax).toBe(40);
    board.release(second);
    expect(board.pick(first, w.track)?.job.ax).toBe(40);
    w.fleet.recall(first);
    expect(board.pick(second, w.track)?.job.ax).toBe(40);
  });

  it('leaves healthy track over 45 % alone', () => {
    const { w, stops } = workLine();
    const t = maintTrain(w, stops);
    wearDown(w, 30, 0.45);
    expect(w.fleet.maintenance.pick(t, w.track)).toBeNull();
    wearDown(w, 30, 0.449);
    expect(w.fleet.maintenance.pick(t, w.track)?.job.tier).toBe(2);
  });

  it('never searches more than three times for one pick', () => {
    const { w, stops } = workLine();
    const t = maintTrain(w, stops);
    // beyond a gap: every tier has work and none of it can be reached
    cut(w, 35);
    wearDown(w, 40, 0);
    wearDown(w, 42, 0.2);
    wearDown(w, 44, 0.4);
    const searches = vi.mocked(findPath);
    searches.mockClear();
    expect(w.fleet.maintenance.pick(t, w.track)).toBeNull();
    expect(searches.mock.calls.length).toBe(3);
    // the first tier with a job in reach ends the look
    wearDown(w, 30, 0);
    searches.mockClear();
    expect(w.fleet.maintenance.pick(t, w.track)?.job.ax).toBe(30);
    expect(searches.mock.calls.length).toBe(1);
  });

  it('with work behind it the train turns round, in one search', () => {
    const { w, stops } = workLine();
    wearDown(w, 40, 0.2);
    const t = maintTrain(w, stops);
    until(w, repairing(t));
    wearDown(w, 20, 0.2);
    const searches = vi.mocked(findPath);
    searches.mockClear();
    until(w, () => t.maint?.ax === 20);
    expect(searches.mock.calls.length).toBe(1);
    until(w, repairing(t));
    expect(t.headTile).toEqual({ x: 20, y: 30 });
  });
});

describe('a maintenance train with no work', () => {
  const free = (w: SimWorld) =>
    w.fleet.dispatchCheck(
      [w.inventory.add('adler', 0).uid],
      [w.inventory.add('maint_wagon_branch', 0).uid],
      [],
      null,
      'maintenance',
    ).reason;

  it('stops its own length and a tile short of the gate, on the line it comes home by', () => {
    rules.trackWearMul = 0;
    const w = simWorld({ terrain: 'grass', size: 96 });
    depotWith(w, startStock(), { x: 4, y: 30 });
    line(w, 6, 30, 50);
    wearDown(w, 40, 0.2);
    const t = maintTrain(w, []);
    until(w, () => healthAt(w, 40) >= 1);
    until(w, () => t.state === 'idle');
    expect(t.headTile).toEqual({ x: GATE + Math.ceil(t.length) + 1, y: 30 });
  });

  it('leaves the gate open after a repair, on a depot with one line', () => {
    const { w, stops } = workLine();
    wearDown(w, 40, 0.2);
    const t = maintTrain(w, stops);
    until(w, () => healthAt(w, 40) >= 1);
    until(w, () => t.state === 'idle');
    expect(free(w)).toBeNull();
    const next = maintTrain(w, stops, 'schedule');
    const from = next.distance;
    until(w, () => next.distance > from + 5, 120);
  });

  it('a train longer than the gap rolls out past it, and it moves off', () => {
    rules.trackWearMul = 0;
    const w = simWorld({ terrain: 'grass', size: 96 });
    depotWith(w, { ...startStock(), wood: 1000, stone: 1000, iron: 1000 }, { x: 4, y: 30 });
    line(w, 6, 30, 90);
    const a = station(w, 'warehouse', 40, 29).id;
    const b = station(w, 'warehouse', 60, 29).id;
    const t = maintTrain(w, []);
    until(w, () => t.state === 'idle', 120);
    const parked = t.headTile!.x;
    const loco = w.inventory.add('adler', 0).uid;
    const flats = Array.from({ length: 6 }, () => w.inventory.add('flatbed', 0).uid);
    expect(w.fleet.dispatchCheck([loco], flats, [a, b], null).reason).toBeNull();
    const long = w.fleet.create([loco], flats, [a, b]);
    if (typeof long === 'string') throw new Error(long);
    expect(long.length).toBeGreaterThan(parked - GATE);
    until(w, () => long.atStation?.id === a, 200);
    expect(t.headTile!.x).not.toBe(parked);
  });

  it('a train that is not parked still shuts the run', () => {
    rules.trackWearMul = 0;
    const w = simWorld({ terrain: 'grass', size: 96 });
    depotWith(w, { ...startStock(), wood: 1000, stone: 1000, iron: 1000 }, { x: 4, y: 30 });
    line(w, 6, 30, 90);
    const a = station(w, 'warehouse', 40, 29).id;
    const b = station(w, 'warehouse', 60, 29).id;
    const other = maintTrain(w, [a, b], 'schedule');
    until(w, () => other.headTile!.x >= 12, 60);
    other.coal = 0;
    other.water = 0;
    until(w, () => other.state === 'noFuel', 30);
    const loco = w.inventory.add('adler', 0).uid;
    const flats = Array.from({ length: 6 }, () => w.inventory.add('flatbed', 0).uid);
    expect(w.fleet.dispatchCheck([loco], flats, [a, b], null).reason).not.toBeNull();
  });

  it('rolled out with nothing to do, it clears the gate too', () => {
    const { w, stops } = workLine();
    const t = maintTrain(w, stops);
    expect(t.state).toBe('moving');
    until(w, () => t.state === 'idle');
    expect(t.headTile!.x).toBeGreaterThan(GATE + Math.ceil(t.length));
    expect(free(w)).toBeNull();
    expect(typeof maintTrain(w, stops, 'schedule')).toBe('object');
  });

  it('stands at the gate when the line holds no place clear of it', () => {
    rules.trackWearMul = 0;
    const w = simWorld({ terrain: 'grass', size: 96 });
    depotWith(w, startStock(), { x: 4, y: 30 });
    line(w, 6, 30, 10);
    const t = maintTrain(w, []);
    expect(t.state).toBe('idle');
    expect(t.headTile).toEqual({ x: GATE, y: 30 });
    expect(t.parkAt).toEqual({ x: GATE, y: 30 });
  });

  it('waits on no platform', () => {
    const { w, stops } = workLine();
    station(w, 'warehouse', 8, 29);
    const t = maintTrain(w, stops);
    until(w, () => t.state === 'idle');
    const platforms = w.builder.stations.flatMap((s) => w.builder.platformTiles(s));
    const under = t.occupancyKeys(w.track.w);
    expect(platforms.filter((p) => under.includes(w.track.key(p.x, p.y)))).toEqual([]);
  });

  it('a second train waits behind the first, and both stay put', () => {
    const { w, stops } = workLine();
    const first = maintTrain(w, stops);
    until(w, () => first.state === 'idle');
    const second = maintTrain(w, stops);
    until(w, () => second.state === 'idle');
    const a = first.headTile!;
    const b = second.headTile!;
    expect(new Set(first.occupancyKeys(w.track.w)).has(w.track.key(b.x, b.y))).toBe(false);
    const from = w.clock.time;
    until(w, () => w.clock.time > from + 65);
    expect(first.headTile).toEqual(a);
    expect(second.headTile).toEqual(b);
    expect(first.blocked || second.blocked).toBe(false);
  });

  it('keeps its place through a save', () => {
    const { w, stops } = workLine();
    const t = maintTrain(w, stops);
    const saved = JSON.parse(JSON.stringify(t.toJSON())) as ReturnType<Train['toJSON']>;
    const back = Train.fromJSON(saved, w.track);
    expect(back.parkAt).toEqual(t.parkAt);
    w.fleet.trains[0] = back;
    until(w, () => back.state === 'idle');
    expect(back.headTile).toEqual(back.parkAt);
    expect(
      Train.fromJSON({ ...saved, parkAt: { x: 'a', y: 1 } } as unknown as typeof saved, w.track)
        .parkAt,
    ).toBeNull();
  });
});

describe('a maintenance train at work', () => {
  it('repairs an unusable piece from the tile beside it', () => {
    const { w, stops } = workLine();
    wearDown(w, 40, 0);
    const t = maintTrain(w, stops);
    until(w, () => healthAt(w, 40) > 0);
    expect(t.state).toBe('repairing');
    expect(t.headTile).toEqual({ x: 39, y: 30 });
    expect(healthAt(w, 40)).toBeGreaterThan(0);
  });

  it('repairs a broken stretch from its near end inward', () => {
    const { w, stops } = workLine();
    cut(w, 43);
    wearDown(w, 40, 0);
    wearDown(w, 41, 0);
    wearDown(w, 42, 0);
    const t = maintTrain(w, stops);
    // only the near piece has a sound neighbour on this side of the stretch
    expect(t.maint).toMatchObject({ ax: 40, x: 39 });
    until(w, () => healthAt(w, 40) >= 1);
    expect(healthAt(w, 41)).toBe(0);
    until(w, repairing(t));
    expect(t.maint).toMatchObject({ ax: 41, x: 40 });
    expect(t.headTile).toEqual({ x: 40, y: 30 });
    until(w, () => healthAt(w, 41) >= 1);
    expect(healthAt(w, 42)).toBe(0);
    until(w, repairing(t));
    expect(t.maint).toMatchObject({ ax: 42, x: 41 });
  });

  it('a piece with no sound neighbour waits for its neighbour', () => {
    const { w, stops } = workLine();
    cut(w, 43);
    wearDown(w, 40, 0);
    wearDown(w, 41, 0);
    wearDown(w, 42, 0);
    const t = maintTrain(w, stops);
    expect(t.maint?.ax).toBe(40);
    // the near end is claimed, and the two beyond have no sound tile to work from
    expect(w.fleet.maintenance.pick(onlooker(), w.track)).toBeNull();
  });

  it('drives on a degraded piece and stands there', () => {
    const { w, stops } = workLine();
    wearDown(w, 40, 0.2);
    const t = maintTrain(w, stops);
    until(w, repairing(t));
    expect(t.headTile).toEqual({ x: 40, y: 30 });
    expect(t.speed).toBe(0);
  });

  it('full repair takes 25 game seconds and is paid as it goes', () => {
    const { w, store, stops } = workLine();
    rules.trackRepairPrice = 10;
    wearDown(w, 40, 0);
    const piece = w.track.get(40, 30)!;
    const price = w.builder.wear.repairDue(piece, 1);
    const goods = Object.keys(price);
    expect(goods.length).toBeGreaterThan(0);
    const t = maintTrain(w, stops);
    until(w, repairing(t));
    const started = w.clock.time;
    const before = goods.map((k) => store.get(k));
    const paid = () => goods.map((k, i) => before[i] - store.get(k));
    until(w, () => piece.wear.health >= 0.5);
    expect(w.clock.time - started).toBeCloseTo(12.5, 0);
    goods.forEach((k, i) => {
      expect(paid()[i], k).toBeGreaterThanOrEqual(Math.floor(price[k] / 2) - 1);
      expect(paid()[i], k).toBeLessThanOrEqual(Math.ceil(price[k] / 2) + 1);
    });
    until(w, () => piece.wear.health >= 1);
    expect(w.clock.time - started).toBeCloseTo(25, 0);
    goods.forEach((k, i) => expect(paid()[i], k).toBe(Math.floor(price[k])));
  });

  it('pays only whole units, and the fraction left stays on the train', () => {
    const { w, store, stops } = workLine();
    rules.trackRepairPrice = 0.7;
    wearDown(w, 40, 0);
    const piece = w.track.get(40, 30)!;
    const due = w.builder.wear.repairDue(piece, 1);
    const k = Object.keys(due).find((id) => due[id] % 1 > 0)!;
    const t = maintTrain(w, stops);
    until(w, repairing(t));
    const before = store.get(k);
    until(w, () => piece.wear.health >= 1);
    expect(before - store.get(k)).toBe(Math.floor(due[k]));
    expect(t.repairOwed[k]).toBeCloseTo(due[k] % 1, 6);
  });

  it('pays from a store however far', () => {
    const { w, store, stops } = workLine();
    rules.buildReach = 5;
    rules.trackRepairPrice = 10;
    wearDown(w, 60, 0);
    const t = maintTrain(w, stops);
    const goods = Object.keys(w.builder.wear.repairDue(w.track.get(60, 30)!, 1));
    const before = goods.map((k) => store.get(k));
    until(w, () => healthAt(w, 60) >= 1, 900);
    expect(goods.some((k, i) => store.get(k) < before[i])).toBe(true);
    expect(t.maint?.ax).not.toBe(60);
  });

  it('partial repair stays when the job is left', () => {
    const { w, stops } = workLine();
    wearDown(w, 40, 0);
    const t = maintTrain(w, stops);
    until(w, () => healthAt(w, 40) >= 0.3);
    expect(w.fleet.setMode(t, 'schedule')).toEqual({ ok: true });
    expect(t.maint).toBeNull();
    expect(t.state).not.toBe('repairing');
    const left = healthAt(w, 40);
    expect(left).toBeLessThan(1);
    until(w, () => t.headTile!.x < 30);
    expect(t.state).toBe('moving');
    expect(healthAt(w, 40)).toBe(left);
  });

  it('taken off the mode on the way to a job, it does not run on to it', () => {
    const { w, stops } = workLine();
    wearDown(w, 80, 0.2);
    const t = maintTrain(w, stops);
    until(w, () => t.headTile!.x > 26);
    expect(w.fleet.setMode(t, 'schedule')).toEqual({ ok: true });
    expect(t.maint).toBeNull();
    let far = 0;
    until(w, () => {
      far = Math.max(far, t.headTile!.x);
      return t.headTile!.x < 20;
    });
    expect(far).toBeLessThan(30);
  });

  it('taken off the mode for one with nothing to pick, it stops there and idles', () => {
    const { w, stops } = workLine();
    wearDown(w, 80, 0.2);
    const t = maintTrain(w, stops);
    until(w, () => t.headTile!.x > 26);
    expect(w.fleet.setMode(t, 'freight')).toEqual({ ok: true });
    expect(w.fleet.chooseNext(t)).toBeNull();
    expect(t.state).toBe('idle');
    expect(t.pathTotal).toBe(0);
    const at = t.headTile!.x;
    const from = w.clock.time;
    until(w, () => w.clock.time > from + 5);
    expect(t.headTile!.x).toBe(at);
  });

  it('backing off for a train, it finishes the move when taken off the mode', () => {
    const { w, stops } = workLine();
    wearDown(w, 80, 0.2);
    const t = maintTrain(w, stops);
    until(w, () => t.headTile!.x > 26);
    t.holding = true;
    const way = t.pathTotal;
    t.leaveWork();
    expect(t.state).toBe('moving');
    expect(t.pathTotal).toBe(way);
    t.holding = false;
  });

  it('given a stop list it leaves the mode and frees its claim', () => {
    const { w, stops } = workLine();
    const commands = new Commands({
      fleet: w.fleet,
      builder: w.builder,
      economy: w.economy,
      trade: w.trade,
      inventory: w.inventory,
      towns: w.towns,
      houses: w.houses,
      contracts: w.contracts,
      contractJobs: w.contractJobs,
      clock: w.clock,
    });
    wearDown(w, 40, 0.2);
    const t = maintTrain(w, stops);
    until(w, repairing(t));
    expect(commands.setSchedule(t, stops.map(defaultStop))).toEqual({ ok: true });
    expect(t.mode).toBe('schedule');
    expect(t.maint).toBeNull();
    expect(t.state).not.toBe('repairing');
    const next = maintTrain(w, stops);
    expect(next.maint?.ax).toBe(40);
    until(w, () => t.atStation?.id === stops[0], 120);
  });

  it('a train that loses its wagon drops the job', () => {
    const { w, stops } = workLine();
    wearDown(w, 40, 0);
    const t = maintTrain(w, stops);
    until(w, repairing(t));
    t.wagons = [];
    until(w, () => t.mode !== 'maintenance');
    expect(t.maint).toBeNull();
    expect(t.state).not.toBe('repairing');
  });

  it('pays its crew at the nearest store on finishing a job, however far', () => {
    const { w, store, stops } = workLine();
    store.add('food', 100);
    const food = store.get('food');
    wearDown(w, 80, 0.2);
    const t = maintTrain(w, stops);
    until(w, repairing(t));
    t.owed.food = 5;
    until(w, () => t.maint === null);
    expect(t.owed.food).toBeLessThan(1);
    expect(store.get('food')).toBeLessThan(food - 4);
  });

  it('pays its crew on reaching its waiting place, and as it waits there', () => {
    const { w, store, stops } = workLine();
    store.add('food', 100);
    const t = maintTrain(w, stops);
    t.owed.food = 5;
    until(w, () => t.state === 'idle');
    const paid = store.get('food');
    expect(t.owed.food).toBeLessThan(1);
    const from = w.clock.time;
    until(w, () => w.clock.time > from + 3 * daySeconds(), 3 * daySeconds() + 1);
    expect(t.state).toBe('idle');
    expect(t.hungry).toBe(false);
    expect(store.get('food')).toBeLessThan(paid);
  });

  it('a piece taken away under the job ends it', () => {
    const { w, stops } = workLine();
    wearDown(w, 30, 0.4);
    wearDown(w, 40, 0.2);
    const t = maintTrain(w, stops);
    until(w, repairing(t));
    expect(t.maint?.ax).toBe(40);
    cut(w, 40);
    until(w, () => t.maint?.ax === 30);
  });

  it('waits with a notice when no store can pay', () => {
    const { w, store, stops } = workLine();
    rules.trackRepairPrice = 10;
    wearDown(w, 40, 0);
    const piece = w.track.get(40, 30)!;
    const t = maintTrain(w, stops);
    until(w, repairing(t));
    const goods = Object.keys(w.builder.wear.repairDue(piece, 1));
    const held = goods.map((k) => store.get(k));
    const notices = () => {
      w.notices.refresh({
        trains: w.fleet.trains,
        builder: w.builder,
        power: w.power,
        wear: w.builder.wear,
      });
      return w.notices.list.filter((n) => n.key === `t${t.id}:repairfunds`);
    };
    expect(notices()).toEqual([]);
    for (const k of goods) store.amounts.set(k, 0);
    until(w, () => t.repairUnpaid);
    const stuck = piece.wear.health;
    const stood = w.clock.time;
    until(w, () => w.clock.time > stood + 5);
    expect(piece.wear.health).toBe(stuck);
    expect(t.state).toBe('repairing');
    const [n] = notices();
    expect(n.text).toBe(STR.notice.repairUnpaid(t.name));
    expect(n.target).toEqual({ kind: 'train', id: t.id });
    goods.forEach((k, i) => store.amounts.set(k, held[i]));
    until(w, () => piece.wear.health > stuck);
    expect(t.repairUnpaid).toBe(false);
    expect(notices()).toEqual([]);
  });

  it('goes to its depot with no work and looks again every 30 seconds', () => {
    const { w, stops } = workLine();
    wearDown(w, 40, 0.2);
    const t = maintTrain(w, stops);
    until(w, () => healthAt(w, 40) >= 1);
    until(w, () => t.state === 'idle');
    const home = t.headTile;
    expect(home).toEqual(t.parkAt);
    expect(home!.x).toBeGreaterThanOrEqual(GATE + Math.ceil(t.length) + 1);
    expect(t.maint).toBeNull();
    const looks = vi.spyOn(w.fleet.maintenance, 'pick');
    const from = w.clock.time;
    until(w, () => w.clock.time > from + 91);
    expect(looks.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(looks.mock.calls.length).toBeLessThanOrEqual(4);
    expect(t.headTile).toEqual(home);
    wearDown(w, 30, 0.2);
    until(w, repairing(t), 60);
    expect(t.headTile).toEqual({ x: 30, y: 30 });
  });

  it('looks for work on the way too, every 30 seconds', () => {
    const { w, stops } = workLine();
    wearDown(w, 80, 0.2);
    const t = maintTrain(w, stops);
    until(w, () => healthAt(w, 80) >= 1, 900);
    until(w, () => t.state === 'moving' && t.parkAt !== null);
    wearDown(w, 15, 0.2);
    const looks = vi.spyOn(w.fleet.maintenance, 'pick');
    const from = w.clock.time;
    until(w, () => t.maint?.ax === 15, 31);
    expect(t.parkAt).toBeNull();
    expect(looks.mock.calls.length).toBeLessThanOrEqual(2);
    expect(w.clock.time - from).toBeGreaterThan(0);
    until(w, repairing(t));
    expect(t.headTile).toEqual({ x: 15, y: 30 });
  });

  it('on the way it looks past its head only: work behind it waits until it stands', () => {
    const { w, stops } = workLine();
    wearDown(w, 80, 0.2);
    const t = maintTrain(w, stops);
    until(w, () => healthAt(w, 80) >= 1, 900);
    until(w, () => t.state === 'moving' && t.parkAt !== null);
    wearDown(w, 85, 0.2);
    const facing = t.reversed;
    until(
      w,
      () => {
        expect(t.maint).toBeNull();
        expect(t.reversed).toBe(facing);
        return t.state === 'idle';
      },
      900,
    );
    expect(t.headTile).toEqual(t.parkAt);
    until(w, () => t.maint?.ax === 85, 31);
    until(w, repairing(t), 900);
    expect(t.headTile).toEqual({ x: 85, y: 30 });
  });

  it('on the way home with nothing new it runs on to its place', () => {
    const { w, stops } = workLine();
    wearDown(w, 80, 0.2);
    const t = maintTrain(w, stops);
    until(w, () => healthAt(w, 80) >= 1, 900);
    until(w, () => t.state === 'idle', 900);
    expect(t.headTile).toEqual(t.parkAt);
  });

  it('with no depot in reach it stands and looks again', () => {
    const { w, stops } = workLine();
    wearDown(w, 40, 0.2);
    const t = maintTrain(w, stops);
    until(w, repairing(t));
    cut(w, 20);
    until(w, () => t.state === 'idle');
    expect(t.maint).toBeNull();
    wearDown(w, 50, 0.2);
    until(w, repairing(t), 60);
    expect(t.maint?.ax).toBe(50);
  });

  it('a train given the mode on the line sets off at once', () => {
    const { w, stops } = workLine();
    const t = maintTrain(w, stops, 'schedule');
    until(w, () => t.headTile!.x > 10);
    wearDown(w, 8, 0.2);
    expect(w.fleet.setMode(t, 'maintenance')).toEqual({ ok: true });
    expect(t.maint?.ax).toBe(8);
    until(w, repairing(t));
    expect(t.headTile).toEqual({ x: 8, y: 30 });
  });

  it('runs on to its job and repairs after a save', () => {
    const { w, stops } = workLine();
    wearDown(w, 40, 0);
    const t = maintTrain(w, stops);
    until(w, () => t.headTile!.x > 20);
    const saved = JSON.parse(JSON.stringify(t.toJSON())) as ReturnType<Train['toJSON']>;
    expect(saved.maint).toEqual(t.maint);
    const back = Train.fromJSON(saved, w.track);
    expect(back.maint).toEqual(t.maint);
    w.fleet.trains[0] = back;
    until(w, () => back.pathTotal > 0);
    expect(back.state).toBe('moving');
    until(w, repairing(back));
    expect(back.headTile).toEqual({ x: 39, y: 30 });
    // the claim came back with it
    expect(w.fleet.maintenance.pick(onlooker(), w.track)).toBeNull();
  });

  it('a save keeps what it owes, and a file without it owes nothing', () => {
    const { w, stops } = workLine();
    const t = maintTrain(w, stops);
    t.repairOwed = { wood: 0.25 };
    expect(Train.fromJSON(t.toJSON(), w.track).repairOwed).toEqual({ wood: 0.25 });
    t.repairOwed = {};
    const none = t.toJSON();
    expect('repairOwed' in none).toBe(false);
    expect('maint' in none).toBe(false);
    expect(Train.fromJSON(none, w.track).maint).toBeNull();
  });

  it('a file with a broken job or debt loads without them', () => {
    const { w, stops } = workLine();
    const j = maintTrain(w, stops).toJSON();
    const job = { ax: 40, ay: 30, tier: 1, x: 40, y: 30 } as const;
    const load = (maint: unknown, repairOwed: unknown) =>
      Train.fromJSON({ ...j, maint, repairOwed } as typeof j, w.track);
    expect(load(job, { wood: 0.5 }).maint).toEqual(job);
    expect(load({ ...job, tier: 3 }, undefined).maint).toBeNull();
    expect(load({ ...job, ax: 'a' }, undefined).maint).toBeNull();
    expect(load({ ...job, x: Number.NaN }, undefined).maint).toBeNull();
    expect(load('job', undefined).maint).toBeNull();
    expect(load(null, { wood: 0.5, iron: -1, stone: Number.NaN, sand: 'x' }).repairOwed).toEqual({
      wood: 0.5,
    });
    expect(load(null, 'owed').repairOwed).toEqual({});
  });

  it('is offered no contract', () => {
    const { w, stops } = workLine();
    const t = maintTrain(w, stops);
    t.wagons.push({
      uid: 91,
      def: wagonDef('flatbed'),
      level: 0,
      cargo: null,
      amount: 0,
      origin: null,
    });
    const [a, b] = stops.map((id) => w.builder.stationById(id)!);
    const c = { cargo: 'wheat', originId: a.id, destId: b.id } as unknown as Contract;
    expect(w.contractJobs.canWork(c, a, b)).toBe(false);
    t.mode = 'freight';
    expect(w.contractJobs.canWork(c, a, b)).toBe(true);
  });
});

/**
 * A depot at the west end of a Branch line with a stop `near` on x 39 and 40 and a stop further out
 * each way. With `sidings`, two dead ends running south: under x 36, from a switch just short of
 * `near`, which a train heading west turns into and leaves heading east, and under x 47, which a
 * train heading east turns into and leaves heading west.
 */
function sidedLine(sidings = true) {
  rules.trackWearMul = 0;
  const w = simWorld({ terrain: 'grass', size: 96 });
  const store = depotWith(
    w,
    { ...startStock(), wood: 1000, stone: 1000, iron: 1000 },
    { x: 4, y: 30 },
  );
  line(w, 6, 30, 90);
  if (sidings) {
    for (const x of [36, 37, 46, 47]) w.track.remove(x, 30);
    w.track.place(36, 30, 'switch', 1, 'branch');
    w.track.place(46, 30, 'switch', 7, 'branch');
    for (let y = 32; y <= 42; y++) {
      w.track.place(36, y, 'straight', 0, 'branch');
      w.track.place(47, y, 'straight', 0, 'branch');
    }
  }
  return {
    w,
    store,
    west: station(w, 'warehouse', 12, 29).id,
    near: station(w, 'warehouse', 39, 29).id,
    east: station(w, 'warehouse', 70, 29).id,
  };
}
/** A train that stands at the stop `from` until `release`, then goes on to `to`. */
function heldAt(w: SimWorld, from: number, to: number) {
  const stay: StopPlan = { ...defaultStop(from), unload: 'none', waitFull: true };
  const loco = w.inventory.add('adler', 0).uid;
  const t = w.fleet.create([loco], [w.inventory.add('flatbed', 0).uid], [stay, defaultStop(to)]);
  if (typeof t === 'string') throw new Error(t);
  until(w, () => t.atStation?.id === from, 120);
  return {
    t,
    release: () => {
      t.schedule[0].waitFull = false;
    },
  };
}
/** Steps the world for `seconds` game seconds, `each` run after every step. */
function run(w: SimWorld, seconds: number, each: () => void) {
  const end = w.clock.time + seconds;
  until(
    w,
    () => {
      each();
      return w.clock.time >= end;
    },
    seconds + 1,
  );
}

describe('a maintenance train in traffic', () => {
  const job = (tier: 0 | 1 | 2) => ({ ax: 40, ay: 30, tier, x: 40, y: 30 });

  it('ranks above every class on an unusable piece, and below every class on any other', () => {
    const { w } = workLine();
    const t = onlooker();
    expect(trafficRank(t, w.track)).toBe(classRank(t.trainClass));
    t.maint = job(2);
    wearDown(w, 40, 0);
    expect(trafficRank(t, w.track)).toBe(4);
    wearDown(w, 40, 0.2);
    expect(trafficRank(t, w.track)).toBe(0);
    wearDown(w, 40, 0.4);
    expect(trafficRank(t, w.track)).toBe(0);
    t.maint = null;
    t.parkAt = { x: 8, y: 30 };
    expect(trafficRank(t, w.track)).toBe(classRank(t.trainClass));
  });

  it('a job begun on an unusable piece keeps its rank until the piece is out of degraded', () => {
    const { w } = workLine();
    const t = onlooker();
    t.maint = job(0);
    wearDown(w, 40, 0.01);
    expect(trafficRank(t, w.track), 'barely mended').toBe(4);
    wearDown(w, 40, rules.trackDegradedAt - 0.01);
    expect(trafficRank(t, w.track), 'just under').toBe(4);
    wearDown(w, 40, rules.trackDegradedAt);
    expect(trafficRank(t, w.track), 'out of degraded').toBe(0);
    wearDown(w, 40, 0.9);
    expect(trafficRank(t, w.track), 'mended past the tiers').toBe(0);
    cut(w, 40);
    expect(trafficRank(t, w.track), 'taken away').toBe(0);
  });

  it('a job begun on a usable piece ranks last until the piece fails', () => {
    const { w } = workLine();
    const t = onlooker();
    for (const tier of [1, 2] as const) {
      t.maint = job(tier);
      wearDown(w, 40, 0.01);
      expect(trafficRank(t, w.track), `tier ${tier}, usable`).toBe(0);
      wearDown(w, 40, 0);
      expect(trafficRank(t, w.track), `tier ${tier}, failed since it was picked`).toBe(4);
    }
  });

  it('a train heading for an unusable piece goes first', () => {
    const { w, west, near } = sidedLine();
    const other = heldAt(w, near, west);
    wearDown(w, 60, 0);
    const t = maintTrain(w, []);
    expect(t.maint?.ax).toBe(60);
    until(w, () => t.blockedBy === other.t.id, 120);
    other.release();
    until(w, repairing(t), 120);
    expect(t.yieldCount).toBe(0);
    expect(other.t.yieldCount).toBeGreaterThan(0);
  });

  it('at work on a piece still unusable it is not backed off', () => {
    const { w, west, near } = sidedLine();
    // a repair that gets nowhere: the piece stays as it is
    rules.trackRepairSeconds = Infinity;
    wearDown(w, 42, 0);
    const t = maintTrain(w, []);
    until(w, repairing(t));
    const at = t.headTile;
    const other = maintTrain(w, [near, west], 'schedule');
    until(w, () => other.blockedBy === t.id, 120);
    run(w, 20, () => {
      expect(t.state).toBe('repairing');
      expect(t.maint?.ax).toBe(42);
    });
    expect(healthAt(w, 42)).toBe(0);
    expect(t.headTile).toEqual(at);
    expect(t.yieldCount).toBe(0);
    expect(other.blockedBy).toBe(t.id);
  });

  it('a job begun on an unusable piece gives way only once the piece is out of degraded', () => {
    const { w, west, near } = sidedLine();
    rules.trackRepairSeconds = 400;
    wearDown(w, 42, 0);
    const t = maintTrain(w, []);
    until(w, repairing(t));
    expect(t.maint?.tier).toBe(0);
    const other = maintTrain(w, [near, west], 'schedule');
    until(w, () => other.blockedBy === t.id, 120);
    until(w, () => other.blockedTime > rules.trackYieldSeconds + 3, 20);
    expect(healthAt(w, 42), 'held past the yield time, still degraded').toBeGreaterThan(0);
    expect(healthAt(w, 42)).toBeLessThan(rules.trackDegradedAt);
    expect(t.state).toBe('repairing');
    expect(t.yieldCount).toBe(0);
    until(w, () => t.maint === null, 200);
    expect(healthAt(w, 42)).toBeGreaterThanOrEqual(rules.trackDegradedAt);
    expect(t.yieldCount).toBe(1);
  });

  /** Posts facing east at x 22 and x 44: a train held at the first while another is in the block. */
  function posted(w: SimWorld) {
    const signal = (x: number) => ({ id: 'signal', x, y: 30, rot: Dir.E });
    w.fleet.signals.rebuild([signal(22), signal(44)] as unknown as Parameters<
      typeof w.fleet.signals.rebuild
    >[0]);
  }

  it('a train held at a post with it on the route ahead makes it pull aside too', () => {
    const { w, west, near } = sidedLine();
    posted(w);
    rules.trackRepairSeconds = 200;
    wearDown(w, 41, 0.2);
    const t = maintTrain(w, []);
    until(w, repairing(t));
    const other = maintTrain(w, [near, west], 'schedule');
    until(w, () => other.blocked && other.speed === 0, 120);
    expect(other.blockedBy).toBeNull();
    expect(other.claimBlocker).toBeNull();
    until(w, () => t.maint === null, 20);
    expect(t.yieldCount).toBe(1);
  });

  it('a train held at a post with it nowhere on the route ahead leaves it at work', () => {
    const { w, west } = sidedLine();
    const short = station(w, 'warehouse', 28, 29).id;
    posted(w);
    rules.trackRepairSeconds = 200;
    wearDown(w, 41, 0.2);
    const t = maintTrain(w, []);
    until(w, repairing(t));
    const other = maintTrain(w, [short, west], 'schedule');
    until(w, () => other.blocked && other.speed === 0, 120);
    until(w, () => other.blockedTime > rules.trackYieldSeconds + 3, 20);
    expect(t.state).toBe('repairing');
    expect(t.yieldCount).toBe(0);
  });

  it('heading for an unusable piece it backs off only for a train that has no way aside', () => {
    const { w, west, near } = sidedLine(false);
    wearDown(w, 42, 0);
    const other = heldAt(w, near, west);
    const t = maintTrain(w, []);
    until(w, () => t.blockedBy === other.t.id, 120);
    // the failed piece at its back, and this train before it: the other could only stand there
    other.release();
    until(w, () => other.t.atStation?.id === west, 120);
    expect(t.yieldCount).toBeGreaterThan(0);
    expect(other.t.yieldCount).toBe(0);
    expect(t.maint?.ax).toBe(42);
  });

  it('on degraded track it gives way, and a train held 5 s by it makes it pull aside', () => {
    const { w, west, near } = sidedLine();
    rules.trackRepairSeconds = 200;
    wearDown(w, 41, 0.2);
    const t = maintTrain(w, []);
    until(w, repairing(t));
    const other = maintTrain(w, [near, west], 'schedule');
    until(w, () => other.blockedBy === t.id, 120);
    let held = 0;
    until(
      w,
      () => {
        if (t.state === 'repairing') held = other.blockedTime;
        return t.state !== 'repairing';
      },
      20,
    );
    expect(held).toBeCloseTo(rules.trackYieldSeconds, 0);
    // the job stays claimed by nobody, partial health stays
    expect(t.maint).toBeNull();
    const left = healthAt(w, 41);
    expect(left).toBeGreaterThan(0.2);
    expect(w.fleet.maintenance.peek(t, w.track)?.ax).toBe(41);
    until(w, () => t.state === 'idle', 60);
    // in a siding, off the line
    expect(t.headTile!.x).toBe(47);
    expect(t.headTile!.y).toBeGreaterThan(31);
    expect(healthAt(w, 41)).toBe(left);
    // it picks again after
    until(w, repairing(t), 120);
    expect(t.maint?.ax).toBe(41);
    expect(t.headTile).toEqual({ x: 41, y: 30 });
  });

  it('with no way aside it works on to the end', () => {
    rules.trackWearMul = 0;
    const w = simWorld({ terrain: 'grass', size: 96 });
    depotWith(w, { ...startStock(), wood: 1000, stone: 1000, iron: 1000 }, { x: 4, y: 30 });
    line(w, 6, 30, 40);
    const west = station(w, 'warehouse', 12, 29).id;
    const near = station(w, 'warehouse', 36, 29).id;
    rules.trackRepairSeconds = 60;
    wearDown(w, 34, 0.2);
    const t = maintTrain(w, []);
    until(w, repairing(t));
    const other = maintTrain(w, [near, west], 'schedule');
    until(w, () => other.blockedBy === t.id, 120);
    until(w, () => healthAt(w, 34) >= 1, 80);
    expect(t.yieldCount).toBe(0);
  });

  it('a degraded job finishes when traffic lets it', () => {
    const { w, west, near } = sidedLine();
    rules.trackRepairSeconds = 200;
    wearDown(w, 41, 0.2);
    const t = maintTrain(w, []);
    until(w, () => t.headTile!.x > 20);
    const other = heldAt(w, west, near);
    until(w, repairing(t), 120);
    other.release();
    until(w, () => t.maint === null, 120);
    expect(healthAt(w, 41)).toBeLessThan(rules.trackCloseAt);
    // one trip, and the other train stands at its stop again
    other.t.schedule[0].waitFull = true;
    until(w, () => healthAt(w, 41) >= 1, 400);
    expect(t.yieldCount).toBe(1);
  });

  it('a train shuttling over the line does not keep it off the piece', () => {
    const { w, west, east } = sidedLine();
    const other = maintTrain(w, [west, east], 'schedule');
    until(w, () => other.atStation?.id === east, 200);
    wearDown(w, 41, 0.2);
    maintTrain(w, []);
    until(w, () => healthAt(w, 41) >= rules.trackCloseAt, 100);
  });

  /** A worker on the failed piece at 42 that no store can pay, and a train it holds up. */
  function unpaid() {
    const { w, store, west, near } = sidedLine();
    rules.trackRepairPrice = 10;
    wearDown(w, 42, 0);
    const t = maintTrain(w, []);
    until(w, repairing(t));
    for (const k of Object.keys(w.builder.wear.repairDue(w.track.get(42, 30)!, 1)))
      store.amounts.set(k, 0);
    until(w, () => t.repairUnpaid);
    return { w, t, other: maintTrain(w, [near, west], 'schedule') };
  }

  it('unpaid on an urgent job it ranks last', () => {
    const { w, t } = unpaid();
    expect(t.maint?.tier).toBe(0);
    expect(trafficRank(t, w.track)).toBe(0);
  });

  it('unpaid on an urgent job it gives way like any job', () => {
    const { w, t, other } = unpaid();
    const left = healthAt(w, 42);
    until(w, () => other.blockedBy === t.id, 120);
    until(w, () => t.state !== 'repairing', other.blockedTime + rules.trackYieldSeconds + 3);
    expect(t.maint).toBeNull();
    expect(t.yieldCount).toBe(1);
    expect(healthAt(w, 42)).toBe(left);
  });

  it('a job let go takes its unpaid note with it', () => {
    const { w, stops } = workLine();
    wearDown(w, 40, 0.2);
    const t = maintTrain(w, stops);
    t.repairUnpaid = true;
    w.fleet.maintenance.release(t);
    expect(t.repairUnpaid).toBe(false);
  });
});

/** A train of an Adler and a flatbed, on its way east, stopped by a piece failing at `x`. */
function stoppedBy(w: SimWorld, x: number, from: number, to: number) {
  const loco = w.inventory.add('adler', 0).uid;
  const t = w.fleet.create([loco], [w.inventory.add('flatbed', 0).uid], [from, to]);
  if (typeof t === 'string') throw new Error(t);
  until(w, () => t.headTile!.x >= x - 6 && t.state === 'moving', 200);
  wearDown(w, x, 0);
  until(w, () => t.state === 'noRoute' && t.speed === 0, 60);
  return t;
}

describe('a maintenance train and a train stopped at the break', () => {
  const SLOW = { timeout: 60_000 };
  const tilesUnder = (w: SimWorld, t: Train) =>
    t.occupancyKeys(w.track.w).map((k) => k % w.track.w);

  /** The worker mends the piece, and the stopped train goes on over it by itself. */
  function bothGoOn(w: SimWorld, x: number, stopped: Train) {
    expect(stopped.headTile).toEqual({ x: x - 1, y: 30 });
    const t = maintTrain(w, []);
    expect(t.maint?.ax).toBe(x);
    until(w, repairing(t), 200);
    until(w, () => stopped.headTile!.x > x, 120);
    expect(stopped.yieldCount, 'the stopped train is not backed off').toBe(0);
    until(w, () => healthAt(w, x) >= 1, 120);
    until(w, () => t.maint === null && t.state !== 'repairing', 30);
    return t;
  }

  it('on a plain line a worker behind it mends the piece and both go on', SLOW, () => {
    const { w, west, east } = sidedLine(false);
    const t = bothGoOn(w, 50, stoppedBy(w, 50, west, east));
    until(w, () => t.state === 'idle', 200);
  });

  it('the worker comes right up behind the train', SLOW, () => {
    const { w, west, east } = sidedLine(false);
    const stopped = stoppedBy(w, 50, west, east);
    const t = maintTrain(w, []);
    until(w, repairing(t), 200);
    expect(t.headTile!.x).toBeGreaterThanOrEqual(Math.min(...tilesUnder(w, stopped)) - 2);
    expect(stopped.state).toBe('noRoute');
  });

  it.each([50, 57, 64])('with sidings on the way a break at %i is mended too', SLOW, (x) => {
    const { w, west, east } = sidedLine();
    const t = bothGoOn(w, x, stoppedBy(w, x, west, east));
    until(w, () => t.state === 'idle', 200);
  });

  it('any train may close up behind one with no way on', SLOW, () => {
    const { w, west, east } = sidedLine(false);
    const stopped = stoppedBy(w, 50, west, east);
    wearDown(w, 50, 1);
    stopped.coal = 0;
    stopped.water = 0;
    until(w, () => stopped.state === 'noFuel', 30);
    const behind = maintTrain(w, [west, east], 'schedule');
    until(w, () => behind.blockedBy === stopped.id && behind.speed === 0, 200);
    expect(behind.headTile!.x).toBeGreaterThanOrEqual(Math.min(...tilesUnder(w, stopped)) - 2);
  });

  it('a train with no way on holds only its own tiles', SLOW, () => {
    const { w, west, east } = sidedLine(false);
    const stopped = stoppedBy(w, 50, west, east);
    const tiles = stopped.occupancyKeys(w.track.w);
    expect([...w.fleet.traffic.claims.keys()].sort()).toEqual([...new Set(tiles)].sort());
  });

  /** Posts facing east at x 22 and x 44, the block past the second holding the stopped train. */
  const posts = (w: SimWorld) => {
    const signal = (x: number) => ({ id: 'signal', x, y: 30, rot: Dir.E });
    w.fleet.signals.rebuild([signal(22), signal(44)] as unknown as Parameters<
      typeof w.fleet.signals.rebuild
    >[0]);
  };

  it('held at a post behind the train it mends the piece from there', SLOW, () => {
    const { w, west, east } = sidedLine(false);
    posts(w);
    const stopped = stoppedBy(w, 50, west, east);
    const t = bothGoOn(w, 50, stopped);
    expect(t.yieldCount).toBe(0);
  });

  it('held at a post with a switch between it and the train it mends the piece too', SLOW, () => {
    const { w, west, east } = sidedLine();
    posts(w);
    const stopped = stoppedBy(w, 42, west, east);
    const t = bothGoOn(w, 42, stopped);
    expect(t.yieldCount).toBe(0);
  });

  it('held at a post with a train at its stop first on its way it does not start', SLOW, () => {
    const { w, west, near } = sidedLine(false);
    posts(w);
    wearDown(w, 80, 0);
    const other = heldAt(w, near, west);
    const t = maintTrain(w, []);
    until(w, () => t.blocked && t.speed < 0.005, 200);
    expect(other.t.noWayOn).toBe(false);
    run(w, 2, () => expect(t.state).toBe('moving'));
  });

  it('held by token working behind the train it mends the piece from there', SLOW, () => {
    const { w, west, east } = sidedLine(false);
    posts(w);
    w.fleet.signals.level = 'token';
    const stopped = stoppedBy(w, 50, west, east);
    const t = bothGoOn(w, 50, stopped);
    expect(t.yieldCount).toBe(0);
  });

  it.each(['detour', 'service stop'])('on a %s behind the train it starts nothing', SLOW, (how) => {
    const { w, west, east } = sidedLine(false);
    const stopped = stoppedBy(w, 50, west, east);
    const t = maintTrain(w, []);
    expect(t.maint?.ax).toBe(50);
    if (how === 'detour') t.detour = east;
    else
      (t as unknown as { serviceStop: unknown }).serviceStop = {
        x: 60,
        y: 30,
        fuel: true,
        water: true,
      };
    until(w, () => t.blocked && t.speed < 0.005, 200);
    run(w, 2, () => expect(t.state).toBe('moving'));
    expect(t.maint?.ax).toBe(50);
    expect(healthAt(w, 50)).toBe(0);
    expect(stopped.state).toBe('noRoute');
  });

  it('on a job not urgent it waits behind the train, and starts nothing from there', SLOW, () => {
    const { w, west, east } = sidedLine(false);
    const stopped = stoppedBy(w, 50, west, east);
    // the break is mended by hand as the train stands: it is held by something else now
    stopped.coal = 0;
    stopped.water = 0;
    wearDown(w, 50, 1);
    until(w, () => stopped.state === 'noFuel', 30);
    wearDown(w, 60, 0.2);
    const t = maintTrain(w, []);
    expect(t.maint?.ax).toBe(60);
    until(w, () => t.blockedBy === stopped.id && t.speed === 0, 200);
    run(w, 3, () => expect(t.state).toBe('moving'));
  });

  it.each(['noFuel', 'stranded'] as const)('a worker gone %s drops its claim', SLOW, (how) => {
    const { w } = sidedLine(false);
    wearDown(w, 50, 0);
    const first = maintTrain(w, []);
    until(w, () => first.headTile!.x > 30, 120);
    expect(first.maint?.ax).toBe(50);
    if (how === 'noFuel') {
      first.coal = 0;
      first.water = 0;
    } else cut(w, first.headTile!.x);
    until(w, () => first.state === how, 30);
    expect(first.maint).toBeNull();
    if (how !== 'noFuel') return;
    // the piece is on the board: the next worker takes it, and works from behind the stopped one
    const next = maintTrain(w, []);
    expect(next.maint?.ax).toBe(50);
    until(w, repairing(next), 120);
    until(w, () => healthAt(w, 50) >= 1, 120);
  });

  it('a worker that stopped and gets fuel again looks for work', SLOW, () => {
    const { w } = sidedLine(false);
    wearDown(w, 50, 0.2);
    const t = maintTrain(w, []);
    until(w, () => t.headTile!.x > 30, 120);
    const fuel = { coal: t.coal, water: t.water };
    t.coal = 0;
    t.water = 0;
    until(w, () => t.state === 'noFuel', 30);
    Object.assign(t, fuel);
    until(w, repairing(t), 120);
    expect(t.maint?.ax).toBe(50);
  });

  it('with a way round the train it takes that and reaches the job', SLOW, () => {
    rules.trackWearMul = 0;
    const w = simWorld({ terrain: 'grass', size: 96 });
    depotWith(w, { ...startStock(), wood: 1000, stone: 1000, iron: 1000 }, { x: 4, y: 30 });
    line(w, 6, 30, 90);
    // a passing loop along row 31, its switch blocks at 30 and 50
    for (const x of [30, 31, 50, 51]) w.track.remove(x, 30);
    w.track.place(30, 30, 'switch', 7, 'branch');
    w.track.place(50, 30, 'switch', 1, 'branch');
    line(w, 32, 31, 49);
    expect(w.track.get(30, 30)!.form).toBe('parallel');
    expect(w.track.get(50, 30)!.form).toBe('parallel');
    const west = station(w, 'warehouse', 12, 29).id;
    const east = station(w, 'warehouse', 80, 29).id;
    const other = maintTrain(w, [west, east], 'schedule');
    until(w, () => other.headTile!.x >= 36 && other.state === 'moving', 200);
    expect(other.headTile!.y).toBe(30);
    other.coal = 0;
    other.water = 0;
    until(w, () => other.state === 'noFuel', 30);
    wearDown(w, 70, 0);
    const t = maintTrain(w, []);
    until(w, repairing(t), 200);
    expect(t.headTile).toEqual({ x: 69, y: 30 });
  });
});

describe('the Depot button of the wear window', () => {
  const narrowLine = (w: SimWorld) => {
    for (let x = 30; x <= 68; x++) w.track.place(x, 50, 'straight', 1, 'narrow');
  };
  /** Regular depots at x 4 and x 80, a narrow one at x 70 beside a narrow line along row 50. */
  function depots() {
    const w = simWorld({ terrain: 'grass', size: 96 });
    depotWith(w, startStock(), { x: 4, y: 30 });
    line(w, 6, 30, 78);
    const east = station(w, 'depot', 80, 30);
    const narrow = station(w, 'narrow_depot', 70, 50);
    narrowLine(w);
    return { w, east, narrow };
  }

  it('takes the nearest depot of the gauge of the piece', () => {
    const { w, east, narrow } = depots();
    expect(w.builder.depotForTrack(70, 30)).toBe(east);
    expect(w.builder.depotForTrack(10, 30)?.x).toBe(4);
    expect(w.builder.depotForTrack(32, 50), 'nearer regular depots do not count').toBe(narrow);
  });

  it('with no such depot, or no piece, it has none to name', () => {
    const w = simWorld({ terrain: 'grass', size: 96 });
    depotWith(w, startStock(), { x: 4, y: 30 });
    narrowLine(w);
    expect(w.builder.depotForTrack(40, 50)).toBeUndefined();
    expect(w.builder.depotForTrack(40, 60)).toBeUndefined();
  });
});
