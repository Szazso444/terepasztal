import { describe, it, expect } from 'vitest';
import { forAll, shrinkInt } from '../testing/property';
import { emptyMap } from './mapgen';
import { RegionState, regionTierMap } from './regions';
import type { GameMap } from './tiles';

/** Every map size a new game offers (`rules.mapSize`: 32 to 480 in steps of 32), and one between. */
const SIZES = [48, ...Array.from({ length: 15 }, (_, k) => 32 * (k + 1))];

describe('the start chunk', () => {
  it.each(SIZES)('is the one chunk a new %i-tile map owns', (s) => {
    const map = emptyMap(1, s, s);
    const regions = new RegionState(map, 0);
    const start =
      Math.floor((map.regionsY - 1) / 2) * map.regionsX + Math.floor((map.regionsX - 1) / 2);
    expect(regions.ownedCount()).toBe(1);
    expect(regions.unlocked[start]).toBe(true);
  });

  it.each(SIZES)('is ring 0 and every ring is a whole number of chunks (%i tiles)', (s) => {
    const tiers = regionTierMap(emptyMap(1, s, s));
    expect(tiers.filter((t) => t === 0)).toHaveLength(1);
    for (const t of tiers) expect(Number.isInteger(t)).toBe(true);
  });

  it.each(SIZES)('keeps every chunk in its ring when a %i-tile map grows by one ring', (s) => {
    const small = emptyMap(1, s, s);
    const big = emptyMap(1, s + 64, s + 64);
    const before = regionTierMap(small);
    const after = regionTierMap(big);
    before.forEach((t, i) => {
      const rx = (i % small.regionsX) + 1;
      const ry = Math.floor(i / small.regionsX) + 1;
      expect(after[ry * big.regionsX + rx]).toBe(t);
    });
  });
});

// Properties over every grid, against an oracle: the ring of a chunk is the number of king moves
// from the start chunk, found by breadth-first search over the grid.

/** The start chunk's index by the rule mapgen and ensureDepot use: floor((n - 1) / 2) per axis. */
const startIndex = (m: GameMap) =>
  Math.floor((m.regionsY - 1) / 2) * m.regionsX + Math.floor((m.regionsX - 1) / 2);

/** Rings by breadth-first search over the eight neighbours: the slow, obvious way to count them. */
function bfsRings(nx: number, ny: number, start: number): number[] {
  const ring = new Array<number>(nx * ny).fill(-1);
  ring[start] = 0;
  const queue = [start];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % nx;
    const y = Math.floor(i / nx);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx;
        const Y = y + dy;
        if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
        const j = Y * nx + X;
        if (ring[j] < 0) {
          ring[j] = ring[i] + 1;
          queue.push(j);
        }
      }
  }
  return ring;
}

/** Throws, naming the size, unless a new game on `w` x `h` tiles starts as the oracle says. */
function expectStart(w: number, h: number) {
  const map = emptyMap(1, w, h);
  const at = `${w} x ${h} tiles (${map.regionsX} x ${map.regionsY} chunks)`;
  const start = startIndex(map);
  const rings = bfsRings(map.regionsX, map.regionsY, start);
  const fresh = new RegionState(map, 0);
  const owned = fresh.unlocked.flatMap((u, i) => (u ? [i] : []));
  if (owned.length !== 1 || owned[0] !== start)
    throw new Error(`${at}: a new game owns [${owned.join(', ')}], not [${start}]`);
  const tiers = regionTierMap(map);
  if (tiers.join() !== rings.join())
    throw new Error(`${at}: rings ${tiers.join()} where the search finds ${rings.join()}`);
  // every starting tier owns the chunks within that many rings, and applyTier adds the rest
  for (let t = 0; t <= Math.max(...rings); t++) {
    const want = rings.map((r) => r <= t);
    if (new RegionState(map, t).unlocked.join() !== want.join())
      throw new Error(`${at}: starting at tier ${t} owns the wrong chunks`);
    const grow = new RegionState(map, 0);
    const newly = grow.applyTier(t);
    const added = rings.flatMap((r, i) => (r > 0 && r <= t ? [i] : []));
    if (newly.join() !== added.join() || grow.unlocked.join() !== want.join())
      throw new Error(`${at}: applyTier(${t}) added [${newly.join(', ')}]`);
  }
}

describe('chunk rings, against a breadth-first search', () => {
  it('give a new game the start chunk alone on every grid of 1 to 15 chunks a side', () => {
    // Every chunk grid a new game, the editor or an expanded save can reach on a 480-tile map.
    for (let nx = 1; nx <= 15; nx++) for (let ny = 1; ny <= 15; ny++) expectStart(32 * nx, 32 * ny);
  });

  it('do the same on a map of any size, whole chunks or not', () => {
    forAll(
      (rng) => ({ w: rng.int(1, 480), h: rng.int(1, 480) }),
      ({ w, h }) => expectStart(w, h),
      {
        shrink: function* (c) {
          for (const w of shrinkInt(c.w, 1)) yield { ...c, w };
          for (const h of shrinkInt(c.h, 1)) yield { ...c, h };
        },
      },
    );
  });

  it('keep every chunk in its ring, and a new game in its one chunk, as the map grows', () => {
    // expandSave's remap: old chunk (rx, ry) becomes (rx + k, ry + k) after k rings.
    forAll(
      (rng) => ({ w: rng.int(1, 288), h: rng.int(1, 288), k: rng.int(1, 3) }),
      ({ w, h, k }) => {
        const small = emptyMap(1, w, h);
        const big = emptyMap(1, w + 64 * k, h + 64 * k, undefined, -32 * k, -32 * k);
        const at = `${w} x ${h} grown by ${k}`;
        const shifted = (i: number) =>
          (Math.floor(i / small.regionsX) + k) * big.regionsX + (i % small.regionsX) + k;
        const before = regionTierMap(small);
        const after = regionTierMap(big);
        before.forEach((t, i) => {
          if (after[shifted(i)] !== t)
            throw new Error(`${at}: chunk ${i} was ring ${t}, is ring ${after[shifted(i)]}`);
        });
        const owned = new Array<boolean>(after.length).fill(false);
        new RegionState(small, 0).unlocked.forEach((u, i) => {
          if (u) owned[shifted(i)] = true;
        });
        if (owned.join() !== new RegionState(big, 0).unlocked.join())
          throw new Error(`${at}: the remapped start chunk is not the grown map's start chunk`);
      },
      {
        shrink: function* (c) {
          for (const k of shrinkInt(c.k, 1)) yield { ...c, k };
          for (const w of shrinkInt(c.w, 1)) yield { ...c, w };
          for (const h of shrinkInt(c.h, 1)) yield { ...c, h };
        },
      },
    );
  });
});
