import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import { ART_SCALE } from '../engine/iso';
import { addBridgeFrames } from './bridges';
import { residence, windmill, upgradedWorks, CIVIC_OX, CIVIC_OY } from './civic';
import { PAL, shade, type RGB } from './palette';
import { PixelBuf } from './pixels';
import { drawPrism, drawCylinder, proj, fillPoly } from './iso3d';

/**
 * Scale a base (ART_SCALE 1) pixel literal to the current art scale. Canvas sizes, sprite origins,
 * every hand-placed rect/line/set offset and every atlas anchor pass through this. Tile-space args
 * to proj/drawPrism/drawCylinder (cx, cy, len, wid, r, angle) and their z heights are NOT scaled
 * here: proj and iso3d already carry the scale for those.
 */
const S = (n: number) => n * ART_SCALE;
import {
  STATION_FAMILIES,
  BUILDING_SPRITES,
  DECOR_SPRITES,
  HOUSE_SPRITES,
  powerLine,
  ground,
  shadowRect,
  shadowEllipse,
  patchRect,
  paving,
} from './industry';

const W = S(96);
const H = S(84);
const OX = S(48);
const OY = S(68);

function lantern(b: PixelBuf, tx: number, ty: number) {
  const p = proj(OX, OY, tx, ty);
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  b.rect(x, y - S(14), S(1), S(14), PAL.iron[2]);
  b.rect(x - S(1), y - S(17), S(3), S(3), PAL.iron[0]);
  b.set(x, y - S(16), PAL.amber);
  b.set(x - S(1), y - S(18), PAL.iron[1]);
  b.set(x, y - S(18), PAL.iron[1]);
  b.set(x + S(1), y - S(18), PAL.iron[1]);
}

/**
 * Station nameboard: a pale board on two posts with dark lettering marks. It reads as a sign at
 * game zoom without spelling anything, and never carries baked text.
 */
function nameboard(b: PixelBuf, tx: number, ty: number, w = S(11)) {
  const p = proj(OX, OY, tx, ty);
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  for (const px of [x - Math.floor(w / 2) + S(1), x + Math.floor(w / 2) - S(1)])
    b.rect(px, y - S(7), S(1), S(7), PAL.timber[2]);
  b.rect(x - Math.floor(w / 2), y - S(12), w, S(5), PAL.white);
  b.rect(x - Math.floor(w / 2), y - S(12), w, S(1), shade(PAL.white, 1.05));
  b.rect(x - Math.floor(w / 2), y - S(8), w, S(1), shade(PAL.white, 0.78));
  for (let i = S(1); i < w - S(1); i += S(2))
    b.set(x - Math.floor(w / 2) + i, y - S(10), PAL.outline);
  b.set(x - Math.floor(w / 2) + S(2), y - S(11), PAL.outline);
  b.set(x + Math.floor(w / 2) - S(3), y - S(11), PAL.outline);
}

function stationL1(): PixelBuf {
  const b = new PixelBuf(W, H);
  // timber shed at the back corner
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: -0.12,
    cy: -0.14,
    angle: 0,
    len: 0.58,
    wid: 0.42,
    h: 16,
    top: PAL.roof,
    side: PAL.timber,
    ridge: 7,
    roof: PAL.roof,
    seed: 3,
  });
  // door & window on the visible +y face
  const d = proj(OX, OY, 0.05, 0.07);
  b.rect(Math.round(d.x) - S(1), Math.round(d.y) - S(9), S(3), S(8), PAL.trunkDark);
  const w = proj(OX, OY, -0.25, 0.07);
  b.rect(Math.round(w.x) - S(1), Math.round(w.y) - S(10), S(3), S(3), PAL.amberDark);
  // nameboard, bench and lantern on the front
  nameboard(b, -0.3, 0.26, S(9));
  lantern(b, 0.32, 0.3);
  const bench = proj(OX, OY, 0.05, 0.36);
  b.rect(Math.round(bench.x) - S(5), Math.round(bench.y) - S(4), S(10), S(2), PAL.timber[1]);
  b.rect(Math.round(bench.x) - S(5), Math.round(bench.y) - S(2), S(1), S(2), PAL.timber[2]);
  b.rect(Math.round(bench.x) + S(4), Math.round(bench.y) - S(2), S(1), S(2), PAL.timber[2]);
  b.outline(PAL.outline, 170);
  // a few flagstones in front of the door, shadow under the shed
  ground(b, [
    patchRect(0.08, 0.3, 0.46, 0.22, paving(PAL.stone, 11), 11, 255, 0.08),
    shadowRect(-0.12, -0.14, 0.58, 0.42),
  ]);
  return b;
}

