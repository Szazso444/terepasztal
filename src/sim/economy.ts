/** Money, tickets, reputation and the tier ladder derived from reputation. */
import { rules } from './rules';

/** Live tier ladder (tunable). */
export function tierThresholds() {
  return rules.tierThresholds;
}

export class Economy {
  money = 25000;
  tickets = 3;
  reputation = 0;
  /** highest tier reached (tiers never drop even if reputation falls) */
  tier = 0;
  /** Milestone tickets already granted per tier. */
  private tierTicketsGranted = new Set<number>();
  onTierUp: ((tier: number) => void) | null = null;
  onMessage: ((msg: string, kind: 'info' | 'warn' | 'good') => void) | null = null;

  canAfford(v: number) {
    return this.money >= v;
  }
  spend(v: number): boolean {
    if (!this.canAfford(v)) {
      this.onMessage?.('Not enough funds', 'warn');
      return false;
    }
    this.money -= v;
    return true;
  }
  earn(v: number) {
    this.money += v;
  }
  addReputation(v: number) {
    this.reputation = Math.max(0, this.reputation + v);
    let t = 0;
    const th = tierThresholds();
    for (let i = 0; i < th.length; i++) if (this.reputation >= th[i]) t = i;
    while (this.tier < t) {
      this.tier++;
      if (!this.tierTicketsGranted.has(this.tier)) {
        this.tierTicketsGranted.add(this.tier);
        this.tickets += 5;
      }
      this.onTierUp?.(this.tier);
    }
  }
  nextTierAt(): number | null {
    const th = tierThresholds();
    return this.tier + 1 < th.length ? th[this.tier + 1] : null;
  }
  toJSON() {
    return {
      money: this.money,
      tickets: this.tickets,
      reputation: this.reputation,
      tier: this.tier,
      granted: [...this.tierTicketsGranted],
    };
  }
  load(j: ReturnType<Economy['toJSON']>) {
    this.money = j.money;
    this.tickets = j.tickets;
    this.reputation = j.reputation;
    this.tier = j.tier;
    this.tierTicketsGranted = new Set(j.granted);
  }
}
