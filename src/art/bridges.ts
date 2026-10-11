import type { AtlasImage, FrameDef } from '../engine/atlas';
import { PixelBuf } from './pixels';
import { PAL, shade, type RGB } from './palette';
import SWATCHES from './bridgeSwatches.json';

/**
 * Material swatches of the `bridges` atlas group. Bridges are drawn as geometry in the game's own
 * projection (render/bridgeGeometry.ts); a swatch is one flat face of it, square-on: the deck
 * top, the slab edge, a parapet, the wall hung under an edge, a pier or post, a timber brace.
 * tools/bridge-kit.mjs cuts the same names from the illustrated kit into public/assets/bridges;
 * without that file these plain palette versions are what a bridge wears.
 */
export const BRIDGE_SWATCHES = SWATCHES.swatches as unknown as Record<string, [number, number]>;
/** Texels per world pixel in the packed kit; the procedural swatches are drawn at one. */
export const BRIDGE_SWATCH_DENSITY = SWATCHES.density;

/** One swatch from the palette, at a pixel per world pixel. */
export function bridgeSwatch(key: string): PixelBuf {
  const size = BRIDGE_SWATCHES[key],
    name = /^bridgemat\/(stone|wood)-([a-z]+)(?:-(.*))?$/.exec(key);
  if (!size || !name) throw new Error(`unknown bridge swatch ${key}`);
  const w = Math.max(1, Math.round(size[0] / BRIDGE_SWATCH_DENSITY)),
    h = Math.max(1, Math.round(size[1] / BRIDGE_SWATCH_DENSITY)),
    b = new PixelBuf(w, h),
    part = name[2],
    flags = (name[3] ?? '').split('-'),
    stone = name[1] === 'stone',
    pal = stone ? PAL.stone : PAL.timber,
    // One upper-left light: faces seen from the lower right stand away from it, and what hangs
    // under a deck stands in its shade.
    light = (flags.includes('r') ? 0.84 : 1) * (flags.includes('shade') ? 0.68 : 1),
    c = (i: number, f = 1): RGB => shade(pal[i], f * light),
    joint = c(2, 0.82);
  const fill = (col: RGB) => b.rect(0, 0, w, h, col);
  /** Masonry: courses `ch` px high, their joints staggered. */
  const courses = (ch: number, bw: number) => {
    fill(c(0));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const row = Math.floor(y / ch);
        if (y % ch === ch - 1 || (x + (row % 2) * (bw >> 1)) % bw === bw - 1) b.set(x, y, joint);
        else if (y % ch === 0) b.set(x, y, c(1));
      }
  };
  /** Half a timber post at each end of the swatch, so one stands on every tile joint. */
  const posts = () => {
    for (let y = 0; y < h; y++)
      for (const x of [0, 1, w - 2, w - 1]) b.set(x, y, c(x === 1 || x === w - 2 ? 0 : 2));
  };
  switch (part) {
    case 'top':
      fill(c(1));
      if (stone)
        // Paving slabs, two by two to the tile.
        for (let i = 0; i < w; i++) {
          b.set(i, h >> 1, c(0));
          b.set(w >> 1, i, c(0));
          b.set(i, h - 1, c(0, 0.94));
          b.set(w - 1, i, c(0, 0.94));
        }
      else
        // Planks along the swatch, their ends staggered.
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const plank = y >> 2;
            if (y % 4 === 3 || (x + plank * 11) % 21 === 0) b.set(x, y, joint);
            else if (plank % 2) b.set(x, y, c(0));
          }
      break;
    case 'edge':
      fill(c(0));
      for (let x = 0; x < w; x++) {
        b.set(x, 0, c(1));
        b.set(x, h - 1, joint);
      }
      break;
    case 'parapet':
      if (flags.includes('top')) {
        fill(c(1, 1.06));
        for (let y = 0; y < h; y++) for (let x = 7; x < w; x += 8) b.set(x, y, c(0));
      } else if (stone) {
        courses(3, 8);
        for (let x = 0; x < w; x++) b.set(x, 0, c(1, 1.06));
      } else {
        // Post and rail.
        for (const y of [2, 3, 6, 7]) for (let x = 0; x < w; x++) b.set(x, y, c(y % 2 ? 2 : 1));
        posts();
      }
      break;
    case 'hung':
      if (stone) {
        courses(4, 8);
        // One arch to the tile: the opening is cut out, its ring left a shade lighter.
        const cx = (w - 1) / 2,
          half = w / 2 - 5;
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const dx = (x - cx) / half,
              dy = (y - (h - 1)) / (h - 3),
              r = dx * dx + dy * dy;
            if (r < 0.74) b.set(x, y, c(0), 0);
            else if (r < 1) b.set(x, y, c(1));
          }
      } else {
        // A Warren truss between two chords.
        for (let x = 0; x < w; x++) {
          b.set(x, 0, c(1));
          b.set(x, 1, c(0));
          b.set(x, h - 2, c(1));
          b.set(x, h - 1, c(2));
        }
        const panel = (w - 4) / 4;
        for (let k = 0; k < 4; k++)
          for (let y = 2; y < h - 2; y++) {
            const f = (y - 2) / (h - 5),
              x = Math.min(w - 4, Math.round(2 + (k + (k % 2 ? 1 - f : f)) * panel));
            b.set(x, y, c(0));
            b.set(x + 1, y, c(2));
          }
        posts();
      }
      break;
    case 'leg':
      if (stone) courses(Math.round(h / 4), w);
      else {
        fill(c(0));
        for (let y = 0; y < h; y++) {
          b.set(0, y, c(1));
          b.set(w - 1, y, c(2));
        }
      }
      break;
    case 'brace':
      for (let x = 0; x < w; x++) {
        const f = x / (w - 1);
        for (const y of [f * (h - 3), (1 - f) * (h - 3)])
          for (let k = 0; k < 3; k++) b.set(x, Math.round(y) + k, c(k === 0 ? 1 : k === 1 ? 0 : 2));
      }
      break;
  }
  return b;
}

/** Every swatch on one sheet, each with a ring of its own edge pixels around it. */
export function generateBridgesAtlas(): AtlasImage {
  const pad = 2,
    width = 256,
    frames: Record<string, FrameDef> = {};
  let x = pad,
    y = pad,
    row = 0;
  const placed = Object.keys(BRIDGE_SWATCHES).map((key) => {
    const b = bridgeSwatch(key);
    if (x + b.w + pad > width) {
      x = pad;
      y += row + 2 * pad;
      row = 0;
    }
    const at = { key, b, x, y };
    x += b.w + 2 * pad;
    row = Math.max(row, b.h);
    return at;
  });
  const image = document.createElement('canvas');
  image.width = width;
  image.height = y + row + pad;
  const ctx = image.getContext('2d')!,
    sheet = ctx.createImageData(image.width, image.height);
  for (const { key, b, x: fx, y: fy } of placed) {
    // Edge pixels repeated outward, so sampling at a face's rim never reads a neighbour.
    for (let yy = -pad; yy < b.h + pad; yy++)
      for (let xx = -pad; xx < b.w + pad; xx++) {
        const sx = Math.max(0, Math.min(b.w - 1, xx)),
          sy = Math.max(0, Math.min(b.h - 1, yy)),
          i = (sy * b.w + sx) * 4;
        sheet.data.set(b.data.subarray(i, i + 4), ((fy + yy) * sheet.width + fx + xx) * 4);
      }
    frames[key] = { x: fx, y: fy, w: b.w, h: b.h, ax: 0, ay: 0 };
  }
  ctx.putImageData(sheet, 0, 0);
  return { image, frames };
}
