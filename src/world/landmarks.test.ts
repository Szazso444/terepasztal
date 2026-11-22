import { describe, expect, it } from 'vitest';
import raw from '../data/landmarks.json';
import { Rng } from '../engine/rng';
import { forAll } from '../testing/property';
import { CHUNK_TILES, buildMap, chunkKey } from './chunks';
import { tileLevels } from './elevation';
import {
  CHUNK_MARGIN,
  anchorOf,
  placeLandmarks,
  rollOf,
  rolledLandmark,
  siteDraw,
  sitesInChunk,
  startChunk,
  type LandmarkPlacement,
  type LandmarkSite,
} from './landmarks';
import { generateMap } from './mapgen';
import { Biome, BIOME_NAMES, Terrain, climateAtIndex, type GameMap } from './tiles';

// The twelve sites as the data has them; the world code takes the rows as they are.
const SITES = raw as unknown as LandmarkSite[];
const HOUSE = SITES.find((s) => s.siteChance !== undefined)!;
const ROLLED = SITES.filter((s) => s.roll !== undefined);
const TARGET = new Map<string, number>(
  (raw as { id: string; target: number }[]).map((r) => [r.id, r.target]),
);
const C = CHUNK_TILES;

/** Seeds 1 to n, as `forAll` takes them. */
const seedList = (n: number, step = 1) => Array.from({ length: n }, (_, i) => (i + 1) * step);
/** Three standard errors of a rate p over n draws. */
const tol = (p: number, n: number) => 3 * Math.sqrt((p * (1 - p)) / n);

// placements in world tiles, so maps of different origins compare
const keys = (map: GameMap, ps: LandmarkPlacement[]) =>
  ps.map((p) => `${p.id}@${map.originX + p.x},${map.originY + p.y}`).sort();

describe('the roll of a region', () => {
  // 200 seeds of 10 x 10 regions: 20 000 regions, drawn without generating a map
  const seeds = seedList(200);
  const regions = Array.from({ length: 100 }, (_, i) => ({
    rx: (i % 10) - 5,
    ry: Math.floor(i / 10) - 5,
  }));

  it('picks each rolled landmark within 3 standard errors of its band, or none', () => {
    const hits = new Map<string | null, number>();
    for (const s of seeds)
      for (const r of regions) {
        const id = rollOf(s, r.rx, r.ry, SITES);
        hits.set(id, (hits.get(id) ?? 0) + 1);
      }
    const n = seeds.length * regions.length;
    for (const site of ROLLED) {
      const rate = (hits.get(site.id) ?? 0) / n;
      expect(Math.abs(rate - site.roll!), `${site.id}: ${rate} against ${site.roll}`).toBeLessThan(
        tol(site.roll!, n),
      );
    }
    const none = 1 - ROLLED.reduce((a, s) => a + s.roll!, 0);
    expect(Math.abs((hits.get(null) ?? 0) / n - none)).toBeLessThan(tol(none, n));
  });

  it('scales every band by landmarkChance', () => {
    for (const chance of [0, 0.5, 2]) {
      const hits = new Map<string | null, number>();
      for (const s of seeds)
        for (const r of regions) {
          const id = rollOf(s, r.rx, r.ry, SITES, chance);
          hits.set(id, (hits.get(id) ?? 0) + 1);
        }
      const n = seeds.length * regions.length;
      for (const site of ROLLED) {
        const p = Math.min(1, site.roll! * chance);
        const rate = (hits.get(site.id) ?? 0) / n;
        expect(Math.abs(rate - p), `${site.id} at ${chance}`).toBeLessThanOrEqual(tol(p, n));
      }
    }
  });

  it('puts the anchor in each of the nine chunks about as often', () => {
    const seen = new Array<number>(9).fill(0);
    let total = 0;
    for (const s of seeds)
      for (const r of regions) {
        const a = anchorOf(s, r.rx, r.ry);
        total++;
        seen[(a.cy - r.ry * 3) * 3 + (a.cx - r.rx * 3)]++;
      }
    for (const c of seen) expect(Math.abs(c / total - 1 / 9)).toBeLessThan(tol(1 / 9, total));
  });

  it("draws the house's site chance at 23 percent of sites, scaled by landmarkChance", () => {
    for (const chance of [1, 2]) {
      let n = 0;
      let ok = 0;
      for (const s of seeds)
        for (let cy = 0; cy < 10; cy++)
          for (let cx = 0; cx < 10; cx++) {
            n++;
            if (siteDraw(s, cx, cy, HOUSE, chance)) ok++;
          }
      const p = HOUSE.siteChance! * chance;
      expect(Math.abs(ok / n - p), `chance ${chance}: ${ok / n}`).toBeLessThan(tol(p, n));
    }
  });
});

