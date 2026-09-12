/**
 * Ages. The game moves from the Steam Age through the Diesel Age to the Electric Age; each age
 * unlocks when every goal listed for it in `src/data/ages.json` is met. `economy.tier` holds the
 * index of the current age (0 steam, 1 diesel, 2 electric) and gates works, stations, decor,
 * station levels, contract templates and gacha banners through their `tier` fields.
 */
import agesJson from '../data/ages.json';

export type GoalKind = 'depots' | 'population' | 'earned' | 'substations' | 'wires';
export interface AgeGoal {
  kind: GoalKind;
  target: number;
}
export interface AgeDef {
  id: string;
  goals: AgeGoal[];
}
/** The live numbers every goal is measured against. */
export type AgeSnapshot = Record<GoalKind, number>;
export interface GoalStatus extends AgeGoal {
  current: number;
  done: boolean;
}
export interface AgeStatus {
  index: number;
  id: string;
  /** already reached */
  unlocked: boolean;
  /** the one the player is in */
  current: boolean;
  goals: GoalStatus[];
}

export const AGE_DEFS: AgeDef[] = agesJson as AgeDef[];
export const AGE_COUNT = AGE_DEFS.length;
export const LAST_AGE = AGE_COUNT - 1;

/** High-speed rail is a quest inside the Electric Age: prove the grid works before the fast track opens. */
export const HS_QUEST: AgeGoal[] = [
  { kind: 'substations', target: 2 },
  { kind: 'wires', target: 60 },
];
export function hsQuestMet(tier: number, s: AgeSnapshot): boolean {
  return tier >= LAST_AGE && HS_QUEST.every((g) => (s[g.kind] ?? 0) >= g.target);
}
export function hsQuestStatus(s: AgeSnapshot): GoalStatus[] {
  return HS_QUEST.map((g) => ({
    ...g,
    current: s[g.kind] ?? 0,
    done: (s[g.kind] ?? 0) >= g.target,
  }));
}
export function ageDef(index: number): AgeDef {
  return AGE_DEFS[Math.max(0, Math.min(LAST_AGE, index))];
}
export function goalsMet(index: number, s: AgeSnapshot): boolean {
  return ageDef(index).goals.every((g) => s[g.kind] >= g.target);
}
/** Progress of every age against the snapshot, for the HUD. */
export function ageStatus(tier: number, s: AgeSnapshot): AgeStatus[] {
  return AGE_DEFS.map((a, i) => ({
    index: i,
    id: a.id,
    unlocked: i <= tier,
    current: i === tier,
    goals: a.goals.map((g) => ({ ...g, current: s[g.kind], done: s[g.kind] >= g.target })),
  }));
}
