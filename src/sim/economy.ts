/** Money, tickets and the current age (steam / diesel / electric), reached through goals. */
import { LAST_AGE, goalsMet, type AgeSnapshot } from './ages';

export class Economy {
  money = 25000;
  tickets = 3;
  /** money taken in over the whole game (contracts, spot sales, fares); one of the age goals */
  earned = 0;
  /** index of the current age: 0 steam, 1 diesel, 2 electric. Never drops. */
  tier = 0;
  /** Milestone tickets already granted per age. */
  private ageTicketsGranted = new Set<number>();
  onAgeUp: ((tier: number) => void) | null = null;
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
    if (v > 0) this.earned += v;
  }
  /**
   * @deprecated Reputation is gone; ages are reached through goals. Kept as a no-op so callers
   * written against the old economy keep compiling until they are updated.
   */
  addReputation(_v: number) {
    void _v;
  }
  /** Move to the next age when its goals are met (called once per in-game hour). */
  advanceAge(s: AgeSnapshot) {
    while (this.tier < LAST_AGE && goalsMet(this.tier + 1, s)) this.enterAge(this.tier + 1);
  }
  /** Jump straight to an age (level start blocks); fires the unlock hook for each age passed. */
  setAge(tier: number) {
    const target = Math.max(0, Math.min(LAST_AGE, Math.floor(tier)));
    while (this.tier < target) this.enterAge(this.tier + 1);
  }
  private enterAge(tier: number) {
    this.tier = tier;
    if (!this.ageTicketsGranted.has(tier)) {
      this.ageTicketsGranted.add(tier);
      this.tickets += 5;
    }
    this.onAgeUp?.(tier);
  }
  toJSON() {
    return {
      money: this.money,
      tickets: this.tickets,
      earned: this.earned,
      tier: this.tier,
      granted: [...this.ageTicketsGranted],
    };
  }
  load(j: Partial<ReturnType<Economy['toJSON']>>) {
    this.money = j.money ?? this.money;
    this.tickets = j.tickets ?? this.tickets;
    this.earned = j.earned ?? 0;
    this.tier = Math.max(0, Math.min(LAST_AGE, j.tier ?? 0));
    this.ageTicketsGranted = new Set(j.granted ?? []);
  }
}
