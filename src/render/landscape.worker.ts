import { type LandscapeMap } from './landscapeModel';
import { reliefHeight, RELIEF_MAX, type TerrainRelief } from './terrainRelief';
import {
  grassDetail,
  rockExposure,
  shareSurfaceDetail,
  surfaceBlend,
  surfaceColor,
  surfaceMaterial,
} from './terrainMaterials';
import { hash2 } from '../engine/rng';
import { Terrain } from '../world/tiles';

let map: LandscapeMap,
  relief: TerrainRelief,
  samples: Uint8ClampedArray,
  reduced: Uint8ClampedArray;
let version = 0,
  tint = 0xffffff;
let city = new Set<number>();
self.onmessage = async (event: MessageEvent) => {
  const data = event.data;
  try {
    if (data.url) {
      const response = await fetch(data.url);
      if (!response.ok) throw Error(`Terrain surfaces: ${response.status}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
        ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      samples = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      reduced = halve(samples, canvas.width, canvas.height);
      shareSurfaceDetail(samples, reduced);
      self.postMessage({ loaded: true });
      return;
    }
    if (data.map) {
      map = data.map;
      relief = data.relief;
      version = data.version;
      tint = data.tint;
      city = new Set<number>(data.city);
      return;
    }
    if (data.version !== version) return;
    const started = performance.now(),
      { x, y, w, h, id } = data,
      scale: number = data.scale ?? 1,
      // Chunks drawn at one pixel per world pixel read a half-size copy, so they stay filtered.
      source = scale > 1 ? samples : reduced;
    const left = (x - y - h) * 32 - 4,
      top = (x + y - 1) * 16 - RELIEF_MAX - 5;
    const width = ((w + h) * 32 + 8) * scale,
      height = ((w + h) * 16 + RELIEF_MAX + 12) * scale;
    const canvas = new OffscreenCanvas(width, height),
      ctx = canvas.getContext('2d')!;
    const pixels = new Uint8ClampedArray(width * height * 4),
      color = [0, 0, 0],
      part = [0, 0, 0],
      blend = new Array<number>(8);
    let raised = false;
    for (let ty = Math.max(0, y - 2); ty < Math.min(map.h, y + h + 3) && !raised; ty++)
      for (let tx = Math.max(0, x - 2); tx < Math.min(map.w, x + w + 3); tx++)
        if (relief.centres[ty * map.w + tx] > 0) {
          raised = true;
          break;
        }
    for (let py = 0; py < height; py += 1)
      for (let px = 0; px < width; px += 1) {
        const sx = left + (px + 0.5) / scale,
          sy = top + (py + 0.5) / scale,
          bx = sx / 64 + sy / 32,
          by = sy / 32 - sx / 64;
        let z = 0;
        if (raised) {
          let lo = 0,
            hi = RELIEF_MAX;
          for (let n = 0; n < 10; n++) {
            const mid = (lo + hi) / 2;
            if (reliefHeight(map, relief, bx + mid / 32, by + mid / 32) > mid) lo = mid;
            else hi = mid;
          }
          z = (lo + hi) / 2;
        }
        const tx = bx + z / 32,
          ty = by + z / 32;
        if (tx < -0.5 || ty < -0.5 || tx >= map.w - 0.5 || ty >= map.h - 0.5) continue;
        if (tx < x - 0.57 || ty < y - 0.57 || tx >= x + w - 0.43 || ty >= y + h - 0.43) continue;
        const wx = tx + map.originX,
          wy = ty + map.originY;
        surfaceBlend(map, tx, ty, blend);
        const tileIndex = Math.round(ty) * map.w + Math.round(tx),
          terrain = map.terrain[tileIndex];
        color[0] = color[1] = color[2] = 0;
        let waterWeight = 0;
        for (let m = 0; m < 4; m++) {
          const weight = blend[m + 4];
          if (!weight) continue;
          let material = blend[m];
          if (city.has(tileIndex)) material = 8;
          if (z > 2 && terrain === Terrain.Mountain && material === 7) material = 9;
          surfaceColor(source, material, wx, wy, part);
          if (material === 5 || material === 8) waterWeight += weight;
          for (let c = 0; c < 3; c++) color[c] += part[c] * weight;
        }
        let shade = 1;
        if (raised) {
          const dx =
            (reliefHeight(map, relief, tx + 0.65, ty) - reliefHeight(map, relief, tx - 0.65, ty)) /
            1.3;
          const dy =
            (reliefHeight(map, relief, tx, ty + 0.65) - reliefHeight(map, relief, tx, ty - 0.65)) /
            1.3;
          shade = Math.max(0.83, Math.min(1.12, 1 + dx * 0.012 - dy * 0.015));
        }
        for (let c = 0; c < 3; c++)
          color[c] *=
            shade * (waterWeight + ((1 - waterWeight) * ((tint >> (16 - c * 8)) & 255)) / 255);
        const k = (py * width + px) * 4;
        pixels[k] = color[0];
        pixels[k + 1] = color[1];
        pixels[k + 2] = color[2];
        pixels[k + 3] = 255;
      }
    ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
    // Identical world-seeded strokes overlap without extending chunk alpha boundaries.
    ctx.globalCompositeOperation = 'source-atop';
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const tufts: number[] = [];
    const ox = map.originX,
      oy = map.originY;
    const tinted = (r: number, g: number, b: number, a: number) =>
      `rgba(${Math.round((r * ((tint >> 16) & 255)) / 255)},${Math.round((g * ((tint >> 8) & 255)) / 255)},${Math.round((b * (tint & 255)) / 255)},${a})`;
    for (
      let iy = Math.floor((y + oy - 0.7) / 0.18);
      iy <= Math.ceil((y + h + oy + 0.7) / 0.18);
      iy++
    )
      for (
        let ix = Math.floor((x + ox - 0.7) / 0.18);
        ix <= Math.ceil((x + w + ox + 0.7) / 0.18);
        ix++
      ) {
        if (hash2(ix, iy, 238) > grassDetail(ix * 0.18, iy * 0.18) * 0.34) continue;
        const tx = ix * 0.18 - ox + (hash2(ix, iy, 111) - 0.5) * 0.15,
          ty = iy * 0.18 - oy + (hash2(ix, iy, 114) - 0.5) * 0.15;
        if (tx < -0.5 || ty < -0.5 || tx >= map.w - 0.5 || ty >= map.h - 0.5) continue;
        if (city.has(Math.round(ty) * map.w + Math.round(tx))) continue;
        const material = surfaceMaterial(map, tx, ty);
        if (![0, 1, 3, 4, 7].includes(material)) continue;
        if (material === 7 && rockExposure(tx + ox, ty + oy) > 0.45) continue;
        const sx = (tx - ty) * 32 - left,
          sy = (tx + ty) * 16 - reliefHeight(map, relief, tx, ty) - top;
        const length = 1.6 + hash2(ix, iy, 17) * 1.5;
        if (tx >= x - 0.5 && ty >= y - 0.5 && tx < x + w - 0.5 && ty < y + h - 0.5)
          tufts.push(sx, sy, length, material === 1 ? 1 : 0);
      }
    // Small stones are baked into the same terrain image, never spawned as objects.
    for (let iy = Math.floor((y + oy - 0.7) / 0.4); iy <= Math.ceil((y + h + oy + 0.7) / 0.4); iy++)
      for (
        let ix = Math.floor((x + ox - 0.7) / 0.4);
        ix <= Math.ceil((x + w + ox + 0.7) / 0.4);
        ix++
      ) {
        const r = hash2(ix, iy, 812);
        if (r > 0.045) continue;
        const tx = ix * 0.4 - ox + (hash2(ix, iy, 819) - 0.5) * 0.3,
          ty = iy * 0.4 - oy + (hash2(ix, iy, 817) - 0.5) * 0.3;
        if (tx < -0.5 || ty < -0.5 || tx >= map.w - 0.5 || ty >= map.h - 0.5) continue;
        if (surfaceMaterial(map, tx, ty) === 5) continue;
        const sx = (tx - ty) * 32 - left,
          sy = (tx + ty) * 16 - reliefHeight(map, relief, tx, ty) - top;
        const size = 0.8 + hash2(ix, iy, 82) * 1.1;
        ctx.fillStyle = tinted(88, 91, 70, 0.3);
        ctx.beginPath();
        ctx.ellipse(sx, sy + 0.3, size * 1.2, size * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = tinted(162, 160, 130, 0.66);
        ctx.beginPath();
        ctx.moveTo(sx - size, sy);
        ctx.lineTo(sx - size * 0.4, sy - size * 0.6);
        ctx.lineTo(sx + size * 0.7, sy - size * 0.45);
        ctx.lineTo(sx + size, sy + 0.2);
        ctx.lineTo(sx, sy + 0.45);
        ctx.closePath();
        ctx.fill();
      }
    const grass = new Float32Array(tufts);
    const output = ctx.getImageData(0, 0, width, height).data;
    self.postMessage(
      {
        id,
        version,
        left,
        top,
        width,
        height,
        scale,
        pixels: output,
        grass,
        tint,
        ms: performance.now() - started,
      },
      { transfer: [output.buffer, grass.buffer] },
    );
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
/** 2×2 box reduction of the packed surface sheet. */
function halve(pixels: Uint8ClampedArray, width: number, height: number) {
  const w = width >> 1,
    h = height >> 1,
    out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        const k = (y * 2 * width + x * 2) * 4 + c;
        out[(y * w + x) * 4 + c] =
          (pixels[k] + pixels[k + 4] + pixels[k + width * 4] + pixels[k + width * 4 + 4] + 2) >> 2;
      }
  return out;
}