function stationL2(): PixelBuf {
  const b = new PixelBuf(W, H);
  // stone building with slate roof
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: -0.1,
    cy: -0.14,
    angle: 0,
    len: 0.7,
    wid: 0.46,
    h: 22,
    top: PAL.roofSlate,
    side: PAL.stone,
    ridge: 9,
    roof: PAL.roofSlate,
    seed: 5,
  });
  // chimney
  drawCylinder(b, OX, OY, -0.32, -0.28, 0.05, 30, 8, PAL.stone, PAL.stone[2], 6);
  // windows row on +y face
  for (const tx of [-0.32, -0.1, 0.12]) {
    const w = proj(OX, OY, tx, 0.09);
    b.rect(Math.round(w.x) - S(1), Math.round(w.y) - S(14), S(3), S(4), PAL.amberDark);
    b.set(Math.round(w.x), Math.round(w.y) - S(13), PAL.amber);
  }
  const d = proj(OX, OY, 0.2, 0.09);
  b.rect(Math.round(d.x) - S(2), Math.round(d.y) - S(10), S(4), S(9), PAL.trunkDark);
  // canopy along the front edge
  const c0 = proj(OX, OY, -0.44, 0.22);
  const c1 = proj(OX, OY, 0.36, 0.22);
  const c2 = proj(OX, OY, 0.36, 0.42);
  const c3 = proj(OX, OY, -0.44, 0.42);
  const lift = S(13);
  fillPoly(
    b,
    [
      { x: c0.x, y: c0.y - lift - S(2) },
      { x: c1.x, y: c1.y - lift - S(2) },
      { x: c2.x, y: c2.y - lift + S(2) },
      { x: c3.x, y: c3.y - lift + S(2) },
    ],
    (x, y) => ((x + y) % 2 === 0 ? PAL.roofSlate[1] : PAL.roofSlate[0]),
  );
  for (const p of [c2, c3, { x: (c2.x + c3.x) / 2, y: (c2.y + c3.y) / 2 }])
    b.rect(Math.round(p.x), Math.round(p.y) - lift + S(2), S(1), lift - S(2), PAL.iron[2]);
  nameboard(b, -0.34, 0.42, S(11));
  lantern(b, 0.42, 0.34);
  b.outline(PAL.outline, 170);
  // paved strip under the canopy only, shadows under the building and the canopy
  ground(b, [
    patchRect(-0.04, 0.33, 0.76, 0.18, paving(PAL.stone, 12), 12, 255, 0.06),
    shadowRect(-0.1, -0.14, 0.7, 0.46),
    shadowEllipse(-0.32, -0.28, 0.07, 50),
    shadowRect(-0.04, 0.32, 0.8, 0.2, 40),
  ]);
  return b;
}

