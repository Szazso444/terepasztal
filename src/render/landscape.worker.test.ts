import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Dir } from '../engine/iso';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { BIOME_DEFS } from '../sim/biomes';
import { buildRelief, reliefHeight, surfaceAlongRay, type TerrainRelief } from './terrainRelief';
import { paintedWater } from './terrainMaterials';
import { LANE_REACH, pavingDoorsteps, PAVING_FRINGE, PAVING_SOLID, TownPaving } from './townPaving';
import { groundOf } from '../art/buildingGround';
import { BuildingYards, buildingYard, yardTiles, type Yard } from './buildingYard';
import { RoadPaint, pavingFade } from './roadPaint';
import { ROAD_FEATHER, ROAD_HALF, roadCode, roadSides } from './roadShape';

/** Side of one cell of the stand-in surface sheet: ten cells stacked, one per material. */
const CELL = 64;
/** A surface sheet with a colour of its own per material and a little texture in each. */
function sheet() {
  const out = new Uint8ClampedArray(CELL * CELL * 10 * 4);
  for (let m = 0; m < 10; m++)
    for (let y = 0; y < CELL; y++)
      for (let x = 0; x < CELL; x++) {
        const k = ((m * CELL + y) * CELL + x) * 4,
          grain = ((x * 7 + y * 13) % 11) * 2;
        out[k] = 40 + m * 18 + grain;
        out[k + 1] = 150 - m * 9 + grain;
        out[k + 2] = 60 + ((m * 37) % 120);
        out[k + 3] = 255;
      }
  return out;
}
/**
 * The 2D context the painter uses: it keeps the pixels put in, and gives the sheet otherwise. It
 * keeps the centre of each ellipse drawn, the shadow under each small stone.
 */
class Context {
  data: Uint8ClampedArray | null = null;
  ellipses: number[] = [];
  constructor(private readonly surfaces: Uint8ClampedArray) {}
  drawImage() {}
  getImageData() {
    return { data: this.data ?? this.surfaces };
  }
  putImageData(image: { data: Uint8ClampedArray }) {
    this.data = image.data;
  }
  setTransform() {}
  beginPath() {}
  ellipse(x: number, y: number) {
    this.ellipses.push(x, y);
  }
  moveTo() {}
  lineTo() {}
  closePath() {}
  fill() {}
  fillStyle = '';
  globalCompositeOperation = '';
}
type Reply = {
  error?: string;
  left: number;
  top: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  /** The grass tufts, four numbers each: where (chunk pixels at one per world pixel), size, kind. */
  grass: Float32Array;
  /** The small stones' shadows drawn into the chunk, as `Context.ellipses` keeps them. */
  stones: number[];
};
let replies: Reply[] = [];
let send: (data: object) => Promise<void>;
/** The context of the canvas made last: a paint job's own. */
let lastContext: Context | null = null;

beforeAll(async () => {
  const surfaces = sheet();
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      context = (lastContext = new Context(surfaces));
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return this.context;
      }
    },
  );
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    },
  );
  vi.stubGlobal('createImageBitmap', async () => ({
    width: CELL,
    height: CELL * 10,
    close() {},
  }));
  vi.stubGlobal('fetch', async () => ({ ok: true, blob: async () => null }));
  const self: { postMessage(m: Reply): void; onmessage?: (e: { data: object }) => Promise<void> } =
    { postMessage: (m) => void replies.push(m) };
  vi.stubGlobal('self', self);
  await import('./landscape.worker');
  send = (data) => self.onmessage!({ data });
  await send({ url: 'test://terrain-surfaces.png' });
});
afterAll(() => vi.unstubAllGlobals());

/** A flat 24 x 18 map with a river along x = 15 and 16, and a town across x = 7.5 and y = 7.5. */
function world() {
  const map = emptyMap(5, 24, 18, Terrain.Grass, -40, 25);
  for (let y = 0; y < map.h; y++) {
    map.terrain[y * map.w + 15] = Terrain.Water;
    map.terrain[y * map.w + 16] = Terrain.Water;
    map.terrain[y * map.w + 2] = Terrain.Forest;
  }
  const city: number[] = [];
  for (let y = 3; y <= 11; y++)
    for (let x = 4; x <= 14; x++) if (!(x > 10 && y > 8)) city.push(y * map.w + x);
  const paved = new Set(city);
  const doorsteps = pavingDoorsteps(
    [
      { tile: { x: 4, y: 6 }, side: Dir.W },
      { tile: { x: 9, y: 11 }, side: Dir.S },
      { tile: { x: 14, y: 4 }, side: Dir.E },
    ],
    (k) => paved.has(k),
    map.w,
    map.h,
  );
  return { map, city, doorsteps };
}
/** The world() town on a hill: level 2 under most of it, as the shipped style lights it. */
function onHill(w: ReturnType<typeof world>) {
  for (let y = 1; y <= 13; y++)
    for (let x = 3; x <= 14; x++) w.map.terrain[y * w.map.w + x] = Terrain.Hill;
  return w;
}
/**
 * Paints the 8 x 8 chunk at (x, y), with the buildings' `yards` if the world has them, under the
 * season's `tint` if it has one; `snowLevels` by climate, the content's by default.
 */
async function paint(
  {
    map,
    city,
    doorsteps,
    yards = [],
    roads = [],
    tint = 0xd8e8c0,
  }: ReturnType<typeof world> & { yards?: Yard[]; roads?: number[]; tint?: number },
  x: number,
  y: number,
  scale = 1,
  snowLevels: readonly number[] = BIOME_DEFS.map((def) => def.snowLevel),
) {
  await send({
    map: {
      w: map.w,
      h: map.h,
      seed: map.seed,
      originX: map.originX,
      originY: map.originY,
      terrain: map.terrain,
      biome: map.biome,
      climate: map.climate,
    },
    relief: buildRelief(map, new Set()),
    version: 1,
    tint,
    city,
    doorsteps,
    yards,
    roads,
    snowLevels,
  });
  replies = [];
  await send({ id: `${x},${y}`, x, y, w: 8, h: 8, version: 1, scale });
  const reply = replies[0];
  expect(reply.error).toBeUndefined();
  return { ...reply, stones: lastContext!.ellipses };
}
/** The map point the painter reads for pixel (px, py) of a flat chunk. */
function pointOf(r: Reply, px: number, py: number, scale: number) {
  const sx = r.left + (px + 0.5) / scale,
    sy = r.top + (py + 0.5) / scale;
  return [sx / 64 + sy / 32, sy / 32 - sx / 64];
}

