import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import { hash2 } from '../engine/rng';
import { PAL, mix, shade, type RGB } from './palette';
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

// --- biome vegetation -------------------------------------------------------------------------

const BIRCH_LEAF: RGB[] = PAL.leaf.map((c) => mix(shade(c, 1.25), [150, 170, 90], 0.25));
const OAK_LEAF: RGB[] = [
  [38, 60, 34],
  [50, 76, 42],
  [30, 48, 28],
  [62, 88, 50],
];
const SPRUCE: RGB[] = [
  [30, 54, 52],
  [38, 66, 62],
  [22, 42, 40],
  [50, 80, 74],
];
const SNOW: RGB = [214, 222, 224];
const SNOW_SHADE: RGB = [168, 184, 190];
const BIRCH_BARK: RGB = [206, 202, 190];
const BIRCH_BAND: RGB = [58, 56, 50];
const CACTUS: RGB[] = [
  [66, 108, 62],
  [78, 122, 70],
  [52, 88, 50],
];
const DEADWOOD: RGB = [96, 84, 68];
const DEADWOOD_DARK: RGB = [66, 56, 44];
const REED: RGB[] = [
  [84, 104, 52],
  [100, 118, 60],
  [68, 86, 42],
];
const CATTAIL: RGB = [104, 72, 44];
const FLOWER_COLOURS: RGB[][] = [
  [
    [186, 70, 62],
    [214, 96, 82],
  ], // red
  [
    [214, 176, 64],
    [236, 204, 96],
  ], // yellow
  [
    [214, 210, 196],
    [238, 236, 226],
  ], // white
  [
    [140, 96, 168],
    [170, 126, 198],
  ], // purple
];

/** Birch: slim white trunk with dark bands, light airy round canopy. Anchor at trunk base. */
function birchTree(seed: number, v: number): PixelBuf {
  const w = 22;
  const h = 38 + v * 2;
  const b = new PixelBuf(w, h);
  const cx = Math.floor(w / 2);
  const trunkH = 16;
  b.rect(cx - 1, h - trunkH, 3, trunkH, BIRCH_BARK);
  b.rect(cx + 1, h - trunkH, 1, trunkH, shade(BIRCH_BARK, 0.78));
  for (let y = h - trunkH + 1; y < h - 1; y += 3) {
    const n = hash2(y, seed, 4);
    if (n > 0.35) b.rect(cx - 1 + (n > 0.7 ? 1 : 0), y, 2, 1, BIRCH_BAND);
  }
  // canopy: a cluster of small ellipses, lighter towards the top-left
  const blobs = 5 + v;
  for (let i = 0; i < blobs; i++) {
    const t = i / (blobs - 1);
    const bx = cx + (hash2(i, seed, 1) - 0.5) * 9;
    const by = h - trunkH - 4 - t * 12 + (hash2(i, seed, 2) - 0.5) * 3;
    const r = 4.5 + hash2(i, seed, 3) * 2.5;
    const s = BIRCH_LEAF.map((c) => shade(c, 0.85 + t * 0.3));
    b.ellipse(bx, by, r, r * 0.8, s, seed + i, 0.4);
  }
  b.outline(PAL.outline, 200);
  return b;
}