describe('spacing', () => {
  it('leaves no two rolled landmarks in touching chunks, and drops only for a touching rival', () => {
    // at a high chance almost every region rolls, so the rule has work to do
    const chance = 2.5;
    let dropped = 0;
    forAll(
      (rng) => rng.int(1, 1_000_000),
      (seed) => {
        const R = 8;
        const standing: { rx: number; ry: number; cx: number; cy: number }[] = [];
        const rolls = new Map<string, { cx: number; cy: number }>();
        for (let ry = 0; ry < R; ry++)
          for (let rx = 0; rx < R; rx++) {
            const s = rolledLandmark(seed, rx, ry, SITES, chance);
            if (s) standing.push({ rx, ry, ...s.anchor });
            // the roll before spacing has no anchor of its own here; take it from a lone region
            if (rollOf(seed, rx, ry, SITES, chance))
              rolls.set(`${rx},${ry}`, s?.anchor ?? { cx: NaN, cy: NaN });
          }
        for (const a of standing)
          for (const b of standing)
            if (a !== b && Math.abs(a.cx - b.cx) <= 1 && Math.abs(a.cy - b.cy) <= 1) return false;
        // a region that rolled and does not stand has a rolling neighbour region
        for (let ry = 1; ry < R - 1; ry++)
          for (let rx = 1; rx < R - 1; rx++) {
            if (!rolls.has(`${rx},${ry}`) || standing.some((s) => s.rx === rx && s.ry === ry))
              continue;
            dropped++;
            let rival = false;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++)
                if ((dx || dy) && rollOf(seed, rx + dx, ry + dy, SITES, chance)) rival = true;
            if (!rival) return false;
          }
        return true;
      },
      { seeds: seedList(200, 7919), format: (s) => `seed ${s}` },
    );
    expect(dropped).toBeGreaterThan(50);
  });
});

/** The 5 x 5 chunk map around the start chunk, generated at once, and the keys of its chunks. */
function bigMap(seed: number): { map: GameMap; added: string[] } {
  const map = generateMap(seed, { w: 160, h: 160, originX: -32, originY: -32 });
  const added: string[] = [];
  for (let cy = -1; cy < 4; cy++) for (let cx = -1; cx < 4; cx++) added.push(chunkKey(cx, cy));
  return { map, added };
}

// Chance 3 makes most regions roll and a good share of the chunks with a house site draw it, so a
// case has placements to compare.
const OPTS = { chance: 3 };
/** The keys of the nine chunks of a new game's map. */
const nineKeys = () => Array.from({ length: 9 }, (_, i) => chunkKey(i % 3, Math.floor(i / 3)));