describe('the painter with a town', () => {
  // Slow: paints twelve chunks, six at twice the size (about 4 s alone).
  it('paints the pixels two neighbouring chunks share alike, paving and all', async () => {
    const w = world(),
      paving = new TownPaving(w.map.w, w.map.h, w.map.originX, w.map.originY, w.city, w.doorsteps);
    for (const scale of [1, 2])
      for (const [a, b] of [
        [
          [0, 0],
          [8, 0],
        ],
        [
          [8, 0],
          [8, 8],
        ],
        [
          [0, 8],
          [8, 8],
        ],
      ]) {
        const ra = await paint(w, a[0], a[1], scale),
          rb = await paint(w, b[0], b[1], scale);
        const ox = (ra.left - rb.left) * scale,
          oy = (ra.top - rb.top) * scale;
        let shared = 0,
          paved = 0;
        for (let py = 0; py < ra.height; py++)
          for (let px = 0; px < ra.width; px++) {
            const ka = (py * ra.width + px) * 4,
              bx = px + ox,
              by = py + oy;
            if (ra.pixels[ka + 3] !== 255 || bx < 0 || by < 0 || bx >= rb.width || by >= rb.height)
              continue;
            const kb = (by * rb.width + bx) * 4;
            if (rb.pixels[kb + 3] !== 255) continue;
            shared++;
            const [tx, ty] = pointOf(ra, px, py, scale);
            if (paving.distance(tx, ty) > -PAVING_FRINGE) paved++;
            for (let c = 0; c < 3; c++)
              expect(rb.pixels[kb + c], `scale ${scale}, pixel ${px},${py}`).toBe(
                ra.pixels[ka + c],
              );
          }
        expect(shared).toBeGreaterThan(50 * scale);
        expect(paved).toBeGreaterThan(10 * scale);
      }
  }, 80_000);

  // Slow: paints six chunks and checks every pixel against its twin (about 3 s alone).
  it('changes nothing beyond the paving and its fringe, nor water outside the town', async () => {
    const w = world(),
      bare = { ...w, city: [], doorsteps: [] },
      paved = new Set(w.city),
      paving = new TownPaving(w.map.w, w.map.h, w.map.originX, w.map.originY, w.city, w.doorsteps);
    let far = 0,
      water = 0;
    for (const [x, y] of [
      [8, 8],
      [8, 0],
      [16, 0],
    ]) {
      const town = await paint(w, x, y),
        none = await paint(bare, x, y);
      for (let py = 0; py < town.height; py++)
        for (let px = 0; px < town.width; px++) {
          const k = (py * town.width + px) * 4;
          if (town.pixels[k + 3] !== 255) continue;
          const [tx, ty] = pointOf(town, px, py, 1);
          const tile = Math.round(ty) * w.map.w + Math.round(tx);
          if (paving.distance(tx, ty) <= -PAVING_FRINGE) {
            far++;
            for (let c = 0; c < 3; c++) expect(town.pixels[k + c]).toBe(none.pixels[k + c]);
          } else if (!paved.has(tile) && paintedWater(w.map, tx, ty) >= 1 - 1e-6) {
            water++;
            for (let c = 0; c < 3; c++)
              expect(Math.abs(town.pixels[k + c] - none.pixels[k + c])).toBeLessThanOrEqual(1);
          }
        }
    }
    expect(far).toBeGreaterThan(1000);
    expect(water).toBeGreaterThan(20);
  }, 60_000);
});

