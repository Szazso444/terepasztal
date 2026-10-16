import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Dir } from '../engine/iso';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { BIOME_DEFS } from '../sim/biomes';
import { buildRelief, reliefHeight, surfaceAlongRay, type TerrainRelief } from './terrainRelief';
import { paintedWater } from './terrainMaterials';
import { pavingDoorsteps, PAVING_FRINGE, PAVING_SOLID, TownPaving } from './townPaving';

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
/** The 2D context the painter uses: it keeps the pixels put in, and gives the sheet otherwise. */
class Context {
  data: Uint8ClampedArray | null = null;
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
  ellipse() {}
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
};
let replies: Reply[] = [];
let send: (data: object) => Promise<void>;

beforeAll(async () => {
  const surfaces = sheet();
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      context = new Context(surfaces);
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
/** Paints the 8 x 8 chunk at (x, y); `snowLevels` by climate, the content's by default. */
async function paint(
  { map, city, doorsteps }: ReturnType<typeof world>,
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
    tint: 0xd8e8c0,
    city,
    doorsteps,
    snowLevels,
  });
  replies = [];
  await send({ id: `${x},${y}`, x, y, w: 8, h: 8, version: 1, scale });
  const reply = replies[0];
  expect(reply.error).toBeUndefined();
  return reply;
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
   * `snowLine` (the content's if none).
   */
  async function town(name: string, raise: boolean, snowLine?: number): Promise<Painted> {
    const w = raise ? onHill(world()) : world(),
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
  let flat: Painted, hill: Painted, snowy: Painted;
  // Slow: paints the town's four chunks three times (about 4 s alone).
  beforeAll(async () => {
    flat = await town('on the flat', false);
    hill = await town('on a hill', true);
    // level 2 is a level above this snow line: full snow on the ground, patches on level 1
    snowy = await town('on a hill above the snow line', true, 1);
  }, 80_000);

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
});
