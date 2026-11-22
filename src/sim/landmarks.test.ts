import { beforeEach, describe, expect, it, vi } from 'vitest';
import { landmarkDef } from '../data/content';
import { forAll } from '../testing/property';
import { simWorld, line, station, type SimWorld } from '../testing/simWorld';
import { storesWith } from '../testing/storeFixtures';
import { locoDef, wagonDef } from '../gacha/items';
import { Dir } from '../engine/iso';
import { TrackGraph } from '../world/track';
import type { LandmarkPlacement } from '../world/landmarks';
import { Economy } from './economy';
import { expandSave } from './expand';
import {
  LANDMARK_BOOST_UNIT,
  LANDMARK_REACH,
  LANDMARK_STAGES,
  LandmarkRegistry,
  pickKey,
  type LandmarkEvent,
  type LandmarkStage,
  type LandmarksJSON,
} from './landmarks';
import { DEFAULT_RULES, daySeconds, rules } from './rules';
import { buildSave, type SaveGame, type SaveParts } from './save';
import { pruneUnknownContent } from './saveContent';
import { Station, resetStationIds } from './stations';
import { GameClock } from './time';
import { Train, defaultStop, resetTrainIds, type DeliveryEvent } from './trains';
import type { WindLevel } from './wind';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  resetStationIds(1);
  resetTrainIds(1);
});

/** A save with nothing in it but the landmarks, on a generated world with its origin at 0. */
function bareSave(landmarks: LandmarksJSON): SaveGame {
  return {
    version: 25,
    savedAt: 0,
    seed: 1,
    landmarks,
    world: { kind: 'generated', params: { w: 96, h: 96, originX: 0, originY: 0 } },
    track: [],
    stations: [],
    trains: [],
    camera: { x: 0, y: 0, zoomIndex: 0 },
    economy: { money: 0, tier: 0 },
    contracts: {},
    inventory: { items: [] },
    clock: { time: 0, speedIndex: 1 },
    lastDay: 1,
  } as unknown as SaveGame;
}

/** A registry on a clock, an economy and a depot store at the origin, and what it announced. */
function fixture(amounts: Record<string, number> = {}) {
  const { stores, depots, stations } = storesWith([{ amounts, at: { x: 0, y: 0 } }]);
  const clock = new GameClock();
  const economy = new Economy();
  const wind = { level: 'calm' as WindLevel };
  const reg = new LandmarkRegistry({ clock, economy, stores, windLevel: () => wind.level });
  const events: LandmarkEvent[] = [];
  reg.onEvent = (e) => events.push(e);
  return { reg, clock, economy, stores, depot: depots[0], depotStation: stations[0], wind, events };
}
type Fixture = ReturnType<typeof fixture>;

const place = (id: string, x: number, y: number): LandmarkPlacement => ({ id, x, y, cx: 4, cy: 7 });
/** One landmark of the def at (x, y), brought to `stage` by the route the player takes. */
function stand(f: Fixture, id: string, stage: LandmarkStage, x = 20, y = 20, pick?: string) {
  f.reg.addPlacements([place(id, x, y)]);
  const item = f.reg.items[f.reg.items.length - 1];
  if (stage === 'hidden') return item;
  f.reg.refreshVisibility(() => true);
  if (stage === 'spotted') return item;
  f.reg.onArrive(new Station('station', x + 2, y + 2));
  if (stage === 'surveyed') return item;
  if (stage === 'salvaged') {
    f.reg.salvage(item.id);
    return item;
  }
  f.reg.start(item.id, pick);
  if (stage === 'restoring') return item;
  expect(stage).toBe('restored');
  for (const [cargo, n] of Object.entries(landmarkDef(id)!.restore.needs))
    f.reg.credit(delivery(new Station('station', x + 2, y + 2), cargo, n));
  return item;
}
function delivery(station: Station, cargo: string, amount: number): DeliveryEvent {
  return { cargo, amount, origin: -1, station, train: null as unknown as Train };
}

