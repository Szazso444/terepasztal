import { describe, it, expect } from 'vitest';
import { content } from '../data/content';
import { craftTier, craftPool } from '../gacha/crafting';
import { TRACK_ITEMS, LINES, lineAge } from '../world/track';
import { unitDef } from '../world/trackGeom';
import { AGE_ORDER } from '../strings';
import { classOf, classRunsOn, gaugeLine, gaugeNetwork, vehicleAccess } from './compat';
import { locoDef, wagonDef } from '../gacha/items';

const MAGNETIC = AGE_ORDER.indexOf('magnetic');

describe('Maglev Guideway', () => {
  it('is a network of its own, open from the Magnetic age', () => {
    expect(LINES.maglev.network).toBe('maglev');
    expect(lineAge('maglev')).toBe(MAGNETIC);
    expect(LINES.maglev.roadCrossing).toBe(false);
    const kinds = TRACK_ITEMS.filter((i) => i.cls === 'maglev').map((i) => i.kind);
    expect(kinds).toEqual(['straight', 'curve', 'switch', 'crossing']);
    expect(TRACK_ITEMS.some((i) => i.cls !== 'maglev' && i.cls2 === 'maglev')).toBe(false);
  });

  it('curves over 5x5 tiles', () => {
    expect(LINES.maglev.n).toBe(5);
    expect(unitDef('curve', LINES.maglev.n, 0).n).toBe(5);
  });

  it('runs only the Hydrofoil class, which runs nowhere else', () => {
    for (const cls of Object.keys(LINES) as (keyof typeof LINES)[])
      expect(classRunsOn('hydrofoil', cls), cls).toBe(cls === 'maglev');
    for (const tc of ['corvette', 'frigate', 'destroyer', 'cruiser', 'carrier'] as const)
      expect(classRunsOn(tc, 'maglev'), tc).toBe(false);
    expect(vehicleAccess(locoDef('transrapid'), 'maglev')).toBeNull();
    expect(vehicleAccess(locoDef('transrapid'), 'trunk')).not.toBeNull();
    expect(vehicleAccess(locoDef('tgv'), 'maglev')).not.toBeNull();
  });

  it('has a depot of its own that lays guideway, from the Magnetic age', () => {
    const depot = content.stations.defs.find((d) => d.id === 'maglev_depot')!;
    expect(depot.tier).toBe(MAGNETIC);
    expect(depot.gauge).toBe('maglev');
    expect(gaugeNetwork('maglev')).toBe('maglev');
    expect(gaugeLine('maglev')).toBe('maglev');
  });
});

describe('the Hydrofoil set', () => {
  it('has the values the author chose', () => {
    expect(locoDef('transrapid')).toMatchObject({
      speed: 4,
      power: 160,
      powerPerTile: 0.3,
      rarity: 'SSR',
    });
  });

  it('is of the Hydrofoil class, and a recipe of the Magnetic age', () => {
    expect(classOf(locoDef('transrapid'))).toBe('hydrofoil');
    expect(classOf(wagonDef('transrapid_car'))).toBe('hydrofoil');
    expect(craftTier('transrapid')).toBe(MAGNETIC);
    expect(craftTier('transrapid_car')).toBe(MAGNETIC);
    expect(craftPool('loco', MAGNETIC)).toEqual(['transrapid']);
    expect(craftPool('wagon', MAGNETIC)).toEqual(['transrapid_car']);
  });
});
