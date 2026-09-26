import { ImageSource, Rectangle, Sprite, Texture } from 'pixi.js';
import type { FrameInfo } from '../engine/atlas';
import { PAL } from '../art/palette';

// Reviewed regions on the packed, rectified source frames: x/y/width/height.
// The colour selector is deliberately restricted to these windows, so blue roof
// outlines, open warehouse bays and water-tower pipes cannot become lamps.
const WINDOW_REGIONS: Record<string, number[][]> = {
  station: [
    [0.185, 0.54, 0.08, 0.16],
    [0.545, 0.68, 0.065, 0.14],
    [0.78, 0.74, 0.06, 0.15],
    [0.77, 0.5, 0.05, 0.13],
    [0.34, 0.63, 0.035, 0.08],
  ],
  townhouse: [
    [0.115, 0.535, 0.085, 0.14],
    [0.43, 0.665, 0.08, 0.14],
    [0.77, 0.47, 0.052, 0.12],
  ],
  town: [
    [0.12, 0.43, 0.07, 0.105],
    [0.13, 0.59, 0.07, 0.09],
    [0.56, 0.59, 0.09, 0.1],
    [0.57, 0.765, 0.08, 0.09],
    [0.79, 0.62, 0.06, 0.085],
    [0.79, 0.78, 0.06, 0.09],
    [0.89, 0.58, 0.045, 0.07],
    [0.89, 0.75, 0.045, 0.09],
    [0.34, 0.49, 0.06, 0.09],
  ],
  warehouse: [
    [0.06, 0.45, 0.05, 0.14],
    [0.74, 0.43, 0.035, 0.06],
  ],
  farm: [
    [0.515, 0.61, 0.065, 0.115],
    [0.25, 0.395, 0.045, 0.075],
    [0.59, 0.31, 0.055, 0.095],
  ],
  windmill: [[0.4, 0.57, 0.055, 0.11]],
};

function texture(canvas: HTMLCanvasElement, f: FrameInfo) {
  return new Texture({
    source: new ImageSource({ resource: canvas, scaleMode: 'linear' }),
    orig: new Rectangle(0, 0, f.w, f.h),
  });
}
function read(f: FrameInfo) {
  const rect = f.texture.frame,
    canvas = document.createElement('canvas');
  canvas.width = rect.width;
  canvas.height = rect.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(f.image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  return { canvas, ctx, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height) };
}
/** Bottom-contour integration; leaves walls, roof edges, doors and rail geometry intact. */
export class SurfaceAssets {
  private contacts = new Map<string, Texture>();
  private windows = new Map<string, Texture>();
  private contours = new Map<string, { x: number; y: number }[]>();
  private summits = new Map<string, Texture>();
  summit(key: string, f: FrameInfo) {
    const cached = this.summits.get(key);
    if (cached) return cached;
    const { canvas, ctx, pixels } = read(f),
      { width: w, height: h, data: p } = pixels;
    const band = (w / f.w) * 8;
    for (let x = 0; x < w; x++) {
      let bottom = h - 1;
      while (bottom > h * 0.45 && p[(bottom * w + x) * 4 + 3] < 100) bottom--;
      for (let d = 0; d < band && bottom - d >= 0; d++) {
        const t = Math.min(1, d / band),
          k = ((bottom - d) * w + x) * 4;
        p[k + 3] *= t * t * (3 - 2 * t);
      }
    }
    ctx.putImageData(pixels, 0, 0);
    const result = texture(canvas, f);
    this.summits.set(key, result);
    return result;
  }
  /** Bottom opaque contour in owner-local logical pixels, not its tile footprint. */
  groundContour(key: string, f: FrameInfo) {
    const cached = this.contours.get(key);
    if (cached) return cached;
    const { pixels } = read(f),
      { width: w, height: h, data: p } = pixels,
      density = w / f.w;
    const floor = key.includes('windmill') ? h * 0.82 : h * 0.58;
    const points: { x: number; y: number }[] = [];
    for (let x = 0; x < w; x += Math.max(1, Math.round(density * 1.5))) {
      let y = h - 1;
      while (y > floor && p[(y * w + x) * 4 + 3] < 170) y--;
      if (y > floor)
        points.push({ x: x / density - f.anchorX * f.w, y: y / density - f.anchorY * f.h });
    }
    this.contours.set(key, points);
    return points;
  }
  contact(key: string, f: FrameInfo, ground: readonly number[]) {
    const cacheKey = key + ':' + ground.join(',');
    const cached = this.contacts.get(cacheKey);
    if (cached) return cached;
    const { canvas, ctx, pixels } = read(f),
      { width: w, height: h, data: p } = pixels;
    const density = w / f.w;
    const lowestGround = key.includes('windmill') ? h * 0.82 : h * 0.68;
    for (let x = 0; x < w; x++) {
      let bottom = h - 1;
      while (bottom > lowestGround && p[(bottom * w + x) * 4 + 3] < 170) bottom--;
      if (bottom <= lowestGround) continue;
      const band = Math.max(2, Math.ceil(density * 1.25));
      for (let d = 0; d < band; d++) {
        const i = ((bottom - d) * w + x) * 4,
          t = (1 - d / band) * 0.45;
        for (let c = 0; c < 3; c++) p[i + c] = p[i + c] * (1 - t) + ground[c] * t;
        p[i + 3] *= 0.4 + 0.6 * Math.min(1, (d + 0.35) / band);
      }
    }
    ctx.putImageData(pixels, 0, 0);
    const result = texture(canvas, f);
    this.contacts.set(cacheKey, result);
    return result;
  }
  /** Existing glass pixels become emissive; masks inherit the owner's depth/pose. */
  window(key: string, f: FrameInfo, procedural = false) {
    let result = this.windows.get(key);
    if (!result) {
      const { canvas, ctx, pixels } = read(f),
        { width: w, height: h, data: p } = pixels;
      const family = key.replace('structures/', '').replace(/(_lv\d+|_s\d+|_\d+)$/, '');
      const regions = WINDOW_REGIONS[family] ?? [];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4,
            r = p[i],
            g = p[i + 1],
            b = p[i + 2];
          const amber = [PAL.amber, PAL.amberDark].some(
            (c) => r === c[0] && g === c[1] && b === c[2],
          );
          const inside = regions.some(
            ([rx, ry, rw, rh]) => x / w >= rx && x / w < rx + rw && y / h >= ry && y / h < ry + rh,
          );
          const glass = inside && r < 85 && g < 105 && b < 110 && b > r - 12;
          if (procedural ? amber : glass) {
            p[i] = 255;
            p[i + 1] = 187;
            p[i + 2] = 91;
          } else p[i + 3] = 0;
        }
      ctx.putImageData(pixels, 0, 0);
      result = texture(canvas, f);
      this.windows.set(key, result);
    }
    return result;
  }
  destroy() {
    for (const t of [...this.contacts.values(), ...this.windows.values(), ...this.summits.values()])
      t.destroy(true);
    this.contacts.clear();
    this.windows.clear();
    this.contours.clear();
    this.summits.clear();
  }
}
export function windowSprite() {
  const sprite = new Sprite({ cullable: true, label: 'emissive' });
  sprite.blendMode = 'add';
  sprite.alpha = 0;
  return sprite;
}
