import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Dir } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { forAll, shrinkArray } from '../testing/property';
import { TrackGraph } from '../world/track';
import { content } from '../data/content';
import { LOCOS, WAGONS, itemDef, locoDef, wagonDef } from '../gacha/items';
import { Inventory } from '../gacha/inventory';
import { STATION_DEFS, Station, stationDef, type StationJSON } from './stations';
import { BUILDING_DEFS, buildingDef } from './buildings';
import { decorDef } from './build';
import { CARGO } from './cargo';
import { RESOURCE_IDS } from './stockpile';
import { rules, DEFAULT_RULES } from './rules';
import { setSupplyMode, DEFAULT_SUPPLY } from './supply';
import { Train, defaultStop, jobStop, resetTrainIds, type StopPlan, type TrainJob } from './trains';
import { SAVE_VERSION, type SaveGame } from './save';
import {
  pruneUnknownContent,
  LIVE_CONTENT,
  UNKNOWN_BUILD_REFUND,
  UNKNOWN_ITEM_REFUND,
  type KnownContent,
  type PruneReport,
} from './saveContent';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => {
  resetTrainIds(1);
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode(DEFAULT_SUPPLY);
});

type TrainJSON = ReturnType<Train['toJSON']>;
type ItemJSON = ReturnType<Inventory['toJSON']>['items'][number];

/** A straight east-west line the fixture's trains stand on. */
function line() {
  const track = new TrackGraph(48, 16);
  for (let x = 2; x < 40; x++) track.place(x, 5, 'straight', 1);
  return track;
}
/** A saved train standing on the line: `loco` leading, then `wagons` with their loads. */
function trainJSON(
  track: TrackGraph,
  id: number,
  loco: { uid: number; defId: string },
  wagons: { uid: number; defId: string; cargo: string | null; amount: number }[],
  stops: number[],
): TrainJSON {
  // built from shipped models, then renamed to what the save says
  const t = new Train([{ uid: loco.uid, level: 1, def: locoDef('adler') }], undefined, id);
  t.wagons = wagons.map((w) => ({
    uid: w.uid,
    def: wagonDef('flatbed'),
    level: 1,
    cargo: w.cargo,
    amount: w.amount,
    origin: null,
  }));
  t.schedule = stops.map(defaultStop);
  t.spawnAt(track, 10 + id * 10, 5, Dir.W);
  const j = JSON.parse(JSON.stringify(t.toJSON())) as TrainJSON;
  j.locos[0].defId = loco.defId;
  j.wagons.forEach((w, i) => (w.defId = wagons[i].defId));
  return j;
}
function station(id: number, defId: string, storage: Record<string, number> = {}): StationJSON {
  return { id, defId, name: `${defId} ${id}`, x: id * 4, y: 2, level: 1, storage, rot: 0 };
}
function item(
  uid: number,
  defId: string,
  assigned: number | null,
  kind: 'loco' | 'wagon' = 'wagon',
): ItemJSON {
  return { uid, defId, kind, level: 1, assigned, dupes: 0, obtainedAt: 0 };
}
function contract(id: number, originId: number, destId: number) {
  return { id, originId, destId, cargo: 'stone', amount: 50, delivered: 0, status: 'active' };
}

/**
 * A save from a build that had a mill station, a "gone" works, a "gone_decor" service, the
 * "puffer" locomotive and the "gone_wagon" wagon. Every vehicle in a train is also its inventory
 * copy, as the fleet keeps them; one more puffer waits unassigned in the depot.
 */
