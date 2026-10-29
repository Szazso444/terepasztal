/**
 * The ages as the era widget by the date shows them (src/ui/hud.ts): the age the player is in, the
 * progress toward the next one, and a tooltip document listing every age with its goals. DOM-free,
 * so Node tests read it.
 */
import { STR } from '../strings';
import type { AgeStatus, GoalKind, GoalStatus } from '../sim/ages';
import { fmtInt, fmtMoney } from './numberFormat';
import { dim, hint, num, quiet, row, title, type Block, type TipDoc } from './tooltipDoc';

/** Display name of an age by data id. */
export function ageName(id: string) {
  return STR.ages.name[id] ?? id;
}

/**
 * An age's goals by entry: a plain goal on its own, the alternatives of one `anyOf` group together
 * (`ageStatus` lists them one after another, each carrying the group's index).
 */
function goalRows(goals: GoalStatus[]): GoalStatus[][] {
  const rows: GoalStatus[][] = [];
  for (const g of goals) {
    const last = rows[rows.length - 1];
    if (g.anyOf !== undefined && last && last[0].anyOf === g.anyOf) last.push(g);
    else rows.push([g]);
  }
  return rows;
}

/** How far one goal is, 0 to 1; a target of 0 is met from the start. */
function goalProgress(g: GoalStatus): number {
  return g.target > 0 ? Math.max(0, Math.min(g.current / g.target, 1)) : 1;
}

/**
 * How far an age is toward opening, 0 to 1: the mean over its entries of each plain goal's share
 * (capped at 1) and each group's best alternative. An age with no goals is complete.
 */
export function ageProgress(s: AgeStatus): number {
  const rows = goalRows(s.goals);
  if (!rows.length) return 1;
  let sum = 0;
  for (const r of rows) sum += Math.max(...r.map(goalProgress));
  return sum / rows.length;
}

/** What the era widget shows: the current age, and the whole percent toward the next one. */
export interface EraView {
  id: string;
  name: string;
  /** rounded down, so it reads 100 only once the age opens; absent at the last age */
  percent?: number;
}

export function eraView(ages: AgeStatus[], tier: number): EraView {
  const cur = ages[Math.max(0, Math.min(tier, ages.length - 1))];
  const next = ages[tier + 1];
  const view: EraView = { id: cur?.id ?? '', name: cur ? ageName(cur.id) : String(tier) };
  if (next) view.percent = Math.floor(ageProgress(next) * 100);
  return view;
}

function fmtGoal(kind: GoalKind, v: number) {
  return kind === 'earned' ? fmtMoney(Math.floor(v)) : fmtInt(Math.floor(v));
}

/** A goal: its name, then `current / target`, the whole row in the good tone once done. */
function goalRow(g: GoalStatus): Block {
  return row(
    STR.ages.goal[g.kind],
    [num(fmtGoal(g.kind, g.current)), ' / ', num(fmtGoal(g.kind, g.target))],
    g.done ? { tone: 'good' } : {},
  );
}

/**
 * Every age with its state (the current one plain, a reached one dim, one to come with its state
 * dim) and its goals. The alternatives of a group follow a "One of these" line, which says so in
 * the good tone once one of them is met. PR 3's "unlocks in the …" terms open this document too.
 */
export function ageTip(ages: AgeStatus[]): TipDoc {
  const out: Block[] = [title(STR.ages.title)];
  for (const a of ages) {
    const name = ageName(a.id);
    if (a.current) out.push(row(name, STR.ages.current));
    else if (a.unlocked) out.push(row(quiet(name), quiet(STR.ages.reached)));
    else out.push(row(name, quiet(STR.ages.locked)));
    if (!a.goals.length) {
      out.push(dim(STR.ages.start));
      continue;
    }
    for (const r of goalRows(a.goals)) {
      // a group of one is a plain goal
      if (r.length > 1)
        out.push(
          r.some((g) => g.done)
            ? { kind: 'text', parts: [STR.ages.anyOfMet], tone: 'good' }
            : dim(STR.ages.anyOf),
        );
      out.push(...r.map(goalRow));
    }
  }
  out.push(hint(STR.ages.hint));
  return out;
}
