import { describe, expect, it } from 'vitest';
import { BUILD_ICON, buildIconSvg, type BuildIcon } from './buildIcons';

describe('the build bar icons', () => {
  it('draws each as fixed markup on a 24 px grid, in currentColor', () => {
    for (const id of Object.keys(BUILD_ICON) as BuildIcon[]) {
      const svg = buildIconSvg(id, 18);
      expect(svg, id).toContain('viewBox="0 0 24 24"');
      expect(svg, id).toContain('width="18"');
      expect(svg, id).toContain('stroke="currentColor"');
      expect(svg, id).toContain(BUILD_ICON[id]);
      expect(BUILD_ICON[id].length, id).toBeGreaterThan(0);
    }
  });
});