function oldSave(track: TrackGraph): SaveGame {
  return {
    version: 13,
    savedAt: 0,
    seed: 7,
    clock: { time: 0, speedIndex: 1 },
    economy: { money: 1000, tickets: 3, tier: 0, granted: [], earned: 0 },
    track: [],
    stations: [
      station(1, 'farm', { wheat: 12 }),
      station(2, 'mill', { wheat: 40, food: 10, passengers: 5 }),
      station(3, 'warehouse'),
    ],
    trains: [
      trainJSON(
        track,
        1,
        { uid: 1, defId: 'puffer' },
        [{ uid: 2, defId: 'flatbed', cargo: 'wood', amount: 20 }],
        [1, 3],
      ),
      trainJSON(
        track,
        2,
        { uid: 3, defId: 'adler' },
        [
          { uid: 4, defId: 'gone_wagon', cargo: 'stone', amount: 15 },
          { uid: 7, defId: 'flatbed', cargo: 'wheat', amount: 6 },
        ],
        [1, 2, 3],
      ),
    ],
    contracts: {
      contracts: [contract(1, 1, 3), contract(2, 2, 3), contract(3, 1, 2)],
      nextId: 4,
      nextRefresh: 0,
      stats: { completed: 0, failed: 0 },
      completedToday: 0,
    },
    inventory: {
      items: [
        item(1, 'puffer', 1, 'loco'),
        item(2, 'flatbed', 1),
        item(3, 'adler', 2, 'loco'),
        item(4, 'gone_wagon', 2),
        item(5, 'puffer', null, 'loco'),
        item(6, 'john_bull', null, 'loco'),
        item(7, 'flatbed', 2),
      ],
      nextUid: 8,
    },
    gacha: {},
    camera: { x: 0, y: 0, zoomIndex: 2 },
    lastDay: 0,
    decor: [
      [5, 8, 'signal', 0],
      [6, 8, 'gone_decor', 1],
    ],
    buildings: [
      [10, 10, 'windmill', 0, 1],
      [12, 10, 'gone', 0.5, 2],
    ],
    stockpile: { amounts: { wheat: 100, food: 50 }, famine: false },
  };
}
/** The same save with only shipped content in it. */
function currentSave(track: TrackGraph): SaveGame {
  const j = oldSave(track);
  j.stations = j.stations.filter((s) => s.defId !== 'mill');
  const trains = j.trains as TrainJSON[];
  trains[0].locos[0].defId = 'adler';
  trains[1].wagons[0].defId = 'flatbed';
  trains[1].schedule = trains[1].schedule.filter((s) => s.stationId !== 2);
  const book = j.contracts as { contracts: { originId: number; destId: number }[] };
  book.contracts = book.contracts.filter((c) => c.originId !== 2 && c.destId !== 2);
  const inv = j.inventory as { items: ItemJSON[] };
  inv.items = inv.items.filter((i) => i.uid !== 5);
  inv.items[0] = item(1, 'adler', 1, 'loco');
  inv.items[3] = item(4, 'flatbed', 2);
  j.decor = j.decor!.filter(([, , id]) => id !== 'gone_decor');
  j.buildings = j.buildings!.filter(([, , id]) => id !== 'gone');
  return j;
}

const UNKNOWN = ['mill', 'gone', 'gone_decor', 'puffer', 'gone_wagon'];

describe('pruneUnknownContent', () => {
  // fails today: the save does not load (Station.fromJSON throws "unknown station mill",
  // Train.fromJSON "unknown loco puffer", buildingDef "unknown building gone")
  it('drops what the content no longer defines, so every lookup of the save succeeds', () => {
    const track = line();
    const j = oldSave(track);
    expect(() => Station.fromJSON(j.stations[1])).toThrow('unknown station mill');
    expect(() => Train.fromJSON((j.trains as TrainJSON[])[0], track)).toThrow(
      'unknown loco puffer',
    );
    expect(() => Train.fromJSON((j.trains as TrainJSON[])[1], track)).toThrow(
      'unknown wagon gone_wagon',
    );
    expect(() => buildingDef('gone')).toThrow('unknown building gone');

    pruneUnknownContent(j);

    const text = JSON.stringify(j);
    for (const id of UNKNOWN) expect(text).not.toContain(JSON.stringify(id));
    for (const s of j.stations) expect(() => Station.fromJSON(s)).not.toThrow();
    resetTrainIds(1);
    for (const t of j.trains as TrainJSON[]) expect(() => Train.fromJSON(t, track)).not.toThrow();
    for (const [, , id] of j.buildings!) expect(() => buildingDef(id)).not.toThrow();
    for (const [, , id] of j.decor!) expect(content.decor.some((d) => d.id === id)).toBe(true);
    const inv = new Inventory();
    inv.load(j.inventory as ReturnType<Inventory['toJSON']>);
    for (const it of inv.items) expect(LIVE_CONTENT.vehicle(it.defId, it.kind)).toBe(true);
  });

  it('reports each dropped id with its count and refunds money and tickets at the stated rates', () => {
    const j = oldSave(line());
    const report = pruneUnknownContent(j);
    expect(report.dropped).toEqual([
      { kind: 'station', id: 'mill', count: 1 },
      { kind: 'works', id: 'gone', count: 1 },
      { kind: 'decor', id: 'gone_decor', count: 1 },
      { kind: 'vehicle', id: 'puffer', count: 1 },
      { kind: 'vehicle', id: 'gone_wagon', count: 1 },
      // the puffer in train 1 is inventory copy 1, refunded once; copy 5 is the spare
      { kind: 'item', id: 'puffer', count: 1 },
    ]);
    expect(report.money).toBe(3 * UNKNOWN_BUILD_REFUND);
    expect(report.tickets).toBe(3 * UNKNOWN_ITEM_REFUND);
    expect(j.economy.money).toBe(1000 + report.money);
    expect(j.economy.tickets).toBe(3 + report.tickets);
  });

  it('salvages goods into the stockpile and unhooks contracts, stops and inventory', () => {
    const j = oldSave(line());
    pruneUnknownContent(j);
    // mill storage (wheat 40, food 10; passengers are not stockpiled), the gone wagon's stone,
    // and the wood of train 1, taken off the line with no locomotive left
    expect((j.stockpile as { amounts: Record<string, number> }).amounts).toEqual({
      wheat: 140,
      food: 60,
      stone: 15,
      wood: 20,
    });
    expect(j.stations.map((s) => s.id)).toEqual([1, 3]);
    const book = j.contracts as { contracts: { id: number }[] };
    expect(book.contracts.map((c) => c.id)).toEqual([1]);
    const trains = j.trains as TrainJSON[];
    expect(trains.map((t) => t.id)).toEqual([2]);
    expect(trains[0].locos.map((l) => l.defId)).toEqual(['adler']);
    expect(trains[0].wagons.map((w) => w.uid)).toEqual([7]);
    expect(trains[0].schedule.map((s) => s.stationId)).toEqual([1, 3]);
    const items = (j.inventory as { items: ItemJSON[] }).items;
    expect(items.map((i) => [i.uid, i.assigned])).toEqual([
      [2, null],
      [3, 2],
      [6, null],
      [7, 2],
    ]);
  });

  it('leaves a save with nothing unknown as it was, and finds nothing on a second run', () => {
    const track = line();
    const clean = currentSave(track);
    const before = JSON.parse(JSON.stringify(clean)) as SaveGame;
    expect(pruneUnknownContent(clean)).toEqual({ dropped: [], money: 0, tickets: 0 });
    expect(clean).toEqual(before);

    const j = oldSave(track);
    pruneUnknownContent(j);
    const once = JSON.parse(JSON.stringify(j)) as SaveGame;
    expect(pruneUnknownContent(j)).toEqual({ dropped: [], money: 0, tickets: 0 });
    expect(j).toEqual(once);
  });

  it('keeps each train heading for the stop it was bound for, or the next one left', () => {
    const track = line();
    const j = oldSave(track);
    // declare the farm unknown too: the save is the same, the content is not
    const known: KnownContent = { ...LIVE_CONTENT, station: (id) => id === 'warehouse' };
    const t = (j.trains as TrainJSON[])[1];
    const job = (contractId: number, originId: number, destId: number): TrainJob => ({
      contractId,
      name: `job ${contractId}`,
      originId,
      destId,
      cargo: 'stone',
    });
    // working contract 3 (farm -> mill) with its program set aside; contract 1 queued
    t.schedule = [defaultStop(1), defaultStop(2)];
    t.routeIndex = 1;
    t.job = job(3, 1, 2);
    t.jobPhase = 'dest';
    t.jobs = [job(1, 1, 3)];
    t.detour = 1;
    t.suspended = {
      schedule: [defaultStop(3), defaultStop(1), defaultStop(2), defaultStop(3)],
      routeIndex: 2,
    };
    pruneUnknownContent(j, known);
    expect(j.stations.map((s) => s.defId)).toEqual(['warehouse']);
    expect((j.contracts as { contracts: unknown[] }).contracts).toEqual([]);
    expect(t.job).toBeNull();
    expect(t.jobs).toEqual([]);
    expect(t.detour).toBeNull();
    // back on its program: it was bound for stop 2 (the mill); the next one left is the last warehouse
    expect(t.suspended).toBeNull();
    expect(t.schedule.map((s) => s.stationId)).toEqual([3, 3]);
    expect(t.routeIndex).toBe(1);
  });
});

