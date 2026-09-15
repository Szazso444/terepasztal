import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import { hash2 } from '../engine/rng';
import { PAL, shade, type RGB } from './palette';
import { PixelBuf } from './pixels';

/**
 * Natural props. Silhouette first, then two or three canopy masses, then material detail in
 * broad clusters under one upper-left light. Every sprite keeps a 1px margin for the contour
 * and three rows below the anchor for a soft ground shadow that touches the trunk base.
 */

const SHADOW_ROWS = 3;
const SHADOW: RGB = [30, 40, 30];

/** Ellipse filled in three lighting bands with 2x2 cluster noise; upper-left is lit. */
function mass(
  b: PixelBuf,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  shades: RGB[],
  seed: number,
  contrast = 1,
) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      if (nx * nx + ny * ny > 1) continue;
      const l = -(nx * 0.45 + ny * 0.75) * contrast;
      const n = (hash2(x >> 1, y >> 1, seed) - 0.5) * 0.5;
      const v = l + n;
      const c = v > 0.4 ? shades[3] : v > 0.05 ? shades[1] : v > -0.35 ? shades[0] : shades[2];
      b.set(x, y, c);
    }
}

/** Soft ground shadow ellipse drawn after the contour so it is never outlined. */
function groundShadow(b: PixelBuf, cx: number, cy: number, rx: number, alpha = 64) {
  const ry = Math.max(1.5, rx * 0.45);
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d > 1 || b.alpha(x, y) > 0) continue;
      b.set(x, y, SHADOW, Math.round(alpha * (1 - d * 0.6)));
    }
}

/** Trunk with a lit left edge and a dark right edge; `w` is the width in pixels. */
function trunk(b: PixelBuf, x0: number, yTop: number, w: number, h: number, base = PAL.trunk) {
  b.rect(x0, yTop, w, h, base);
  b.rect(x0, yTop, 1, h, shade(base, 1.18));
  if (w > 2) b.rect(x0 + w - 1, yTop, 1, h, shade(base, 0.72));
  if (w > 3) b.rect(x0 + w - 2, yTop, 1, h, shade(base, 0.9));
}

// --- broadleaf trees ---------------------------------------------------------------------------

/** Round broadleaf: two or three connected canopy masses on a short trunk. */
function roundTree(seed: number, v: number): PixelBuf {
  const w = 24 + v * 3;
  const h = 32 + v * 4 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const cx = Math.floor(w / 2);
  const trunkH = 9 + v;
  trunk(b, cx - 1, base - trunkH, 3, trunkH + 1);
  // main crown, then a lower side mass and a small lit top mass
  const cr = w / 2 - 1;
  mass(b, cx, base - trunkH - cr * 0.7, cr, cr * 0.72, PAL.leaf, seed);
  const side = hash2(seed, 1, 2) > 0.5 ? 1 : -1;
  mass(
    b,
    cx + side * cr * 0.45,
    base - trunkH - cr * 0.35,
    cr * 0.62,
    cr * 0.5,
    PAL.leaf,
    seed + 1,
  );
  mass(
    b,
    cx - side * cr * 0.2,
    base - trunkH - cr * 1.15,
    cr * 0.55,
    cr * 0.42,
    PAL.leaf,
    seed + 2,
  );
  b.outline(PAL.outline, 190);
  groundShadow(b, cx, base + 1, cr * 0.8);
  return b;
}

/** Oak: wider and heavier than the round tree; strong branching and a low spreading crown. */
function oakTree(seed: number, v: number): PixelBuf {
  const w = 34 + v * 2;
  const h = 38 + v * 2 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const cx = w / 2;
  const OAK: RGB[] = [
    [74, 112, 58],
    [92, 132, 68],
    [54, 86, 46],
    [114, 154, 82],
  ];
  const trunkW = 5;
  const trunkH = 12;
  trunk(b, Math.floor(cx - trunkW / 2), base - trunkH, trunkW, trunkH + 1);
  // root flare and two visible boughs leaving the trunk
  b.set(Math.floor(cx - trunkW / 2) - 1, base, PAL.trunkDark);
  b.set(Math.floor(cx + trunkW / 2), base, shade(PAL.trunk, 0.85));
  b.line(cx, base - trunkH + 1, cx - 8, base - trunkH - 6, PAL.trunkDark);
  b.line(cx + 1, base - trunkH + 1, cx + 8, base - trunkH - 5, shade(PAL.trunk, 0.9));
  // low wide crown built from three overlapping masses, a heavier dark one at the bottom
  const cr = w / 2 - 1;
  mass(b, cx, base - trunkH - 9, cr, 9, OAK, seed, 0.9);
  mass(b, cx - cr * 0.35, base - trunkH - 15, cr * 0.62, 8, OAK, seed + 1);
  mass(b, cx + cr * 0.32, base - trunkH - 14, cr * 0.6, 7.5, OAK, seed + 2);
  mass(b, cx + (hash2(seed, 3, 1) - 0.5) * 6, base - trunkH - 20, cr * 0.5, 6, OAK, seed + 3);
  b.outline(PAL.outline, 190);
  groundShadow(b, cx, base + 1, cr * 0.85, 70);
  return b;
}