describe('placing and discovering', () => {
  it('takes placements in hidden, numbers them from 1 and does not take one twice', () => {
    const { reg } = fixture();
    const p = place('bellkeepers_refuge', 10, 12);
    reg.addPlacements([p, place('inverted_manor', 30, 30)]);
    reg.addPlacements([p]);
    expect(reg.items.map((i) => [i.id, i.def, i.stage, i.region])).toEqual([
      [1, 'bellkeepers_refuge', 'hidden', [1, 2]],
      [2, 'inverted_manor', 'hidden', [1, 2]],
    ]);
  });

  it('spots a landmark when its chunk is revealed, and never hides it again', () => {
    const { reg } = fixture();
    reg.addPlacements([place('bellkeepers_refuge', 10, 12), place('inverted_manor', 50, 50)]);
    reg.refreshVisibility((x) => x < 20);
    expect(reg.items.map((i) => i.stage)).toEqual(['spotted', 'hidden']);
    reg.refreshVisibility(() => false);
    expect(reg.items.map((i) => i.stage)).toEqual(['spotted', 'hidden']);
  });

  it('surveys a spotted landmark when a train stops within 7 tiles of its footprint', () => {
    const f = fixture();
    // the manor is 1x1 at (20, 20); a station 1x1 at x = 20 + 7 is within reach, one at 8 is not
    const item = stand(f, 'inverted_manor', 'spotted');
    f.reg.onArrive(new Station('station', 20 + LANDMARK_REACH + 1, 20));
    expect(item.stage).toBe('spotted');
    f.reg.onArrive(new Station('station', 20 + LANDMARK_REACH, 20 - LANDMARK_REACH));
    expect(item.stage).toBe('surveyed');
    expect(f.events.map((e) => e.kind)).toEqual(['spotted', 'surveyed']);
  });

  it('measures reach from the footprint, not its corner', () => {
    const f = fixture();
    // the bathhouse is 3x2: its far corner is at (22, 21)
    const item = stand(f, 'overgrown_bathhouse', 'spotted');
    f.reg.onArrive(new Station('station', 22 + LANDMARK_REACH, 21));
    expect(item.stage).toBe('surveyed');
  });

  it('does not survey a hidden landmark', () => {
    const f = fixture();
    const item = stand(f, 'inverted_manor', 'hidden');
    f.reg.onArrive(new Station('station', 20, 20));
    expect(item.stage).toBe('hidden');
  });
});

describe('the choices', () => {
  it('starts a restore only from surveyed, and a pick only where there is one', () => {
    const f = fixture();
    const manor = stand(f, 'inverted_manor', 'spotted');
    expect(f.reg.start(manor.id)).toEqual({ ok: false, reason: 'stage' });
    f.reg.onArrive(new Station('station', 21, 21));
    expect(f.reg.start(manor.id, 'boost')).toEqual({ ok: false, reason: 'pick' });
    expect(f.reg.start(manor.id)).toEqual({ ok: true });
    expect(manor).toMatchObject({
      stage: 'restoring',
      path: 'restore',
      delivered: { stone: 0, iron: 0, wood: 0 },
    });
    expect(f.reg.start(manor.id)).toEqual({ ok: false, reason: 'stage' });
    expect(f.reg.start(999)).toEqual({ ok: false, reason: 'unknown' });
  });

  it('asks a landmark with a pick for one at the start, one of its own', () => {
    const f = fixture();
    const house = stand(f, 'house_between_seasons', 'surveyed');
    expect(f.reg.start(house.id)).toEqual({ ok: false, reason: 'pick' });
    expect(f.reg.start(house.id, 'produce:wheat')).toEqual({ ok: false, reason: 'pick' });
    expect(f.reg.start(house.id, 'produce:food')).toEqual({ ok: true });
    expect(house.pick).toBe('produce:food');
    expect(landmarkDef(house.def)!.restore.pick!.map(pickKey)).toEqual(['boost', 'produce:food']);
  });

  it('salvages from surveyed and from restoring, and pays the reward in the same step', () => {
    const f = fixture();
    const a = stand(f, 'inverted_manor', 'surveyed');
    const b = stand(f, 'stormglass_observatory', 'restoring', 40, 40);
    const before = f.economy.money;
    expect(f.reg.salvage(a.id)).toEqual({ ok: true });
    expect(a).toMatchObject({ stage: 'salvaged', path: 'salvage', paid: true });
    expect(f.economy.money).toBe(before + 4000);
    expect(f.reg.salvage(b.id)).toEqual({ ok: true });
    expect(b).toMatchObject({ stage: 'salvaged', path: 'salvage', paid: true });
    expect(b.delivered).toBeUndefined();
    expect(f.economy.money).toBe(before + 4000 + 1500);
    expect(f.depot.get('iron')).toBe(20);
  });

  it('refuses salvage from any other stage', () => {
    for (const stage of ['hidden', 'spotted', 'restored', 'salvaged'] as const) {
      const f = fixture();
      const item = stand(f, 'inverted_manor', stage);
      expect(f.reg.salvage(item.id), stage).toEqual({ ok: false, reason: 'stage' });
    }
  });

  it('cancels a restore back to surveyed and keeps no refund of what was delivered', () => {
    const f = fixture();
    const item = stand(f, 'bellkeepers_refuge', 'restoring');
    const s = new Station('station', 22, 22);
    f.reg.credit(delivery(s, 'wood', 12));
    const total = [...f.depot.held()].reduce((n, [, v]) => n + v, 0);
    expect(f.reg.cancel(item.id)).toEqual({ ok: true });
    expect(item.stage).toBe('surveyed');
    expect(item.delivered).toBeUndefined();
    expect(item.path).toBeUndefined();
    expect([...f.depot.held()].reduce((n, [, v]) => n + v, 0)).toBe(total);
    // starting again begins from nothing
    f.reg.start(item.id);
    expect(item.delivered).toEqual({ wood: 0, iron: 0 });
    expect(f.reg.cancel(stand(f, 'inverted_manor', 'surveyed').id)).toEqual({
      ok: false,
      reason: 'stage',
    });
  });
});