describe('the painter with a town on the flat, on a hill and above the snow line', () => {
  /** A town's four chunks as painted, with the relief and the paving the painter builds. */
  interface Painted {
    name: string;
    w: ReturnType<typeof world>;
    relief: TerrainRelief;
    paving: TownPaving;
    chunks: Reply[];
  }
  /**
   * Paints the world() town's four chunks, on a hill if `raise`, with every climate's snow line at
   * `snowLine` (the content's if none); with no town on the map at all if not `paved`.
   */
  async function town(
    name: string,
    raise: boolean,
    snowLine?: number,
    paved = true,
  ): Promise<Painted> {
    const built = raise ? onHill(world()) : world(),
      w = paved ? built : { ...built, city: [], doorsteps: [] },
      snowLevels = snowLine === undefined ? undefined : BIOME_DEFS.map(() => snowLine),
      chunks: Reply[] = [];
    for (const [x, y] of [
      [0, 0],
      [8, 0],
      [0, 8],
      [8, 8],
    ])
      chunks.push(await paint(w, x, y, 1, snowLevels));
    return {
      name,
      w,
      relief: buildRelief(w.map, new Set()),
      paving: new TownPaving(w.map.w, w.map.h, w.map.originX, w.map.originY, w.city, w.doorsteps),
      chunks,
    };
  }
  let flat: Painted, hill: Painted, snowy: Painted, bare: Painted;
  // Slow: paints the town's four chunks three times, and the flat map's once with no town (about
  // 5 s alone).
  beforeAll(async () => {
    flat = await town('on the flat', false);
    hill = await town('on a hill', true);
    // level 2 is a level above this snow line: full snow on the ground, patches on level 1
    snowy = await town('on a hill above the snow line', true, 1);
    bare = await town('on the flat with no town', false, undefined, false);
  }, 100_000);

  /**
   * The map point the painter reads at pixel (px, py), raised as the painter raises it, its height
   * and how far inside the paving it lies.
   */
  function readAt({ w, relief, paving }: Painted, r: Reply, px: number, py: number) {
    const [bx, by] = pointOf(r, px, py, 1),
      z = surfaceAlongRay(w.map, relief, bx, by, 10),
      tx = bx + z / 32,
      ty = by + z / 32,
      d = paving.near(Math.round(ty) * w.map.w + Math.round(tx)) ? paving.distance(tx, ty) : -9;
    return { tx, ty, z, d };
  }
  const light = (r: Reply, k: number) => r.pixels[k] + r.pixels[k + 1] + r.pixels[k + 2];

  // Slow: reads the point under every pixel of twelve chunks (about 0.7 s alone).
  it('shows no step where the ground under the paving stops being painted, on a hill and in snow', () => {
    for (const c of [flat, hill, snowy]) {
      // neighbouring pixels either side of PAVING_SOLID, from which the ground under the paving
      // is not painted, both within 0.06 of it: the inner one's brightness over the outer one's
      const ratios: number[] = [];
      for (const r of c.chunks)
        for (let py = 0; py < r.height; py++) {
          // how far inside the paving the pixel to the left lies (NaN where nothing is painted)
          let left = NaN;
          for (let px = 0; px < r.width; px++) {
            const k = (py * r.width + px) * 4,
              d = r.pixels[k + 3] === 255 ? readAt(c, r, px, py).d : NaN,
              was = left;
            left = d;
            if (!(Math.abs(was - PAVING_SOLID) <= 0.06 && Math.abs(d - PAVING_SOLID) <= 0.06))
              continue;
            if (was >= PAVING_SOLID === d >= PAVING_SOLID) continue;
            const [inner, outer] = was >= PAVING_SOLID ? [k - 4, k] : [k, k - 4];
            ratios.push(light(r, inner) / light(r, outer));
          }
        }
      ratios.sort((a, b) => a - b);
      const median = ratios[Math.floor(ratios.length / 2)];
      expect(ratios.length, c.name).toBeGreaterThan(40);
      expect(Math.abs(median - 1), `${c.name}: median ratio ${median}`).toBeLessThan(0.03);
    }
    // the snow is there to show a step: the worn joints and the fringe show it (by 60 of 765)
    let snowed = 0;
    for (const [i, r] of snowy.chunks.entries()) {
      const bare = hill.chunks[i];
      for (let k = 0; k < r.pixels.length; k += 4) {
        if (r.pixels[k + 3] !== 255 || light(r, k) < light(bare, k) + 60) continue;
        const p = k / 4,
          d = readAt(snowy, r, p % r.width, Math.floor(p / r.width)).d;
        if (d > -PAVING_FRINGE && d < PAVING_SOLID) snowed++;
      }
    }
    expect(snowed, 'snowed pixels in the worn edge and the fringe').toBeGreaterThan(200);
  }, 40_000);

  // Slow: reads the point under every pixel of eight chunks and paints the paving there (about
  // 0.5 s alone).
  it('lights the solid paving on a level top by its level alone, untinted and unshaded', () => {
    const around = [
      [0.15, 0],
      [-0.15, 0],
      [0, 0.15],
      [0, -0.15],
    ];
    for (const c of [flat, hill]) {
      const { map } = c.w,
        step = c.relief.style.step,
        heightLight = c.relief.style.heightLight ?? 0,
        out = [0, 0, 0];
      let checked = 0,
        raised = 0;
      for (const r of c.chunks)
        for (let py = 0; py < r.height; py++)
          for (let px = 0; px < r.width; px++) {
            const k = (py * r.width + px) * 4;
            if (r.pixels[k + 3] !== 255) continue;
            const { tx, ty, z, d } = readAt(c, r, px, py);
            if (d < PAVING_SOLID) continue;
            // on a level top, where neither a bank's slope nor its rims light it (faceShade)
            const top = reliefHeight(map, c.relief, tx, ty);
            if (around.some(([dx, dy]) => reliefHeight(map, c.relief, tx + dx, ty + dy) !== top))
              continue;
            // the paving's own colour, times the light the shipped style gives a level
            c.paving.paint(tx, ty, d, null, 1, out);
            const lit = 1 + heightLight * (z / step);
            for (let ch = 0; ch < 3; ch++)
              if (Math.abs(r.pixels[k + ch] - out[ch] * lit) > 0.51)
                expect.fail(
                  `${c.name}: pixel ${px},${py} of chunk ${r.left},${r.top} at ${tx.toFixed(3)},` +
                    `${ty.toFixed(3)}, level ${(z / step).toFixed(3)}, ${d.toFixed(3)} in: ` +
                    `[${r.pixels.slice(k, k + 3).join()}], not the paving's ` +
                    `[${out.map((v) => v.toFixed(1)).join()}] lit by ${lit.toFixed(3)}`,
                );
            checked++;
            if (z > step / 2) raised++;
          }
      expect(checked, c.name).toBeGreaterThan(2000);
      if (c === hill) expect(raised, c.name).toBeGreaterThan(2000);
    }
  }, 40_000);

  it('paints the pixels two neighbouring chunks share alike on a hill and in snow too', () => {
    // the chunks at 0,0 and 8,0; 8,0 and 8,8; 0,8 and 8,8; 0,0 and 0,8
    const pairs = [
      [0, 1],
      [1, 3],
      [2, 3],
      [0, 2],
    ];
    for (const c of [hill, snowy]) {
      let shared = 0,
        solid = 0;
      for (const [i, j] of pairs) {
        const ra = c.chunks[i],
          rb = c.chunks[j],
          ox = ra.left - rb.left,
          oy = ra.top - rb.top;
        for (let py = 0; py < ra.height; py++)
          for (let px = 0; px < ra.width; px++) {
            const ka = (py * ra.width + px) * 4,
              bx = px + ox,
              by = py + oy;
            if (ra.pixels[ka + 3] !== 255 || bx < 0 || by < 0 || bx >= rb.width || by >= rb.height)
              continue;
            const kb = (by * rb.width + bx) * 4;
            if (rb.pixels[kb + 3] !== 255) continue;
            shared++;
            const { z, d } = readAt(c, ra, px, py);
            if (d >= PAVING_SOLID && z > 0) solid++;
            for (let ch = 0; ch < 3; ch++)
              if (rb.pixels[kb + ch] !== ra.pixels[ka + ch])
                expect.fail(
                  `${c.name}: pixel ${px},${py} of chunk ${ra.left},${ra.top} is ` +
                    `[${ra.pixels.slice(ka, ka + 3).join()}], and ` +
                    `[${rb.pixels.slice(kb, kb + 3).join()}] in chunk ${rb.left},${rb.top} ` +
                    `(${d.toFixed(3)} inside the paving)`,
                );
          }
      }
      // 4558 shared pixels, 2787 of them on the raised solid paving, which the painter lights
      // without painting the ground under it
      expect(shared, c.name).toBeGreaterThan(2000);
      expect(solid, `${c.name}: shared pixels of raised solid paving`).toBeGreaterThan(1000);
    }
  });

  it('keeps grass tufts and stones off the paving, and leaves those beyond its fringe be', () => {
    /** Each tuft's and each stone's map point and its key, from a flat chunk's reply. */
    const scatter = (r: Reply) => {
      const out: { kind: 'tuft' | 'stone'; key: string; x: number; y: number }[] = [],
        point = (sx: number, sy: number) => {
          const a = (sx + r.left) / 32,
            b = (sy + r.top) / 16;
          return { x: (a + b) / 2, y: (b - a) / 2 };
        };
      for (let k = 0; k + 3 < r.grass.length; k += 4)
        out.push({
          kind: 'tuft',
          key: `tuft ${r.grass.slice(k, k + 4).join()}`,
          ...point(r.grass[k], r.grass[k + 1]),
        });
      // a stone's shadow lies 0.3 below the stone
      for (let k = 0; k + 1 < r.stones.length; k += 2)
        out.push({
          kind: 'stone',
          key: `stone ${r.stones[k]},${r.stones[k + 1]}`,
          ...point(r.stones[k], r.stones[k + 1] - 0.3),
        });
      return out;
    };
    const { map } = flat.w,
      inside = (x: number, y: number) =>
        flat.paving.near(Math.round(y) * map.w + Math.round(x)) ? flat.paving.distance(x, y) : -9;
    const taken = { tuft: 0, stone: 0 },
      kept = { tuft: 0, stone: 0 };
    for (const [i, r] of flat.chunks.entries()) {
      const town = scatter(r),
        none = scatter(bare.chunks[i]),
        before = new Set(none.map((s) => s.key)),
        after = new Set(town.map((s) => s.key));
      const at = (s: (typeof town)[number]) =>
        `chunk ${r.left},${r.top}: ${s.key} at ${s.x.toFixed(3)},${s.y.toFixed(3)}, ` +
        `${inside(s.x, s.y).toFixed(3)} inside the paving`;
      for (const s of town) {
        // the paving only takes scatter away, and leaves none on it
        if (!before.has(s.key)) expect.fail(`${at(s)}, which the map with no town does not have`);
        if (inside(s.x, s.y) > 0) expect.fail(`${at(s)}, on the paving`);
      }
      for (const s of none) {
        const d = inside(s.x, s.y);
        if (d > 0) taken[s.kind]++;
        else if (d <= -PAVING_FRINGE) {
          kept[s.kind]++;
          if (!after.has(s.key)) expect.fail(`${at(s)}, beyond the fringe, is gone`);
        }
      }
    }
    // the map with no town has scatter where the paving lies (606 tufts, 37 stones), and the town
    // keeps what is beyond it (1054 and 50)
    expect(taken.tuft, 'tufts the paving takes').toBeGreaterThan(300);
    expect(taken.stone, 'stones the paving takes').toBeGreaterThan(15);
    expect(kept.tuft, 'tufts beyond the fringe').toBeGreaterThan(500);
    expect(kept.stone, 'stones beyond the fringe').toBeGreaterThan(20);
  });
});

