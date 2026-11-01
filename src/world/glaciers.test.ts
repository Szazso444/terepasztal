import { describe, expect, it } from 'vitest';
import { DIR_DX, DIR_DY, type Dir } from '../engine/iso';
import { DEFAULT_RELIEF, TILE_SIDE_PX, buildRelief } from '../render/terrainRelief';
import { buildMap, encodeMap } from './chunks';
import { MAX_LEVEL, levelTarget, tileLevels } from './elevation';
import { GlacierKind, ICE_LOW, ICE_TILES, MELT_TILES, traceGlaciers } from './glaciers';
import { emptyMap, generateMap, type MapGenParams } from './mapgen';
import { WaterKind, type Drainage } from './rivers';
import { Biome, Terrain, type GameMap } from './tiles';

/** Worlds that grow glaciers: 15 at the default sliders, 5 with more stone. */
const DEFAULT_SEEDS = [15, 16, 19, 45, 46, 64, 79, 82, 91, 93, 99, 110, 118, 132, 133];
const STONY_SEEDS = [2, 3, 5, 8, 10];
const STONY: Partial<MapGenParams> = { rockLevel: 0.72 };

function sidesOf(m: GameMap, i: number) {
  const x = i % m.w;
  const y = (i - x) / m.w;
  return [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ]
    .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < m.w && ny < m.h)
    .map(([nx, ny]) => ny * m.w + nx);
}

/** The glaciers of `m`: its connected areas of ice. */
function iceAreas(m: GameMap) {
  const seen = new Uint8Array(m.w * m.h);
  const out: number[][] = [];
  for (let s = 0; s < m.w * m.h; s++) {
    if (seen[s] || m.terrain[s] !== Terrain.Ice) continue;
    seen[s] = 1;
    const area = [s];
    for (let k = 0; k < area.length; k++)
      for (const n of sidesOf(m, area[k]))
        if (!seen[n] && m.terrain[n] === Terrain.Ice) {
          seen[n] = 1;
          area.push(n);
        }
    out.push(area);
  }
  return out;
}

