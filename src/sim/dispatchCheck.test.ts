import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph, makePiece } from '../world/track';
import { Dir } from '../engine/iso';
import { Builder } from './build';
import { Economy } from './economy';
import { Fleet, MAX_LOCOS, MAX_WAGONS } from './fleet';
import { Inventory } from '../gacha/inventory';
import { rules, DEFAULT_RULES } from './rules';
import { Train, resetTrainIds, type StopPlan } from './trains';
import { resetStationIds } from './stations';
import { STR } from '../strings';
import { storeWith } from '../testing/storeFixtures';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  resetTrainIds();
  resetStationIds();
});

/** A narrow depot at (20, 20) with its gates at x 19 and 22, and `reach` tiles of track east of the east gate. */
function world(reach: number) {
  const map = emptyMap(4242, 64, 64, Terrain.Grass);
  const track = new TrackGraph(64, 64);
  const economy = new Economy();
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  const builder = new Builder(map, regions, track, economy, storeWith({}).stores);
  builder.free = true;
  const inventory = new Inventory();
  const fleet = new Fleet(track, builder, map, inventory, economy);
  const depot = builder.placeStation(20, 20, 'narrow_depot', 0)!;
  const ew = [0, 1].find((r) => makePiece('straight', r, 'narrow').links[0].includes(Dir.E))!;
  for (let x = 22; x < 22 + reach; x++) track.place(x, 20, 'straight', ew, 'narrow');
  // a quarry beside the track, so the route has a stop to reach
  const quarry = builder.placeStation(24, 21, 'quarry', 0)!;
  const farm = builder.placeStation(26, 21, 'farm', 0)!;
  return { builder, fleet, inventory, depot, quarry, farm, track };
}

/** What `create` answers, with what it would change put back. */
function created(w: ReturnType<typeof world>, ...args: Parameters<Fleet['create']>) {
  return w.fleet.create(...args);
}

