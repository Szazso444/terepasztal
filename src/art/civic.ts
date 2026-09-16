import { PixelBuf } from './pixels';
import { PAL, shade, type RGB } from './palette';
import { drawPrism, drawCylinder, proj } from './iso3d';

export const CIVIC_OX = 48,
  CIVIC_OY = 164;
const STONE: RGB[] = [
  [200, 188, 162],
  [218, 206, 180],
  [170, 158, 134],
];
const GLASS: RGB[] = [
  [96, 140, 156],
  [118, 162, 176],
  [74, 110, 126],
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
  // flour sacks beside the door: the mill's product, stacked higher as it is upgraded
  const sackC: RGB[] = [
    [214, 202, 174],
    [232, 222, 196],
    [186, 172, 146],
  ];
  const s = proj(CIVIC_OX, CIVIC_OY, 0.24, 0.24, 0);
  for (let i = 0; i < Math.min(4, level + 1); i++) {
    const sx = s.x - 4 + (i % 2) * 6;
    const sy = s.y - Math.floor(i / 2) * 4;
    b.rect(sx, sy - 5, 5, 5, sackC[0]);
    b.rect(sx, sy - 5, 2, 5, sackC[1]);
    b.rect(sx + 4, sy - 5, 1, 5, sackC[2]);
    b.set(sx + 2, sy - 6, sackC[2]);
  }
  if (level > 2) {
    // a sack hoist beam above the door once the mill has a handling annex
    const hb = proj(CIVIC_OX, CIVIC_OY, 0, 0.3, h - 10);
    b.rect(hb.x - 1, hb.y - 2, 8, 2, PAL.timber[2]);
    b.rect(hb.x + 6, hb.y, 1, 5, PAL.iron[2]);
    b.rect(hb.x + 4, hb.y + 5, 5, 4, sackC[0]);
  }
  b.outline(PAL.outline, 170);
  return b;
}
/**
 * Works upgrades: a handling annex, covered sorting bays and better machinery beside the base
 * building. The additions stay low and use the works' own materials so the dominant object of
 * each process still reads; a taller stack alone would make every upgraded works look alike.
 */
export function upgradedWorks(base: PixelBuf, level: number) {
  const b = new PixelBuf(96, 184);
  b.blit(base, 0, CIVIC_OY - 68);
  const P = (tx: number, ty: number, z = 0) => proj(CIVIC_OX, CIVIC_OY, tx, ty, z);
  // handling annex on the +x/+y corner: cream walls, slate roof, one loading bay
  const annexH = 9 + level * 2;
  drawPrism(b, {
    ox: CIVIC_OX,
    oy: CIVIC_OY,
    cx: 0.29,
    cy: 0.2,
    angle: 0,
    len: 0.2 + level * 0.02,
    wid: 0.22,
    z0: 0,
    h: annexH,
    top: PAL.roofSlate,
    side: STONE,
    ridge: 5,
    roof: PAL.roofSlate,
    seed: level * 11,
  });
  const bay = P(0.29, 0.31);
  b.rect(bay.x - 3, bay.y - Math.round(annexH * 0.7), 7, Math.round(annexH * 0.7), PAL.outline);
  b.rect(bay.x - 2, bay.y - Math.round(annexH * 0.7) + 1, 5, 2, PAL.iron[0]);
  // covered conveyor from the annex towards the main building, on short iron legs
  const c0 = P(0.18, 0.16, annexH - 2);
  const c1 = P(-0.02, 0.06, annexH + 2);
  b.line(c0.x, c0.y, c1.x, c1.y, PAL.iron[1]);
  b.line(c0.x, c0.y + 1, c1.x, c1.y + 1, PAL.iron[2]);
  b.line(c0.x, c0.y + 2, c1.x, c1.y + 2, PAL.iron[0]);
  const leg = P(0.08, 0.11);
  b.rect(leg.x, leg.y - annexH, 1, annexH, PAL.iron[2]);
  if (level >= 3) {
    // sorting bay: an open lean-to with a timber frame on the -x side
    for (const [lx, ly] of [
      [-0.36, 0.3],
      [-0.16, 0.3],
      [-0.36, 0.12],
      [-0.16, 0.12],
    ]) {
      const p = P(lx, ly);
      b.rect(p.x - 1, p.y - 12, 2, 12, PAL.timber[2]);
    }
    const r0 = P(-0.4, 0.34, 12);
    const r1 = P(-0.12, 0.08, 14);
    for (let k = 0; k < 3; k++) b.line(r0.x, r0.y + k, r1.x, r1.y + k, PAL.roofSlate[k % 3]);
    // stacked product under the lean-to
    const st = P(-0.26, 0.24);
    b.rect(st.x - 5, st.y - 6, 10, 6, PAL.timber[0]);
    b.rect(st.x - 5, st.y - 6, 10, 1, PAL.timber[1]);
  }
  if (level >= 4) {
    // refined machinery: a copper-banded vessel and a short vent stack, not a generic chimney
    drawCylinder(b, CIVIC_OX, CIVIC_OY, -0.3, -0.14, 0.07, 0, 18, STONE, STONE[1], 9);
    const band = P(-0.3, -0.14, 10);
    for (let x = -4; x <= 4; x++)
      b.set(band.x + x, band.y + Math.round(Math.abs(x) / 3), PAL.copper[0]);
    drawCylinder(b, CIVIC_OX, CIVIC_OY, -0.3, -0.14, 0.03, 18, 12, PAL.iron, PAL.iron[1], 10);
    const cap = P(-0.3, -0.14, 30);
    b.rect(cap.x - 2, cap.y - 1, 4, 2, PAL.iron[0]);
  }
  b.outline(PAL.outline, 170);
  return b;
}
