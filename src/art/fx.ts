import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import { hash2 } from '../engine/rng';
import { PAL } from './palette';
import { PixelBuf } from './pixels';

/** Additive lantern glow: dithered radial falloff, slightly squashed to sit on the ground. */
function glow(w: number, h: number, seed: number): PixelBuf {
  const b = new PixelBuf(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5 - w / 2) / (w / 2);
      const ny = (y + 0.5 - h / 2) / (h / 2);
      const d = Math.sqrt(nx * nx + ny * ny);
      if (d >= 1) continue;
      const f = (1 - d) * (1 - d);
      // ordered dither so the falloff reads as painted rather than smooth
      const n = hash2(x >> 1, y >> 1, seed);
      const a = Math.round(Math.min(255, f * 255 * (0.8 + n * 0.4)));
      if (a < 8) continue;
      b.set(x, y, PAL.amber, a);
    }
  return b;
}

function smoke(r: number, seed: number): PixelBuf {
  const s = r * 2 + 2;
  const b = new PixelBuf(s, s);
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const nx = (x + 0.5 - s / 2) / r;
      const ny = (y + 0.5 - s / 2) / r;
      const d = Math.sqrt(nx * nx + ny * ny) + (hash2(x, y, seed) - 0.5) * 0.35;
      if (d >= 1) continue;
      const shade = 150 + Math.floor(hash2(x >> 1, y >> 1, seed + 3) * 50) - (ny > 0 ? 30 : 0);
      b.set(x, y, [shade, shade, shade + 6], d > 0.8 ? 120 : 200);
    }
  return b;
}

export function generateFxAtlas(): AtlasImage {
  const ab = new AtlasBuilder();
  const g = glow(64, 40, 1);
  ab.add('fx/glow', g.toImageData(), 32, 20);
  const gs = glow(28, 18, 2);
  ab.add('fx/glow_small', gs.toImageData(), 14, 9);
  for (let i = 0; i < 3; i++) {
    const p = smoke(3 + i * 2, 10 + i);
    ab.add(`fx/smoke_${i}`, p.toImageData(), p.w / 2, p.h / 2);
  }
  return ab.build(256);
}
