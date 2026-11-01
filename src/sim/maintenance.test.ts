import { describe, it, expect, beforeEach, vi } from 'vitest';
import { content } from '../data/content';
import { levelMul } from '../gacha/items';
import { STR } from '../strings';
import { depotWith } from '../testing/storeFixtures';
import { line, simWorld, station, type SimWorld } from '../testing/simWorld';
import { findPath } from '../world/pathfinding';
import { consistAccess, consistGauge, gaugeOf } from './compat';
import type { Contract } from './contracts';
import { DEFAULT_RULES, rules } from './rules';
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
    const gates = () => w.builder.depots().flatMap((d) => w.builder.platformTiles(d));
    until(w, () => t.state === 'idle' && gates().some((g) => g.x === t.headTile!.x));
    const home = t.headTile;
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
