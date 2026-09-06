import { PAL, shade, type RGB } from './palette';
import { PixelBuf } from './pixels';
import { drawPrism, drawCylinder, proj, fillPoly } from './iso3d';
import { hash2 } from '../engine/rng';

/** Shared sprite frame for one-tile structures (same as `structures.ts`). */
export const W = 96;
export const H = 84;
export const OX = 48;
export const OY = 68;
/** Ground origin: structures stand on a 3px slab. */
const GY = OY - 3;

const BRICK: RGB[] = [
  [118, 70, 52],
  [132, 80, 60],
  [98, 58, 44],
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
const WHITEWASH: RGB[] = [
  [178, 168, 148],
  [196, 186, 166],
  [150, 140, 122],
];
const COAL: RGB[] = [
  [40, 40, 42],
  [52, 52, 56],
  [30, 30, 32],
];
const GRAVEL: RGB[] = [
  [128, 124, 116],
  [142, 138, 130],
  [110, 106, 98],
];
const WHEATC: RGB[] = [
  [186, 156, 78],
  [204, 172, 90],
  [160, 132, 62],
];
const CROP: RGB[] = [
  [86, 116, 58],
  [98, 132, 66],
  [70, 96, 48],
];

/** A flat rectangle of ground cover, e.g. a yard slab or a field. */
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

/** Yard: packed earth with pebbles, the ground every industry stands on. */
export function yard(b: PixelBuf, seed: number, lenX = 0.94, lenY = 0.94) {
  pad(b, 0, 0, lenX, lenY, (x, y) => shade(PAL.sand[2], 0.7 + 0.1 * hash2(x, y, seed)));
  pad(
    b,
    0,
    0,
    lenX,
    lenY,
    (x, y) => {
      const n = hash2(x >> 1, y >> 1, seed + 1);
      return n > 0.92 ? PAL.stone[1] : PAL.sand[Math.min(2, Math.floor(n * 3))];
    },
    3,
  );
}

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

export function chimney(b: PixelBuf, cx: number, cy: number, z0: number, h: number, r = 0.05) {
  drawCylinder(
    b,
    OX,
    GY,
    cx,
    cy,
    r,
    z0,
    h,
    [PAL.iron[2], PAL.iron[0], PAL.iron[1]],
    PAL.iron[0],
    7,
  );
  const t = proj(OX, GY, cx, cy, z0 + h);
  b.set(Math.round(t.x), Math.round(t.y) - 1, PAL.iron[3]);
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
    b.rect(Math.round(w.x) - 1, Math.round(w.y) - 12, 3, 4, PAL.amberDark);
    b.set(Math.round(w.x), Math.round(w.y) - 11, PAL.amber);
  }
  if (doorX !== null) {
    const d = proj(OX, GY, cx + doorX, cy + wid / 2, z);
    b.rect(Math.round(d.x) - 1, Math.round(d.y) - 9, 3, 8, PAL.trunkDark);
  }
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
  const rx = r * 32;
  const ry = r * 16;
  for (let y = Math.floor(c.y - ry - h); y <= Math.ceil(c.y + ry); y++)
    for (let x = Math.floor(c.x - rx); x <= Math.ceil(c.x + rx); x++) {
      const nx = (x + 0.5 - c.x) / rx;
      const dy = Math.sqrt(Math.max(0, 1 - nx * nx)) * ry;
      const top = c.y - h * (1 - Math.abs(nx)) - dy;
      if (y < top || y > c.y + dy) continue;
      const n = hash2(x >> 1, y >> 1, seed);
      const light = 0.75 + 0.35 * (1 - (nx + 1) / 2) + (y < top + 2 ? 0.15 : 0);
      b.set(x, y, shade(shades[Math.min(shades.length - 1, Math.floor(n * shades.length))], light));
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
      b.set(Math.round(e.x), Math.round(e.y), PAL.sand[1]);
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

/** Round storage tank / silo with a domed cap. */
export function silo(
  b: PixelBuf,
  cx: number,
  cy: number,
  r: number,
  h: number,
  side: RGB[],
  cap: RGB,
  seed: number,
) {
  drawCylinder(b, OX, GY, cx, cy, r, 0, h, side, cap, seed);
  const t = proj(OX, GY, cx, cy, h);
  const rx = r * 32;
  for (let d = 1; d <= 4; d++) {
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (d / 5) ** 2)));
    for (let x = -w; x <= w; x++)
      b.set(Math.round(t.x) + x, Math.round(t.y) - d, shade(cap, 0.9 + 0.05 * d));
  }
  // band
  const m = proj(OX, GY, cx, cy, h * 0.55);
  for (let x = -Math.round(rx); x <= Math.round(rx); x++) {
    const yy = Math.round(m.y) + Math.round(Math.sqrt(Math.max(0, 1 - (x / rx) ** 2)) * r * 16);
    b.set(Math.round(m.x) + x, yy, PAL.iron[1]);
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

/** Field with crop rows, greener at low levels, golden when mature. */
function field(
  b: PixelBuf,
  cx: number,
  cy: number,
  lenX: number,
  lenY: number,
  ripe: number,
  seed: number,
) {
  pad(b, cx, cy, lenX, lenY, (x, y) => shade(PAL.sand[2], 0.75 + 0.1 * hash2(x, y, seed)), 3);
  pad(
    b,
    cx,
    cy,
    lenX,
    lenY,
    (x, y): RGB | null => {
      const row = (x + 2 * y) % 6;
      if (row > 2) return null;
      const n = hash2(x, y, seed);
      const c = n < ripe ? WHEATC : CROP;
      return c[Math.min(2, Math.floor(hash2(x >> 1, y, seed + 3) * 3))];
    },
    4,
  );
}

// ------------------------------------------------------------------ station families

function farm(level: number): PixelBuf {
  const b = new PixelBuf(W, H);
  yard(b, 31, 0.96, 0.96);
  field(b, 0.22, 0.2, 0.42, 0.46, 0.35 + 0.3 * level, 32 + level);
  if (level === 1) {
    house(b, -0.2, -0.16, 0.42, 0.34, 12, PAL.timber, PAL.roof, 33);
    facade(b, -0.2, -0.16, 0.34, [-0.12], 0.08);
    crates(b, [[0.1, -0.3]], 34);
  } else if (level === 2) {
    house(
      b,
      -0.18,
      -0.12,
      0.5,
      0.36,
      15,
      PAL.roof.map((c) => shade(c, 1.2)),
      PAL.roofSlate,
      35,
    );
    facade(b, -0.18, -0.12, 0.36, [-0.16, 0.12], -0.02);
    silo(b, 0.24, -0.3, 0.09, 26, STEEL, STEEL[1], 36);
    crates(b, [[-0.36, 0.28]], 37);
  } else {
    house(
      b,
      -0.2,
      -0.1,
      0.52,
      0.4,
      18,
      PAL.roof.map((c) => shade(c, 1.2)),
      PAL.roofSlate,
      38,
    );
    facade(b, -0.2, -0.1, 0.4, [-0.18, -0.02, 0.14], null);
    silo(b, 0.2, -0.3, 0.09, 30, STEEL, STEEL[1], 39);
    silo(b, 0.36, -0.2, 0.09, 30, STEEL, STEEL[1], 40);
    // windmill mast
    const m = proj(OX, GY, -0.4, 0.34);
    b.rect(Math.round(m.x) - 1, Math.round(m.y) - 30, 2, 30, PAL.iron[2]);
    for (let i = -7; i <= 7; i++) {
      b.set(Math.round(m.x) + i, Math.round(m.y) - 30, PAL.iron[3]);
      b.set(Math.round(m.x), Math.round(m.y) - 30 + i, PAL.iron[3]);
    }
  }
  b.outline(PAL.outline, 170);
  return b;
}

function lumber(level: number): PixelBuf {
  const b = new PixelBuf(W, H);
  yard(b, 41, 0.96, 0.96);
  heap(b, 0.3, 0.3, 0.14, 4, PAL.sand, 42); // sawdust
  if (level === 1) {
    logStack(b, 0.12, 0.22, 0.4, 2, 43);
    house(b, -0.22, -0.18, 0.4, 0.34, 11, PAL.timber, PAL.roof, 44);
    facade(b, -0.22, -0.18, 0.34, [], 0.06);
  } else if (level === 2) {
    logStack(b, 0.16, 0.24, 0.44, 3, 45);
    house(b, -0.2, -0.14, 0.52, 0.4, 14, PAL.timber, PAL.roofSlate, 46);
    facade(b, -0.2, -0.14, 0.4, [-0.18, 0.14], null);
    // open sawing bay: dark door
    const d = proj(OX, GY, 0.06, 0.06);
    b.rect(Math.round(d.x) - 5, Math.round(d.y) - 10, 10, 9, PAL.outline);
    chimney(b, -0.36, -0.28, 14, 12, 0.04);
  } else {
    logStack(b, 0.18, 0.26, 0.46, 4, 47);
    logStack(b, -0.3, 0.36, 0.3, 2, 48);
    house(b, -0.16, -0.16, 0.6, 0.42, 18, BRICK, PAL.roofSlate, 49);
    facade(b, -0.16, -0.16, 0.42, [-0.22, -0.06, 0.1], null);
    const d = proj(OX, GY, 0.14, 0.05);
    b.rect(Math.round(d.x) - 5, Math.round(d.y) - 12, 10, 11, PAL.outline);
    chimney(b, -0.38, -0.3, 18, 20, 0.05);
  }
  b.outline(PAL.outline, 170);
  return b;
}

function quarry(level: number): PixelBuf {
  const b = new PixelBuf(W, H);
  yard(b, 51, 0.96, 0.96);
  // rock face along the back
  for (let i = 0; i < 5; i++) {
    const t = -0.42 + i * 0.2;
    drawPrism(b, {
      ox: OX,
      oy: GY,
      cx: t,
      cy: -0.4,
      angle: 0,
      len: 0.2,
      wid: 0.14,
      h: 6 + Math.floor(hash2(i, level, 52) * 8),
      top: PAL.rock,
      side: PAL.rock,
      seed: 53 + i,
    });
  }
  heap(b, 0.22, 0.2, 0.2 + 0.03 * level, 8 + 2 * level, GRAVEL, 54);
  if (level === 1) {
    house(b, -0.24, 0.1, 0.3, 0.26, 10, PAL.timber, PAL.roof, 55);
    crates(b, [[-0.02, 0.36]], 56);
  } else if (level === 2) {
    house(b, -0.24, 0.12, 0.34, 0.3, 12, PAL.timber, PAL.roofSlate, 57);
    facade(b, -0.24, 0.12, 0.3, [-0.1], 0.08);
    // derrick crane
    const m = proj(OX, GY, 0.02, -0.06);
    b.rect(Math.round(m.x) - 1, Math.round(m.y) - 32, 2, 32, PAL.iron[2]);
    b.line(
      Math.round(m.x),
      Math.round(m.y) - 32,
      Math.round(m.x) + 16,
      Math.round(m.y) - 14,
      PAL.iron[1],
    );
    b.line(
      Math.round(m.x) + 16,
      Math.round(m.y) - 14,
      Math.round(m.x) + 16,
      Math.round(m.y) - 4,
      PAL.iron[3],
    );
  } else {
    // stone crusher tower with a hopper on top
    house(b, -0.22, 0.06, 0.34, 0.32, 24, STEEL, null, 58);
    drawPrism(b, {
      ox: OX,
      oy: GY,
      cx: -0.22,
      cy: 0.06,
      angle: 0,
      len: 0.26,
      wid: 0.26,
      h: 8,
      z0: 24,
      top: [PAL.iron[2], PAL.iron[0]],
      side: PAL.iron,
      seed: 59,
    });
    // conveyor from tower to heap
    const c0 = proj(OX, GY, -0.06, 0.1, 18);
    const c1 = proj(OX, GY, 0.2, 0.2, 14);
    b.line(Math.round(c0.x), Math.round(c0.y), Math.round(c1.x), Math.round(c1.y), PAL.iron[1]);
    b.line(
      Math.round(c0.x),
      Math.round(c0.y) + 1,
      Math.round(c1.x),
      Math.round(c1.y) + 1,
      PAL.iron[2],
    );
    heap(b, -0.3, 0.36, 0.14, 6, GRAVEL, 60);
  }
  b.outline(PAL.outline, 170);
  return b;
}

function pump(level: number): PixelBuf {
  const b = new PixelBuf(W, H);
  yard(b, 61, 0.96, 0.96);
  // pond corner
  pad(
    b,
    0.26,
    0.26,
    0.4,
    0.38,
    (x, y) => PAL.water[Math.min(3, Math.floor(hash2(x >> 2, y >> 1, 62) * 4))],
    3,
  );
  if (level === 1) {
    house(b, -0.2, -0.16, 0.34, 0.3, 11, BRICK, PAL.roofSlate, 63);
    facade(b, -0.2, -0.16, 0.3, [-0.08], 0.08);
    chimney(b, -0.34, -0.26, 11, 8, 0.035);
  } else if (level === 2) {
    house(b, -0.2, -0.14, 0.4, 0.32, 13, BRICK, PAL.roofSlate, 64);
    facade(b, -0.2, -0.14, 0.32, [-0.14, 0.06], null);
    chimney(b, -0.36, -0.26, 13, 10, 0.04);
    silo(b, 0.24, -0.26, 0.11, 18, STEEL, STEEL[1], 65);
  } else {
    house(b, -0.22, -0.12, 0.44, 0.36, 16, BRICK, PAL.roofSlate, 66);
    facade(b, -0.22, -0.12, 0.36, [-0.16, 0, 0.14], null);
    chimney(b, -0.4, -0.28, 16, 14, 0.045);
    // elevated tank on a steel trestle
    for (const [lx, ly] of [
      [0.14, -0.36],
      [0.34, -0.36],
      [0.34, -0.16],
      [0.14, -0.16],
    ]) {
      const p = proj(OX, GY, lx, ly);
      b.rect(Math.round(p.x) - 1, Math.round(p.y) - 22, 2, 22, PAL.iron[2]);
    }
    silo(b, 0.24, -0.26, 0.13, 14, STEEL, STEEL[1], 67);
    drawCylinder(b, OX, GY, 0.24, -0.26, 0.13, 20, 14, STEEL, STEEL[1], 68);
  }
  // pipe from the house to the pond
  const p0 = proj(OX, GY, -0.02, 0.0, 4);
  const p1 = proj(OX, GY, 0.14, 0.12, 4);
  b.line(Math.round(p0.x), Math.round(p0.y), Math.round(p1.x), Math.round(p1.y), PAL.iron[3]);
  b.outline(PAL.outline, 170);
  return b;
}

function town(level: number): PixelBuf {
  const b = new PixelBuf(W, H);
  // cobbled square
  pad(b, 0, 0, 0.96, 0.96, (x, y) => shade(PAL.stone[2], 0.75 + 0.1 * hash2(x, y, 71)));
  pad(
    b,
    0,
    0,
    0.96,
    0.96,
    (x, y) => {
      const n = hash2(x >> 1, y >> 1, 72);
      const c = PAL.stone[Math.min(2, Math.floor(n * 3))];
      return (x + 2 * y) % 6 === 0 ? shade(c, 0.85) : c;
    },
    3,
  );
  const homes: [number, number, number, number, RGB[], RGB[]][] =
    level === 1
      ? [
          [-0.22, -0.2, 0.3, 0.26, WHITEWASH, PAL.roof],
          [0.2, 0.18, 0.26, 0.24, PAL.timber, PAL.roof],
        ]
      : level === 2
        ? [
            [-0.26, -0.22, 0.28, 0.26, WHITEWASH, PAL.roof],
            [0.1, -0.28, 0.26, 0.22, BRICK, PAL.roofSlate],
            [-0.28, 0.16, 0.24, 0.24, PAL.timber, PAL.roof],
            [0.24, 0.2, 0.28, 0.26, WHITEWASH, PAL.roofSlate],
          ]
        : [
            [-0.3, -0.24, 0.26, 0.26, BRICK, PAL.roofSlate],
            [0.0, -0.3, 0.26, 0.22, WHITEWASH, PAL.roof],
            [0.3, -0.24, 0.24, 0.26, BRICK, PAL.roofSlate],
            [-0.3, 0.18, 0.26, 0.26, WHITEWASH, PAL.roofSlate],
            [0.3, 0.2, 0.26, 0.26, PAL.timber, PAL.roof],
          ];
  homes.forEach(([cx, cy, len, wid, side, roof], i) => {
    house(b, cx, cy, len, wid, 10 + level * 2 + (i % 2) * 2, side, roof, 73 + i);
    facade(b, cx, cy, wid, [-len * 0.25], len * 0.2);
  });
  if (level >= 2) {
    // church / hall tower in the middle
    house(b, 0.0, 0.02, 0.18, 0.18, 14 + level * 6, PAL.stone, null, 79);
    const t = proj(OX, GY, 0, 0.02, 14 + level * 6);
    for (let r = 5; r >= 0; r--)
      for (let x = -r; x <= r; x++)
        b.set(Math.round(t.x) + x, Math.round(t.y) - (5 - r), PAL.roofSlate[(x + r) % 3]);
    b.rect(Math.round(t.x) - 1, Math.round(t.y) - 4, 3, 3, PAL.white);
  }
  // lamp posts
  for (const [lx, ly] of level === 3
    ? [
        [0.42, 0.0],
        [-0.42, 0.0],
      ]
    : [[0.4, -0.1]]) {
    const p = proj(OX, GY, lx, ly);
    b.rect(Math.round(p.x), Math.round(p.y) - 12, 1, 12, PAL.iron[2]);
    b.set(Math.round(p.x), Math.round(p.y) - 13, PAL.amber);
  }
  b.outline(PAL.outline, 170);
  return b;
}

function warehouse(level: number): PixelBuf {
  const b = new PixelBuf(W, H);
  // paved loading yard
  pad(b, 0, 0, 0.96, 0.96, (x, y) => shade(PAL.stone[2], 0.8 + 0.1 * hash2(x, y, 81)));
  pad(
    b,
    0,
    0,
    0.96,
    0.96,
    (x, y) => CONCRETE[Math.min(2, Math.floor(hash2(x >> 2, y >> 1, 82) * 3))],
    3,
  );
  if (level === 1) {
    house(b, -0.16, -0.14, 0.5, 0.36, 13, PAL.timber, PAL.roofSlate, 83);
    const d = proj(OX, GY, -0.1, 0.04);
    b.rect(Math.round(d.x) - 5, Math.round(d.y) - 9, 10, 8, PAL.outline);
    crates(
      b,
      [
        [0.3, 0.2],
        [0.18, 0.34],
      ],
      84,
    );
  } else if (level === 2) {
    house(b, -0.12, -0.14, 0.64, 0.4, 17, BRICK, PAL.roofSlate, 85);
    for (const dx of [-0.26, 0.02]) {
      const d = proj(OX, GY, dx, 0.06);
      b.rect(Math.round(d.x) - 5, Math.round(d.y) - 11, 10, 10, PAL.outline);
    }
    facade(b, -0.12, -0.14, 0.4, [0.24], null);
    crates(
      b,
      [
        [0.34, 0.16],
        [0.22, 0.32],
        [0.38, 0.34],
      ],
      86,
    );
  } else {
    house(b, -0.2, -0.22, 0.56, 0.3, 18, BRICK, PAL.roofSlate, 87);
    house(b, -0.2, 0.14, 0.56, 0.3, 18, BRICK, PAL.roofSlate, 88);
    for (const dx of [-0.34, -0.06]) {
      const d = proj(OX, GY, dx, 0.29);
      b.rect(Math.round(d.x) - 5, Math.round(d.y) - 11, 10, 10, PAL.outline);
    }
    // gantry crane over the yard edge
    for (const ly of [-0.36, 0.36]) {
      const p = proj(OX, GY, 0.32, ly);
      b.rect(Math.round(p.x) - 1, Math.round(p.y) - 30, 2, 30, PAL.iron[2]);
    }
    const g0 = proj(OX, GY, 0.32, -0.36, 30);
    const g1 = proj(OX, GY, 0.32, 0.36, 30);
    b.line(Math.round(g0.x), Math.round(g0.y), Math.round(g1.x), Math.round(g1.y), PAL.iron[3]);
    b.line(
      Math.round(g0.x),
      Math.round(g0.y) + 1,
      Math.round(g1.x),
      Math.round(g1.y) + 1,
      PAL.iron[1],
    );
    crates(
      b,
      [
        [0.3, 0.08],
        [0.36, -0.12],
        [0.2, 0.3],
      ],
      89,
    );
  }
  b.outline(PAL.outline, 170);
  return b;
}

// ------------------------------------------------------------------ processing buildings

/** Beehive brick kiln with a wood pile and a glowing mouth. */
function kiln(): PixelBuf {
  const b = new PixelBuf(W, H);
  yard(b, 91, 0.94, 0.94);
  drawCylinder(b, OX, GY, -0.1, -0.06, 0.24, 0, 14, BRICK, BRICK[2], 92);
  const t = proj(OX, GY, -0.1, -0.06, 14);
  const rx = 0.24 * 32;
  for (let d = 1; d <= 10; d++) {
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (d / 11) ** 2)));
    for (let x = -w; x <= w; x++) {
      const n = hash2(x >> 1, d, 93);
      b.set(
        Math.round(t.x) + x,
        Math.round(t.y) - d,
        shade(BRICK[Math.floor(n * 3)], 0.8 + 0.03 * d),
      );
    }
  }
  // smoke vent
  b.rect(Math.round(t.x) - 2, Math.round(t.y) - 12, 4, 2, PAL.outline);
  // glowing mouth on the front
  const m = proj(OX, GY, 0.02, 0.16);
  b.rect(Math.round(m.x) - 3, Math.round(m.y) - 6, 6, 5, PAL.outline);
  b.rect(Math.round(m.x) - 2, Math.round(m.y) - 5, 4, 3, PAL.amberDark);
  b.set(Math.round(m.x), Math.round(m.y) - 4, PAL.amber);
  logStack(b, 0.26, 0.2, 0.3, 2, 94);
  heap(b, -0.32, 0.32, 0.12, 5, COAL, 95);
  b.outline(PAL.outline, 170);
  return b;
}

