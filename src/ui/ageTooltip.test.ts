import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ageName, ageProgress, ageTip, eraView, levelLine, lockTip } from './ageTooltip';
import { decorPlace } from './buildBar';
import { ageHint } from './ruleText';
import { DECOR_DEFS } from '../sim/build';
import { blockText, partsOf, plain, termsOf, type Block } from './tooltipDoc';
import { AGE_PICTURE, ageNews, agePictureUrl } from './ageNews';
import { DEFAULT_CONTENT } from '../data/content';
import { DEFAULT_RULES, rules } from '../sim/rules';
import { DEFAULT_SUPPLY, setSupplyMode } from '../sim/supply';
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
    expect(doc[doc.length - 1]).toEqual({ kind: 'hint', parts: [ageHint()] });
  });
  it('heads each age with its name, the current one in the accent tone', () => {
    const ids = ['steam', 'diesel', 'electric'];
    const doc = ageTip([
      age('steam', [], false, true),
      age('diesel', [], true, true),
      age('electric', [goal('earned', 5, 10)], false, false),
    ]);
    const names = new Set(ids.map(ageName));
    const heads = doc.filter((b) => b.kind === 'row' && names.has(plain(b.label)));
    expect(heads.map((b) => (b.kind === 'row' ? plain(b.label) : null))).toEqual(ids.map(ageName));
    expect(heads.map((b) => (b.kind === 'row' ? b.tone : null))).toEqual([
      undefined,
      'accent',
      undefined,
    ]);
    expect(heads.every((b) => b.kind === 'row' && !b.indent)).toBe(true);
  });
  it('indents the alternatives of a group, and no plain goal', () => {
    const doc = ageTip([
      age(
        'diesel',
        [goal('population', 40, 100, 0), goal('chunks', 4, 9, 0), goal('depots', 1, 3)],
        false,
        false,
      ),
    ]);
    const goals = doc.filter((b) => b.kind === 'row').slice(1);
    expect(goals.map((b) => (b.kind === 'row' ? !!b.indent : null))).toEqual([true, true, false]);
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

describe('what each age brings', () => {
  beforeEach(() => Object.assign(rules, DEFAULT_RULES));
  afterEach(() => {
    Object.assign(rules, DEFAULT_RULES);
    setSupplyMode(DEFAULT_SUPPLY);
  });
  const ids = (list: { id: string }[]) => list.map((d) => d.id).sort();
  const data = DEFAULT_CONTENT;
  const inChain = (mode: string) => (d: { supply?: string }) => !d.supply || d.supply === mode;

  it('opens each buildable line in its age, and no line that has no pieces yet', () => {
    expect(AGE_DEFS.map((_, i) => ageNews(i).lines)).toEqual([
      ['narrow', 'branch'],
      ['main'],
      ['trunk'],
      [],
      [],
      [],
    ]);
    rules.lineAgeLocks = 0;
    expect(ageNews(0).lines).toEqual(['narrow', 'branch', 'main', 'trunk']);
    rules.narrowUnlocked = 0;
    expect(ageNews(0).lines).not.toContain('narrow');
    expect(ids(ageNews(0).stations)).not.toContain('narrow_depot');
  });

  for (const mode of ['simple', 'full'] as const)
    it(`takes stations, works and bridges by their tier, in the ${mode} chain`, () => {
      setSupplyMode(mode);
      AGE_DEFS.forEach((a, i) => {
        const n = ageNews(i);
        const stations = data.stations.defs.filter((d) => d.tier === i).filter(inChain(mode));
        const works = data.buildings.filter((d) => d.tier === i).filter(inChain(mode));
        expect(ids(n.stations), a.id).toEqual(ids(stations));
        expect(ids([...n.works, ...n.bridges]), a.id).toEqual(ids(works));
        for (const b of n.bridges) expect(b.bridge, b.id).toBeDefined();
      });
    });

  it('sorts the rolling stock by its age, and leaves out what is retired', () => {
    const engines = AGE_DEFS.map((_, i) => ageNews(i).locos);
    const type = ['steam', 'diesel', 'electric'];
    engines.forEach((list, i) => {
      for (const l of list) {
        expect(l.type).toBe(type[i]);
        expect(l.retired, l.id).toBeFalsy();
      }
    });
    expect(engines.flat().length).toBe(data.locomotives.filter((l) => !l.retired).length);
    expect(AGE_DEFS.flatMap((_, i) => ageNews(i).wagons).length).toBe(
      data.wagons.filter((w) => !w.retired).length,
    );
    // the ages after Electric bring no vehicle of their own
    expect(engines.slice(3).flat()).toEqual([]);
  });

  it('takes contracts by their first age, wires by theirs, and one more level each age', () => {
    expect(AGE_DEFS.map((_, i) => ids(ageNews(i).contracts))).toEqual([
      ['bulk', 'local'],
      ['rush', 'standing'],
      ['charter'],
      [],
      [],
      [],
    ]);
    expect(ageNews(2).supplies.length).toBe(3);
    expect(ageNews(1).supplies).toEqual([]);
    expect(AGE_DEFS.map((_, i) => ageNews(i).level)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  /** The blocks of the card of one age: from its picture to the next one. */
  const card = (doc: readonly Block[], id: string) => {
    const at = doc.findIndex((b) => b.kind === 'picture' && b.age === id);
    const next = doc.findIndex((b, i) => i > at && (b.kind === 'picture' || b.kind === 'hint'));
    return doc.slice(at, next);
  };
  const tip = () => ageTip(ageStatus(0, NO_PROGRESS));

  it('stands a picture at the head of every card, from the one table', () => {
    const doc = tip();
    const pictures = doc.filter((b) => b.kind === 'picture');
    expect(pictures).toEqual(
      AGE_DEFS.map((a) => ({ kind: 'picture', age: a.id, src: agePictureUrl(a.id) })),
    );
    expect(Object.keys(AGE_PICTURE)).toEqual(AGE_DEFS.map((a) => a.id));
    for (const a of AGE_DEFS) expect(card(doc, a.id)[1].kind, a.id).toBe('row');
  });

  it('says what is new in an age, each thing a term that opens what the data says of it', () => {
    const doc = tip();
    const diesel = card(doc, 'diesel');
    const lines = diesel.map(blockText);
    expect(lines).toContain(STR.ages.news.track.replace('{list}', STR.toolbar.trackClass.main));
    const terms = termsOf(diesel);
    const main = terms.find((t) => t.term === STR.toolbar.trackClass.main);
    expect(main?.tip().map(blockText)).toEqual([
      STR.toolbar.trackClass.main,
      STR.toolbar.trackDesc.straight_main,
    ]);
    const refinery = data.buildings.find((b) => b.id === 'refinery');
    expect(terms.some((t) => t.term === refinery?.name)).toBe(true);
    expect(lines).toContain(levelLine(2));
    expect(lines.join('\n')).not.toContain('{');
  });

  it('counts a long list, and the count opens every name of it', () => {
    const steam = card(tip(), 'steam');
    const count = termsOf(steam).find((t) => t.term === STR.ages.news.enginesCount(18));
    expect(count).toBeDefined();
    const names = count?.tip().map(blockText) ?? [];
    expect(names).toContain("Stephenson's Rocket");
    expect(names).toHaveLength(19);
  });

  it('says of an age with nothing but a level just that', () => {
    const lines = card(tip(), 'nuclear').map(blockText);
    expect(lines[lines.length - 1]).toBe(levelLine(4));
    expect(card(tip(), 'nuclear').filter((b) => b.kind === 'dim')).toHaveLength(1);
  });

  it('calls engines and wagons recipes, and says the level of the first age alone', () => {
    const lines = card(tip(), 'diesel').map(blockText);
    expect(lines.some((l) => l.startsWith('Engine recipes: '))).toBe(true);
    expect(lines.some((l) => l.startsWith('Wagon recipes: '))).toBe(true);
    expect(lines).toContain('Steam Age buildings rise to level 2');
  });

  it('lists what the bar calls tools as tools, not as town and services', () => {
    const lines = card(tip(), 'steam').map(blockText);
    const tools = lines.find((l) => l.startsWith('Tools: ')) ?? '';
    const onTools = DECOR_DEFS.filter((d) => decorPlace(d).category === 'tools');
    expect(onTools.length).toBeGreaterThan(0);
    for (const d of onTools) expect(tools).toContain(d.name);
    expect(ageNews(0).tools).toEqual(onTools);
    expect(ageNews(0).decor).toEqual(DECOR_DEFS.filter((d) => !onTools.includes(d)));
  });

  it('gives a term only to what has something to say', () => {
    const diesel = termsOf(card(tip(), 'diesel')).map((t) => t.term);
    const contract = data.contracts.templates.find((t) => t.minTier === 1);
    expect(card(tip(), 'diesel').map(blockText).join('\n')).toContain(contract?.name);
    expect(diesel).not.toContain(contract?.name);
  });

  it('reads no part of a picture', () => {
    const p = tip().find((b) => b.kind === 'picture') as Block;
    expect(partsOf(p)).toEqual([]);
    expect(blockText(p)).toBe('');
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

describe('lockTip', () => {
  const AGES = [
    age('steam', [], true, true),
    age('diesel', [goal('depots', 1, 2), goal('population', 300, 300)], false, false),
    age('electric', [goal('earned', 10, 100, 0), goal('wires', 3, 4, 0)], false, false),
  ];

  it('names the age it waits for, then the goals of that age with their progress', () => {
    const lines = lockTip(AGES, 1).map(blockText);
    expect(lines[0]).toBe(STR.ages.unlocksIn(ageName('diesel')));
    expect(lines).toContain(`${STR.ages.goal.depots}: 1 / 2`);
    expect(lines).toContain(`${STR.ages.goal.population}: 300 / 300`);
  });
  it('shows a met goal in the good tone, and one still open in none', () => {
    const rows = lockTip(AGES, 1).filter((b) => b.kind === 'row');
    expect(rows.map((b) => (b.kind === 'row' ? b.tone : null))).toEqual([undefined, 'good']);
  });
  it('lists the alternatives of a group under its line, indented', () => {
    const doc = lockTip(AGES, 2);
    expect(doc.map(blockText)).toContain(STR.ages.anyOf);
    const rows = doc.filter((b) => b.kind === 'row');
    expect(rows.map((b) => (b.kind === 'row' ? !!b.indent : null))).toEqual([true, true]);
  });
  it('says which age comes first when the one it waits for is not the next', () => {
    expect(lockTip(AGES, 2).map(blockText)).toContain(STR.ages.reachFirst(ageName('diesel')));
    expect(lockTip(AGES, 1).map(blockText)).not.toContain(STR.ages.reachFirst(ageName('steam')));
  });
  it('still says what it needs for an age the list does not hold', () => {
    expect(lockTip([], 3).map(blockText)).toEqual([STR.build.tierLocked(3)]);
  });
});
