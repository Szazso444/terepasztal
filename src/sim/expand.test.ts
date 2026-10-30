import { describe, it, expect } from 'vitest';
import { Rng } from '../engine/rng';
import { tileToWorld, worldToTile } from '../engine/iso';
import { forAll, shrinkInt } from '../testing/property';
import { mapChunks } from '../world/chunks';
import { DEFAULT_MAP_PARAMS, emptyMap, type MapGenParams } from '../world/mapgen';
import { RegionState } from '../world/regions';
import { Terrain } from '../world/tiles';
import { CHUNK_TILES, expandSave, ownsBorderChunk, ringsWithinBound } from './expand';
import { MAX_WORLD_CHUNKS, worldWithinBound, type GeneratedWorld } from './ground';
import { buildSave, readSaveText, type SaveGame, type SaveParts } from './save';

/**
 * What stops the growth of a generated world: expandSave and ownsBorderChunk never take the map
 * past MAX_WORLD_CHUNKS chunks (#390), so the bound is the largest world the game reaches and no
 * world a player makes is refused. The cases follow MAX_WORLD_CHUNKS, not 1024, so the constant can
 * be raised without these tests changing.
 */

type Frame = Pick<MapGenParams, 'w' | 'h' | 'originX' | 'originY'>;

/** Chunks along the side of a square a little larger than the bound. */
const SIDE = Math.ceil(Math.sqrt(MAX_WORLD_CHUNKS));

/** A generated world of seed 1 on `frame`, nothing stored. */
const worldOf = (frame: Partial<MapGenParams>): GeneratedWorld => ({
  kind: 'generated',
  seed: 1,
  params: { ...DEFAULT_MAP_PARAMS, ...frame },
});

/** The parts of a small game on `world`, as `Game.snapshot` hands them to `buildSave`. */
function partsOf(world: SaveParts['world']): SaveParts {
  return {
    seed: world.seed,
    clock: { time: 900, speedIndex: 1 },
    economy: { money: 5000, tickets: 2, tier: 1, granted: [0], earned: 100 },
    track: [[3, 4, 'straight', 1, 'regular', 'regular']],
    stations: [],
    trains: [],
    contracts: { contracts: [] },
    inventory: { items: [], nextUid: 1 },
    gacha: {},
    camera: { x: 0, y: 0, zoomIndex: 2 },
    lastDay: 3,
    decor: [],
    wires: [],
    weather: {},
    world,
    rules: {},
    stores: [],
    buildings: [],
    regions: [true],
    seasonOffset: 0,
    towns: [],
    trade: { deals: {}, nextAt: 0, fuelMul: 1, driftDay: 0 },
    crafting: { recipes: [], stats: { unlocks: 0, crafts: 0, failures: 0 } },
    houses: { list: [], arrivals: [], visited: [] },
    supply: 'simple',
    people: { rng: 7 },
    roads: [],
  };
}

const frameOf = (save: SaveGame): MapGenParams => (save.world as GeneratedWorld).params;
/** The chunk counts along a side as the regions array lays them out: rows of ceil(w / 32). */
const gridOf = (f: Frame) => ({
  cw: Math.ceil(f.w / CHUNK_TILES),
  ch: Math.ceil(f.h / CHUNK_TILES),
});

/**
 * The most rings, of `ask`, a map on `frame` can be given, found the slow obvious way: grow it a
 * ring at a time and walk every chunk of the grown map, as the load does (`mapChunks`).
 */
function ringsByWalking(frame: Frame, ask: number): number {
  let rings = 0;
  while (rings < ask) {
    const d = (rings + 1) * CHUNK_TILES;
    const grown = {
      w: frame.w + 2 * d,
      h: frame.h + 2 * d,
      originX: (frame.originX ?? 0) - d,
      originY: (frame.originY ?? 0) - d,
    };
    if (mapChunks(grown).length > MAX_WORLD_CHUNKS) break;
    rings++;
  }
  return rings;
}
/** The same by arithmetic on whole chunks, for a map on the chunk grid. */
function ringsByCount(cw: number, ch: number, ask: number): number {
  let rings = 0;
  while (rings < ask && (cw + 2 * (rings + 1)) * (ch + 2 * (rings + 1)) <= MAX_WORLD_CHUNKS)
    rings++;
  return rings;
}
/** A side in chunks such that `rings` rings take a map of `cw` across to about the bound. */
function nearBound(rng: Rng, cw: number, rings: number): number {
  const ch = Math.floor(MAX_WORLD_CHUNKS / (cw + 2 * rings)) - 2 * rings + rng.int(-2, 2);
  return Math.max(1, ch);
}