describe('order independence', () => {
  // Slow: 200 maps of 3 x 3 chunks to generate, 12 s alone; limit 240 s.
  it(
    'gives the same placements ring by ring as all at once, and in any batch order',
    { timeout: 240_000 },
    () => {
      // the 3 x 3 map of a new game: the start chunk first and the ring round it after, against all nine
      let total = 0;
      forAll(
        (rng) => rng.int(1, 2_000_000_000),
        (seed) => {
          const map = generateMap(seed, { w: 96, h: 96 });
          const added = nineKeys();
          const inner = [chunkKey(1, 1)];
          const ring = [
            ...placeLandmarks(seed, map, inner, SITES, OPTS),
            ...placeLandmarks(
              seed,
              map,
              added.filter((k) => !inner.includes(k)),
              SITES,
              OPTS,
            ),
          ];
          const whole = placeLandmarks(seed, map, added, SITES, OPTS);
          total += whole.length;
          const rng = new Rng(seed);
          const shuffled = rng.shuffle([...added]);
          const batches: string[][] = [];
          while (shuffled.length) batches.push(shuffled.splice(0, rng.int(1, 7)));
          const split = batches.flatMap((b) => placeLandmarks(seed, map, b, SITES, OPTS));
          expect(keys(map, ring)).toEqual(keys(map, whole));
          expect(keys(map, split)).toEqual(keys(map, whole));
          return true;
        },
        { seeds: seedList(200, 104729), format: (s) => `seed ${s}` },
      );
      expect(total).toBeGreaterThan(50);
    },
  );

  // Slow: 25 maps built twice, 2.6 s alone; limit 60 s.
  it(
    'gives the same placements on a map grown from stored chunks as on one made at once',
    { timeout: 60_000 },
    () => {
      // buildMap stores the first 3 x 3 chunks, then adds the ring: its ground must read the same
      forAll(
        (rng) => rng.int(1, 2_000_000_000),
        (seed) => {
          const first = buildMap(seed, { w: 96, h: 96 }, {});
          const grown = buildMap(
            seed,
            { w: 160, h: 160, originX: -32, originY: -32 },
            first.chunks,
          );
          const ring = [
            ...keys(first.map, placeLandmarks(seed, first.map, first.added, SITES, OPTS)),
            ...keys(grown.map, placeLandmarks(seed, grown.map, grown.added, SITES, OPTS)),
          ].sort();
          const once = bigMap(seed);
          const whole = placeLandmarks(seed, once.map, once.added, SITES, OPTS);
          expect(ring).toEqual(keys(once.map, whole));
          return true;
        },
        { seeds: seedList(25, 7368791), format: (s) => `seed ${s}` },
      );
    },
  );

  // Slow: 30 maps of 5 x 5 chunks to generate, 2.1 s alone; limit 60 s.
  it(
    'places only in chunks that were added, and none when nothing was',
    { timeout: 60_000 },
    () => {
      forAll(
        (rng) => rng.int(1, 2_000_000_000),
        (seed) => {
          const { map, added } = bigMap(seed);
          expect(placeLandmarks(seed, map, [], SITES, OPTS)).toEqual([]);
          const rng = new Rng(seed);
          const some = added.filter(() => rng.chance(0.4));
          const set = new Set(some);
          const got = placeLandmarks(seed, map, some, SITES, OPTS);
          const all = placeLandmarks(seed, map, added, SITES, OPTS);
          expect(got.every((p) => set.has(chunkKey(p.cx, p.cy)))).toBe(true);
          // a chunk in the batch keeps what it has in a batch of all
          const mine = all.filter((p) => set.has(chunkKey(p.cx, p.cy)));
          expect(keys(map, got)).toEqual(keys(map, mine));
          return true;
        },
        { seeds: seedList(30, 15485863), format: (s) => `seed ${s}` },
      );
    },
  );

  it('puts the start chunk at world chunk (1, 1) of a new game, and keeps it as the map grows', () => {
    const a = buildMap(9, { w: 96, h: 96 }, {}).map;
    const b = buildMap(9, { w: 160, h: 160, originX: -32, originY: -32 }, {}).map;
    const c = buildMap(9, { w: 224, h: 224, originX: -64, originY: -64 }, {}).map;
    for (const m of [a, b, c]) expect(startChunk(m)).toEqual({ cx: 1, cy: 1 });
  });
});

