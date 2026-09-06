import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import { PAL, shade, type RGB } from './palette';
import { PixelBuf } from './pixels';
import { drawPrism, drawCylinder } from './iso3d';

const W = 72;
const H = 64;
const OX = 36;
const OY = 50;

const PAINTS: Record<string, RGB[]> = {
  iron: PAL.iron,
  rust: PAL.rust,
  black: [
    [34, 34, 38],
    [46, 46, 50],
    [26, 26, 30],
    [58, 58, 62],
  ],
  green: [
    [44, 70, 50],
    [56, 86, 60],
    [34, 54, 40],
    [70, 100, 74],
  ],
  wood: PAL.timber,
  blue: [
    [40, 62, 96],
    [52, 78, 116],
    [30, 46, 74],
    [70, 98, 138],
  ],
  red: [
    [124, 44, 40],
    [146, 56, 50],
    [96, 34, 30],
    [168, 72, 62],
  ],
  yellow: [
    [178, 140, 50],
    [200, 160, 64],
    [146, 112, 38],
    [216, 180, 90],
  ],
  brown: [
    [96, 64, 44],
    [116, 80, 56],
    [74, 48, 32],
    [136, 98, 70],
  ],
};
/** Locomotive body styles, in the same order as the roster. */
const LOCO_BODIES = [
  'steam_early',
  'steam_std',
  'steam_streamlined',
  'diesel_switcher',
  'diesel_cab',
  'diesel_hood',
  'electric_box',
  'electric_crocodile',
] as const;
/** Body/paint combinations the shipped roster uses, plus an iron fallback for each body. */
const LOCO_PAINTS: Record<(typeof LOCO_BODIES)[number], string[]> = {
  steam_early: ['iron', 'black', 'green', 'yellow'],
  steam_std: ['iron', 'black', 'blue', 'green', 'rust'],
  steam_streamlined: ['iron', 'blue', 'rust'],
  diesel_switcher: ['iron', 'black', 'green'],
  diesel_cab: ['iron', 'blue', 'red'],
  diesel_hood: ['iron', 'black', 'green', 'yellow'],
  electric_box: ['iron', 'green', 'red'],
  electric_crocodile: ['iron', 'brown'],
};
const WHEELS: RGB[] = [
  [30, 30, 32],
  [44, 44, 48],
  [22, 22, 24],
];

function facingAngle(f: number) {
  return (f * Math.PI) / 4;
}
/** Offset a point along the heading (l) and across it (w), in tile units. */
function along(angle: number, l: number, w: number) {
  return {
    x: Math.cos(angle) * l - Math.sin(angle) * w,
    y: Math.sin(angle) * l + Math.cos(angle) * w,
  };
}

function chassis(b: PixelBuf, angle: number, len: number, seed: number) {
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: 0,
    cy: 0,
    angle,
    len,
    wid: 0.2,
    h: 5,
    top: WHEELS,
    side: WHEELS,
    seed,
  });
  // axle boxes / wheels as darker dots on both sides
  for (const l of [-len * 0.32, len * 0.32]) {
    for (const w of [-0.11, 0.11]) {
      const p = along(angle, l, w);
      const sx = Math.round(OX + (p.x - p.y) * 32);
      const sy = Math.round(OY + (p.x + p.y) * 16) - 2;
      b.rect(sx - 1, sy - 2, 3, 4, WHEELS[2]);
      b.set(sx, sy - 1, PAL.iron[3]);
    }
  }
}