describe('the rings a generated world can still be given', () => {
  interface Case {
    cw: number;
    ch: number;
    /** tiles the last chunk of a side is short by */
    trimX: number;
    trimY: number;
    /** the origin: whole chunks, and tiles off the chunk grid */
    gridX: number;
    gridY: number;
    offX: number;
    offY: number;
    ask: number;
  }
  const frameOfCase = (c: Case): Required<Frame> => ({
    w: c.cw * CHUNK_TILES - c.trimX,
    h: c.ch * CHUNK_TILES - c.trimY,
    originX: c.gridX * CHUNK_TILES + c.offX,
    originY: c.gridY * CHUNK_TILES + c.offY,
  });

  it('is what walking the grown map allows, for any size, origin and ask', () => {
    forAll(
      (rng): Case => {
        const cw = rng.int(1, 2 * SIDE);
        const near = rng.chance(0.6);
        const ch = near ? nearBound(rng, cw, rng.int(0, 4)) : rng.int(1, 2 * SIDE);
        const off = rng.chance(0.4);
        return {
          cw,
          ch,
          trimX: rng.chance(0.4) ? rng.int(0, CHUNK_TILES - 1) : 0,
          trimY: rng.chance(0.4) ? rng.int(0, CHUNK_TILES - 1) : 0,
          gridX: rng.int(-6, 6),
          gridY: rng.int(-6, 6),
          offX: off ? rng.int(-31, 31) : 0,
          offY: off ? rng.int(-31, 31) : 0,
          ask: rng.int(0, 5),
        };
      },
      (c) => {
        const frame = frameOfCase(c);
        const got = ringsWithinBound(frame, c.ask);
        const want = ringsByWalking(frame, c.ask);
        expect(got, `${JSON.stringify(frame)} asked ${c.ask}`).toBe(want);
        // a map within the bound is given a map within it
        if (mapChunks(frame).length <= MAX_WORLD_CHUNKS) {
          const d = got * CHUNK_TILES;
          const grown = {
            ...frame,
            w: frame.w + 2 * d,
            h: frame.h + 2 * d,
            originX: frame.originX - d,
            originY: frame.originY - d,
          };
          expect(worldWithinBound({ kind: 'generated', params: grown })).toBe(true);
          expect(mapChunks(grown).length).toBeLessThanOrEqual(MAX_WORLD_CHUNKS);
        }
      },
      {
        seeds: Array.from({ length: 400 }, (_, i) => i + 1),
        shrink: function* (c) {
          for (const ask of shrinkInt(c.ask, 0)) yield { ...c, ask };
          for (const cw of shrinkInt(c.cw, 1)) yield { ...c, cw };
          for (const ch of shrinkInt(c.ch, 1)) yield { ...c, ch };
          for (const k of ['trimX', 'trimY', 'offX', 'offY', 'gridX', 'gridY'] as const)
            for (const v of shrinkInt(c[k], 0)) yield { ...c, [k]: v };
        },
      },
    );
  });

  it('is, for every size on the chunk grid, the rings that keep (w + 2r)(h + 2r) in the bound', () => {
    // every size from one chunk to twice the bound's side: the whole boundary, hit or missed
    for (let cw = 1; cw <= 2 * SIDE; cw++)
      for (let ch = 1; ch <= 2 * SIDE; ch++)
        for (const ask of [1, 3]) {
          const frame = { w: cw * CHUNK_TILES, h: ch * CHUNK_TILES };
          expect(ringsWithinBound(frame, ask), `${cw} x ${ch} chunks, ask ${ask}`).toBe(
            ringsByCount(cw, ch, ask),
          );
        }
  });

  it('is none for a map already past the bound, and for a size no map has', () => {
    const over = Math.floor(MAX_WORLD_CHUNKS / 3) + 1;
    expect(ringsWithinBound({ w: over * CHUNK_TILES, h: 3 * CHUNK_TILES }, 4)).toBe(0);
    for (const w of [1e6, 1e9, 2 ** 40, Infinity, -Infinity, NaN])
      for (const h of [96, 1e6, NaN]) expect(ringsWithinBound({ w, h }, 3), `${w} x ${h}`).toBe(0);
    // so is an origin no map lies at; one that is far but finite is a map like any other
    for (const originX of [1e300, -1e300, 2 ** 31, Infinity, NaN])
      expect(ringsWithinBound({ w: 96, h: 96, originX }, 3), `originX ${originX}`).toBe(0);
    expect(ringsWithinBound({ w: 96, h: 96, originX: 1e6 * CHUNK_TILES }, 3)).toBe(
      ringsByCount(3, 3, 3),
    );
    // an ask of nothing is nothing
    expect(ringsWithinBound({ w: 64, h: 64 }, 0)).toBe(0);
  });
});

