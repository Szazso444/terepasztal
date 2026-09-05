import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import { hash2 } from '../engine/rng';
import { PAL, shade } from './palette';
import { PixelBuf } from './pixels';

/** Round-canopy deciduous tree. Anchor at trunk base. */
function roundTree(seed: number, size: number): PixelBuf {
  const w = 22 + size * 4;
  const h = 34 + size * 6;
  const b = new PixelBuf(w, h);
  const cx = w / 2;
  // trunk
  const trunkW = 3 + (size > 1 ? 1 : 0);
  b.rect(Math.floor(cx - trunkW / 2), h - 12, trunkW, 12, PAL.trunk);
  b.rect(Math.floor(cx - trunkW / 2), h - 12, 1, 12, PAL.trunkDark);
  // canopy blobs, darker lower ones first
  const layers = 3 + size;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const cy = h - 16 - t * (h - 26);
    const rx = (w / 2 - 1) * (1 - Math.abs(t - 0.45) * 0.9);
    const ry = rx * 0.75;
    const s = PAL.leaf.map((c) => shade(c, 0.8 + t * 0.35));
    b.ellipse(cx + (hash2(i, seed, 1) - 0.5) * 4, cy, rx, ry, s, seed + i);
  }
  b.outline(PAL.outline, 200);
  return b;
}

/** Conifer: stacked dithered triangles. Anchor at trunk base. */
function pineTree(seed: number, size: number): PixelBuf {
  const w = 18 + size * 2;
  const h = 40 + size * 8;
  const b = new PixelBuf(w, h);
  const cx = Math.floor(w / 2);
  b.rect(cx - 1, h - 10, 3, 10, PAL.trunk);
  b.set(cx - 1, h - 10, PAL.trunkDark);
  const tiers = 4;
  for (let t = 0; t < tiers; t++) {
    const yTop = 2 + t * ((h - 14) / tiers) * 0.85;
    const yBot = yTop + (h - 14) / tiers + 4;
    const halfW = ((w / 2 - 1) * (t + 1.5)) / (tiers + 0.5);
    for (let y = Math.floor(yTop); y < Math.min(h - 8, Math.floor(yBot)); y++) {
      const f = (y - yTop) / (yBot - yTop);
      const hw = halfW * f;
      for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
        const n = hash2(x >> 1, y >> 1, seed + t);
        const side = (x - cx) / Math.max(1, hw); // -1 left (lit) .. +1 right (shadow)
        const v = n * 0.6 + 0.4 - side * 0.3;
        const idx = Math.max(0, Math.min(3, Math.floor(v * 3)));
        b.set(x, y, PAL.pine[idx]);
      }
    }
  }
  b.outline(PAL.outline, 200);
  return b;
}

function boulder(seed: number, size: number): PixelBuf {
  const w = 14 + size * 6;
  const h = 10 + size * 4;
  const b = new PixelBuf(w, h + 2);
  b.ellipse(
    w / 2,
    h / 2 + 1,
    w / 2 - 1,
    h / 2 - 1,
    PAL.rock.map((c) => shade(c, 1.05)),
    seed,
    0.5,
  );
  // flat bottom
  for (let x = 0; x < w; x++)
    for (let y = h; y < h + 2; y++)
      b.set(x, y, shade(PAL.rock[2], 0.7), b.alpha(x, y - 1) ? 255 : 0);
  b.outline(PAL.outline, 200);
  return b;
}

function bush(seed: number): PixelBuf {
  const b = new PixelBuf(14, 10);
  b.ellipse(7, 5, 6, 4, PAL.leaf, seed);
  b.outline(PAL.outline, 160);
  return b;
}

export function generatePropsAtlas(): AtlasImage {
  const ab = new AtlasBuilder();
  for (let v = 0; v < 3; v++) {
    const t = roundTree(10 + v, v % 2);
    ab.add(`props/tree_${v}`, t.toImageData(), t.w / 2, t.h - 1);
    const p = pineTree(20 + v, v % 2);
    ab.add(`props/pine_${v}`, p.toImageData(), Math.floor(p.w / 2) + 1, p.h - 1);
    const r = boulder(30 + v, v % 2);
    ab.add(`props/rock_${v}`, r.toImageData(), r.w / 2, r.h - 1);
  }
  const bs = bush(40);
  ab.add('props/bush_0', bs.toImageData(), 7, 9);
  return ab.build(512);
}