describe('glaciers in generated worlds', () => {
  const cases = [
    ...DEFAULT_SEEDS.map((seed) => ({ seed, params: {} })),
    ...STONY_SEEDS.map((seed) => ({ seed, params: STONY })),
  ];

  it('stand at the snow line or a level below it, like the Mountain they replace', () => {
    let ice = 0;
    for (const { seed, params } of cases) {
      const m = generateMap(seed, { w: 160, h: 160, ...params });
      const levels = tileLevels(m);
      const asMountain = {
        ...m,
        terrain: m.terrain.map((t) => (t === Terrain.Ice ? Terrain.Mountain : t)),
      };
      expect(tileLevels(asMountain)).toEqual(levels);
      for (let i = 0; i < m.w * m.h; i++) {
        if (m.terrain[i] !== Terrain.Ice) continue;
        ice++;
        expect(levelTarget(m, i)).toBeGreaterThanOrEqual(ICE_LOW);
        expect(m.biome[i]).toBe(Biome.Mountain);
        // the edge of a map holds levels down (tileLevels); the world beyond it does not
        const x = i % m.w;
        const y = (i - x) / m.w;
        if (Math.min(x, y, m.w - 1 - x, m.h - 1 - y) < MAX_LEVEL) continue;
        expect(levels[i], `seed ${seed}, tile ${i}`).toBe(levelTarget(m, i));
      }
      for (let y = 0; y < m.h; y++)
        for (let x = 0; x < m.w; x++) {
          const k = y * m.w + x;
          if (x) expect(Math.abs(levels[k] - levels[k - 1])).toBeLessThanOrEqual(1);
          if (y) expect(Math.abs(levels[k] - levels[k - m.w])).toBeLessThanOrEqual(1);
        }
    }
    expect(ice).toBeGreaterThan(0);
  }, 60_000);

  it('drain into a river, and the river below them never rises downstream', () => {
    let areas = 0;
    for (const { seed, params } of cases) {
      // a ring around the map, so a glacier at its edge keeps the tile it drains into
      const m = generateMap(seed, { w: 160, h: 160, ...params });
      for (const area of iceAreas(m)) {
        if (area.some((i) => sidesOf(m, i).length < 4)) continue;
        areas++;
        const drains = area.some((i) =>
          sidesOf(m, i).some((n) => m.terrain[n] === Terrain.Water && m.biome[n] === Biome.River),
        );
        const reachesOff = area.some(
          (i) => i % m.w < 3 || i % m.w >= m.w - 3 || i < 3 * m.w || i >= (m.h - 3) * m.w,
        );
        expect(drains || reachesOff, `seed ${seed}, tile ${area[0]}`).toBe(true);
      }
      for (let i = 0; i < m.w * m.h; i++) {
        const side = m.flowDir![i];
        if (!side) continue;
        const d = (side - 1) as Dir;
        const nx = (i % m.w) + DIR_DX[d];
        const ny = Math.floor(i / m.w) + DIR_DY[d];
        if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
        const n = ny * m.w + nx;
        if (m.terrain[n] === Terrain.Water)
          expect(m.waterSurface![n], `seed ${seed}, tile ${i}`).toBeLessThanOrEqual(
            m.waterSurface![i],
          );
      }
    }
    expect(areas).toBeGreaterThan(0);
  }, 60_000);

  it('are small: at most the trace and the ice above it', () => {
    let largest = 0;
    for (const { seed, params } of cases)
      for (const a of iceAreas(generateMap(seed, { w: 160, h: 160, ...params })))
        largest = Math.max(largest, a.length);
    expect(largest).toBeGreaterThan(0);
    expect(largest).toBeLessThanOrEqual(10 * (1 + ICE_TILES));
  }, 60_000);

  it('never come to a chunk that was stored without them', () => {
    const seed = DEFAULT_SEEDS[0];
    const frame = { w: 160, h: 160 };
    const made = generateMap(seed, frame);
    expect(made.terrain.includes(Terrain.Ice)).toBe(true);
    const old = {
      ...made,
      terrain: made.terrain.map((t) => (t === Terrain.Ice ? Terrain.Mountain : t)),
    };
    const back = buildMap(seed, frame, encodeMap(old)).map;
    expect(back.terrain.includes(Terrain.Ice)).toBe(false);
  }, 60_000);
});

describe('ice in the relief', () => {
  it('reads like the Mountain it replaces', () => {
    const m = emptyMap(7412, 32, 32);
    for (let y = 3; y < 29; y++)
      for (let x = 3; x < 29; x++)
        m.terrain[y * 32 + x] =
          x > 7 && x < 25 && y > 7 && y < 25 ? Terrain.Mountain : Terrain.Hill;
    const iced = { ...m, terrain: m.terrain.slice() };
    for (let y = 12; y < 18; y++) iced.terrain[y * 32 + 16] = Terrain.Ice;
    const corners = { step: TILE_SIDE_PX / 4, maxRise: 2 as const, faces: true };
    for (const style of [DEFAULT_RELIEF, corners]) {
      const a = buildRelief(m, new Set(), style);
      const b = buildRelief(iced, new Set(), style);
      expect(b.corners).toEqual(a.corners);
      expect(b.tiles).toEqual(a.tiles);
    }
  });
});

