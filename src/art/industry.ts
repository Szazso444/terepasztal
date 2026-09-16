import { PAL, shade, type RGB } from './palette';
import { PixelBuf } from './pixels';
import { drawPrism, drawCylinder, proj, fillPoly, type P2 } from './iso3d';
import { hash2 } from '../engine/rng';
import { HALF_W, HALF_H, ART_SCALE } from '../engine/iso';

/**
 * Scale a base (ART_SCALE 1) pixel literal to the current art scale. Canvas sizes, sprite origins,
 * every hand-placed rect/line/set offset and radius pass through this. Tile-space args to
 * proj/drawPrism/drawCylinder (cx, cy, len, wid, r, angle) and their z heights are NOT scaled here:
 * proj and iso3d already carry the scale for those.
 */
const S = (n: number) => n * ART_SCALE;

/** Shared sprite frame for one-tile structures (same as `structures.ts`). */
export const W = S(96);
export const H = S(84);
export const OX = S(48);
export const OY = S(68);
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
  [166, 96, 66],
  [184, 112, 78],
  [138, 76, 54],
];
const BARN: RGB[] = [
  [150, 62, 50],
  [170, 76, 60],
  [122, 50, 42],
];
const CONCRETE: RGB[] = [
  [178, 172, 160],
  [194, 188, 176],
  [156, 150, 138],
];
const STEEL: RGB[] = [
  [138, 142, 148],
  [158, 162, 168],
  [112, 116, 122],
];
const SILVER: RGB[] = [
  [190, 194, 200],
  [212, 216, 222],
  [160, 164, 170],
];
const BLUE_STEEL: RGB[] = [
  [88, 116, 136],
  [106, 136, 156],
  [70, 94, 112],
];
const WHITEWASH: RGB[] = [
  [222, 212, 190],
  [236, 228, 208],
  [196, 186, 164],
];
const TANK_WHITE: RGB[] = [
  [214, 208, 196],
  [230, 224, 212],
  [188, 182, 170],
];
const PALE_TIMBER: RGB[] = [
  [178, 140, 92],
  [196, 158, 108],
  [152, 116, 74],
];
const COAL: RGB[] = [
  [40, 40, 42],
  [52, 52, 56],
  [30, 30, 32],
];
const GRAVEL: RGB[] = [
  [166, 160, 148],
  [180, 174, 162],
  [148, 142, 130],
];
const DUST: RGB[] = [
  [204, 180, 128],
  [220, 196, 142],
  [184, 160, 110],
];
const COBBLE: RGB[] = [
  [172, 158, 136],
  [188, 174, 152],
  [150, 136, 116],
];
const WHEATC: RGB[] = [
  [214, 178, 86],
  [232, 196, 104],
  [188, 152, 70],
];
const CROP: RGB[] = [
  [104, 140, 68],
  [120, 156, 78],
  [86, 118, 56],
];
const SHINGLE: RGB[] = [
  [124, 92, 58],
  [140, 106, 68],
  [104, 76, 48],
];
const FLAT_ROOF: RGB[] = [
  [118, 120, 122],
  [132, 134, 138],
  [100, 102, 106],
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

const SHADOW: RGB = [30, 40, 30];

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
  b.set(rx(t), ry(t) - S(1), PAL.iron[3]);
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
    b.rect(rx(w) - S(1), ry(w) - S(12), S(3), S(4), PAL.amberDark);
    b.set(rx(w), ry(w) - S(11), PAL.amber);
  }
  if (doorX !== null) {
    const d = proj(OX, GY, cx + doorX, cy + wid / 2, z);
    b.rect(rx(d) - S(1), ry(d) - S(9), S(3), S(8), PAL.trunkDark);
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
  b.rect(rx(p) - Math.floor(S(w) / 2), ry(p) - S(h), S(w), S(h), c);
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
  for (let t = 0; t < S(thick); t++) b.line(rx(p), ry(p) + t, rx(q), ry(q) + t, c);
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
  const hrx = r * HALF_W;
  const hry = r * HALF_H;
  for (let y = Math.floor(c.y - hry - S(h)); y <= Math.ceil(c.y + hry); y++)
    for (let x = Math.floor(c.x - hrx); x <= Math.ceil(c.x + hrx); x++) {
      const nx = (x + 0.5 - c.x) / hrx;
      const dy = Math.sqrt(Math.max(0, 1 - nx * nx)) * hry;
      const top = c.y - S(h) * (1 - Math.abs(nx)) - dy;
      if (y < top || y > c.y + dy) continue;
      const n = hash2(x >> 1, y >> 1, seed);
      const light = 0.75 + 0.35 * (1 - (nx + 1) / 2) + (y < top + S(2) ? 0.15 : 0);
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
      b.set(rx(e) - S(1), ry(e), PAL.sand[2]);
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
  const prx = r * HALF_W;
  for (let d = S(1); d <= S(4); d++) {
    const db = d / ART_SCALE;
    const w = Math.round(prx * Math.sqrt(Math.max(0, 1 - (db / 5) ** 2)));
    for (let x = -w; x <= w; x++) b.set(rx(t) + x, ry(t) - d, shade(cap, 0.9 + 0.05 * db));
  }
  const m = proj(OX, GY, cx, cy, z0 + h * 0.55);
  for (let x = -Math.round(prx); x <= Math.round(prx); x++) {
    const yy = ry(m) + Math.round(Math.sqrt(Math.max(0, 1 - (x / prx) ** 2)) * r * HALF_H);
    b.set(rx(m) + x, yy, PAL.iron[1]);
  }
}

/** Utility pole with a crossarm; used by the power line and the plant's switchyard. */
export function pole(b: PixelBuf, ox: number, oy: number, h = 26) {
  b.rect(ox - S(1), oy - S(h), S(2), S(h), PAL.timber[2]);
  b.rect(ox - S(6), oy - S(h) + S(3), S(12), S(1), PAL.timber[1]);
  b.rect(ox - S(6), oy - S(h) + S(4), S(12), S(1), PAL.timber[2]);
  for (const x of [-5, 0, 5]) {
    b.set(ox + S(x), oy - S(h) + S(2), PAL.cyanDark);
    b.set(ox + S(x), oy - S(h) + S(1), PAL.cyan);
  }
  b.set(ox - S(1), oy - S(h) - S(1), PAL.iron[1]);
  b.set(ox, oy - S(h) - S(1), PAL.iron[1]);
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
  b.line(x - S(3), y, x - S(1), y - S(h) + S(2), PAL.iron[2]);
  b.line(x + S(3), y, x + S(1), y - S(h) + S(2), PAL.iron[2]);
  for (let d = S(4); d < S(h) - S(2); d += S(5)) b.rect(x - S(2), y - d, S(5), S(1), PAL.iron[1]);
  const cy = y - S(h) - S(2);
  for (let a = 0; a < 28; a++) {
    const ang = (a / 28) * Math.PI * 2;
    b.set(x + Math.round(Math.cos(ang) * S(6)), cy + Math.round(Math.sin(ang) * S(6)), PAL.iron[3]);
  }
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2 + 0.2;
    b.line(
      x,
      cy,
      x + Math.round(Math.cos(ang) * S(5)),
      cy + Math.round(Math.sin(ang) * S(5)),
      PAL.iron[1],
    );
  }
  b.set(x, cy, PAL.brass);
  b.rect(x + S(7), cy, S(3), S(1), PAL.iron[1]);
  b.rect(x + S(10), cy - S(2), S(2), S(5), PAL.red);
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
      b.rect(rx(p) - S(5) + i * S(4) + r * S(2), ry(p) - S(2) - r * S(2), S(4), S(2), STEEL[(i + r) % 3]);
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
  b.line(rx(d0), ry(d0) - S(1), rx(d1), ry(d1) - S(bh - 4), PAL.timber[1]);
  b.line(rx(d0), ry(d0) - S(bh - 4), rx(d1), ry(d1) - S(1), PAL.timber[1]);
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
        rx(bl) + Math.round(Math.cos(ang) * S(3)),
        ry(bl) + Math.round(Math.sin(ang) * S(4)),
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
    b.ellipse(rx(p), ry(p) - S(2), S(3), S(2), PAL.rock, 54);
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
    b.rect(mx - S(1), my - S(32), S(3), S(32), PAL.timber[2]);
    b.line(mx - S(4), my, mx - S(1), my - S(28), PAL.timber[1]);
    b.line(mx + S(4), my, mx + S(1), my - S(28), PAL.timber[1]);
    b.line(mx, my - S(31), mx + S(15), my - S(15), PAL.timber[0]);
    b.line(mx, my - S(30), mx + S(15), my - S(14), PAL.timber[2]);
    b.line(mx + S(15), my - S(15), mx + S(15), my - S(4), PAL.iron[3]);
    b.rect(mx + S(13), my - S(5), S(5), S(4), PAL.rock[1]);
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
  b.rect(rx(v) - S(1), ry(v) - S(1), S(3), S(3), PAL.red);
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
    for (let d = 0; d <= S(sp); d++) {
      const db = d / ART_SCALE;
      const r = Math.round(S(6) * (1 - db / sp));
      for (let x = -r; x <= r; x++) b.set(rx(t) + x, ry(t) - d, PAL.roofSlate[(x + r + d) % 3]);
    }
    b.set(rx(t), ry(t) - S(sp) - S(1), PAL.brass);
    const f = proj(OX, GY, 0.09, -0.02, th - 8);
    b.rect(rx(f) - S(1), ry(f) - S(2), S(3), S(3), PAL.white);
    b.set(rx(f), ry(f) - S(1), PAL.outline);
    const w = proj(OX, GY, 0.0, 0.07, th - 8);
    b.rect(rx(w) - S(1), ry(w) - S(2), S(3), S(3), PAL.white);
    b.set(rx(w), ry(w) - S(1), PAL.outline);
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
    b.rect(rx(p), ry(p) - S(12), S(1), S(12), PAL.iron[2]);
    b.rect(rx(p) - S(1), ry(p) - S(14), S(3), S(2), PAL.amber);
    b.set(rx(p), ry(p) - S(15), PAL.iron[1]);
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
    b.rect(rx(l) - S(4), ry(l), S(9), S(1), PAL.amberDark);
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
      b.rect(rx(l) - S(4), ry(l), S(9), S(1), PAL.amberDark);
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
      b.rect(rx(l) - S(4), ry(l), S(9), S(1), PAL.amberDark);
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
    b.rect(rx(tr) - S(2), ry(tr) - S(3), S(5), S(3), PAL.iron[0]);
    b.rect(rx(tr), ry(tr), S(1), S(12), PAL.iron[3]);
    b.rect(rx(tr) - S(2), ry(tr) + S(12), S(5), S(4), PAL.cargoGoods);
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
  const prx = kr * HALF_W;
  const dome = 15;
  for (let d = S(1); d <= S(dome); d++) {
    const db = d / ART_SCALE;
    const w = Math.round(prx * Math.sqrt(Math.max(0, 1 - (db / (dome + 1)) ** 2)));
    for (let x = -w; x <= w; x++) {
      const n = hash2(x >> 1, d >> 1, 93);
      const light = 0.78 + 0.03 * db + 0.18 * (1 - (x / prx + 1) / 2);
      b.set(rx(t) + x, ry(t) - d, shade(pick(BRICK, n), light));
    }
  }
  // iron hoop and the smoke vent on top
  for (let x = -Math.round(prx * 0.95); x <= Math.round(prx * 0.95); x++)
    b.set(rx(t) + x, ry(t) - S(4) + Math.round(((x * x) / (prx * prx)) * S(3)), PAL.iron[1]);
  b.rect(rx(t) - S(2), ry(t) - S(dome) - S(2), S(5), S(3), PAL.iron[0]);
  b.set(rx(t) - S(3), ry(t) - S(dome) - S(4), PAL.stone[2]);
  b.set(rx(t) - S(5), ry(t) - S(dome) - S(6), PAL.stone[1]);
  // glowing mouth on the front
  const c = proj(OX, GY, kx, ky, 0);
  const mx = rx(c);
  const my = ry(c) + Math.round(kr * HALF_H) - S(1);
  b.rect(mx - S(3), my - S(7), S(7), S(7), PAL.outline);
  b.rect(mx - S(2), my - S(6), S(5), S(5), PAL.amberDark);
  b.rect(mx - S(1), my - S(5), S(3), S(3), PAL.amber);
  b.set(mx, my - S(4), PAL.white);
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
  const cx = rx(c) + S(2);
  const cy = ry(c);
  for (let a = 0; a < 24; a++) {
    const ang = (a / 24) * Math.PI * 2;
    b.set(cx + Math.round(Math.cos(ang) * S(5)), cy + Math.round(Math.sin(ang) * S(9)), PAL.iron[3]);
    if (a % 3 === 0)
      b.set(
        cx + Math.round(Math.cos(ang) * S(6)),
        cy + Math.round(Math.sin(ang) * S(11)),
        PAL.iron[1],
      );
  }
  for (let a = 0; a < 6; a++) {
    const ang = (a / 6) * Math.PI * 2;
    b.line(
      cx,
      cy,
      cx + Math.round(Math.cos(ang) * S(4)),
      cy + Math.round(Math.sin(ang) * S(7)),
      PAL.iron[1],
    );
  }
  b.rect(cx - S(1), cy - S(1), S(3), S(3), PAL.brass);
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
    for (let x = -S(3); x <= S(3); x++) {
      const xb = x / ART_SCALE;
      b.set(rx(r) + x, ry(r) + S(Math.round(Math.sqrt(9 - xb * xb) * 0.5)), PAL.iron[2]);
    }
  }
  const pl = proj(OX, GY, cx, cy, 30);
  b.rect(rx(pl) - S(5), ry(pl), S(11), S(1), PAL.iron[1]);
  b.rect(rx(pl) - S(5), ry(pl) - S(3), S(1), S(3), PAL.iron[3]);
  b.rect(rx(pl) + S(5), ry(pl) - S(3), S(1), S(3), PAL.iron[3]);
  silo(b, 0.14, -0.24, 0.14, 15, TANK_WHITE, TANK_WHITE[1], 114);
  silo(b, 0.3, 0.12, 0.12, 12, TANK_WHITE, TANK_WHITE[1], 115);
  // red band on the big tank
  const bd = proj(OX, GY, 0.14, -0.24, 11);
  for (let x = -S(4); x <= S(4); x++) {
    const xb = x / ART_SCALE;
    b.set(rx(bd) + x, ry(bd) + S(4 + Math.round(Math.abs(xb) / 3)), PAL.red);
  }
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
  b.rect(rx(f), ry(f) - S(30), S(1), S(30), PAL.iron[2]);
  b.rect(rx(f) - S(1), ry(f) - S(31), S(3), S(2), PAL.iron[0]);
  b.rect(rx(f) - S(1), ry(f) - S(34), S(3), S(3), PAL.amber);
  b.set(rx(f), ry(f) - S(35), PAL.red);
  b.set(rx(f), ry(f) - S(33), PAL.white);
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
    b.rect(rx(w) - S(1), ry(w) - S(16), S(3), S(8), PAL.amberDark);
    b.set(rx(w), ry(w) - S(17), PAL.amberDark);
    b.set(rx(w), ry(w) - S(14), PAL.amber);
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
  b.rect(rx(s) - S(2), ry(s), S(5), S(3), PAL.red);
  const cap = proj(OX, GY, sx, sy, 48);
  b.rect(rx(cap) - S(2), ry(cap) - S(1), S(5), S(2), PAL.iron[0]);
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
    b.set(rx(tp) + S(x), ry(tp) - S(2), PAL.cyan);
    b.set(rx(tp) + S(x), ry(tp) - S(1), PAL.cyanDark);
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
  const b = new PixelBuf(S(16), S(36));
  pole(b, S(8), S(35), 30);
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
    b.rect(rx(p) - S(1), ry(p) - S(20), S(2), S(20), PAL.timber[2]);
  }
  // cross bracing on the two visible sides
  const b0 = proj(OX, OY, -0.18, 0.14);
  const b1 = proj(OX, OY, 0.18, 0.14);
  const b2 = proj(OX, OY, 0.18, -0.14);
  b.line(rx(b0), ry(b0) - S(18), rx(b1), ry(b1) - S(4), PAL.timber[1]);
  b.line(rx(b0), ry(b0) - S(4), rx(b1), ry(b1) - S(18), PAL.timber[1]);
  b.line(rx(b1), ry(b1) - S(18), rx(b2), ry(b2) - S(4), PAL.timber[1]);
  b.line(rx(b1), ry(b1) - S(4), rx(b2), ry(b2) - S(18), PAL.timber[1]);
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
  for (let d = 0; d < S(4); d++) {
    const db = d / ART_SCALE;
    const half = S(10 - db * 2);
    for (let x = -half; x <= half; x++) b.set(rx(t) + x, ry(t) - d, COAL[(((x + d) % 3) + 3) % 3]);
  }
  // chute towards the track side
  const c0 = proj(OX, OY, 0.22, 0.1, 22);
  const c1 = proj(OX, OY, 0.4, 0.2, 12);
  b.line(rx(c0), ry(c0), rx(c1), ry(c1), PAL.iron[1]);
  b.line(rx(c0), ry(c0) + S(1), rx(c1), ry(c1) + S(1), PAL.iron[2]);
  // ladder on the front leg
  const ld = proj(OX, OY, -0.18, 0.14);
  for (let y = S(2); y < S(20); y += S(3)) b.rect(rx(ld) - S(3), ry(ld) - y, S(3), S(1), PAL.timber[1]);
  const h0 = proj(OX, OY, -0.28, 0.28);
  b.ellipse(rx(h0), ry(h0) - S(3), S(6), S(4), COAL, 132, 0.5);
  b.outline(PAL.outline, 170);
  // spilled coal around the heap, shadow under the trestle
  ground(b, [
    patchEllipse(-0.28, 0.28, 0.13, (x, y) => shade(pick(COAL, hash2(x, y, 133)), 1.1), 133, 200),
    shadowRect(0, 0, 0.4, 0.32, 55),
    shadowEllipse(-0.28, 0.28, 0.1),
  ]);
  return b;
}

