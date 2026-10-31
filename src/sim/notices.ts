import type { Train } from './trains';
import type { Builder } from './build';
import type { PowerGrid } from './power';
import type { ContractBoard } from './contracts';
import { buildingDef, missingInput } from './buildings';
import { cargoName } from './cargo';
import { STR } from '../strings';
import { rules } from './rules';
import { RESOURCE_IDS } from './stores';
import { contractAtRisk, type AlertType } from './alerts';

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

/**
 * Everything that deserves a marker: derived notices are recomputed from the live state every
 * refresh, transient ones (a failed contract, a purchase) are pushed with a lifetime.
 */
export class Notices {
  list: Notice[] = [];
  private transient: Notice[] = [];
  onChange: (() => void) | null = null;

  push(n: Omit<Notice, 'expires'>, ttl = 30) {
    this.transient = this.transient.filter((t) => t.key !== n.key);
    this.transient.push({ ...n, expires: performance.now() / 1000 + ttl });
  }
  /** Withdraw a transient notice before its lifetime ends. */
  drop(key: string) {
    this.transient = this.transient.filter((t) => t.key !== key);
  }

  refresh(src: {
    trains: Train[];
    builder: Builder;
    power: PowerGrid;
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
      } else if (b.reason === 'full')
        out.push({
          key: `b${b.x},${b.y}:full`,
          kind: 'info',
          type: 'full',
          text: STR.notice.full(def.name),
          target,
        });
    }
    // a place that keeps goods, full of one or more of them; in Simple mode a whole rail network
    const stores = src.builder.stores;
    for (const pool of stores.choices()) {
      const full = RESOURCE_IDS.filter(
        (id) => id !== 'power' && pool.cap(id) > 0 && pool.get(id) >= pool.cap(id) - 1e-6,
      );
      if (full.length)
        out.push({
          key: `store:${pool.key}:full`,
          kind: 'warn',
          type: 'full',
          text: STR.notice.storeFull(stores.label(pool), full.map(cargoName).join(', ')),
          target: { kind: 'tile', x: pool.anchor.x, y: pool.anchor.y },
        });
    }
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
            text: STR.notice.contractAtRisk(c.name),
            target: destOf(c.destId),
          });
      for (const c of board.offers)
        out.push({
          key: `offer:${c.id}`,
          kind: 'info',
          type: 'offer',
          text: STR.notice.contractOffered(c.name),
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