function stationL3(): PixelBuf {
  const b = new PixelBuf(W, H);
  // main hall
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: -0.08,
    cy: -0.16,
    angle: 0,
    len: 0.84,
    wid: 0.5,
    h: 26,
    top: PAL.roofSlate,
    side: PAL.stone,
    ridge: 10,
    roof: PAL.roofSlate,
    seed: 7,
  });
  // clock gable at the left end: limestone walls under a slate cap, kept below the hall's mass
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: -0.42,
    cy: -0.16,
    angle: 0,
    len: 0.2,
    wid: 0.22,
    h: 34,
    top: PAL.stone,
    side: PAL.stone,
    seed: 8,
  });
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: -0.42,
    cy: -0.16,
    angle: 0,
    len: 0.22,
    wid: 0.24,
    z0: 34,
    h: 2,
    top: PAL.roofSlate,
    side: PAL.roofSlate,
    ridge: 7,
    roof: PAL.roofSlate,
    seed: 9,
  });
  const clock = proj(OX, OY, -0.42, 0.0);
  b.rect(Math.round(clock.x) - S(2), Math.round(clock.y) - S(30), S(5), S(5), PAL.white);
  b.set(Math.round(clock.x), Math.round(clock.y) - S(28), PAL.outline);
  b.set(Math.round(clock.x), Math.round(clock.y) - S(29), PAL.outline);
  b.set(Math.round(clock.x) + S(1), Math.round(clock.y) - S(28), PAL.outline);
  // arched windows
  for (const tx of [-0.2, -0.02, 0.16, 0.32]) {
    const w = proj(OX, OY, tx, 0.09);
    b.rect(Math.round(w.x) - S(1), Math.round(w.y) - S(17), S(3), S(6), PAL.amberDark);
    b.set(Math.round(w.x), Math.round(w.y) - S(18), PAL.amberDark);
    b.set(Math.round(w.x), Math.round(w.y) - S(15), PAL.amber);
  }
  // long iron canopy
  const c0 = proj(OX, OY, -0.5, 0.2);
  const c1 = proj(OX, OY, 0.5, 0.2);
  const c2 = proj(OX, OY, 0.5, 0.48);
  const c3 = proj(OX, OY, -0.5, 0.48);
  const lift = S(15);
  fillPoly(
    b,
    [
      { x: c0.x, y: c0.y - lift - S(3) },
      { x: c1.x, y: c1.y - lift - S(3) },
      { x: c2.x, y: c2.y - lift + S(2) },
      { x: c3.x, y: c3.y - lift + S(2) },
    ],
    (x, y) => ((x + y) % 3 === 0 ? PAL.iron[3] : PAL.iron[1]),
  );
  for (let i = 0; i <= 3; i++) {
    const t = i / 3;
    const p = { x: c3.x + (c2.x - c3.x) * t, y: c3.y + (c2.y - c3.y) * t };
    b.rect(Math.round(p.x), Math.round(p.y) - lift + S(2), S(1), lift - S(2), PAL.iron[2]);
  }
  nameboard(b, 0.12, 0.48, S(13));
  lantern(b, 0.46, 0.42);
  lantern(b, -0.4, 0.46);
  b.outline(PAL.outline, 170);
  // paved strip under the iron canopy, shadows under the hall, the tower and the canopy
  ground(b, [
    patchRect(0.0, 0.34, 0.86, 0.2, paving(PAL.stone, 13), 13, 255, 0.06),
    shadowRect(-0.08, -0.16, 0.84, 0.5),
    shadowRect(-0.42, -0.16, 0.2, 0.22, 90),
    shadowRect(0.0, 0.34, 0.9, 0.24, 40),
  ]);
  return b;
}