describe('deliveries', () => {
  it('credits only what is missing, in id order, and says how much it took', () => {
    const f = fixture();
    // two refuges (wood 20, iron 20 each) within reach of one station
    const a = stand(f, 'bellkeepers_refuge', 'restoring', 20, 20);
    const b = stand(f, 'bellkeepers_refuge', 'restoring', 24, 20);
    const s = new Station('station', 22, 22);
    expect(f.reg.wants(s, 'wood')).toBe(40);
    expect(f.reg.wants(s, 'coal')).toBe(0);
    expect(f.reg.credit(delivery(s, 'wood', 30))).toBe(30);
    expect(a.delivered!.wood).toBe(20);
    expect(b.delivered!.wood).toBe(10);
    expect(f.reg.credit(delivery(s, 'wood', 30))).toBe(10);
    expect(f.reg.credit(delivery(s, 'wood', 30))).toBe(0);
    expect(f.reg.credit(delivery(s, 'coal', 30))).toBe(0);
    expect(f.reg.wants(s, 'wood')).toBe(0);
    expect(f.reg.wants(s, 'iron')).toBe(40);
  });

  it('wants nothing for a station out of reach, or for a landmark not restoring', () => {
    const f = fixture();
    stand(f, 'bellkeepers_refuge', 'surveyed', 20, 20);
    stand(f, 'bellkeepers_refuge', 'restoring', 60, 60);
    const near = new Station('station', 22, 22);
    const far = new Station('station', 60 + LANDMARK_REACH + 1, 60);
    expect(f.reg.wants(near, 'wood')).toBe(0);
    expect(f.reg.wants(far, 'wood')).toBe(0);
    expect(f.reg.credit(delivery(far, 'wood', 5))).toBe(0);
    expect(f.reg.wants(new Station('station', 60 + LANDMARK_REACH, 60), 'wood')).toBe(20);
  });

  it('restores at the last delivery when the condition holds, and pays its one-time grant', () => {
    const f = fixture();
    // the archive: stone 60, iron 30, coal 30, a grant of 6000 on restoring
    const item = stand(f, 'flooded_archive', 'restoring');
    const s = new Station('station', 22, 22);
    const before = f.economy.money;
    f.reg.credit(delivery(s, 'stone', 60));
    f.reg.credit(delivery(s, 'iron', 30));
    expect(item.stage).toBe('restoring');
    f.reg.credit(delivery(s, 'coal', 30));
    expect(item).toMatchObject({ stage: 'restored', paid: true });
    expect(f.economy.money).toBe(before + 6000);
  });
});

