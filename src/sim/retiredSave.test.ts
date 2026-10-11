import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph, makePiece, type TrackClass } from '../world/track';
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
import { pruneUnknownContent } from './saveContent';
import { gaugeOf } from './compat';
import { Inventory } from '../gacha/inventory';
import { Gacha } from '../gacha/gacha';
import { Crafting } from '../gacha/crafting';
import { LOCOS, WAGONS, locoDef, wagonDef, type Item } from '../gacha/items';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => Object.assign(rules, DEFAULT_RULES));

/** The two engines withdrawn from the game (decision retire-adler-john-bull). */
const RETIRED = ['adler', 'john_bull'];
/** Diesel-age recipe finds the retirement leaves alone (decision startkit-diesels). */
const KEPT = ['bm50', 'muki'];
/** Every model the content flags retired, read from the flag rather than named. */
const FLAGGED = [...LOCOS, ...WAGONS].filter((d) => d.retired).map((d) => d.id);
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

/** A pair of engines a save holds, the track they run on and the wagon behind each. */
interface Pair {
  engines: string[];
  cls: TrackClass;
  wagon: string;
}
/** Adler and John Bull are regular-gauge engines; wood_hopper is a regular wagon to match. */
const RETIRED_PAIR: Pair = { engines: RETIRED, cls: 'regular', wagon: 'wood_hopper' };
/** BM-50 and Muki are narrow-gauge diesels; the mine tub is a narrow wagon to match. */
const KEPT_PAIR: Pair = { engines: KEPT, cls: 'narrow', wagon: 'mine_tub' };

/**
 * The text of a save with one train headed by each engine on its own line, a spare copy of each in
 * the depot, and their workshop recipes known. `version` 12 predates gauges and narrow track; 9
 * predates the workshop too, so the v9 to v10 step derives the recipes from the inventory instead.
 */
