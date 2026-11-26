import { describe, it, expect, beforeEach, vi } from 'vitest';
import { simWorld, line, type SimWorld } from '../testing/simWorld';
import { townWith } from '../testing/storeFixtures';
import { Dir } from '../engine/iso';
import { locoDef, wagonDef } from '../gacha/items';
import { DEFAULT_RULES, rules } from './rules';
import { DEFAULT_SUPPLY, setSupplyMode } from './supply';
import { DECOR_DEFS, facedTile } from './build';
import { STR } from '../strings';
import { Train, resetTrainIds, type TickCtx } from './trains';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

// The water tower, the coaling stage and the Fuel Pump (#312): each stands with its front on the
// track, hands out only its own fuel from the store that supplies it, and a train that leaves its
// route to refuel stops with its tender, or an engine without one, at the tile the front faces.

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode(DEFAULT_SUPPLY);
  resetTrainIds();
});

const ROW = 20;
const GDT = 0.05;
const grass = (supply?: 'simple' | 'full') => simWorld({ terrain: 'grass', size: 64, supply });
const ctxOf = (w: SimWorld, now = 0) =>
  (w.fleet as unknown as { ctx(n: number, s: number): TickCtx }).ctx(now, 1);
const standing = (w: SimWorld, fn: () => void) => {
  w.builder.free = true;
  fn();
  w.builder.free = false;
};

/** A line along ROW with a stocked town by it, and `loco` on the line at column 40. */
function service(w: SimWorld, id: string, rot: number, loco: string) {
  line(w, 2, ROW, 60);
  const town = townWith(
    w,
    { coal: 1000, water: 1000, oil: 1000, diesel: 1000 },
    { x: 34, y: ROW - 1 },
  );
  const y = rot === 0 ? ROW - 1 : ROW + 1;
  const d = w.builder;
  standing(w, () => expect(d.placeDecor(30, y, id, rot), id).not.toBeNull());
  const t = new Train([{ uid: 1, level: 1, def: locoDef(loco) }]);
  t.wagons = [
    { uid: 2, def: wagonDef('wood_hopper'), level: 1, cargo: null, amount: 0, origin: null },
  ];
  expect(t.spawnAt(w.track, 40, ROW, Dir.E)).not.toBe(false);
  w.fleet.trains.push(t);
  return { t, town, faced: facedTile(30, y, rot) };
}
const detour = (w: SimWorld, t: Train) => t.planFuelDetour(ctxOf(w));
/** Fleet ticks until the train has its service behind it. */
function runToService(w: SimWorld, t: Train, max = 40000) {
  const stop = () => (t as unknown as { serviceStop: unknown }).serviceStop;
  for (let n = 0; n < max && stop(); n++) w.fleet.tick(GDT, (w.clock.time += GDT));
  expect(stop(), 'the train reached the service').toBeNull();
}

describe('a fuel building faces the track', () => {
  it('the front turns S, W, N, E with rotations 0 to 3', () => {
    expect([0, 1, 2, 3].map((r) => facedTile(10, 10, r))).toEqual([
      { x: 10, y: 11 },
      { x: 9, y: 10 },
      { x: 10, y: 9 },
      { x: 11, y: 10 },
    ]);
  });

  it('track on one side gives its rotation, on two sides both, on none nothing', () => {
    const w = grass();
    line(w, 2, ROW, 60);
    expect(w.builder.trackFacingRots(30, ROW - 1)).toEqual([0]);
    expect(w.builder.trackFacingRots(30, ROW + 1)).toEqual([2]);
    expect(w.builder.trackFacingRots(30, ROW + 5)).toEqual([]);
    line(w, 2, ROW + 2, 60);
    expect(w.builder.trackFacingRots(30, ROW + 1)).toEqual([0, 2]);
  });

  it('east and west of a tile count too', () => {
    const w = grass();
    const up = { kind: 'straight', cls: 'branch', cls2: 'branch' } as const;
    standing(w, () => {
      expect(w.builder.placeTrack(31, ROW, up, 0)).toBeTruthy();
      expect(w.builder.placeTrack(29, ROW + 3, up, 0)).toBeTruthy();
    });
    expect(w.builder.trackFacingRots(30, ROW)).toEqual([3]);
    expect(w.builder.trackFacingRots(30, ROW + 3)).toEqual([1]);
  });

  it.each(['water_tower', 'fuel_stop', 'fuel_pump'])('%s stands only facing track', (id) => {
    const w = grass();
    line(w, 2, ROW, 60);
    w.builder.free = true;
    expect(w.builder.checkDecor(30, ROW + 5, id).reason).toBe(STR.build.needTrack);
    expect(w.builder.checkDecor(30, ROW - 1, id, 2).reason).toBe(STR.build.facesTrack);
    expect(w.builder.placeDecor(30, ROW - 1, id, 2)).toBeNull();
    expect(w.builder.placeDecor(30, ROW - 1, id, 0)).not.toBeNull();
  });

  it('every fuel building has the flag, and its street door away from the track', () => {
    for (const id of ['water_tower', 'fuel_stop', 'fuel_pump']) {
      const d = DECOR_DEFS.find((x) => x.id === id)!;
      expect(d.facesTrack, id).toBe(true);
      expect(d.doors?.[0].side, id).toBe('N');
    }
  });

  it('one from an older save, facing no track, still serves every track tile in its radius', () => {
    const w = grass();
    line(w, 2, ROW, 60);
    // standing as an old save may stand it: turned away from the track beside it
    standing(w, () => {
      w.builder.placeDecor(30, ROW - 1, 'water_tower', 0)!.rot = 2;
    });
    const tiles = w.builder.serviceTiles().filter((p) => p.water);
    expect(tiles.map((p) => p.x).sort((a, b) => a - b)).toEqual([28, 29, 30, 31, 32]);
  });
});

