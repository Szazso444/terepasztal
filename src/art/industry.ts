import { PAL, shade, type RGB } from './palette';
import { PixelBuf } from './pixels';
import { drawPrism, drawCylinder, proj, fillPoly, type P2 } from './iso3d';
import { hash2 } from '../engine/rng';
import { HALF_W, HALF_H } from '../engine/iso';

/** Shared sprite frame for one-tile structures (same as `structures.ts`). */
export const W = 96;
export const H = 84;
export const OX = 48;
export const OY = 68;
/** Ground origin: structures stand directly on the terrain tile. */
const GY = OY;
/**
 * Every station / works sprite keeps its ground-level geometry inside |tx|,|ty| <= 0.45 tile
 * units; only chimneys, masts and towers rise above it. The ground pass (shadows, small
 * patches) never paints outside GROUND_LIMIT, so the terrain shows through around everything.
 */
const GROUND_LIMIT = 0.47;

// ------------------------------------------------------------------ material palettes

const BRICK: RGB[] = [
  [118, 70, 52],
  [132, 80, 60],
  [98, 58, 44],
];
const BARN: RGB[] = [
  [146, 60, 46],
  [164, 72, 54],
  [122, 48, 38],
];
const CONCRETE: RGB[] = [
  [122, 118, 110],
  [138, 134, 126],
  [104, 100, 92],
];
const STEEL: RGB[] = [
  [120, 124, 132],
  [140, 144, 152],
  [96, 100, 108],
];
const SILVER: RGB[] = [
  [168, 172, 180],
  [192, 196, 204],
  [140, 144, 152],
];
const BLUE_STEEL: RGB[] = [
  [64, 94, 118],
  [80, 112, 138],
  [50, 74, 96],
];
const WHITEWASH: RGB[] = [
  [186, 176, 156],
  [204, 194, 174],
  [160, 150, 132],
];
const TANK_WHITE: RGB[] = [
  [200, 194, 182],
  [220, 214, 202],
  [172, 166, 154],
];
const PALE_TIMBER: RGB[] = [
  [152, 120, 78],
  [170, 136, 90],
  [128, 98, 62],
];
const COAL: RGB[] = [
  [40, 40, 42],
  [52, 52, 56],
  [30, 30, 32],
];
const GRAVEL: RGB[] = [
  [120, 118, 112],
  [134, 132, 126],
  [104, 102, 96],
];
const DUST: RGB[] = [
  [184, 160, 110],
  [200, 176, 124],
  [164, 140, 94],
];
const COBBLE: RGB[] = [
  [126, 112, 94],
  [140, 126, 106],
  [108, 96, 80],
];
const WHEATC: RGB[] = [
  [196, 162, 76],
  [214, 180, 90],
  [170, 138, 62],
];
const CROP: RGB[] = [
  [86, 116, 58],
  [98, 132, 66],
  [70, 96, 48],
];
const SHINGLE: RGB[] = [
  [96, 72, 46],
  [110, 84, 54],
  [80, 60, 38],
];
const FLAT_ROOF: RGB[] = [
  [70, 72, 76],
  [80, 82, 88],
  [58, 60, 64],
];

function pick(shades: RGB[], n: number): RGB {
  return shades[Math.min(shades.length - 1, Math.floor(n * shades.length))];
}
function rx(p: P2) {
  return Math.round(p.x);
}
function ry(p: P2) {
  return Math.round(p.y);
}

// ------------------------------------------------------------------ ground helpers

/** A flat rectangle of ground cover drawn as part of a structure, e.g. a shed floor. */
export function pad(
  b: PixelBuf,
  cx: number,
  cy: number,
  lenX: number,
  lenY: number,
  color: (x: number, y: number) => RGB | null,
  lift = 0,
) {
  const pts = [
    proj(OX, OY, cx - lenX / 2, cy - lenY / 2, lift),
    proj(OX, OY, cx + lenX / 2, cy - lenY / 2, lift),
    proj(OX, OY, cx + lenX / 2, cy + lenY / 2, lift),
    proj(OX, OY, cx - lenX / 2, cy + lenY / 2, lift),
  ];
  fillPoly(b, pts, color);
}

/** Inverse of `proj` at ground level: sprite pixel centre -> tile-space point. */
function unproj(x: number, y: number): [number, number] {
  const px = (x + 0.5 - OX) / HALF_W;
  const py = (y + 0.5 - OY) / HALF_H;
  return [(px + py) / 2, (py - px) / 2];
}

/** One ground layer: colour + alpha for a tile-space point (and its pixel), or null. */
export type GroundFn = (tx: number, ty: number, x: number, y: number) => [RGB, number] | null;

const SHADOW: RGB = [16, 18, 16];

/**
 * Ground pass, run after `outline()`: composites the layers (first = bottom) into pixels that
 * are still transparent, so the terrain tile shows through and the outline never wraps them.
 */
export function ground(b: PixelBuf, layers: GroundFn[]) {
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      if (b.alpha(x, y) > 0) continue;
      const [tx, ty] = unproj(x, y);
      if (Math.abs(tx) > GROUND_LIMIT || Math.abs(ty) > GROUND_LIMIT) continue;
      let c: RGB | null = null;
      let a = 0;
      for (const layer of layers) {
        const r = layer(tx, ty, x, y);
        if (!r) continue;
        const [rc, ra] = r;
        const t = ra / 255;
        c = c
          ? [c[0] + (rc[0] - c[0]) * t, c[1] + (rc[1] - c[1]) * t, c[2] + (rc[2] - c[2]) * t]
          : rc;
        a += ra * (1 - a / 255);
      }
      if (c && a > 0) b.set(x, y, c, Math.round(a));
    }
}

/** Signed distance (tile units) outside an axis-aligned rectangle; negative inside. */
function rectDist(tx: number, ty: number, cx: number, cy: number, lenX: number, lenY: number) {
  return Math.max(Math.abs(tx - cx) - lenX / 2, Math.abs(ty - cy) - lenY / 2);
}

/** Soft shadow under a rectangular footprint, nudged towards the +x/+y (shaded) side. */
export function shadowRect(
  cx: number,
  cy: number,
  lenX: number,
  lenY: number,
  alpha = 70,
  feather = 0.1,
): GroundFn {
  return (tx, ty) => {
    const d = rectDist(tx, ty, cx + 0.03, cy + 0.03, lenX, lenY);
    if (d >= feather) return null;
    return [SHADOW, Math.round(alpha * (d <= 0 ? 1 : 1 - d / feather))];
  };
}

/** Soft round shadow under a heap, tank or tower base. */
export function shadowEllipse(
  cx: number,
  cy: number,
  r: number,
  alpha = 70,
  feather = 0.4,
): GroundFn {
  return (tx, ty) => {
    const d = Math.hypot(tx - cx - 0.02, ty - cy - 0.02) / r;
    if (d >= 1 + feather) return null;
    return [SHADOW, Math.round(alpha * (d <= 1 ? 1 : 1 - (d - 1) / feather))];
  };
}

/** Ragged-edge threshold: pixels crumble inwards by up to `rough`, a few stray outwards. */
function ragged(x: number, y: number, seed: number, rough: number) {
  return rough * (hash2(x >> 1, y >> 1, seed) * 1.5 - 1);
}

/** Small rectangular patch of ground cover with a ragged edge; never fills the tile. */
export function patchRect(
  cx: number,
  cy: number,
  lenX: number,
  lenY: number,
  color: (x: number, y: number) => RGB,
  seed: number,
  alpha = 255,
  rough = 0.06,
): GroundFn {
  return (tx, ty, x, y) =>
    rectDist(tx, ty, cx, cy, lenX, lenY) > ragged(x, y, seed, rough) ? null : [color(x, y), alpha];
}

/** Small round patch of ground cover with a ragged edge. */
export function patchEllipse(
  cx: number,
  cy: number,
  r: number,
  color: (x: number, y: number) => RGB,
  seed: number,
  alpha = 255,
  rough = 0.06,
): GroundFn {
  return (tx, ty, x, y) =>
    Math.hypot(tx - cx, ty - cy) - r > ragged(x, y, seed, rough) ? null : [color(x, y), alpha];
}

/** Loose material (gravel, dust, coal) dithered from a shade set. */
export function loose(shades: RGB[], seed: number) {
  return (x: number, y: number) => pick(shades, hash2(x >> 1, y >> 1, seed));
}