/** Spruce: tall narrow dark blue-green conifer with snow on its upper tiers. */
function spruceTree(seed: number, v: number): PixelBuf {
  const w = 18;
  const h = 44 + v * 4;
  const b = new PixelBuf(w, h);
  const cx = Math.floor(w / 2);
  b.rect(cx - 1, h - 9, 3, 9, PAL.trunkDark);
  b.set(cx, h - 9, PAL.trunk);
  const tiers = 5;
  const tierH = (h - 12) / tiers;
  for (let t = 0; t < tiers; t++) {
    const yTop = 1 + t * tierH * 0.88;
    const yBot = yTop + tierH + 3;
    const halfW = ((w / 2 - 1) * (t + 1.2)) / (tiers + 0.2);
    const yEnd = Math.min(h - 8, Math.floor(yBot));
    for (let y = Math.floor(yTop); y < yEnd; y++) {
      const f = (y - yTop) / (yBot - yTop);
      const hw = halfW * f;
      for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
        const n = hash2(x >> 1, y >> 1, seed + t);
        const side = (x - cx) / Math.max(1, hw);
        const vv = n * 0.6 + 0.4 - side * 0.3;
        const idx = Math.max(0, Math.min(3, Math.floor(vv * 3)));
        let c = SPRUCE[idx];
        // snow: upper two tiers carry a snow cap along their lower edge and top
        if (t < 2 && (y >= yEnd - 2 || f < 0.35)) {
          const sn = hash2(x, y, seed + 30 + t);
          c = sn > 0.3 ? (side > 0.3 ? SNOW_SHADE : SNOW) : c;
        } else if (t === 2 && y >= yEnd - 1 && hash2(x, y, seed + 33) > 0.55) c = SNOW_SHADE;
        b.set(x, y, c);
      }
    }
  }
  b.outline(PAL.outline, 200);
  return b;
}

/** Oak: broad, heavy dark canopy on a thick trunk. Bigger than the plain round tree. */
function oakTree(seed: number, v: number): PixelBuf {
  const w = 32 + v * 2;
  const h = 40 + v * 2;
  const b = new PixelBuf(w, h);
  const cx = w / 2;
  const trunkW = 6;
  const trunkH = 13;
  b.rect(Math.floor(cx - trunkW / 2), h - trunkH, trunkW, trunkH, PAL.trunk);
  b.rect(Math.floor(cx - trunkW / 2), h - trunkH, 2, trunkH, PAL.trunkDark);
  b.rect(Math.floor(cx + trunkW / 2) - 1, h - trunkH, 1, trunkH, shade(PAL.trunk, 1.15));
  // root flare
  b.set(Math.floor(cx - trunkW / 2) - 1, h - 1, PAL.trunkDark);
  b.set(Math.floor(cx + trunkW / 2), h - 1, PAL.trunk);
  // canopy: wide low ellipses stacked, darker at the bottom
  const layers = 4;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const cy = h - trunkH - 3 - t * (h - trunkH - 16);
    const rx = (w / 2 - 1) * (1 - Math.abs(t - 0.35) * 0.7);
    const ry = rx * 0.62;
    const s = OAK_LEAF.map((c) => shade(c, 0.8 + t * 0.4));
    b.ellipse(cx + (hash2(i, seed, 1) - 0.5) * 5, cy, rx, ry, s, seed + i, 0.4);
  }
  // a few lighter leaf clusters on the lit side
  for (let i = 0; i < 4; i++) {
    const px = Math.floor(cx - 6 + hash2(i, seed, 7) * 10 - 4);
    const py = Math.floor(6 + hash2(i, seed, 8) * 10);
    if (b.alpha(px, py)) b.rect(px, py, 2, 1, OAK_LEAF[3]);
  }
  b.outline(PAL.outline, 200);
  return b;
}

