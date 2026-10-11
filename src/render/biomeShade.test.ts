import { describe, expect, it } from 'vitest';
import { biomeShade } from './biomeShade';

/** Terrain ids 0..6 (grass, forest, hill, water, rock, sand, mountain), biome ids 0..5. */
const TERRAINS = [0, 1, 2, 3, 4, 5, 6];
const BIOMES = [0, 1, 2, 3, 4, 5];
const SHADED_TERRAINS = [0, 1];
/** Plains, desert, taiga, swamp tint; forest (1) and ocean (5) do not. */
const TINTED_BIOMES = [0, 2, 3, 4];
const UNTINTED_BIOMES = [1, 5];

/** The overview and minimap terrain colours, plus the extremes the clamp has to survive. */
const COLORS = [
  '#5b7145',
  '#3f5231',
  '#8a7a55',
  '#39616a',
  '#7c7970',
  '#b7a47b',
  '#93908a',
  '#000000',
  '#010101',
  '#0a0a0a',
  '#ffffff',
  '#fefefe',
  '#f5f5f5',
  '#ff0000',
  '#00ff00',
  '#0000ff',
];

const channels = (css: string) => [1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16));

describe('biomeShade', () => {
  it('leaves every terrain other than grass and forest unchanged, whatever the biome', () => {
    for (const terrain of TERRAINS.filter((t) => !SHADED_TERRAINS.includes(t)))
      for (const biome of BIOMES)
        for (const css of COLORS) expect(biomeShade(css, biome, terrain)).toBe(css);
  });

  it('returns input that is not #rrggbb unchanged, for every terrain and biome', () => {
    const notHex = [
      '',
      'red',
      '#fff',
      '#ffff',
      '#12345',
      '#1234567',
      '#12345678',
      '#gg0000',
      '123456',
      ' #123456',
      '#123456 ',
      'rgb(10, 20, 30)',
      'rgba(10,20,30,0.5)',
      'hsl(120, 40%, 40%)',
    ];
    for (const terrain of TERRAINS)
      for (const biome of BIOMES)
        for (const css of notHex) expect(biomeShade(css, biome, terrain)).toBe(css);
  });

  it('returns the input colour for a biome with no tint (forest, ocean)', () => {
    for (const terrain of SHADED_TERRAINS)
      for (const biome of UNTINTED_BIOMES)
        for (const css of COLORS) expect(biomeShade(css, biome, terrain)).toBe(css);
  });

  it('returns the input colour for a biome id outside the known set', () => {
    for (const terrain of SHADED_TERRAINS)
      for (const biome of [-1, 6, 99, 0.5, NaN])
        for (const css of COLORS) expect(biomeShade(css, biome, terrain)).toBe(css);
  });

  it('reads the hex digits in either case and answers in lower case', () => {
    for (const terrain of SHADED_TERRAINS)
      for (const biome of BIOMES) {
        const lower = biomeShade('#5b7145', biome, terrain);
        expect(biomeShade('#5B7145', biome, terrain)).toBe(lower);
        expect(lower).toBe(lower.toLowerCase());
      }
  });

  it('answers #rrggbb with every channel in 0..255 for every tinted biome, near black and white too', () => {
    for (const terrain of SHADED_TERRAINS)
      for (const biome of TINTED_BIOMES)
        for (const css of COLORS) {
          const out = biomeShade(css, biome, terrain);
          expect(out).toMatch(/^#[0-9a-f]{6}$/);
          for (const v of channels(out)) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(255);
          }
        }
  });

  it('saturates at 00 and ff instead of wrapping round', () => {
    expect(biomeShade('#ffffff', 2, 0)).toBe('#ffffff');
    expect(biomeShade('#fefefe', 0, 1)).toBe('#fffffe');
    expect(biomeShade('#000000', 3, 0)).toBe('#000016');
    expect(biomeShade('#000000', 4, 1)).toBe('#0a0000');
    expect(biomeShade('#ffffff', 3, 1)).toBe('#f5ffff');
  });

  it('keeps the tint direction: taiga cooler, swamp muddier, desert paler, plains warmer', () => {
    // A mid grey, so no channel clamps and the direction of each tint can be read off.
    const base = channels('#808080');
    const taiga = channels(biomeShade('#808080', 3, 0));
    expect(taiga[0]).toBeLessThan(base[0]);
    expect(taiga[2]).toBeGreaterThan(base[2]);
    const swamp = channels(biomeShade('#808080', 4, 0));
    expect(swamp[0]).toBeGreaterThan(base[0]);
    expect(swamp[1]).toBeLessThan(base[1]);
    expect(swamp[2]).toBeLessThan(base[2]);
    const desert = channels(biomeShade('#808080', 2, 0));
    expect(desert[0]).toBeGreaterThan(base[0]);
    expect(desert[1]).toBeGreaterThan(base[1]);
    expect(desert[2]).toBe(base[2]);
    const plains = channels(biomeShade('#808080', 0, 0));
    expect(plains[0]).toBeGreaterThan(base[0]);
    expect(plains[1]).toBeGreaterThan(base[1]);
    expect(plains[2]).toBe(base[2]);
    // Desert is the paler of the two warm tints.
    expect(desert[0] + desert[1]).toBeGreaterThan(plains[0] + plains[1]);
  });

  it('tints grass and forest alike', () => {
    for (const biome of BIOMES)
      for (const css of COLORS) expect(biomeShade(css, biome, 0)).toBe(biomeShade(css, biome, 1));
  });
});
