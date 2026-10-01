import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Dir } from '../engine/iso';
import { Rng } from '../engine/rng';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Station, resetStationIds } from './stations';
import { Train, resetTrainIds } from './trains';
import { Fleet } from './fleet';
import { rules, DEFAULT_RULES } from './rules';
import { SAVE_VERSION, SAVE_MIN_VERSION, migrate, parseSave, type SaveGame } from './save';
import { gaugeOf } from './compat';
import { Inventory } from '../gacha/inventory';
import { Gacha } from '../gacha/gacha';
import { Crafting } from '../gacha/crafting';
import { isRetired, locoDef, wagonDef, WAGONS, type Item } from '../gacha/items';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => Object.assign(rules, DEFAULT_RULES));

/** The two engines withdrawn from the game; players may still own and run them. */
const RETIRED = ['adler', 'john_bull'];
const LINES = [30, 40];

function world() {
  const map = emptyMap(4242, 96, 96, Terrain.Grass),
    track = new TrackGraph(96, 96),
    stock = new Stockpile(),
    economy = new Economy(),
    inventory = new Inventory();
  const builder = new Builder(map, new RegionState(map), track, economy, stock);
  builder.free = true;
  const fleet = new Fleet(track, builder, map, inventory, economy, stock);
  const gacha = new Gacha(new Rng(1), inventory);
  const crafting = new Crafting(new Rng(2), inventory, economy, stock);
  return { map, track, stock, economy, builder, fleet, inventory, gacha, crafting };
}
function item(uid: number, defId: string, kind: Item['kind'], assigned: number | null): Item {
  return { uid, defId, kind, level: 1, assigned, dupes: 0, obtainedAt: 0 };
}

/**
 * The text of a save written while both engines were ordinary models: one train headed by each on
 * its own regular-gauge line (both are regular-gauge engines), a spare copy of each in the depot,
 * and their workshop recipes known. `version` 12 predates gauges and narrow track; 9 predates the
 * workshop too, so the v9 to v10 step derives the recipes from the inventory instead.
 */
function saveWithRetiredEngines(version: number): string {
  const w = world();
  resetStationIds(1);
  resetTrainIds(1);
  const wagon = WAGONS.find((d) => d.starter)!;
  const items: Item[] = [];
  const trains: Train[] = [];
  const track: SaveGame['track'] = [];
  RETIRED.forEach((id, i) => {
    const y = LINES[i];
    for (let x = 2; x < 90; x++) {
      w.track.place(x, y, 'straight', 1, 'regular');
      track.push([x, y, 'straight', 1, 'regular']);
    }
    const from = new Station('quarry', 15, y - 1),
      to = new Station('quarry', 80, y - 1);
    w.builder.stations.push(from, to);
    const t = new Train([{ uid: 10 + i, level: 1, def: locoDef(id) }]);
    t.wagons.push({
      uid: 20 + i,
      def: wagonDef(wagon.id),
      level: 1,
      cargo: null,
      amount: 0,
      origin: null,
    });
    t.spawnAt(w.track, 20, y, Dir.W);
    t.route = [to.id, from.id];
    t.coal = t.coalCap;
    t.water = t.waterCap;
    trains.push(t);
    items.push(
      item(10 + i, id, 'loco', t.id),
      item(20 + i, wagon.id, 'wagon', t.id),
      item(30 + i, id, 'loco', null),
    );
  });
  const save: SaveGame = {
    version,
    savedAt: 1700000000000,
    seed: 4242,
    clock: { time: 0, speedIndex: 1 },
    economy: { money: 1000, tickets: 0, tier: 0, granted: [], earned: 0 },
    track,
    stations: w.builder.stations.map((s) => s.toJSON()),
    trains: trains.map((t) => t.toJSON()),
    contracts: { contracts: [] },
    inventory: { items, nextUid: 40 },
    gacha: { pity: 3, totalPulls: 7, rng: 12345 },
    camera: { x: 0, y: 0, zoomIndex: 2 },
    lastDay: 1,
    decor: [],
    buildings: [],
    supply: 'simple',
  };
  if (version >= 10)
    save.crafting = {
      recipes: ['rocket', ...RETIRED],
      stats: { unlocks: 2, crafts: 2, failures: 0 },
      pending: null,
      rng: 777,
    };
  return JSON.stringify(save);
}