/** Cobbles / flagstones: dithered shades with joint lines. */
export function paving(shades: RGB[], seed: number) {
  return (x: number, y: number) => {
    const c = pick(shades, hash2(x >> 1, y >> 1, seed));
    return (x + 2 * y) % 5 === 0 || (x - 2 * y + 400) % 7 === 0 ? shade(c, 0.82) : c;
  };
}

/** Poured concrete with expansion joints. */
function concrete(seed: number) {
  return (x: number, y: number) => {
    const c = pick(CONCRETE, hash2(x >> 1, y >> 1, seed));
    return (x + 2 * y) % 12 === 0 ? shade(c, 0.85) : c;
  };
}

// ------------------------------------------------------------------ building helpers

/** Axis-aligned building with an optional pitched roof. */
export function house(
  b: PixelBuf,
  cx: number,
  cy: number,
  len: number,
  wid: number,
  h: number,
  side: RGB[],
  roof: RGB[] | null,
  seed: number,
  angle = 0,
  z0 = 0,
) {
  drawPrism(b, {
    ox: OX,
    oy: GY,
    cx,
    cy,
    angle,
    len,
    wid,
    h,
    z0,
    top: roof ?? side,
    side,
    ridge: roof ? Math.max(4, Math.round(wid * 20)) : undefined,
    roof: roof ?? undefined,
    seed,
  });
}

/** Flat-roofed box with a lighter parapet line along the visible roof edges. */
function flatShed(
  b: PixelBuf,
  cx: number,
  cy: number,
  len: number,
  wid: number,
  h: number,
  side: RGB[],
  seed: number,
) {
  drawPrism(b, { ox: OX, oy: GY, cx, cy, angle: 0, len, wid, h, top: FLAT_ROOF, side, seed });
  const a = proj(OX, GY, cx - len / 2, cy + wid / 2, h);
  const f = proj(OX, GY, cx + len / 2, cy + wid / 2, h);
  const r = proj(OX, GY, cx + len / 2, cy - wid / 2, h);
  b.line(rx(a), ry(a), rx(f), ry(f), CONCRETE[1]);
  b.line(rx(f), ry(f), rx(r), ry(r), CONCRETE[1]);
}

export function chimney(
  b: PixelBuf,
  cx: number,
  cy: number,
  z0: number,
  h: number,
  r = 0.05,
  side: RGB[] = [PAL.iron[2], PAL.iron[0], PAL.iron[1]],
) {
  drawCylinder(b, OX, GY, cx, cy, r, z0, h, side, PAL.iron[0], 7);
  const t = proj(OX, GY, cx, cy, z0 + h);
  b.set(rx(t), ry(t) - 1, PAL.iron[3]);
}

/** Door and a row of windows on the +y face. */
export function facade(
  b: PixelBuf,
  cx: number,
  cy: number,
  wid: number,
  xs: number[],
  doorX: number | null,
  z = 0,
) {
  for (const tx of xs) {
    const w = proj(OX, GY, cx + tx, cy + wid / 2, z);
    b.rect(rx(w) - 1, ry(w) - 12, 3, 4, PAL.amberDark);
    b.set(rx(w), ry(w) - 11, PAL.amber);
  }
  if (doorX !== null) {
    const d = proj(OX, GY, cx + doorX, cy + wid / 2, z);
    b.rect(rx(d) - 1, ry(d) - 9, 3, 8, PAL.trunkDark);
  }
}

/** Vertical opening (door, bay, dark interior) stretched between two ground points. */
function opening(
  b: PixelBuf,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  z0: number,
  h: number,
  color: RGB | ((x: number, y: number) => RGB | null),
) {
  const pts = [
    proj(OX, GY, ax, ay, z0),
    proj(OX, GY, bx, by, z0),
    proj(OX, GY, bx, by, z0 + h),
    proj(OX, GY, ax, ay, z0 + h),
  ];
  fillPoly(b, pts, typeof color === 'function' ? color : () => color);
}

/** Vertical post standing on the ground (or at z0). */
function post(b: PixelBuf, tx: number, ty: number, h: number, c: RGB, z0 = 0, w = 2) {
  const p = proj(OX, GY, tx, ty, z0);
  b.rect(rx(p) - Math.floor(w / 2), ry(p) - h, w, h, c);
}

/** Straight bar between two tile-space points at given heights. */
function bar(
  b: PixelBuf,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  c: RGB,
  thick = 1,
) {
  const p = proj(OX, GY, ax, ay, az);
  const q = proj(OX, GY, bx, by, bz);
  for (let t = 0; t < thick; t++) b.line(rx(p), ry(p) + t, rx(q), ry(q) + t, c);
}

/** Conical heap of loose material. */
export function heap(
  b: PixelBuf,
  cx: number,
  cy: number,
  r: number,
  h: number,
  shades: RGB[],
  seed: number,
) {
  const c = proj(OX, GY, cx, cy);
  const hrx = r * 32;
  const hry = r * 16;
  for (let y = Math.floor(c.y - hry - h); y <= Math.ceil(c.y + hry); y++)
    for (let x = Math.floor(c.x - hrx); x <= Math.ceil(c.x + hrx); x++) {
      const nx = (x + 0.5 - c.x) / hrx;
      const dy = Math.sqrt(Math.max(0, 1 - nx * nx)) * hry;
      const top = c.y - h * (1 - Math.abs(nx)) - dy;
      if (y < top || y > c.y + dy) continue;
      const n = hash2(x >> 1, y >> 1, seed);
      const light = 0.75 + 0.35 * (1 - (nx + 1) / 2) + (y < top + 2 ? 0.15 : 0);
      b.set(x, y, shade(pick(shades, n), light));
    }
}

/** Stack of logs lying along +x. */
export function logStack(
  b: PixelBuf,
  cx: number,
  cy: number,
  len: number,
  rows: number,
  seed: number,
) {
  for (let r = 0; r < rows; r++) {
    const n = rows - r;
    for (let i = 0; i < n; i++) {
      const w = (i - (n - 1) / 2) * 0.09;
      drawPrism(b, {
        ox: OX,
        oy: GY,
        cx,
        cy: cy + w,
        angle: 0,
        len,
        wid: 0.08,
        h: 4,
        z0: r * 4,
        top: PAL.timber,
        side: [PAL.trunk, PAL.trunkDark],
        seed: seed + r * 7 + i,
      });
      const e = proj(OX, GY, cx + len / 2, cy + w, r * 4 + 2);
      b.set(rx(e), ry(e), PAL.sand[1]);
      b.set(rx(e) - 1, ry(e), PAL.sand[2]);
    }
  }
}

/** Wooden crates and barrels scattered on the yard. */
export function crates(b: PixelBuf, spots: [number, number][], seed: number) {
  spots.forEach(([x, y], i) => {
    if ((i + seed) % 3 === 2)
      drawCylinder(
        b,
        OX,
        GY,
        x,
        y,
        0.06,
        0,
        7,
        [PAL.timber[2], PAL.timber[0]],
        PAL.timber[1],
        seed + i,
      );
    else
      drawPrism(b, {
        ox: OX,
        oy: GY,
        cx: x,
        cy: y,
        angle: 0,
        len: 0.13,
        wid: 0.13,
        h: 6,
        top: PAL.timber.map((c) => shade(c, 1.1)),
        side: PAL.timber,
        seed: seed + i,
      });
  });
}

/** Round storage tank / silo with a domed cap and an iron band. */
export function silo(
  b: PixelBuf,
  cx: number,
  cy: number,
  r: number,
  h: number,
  side: RGB[],
  cap: RGB,
  seed: number,
  z0 = 0,
) {
  drawCylinder(b, OX, GY, cx, cy, r, z0, h, side, cap, seed);
  const t = proj(OX, GY, cx, cy, z0 + h);
  const prx = r * 32;
  for (let d = 1; d <= 4; d++) {
    const w = Math.round(prx * Math.sqrt(Math.max(0, 1 - (d / 5) ** 2)));
    for (let x = -w; x <= w; x++) b.set(rx(t) + x, ry(t) - d, shade(cap, 0.9 + 0.05 * d));
  }
  const m = proj(OX, GY, cx, cy, z0 + h * 0.55);
  for (let x = -Math.round(prx); x <= Math.round(prx); x++) {
    const yy = ry(m) + Math.round(Math.sqrt(Math.max(0, 1 - (x / prx) ** 2)) * r * 16);
    b.set(rx(m) + x, yy, PAL.iron[1]);
  }
}

