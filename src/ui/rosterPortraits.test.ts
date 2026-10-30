import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOCOS, WAGONS } from '../gacha/items';
import { PORTRAIT_IDS, portraitUrl } from './rosterPortraits';

const shipped = readdirSync(new URL('../../public/assets/portraits/', import.meta.url))
  .filter((f) => f.endsWith('.png'))
  .map((f) => f.slice(0, -'.png'.length));

describe('roster portraits', () => {
  it('lists exactly the shipped files', () => {
    expect([...PORTRAIT_IDS].sort()).toEqual([...shipped].sort());
  });

  it('names only real vehicles', () => {
    const ids = new Set([...LOCOS, ...WAGONS].map((d) => d.id));
    expect([...PORTRAIT_IDS].filter((id) => !ids.has(id))).toEqual([]);
  });

  it('gives a URL under the base for a listed vehicle and null otherwise', () => {
    expect(portraitUrl('m62', '/sub/')).toBe('/sub/assets/portraits/m62.png');
    expect(portraitUrl('no_such_vehicle')).toBeNull();
  });
});