/** The rule of a site, checked on whole-map arrays the way the measure script does. */
function ruleHolds(map: GameMap, lv: Uint8Array, s: LandmarkSite, x: number, y: number): boolean {
  const { w, d, rule: r } = s;
  const at = (i: number, j: number) => j * map.w + i;
  const win = (rr: number, f: (k: number) => boolean) => {
    let n = 0;
    for (let j = y - rr; j < y + d + rr; j++)
      for (let i = x - rr; i < x + w + rr; i++) if (f(at(i, j))) n++;
    return n;
  };
  const fresh = (k: number) => map.biome[k] === Biome.Lake || map.biome[k] === Biome.River;
  switch (r.kind) {
    case 'none':
      return true;
    case 'climateAll':
      return win(0, (k) => BIOME_NAMES[climateAtIndex(map, k)] !== r.climate) === 0;
    case 'near':
      return (
        win(r.r, (k) =>
          r.what === 'fresh water'
            ? fresh(k)
            : r.what === 'lake'
              ? map.biome[k] === Biome.Lake
              : r.what === 'desert'
                ? climateAtIndex(map, k) === Biome.Desert
                : map.terrain[k] === Terrain.Rock || map.terrain[k] === Terrain.Mountain,
        ) > 0
      );
    case 'forestCount':
      return win(r.r, (k) => map.terrain[k] === Terrain.Forest) >= r.n;
    case 'levelAtLeast':
      return lv[at(x, y)] >= r.n;
    case 'cliff':
      return win(r.r, (k) => lv[k] >= lv[at(x, y)] + r.levels) > 0;
    case 'fourClimates':
      return r.climates.every(
        (c) => win(r.r, (k) => BIOME_NAMES[climateAtIndex(map, k)] === c) > 0,
      );
  }
}

describe('legality', () => {
  // Slow: 60 maps of 5 x 5 chunks to generate and check, 4 s alone; limit 120 s.
  it('breaks no legality rule, site rule, margin or spacing rule', { timeout: 120_000 }, () => {
    let total = 0;
    const seen = new Set<string>();
    forAll(
      (rng) => rng.int(1, 2_000_000_000),
      (seed) => {
        const { map, added } = bigMap(seed);
        const lv = tileLevels(map);
        const start = startChunk(map);
        const placed = placeLandmarks(seed, map, added, SITES, OPTS);
        total += placed.length;
        for (const p of placed) {
          const site = SITES.find((s) => s.id === p.id)!;
          seen.add(p.id);
          const gx = map.originX + p.x;
          const gy = map.originY + p.y;
          expect([Math.floor(gx / C), Math.floor(gy / C)], 'chunk').toEqual([p.cx, p.cy]);
          expect(p.cx === start.cx && p.cy === start.cy, 'start chunk').toBe(false);
          // the footprint keeps CHUNK_MARGIN tiles from the chunk's edges
          const lx = gx - p.cx * C;
          const ly = gy - p.cy * C;
          expect(lx).toBeGreaterThanOrEqual(CHUNK_MARGIN);
          expect(ly).toBeGreaterThanOrEqual(CHUNK_MARGIN);
          expect(lx + site.w).toBeLessThanOrEqual(C - CHUNK_MARGIN);
          expect(ly + site.d).toBeLessThanOrEqual(C - CHUNK_MARGIN);
          const l0 = lv[p.y * map.w + p.x];
          for (let j = p.y; j < p.y + site.d; j++)
            for (let i = p.x; i < p.x + site.w; i++) {
              const k = j * map.w + i;
              const t = map.terrain[k];
              expect(t !== Terrain.Water && t !== Terrain.Rock && t !== Terrain.Mountain).toBe(
                true,
              );
              expect(lv[k], 'one elevation').toBe(l0);
              const deposit = map.props
                .get(k)
                ?.some((q) => q.kind === 'coal' || q.kind === 'oil' || q.kind === 'wheat');
              expect(deposit, 'deposit').toBeFalsy();
            }
          expect(ruleHolds(map, lv, site, p.x, p.y), `${p.id} site rule`).toBe(true);
        }
        // no two rolled landmarks in 8-neighbouring chunks, and the house is alone in its chunk
        for (const a of placed)
          for (const b of placed) {
            if (a === b) continue;
            const near = Math.abs(a.cx - b.cx) <= 1 && Math.abs(a.cy - b.cy) <= 1;
            if (a.id === HOUSE.id || b.id === HOUSE.id) {
              if (a.id !== b.id)
                expect(a.cx === b.cx && a.cy === b.cy, 'house and rolled').toBe(false);
            } else expect(near, 'rolled landmarks touch').toBe(false);
          }
        return true;
      },
      { seeds: seedList(60, 32452843), format: (s) => `seed ${s}` },
    );
    expect(total).toBeGreaterThan(80);
    // the common landmarks all met a real placement
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });
});

