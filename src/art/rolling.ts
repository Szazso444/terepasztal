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
    for (const p of ['iron', 'rust', 'black', 'green'])
      ab.add(`rolling/loco_steam_${p}_f${f}`, steamLoco(PAINTS[p], f).toImageData(), OX, OY);
    for (const p of ['iron', 'green'])
      ab.add(`rolling/loco_diesel_${p}_f${f}`, dieselLoco(PAINTS[p], f).toImageData(), OX, OY);
    for (const body of ['box', 'hopper', 'flat', 'tank'])
      for (const p of ['wood', 'iron', 'black'])
        ab.add(`rolling/wagon_${body}_${p}_f${f}`, wagon(body, PAINTS[p], f).toImageData(), OX, OY);
    for (const k of ['heap', 'crates', 'logs'])
      ab.add(`rolling/load_${k}_f${f}`, load(k, f).toImageData(), OX, OY);
  }
  return ab.build(2048);
}
