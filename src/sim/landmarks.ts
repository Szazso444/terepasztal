import { landmarkDef, type LandmarkDef, type LandmarkEffect, type Cost } from '../data/content';
import type { LandmarkPlacement } from '../world/landmarks';
import type { Economy } from './economy';
import type { GameClock } from './time';
import type { Station } from './stations';
import type { StoreRegistry } from './stores';
import type { DeliveryEvent } from './trains';
import type { WindLevel } from './wind';
import { daySeconds } from './rules';

/**
 * The stages of a landmark, in the order a landmark can only move forward through them, bar the
 * one way back (`cancel`): hidden, spotted, surveyed, restoring, then restored or salvaged for good.
 */
export const LANDMARK_STAGES = [
  'hidden',
  'spotted',
  'surveyed',
  'restoring',
  'restored',
  'salvaged',
] as const;
export type LandmarkStage = (typeof LANDMARK_STAGES)[number];

/** Tiles (Chebyshev, from the footprint) within which a station surveys, is credited and is boosted. */
export const LANDMARK_REACH = 7;
/** What one point of a `boost` effect adds to a station's loading rate: one decor's `loadBoost`. */
export const LANDMARK_BOOST_UNIT = 0.25;
/** Cargo a delivery leaves undone below this is counted as done (the trains move fractions). */
const EPS = 1e-6;

/** A landmark as a save holds it (`LandmarksJSON.items`). */
export interface LandmarkItem {
  id: number;
  /** the `landmarks.json` id; an item whose def the content lacks is carried and never ticked */
  def: string;
  /** the footprint's corner of least x and y, in map tiles */
  x: number;
  y: number;
  /** the world region it was rolled in, for tests and diagnostics; never shifted */
  region: [number, number];
  stage: LandmarkStage;
  path?: 'salvage' | 'restore';
  /** the Restore pick, where the landmark has one (`pickKey`) */
  pick?: string;
  delivered?: Record<string, number>;
  /** the game day the current stage began */
  stageDay?: number;
  /** the one-time grant was paid; set in the same step that pays it */
  paid?: true;
}

export interface LandmarksJSON {
  nextId: number;
  /** set by the v24 step: the first load rolls nothing and clears it (`takeSkipRoll`) */
  skipRoll?: true;
  items: LandmarkItem[];
}

/** Why a command was refused; the panel words it. */
export type LandmarkRefusal = 'unknown' | 'stage' | 'pick';
export type LandmarkResult = { ok: true } | { ok: false; reason: LandmarkRefusal };

/** What the registry tells the game happened, for toasts and the panel. */
export type LandmarkEvent =
  | { kind: 'spotted' | 'surveyed' | 'restored' | 'salvaged'; item: LandmarkItem }
  | { kind: 'granted'; item: LandmarkItem; money: number; stored: Cost; lost: Cost };

/** Why a restored landmark made nothing in the last step. */
export type ProduceReason = 'store' | 'inputs' | 'full' | '';

/** What the Builder reads to add restored landmarks to the stations in their reach. */
export interface LandmarkEffects {
  /** loading rate a station gains from restored landmarks in reach (added to its boost) */
  boostAt(s: Station): number;
  /** visitors a day the station gains: those of the landmarks it is the nearest passenger station to */
  visitorsAt(s: Station, stations: readonly Station[]): number;
}

/** What the registry reads of the game. */
export interface LandmarkDeps {
  clock: GameClock;
  economy: Economy;
  stores: StoreRegistry;
  /** the wind's level now (`Weather.wind.level`, from `windAt`) */
  windLevel: () => WindLevel;
}

/** The pick a def's effect stands for: its kind, and the cargo where it makes one. */
export function pickKey(e: LandmarkEffect): string {
  return e.kind === 'produce' ? `produce:${e.cargo}` : e.kind;
}

/** The effect a landmark runs or ran: its path's, and the Restore pick's where it has one. */
function effectOf(item: LandmarkItem, def: LandmarkDef): LandmarkEffect | undefined {
  if (item.path === 'salvage') return def.salvage.effect;
  if (item.path !== 'restore') return undefined;
  return def.restore.pick?.find((p) => pickKey(p) === item.pick) ?? def.restore.effect;
}

/** Chebyshev distance from the footprint to the station's, 0 where they touch or overlap. */
function reachOf(item: LandmarkItem, def: LandmarkDef, s: Station): number {
  const dx = Math.max(0, item.x - (s.x + s.w - 1), s.x - (item.x + def.w - 1));
  const dy = Math.max(0, item.y - (s.y + s.h - 1), s.y - (item.y + def.d - 1));
  return Math.max(dx, dy);
}

/** The game hours 20:00 to 05:00, whatever the day and night display says. */
function isNight(clock: GameClock): boolean {
  return clock.hour >= 20 || clock.hour < 5;
}