describe('Inventory.load', () => {
  // fails today: the puffer is kept, and the first lookup of its model throws
  it('leaves out copies of models the content does not define', () => {
    const inv = new Inventory();
    inv.load({ items: [item(1, 'puffer', null), item(2, 'adler', null)], nextUid: 3 });
    expect(inv.items.map((i) => i.defId)).toEqual(['adler']);
    expect(inv.count('puffer')).toBe(0);
  });
});

// ---------------------------------------------------------------- properties over random saves
//
// For a random save and a random share of the shipped ids declared unknown through KnownContent:
// every id left is known, the refund is the per-kind counts times the rates, goods are moved and
// not lost, nothing points at what went, a second run finds nothing, and a save with nothing
// unknown is left as it was. A case is a compact spec the save is built from, so forAll can shrink
// it and every shrunk save stays whole.

/** Ids of each table the game ships. */
const SHIPPED = {
  station: STATION_DEFS.map((d) => d.id),
  works: BUILDING_DEFS.map((d) => d.id),
  decor: content.decor.map((d) => d.id),
  loco: LOCOS.map((d) => d.id),
  wagon: WAGONS.map((d) => d.id),
};
/** Ids no table defines: content an update removed. They are always unknown. */
const NEVER = {
  station: ['mill', 'old_halt'],
  works: ['gone', 'old_works'],
  decor: ['gone_decor'],
  loco: ['puffer', 'old_tank'],
  wagon: ['gone_wagon', 'old_coach'],
};
const LOCO_IDS = new Set([...SHIPPED.loco, ...NEVER.loco]);
/** What a store or a wagon may hold: every cargo, passengers included, and one the game dropped. */
const GOODS = [...CARGO.map((c) => c.id), 'gone_cargo'];
const EMPTY: PruneReport = { dropped: [], money: 0, tickets: 0 };

