import { describe, it, expect } from 'vitest';
import { MAX_LEVEL, NO_LEVEL, levelAt, maxStep, tileLevels, type Elevated } from './elevation';
import { reshape } from './reshape';
import { Terrain } from './tiles';
import { forAll } from '../testing/property';

const none = () => false;
const zero = () => 0;

/** A map of w x h Grass tiles whose ground level plane holds the given levels, 0 where none. */
function grassMap(w: number, h: number, levels?: Uint8Array): Elevated {
  return {
    w,
    h,
    terrain: new Uint8Array(w * h).fill(Terrain.Grass),
    groundLevel: levels ?? new Uint8Array(w * h),
  };
}

/** Runs reshape on the map's own levels and, when nothing refuses, writes its result into the plane. */
function act(
  map: Elevated,
  tiles: [number, number][],
  delta: 1 | -1,
  fixed: (x: number, y: number) => boolean = none,
  least: (x: number, y: number) => number = zero,
) {
  const result = reshape(
    map,
    tileLevels(map),
    tiles.map(([x, y]) => ({ x, y })),
    delta,
    fixed,
    least,
  );
  map.groundLevel ??= new Uint8Array(map.w * map.h).fill(NO_LEVEL);
  for (const { x, y, to } of result.moved) map.groundLevel[y * map.w + x] = to;
  return result;
}

/** The levels of a row of the map. */
function row(map: Elevated, y: number, from: number, to: number) {
  const levels = tileLevels(map);
  return [...levels.slice(y * map.w + from, y * map.w + to + 1)];
}

/** What the writes of a result make of the levels they were made from. */
function applied(levels: Uint8Array, moved: { x: number; y: number; to: number }[], w: number) {
  const next = Uint8Array.from(levels);
  for (const { x, y, to } of moved) next[y * w + x] = to;
  return next;
}