/** Birch: slender pale trunk with sparing dark breaks, airy uneven canopy of small masses. */
function birchTree(seed: number, v: number): PixelBuf {
  const w = 22;
  const h = 38 + v * 2 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const cx = Math.floor(w / 2);
  const BARK: RGB = [224, 220, 206];
  const BAND: RGB = [72, 68, 60];
  const LEAF: RGB[] = [
    [124, 164, 82],
    [146, 184, 96],
    [98, 134, 68],
    [172, 204, 116],
  ];
  const trunkH = 17;
  b.rect(cx - 1, base - trunkH, 2, trunkH + 1, BARK);
  b.rect(cx, base - trunkH, 1, trunkH + 1, shade(BARK, 0.84));
  for (let y = base - trunkH + 2; y < base - 1; y += 4)
    if (hash2(y, seed, 4) > 0.45) b.set(cx - 1 + (hash2(y, seed, 5) > 0.5 ? 1 : 0), y, BAND);
  // airy canopy: five or six small masses with gaps, lighter towards the top-left
  const blobs = 5 + v;
  for (let i = 0; i < blobs; i++) {
    const t = i / (blobs - 1);
    const bx = cx + (hash2(i, seed, 1) - 0.5) * 12;
    const by = base - trunkH - 2 - t * 13 + (hash2(i, seed, 2) - 0.5) * 3;
    const r = 3.5 + hash2(i, seed, 3) * 2.5;
    mass(b, bx, by, r, r * 0.8, LEAF, seed + i, 0.8);
  }
  b.outline(PAL.outline, 170);
  groundShadow(b, cx, base + 1, 5, 50);
  return b;
}

// --- conifers ----------------------------------------------------------------------------------

/** One conifer tier: a triangle with lit left side and dark right, cluster noise. */
function tier(
  b: PixelBuf,
  cx: number,
  yTop: number,
  yBot: number,
  halfW: number,
  shades: RGB[],
  seed: number,
  snow = 0,
) {
  for (let y = Math.floor(yTop); y < Math.floor(yBot); y++) {
    const f = (y - yTop) / (yBot - yTop);
    const hw = halfW * f;
    for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
      const side = (x - cx) / Math.max(1, hw);
      const n = (hash2(x >> 1, y >> 1, seed) - 0.5) * 0.5;
      const v = -side * 0.5 + n + (f > 0.85 ? -0.3 : 0);
      let c = v > 0.35 ? shades[3] : v > 0 ? shades[1] : v > -0.4 ? shades[0] : shades[2];
      if (snow > 0 && f > 0.78 && hash2(x, y, seed + 30) < snow) c = side > 0.3 ? SNOW_SHADE : SNOW;
      b.set(x, y, c);
    }
  }
}
const SNOW: RGB = [230, 236, 234];
const SNOW_SHADE: RGB = [186, 200, 204];

/** Pine: open tiered canopy with the trunk visible between the groups. */
function pineTree(seed: number, v: number): PixelBuf {
  const w = 20 + v * 2;
  const h = 40 + v * 6 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const cx = Math.floor(w / 2);
  const top = 2;
  trunk(b, cx - 1, top + 4, 3, base - top - 3);
  const tiers = 3;
  const span = base - 8 - top;
  for (let t = 0; t < tiers; t++) {
    const yTop = top + (t / tiers) * span;
    const yBot = yTop + span / tiers - 3; // gap below each tier shows the trunk
    const halfW = ((w / 2 - 1) * (t + 1.6)) / (tiers + 0.6);
    tier(b, cx, yTop, yBot, halfW, PAL.pine, seed + t);
  }
  b.outline(PAL.outline, 190);
  groundShadow(b, cx, base + 1, 5, 50);
  return b;
}