function saveWith(version: number, pair: Pair): string {
  const w = world();
  resetStationIds(1);
  resetTrainIds(1);
  const ew = [0, 1].find((r) => makePiece('straight', r, pair.cls).links[0].includes(Dir.E))!;
  const items: Item[] = [];
  const trains: Train[] = [];
  const track: SaveGame['track'] = [];
  pair.engines.forEach((id, i) => {
    const y = LINES[i];
    for (let x = 2; x < 90; x++) {
      w.track.place(x, y, 'straight', ew, pair.cls);
      track.push([x, y, 'straight', ew, pair.cls]);
    }
    const from = new Station('quarry', 15, y - 1),
      to = new Station('quarry', 80, y - 1);
    w.builder.stations.push(from, to);
    const t = new Train([{ uid: 10 + i, level: 1, def: locoDef(id) }]);
    t.wagons.push({
      uid: 20 + i,
      def: wagonDef(pair.wagon),
      level: 1,
      cargo: null,
      amount: 0,
      origin: null,
    });
    t.spawnAt(w.track, 20, y, Dir.W);
    t.route = [to.id, from.id];
    t.coal = t.coalCap;
    t.water = t.waterCap;
    t.oil = t.oilCap;
    trains.push(t);
    items.push(
      item(10 + i, id, 'loco', t.id),
      item(20 + i, pair.wagon, 'wagon', t.id),
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
      recipes: ['rocket', ...pair.engines],
      stats: { unlocks: 2, crafts: 2, failures: 0 },
      pending: null,
      rng: 777,
    };
  return JSON.stringify(save);
}

/** The parts of `Game.applySave` that touch rolling stock, in the order the game runs them. */
function load(text: string) {
  const j = parseSave(text)!;
  const pruned = pruneUnknownContent(j);
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
  return { j, pruned, ...w };
}

describe.each([
  ['an Adler and a John Bull', 'the current format', SAVE_VERSION, RETIRED_PAIR],
  ['an Adler and a John Bull', 'the format from before gauges', 12, RETIRED_PAIR],
  ['an Adler and a John Bull', 'a format from before the workshop', 9, RETIRED_PAIR],
  ['a BM-50 and a Muki', 'the current format', SAVE_VERSION, KEPT_PAIR],
])('a save with %s in %s', (_engines, _format, version, pair) => {
  it('really is a save that names both engines', () => {
    const text = saveWith(version, pair);
    for (const id of pair.engines) {
      expect(locoDef(id).retired === true, id).toBe(pair === RETIRED_PAIR);
      // a train's locomotive and two inventory copies each
      expect(text.split(`"defId":"${id}"`).length - 1, id).toBe(3);
    }
  });

  it('loads with every owned copy kept, in service or spare', () => {
    const w = load(saveWith(version, pair));
    expect(w.j.version).toBe(SAVE_VERSION);
    expect(w.pruned.dropped).toEqual([]);
    expect(w.fleet.trains.map((t) => t.locoDef.id)).toEqual(pair.engines);
    for (const [i, id] of pair.engines.entries()) {
      // each stays an engine of the gauge it was saved on
      expect(gaugeOf(locoDef(id)), id).toBe(pair.cls);
      expect(w.inventory.count(id), id).toBe(2);
      expect(w.inventory.byUid(10 + i)?.assigned, id).toBe(w.fleet.trains[i].id);
      // the spare is still offered to the depot for a new train
      expect(
        w.inventory.free('loco').some((it) => it.uid === 30 + i && it.defId === id),
        id,
      ).toBe(true);
    }
  });

  it('keeps the trains running to their next stop', () => {
    const w = load(saveWith(version, pair));
    const start = w.fleet.trains.map((t) => t.distance);
    // first platform each train pulls into (the faster one is on its way back by the end)
    const reached = new Map<number, Station>();
    w.fleet.onArrive = (t, s) => void (reached.has(t.id) || reached.set(t.id, s));
    for (let i = 0; i < 12000 && reached.size < w.fleet.trains.length; i++)
      w.fleet.tick(0.05, i * 0.05);
    w.fleet.trains.forEach((t, i) => {
      expect(reached.get(t.id)?.x, t.locoDef.id).toBe(80);
      expect(reached.get(t.id)?.y, t.locoDef.id).toBe(LINES[i] - 1);
      // from tile 20 to the platform at 80, under its own power
      expect(t.distance - start[i], t.locoDef.id).toBeGreaterThan(50);
      expect(t.state, t.locoDef.id).not.toBe('noFuel');
    });
  });

  it('writes both engines back out on the next save', () => {
    const w = load(saveWith(version, pair));
    const again = JSON.stringify({
      inventory: w.inventory.toJSON(),
      trains: w.fleet.trains.map((t) => t.toJSON()),
    });
    for (const id of pair.engines) expect(again.split(`"defId":"${id}"`).length - 1, id).toBe(3);
  });

  it('keeps every recipe the save holds but a retired one, and builds only those', () => {
    const w = load(saveWith(version, pair));
    const saved = (w.j.crafting as { recipes: string[] }).recipes;
    expect(saved).toEqual(expect.arrayContaining(pair.engines));
    expect([...w.crafting.recipes].sort()).toEqual(
      saved.filter((id) => !FLAGGED.includes(id)).sort(),
    );
    for (const id of pair.engines) {
      const retired = FLAGGED.includes(id);
      expect(w.crafting.knows(id), id).toBe(!retired);
      for (const k of Object.keys(w.crafting.instanceCost(id))) w.stock.add(k, 1e6);
      expect(w.crafting.canCraft(id), id).toBe(!retired);
      const built = w.crafting.craft(id, 0);
      expect(built === null, id).toBe(retired);
      expect(w.inventory.count(id), id).toBe(built?.ok ? 3 : 2);
    }
  });
});

/** A save of `version` from before any John Bull existed or with the one given, otherwise bare. */
function oldSave(version: number, items: Item[]): SaveGame {
  const save: SaveGame = {
    version,
    savedAt: 1700000000000,
    seed: 1,
    clock: { time: 0, speedIndex: 1 },
    economy: { money: 0, tickets: 0, tier: 0, granted: [] },
    track: [],
    stations: [],
    trains: [],
    contracts: { contracts: [] },
    inventory: { items, nextUid: items.length + 1 },
    gacha: {},
    camera: { x: 0, y: 0, zoomIndex: 2 },
    lastDay: 0,
  };
  // a save of the workshop's time holds the recipes of what it owns
  if (version >= 10) save.crafting = { recipes: items.map((i) => i.defId) };
  return save;
}

describe('upgrading an older save', () => {
  const count = (j: SaveGame, id: string) =>
    (j.inventory as { items: Item[] }).items.filter((i) => i.defId === id).length;

  it('gives a save up to v12 exactly one John Bull, and never another retired model', () => {
    for (let version = SAVE_MIN_VERSION; version <= 12; version++) {
      // the v12 to v13 step hands it out as a new starter: left exactly as it was
      const j = migrate(oldSave(version, [item(1, 'rocket', 'loco', null)]));
      expect(count(j, 'john_bull'), `from v${version}`).toBe(1);
      for (const id of FLAGGED.filter((f) => f !== 'john_bull'))
        expect(count(j, id), `${id} from v${version}`).toBe(0);
    }
  });

  it('gives a save up to v12 that already has a John Bull no second one', () => {
    for (let version = SAVE_MIN_VERSION; version <= 12; version++) {
      const j = migrate(oldSave(version, [item(1, 'john_bull', 'loco', null)]));
      expect(count(j, 'john_bull'), `from v${version}`).toBe(1);
      for (const id of FLAGGED.filter((f) => f !== 'john_bull'))
        expect(count(j, id), `${id} from v${version}`).toBe(0);
    }
  });

  it('hands out no retired model from v13 on', () => {
    for (let version = 13; version < SAVE_VERSION; version++) {
      const j = migrate(oldSave(version, [item(1, 'rocket', 'loco', null)]));
      for (const id of FLAGGED) expect(count(j, id), `${id} from v${version}`).toBe(0);
    }
  });

  it('loads the John Bull it was given, with no workshop recipe for it', () => {
    for (let version = SAVE_MIN_VERSION; version <= 12; version++) {
      const w = load(JSON.stringify(oldSave(version, [item(1, 'rocket', 'loco', null)])));
      expect(w.pruned.dropped, `from v${version}`).toEqual([]);
      expect(w.inventory.count('john_bull'), `from v${version}`).toBe(1);
      expect(w.inventory.free('loco').some((it) => it.defId === 'john_bull')).toBe(true);
      expect(w.crafting.knows('john_bull'), `from v${version}`).toBe(false);
      for (const id of FLAGGED) expect(w.crafting.knows(id), `${id} from v${version}`).toBe(false);
      expect(w.crafting.knows('rocket'), `from v${version}`).toBe(true);
    }
  });
});