/** Two-tile engine shed: gates on the ±x faces (rot 0) or the ±y faces (rot 1). */
const DW = S(176);
const DH = S(132);
const DOX = S(88);
const DOY = S(100);
function depot2(rot: number): PixelBuf {
  const b = new PixelBuf(DW, DH);
  const along = rot % 2 === 0; // shed axis along +x (gates west / east)
  const P = (tx: number, ty: number, z = 0) => proj(DOX, DOY, tx, ty, z);
  const px = (p: { x: number; y: number }) => Math.round(p.x);
  const py = (p: { x: number; y: number }) => Math.round(p.y);
  // ground: shadow and two rail pairs running through the footprint on the gate axis
  for (let ty = -1; ty <= 1; ty += 0.02)
    for (let tx = -1; tx <= 1; tx += 0.02) {
      const a = along ? tx : ty;
      const c = along ? ty : tx;
      const inShed = Math.abs(a) < 0.88 && Math.abs(c) < 0.9;
      if (inShed) continue;
      const q = P(tx, ty);
      const ballast = Math.abs(Math.abs(c) - 0.5) < 0.22;
      if (ballast) b.set(px(q), py(q), PAL.ballast[(px(q) + py(q)) % PAL.ballast.length]);
    }
  for (const lane of [-0.5, 0.5])
    for (const off of [-0.09, 0.09]) {
      const c = lane + off;
      for (const seg of [
        [-1.0, -0.85],
        [0.85, 1.0],
      ]) {
        const a0 = along ? P(seg[0], c) : P(c, seg[0]);
        const a1 = along ? P(seg[1], c) : P(c, seg[1]);
        b.line(px(a0), py(a0), px(a1), py(a1), PAL.railLight);
        b.line(px(a0), py(a0) + S(1), px(a1), py(a1) + S(1), PAL.railDark);
      }
    }
  // the shed: long brick prism with a slate roof, ridge along the gate axis
  drawPrism(b, {
    ox: DOX,
    oy: DOY,
    cx: 0,
    cy: 0,
    angle: along ? 0 : Math.PI / 2,
    len: 1.8,
    wid: 1.7,
    h: 30,
    top: PAL.roofSlate,
    side: PAL.rust.map((c) => shade(c, 0.78)),
    ridge: 12,
    roof: PAL.roofSlate,
    seed: 21,
  });
  // two arched doors on the visible gate face (+x for rot 0, +y for rot 1)
  for (const lane of [-0.5, 0.5]) {
    const d = along ? P(0.9, lane) : P(lane, 0.9);
    const dx = px(d);
    const dy = py(d);
    const sl = along ? 0.5 : -0.5;
    // limestone surround one pixel outside the opening, then the dark interior. The scan is over
    // scaled pixel rows; the arch width is computed from the base-scale row so its shape holds.
    for (let y = S(-23); y < S(1); y++) {
      const yb = y / ART_SCALE;
      const w = S(yb < -19 ? 4 + (yb + 23) : 8);
      b.line(
        dx - w,
        dy + y + Math.round(-w * sl),
        dx + w,
        dy + y + Math.round(w * sl),
        PAL.stone[1],
      );
    }
    for (let y = S(-21); y < 0; y++) {
      const yb = y / ART_SCALE;
      const w = S(yb < -18 ? 3 + (yb + 21) : 6);
      // interior: darkest at the back, a faint warm glow deep inside the shed
      const col = yb > -4 ? [22, 20, 20] : yb < -15 ? shade(PAL.iron[2], 0.5) : [30, 28, 28];
      b.line(dx - w, dy + y + Math.round(-w * sl), dx + w, dy + y + Math.round(w * sl), col as RGB);
    }
    b.set(dx, dy - S(8), PAL.amberDark);
    b.set(dx, dy - S(20), PAL.amber);
  }
  // roof vents and a brick chimney at the back corner
  for (const t of [-0.35, 0, 0.35]) {
    const v = along ? P(t, -0.2, 44) : P(-0.2, t, 44);
    b.rect(px(v) - S(2), py(v) - S(3), S(4), S(3), PAL.iron[1]);
  }
  const ch = P(-0.6, -0.6, 40);
  b.rect(px(ch) - S(2), py(ch) - S(10), S(4), S(10), PAL.rust[2]);
  b.rect(px(ch) - S(3), py(ch) - S(11), S(6), S(2), PAL.rust[0]);
  // water crane and coal stage beside the near gates
  const cr = along ? P(0.95, -0.95) : P(-0.95, 0.95);
  b.rect(px(cr) - S(1), py(cr) - S(22), S(2), S(22), PAL.iron[2]);
  b.rect(px(cr) - S(1), py(cr) - S(22), S(8), S(2), PAL.iron[1]);
  b.set(px(cr) + S(6), py(cr) - S(19), PAL.cyan);
  drawCylinder(
    b,
    DOX,
    DOY,
    along ? 0.95 : -0.95,
    along ? 0.95 : -0.95,
    0.16,
    8,
    8,
    PAL.stone,
    PAL.stone[2],
    12,
  );
  b.outline(PAL.outline, 170);
  return b;
}

/**
 * Semaphore signal: a post with a ladder, a red home arm with a white stripe pivoting at the
 * top and a yellow fishtailed distant arm below. `m` and `d` are the arm positions from 0
 * (horizontal: danger / caution) to 3 (raised 45°: clear); the in-between frames animate the
 * sweep. Lamps beside the pivots show the colour the arm means.
 */