describe('conditions', () => {
  const full = (f: Fixture, item: { id: number }, def: string) => {
    f.reg.start(item.id);
    for (const [c, n] of Object.entries(landmarkDef(def)!.restore.needs))
      f.reg.credit(delivery(new Station('station', 22, 22), c, n));
  };

  it('holds a night landmark in restoring until game hours 20:00 to 05:00', () => {
    const f = fixture();
    const item = stand(f, 'moonwell_pavilion', 'surveyed');
    // noon
    f.clock.time = daySeconds() * 0.5;
    full(f, item, 'moonwell_pavilion');
    expect(item.stage).toBe('restoring');
    f.reg.tick(0.05);
    expect(item.stage).toBe('restoring');
    // 19:59 is day, 20:00 is night
    f.clock.time = daySeconds() * (19.99 / 24);
    f.reg.tick(0.05);
    expect(item.stage).toBe('restoring');
    f.clock.time = daySeconds() * (20.01 / 24);
    f.reg.tick(0.05);
    expect(item.stage).toBe('restored');
  });

  it('knows the night from 20:00 to 04:59, midnight included', () => {
    const hours: [number, boolean][] = [
      [4.9, true],
      [5.1, false],
      [12, false],
      [20.5, true],
      [0.5, true],
    ];
    for (const [h, night] of hours) {
      const f = fixture();
      const item = stand(f, 'moonwell_pavilion', 'surveyed');
      f.clock.time = (daySeconds() * h) / 24;
      full(f, item, 'moonwell_pavilion');
      expect(item.stage === 'restored', `hour ${h}`).toBe(night);
    }
  });

  it('holds a storm landmark until the wind level is storm, then completes on the next step', () => {
    const f = fixture();
    const item = stand(f, 'stormglass_observatory', 'surveyed');
    full(f, item, 'stormglass_observatory');
    expect(item.stage).toBe('restoring');
    for (const level of ['calm', 'breeze', 'windy'] as const) {
      f.wind.level = level;
      f.reg.tick(0.05);
      expect(item.stage, level).toBe('restoring');
    }
    f.wind.level = 'storm';
    f.reg.tick(0.05);
    expect(item.stage).toBe('restored');
  });
});

describe('the grants', () => {
  it('puts cargo into the nearest store and the rest into the next, and loses what fits nowhere', () => {
    const { stores, depots } = storesWith([
      { amounts: {}, at: { x: 0, y: 0 } },
      { amounts: {}, at: { x: 100, y: 100 } },
    ]);
    const near = depots[0];
    const far = depots[1];
    const clock = new GameClock();
    const reg = new LandmarkRegistry({
      clock,
      economy: new Economy(),
      stores,
      windLevel: () => 'calm',
    });
    const events: LandmarkEvent[] = [];
    reg.onEvent = (e) => events.push(e);
    // leave room for 10 iron in the near store and 15 in the far one
    near.amounts.set('iron', near.cap('iron') - 10);
    far.amounts.set('iron', far.cap('iron') - 15);
    reg.addPlacements([place('sleeping_foundry', 5, 5)]);
    reg.refreshVisibility(() => true);
    reg.onArrive(new Station('station', 6, 6));
    reg.salvage(1);
    expect(near.get('iron')).toBe(near.cap('iron'));
    expect(far.get('iron')).toBe(far.cap('iron'));
    // the foundry's salvage: 60 iron and 20 coal
    expect(near.get('coal')).toBe(20);
    const granted = events.find((e) => e.kind === 'granted');
    expect(granted).toMatchObject({ stored: { iron: 25, coal: 20 }, lost: { iron: 35 } });
  });

  it('pays once across save, load, expand and reload', () => {
    const f = fixture();
    const item = stand(f, 'inverted_manor', 'surveyed');
    f.reg.salvage(item.id);
    expect(f.economy.money - new Economy().money).toBe(4000);
    let json: LandmarksJSON = f.reg.toJSON();
    for (let round = 0; round < 3; round++) {
      const save = bareSave(JSON.parse(JSON.stringify(json)));
      expandSave(save);
      const again = new LandmarkRegistry({
        clock: f.clock,
        economy: f.economy,
        stores: f.stores,
        windLevel: () => 'calm',
      });
      again.load(save.landmarks);
      expect(again.items[0].paid).toBe(true);
      expect(again.salvage(item.id)).toEqual({ ok: false, reason: 'stage' });
      again.tick(1);
      json = again.toJSON();
    }
    expect(f.economy.money - new Economy().money).toBe(4000);
  });
});