// ------------------------------------------------------------------ full production chain

const RUST_ORE: RGB[] = [
  [150, 100, 70],
  [172, 120, 84],
  [118, 78, 56],
];
const COPPER: RGB[] = [PAL.copper[1], [212, 152, 104], PAL.copper[2]];
const OIL_POOL: RGB[] = [
  [34, 28, 30],
  [48, 40, 40],
  [22, 18, 20],
];

/** Colliery: brick winding house, timber headframe with a sheave wheel, coal and spoil heaps. */
function colliery(): PixelBuf {
  const b = new PixelBuf(W, H);
  const hx = -0.2;
  const hy = 0.16;
  const fx = 0.16;
  const fy = -0.16;
  const gnd: GroundFn[] = [
    patchEllipse(0.3, 0.26, 0.16, loose(COAL, 140), 140, 130, 0.08),
    patchEllipse(fx, fy, 0.2, loose(GRAVEL, 141), 141, 200, 0.08),
    shadowRect(hx, hy, 0.32, 0.24),
    shadowEllipse(0.3, 0.26, 0.12),
    shadowRect(fx, fy, 0.24, 0.24, 50),
  ];
  house(b, hx, hy, 0.32, 0.24, 12, BRICK, PAL.roofSlate, 142);
  facade(b, hx, hy, 0.24, [-0.08], 0.06);
  chimney(b, hx - 0.1, hy - 0.06, 12, 14, 0.04, [PAL.stone[2], PAL.stone[0], PAL.stone[1]]);
  // headframe: two leaning legs meeting a crossbeam, the sheave wheel above the shaft mouth
  const legH = 36;
  bar(b, fx - 0.14, fy + 0.12, 0, fx - 0.03, fy, legH, PAL.timber[2], 2);
  bar(b, fx + 0.14, fy + 0.12, 0, fx + 0.03, fy, legH, PAL.timber[2], 2);
  bar(b, fx - 0.12, fy - 0.12, 0, fx - 0.03, fy, legH, PAL.timber[1], 2);
  bar(b, fx + 0.12, fy - 0.12, 0, fx + 0.03, fy, legH, PAL.timber[1], 2);
  for (const z of [12, 24]) bar(b, fx - 0.1, fy + 0.06, z, fx + 0.1, fy + 0.06, z, PAL.timber[0]);
  const top = proj(OX, GY, fx, fy, legH);
  b.rect(rx(top) - S(6), ry(top), S(13), S(2), PAL.timber[0]);
  b.ellipse(rx(top), ry(top) - S(4), S(5), S(5), [PAL.iron[1], PAL.iron[0]], 143, 0.2);
  b.ellipse(rx(top), ry(top) - S(4), S(2.5), S(2.5), [PAL.iron[2]], 144, 0);
  // cable down to the cage, dark shaft mouth
  b.line(rx(top) + S(4), ry(top) - S(2), rx(top) + S(4), ry(top) + S(legH - 8), PAL.iron[2]);
  const m = proj(OX, GY, fx, fy);
  b.ellipse(rx(m), ry(m), S(5), S(2.5), [PAL.outline], 145, 0);
  heap(b, 0.3, 0.26, 0.12, 6, COAL, 146);
  logStack(b, -0.3, -0.26, 0.22, 2, 147);
  crates(b, [[0.04, 0.36]], 148);
  b.outline(PAL.outline, 170);
  ground(b, gnd);
  return b;
}