/** Utility pole with a crossarm; used by the power line and the plant's switchyard. */
export function pole(b: PixelBuf, ox: number, oy: number, h = 26) {
  b.rect(ox - 1, oy - h, 2, h, PAL.timber[2]);
  b.rect(ox - 6, oy - h + 3, 12, 1, PAL.timber[1]);
  b.rect(ox - 6, oy - h + 4, 12, 1, PAL.timber[2]);
  for (const x of [-5, 0, 5]) {
    b.set(ox + x, oy - h + 2, PAL.cyanDark);
    b.set(ox + x, oy - h + 1, PAL.cyan);
  }
  b.set(ox - 1, oy - h - 1, PAL.iron[1]);
  b.set(ox, oy - h - 1, PAL.iron[1]);
}

/** Field with crop rows, greener at low levels, golden when mature; soft, irregular edge. */
function field(
  cx: number,
  cy: number,
  lenX: number,
  lenY: number,
  ripe: number,
  seed: number,
): GroundFn {
  return (tx, ty, x, y) => {
    if (rectDist(tx, ty, cx, cy, lenX, lenY) > ragged(x, y, seed + 5, 0.08)) return null;
    const row = (x + 2 * y) % 6;
    if (row > 3) return [shade(PAL.sand[2], 0.7 + 0.1 * hash2(x, y, seed)), 255];
    const n = hash2(x >> 1, y, seed);
    const c = n < ripe ? WHEATC : CROP;
    const s = pick(c, hash2(x, y >> 1, seed + 3));
    return [row === 0 ? shade(s, 1.12) : row === 3 ? shade(s, 0.85) : s, 255];
  };
}

/** Round pond with a stone rim. */
function pond(cx: number, cy: number, r: number, seed: number): GroundFn {
  return (tx, ty, x, y) => {
    const d = Math.hypot(tx - cx, ty - cy) / r;
    if (d > 1 + 0.12 * (hash2(x >> 1, y >> 1, seed) - 0.5)) return null;
    if (d > 0.8) return [pick(PAL.stone, hash2(x >> 1, y, seed + 1)), 255];
    const n = hash2(x >> 2, y >> 1, seed + 2);
    const c = PAL.water[Math.min(3, Math.floor(n * 4))];
    return [(x + 3 * y) % 11 === 0 && n > 0.5 ? PAL.cyanDark : c, 255];
  };
}

/** Post-and-rail fence between two ground points. */
function fence(b: PixelBuf, ax: number, ay: number, bx: number, by: number, seg = 4) {
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    post(b, ax + (bx - ax) * t, ay + (by - ay) * t, 5, PAL.timber[2], 0, 1);
  }
  bar(b, ax, ay, 4, bx, by, 4, PAL.timber[1]);
  bar(b, ax, ay, 2, bx, by, 2, PAL.timber[2]);
}

/** Lattice wind pump: iron mast with a many-vaned wheel and a tail vane. */
function windmill(b: PixelBuf, tx: number, ty: number, h: number) {
  const p = proj(OX, GY, tx, ty);
  const x = rx(p);
  const y = ry(p);
  b.line(x - 3, y, x - 1, y - h + 2, PAL.iron[2]);
  b.line(x + 3, y, x + 1, y - h + 2, PAL.iron[2]);
  for (let d = 4; d < h - 2; d += 5) b.rect(x - 2, y - d, 5, 1, PAL.iron[1]);
  const cy = y - h - 2;
  for (let a = 0; a < 28; a++) {
    const ang = (a / 28) * Math.PI * 2;
    b.set(x + Math.round(Math.cos(ang) * 6), cy + Math.round(Math.sin(ang) * 6), PAL.iron[3]);
  }
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2 + 0.2;
    b.line(
      x,
      cy,
      x + Math.round(Math.cos(ang) * 5),
      cy + Math.round(Math.sin(ang) * 5),
      PAL.iron[1],
    );
  }
  b.set(x, cy, PAL.brass);
  b.rect(x + 7, cy, 3, 1, PAL.iron[1]);
  b.rect(x + 10, cy - 2, 2, 5, PAL.red);
}

/** Open-fronted pole shed: dark interior, corner posts and a pitched roof on top. */
function openShed(
  b: PixelBuf,
  cx: number,
  cy: number,
  len: number,
  wid: number,
  h: number,
  seed: number,
) {
  const x0 = cx - len / 2;
  const x1 = cx + len / 2;
  const y0 = cy - wid / 2;
  const y1 = cy + wid / 2;
  pad(b, cx, cy, len, wid, (x, y) => shade(PAL.sand[2], 0.45 + 0.1 * hash2(x, y, seed)));
  const dark = (x: number, y: number) => shade(pick(PAL.timber, hash2(x >> 1, y, seed)), 0.5);
  opening(b, x0, y0, x0, y1, 0, h, dark); // inner side of the -x wall
  opening(b, x0, y0, x1, y0, 0, h, dark); // inner side of the -y wall
  for (const [px, py] of [
    [x0, y1],
    [x1, y1],
    [x1, y0],
    [cx, y1],
    [x1, cy],
  ])
    post(b, px, py, h, PAL.timber[2]);
  drawPrism(b, {
    ox: OX,
    oy: GY,
    cx,
    cy,
    angle: 0,
    len: len + 0.04,
    wid: wid + 0.04,
    h: 0,
    z0: h,
    top: SHINGLE,
    side: PAL.timber,
    ridge: Math.max(4, Math.round(wid * 20)),
    roof: SHINGLE,
    seed: seed + 1,
  });
}

/** Ingots stacked in a small pyramid. */
function ingots(b: PixelBuf, tx: number, ty: number) {
  const p = proj(OX, GY, tx, ty);
  for (let r = 0; r < 3; r++)
    for (let i = 0; i < 3 - r; i++)
      b.rect(rx(p) - 5 + i * 4 + r * 2, ry(p) - 2 - r * 2, 4, 2, STEEL[(i + r) % 3]);
}

// ------------------------------------------------------------------ station families

/** Farm: red barn, golden wheat rows, fence; silos from level 2, a wind pump at level 3. */
function farm(level: number): PixelBuf {
  const b = new PixelBuf(W, H);
  // wheat field along the +x half, shrinking a bit when the silos arrive
  const gnd: GroundFn[] = [
    level === 1
      ? field(0.24, 0.02, 0.4, 0.82, 0.55, 32)
      : field(0.24, 0.12, 0.4, 0.62, 0.7 + 0.1 * level, 32 + level),
  ];
  // fence along the front-left edge
  fence(b, -0.43, 0.42, -0.06, 0.42);
  // barn
  const bl = 0.34 + 0.04 * level;
  const bw = 0.28 + 0.03 * level;
  const bh = 11 + 3 * level;
  const bx = -0.23;
  const by = -0.17;
  house(b, bx, by, bl, bw, bh, BARN, PAL.roofSlate, 33 + level);
  gnd.push(shadowRect(bx, by, bl, bw));
  // big barn door with cross bracing on the +y face, hayloft hatch above
  opening(b, bx - 0.07, by + bw / 2, bx + 0.07, by + bw / 2, 0, bh - 4, PAL.trunkDark);
  const d0 = proj(OX, GY, bx - 0.07, by + bw / 2, 0);
  const d1 = proj(OX, GY, bx + 0.07, by + bw / 2, 0);
  b.line(rx(d0), ry(d0) - 1, rx(d1), ry(d1) - (bh - 4), PAL.timber[1]);
  b.line(rx(d0), ry(d0) - (bh - 4), rx(d1), ry(d1) - 1, PAL.timber[1]);
  facade(b, bx, by, bw, [bx > 0 ? 0 : bl * 0.32], null, 2);
  if (level === 1) {
    heap(b, -0.26, 0.24, 0.1, 6, WHEATC, 34);
    crates(b, [[-0.06, 0.3]], 35);
    gnd.push(shadowEllipse(-0.26, 0.24, 0.12));
  } else if (level === 2) {
    silo(b, 0.3, -0.33, 0.1, 24, STEEL, STEEL[1], 36);
    heap(b, -0.26, 0.24, 0.1, 6, WHEATC, 34);
    crates(b, [[-0.08, 0.3]], 37);
    gnd.push(shadowEllipse(0.3, -0.33, 0.13), shadowEllipse(-0.26, 0.24, 0.12));
  } else {
    silo(b, 0.2, -0.34, 0.085, 28, STEEL, STEEL[1], 38);
    silo(b, 0.36, -0.34, 0.085, 28, STEEL, STEEL[1], 39);
    heap(b, -0.1, 0.3, 0.1, 6, WHEATC, 34);
    windmill(b, -0.3, 0.26, 30);
    gnd.push(
      shadowEllipse(0.2, -0.34, 0.11),
      shadowEllipse(0.36, -0.34, 0.11),
      shadowEllipse(-0.1, 0.3, 0.12),
      shadowEllipse(-0.3, 0.26, 0.08, 50),
    );
  }
  b.outline(PAL.outline, 170);
  ground(b, gnd);
  return b;
}