interface WagonSpec {
  defId: string;
  cargo: string | null;
  amount: number;
}
interface TrainSpec {
  /** at least one */
  locos: string[];
  wagons: WagonSpec[];
  /** station ids of the standing program, and the index of the stop it is bound for */
  program: number[];
  at: number;
  /** index into the spec's contracts of the one being worked, its program set aside; or null */
  job: number | null;
  phase: 'origin' | 'dest';
  /** indices of the spec's contracts queued after it */
  queue: number[];
  detour: number | null;
  /** the station it stands at, or null */
  station: number | null;
}
interface SaveSpec {
  /** station `i` gets id `i + 1` */
  stations: { defId: string; storage: [string, number][] }[];
  /** [origin, destination] station ids; contract `i` gets id `i + 1` */
  contracts: [number, number][];
  /** train `i` gets id `i + 1`; each vehicle is also its inventory copy, as the fleet keeps them */
  trains: TrainSpec[];
  /** copies waiting in the depot */
  spares: string[];
  works: string[];
  decor: string[];
  /** null: the save has no stockpile */
  stock: [string, number][] | null;
  /** shipped ids declared unknown, per predicate */
  unknown: { station: string[]; works: string[]; decor: string[]; vehicle: string[] };
}

type ContractJSON = ReturnType<typeof contract>;
const trainsOf = (j: SaveGame) => j.trains as TrainJSON[];
const itemsOf = (j: SaveGame) => (j.inventory as { items: ItemJSON[] }).items;
const contractsOf = (j: SaveGame) => (j.contracts as { contracts: ContractJSON[] }).contracts;
const stockOf = (j: SaveGame) =>
  (j.stockpile as { amounts: Record<string, number> } | undefined)?.amounts;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function genSpec(rng: Rng, removed = true): SaveSpec {
  const id = (kind: keyof typeof SHIPPED) =>
    removed && rng.chance(0.15) ? rng.pick(NEVER[kind]) : rng.pick(SHIPPED[kind]);
  // now and then a slot names a model of the other table, as if the content had moved it
  const slot = (kind: 'loco' | 'wagon') =>
    removed && rng.chance(0.05) ? rng.pick(SHIPPED[kind === 'loco' ? 'wagon' : 'loco']) : id(kind);
  const list = <T>(max: number, f: () => T): T[] => Array.from({ length: rng.int(0, max) }, f);
  const goods = (max: number) =>
    list(max, (): [string, number] => [rng.pick(GOODS), rng.int(1, 60)]);
  const stations = list(6, () => ({ defId: id('station'), storage: goods(3) }));
  const stationId = () => rng.int(1, stations.length);
  const contracts = stations.length
    ? list(5, (): [number, number] => [stationId(), stationId()])
    : [];
  const contractAt = () => rng.int(0, contracts.length - 1);
  const trains = list(5, (): TrainSpec => {
    const program = stations.length ? list(5, stationId) : [];
    return {
      locos: Array.from({ length: rng.int(1, 3) }, () => slot('loco')),
      wagons: list(4, () => {
        const cargo = rng.chance(0.3) ? null : rng.pick(GOODS);
        return { defId: slot('wagon'), cargo, amount: cargo ? rng.int(1, 40) : 0 };
      }),
      program,
      at: program.length ? rng.int(0, program.length - 1) : 0,
      job: contracts.length && rng.chance(0.4) ? contractAt() : null,
      phase: rng.chance(0.5) ? 'origin' : 'dest',
      queue: contracts.length ? list(2, contractAt) : [],
      detour: stations.length && rng.chance(0.25) ? stationId() : null,
      station: stations.length && rng.chance(0.25) ? stationId() : null,
    };
  });
  const spares = list(4, () => (rng.chance(0.5) ? id('loco') : id('wagon')));
  const works = list(4, () => id('works'));
  const decor = list(4, () => id('decor'));
  const stock = rng.chance(0.1)
    ? null
    : list(4, (): [string, number] => [rng.pick(RESOURCE_IDS), rng.int(0, 200)]);
  // none of the shipped ids, a few, some or most of them
  const share = rng.pick([0, 0.1, 0.3, 0.7]);
  const some = (ids: string[]) => ids.filter(() => rng.chance(share));
  const unknown = {
    station: some(SHIPPED.station),
    works: some(SHIPPED.works),
    decor: some(SHIPPED.decor),
    vehicle: some([...SHIPPED.loco, ...SHIPPED.wagon]),
  };
  return { stations, contracts, trains, spares, works, decor, stock, unknown };
}

/** A save made only of shipped content, with only ids it does not use declared unknown. */
function genClean(rng: Rng): SaveSpec {
  const spec = genSpec(rng, false);
  const used = new Set([
    ...spec.stations.map((s) => s.defId),
    ...spec.trains.flatMap((t) => [...t.locos, ...t.wagons.map((w) => w.defId)]),
    ...spec.spares,
    ...spec.works,
    ...spec.decor,
  ]);
  const unused = (ids: string[]) => ids.filter((x) => !used.has(x));
  const u = spec.unknown;
  return {
    ...spec,
    unknown: {
      station: unused(u.station),
      works: unused(u.works),
      decor: unused(u.decor),
      vehicle: unused(u.vehicle),
    },
  };
}