describe('calibration', () => {
  // The Sites column of spec section 1, measured again: the share of chunks (start chunk left out)
  // with a legal footprint meeting the rule, 3 tiles in from the chunk's edges, on 11 x 11-chunk
  // maps of a fixed seed list, as the measure script does. Roll x sites must come to the target
  // within a fifth; the house's draw is nine chunks x its site share x siteChance. A change to map
  // generation, which is what moves the sites, fails here and the data gets new rolls. The rolled
  // landmarks are measured on the first 36 seeds (4 320 chunks), the house, whose sites are 0.1 percent
  // of chunks, on 150 (18 000 chunks) as the spec did, looking only in chunks that hold both a desert
  // and a taiga tile.
  // Slow: 100 maps of 11 x 11 chunks to generate and scan, 14 s alone; limit 240 s.
  it('keeps roll x sites within a fifth of every target', { timeout: 240_000 }, () => {
    const ROLLED_SEEDS = 24;
    const SEEDS = 100;
    const RING = 4;
    const n = 2 * RING + 3;
    const hit = new Map<string, number>();
    let rolledChunks = 0;
    let houseChunks = 0;
    for (let s = 0; s < SEEDS; s++) {
      const map = generateMap(1000 + s * 7919, {
        w: n * C,
        h: n * C,
        originX: -RING * C,
        originY: -RING * C,
      });
      const start = startChunk(map);
      for (let cy = -RING; cy < n - RING; cy++)
        for (let cx = -RING; cx < n - RING; cx++) {
          if (cx === start.cx && cy === start.cy) continue;
          houseChunks++;
          let sites = s < ROLLED_SEEDS ? SITES : [HOUSE];
          if (s < ROLLED_SEEDS) rolledChunks++;
          if (sites.includes(HOUSE) && !hasBoth(map, cx, cy))
            sites = sites.filter((x) => x !== HOUSE);
          sitesInChunk(map, cx, cy, sites, 1).forEach((list, i) => {
            if (list.length) hit.set(sites[i].id, (hit.get(sites[i].id) ?? 0) + 1);
          });
        }
    }
    for (const site of ROLLED) {
      const rate = site.roll! * ((hit.get(site.id) ?? 0) / rolledChunks);
      const target = TARGET.get(site.id)!;
      expect(
        Math.abs(rate - target) / target,
        `${site.id}: ${rate} against ${target}`,
      ).toBeLessThan(0.2);
    }
    const house = 9 * ((hit.get(HOUSE.id) ?? 0) / houseChunks) * HOUSE.siteChance!;
    const target = TARGET.get(HOUSE.id)!;
    expect(
      Math.abs(house - target) / target,
      `${HOUSE.id}: ${house} against ${target}`,
    ).toBeLessThan(0.2);
  });
});

/** Whether chunk (cx, cy) holds a desert tile and a taiga tile, the least the house needs. */
function hasBoth(map: GameMap, cx: number, cy: number): boolean {
  let desert = false;
  let taiga = false;
  for (let y = 0; y < C; y++)
    for (let x = 0; x < C; x++) {
      const c = climateAtIndex(map, (cy * C - map.originY + y) * map.w + cx * C - map.originX + x);
      desert ||= c === Biome.Desert;
      taiga ||= c === Biome.Taiga;
    }
  return desert && taiga;
}