function steamLoco(paint: RGB[], f: number): PixelBuf {
  const b = new PixelBuf(W, H);
  const a = facingAngle(f);
  chassis(b, a, 0.62, 3 + f);
  // running board
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: 0,
    cy: 0,
    angle: a,
    len: 0.66,
    wid: 0.28,
    h: 2,
    z0: 5,
    top: PAL.iron,
    side: PAL.iron,
    seed: 11,
  });
  // boiler: two stacked prisms approximate a cylinder
  const bc = along(a, 0.1, 0);
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: bc.x,
    cy: bc.y,
    angle: a,
    len: 0.42,
    wid: 0.2,
    h: 10,
    z0: 7,
    top: paint,
    side: paint,
    seed: 12,
  });
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: bc.x,
    cy: bc.y,
    angle: a,
    len: 0.42,
    wid: 0.13,
    h: 3,
    z0: 17,
    top: paint.map((c) => shade(c, 1.15)),
    side: paint,
    seed: 13,
  });
  // smokebox front (darker) and chimney
  const sm = along(a, 0.27, 0);
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: sm.x,
    cy: sm.y,
    angle: a,
    len: 0.08,
    wid: 0.21,
    h: 11,
    z0: 7,
    top: PAL.iron,
    side: [PAL.iron[2], PAL.iron[0]],
    seed: 14,
  });
  const ch = along(a, 0.24, 0);
  drawCylinder(
    b,
    OX,
    OY,
    ch.x,
    ch.y,
    0.045,
    18,
    9,
    [PAL.iron[2], PAL.iron[0], PAL.iron[1]],
    PAL.iron[0],
    15,
  );
  // dome
  const dm = along(a, 0.02, 0);
  drawCylinder(
    b,
    OX,
    OY,
    dm.x,
    dm.y,
    0.05,
    19,
    4,
    [PAL.brass, shade(PAL.brass, 0.8)],
    shade(PAL.brass, 1.1),
    16,
  );
  // cab at the rear
  const cb = along(a, -0.2, 0);
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: cb.x,
    cy: cb.y,
    angle: a,
    len: 0.2,
    wid: 0.27,
    h: 17,
    z0: 7,
    top: PAL.iron,
    side: paint,
    seed: 17,
    ridge: 3,
    roof: [PAL.iron[0], PAL.iron[2]],
  });
  // cab window (amber) on the visible side
  const win = along(a, -0.2, 0.135);
  const wx = Math.round(OX + (win.x - win.y) * 32);
  const wy = Math.round(OY + (win.x + win.y) * 16);
  if (win.x + win.y > cb.x + cb.y) b.rect(wx - 1, wy - 19, 3, 4, PAL.amberDark);
  // headlamp
  const hl = along(a, 0.32, 0);
  const hx = Math.round(OX + (hl.x - hl.y) * 32);
  const hy = Math.round(OY + (hl.x + hl.y) * 16);
  b.rect(hx - 1, hy - 14, 2, 2, PAL.amber);
  b.outline(PAL.outline, 190);
  return b;
}

function dieselLoco(paint: RGB[], f: number): PixelBuf {
  const b = new PixelBuf(W, H);
  const a = facingAngle(f);
  chassis(b, a, 0.64, 5 + f);
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: 0,
    cy: 0,
    angle: a,
    len: 0.68,
    wid: 0.27,
    h: 12,
    z0: 5,
    top: paint.map((c) => shade(c, 1.1)),
    side: paint,
    seed: 21,
  });
  // cab hump
  const cb = along(a, -0.12, 0);
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: cb.x,
    cy: cb.y,
    angle: a,
    len: 0.24,
    wid: 0.27,
    h: 6,
    z0: 17,
    top: PAL.iron,
    side: paint,
    seed: 22,
  });
  // stripe: light band along the side
  for (let i = -6; i <= 6; i++) {
    const p = along(a, i * 0.05, 0.135);
    const sx = Math.round(OX + (p.x - p.y) * 32);
    const sy = Math.round(OY + (p.x + p.y) * 16) - 10;
    if (p.x + p.y > 0.05) b.set(sx, sy, PAL.amber);
  }
  const hl = along(a, 0.33, 0);
  const hx = Math.round(OX + (hl.x - hl.y) * 32);
  const hy = Math.round(OY + (hl.x + hl.y) * 16);
  b.rect(hx - 1, hy - 13, 2, 2, PAL.amber);
  b.outline(PAL.outline, 190);
  return b;
}