/** Stone grinder: mill house with a big cog wheel, stone in, gravel and ingots out. */
function grinder(): PixelBuf {
  const b = new PixelBuf(W, H);
  yard(b, 101, 0.94, 0.94);
  house(b, -0.14, -0.12, 0.46, 0.38, 20, PAL.stone, PAL.roofSlate, 102);
  facade(b, -0.14, -0.12, 0.38, [-0.24, 0.02], null);
  chimney(b, -0.32, -0.28, 20, 12, 0.045);
  // cog wheel on the +x face
  const c = proj(OX, GY, 0.1, -0.12, 11);
  const cx = Math.round(c.x) + 3;
  const cy = Math.round(c.y);
  for (let a = 0; a < 12; a++) {
    const x = Math.round(Math.cos((a / 12) * Math.PI * 2) * 4);
    const y = Math.round(Math.sin((a / 12) * Math.PI * 2) * 7);
    b.set(cx + x, cy + y, PAL.iron[3]);
  }
  for (let a = 0; a < 8; a++) {
    const x = Math.round(Math.cos((a / 8) * Math.PI * 2) * 2.5);
    const y = Math.round(Math.sin((a / 8) * Math.PI * 2) * 4.5);
    b.set(cx + x, cy + y, PAL.iron[1]);
  }
  b.set(cx, cy, PAL.brass);
  // hopper mouth
  drawPrism(b, {
    ox: OX,
    oy: GY,
    cx: 0.14,
    cy: -0.1,
    angle: 0,
    len: 0.14,
    wid: 0.14,
    h: 6,
    z0: 20,
    top: [PAL.iron[2], PAL.iron[0]],
    side: PAL.iron,
    seed: 103,
  });
  heap(b, 0.28, 0.22, 0.16, 7, PAL.rock, 104);
  heap(b, -0.3, 0.32, 0.12, 4, GRAVEL, 105);
  // ingot stack
  for (let i = 0; i < 3; i++) {
    const p = proj(OX, GY, 0.02 + i * 0.05, 0.34, 0);
    b.rect(Math.round(p.x) - 2, Math.round(p.y) - 3 - (i % 2), 5, 3, STEEL[i % 3]);
  }
  b.outline(PAL.outline, 170);
  return b;
}