/**
 * The rare landmarks of the world and what the player has made of them: the stage machine of the
 * spec (`hidden` to `restored` or `salvaged`), what deliveries credit, the conditions that gate
 * completion and the four first-version effects. Placement is the world's (`placeLandmarks`); the
 * game hands its placements in (`addPlacements`) and calls the hooks below.
 */
export class LandmarkRegistry implements LandmarkEffects {
  items: LandmarkItem[] = [];
  private nextId = 1;
  private skipRoll = false;
  /** why a restored landmark made nothing, by item id; not saved */
  private reasons = new Map<number, ProduceReason>();
  onEvent: ((e: LandmarkEvent) => void) | null = null;
  /** fired when a landmark starts or stops adding to the stations (the game refreshes their boosts) */
  onEffectsChanged: (() => void) | null = null;

  constructor(private readonly d: LandmarkDeps) {}

  // ------------------------------------------------------------------ lookup
  byId(id: number): LandmarkItem | undefined {
    return this.items.find((i) => i.id === id);
  }
  /** The def of an item the content knows and whose stage is one of the six; else it is left alone. */
  private live(i: LandmarkItem): LandmarkDef | undefined {
    return LANDMARK_STAGES.includes(i.stage) ? landmarkDef(i.def) : undefined;
  }
  /** The landmark whose footprint covers the tile, if any. */
  at(x: number, y: number): LandmarkItem | undefined {
    for (const i of this.items) {
      const def = landmarkDef(i.def);
      // an unknown def covers its corner alone: the tile still blocks
      const w = def?.w ?? 1;
      const d = def?.d ?? 1;
      if (x >= i.x && x < i.x + w && y >= i.y && y < i.y + d) return i;
    }
    return undefined;
  }
  /** Why a restored landmark that produces made nothing in the last step ('' while it runs). */
  reasonOf(id: number): ProduceReason {
    return this.reasons.get(id) ?? '';
  }

  // ------------------------------------------------------------------ placement and discovery
  /**
   * Take the placements of newly generated chunks in, each hidden until its chunk is revealed
   * (`refreshVisibility`). One already held (same landmark, same corner) is not added twice.
   */
  addPlacements(placed: readonly LandmarkPlacement[]) {
    for (const p of placed) {
      if (this.items.some((i) => i.def === p.id && i.x === p.x && i.y === p.y)) continue;
      this.items.push({
        id: this.nextId++,
        def: p.id,
        x: p.x,
        y: p.y,
        region: [Math.floor(p.cx / 3), Math.floor(p.cy / 3)],
        stage: 'hidden',
        stageDay: this.d.clock.day,
      });
    }
  }
  /** Whether the first load after a v24 migration rolls nothing; reading it clears it. */
  takeSkipRoll(): boolean {
    const was = this.skipRoll;
    this.skipRoll = false;
    return was;
  }

  /**
   * A hidden landmark whose chunk is revealed becomes spotted. `revealed` asks about a map tile:
   * the game answers for the chunk the tile is in (owned, or next to an owned one).
   */
  refreshVisibility(revealed: (x: number, y: number) => boolean) {
    for (const i of this.items) {
      if (i.stage !== 'hidden' || !this.live(i)) continue;
      if (revealed(i.x, i.y)) this.enter(i, 'spotted');
    }
  }

  /** A train stopped at the station: each spotted landmark within reach is surveyed. */
  onArrive(s: Station) {
    for (const i of this.items) {
      const def = this.live(i);
      if (!def || i.stage !== 'spotted') continue;
      if (reachOf(i, def, s) <= LANDMARK_REACH) this.enter(i, 'surveyed');
    }
  }

  // ------------------------------------------------------------------ the player's choices
  /**
   * Start restoring a surveyed landmark. A landmark with a pick takes one at the start (`pick`, as
   * `pickKey` names it) and runs it when the restore completes; one without takes none.
   */
  start(id: number, pick?: string): LandmarkResult {
    const i = this.byId(id);
    const def = i && this.live(i);
    if (!i || !def) return { ok: false, reason: 'unknown' };
    if (i.stage !== 'surveyed') return { ok: false, reason: 'stage' };
    const picks = def.restore.pick;
    if (picks ? !picks.some((p) => pickKey(p) === pick) : pick !== undefined)
      return { ok: false, reason: 'pick' };
    i.path = 'restore';
    if (picks) i.pick = pick;
    i.delivered = Object.fromEntries(Object.keys(def.restore.needs).map((c) => [c, 0]));
    this.enter(i, 'restoring');
    return { ok: true };
  }
  /** Salvage a surveyed or restoring landmark: the one-time reward is paid in the same step. */
  salvage(id: number): LandmarkResult {
    const i = this.byId(id);
    const def = i && this.live(i);
    if (!i || !def) return { ok: false, reason: 'unknown' };
    if (i.stage !== 'surveyed' && i.stage !== 'restoring') return { ok: false, reason: 'stage' };
    delete i.pick;
    delete i.delivered;
    i.path = 'salvage';
    this.enter(i, 'salvaged', def.salvage.effect);
    return { ok: true };
  }
  /** Give a restore up: back to surveyed, what was delivered is kept by no one. */
  cancel(id: number): LandmarkResult {
    const i = this.byId(id);
    if (!i || !this.live(i)) return { ok: false, reason: 'unknown' };
    if (i.stage !== 'restoring') return { ok: false, reason: 'stage' };
    delete i.path;
    delete i.pick;
    delete i.delivered;
    this.enter(i, 'surveyed');
    return { ok: true };
  }