/** Sprite pixel of a point offset along/across the heading at height z. */
function px(angle: number, l: number, w: number, z = 0) {
  const p = along(angle, l, w);
  return { x: Math.round(OX + (p.x - p.y) * 32), y: Math.round(OY + (p.x + p.y) * 16) - z };
}
/** Round headlamp at the front end (or both ends). */
function lamp(b: PixelBuf, angle: number, l: number, z: number) {
  const p = px(angle, l, 0, z);
  b.rect(p.x - 1, p.y - 1, 2, 2, PAL.amber);
}
/** Pantograph: two thin rods meeting a contact bar above the roof centre. */
function pantograph(b: PixelBuf, angle: number, l: number, zRoof: number) {
  const base = px(angle, l, 0, zRoof);
  const top = px(angle, l, 0, zRoof + 9);
  b.line(base.x - 2, base.y, top.x + 1, top.y, PAL.iron[3]);
  b.line(base.x + 2, base.y, top.x - 1, top.y, PAL.iron[3]);
  const a = px(angle, l, -0.08, zRoof + 9);
  const c = px(angle, l, 0.08, zRoof + 9);
  b.line(a.x, a.y, c.x, c.y, PAL.iron[3]);
}
/** Side windows along a cab wall on whichever face is towards the viewer. */
function windows(b: PixelBuf, angle: number, ls: number[], z: number, hgt = 3) {
  for (const l of ls) {
    for (const w of [-0.135, 0.135]) {
      const p = along(angle, l, w);
      const c = along(angle, l, 0);
      if (p.x + p.y <= c.x + c.y) continue; // hidden face
      const q = px(angle, l, w, z);
      b.rect(q.x - 1, q.y - hgt, 2, hgt, PAL.amberDark);
      b.set(q.x - 1, q.y - hgt, PAL.amber);
    }
  }
}

/** Rocket-era engine: tiny frame, tall chimney, open footplate, big rear wheels. */
function steamEarly(paint: RGB[], f: number): PixelBuf {
  const b = new PixelBuf(W, H);
  const a = facingAngle(f);
  chassis(b, a, 0.5, 3 + f);
  // low boiler
  const bc = along(a, 0.06, 0);
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: bc.x,
    cy: bc.y,
    angle: a,
    len: 0.34,
    wid: 0.17,
    h: 8,
    z0: 6,
    top: paint,
    side: paint,
    seed: 12,
  });
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: bc.x,
    cy: bc.y,
    angle: a,
    len: 0.34,
    wid: 0.1,
    h: 2,
    z0: 14,
    top: paint.map((c) => shade(c, 1.15)),
    side: paint,
    seed: 13,
  });
  // brass bands
  for (const l of [-0.06, 0.14]) {
    const p = px(a, l, 0.09, 10);
    b.rect(p.x, p.y - 4, 1, 5, PAL.brass);
  }
  // very tall chimney
  const ch = along(a, 0.22, 0);
  drawCylinder(b, OX, OY, ch.x, ch.y, 0.04, 14, 18, [PAL.iron[2], PAL.iron[0]], PAL.iron[0], 15);
  const cap = px(a, 0.22, 0, 32);
  b.rect(cap.x - 3, cap.y - 1, 6, 2, PAL.brass);
  // open footplate with a low weather board and driver
  const fb = along(a, -0.18, 0);
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: fb.x,
    cy: fb.y,
    angle: a,
    len: 0.16,
    wid: 0.24,
    h: 2,
    z0: 6,
    top: PAL.timber,
    side: PAL.timber,
    seed: 17,
  });
  const board = px(a, -0.1, 0, 8);
  b.rect(board.x - 3, board.y - 8, 6, 8, paint[2]);
  const drv = px(a, -0.2, 0, 8);
  b.rect(drv.x - 1, drv.y - 6, 2, 6, PAINTS.blue[0]);
  b.set(drv.x - 1, drv.y - 7, PAL.white);
  b.set(drv.x, drv.y - 7, PAL.white);
  // big rear wheel visible
  for (const w of [-0.11, 0.11]) {
    const p = px(a, -0.12, w, 0);
    b.ellipse(p.x, p.y - 4, 4, 4, WHEELS, 61);
    b.set(p.x, p.y - 4, PAL.brass);
  }
  lamp(b, a, 0.26, 12);
  b.outline(PAL.outline, 190);
  return b;
}