export const SEMAPHORE_STEPS = 4;
function semaphore(m: number, d: number): PixelBuf {
  const W = S(26);
  const H = S(46);
  const b = new PixelBuf(W, H);
  const postX = S(14);
  // post, base and ladder
  b.rect(postX, S(6), S(2), S(38), PAL.iron[2]);
  b.rect(postX - S(1), S(6), S(4), S(2), PAL.iron[1]);
  b.rect(postX - S(2), S(42), S(6), S(3), PAL.iron[0]);
  for (let y = S(12); y < S(42); y += S(3)) b.rect(postX + S(3), y, S(3), S(1), PAL.iron[3]);
  b.rect(postX + S(3), S(10), S(1), S(32), PAL.iron[1]);
  b.rect(postX + S(5), S(10), S(1), S(32), PAL.iron[1]);
  const arm = (
    px: number,
    py: number,
    angle: number,
    len: number,
    col: RGB,
    dark: RGB,
    fishtail: boolean,
  ) => {
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    for (let i = 0; i <= len; i++) {
      const x = Math.round(px - ca * i);
      const y = Math.round(py - sa * i);
      // white stripe near the tip
      const stripe = i >= len - S(4) && i <= len - S(2);
      const c: RGB = stripe ? PAL.white : col;
      b.set(x, y, c);
      b.set(x, y + S(1), stripe ? [190, 190, 184] : dark);
      if (fishtail && i === len) {
        b.set(x, y, PAL.outline);
      }
    }
    // pivot bolt
    b.set(px, py, PAL.iron[3]);
  };
  const up = (i: number) => (Math.PI / 4) * (i / (SEMAPHORE_STEPS - 1));
  // home arm: red, raises 45° for clear
  arm(postX, S(8), up(m), S(12), PAL.red, [110, 36, 30], false);
  // distant arm: yellow fishtail, drops 45° for clear
  arm(postX, S(24), -up(d), S(11), PAL.amber, [140, 96, 30], true);
  // lamps: colour they currently show
  const homeClear = m >= SEMAPHORE_STEPS - 1;
  const distClear = d >= SEMAPHORE_STEPS - 1;
  b.rect(postX + S(2), S(7), S(3), S(3), homeClear ? PAL.cyan : PAL.red);
  b.set(postX + S(3), S(8), homeClear ? [190, 240, 250] : [230, 120, 100]);
  b.rect(postX + S(2), S(23), S(3), S(3), distClear ? PAL.cyan : PAL.amber);
  b.set(postX + S(3), S(24), distClear ? [190, 240, 250] : [240, 200, 120]);
  b.outline(PAL.outline, 170);
  return b;
}
/**
 * Electrification overlay for one track tile: a live rail beside the track, or a mast at the
 * tile edge with a wire across the tile. `axis` is the track direction on the tile.
 */
