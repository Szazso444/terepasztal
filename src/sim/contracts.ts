import { content, type ContractTemplate } from '../data/content';
import { rules, daySeconds } from './rules';
import { Rng } from '../engine/rng';
import type { Station } from './stations';
import type { Builder } from './build';
import type { Economy } from './economy';
import { cargoDef } from './cargo';
import type { DeliveryEvent } from './trains';

export type { ContractTemplate };
export type ContractStatus = 'offer' | 'active' | 'done' | 'failed' | 'expired';

export interface Contract {
  id: number;
  templateId: string;
  name: string;
  cargo: string;
  amount: number;
  delivered: number;
  originId: number;
  destId: number;
  payout: number;
  reputation: number;
  tickets: number;
  /** duration in in-game seconds once accepted */
  duration: number;
  /** absolute game time when the offer disappears / the active contract fails */
  expires: number;
  acceptedAt: number;
  status: ContractStatus;
}

export interface ContractEvent {
  kind: 'completed' | 'failed' | 'accepted' | 'offered';
  contract: Contract;
}

const contractData = content.contracts;
const TEMPLATES: ContractTemplate[] = contractData.templates;

/** Generates offers, tracks active contracts and applies deliveries. */
export class ContractBoard {
  contracts: Contract[] = [];
  private nextId = 1;
  private nextRefresh = 0;
  completedToday = 0;
  stats = { completed: 0, failed: 0 };
  onEvent: ((e: ContractEvent) => void) | null = null;

  constructor(
    readonly rng: Rng,
    readonly builder: Builder,
    readonly economy: Economy,
  ) {}

  get offers() {
    return this.contracts.filter((c) => c.status === 'offer');
  }
  get active() {
    return this.contracts.filter((c) => c.status === 'active');
  }
  byId(id: number) {
    return this.contracts.find((c) => c.id === id);
  }

  /** Every valid (origin, destination, cargo) triple given current stations. */
  private pairs(): { from: Station; to: Station; cargo: string }[] {
    const out: { from: Station; to: Station; cargo: string }[] = [];
    for (const from of this.builder.stations) {
      if (!this.builder.platformTiles(from).length) continue;
      for (const cargo of from.producedCargo())
        for (const to of this.builder.stations) {
          if (to === from || !to.accepts(cargo) || !this.builder.platformTiles(to).length) continue;
          out.push({ from, to, cargo });
        }
    }
    return out;
  }

  canGenerate() {
    return this.pairs().length > 0;
  }

  generate(now: number, force = false): Contract | null {
    const pairs = this.pairs();
    if (!pairs.length) return null;
    const tier = this.economy.tier;
    const templates = TEMPLATES.filter((t) => t.minTier <= tier);
    const totalW = templates.reduce((a, t) => a + t.weight, 0);
    let r = this.rng.next() * totalW;
    let tpl = templates[0];
    for (const t of templates) {
      r -= t.weight;
      if (r <= 0) {
        tpl = t;
        break;
      }
    }
    // avoid duplicating an identical open offer unless forced
    const pair = this.rng.pick(pairs);
    if (
      !force &&
      this.offers.some(
        (o) =>
          o.originId === pair.from.id &&
          o.destId === pair.to.id &&
          o.cargo === pair.cargo &&
          o.templateId === tpl.id,
      )
    )
      return null;
    const scale = 1 + tier * 0.25;
    const amount = Math.round(this.rng.int(tpl.amount[0], tpl.amount[1]) * scale);
    const dist = Math.abs(pair.from.x - pair.to.x) + Math.abs(pair.from.y - pair.to.y);
    const durationDays = tpl.baseDays + dist * tpl.daysPerTile + amount / 60;
    const price = cargoDef(pair.cargo).price;
    const payout = Math.round(
      rules.payoutMul * amount * price * tpl.payoutMul * (1 + dist / 80) * (1 + tier * 0.15),
    );
    const reputation = Math.round(
      rules.reputationMul * this.rng.int(tpl.reputation[0], tpl.reputation[1]) * (1 + dist / 120),
    );
    const c: Contract = {
      id: this.nextId++,
      templateId: tpl.id,
      name: tpl.name,
      cargo: pair.cargo,
      amount,
      delivered: 0,
      originId: pair.from.id,
      destId: pair.to.id,
      payout,
      reputation,
      tickets: tpl.tickets,
      duration: durationDays * rules.deadlineMul * daySeconds(),
      expires: now + contractData.offerLifetimeDays * daySeconds(),
      acceptedAt: 0,
      status: 'offer',
    };
    this.contracts.push(c);
    this.onEvent?.({ kind: 'offered', contract: c });
    return c;
  }

