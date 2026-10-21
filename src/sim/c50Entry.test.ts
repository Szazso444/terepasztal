import { describe, it, expect } from 'vitest';
import { content } from '../data/content';
import { bannerPool, validateBanners } from '../gacha/gacha';
import { craftPool, craftSize, craftTier } from '../gacha/crafting';
import { isRetired, locoDef } from '../gacha/items';
import { OWN_LENGTH, SIZE_LEN, vehicleSpec } from './body';
import { gaugeOf, vehicleAccess } from './compat';

/** The common narrow diesels the C-50 joins (decision c50-role, 2026-10-11, "New narrow diesel, common"). */
const SIBLINGS = ['bm50', 'muki'] as const;

describe('the MÁV C-50 (c50-role: a common narrow diesel, found, not handed out)', () => {
  const c50 = locoDef('c50');

  it('is one entry: a common diesel on the narrow gauge, in the content as shipped', () => {
    expect(content.locomotives.filter((l) => l.id === 'c50')).toHaveLength(1);
    expect(c50.name).toBe('MÁV C-50');
    expect(c50.rarity).toBe('N');
    expect(c50.type).toBe('diesel');
    expect(gaugeOf(c50)).toBe('narrow');
    expect(c50.era.length).toBeGreaterThan(0);
    expect(c50.era).toMatch(/760 mm/);
  });

  it('is no starter and not retired: a new game hands none out and a pull or a recipe may', () => {
    expect(c50.starter).toBeUndefined();
    expect(isRetired('c50')).toBe(false);
    // the starters are the entries that say so; the C-50 is not among them
    expect(content.locomotives.filter((l) => l.starter).map((l) => l.id)).not.toContain('c50');
  });

  it('is found by crafting in the Diesel age and by pulling the Diesel Era banner, and nowhere else', () => {
    expect(craftTier('c50')).toBe(1);
    expect(craftPool('loco', 1)).toContain('c50');
    for (const t of [0, 2]) expect(craftPool('loco', t)).not.toContain('c50');
    const holding = content.gacha.banners.filter((b) => bannerPool(b).includes('c50'));
    expect(holding.map((b) => b.id)).toEqual(['diesel_era']);
    expect(holding.map((b) => b.tier)).toEqual([1]);
  });

  it('leaves every banner offering every rarity', () => {
    expect(validateBanners()).toEqual([]);
  });

  it('has the stats of a common narrow diesel, beside BM-50 and Muki', () => {
    expect(c50.power).toBeGreaterThanOrEqual(30);
    expect(c50.power).toBeLessThanOrEqual(60);
    expect(c50.crew).toBe(1);
    expect(c50.fuelCap && c50.fuelPerTile).toBeTruthy();
    const sibs = SIBLINGS.map(locoDef);
    for (const key of ['speed', 'power', 'weight', 'crew', 'fuelCap', 'fuelPerTile'] as const) {
      const vals = sibs.map((s) => s[key] as number);
      const v = c50[key] as number;
      expect(v, key).toBeGreaterThanOrEqual(Math.min(...vals) * 0.5);
      expect(v, key).toBeLessThanOrEqual(Math.max(...vals) * 2);
    }
    // a diesel carries no water
    expect(c50.waterCap).toBeUndefined();
    expect(c50.waterPerTile).toBeUndefined();
  });

  it('is a small rigid body of its own length: the size its plan needs, the length of its model', () => {
    expect(c50.size).toBe('small');
    expect(craftSize('c50')).toBe('small');
    expect(c50.length).toBe(0.82);
    expect(c50.length!).toBeGreaterThanOrEqual(OWN_LENGTH.min);
    expect(c50.length!).toBeLessThanOrEqual(OWN_LENGTH.max);
    const spec = vehicleSpec(c50);
    expect(spec.segments).toHaveLength(1);
    expect(spec.segments[0].L).toBe(0.82);
    expect(spec.segments[0].L).toBeLessThan(SIZE_LEN.small);
  });

  it('runs on narrow track and on no wide class', () => {
    expect(vehicleAccess(c50, 'narrow')).toBeNull();
    expect(vehicleAccess(c50, 'regular')).not.toBeNull();
    expect(vehicleAccess(c50, 'high_speed')).not.toBeNull();
  });

  it('is drawn from a body and paint the narrow diesels already use, so it adds no atlas frame', () => {
    const drawn = (d: (typeof content.locomotives)[number]) =>
      `${d.body}|${d.size ?? 'small'}|${d.gauge ?? 'regular'}|${d.paint}`;
    const others = content.locomotives.filter((l) => l.id !== 'c50').map(drawn);
    expect(others).toContain(drawn(c50));
    expect(c50.body).toBe('diesel_switcher');
    // the generator draws each such variant once, from the first entry that names it: the C-50
    // must not be that entry, or its length would redraw the sprites its siblings use
    const first = content.locomotives.find((l) => drawn(l) === drawn(c50))!;
    expect(first.id).not.toBe('c50');
  });
});
