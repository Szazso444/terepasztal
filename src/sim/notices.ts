import type { Train } from './trains';
import type { Builder } from './build';
import type { Stockpile } from './stockpile';
import type { PowerGrid } from './power';
import { buildingDef, missingInput } from './buildings';
import { cargoName } from './cargo';
import { STR } from '../strings';

export type NoticeKind = 'info' | 'warn' | 'bad';
export type NoticeTarget =
  { kind: 'train'; id: number } | { kind: 'tile'; x: number; y: number } | null;
export interface Notice {
  key: string;
  kind: NoticeKind;
  text: string;
  target: NoticeTarget;
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

  refresh(src: {
    trains: Train[];
    builder: Builder;
    stock: Stockpile;
    power: PowerGrid;
    stuck?: { id: number; since: number }[];
  }) {
    const now = performance.now() / 1000;
    this.transient = this.transient.filter((t) => (t.expires ?? 0) > now);
    const out: Notice[] = [...this.transient];
    for (const t of src.trains) {
      const target = { kind: 'train' as const, id: t.id };
      if (t.state === 'noFuel')
        out.push({ key: `t${t.id}:fuel`, kind: 'bad', text: STR.notice.outOfFuel(t.name), target });
      else if (t.state === 'noPower')
        out.push({ key: `t${t.id}:power`, kind: 'bad', text: STR.notice.noPower(t.name), target });
      else if (t.state === 'overweight')
        out.push({
          key: `t${t.id}:heavy`,
          kind: 'bad',
          text: STR.notice.overweight(t.name),
          target,
        });
      else if (t.state === 'noRoute' || t.state === 'stranded')
        out.push({ key: `t${t.id}:route`, kind: 'warn', text: STR.notice.noRoute(t.name), target });
      else if (t.eco)
        out.push({ key: `t${t.id}:eco`, kind: 'warn', text: STR.notice.ecoMode(t.name), target });
      else if (src.stuck?.some((x) => x.id === t.id))
        out.push({
          key: `t${t.id}:stuck`,
          kind: 'bad',
          text: STR.notice.stuck(t.name, Math.round(src.stuck.find((x) => x.id === t.id)!.since)),
          target,
        });
      else if (t.blocked && t.blockedTime > 8)
        out.push({ key: `t${t.id}:held`, kind: 'info', text: STR.notice.held(t.name), target });
    }
    for (const s of src.builder.stations) {
      if (src.builder.isOrphaned(s))
        out.push({
          key: `s${s.id}:orphan`,
          kind: 'bad',
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
      const def = buildingDef(b.id);
      const target = { kind: 'tile' as const, x: b.x, y: b.y };
      if (def.power && !plantsWired.has(`${b.x},${b.y}`))
        out.push({
          key: `b${b.x},${b.y}:wire`,
          kind: 'warn',
          text: STR.notice.unwired(def.name),
          target,
        });
      else if (b.reason === 'inputs') {
        const m = missingInput(def, src.stock);
        out.push({
          key: `b${b.x},${b.y}:in`,
          kind: 'warn',
          text: STR.notice.starved(def.name, m ? cargoName(m) : '?'),
          target,
        });
      } else if (b.reason === 'full')
        out.push({
          key: `b${b.x},${b.y}:full`,
          kind: 'info',
          text: STR.notice.full(def.name),
          target,
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