/** Smaller specs: fewer of anything, simpler trains. A reference that loses its target goes. */
function* shrinkSpec(spec: SaveSpec): Iterable<SaveSpec> {
  for (const trains of shrinkArray(spec.trains, shrinkTrain)) yield { ...spec, trains };
  const emptied = (s: SaveSpec['stations'][number]) =>
    s.storage.length ? [{ ...s, storage: [] }] : [];
  for (const stations of shrinkArray(spec.stations, emptied)) yield { ...spec, stations };
  for (const contracts of shrinkArray(spec.contracts)) yield { ...spec, contracts };
  for (const spares of shrinkArray(spec.spares)) yield { ...spec, spares };
  for (const works of shrinkArray(spec.works)) yield { ...spec, works };
  for (const decor of shrinkArray(spec.decor)) yield { ...spec, decor };
  if (spec.stock) for (const stock of shrinkArray(spec.stock)) yield { ...spec, stock };
  for (const kind of ['station', 'works', 'decor', 'vehicle'] as const)
    for (const ids of shrinkArray(spec.unknown[kind]))
      yield { ...spec, unknown: { ...spec.unknown, [kind]: ids } };
}
function* shrinkTrain(t: TrainSpec): Iterable<TrainSpec> {
  for (const wagons of shrinkArray(t.wagons)) yield { ...t, wagons };
  for (const locos of shrinkArray(t.locos)) if (locos.length) yield { ...t, locos };
  for (const program of shrinkArray(t.program)) yield { ...t, program };
  if (t.at) yield { ...t, at: 0 };
  if (t.job !== null) yield { ...t, job: null };
  for (const queue of shrinkArray(t.queue)) yield { ...t, queue };
  if (t.detour !== null) yield { ...t, detour: null };
  if (t.station !== null) yield { ...t, station: null };
}

/** The shipped tables, minus the ids the spec declares unknown; each slot reads its own table. */
function knownFor(u: SaveSpec['unknown']): KnownContent {
  const off = {
    station: new Set(u.station),
    works: new Set(u.works),
    decor: new Set(u.decor),
    vehicle: new Set(u.vehicle),
  };
  return {
    station: (id) => SHIPPED.station.includes(id) && !off.station.has(id),
    works: (id) => SHIPPED.works.includes(id) && !off.works.has(id),
    decor: (id) => SHIPPED.decor.includes(id) && !off.decor.has(id),
    vehicle: (id, kind) =>
      !off.vehicle.has(id) &&
      ((kind !== 'wagon' && SHIPPED.loco.includes(id)) ||
        (kind !== 'loco' && SHIPPED.wagon.includes(id))),
  };
}

/** A saved train as `Train.toJSON` writes it, standing nowhere, its vehicles named as given. */
function savedTrain(
  id: number,
  locos: { uid: number; defId: string }[],
  wagons: (WagonSpec & { uid: number })[],
): TrainJSON {
  // built from shipped models, then renamed to what the save says
  const t = new Train(
    locos.map((l) => ({
      uid: l.uid,
      level: 1,
      def: locoDef(SHIPPED.loco.includes(l.defId) ? l.defId : 'adler'),
    })),
    undefined,
    id,
  );
  t.wagons = wagons.map((w) => ({
    uid: w.uid,
    def: wagonDef(SHIPPED.wagon.includes(w.defId) ? w.defId : 'flatbed'),
    level: 1,
    cargo: w.cargo,
    amount: w.amount,
    origin: null,
  }));
  const j = clone(t.toJSON());
  j.locos.forEach((l, k) => (l.defId = locos[k].defId));
  j.wagons.forEach((w, k) => (w.defId = wagons[k].defId));
  return j;
}
const jobOf = (c: ContractJSON): TrainJob => ({
  contractId: c.id,
  name: `contract ${c.id}`,
  originId: c.originId,
  destId: c.destId,
  cargo: c.cargo,
});