/** Spruce: denser tapered cone with darker lower layers; a cosmetic dusting of snow. */
function spruceTree(seed: number, v: number): PixelBuf {
  const w = 18;
  const h = 44 + v * 4 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const cx = Math.floor(w / 2);
  const SPRUCE: RGB[] = [
    [44, 84, 72],
    [56, 100, 84],
    [32, 62, 56],
    [74, 122, 100],
  ];
  trunk(b, cx - 1, base - 8, 3, 9, PAL.trunkDark);
  const tiers = 5;
  const span = base - 10;
  for (let t = 0; t < tiers; t++) {
    const yTop = 1 + (t / tiers) * span * 0.92;
    const yBot = yTop + span / tiers + 3;
    const halfW = ((w / 2 - 1) * (t + 1.3)) / (tiers + 0.3);
    const dark = SPRUCE.map((c) => shade(c, 1 - t * 0.05));
    tier(b, cx, yTop, Math.min(base - 6, yBot), halfW, dark, seed + t, t < 2 ? 0.55 : 0.2);
  }
  b.outline(PAL.outline, 190);
  groundShadow(b, cx, base + 1, 4.5, 50);
  return b;
}

// --- desert ------------------------------------------------------------------------------------

/** Palm: bent trunk with a small fan of readable fronds. */
function palmTree(seed: number, v: number): PixelBuf {
  const w = 28;
  const h = 36 + v * 2 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const lean = v === 0 ? 1 : -1;
  const baseX = Math.floor(w / 2) - lean * 4;
  const topX = Math.floor(w / 2) + lean * 3;
  const topY = 11;
  for (let y = base; y >= topY; y--) {
    const t = (base - y) / (base - topY);
    const ctrlX = baseX + (topX - baseX) * 0.15;
    const x = (1 - t) * (1 - t) * baseX + 2 * (1 - t) * t * ctrlX + t * t * topX;
    const xi = Math.round(x);
    const ring = y % 3 === 0;
    b.set(xi - 1, y, ring ? PAL.trunkDark : shade(PAL.trunk, 1.1));
    b.set(xi, y, ring ? shade(PAL.trunk, 0.8) : PAL.trunk);
    if (t < 0.5) b.set(xi + 1, y, PAL.trunkDark);
  }
  const FROND: RGB[] = [
    [86, 132, 66],
    [110, 158, 80],
    [64, 104, 54],
    [138, 180, 96],
  ];
  const fronds = 6;
  for (let i = 0; i < fronds; i++) {
    const a =
      -Math.PI * 1.05 + (i / (fronds - 1)) * Math.PI * 1.1 + (hash2(i, seed, 2) - 0.5) * 0.2;
    const len = 10 + hash2(i, seed, 3) * 3;
    let px = topX;
    let py = topY;
    for (let k = 0; k < len; k++) {
      const f = k / len;
      const dx = Math.cos(a) * (1 - f * 0.35);
      const dy = Math.sin(a) * (1 - f) + f * 1.3;
      px += dx;
      py += dy;
      const xi = Math.round(px);
      const yi = Math.round(py);
      const lit = dx < 0 || f < 0.3;
      b.set(xi, yi, lit ? FROND[3] : FROND[1]);
      b.set(xi, yi + 1, f < 0.6 ? FROND[0] : FROND[2]);
      if (k % 3 === 1 && k > 1) b.set(xi, yi + 2, FROND[2]);
    }
  }
  b.rect(topX - 1, topY - 1, 3, 3, FROND[2]);
  b.set(topX, topY - 1, FROND[3]);
  b.set(topX - 1, topY + 2, PAL.trunkDark);
  b.set(topX + 1, topY + 2, PAL.trunk);
  b.outline(PAL.outline, 190);
  groundShadow(b, baseX, base + 1, 5, 50);
  return b;
}

/** Saguaro: ribbed column with one or two arms, few highlights. */
function cactus(seed: number, v: number): PixelBuf {
  const w = 12;
  const h = 22 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const CACTUS: RGB[] = [
    [80, 128, 72],
    [98, 148, 84],
    [60, 100, 58],
  ];
  const cx = 5;
  const top = 3 + v;
  for (let y = top; y <= base; y++)
    for (let x = cx - 1; x <= cx + 1; x++)
      b.set(x, y, x === cx - 1 ? CACTUS[1] : x === cx + 1 ? CACTUS[2] : CACTUS[0]);
  b.set(cx, top - 1, CACTUS[1]);
  for (let y = top + 1; y < base; y += 3) b.set(cx, y, shade(CACTUS[0], 0.9));
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
  b.outline(PAL.outline, 190);
  groundShadow(b, cx, base + 1, 3, 50);
  return b;
}

