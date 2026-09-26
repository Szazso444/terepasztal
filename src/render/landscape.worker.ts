import { type LandscapeMap } from './landscapeModel';
import { reliefHeight, surfaceAlongRay, RELIEF_MAX, type TerrainRelief } from './terrainRelief';
import {
  grassDetail,
  rockExposure,
  shareSurfaceDetail,
  surfaceNoise,
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
        const z = raised ? surfaceAlongRay(map, relief, bx, by, 10) : 0;
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
        // Tile-face style: rock shows where the slope is steep, not in random islands.
        let steep: number | undefined;
        if (relief.style.faces && relief.style.rockFaces !== false && raised) {
          faceGradient(tx, ty);
          const levels = Math.hypot(gradient[0], gradient[1]) / relief.style.step,
            t = (levels - 1.4 + (surfaceNoise(wx * 3, wy * 3, 617) - 0.5) * 0.6) / 0.4;
          steep = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
        }
        for (let m = 0; m < 4; m++) {
          const weight = blend[m + 4];
          if (!weight) continue;
          let material = blend[m];
          if (city.has(tileIndex)) material = 8;
          if (z > 2 && terrain === Terrain.Mountain && material === 7) material = 9;
          surfaceColor(
            source,
            material,
            wx,
            wy,
            part,
            [0, 1, 3, 4, 7, 9].includes(material) ? steep : undefined,
          );
          if (material === 5 || material === 8) waterWeight += weight;
          for (let c = 0; c < 3; c++) color[c] += part[c] * weight;
        }
        let shade = 1;
        if (raised && relief.style.faces) shade = faceShade(tx, ty);
        else if (raised) {
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
const gradient = [0, 0];
/** Surface slope in world pixels per tile at (x, y): the analytic derivative of its corners. */
function faceGradient(x: number, y: number) {
  const tx = Math.floor(x + 0.5),
    ty = Math.floor(y + 0.5),
    u = x - tx + 0.5,
    v = y - ty + 0.5,
    stride = map.w + 1,
    k = ty * stride + tx,
    c = relief.corners,
    step = relief.style.step;
  gradient[0] = gradient[1] = 0;
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return;
  if (relief.tiles) {
    // Terraces: the rounded banks have no corner formula; measure the surface itself.
    const d = 0.05;
    gradient[0] =
      (reliefHeight(map, relief, x + d, y) - reliefHeight(map, relief, x - d, y)) / (2 * d);
    gradient[1] =
      (reliefHeight(map, relief, x, y + d) - reliefHeight(map, relief, x, y - d)) / (2 * d);
    return;
  }
  const a = c[k] * step,
    b = c[k + 1] * step,
    d = c[k + stride + 1] * step,
    e = c[k + stride] * step;
  gradient[0] = b - a + (a - b - e + d) * v;
  gradient[1] = e - a + (a - b - e + d) * u;
}
/**
 * Light from the tile's own surface slope, so each elevated tile reads as a face and slopes
 * change visibly at tile edges. Upper-left light.
 */
function faceShade(x: number, y: number) {
  faceGradient(x, y);
  let shade = Math.max(0.68, Math.min(1.24, 1 + gradient[0] * 0.016 - gradient[1] * 0.019));
  if (relief.style.rims) {
    // Curvature: convex slope tops catch light, concave feet sit in soft shadow.
    const d = 0.12,
      h = reliefHeight(map, relief, x, y),
      curve =
        (reliefHeight(map, relief, x + d, y) +
          reliefHeight(map, relief, x - d, y) +
          reliefHeight(map, relief, x, y + d) +
          reliefHeight(map, relief, x, y - d) -
          4 * h) /
        (d * d);
    shade *= Math.max(0.8, Math.min(1.16, 1 - curve * 0.0004));
  }
  return shade;
}
