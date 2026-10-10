/**
 * Ages. The game moves through six ages: Steam, Diesel, Electric, Nuclear, Magnetic and Hyper;
 * each age unlocks when every goal listed for it in `src/data/ages.json` is met. A goal is a live
 * number to reach (`{ kind, target }`) or a group of alternatives (`{ anyOf: [goal, ...] }`), met
 * once any one of them is. `ages.json` is not a content-editor table; `ageProblems` checks its
 * shape. `economy.tier` holds the index of the current age (0 steam, 1 diesel, 2 electric,
 * 3 nuclear, 4 magnetic, 5 hyper) and gates works, stations, decor, contract templates and gacha
 * banners through their `tier` fields. Stations, works and houses also gain one level per age from
 * the age they appear in (`levelCap` in src/sim/levels.ts).
 *
 * For now an age after Electric only raises the level cap of buildings: no rolling stock,
 * contract, recipe or banner belongs to one. Code that picks amounts or payouts by the age number
 * reads it through `railAge`, which stops at Electric.
 */
import agesJson from '../data/ages.json';

/** Every kind of goal: one live number each in the snapshot (`ageSnapshot` in src/sim/step.ts). */
export const GOAL_KINDS = [
  'depots',
  'population',
  'earned',
  'substations',
  'wires',
  'chunks',
] as const;
/** `chunks` counts owned chunks (`RegionState.ownedCount`), the start chunk included. */
export type GoalKind = (typeof GOAL_KINDS)[number];
/** A live number to reach. */
export interface AgeGoal {
  kind: GoalKind;
  target: number;
}
/** Alternatives: met once any one of them is. */
export interface AnyOfGoal {
  anyOf: AgeGoal[];
}
/** One entry of an age's goals; the age opens when every entry is met. */
export type AgeGoalEntry = AgeGoal | AnyOfGoal;
export interface AgeDef {
  id: string;
  goals: AgeGoalEntry[];
}
/** The live numbers every goal is measured against. */
export type AgeSnapshot = Record<GoalKind, number>;
export interface GoalStatus extends AgeGoal {
  current: number;
  done: boolean;
  /**
   * Set on the alternatives of an `anyOf` entry: that entry's index in the age's goals, the same
   * on every alternative of the group. The group is met once any of them is done.
   */
  anyOf?: number;
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
/** Ages that bring their own rolling stock, contracts and land: steam, diesel and electric. */
export const RAIL_AGES = 3;

/** The age as trains, contracts and land see it: the ages after Electric count as Electric. */
export function railAge(tier: number): number {
  return Math.min(tier, RAIL_AGES - 1);
}

export function ageDef(index: number): AgeDef {
  return AGE_DEFS[Math.max(0, Math.min(LAST_AGE, index))];
}
function reached(g: AgeGoal, s: AgeSnapshot) {
  return s[g.kind] >= g.target;
}
function entryMet(e: AgeGoalEntry, s: AgeSnapshot) {
  return 'anyOf' in e ? e.anyOf.some((g) => reached(g, s)) : reached(e, s);
}
export function goalsMet(index: number, s: AgeSnapshot): boolean {
  return ageDef(index).goals.every((e) => entryMet(e, s));
}
function goalStatus(g: AgeGoal, s: AgeSnapshot): GoalStatus {
  return { kind: g.kind, target: g.target, current: s[g.kind], done: reached(g, s) };
}
/**
 * Progress of every age against the snapshot, for the HUD. The goals are flat, in the order
 * `ages.json` lists them; the alternatives of a group follow one another and carry `anyOf`.
 */
export function ageStatus(tier: number, s: AgeSnapshot): AgeStatus[] {
  return AGE_DEFS.map((a, i) => ({
    index: i,
    id: a.id,
    unlocked: i <= tier,
    current: i === tier,
    goals: a.goals.flatMap((e, j) =>
      'anyOf' in e ? e.anyOf.map((g) => ({ ...goalStatus(g, s), anyOf: j })) : [goalStatus(e, s)],
    ),
  }));
}

/**
 * Problems with an ages table, as `src/data/ages.json` holds it; empty means valid. Every age needs
 * an id and a list of goals; a goal needs a known kind and a target of zero or more; an `anyOf`
 * needs at least one alternative, each a plain goal (an empty group could never be met).
 */
export function ageProblems(defs: unknown): string[] {
  if (!Array.isArray(defs)) return ['ages: must be a list'];
  const out: string[] = [];
  const isObj = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  const checkGoal = (g: unknown, where: string) => {
    if (!isObj(g)) {
      out.push(`${where}: must be an object`);
      return;
    }
    if (!(GOAL_KINDS as readonly unknown[]).includes(g.kind))
      out.push(`${where}: unknown kind "${String(g.kind)}"`);
    if (typeof g.target !== 'number' || !Number.isFinite(g.target) || g.target < 0)
      out.push(`${where}: target must be a number of 0 or more`);
  };
  for (const [i, a] of (defs as unknown[]).entries()) {
    const id = isObj(a) && typeof a.id === 'string' && a.id ? a.id : null;
    const where = `age ${id ?? i}`;
    if (!id) out.push(`${where}: needs an id`);
    const goals = isObj(a) ? a.goals : undefined;
    if (!Array.isArray(goals)) {
      out.push(`${where}: goals must be a list`);
      continue;
    }
    for (const [j, e] of (goals as unknown[]).entries()) {
      if (!isObj(e) || !('anyOf' in e)) checkGoal(e, `${where} goal ${j}`);
      else if (!Array.isArray(e.anyOf) || !e.anyOf.length)
        out.push(`${where} goal ${j}: anyOf needs at least one goal`);
      else
        for (const [k, g] of (e.anyOf as unknown[]).entries())
          checkGoal(g, `${where} goal ${j} anyOf ${k}`);
    }
  }
  return out;
}