describe('the largest world: one ring below the bound grows, at it does not', () => {
  const game = (cw: number, ch = cw) => {
    const save = buildSave(
      partsOf(worldOf({ w: cw * CHUNK_TILES, h: ch * CHUNK_TILES, originX: 0, originY: 0 })),
    );
    save.regions = new Array<boolean>(cw * ch).fill(true);
    return save;
  };

  it('grows the square a ring smaller than the largest to the largest, which grows no more', () => {
    const top = Math.floor(Math.sqrt(MAX_WORLD_CHUNKS));
    // the side two chunks below the bound's square: one ring, and a square of exactly `top`
    const below = game(top - 2);
    expect(ownsBorderChunk(below.regions!, frameOf(below).w, frameOf(below).h)).toBe(true);
    expandSave(below);
    expect(gridOf(frameOf(below))).toEqual({ cw: top, ch: top });
    expect(top * top).toBeLessThanOrEqual(MAX_WORLD_CHUNKS);
    expect(worldWithinBound(below.world)).toBe(true);

    // the largest square: every chunk owned, the edge ones too, and the world stays as it is
    const at = game(top);
    const was = structuredClone(at);
    expect(ownsBorderChunk(at.regions!, frameOf(at).w, frameOf(at).h)).toBe(false);
    expect(expandSave(at)).toBe(at);
    expect(at).toEqual(was);
    // one chunk a side short of it is no nearer to growing: its ring is past the bound too
    const short = game(top - 1);
    expect(ownsBorderChunk(short.regions!, frameOf(short).w, frameOf(short).h)).toBe(false);
    expect(expandSave(short)).toBe(short);
  });

  it('does not touch the save when no ring fits, however much is asked or how large the map', () => {
    // a map no load builds: growing it would lay out an ownership list for every chunk of it
    const cases: { frame: Partial<MapGenParams>; bySize: boolean }[] = [
      { frame: { w: 100_000, h: 100_000 }, bySize: true },
      { frame: { w: 1e6, h: 64 }, bySize: true },
      { frame: { w: Infinity, h: 96 }, bySize: true },
      { frame: { w: NaN, h: 96 }, bySize: true },
      { frame: { w: 96, h: 96, originX: 1e300 }, bySize: false },
      { frame: { w: 96, h: 96, originX: 2 ** 31 }, bySize: false },
    ];
    for (const { frame, bySize } of cases) {
      const save = buildSave(partsOf(worldOf(frame)));
      const text = JSON.stringify(save);
      const at = JSON.stringify(frame);
      expect(expandSave(save, 1), at).toBe(save);
      expect(expandSave(save, 6), at).toBe(save);
      expect(JSON.stringify(save), at).toBe(text);
      // the shop asks by size alone, and a size no map has is no reason to grow
      if (bySize) expect(ownsBorderChunk([true, true, true], frame.w!, frame.h!), at).toBe(false);
    }
  });
});