/** Art-deco shrouded express engine: long rounded casing, skirts over the wheels, lowered cab. */
function steamStreamlined(paint: RGB[], f: number): PixelBuf {
  const b = new PixelBuf(W, H);
  const a = facingAngle(f);
  chassis(b, a, 0.7, 7 + f);
  // skirts
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: 0,
    cy: 0,
    angle: a,
    len: 0.74,
    wid: 0.29,
    h: 4,
    z0: 4,
    top: paint.map((c) => shade(c, 0.9)),
    side: paint.map((c) => shade(c, 0.8)),
    seed: 21,
  });
  // stepped casing approximates a rounded shroud
  const steps: [number, number, number][] = [
    [0.72, 0.27, 6],
    [0.68, 0.22, 4],
    [0.6, 0.15, 3],
    [0.5, 0.08, 2],
  ];
  let z = 8;
  for (const [len, wid, h] of steps) {
    drawPrism(b, {
      ox: OX,
      oy: OY,
      cx: along(a, -0.02, 0).x,
      cy: along(a, -0.02, 0).y,
      angle: a,
      len,
      wid,
      h,
      z0: z,
      top: paint.map((c) => shade(c, 1.1)),
      side: paint,
      seed: 22 + h,
    });
    z += h;
  }
  // speed stripe
  for (let i = -7; i <= 7; i++) {
    const p = along(a, i * 0.05, 0.14);
    const c = along(a, i * 0.05, 0);
    if (p.x + p.y > c.x + c.y) {
      const q = px(a, i * 0.05, 0.14, 12);
      b.set(q.x, q.y, PAL.white);
    }
  }
  // sloped nose: dark wedge
  const nose = px(a, 0.36, 0, 8);
  b.rect(nose.x - 2, nose.y - 10, 4, 10, shade(paint[2], 0.85));
  // recessed chimney bump
  const ch = along(a, 0.2, 0);
  drawCylinder(b, OX, OY, ch.x, ch.y, 0.04, z, 3, [PAL.iron[2], PAL.iron[0]], PAL.iron[0], 25);
  windows(b, a, [-0.28, -0.22], 17, 3);
  lamp(b, a, 0.37, 14);
  b.outline(PAL.outline, 190);
  return b;
}

/** Yard switcher: short frame, low hood, cab at one end. */
function dieselSwitcher(paint: RGB[], f: number): PixelBuf {
  const b = new PixelBuf(W, H);
  const a = facingAngle(f);
  chassis(b, a, 0.5, 9 + f);
  const hood = along(a, 0.08, 0);
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: hood.x,
    cy: hood.y,
    angle: a,
    len: 0.36,
    wid: 0.2,
    h: 9,
    z0: 5,
    top: paint.map((c) => shade(c, 1.1)),
    side: paint,
    seed: 31,
  });
  // walkway
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: 0,
    cy: 0,
    angle: a,
    len: 0.54,
    wid: 0.27,
    h: 1,
    z0: 5,
    top: PAL.iron,
    side: PAL.iron,
    seed: 32,
  });
  const cab = along(a, -0.17, 0);
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: cab.x,
    cy: cab.y,
    angle: a,
    len: 0.16,
    wid: 0.26,
    h: 14,
    z0: 5,
    top: PAL.iron,
    side: paint,
    seed: 33,
  });
  windows(b, a, [-0.17], 19, 4);
  // hood louvres
  for (const l of [0.0, 0.08, 0.16]) {
    const p = px(a, l, 0.1, 9);
    b.set(p.x, p.y, shade(paint[2], 0.8));
    b.set(p.x, p.y - 2, shade(paint[2], 0.8));
  }
  lamp(b, a, 0.27, 12);
  lamp(b, a, -0.26, 16);
  b.outline(PAL.outline, 190);
  return b;
}