describe('the effects', () => {
  it('produces into the supplier store per game day, as its restore or pick says', () => {
    const f = fixture();
    const item = stand(f, 'rootbound_workshop', 'restored', 4, 4);
    expect(f.depot.get('wood')).toBe(0);
    for (let t = 0; t < daySeconds(); t += 1) f.reg.tick(1);
    expect(f.depot.get('wood')).toBeCloseTo(4, 6);
    expect(f.reg.reasonOf(item.id)).toBe('');
  });

  it('consumes first and makes nothing while the consumed cargo is missing', () => {
    const f = fixture({ coal: 3 });
    const item = stand(f, 'sleeping_foundry', 'restored', 4, 4);
    for (let t = 0; t < daySeconds() / 2; t += 1) f.reg.tick(1);
    // 6 coal a day: it ran for half a day on 3 coal, and the iron made matches the coal eaten
    expect(f.depot.get('coal')).toBeCloseTo(0, 6);
    expect(f.depot.get('iron')).toBeCloseTo(3, 6);
    f.reg.tick(1);
    expect(f.depot.get('iron')).toBeCloseTo(3, 6);
    expect(f.reg.reasonOf(item.id)).toBe('inputs');
  });

  it('makes nothing with no store to make into, and says so', () => {
    const f = fixture();
    const item = stand(f, 'rootbound_workshop', 'restored', 400, 400);
    f.reg.tick(10);
    expect(f.reg.reasonOf(item.id)).toBe('store');
    expect(f.depot.get('wood')).toBe(0);
  });

  it('runs the picked produce of a landmark with a pick', () => {
    const f = fixture();
    stand(f, 'ashen_conservatory', 'restoring', 4, 4, 'produce:wheat');
    const item = f.reg.items[0];
    for (const [c, n] of Object.entries(landmarkDef('ashen_conservatory')!.restore.needs))
      f.reg.credit(delivery(new Station('station', 6, 6), c, n));
    expect(item.stage).toBe('restored');
    for (let t = 0; t < daySeconds(); t += 1) f.reg.tick(1);
    expect(f.depot.get('wheat')).toBeCloseTo(4, 6);
    expect(f.depot.get('food')).toBe(0);
  });

  it('adds a boost to every station in reach, outside the decor limit, and adds up', () => {
    const f = fixture();
    stand(f, 'bellkeepers_refuge', 'restored', 20, 20);
    stand(f, 'cliffside_cable_station', 'restored', 24, 20);
    const near = new Station('station', 22, 22);
    const far = new Station('station', 60, 60);
    expect(f.reg.boostAt(near)).toBeCloseTo((1 + 2) * LANDMARK_BOOST_UNIT, 9);
    expect(f.reg.boostAt(far)).toBe(0);
  });

  it('gives an attraction to the nearest passenger station in reach, and only that one', () => {
    const f = fixture();
    stand(f, 'inverted_manor', 'restored', 20, 20);
    const nearer = new Station('station', 22, 20);
    const farther = new Station('station', 25, 20);
    const outside = new Station('station', 40, 40);
    const depot = new Station('depot', 21, 21);
    const all = [farther, nearer, outside, depot];
    expect(all.map((s) => f.reg.visitorsAt(s, all))).toEqual([0, 10, 0, 0]);
  });

  it('brings its visitors per game day whatever the season or biome multiplier says', () => {
    for (const mul of [0.3, 1, 1.7]) {
      const s = new Station('station', 22, 20);
      s.visitorsPerDay = 10;
      s.passengerPopulation = 0;
      s.productionMul = mul;
      s.tick(daySeconds());
      expect(s.stored('passengers'), 'multiplier ' + mul).toBeCloseTo(10, 6);
    }
  });

  it('writes a grant paid even when a handler saves on the event', () => {
    for (const stage of ['salvaged', 'restored'] as const) {
      const f = fixture();
      const snaps: LandmarksJSON[] = [];
      f.reg.onEvent = (e) => {
        if (e.kind === stage) snaps.push(JSON.parse(JSON.stringify(f.reg.toJSON())));
      };
      stand(f, stage === 'salvaged' ? 'inverted_manor' : 'flooded_archive', stage);
      expect(snaps, stage).toHaveLength(1);
      expect(snaps[0].items[0].paid, stage).toBe(true);
    }
  });

  it('adds nothing where no passenger station is in reach', () => {
    const f = fixture();
    stand(f, 'inverted_manor', 'restored', 20, 20);
    const only = new Station('depot', 21, 21);
    expect(f.reg.visitorsAt(only, [only])).toBe(0);
  });

  it('runs only a restored landmark, not a salvaged one', () => {
    const f = fixture();
    stand(f, 'bellkeepers_refuge', 'salvaged', 20, 20);
    stand(f, 'rootbound_workshop', 'salvaged', 4, 4);
    f.reg.tick(daySeconds());
    expect(f.reg.boostAt(new Station('station', 22, 22))).toBe(0);
    expect(f.depot.get('wood')).toBe(50);
  });

  it('tells the game when a boost starts, so the stations are refreshed', () => {
    const f = fixture();
    const changed = vi.fn();
    f.reg.onEffectsChanged = changed;
    const item = stand(f, 'bellkeepers_refuge', 'restoring');
    expect(changed).not.toHaveBeenCalled();
    f.reg.credit(delivery(new Station('station', 22, 22), 'wood', 20));
    f.reg.credit(delivery(new Station('station', 22, 22), 'iron', 20));
    expect(item.stage).toBe('restored');
    expect(changed).toHaveBeenCalledTimes(1);
  });
});

