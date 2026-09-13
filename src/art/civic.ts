import { PixelBuf } from './pixels';
import { PAL, shade, type RGB } from './palette';
import { drawPrism, drawCylinder, proj } from './iso3d';

export const CIVIC_OX = 48,
  CIVIC_OY = 164;
const STONE: RGB[] = [
  [159, 150, 129],
  [182, 172, 149],
  [124, 117, 104],
];
const GLASS: RGB[] = [
  [61, 98, 113],
  [82, 119, 133],
  [43, 71, 86],
];
export function residence(level: number) {
  const b = new PixelBuf(96, 184),
    h = [23, 43, 79, 132][level - 1];
  const side = level === 1 ? PAL.timber : level === 2 ? STONE : GLASS;
  const prism = (
    len: number,
    wid: number,
    z: number,
    height: number,
    colors: RGB[],
    roof = false,
  ) =>
    drawPrism(b, {
      ox: CIVIC_OX,
      oy: CIVIC_OY,
      cx: 0,
      cy: 0,
      angle: 0,
      len,
      wid,
      z0: z,
      h: height,
      top: PAL.iron,
      side: colors,
      seed: 27 + level,
      ridge: roof ? 8 : undefined,
      roof: roof ? PAL.roof : undefined,
    });
  prism(0.76, 0.66, 0, 4, PAL.stone);
  prism(0.6, 0.49, 4, h, side, level < 3);
  if (level === 4) {
    prism(0.42, 0.35, h + 4, 14, GLASS);
    const p = proj(CIVIC_OX, CIVIC_OY, 0, 0, h + 18);
    b.line(p.x, p.y, p.x, p.y - 8, PAL.brass);
  }
  for (let z = 12; z < h; z += 10)
    for (const wall of [0, 1])
      for (const u of [-0.2, -0.07, 0.07, 0.2]) {
        const p = proj(CIVIC_OX, CIVIC_OY, wall ? 0.306 : u, wall ? u : 0.251, z);
        b.rect(
          p.x - 1,
          p.y - 4,
          3,
          5,
          level < 3 ? PAL.amberDark : shade(PAL.cyanDark, z % 20 === 12 ? 1.5 : 0.8),
        );
        b.line(p.x - 1, p.y + 1, p.x + 2, p.y + 1, PAL.stone[0]);
      }
  const door = proj(CIVIC_OX, CIVIC_OY, 0, 0.26, 4);
  b.rect(door.x - 2, door.y - 9, 4, 9, PAL.iron[2]);
  b.outline(PAL.outline, 170);
  return b;
}
export function windmill(level = 1) {
  const b = new PixelBuf(96, 184),
    h = 30 + level * 6;
  drawCylinder(
    b,
    CIVIC_OX,
    CIVIC_OY,
    0,
    0,
    0.24,
    0,
    h,
    level < 3 ? PAL.stone : STONE,
    PAL.stone[0],
    91,
  );
  drawPrism(b, {
    ox: CIVIC_OX,
    oy: CIVIC_OY,
    cx: 0,
    cy: 0,
    angle: 0,
    len: 0.5,
    wid: 0.45,
    h: 3,
    z0: h,
    top: PAL.roof,
    side: PAL.roof,
    ridge: 10,
    roof: PAL.roof,
    seed: 8,
  });
  const p = proj(CIVIC_OX, CIVIC_OY, 0, 0.26, h - 4);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const dx = Math.cos(a),
      dy = Math.sin(a),
      r = 25 + level;
    b.line(p.x, p.y, p.x + dx * r, p.y + dy * r, PAL.timber[2]);
    for (let q = 8; q < r; q++)
      b.line(
        p.x + dx * q,
        p.y + dy * q,
        p.x + dx * q - dy * 5,
        p.y + dy * q + dx * 5,
        level > 2 ? PAL.white : PAL.sand[0],
      );
  }
  b.rect(p.x - 2, p.y - 2, 4, 4, PAL.brass);
  const d = proj(CIVIC_OX, CIVIC_OY, 0, 0.25, 0);
  b.rect(d.x - 2, d.y - 10, 5, 10, PAL.trunkDark);
  b.outline(PAL.outline, 170);
  return b;
}
/** Larger boiler houses, pipework and metal roof fixtures signal successive works upgrades. */
export function upgradedWorks(base: PixelBuf, level: number) {
  const b = new PixelBuf(96, 184);
  b.blit(base, 0, CIVIC_OY - 68);
  drawPrism(b, {
    ox: CIVIC_OX,
    oy: CIVIC_OY,
    cx: 0.27,
    cy: 0.18,
    angle: 0,
    len: 0.23,
    wid: 0.25,
    z0: 0,
    h: 12 + level * 5,
    top: PAL.iron,
    side: level === 2 ? STONE : GLASS,
    seed: level * 11,
  });
  for (let i = 0; i < level - 1; i++)
    drawCylinder(
      b,
      CIVIC_OX,
      CIVIC_OY,
      -0.29 + i * 0.12,
      -0.2,
      0.035,
      0,
      35 + level * 5,
      PAL.iron,
      PAL.iron[1],
      i + 9,
    );
  b.outline(PAL.outline, 170);
  return b;
}
