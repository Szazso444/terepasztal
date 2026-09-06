import { CARGO } from './cargo';
import type { Cost } from '../data/content';
import { rules, daySeconds } from './rules';

/** Resource ids that can sit in the stockpile: every cargo plus stored power. */
export const RESOURCE_IDS: string[] = [...CARGO.map((c) => c.id), 'power'];

/**
 * The player's global stockpile. Fed by deliveries to warehouses and by processing buildings;
 * drained by construction, upkeep (wheat per crew member) and refuelling.
 */
export class Stockpile {
  amounts = new Map<string, number>();
  /** crew members fed by wheat */
  population = 0;
  /** true while wheat is out; production and speed suffer */
  famine = false;
  private famineTime = 0;
  onMessage: ((msg: string, kind: 'info' | 'warn' | 'good') => void) | null = null;

  get(id: string) {
    return this.amounts.get(id) ?? 0;
  }
  /** Storage cap per resource; warehouses raise it, power has its own battery cap. */
  cap(id: string, warehouseLevels: number, plants: number) {
    if (id === 'power') return rules.powerCap + plants * 100;
    return rules.stockpileCap + warehouseLevels * rules.warehouseCap;
  }
  /** Add up to the cap; returns the amount actually stored. */
  add(id: string, amount: number, cap = Infinity) {
    const cur = this.get(id);
    const n = Math.max(0, Math.min(amount, cap - cur));
    this.amounts.set(id, cur + n);
    return n;
  }
  take(id: string, amount: number) {
    const cur = this.get(id);
    const n = Math.max(0, Math.min(cur, amount));
    this.amounts.set(id, cur - n);
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

  /** Crew upkeep: wheat per crew member per day. */
  tick(gameDt: number) {
    const need = (this.population * rules.wheatPerCrew * gameDt) / daySeconds();
    const got = this.take('wheat', need);
    const starving = need > 0 && got < need * 0.999;
    if (starving) {
      this.famineTime += gameDt;
      if (!this.famine && this.famineTime > 10) {
        this.famine = true;
        this.onMessage?.('The crews are out of wheat: production halved, trains slowed', 'warn');
      }
    } else {
      this.famineTime = 0;
      if (this.famine) {
        this.famine = false;
        this.onMessage?.('Wheat is back; crews are fed again', 'good');
      }
    }
  }
  /** Wheat consumed per in-game day at the current population. */
  wheatPerDay() {
    return this.population * rules.wheatPerCrew;
  }
  toJSON() {
    return { amounts: Object.fromEntries(this.amounts), famine: this.famine };
  }
  load(j: ReturnType<Stockpile['toJSON']>) {
    this.amounts = new Map(Object.entries(j.amounts));
    this.famine = j.famine;
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