describe('an item of a def the content lacks', () => {
  const stray = {
    id: 7,
    def: 'a_landmark_from_a_later_build',
    x: 9,
    y: 9,
    region: [1, 1] as [number, number],
    stage: 'restoring' as const,
    path: 'restore' as const,
    delivered: { wood: 3 },
    extra: { kept: true },
  };

  it('is carried through a save untouched, never ticked, credited or surveyed', () => {
    const f = fixture({ wood: 100 });
    f.reg.load({ nextId: 2, items: [JSON.parse(JSON.stringify(stray))] });
    const s = new Station('station', 10, 10);
    f.reg.tick(daySeconds());
    f.reg.onArrive(s);
    f.reg.refreshVisibility(() => true);
    expect(f.reg.wants(s, 'wood')).toBe(0);
    expect(f.reg.credit(delivery(s, 'wood', 10))).toBe(0);
    expect(f.reg.start(7)).toEqual({ ok: false, reason: 'unknown' });
    expect(f.reg.salvage(7)).toEqual({ ok: false, reason: 'unknown' });
    expect(f.reg.boostAt(s)).toBe(0);
    expect(f.reg.toJSON()).toEqual({ nextId: 8, items: [stray] });
    expect(f.reg.at(9, 9)?.id, 'its tile still blocks').toBe(7);
  });

  it('is left alone by pruning unknown content', () => {
    const save = bareSave({ nextId: 8, items: [stray] });
    const report = pruneUnknownContent(save);
    expect(report.dropped).toEqual([]);
    expect(save.landmarks!.items).toEqual([stray]);
  });
});

describe('the registry in a save', () => {
  it('round trips every item, and takes the no-roll mark once', () => {
    const f = fixture();
    stand(f, 'inverted_manor', 'surveyed');
    stand(f, 'bellkeepers_refuge', 'restoring', 40, 40);
    f.reg.credit(delivery(new Station('station', 42, 42), 'wood', 5));
    stand(f, 'rootbound_workshop', 'restored', 60, 60);
    const json = JSON.parse(JSON.stringify(f.reg.toJSON()));
    const g = fixture();
    g.reg.load({ ...json, skipRoll: true });
    expect(g.reg.toJSON()).toEqual({ ...json, skipRoll: true });
    expect(g.reg.takeSkipRoll()).toBe(true);
    expect(g.reg.takeSkipRoll()).toBe(false);
    expect(g.reg.toJSON()).toEqual(json);
  });

  it('keeps ids unique past the largest held', () => {
    const f = fixture();
    f.reg.load({ nextId: 1, items: [{ ...place2(), id: 5 }] });
    f.reg.addPlacements([place('inverted_manor', 1, 1)]);
    expect(f.reg.items.map((i) => i.id)).toEqual([5, 6]);
    f.reg.load(undefined);
    expect(f.reg.toJSON()).toEqual({ nextId: 1, items: [] });
  });
  function place2() {
    return {
      def: 'inverted_manor',
      x: 3,
      y: 3,
      region: [0, 0] as [number, number],
      stage: 'spotted' as const,
    };
  }

  it('is a known key of a save and survives expandSave with its region unmoved', () => {
    const f = fixture();
    stand(f, 'inverted_manor', 'surveyed', 10, 12);
    const parts = { landmarks: f.reg.toJSON() } as unknown as SaveParts;
    expect(Object.keys(buildSave(parts))).toContain('landmarks');
    const save = bareSave(f.reg.toJSON());
    expandSave(save);
    expect(save.landmarks!.items[0]).toMatchObject({ x: 42, y: 44, region: [1, 2] });
  });
});

