import { content, type ContractTemplate, type ContractRarityDef } from '../data/content';
import { rules, daySeconds } from './rules';
import { Rng } from '../engine/rng';
import type { Station } from './stations';
import type { Builder } from './build';
import type { Economy } from './economy';
import { cargoDef } from './cargo';
import type { DeliveryEvent } from './trains';
import { CONTRACT_RARITIES, type ContractRarity } from './save';

export type { ContractTemplate, ContractRarityDef };
export type { ContractRarity };
export type ContractStatus = 'offer' | 'active' | 'done' | 'failed' | 'expired' | 'cancelled';

export interface Contract {
  id: number;
  templateId: string;
  name: string;
  /** multiplier layer over the template: bigger ask, bigger reward */
  rarity: ContractRarity;
  cargo: string;
  amount: number;
  delivered: number;
  originId: number;
  destId: number;
  payout: number;
  tickets: number;
  /** duration in in-game seconds once accepted */
  duration: number;
  /** absolute game time when the offer disappears / the active contract fails */
  expires: number;
  acceptedAt: number;
  status: ContractStatus;
  /** train working the contract (null: nobody could, or not accepted yet) */
  trainId: number | null;
}

export interface ContractEvent {
  kind: 'completed' | 'failed' | 'accepted' | 'offered' | 'cancelled';
  contract: Contract;
}

const contractData = content.contracts;
const TEMPLATES: ContractTemplate[] = contractData.templates;
const RARITIES: ContractRarityDef[] = contractData.rarities;

/** Numbers behind a rarity (Common when the data lacks it). */
export function rarityDef(id: ContractRarity): ContractRarityDef {
  return (
    RARITIES.find((r) => r.id === id) ??
    RARITIES[0] ?? {
      id: 'common',
      name: 'Common',
      weight: 1,
      rewardMul: 1,
      ticketMul: 1,
      amountMul: 1,
      deadlineMul: 1,
    }
  );
}

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
  pairs(): { from: Station; to: Station; cargo: string }[] {
    const out: { from: Station; to: Station; cargo: string }[] = [];
    for (const from of this.builder.stations) {
      if (from.def.contracts === false || !this.builder.platformTiles(from).length) continue;
      for (const cargo of from.producedCargo())
        for (const to of this.builder.stations) {
          if (
            to === from ||
            to.def.contracts === false ||
            !to.accepts(cargo) ||
            !this.builder.platformTiles(to).length
          )
            continue;
          out.push({ from, to, cargo });
        }
    }
    return out;
  }

  canGenerate() {
    return this.pairs().length > 0;
  }

  /** Weighted rarity roll; a rarity at its open-offer cap (Legendary: one at a time) is skipped. */
  private rollRarity(): ContractRarityDef {
    const open = this.offers;
    const pool = RARITIES.filter(
      (r) =>
        CONTRACT_RARITIES.includes(r.id as ContractRarity) &&
        (r.maxOpen === undefined || open.filter((o) => o.rarity === r.id).length < r.maxOpen),
    );
    const totalW = pool.reduce((a, r) => a + r.weight, 0);
    let x = this.rng.next() * totalW;
    for (const r of pool) {
      x -= r.weight;
      if (x <= 0) return r;
    }
    return pool[0] ?? rarityDef('common');
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
    const rar = this.rollRarity();
    const scale = 1 + tier * 0.25;
    const amount = Math.round(this.rng.int(tpl.amount[0], tpl.amount[1]) * scale * rar.amountMul);
    const dist = Math.abs(pair.from.x - pair.to.x) + Math.abs(pair.from.y - pair.to.y);
    const durationDays =
      (tpl.baseDays + dist * tpl.daysPerTile + amount / 60) *
      (tpl.rarityDeadline ? rar.deadlineMul : 1);
    const price = cargoDef(pair.cargo).price;
    const payout = Math.round(
      rules.payoutMul *
        amount *
        price *
        tpl.payoutMul *
        (1 + dist / 80) *
        (1 + tier * 0.15) *
        rar.rewardMul,
    );
    const c: Contract = {
      id: this.nextId++,
      templateId: tpl.id,
      name: tpl.name,
      rarity: rar.id as ContractRarity,
      cargo: pair.cargo,
      amount,
      delivered: 0,
      originId: pair.from.id,
      destId: pair.to.id,
      payout,
      tickets: Math.round(tpl.tickets * rar.ticketMul),
      duration: durationDays * rules.deadlineMul * daySeconds(),
      expires: now + contractData.offerLifetimeDays * daySeconds(),
      acceptedAt: 0,
      status: 'offer',
      trainId: null,
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

  /** Drop an offer; costs nothing before acceptance. */
  decline(c: Contract) {
    if (c.status !== 'offer') return;
    c.status = 'expired';
  }

  /** Fine for cancelling an active contract. */
  cancelFine(c: Contract) {
    return Math.round(c.payout * contractData.cancelFine);
  }
  /** Fine for missing the deadline. */
  failFine(c: Contract) {
    return Math.round(c.payout * contractData.failFine * rules.failPenaltyMul);
  }

  /** Give up an active contract: the cancellation fine is charged, the train is released. */
  cancel(c: Contract) {
    if (c.status !== 'active') return false;
    c.status = 'cancelled';
    this.economy.money -= this.cancelFine(c);
    this.onEvent?.({ kind: 'cancelled', contract: c });
    return true;
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
    this.economy.money -= this.failFine(c);
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
    this.contracts = j.contracts.map((c) => ({
      ...c,
      rarity: CONTRACT_RARITIES.includes(c.rarity) ? c.rarity : 'common',
      trainId: c.trainId ?? null,
    }));
    this.nextId = j.nextId;
    this.nextRefresh = j.nextRefresh;
    this.stats = j.stats;
    this.completedToday = j.completedToday;
  }
}