/** Ironworks: brick casting hall beside a tall blast furnace, ore and slag heaps, ingots. */
function ironworks(): PixelBuf {
  const b = new PixelBuf(W, H);
  const hx = -0.1;
  const hy = 0.16;
  const fx = 0.2;
  const fy = -0.18;
  const gnd: GroundFn[] = [
    patchEllipse(-0.3, -0.26, 0.15, loose(RUST_ORE, 150), 150, 140, 0.08),
    patchEllipse(0.34, 0.2, 0.12, loose(GRAVEL, 151), 151, 180, 0.08),
    shadowRect(hx, hy, 0.44, 0.26),
    shadowEllipse(fx, fy, 0.16),
    shadowEllipse(-0.3, -0.26, 0.12),
  ];
  house(b, hx, hy, 0.44, 0.26, 14, BRICK, PAL.roofSlate, 152);
  facade(b, hx, hy, 0.26, [-0.14, 0.06], -0.04);
  // the furnace: a wide brick stack with an iron band and a bright throat
  drawCylinder(b, OX, GY, fx, fy, 0.13, 0, 30, BRICK, BRICK[2], 153);
  const bd = proj(OX, GY, fx, fy, 16);
  for (let x = -S(4); x <= S(4); x++) {
    const xb = x / ART_SCALE;
    b.set(rx(bd) + x, ry(bd) + S(2 + Math.round(Math.abs(xb) / 3)), PAL.iron[1]);
  }
  chimney(b, fx, fy, 30, 14, 0.05);
  const t = proj(OX, GY, fx, fy, 44);
  b.set(rx(t), ry(t) - S(2), PAL.amber);
  b.set(rx(t) - S(1), ry(t) - S(3), PAL.red);
  // tapping hole glowing at the foot, a chute into the hall
  const th = proj(OX, GY, fx, fy + 0.13);
  b.rect(rx(th) - S(2), ry(th) - S(5), S(5), S(4), PAL.outline);
  b.rect(rx(th) - S(1), ry(th) - S(4), S(3), S(2), PAL.amber);
  bar(b, fx - 0.06, fy + 0.1, 8, hx + 0.16, hy - 0.1, 12, PAL.iron[2], 2);
  heap(b, -0.3, -0.26, 0.11, 5, RUST_ORE, 154);
  heap(b, 0.34, 0.2, 0.08, 4, GRAVEL, 155);
  ingots(b, -0.34, 0.3);
  ingots(b, -0.22, 0.36);
  b.outline(PAL.outline, 170);
  ground(b, gnd);
  return b;
}