function supplyOverlay(
  kind: 'third_rail' | 'catenary' | 'hv_catenary',
  axis: 'ns' | 'ew' | 'x',
): PixelBuf {
  const b = new PixelBuf(W, H);
  const dir = axis === 'ns' ? { x: 0, y: 1 } : { x: 1, y: 0 };
  const side = axis === 'ns' ? { x: 1, y: 0 } : { x: 0, y: 1 };
  if (kind === 'third_rail') {
    const a = proj(OX, OY, -0.5 * dir.x + 0.25 * side.x, -0.5 * dir.y + 0.25 * side.y);
    const c = proj(OX, OY, 0.5 * dir.x + 0.25 * side.x, 0.5 * dir.y + 0.25 * side.y);
    b.line(Math.round(a.x), Math.round(a.y), Math.round(c.x), Math.round(c.y), [200, 190, 120]);
    b.line(
      Math.round(a.x),
      Math.round(a.y) + S(1),
      Math.round(c.x),
      Math.round(c.y) + S(1),
      [120, 110, 60],
    );
    if (axis === 'x') {
      const a2 = proj(OX, OY, 0.25, -0.5);
      const c2 = proj(OX, OY, 0.25, 0.5);
      b.line(
        Math.round(a2.x),
        Math.round(a2.y),
        Math.round(c2.x),
        Math.round(c2.y),
        [200, 190, 120],
      );
    }
    return b;
  }
  const hv = kind === 'hv_catenary';
  // mastH stays in base pixels: it feeds proj as a z height (proj scales it) and is scaled with
  // S() only where it is used as a raw pixel offset or size.
  const mastH = hv ? 34 : 26;
  // mast at the +side edge, bracket over the track, wire along the tile at wire height
  const m = proj(OX, OY, 0.42 * side.x, 0.42 * side.y);
  const mx = Math.round(m.x);
  const my = Math.round(m.y);
  b.rect(mx - S(1), my - S(mastH), hv ? S(3) : S(2), S(mastH), PAL.iron[1]);
  b.rect(mx - S(2), my - S(1), hv ? S(5) : S(4), S(2), PAL.iron[0]);
  const over = proj(OX, OY, 0, 0, mastH - 4);
  b.line(mx, my - S(mastH) + S(3), Math.round(over.x), Math.round(over.y), PAL.iron[2]);
  const wireZ = mastH - 6;
  const a = proj(OX, OY, -0.5 * dir.x, -0.5 * dir.y, wireZ);
  const c = proj(OX, OY, 0.5 * dir.x, 0.5 * dir.y, wireZ);
  b.line(Math.round(a.x), Math.round(a.y), Math.round(c.x), Math.round(c.y), [190, 170, 120]);
  if (hv)
    b.line(
      Math.round(a.x),
      Math.round(a.y) - S(2),
      Math.round(c.x),
      Math.round(c.y) - S(2),
      [190, 170, 120],
    );
  if (axis === 'x') {
    const a2 = proj(OX, OY, 0, -0.5, wireZ);
    const c2 = proj(OX, OY, 0, 0.5, wireZ);
    b.line(Math.round(a2.x), Math.round(a2.y), Math.round(c2.x), Math.round(c2.y), [190, 170, 120]);
  }
  // insulator
  b.set(Math.round(over.x), Math.round(over.y) + S(1), PAL.white);
  b.outline(PAL.outline, 150);
  return b;
}
/** Frame name for a pair of arm positions. */
export function semaphoreFrame(m: number, d: number) {
  return `structures/semaphore_m${m}_d${d}`;
}

/** Wooden water tower on a trestle with an iron band. */
function waterTower(): PixelBuf {
  const b = new PixelBuf(W, H);
  for (const [lx, ly] of [
    [-0.16, -0.16],
    [0.16, -0.16],
    [0.16, 0.16],
    [-0.16, 0.16],
  ]) {
    const p = proj(OX, OY, lx, ly);
    b.rect(Math.round(p.x) - S(1), Math.round(p.y) - S(22), S(2), S(22), PAL.timber[2]);
  }
  drawCylinder(b, OX, OY, 0, 0, 0.19, 22, 18, PAL.timber, PAL.timber[2], 33);
  const band = proj(OX, OY, 0, 0);
  for (let x = -S(12); x <= S(12); x++) {
    const xb = x / ART_SCALE;
    const y =
      Math.round(band.y) - S(30) + S(Math.round(Math.sqrt(Math.max(0, 1 - (xb / 12) ** 2)) * 6));
    b.set(Math.round(band.x) + x, y, PAL.iron[1]);
  }
  const top = proj(OX, OY, 0, 0, 40);
  for (let r = S(12); r >= 0; r--) {
    const y = Math.round(top.y) - (S(12) - r);
    for (let x = -r; x <= r; x++) b.set(Math.round(top.x) + x, y, PAL.roofSlate[(x + r) % 3]);
  }
  const sp = proj(OX, OY, 0.22, 0.05);
  b.rect(Math.round(sp.x) - S(2), Math.round(sp.y) - S(26), S(5), S(2), PAL.iron[2]);
  b.rect(Math.round(sp.x) + S(2), Math.round(sp.y) - S(26), S(2), S(6), PAL.iron[2]);
  b.outline(PAL.outline, 170);
  return b;
}

/** Amber "!" marker shown over stations that lost their platform track. */
function warnMarker(color: RGB = PAL.amber, shape: 'triangle' | 'disc' = 'triangle'): PixelBuf {
  const b = new PixelBuf(S(14), S(16));
  if (shape === 'triangle') {
    for (let y = 0; y < S(14); y++) {
      const yb = y / ART_SCALE;
      const hw = S(Math.round((yb / 13) * 6));
      for (let x = S(7) - hw; x <= S(7) + hw - S(1); x++) b.set(x, y + S(1), color);
    }
  } else b.ellipse(S(7), S(8), S(6), S(6), [color, shade(color, 0.85)], 3, 0.3);
  b.rect(S(6), S(4), S(2), S(6), PAL.outline);
  b.rect(S(6), S(11), S(2), S(2), PAL.outline);
  b.outline(PAL.outline, 220);
  return b;
}

