/**
 * Content a save names that the game no longer defines: removed in an update, or hidden by a
 * content override. Loading such a save used to throw at the first lookup ("unknown station
 * mill"); instead the things are dropped before the save is applied, the player is refunded and
 * a report says what went. It works on the parsed save alone: no DOM, no storage.
 */
import type { SaveGame } from './save';
import type { StopPlan, TrainJob } from './trains';
import { STATION_DEFS } from './stations';
import { BUILDING_DEFS } from './buildings';
import { RESOURCE_IDS } from './stockpile';
import { content } from '../data/content';
import { LOCOS, WAGONS } from '../gacha/items';

/** Money refunded for each dropped station, works or service; about the cheapest station's cost. */
export const UNKNOWN_BUILD_REFUND = 250;
/** Tickets refunded for each dropped vehicle or inventory item (one pull or recipe each). */
export const UNKNOWN_ITEM_REFUND = 1;

/** Which ids the content defines. `vehicle` checks one table when given a kind, either without. */
export interface KnownContent {
  station(id: string): boolean;
  works(id: string): boolean;
  decor(id: string): boolean;
  vehicle(id: string, kind?: 'loco' | 'wagon'): boolean;
}
/** The live content tables (decor is read from the bundle: `build.ts` would pull in audio). */
export const LIVE_CONTENT: KnownContent = {
  station: (id) => STATION_DEFS.some((d) => d.id === id),
  works: (id) => BUILDING_DEFS.some((d) => d.id === id),
  decor: (id) => content.decor.some((d) => d.id === id),
  vehicle: (id, kind) =>
    (kind !== 'wagon' && LOCOS.some((d) => d.id === id)) ||
    (kind !== 'loco' && WAGONS.some((d) => d.id === id)),
};

export type DroppedKind = 'station' | 'works' | 'decor' | 'vehicle' | 'item';
export interface PruneReport {
  /** what went, one entry per kind and id, in the order found */
  dropped: { kind: DroppedKind; id: string; count: number }[];
  /** money added to the economy */
  money: number;
  /** tickets added to the economy */
  tickets: number;
}

/** The parts of a saved train this pass reads (`Train.toJSON`; older saves may lack the job fields). */
interface TrainSave {
  id: number;
  locos: { uid: number; defId: string }[];
  wagons: { uid: number; defId: string; cargo: string | null; amount: number }[];
  schedule: StopPlan[];
  routeIndex: number;
  suspended?: { schedule: StopPlan[]; routeIndex: number } | null;
  detour?: number | null;
  jobs?: TrainJob[];
  job?: TrainJob | null;
  jobPhase?: 'origin' | 'dest';
}
interface ItemSave {
  uid: number;
  defId: string;
  assigned: number | null;
}

/**
 * Drop from `j` (in place) every station, works, service, train vehicle and inventory item whose
 * id `known` does not define, with what hangs on them: a dropped station's goods go to the
 * stockpile, its contracts are cancelled and trains skip its stops; a train left without a
 * locomotive is taken off the line and its wagons go back to the inventory; a dropped wagon's
 * cargo goes to the stockpile. A vehicle in a train and its inventory entry are one copy and are
 * refunded once. Running it again finds nothing.
 */