/** Road switcher: long hood, cab near one end, low short hood beyond it. */
function dieselHood(paint: RGB[], f: number): PixelBuf {
  const b = new PixelBuf(W, H);
  const a = facingAngle(f);
  chassis(b, a, 0.7, 11 + f);
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: 0,
    cy: 0,
    angle: a,
    len: 0.74,
    wid: 0.28,
    h: 2,
    z0: 5,
    top: PAL.iron,
    side: PAL.iron,
    seed: 34,
  });
  const long = along(a, 0.12, 0);
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: long.x,
    cy: long.y,
    angle: a,
    len: 0.46,
    wid: 0.2,
    h: 11,
    z0: 7,
    top: paint.map((c) => shade(c, 1.1)),
    side: paint,
    seed: 35,
  });
  // radiator fans on the roof
  for (const l of [0.22, 0.3]) {
    const p = px(a, l, 0, 18);
    b.ellipse(p.x, p.y, 3, 1, [PAL.iron[2], PAL.iron[0]], 62);
  }
  const cab = along(a, -0.19, 0);
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: cab.x,
    cy: cab.y,
    angle: a,
    len: 0.16,
    wid: 0.27,
    h: 13,
    z0: 7,
    top: PAL.iron,
    side: paint,
    seed: 36,
  });
  const short = along(a, -0.32, 0);
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: short.x,
    cy: short.y,
    angle: a,
    len: 0.1,
    wid: 0.2,
    h: 6,
    z0: 7,
    top: paint.map((c) => shade(c, 1.1)),
    side: paint,
    seed: 37,
  });
  windows(b, a, [-0.19], 20, 4);
  // stripe
  for (let i = -6; i <= 8; i++) {
    const p = along(a, i * 0.05, 0.1);
    const c = along(a, i * 0.05, 0);
    if (p.x + p.y > c.x + c.y) {
      const q = px(a, i * 0.05, 0.1, 9);
      b.set(q.x, q.y, PAL.white);
    }
  }
  lamp(b, a, 0.36, 14);
  lamp(b, a, -0.37, 10);
  b.outline(PAL.outline, 190);
  return b;
}

/** Bo-Bo box-cab electric with a pantograph and a light band. */
function electricBox(paint: RGB[], f: number): PixelBuf {
  const b = new PixelBuf(W, H);
  const a = facingAngle(f);
  chassis(b, a, 0.62, 13 + f);
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: 0,
    cy: 0,
    angle: a,
    len: 0.64,
    wid: 0.27,
    h: 14,
    z0: 5,
    top: paint.map((c) => shade(c, 1.1)),
    side: paint,
    seed: 41,
  });
  // roof equipment box
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: 0,
    cy: 0,
    angle: a,
    len: 0.4,
    wid: 0.18,
    h: 2,
    z0: 19,
    top: PAL.iron,
    side: PAL.iron,
    seed: 42,
  });
  windows(b, a, [-0.26, 0.26], 18, 4);
  for (let i = -6; i <= 6; i++) {
    const p = along(a, i * 0.05, 0.135);
    const c = along(a, i * 0.05, 0);
    if (p.x + p.y > c.x + c.y) {
      const q = px(a, i * 0.05, 0.135, 11);
      b.set(q.x, q.y, PAL.white);
    }
  }
  pantograph(b, a, 0.1, 21);
  lamp(b, a, 0.33, 13);
  lamp(b, a, -0.33, 13);
  b.outline(PAL.outline, 190);
  return b;
}

