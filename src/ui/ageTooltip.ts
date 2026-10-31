/**
 * The ages as the era widget by the date shows them (src/ui/hud.ts): the age the player is in, the
 * progress toward the next one, and a tooltip document with a card for every age: its picture, its
 * goals and what is new in it (`ageNews`). DOM-free, so Node tests read it.
 */
import { STR } from '../strings';
import { AGE_DEFS, type AgeStatus, type GoalKind, type GoalStatus } from '../sim/ages';
import { ageNews, agePictureUrl, type AgeNews } from './ageNews';
import { fmtInt, fmtMoney } from './numberFormat';
import {
  bad,
  dim,
  fill,
  good,
  hint,
  num,
  picture,
  quiet,
  richText,
  row,
  term,
  title,
  type Block,
  type Inline,
  type TipDoc,
} from './tooltipDoc';

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

export function fmtGoal(kind: GoalKind, v: number) {
  return kind === 'earned' ? fmtMoney(Math.floor(v)) : fmtInt(Math.floor(v));
}

/**
 * A goal: its name, then `current / target`, the whole row in the good tone once done; an
 * alternative of a group sits indented under the group's line.
 */
function goalRow(g: GoalStatus, indent: boolean): Block {
  return row(
    STR.ages.goal[g.kind],
    [num(fmtGoal(g.kind, g.current)), ' / ', num(fmtGoal(g.kind, g.target))],
    { tone: g.done ? 'good' : undefined, indent },
  );
}

/**
 * An age's goals: the alternatives of a group sit indented under a "One of these" line, which says
 * so in the good tone once one of them is met.
 */
function goalBlocks(goals: GoalStatus[]): Block[] {
  const out: Block[] = [];
  for (const r of goalRows(goals)) {
    // a group of one is a plain goal
    const group = r.length > 1;
    if (group) out.push(r.some((g) => g.done) ? good(STR.ages.anyOfMet) : dim(STR.ages.anyOf));
    out.push(...r.map((g) => goalRow(g, group)));
  }
  return out;
}

/**
 * What a locked item or type of the build bar waits for: the age it opens in, the goals of that age
 * with their progress and, when another age comes first, which one. `tier` is the age's index.
 */
export function lockTip(ages: AgeStatus[], tier: number): Block[] {
  const waits = ages[tier];
  if (!waits) return [bad(STR.build.tierLocked(tier))];
  const before = ages[tier - 1];
  return [
    bad(STR.ages.unlocksIn(ageName(waits.id))),
    ...(before && !before.unlocked ? [dim(STR.ages.reachFirst(ageName(before.id)))] : []),
    ...goalBlocks(waits.goals),
  ];
}

/** One new thing of an age: its name, and what its own tooltip says. */
export interface NewThing {
  name: string;
  about?: string;
}

/** The most things named one by one; a longer list is a count that opens them in its tooltip. */
const NAMED_AT_MOST = 4;

/** A term for one new thing: its tooltip has the name and what the data says of it. */
function thingTerm(t: NewThing): Inline {
  return term(t.name, () => [title(t.name), ...(t.about ? [dim(...richText(t.about))] : [])]);
}

/** A list of new things: named while it is short, a count that lists them when it is not. */
function thingList(things: readonly NewThing[], count: (n: number) => string): Inline[] {
  if (things.length > NAMED_AT_MOST)
    return [
      term(count(things.length), () => [
        title(count(things.length)),
        ...things.map((t) => dim(t.name)),
      ]),
    ];
  return things.flatMap((t, i) => (i ? [', ', thingTerm(t)] : [thingTerm(t)]));
}

/** What a kind of new thing is called on its line, and the things of an age under it. */
export interface NewsLine {
  /** the line's template, with `{list}` for the things */
  label: string;
  things: NewThing[];
  /** the things as a count, for a long list */
  count: (n: number) => string;
}

const named = (d: { name: string; flavor: string }): NewThing => ({
  name: d.name,
  about: d.flavor,
});

/** An age's news by kind, the empty kinds left out. */
export function newsLines(n: AgeNews): NewsLine[] {
  const N = STR.ages.news;
  const lines: NewThing[] = n.lines.map((c) => ({
    name: STR.toolbar.trackClass[c],
    about: STR.toolbar.trackDesc[`straight_${c}`],
  }));
  const supplies: NewThing[] = n.supplies.map((k) => ({
    name: STR.toolbar.supply[k],
    about: STR.toolbar.supplyDesc[k],
  }));
  const all: NewsLine[] = [
    { label: N.track, things: [...lines, ...n.bridges.map(named)], count: N.trackCount },
    { label: N.stations, things: n.stations.map(named), count: N.stationsCount },
    { label: N.services, things: n.decor.map(named), count: N.servicesCount },
    { label: N.works, things: n.works.map(named), count: N.worksCount },
    { label: N.electric, things: supplies, count: N.electricCount },
    {
      label: N.engines,
      things: n.locos.map((l) => ({ name: l.name, about: l.era })),
      count: N.enginesCount,
    },
    {
      label: N.wagons,
      things: n.wagons.map((w) => ({ name: w.name, about: w.era })),
      count: N.wagonsCount,
    },
    {
      label: N.contracts,
      things: n.contracts.map((t) => ({ name: t.name })),
      count: N.contractsCount,
    },
  ];
  return all.filter((l) => l.things.length);
}

/** An age's news as dim lines, then the level its buildings may rise to. */
function newsBlocks(n: AgeNews): Block[] {
  const out = newsLines(n).map((l) =>
    dim(...fill(l.label, { list: thingList(l.things, l.count) })),
  );
  if (n.level > 1) out.push(dim(...richText(STR.ages.news.level(n.level))));
  return out;
}

/** The news of the age with this id; an age the data does not know has none. */
function newsOf(id: string): Block[] {
  const at = AGE_DEFS.findIndex((a) => a.id === id);
  return at < 0 ? [] : newsBlocks(ageNews(at));
}

/**
 * A card for every age: its picture; its name and state as a heading row (the current one in the
 * accent tone, a reached one dim, one to come with its state dim); its goals; then what is new in
 * it, each thing a term with its own tooltip.
 */
export function ageTip(ages: AgeStatus[]): TipDoc {
  const out: Block[] = [title(STR.ages.title)];
  for (const a of ages) {
    const name = ageName(a.id);
    out.push(picture(a.id, agePictureUrl(a.id)));
    if (a.current) out.push(row(name, STR.ages.current, { tone: 'accent' }));
    else if (a.unlocked) out.push(row(quiet(name), quiet(STR.ages.reached)));
    else out.push(row(name, quiet(STR.ages.locked)));
    if (a.goals.length) out.push(...goalBlocks(a.goals));
    else out.push(dim(STR.ages.start));
    out.push(...newsOf(a.id));
  }
  out.push(hint(STR.ages.hint));
  return out;
}