/**
 * Station upgrades: a longer canopy, better frontage and more platform furniture. Stations grow
 * as passenger buildings, so they never take the works' industrial annex.
 */
function upgradedStation(base: PixelBuf, level: number): PixelBuf {
  const b = new PixelBuf(S(96), S(184));
  b.blit(base, 0, CIVIC_OY - S(68));
  const P = (tx: number, ty: number, z = 0) => proj(CIVIC_OX, CIVIC_OY, tx, ty, z);
  // extra canopy bay beyond the -x end of the hall, on slender iron columns
  const lift = S(15);
  const k0 = P(-0.5, 0.2);
  const k1 = P(-0.5, 0.48);
  const k2 = P(-0.26, 0.48);
  const k3 = P(-0.26, 0.2);
  fillPoly(
    b,
    [
      { x: k0.x, y: k0.y - lift - S(3) },
      { x: k3.x, y: k3.y - lift - S(3) },
      { x: k2.x, y: k2.y - lift + S(2) },
      { x: k1.x, y: k1.y - lift + S(2) },
    ],
    (x, y) => ((x + y) % 3 === 0 ? PAL.iron[3] : PAL.iron[1]),
  );
  for (const p of [k1, k2])
    b.rect(Math.round(p.x), Math.round(p.y) - lift + S(2), S(1), lift - S(2), PAL.iron[2]);
  // platform edge: a pale kerb line along the front of the whole platform
  const e0 = P(-0.5, 0.5);
  const e1 = P(0.5, 0.5);
  b.line(Math.round(e0.x), Math.round(e0.y), Math.round(e1.x), Math.round(e1.y), PAL.stone[1]);
  b.line(
    Math.round(e0.x),
    Math.round(e0.y) + S(1),
    Math.round(e1.x),
    Math.round(e1.y) + S(1),
    PAL.stone[2],
  );
  // benches and a luggage trolley under the new bay
  for (const [bx, by] of [
    [-0.42, 0.34],
    [-0.3, 0.42],
  ]) {
    const p = P(bx, by);
    b.rect(Math.round(p.x) - S(4), Math.round(p.y) - S(4), S(9), S(2), PAL.timber[1]);
    b.rect(Math.round(p.x) - S(4), Math.round(p.y) - S(2), S(1), S(2), PAL.timber[2]);
    b.rect(Math.round(p.x) + S(4), Math.round(p.y) - S(2), S(1), S(2), PAL.timber[2]);
  }
  const tr = P(-0.18, 0.4);
  b.rect(Math.round(tr.x) - S(4), Math.round(tr.y) - S(5), S(8), S(4), PAL.timber[0]);
  b.rect(Math.round(tr.x) - S(4), Math.round(tr.y) - S(6), S(8), S(1), PAL.timber[1]);
  b.set(Math.round(tr.x) - S(3), Math.round(tr.y) - S(1), PAL.iron[2]);
  b.set(Math.round(tr.x) + S(3), Math.round(tr.y) - S(1), PAL.iron[2]);
  if (level >= 4) {
    // parcels office at the far end: cream walls, slate roof, one lit window
    drawPrism(b, {
      ox: CIVIC_OX,
      oy: CIVIC_OY,
      cx: -0.34,
      cy: -0.3,
      angle: 0,
      len: 0.26,
      wid: 0.22,
      h: 16,
      top: PAL.roofSlate,
      side: PAL.stone,
      ridge: 6,
      roof: PAL.roofSlate,
      seed: 41,
    });
    const w = P(-0.34, -0.19);
    b.rect(Math.round(w.x) - S(1), Math.round(w.y) - S(10), S(3), S(4), PAL.amberDark);
    b.set(Math.round(w.x), Math.round(w.y) - S(9), PAL.amber);
  }
  b.outline(PAL.outline, 170);
  return b;
}