describe('only the transitions of the spec', () => {
  const ALLOWED = new Set([
    'hidden>spotted',
    'spotted>surveyed',
    'surveyed>restoring',
    'restoring>restored',
    'surveyed>salvaged',
    'restoring>salvaged',
    'restoring>surveyed',
  ]);

  type Op = { kind: string; n: number };
  const KINDS = [
    'reveal',
    'arrive',
    'start',
    'salvage',
    'cancel',
    'deliver',
    'deliver',
    'tick',
    'save',
    'night',
    'storm',
  ];

  it('moves only along them, pays each grant once, and changes money and cargo only by recorded grants', () => {
    forAll(
      (rng) =>
        Array.from({ length: 60 }, (): Op => ({
          kind: KINDS[rng.int(0, KINDS.length - 1)],
          n: rng.int(0, 99),
        })),
      (ops) => {
        const f = fixture();
        const ids = [
          'flooded_archive',
          'stormglass_observatory',
          'house_between_seasons',
          'moonwell_pavilion',
        ];
        f.reg.addPlacements(ids.map((id, i) => place(id, 20 + i * 4, 20)));
        const near = new Station('station', 24, 24);
        const total = () => {
          let n = f.economy.money;
          for (const [, v] of f.depot.held()) n += v;
          return n;
        };
        let granted = 0;
        let reg = f.reg;
        reg.onEvent = (e) => {
          if (e.kind === 'granted')
            granted += e.money + Object.values(e.stored).reduce((a, b) => a + b, 0);
        };
        const start = total();
        const paid = new Set<number>();
        for (const op of ops) {
          const before = new Map(reg.items.map((i) => [i.id, i.stage]));
          const item = reg.items[op.n % reg.items.length];
          switch (op.kind) {
            case 'reveal':
              reg.refreshVisibility(() => true);
              break;
            case 'arrive':
              reg.onArrive(near);
              break;
            case 'start':
              reg.start(item.id, op.n % 2 ? 'boost' : 'produce:food');
              break;
            case 'salvage':
              reg.salvage(item.id);
              break;
            case 'cancel':
              reg.cancel(item.id);
              break;
            case 'deliver': {
              const cargo = ['stone', 'iron', 'coal', 'wood', 'water', 'food'][op.n % 6];
              const got = reg.credit(delivery(near, cargo, (op.n % 40) + 1));
              expect(got).toBeLessThanOrEqual((op.n % 40) + 1);
              break;
            }
            case 'night':
              f.clock.time = daySeconds() * 0.9;
              break;
            case 'storm':
              f.wind.level = op.n % 2 ? 'storm' : 'calm';
              break;
            case 'save': {
              const json = JSON.parse(JSON.stringify(reg.toJSON()));
              reg = new LandmarkRegistry({
                clock: f.clock,
                economy: f.economy,
                stores: f.stores,
                windLevel: () => f.wind.level,
              });
              reg.onEvent = f.reg.onEvent;
              reg.load(json);
              break;
            }
            default:
              reg.tick(0.05);
          }
          for (const i of reg.items) {
            const was = before.get(i.id)!;
            if (was !== i.stage)
              expect(ALLOWED.has(`${was}>${i.stage}`), `${was}>${i.stage}`).toBe(true);
            expect(LANDMARK_STAGES).toContain(i.stage);
            const need = landmarkDef(i.def)!.restore.needs;
            for (const [c, v] of Object.entries(i.delivered ?? {}))
              expect(v).toBeLessThanOrEqual(need[c] + 1e-9);
            if (i.paid) paid.add(i.id);
            else expect(paid.has(i.id), 'paid never unsets').toBe(false);
          }
        }
        // produce effects move goods too; none of the four here produces
        expect(total() - start).toBeCloseTo(granted, 6);
      },
    );
  });
});