/** Refinery: distillation column, two storage tanks, a flare stack and pipework. */
function refinery(): PixelBuf {
  const b = new PixelBuf(W, H);
  pad(b, 0, 0, 0.94, 0.94, (x, y) => shade(PAL.stone[2], 0.8 + 0.1 * hash2(x, y, 111)));
  pad(
    b,
    0,
    0,
    0.94,
    0.94,
    (x, y) => CONCRETE[Math.min(2, Math.floor(hash2(x >> 2, y >> 1, 112) * 3))],
    3,
  );
  drawCylinder(b, OX, GY, -0.26, -0.22, 0.08, 0, 38, STEEL, STEEL[1], 113);
  // column rings
  for (const z of [10, 20, 30]) {
    const r = proj(OX, GY, -0.26, -0.22, z);
    for (let x = -3; x <= 3; x++)
      b.set(
        Math.round(r.x) + x,
        Math.round(r.y) + Math.round(Math.sqrt(9 - x * x) * 0.5),
        PAL.iron[2],
      );
  }
  silo(b, 0.14, -0.22, 0.14, 14, [WHITEWASH[2], WHITEWASH[0], WHITEWASH[1]], WHITEWASH[1], 114);
  silo(b, 0.3, 0.1, 0.12, 12, [WHITEWASH[2], WHITEWASH[0], WHITEWASH[1]], WHITEWASH[1], 115);
  // pipes
  const p0 = proj(OX, GY, -0.18, -0.16, 22);
  const p1 = proj(OX, GY, 0.08, -0.16, 14);
  b.line(Math.round(p0.x), Math.round(p0.y), Math.round(p1.x), Math.round(p1.y), PAL.iron[3]);
  const p2 = proj(OX, GY, 0.14, -0.06, 4);
  const p3 = proj(OX, GY, 0.3, 0.0, 4);
  b.line(Math.round(p2.x), Math.round(p2.y), Math.round(p3.x), Math.round(p3.y), PAL.iron[3]);
  // small control house
  house(b, -0.22, 0.24, 0.3, 0.24, 9, BRICK, PAL.roofSlate, 116);
  facade(b, -0.22, 0.24, 0.24, [-0.08], 0.06);
  // flare stack
  const f = proj(OX, GY, 0.0, 0.36);
  b.rect(Math.round(f.x), Math.round(f.y) - 28, 1, 28, PAL.iron[2]);
  b.rect(Math.round(f.x) - 1, Math.round(f.y) - 31, 3, 3, PAL.amber);
  b.set(Math.round(f.x), Math.round(f.y) - 32, PAL.red);
  crates(b, [[0.34, 0.34]], 117);
  b.outline(PAL.outline, 170);
  return b;
}