describe('where a train refuels', () => {
  it('only the faced tile is a service tile for a detour, a station keeps the radius', () => {
    const w = grass();
    const { faced } = service(w, 'fuel_stop', 0, 'general');
    expect(w.builder.serviceTiles().filter((p) => p.coal)).toEqual([
      expect.objectContaining({ ...faced, faced: true }),
    ]);
    expect(w.builder.serviceAt(faced.x + 2, faced.y).coal, 'the radius still serves').toBe(true);
  });

  it('a steam engine stops with its tender within half a tile of the faced tile', () => {
    const w = grass();
    const { t, faced } = service(w, 'fuel_stop', 0, 'general');
    t.coal = t.coalCap * 0.3;
    t.water = t.waterCap;
    expect(detour(w, t)).toBe(true);
    const L = t.vehicleSpecs[0].L;
    const stop = t.pathAhead().at(-1)!;
    const tender = stop.x + Math.sign(faced.x - stop.x) * L * 0.8;
    expect(Math.abs(tender - faced.x)).toBeLessThanOrEqual(0.5);
    expect(stop.x, 'the head is past the tile').not.toBe(faced.x);
    runToService(w, t);
    expect(t.coal, 'filled there').toBeGreaterThan(t.coalCap * 0.9);
  });

  it('an engine with no tender stops with itself there', () => {
    const w = grass();
    const { t, faced } = service(w, 'fuel_pump', 0, 'f7');
    t.oil = t.oilCap * 0.3;
    expect(detour(w, t)).toBe(true);
    const L = t.vehicleSpecs[0].L;
    const stop = t.pathAhead().at(-1)!;
    expect(Math.abs(stop.x + Math.sign(faced.x - stop.x) * L * 0.5 - faced.x)).toBeLessThanOrEqual(
      0.5,
    );
  });

  it('a train with full tanks does not stop', () => {
    const w = grass();
    const { t } = service(w, 'fuel_stop', 0, 'general');
    t.coal = t.coalCap;
    t.water = t.waterCap;
    expect(detour(w, t)).toBe(false);
  });
});

describe('coal is the only solid fuel', () => {
  it('an engine at a store with wood and no coal does not refuel', () => {
    const w = grass();
    const { t, town } = service(w, 'fuel_stop', 0, 'general');
    town.amounts.set('coal', 0);
    town.amounts.set('wood', 1000);
    t.coal = t.coalCap * 0.3;
    t.water = t.waterCap;
    expect(detour(w, t)).toBe(false);
    const coal = t.coal;
    t.fillUp(town, w.stores.grid, { fuel: true, water: false });
    expect(t.coal).toBe(coal);
    expect(town.get('wood')).toBe(1000);
  });
});

describe('each building hands out its own', () => {
  it('the water tower fills water only', () => {
    const w = grass();
    const { t } = service(w, 'water_tower', 0, 'general');
    t.coal = t.coalCap * 0.8;
    t.water = t.waterCap * 0.3;
    const coal = t.coal;
    expect(detour(w, t)).toBe(true);
    runToService(w, t);
    expect(t.water).toBeGreaterThan(t.waterCap * 0.9);
    expect(t.coal).toBeLessThanOrEqual(coal);
  });

  it('the coaling stage fills coal only', () => {
    const w = grass();
    const { t } = service(w, 'fuel_stop', 0, 'general');
    t.coal = t.coalCap * 0.3;
    t.water = t.waterCap * 0.8;
    const water = t.water;
    expect(detour(w, t)).toBe(true);
    runToService(w, t);
    expect(t.coal).toBeGreaterThan(t.coalCap * 0.9);
    expect(t.water).toBeLessThanOrEqual(water);
  });

  it.each([
    ['simple', 'oil'],
    ['full', 'diesel'],
  ] as const)('a diesel gets its fuel at the Fuel Pump (%s chain)', (supply, kind) => {
    const w = grass(supply);
    const { t, town } = service(w, 'fuel_pump', 0, 'f7');
    t.oil = t.oilCap * 0.3;
    expect(detour(w, t)).toBe(true);
    runToService(w, t);
    expect(t.oil).toBeGreaterThan(t.oilCap * 0.9);
    expect(t.oilKind).toBe(kind);
    expect(town.get(kind)).toBeLessThan(1000);
  });

  it('a diesel gets nothing at a coaling stage', () => {
    const w = grass();
    const { t } = service(w, 'fuel_stop', 0, 'f7');
    t.oil = t.oilCap * 0.3;
    expect(detour(w, t)).toBe(false);
    const oil = t.oil;
    const store = w.stores.fuelSupplierFor(30, ROW)!;
    t.fillUp(store, w.stores.grid, w.builder.serviceAt(30, ROW));
    expect(t.oil).toBe(oil);
  });

  it('a steam engine gets no coal at the Fuel Pump', () => {
    const w = grass();
    const { t } = service(w, 'fuel_pump', 0, 'general');
    t.coal = t.coalCap * 0.3;
    t.water = t.waterCap;
    expect(detour(w, t)).toBe(false);
    const coal = t.coal;
    const store = w.stores.fuelSupplierFor(30, ROW)!;
    t.fillUp(store, w.stores.grid, w.builder.serviceAt(30, ROW));
    expect(t.coal).toBe(coal);
  });
});
