import { describe, expect, it, vi } from 'vitest';
import { AGE_ORDER, STR } from '../strings';
import { LAST_AGE } from '../sim/ages';
import { shownStartAge, startAges } from './editorPanel';

// the panel plays sounds through the buttons it is made of; these tests read only its lists
vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

describe('the level editor: the start age', () => {
  it('is picked by name, every age in order, none by a number', () => {
    const ages = startAges();
    expect(ages.map((a) => a.tier)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(ages.map((a) => a.name)).toEqual(AGE_ORDER.map((id) => STR.ages.name[id]));
    expect(STR.editor.startTier).not.toMatch(/\d/);
  });

  it('shows a tier outside the ages as the nearest age, and a good one as it is', () => {
    expect(shownStartAge(0)).toBe(0);
    expect(shownStartAge(3)).toBe(3);
    expect(shownStartAge(LAST_AGE)).toBe(LAST_AGE);
    expect(shownStartAge(99)).toBe(LAST_AGE);
    expect(shownStartAge(-2)).toBe(0);
    expect(shownStartAge(Number.NaN)).toBe(0);
  });
});
