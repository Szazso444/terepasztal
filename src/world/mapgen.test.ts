import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateMap, emptyMap, DEFAULT_MAP_PARAMS, type MapGenParams } from './mapgen';
import { Terrain, type GameMap, type PropInstance } from './tiles';
import { Rng, hash2, hashString } from '../engine/rng';
import { setSupplyMode } from '../sim/supply';
import { forAll, shrinkInt } from '../testing/property';

/** Stable FNV-1a over a tile plane, so a generation change shows up as one number. */
function fnv(a: Uint8Array) {
  let h = 2166136261;
  for (let i = 0; i < a.length; i++) {
    h ^= a[i];
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const count = (a: Uint8Array, t: Terrain) => a.reduce((n, v) => n + (v === t ? 1 : 0), 0);

/** One tile's props as text: every field, numbers exact. */
const propText = (list: PropInstance[] | undefined) =>
  (list ?? []).map((p) => `${p.kind},${p.variant},${p.ox},${p.oy}`).join(';');
/** FNV-1a over every tile's props in tile order, so a moved, added or changed prop shows. */
function propHash(m: GameMap) {
  const parts: string[] = [];
  for (let i = 0; i < m.w * m.h; i++)
    if (m.props.has(i)) parts.push(`${i}:${propText(m.props.get(i))}`);
  return hashString(parts.join('|'));
}

/**
 * Tiles of `small` that differ from the same world tiles of `big`, per plane. `big` must contain
 * `small` (its origin at or before small's and its far edge at or after).
 */
function overlapDiff(small: GameMap, big: GameMap) {
  const dx = small.originX - big.originX;
  const dy = small.originY - big.originY;
  const diff = { terrain: 0, biome: 0, variant: 0, props: 0 };
  for (let y = 0; y < small.h; y++)
    for (let x = 0; x < small.w; x++) {
      const i = y * small.w + x;
      const j = (y + dy) * big.w + x + dx;
      if (small.terrain[i] !== big.terrain[j]) diff.terrain++;
      if (small.biome[i] !== big.biome[j]) diff.biome++;
      if (small.variant[i] !== big.variant[j]) diff.variant++;
      if (propText(small.props.get(i)) !== propText(big.props.get(j))) diff.props++;
    }
  return diff;
}
const SAME = { terrain: 0, biome: 0, variant: 0, props: 0 };
/** A generated map of `w` x `w` grown by one ring of 32-tile chunks, as `expandSave` grows it. */
const grown = (seed: number, w: number) =>
  generateMap(seed, { w: w + 64, h: w + 64, originX: -32, originY: -32 });

const SEED = 20260912;
const SMALL = { w: 48, h: 48 };

describe('generateMap', () => {
  it('gives the same world for the same seed', () => {
    const a = generateMap(SEED, SMALL);
    const b = generateMap(SEED, SMALL);
    expect(fnv(a.terrain)).toBe(fnv(b.terrain));
    expect(fnv(a.biome)).toBe(fnv(b.biome));
    expect(fnv(a.variant)).toBe(fnv(b.variant));
    expect(a.props.size).toBe(b.props.size);
  });

  it('gives a different world for a different seed', () => {
    expect(fnv(generateMap(SEED, SMALL).terrain)).not.toBe(
      fnv(generateMap(SEED + 1, SMALL).terrain),
    );
  });

  it('generates the world these numbers describe', () => {
    // A tripwire, not a specification: any deliberate change to map generation invalidates
    // every existing seed, so re-bless these numbers on purpose or not at all.
    const m = generateMap(SEED, SMALL);
    expect(fnv(m.terrain)).toBe(2330203531);
    expect(fnv(m.biome)).toBe(4076181840);
    expect(fnv(m.variant)).toBe(417171169);
    expect(m.props.size).toBe(361);
  });

  it('fills the plane it was asked for', () => {
    const m = generateMap(SEED, SMALL);
    expect(m.w).toBe(SMALL.w);
    expect(m.h).toBe(SMALL.h);
    expect(m.terrain).toHaveLength(SMALL.w * SMALL.h);
    expect(m.biome).toHaveLength(SMALL.w * SMALL.h);
    expect(m.variant).toHaveLength(SMALL.w * SMALL.h);
    expect(m.seed).toBe(SEED);
  });

  it('raises the water line with waterLevel', () => {
    const dry = generateMap(SEED, { ...SMALL, waterLevel: 0.2 });
    const mid = generateMap(SEED, SMALL);
    const wet = generateMap(SEED, { ...SMALL, waterLevel: 0.5 });
    expect(count(dry.terrain, Terrain.Water)).toBeLessThan(count(mid.terrain, Terrain.Water));
    expect(count(mid.terrain, Terrain.Water)).toBeLessThan(count(wet.terrain, Terrain.Water));
  });

  it('thins the forest as forestDensity rises', () => {
    // Despite the name it is a moisture threshold, as the tuning slider says: lower = more
    // forest. Above the default the threshold stops biting and only the forest biome is left,
    // so the count floors rather than falling further.
    const at = (v: number) =>
      count(generateMap(SEED, { ...SMALL, forestDensity: v }).terrain, Terrain.Forest);
    const sweep = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map(at);
    for (let i = 1; i < sweep.length; i++) expect(sweep[i]).toBeLessThanOrEqual(sweep[i - 1]);
    expect(sweep[0]).toBeGreaterThan(sweep[sweep.length - 1]);
  });

  it('defaults to the documented parameters', () => {
    const m = generateMap(SEED);
    expect(m.w).toBe(DEFAULT_MAP_PARAMS.w);
    expect(m.h).toBe(DEFAULT_MAP_PARAMS.h);
  });
});

describe('a grown map', () => {
  const SEEDS = [SEED, 1, 7412, 31337, 987654321];

  it.each(SEEDS)('keeps every old tile when 96 grows to 160 (seed %i)', (seed) => {
    expect(overlapDiff(generateMap(seed, { w: 96, h: 96 }), grown(seed, 96))).toEqual(SAME);
  });

  it.each(SEEDS)('keeps every old tile when 160 grows to 224 (seed %i)', (seed) => {
    expect(overlapDiff(generateMap(seed, { w: 160, h: 160 }), grown(seed, 160))).toEqual(SAME);
  });

  it.each([32, 64, 128])('keeps every old tile when %i grows by a ring', (w) => {
    expect(overlapDiff(generateMap(SEED, { w, h: w }), grown(SEED, w))).toEqual(SAME);
  });

  // In these two worlds a river runs just outside the 32x32 map, never entering it, and still
  // decides a tile on its edge: generation must carve it although no tile of it is the map's.
  it.each([175, 182])('keeps the edge a river just outside it shaped (seed %i)', (seed) => {
    expect(overlapDiff(generateMap(seed, { w: 32, h: 32 }), grown(seed, 32))).toEqual(SAME);
  });

  it('keeps every old tile, oil fields and start seeps included, in the full production chain', () => {
    setSupplyMode('full');
    try {
      const seed = 7412;
      const small = generateMap(seed, { w: 96, h: 96 });
      expect([...small.props.values()].some((l) => l[0].kind === 'oil')).toBe(true);
      expect(overlapDiff(small, grown(seed, 96))).toEqual(SAME);
      expect(overlapDiff(generateMap(seed, { w: 160, h: 160 }), grown(seed, 160))).toEqual(SAME);
    } finally {
      setSupplyMode('simple');
    }
  });

  it('generates the worlds these numbers describe', () => {
    // Tripwires like the one above, at the default map size and that map grown by one ring.
    const m = generateMap(SEED, { w: 160, h: 160 });
    expect([fnv(m.terrain), fnv(m.biome), fnv(m.variant), propHash(m)]).toEqual([
      2688962428, 1335671557, 1813736059, 4170314098,
    ]);
    const g = grown(SEED, 160);
    expect([fnv(g.terrain), fnv(g.biome), fnv(g.variant), propHash(g)]).toEqual([
      814356426, 211014301, 1107381422, 3078554006,
    ]);
  });
});

// Generation in world space, as a property: a tile is a function of its world coordinates, the
// seed, the params, the production chain and where the start chunk lies, never of where the map
// happens to end. expandSave's ring growth is one case of it.

/** emptyMap's chunk edge, in tiles. */
const CHUNK = 32;
/** The start chunk along an axis of `len` tiles: the middle one, the nearer one when even. */
const startChunk = (len: number) => Math.floor((Math.ceil(len / CHUNK) - 1) / 2);

/**
 * One axis of a pair of maps: the small map is `len` tiles long, the big one `big` tiles and it
 * starts `before` whole chunks earlier. Valid when the big map holds the small one, and both put
 * their start chunk on the same world tiles (a map narrower than a chunk clips its start chunk,
 * which no game makes: new games and editor levels are 32 tiles or more).
 */
interface Axis {
  len: number;
  before: number;
  big: number;
}
const validAxis = ({ len, before, big }: Axis) =>
  len >= CHUNK &&
  before >= 0 &&
  big >= CHUNK * before + len &&
  startChunk(big) === startChunk(len) + before;

type SliderParams = Pick<MapGenParams, 'waterLevel' | 'hillLevel' | 'rockLevel' | 'forestDensity'>;
const DEFAULT_SLIDERS: SliderParams = {
  waterLevel: DEFAULT_MAP_PARAMS.waterLevel,
  hillLevel: DEFAULT_MAP_PARAMS.hillLevel,
  rockLevel: DEFAULT_MAP_PARAMS.rockLevel,
  forestDensity: DEFAULT_MAP_PARAMS.forestDensity,
};

/** Two maps of one seed, params and production chain; the small one's origin is any tile. */
interface Pair {
  seed: number;
  full: boolean;
  params: SliderParams;
  ox: number;
  oy: number;
  x: Axis;
  y: Axis;
}

function genAxis(rng: Rng): Axis {
  const len = rng.int(CHUNK, 4 * CHUNK);
  for (;;) {
    const before = rng.int(0, 2);
    const big = CHUNK * before + len + rng.int(0, 2 * CHUNK);
    const a = { len, before, big };
    if (big > len && validAxis(a)) return a;
  }
}

/**
 * Half the pairs grow as a game grows its map: a square of whole chunks, its origin on the chunk
 * grid from earlier growth, gaining one or two rings on every side as expandSave adds them. The
 * other half go beyond that: any sizes and origins, and growth on the sides that keep the start
 * chunk. Params anywhere on their sliders, either production chain.
 */
function genPair(rng: Rng): Pair {
  const seed = rng.int(0, 2 ** 31 - 1);
  const full = rng.chance(0.5);
  const params = {
    waterLevel: rng.int(10, 60) / 100,
    hillLevel: rng.int(45, 90) / 100,
    rockLevel: rng.int(50, 100) / 100,
    forestDensity: rng.int(30, 90) / 100,
  };
  if (rng.chance(0.5)) {
    const len = CHUNK * rng.int(1, 5);
    const ring = rng.int(1, 2);
    const earlier = rng.int(0, 2);
    const at = earlier ? -CHUNK * earlier : 0;
    const axis = { len, before: ring, big: len + 2 * CHUNK * ring };
    return { seed, full, params, ox: at, oy: at, x: axis, y: { ...axis } };
  }
  const ox = rng.int(-4 * CHUNK, 4 * CHUNK);
  const oy = rng.int(-4 * CHUNK, 4 * CHUNK);
  return { seed, full, params, ox, oy, x: genAxis(rng), y: genAxis(rng) };
}

/** A pair shaped as expandSave grows a game's map. */
const ringGrowth = (c: Pair) =>
  c.ox % CHUNK === 0 &&
  c.ox === c.oy &&
  c.x.len === c.y.len &&
  c.x.len % CHUNK === 0 &&
  c.x.before === c.y.before &&
  c.x.big === c.x.len + 2 * CHUNK * c.x.before &&
  c.y.big === c.x.big;

function* shrinkAxis(a: Axis): Iterable<Axis> {
  if (a.before > 0) yield { ...a, before: a.before - 1, big: a.big - CHUNK };
  for (const len of shrinkInt(a.len, CHUNK)) yield { ...a, len, big: a.big - (a.len - len) };
  for (const big of shrinkInt(a.big, CHUNK * a.before + a.len)) yield { ...a, big };
}

/** Toward the simple chain, default params, origin 0 and the least growth that still differs. */
function* shrinkPair(p: Pair): Iterable<Pair> {
  const candidates = function* (): Iterable<Pair> {
    if (p.full) yield { ...p, full: false };
    if (JSON.stringify(p.params) !== JSON.stringify(DEFAULT_SLIDERS))
      yield { ...p, params: DEFAULT_SLIDERS };
    for (const ox of shrinkInt(p.ox)) yield { ...p, ox };
    for (const oy of shrinkInt(p.oy)) yield { ...p, oy };
    for (const x of shrinkAxis(p.x)) yield { ...p, x };
    for (const y of shrinkAxis(p.y)) yield { ...p, y };
  };
  for (const c of candidates())
    if (validAxis(c.x) && validAxis(c.y) && (c.x.big > c.x.len || c.y.big > c.y.len)) yield c;
}

/** The pair's two maps, generated in its production chain. */
function pairMaps(c: Pair) {
  setSupplyMode(c.full ? 'full' : 'simple');
  try {
    const small = generateMap(c.seed, {
      ...c.params,
      w: c.x.len,
      h: c.y.len,
      originX: c.ox,
      originY: c.oy,
    });
    const big = generateMap(c.seed, {
      ...c.params,
      w: c.x.big,
      h: c.y.big,
      originX: c.ox - CHUNK * c.x.before,
      originY: c.oy - CHUNK * c.y.before,
    });
    return { small, big };
  } finally {
    setSupplyMode('simple');
  }
}

/** Whether two tiles' props have the same text; field by field first, so text is rarely built. */
const sameProps = (a: PropInstance[] | undefined, b: PropInstance[] | undefined) =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.length === b.length &&
    a.every(
      (p, k) =>
        p.kind === b[k].kind && p.variant === b[k].variant && p.ox === b[k].ox && p.oy === b[k].oy,
    )) ||
  propText(a) === propText(b);

/** The first tile of `small`, in tile order, that differs from `big`; null when none does. */
function firstDifference(small: GameMap, big: GameMap): string | null {
  const dx = small.originX - big.originX;
  const dy = small.originY - big.originY;
  for (let y = 0; y < small.h; y++)
    for (let x = 0; x < small.w; x++) {
      const i = y * small.w + x;
      const j = (y + dy) * big.w + x + dx;
      if (
        small.terrain[i] === big.terrain[j] &&
        small.biome[i] === big.biome[j] &&
        small.variant[i] === big.variant[j] &&
        sameProps(small.props.get(i), big.props.get(j))
      )
        continue;
      const planes: [string, string, string][] = [
        ['terrain', String(small.terrain[i]), String(big.terrain[j])],
        ['biome', String(small.biome[i]), String(big.biome[j])],
        ['variant', String(small.variant[i]), String(big.variant[j])],
        ['props', propText(small.props.get(i)), propText(big.props.get(j))],
      ];
      for (const [plane, a, b] of planes)
        if (a !== b)
          return `${plane} at world tile (${x + small.originX}, ${y + small.originY}): small "${a}", big "${b}"`;
    }
  return null;
}

/** Fixed seeds for the pair property: each case generates two maps, so it runs fewer than SEEDS. */
const PAIR_SEEDS = Array.from({ length: 16 }, (_, i) => i + 1);

describe('generation in world space', () => {
  beforeEach(() => setSupplyMode('simple'));
  afterEach(() => setSupplyMode('simple'));

  it('draws pairs of every kind the property claims', () => {
    // The generator, checked: without this a narrowed generator would pass the property vacuously.
    const cases = PAIR_SEEDS.map((s) => genPair(new Rng(s)));
    const axes = cases.flatMap((c) => [c.x, c.y]);
    for (const game of [true, false])
      for (const full of [true, false])
        expect(cases.some((c) => ringGrowth(c) === game && c.full === full)).toBe(true);
    expect(cases.some((c) => ringGrowth(c) && c.x.before === 2 && c.ox < 0)).toBe(true);
    expect(axes.some((a) => a.len % CHUNK !== 0)).toBe(true);
    expect(axes.some((a) => a.before === 0)).toBe(true);
    expect(axes.some((a) => a.before === 2)).toBe(true);
    // the big map reaches further after the small one than before it
    expect(axes.some((a) => a.big - a.len - CHUNK * a.before > CHUNK * a.before)).toBe(true);
    expect(cases.some((c) => c.ox % CHUNK !== 0 && c.oy % CHUNK !== 0)).toBe(true);
  });

  // 32 maps up to 288 tiles a side: about 4 s at a load average of 40 on 4 cores, and a failure
  // shrinks through up to 60 more pairs, so the timeout leaves room for both on a busier machine
  it('gives two maps with one seed, params and start chunk the same tiles where they overlap', () => {
    let oil = 0;
    forAll(
      genPair,
      (c) => {
        const { small, big } = pairMaps(c);
        if (c.full) for (const list of small.props.values()) if (list[0].kind === 'oil') oil++;
        const where = firstDifference(small, big);
        if (where) throw new Error(`${JSON.stringify(overlapDiff(small, big))}; first ${where}`);
      },
      { seeds: PAIR_SEEDS, shrink: shrinkPair, shrinkBudget: 60 },
    );
    // the full chain's own passes (oil fields, start seeps) ran in some case
    expect(oil).toBeGreaterThan(0);
  }, 60_000);
});

describe('emptyMap', () => {
  it('hashes the variant plane on world coordinates', () => {
    const small = emptyMap(7, 16, 16, Terrain.Grass, -4, 3);
    const big = emptyMap(7, 40, 40, Terrain.Grass, -20, -20);
    expect(overlapDiff(small, big).variant).toBe(0);
  });

  it('gives each tile the variant of its world tile, hash2(x + originX, y + originY, seed)', () => {
    // At origin 0 this is the plane every earlier version drew, hash2(x, y, seed).
    forAll(
      (rng) => ({
        seed: rng.int(0, 2 ** 31 - 1),
        w: rng.int(1, 48),
        h: rng.int(1, 48),
        ox: rng.chance(0.25) ? 0 : rng.int(-300, 300),
        oy: rng.chance(0.25) ? 0 : rng.int(-300, 300),
      }),
      ({ seed, w, h, ox, oy }) => {
        const m = emptyMap(seed, w, h, Terrain.Grass, ox, oy);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const want = Math.floor(hash2(x + ox, y + oy, seed) * 4);
            const got = m.variant[y * w + x];
            if (got !== want) throw new Error(`tile (${x}, ${y}) has variant ${got}, not ${want}`);
          }
      },
      {
        shrink: function* (c) {
          for (const w of shrinkInt(c.w, 1)) yield { ...c, w };
          for (const h of shrinkInt(c.h, 1)) yield { ...c, h };
          for (const ox of shrinkInt(c.ox)) yield { ...c, ox };
          for (const oy of shrinkInt(c.oy)) yield { ...c, oy };
        },
      },
    );
  });

  it('is the variant plane generateMap keeps', () => {
    forAll(
      (rng) => ({
        seed: rng.int(0, 2 ** 31 - 1),
        w: rng.int(32, 64),
        h: rng.int(32, 64),
        ox: rng.int(-100, 100),
        oy: rng.int(-100, 100),
      }),
      ({ seed, w, h, ox, oy }) => {
        const m = generateMap(seed, { w, h, originX: ox, originY: oy });
        expect(m.variant).toEqual(emptyMap(seed, w, h, Terrain.Grass, ox, oy).variant);
      },
      { seeds: PAIR_SEEDS.slice(0, 8) },
    );
  });

  it('is one terrain, no props, and remembers where it starts', () => {
    const m = emptyMap(7, 10, 12, Terrain.Sand, -4, 5);
    expect(m.terrain).toHaveLength(120);
    expect([...new Set(m.terrain)]).toEqual([Terrain.Sand]);
    expect(m.props.size).toBe(0);
    expect(m.originX).toBe(-4);
    expect(m.originY).toBe(5);
    expect(m.seed).toBe(7);
  });

  it('covers every tile with regions', () => {
    const m = emptyMap(1, 40, 24);
    expect(m.regionsX * m.regionSize).toBeGreaterThanOrEqual(m.w);
    expect(m.regionsY * m.regionSize).toBeGreaterThanOrEqual(m.h);
  });
});