describe('the painter with building yards', () => {
  /** Buildings on the grass south of the town, west of the river: a station, a farm and a house. */
  function yarded() {
    const w = world(),
      bare = { ...w, city: [], doorsteps: [] };
    const yards = (
      [
        ['structures/station_2', 5, 14],
        ['structures/farm_1', 9, 14],
        ['structures/townhouse', 12, 15],
      ] as const
    ).map(([frame, x, y]) =>
      buildingYard(frame, groundOf(frame)!, { x, y, scale: 0.8, sandy: false }, [], () => false),
    );
    return { bare, built: { ...bare, yards } };
  }

  // Slow: paints four chunks twice and checks every pixel (about 2 s alone).
  it('wears each yard into the ground on the tiles it lists, and changes nothing elsewhere', async () => {
    const { bare, built } = yarded(),
      { map } = bare,
      listed = new Set(built.yards.flatMap((y) => yardTiles(y, map.w, map.h))),
      yards = new BuildingYards(map.w, map.h, map.originX, map.originY, built.yards);
    let off = 0,
      inside = 0;
    for (const [x, y] of [
      [0, 8],
      [8, 8],
      [0, 16],
      [8, 16],
    ]) {
      const a = await paint(built, x, y),
        b = await paint(bare, x, y);
      for (let py = 0; py < a.height; py++)
        for (let px = 0; px < a.width; px++) {
          const k = (py * a.width + px) * 4;
          if (a.pixels[k + 3] !== 255) continue;
          const [tx, ty] = pointOf(a, px, py, 1),
            tile = Math.round(ty) * map.w + Math.round(tx);
          if (!listed.has(tile)) {
            off++;
            for (let c = 0; c < 3; c++)
              expect(a.pixels[k + c], `pixel ${px},${py} of ${x},${y}`).toBe(b.pixels[k + c]);
          } else if (yards.weigh(tx, ty, tile) === 1) {
            inside++;
            // grass is green; a whole yard is the grey or brown of its ground
            expect(a.pixels[k + 1] - a.pixels[k + 2], `pixel ${px},${py}`).toBeLessThan(
              b.pixels[k + 1] - b.pixels[k + 2],
            );
          }
        }
    }
    expect(off).toBeGreaterThan(5000);
    expect(inside).toBeGreaterThan(500);
  }, 30_000);

  // Slow: paints a chunk with its tufts (about 0.35 s alone), so the limit is 10 s.
  it('grows no grass tufts on a yard', async () => {
    const { built } = yarded(),
      { map } = built,
      yards = new BuildingYards(map.w, map.h, map.originX, map.originY, built.yards);
    let tufts = 0;
    for (const [x, y] of [
      [0, 8],
      [8, 8],
    ]) {
      const r = await paint(built, x, y);
      for (let i = 0; i < r.grass.length; i += 4) {
        // a tuft stands at its map point on flat ground (pointOf at one pixel per world pixel)
        const sx = r.grass[i] + r.left,
          sy = r.grass[i + 1] + r.top,
          tx = sx / 64 + sy / 32,
          ty = sy / 32 - sx / 64;
        tufts++;
        expect(
          yards.weigh(tx, ty, Math.round(ty) * map.w + Math.round(tx)),
          `tuft at ${tx}, ${ty}`,
        ).toBeLessThanOrEqual(0.5);
      }
    }
    expect(tufts).toBeGreaterThan(50);
  }, 10_000);
});

