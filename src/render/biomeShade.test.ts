import { describe, expect, it } from 'vitest';
import type { Rng } from '../engine/rng';
import { forAll, shrinkInt } from '../testing/property';
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

/**
 * The tint each biome adds to a colour's red, green and blue, as a table rather than the
 * function's if-chain. These are the values the move must not change; the biomes missing here
 * (forest, ocean) add nothing.
 */
const TINT: Record<number, readonly [number, number, number]> = {
  0: [18, 14, 0], // plains: warmer
  2: [40, 24, 0], // desert: paler
  3: [-10, 0, 22], // taiga: cooler
  4: [10, -14, -10], // swamp: muddier
};

const DIGITS = '0123456789abcdef';

/**
 * A slow, obvious biomeShade written another way: read the digits one at a time, add the tint
 * per channel, clamp, and write the digits back from a lookup. No regular expression, no
 * toString(16).
 */
function oracle(css: string, biome: number, terrain: number): string {
  if (terrain !== 0 && terrain !== 1) return css;
  if (css.length !== 7 || css[0] !== '#') return css;
  const digits: number[] = [];
  for (let i = 1; i < 7; i++) {
    const d = DIGITS.indexOf(css[i].toLowerCase());
    if (d < 0) return css;
    digits.push(d);
  }
  const delta = TINT[biome] ?? [0, 0, 0];
  let out = '#';
  for (let ch = 0; ch < 3; ch++) {
    const v = Math.min(255, Math.max(0, digits[2 * ch] * 16 + digits[2 * ch + 1] + delta[ch]));
    out += DIGITS[Math.floor(v / 16)] + DIGITS[v % 16];
  }
  return out;
}

/** Channel values where a tint starts or stops clamping, for every delta in the table, +-1. */
const EDGE_CHANNELS: readonly number[] = (() => {
  const edges = new Set([0, 1, 2, 253, 254, 255]);
  for (const t of Object.values(TINT))
    for (const d of t.map(Math.abs).filter((n) => n > 0))
      for (const k of [-1, 0, 1]) {
        edges.add(d + k);
        edges.add(255 - d + k);
      }
  return [...edges].filter((v) => v >= 0 && v <= 255).sort((a, b) => a - b);
})();

/** Seeds 1 to 2000: a case is one colour, terrain and biome, cheap enough to run thousands. */
const MANY_SEEDS: readonly number[] = Array.from({ length: 2000 }, (_, i) => i + 1);

interface Case {
  css: string;
  biome: number;
  terrain: number;
}

const rgb = (css: string) => channels(css);
const fromRgb = (c: readonly number[]) =>
  '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

/** A valid #rrggbb in either case, half its channels drawn from where clamping begins. */
function genCase(rng: Rng): Case {
  const channel = () => {
    const v = rng.chance(0.5) ? rng.pick(EDGE_CHANNELS) : rng.int(0, 255);
    const hex = v.toString(16).padStart(2, '0');
    return rng.chance(0.3) ? hex.toUpperCase() : hex;
  };
  return {
    css: `#${channel()}${channel()}${channel()}`,
    biome: rng.int(0, 5),
    terrain: rng.int(0, 6),
  };
}

/** Simpler terrain and biome first, then each channel toward 0; the colour stays valid. */
function* shrinkCase(c: Case): Iterable<Case> {
  for (const terrain of shrinkInt(c.terrain, 0)) yield { ...c, terrain };
  for (const biome of shrinkInt(c.biome, 0)) yield { ...c, biome };
  const now = rgb(c.css);
  for (let i = 0; i < 3; i++)
    for (const v of shrinkInt(now[i], 0)) {
      const next = [...now];
      next[i] = v;
      yield { ...c, css: fromRgb(next) };
    }
}