  accept(c: Contract, now: number) {
    if (c.status !== 'offer') return false;
    c.status = 'active';
    c.acceptedAt = now;
    c.expires = now + c.duration;
    this.onEvent?.({ kind: 'accepted', contract: c });
    return true;
  }

  decline(c: Contract) {
    if (c.status !== 'offer') return;
    c.status = 'expired';
  }

  /** Fraction of the deadline remaining (1 = just accepted). */
  remaining(c: Contract, now: number) {
    if (c.status !== 'active') return 0;
    return Math.max(0, Math.min(1, (c.expires - now) / c.duration));
  }

  tick(now: number) {
    if (now >= this.nextRefresh) {
      this.nextRefresh = now + rules.contractRefreshDays * daySeconds();
      const want = rules.contractOfferCount;
      let tries = 0;
      while (this.offers.length < want && tries++ < 6) this.generate(now);
    }
    for (const c of this.contracts) {
      if (c.status === 'offer' && now >= c.expires) c.status = 'expired';
      else if (c.status === 'active' && now >= c.expires) this.fail(c);
    }
    // prune old history
    if (this.contracts.length > 80)
      this.contracts = this.contracts
        .filter((c) => c.status === 'offer' || c.status === 'active')
        .concat(
          this.contracts.filter((c) => c.status !== 'offer' && c.status !== 'active').slice(-30),
        );
  }

  private fail(c: Contract) {
    c.status = 'failed';
    this.stats.failed++;
    this.economy.addReputation(
      -Math.round(c.reputation * contractData.failReputationMul * rules.failPenaltyMul),
    );
    this.onEvent?.({ kind: 'failed', contract: c });
  }

  /** Apply a delivery to matching active contracts (earliest deadline first). Returns units credited. */
  onDelivery(e: DeliveryEvent): number {
    let left = e.amount;
    const matches = this.active
      .filter((c) => c.cargo === e.cargo && c.destId === e.station.id && c.originId === e.origin)
      .sort((a, b) => a.expires - b.expires);
    for (const c of matches) {
      if (left <= 0) break;
      const need = c.amount - c.delivered;
      const n = Math.min(need, left);
      c.delivered += n;
      left -= n;
      if (c.delivered >= c.amount - 1e-6) this.complete(c);
    }
    return e.amount - left;
  }

  private complete(c: Contract) {
    c.status = 'done';
    c.delivered = c.amount;
    this.stats.completed++;
    this.completedToday++;
    this.economy.earn(c.payout);
    this.economy.addReputation(c.reputation);
    this.economy.tickets += c.tickets;
    this.onEvent?.({ kind: 'completed', contract: c });
  }

  toJSON() {
    return {
      contracts: this.contracts,
      nextId: this.nextId,
      nextRefresh: this.nextRefresh,
      stats: this.stats,
      completedToday: this.completedToday,
    };
  }
  load(j: ReturnType<ContractBoard['toJSON']>) {
    this.contracts = j.contracts;
    this.nextId = j.nextId;
    this.nextRefresh = j.nextRefresh;
    this.stats = j.stats;
    this.completedToday = j.completedToday;
  }
}