/** The yard of `frame` with its footprint's (one) tile at (x, y), as drawn at `scale`. */
const yardAt = (frame: string, x: number, y: number, scale = 1) =>
  buildingYard(frame, groundOf(frame)!, { x, y, scale, sandy: false }, [], () => false);

describe('the painter with yards beside water, paving and chunk edges', () => {
  // Slow: paints three chunks of a hill twice and checks every pixel (about 2 s alone).
  it('keeps every yard off a steep bank', async () => {
    const w = onHill(world()),
      bare = { ...w, city: [], doorsteps: [] },
      { map } = w,
      relief = buildRelief(map, new Set()),
      // a house, a farm and a water tower astride the hill's west, south and east banks
      yards = [
        yardAt('structures/townhouse', 3, 7),
        yardAt('structures/farm_1', 7, 13),
        yardAt('structures/water_tower', 14, 4),
      ],
      painter = new BuildingYards(map.w, map.h, map.originX, map.originY, yards);
    expect(relief.tiles).toBeDefined();
    let steep = 0,
      level = 0;
    const touched: string[] = [];
    for (const [x, y] of [
      [0, 0],
      [0, 8],
      [8, 0],
    ]) {
      const a = await paint({ ...bare, yards }, x, y),
        b = await paint(bare, x, y);
      for (let py = 0; py < a.height; py++)
        for (let px = 0; px < a.width; px++) {
          const k = (py * a.width + px) * 4;
          if (a.pixels[k + 3] !== 255) continue;
          // the map point the painter reads here, raised as it raises it
          const [bx, by] = pointOf(a, px, py, 1),
            z = surfaceAlongRay(map, relief, bx, by, 10),
            tx = bx + z / 32,
            ty = by + z / 32,
            tile = Math.round(ty) * map.w + Math.round(tx);
          if (!painter.near(tile) || !painter.weigh(tx, ty, tile)) continue;
          // the levels the surface climbs per tile here, as the painter measures a terrace's slope
          const d = 0.05,
            gx =
              (reliefHeight(map, relief, tx + d, ty) - reliefHeight(map, relief, tx - d, ty)) / 0.1,
            gy =
              (reliefHeight(map, relief, tx, ty + d) - reliefHeight(map, relief, tx, ty - d)) / 0.1,
            levels = Math.hypot(gx, gy) / relief.style.step;
          if (levels < 0.6) {
            if (levels < 0.25) level++;
            continue;
          }
          steep++;
          const was = [...b.pixels.subarray(k, k + 3)],
            now = [...a.pixels.subarray(k, k + 3)];
          if (now.some((c, i) => c !== was[i]))
            touched.push(
              `${levels.toFixed(2)} levels a tile at ${tx.toFixed(3)}, ${ty.toFixed(3)} ` +
                `(chunk ${x},${y} pixel ${px},${py}): ${was} painted ${now}`,
            );
        }
    }
    // the yards reach well over the banks, and over the level ground beside them
    expect(steep).toBeGreaterThan(200);
    expect(level).toBeGreaterThan(1000);
    expect(touched.slice(0, 5), `${touched.length} pixels painted`).toEqual([]);
  }, 40_000);

  // The kerb's dark foot line lies past the platform, on whatever ground is there: on a steep
  // bank it is given no share of the point, like the rest of the yard. Slow: paints four chunks of
  // a hill twice and checks every pixel (about 3.5 s alone; the limit is 60 s).
  it("keeps a platform's kerb and the dark line at its foot off a steep bank", async () => {
    const w = onHill(world()),
      bare = { ...w, city: [], doorsteps: [] },
      { map } = w,
      relief = buildRelief(map, new Set()),
      // stations on the hill's edges, two to a side, their platforms facing out over its banks
      yards = (
        [
          ['structures/station_2', 8, 13],
          ['structures/station_1', 5, 12],
          ['structures/station_1_r3', 14, 5],
          ['structures/station_3_r3', 13, 9],
          ['structures/station_1_r2', 9, 1],
          ['structures/station_2_r2', 11, 2],
          ['structures/station_1_r1', 3, 4],
          ['structures/station_2_r1', 4, 10],
        ] as const
      ).map(([frame, x, y]) => yardAt(frame, x, y)),
      painter = new BuildingYards(map.w, map.h, map.originX, map.originY, yards);
    expect(relief.tiles).toBeDefined();
    const seen = { foot: 0, platform: 0 },
      touched: string[] = [];
    for (const [x, y] of [
      [0, 0],
      [8, 0],
      [0, 8],
      [8, 8],
    ]) {
      const a = await paint({ ...bare, yards }, x, y),
        b = await paint(bare, x, y);
      for (let py = 0; py < a.height; py++)
        for (let px = 0; px < a.width; px++) {
          const k = (py * a.width + px) * 4;
          if (a.pixels[k + 3] !== 255) continue;
          // the map point the painter reads here, raised as it raises it
          const [bx, by] = pointOf(a, px, py, 1),
            z = surfaceAlongRay(map, relief, bx, by, 10),
            tx = bx + z / 32,
            ty = by + z / 32,
            tile = Math.round(ty) * map.w + Math.round(tx);
          if (!painter.near(tile)) continue;
          painter.weigh(tx, ty, tile);
          if (!painter.touched) continue;
          // the levels the surface climbs per tile here, as the painter measures a terrace's slope
          const d = 0.05,
            gx =
              (reliefHeight(map, relief, tx + d, ty) - reliefHeight(map, relief, tx - d, ty)) / 0.1,
            gy =
              (reliefHeight(map, relief, tx, ty + d) - reliefHeight(map, relief, tx, ty - d)) / 0.1;
          if (Math.hypot(gx, gy) / relief.style.step < 0.6) continue;
          if (painter.weight > 0) seen.platform++;
          else seen.foot++;
          const was = [...b.pixels.subarray(k, k + 3)],
            now = [...a.pixels.subarray(k, k + 3)];
          if (now.some((c, i) => c !== was[i]))
            touched.push(
              `${painter.weight > 0 ? 'platform' : 'foot line'} at ${tx.toFixed(3)}, ` +
                `${ty.toFixed(3)} (chunk ${x},${y} pixel ${px},${py}): ${was} painted ${now}`,
            );
        }
    }
    // the kerbs' foot lines and their platforms both reach over the banks
    expect(seen.foot, 'foot line pixels on a steep bank').toBeGreaterThan(60);
    expect(seen.platform, 'platform pixels on a steep bank').toBeGreaterThan(2000);
    expect(touched.slice(0, 5), `${touched.length} pixels painted`).toEqual([]);
  }, 60_000);

  // Slow: paints two chunks twice and checks every pixel (about a second alone).
  it('keeps every yard out of the water and off the solid paving', async () => {
    const w = world(),
      { map } = w,
      paved = new Set(w.city),
      paving = new TownPaving(map.w, map.h, map.originX, map.originY, w.city, w.doorsteps);
    // stations whose platforms face the river, a house by the river, and two yards in the town
    const yards = [
      yardAt('structures/station_2_r3', 14, 14),
      yardAt('structures/station_2_r1', 17, 13),
      yardAt('structures/townhouse', 14, 13),
      yardAt('structures/townhouse', 10, 8),
      yardAt('structures/farm_1', 12, 10),
    ];
    let water = 0,
      solid = 0;
    const touched: string[] = [];
    for (const [x, y] of [
      [8, 8],
      [16, 8],
    ]) {
      const a = await paint({ ...w, yards }, x, y),
        b = await paint(w, x, y);
      for (let py = 0; py < a.height; py++)
        for (let px = 0; px < a.width; px++) {
          const k = (py * a.width + px) * 4;
          if (a.pixels[k + 3] !== 255) continue;
          const [tx, ty] = pointOf(a, px, py, 1),
            tile = Math.round(ty) * map.w + Math.round(tx),
            onPaving = paving.near(tile) && paving.distance(tx, ty) >= PAVING_SOLID,
            inWater = !paved.has(tile) && paintedWater(map, tx, ty) >= 1 - 1e-9;
          if (!onPaving && !inWater) continue;
          if (onPaving) solid++;
          else water++;
          const was = [...b.pixels.subarray(k, k + 3)],
            now = [...a.pixels.subarray(k, k + 3)];
          if (now.some((c, i) => c !== was[i]))
            touched.push(
              `${onPaving ? 'paving' : 'water'} at ${tx.toFixed(3)}, ${ty.toFixed(3)} ` +
                `(chunk ${x},${y} pixel ${px},${py}): ${was} painted ${now}`,
            );
        }
    }
    expect(water).toBeGreaterThan(1000);
    expect(solid).toBeGreaterThan(1000);
    expect(touched.slice(0, 5), `${touched.length} pixels painted`).toEqual([]);
  }, 30_000);

  // Slow: paints four pairs of chunks, two at twice the size (about 3 s alone).
  it('paints the pixels two neighbouring chunks share alike, yards and kerbs across their edge', async () => {
    const w = world(),
      bare = { ...w, city: [], doorsteps: [] },
      yards = [
        // a platform's kerb across x = 7.5, a house's yard and a farm's across y = 7.5
        yardAt('structures/station_2_r1', 8, 12),
        yardAt('structures/townhouse', 7, 10),
        yardAt('structures/farm_1', 10, 7),
        yardAt('structures/water_tower', 8, 8),
      ],
      painter = new BuildingYards(w.map.w, w.map.h, w.map.originX, w.map.originY, yards);
    for (const scale of [1, 2])
      for (const [a, b] of [
        [
          [0, 8],
          [8, 8],
        ],
        [
          [8, 0],
          [8, 8],
        ],
      ]) {
        const ra = await paint({ ...bare, yards }, a[0], a[1], scale),
          rb = await paint({ ...bare, yards }, b[0], b[1], scale);
        const ox = (ra.left - rb.left) * scale,
          oy = (ra.top - rb.top) * scale;
        let shared = 0,
          yard = 0;
        for (let py = 0; py < ra.height; py++)
          for (let px = 0; px < ra.width; px++) {
            const ka = (py * ra.width + px) * 4,
              bx = px + ox,
              by = py + oy;
            if (ra.pixels[ka + 3] !== 255 || bx < 0 || by < 0 || bx >= rb.width || by >= rb.height)
              continue;
            const kb = (by * rb.width + bx) * 4;
            if (rb.pixels[kb + 3] !== 255) continue;
            shared++;
            const [tx, ty] = pointOf(ra, px, py, scale),
              tile = Math.round(ty) * w.map.w + Math.round(tx);
            if (painter.near(tile)) {
              painter.weigh(tx, ty, tile);
              if (painter.touched) yard++;
            }
            for (let c = 0; c < 3; c++)
              expect(rb.pixels[kb + c], `scale ${scale}, pixel ${px},${py}`).toBe(
                ra.pixels[ka + c],
              );
          }
        expect(shared).toBeGreaterThan(50 * scale);
        expect(yard, `chunks ${a} and ${b} at ${scale}`).toBeGreaterThan(10 * scale);
      }
  }, 80_000);

  // Slow: paints one chunk twice and reads every pixel (about 0.35 s alone; the limit is 10 s).
  it("keeps a stone yard's colour under any season's tint, and tints an earth yard with the ground", async () => {
    const w = world(),
      bare = { ...w, city: [], doorsteps: [] },
      { map } = w,
      sites = [
        ['structures/station_2', 10, 12, true],
        ['structures/water_tower', 12, 10, true],
        ['structures/quarry_2', 10, 14, true],
        ['structures/farm_1', 13, 13, false],
      ] as const,
      yards = sites.map(([frame, x, y]) => yardAt(frame, x, y)),
      alone = yards.map((y) => new BuildingYards(map.w, map.h, map.originX, map.originY, [y]));
    const summer = await paint({ ...bare, yards, tint: 0xd8e8c0 }, 8, 8),
      autumn = await paint({ ...bare, yards, tint: 0xe8b878 }, 8, 8);
    const seen = [0, 0];
    for (let py = 0; py < summer.height; py++)
      for (let px = 0; px < summer.width; px++) {
        const k = (py * summer.width + px) * 4;
        if (summer.pixels[k + 3] !== 255) continue;
        const [tx, ty] = pointOf(summer, px, py, 1),
          tile = Math.round(ty) * map.w + Math.round(tx);
        // inside one building's yard, wholly
        const whole = alone.findIndex((p) => p.near(tile) && p.weigh(tx, ty, tile) === 1);
        if (whole < 0 || alone.some((p, i) => i !== whole && p.near(tile) && p.weigh(tx, ty, tile)))
          continue;
        const stone = sites[whole][3],
          a = [...summer.pixels.subarray(k, k + 3)],
          b = [...autumn.pixels.subarray(k, k + 3)],
          where = `${sites[whole][0]} at ${tx}, ${ty}`;
        seen[stone ? 0 : 1]++;
        if (stone)
          for (let c = 0; c < 3; c++) expect(Math.abs(a[c] - b[c]), where).toBeLessThanOrEqual(1);
        // the autumn tint is redder and far less blue than the summer one
        else expect(b[2] - a[2], where).toBeLessThan(-10);
      }
    expect(seen[0], 'whole stone yard pixels').toBeGreaterThan(300);
    expect(seen[1], 'whole earth yard pixels').toBeGreaterThan(100);
  }, 10_000);
});