/** Dead tree: bare branching silhouette in silvered wood, no foliage. */
function deadTree(seed: number, v: number): PixelBuf {
  const w = 22;
  const h = 34 + v * 2 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const cx = Math.floor(w / 2);
  const DEAD: RGB = [148, 134, 116];
  const DEAD_DARK: RGB = [104, 92, 78];
  const lean = v === 0 ? 1 : -1;
  for (let y = base; y >= 8; y--) {
    const t = (base - y) / (base - 8);
    const x = cx + Math.round(lean * t * 2);
    const wd = t < 0.35 ? 3 : t < 0.7 ? 2 : 1;
    b.rect(x - Math.floor(wd / 2), y, wd, 1, DEAD);
    b.set(x - Math.floor(wd / 2), y, shade(DEAD, 1.1));
    if (wd > 1) b.set(x - Math.floor(wd / 2) + wd - 1, y, DEAD_DARK);
  }
  const branches = 4;
  for (let i = 0; i < branches; i++) {
    const sy = 9 + Math.floor(hash2(i, seed, 1) * 14);
    const t = (base - sy) / (base - 8);
    const sx = cx + Math.round(lean * t * 2);
    const dir = i % 2 === 0 ? -1 : 1;
    const len = 4 + Math.floor(hash2(i, seed, 2) * 5);
    const ex = sx + dir * len;
    const ey = sy - 3 - Math.floor(hash2(i, seed, 3) * 4);
    b.line(sx, sy, ex, ey, DEAD);
    const mx = Math.round((sx + ex) / 2);
    const my = Math.round((sy + ey) / 2);
    b.line(mx, my, mx + dir * 2, my - 3, DEAD_DARK);
    b.line(ex, ey, ex + dir, ey - 3, DEAD_DARK);
  }
  b.line(cx + lean * 2, 8, cx + lean * 3, 3, DEAD);
  b.line(cx + lean * 2, 8, cx, 4, DEAD_DARK);
  b.outline(PAL.outline, 190);
  groundShadow(b, cx, base + 1, 4, 45);
  return b;
}

// --- low plants --------------------------------------------------------------------------------

/** Bush: low two- or three-lobed cluster, shorter than a wagon body. */
function bush(seed: number, v: number): PixelBuf {
  const w = 16;
  const h = 11 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const tint = v === 1 ? 1.1 : v === 2 ? 0.92 : 1;
  const s = PAL.leaf.map((c) => shade(c, tint));
  if (v === 2) {
    mass(b, 5, base - 3, 4.5, 3.5, s, seed);
    mass(b, 10, base - 4, 4.5, 4, s, seed + 1);
  } else {
    mass(b, 8, base - 3.5, 6.5, 4, s, seed);
    mass(b, 5, base - 5.5, 3.5, 3, s, seed + 2);
    if (v === 1) mass(b, 11, base - 5, 3, 2.5, s, seed + 3);
  }
  b.outline(PAL.outline, 160);
  groundShadow(b, 8, base + 1, 6, 40);
  return b;
}

/** Flower patch: a tuft with blooms concentrated in one small cluster; four colour variants. */
function flowers(seed: number, colour: number): PixelBuf {
  const w = 16;
  const h = 9 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const FLOWER: [RGB, RGB][] = [
    [
      [212, 92, 80],
      [236, 132, 112],
    ], // red
    [
      [224, 184, 72],
      [244, 214, 116],
    ], // yellow
    [
      [222, 220, 206],
      [244, 242, 232],
    ], // white
    [
      [156, 112, 184],
      [190, 150, 214],
    ], // lilac
  ];
  const [dark, light] = FLOWER[colour];
  const tuft = PAL.grass.map((c) => shade(c, 1.1));
  mass(b, 8, base - 2, 6.5, 2.5, tuft, seed, 0.4);
  for (let i = 0; i < 5; i++) {
    const x = 2 + Math.floor(hash2(i, seed, 1) * 12);
    const hgt = 1 + Math.floor(hash2(i, seed, 2) * 2);
    for (let k = 0; k < hgt; k++) b.set(x, base - 3 - k, PAL.grass[3]);
  }
  // blooms cluster around one centre
  const ccx = 5 + Math.floor(hash2(seed, colour, 6) * 6);
  const n = 3 + Math.floor(hash2(seed, colour, 3) * 2);
  for (let i = 0; i < n; i++) {
    const x = ccx + Math.round((hash2(i, seed, 4) - 0.5) * 6);
    const y = 2 + Math.floor(hash2(i, seed, 5) * 3);
    b.set(x, y + 2, PAL.grass[2]);
    b.set(x, y, light);
    b.set(x + 1, y, dark);
    b.set(x, y + 1, dark);
    b.set(x + 1, y + 1, shade(dark, 0.8));
  }
  b.outline(PAL.outline, 120);
  return b;
}