describe('the shop asks for a ring and the game grows by the rings that fit', () => {
  it('is yes exactly when an owned chunk touches the edge and a ring fits', () => {
    forAll(
      (rng) => {
        const cw = rng.int(1, 2 * SIDE);
        const ch = rng.chance(0.7) ? nearBound(rng, cw, rng.int(0, 1)) : rng.int(1, 2 * SIDE);
        const density = rng.pick([0, 0.01, 0.2, 0.9]);
        const interiorOnly = rng.chance(0.3);
        const owned = Array.from({ length: cw * ch }, (_, i) => {
          const x = i % cw;
          const y = Math.floor(i / cw);
          const border = x === 0 || y === 0 || x === cw - 1 || y === ch - 1;
          return !(interiorOnly && border) && rng.chance(density);
        });
        return { cw, ch, trimX: rng.int(0, CHUNK_TILES - 1), trimY: rng.int(0, 31), owned };
      },
      (c) => {
        const w = c.cw * CHUNK_TILES - c.trimX;
        const h = c.ch * CHUNK_TILES - c.trimY;
        let touchesEdge = false;
        for (let y = 0; y < c.ch; y++)
          for (let x = 0; x < c.cw; x++)
            if (c.owned[y * c.cw + x] && (x === 0 || y === 0 || x === c.cw - 1 || y === c.ch - 1))
              touchesEdge = true;
        const ringFits = (c.cw + 2) * (c.ch + 2) <= MAX_WORLD_CHUNKS;
        expect(ownsBorderChunk(c.owned, w, h), `${c.cw} x ${c.ch}`).toBe(touchesEdge && ringFits);
      },
      { seeds: Array.from({ length: 300 }, (_, i) => i + 1) },
    );
  });

  /** A save with something of every kind that has a place on the map, so growth moves them all. */
  function richSave(frame: Required<Frame>, owned: boolean[], rng: Rng): SaveGame {
    const at = () => [rng.int(0, frame.w - 1), rng.int(0, frame.h - 1)];
    const pt = () => {
      const [x, y] = at();
      return { x, y };
    };
    const cam = tileToWorld(...(at() as [number, number]));
    return {
      ...buildSave(partsOf(worldOf(frame))),
      track: [0, 1, 2].map(() => [...at(), 'straight', 1, 'regular']),
      stations: [pt(), pt()],
      decor: [[...at(), 'townhouse', 0]],
      buildings: [[...at(), 'bridge_stone', 0.5, 3]],
      wires: [[...at(), 'catenary']],
      roads: [at(), at()],
      houses: {
        list: [{ ...pt(), level: 3, residents: 100, progress: 1 }],
        arrivals: [],
        visited: [],
      },
      trains: [
        {
          head: pt(),
          trail: [[...at(), ...at(), 3, 1, 1]],
          retreat: { path: [{ ...pt(), in: 3, out: 1 }, pt()], group: [7] },
        },
        {
          head: pt(),
          trail: [[...at(), ...at(), 3, 1]],
          serviceStop: { ...pt(), fuel: true, water: false },
          way: { path: [pt(), pt()], left: 1.5 },
          want: [at(), at()],
        },
      ],
      regions: owned,
      camera: { x: cam.x, y: cam.y, zoomIndex: 2 },
    } as unknown as SaveGame;
  }
  /** Every place the save names on the map, in a fixed order. */
  function places(save: SaveGame): number[][] {
    type At = { x: number; y: number };
    const out: number[][] = [];
    const add = (p: At) => out.push([p.x, p.y]);
    for (const [x, y] of save.track) out.push([x, y]);
    for (const s of save.stations) add(s);
    for (const [x, y] of save.decor ?? []) out.push([x, y]);
    for (const [x, y] of save.buildings ?? []) out.push([x, y]);
    for (const [x, y] of save.wires ?? []) out.push([x, y]);
    for (const [x, y] of save.roads ?? []) out.push([x, y]);
    for (const h of save.houses?.list ?? []) add(h);
    for (const t of save.trains as unknown as {
      head?: At;
      trail?: number[][];
      retreat?: { path: At[] };
      way?: { path: At[] };
      serviceStop?: At;
      want?: number[][];
    }[]) {
      if (t.head) add(t.head);
      for (const [x, y, sx, sy] of t.trail ?? []) out.push([x, y], [sx, sy]);
      for (const p of [...(t.retreat?.path ?? []), ...(t.way?.path ?? [])]) add(p);
      if (t.serviceStop) add(t.serviceStop);
      for (const [x, y] of t.want ?? []) out.push([x, y]);
    }
    return out;
  }

  interface Growth {
    cw: number;
    ch: number;
    trim: number;
    /** whole chunks the origin already lies from 0, from earlier growth */
    grown: number;
    ask: number;
    seed: number;
  }
  const growthCases = (rng: Rng): Growth => {
    const cw = rng.int(1, 2 * SIDE);
    return {
      cw,
      ch: rng.chance(0.7) ? nearBound(rng, cw, rng.int(0, 4)) : rng.int(1, 2 * SIDE),
      trim: rng.chance(0.4) ? rng.int(0, CHUNK_TILES - 1) : 0,
      grown: rng.int(0, 4),
      ask: rng.int(1, 4),
      seed: rng.int(1, 1e6),
    };
  };
  const growthShrink = function* (c: Growth): Iterable<Growth> {
    for (const ask of shrinkInt(c.ask, 1)) yield { ...c, ask };
    for (const cw of shrinkInt(c.cw, 1)) yield { ...c, cw };
    for (const ch of shrinkInt(c.ch, 1)) yield { ...c, ch };
    for (const trim of shrinkInt(c.trim, 0)) yield { ...c, trim };
    for (const grown of shrinkInt(c.grown, 0)) yield { ...c, grown };
  };
  const prepare = (c: Growth) => {
    const rng = new Rng(c.seed);
    const frame = {
      w: c.cw * CHUNK_TILES - c.trim,
      h: c.ch * CHUNK_TILES - c.trim,
      originX: -c.grown * CHUNK_TILES,
      originY: -c.grown * CHUNK_TILES,
    };
    const owned = Array.from({ length: c.cw * c.ch }, () => rng.chance(0.3));
    return { frame, owned, save: richSave(frame, owned, rng) };
  };

  it('grows by the rings that fit, none when none does, and a ring wherever the shop says yes', () => {
    forAll(
      growthCases,
      (c) => {
        const { frame, owned, save } = prepare(c);
        const fits = ringsByCount(c.cw, c.ch, c.ask);
        const yes = ownsBorderChunk(owned, frame.w, frame.h);
        // the shop asks for one ring: growth gives it whenever one fits, and a yes is one that does
        const one = structuredClone(save);
        expandSave(one, 1);
        const ringFits = ringsByCount(c.cw, c.ch, 1) === 1;
        expect(frameOf(one).w - frame.w, 'one ring asked').toBe(ringFits ? 2 * CHUNK_TILES : 0);
        if (yes) expect(ringFits, 'a yes is a ring that fits').toBe(true);

        const was = structuredClone(save);
        expandSave(save, c.ask);
        const now = frameOf(save);
        const d = fits * CHUNK_TILES;
        expect(now).toMatchObject({
          w: frame.w + 2 * d,
          h: frame.h + 2 * d,
          originX: frame.originX - d,
          originY: frame.originY - d,
        });
        // no ring that fits, no change at all
        if (fits === 0) expect(save).toEqual(was);
        // a world within the bound is given a world within it, and not short of it
        if (c.cw * c.ch <= MAX_WORLD_CHUNKS) {
          expect(mapChunks(now).length).toBeLessThanOrEqual(MAX_WORLD_CHUNKS);
          expect(worldWithinBound(save.world)).toBe(true);
        }
        if (fits < c.ask) {
          const more = { ...now, w: now.w + 2 * CHUNK_TILES, h: now.h + 2 * CHUNK_TILES };
          more.originX = now.originX! - CHUNK_TILES;
          more.originY = now.originY! - CHUNK_TILES;
          expect(mapChunks(more).length, 'one ring more is past the bound').toBeGreaterThan(
            MAX_WORLD_CHUNKS,
          );
        }
      },
      { seeds: Array.from({ length: 200 }, (_, i) => i + 1), shrink: growthShrink },
    );
  });

  it('moves nothing in world space: every place keeps its world tile, the camera its place', () => {
    forAll(
      growthCases,
      (c) => {
        const { save } = prepare(c);
        const before = places(save);
        const o = frameOf(save);
        const cam = worldToTile(save.camera.x, save.camera.y);
        const here = { x: cam.x + o.originX!, y: cam.y + o.originY! };
        expandSave(save, c.ask);
        const n = frameOf(save);
        const after = places(save);
        expect(after).toHaveLength(before.length);
        before.forEach(([x, y], i) => {
          expect(after[i][0] + n.originX!, `place ${i}, x`).toBe(x + o.originX!);
          expect(after[i][1] + n.originY!, `place ${i}, y`).toBe(y + o.originY!);
        });
        const camNow = worldToTile(save.camera.x, save.camera.y);
        expect(camNow.x + n.originX!).toBeCloseTo(here.x, 6);
        expect(camNow.y + n.originY!).toBeCloseTo(here.y, 6);
      },
      { seeds: Array.from({ length: 200 }, (_, i) => i + 1), shrink: growthShrink },
    );
  });

  it('keeps every chunk bought where it was in the world, whatever rings were added', () => {
    forAll(
      growthCases,
      (c) => {
        const { frame, owned, save } = prepare(c);
        expandSave(save, c.ask);
        const now = frameOf(save);
        const chunksBefore = mapChunks(frame);
        const chunksNow = mapChunks(now);
        expect(save.regions, 'one entry a chunk of the map').toHaveLength(chunksNow.length);
        // the world chunk each entry stands for, as a load numbers them
        const ownedAt = new Set<string>();
        chunksBefore.forEach(({ cx, cy }, i) => owned[i] && ownedAt.add(`${cx},${cy}`));
        const ownedNow = new Set<string>();
        chunksNow.forEach(({ cx, cy }, i) => save.regions![i] && ownedNow.add(`${cx},${cy}`));
        expect([...ownedNow].sort()).toEqual([...ownedAt].sort());
      },
      { seeds: Array.from({ length: 200 }, (_, i) => i + 1), shrink: growthShrink },
    );
  });

  it('is the same asked for at once as a ring at a time until no ring is given', () => {
    forAll(
      growthCases,
      (c) => {
        const { save } = prepare(c);
        const once = structuredClone(save);
        expandSave(once, c.ask);
        const stepped = structuredClone(save);
        for (let k = 0; k < c.ask; k++) {
          const wasFrame = frameOf(stepped).w;
          expandSave(stepped, 1);
          if (frameOf(stepped).w === wasFrame) break;
        }
        expect(stepped).toEqual(once);
      },
      { seeds: Array.from({ length: 200 }, (_, i) => i + 1), shrink: growthShrink },
    );
  });
});