/** Power plant: turbine hall, tall stack, cooling tank and a switchyard pole. */
function powerPlant(): PixelBuf {
  const b = new PixelBuf(W, H);
  pad(b, 0, 0, 0.96, 0.96, (x, y) => shade(PAL.stone[2], 0.8 + 0.1 * hash2(x, y, 121)));
  pad(
    b,
    0,
    0,
    0.96,
    0.96,
    (x, y) => CONCRETE[Math.min(2, Math.floor(hash2(x >> 2, y >> 1, 122) * 3))],
    3,
  );
  house(b, -0.1, -0.12, 0.6, 0.4, 22, BRICK, PAL.roofSlate, 123);
  facade(b, -0.1, -0.12, 0.4, [-0.3, -0.16, -0.02, 0.12], null);
  // clerestory strip on the roof
  drawPrism(b, {
    ox: OX,
    oy: GY,
    cx: -0.1,
    cy: -0.12,
    angle: 0,
    len: 0.4,
    wid: 0.1,
    h: 4,
    z0: 28,
    top: PAL.roofSlate,
    side: [PAL.amberDark, PAL.amber],
    seed: 124,
  });
  chimney(b, -0.36, -0.3, 22, 30, 0.06);
  const s = proj(OX, GY, -0.36, -0.3, 52);
  b.rect(Math.round(s.x) - 2, Math.round(s.y), 5, 1, PAL.red);
  // cooling tank
  silo(b, 0.3, 0.14, 0.14, 12, STEEL, STEEL[1], 125);
  // transformer box and pole
  drawPrism(b, {
    ox: OX,
    oy: GY,
    cx: -0.3,
    cy: 0.3,
    angle: 0,
    len: 0.14,
    wid: 0.12,
    h: 8,
    top: PAL.iron,
    side: [PAL.iron[2], PAL.iron[0]],
    seed: 126,
  });
  const tp = proj(OX, GY, -0.3, 0.3, 8);
  for (const x of [-2, 0, 2]) b.set(Math.round(tp.x) + x, Math.round(tp.y) - 2, PAL.cyan);
  const pl = proj(OX, GY, 0.06, 0.36);
  pole(b, Math.round(pl.x), Math.round(pl.y), 24);
  heap(b, 0.34, -0.3, 0.12, 5, COAL, 127);
  b.outline(PAL.outline, 170);
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
  for (const [lx, ly] of [
    [-0.18, -0.14],
    [0.18, -0.14],
    [0.18, 0.14],
    [-0.18, 0.14],
  ]) {
    const p = proj(OX, OY, lx, ly);
    b.rect(Math.round(p.x) - 1, Math.round(p.y) - 20, 2, 20, PAL.timber[2]);
  }
  // cross bracing
  const b0 = proj(OX, OY, -0.18, 0.14);
  const b1 = proj(OX, OY, 0.18, 0.14);
  b.line(
    Math.round(b0.x),
    Math.round(b0.y) - 18,
    Math.round(b1.x),
    Math.round(b1.y) - 4,
    PAL.timber[1],
  );
  b.line(
    Math.round(b0.x),
    Math.round(b0.y) - 4,
    Math.round(b1.x),
    Math.round(b1.y) - 18,
    PAL.timber[1],
  );
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
      b.set(Math.round(t.x) + x, Math.round(t.y) - d, COAL[(((x + d) % 3) + 3) % 3]);
  // chute towards the track side
  const c0 = proj(OX, OY, 0.22, 0.1, 22);
  const c1 = proj(OX, OY, 0.4, 0.2, 12);
  b.line(Math.round(c0.x), Math.round(c0.y), Math.round(c1.x), Math.round(c1.y), PAL.iron[1]);
  b.line(
    Math.round(c0.x),
    Math.round(c0.y) + 1,
    Math.round(c1.x),
    Math.round(c1.y) + 1,
    PAL.iron[2],
  );
  heap(b, -0.3, 0.3, 0.12, 5, COAL, 132);
  b.outline(PAL.outline, 170);
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
export const DECOR_SPRITES: Record<string, () => PixelBuf> = {
  fuel_stop: fuelStop,
};
export { powerLine };