/** Lumber: pale timber saw shed with an open front, log stacks and sawdust; chimney at level 3. */
function lumber(level: number): PixelBuf {
  const b = new PixelBuf(W, H);
  heap(b, 0.3, 0.3, 0.13, 5, DUST, 42); // sawdust
  // wood chips strewn under the log stacks, sawdust drift around the heap
  const gnd: GroundFn[] = [
    patchRect(0.18, -0.1, 0.5, 0.5, loose(DUST, 40), 40, 120, 0.1),
    patchEllipse(0.3, 0.3, 0.17, loose(DUST, 41), 41, 160, 0.08),
    shadowEllipse(0.3, 0.3, 0.15),
  ];
  if (level === 1) {
    openShed(b, -0.2, -0.16, 0.4, 0.32, 12, 43);
    logStack(b, 0.2, -0.2, 0.4, 2, 44);
    gnd.push(shadowRect(-0.2, -0.16, 0.4, 0.32), shadowRect(0.2, -0.2, 0.4, 0.2));
    // saw bench inside
    drawPrism(b, {
      ox: OX,
      oy: GY,
      cx: -0.2,
      cy: -0.14,
      angle: 0,
      len: 0.22,
      wid: 0.08,
      h: 5,
      top: STEEL,
      side: PAL.timber,
      seed: 45,
    });
    crates(b, [[-0.16, 0.3]], 46);
  } else {
    const sx = -0.2;
    const sy = -0.16;
    const sl = 0.44;
    const sw = 0.34;
    const sh = level === 2 ? 15 : 17;
    house(b, sx, sy, sl, sw, sh, PALE_TIMBER, SHINGLE, 47 + level);
    gnd.push(shadowRect(sx, sy, sl, sw), shadowRect(0.2, -0.22, 0.4, 0.3));
    gnd.push(shadowRect(0.12, 0.08, 0.34, 0.2));
    // big open sawing bay on the +y face with the blade glinting inside
    const fy = sy + sw / 2;
    opening(b, sx - 0.16, fy, sx + 0.1, fy, 0, sh - 3, (x, y) =>
      shade(pick(PAL.timber, hash2(x >> 1, y, 48)), 0.35),
    );
    const bl = proj(OX, GY, sx - 0.02, fy, 5);
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      b.set(
        rx(bl) + Math.round(Math.cos(ang) * 3),
        ry(bl) + Math.round(Math.sin(ang) * 4),
        STEEL[1],
      );
    }
    b.set(rx(bl), ry(bl), PAL.iron[2]);
    facade(b, sx, sy, sw, [sl * 0.36], null);
    logStack(b, 0.2, -0.22, 0.4, 3, 49);
    logStack(b, 0.12, 0.08, 0.34, 2, 50);
    if (level === 3) {
      chimney(b, -0.39, -0.3, 0, 32, 0.05, BRICK);
      openShed(b, -0.24, 0.26, 0.34, 0.26, 10, 51);
      logStack(b, -0.24, 0.26, 0.24, 1, 52);
      gnd.push(shadowRect(-0.24, 0.26, 0.34, 0.26));
    } else crates(b, [[-0.3, 0.3]], 53);
  }
  b.outline(PAL.outline, 170);
  ground(b, gnd);
  return b;
}

/** Quarry: grey rock face at the back, gravel heaps; derrick at 2, steel crusher + conveyor at 3. */
function quarry(level: number): PixelBuf {
  const b = new PixelBuf(W, H);
  // gravel apron under the heaps and along the foot of the rock face; shadows under the face
  const hr = 0.16 + 0.02 * level;
  const gnd: GroundFn[] = [
    patchRect(-0.02, -0.26, 0.82, 0.16, loose(GRAVEL, 50), 50, 220, 0.08),
    patchEllipse(0.24, 0.16, hr + 0.07, loose(GRAVEL, 51), 51, 255, 0.08),
    shadowRect(0.0, -0.38, 0.9, 0.14, 60),
    shadowRect(-0.38, -0.02, 0.14, 0.54, 60),
    shadowEllipse(0.24, 0.16, hr + 0.02),
  ];
  // jagged rock face along the -y and -x edges
  const blocks: [number, number, number, number][] = [];
  for (let i = 0; i < 5; i++) blocks.push([-0.36 + i * 0.18, -0.38, 0.18, 0.14]);
  for (let i = 0; i < 3; i++) blocks.push([-0.38, -0.2 + i * 0.18, 0.14, 0.18]);
  blocks.forEach(([cx, cy, len, wid], i) => {
    const h = 5 + Math.floor(hash2(i, level, 52) * 11) + 2 * level;
    drawPrism(b, {
      ox: OX,
      oy: GY,
      cx,
      cy,
      angle: 0,
      len,
      wid,
      h,
      top: [PAL.rock[3], PAL.rock[1]],
      side: PAL.rock,
      seed: 53 + i,
    });
  });
  // loose boulders at the foot of the face
  for (const [bx, by] of [
    [-0.24, -0.2],
    [0.08, -0.24],
  ]) {
    const p = proj(OX, GY, bx, by);
    b.ellipse(rx(p), ry(p) - 2, 3, 2, PAL.rock, 54);
  }
  heap(b, 0.24, 0.16, 0.16 + 0.02 * level, 8 + 2 * level, GRAVEL, 55);
  if (level === 1) {
    house(b, -0.16, 0.24, 0.26, 0.2, 8, PAL.timber, PAL.roofSlate, 56);
    facade(b, -0.16, 0.24, 0.2, [], 0.04);
    crates(b, [[0.06, 0.36]], 57);
    gnd.push(shadowRect(-0.16, 0.24, 0.26, 0.2));
  } else if (level === 2) {
    house(b, -0.2, 0.26, 0.26, 0.2, 9, PAL.timber, PAL.roofSlate, 58);
    facade(b, -0.2, 0.26, 0.2, [-0.06], 0.05);
    gnd.push(shadowRect(-0.2, 0.26, 0.26, 0.2), shadowEllipse(-0.02, -0.04, 0.08, 50));
    // timber derrick: mast, boom, cable and a stone block on the hook
    const m = proj(OX, GY, -0.02, -0.04);
    const mx = rx(m);
    const my = ry(m);
    b.rect(mx - 1, my - 32, 3, 32, PAL.timber[2]);
    b.line(mx - 4, my, mx - 1, my - 28, PAL.timber[1]);
    b.line(mx + 4, my, mx + 1, my - 28, PAL.timber[1]);
    b.line(mx, my - 31, mx + 15, my - 15, PAL.timber[0]);
    b.line(mx, my - 30, mx + 15, my - 14, PAL.timber[2]);
    b.line(mx + 15, my - 15, mx + 15, my - 4, PAL.iron[3]);
    b.rect(mx + 13, my - 5, 5, 4, PAL.rock[1]);
    crates(b, [[0.06, 0.38]], 59);
  } else {
    // steel crusher tower with hopper, conveyor down to the gravel heap
    house(b, -0.16, 0.06, 0.3, 0.3, 24, STEEL, null, 60);
    drawPrism(b, {
      ox: OX,
      oy: GY,
      cx: -0.16,
      cy: 0.06,
      angle: 0,
      len: 0.24,
      wid: 0.24,
      h: 8,
      z0: 24,
      top: [PAL.iron[2], PAL.iron[0]],
      side: PAL.iron,
      seed: 61,
    });
    opening(b, -0.24, 0.21, -0.1, 0.21, 0, 9, PAL.outline);
    bar(b, -0.02, 0.1, 18, 0.22, 0.18, 12, PAL.iron[3]);
    bar(b, -0.02, 0.1, 17, 0.22, 0.18, 11, PAL.iron[2]);
    post(b, 0.12, 0.14, 12, PAL.iron[2], 0, 1);
    heap(b, -0.24, 0.34, 0.12, 5, GRAVEL, 62);
    heap(b, 0.14, -0.14, 0.1, 5, PAL.rock, 63);
    gnd.unshift(patchEllipse(-0.24, 0.34, 0.17, loose(GRAVEL, 52), 52, 255, 0.08));
    gnd.push(shadowRect(-0.16, 0.06, 0.3, 0.3, 80), shadowEllipse(-0.24, 0.34, 0.14));
  }
  b.outline(PAL.outline, 170);
  ground(b, gnd);
  return b;
}