/** The road tiles of a map `w` wide and their codes, as the renderer hands them over. */
function roadList(w: number, h: number, tiles: [number, number][]) {
  const at = new Set(tiles.map(([x, y]) => y * w + x)),
    has = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && at.has(y * w + x),
    out: number[] = [];
  for (const k of at) out.push(k, roadCode(roadSides(has, [], k % w, Math.floor(k / w)), 0));
  return out;
}

describe('the painter with roads', () => {
  /**
   * The world() town and river with roads: one along y = 13 from the forest over the river, one
   * along x = 9 from the middle of the town south to it, and a lone tile.
   */
  function roaded() {
    const w = world(),
      tiles: [number, number][] = [[20, 5]];
    for (let x = 0; x < 22; x++) tiles.push([x, 13]);
    for (let y = 5; y < 13; y++) tiles.push([9, y]);
    const roads = roadList(w.map.w, w.map.h, tiles),
      paving = new TownPaving(w.map.w, w.map.h, w.map.originX, w.map.originY, w.city, w.doorsteps),
      painter = new RoadPaint(w.map.w, w.map.h, w.map.originX, w.map.originY, roads, (k) =>
        paving.paved(k),
      );
    // the same roads read for the lanes they lay across the paving (#476)
    const lanes = new RoadPaint(
      w.map.w,
      w.map.h,
      w.map.originX,
      w.map.originY,
      roads,
      (k) => !paving.paved(k),
    );
    return { w, roads, paving, painter, lanes };
  }
  const CHUNKS = [
    [8, 8],
    [16, 8],
    [0, 8],
    [8, 0],
  ];

  // Slow: paints four chunks twice and checks every pixel (about 2 s alone).
  it('paints the roads where they weigh, out of the water, under the paving, and nothing else', async () => {
    const { w, roads, paving, painter, lanes } = roaded();
    const { map } = w;
    let road = 0,
      faded = 0,
      water = 0,
      laid = 0,
      changed = 0;
    for (const [x, y] of CHUNKS) {
      const a = await paint({ ...w, roads }, x, y),
        b = await paint(w, x, y);
      for (let py = 0; py < a.height; py++)
        for (let px = 0; px < a.width; px++) {
          const k = (py * a.width + px) * 4;
          if (a.pixels[k + 3] !== 255) continue;
          const [tx, ty] = pointOf(a, px, py, 1),
            tile = Math.round(ty) * map.w + Math.round(tx),
            weight = painter.weigh(tx, ty, tile),
            pave = paving.near(tile) ? paving.distance(tx, ty) : -9,
            wet = paintedWater(map, tx, ty, paving.paved(tile));
          const same = () => {
            for (let c = 0; c < 3; c++)
              expect(a.pixels[k + c], `pixel ${px},${py} of ${x},${y}`).toBe(b.pixels[k + c]);
          };
          // a road across the paving is a lane of setts, not gravel: it changes the paving itself,
          // by the lane's reach and no farther
          const lane = pave > 0 && lanes.near(tile) ? lanes.centre(tx, ty, tile) : Infinity;
          if (lane < LANE_REACH) {
            laid++;
            for (let c = 0; c < 3; c++) if (a.pixels[k + c] !== b.pixels[k + c]) changed++;
          } else if (weight === 0 || pavingFade(pave) === 0) same();
          else if (wet >= 1 - 1e-9) {
            water++;
            same();
          } else if (weight === 1 && pavingFade(pave) === 1 && wet === 0) {
            road++;
            // grass is green; gravel is warm, red over green over blue
            expect(a.pixels[k] - a.pixels[k + 1], `pixel ${px},${py}`).toBeGreaterThan(0);
            expect(a.pixels[k + 1] - a.pixels[k + 2], `pixel ${px},${py}`).toBeGreaterThan(5);
          } else if (pave > -0.17) faded++;
        }
    }
    expect(road).toBeGreaterThan(2000);
    expect(water).toBeGreaterThan(100);
    expect(faded).toBeGreaterThan(20);
    expect(laid).toBeGreaterThan(300);
    expect(changed).toBeGreaterThan(laid);
  }, 30_000);

  // Slow: paints four chunks and works out the paving at every pixel of the lane (about 1 s
  // alone), so the limit is 30 s.
  it('lays the lane of a road across the paving by its distance and axis, along x and along y alike', async () => {
    // a road along x on row 7 and one along y on column 9, crossing in the middle of the town
    const w = world(),
      tiles: [number, number][] = [];
    for (let x = 3; x <= 15; x++) tiles.push([x, 7]);
    for (let y = 4; y <= 12; y++) if (y !== 7) tiles.push([9, y]);
    const roads = roadList(w.map.w, w.map.h, tiles),
      { map } = w,
      paving = new TownPaving(map.w, map.h, map.originX, map.originY, w.city, w.doorsteps),
      gravel = new RoadPaint(map.w, map.h, map.originX, map.originY, roads, (k) => paving.paved(k)),
      lanes = new RoadPaint(map.w, map.h, map.originX, map.originY, roads, (k) => !paving.paved(k)),
      out = [0, 0, 0],
      onAxis = [0, 0, 0];
    for (const [x, y] of CHUNKS) {
      const a = await paint({ ...w, roads }, x, y);
      for (let py = 0; py < a.height; py++)
        for (let px = 0; px < a.width; px++) {
          const k = (py * a.width + px) * 4;
          if (a.pixels[k + 3] !== 255) continue;
          // the map is flat, so the pixel's point is the map point
          const [tx, ty] = pointOf(a, px, py, 1),
            tile = Math.round(ty) * map.w + Math.round(tx),
            d = paving.near(tile) ? paving.distance(tx, ty) : -9;
          if (d < PAVING_SOLID || !lanes.near(tile) || gravel.weigh(tx, ty, tile) > 0) continue;
          const lane = lanes.centre(tx, ty, tile),
            axis = lanes.axis(tx, ty, tile);
          if (lane >= LANE_REACH) continue;
          // on the paving, the pixel is the paving's colour at that point, with that lane
          paving.paint(tx, ty, d, null, 1, out, lane, axis);
          for (let c = 0; c < 3; c++)
            if (Math.abs(a.pixels[k + c] - out[c]) > 0.51)
              expect.fail(
                `pixel ${px},${py} of chunk ${x},${y} at ${tx.toFixed(3)},${ty.toFixed(3)}, ` +
                  `lane ${lane.toFixed(3)}, axis ${axis}: [${a.pixels.slice(k, k + 3).join()}], ` +
                  `not [${out.map((v) => v.toFixed(1)).join()}]`,
              );
          if (lane < ROAD_HALF) onAxis[axis]++;
        }
    }
    // lane pixels were checked, along both axes
    expect(onAxis[1]).toBeGreaterThan(150);
    expect(onAxis[2]).toBeGreaterThan(150);
  }, 30_000);

  it('grows no tuft and lays no loose stone on a road, and keeps those beside it', async () => {
    const { w, roads, painter } = roaded();
    const { map } = w;
    let kept = 0,
      taken = 0,
      edge = 0;
    for (const [x, y] of CHUNKS) {
      const a = await paint({ ...w, roads }, x, y),
        b = await paint(w, x, y);
      const tufts = (r: Reply) => {
        const out = new Map<string, [number, number]>();
        for (let i = 0; i < r.grass.length; i += 4) {
          const sx = r.grass[i] + r.left,
            sy = r.grass[i + 1] + r.top;
          out.set(r.grass.slice(i, i + 4).join(), [sx / 64 + sy / 32, sy / 32 - sx / 64]);
        }
        return out;
      };
      const on = tufts(a),
        off = tufts(b);
      for (const [key, [tx, ty]] of off) {
        const tile = Math.round(ty) * map.w + Math.round(tx),
          core = painter.onCore(tx, ty, tile);
        expect(on.has(key), `tuft at ${tx}, ${ty}`).toBe(!core);
        if (core) taken++;
        else {
          kept++;
          painter.weigh(tx, ty, tile);
          if (painter.dist > ROAD_HALF - ROAD_FEATHER / 2 && painter.dist < ROAD_HALF + 0.03)
            edge++;
        }
      }
      for (let i = 0; i + 1 < a.stones.length; i += 2) {
        const sx = a.stones[i] + a.left,
          sy = a.stones[i + 1] - 0.3 + a.top,
          tx = sx / 64 + sy / 32,
          ty = sy / 32 - sx / 64;
        expect(painter.onCore(tx, ty, Math.round(ty) * map.w + Math.round(tx))).toBe(false);
      }
    }
    expect(taken).toBeGreaterThan(20);
    expect(kept).toBeGreaterThan(300);
    // tufts may stand on the soft edge
    expect(edge).toBeGreaterThan(0);
  }, 30_000);

  // Slow: paints the chunk a road and a yard share (about 0.4 s alone), so the limit is 10 s.
  it("lies over a building's yard where they meet: the road is painted after it", async () => {
    const { w, roads, painter } = roaded();
    // a house south of the road along y = 13, its yard and its door path run on to the road
    const yards = [
      buildingYard(
        'structures/townhouse',
        groundOf('structures/townhouse')!,
        { x: 5, y: 14, scale: 0.8, sandy: false },
        // a street door on its N wall, on to the road's tile
        [{ tile: { x: 5, y: 14 }, side: Dir.N }],
        (x, y) => y === 13 && x >= 0 && x < 22,
      ),
    ];
    const under = new BuildingYards(w.map.w, w.map.h, w.map.originX, w.map.originY, yards);
    const a = await paint({ ...w, roads, yards }, 0, 8),
      b = await paint({ ...w, roads }, 0, 8),
      c = await paint({ ...w, yards }, 0, 8);
    let over = 0;
    for (let py = 0; py < a.height; py++)
      for (let px = 0; px < a.width; px++) {
        const k = (py * a.width + px) * 4;
        if (a.pixels[k + 3] !== 255) continue;
        const [tx, ty] = pointOf(a, px, py, 1),
          tile = Math.round(ty) * w.map.w + Math.round(tx);
        if (painter.weigh(tx, ty, tile) < 1 || under.weigh(tx, ty, tile) === 0) continue;
        over++;
        // the yard is there, and the road covers it whole
        expect(c.pixels.slice(k, k + 3)).not.toEqual(b.pixels.slice(k, k + 3));
        for (let ch = 0; ch < 3; ch++) expect(a.pixels[k + ch]).toBe(b.pixels[k + ch]);
      }
    expect(over).toBeGreaterThan(20);
  }, 10_000);

  // Slow: paints six chunks, three at twice the size (about 3 s alone).
  it('paints the pixels two neighbouring chunks share alike, roads across their edge', async () => {
    const { w, roads } = roaded();
    for (const scale of [1, 2])
      for (const [a, b] of [
        [
          [0, 8],
          [8, 8],
        ],
        [
          [8, 0],
          [8, 8],
        ],
      ]) {
        const ra = await paint({ ...w, roads }, a[0], a[1], scale),
          rb = await paint({ ...w, roads }, b[0], b[1], scale);
        const ox = (ra.left - rb.left) * scale,
          oy = (ra.top - rb.top) * scale;
        let shared = 0;
        for (let py = 0; py < ra.height; py++)
          for (let px = 0; px < ra.width; px++) {
            const ka = (py * ra.width + px) * 4,
              bx = px + ox,
              by = py + oy;
            if (ra.pixels[ka + 3] !== 255 || bx < 0 || by < 0 || bx >= rb.width || by >= rb.height)
              continue;
            const kb = (by * rb.width + bx) * 4;
            if (rb.pixels[kb + 3] !== 255) continue;
            shared++;
            for (let c = 0; c < 3; c++)
              expect(rb.pixels[kb + c], `scale ${scale}, pixel ${px},${py}`).toBe(
                ra.pixels[ka + c],
              );
          }
        expect(shared).toBeGreaterThan(50 * scale);
      }
  }, 60_000);
});