describe('Fleet.dispatchCheck', () => {
  it('lets a consist through that create rolls out, and gives the gate and the stops', () => {
    const w = world(12);
    const rocket = w.inventory.add('rocket', 0);
    const tub = w.inventory.add('mine_tub', 0);
    const check = w.fleet.dispatchCheck([rocket.uid], [tub.uid], [], w.depot.id);
    expect(check.reason).toBeNull();
    expect(check.gate).toEqual({ x: 22, y: 20 });
    expect(check.depot?.id).toBe(w.depot.id);
    expect(check.stops.length).toBeGreaterThanOrEqual(2);
    expect(typeof created(w, [rocket.uid], [tub.uid], [], undefined, 'schedule', w.depot.id)).toBe(
      'object',
    );
  });

  it('changes nothing: no train, no number used, no vehicle taken', () => {
    const w = world(12);
    const rocket = w.inventory.add('rocket', 0);
    const tub = w.inventory.add('mine_tub', 0);
    for (let i = 0; i < 3; i++) w.fleet.dispatchCheck([rocket.uid], [tub.uid], [], w.depot.id);
    expect(w.fleet.trains).toHaveLength(0);
    expect(rocket.assigned).toBeNull();
    expect(tub.assigned).toBeNull();
    // the probe takes no train number: the first train made is number 1
    const t = created(w, [rocket.uid], [tub.uid], [], undefined, 'schedule', w.depot.id);
    expect(typeof t === 'string' ? t : t.id).toBe(1);
  });

  describe('says what create says, for every refusal', () => {
    const cases: [string, (w: ReturnType<typeof world>) => [number[], number[]]][] = [
      ['no engine', (w) => [[], [w.inventory.add('mine_tub', 0).uid]]],
      [
        'too many engines',
        (w) => [Array.from({ length: MAX_LOCOS + 1 }, () => w.inventory.add('rocket', 0).uid), []],
      ],
      [
        'too many wagons',
        (w) => [
          [w.inventory.add('rocket', 0).uid],
          Array.from({ length: MAX_WAGONS + 1 }, () => w.inventory.add('mine_tub', 0).uid),
        ],
      ],
      [
        'an engine already in service',
        (w) => {
          const l = w.inventory.add('rocket', 0);
          l.assigned = 7;
          return [[l.uid], []];
        },
      ],
      [
        'a wagon already in service',
        (w) => {
          const t = w.inventory.add('mine_tub', 0);
          t.assigned = 7;
          return [[w.inventory.add('rocket', 0).uid], [t.uid]];
        },
      ],
      ['an engine that is a wagon', (w) => [[w.inventory.add('mine_tub', 0).uid], []]],
      ['a uid nobody holds', (w) => [[w.inventory.add('rocket', 0).uid], [9999]]],
      [
        'wagons heavier than the engine hauls',
        (w) => [
          [w.inventory.add('rocket', 0).uid],
          Array.from({ length: MAX_WAGONS }, () => w.inventory.add('narrow_box', 0).uid),
        ],
      ],
      [
        'narrow and regular stock together',
        (w) => [[w.inventory.add('rocket', 0).uid], [w.inventory.add('boxcar', 0).uid]],
      ],
      ['an engine no depot of its gauge serves', (w) => [[w.inventory.add('f7', 0).uid], []]],
    ];
    for (const [name, make] of cases)
      it(name, () => {
        const w = world(12);
        const [locos, wagons] = make(w);
        const check = w.fleet.dispatchCheck(locos, wagons, [], w.depot.id);
        expect(check.reason).not.toBeNull();
        // create answers the same words
        expect(created(w, locos, wagons, [], undefined, 'schedule', w.depot.id)).toBe(check.reason);
        expect(w.fleet.trains).toHaveLength(0);
      });

    it('a route that needs two stations, when there is no other', () => {
      const w = world(12);
      w.builder.removeStation(w.quarry);
      w.builder.removeStation(w.farm);
      const rocket = w.inventory.add('rocket', 0);
      const check = w.fleet.dispatchCheck([rocket.uid], [], [], w.depot.id);
      expect(check.reason).toBe(STR.fleet.needTwoStops);
      expect(created(w, [rocket.uid], [], [], undefined, 'schedule', w.depot.id)).toBe(
        check.reason,
      );
    });

    it('a custom route of one stop falls back to the automatic one, as create does', () => {
      const w = world(12);
      const rocket = w.inventory.add('rocket', 0);
      const one: StopPlan[] = [{ ...w.fleet.autoSchedule(w.depot)[0] }];
      const check = w.fleet.dispatchCheck([rocket.uid], [], one, w.depot.id);
      expect(check.reason).toBeNull();
      expect(check.stops.length).toBeGreaterThanOrEqual(2);
      expect(typeof created(w, [rocket.uid], [], one, undefined, 'schedule', w.depot.id)).toBe(
        'object',
      );
    });
  });

  describe('counts the wagons the gate must hold', () => {
    it('refuses a long consist at a gate with a short run, which the engines alone do not', () => {
      // three tiles of track beyond the east gate: room for a short train
      const w = world(3);
      const rocket = w.inventory.add('mav490', 0);
      const tubs = Array.from({ length: MAX_WAGONS }, () => w.inventory.add('mine_tub', 0).uid);
      const alone = w.fleet.dispatchCheck([rocket.uid], [], [], w.depot.id);
      expect(alone.reason).toBeNull();
      // the preview of the engines alone cannot see what the wagons add
      expect(w.fleet.previewSpawn([rocket.uid], [], w.depot.id).reason).toBeNull();
      const long = w.fleet.dispatchCheck([rocket.uid], tubs, [], w.depot.id);
      expect(long.reason).toMatch(/tiles of run/);
      expect(long.gate).toBeNull();
      expect(created(w, [rocket.uid], tubs, [], undefined, 'schedule', w.depot.id)).toBe(
        long.reason,
      );
    });

    it('lets the same consist through where the gate has room', () => {
      const w = world(14);
      const rocket = w.inventory.add('mav490', 0);
      const tubs = Array.from({ length: MAX_WAGONS }, () => w.inventory.add('mine_tub', 0).uid);
      expect(w.fleet.dispatchCheck([rocket.uid], tubs, [], w.depot.id).reason).toBeNull();
      expect(typeof created(w, [rocket.uid], tubs, [], undefined, 'schedule', w.depot.id)).toBe(
        'object',
      );
    });
  });
});