describe('a player buying chunk after chunk', () => {
  const mapOf = (p: Frame) => emptyMap(1, p.w, p.h, Terrain.Grass, p.originX ?? 0, p.originY ?? 0);

  /**
   * Plays a game from a map of `start` tiles: the player buys a revealed chunk at a time (mostly
   * the outermost, sometimes any) and, as `Game.buyChunk` does, the world grows a ring whenever
   * `ownsBorderChunk` says it must, the save going through `expandSave` and coming back as a
   * `RegionState` over the grown map. Goes on until every chunk of the world is bought.
   */
  function play(seed: number, start: { w: number; h: number }) {
    const rng = new Rng(seed);
    const save = buildSave(partsOf(worldOf({ ...start, originX: 0, originY: 0 })));
    let map = mapOf(frameOf(save));
    let regions = new RegionState(map, 0);
    const startChunk = () => mapChunks(frameOf(save))[regions.tiers.indexOf(0)];
    const middle = startChunk();
    let growths = 0;
    let purchases = 0;
    let atTheBound = 0;

    /** What follows a purchase, and the load of a game: the world grows if the shop says it must. */
    function settle() {
      const p = frameOf(save);
      const { cw, ch } = gridOf(p);
      const at = `seed ${seed}: ${cw} x ${ch}`;
      const touches = regions.unlocked.some(
        (v, i) =>
          v && (i % cw === 0 || i < cw || i % cw === cw - 1 || Math.floor(i / cw) === ch - 1),
      );
      const fits = (cw + 2) * (ch + 2) <= MAX_WORLD_CHUNKS;
      const grows = ownsBorderChunk(regions.unlocked, map.w, map.h);
      expect(grows, at).toBe(touches && fits);
      if (touches && !fits) atTheBound++;
      if (!grows) return;

      // grow the world as buyChunk does: snapshot, one ring, write, come back into it
      save.regions = [...regions.unlocked];
      const ownedBefore = regions.ownedCount();
      expandSave(save, 1);
      growths++;
      const q = frameOf(save);
      expect([q.w, q.h], at).toEqual([p.w + 2 * CHUNK_TILES, p.h + 2 * CHUNK_TILES]);
      expect(worldWithinBound(save.world), at).toBe(true);
      expect(readSaveText(JSON.stringify(save)), at).toHaveProperty('save');
      map = mapOf(q);
      regions = new RegionState(map, 0);
      regions.load(save.regions);
      // `load` drops a list of the wrong length: the bought chunks are still bought
      expect(regions.ownedCount(), at).toBe(ownedBefore);
      // and the start chunk is still the middle of the map, the same chunk of the world
      expect(startChunk(), at).toEqual(middle);
    }

    settle();
    for (;;) {
      const open: number[] = [];
      for (let i = 0; i < regions.unlocked.length; i++)
        if (!regions.unlocked[i] && regions.isRevealed(i)) open.push(i);
      if (open.length === 0) break;
      let pick = rng.pick(open);
      if (rng.chance(0.7))
        for (const i of open) if (regions.tiers[i] > regions.tiers[pick]) pick = i;
      const { cw, ch } = gridOf(frameOf(save));
      // the purchase goes through at every size, at the bound too
      expect(regions.own(pick), `seed ${seed}: a purchase in a ${cw} x ${ch} world`).toBe(true);
      purchases++;
      settle();
    }
    return { save, regions, growths, purchases, atTheBound };
  }

  // Every ring rebuilds a map of up to a million tiles for the regions; the run takes about a second.
  it('is never refused, and ends in the largest world the bound allows, every chunk bought', () => {
    // 15 x 15 chunks is the largest world a new game starts with; the others take other paths to
    // the bound, odd and even sides, a side off the chunk grid and a world not square
    const starts = [
      { w: CHUNK_TILES, h: CHUNK_TILES },
      { w: 15 * CHUNK_TILES, h: 15 * CHUNK_TILES },
      { w: 12 * CHUNK_TILES, h: 12 * CHUNK_TILES },
      { w: 7 * CHUNK_TILES - 24, h: 10 * CHUNK_TILES - 5 },
      { w: 3 * CHUNK_TILES, h: 20 * CHUNK_TILES },
      { w: 3 * CHUNK_TILES, h: 3 * CHUNK_TILES },
    ].filter((start) => mapChunks(start).length <= MAX_WORLD_CHUNKS);
    starts.forEach((start, k) => {
      const seed = 100 + k;
      const played = play(seed, start);
      const { cw, ch } = gridOf(frameOf(played.save));
      const at = `seed ${seed}, from ${JSON.stringify(start)}: ended ${cw} x ${ch}`;
      const first = gridOf(start);
      // every chunk is bought, so the world was not stopped short: no ring would have fit
      expect(played.regions.ownedCount(), at).toBe(cw * ch);
      expect((cw + 2) * (ch + 2), at).toBeGreaterThan(MAX_WORLD_CHUNKS);
      expect(cw * ch, at).toBeLessThanOrEqual(MAX_WORLD_CHUNKS);
      expect(ringsWithinBound(frameOf(played.save), 1), at).toBe(0);
      // it grew by whole rings, and by all of them
      expect(cw - first.cw, at).toBe(ringsByCount(first.cw, first.ch, 999) * 2);
      expect(ch - first.ch, at).toBe(cw - first.cw);
      expect(played.growths, at).toBe(ringsByCount(first.cw, first.ch, 999));
      // and the player did buy chunks of the edge at the bound, which went through
      expect(played.atTheBound, at).toBeGreaterThan(0);
    });
  }, 20_000);
});