/** Pump: brick pump house beside a blue pond; blue steel tank at 2, elevated tank at 3. */
function pump(level: number): PixelBuf {
  const b = new PixelBuf(W, H);
  // pond in the front-right corner with a stone rim
  const gnd: GroundFn[] = [pond(0.2, 0.2, 0.23, 62)];
  // pump house
  const hl = 0.32 + 0.04 * level;
  const hw = 0.28 + 0.03 * level;
  const hh = 11 + 2 * level;
  const hx = -0.22;
  const hy = -0.2;
  house(b, hx, hy, hl, hw, hh, BRICK, PAL.roofSlate, 64 + level);
  gnd.push(shadowRect(hx, hy, hl, hw));
  facade(b, hx, hy, hw, level === 1 ? [-0.06] : [-0.12, 0.02], hl * 0.32);
  chimney(b, hx - hl / 2 + 0.05, hy - hw / 2 + 0.05, hh, 8 + level, 0.035, BRICK);
  // pipe from the house to the pond, with a valve wheel
  bar(b, hx + 0.02, hy + hw / 2 + 0.02, 4, 0.06, 0.06, 4, PAL.iron[3]);
  bar(b, hx + 0.02, hy + hw / 2 + 0.02, 3, 0.06, 0.06, 3, PAL.iron[2]);
  const v = proj(OX, GY, -0.04, 0.0, 6);
  b.rect(rx(v) - 1, ry(v) - 1, 3, 3, PAL.red);
  if (level === 2) {
    silo(b, 0.27, -0.28, 0.11, 18, BLUE_STEEL, BLUE_STEEL[1], 66);
    gnd.push(shadowEllipse(0.27, -0.28, 0.13));
  } else if (level === 3) {
    gnd.push(shadowRect(0.27, -0.27, 0.24, 0.24, 50));
    for (const [lx, ly] of [
      [0.16, -0.38],
      [0.38, -0.38],
      [0.38, -0.16],
      [0.16, -0.16],
    ])
      post(b, lx, ly, 20, PAL.iron[2]);
    bar(b, 0.16, -0.16, 8, 0.38, -0.16, 8, PAL.iron[1]);
    bar(b, 0.38, -0.38, 8, 0.38, -0.16, 8, PAL.iron[1]);
    silo(b, 0.27, -0.27, 0.13, 14, BLUE_STEEL, BLUE_STEEL[1], 67, 20);
    post(b, 0.27, -0.27, 20, PAL.iron[3], 0, 1);
  }
  if (level === 1) crates(b, [[-0.3, 0.3]], 68);
  b.outline(PAL.outline, 170);
  ground(b, gnd);
  return b;
}

/** Town: whitewashed and brick houses around a cobbled square; church tower from level 2. */
function town(level: number): PixelBuf {
  const b = new PixelBuf(W, H);
  // a cobbled square between the houses, ragged where it meets the grass
  const cob = paving(COBBLE, 71);
  const gnd: GroundFn[] =
    level === 1
      ? [patchRect(-0.14, 0.14, 0.34, 0.3, cob, 71, 235, 0.1)]
      : level === 2
        ? [
            patchRect(0.0, 0.24, 0.24, 0.34, cob, 71, 235, 0.1),
            patchRect(0.0, 0.0, 0.7, 0.18, cob, 72, 235, 0.1),
          ]
        : [
            patchRect(0.0, 0.26, 0.3, 0.32, cob, 71, 235, 0.1),
            patchRect(0.0, -0.02, 0.76, 0.16, cob, 72, 235, 0.1),
          ];
  const homes: [number, number, number, number, RGB[], RGB[]][] =
    level === 1
      ? [
          [-0.24, -0.22, 0.3, 0.26, WHITEWASH, PAL.roof],
          [0.22, 0.2, 0.26, 0.24, BRICK, PAL.roofSlate],
        ]
      : level === 2
        ? [
            [-0.26, -0.24, 0.3, 0.26, WHITEWASH, PAL.roof],
            [0.22, -0.28, 0.28, 0.22, BRICK, PAL.roofSlate],
            [-0.28, 0.22, 0.24, 0.24, BRICK, PAL.roof],
            [0.26, 0.22, 0.28, 0.24, WHITEWASH, PAL.roofSlate],
          ]
        : [
            [-0.3, -0.26, 0.26, 0.26, BRICK, PAL.roofSlate],
            [0.04, -0.32, 0.26, 0.2, WHITEWASH, PAL.roof],
            [0.32, -0.22, 0.22, 0.26, WHITEWASH, PAL.roof],
            [-0.3, 0.2, 0.26, 0.26, WHITEWASH, PAL.roofSlate],
            [0.3, 0.22, 0.26, 0.26, BRICK, PAL.roof],
          ];
  homes.forEach(([cx, cy, len, wid, side, roof], i) => {
    house(b, cx, cy, len, wid, 10 + level * 2 + (i % 2) * 2, side, roof, 73 + i);
    facade(b, cx, cy, wid, [-len * 0.25], len * 0.2);
    gnd.push(shadowRect(cx, cy, len, wid));
  });
  if (level >= 2) {
    // church / hall tower with a slate spire in the middle of the square
    const th = 14 + level * 6;
    house(b, 0.0, -0.02, 0.18, 0.18, th, PAL.stone, null, 79);
    gnd.push(shadowRect(0.0, -0.02, 0.18, 0.18, 80));
    const t = proj(OX, GY, 0, -0.02, th);
    const sp = 6 + level * 2;
    for (let d = 0; d <= sp; d++) {
      const r = Math.round(6 * (1 - d / sp));
      for (let x = -r; x <= r; x++) b.set(rx(t) + x, ry(t) - d, PAL.roofSlate[(x + r + d) % 3]);
    }
    b.set(rx(t), ry(t) - sp - 1, PAL.brass);
    const f = proj(OX, GY, 0.09, -0.02, th - 8);
    b.rect(rx(f) - 1, ry(f) - 2, 3, 3, PAL.white);
    b.set(rx(f), ry(f) - 1, PAL.outline);
    const w = proj(OX, GY, 0.0, 0.07, th - 8);
    b.rect(rx(w) - 1, ry(w) - 2, 3, 3, PAL.white);
    b.set(rx(w), ry(w) - 1, PAL.outline);
  }
  // lamp posts
  for (const [lx, ly] of level === 3
    ? [
        [0.02, 0.4],
        [-0.02, -0.4],
      ]
    : level === 2
      ? [[0.0, 0.38]]
      : [[0.02, -0.02]]) {
    const p = proj(OX, GY, lx, ly);
    b.rect(rx(p), ry(p) - 12, 1, 12, PAL.iron[2]);
    b.rect(rx(p) - 1, ry(p) - 14, 3, 2, PAL.amber);
    b.set(rx(p), ry(p) - 15, PAL.iron[1]);
  }
  b.outline(PAL.outline, 170);
  ground(b, gnd);
  return b;
}