/** Reeds: sparse upright stems standing in a grounded wet base. */
function reeds(seed: number, v: number): PixelBuf {
  const w = 12;
  const h = 19 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const REED: RGB[] = [
    [104, 132, 62],
    [124, 150, 72],
    [84, 108, 50],
  ];
  const CATTAIL: RGB = [112, 76, 46];
  const WET: RGB[] = [
    [84, 130, 130],
    [98, 144, 142],
    [70, 112, 116],
    [110, 156, 152],
  ];
  // wet base: a small pool the stems stand in
  mass(b, 6, base - 1, 5.5, 2, WET, seed + 9, 0.3);
  const stalks = 4;
  for (let i = 0; i < stalks; i++) {
    const bx = 2 + Math.floor((i / (stalks - 1)) * 8);
    const top = 1 + Math.floor(hash2(i, seed, 1) * 6);
    const lean = Math.round((hash2(i, seed, 2) - 0.5) * 3);
    const c = REED[i % 3];
    b.line(bx, base - 1, bx + lean, top, c);
    if ((i + v) % 2 === 0 && top < 7) {
      b.rect(bx + lean, top, 1, 4, CATTAIL);
      b.set(bx + lean, top - 1, shade(REED[1], 1.1));
      b.set(bx + lean, top + 4, shade(CATTAIL, 0.75));
    }
  }
  b.line(3, base - 2, 1, base - 7, REED[2]);
  b.line(8, base - 2, 10, base - 6, REED[0]);
  b.outline(PAL.outline, 150);
  return b;
}

// --- stone and minerals ------------------------------------------------------------------------

/** Small low stone: a flat-topped lump, lit from the upper left. */
function smallRock(seed: number, v: number): PixelBuf {
  const w = 14 + v * 4;
  const h = 9 + v * 2 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const cx = w / 2;
  const ry = (base - 1) / 2;
  mass(b, cx, base - ry, w / 2 - 1, ry, PAL.rock, seed, 1.2);
  // flat lit top and a dark underside
  for (let x = Math.floor(cx - w * 0.3); x <= Math.ceil(cx); x++)
    if (b.alpha(x, Math.round(base - ry * 1.4))) b.set(x, Math.round(base - ry * 1.4), PAL.rock[3]);
  for (let x = 0; x < w; x++)
    for (let y = base - 1; y <= base; y++) if (b.alpha(x, y)) b.set(x, y, shade(PAL.rock[2], 0.85));
  b.outline(PAL.outline, 180);
  groundShadow(b, cx, base + 1, w / 2 - 2, 45);
  return b;
}

/** Boulder: larger angular mass built from two or three faceted blocks. */
function boulder(seed: number, v: number): PixelBuf {
  const w = 22;
  const h = 15 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const LIT = PAL.rock[3];
  const MID = PAL.rock[1];
  const DARK = PAL.rock[2];
  const DEEP = shade(PAL.rock[2], 0.78);
  // faceted block: left face lit, right face dark, top lightest; a jagged top edge
  const blocks: [number, number, number, number][] =
    v === 0
      ? [
          [2, 5, 12, 10],
          [11, 3, 9, 12],
        ]
      : v === 1
        ? [
            [1, 6, 9, 9],
            [8, 2, 10, 13],
            [16, 7, 5, 8],
          ]
        : [
            [1, 4, 13, 11],
            [12, 6, 9, 9],
          ];
  for (const [x0, y0, bw, bh] of blocks) {
    const split = x0 + Math.floor(bw * 0.55);
    for (let y = y0; y < y0 + bh; y++)
      for (let x = x0; x < x0 + bw; x++) {
        const notch = y === y0 && hash2(x, seed, 3) > 0.6;
        if (notch) continue;
        const top = y < y0 + 2;
        const n = hash2(x >> 1, y >> 1, seed + x0);
        const c = top ? LIT : x < split ? (n > 0.7 ? LIT : MID) : n > 0.7 ? DARK : DEEP;
        b.set(x, y + (base - 14), c);
      }
    // crack along the facet edge
    for (let y = y0 + 2; y < y0 + bh - 1; y += 2) b.set(split, y + (base - 14), DEEP);
  }
  b.outline(PAL.outline, 190);
  groundShadow(b, w / 2, base + 1, 9, 55);
  return b;
}