export function generateStructuresAtlas(): AtlasImage {
  const ab = new AtlasBuilder();
  addBridgeFrames(ab);
  ab.add('structures/station_1', stationL1().toImageData(), OX, OY);
  ab.add('structures/station_2', stationL2().toImageData(), OX, OY);
  ab.add('structures/station_3', stationL3().toImageData(), OX, OY);
  for (let l = 4; l <= 5; l++)
    ab.add(
      `structures/station_${l}`,
      upgradedStation(stationL3(), l - 1).toImageData(),
      CIVIC_OX,
      CIVIC_OY,
    );
  for (const r of [0, 1]) {
    ab.add(`structures/depot_r${r}`, depot2(r).toImageData(), DOX, DOY);
    for (let l = 2; l <= 5; l++) {
      const b = depot2(r);
      for (let i = 0; i < l - 1; i++) {
        const x = DOX - S(18) + i * S(10),
          y = DOY - S(32) - i * S(2);
        b.rect(x, y, S(5), S(8), PAL.iron[1]);
        b.rect(x - S(1), y - S(2), S(7), S(3), PAL.iron[0]);
      }
      ab.add(`structures/depot_r${r}_lv${l}`, b.toImageData(), DOX, DOY);
    }
  }
  ab.add('structures/depot_1', depot2(0).toImageData(), DOX, DOY);
  for (const k of ['third_rail', 'catenary', 'hv_catenary'] as const)
    for (const ax of ['ns', 'ew', 'x'] as const)
      ab.add(`structures/supply_${k}_${ax}`, supplyOverlay(k, ax).toImageData(), OX, OY);
  for (let m = 0; m < SEMAPHORE_STEPS; m++)
    for (let d = 0; d < SEMAPHORE_STEPS; d++)
      ab.add(semaphoreFrame(m, d), semaphore(m, d).toImageData(), S(15), S(44));
  // the old names stay valid for the toolbar preview and old callers
  ab.add('structures/signal', semaphore(0, 0).toImageData(), S(15), S(44));
  ab.add('structures/signal_red', semaphore(0, 0).toImageData(), S(15), S(44));
  ab.add('structures/signal_green', semaphore(3, 3).toImageData(), S(15), S(44));
  ab.add('structures/water_tower', waterTower().toImageData(), OX, OY);
  ab.add('structures/warn', warnMarker().toImageData(), S(7), S(15));
  ab.add('structures/alert', warnMarker(PAL.red, 'disc').toImageData(), S(7), S(15));
  ab.add('structures/note', warnMarker(PAL.cyanDark, 'disc').toImageData(), S(7), S(15));
  for (const [fam, gen] of Object.entries(STATION_FAMILIES))
    for (let l = 1; l <= 5; l++) {
      if (l <= 3) ab.add(`structures/${fam}_${l}`, gen(l).toImageData(), OX, OY);
      else
        ab.add(
          `structures/${fam}_${l}`,
          upgradedWorks(gen(3), l - 1).toImageData(),
          CIVIC_OX,
          CIVIC_OY,
        );
    }
  for (const [id, gen] of Object.entries(BUILDING_SPRITES)) {
    ab.add(`structures/${id}`, gen().toImageData(), OX, OY);
    for (let l = 2; l <= 4; l++)
      ab.add(`structures/${id}_lv${l}`, upgradedWorks(gen(), l).toImageData(), CIVIC_OX, CIVIC_OY);
  }
  for (let l = 1; l <= 4; l++)
    ab.add(
      `structures/windmill${l > 1 ? '_lv' + l : ''}`,
      windmill(l).toImageData(),
      CIVIC_OX,
      CIVIC_OY,
    );
  for (const [id, gen] of Object.entries(DECOR_SPRITES))
    if (id !== 'townhouse') ab.add(`structures/${id}`, gen().toImageData(), OX, OY);
  for (const [id, gen] of Object.entries(HOUSE_SPRITES))
    if (id.includes('_s')) ab.add(`structures/${id}`, gen().toImageData(), OX, OY);
  for (let l = 1; l <= 4; l++)
    ab.add(
      `structures/townhouse${l > 1 ? '_' + l : ''}`,
      residence(l).toImageData(),
      CIVIC_OX,
      CIVIC_OY,
    );
  ab.add('structures/power_line', powerLine().toImageData(), S(8), S(35));
  return ab.build(4096);
}