/** Articulated rod-drive electric: centre cab with two long low noses, two pantographs. */
function electricCrocodile(paint: RGB[], f: number): PixelBuf {
  const b = new PixelBuf(W, H);
  const a = facingAngle(f);
  chassis(b, a, 0.78, 15 + f);
  for (const side of [-1, 1]) {
    const n = along(a, side * 0.25, 0);
    drawPrism(b, {
      ox: OX,
      oy: OY,
      cx: n.x,
      cy: n.y,
      angle: a,
      len: 0.3,
      wid: 0.2,
      h: 8,
      z0: 5,
      top: paint.map((c) => shade(c, 1.1)),
      side: paint,
      seed: 43 + side,
    });
    // side rods
    for (const w of [-0.11, 0.11]) {
      const p0 = px(a, side * 0.14, w, 3);
      const p1 = px(a, side * 0.36, w, 3);
      b.line(p0.x, p0.y, p1.x, p1.y, PAL.red);
    }
  }
  const cab = along(a, 0, 0);
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: cab.x,
    cy: cab.y,
    angle: a,
    len: 0.22,
    wid: 0.27,
    h: 15,
    z0: 5,
    top: PAL.iron,
    side: paint,
    seed: 46,
  });
  windows(b, a, [-0.05, 0.05], 19, 4);
  pantograph(b, a, -0.06, 20);
  pantograph(b, a, 0.06, 20);
  lamp(b, a, 0.4, 9);
  lamp(b, a, -0.4, 9);
  b.outline(PAL.outline, 190);
  return b;
}

function locoBody(body: string, paint: RGB[], f: number): PixelBuf {
  switch (body) {
    case 'steam_early':
      return steamEarly(paint, f);
    case 'steam_streamlined':
      return steamStreamlined(paint, f);
    case 'diesel_switcher':
      return dieselSwitcher(paint, f);
    case 'diesel_cab':
      return dieselLoco(paint, f);
    case 'diesel_hood':
      return dieselHood(paint, f);
    case 'electric_box':
      return electricBox(paint, f);
    case 'electric_crocodile':
      return electricCrocodile(paint, f);
    default:
      return steamLoco(paint, f);
  }
}

function wagon(body: string, paint: RGB[], f: number): PixelBuf {
  const b = new PixelBuf(W, H);
  const a = facingAngle(f);
  chassis(b, a, 0.56, 31 + f);
  switch (body) {
    case 'box':
      drawPrism(b, {
        ox: OX,
        oy: OY,
        cx: 0,
        cy: 0,
        angle: a,
        len: 0.56,
        wid: 0.26,
        h: 13,
        z0: 5,
        top: PAL.iron,
        side: paint,
        seed: 41,
        ridge: 3,
        roof: [PAL.iron[0], PAL.iron[2], PAL.iron[1]],
      });
      break;
    case 'hopper':
      drawPrism(b, {
        ox: OX,
        oy: OY,
        cx: 0,
        cy: 0,
        angle: a,
        len: 0.56,
        wid: 0.26,
        h: 10,
        z0: 5,
        top: [PAL.iron[2], PAL.iron[0]],
        side: paint,
        seed: 42,
      });
      // rim
      drawPrism(b, {
        ox: OX,
        oy: OY,
        cx: 0,
        cy: 0,
        angle: a,
        len: 0.56,
        wid: 0.26,
        h: 1,
        z0: 15,
        top: paint.map((c) => shade(c, 1.2)),
        side: paint,
        seed: 43,
      });
      break;
    case 'flat':
      drawPrism(b, {
        ox: OX,
        oy: OY,
        cx: 0,
        cy: 0,
        angle: a,
        len: 0.58,
        wid: 0.27,
        h: 3,
        z0: 5,
        top: paint.map((c) => shade(c, 1.1)),
        side: paint,
        seed: 44,
      });
      for (const l of [-0.25, 0, 0.25])
        for (const w of [-0.125, 0.125]) {
          const p = along(a, l, w);
          const sx = Math.round(OX + (p.x - p.y) * 32);
          const sy = Math.round(OY + (p.x + p.y) * 16) - 8;
          b.rect(sx, sy - 4, 1, 5, PAL.iron[2]);
        }
      break;
    case 'tank':
      drawPrism(b, {
        ox: OX,
        oy: OY,
        cx: 0,
        cy: 0,
        angle: a,
        len: 0.5,
        wid: 0.2,
        h: 9,
        z0: 6,
        top: paint,
        side: paint,
        seed: 45,
      });
      drawPrism(b, {
        ox: OX,
        oy: OY,
        cx: 0,
        cy: 0,
        angle: a,
        len: 0.5,
        wid: 0.13,
        h: 3,
        z0: 15,
        top: paint.map((c) => shade(c, 1.2)),
        side: paint,
        seed: 46,
      });
      drawCylinder(b, OX, OY, 0, 0, 0.04, 18, 3, [PAL.iron[1], PAL.iron[2]], PAL.iron[3], 47);
      break;
  }
  b.outline(PAL.outline, 190);
  return b;
}