  // ------------------------------------------------------------------ deliveries
  /** The restoring landmarks within reach of the station, in id order. */
  private restoringNear(s: Station): { item: LandmarkItem; def: LandmarkDef }[] {
    const out: { item: LandmarkItem; def: LandmarkDef }[] = [];
    for (const item of this.items) {
      const def = this.live(item);
      if (def && item.stage === 'restoring' && reachOf(item, def, s) <= LANDMARK_REACH)
        out.push({ item, def });
    }
    return out.sort((a, b) => a.item.id - b.item.id);
  }
  private missing(item: LandmarkItem, def: LandmarkDef, cargo: string): number {
    const need = def.restore.needs[cargo] ?? 0;
    return Math.max(0, need - (item.delivered?.[cargo] ?? 0));
  }
  /** How much of the cargo the restoring landmarks within reach of the station still miss. */
  wants(s: Station, cargo: string): number {
    let n = 0;
    for (const { item, def } of this.restoringNear(s)) n += this.missing(item, def, cargo);
    return n > EPS ? n : 0;
  }
  /**
   * Credit a delivery to the restoring landmarks within reach of the station, in id order, each up
   * to what it still misses. Returns the units credited; the rest goes on to contracts and the
   * store. A landmark that has everything now and whose condition holds is restored at once.
   */
  credit(e: DeliveryEvent): number {
    let left = e.amount;
    for (const { item, def } of this.restoringNear(e.station)) {
      if (left <= EPS) break;
      const n = Math.min(this.missing(item, def, e.cargo), left);
      if (n <= 0) continue;
      const have = (item.delivered?.[e.cargo] ?? 0) + n;
      const need = def.restore.needs[e.cargo];
      item.delivered = { ...item.delivered, [e.cargo]: need - have < EPS ? need : have };
      left -= n;
      this.tryComplete(item, def);
    }
    return e.amount - left;
  }

  // ------------------------------------------------------------------ conditions and completion
  /** Whether the condition of the restore (if any) holds now. */
  conditionHolds(def: LandmarkDef): boolean {
    switch (def.restore.condition) {
      case 'night':
        return isNight(this.d.clock);
      case 'storm':
        return this.d.windLevel() === 'storm';
      default:
        return true;
    }
  }
  /** Everything the restore needs is delivered. */
  private delivered(item: LandmarkItem, def: LandmarkDef): boolean {
    return Object.keys(def.restore.needs).every((c) => this.missing(item, def, c) <= EPS);
  }
  private tryComplete(item: LandmarkItem, def: LandmarkDef) {
    if (item.stage !== 'restoring' || !this.delivered(item, def) || !this.conditionHolds(def))
      return;
    this.enter(item, 'restored', effectOf(item, def));
  }

  // ------------------------------------------------------------------ effects
  /**
   * Pay the effect's one-time grant, if it is one and has not been paid: money through
   * `Economy.earn`, cargo into the nearest store at any distance and then the next nearest, what
   * fits nowhere lost. `paid` is set in the same step that pays, so a reload cannot pay twice.
   */
  private settle(item: LandmarkItem, effect: LandmarkEffect | undefined) {
    if (effect?.kind !== 'grant' || item.paid) return;
    item.paid = true;
    const money = effect.money ?? 0;
    if (money > 0) this.d.economy.earn(money);
    const stored: Cost = {};
    const lost: Cost = {};
    const stores = effect.cargo ? this.d.stores.nearest(item.x, item.y, Infinity) : [];
    for (const [cargo, amount] of Object.entries(effect.cargo ?? {})) {
      let left = amount;
      for (const store of stores) {
        if (left <= 0) break;
        left -= store.add(cargo, left);
      }
      if (amount - left > 0) stored[cargo] = amount - left;
      if (left > 0) lost[cargo] = left;
    }
    this.onEvent?.({ kind: 'granted', item, money, stored, lost });
  }

