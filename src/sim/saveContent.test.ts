import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Dir } from '../engine/iso';
import { TrackGraph } from '../world/track';
import { content } from '../data/content';
import { locoDef, wagonDef } from '../gacha/items';
import { Inventory } from '../gacha/inventory';
import { Station, type StationJSON } from './stations';
import { buildingDef } from './buildings';
import { Train, defaultStop, resetTrainIds, type TrainJob } from './trains';
import type { SaveGame } from './save';
import {
  pruneUnknownContent,
  LIVE_CONTENT,
  UNKNOWN_BUILD_REFUND,
  UNKNOWN_ITEM_REFUND,
  type KnownContent,
} from './saveContent';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => resetTrainIds(1));

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