/** Warehouse: long concrete sheds with big dark doors, crates and barrels; gantry crane at 3. */
function warehouse(level: number): PixelBuf {
  const b = new PixelBuf(W, H);
  // concrete pad only under the sheds (plus a short apron), shadows under sheds and crates
  const gnd: GroundFn[] = [];
  if (level === 1) {
    gnd.push(patchRect(-0.1, -0.1, 0.66, 0.5, concrete(81), 81, 255, 0.05));
    gnd.push(shadowRect(-0.14, -0.14, 0.5, 0.34), shadowEllipse(0.24, 0.28, 0.14, 50));
    flatShed(b, -0.14, -0.14, 0.5, 0.34, 13, CONCRETE, 83);
    opening(b, -0.22, 0.03, -0.08, 0.03, 0, 10, PAL.outline);
    const l = proj(OX, GY, -0.15, 0.03, 10);
    b.rect(rx(l) - 4, ry(l), 9, 1, PAL.amberDark);
    crates(
      b,
      [
        [0.3, 0.2],
        [0.16, 0.34],
      ],
      84,
    );
  } else if (level === 2) {
    gnd.push(patchRect(-0.05, -0.1, 0.8, 0.56, concrete(81), 81, 255, 0.05));
    gnd.push(shadowRect(-0.1, -0.14, 0.66, 0.4), shadowEllipse(0.26, 0.28, 0.18, 50));
    flatShed(b, -0.1, -0.14, 0.66, 0.4, 17, CONCRETE, 85);
    for (const dx of [-0.32, -0.06]) opening(b, dx, 0.06, dx + 0.14, 0.06, 0, 13, PAL.outline);
    for (const dx of [-0.32, -0.06]) {
      const l = proj(OX, GY, dx + 0.07, 0.06, 13);
      b.rect(rx(l) - 4, ry(l), 9, 1, PAL.amberDark);
    }
    facade(b, -0.1, -0.14, 0.4, [0.2], null, 4);
    crates(
      b,
      [
        [0.34, 0.14],
        [0.22, 0.32],
        [0.38, 0.34],
        [0.02, 0.36],
      ],
      86,
    );
  } else {
    gnd.push(patchRect(-0.14, -0.06, 0.62, 0.78, concrete(81), 81, 255, 0.05));
    gnd.push(shadowRect(-0.18, -0.26, 0.54, 0.28), shadowRect(-0.18, 0.1, 0.54, 0.28));
    gnd.push(shadowRect(0.37, 0.0, 0.14, 0.84, 35));
    flatShed(b, -0.18, -0.26, 0.54, 0.28, 18, CONCRETE, 87);
    flatShed(b, -0.18, 0.1, 0.54, 0.28, 18, CONCRETE, 88);
    for (const cy of [-0.26, 0.1]) {
      opening(b, 0.09, cy - 0.08, 0.09, cy + 0.08, 0, 13, PAL.outline);
      const l = proj(OX, GY, 0.09, cy, 13);
      b.rect(rx(l) - 4, ry(l), 9, 1, PAL.amberDark);
    }
    opening(b, -0.38, 0.24, -0.26, 0.24, 0, 13, PAL.outline);
    // gantry crane spanning the loading bay along the +x edge
    for (const ly of [-0.42, 0.42]) {
      post(b, 0.32, ly, 30, PAL.iron[2]);
      post(b, 0.42, ly, 30, PAL.iron[2]);
      bar(b, 0.32, ly, 30, 0.42, ly, 30, PAL.iron[3]);
    }
    bar(b, 0.32, -0.42, 30, 0.32, 0.42, 30, PAL.iron[3]);
    bar(b, 0.32, -0.42, 29, 0.32, 0.42, 29, PAL.iron[1]);
    bar(b, 0.42, -0.42, 30, 0.42, 0.42, 30, PAL.iron[3]);
    // trolley and hook with a crate
    const tr = proj(OX, GY, 0.37, 0.0, 30);
    b.rect(rx(tr) - 2, ry(tr) - 3, 5, 3, PAL.iron[0]);
    b.rect(rx(tr), ry(tr), 1, 12, PAL.iron[3]);
    b.rect(rx(tr) - 2, ry(tr) + 12, 5, 4, PAL.cargoGoods);
    crates(
      b,
      [
        [0.3, 0.22],
        [0.38, -0.2],
        [0.14, 0.36],
      ],
      89,
    );
  }
  b.outline(PAL.outline, 170);
  ground(b, gnd);
  return b;
}

// ------------------------------------------------------------------ processing buildings

/** Beehive brick kiln with a wood pile and a glowing mouth. */
function kiln(): PixelBuf {
  const b = new PixelBuf(W, H);
  const kx = -0.08;
  const ky = -0.08;
  const kr = 0.27;
  // ash and soot in front of the mouth, coal dust under the heap, shadows
  const gnd: GroundFn[] = [
    patchEllipse(kx + 0.02, ky + kr + 0.08, 0.12, loose(PAL.stone, 90), 90, 110, 0.08),
    patchEllipse(-0.32, 0.3, 0.15, loose(COAL, 91), 91, 130, 0.08),
    shadowEllipse(kx, ky, kr + 0.02, 80, 0.25),
    shadowRect(0.26, 0.2, 0.3, 0.2),
    shadowEllipse(-0.32, 0.3, 0.12),
  ];
  drawCylinder(b, OX, GY, kx, ky, kr, 0, 10, BRICK, BRICK[2], 92);
  const t = proj(OX, GY, kx, ky, 10);
  const prx = kr * 32;
  const dome = 15;
  for (let d = 1; d <= dome; d++) {
    const w = Math.round(prx * Math.sqrt(Math.max(0, 1 - (d / (dome + 1)) ** 2)));
    for (let x = -w; x <= w; x++) {
      const n = hash2(x >> 1, d >> 1, 93);
      const light = 0.78 + 0.03 * d + 0.18 * (1 - (x / prx + 1) / 2);
      b.set(rx(t) + x, ry(t) - d, shade(pick(BRICK, n), light));
    }
  }
  // iron hoop and the smoke vent on top
  for (let x = -Math.round(prx * 0.95); x <= Math.round(prx * 0.95); x++)
    b.set(rx(t) + x, ry(t) - 4 + Math.round(((x * x) / (prx * prx)) * 3), PAL.iron[1]);
  b.rect(rx(t) - 2, ry(t) - dome - 2, 5, 3, PAL.iron[0]);
  b.set(rx(t) - 3, ry(t) - dome - 4, PAL.stone[2]);
  b.set(rx(t) - 5, ry(t) - dome - 6, PAL.stone[1]);
  // glowing mouth on the front
  const c = proj(OX, GY, kx, ky, 0);
  const mx = rx(c);
  const my = ry(c) + Math.round(kr * 16) - 1;
  b.rect(mx - 3, my - 7, 7, 7, PAL.outline);
  b.rect(mx - 2, my - 6, 5, 5, PAL.amberDark);
  b.rect(mx - 1, my - 5, 3, 3, PAL.amber);
  b.set(mx, my - 4, PAL.white);
  logStack(b, 0.26, 0.2, 0.3, 2, 94);
  heap(b, -0.32, 0.3, 0.1, 5, COAL, 95);
  b.outline(PAL.outline, 170);
  ground(b, gnd);
  return b;
}

/** Stone grinder: tall mill tower with a big cog wheel, stone in, gravel and ingots out. */
function grinder(): PixelBuf {
  const b = new PixelBuf(W, H);
  const tx = -0.16;
  const ty = -0.14;
  // gravel aprons under the stone and gravel heaps, shadow under the tower
  const gnd: GroundFn[] = [
    patchEllipse(0.26, 0.2, 0.24, loose(GRAVEL, 100), 100, 255, 0.08),
    patchEllipse(-0.28, 0.32, 0.16, loose(GRAVEL, 101), 101, 255, 0.08),
    shadowRect(tx, ty, 0.32, 0.32, 80),
    shadowEllipse(0.26, 0.2, 0.19),
    shadowEllipse(-0.28, 0.32, 0.13),
  ];
  house(b, tx, ty, 0.32, 0.32, 32, PAL.stone, PAL.roofSlate, 102);
  facade(b, tx, ty, 0.32, [-0.08, 0.06], null, 14);
  facade(b, tx, ty, 0.32, [-0.08], 0.06);
  chimney(b, tx - 0.1, ty - 0.1, 38, 8, 0.04);
  // big cog wheel on the +x face
  const c = proj(OX, GY, tx + 0.16, ty, 16);
  const cx = rx(c) + 2;
  const cy = ry(c);
  for (let a = 0; a < 24; a++) {
    const ang = (a / 24) * Math.PI * 2;
    b.set(cx + Math.round(Math.cos(ang) * 5), cy + Math.round(Math.sin(ang) * 9), PAL.iron[3]);
    if (a % 3 === 0)
      b.set(cx + Math.round(Math.cos(ang) * 6), cy + Math.round(Math.sin(ang) * 11), PAL.iron[1]);
  }
  for (let a = 0; a < 6; a++) {
    const ang = (a / 6) * Math.PI * 2;
    b.line(
      cx,
      cy,
      cx + Math.round(Math.cos(ang) * 4),
      cy + Math.round(Math.sin(ang) * 7),
      PAL.iron[1],
    );
  }
  b.rect(cx - 1, cy - 1, 3, 3, PAL.brass);
  // hopper mouth on the roof and a feed chute
  drawPrism(b, {
    ox: OX,
    oy: GY,
    cx: tx + 0.14,
    cy: ty - 0.1,
    angle: 0,
    len: 0.12,
    wid: 0.12,
    h: 6,
    z0: 34,
    top: [PAL.iron[2], PAL.iron[0]],
    side: PAL.iron,
    seed: 103,
  });
  heap(b, 0.26, 0.2, 0.17, 8, PAL.rock, 104);
  heap(b, -0.28, 0.32, 0.11, 4, GRAVEL, 105);
  ingots(b, 0.06, 0.36);
  b.outline(PAL.outline, 170);
  ground(b, gnd);
  return b;
}