describe('the depot a train belongs to', () => {
  const rolledOut = () => {
    const w = world(8);
    const t = w.fleet.create([w.inventory.add('rocket', 0).uid], [], [], undefined, 'schedule');
    if (typeof t === 'string') throw new Error(t);
    return { ...w, t };
  };

  it('is the one it rolled out of, and a save keeps it', () => {
    const { t, depot, fleet, track } = rolledOut();
    expect(t.depotId).toBe(depot.id);
    expect(fleet.homeDepot(t)).toBe(depot);
    const back = Train.fromJSON(JSON.parse(JSON.stringify(t.toJSON())), track);
    expect(back.depotId).toBe(depot.id);
  });

  it('reads as none from a file written before trains kept it', () => {
    const { t, track } = rolledOut();
    const old = JSON.parse(JSON.stringify(t.toJSON()));
    delete old.depot;
    expect(Train.fromJSON(old, track).depotId).toBeNull();
  });

  it('is nobody for a train that does not say, until the homes are settled', () => {
    const { t, fleet } = rolledOut();
    t.depotId = null;
    expect(fleet.homeDepot(t)).toBeNull();
  });

  it('settles on the depot of its gauge on its rails', () => {
    const { t, depot, builder, fleet } = rolledOut();
    builder.placeStation(40, 40, 'narrow_depot', 0);
    // the depot off its rails stands first in the list
    builder.stations.reverse();
    t.depotId = null;
    expect(builder.depots()[0]).not.toBe(depot);
    fleet.settleHomes();
    expect(t.depotId).toBe(depot.id);
  });

  it('passes to another depot of its gauge when its own is gone', () => {
    const { t, depot, builder, fleet } = rolledOut();
    const other = builder.placeStation(40, 40, 'narrow_depot', 0)!;
    t.depotId = 9999;
    fleet.settleHomes();
    expect(fleet.homeDepot(t)).toBe(depot);
    // not on the map at all: the first of its gauge
    builder.stations.reverse();
    const off = new Train([{ uid: -1, def: t.locos[0].def, level: 1 }], 'off', 77);
    fleet.trains.push(off);
    fleet.settleHomes();
    expect(fleet.homeDepot(off)).toBe(other);
  });

  it('leaves a train with a home alone, and walks no rails for it', () => {
    const { t, depot, fleet } = rolledOut();
    const walk = vi.spyOn(fleet, 'reachableFrom');
    fleet.settleHomes();
    expect(walk).not.toHaveBeenCalled();
    expect(t.depotId).toBe(depot.id);
  });

  it('walks each depot once, however many trains need one', () => {
    const { t, fleet } = rolledOut();
    const second = new Train([{ uid: -1, def: t.locos[0].def, level: 1 }], 'second', 78);
    fleet.trains.push(second);
    t.depotId = second.depotId = null;
    const walk = vi.spyOn(fleet, 'reachableFrom');
    fleet.settleHomes();
    expect(walk).toHaveBeenCalledTimes(1);
  });

  it('reads no track at all when asked for a home', () => {
    const { t, fleet } = rolledOut();
    const walk = vi.spyOn(fleet, 'reachableFrom');
    fleet.homeDepot(t);
    t.depotId = null;
    fleet.homeDepot(t);
    expect(walk).not.toHaveBeenCalled();
  });

  it('is no depot of another gauge, even one that came to hold its old id', () => {
    const { t, builder, fleet } = rolledOut();
    const standard = builder.placeStation(40, 40, 'depot', 0)!;
    t.depotId = standard.id;
    expect(fleet.homeDepot(t)).toBeNull();
    fleet.settleHomes();
    expect(fleet.homeDepot(t)?.def.gauge).toBe('narrow');
  });

  it('is nobody when its gauge has no depot left, whatever other depots stand', () => {
    const { t, depot, builder, fleet } = rolledOut();
    builder.placeStation(40, 40, 'depot', 0);
    builder.stations.splice(builder.stations.indexOf(depot), 1);
    fleet.settleHomes();
    expect(t.depotId).toBeNull();
    expect(fleet.homeDepot(t)).toBeNull();
    // the depot stands again: the train that had no home finds it
    builder.stations.push(depot);
    fleet.settleHomes();
    expect(fleet.homeDepot(t)).toBe(depot);
  });

  it('is nobody with no depot left', () => {
    const { t, builder, fleet } = rolledOut();
    builder.stations.length = 0;
    fleet.settleHomes();
    expect(fleet.homeDepot(t)).toBeNull();
  });

  it('moves nothing: a train is where it was, and rolls on the same', () => {
    const { t, fleet } = rolledOut();
    const before = JSON.stringify(t.toJSON());
    t.depotId = null;
    fleet.settleHomes();
    expect(JSON.stringify(t.toJSON())).toBe(before);
  });
});

describe('what a refusal at the gates cost', () => {
  it('searched nothing for a gate a train stands on', () => {
    const w = world(8);
    const first = w.fleet.create([w.inventory.add('rocket', 0).uid], [], [], undefined);
    expect(typeof first).not.toBe('string');
    const second = w.inventory.add('rocket', 0);
    const check = w.fleet.dispatchCheck([second.uid], [], [], w.depot.id);
    expect(check.reason).not.toBeNull();
    expect(check.gate).toBeNull();
    expect(check.routeFailed).toBe(false);
    expect(w.fleet.previewSpawn([], [], w.depot.id).routeFailed).toBe(false);
  });

  it('searched the track when a gate was free and no route led from it', () => {
    const w = world(8);
    const loco = w.inventory.add('rocket', 0);
    // a stop on no rails of the depot's: the free gate is tried, and leads nowhere
    const away = w.builder.placeStation(40, 40, 'narrow_depot', 0)!;
    w.track.place(42, 40, 'straight', 1, 'narrow');
    const stops = [away.id, away.id];
    const check = w.fleet.dispatchCheck([loco.uid], [], stops, w.depot.id);
    expect(check.reason).not.toBeNull();
    expect(check.routeFailed).toBe(true);
  });

  it('searched nothing for a consist that never reached the gates', () => {
    const w = world(8);
    expect(w.fleet.dispatchCheck([], [], [], w.depot.id).routeFailed).toBe(false);
  });

  it('is no failure for a train that goes', () => {
    const w = world(8);
    const loco = w.inventory.add('rocket', 0);
    const check = w.fleet.dispatchCheck([loco.uid], [], [], w.depot.id);
    expect(check.reason).toBeNull();
    expect(check.routeFailed).toBe(false);
  });
});
