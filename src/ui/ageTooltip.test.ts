import { describe, expect, it } from 'vitest';
import { ageName, ageProgress, ageTip, eraView } from './ageTooltip';
import { blockText } from './tooltipDoc';
import { STR } from '../strings';
import { fmtMoney } from './numberFormat';
import { forAll } from '../testing/property';
import { AGE_DEFS, ageStatus, goalsMet, type AgeSnapshot, type AgeStatus } from '../sim/ages';
import type { GoalKind, GoalStatus } from '../sim/ages';

const goal = (kind: GoalKind, current: number, target: number, anyOf?: number): GoalStatus => ({
  kind,
  current,
  target,
  done: current >= target,
  anyOf,
});
const age = (id: string, goals: GoalStatus[], current: boolean, unlocked: boolean): AgeStatus => ({
  index: 0,
  id,
  goals,
  current,
  unlocked,
});

describe('ageProgress', () => {
  it('is the mean of plain goals, each capped at 1', () => {
    const a = age('diesel', [goal('depots', 1, 3), goal('population', 2000, 1000)], false, false);
    expect(ageProgress(a)).toBeCloseTo((1 / 3 + 1) / 2, 6);
  });
  it('an anyOf group counts its best alternative', () => {
    const a = age('x', [goal('earned', 10, 100, 0), goal('depots', 3, 4, 0)], false, false);
    expect(ageProgress(a)).toBeCloseTo(0.75, 6);
  });
  it('a group is one entry of the mean, next to a plain goal', () => {
    const a = age(
      'x',
      [goal('earned', 10, 100, 0), goal('depots', 3, 4, 0), goal('wires', 0, 10)],
      false,
      false,
    );
    expect(ageProgress(a)).toBeCloseTo((0.75 + 0) / 2, 6);
  });
  it('a target of 0 counts as met', () => {
    expect(ageProgress(age('x', [goal('substations', 0, 0)], false, false))).toBe(1);
  });
  it('an age with no goals is complete', () => {
    expect(ageProgress(age('steam', [], true, true))).toBe(1);
  });
  it('reaches 1 exactly when the age check opens the age, for every age of ages.json', () => {
    forAll(
      (rng): AgeSnapshot => ({
        depots: rng.int(0, 4),
        population: rng.pick([0, 99, 100, 999, 1000, 5000]),
        earned: rng.pick([0, 99999, 100000, 150000, 500000]),
        substations: rng.int(0, 2),
        wires: rng.int(0, 50),
        chunks: rng.int(1, 16),
      }),
      (s) => {
        for (const a of ageStatus(0, s)) {
          const p = ageProgress(a);
          expect(p, a.id).toBeGreaterThanOrEqual(0);
          expect(p === 1, a.id).toBe(goalsMet(a.index, s));
        }
      },
    );
  });
});

describe('ageTip', () => {
  it('lists every age with its state and its goals', () => {
    const lines = ageTip([
      age('steam', [], true, true),
      age('diesel', [goal('depots', 1, 3)], false, false),
    ]).map(blockText);
    expect(lines.some((l) => l.includes(STR.ages.current))).toBe(true);
    expect(
      lines.some((l) => l.includes(STR.ages.goal.depots) && l.includes('1') && l.includes('3')),
    ).toBe(true);
  });
  it('opens with its title, says reached, current and not yet, and ends with the hint', () => {
    const doc = ageTip([
      age('steam', [], false, true),
      age('diesel', [], true, true),
      age('electric', [goal('earned', 5, 10)], false, false),
    ]);
    expect(doc[0]).toEqual({ kind: 'title', parts: [STR.ages.title] });
    const lines = doc.map(blockText);
    expect(lines).toContain(`${ageName('steam')}: ${STR.ages.reached}`);
    expect(lines).toContain(`${ageName('diesel')}: ${STR.ages.current}`);
    expect(lines).toContain(`${ageName('electric')}: ${STR.ages.locked}`);
    expect(doc[doc.length - 1]).toEqual({ kind: 'hint', parts: [STR.ages.hint] });
  });
  it('says where every railway begins for an age with no goals', () => {
    const lines = ageTip([age('steam', [], true, true)]).map(blockText);
    expect(lines).toContain(STR.ages.start);
  });
  it('shows a goal as current / target, money as money, in the good tone once done', () => {
    const doc = ageTip([
      age('electric', [goal('earned', 1234.6, 100000), goal('depots', 3, 3)], false, false),
    ]);
    const rows = doc.filter((b) => b.kind === 'row').slice(1);
    expect(rows.map(blockText)).toEqual([
      `${STR.ages.goal.earned}: ${fmtMoney(1234)} / ${fmtMoney(100000)}`,
      `${STR.ages.goal.depots}: 3 / 3`,
    ]);
    expect(rows.map((r) => (r.kind === 'row' ? r.tone : null))).toEqual([undefined, 'good']);
  });
  it('heads the alternatives of a group once, and says when one of them is met', () => {
    const open = ageTip([
      age('diesel', [goal('population', 40, 100, 0), goal('chunks', 4, 9, 0)], false, false),
    ]).map(blockText);
    expect(open.filter((l) => l === STR.ages.anyOf)).toHaveLength(1);
    expect(open).not.toContain(STR.ages.anyOfMet);
    const met = ageTip([
      age('diesel', [goal('population', 40, 100, 0), goal('chunks', 9, 9, 0)], false, false),
    ]);
    const heading = met.find((b) => blockText(b) === STR.ages.anyOfMet);
    expect(heading).toMatchObject({ tone: 'good' });
    expect(met.map(blockText)).not.toContain(STR.ages.anyOf);
  });
  it('names every age of ages.json and every goal kind it uses', () => {
    const lines = ageTip(ageStatus(0, NO_PROGRESS)).map(blockText).join('\n');
    for (const a of AGE_DEFS) expect(lines, a.id).toContain(STR.ages.name[a.id]);
    for (const a of ageStatus(0, NO_PROGRESS))
      for (const g of a.goals) expect(lines, g.kind).toContain(STR.ages.goal[g.kind]);
  });
});

const NO_PROGRESS: AgeSnapshot = {
  depots: 0,
  population: 0,
  earned: 0,
  substations: 0,
  wires: 0,
  chunks: 1,
};

describe('eraView', () => {
  const ages = ageStatus(1, { ...NO_PROGRESS, earned: 25000 });
  it('names the age the player is in and the progress toward the next one', () => {
    expect(eraView(ages, 1)).toEqual({
      id: 'diesel',
      name: ageName('diesel'),
      percent: Math.floor(ageProgress(ages[2]) * 100),
    });
    expect(eraView(ages, 1).percent).toBe(25);
  });
  it('rounds down, so an age never reads 100% before it opens', () => {
    const near = ageStatus(1, { ...NO_PROGRESS, earned: 99999 });
    expect(eraView(near, 1).percent).toBe(99);
  });
  it('has no progress at the last age', () => {
    const last = ages.length - 1;
    expect(eraView(ages, last)).toEqual({ id: ages[last].id, name: ageName(ages[last].id) });
  });
});

describe('ageName', () => {
  it('names an age by its data id, and an unknown id by itself', () => {
    expect(ageName('steam')).toBe(STR.ages.name.steam);
    expect(ageName('nowhere')).toBe('nowhere');
  });
});