/** Coal seam: dark stratified outcrop with a few glints, unlike ordinary grey rock. */
function coalSeam(seed: number, v: number): PixelBuf {
  const w = 20;
  const h = 10 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const c: RGB[] = [
    [52, 50, 54],
    [70, 68, 74],
    [34, 32, 36],
    [88, 86, 94],
  ];
  mass(b, w / 2, base - 4, w / 2 - 1 - (v % 2), 4, c, seed, 1.1);
  if (v === 2) mass(b, w / 2 + 5, base - 4.5, 4, 3, c, seed + 1, 1.1);
  // strata: dark bands every third row, lit ledge on top
  for (let y = 0; y <= base; y++)
    for (let x = 0; x < w; x++) {
      if (!b.alpha(x, y)) continue;
      if ((y + v) % 3 === 0) b.set(x, y, shade(b.get(x, y)!, 0.78));
      else if (y === base - 7 || (y === base - 6 && x > 8)) b.set(x, y, c[3]);
    }
  b.set(5, base - 4, [124, 122, 134]);
  b.set(12 + v, base - 2, [124, 122, 134]);
  b.outline(PAL.outline, 190);
  groundShadow(b, w / 2, base + 1, 8, 50);
  return b;
}

/** Oil seep: a small dark pool with a restrained sheen and a bubble, no rainbow. */
function oilSeep(seed: number, v: number): PixelBuf {
  const w = 22;
  const h = 9 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const c: RGB[] = [
    [42, 36, 38],
    [56, 48, 50],
    [28, 24, 26],
    [70, 62, 66],
  ];
  mass(b, w / 2, base - 3, w / 2 - 1, 3, c, seed, 0.4);
  if (v > 0) mass(b, w / 2 - 6 + v * 4, base - 5 + v, 3, 1.5, c, seed + 2, 0.4);
  // muddy rim on the lit side, sheen streak, one bubble
  for (let x = 2; x < w - 2; x++)
    if (b.alpha(x, base - 6) && !b.alpha(x, base - 7)) b.set(x, base - 6, [96, 82, 62]);
  b.rect(6, base - 3, 3, 1, [104, 96, 110]);
  b.set(13 + v, base - 2, [104, 96, 110]);
  b.set(15, base - 4, [84, 76, 84]);
  b.outline(PAL.outline, 170);
  return b;
}

export function generatePropsAtlas(): AtlasImage {
  const ab = new AtlasBuilder();
  // anchor: horizontal centre, on the row just above the shadow rows
  const add = (name: string, p: PixelBuf, ax?: number) =>
    ab.add(name, p.toImageData(), ax ?? Math.floor(p.w / 2), p.h - 1 - SHADOW_ROWS);
  for (let v = 0; v < 3; v++) {
    add(`props/tree_${v}`, roundTree(10 + v, v));
    add(`props/pine_${v}`, pineTree(20 + v, v));
    add(`props/rock_${v}`, smallRock(30 + v, v));
    add(`props/birch_${v}`, birchTree(50 + v, v));
    add(`props/spruce_${v}`, spruceTree(60 + v, v));
    add(`props/oak_${v}`, oakTree(70 + v, v));
    add(`props/cactus_${v}`, cactus(90 + v, v), 5);
    add(`props/bush_${v}`, bush(40 + v, v));
    add(`props/boulder_${v}`, boulder(130 + v, v));
    add(`props/coal_${v}`, coalSeam(140 + v, v));
    add(`props/oil_${v}`, oilSeep(150 + v, v));
  }
  for (let v = 0; v < 2; v++) {
    add(`props/palm_${v}`, palmTree(80 + v, v), Math.floor(28 / 2) - (v === 0 ? 1 : -1) * 4);
    add(`props/deadtree_${v}`, deadTree(100 + v, v));
    add(`props/reeds_${v}`, reeds(120 + v, v));
  }
  for (let v = 0; v < 4; v++) add(`props/flowers_${v}`, flowers(110 + v, v));
  return ab.build(512);
}
