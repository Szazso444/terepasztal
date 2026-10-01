// Runs landscape.worker.ts under Node: paints every chunk of a generated world and hashes the
// output, so a change to the painter can be timed and proven pixel-identical.
// node scratchpad/perf/paint.mjs  (bundles this file with esbuild first)
import { PNG } from 'pngjs';
import fs from 'node:fs';
import { generateMap } from '../../src/world/mapgen';
import { buildRelief } from '../../src/render/terrainRelief';

const png = PNG.sync.read(fs.readFileSync('public/assets/terrain-surfaces.png'));
class Ctx {
  constructor(
    private w: number,
    private h: number,
  ) {}
  data = new Uint8ClampedArray(0);
  drawImage() {}
  getImageData() {
    return this.data.length ? { data: this.data } : { data: new Uint8ClampedArray(png.data) };
  }
  putImageData(img: { data: Uint8ClampedArray }) {
    this.data = img.data;
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
const g = globalThis as any;
g.OffscreenCanvas = class {
  ctx: Ctx;
  constructor(
    public width: number,
    public height: number,
  ) {
    this.ctx = new Ctx(width, height);
  }
  getContext() {
    return this.ctx;
  }
  transferToImageBitmap() {
    return { pixels: this.ctx.data, close() {} };
  }
};
g.ImageData = class {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
};
g.createImageBitmap = async () => ({ width: png.width, height: png.height, close() {} });
g.fetch = async () => ({ ok: true, blob: async () => null });
const replies: any[] = [];
g.self = { postMessage: (m: any) => replies.push(m) };
await import('../../src/render/landscape.worker');
const send = (data: any) => g.self.onmessage({ data });

const map: any = generateMap(7412, { w: 128, h: 128 });
map.originX ??= 0;
map.originY ??= 0;
const relief = buildRelief(map, new Set());
await send({ url: 'x' });
await send({
  map: {
    w: map.w,
    h: map.h,
    seed: map.seed,
    originX: map.originX,
    originY: map.originY,
    terrain: map.terrain,
    biome: map.biome,
  },
  relief,
  version: 0,
  tint: 0xffffff,
  city: [],
});
const only = Number(process.env.CHUNKS ?? 256);
const scale = Number(process.env.SCALE ?? 1);
let hash = 2166136261,
  n = 0;
const t = performance.now();
for (let y = 0; y < 128 && n < only; y += 8)
  for (let x = 0; x < 128 && n < only; x += 8, n++) {
    replies.length = 0;
    await send({ id: `${x},${y}`, x, y, w: 8, h: 8, version: 0, scale });
    const r = replies[0];
    if (r.error) throw Error(r.error);
    const px: Uint8ClampedArray = r.pixels ?? r.bitmap.pixels;
    for (let i = 0; i < px.length; i++) hash = Math.imul(hash ^ px[i], 16777619);
    for (const v of r.grass) hash = Math.imul(hash ^ Math.round(v * 1000), 16777619);
  }
console.log(
  JSON.stringify({ chunks: n, scale, ms: Math.round(performance.now() - t), hash: hash >>> 0 }),
);