/** Oil derrick: timber lattice tower over a seep, a small tank and a pump house. */
function oilDerrick(): PixelBuf {
  const b = new PixelBuf(W, H);
  const dx = 0.02;
  const dy = -0.08;
  const gnd: GroundFn[] = [
    patchEllipse(dx + 0.02, dy + 0.06, 0.16, loose(OIL_POOL, 160), 160, 200, 0.1),
    patchEllipse(-0.3, 0.26, 0.1, loose(OIL_POOL, 161), 161, 120, 0.1),
    shadowRect(dx, dy, 0.28, 0.28, 50),
    shadowRect(0.28, 0.24, 0.2, 0.16),
    shadowEllipse(-0.3, 0.24, 0.09),
  ];
  const h = 48;
  const s = 0.14;
  // four legs converging on the crown, three rings of bracing
  for (const [lx, ly] of [
    [-s, -s],
    [s, -s],
    [s, s],
    [-s, s],
  ])
    bar(b, dx + lx, dy + ly, 0, dx + lx * 0.25, dy + ly * 0.25, h, PAL.timber[2], 2);
  for (const z of [12, 26, 40]) {
    const k = 1 - (z / h) * 0.75;
    bar(b, dx - s * k, dy + s * k, z, dx + s * k, dy + s * k, z, PAL.timber[1]);
    bar(b, dx + s * k, dy + s * k, z, dx + s * k, dy - s * k, z, PAL.timber[1]);
    bar(b, dx - s * k, dy - s * k, z, dx - s * k, dy + s * k, z, PAL.timber[0]);
  }
  const top = proj(OX, GY, dx, dy, h);
  b.rect(rx(top) - S(3), ry(top) - S(1), S(7), S(2), PAL.timber[0]);
  b.rect(rx(top) - S(1), ry(top) - S(5), S(3), S(4), PAL.iron[1]);
  // walking beam and the rod down into the well
  bar(b, dx - 0.12, dy - 0.02, 20, dx + 0.1, dy - 0.02, 26, PAL.iron[2], 2);
  bar(b, dx + 0.1, dy - 0.02, 26, dx + 0.1, dy - 0.02, 2, PAL.iron[3]);
  silo(b, 0.3, 0.24, 0.1, 10, TANK_WHITE, TANK_WHITE[1], 162);
  bar(b, dx + 0.1, dy + 0.1, 4, 0.22, 0.2, 6, PAL.iron[3]);
  house(b, -0.26, -0.28, 0.2, 0.16, 8, PALE_TIMBER, PAL.roofSlate, 163);
  crates(b, [[-0.36, 0.1]], 164);
  b.outline(PAL.outline, 170);
  ground(b, gnd);
  return b;
}

