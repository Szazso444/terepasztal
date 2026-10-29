import { describe, expect, it } from 'vitest';
import { AGE_ICONS, ageIcon } from './ageIcons';
import { AGE_DEFS } from '../sim/ages';

/** The opening tag of an icon's markup. */
const svgTag = (markup: string) => /^<svg\b[^>]*>/.exec(markup)?.[0] ?? '';

describe('AGE_ICONS', () => {
  it('has an icon for every age of ages.json, and the six are different', () => {
    for (const a of AGE_DEFS) expect(AGE_ICONS[a.id], a.id).toBeTruthy();
    expect(Object.keys(AGE_ICONS).sort()).toEqual(
      ['diesel', 'electric', 'hyper', 'magnetic', 'nuclear', 'steam'].sort(),
    );
    expect(new Set(Object.values(AGE_ICONS)).size).toBe(Object.keys(AGE_ICONS).length);
  });
  it('draws each as a 24 × 24 stroke icon in the current colour, hidden from a screen reader', () => {
    for (const [id, markup] of Object.entries(AGE_ICONS)) {
      const tag = svgTag(markup);
      expect(tag, id).toContain('viewBox="0 0 24 24"');
      expect(tag, id).toContain('fill="none"');
      expect(tag, id).toContain('stroke="currentColor"');
      expect(tag, id).toContain('aria-hidden="true"');
      expect(markup.endsWith('</svg>'), id).toBe(true);
      // shapes only: no fill of their own, no script, no outside reference
      expect(markup, id).not.toMatch(/<script|href|fill="(?!none)/);
    }
  });
});

describe('ageIcon', () => {
  it("gives an age's own icon, and a generic one for an unknown id", () => {
    expect(ageIcon('steam')).toBe(AGE_ICONS.steam);
    const generic = ageIcon('somewhere');
    expect(svgTag(generic)).toContain('viewBox="0 0 24 24"');
    expect(Object.values(AGE_ICONS)).not.toContain(generic);
    // an id that names something every object has is no icon either
    expect(ageIcon('constructor')).toBe(generic);
  });
});
