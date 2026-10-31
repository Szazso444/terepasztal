import type { Train } from './trains';
import type { Builder } from './build';
import type { PowerGrid } from './power';
import type { TrackWear } from './wear';
import { contractTitle, type ContractBoard } from './contracts';
import { buildingDef, missingInput } from './buildings';
import { cargoName } from './cargo';
import { STR } from '../strings';
import { rules } from './rules';
import { RESOURCE_IDS } from './stores';
import { contractAtRisk, storeStaysFull, type AlertType } from './alerts';

export type NoticeKind = 'info' | 'warn' | 'bad';
export type NoticeTarget =
  | { kind: 'train'; id: number }
  | { kind: 'tile'; x: number; y: number }
  /** a junction: centre tile to pan to, contributing tiles to highlight */
  | { kind: 'junction'; id: number; x: number; y: number; tiles: { x: number; y: number }[] }
  | null;
export interface Notice {
  key: string;
  kind: NoticeKind;
  /** its row of the Notifications screen (`src/sim/alerts.ts`) */
  type: AlertType;
  text: string;
  target: NoticeTarget;
  /** what the Toast channel says in place of `text`; null when the event has a toast of its own */
  toast?: string | null;
  /** wall-clock seconds; transient notices vanish after this */
  expires?: number;
}

/** Unusable pieces up to this many each have a notice; more gather into one with a count. */
const BROKEN_EACH = 3;

/**
 * Everything that deserves a marker: derived notices are recomputed from the live state every
 * refresh, transient ones (a failed contract, a purchase) are pushed with a lifetime.
 */
export class Notices {
  list: Notice[] = [];
  private transient: Notice[] = [];
  /** `store|good` of each good that counts as full (`storeStaysFull`) */
  private fullGoods = new Set<string>();
  onChange: (() => void) | null = null;

  push(n: Omit<Notice, 'expires'>, ttl = 30) {
    this.transient = this.transient.filter((t) => t.key !== n.key);
    this.transient.push({ ...n, expires: performance.now() / 1000 + ttl });
  }
  /** Withdraw a transient notice before its lifetime ends. */
  drop(key: string) {
    this.transient = this.transient.filter((t) => t.key !== key);
  }

  /** A notice for each unusable piece, or one with a count when there are many. */
  private brokenTrack(wear: TrackWear, out: Notice[]) {
    const { track } = wear;
    const keys = [...wear.unusable].sort((a, b) => a - b);
    // one entry for each piece: a curve's tiles share one wear
    const seen = new Set<object>();
    const at: { x: number; y: number }[] = [];
    for (const k of keys) {
      const p = track.pieces.get(k);
      if (!p || seen.has(p.wear)) continue;
      seen.add(p.wear);
      at.push(track.anchorOf(k % track.w, Math.floor(k / track.w)));
    }
    if (!at.length) return;
    const notice = (key: string, text: string, t: { x: number; y: number }): Notice => ({
      key,
      kind: 'bad',
      type: 'trackbroken',
      text,
      target: { kind: 'tile', x: t.x, y: t.y },
    });
    if (at.length > BROKEN_EACH)
      out.push(notice('track:broken', STR.notice.trackBrokenMany(at.length), at[0]));
    else
      for (const t of at)
        out.push(notice(`track${t.x},${t.y}:broken`, STR.notice.trackBroken(t.x, t.y), t));
  }