/** Palm: curved trunk with a crown of arching fronds. */
function palmTree(seed: number, v: number): PixelBuf {
  const w = 28;
  const h = 36 + v * 2;
  const b = new PixelBuf(w, h);
  const lean = v === 0 ? 1 : -1;
  const baseX = Math.floor(w / 2) - lean * 4;
  const topX = Math.floor(w / 2) + lean * 3;
  const topY = 11;
  // trunk: quadratic curve sampled per row, 2-3 px wide with ring marks
  for (let y = h - 1; y >= topY; y--) {
    const t = (h - 1 - y) / (h - 1 - topY);
    const ctrlX = baseX + (topX - baseX) * 0.15;
    const x = (1 - t) * (1 - t) * baseX + 2 * (1 - t) * t * ctrlX + t * t * topX;
    const xi = Math.round(x);
    const ring = y % 3 === 0;
    b.set(xi - 1, y, ring ? PAL.trunkDark : shade(PAL.trunk, 0.9));
    b.set(xi, y, ring ? shade(PAL.trunk, 0.85) : shade(PAL.trunk, 1.1));
    if (t < 0.5) b.set(xi + 1, y, PAL.trunkDark);
  }
  // fronds: arcs radiating from the crown
  const fronds = 7;
  for (let i = 0; i < fronds; i++) {
    // spread over a full fan from left-down through up to right-down
    const a =
      -Math.PI * 1.1 + (i / (fronds - 1)) * Math.PI * 1.2 + (hash2(i, seed, 2) - 0.5) * 0.25;
    const len = 10 + hash2(i, seed, 3) * 3;
    let px = topX;
    let py = topY;
    for (let k = 0; k < len; k++) {
      const f = k / len;
      // start outward, then droop
      const dx = Math.cos(a) * (1 - f * 0.4);
      const dy = Math.sin(a) * (1 - f) + f * 1.3;
      px += dx;
      py += dy;
      const xi = Math.round(px);
      const yi = Math.round(py);
      const lit = dx < 0 || f < 0.3;
      const c = lit ? PAL.leaf[3] : PAL.leaf[1];
      b.set(xi, yi, c);
      // leaflets: 2px-wide rib with alternating hanging pixels so fronds read as feathery
      b.set(xi, yi + 1, f < 0.6 ? PAL.leaf[1] : PAL.leaf[0]);
      if (k % 2 === 0 && k > 1) b.set(xi, yi + 2, PAL.leaf[2]);
      else if (k > 1) b.set(xi + (dx > 0 ? 1 : -1), yi, PAL.leaf[2]);
    }
  }
  // crown core
  b.rect(topX - 1, topY - 1, 3, 3, PAL.leaf[2]);
  b.set(topX, topY - 1, PAL.leaf[3]);
  // coconuts
  b.set(topX - 1, topY + 2, PAL.trunkDark);
  b.set(topX + 1, topY + 2, PAL.trunk);
  b.outline(PAL.outline, 200);
  return b;
}

/** Saguaro cactus with one or two arms. ~10x22. */
function cactus(seed: number, v: number): PixelBuf {
  const w = 10;
  const h = 22;
  const b = new PixelBuf(w, h);
  const cx = 4;
  const top = 3 + v;
  // main column
  for (let y = top; y < h; y++)
    for (let x = cx - 1; x <= cx + 1; x++) {
      const idx = x === cx - 1 ? 1 : x === cx + 1 ? 2 : 0;
      b.set(x, y, CACTUS[idx]);
    }
  b.set(cx, top - 1, CACTUS[1]);
  // rib line
  for (let y = top + 1; y < h; y += 2) b.set(cx, y, shade(CACTUS[0], 0.9));
  // arms: horizontal stub then up
  const arms = v === 2 ? 2 : 1;
  const armSide = hash2(seed, 1, 2) > 0.5 ? 1 : -1;
  for (let a = 0; a < arms; a++) {
    const side = a === 0 ? armSide : -armSide;
    const ay = 10 + a * 3 + Math.floor(hash2(seed, a, 3) * 2);
    const ax = cx + side * 3;
    b.rect(Math.min(cx, ax), ay, 4, 2, CACTUS[0]);
    b.rect(ax - (side > 0 ? 0 : 1), ay - 4 - a, 2, 6 + a, CACTUS[0]);
    b.rect(ax - (side > 0 ? 0 : 1), ay - 4 - a, 1, 6 + a, CACTUS[side > 0 ? 1 : 2]);
    b.set(ax, ay - 5 - a, CACTUS[1]);
  }
  b.outline(PAL.outline, 200);
  return b;
}