/** The save a spec describes, as `JSON.parse` hands it to the load. */
function buildSave(spec: SaveSpec): SaveGame {
  const exists = (id: number) => id >= 1 && id <= spec.stations.length;
  const contracts = spec.contracts.flatMap(([o, d], i) =>
    exists(o) && exists(d) ? [contract(i + 1, o, d)] : [],
  );
  const contractAt = (i: number) => contracts.find((c) => c.id === i + 1);
  const items: ItemJSON[] = [];
  let uid = 1;
  const trains = spec.trains.map((ts, i) => {
    const id = i + 1;
    const locos = ts.locos.map((defId) => ({ uid: uid++, defId }));
    const wagons = ts.wagons.map((w) => ({ ...w, uid: uid++ }));
    for (const l of locos) items.push(item(l.uid, l.defId, id, 'loco'));
    for (const w of wagons) items.push(item(w.uid, w.defId, id, 'wagon'));
    const j = savedTrain(id, locos, wagons);
    const program = ts.program.filter(exists).map(defaultStop);
    const at = program.length ? ts.at % program.length : 0;
    const job = ts.job === null ? undefined : contractAt(ts.job);
    if (job) {
      j.suspended = { schedule: program, routeIndex: at };
      j.job = jobOf(job);
      j.jobPhase = ts.phase;
      j.schedule = [jobStop(job.originId, 'origin'), jobStop(job.destId, 'dest')];
      j.routeIndex = ts.phase === 'dest' ? 1 : 0;
    } else {
      j.schedule = program;
      j.routeIndex = at;
    }
    j.jobs = ts.queue.flatMap((q) => {
      const c = contractAt(q);
      return c ? [jobOf(c)] : [];
    });
    j.detour = ts.detour !== null && exists(ts.detour) ? ts.detour : null;
    j.station = ts.station !== null && exists(ts.station) ? ts.station : null;
    return j;
  });
  for (const defId of spec.spares)
    items.push(item(uid++, defId, null, LOCO_IDS.has(defId) ? 'loco' : 'wagon'));
  const save: SaveGame = {
    version: SAVE_VERSION,
    savedAt: 0,
    seed: 7,
    clock: { time: 0, speedIndex: 1 },
    economy: { money: 1000, tickets: 3, tier: 0, granted: [], earned: 0 },
    track: [],
    stations: spec.stations.map((s, i) => station(i + 1, s.defId, Object.fromEntries(s.storage))),
    trains,
    contracts: {
      contracts,
      nextId: spec.contracts.length + 1,
      nextRefresh: 0,
      stats: { completed: 0, failed: 0 },
      completedToday: 0,
    },
    inventory: { items, nextUid: uid },
    gacha: {},
    camera: { x: 0, y: 0, zoomIndex: 2 },
    lastDay: 0,
    decor: spec.decor.map((id, i) => [i, 8, id, 0]),
    buildings: spec.works.map((id, i) => [i * 3, 10, id, 0, 1]),
  };
  if (spec.stock) save.stockpile = { amounts: Object.fromEntries(spec.stock), famine: false };
  return clone(save);
}

/** Build the spec's save, keep a copy of it as it was, and prune it with the spec's content. */
function pruned(spec: SaveSpec) {
  const j = buildSave(spec);
  const before = clone(j);
  const known = knownFor(spec.unknown);
  const report = pruneUnknownContent(j, known);
  return { j, before, known, report };
}

/**
 * A program after pruning: the stops left, in order, bound for the stop it was heading for or,
 * when that one went, the next one left (found the slow way: walk on, wrapping at the end).
 */
function expectProgram(
  after: { schedule: StopPlan[]; routeIndex: number } | null,
  before: { schedule: StopPlan[]; routeIndex: number },
  gone: Set<number>,
  where: string,
) {
  const left = before.schedule.map((s, i) => ({ s, i })).filter(({ s }) => !gone.has(s.stationId));
  expect(after?.schedule, where).toEqual(left.map(({ s }) => s));
  let want = 0;
  for (let k = 0; k < before.schedule.length; k++) {
    const at = left.findIndex((l) => l.i === (before.routeIndex + k) % before.schedule.length);
    if (at >= 0) {
      want = at;
      break;
    }
  }
  expect(after?.routeIndex, `${where}: routeIndex`).toBe(want);
}

