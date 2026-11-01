import { describe, it, expect, beforeEach } from 'vitest';
import { content } from '../data/content';
import { levelMul } from '../gacha/items';
import { depotWith } from '../testing/storeFixtures';
import { line, simWorld, station, type SimWorld } from '../testing/simWorld';
import { consistAccess, consistGauge, gaugeOf } from './compat';
import { DEFAULT_RULES, rules } from './rules';
import { SimStep, startStock, type StepContext } from './step';
import { defaultStop, Train, type StopPlan } from './trains';
import { locoDef, wagonDef } from '../gacha/items';
import type { Station } from './stations';

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