  /** What a restored landmark runs, by its def: the effect of its restore or its pick. */
  private running(): { item: LandmarkItem; def: LandmarkDef; effect: LandmarkEffect }[] {
    const out: { item: LandmarkItem; def: LandmarkDef; effect: LandmarkEffect }[] = [];
    for (const item of this.items) {
      const def = this.live(item);
      if (!def || item.stage !== 'restored') continue;
      const effect = effectOf(item, def);
      if (effect) out.push({ item, def, effect });
    }
    return out;
  }

  boostAt(s: Station): number {
    let strength = 0;
    for (const { item, def, effect } of this.running())
      if (effect.kind === 'boost' && reachOf(item, def, s) <= LANDMARK_REACH)
        strength += effect.strength;
    return strength * LANDMARK_BOOST_UNIT;
  }
  visitorsAt(s: Station, stations: readonly Station[]): number {
    if (!s.def.produces.some((p) => p.cargo === 'passengers')) return 0;
    let perDay = 0;
    for (const { item, def, effect } of this.running()) {
      if (effect.kind !== 'attraction') continue;
      // the nearest passenger station within reach gets them; the older one on a tie
      let best: Station | null = null;
      let bestAt = Infinity;
      for (const o of stations) {
        if (!o.def.produces.some((p) => p.cargo === 'passengers')) continue;
        const at = reachOf(item, def, o);
        if (at <= LANDMARK_REACH && (at < bestAt || (at === bestAt && o.id < best!.id))) {
          best = o;
          bestAt = at;
        }
      }
      if (best === s) perDay += effect.perDay;
    }
    return perDay;
  }

  /**
   * One step: a landmark whose restore waits on its condition checks it, and a restored `produce`
   * landmark makes its cargo into the store its footprint's corner is supplied from, taking what
   * it consumes first. With no store, or the consumed cargo missing, it makes nothing and the
   * reason is kept (`reasonOf`).
   */
  tick(gameDt: number) {
    for (const item of this.items) {
      const def = this.live(item);
      if (def && item.stage === 'restoring') this.tryComplete(item, def);
    }
    const days = gameDt / daySeconds();
    for (const { item, effect } of this.running()) {
      if (effect.kind !== 'produce') continue;
      const store = this.d.stores.supplierFor(item.x, item.y);
      if (!store) {
        this.reasons.set(item.id, 'store');
        continue;
      }
      const make = effect.perDay * days;
      const eat = (effect.consumes?.perDay ?? 0) * days;
      if (effect.consumes && store.get(effect.consumes.cargo) < eat - EPS) {
        this.reasons.set(item.id, 'inputs');
        continue;
      }
      const room = store.cap(effect.cargo) - store.get(effect.cargo);
      if (room < make - EPS) {
        this.reasons.set(item.id, 'full');
        continue;
      }
      if (effect.consumes) store.take(effect.consumes.cargo, eat);
      store.add(effect.cargo, make);
      this.reasons.set(item.id, '');
    }
  }

  // ------------------------------------------------------------------ stages
  /**
   * Move to the stage. A one-time grant of `effect` is paid, and `paid` set, before anything is
   * announced, so a handler that saves on the event writes the item paid.
   */
  private enter(item: LandmarkItem, stage: LandmarkStage, effect?: LandmarkEffect) {
    const before = item.stage;
    item.stage = stage;
    item.stageDay = this.d.clock.day;
    this.settle(item, effect);
    if (stage === 'spotted' || stage === 'surveyed' || stage === 'restored' || stage === 'salvaged')
      this.onEvent?.({ kind: stage, item });
    if (stage === 'restored' || before === 'restored') this.onEffectsChanged?.();
  }

  // ------------------------------------------------------------------ save
  toJSON(): LandmarksJSON {
    return {
      nextId: this.nextId,
      ...(this.skipRoll ? { skipRoll: true as const } : {}),
      items: this.items.map((i) => ({
        ...i,
        region: [...i.region] as [number, number],
        ...(i.delivered ? { delivered: { ...i.delivered } } : {}),
      })),
    };
  }
  /**
   * Take the saved landmarks. An item of a def the content lacks is kept as it is, so the file
   * writes it back; `nextId` stays above every id held. A file without the block (v24 and older,
   * before the step) loads none.
   */
  load(j: Partial<LandmarksJSON> | undefined) {
    this.items = (j?.items ?? []).map((i) => ({
      ...i,
      ...(i.delivered ? { delivered: { ...i.delivered } } : {}),
    }));
    this.nextId = Math.max(j?.nextId ?? 1, 1, ...this.items.map((i) => i.id + 1));
    this.skipRoll = j?.skipRoll === true;
    this.reasons.clear();
    this.onEffectsChanged?.();
  }
}
