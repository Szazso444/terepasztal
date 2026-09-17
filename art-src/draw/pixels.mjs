/**
 * A hard-edged pixel buffer and a seeded RNG: the floor the drawn assets stand on.
 *
 * These are drawn, not rendered. There is no camera and no light solve -- every pixel is placed
 * deliberately, the way the concept boards were drawn, which is the only way to get the clustered
 * leaf blocks and the branch structure showing through the canopy that a rendered volume loses.
 */
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';

/** Deterministic LCG, the same contract as kit.Rng on the Blender side. */
export class Rng {
  constructor(seed) {
    this.s = (Math.trunc(seed) * 1103515245 + 12345) & 0x7fffffff;
  }
  f() {
    this.s = (this.s * 1103515245 + 12345) & 0x7fffffff;
    return this.s / 0x80000000;
  }
  r(a, b) {
    return a + (b - a) * this.f();
  }
  int(a, b) {
    return Math.floor(this.r(a, b + 1));
  }
  pick(list) {
    return list[Math.min(list.length - 1, Math.floor(this.f() * list.length))];
  }
}

export class Buf {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 4);
  }
  set(x, y, c, a = 255) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 4;
    this.px[o] = c[0];
    this.px[o + 1] = c[1];
    this.px[o + 2] = c[2];
    this.px[o + 3] = a;
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    const o = (y * this.w + x) * 4;
    return this.px[o + 3] ? [this.px[o], this.px[o + 1], this.px[o + 2]] : null;
  }
  alpha(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.px[(y * this.w + x) * 4 + 3];
  }
  /** A filled disc. The unit of foliage and of a branch's thickness. */
  disc(cx, cy, r, c) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) this.set(x, y, c);
      }
  }
  /** A tapered stroke from (x0,y0) to (x1,y1): a branch, a root, a stem. */
  taper(x0, y0, x1, y1, r0, r1, c) {
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r0 + (r1 - r0) * t, c);
    }
  }
  /**
   * Darken the rim where the shape meets nothing, on the lower and outer sides only.
   *
   * The same selective contour src/art/pixels.ts applies, and the same reason: a box around
   * everything flattens the sprite, while a lower rim grounds it.
   */
  outline(c) {
    const was = this.px.slice();
    const lit = (x, y) =>
      x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : was[(y * this.w + x) * 4 + 3];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (lit(x, y)) continue;
        const near = lit(x - 1, y) || lit(x + 1, y) || lit(x, y - 1) || lit(x, y + 1);
        if (!near) continue;
        // only where the shape is above or beside, never where it is below: that is the lit rim
        const below = lit(x, y + 1);
        const above = lit(x, y - 1);
        if (below && !above) continue;
        this.set(x, y, c);
      }
  }
  write(path) {
    const png = new PNG({ width: this.w, height: this.h });
    png.data.set(this.px);
    writeFileSync(path, PNG.sync.write(png));
    return path;
  }
  /** Trim to the drawn pixels, so the caller never has to guess the canvas size. */
  trim(pad = 1) {
    let x0 = this.w;
    let y0 = this.h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.alpha(x, y)) {
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
    if (x1 < 0) return this;
    x0 = Math.max(0, x0 - pad);
    y0 = Math.max(0, y0 - pad);
    x1 = Math.min(this.w - 1, x1 + pad);
    y1 = Math.min(this.h - 1, y1 + pad);
    const out = new Buf(x1 - x0 + 1, y1 - y0 + 1);
    for (let y = 0; y < out.h; y++)
      for (let x = 0; x < out.w; x++) {
        const o = ((y + y0) * this.w + (x + x0)) * 4;
        const d = (y * out.w + x) * 4;
        for (let k = 0; k < 4; k++) out.px[d + k] = this.px[o + k];
      }
    return out;
  }
}
