import { hash2 } from '../engine/rng';
import { mix, shade, type RGB } from './palette';

/** Small software pixel buffer used by the procedural sprite generators. */
export class PixelBuf {
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  }
  set(x: number, y: number, c: RGB, a = 255) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = a;
  }
  get(x: number, y: number): RGB | null {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    const i = (y * this.w + x) * 4;
    if (this.data[i + 3] === 0) return null;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }
  alpha(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[(y * this.w + x) * 4 + 3];
  }
  rect(x0: number, y0: number, w: number, h: number, c: RGB) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c);
  }
  /** Fill a rectangle using dithered shades: shades[] picked by 2x2-block noise. */
  ditherRect(x0: number, y0: number, w: number, h: number, shades: RGB[], seed: number, block = 2) {
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) this.set(x, y, pickShade(x, y, shades, seed, block));
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
  /** Filled ellipse with dithered shades, darker towards the lower-right. */
  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    shades: RGB[],
    seed: number,
    light = 0.35,
  ) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny > 1) continue;
        // lighting: upper-left brighter
        const l = -nx * light - ny * light;
        const n = hash2(x >> 1, y >> 1, seed);
        const idx = Math.max(
          0,
          Math.min(shades.length - 1, Math.floor((n * 0.6 + 0.5 - l) * shades.length)),
        );
        this.set(x, y, mix(shades[0], shades[idx], 0.45));
      }
  }
  /** Add a 1px dark outline around all opaque pixels. */
  outline(c: RGB, a = 255) {
    const mask = new Uint8Array(this.w * this.h);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) if (this.alpha(x, y) > 0) mask[y * this.w + x] = 1;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (mask[y * this.w + x]) continue;
        if (
          (x > 0 && mask[y * this.w + x - 1]) ||
          (x < this.w - 1 && mask[y * this.w + x + 1]) ||
          (y > 0 && mask[(y - 1) * this.w + x]) ||
          (y < this.h - 1 && mask[(y + 1) * this.w + x])
        ) {
          // Coloured contour: upper rims catch light; lower rims ground the miniature.
          const neighbour =
            this.get(x, y + 1) ??
            this.get(x + 1, y) ??
            this.get(x - 1, y) ??
            this.get(x, y - 1) ??
            c;
          const upper = y + 1 < this.h && mask[(y + 1) * this.w + x];
          this.set(x, y, mix(c, shade(neighbour, upper ? 0.7 : 0.4), 0.65), a);
        }
      }
  }
  /** Blit another buffer with alpha test. */
  blit(src: PixelBuf, dx: number, dy: number, flipX = false) {
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const sx = flipX ? src.w - 1 - x : x;
        const a = src.alpha(sx, y);
        if (a === 0) continue;
        const c = src.get(sx, y)!;
        this.set(dx + x, dy + y, c, a);
      }
  }
  toImageData(): ImageData {
    return new ImageData(this.data, this.w, this.h);
  }
}

export function pickShade(x: number, y: number, shades: RGB[], seed: number, block = 2): RGB {
  const n = hash2(x >> (block === 2 ? 1 : 0), y >> (block === 2 ? 1 : 0), seed);
  const low = hash2(x >> 3, y >> 3, seed + 99) * 0.5;
  const v = (n * 0.7 + low) / 1.2;
  return mix(shades[0], shades[Math.min(shades.length - 1, Math.floor(v * shades.length))], 0.35);
}

/** Point inside a 64x32 (or scaled) iso diamond centred at (cx, cy). */
export function inDiamond(x: number, y: number, cx: number, cy: number, hw: number, hh: number) {
  return Math.abs(x + 0.5 - cx) / hw + Math.abs(y + 0.5 - cy) / hh <= 1;
}