/** Wire mill: long steel drawing shed with a saw-tooth roof, copper coils and an ore heap. */
function wireMill(): PixelBuf {
  const b = new PixelBuf(W, H);
  const hx = -0.06;
  const hy = -0.06;
  const gnd: GroundFn[] = [
    patchRect(0.24, 0.3, 0.3, 0.18, concrete(170), 170, 255, 0.05),
    patchEllipse(-0.32, 0.28, 0.12, loose(RUST_ORE, 171), 171, 140, 0.08),
    shadowRect(hx, hy, 0.56, 0.34, 80),
    shadowEllipse(-0.32, 0.28, 0.09),
  ];
  flatShed(b, hx, hy, 0.56, 0.34, 16, STEEL, 172);
  // saw-tooth skylights along the roof
  for (const tx of [-0.2, -0.04, 0.12]) {
    drawPrism(b, {
      ox: OX,
      oy: GY,
      cx: hx + tx,
      cy: hy,
      angle: 0,
      len: 0.1,
      wid: 0.3,
      h: 5,
      z0: 16,
      top: [PAL.cyanDark, PAL.cyan],
      side: STEEL,
      seed: 173,
    });
  }
  opening(b, hx + 0.1, hy + 0.17, hx + 0.22, hy + 0.17, 0, 11, PAL.outline);
  chimney(b, hx - 0.22, hy - 0.1, 16, 10, 0.04);
  // coils of drawn wire on the loading pad
  for (const [cx, cy] of [
    [0.18, 0.28],
    [0.3, 0.34],
    [0.3, 0.22],
  ]) {
    drawCylinder(b, OX, GY, cx, cy, 0.05, 0, 5, COPPER, COPPER[1], 174);
    const c = proj(OX, GY, cx, cy, 5);
    b.set(rx(c), ry(c), COPPER[2]);
  }
  heap(
    b,
    -0.32,
    0.28,
    0.09,
    5,
    COPPER.map((c) => shade(c, 0.6)),
    175,
  );
  b.outline(PAL.outline, 170);
  ground(b, gnd);
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
/** Fenced yard with a transformer block and a short pylon. */
function substation(): PixelBuf {
  const b = new PixelBuf(W, H);
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: 0,
    cy: 0,
    angle: 0,
    len: 0.7,
    wid: 0.7,
    h: 1,
    top: PAL.stone,
    side: PAL.stone,
    seed: 71,
  });
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: -0.1,
    cy: 0.05,
    angle: 0,
    len: 0.3,
    wid: 0.24,
    h: 12,
    z0: 1,
    top: PAL.iron,
    side: PAL.iron,
    seed: 72,
  });
  for (const f of [-0.08, 0, 0.08])
    drawCylinder(
      b,
      OX,
      OY,
      -0.1 + f,
      0.05,
      0.03,
      13,
      5,
      [PAL.white, [180, 180, 176]],
      PAL.white,
      73 + f * 10,
    );
  const p = proj(OX, OY, 0.2, -0.18);
  b.rect(Math.round(p.x) - S(1), Math.round(p.y) - S(30), S(2), S(30), PAL.iron[2]);
  b.rect(Math.round(p.x) - S(6), Math.round(p.y) - S(28), S(12), S(1), PAL.iron[1]);
  b.rect(Math.round(p.x) - S(4), Math.round(p.y) - S(22), S(8), S(1), PAL.iron[1]);
  for (const [lx, ly] of [
    [-0.34, -0.34],
    [0.34, -0.34],
    [0.34, 0.34],
    [-0.34, 0.34],
  ]) {
    const q = proj(OX, OY, lx, ly);
    b.rect(Math.round(q.x), Math.round(q.y) - S(6), S(1), S(6), PAL.timber[2]);
  }
  b.outline(PAL.outline, 170);
  return b;
}
/** Turbine house on a weir with a spillway. */
function hydroPlant(): PixelBuf {
  const b = new PixelBuf(W, H);
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: 0,
    cy: 0.1,
    angle: 0,
    len: 0.8,
    wid: 0.5,
    h: 4,
    top: PAL.stone,
    side: PAL.stone,
    seed: 81,
  });
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: -0.1,
    cy: 0.05,
    angle: 0,
    len: 0.42,
    wid: 0.34,
    h: 16,
    z0: 4,
    top: PAL.roofSlate,
    side: PAL.stone,
    seed: 82,
    ridge: 4,
    roof: PAL.roofSlate,
  });
  drawCylinder(b, OX, OY, 0.22, -0.1, 0.07, 4, 10, [PAL.iron[1], PAL.iron[2]], PAL.iron[0], 83);
  for (let i = 0; i < 6; i++) {
    const q = proj(OX, OY, 0.28, 0.18 + i * 0.04);
    b.rect(Math.round(q.x) - S(3), Math.round(q.y) - S(2), S(6), S(1), [160, 200, 220]);
  }
  b.outline(PAL.outline, 170);
  return b;
}
export const BUILDING_SPRITES: Record<string, () => PixelBuf> = {
  kiln,
  grinder,
  refinery,
  power_plant: powerPlant,
  substation,
  hydro_plant: hydroPlant,
  // full production chain
  colliery,
  ironworks,
  oil_derrick: oilDerrick,
  diesel_refinery: refinery,
  wire_mill: wireMill,
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
    b.rect(rx(aw) - S(1), ry(aw) - S(7), S(3), S(3), PAL.amberDark);
  }
  // door and rows of windows on the +y face; some lit
  const fy = HOUSE_CY + wid / 2 + 0.01;
  const d = proj(OX, GY, -0.14, fy);
  b.rect(rx(d) - S(1), ry(d) - S(8), S(3), S(8), PAL.trunkDark);
  const cols = level === 1 ? [0.08] : level === 2 ? [0.0, 0.14] : [-0.26, 0.0, 0.14];
  for (let z = 0, row = 0; z + 10 <= h; z += 11, row++)
    for (const wx of cols) {
      if (row === 0 && wx < -0.2) continue;
      const w = proj(OX, GY, wx, fy, z);
      const lit = hash2(row, Math.round(wx * 100), 45 + level) > 0.45;
      b.rect(rx(w) - S(1), ry(w) - S(9), S(3), S(3), lit ? PAL.amber : PAL.amberDark);
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