describe('pruneUnknownContent over random saves', () => {
  const bySpec = { shrink: shrinkSpec };

  it('leaves only ids the content defines, so every lookup of the save succeeds', () => {
    const track = new TrackGraph(8, 8);
    forAll(
      genSpec,
      (spec) => {
        const { j, known } = pruned(spec);
        for (const s of j.stations) expect(known.station(s.defId), s.defId).toBe(true);
        for (const [, , id] of j.buildings!) expect(known.works(id), id).toBe(true);
        for (const [, , id] of j.decor!) expect(known.decor(id), id).toBe(true);
        for (const t of trainsOf(j)) {
          expect(t.locos.length, `train ${t.id} has a locomotive`).toBeGreaterThan(0);
          for (const l of t.locos) expect(known.vehicle(l.defId, 'loco'), l.defId).toBe(true);
          for (const w of t.wagons) expect(known.vehicle(w.defId, 'wagon'), w.defId).toBe(true);
        }
        for (const it of itemsOf(j)) expect(known.vehicle(it.defId), it.defId).toBe(true);
        // the game's own lookups, each of which throws on an id it does not know
        for (const s of j.stations) Station.fromJSON(s);
        for (const t of trainsOf(j)) Train.fromJSON(t, track);
        for (const [, , id] of j.buildings!) buildingDef(id);
        for (const [, , id] of j.decor!) decorDef(id);
        const inv = new Inventory();
        inv.load(j.inventory as ReturnType<Inventory['toJSON']>);
        expect(inv.items, 'Inventory.load keeps every copy left').toEqual(itemsOf(j));
        for (const it of inv.items) itemDef(it.defId);
      },
      bySpec,
    );
  });

  it('drops exactly what is unknown and the trains left with no locomotive; the rest stays', () => {
    forAll(
      genSpec,
      (spec) => {
        const { j, before, known } = pruned(spec);
        expect(j.stations).toEqual(before.stations.filter((s) => known.station(s.defId)));
        expect(j.buildings).toEqual(before.buildings!.filter(([, , id]) => known.works(id)));
        expect(j.decor).toEqual(before.decor!.filter(([, , id]) => known.decor(id)));
        const pulled = trainsOf(before).filter((t) =>
          t.locos.some((l) => known.vehicle(l.defId, 'loco')),
        );
        expect(trainsOf(j).map((t) => t.id)).toEqual(pulled.map((t) => t.id));
        // what a train is made of; its stops and jobs are the unhooking property's
        const body = (t: TrainJSON) => ({
          ...t,
          schedule: null,
          routeIndex: null,
          suspended: null,
          detour: null,
          station: null,
          jobs: null,
          job: null,
          jobPhase: null,
        });
        trainsOf(j).forEach((t, k) => {
          const b = pulled[k];
          expect(body(t), `train ${t.id}`).toStrictEqual(
            body({
              ...b,
              locos: b.locos.filter((l) => known.vehicle(l.defId, 'loco')),
              wagons: b.wagons.filter((w) => known.vehicle(w.defId, 'wagon')),
            }),
          );
        });
        // inventory copies stay as they were but for which train they serve
        const copy = (i: ItemJSON) => ({ ...i, assigned: null });
        expect(itemsOf(j).map(copy)).toStrictEqual(
          itemsOf(before)
            .filter((i) => known.vehicle(i.defId))
            .map(copy),
        );
        // and nothing else in the save moves
        const outside = (s: SaveGame) => ({
          ...s,
          stations: null,
          trains: null,
          decor: null,
          buildings: null,
          stockpile: null,
          economy: { ...s.economy, money: null, tickets: null },
          contracts: { ...(s.contracts as object), contracts: null },
          inventory: { ...(s.inventory as object), items: null },
        });
        expect(outside(j)).toStrictEqual(outside(before));
      },
      bySpec,
    );
  });

  it('reports each dropped id with its count, refunded per kind at the stated rates', () => {
    forAll(
      genSpec,
      (spec) => {
        const { j, before, known, report } = pruned(spec);
        const want = new Map<string, number>();
        const add = (kind: string, id: string) =>
          want.set(`${kind} ${id}`, (want.get(`${kind} ${id}`) ?? 0) + 1);
        for (const s of before.stations) if (!known.station(s.defId)) add('station', s.defId);
        for (const [, , id] of before.buildings!) if (!known.works(id)) add('works', id);
        for (const [, , id] of before.decor!) if (!known.decor(id)) add('decor', id);
        const inService = new Set<number>();
        for (const t of trainsOf(before)) {
          const slots = [
            ...t.locos.map((v) => ({ v, kind: 'loco' as const })),
            ...t.wagons.map((v) => ({ v, kind: 'wagon' as const })),
          ];
          for (const { v, kind } of slots)
            if (!known.vehicle(v.defId, kind)) {
              add('vehicle', v.defId);
              inService.add(v.uid);
            }
        }
        // a vehicle in a train is also its inventory copy: one copy, one refund
        for (const it of itemsOf(before))
          if (!known.vehicle(it.defId) && !inService.has(it.uid)) add('item', it.defId);

        const got = new Map(report.dropped.map((d) => [`${d.kind} ${d.id}`, d.count]));
        expect(got.size, 'one entry per kind and id').toBe(report.dropped.length);
        expect(got).toEqual(want);
        const count = (...kinds: string[]) =>
          report.dropped.filter((d) => kinds.includes(d.kind)).reduce((n, d) => n + d.count, 0);
        expect(report.money).toBe(count('station', 'works', 'decor') * UNKNOWN_BUILD_REFUND);
        expect(report.tickets).toBe(count('vehicle', 'item') * UNKNOWN_ITEM_REFUND);
        expect(j.economy.money).toBe(before.economy.money + report.money);
        expect(j.economy.tickets).toBe(before.economy.tickets + report.tickets);
      },
      bySpec,
    );
  });

  it('moves the storable goods of what went into the stockpile, so none are made or lost', () => {
    forAll(
      genSpec,
      (spec) => {
        const { j, before } = pruned(spec);
        const stock = stockOf(j);
        if (!stock) {
          expect(j.stockpile, 'no stockpile is made up').toBeUndefined();
          return;
        }
        const held = (s: SaveGame) => {
          const n: Record<string, number> = {};
          const add = (cargo: string | null, amount: number) => {
            if (cargo && RESOURCE_IDS.includes(cargo)) n[cargo] = (n[cargo] ?? 0) + amount;
          };
          for (const [c, a] of Object.entries(stockOf(s)!)) add(c, a);
          for (const st of s.stations) for (const [c, a] of Object.entries(st.storage)) add(c, a);
          for (const t of trainsOf(s)) for (const w of t.wagons) add(w.cargo, w.amount);
          return n;
        };
        expect(held(j)).toEqual(held(before));
        // passengers and cargo the game dropped are never stockpiled
        for (const c of Object.keys(stock))
          expect(c in stockOf(before)! || RESOURCE_IDS.includes(c), c).toBe(true);
      },
      bySpec,
    );
  });

  it('leaves no contract, stop, job or inventory copy pointing at what went', () => {
    forAll(
      genSpec,
      (spec) => {
        const { j, before, known } = pruned(spec);
        const gone = new Set(
          before.stations.filter((s) => !known.station(s.defId)).map((s) => s.id),
        );
        const touches = (c: { originId: number; destId: number }) =>
          gone.has(c.originId) || gone.has(c.destId);
        const cancelled = new Set(
          contractsOf(before)
            .filter(touches)
            .map((c) => c.id),
        );
        expect(contractsOf(j)).toEqual(contractsOf(before).filter((c) => !cancelled.has(c.id)));
        const lapsed = (job: TrainJob) => cancelled.has(job.contractId) || touches(job);
        const was = new Map(trainsOf(before).map((t) => [t.id, t]));
        for (const t of trainsOf(j)) {
          const b = was.get(t.id)!;
          const where = `train ${t.id}`;
          expect(t.jobs, where).toEqual(b.jobs.filter((job) => !lapsed(job)));
          expect(t.detour, where).toBe(b.detour !== null && gone.has(b.detour) ? null : b.detour);
          expect(t.station, where).toBe(
            b.station !== null && gone.has(b.station) ? null : b.station,
          );
          if (b.job && lapsed(b.job)) {
            // its contract went: the job ends and the program it set aside resumes
            expect(t.job, where).toBeNull();
            expect(t.jobPhase, where).toBe('origin');
            expect(t.suspended, where).toBeNull();
            expectProgram(t, b.suspended ?? b, gone, `${where} resumed`);
          } else {
            expect(t.job, where).toEqual(b.job);
            expect(t.jobPhase, where).toBe(b.jobPhase);
            expectProgram(t, b, gone, where);
            if (b.suspended) expectProgram(t.suspended, b.suspended, gone, `${where} set aside`);
            else expect(t.suspended, where).toBeNull();
          }
        }
        // the fleet and the inventory still agree on which copy runs in which train
        const running = new Map<number, number>();
        for (const t of trainsOf(j))
          for (const v of [...t.locos, ...t.wagons]) running.set(v.uid, t.id);
        const assigned = new Map<number, number>();
        for (const i of itemsOf(j)) if (i.assigned !== null) assigned.set(i.uid, i.assigned);
        expect(assigned).toEqual(running);
      },
      bySpec,
    );
  });

  it('finds nothing on a second run and changes nothing', () => {
    forAll(
      genSpec,
      (spec) => {
        const { j, known } = pruned(spec);
        const once = clone(j);
        expect(pruneUnknownContent(j, known)).toStrictEqual(EMPTY);
        expect(j).toStrictEqual(once);
      },
      bySpec,
    );
  });

  it('leaves a save with nothing unknown in it exactly as it was', () => {
    forAll(
      genClean,
      (spec) => {
        const j = buildSave(spec);
        const before = clone(j);
        expect(pruneUnknownContent(j, knownFor(spec.unknown))).toStrictEqual(EMPTY);
        expect(j).toStrictEqual(before);
        // and with the live content, which ships every id the save uses
        expect(pruneUnknownContent(j)).toStrictEqual(EMPTY);
        expect(j).toStrictEqual(before);
      },
      bySpec,
    );
  });
});

describe('LIVE_CONTENT', () => {
  it('agrees with the lookup each predicate guards, for every id of every table', () => {
    const finds = (lookup: (id: string) => unknown, id: string) => {
      try {
        lookup(id);
        return true;
      } catch {
        return false;
      }
    };
    for (const id of [...Object.values(SHIPPED), ...Object.values(NEVER)].flat()) {
      expect(LIVE_CONTENT.station(id), `station ${id}`).toBe(finds(stationDef, id));
      expect(LIVE_CONTENT.works(id), `works ${id}`).toBe(finds(buildingDef, id));
      expect(LIVE_CONTENT.decor(id), `decor ${id}`).toBe(finds(decorDef, id));
      // a locomotive slot is read with locoDef, a wagon slot with wagonDef, an item with either
      expect(LIVE_CONTENT.vehicle(id, 'loco'), `loco ${id}`).toBe(finds(locoDef, id));
      expect(LIVE_CONTENT.vehicle(id, 'wagon'), `wagon ${id}`).toBe(finds(wagonDef, id));
      expect(LIVE_CONTENT.vehicle(id), `vehicle ${id}`).toBe(
        finds(locoDef, id) || finds(wagonDef, id),
      );
    }
  });
});