/** The parts of `Game.load` that touch rolling stock, in the order the game runs them. */
function load(text: string) {
  const j = parseSave(text)!;
  const w = world();
  for (const [x, y, kind, rot, cls, cls2] of j.track)
    w.track.place(x, y, kind, rot, cls ?? 'regular', cls2);
  w.track.refreshSwitchForms();
  resetStationIds(1);
  for (const sj of j.stations) w.builder.stations.push(Station.fromJSON(sj));
  w.inventory.load(j.inventory as ReturnType<Inventory['toJSON']>);
  w.gacha.load(j.gacha as ReturnType<Gacha['toJSON']>);
  w.crafting.load(j.crafting as ReturnType<Crafting['toJSON']> | undefined);
  resetTrainIds(1);
  for (const tj of j.trains as ReturnType<Train['toJSON']>[])
    w.fleet.trains.push(Train.fromJSON(tj, w.track));
  for (const it of w.inventory.items)
    if (it.assigned !== null && !w.fleet.byId(it.assigned)) it.assigned = null;
  return { j, ...w };
}

describe.each([
  ['the current format', SAVE_VERSION],
  ['the format from before gauges', 12],
  ['a format from before the workshop', 9],
])('a save with an Adler and a John Bull in %s', (_label, version) => {
  it('really is a save that names both engines', () => {
    const text = saveWithRetiredEngines(version);
    for (const id of RETIRED) {
      expect(isRetired(id)).toBe(true);
      // a train's locomotive and two inventory copies each
      expect(text.split(`"defId":"${id}"`).length - 1).toBe(3);
    }
  });

  it('loads with every owned copy kept, in service or spare', () => {
    const w = load(saveWithRetiredEngines(version));
    expect(w.j.version).toBe(SAVE_VERSION);
    expect(w.fleet.trains.map((t) => t.locoDef.id)).toEqual(RETIRED);
    for (const [i, id] of RETIRED.entries()) {
      // both stay regular-gauge engines on the regular line they were saved on
      expect(gaugeOf(locoDef(id))).toBe('regular');
      expect(w.inventory.count(id)).toBe(2);
      expect(w.inventory.byUid(10 + i)?.assigned).toBe(w.fleet.trains[i].id);
      // the spare is still offered to the depot for a new train
      expect(w.inventory.free('loco').some((it) => it.uid === 30 + i && it.defId === id)).toBe(
        true,
      );
    }
  });

  it('keeps the trains running to their next stop', () => {
    const w = load(saveWithRetiredEngines(version));
    const start = w.fleet.trains.map((t) => t.distance);
    // first platform each train pulls into (the faster one is on its way back by the end)
    const reached = new Map<number, Station>();
    w.fleet.onArrive = (t, s) => void (reached.has(t.id) || reached.set(t.id, s));
    for (let i = 0; i < 12000 && reached.size < w.fleet.trains.length; i++)
      w.fleet.tick(0.05, i * 0.05);
    w.fleet.trains.forEach((t, i) => {
      expect(reached.get(t.id)?.x).toBe(80);
      expect(reached.get(t.id)?.y).toBe(LINES[i] - 1);
      // from tile 20 to the platform at 80, under its own steam
      expect(t.distance - start[i]).toBeGreaterThan(50);
      expect(t.state).not.toBe('noFuel');
    });
  });

  it('writes both engines back out on the next save', () => {
    const w = load(saveWithRetiredEngines(version));
    const again = JSON.stringify({
      inventory: w.inventory.toJSON(),
      trains: w.fleet.trains.map((t) => t.toJSON()),
    });
    for (const id of RETIRED) expect(again.split(`"defId":"${id}"`).length - 1).toBe(3);
  });

  it('no longer lets the workshop build either one', () => {
    const w = load(saveWithRetiredEngines(version));
    expect(w.crafting.knows('rocket')).toBe(version >= 10);
    for (const id of RETIRED) {
      expect(w.crafting.knows(id)).toBe(false);
      for (const k of Object.keys(w.crafting.instanceCost(id))) w.stock.add(k, 1e6);
      expect(w.crafting.craft(id, 0)).toBeNull();
      expect(w.inventory.count(id)).toBe(2);
    }
  });
});

describe('upgrading an older save', () => {
  it('hands out no retired model on the way, from any format version', () => {
    for (let version = SAVE_MIN_VERSION; version < SAVE_VERSION; version++) {
      const j = migrate({
        version,
        savedAt: 1700000000000,
        seed: 1,
        clock: { time: 0, speedIndex: 1 },
        economy: { money: 0, tickets: 0, tier: 0, granted: [] },
        track: [],
        stations: [],
        trains: [],
        contracts: { contracts: [] },
        inventory: { items: [item(1, 'rocket', 'loco', null)], nextUid: 2 },
        gacha: {},
        camera: { x: 0, y: 0, zoomIndex: 2 },
        lastDay: 0,
      });
      const items = (j.inventory as { items: Item[] }).items;
      expect(items.map((i) => i.defId).filter(isRetired), `from v${version}`).toEqual([]);
      const recipes = (j.crafting as { recipes?: string[] } | undefined)?.recipes ?? [];
      expect(recipes.filter(isRetired), `from v${version}`).toEqual([]);
    }
  });
});
