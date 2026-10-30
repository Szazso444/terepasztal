import { describe, it, expect } from 'vitest';
import { AGE_ORDER, STR } from '../strings';
import { AGE_ICON, ageIconSvg, ageParts } from './ageIcon';

describe('age icons', () => {
  it('has an icon for every age', () => {
    for (const id of AGE_ORDER) {
      expect(AGE_ICON[id], id).toBeTruthy();
      expect(ageIconSvg(id, 14), id).toContain(AGE_ICON[id]);
    }
  });

  it('puts the icon before every age a text names', () => {
    const parts = ageParts(`From the ${STR.ages.name.diesel} to the ${STR.ages.name.hyper}.`);
    expect(parts).toEqual([
      'From the ',
      { id: 'diesel', name: 'Diesel Age' },
      ' to the ',
      { id: 'hyper', name: 'Hyper Age' },
      '.',
    ]);
  });

  it('leaves a text that names no age as it is', () => {
    expect(ageParts('Not enough money')).toEqual(['Not enough money']);
  });
});