  refresh(src: {
    trains: Train[];
    builder: Builder;
    power: PowerGrid;
    wear: TrackWear;
    stuck?: { id: number; since: number }[];
    /** the contract board and the game time */
    contracts?: { board: Pick<ContractBoard, 'active' | 'offers' | 'remaining'>; now: number };
  }) {
    const now = performance.now() / 1000;
    this.transient = this.transient.filter((t) => (t.expires ?? 0) > now);
    const out: Notice[] = [...this.transient];
    for (const t of src.trains) {
      const target = { kind: 'train' as const, id: t.id };
      if (t.state === 'noFuel')
        out.push({
          key: `t${t.id}:fuel`,
          kind: 'bad',
          type: 'nofuel',
          text: STR.notice.outOfFuel(t.name),
          target,
        });
      else if (t.state === 'noPower')
        out.push({
          key: `t${t.id}:power`,
          kind: 'bad',
          type: 'nofuel',
          text: STR.notice.noPower(t.name),
          target,
        });
      else if (t.state === 'overweight')
        out.push({
          key: `t${t.id}:heavy`,
          kind: 'bad',
          type: 'noroute',
          text: STR.notice.overweight(t.name),
          target,
        });
      else if (t.state === 'noRoute' || t.state === 'stranded')
        out.push({
          key: `t${t.id}:route`,
          kind: 'warn',
          type: 'noroute',
          text: STR.notice.noRoute(t.name),
          target,
        });
      else if (t.eco)
        out.push({
          key: `t${t.id}:eco`,
          kind: 'warn',
          type: 'slow',
          text: STR.notice.ecoMode(t.name),
          target,
        });
      else if (src.stuck?.some((x) => x.id === t.id))
        out.push({
          key: `t${t.id}:stuck`,
          kind: 'bad',
          type: 'stuck',
          text: STR.notice.stuck(t.name, Math.round(src.stuck.find((x) => x.id === t.id)!.since)),
          target,
        });
      else if (t.blocked && t.blockedTime > 8)
        out.push({
          key: `t${t.id}:held`,
          kind: 'info',
          type: 'slow',
          text: STR.notice.held(t.name),
          target,
        });
    }
    for (const s of src.builder.stations) {
      if (src.builder.isOrphaned(s))
        out.push({
          key: `s${s.id}:orphan`,
          kind: 'bad',
          type: 'noroute',
          text: STR.notice.orphaned(s.name),
          target: { kind: 'tile', x: s.x, y: s.y },
        });
    }
    const plantsWired = new Set<string>();
    for (const e of src.power.edges()) {
      if (e.a.plant) plantsWired.add(`${e.a.x},${e.a.y}`);
      if (e.b.plant) plantsWired.add(`${e.b.x},${e.b.y}`);
    }
    // the places whose works already say they are full
    const worksFull = new Set<string>();
    for (const b of src.builder.buildings.values()) {
      // closed for its upgrade: off the grid and idle on purpose, nothing to report
      if (b.work) continue;
      const def = buildingDef(b.id);
      const target = { kind: 'tile' as const, x: b.x, y: b.y };
      if (def.power && !plantsWired.has(`${b.x},${b.y}`))
        out.push({
          key: `b${b.x},${b.y}:wire`,
          kind: 'warn',
          type: 'starved',
          text: STR.notice.unwired(def.name),
          target,
        });
      else if (b.reason === 'inputs') {
        const store = src.builder.stores.worksStore(b);
        const m = missingInput(def, store);
        out.push({
          key: `b${b.x},${b.y}:in`,
          kind: 'warn',
          type: 'starved',
          text: store
            ? STR.notice.starved(def.name, m ? cargoName(m) : '?')
            : STR.notice.noStore(def.name, rules.buildReach),
          target,
        });
      } else if (b.reason === 'full') {
        const store = src.builder.stores.worksStore(b);
        if (store) worksFull.add(src.builder.stores.networkPool(store).key);
        out.push({
          key: `b${b.x},${b.y}:full`,
          kind: 'info',
          type: 'full',
          text: STR.notice.full(def.name),
          target,
        });
      }
    }
    // a place that keeps goods, full of one or more of them; in Simple mode a whole rail network.
    // A works saying so has already told of that place
    const stores = src.builder.stores;
    const fullGoods = new Set<string>();
    for (const pool of stores.choices()) {
      const full = RESOURCE_IDS.filter((id) => {
        if (id === 'power' || pool.cap(id) <= 0) return false;
        const good = `${pool.key}|${id}`;
        if (!storeStaysFull(this.fullGoods.has(good), pool.get(id), pool.cap(id))) return false;
        fullGoods.add(good);
        return true;
      });
      if (full.length && !worksFull.has(pool.key))
        out.push({
          key: `store:${pool.key}:full`,
          kind: 'warn',
          type: 'full',
          text: STR.notice.storeFull(stores.label(pool), full.map(cargoName).join(', ')),
          target: { kind: 'tile', x: pool.anchor.x, y: pool.anchor.y },
        });
    }
    this.fullGoods = fullGoods;
    this.brokenTrack(src.wear, out);
    if (src.contracts) {
      const { board, now } = src.contracts;
      const destOf = (destId: number): NoticeTarget => {
        const dest = src.builder.stationById(destId);
        return dest ? { kind: 'tile', x: dest.x, y: dest.y } : null;
      };
      for (const c of board.active)
        if (contractAtRisk(board.remaining(c, now), c.delivered, c.amount))
          out.push({
            key: `contract:${c.id}:risk`,
            kind: 'warn',
            type: 'contract',
            text: STR.notice.contractAtRisk(contractTitle(c.name)),
            target: destOf(c.destId),
          });
      for (const c of board.offers)
        out.push({
          key: `offer:${c.id}`,
          kind: 'info',
          type: 'offer',
          text: STR.notice.contractOffered(contractTitle(c.name)),
          target: destOf(c.destId),
        });
    }
    const order = { bad: 0, warn: 1, info: 2 };
    out.sort((a, b) => order[a.kind] - order[b.kind]);
    const key = out.map((n) => n.key + n.kind).join('|');
    const prev = this.list.map((n) => n.key + n.kind).join('|');
    this.list = out;
    if (key !== prev) this.onChange?.();
  }
}
