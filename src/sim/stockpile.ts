import { CARGO } from './cargo';
import type { Cost } from '../data/content';
import { rules, weekSeconds } from './rules';

/** Resource ids that can sit in the stockpile: every cargo plus stored power. */
export const RESOURCE_IDS: string[] = [
  ...CARGO.filter((c) => c.class !== 'people').map((c) => c.id),
  'power',
];

/**
 * The player's global stockpile. Fed by trains unloading at a depot and by processing buildings;
 * drained by construction, upkeep (food per crew member) and refuelling.
 */
export class Stockpile {
  amounts = new Map<string, number>();
  /** Residents and working crews are counted separately. */
  population = 0;
  workforce = 0;
  private flowTime = 0;
  private tracking = false;
  private flows = new Map<string, { at: number; produced: number; consumed: number }[]>();

  /** Begin after initial resources or a save have been restored, including paused construction. */
  beginFlowHistory() {
    this.flows.clear();
    this.flowTime = 0;
    this.tracking = true;
  }

  private record(id: string, amount: number, kind: 'produced' | 'consumed') {
    if (!this.tracking || amount <= 0) return;
    const buckets = this.flows.get(id) ?? [];
    // Quarter-day buckets keep the rolling history bounded even for continuous upkeep.
    const at = Math.floor(this.flowTime / (weekSeconds() / 28));
    let bucket = buckets[buckets.length - 1];
    if (!bucket || bucket.at !== at) {
      bucket = { at, produced: 0, consumed: 0 };
      buckets.push(bucket);
    }
    bucket[kind] += amount;
    while (buckets.length && buckets[0].at <= at - 28) buckets.shift();
    this.flows.set(id, buckets);
  }

  /** Actual stock movements in the last seven days; starting stock is excluded. */
  weeklyFlow(id: string) {
    const now = Math.floor(this.flowTime / (weekSeconds() / 28));
    const total = { produced: 0, consumed: 0 };
    for (const b of this.flows.get(id) ?? [])
      if (b.at > now - 28) {
        total.produced += b.produced;
        total.consumed += b.consumed;
      }
    return total;
  }
  /** true while food is out; production and speed suffer */
  famine = false;
  private famineTime = 0;
  onMessage: ((msg: string, kind: 'info' | 'warn' | 'good') => void) | null = null;

  get(id: string) {
    return this.amounts.get(id) ?? 0;
  }
  /** Storage cap per resource; each depot raises it, power has its own battery cap. */
  cap(id: string, depots: number, plants: number) {
    if (id === 'power') return rules.powerCap + plants * 100;
    return rules.stockpileCap + depots * rules.depotCap;
  }
  /** Add up to the cap; returns the amount actually stored. */
  add(id: string, amount: number, cap = Infinity) {
    const cur = this.get(id);
    const n = Math.max(0, Math.min(amount, cap - cur));
    this.amounts.set(id, cur + n);
    this.record(id, n, 'produced');
    return n;
  }
  take(id: string, amount: number) {
    const cur = this.get(id);
    const n = Math.max(0, Math.min(cur, amount));
    this.amounts.set(id, cur - n);
    this.record(id, n, 'consumed');
    return n;
  }
  canAfford(cost: Cost, mul = 1) {
    return Object.entries(cost).every(([k, v]) => this.get(k) >= v * mul);
  }
  /** What is missing to pay `cost` (empty when affordable). */
  missing(cost: Cost, mul = 1): Cost {
    const out: Cost = {};
    for (const [k, v] of Object.entries(cost))
      if (this.get(k) < v * mul) out[k] = Math.ceil(v * mul - this.get(k));
    return out;
  }
  spend(cost: Cost, mul = 1) {
    if (!this.canAfford(cost, mul)) return false;
    for (const [k, v] of Object.entries(cost)) this.take(k, v * mul);
    return true;
  }
  refund(cost: Cost, mul = 1) {
    for (const [k, v] of Object.entries(cost)) this.add(k, Math.floor(v * mul));
  }

  /** Crew upkeep: food per crew member per week. */
  tick(gameDt: number) {
    this.flowTime += gameDt;
    this.tracking ||= gameDt > 0;
    const need = ((this.population + this.workforce) * rules.wheatPerCrew * gameDt) / weekSeconds();
    const got = this.take('food', need);
    const starving = need > 0 && got < need * 0.999;
    if (starving) {
      this.famineTime += gameDt;
      if (!this.famine && this.famineTime > 10) {
        this.famine = true;
        this.onMessage?.('The crews are out of food: production halved, trains slowed', 'warn');
      }
    } else {
      this.famineTime = 0;
      if (this.famine) {
        this.famine = false;
        this.onMessage?.('Food is back; crews are fed again', 'good');
      }
    }
  }
  /** Food consumed per in-game week at the current population. */
  foodPerWeek() {
    return (this.population + this.workforce) * rules.wheatPerCrew;
  }
  toJSON() {
    return { amounts: Object.fromEntries(this.amounts), famine: this.famine };
  }
  load(j: ReturnType<Stockpile['toJSON']>) {
    this.amounts = new Map(Object.entries(j.amounts));
    this.famine = j.famine;
    this.flows.clear();
    this.flowTime = 0;
    this.tracking = false;
  }
}

/** "30 wood, 10 stone" */
export function fmtCost(cost: Cost, mul = 1): string {
  const parts = Object.entries(cost)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${Math.ceil(v * mul)} ${k}`);
  return parts.length ? parts.join(', ') : 'free';
}
export function scaleCost(cost: Cost, mul: number): Cost {
  const out: Cost = {};
  for (const [k, v] of Object.entries(cost)) out[k] = Math.ceil(v * mul);
  return out;
}