/** Dead tree: bare grey-brown trunk with forking branches. */
function deadTree(seed: number, v: number): PixelBuf {
  const w = 22;
  const h = 34 + v * 2;
  const b = new PixelBuf(w, h);
  const cx = Math.floor(w / 2);
  const lean = v === 0 ? 1 : -1;
  // trunk tapering upward
  for (let y = h - 1; y >= 8; y--) {
    const t = (h - 1 - y) / (h - 9);
    const x = cx + Math.round(lean * t * 2);
    const wd = t < 0.35 ? 3 : t < 0.7 ? 2 : 1;
    b.rect(x - Math.floor(wd / 2), y, wd, 1, DEADWOOD);
    b.set(x - Math.floor(wd / 2), y, DEADWOOD_DARK);
  }
  // branches: each starts on the trunk and forks once
  const branches = 4;
  for (let i = 0; i < branches; i++) {
    const sy = 9 + Math.floor(hash2(i, seed, 1) * 14);
    const t = (h - 1 - sy) / (h - 9);
    const sx = cx + Math.round(lean * t * 2);
    const dir = i % 2 === 0 ? -1 : 1;
    const len = 4 + Math.floor(hash2(i, seed, 2) * 5);
    const ex = sx + dir * len;
    const ey = sy - 3 - Math.floor(hash2(i, seed, 3) * 4);
    b.line(sx, sy, ex, ey, DEADWOOD);
    // twig
    const mx = Math.round((sx + ex) / 2);
    const my = Math.round((sy + ey) / 2);
    b.line(mx, my, mx + dir * 2, my - 3, DEADWOOD_DARK);
    b.line(ex, ey, ex + dir, ey - 3, DEADWOOD_DARK);
  }
  // crown tip
  b.line(cx + lean * 2, 8, cx + lean * 3, 3, DEADWOOD);
  b.line(cx + lean * 2, 8, cx + lean * 0, 4, DEADWOOD_DARK);
  b.outline(PAL.outline, 200);
  return b;
}

/** Round shrub; variants differ in shape and tint. 14x10. */
function bush(seed: number, v = 0): PixelBuf {
  const b = new PixelBuf(14, 10);
  const tint = v === 1 ? 1.15 : v === 2 ? 0.88 : 1;
  const s = PAL.leaf.map((c) => shade(c, tint));
  if (v === 2) {
    b.ellipse(5, 6, 4.5, 3.5, s, seed);
    b.ellipse(9, 5, 4, 3.5, s, seed + 1);
  } else {
    b.ellipse(7, 5, 6, 4, s, seed);
    if (v === 1)
      b.ellipse(
        6,
        3.5,
        3,
        2.5,
        s.map((c) => shade(c, 1.1)),
        seed + 2,
        0.5,
      );
  }
  b.outline(PAL.outline, 160);
  return b;
}

/** Low flower patch: a grass tuft with a handful of coloured blooms. 16x8. */
function flowers(seed: number, colour: number): PixelBuf {
  const w = 16;
  const h = 8;
  const b = new PixelBuf(w, h);
  const [dark, light] = FLOWER_COLOURS[colour];
  // grass tuft base
  b.ellipse(
    8,
    5.5,
    7,
    2.5,
    PAL.grass.map((c) => shade(c, 1.15)),
    seed,
    0.2,
  );
  for (let i = 0; i < 6; i++) {
    const x = 1 + Math.floor(hash2(i, seed, 1) * 14);
    const hgt = 1 + Math.floor(hash2(i, seed, 2) * 2);
    for (let k = 0; k < hgt; k++) b.set(x, 4 - k, PAL.grass[3]);
  }
  // blooms: 2x2 with a dark pixel at the lower-right, on short stems
  const n = 4 + Math.floor(hash2(seed, colour, 3) * 2);
  for (let i = 0; i < n; i++) {
    const x = 1 + Math.floor((i + hash2(i, seed, 4) * 0.8) * (13 / n));
    const y = 1 + Math.floor(hash2(i, seed, 5) * 3);
    b.set(x, y + 2, PAL.grass[3]);
    b.set(x, y, light);
    b.set(x + 1, y, dark);
    b.set(x, y + 1, dark);
    b.set(x + 1, y + 1, shade(dark, 0.8));
  }
  b.outline(PAL.outline, 130);
  return b;
}