export function pruneUnknownContent(j: SaveGame, known: KnownContent = LIVE_CONTENT): PruneReport {
  const report: PruneReport = { dropped: [], money: 0, tickets: 0 };
  const drop = (kind: DroppedKind, id: string) => {
    const e = report.dropped.find((d) => d.kind === kind && d.id === id);
    if (e) e.count++;
    else report.dropped.push({ kind, id, count: 1 });
    if (kind === 'vehicle' || kind === 'item') report.tickets += UNKNOWN_ITEM_REFUND;
    else report.money += UNKNOWN_BUILD_REFUND;
  };
  const amounts = stockpileAmounts(j);
  const toStock = (cargo: string | null, amount: number) => {
    // passengers and goods the game no longer has cannot be stored
    if (!amounts || !cargo || !(amount > 0) || !RESOURCE_IDS.includes(cargo)) return;
    amounts[cargo] = (amounts[cargo] ?? 0) + amount;
  };

  // stations, and everything that names one
  const gone = new Set<number>();
  if (j.stations.some((s) => !known.station(s.defId)))
    j.stations = j.stations.filter((s) => {
      if (known.station(s.defId)) return true;
      drop('station', s.defId);
      gone.add(s.id);
      for (const [cargo, v] of Object.entries(s.storage ?? {})) toStock(cargo, v);
      return false;
    });
  const cancelled = new Set<number>();
  const board = j.contracts as
    { contracts?: { id: number; originId: number; destId: number }[] } | undefined;
  if (gone.size && board && Array.isArray(board.contracts))
    board.contracts = board.contracts.filter((c) => {
      const keep = !gone.has(c.originId) && !gone.has(c.destId);
      if (!keep) cancelled.add(c.id);
      return keep;
    });

  // works and services
  if (j.buildings?.some(([, , id]) => !known.works(id)))
    j.buildings = j.buildings.filter(([, , id]) => {
      if (known.works(id)) return true;
      drop('works', id);
      return false;
    });
  if (j.decor?.some(([, , id]) => !known.decor(id)))
    j.decor = j.decor.filter(([, , id]) => {
      if (known.decor(id)) return true;
      drop('decor', id);
      return false;
    });

  // trains: stops at dropped stations, then vehicles the content no longer has
  // inventory uid -> model of every vehicle taken out of a train
  const lostCopies = new Map<number, string>();
  const offLine = new Set<number>();
  const trains = j.trains as TrainSave[];
  for (const t of trains) {
    if (gone.size) forgetStations(t, gone, cancelled);
    if (t.locos.some((l) => !known.vehicle(l.defId, 'loco')))
      t.locos = t.locos.filter((l) => {
        if (known.vehicle(l.defId, 'loco')) return true;
        drop('vehicle', l.defId);
        lostCopies.set(l.uid, l.defId);
        return false;
      });
    if (t.wagons.some((w) => !known.vehicle(w.defId, 'wagon')))
      t.wagons = t.wagons.filter((w) => {
        if (known.vehicle(w.defId, 'wagon')) return true;
        drop('vehicle', w.defId);
        lostCopies.set(w.uid, w.defId);
        toStock(w.cargo, w.amount);
        return false;
      });
    if (t.locos.length) continue;
    // nothing left to pull it: the wagons go back to the inventory and unload into the stockpile
    offLine.add(t.id);
    for (const w of t.wagons) toStock(w.cargo, w.amount);
  }
  if (offLine.size) j.trains = trains.filter((t) => !offLine.has(t.id));

  // inventory: unknown models go; a copy already refunded as a train vehicle is not counted again
  const inv = j.inventory as { items?: ItemSave[] } | undefined;
  if (inv && Array.isArray(inv.items)) {
    if (inv.items.some((it) => !known.vehicle(it.defId)))
      inv.items = inv.items.filter((it) => {
        if (known.vehicle(it.defId)) return true;
        if (lostCopies.get(it.uid) !== it.defId) drop('item', it.defId);
        return false;
      });
    for (const it of inv.items)
      if (it.assigned !== null && (offLine.has(it.assigned) || lostCopies.has(it.uid)))
        it.assigned = null;
  }

  if (report.money) j.economy.money += report.money;
  if (report.tickets) j.economy.tickets += report.tickets;
  return report;
}

/** The stockpile's amounts to add salvaged goods to, or null when the save has no stockpile. */
function stockpileAmounts(j: SaveGame): Record<string, number> | null {
  const s = j.stockpile as { amounts?: Record<string, number> } | undefined;
  return s && s.amounts && typeof s.amounts === 'object' ? s.amounts : null;
}

/**
 * Take dropped stations out of a train's schedules and jobs. The index keeps pointing at the stop
 * the train was heading for, or the next one left; a job whose contract was cancelled ends, and
 * the program it set aside resumes the way `Train.resumeProgram` does.
 */
function forgetStations(t: TrainSave, gone: Set<number>, cancelled: Set<number>) {
  const prune = (p: { schedule: StopPlan[]; routeIndex: number }) => {
    if (!p.schedule.some((s) => gone.has(s.stationId))) return;
    const before = p.schedule.slice(0, p.routeIndex).filter((s) => !gone.has(s.stationId)).length;
    p.schedule = p.schedule.filter((s) => !gone.has(s.stationId));
    p.routeIndex = p.schedule.length ? before % p.schedule.length : 0;
  };
  prune(t);
  if (t.suspended) prune(t.suspended);
  if (typeof t.detour === 'number' && gone.has(t.detour)) t.detour = null;
  const lapsed = (job: TrainJob) =>
    cancelled.has(job.contractId) || gone.has(job.originId) || gone.has(job.destId);
  if (t.jobs?.some(lapsed)) t.jobs = t.jobs.filter((job) => !lapsed(job));
  if (!t.job || !lapsed(t.job)) return;
  t.job = null;
  t.jobPhase = 'origin';
  const s = t.suspended;
  if (!s) return;
  t.suspended = null;
  t.schedule = s.schedule;
  t.routeIndex = s.routeIndex % Math.max(1, s.schedule.length);
}