/** Refinery: silver distillation column, two white tanks, a flare stack and pipework. */
function refinery(): PixelBuf {
  const b = new PixelBuf(W, H);
  const cx = -0.28;
  const cy = -0.24;
  // concrete pads only under the column and the two tanks
  const gnd: GroundFn[] = [
    patchEllipse(cx, cy, 0.15, concrete(111), 111, 255, 0.05),
    patchEllipse(0.14, -0.24, 0.21, concrete(111), 112, 255, 0.05),
    patchEllipse(0.3, 0.12, 0.19, concrete(111), 113, 255, 0.05),
    shadowEllipse(cx, cy, 0.11),
    shadowEllipse(0.14, -0.24, 0.16),
    shadowEllipse(0.3, 0.12, 0.14),
    shadowRect(-0.24, 0.24, 0.28, 0.22),
  ];
  drawCylinder(b, OX, GY, cx, cy, 0.09, 0, 46, SILVER, SILVER[1], 113);
  // rings, a platform and a ladder on the column
  for (const z of [12, 24, 36]) {
    const r = proj(OX, GY, cx, cy, z);
    for (let x = -3; x <= 3; x++)
      b.set(rx(r) + x, ry(r) + Math.round(Math.sqrt(9 - x * x) * 0.5), PAL.iron[2]);
  }
  const pl = proj(OX, GY, cx, cy, 30);
  b.rect(rx(pl) - 5, ry(pl), 11, 1, PAL.iron[1]);
  b.rect(rx(pl) - 5, ry(pl) - 3, 1, 3, PAL.iron[3]);
  b.rect(rx(pl) + 5, ry(pl) - 3, 1, 3, PAL.iron[3]);
  silo(b, 0.14, -0.24, 0.14, 15, TANK_WHITE, TANK_WHITE[1], 114);
  silo(b, 0.3, 0.12, 0.12, 12, TANK_WHITE, TANK_WHITE[1], 115);
  // red band on the big tank
  const bd = proj(OX, GY, 0.14, -0.24, 11);
  for (let x = -4; x <= 4; x++)
    b.set(rx(bd) + x, ry(bd) + 4 + Math.round(Math.abs(x) / 3), PAL.red);
  // pipes: column -> tank 1 (elevated), tank 1 -> tank 2 (ground)
  bar(b, cx + 0.08, cy, 24, 0.02, cy, 24, PAL.iron[3]);
  bar(b, 0.02, cy, 24, 0.02, cy, 15, PAL.iron[3]);
  bar(b, 0.14, -0.1, 4, 0.14, 0.02, 4, PAL.iron[3]);
  bar(b, 0.14, 0.02, 4, 0.28, 0.02, 4, PAL.iron[3]);
  // small control house
  house(b, -0.24, 0.24, 0.28, 0.22, 9, BRICK, PAL.roofSlate, 116);
  facade(b, -0.24, 0.24, 0.22, [-0.08], 0.06);
  // flare stack with a flame
  const f = proj(OX, GY, 0.04, 0.36);
  b.rect(rx(f), ry(f) - 30, 1, 30, PAL.iron[2]);
  b.rect(rx(f) - 1, ry(f) - 31, 3, 2, PAL.iron[0]);
  b.rect(rx(f) - 1, ry(f) - 34, 3, 3, PAL.amber);
  b.set(rx(f), ry(f) - 35, PAL.red);
  b.set(rx(f), ry(f) - 33, PAL.white);
  crates(b, [[0.36, 0.36]], 119);
  b.outline(PAL.outline, 170);
  ground(b, gnd);
  return b;
}

/** Power plant: brick turbine hall, very tall banded chimney, cooling tank and a switchyard pole. */
function powerPlant(): PixelBuf {
  const b = new PixelBuf(W, H);
  const hx = -0.08;
  const hy = -0.1;
  const gnd: GroundFn[] = [
    patchEllipse(0.32, -0.3, 0.15, loose(COAL, 120), 120, 130, 0.08),
    shadowRect(hx, hy, 0.62, 0.42, 80),
    shadowEllipse(-0.36, -0.34, 0.09),
    shadowEllipse(0.3, 0.2, 0.16),
    shadowRect(-0.3, 0.32, 0.14, 0.12),
    shadowEllipse(0.32, -0.3, 0.12),
  ];
  house(b, hx, hy, 0.62, 0.42, 22, BRICK, PAL.roofSlate, 123);
  // tall arched windows on the +y face
  for (const tx of [-0.24, -0.12, 0.0, 0.12]) {
    const w = proj(OX, GY, hx + tx, hy + 0.21, 0);
    b.rect(rx(w) - 1, ry(w) - 16, 3, 8, PAL.amberDark);
    b.set(rx(w), ry(w) - 17, PAL.amberDark);
    b.set(rx(w), ry(w) - 14, PAL.amber);
  }
  opening(b, hx + 0.19, hy + 0.21, hx + 0.27, hy + 0.21, 0, 12, PAL.outline);
  // clerestory strip on the roof
  drawPrism(b, {
    ox: OX,
    oy: GY,
    cx: hx,
    cy: hy,
    angle: 0,
    len: 0.42,
    wid: 0.1,
    h: 4,
    z0: 28,
    top: PAL.roofSlate,
    side: [PAL.amberDark, PAL.amber],
    seed: 124,
  });
  // chimney with a red band and an iron cap
  const sx = -0.36;
  const sy = -0.34;
  chimney(b, sx, sy, 0, 48, 0.065, BRICK);
  const s = proj(OX, GY, sx, sy, 40);
  b.rect(rx(s) - 2, ry(s), 5, 3, PAL.red);
  const cap = proj(OX, GY, sx, sy, 48);
  b.rect(rx(cap) - 2, ry(cap) - 1, 5, 2, PAL.iron[0]);
  // cooling tank
  silo(b, 0.3, 0.2, 0.14, 14, STEEL, STEEL[1], 125);
  bar(b, 0.22, 0.12, 6, 0.16, 0.1, 6, PAL.iron[3]);
  // transformer box with insulators, and a pole
  drawPrism(b, {
    ox: OX,
    oy: GY,
    cx: -0.3,
    cy: 0.32,
    angle: 0,
    len: 0.14,
    wid: 0.12,
    h: 8,
    top: PAL.iron,
    side: [PAL.iron[2], PAL.iron[0]],
    seed: 126,
  });
  const tp = proj(OX, GY, -0.3, 0.32, 8);
  for (const x of [-2, 0, 2]) {
    b.set(rx(tp) + x, ry(tp) - 2, PAL.cyan);
    b.set(rx(tp) + x, ry(tp) - 1, PAL.cyanDark);
  }
  const pl = proj(OX, GY, 0.04, 0.38);
  pole(b, rx(pl), ry(pl), 24);
  heap(b, 0.32, -0.3, 0.11, 5, COAL, 127);
  b.outline(PAL.outline, 170);
  ground(b, gnd);
  return b;
}

// ------------------------------------------------------------------ decor

/** Utility pole; anchored at the base like the signal. */
function powerLine(): PixelBuf {
  const b = new PixelBuf(16, 36);
  pole(b, 8, 35, 30);
  b.outline(PAL.outline, 170);
  return b;
}