/** Cargo overlays drawn in the same frame as the wagons; tinted at runtime by cargo colour. */
function load(kind: string, f: number): PixelBuf {
  const b = new PixelBuf(W, H);
  const a = facingAngle(f);
  const grey: RGB[] = [
    [200, 200, 200],
    [230, 230, 230],
    [170, 170, 170],
  ];
  switch (kind) {
    case 'heap':
      drawPrism(b, {
        ox: OX,
        oy: OY,
        cx: 0,
        cy: 0,
        angle: a,
        len: 0.48,
        wid: 0.2,
        h: 3,
        z0: 15,
        top: grey,
        side: grey,
        seed: 51,
      });
      drawPrism(b, {
        ox: OX,
        oy: OY,
        cx: 0,
        cy: 0,
        angle: a,
        len: 0.32,
        wid: 0.12,
        h: 3,
        z0: 18,
        top: grey,
        side: grey,
        seed: 52,
      });
      break;
    case 'crates':
      for (const l of [-0.16, 0.06, 0.2]) {
        const p = along(a, l, 0);
        drawPrism(b, {
          ox: OX,
          oy: OY,
          cx: p.x,
          cy: p.y,
          angle: a,
          len: 0.12,
          wid: 0.18,
          h: 6,
          z0: 8,
          top: grey,
          side: grey,
          seed: 53,
        });
      }
      break;
    case 'bales':
      for (const l of [-0.18, -0.06, 0.06, 0.18]) {
        const p = along(a, l, 0);
        drawPrism(b, {
          ox: OX,
          oy: OY,
          cx: p.x,
          cy: p.y,
          angle: a,
          len: 0.1,
          wid: 0.2,
          h: 5,
          z0: 8,
          top: grey,
          side: grey.map((c) => shade(c, 0.85)),
          seed: 55,
        });
        const q = px(a, l, 0.1, 10);
        b.set(q.x, q.y, [120, 120, 120]);
      }
      break;
    case 'logs':
      for (const w of [-0.08, 0.02, 0.1]) {
        const p = along(a, 0, w);
        drawPrism(b, {
          ox: OX,
          oy: OY,
          cx: p.x,
          cy: p.y,
          angle: a,
          len: 0.5,
          wid: 0.07,
          h: 4,
          z0: w === 0.02 ? 12 : 8,
          top: grey,
          side: grey,
          seed: 54,
        });
      }
      break;
  }
  b.outline(PAL.outline, 120);
  return b;
}

export function generateRollingAtlas(): AtlasImage {
  const ab = new AtlasBuilder();
  for (let f = 0; f < 8; f++) {
    for (const body of LOCO_BODIES)
      for (const p of LOCO_PAINTS[body])
        ab.add(
          `rolling/loco_${body}_${p}_f${f}`,
          locoBody(body, PAINTS[p], f).toImageData(),
          OX,
          OY,
        );
    for (const body of ['box', 'hopper', 'flat', 'tank'])
      for (const p of ['wood', 'iron', 'black'])
        ab.add(`rolling/wagon_${body}_${p}_f${f}`, wagon(body, PAINTS[p], f).toImageData(), OX, OY);
    for (const k of ['heap', 'crates', 'logs', 'bales'])
      ab.add(`rolling/load_${k}_f${f}`, load(k, f).toImageData(), OX, OY);
  }
  return ab.build(2048);
}
