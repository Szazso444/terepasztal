import { describe, it, expect } from 'vitest';
import { BRIDGE_SWATCHES, BRIDGE_SWATCH_DENSITY, bridgeSwatch } from './bridges';

describe('procedural bridge swatches', () => {
  it('draws every swatch of the list, at one pixel per world pixel', () => {
    // The packed kit (tools/bridge-kit.mjs) carries the same names; without that file this is
    // all a bridge wears, so a name the generator cannot draw would leave a face bare.
    for (const [key, [w, h]] of Object.entries(BRIDGE_SWATCHES)) {
      const b = bridgeSwatch(key);
      expect([b.w, b.h], key).toEqual([
        Math.max(1, Math.round(w / BRIDGE_SWATCH_DENSITY)),
        Math.max(1, Math.round(h / BRIDGE_SWATCH_DENSITY)),
      ]);
      let painted = 0;
      for (let i = 3; i < b.data.length; i += 4) if (b.data[i]) painted++;
      expect(painted, key).toBeGreaterThan(0);
    }
  });

  it('keeps solid faces solid and leaves fences, trusses, braces and arches open', () => {
    const holes = (key: string) => {
      const b = bridgeSwatch(key);
      let n = 0;
      for (let i = 3; i < b.data.length; i += 4) if (!b.data[i]) n++;
      return n;
    };
    for (const key of Object.keys(BRIDGE_SWATCHES)) {
      const open = /(stone-hung|wood-(parapet|hung|brace))/.test(key);
      if (open) expect(holes(key), key).toBeGreaterThan(0);
      else expect(holes(key), key).toBe(0);
    }
  });

  it('shades faces that stand away from the light, and those under a deck more', () => {
    const mean = (key: string) => {
      const b = bridgeSwatch(key);
      let sum = 0,
        n = 0;
      for (let i = 0; i < b.data.length; i += 4)
        if (b.data[i + 3]) {
          sum += b.data[i] + b.data[i + 1] + b.data[i + 2];
          n++;
        }
      return sum / n;
    };
    for (const m of ['stone', 'wood']) {
      expect(mean(`bridgemat/${m}-leg-r`)).toBeLessThan(mean(`bridgemat/${m}-leg-l`));
      expect(mean(`bridgemat/${m}-leg-l-shade`)).toBeLessThan(mean(`bridgemat/${m}-leg-l`));
      expect(mean(`bridgemat/${m}-hung-r-shade`)).toBeLessThan(mean(`bridgemat/${m}-hung-r`));
    }
  });
});