/** Coaling stage: a timber trestle carrying a coal bunker with a chute. */
function fuelStop(): PixelBuf {
  const b = new PixelBuf(W, H);
  const legs: [number, number][] = [
    [-0.18, -0.14],
    [0.18, -0.14],
    [0.18, 0.14],
    [-0.18, 0.14],
  ];
  for (const [lx, ly] of legs) {
    const p = proj(OX, OY, lx, ly);
    b.rect(rx(p) - 1, ry(p) - 20, 2, 20, PAL.timber[2]);
  }
  // cross bracing on the two visible sides
  const b0 = proj(OX, OY, -0.18, 0.14);
  const b1 = proj(OX, OY, 0.18, 0.14);
  const b2 = proj(OX, OY, 0.18, -0.14);
  b.line(rx(b0), ry(b0) - 18, rx(b1), ry(b1) - 4, PAL.timber[1]);
  b.line(rx(b0), ry(b0) - 4, rx(b1), ry(b1) - 18, PAL.timber[1]);
  b.line(rx(b1), ry(b1) - 18, rx(b2), ry(b2) - 4, PAL.timber[1]);
  b.line(rx(b1), ry(b1) - 4, rx(b2), ry(b2) - 18, PAL.timber[1]);
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: 0,
    cy: 0,
    angle: 0,
    len: 0.44,
    wid: 0.36,
    h: 12,
    z0: 20,
    top: COAL,
    side: PAL.timber,
    seed: 131,
  });
  // heaped coal above the rim
  const t = proj(OX, OY, 0, 0, 32);
  for (let d = 0; d < 4; d++)
    for (let x = -10 + d * 2; x <= 10 - d * 2; x++)
      b.set(rx(t) + x, ry(t) - d, COAL[(((x + d) % 3) + 3) % 3]);
  // chute towards the track side
  const c0 = proj(OX, OY, 0.22, 0.1, 22);
  const c1 = proj(OX, OY, 0.4, 0.2, 12);
  b.line(rx(c0), ry(c0), rx(c1), ry(c1), PAL.iron[1]);
  b.line(rx(c0), ry(c0) + 1, rx(c1), ry(c1) + 1, PAL.iron[2]);
  // ladder on the front leg
  const ld = proj(OX, OY, -0.18, 0.14);
  for (let y = 2; y < 20; y += 3) b.rect(rx(ld) - 3, ry(ld) - y, 3, 1, PAL.timber[1]);
  const h0 = proj(OX, OY, -0.28, 0.28);
  b.ellipse(rx(h0), ry(h0) - 3, 6, 4, COAL, 132, 0.5);
  b.outline(PAL.outline, 170);
  // spilled coal around the heap, shadow under the trestle
  ground(b, [
    patchEllipse(-0.28, 0.28, 0.13, (x, y) => shade(pick(COAL, hash2(x, y, 133)), 1.1), 133, 200),
    shadowRect(0, 0, 0.4, 0.32, 55),
    shadowEllipse(-0.28, 0.28, 0.1),
  ]);
  return b;
}

export const STATION_FAMILIES: Record<string, (level: number) => PixelBuf> = {
  farm,
  lumber,
  quarry,
  pump,
  town,
  warehouse,
};
export const BUILDING_SPRITES: Record<string, () => PixelBuf> = {
  kiln,
  grinder,
  refinery,
  power_plant: powerPlant,
};
/** Footprint every townhouse stage and level shares (the yard and paving sit to its +x/+y). */
const HOUSE_CX = -0.04;
const HOUSE_CY = -0.02;
const HOUSE_STONE: RGB[] = [PAL.stone[2], PAL.stone[0], PAL.stone[1]];

/**
 * Townhouse by level: 1 a two-storey timber house with a pitched roof, a chimney and a small
 * yard; 2 a taller whitewashed house with two chimneys; 3 a brick block with a slate roof, three
 * rows of windows and an annex.
 */
function townhouse(level = 1): PixelBuf {
  const b = new PixelBuf(W, H);
  const len = [0.5, 0.54, 0.58][level - 1];
  const wid = [0.36, 0.38, 0.42][level - 1];
  const h = [22, 32, 42][level - 1];
  const side = level === 1 ? PAL.timber : level === 2 ? WHITEWASH : BRICK;
  const roof = level === 3 ? PAL.roofSlate : PAL.roof;
  const gnd: GroundFn[] = [
    shadowRect(HOUSE_CX + 0.02, HOUSE_CY + 0.02, len, wid),
    patchRect(0.22, 0.26, 0.3, 0.18, paving(PAL.stone, 61), 61, 200, 0.05),
  ];
  house(b, HOUSE_CX, HOUSE_CY, len, wid, h, side, roof, 44 + level);
  chimney(b, -0.2, -0.1, h, 8, 0.04, HOUSE_STONE);
  if (level >= 2) chimney(b, 0.12, -0.12, h, 7, 0.04, HOUSE_STONE);
  if (level >= 3) {
    // annex on the +x side
    const ax = HOUSE_CX + len / 2 + 0.08;
    house(b, ax, HOUSE_CY + 0.04, 0.16, 0.22, 14, side, roof, 49);
    gnd.push(shadowRect(ax + 0.02, HOUSE_CY + 0.06, 0.16, 0.22));
    const aw = proj(OX, GY, ax, HOUSE_CY + 0.16, 2);
    b.rect(rx(aw) - 1, ry(aw) - 7, 3, 3, PAL.amberDark);
  }
  // door and rows of windows on the +y face; some lit
  const fy = HOUSE_CY + wid / 2 + 0.01;
  const d = proj(OX, GY, -0.14, fy);
  b.rect(rx(d) - 1, ry(d) - 8, 3, 8, PAL.trunkDark);
  const cols = level === 1 ? [0.08] : level === 2 ? [0.0, 0.14] : [-0.26, 0.0, 0.14];
  for (let z = 0, row = 0; z + 10 <= h; z += 11, row++)
    for (const wx of cols) {
      if (row === 0 && wx < -0.2) continue;
      const w = proj(OX, GY, wx, fy, z);
      const lit = hash2(row, Math.round(wx * 100), 45 + level) > 0.45;
      b.rect(rx(w) - 1, ry(w) - 9, 3, 3, lit ? PAL.amber : PAL.amberDark);
    }
  fence(b, 0.2, 0.38, 0.42, 0.38, 3);
  b.outline(PAL.outline, 170);
  ground(b, gnd);
  return b;
}

/**
 * Townhouse under construction: 0 a stone footing with timber and stone delivered, 1 the timber
 * frame on the footing, 2 walls and roof up with a ladder still against the front.
 */
function townhouseStage(stage: number): PixelBuf {
  const b = new PixelBuf(W, H);
  const len = 0.5;
  const wid = 0.36;
  const cx = HOUSE_CX;
  const cy = HOUSE_CY;
  const gnd: GroundFn[] = [
    shadowRect(cx + 0.02, cy + 0.02, len, wid),
    patchRect(cx + 0.02, cy + 0.04, len + 0.16, wid + 0.16, loose(DUST, 63), 63, 150, 0.1),
  ];
  const fy = cy + wid / 2;
  if (stage === 0) {
    house(b, cx, cy, len, wid, 3, PAL.stone, null, 44);
    logStack(b, 0.26, 0.24, 0.18, 2, 91);
    heap(b, -0.3, 0.26, 0.08, 4, PAL.stone, 92);
  } else if (stage === 1) {
    house(b, cx, cy, len, wid, 3, PAL.stone, null, 44);
    const top = 21;
    for (const x of [cx - len / 2, cx, cx + len / 2])
      for (const y of [cy - wid / 2, fy]) post(b, x, y, top - 3, PALE_TIMBER[0], 3, 2);
    bar(b, cx - len / 2, cy - wid / 2, top, cx + len / 2, cy - wid / 2, top, PALE_TIMBER[2]);
    bar(b, cx - len / 2, cy - wid / 2, top, cx - len / 2, fy, top, PALE_TIMBER[2]);
    bar(b, cx - len / 2, fy, top, cx + len / 2, fy, top, PALE_TIMBER[1]);
    bar(b, cx + len / 2, cy - wid / 2, top, cx + len / 2, fy, top, PALE_TIMBER[1]);
    // diagonal brace on the front
    bar(b, cx - len / 2, fy, 3, cx, fy, top, PALE_TIMBER[2]);
    logStack(b, 0.26, 0.24, 0.18, 1, 91);
  } else {
    house(b, cx, cy, len, wid, 22, PALE_TIMBER, SHINGLE, 44);
    // ladder against the front wall
    const lx = 0.08;
    const ly = fy + 0.04;
    post(b, lx - 0.03, ly, 24, PAL.timber[2], 0, 1);
    post(b, lx + 0.03, ly, 24, PAL.timber[2], 0, 1);
    for (let z = 3; z < 24; z += 4) bar(b, lx - 0.03, ly, z, lx + 0.03, ly, z, PAL.timber[1]);
    heap(b, -0.3, 0.26, 0.06, 3, PAL.stone, 92);
  }
  b.outline(PAL.outline, 170);
  ground(b, gnd);
  return b;
}

export const DECOR_SPRITES: Record<string, () => PixelBuf> = {
  fuel_stop: fuelStop,
  townhouse: () => townhouse(1),
};
/** Townhouse variants beyond the decor frame: levels 2 and 3, and the three construction stages. */
export const HOUSE_SPRITES: Record<string, () => PixelBuf> = {
  townhouse_2: () => townhouse(2),
  townhouse_3: () => townhouse(3),
  townhouse_s0: () => townhouseStage(0),
  townhouse_s1: () => townhouseStage(1),
  townhouse_s2: () => townhouseStage(2),
};
export { powerLine };