/** Marsh reeds / cattails: tall thin stalks. 10x18. */
function reeds(seed: number, v: number): PixelBuf {
  const w = 10;
  const h = 18;
  const b = new PixelBuf(w, h);
  const stalks = 5;
  for (let i = 0; i < stalks; i++) {
    const bx = 1 + Math.floor((i / (stalks - 1)) * 7);
    const top = 1 + Math.floor(hash2(i, seed, 1) * 6);
    const lean = Math.round((hash2(i, seed, 2) - 0.5) * 3);
    const c = REED[i % 3];
    b.line(bx, h - 1, bx + lean, top, c);
    // cattail heads on some stalks
    if ((i + v) % 2 === 0 && top < 6) {
      b.rect(bx + lean, top, 1, 4, CATTAIL);
      b.set(bx + lean, top - 1, shade(REED[1], 1.1));
      b.set(bx + lean, top + 4, shade(CATTAIL, 0.75));
    }
  }
  // leaf blades at the base
  b.line(2, h - 1, 0, h - 6, REED[2]);
  b.line(7, h - 1, 9, h - 5, REED[0]);
  b.outline(PAL.outline, 160);
  return b;
}

/** Large rounded boulder with strong shading and a crack. 20x14. */
function bigBoulder(seed: number, v: number): PixelBuf {
  const w = 20;
  const h = 14;
  const b = new PixelBuf(w, h);
  const s = PAL.rock.map((c) => shade(c, 1.02 + v * 0.04));
  b.ellipse(w / 2, 6.5, w / 2 - 1, 5.5, s, seed, 0.65);
  if (v === 1) b.ellipse(w / 2 + 3, 5, 5, 4, s, seed + 1, 0.65); // lumpy top
  if (v === 2)
    b.ellipse(
      w / 2 - 4,
      6,
      5,
      4.5,
      s.map((c) => shade(c, 1.08)),
      seed + 2,
      0.65,
    );
  // highlight
  b.rect(6, 3, 2, 1, shade(PAL.rock[3], 1.2));
  b.set(5, 4, shade(PAL.rock[3], 1.12));
  // crack
  b.line(11, 5, 13, 8, shade(PAL.rock[2], 0.7));
  b.line(13, 8, 12, 10, shade(PAL.rock[2], 0.7));
  // flat shadowed bottom
  for (let x = 0; x < w; x++)
    for (let y = 12; y < h; y++) if (b.alpha(x, y - 1)) b.set(x, y, shade(PAL.rock[2], 0.72));
  b.outline(PAL.outline, 200);
  return b;
}

export function generatePropsAtlas(): AtlasImage {
  const ab = new AtlasBuilder();
  const add = (name: string, p: PixelBuf) =>
    ab.add(name, p.toImageData(), Math.floor(p.w / 2), p.h - 1);
  for (let v = 0; v < 3; v++) {
    const t = roundTree(10 + v, v % 2);
    ab.add(`props/tree_${v}`, t.toImageData(), t.w / 2, t.h - 1);
    const p = pineTree(20 + v, v % 2);
    ab.add(`props/pine_${v}`, p.toImageData(), Math.floor(p.w / 2) + 1, p.h - 1);
    const r = boulder(30 + v, v % 2);
    ab.add(`props/rock_${v}`, r.toImageData(), r.w / 2, r.h - 1);
    add(`props/birch_${v}`, birchTree(50 + v, v));
    add(`props/spruce_${v}`, spruceTree(60 + v, v));
    add(`props/oak_${v}`, oakTree(70 + v, v));
    add(`props/cactus_${v}`, cactus(90 + v, v));
    add(`props/bush_${v}`, bush(40 + v, v));
    add(`props/boulder_${v}`, bigBoulder(130 + v, v));
  }
  for (let v = 0; v < 2; v++) {
    add(`props/palm_${v}`, palmTree(80 + v, v));
    add(`props/deadtree_${v}`, deadTree(100 + v, v));
    add(`props/reeds_${v}`, reeds(120 + v, v));
  }
  for (let v = 0; v < 4; v++) add(`props/flowers_${v}`, flowers(110 + v, v));
  return ab.build(512);
}