describe('deliveries by train', () => {
  const ROW = 20;
  const GDT = 0.05;

  /** A flat world with a depot holding stone, a line east and a plain passenger station. */
  function scene() {
    const w = simWorld({ terrain: 'grass', size: 64 });
    const depot = station(w, 'depot', 4, ROW);
    line(w, 6, ROW, 60);
    const plain = station(w, 'station', 44, ROW - 1);
    const store = w.stores.byKey(`st:${depot.id}`)!;
    store.amounts.set('stone', 200);
    const reg = new LandmarkRegistry({
      clock: w.clock,
      economy: w.economy,
      stores: w.stores,
      windLevel: () => 'calm',
    });
    // what the game's wiring does (the engine task): the fleet asks, the registry answers
    w.fleet.landmarkWants = (s, c) => reg.wants(s, c);
    w.fleet.landmarkCredit = (e) => reg.credit(e);
    return { w, depot, plain, store, reg };
  }
  /** The observatory (stone 30, iron 20) within reach of the station, brought to restoring. */
  function restoring(f: ReturnType<typeof scene>, delivered = 0) {
    f.reg.addPlacements([place('stormglass_observatory', 44, ROW - 6)]);
    f.reg.refreshVisibility(() => true);
    f.reg.onArrive(f.plain);
    f.reg.start(1);
    f.reg.items[0].delivered!.stone = delivered;
    return f.reg.items[0];
  }
  function train(f: ReturnType<typeof scene>) {
    const t = new Train([{ uid: 1, level: 1, def: locoDef('f7') }]);
    t.wagons = [
      { uid: 2, def: wagonDef('wood_hopper'), level: 1, cargo: null, amount: 0, origin: null },
    ];
    expect(t.spawnAt(f.w.track, 20, ROW, Dir.E)).not.toBe(false);
    f.w.fleet.trains.push(t);
    t.oil = t.oilCap;
    t.schedule = [
      { ...defaultStop(f.depot.id), unload: 'none' },
      { ...defaultStop(f.plain.id), load: 'none' },
    ];
    expect(t.dispatch(f.w.track, f.w.builder, f.w.map)).toBe(true);
    return t;
  }
  function run(w: SimWorld, done: () => boolean, max = 60000) {
    let n = 0;
    for (; n < max && !done(); n++) w.fleet.tick(GDT, (w.clock.time += GDT));
    expect(done(), `done within ${max} ticks`).toBe(true);
  }
  void TrackGraph;

  it('unloads at a plain station only what the landmark still misses, and keeps the rest', () => {
    const f = scene();
    const item = restoring(f, 15);
    const t = train(f);
    let left = false;
    run(f.w, () => {
      if (t.atStation === f.plain) left = true;
      return left && t.atStation !== f.plain;
    });
    expect(item.delivered!.stone, 'the landmark has what it needed').toBe(30);
    // the hopper took a full 20 at the depot, handed over 15 and still holds the other 5
    expect(t.wagons[0].amount).toBeCloseTo(5, 6);
    expect(f.plain.totalStored(), 'nothing entered the station').toBe(0);
    expect(f.store.get('stone'), 'what the train took came out of the depot').toBeCloseTo(180, 6);
  });

  it('loads nothing for a station that no landmark wants stone at', () => {
    const f = scene();
    const item = restoring(f, 0);
    f.reg.cancel(item.id);
    const t = train(f);
    run(f.w, () => f.w.clock.time > 60);
    expect(t.wagons[0].amount, 'a plain station takes no stone, so none is loaded').toBe(0);
  });

  it('credits the landmark before a contract, which sees only what is left', () => {
    const f = scene();
    const item = restoring(f, 0);
    const calls: { who: 'landmark' | 'contract'; asked: number; took: number }[] = [];
    f.w.fleet.onDelivery = (e) => {
      calls.push({ who: 'contract', asked: e.amount, took: 0 });
      return 0;
    };
    const credit = f.w.fleet.landmarkCredit!;
    f.w.fleet.landmarkCredit = (e) => {
      const took = credit(e);
      calls.push({ who: 'landmark', asked: e.amount, took });
      return took;
    };
    // the plain station takes stone for a contract as well
    vi.spyOn(f.plain, 'accepts').mockReturnValue(true);
    const t = train(f);
    let left = false;
    run(f.w, () => {
      if (t.atStation === f.plain) left = true;
      return left && t.atStation !== f.plain;
    });
    expect(calls[0].who).toBe('landmark');
    expect(item.delivered!.stone, 'a full hopper, all of it the landmark missed').toBeCloseTo(
      20,
      6,
    );
    for (let i = 1; i < calls.length; i++)
      if (calls[i].who === 'contract') {
        expect(calls[i - 1].who).toBe('landmark');
        expect(calls[i].asked).toBeCloseTo(calls[i - 1].asked - calls[i - 1].took, 9);
      }
  });
});