describe('reshape', () => {
  it('a raise lifts the neighbours one level short of it', () => {
    const map = grassMap(9, 9);
    act(map, [[4, 4]], 1);
    expect(row(map, 4, 2, 6)).toEqual([0, 0, 1, 0, 0]);
    act(map, [[4, 4]], 1);
    const second = act(map, [[4, 4]], 1);
    expect(row(map, 4, 0, 8)).toEqual([0, 0, 1, 2, 3, 2, 1, 0, 0]);
    expect(second.moved.map(({ x, y, to }) => [x, y, to]).sort()).toEqual(
      [
        [4, 4, 3],
        [3, 4, 2],
        [5, 4, 2],
        [4, 3, 2],
        [4, 5, 2],
        [3, 3, 1],
        [5, 3, 1],
        [3, 5, 1],
        [5, 5, 1],
        [2, 4, 1],
        [6, 4, 1],
        [4, 2, 1],
        [4, 6, 1],
      ].sort(),
    );
  });

  it('a lower takes them down', () => {
    const map = grassMap(9, 9);
    for (let i = 0; i < 3; i++) act(map, [[4, 4]], 1);
    // the foot of the mound goes down one: the tile beside it is now two short of the top
    const result = act(map, [[5, 4]], -1);
    expect(result.moved).toEqual([
      { x: 4, y: 4, to: 2 },
      { x: 5, y: 4, to: 1 },
    ]);
    expect(row(map, 4, 2, 6)).toEqual([1, 2, 2, 1, 1]);
  });

  it('a step that was 4 stays, and a new step is at most 1', () => {
    const w = 12,
      raw = new Uint8Array(w * w);
    for (let i = 0; i < w * w; i++) raw[i] = i % w >= 6 ? 4 : 0;
    const generatedLevel = tileLevels({
      w,
      h: w,
      terrain: new Uint8Array(w * w),
      generatedLevel: raw,
    });
    const map: Elevated = { w, h: w, terrain: new Uint8Array(w * w), generatedLevel };
    expect(row(map, 5, 4, 7)).toEqual([0, 0, 4, 4]);
    // the high side of the cliff goes up: the low side comes up with it and the cliff stays 4
    const raise = act(map, [[6, 5]], 1);
    expect(raise.moved).toEqual([
      { x: 5, y: 5, to: 1 },
      { x: 6, y: 5, to: 5 },
    ]);
    expect(row(map, 5, 3, 7)).toEqual([0, 0, 1, 5, 4]);
    // a raise beside the foot of the cliff moves nothing else
    expect(act(map, [[4, 5]], 1).moved).toEqual([{ x: 4, y: 5, to: 1 }]);
    // the foot of the cliff goes back down: the top follows, to a step of 4 again
    const lower = act(map, [[5, 5]], -1);
    expect(lower.moved).toEqual([
      { x: 5, y: 5, to: 0 },
      { x: 6, y: 5, to: 4 },
    ]);
  });

  it('a fixed tile that must move refuses the whole action', () => {
    const map = grassMap(9, 9);
    for (let i = 0; i < 2; i++) act(map, [[4, 4]], 1);
    const before = [...tileLevels(map)];
    // the third raise would lift (5, 4), which is fixed
    const refused = act(map, [[4, 4]], 1, (x, y) => x === 5 && y === 4);
    expect(refused.moved).toEqual([]);
    expect(refused.refused).toEqual([{ x: 5, y: 4 }]);
    expect([...tileLevels(map)]).toEqual(before);
    // a fixed tile the slope does not reach does not matter
    expect(act(map, [[4, 4]], 1, (x, y) => x === 7 && y === 4).refused).toEqual([]);
    // a fixed tile that is asked for refuses
    expect(act(map, [[2, 2]], 1, (x, y) => x === 2 && y === 2).refused).toEqual([{ x: 2, y: 2 }]);
  });

  it('refuses at the top of 16 and the bottom of 0, and above 1 on the border', () => {
    const w = 11,
      terrain = new Uint8Array(w * w),
      raw = new Uint8Array(w * w);
    raw.fill(MAX_LEVEL);
    const generatedLevel = tileLevels({ w, h: w, terrain, generatedLevel: raw });
    const map: Elevated = { w, h: w, terrain, generatedLevel };
    expect(generatedLevel[5 * w + 5]).toBe(MAX_LEVEL);
    expect(act(map, [[5, 5]], 1).refused).toEqual([{ x: 5, y: 5 }]);
    const flat = grassMap(9, 9);
    expect(act(flat, [[4, 4]], -1).refused).toEqual([{ x: 4, y: 4 }]);
    expect(act(flat, [[0, 3]], 1).moved).toEqual([{ x: 0, y: 3, to: 1 }]);
    expect(act(flat, [[0, 3]], 1).refused).toEqual([{ x: 0, y: 3 }]);
    // a raise that would lift the border above 1 refuses on the border tile
    const inner = grassMap(9, 9);
    act(inner, [[1, 3]], 1);
    const second = act(inner, [[1, 3]], 1).moved;
    expect(second).toContainEqual({ x: 0, y: 3, to: 1 });
    expect(second).toContainEqual({ x: 1, y: 3, to: 2 });
    expect(act(inner, [[1, 3]], 1).refused).toEqual([{ x: 0, y: 3 }]);
  });

  it('least: a tile over a dug tile refuses below rail + 3', () => {
    const map = grassMap(9, 9);
    for (let i = 0; i < 3; i++) act(map, [[4, 4]], 1);
    const least = (x: number, y: number) => (x === 4 && y === 4 ? 3 : 0);
    const refused = act(map, [[4, 4]], -1, none, least);
    expect(refused.moved).toEqual([]);
    expect(refused.refused).toEqual([{ x: 4, y: 4 }]);
    // a tile the lowering pulls down refuses just the same
    const pulled = act(map, [[5, 4]], -1, none, least);
    expect(pulled.refused).toEqual([{ x: 4, y: 4 }]);
    // and at or above its floor it moves
    expect(act(map, [[4, 4]], -1, none, (x, y) => (x === 4 && y === 4 ? 2 : 0)).refused).toEqual(
      [],
    );
  });

  it('never moves water: a raise that would lift it refuses, one that leaves it be does not', () => {
    const map = grassMap(9, 9);
    map.terrain[4 * 9 + 5] = Terrain.Water;
    expect(act(map, [[4, 4]], 1).refused).toEqual([]);
    expect(act(map, [[4, 4]], 1).refused).toEqual([{ x: 5, y: 4 }]);
    expect(act(map, [[5, 4]], 1).refused).toEqual([{ x: 5, y: 4 }]);
  });

  it('holds ground that a raise would free to rise', () => {
    // a block of mountain, level 1 at its foot because the grass beside it is level 0
    const w = 10,
      terrain = new Uint8Array(w * w).fill(Terrain.Grass);
    for (let y = 2; y <= 6; y++) for (let x = 4; x <= 7; x++) terrain[y * w + x] = Terrain.Mountain;
    const map: Elevated = { w, h: w, terrain };
    const levels = tileLevels(map);
    expect(levels[4 * w + 4]).toBe(1);
    const result = act(map, [[3, 4]], 1);
    // (4, 4) would come up to 2 by itself; it is held at 1, and so are the rest of its foot
    expect(result.moved).toContainEqual({ x: 3, y: 4, to: 1 });
    expect(result.moved).toContainEqual({ x: 4, y: 4, to: 1 });
    expect([...tileLevels(map)]).toEqual([...applied(levels, result.moved, w)]);
    expect(tileLevels(map)[4 * w + 4]).toBe(1);
  });

  // The property the editing tools stand on: a plane written with `moved` is settled. Planes of
  // random settled levels, with and without the generator's steps of up to 4, random tiles, fixed
  // tiles and floors.
  it('leaves a settled plane settled, with levelAt and tileLevels agreeing', () => {
    let moved = 0,
      refused = 0;
    forAll(
      (rng) => {
        const w = rng.int(3, 12),
          h = rng.int(3, 12),
          steep = rng.chance(0.5),
          terrain = new Uint8Array(w * h).fill(Terrain.Grass),
          raw = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) raw[i] = rng.chance(0.3) ? rng.int(0, MAX_LEVEL) : 0;
        const settled = tileLevels({
          w,
          h,
          terrain,
          generatedLevel: steep ? raw : undefined,
          groundLevel: steep ? undefined : raw,
        });
        const tiles = Array.from({ length: rng.int(1, 5) }, () => ({
          x: rng.int(0, w - 1),
          y: rng.int(0, h - 1),
        }));
        const fixedAt = new Set<number>(),
          leastAt = new Map<number, number>();
        for (let i = 0; i < w * h; i++) {
          if (rng.chance(0.05)) fixedAt.add(i);
          if (rng.chance(0.05)) leastAt.set(i, rng.int(0, 4));
        }
        return {
          w,
          h,
          terrain,
          steep,
          settled,
          tiles,
          delta: rng.pick([1, -1] as const),
          fixedAt,
          leastAt,
        };
      },
      ({ w, h, terrain, steep, settled, tiles, delta, fixedAt, leastAt }) => {
        const map: Elevated = {
          w,
          h,
          terrain,
          generatedLevel: steep ? Uint8Array.from(settled) : undefined,
          groundLevel: Uint8Array.from(settled),
        };
        const levels = tileLevels(map);
        expect([...levels]).toEqual([...settled]);
        const result = reshape(
          map,
          levels,
          tiles,
          delta,
          (x, y) => fixedAt.has(y * w + x),
          (x, y) => leastAt.get(y * w + x) ?? 0,
        );
        if (result.refused.length) {
          refused++;
          if (result.moved.length) throw new Error('a refused action moved tiles');
          return;
        }
        moved++;
        for (const t of tiles) {
          const k = t.y * w + t.x;
          if (!result.moved.some((m) => m.x === t.x && m.y === t.y && m.to === levels[k] + delta))
            throw new Error(`(${t.x}, ${t.y}) did not move by ${delta}`);
        }
        const next = applied(levels, result.moved, w);
        for (const m of result.moved) {
          const k = m.y * w + m.x;
          if (m.to < 0 || m.to > MAX_LEVEL) throw new Error(`level ${m.to} out of range`);
          if (m.to !== levels[k] && (fixedAt.has(k) || m.to < (leastAt.get(k) ?? 0)))
            throw new Error(`(${m.x}, ${m.y}) moved against its rules`);
          map.groundLevel![k] = m.to;
        }
        const after = tileLevels(map);
        if (after.some((v, i) => v !== next[i])) throw new Error('tileLevels left the plane');
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const k = y * w + x;
            if (levelAt(map, x, y) !== after[k]) throw new Error(`levelAt differs at (${x}, ${y})`);
            // no step grows past what it was, with a floor of one, and none past maxStep
            for (const k2 of [x < w - 1 ? k + 1 : -1, y < h - 1 ? k + w : -1]) {
              if (k2 < 0) continue;
              const was = Math.abs(levels[k] - levels[k2]),
                now = Math.abs(next[k] - next[k2]);
              if (now > Math.max(1, was) || now > maxStep(map))
                throw new Error(`step ${was} became ${now} at (${x}, ${y})`);
            }
          }
      },
      { format: (c) => `${c.w} x ${c.h}, delta ${c.delta}, tiles ${JSON.stringify(c.tiles)}` },
    );
    // the cases cover both ends
    expect(moved).toBeGreaterThan(10);
    expect(refused).toBeGreaterThan(5);
  });

  it('leaves a map whose planes set some tiles only settled', () => {
    const palette = [Terrain.Grass, Terrain.Hill, Terrain.Mountain];
    let held = 0;
    forAll(
      (rng) => {
        const w = rng.int(3, 12),
          h = rng.int(3, 12),
          terrain = new Uint8Array(w * h),
          lumps = rng.chance(0.5);
        for (let i = 0; i < w * h; i++)
          terrain[i] = lumps && i > 0 && rng.chance(0.7) ? terrain[i - 1] : rng.pick(palette);
        if (rng.chance(0.3)) terrain[rng.int(0, w * h - 1)] = Terrain.Water;
        const settled = tileLevels({ w, h, terrain });
        const part = new Uint8Array(w * h).fill(NO_LEVEL);
        for (let i = 0; i < w * h; i++) if (rng.chance(0.3)) part[i] = settled[i];
        const tiles = Array.from({ length: rng.int(1, 4) }, () => ({
          x: rng.int(0, w - 1),
          y: rng.int(0, h - 1),
        }));
        return { w, h, terrain, part, tiles, delta: rng.pick([1, -1] as const) };
      },
      ({ w, h, terrain, part, tiles, delta }) => {
        const map: Elevated = { w, h, terrain, groundLevel: Uint8Array.from(part) };
        const levels = tileLevels(map);
        const result = reshape(map, levels, tiles, delta, none, zero);
        if (result.refused.length) return;
        for (const m of result.moved) {
          if (m.to === levels[m.y * w + m.x]) held++;
          map.groundLevel![m.y * w + m.x] = m.to;
        }
        const next = applied(levels, result.moved, w),
          after = tileLevels(map);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const k = y * w + x;
            if (after[k] !== next[k])
              throw new Error(`tileLevels ${after[k]}, ${next[k]} at (${x}, ${y})`);
            if (levelAt(map, x, y) !== next[k]) throw new Error(`levelAt differs at (${x}, ${y})`);
          }
      },
      { format: (c) => `${c.w} x ${c.h}, delta ${c.delta}, tiles ${JSON.stringify(c.tiles)}` },
    );
    expect(held).toBeGreaterThan(0);
  });
});