describe('traceGlaciers on a hand-made drainage', () => {
  const W = 40;
  /**
   * A valley up the middle column of a mountain: a river source at (20, 34), land above it up to
   * row 10, and everything drains towards the source. Row by row the level climbs at row 31 and up.
   */
  function fixture() {
    const n = W * W;
    const terrain = new Uint8Array(n).fill(Terrain.Mountain);
    const kind = new Uint8Array(n);
    const down = new Int32Array(n).fill(-1);
    const acc = new Float32Array(n).fill(1);
    const surface = new Uint8Array(n);
    // low ground: rows 34 and below are grass, with the source on it
    for (let y = 34; y < W; y++) for (let x = 0; x < W; x++) terrain[y * W + x] = Terrain.Grass;
    const source = 34 * W + 20;
    terrain[source] = Terrain.Water;
    kind[source] = WaterKind.River;
    for (let y = 33; y >= 10; y--) {
      const i = y * W + 20;
      down[i] = i + W;
      acc[i] = 10 + y;
    }
    const d = {
      kind,
      surface,
      flow: new Uint16Array(n),
      dir: new Uint8Array(n),
      exits: [],
      pond: false,
      down,
      acc,
    } as Drainage;
    return {
      w: W,
      h: W,
      core: { x0: 0, y0: 0, x1: W, y1: W },
      terrain,
      keepOut: new Uint8Array(n),
      drainage: d,
      source,
    };
  }
  const column = (plane: Uint8Array) => {
    const out: number[] = [];
    for (let y = 0; y < W; y++) if (plane[y * W + 20]) out.push(y);
    return out;
  };

  it('turns the way up into river, its top tile into ice and the ice runs on for ICE_TILES', () => {
    const p = fixture();
    const levels = tileLevels(p);
    const plane = traceGlaciers(p);
    // the first tile up at MAX_LEVEL: 4 tiles into the mountain
    let top = 33;
    while (levels[top * W + 20] < MAX_LEVEL) top--;
    expect(33 - top).toBeLessThanOrEqual(MELT_TILES);
    expect(column(plane).length).toBe(33 - top + 1 + ICE_TILES);
    expect(plane[top * W + 20]).toBe(GlacierKind.Ice);
    expect(plane[(top - ICE_TILES) * W + 20]).toBe(GlacierKind.Ice);
    expect(plane[(top - ICE_TILES - 1) * W + 20]).toBe(GlacierKind.None);
    // the ice runs a tile further down, a level lower, then its melt starts
    expect(plane[(top + 1) * W + 20]).toBe(GlacierKind.Ice);
    expect(p.drainage.surface[(top + 1) * W + 20]).toBe(ICE_LOW);
    expect(plane[(top + 2) * W + 20]).toBe(GlacierKind.Head);
    expect(plane[33 * W + 20]).toBe(GlacierKind.Melt);
    // the melt has its water level, flow and way down
    const melt = (top + 2) * W + 20;
    expect(p.drainage.surface[melt]).toBe(levels[melt]);
    expect(p.drainage.flow[melt]).toBe(Math.round(p.drainage.acc[melt]));
    expect(p.drainage.dir[melt]).toBe(3);
    // the land under it stays land until the mountains have risen
    expect(p.drainage.kind[melt]).toBe(WaterKind.Land);
  });

  it('takes the fuller of two ways, the lower index on a tie', () => {
    const p = fixture();
    const { down, acc } = p.drainage;
    const side = 33 * W + 21;
    down[side] = 33 * W + 20;
    acc[side] = acc[32 * W + 20];
    const plane = traceGlaciers(p);
    expect(plane[side]).toBe(GlacierKind.None);
    expect(plane[33 * W + 20]).toBe(GlacierKind.Melt);
  });

  it('keeps out of what `keepOut` marks', () => {
    const p = fixture();
    p.keepOut.fill(1);
    expect(traceGlaciers(p).some((g) => g)).toBe(false);
  });

  it('leaves no glacier where the water would stand below what it runs into', () => {
    const p = fixture();
    p.drainage.surface[p.source] = MAX_LEVEL;
    p.terrain[p.source] = Terrain.Mountain;
    expect(traceGlaciers(p).some((g) => g)).toBe(false);
  });

  it('lays a field no trace reaches from its tile with the most rain down to the water', () => {
    const p = fixture();
    const { kind, down } = p.drainage;
    // a river out of a lake is no source, so no trace starts from it
    const lake = 35 * W + 20;
    kind[lake] = WaterKind.Lake;
    p.terrain[lake] = Terrain.Water;
    down[lake] = p.source;
    const plane = traceGlaciers(p);
    expect(column(plane)).toEqual(column(traceGlaciers(fixture())));
  });
});