describe('biomeShade against an oracle', () => {
  it('gives the oracle answer for any colour, terrain id and biome id', () => {
    forAll(
      genCase,
      ({ css, biome, terrain }) => {
        expect(biomeShade(css, biome, terrain)).toBe(oracle(css, biome, terrain));
      },
      { seeds: MANY_SEEDS, shrink: shrinkCase },
    );
  });

  it('adds the tint to one channel and clamps it, for every value of that channel', () => {
    // The other two channels sit at 0, mid and 255, so a tint on one cannot leak into another.
    const others = [0, 128, 255];
    for (const terrain of SHADED_TERRAINS)
      for (const biome of BIOMES)
        for (let at = 0; at < 3; at++)
          for (const other of others)
            for (let v = 0; v <= 255; v++) {
              const c = [other, other, other];
              c[at] = v;
              const css = fromRgb(c);
              const want = c.map((x, i) => Math.min(255, Math.max(0, x + (TINT[biome]?.[i] ?? 0))));
              expect(
                biomeShade(css, biome, terrain),
                `${css} biome ${biome} terrain ${terrain}`,
              ).toBe(fromRgb(want));
            }
  });

  it('returns a string that is not #rrggbb unchanged, however it is broken', () => {
    // Break a valid colour one way at a time: each result is invalid by construction.
    const breakIt: ((css: string, rng: Rng) => string)[] = [
      (css) => css.slice(1), // no '#'
      (css) => css.slice(0, -1), // a digit short
      (css, rng) => css + rng.pick(['0', 'f', 'F', '#', ' ']), // one too long
      (css, rng) => rng.pick(['0', ' ', '#']) + css, // one too long, at the front
      (css) => css + '\n', // `$` must not match before a trailing newline
      (css) => '\n' + css,
      (css, rng) => {
        const at = rng.int(1, 6);
        return (
          css.slice(0, at) + rng.pick(['g', 'G', 'z', ' ', '-', '+', '.', 'x']) + css.slice(at + 1)
        );
      },
      (css) => `#${css.slice(1, 4)}`, // the #rgb shorthand
      (css) => css.replace('#', '0x'),
      (css) => `rgb(${rgb(css).join(',')})`,
    ];
    forAll(
      (rng) => {
        const { css, biome, terrain } = genCase(rng);
        return { css: rng.pick(breakIt)(css, rng), biome, terrain };
      },
      ({ css, biome, terrain }) => {
        expect(biomeShade(css, biome, terrain)).toBe(css);
      },
      { seeds: MANY_SEEDS, shrink: shrinkCase },
    );
  });

  it('leaves other terrain alone and gives a biome id it does not know the input colour', () => {
    forAll(
      (rng) => ({
        css: genCase(rng).css,
        biome: rng.int(0, 5),
        terrain: rng.chance(0.5) ? rng.int(2, 6) : rng.int(-3, 12),
        stray: rng.pick([-1, 6, 7, 99, 255, 0.5, NaN]),
      }),
      ({ css, biome, terrain, stray }) => {
        const shaded = terrain === 0 || terrain === 1;
        if (!shaded) expect(biomeShade(css, biome, terrain)).toBe(css);
        // On grass and forest an untinted biome still rewrites the digits, so an upper-case input
        // comes back lower-case: the same colour, not the same string.
        for (const t of SHADED_TERRAINS) expect(biomeShade(css, stray, t)).toBe(css.toLowerCase());
      },
      { seeds: MANY_SEEDS },
    );
  });

  it('answers lower-case #rrggbb on grass and forest, whatever the case of the input', () => {
    forAll(
      genCase,
      ({ css, biome }) => {
        for (const terrain of SHADED_TERRAINS)
          expect(biomeShade(css, biome, terrain)).toMatch(/^#[0-9a-f]{6}$/);
      },
      { seeds: MANY_SEEDS, shrink: shrinkCase },
    );
  });
});

describe('biomeShade on the colours the overview and the minimap draw', () => {
  // Worked out by hand from the tint table above (plains +18 +14 +0, desert +40 +24 +0, taiga
  // -10 +0 +22, swamp +10 -14 -10), so a change to a tint shows as a changed pixel colour.
  // [input colour, plains, forest, desert, taiga, swamp, ocean] for terrain grass and forest.
  const DRAWN: [string, string, string, string, string, string, string][] = [
    // minimap grass, forest
    ['#5b7145', '#6d7f45', '#5b7145', '#838945', '#51715b', '#65633b', '#5b7145'],
    ['#3f5231', '#516031', '#3f5231', '#676a31', '#355247', '#494427', '#3f5231'],
    // overview grass, forest
    ['#4e6339', '#607139', '#4e6339', '#767b39', '#44634f', '#58552f', '#4e6339'],
    ['#38492b', '#4a572b', '#38492b', '#60612b', '#2e4941', '#423b21', '#38492b'],
  ];

  it.each(DRAWN)('tints %s as before in every biome', (css, ...byBiome) => {
    for (const terrain of SHADED_TERRAINS)
      byBiome.forEach((want, biome) => {
        expect(biomeShade(css, biome, terrain), `biome ${biome} terrain ${terrain}`).toBe(want);
      });
  });

  it('leaves the overview colours of the other terrains, written rgb(r,g,b), as they are', () => {
    for (const css of ['rgb(132,116,80)', 'rgb(62,110,120)', 'rgb(198,180,136)'])
      for (const terrain of TERRAINS)
        for (const biome of BIOMES) expect(biomeShade(css, biome, terrain)).toBe(css);
  });
});
