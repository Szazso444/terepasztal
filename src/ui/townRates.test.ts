import { describe, it, expect } from 'vitest';
import { STR } from '../strings';
import { content } from '../data/content';
import { formatRates, rateLabel } from './townRates';

const plant = content.buildings.find((b) => b.id === 'power_plant')!;

/** A week of one works, as the town registry sums it: each recipe amount times its batches. */
const perWeek = (rec: Record<string, number>, batches: number) =>
  Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, v * batches]));

describe('what the town panel lists a town makes and uses', () => {
  it('shows the power a power plant makes under its own label', () => {
    expect(plant.recipe.out).toHaveProperty('power');
    const makes = { ...perWeek(plant.recipe.out, plant.perWeek), wood: 12 };
    const uses = { ...perWeek(plant.recipe.in, plant.perWeek), food: 3 };
    expect(() => formatRates(makes)).not.toThrow();
    expect(rateLabel('power')).toBe(STR.town.power);
    expect(formatRates(makes)).toContain(`${plant.perWeek} ${STR.town.power}`);
    expect(formatRates(makes)).toContain(`12 ${rateLabel('wood')}`);
    for (const id of Object.keys(uses)) expect(formatRates(uses)).toContain(rateLabel(id)!);
  });

  it('lists a town of cargo only largest first, in whole units, without what rounds to nothing', () => {
    const shown = formatRates({ wood: 12.4, stone: 30, water: 0.4 });
    expect(shown).toContain(`30 ${rateLabel('stone')}`);
    expect(shown).toContain(`12 ${rateLabel('wood')}`);
    expect(shown.indexOf(rateLabel('stone')!)).toBeLessThan(shown.indexOf(rateLabel('wood')!));
    expect(shown).not.toContain(rateLabel('water')!);
    expect(shown).not.toContain(STR.town.power);
    // nothing worth a unit reads the same as nothing at all, with no number in it
    expect(formatRates({ water: 0.2 })).toBe(formatRates({}));
    expect(formatRates({})).not.toMatch(/\d/);
  });

  it('skips an id that is neither power nor a cargo instead of throwing', () => {
    expect(rateLabel('no_such_cargo')).toBeNull();
    expect(() => formatRates({ no_such_cargo: 50, wood: 3 })).not.toThrow();
    expect(formatRates({ no_such_cargo: 50, wood: 3 })).toBe(formatRates({ wood: 3 }));
    expect(formatRates({ no_such_cargo: 50 })).toBe(formatRates({}));
  });

  it('has a label for everything the shipped works and stations make or use', () => {
    const ids = new Set<string>();
    for (const b of content.buildings)
      for (const rec of [b.recipe.in, b.recipe.out, b.altIn ?? {}])
        for (const id of Object.keys(rec)) ids.add(id);
    for (const s of content.stations.defs) for (const p of s.produces) ids.add(p.cargo);
    // residents eat food even in a town without works
    ids.add('food');
    for (const id of ids) expect(rateLabel(id), id).not.toBeNull();
  });
});
