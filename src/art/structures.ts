import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import { PAL, shade, type RGB } from './palette';
import { PixelBuf } from './pixels';
import { drawPrism, drawCylinder, proj, fillPoly } from './iso3d';
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

const W = 96;
const H = 84;
const OX = 48;
const OY = 68;

function lantern(b: PixelBuf, tx: number, ty: number) {
  const p = proj(OX, OY, tx, ty);
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  b.rect(x, y - 14, 1, 14, PAL.iron[2]);
  b.rect(x - 1, y - 17, 3, 3, PAL.iron[0]);
  b.set(x, y - 16, PAL.amber);
  b.set(x - 1, y - 18, PAL.iron[1]);
  b.set(x, y - 18, PAL.iron[1]);
  b.set(x + 1, y - 18, PAL.iron[1]);
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
  b.rect(Math.round(d.x) - 1, Math.round(d.y) - 9, 3, 8, PAL.trunkDark);
  const w = proj(OX, OY, -0.25, 0.07);
  b.rect(Math.round(w.x) - 1, Math.round(w.y) - 10, 3, 3, PAL.amberDark);
  // bench + lantern on the front
  lantern(b, 0.32, 0.3);
  const bench = proj(OX, OY, 0.05, 0.36);
  b.rect(Math.round(bench.x) - 5, Math.round(bench.y) - 4, 10, 2, PAL.timber[1]);
  b.rect(Math.round(bench.x) - 5, Math.round(bench.y) - 2, 1, 2, PAL.timber[2]);
  b.rect(Math.round(bench.x) + 4, Math.round(bench.y) - 2, 1, 2, PAL.timber[2]);
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
    b.rect(Math.round(w.x) - 1, Math.round(w.y) - 14, 3, 4, PAL.amberDark);
    b.set(Math.round(w.x), Math.round(w.y) - 13, PAL.amber);
  }
  const d = proj(OX, OY, 0.2, 0.09);
  b.rect(Math.round(d.x) - 2, Math.round(d.y) - 10, 4, 9, PAL.trunkDark);
  // canopy along the front edge
  const c0 = proj(OX, OY, -0.44, 0.22);
  const c1 = proj(OX, OY, 0.36, 0.22);
  const c2 = proj(OX, OY, 0.36, 0.42);
  const c3 = proj(OX, OY, -0.44, 0.42);
  const lift = 13;
  fillPoly(
    b,
    [
      { x: c0.x, y: c0.y - lift - 2 },
      { x: c1.x, y: c1.y - lift - 2 },
      { x: c2.x, y: c2.y - lift + 2 },
      { x: c3.x, y: c3.y - lift + 2 },
    ],
    (x, y) => ((x + y) % 2 === 0 ? PAL.roofSlate[1] : PAL.roofSlate[0]),
  );
  for (const p of [c2, c3, { x: (c2.x + c3.x) / 2, y: (c2.y + c3.y) / 2 }])
    b.rect(Math.round(p.x), Math.round(p.y) - lift + 2, 1, lift - 2, PAL.iron[2]);
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
  // clock tower at the left end
  drawPrism(b, {
    ox: OX,
    oy: OY,
    cx: -0.42,
    cy: -0.16,
    angle: 0,
    len: 0.2,
    wid: 0.22,
    h: 44,
    top: PAL.roofSlate,
    side: PAL.stone,
    ridge: 8,
    roof: PAL.roofSlate,
    seed: 8,
  });
  const clock = proj(OX, OY, -0.42, 0.0);
  b.rect(Math.round(clock.x) - 2, Math.round(clock.y) - 37, 5, 5, PAL.white);
  b.set(Math.round(clock.x), Math.round(clock.y) - 35, PAL.outline);
  b.set(Math.round(clock.x), Math.round(clock.y) - 36, PAL.outline);
  b.set(Math.round(clock.x) + 1, Math.round(clock.y) - 35, PAL.outline);
  // arched windows
  for (const tx of [-0.2, -0.02, 0.16, 0.32]) {
    const w = proj(OX, OY, tx, 0.09);
    b.rect(Math.round(w.x) - 1, Math.round(w.y) - 17, 3, 6, PAL.amberDark);
    b.set(Math.round(w.x), Math.round(w.y) - 18, PAL.amberDark);
    b.set(Math.round(w.x), Math.round(w.y) - 15, PAL.amber);
  }
  // long iron canopy
  const c0 = proj(OX, OY, -0.5, 0.2);
  const c1 = proj(OX, OY, 0.5, 0.2);
  const c2 = proj(OX, OY, 0.5, 0.48);
  const c3 = proj(OX, OY, -0.5, 0.48);
  const lift = 15;
  fillPoly(
    b,
    [
      { x: c0.x, y: c0.y - lift - 3 },
      { x: c1.x, y: c1.y - lift - 3 },
      { x: c2.x, y: c2.y - lift + 2 },
      { x: c3.x, y: c3.y - lift + 2 },
    ],
    (x, y) => ((x + y) % 3 === 0 ? PAL.iron[3] : PAL.iron[1]),
  );
  for (let i = 0; i <= 3; i++) {
    const t = i / 3;
    const p = { x: c3.x + (c2.x - c3.x) * t, y: c3.y + (c2.y - c3.y) * t };
    b.rect(Math.round(p.x), Math.round(p.y) - lift + 2, 1, lift - 2, PAL.iron[2]);
  }
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
const DW = 176;
const DH = 132;
const DOX = 88;
const DOY = 100;
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
        b.line(px(a0), py(a0) + 1, px(a1), py(a1) + 1, PAL.railDark);
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
    for (let y = -18; y < 0; y++) {
      const w = y < -15 ? 3 + (y + 18) : 5;
      const col = y > -3 ? PAL.outline : shade(PAL.iron[0], 0.65);
      // door face follows the wall slope: +x face rises to the right, +y face to the left
      const sl = along ? 0.5 : -0.5;
      b.line(dx - w, dy + y + Math.round(-w * sl), dx + w, dy + y + Math.round(w * sl), col);
    }
    b.set(dx, dy - 17, PAL.amber);
  }
  // roof vents and a brick chimney at the back corner
  for (const t of [-0.35, 0, 0.35]) {
    const v = along ? P(t, -0.2, 44) : P(-0.2, t, 44);
    b.rect(px(v) - 2, py(v) - 3, 4, 3, PAL.iron[1]);
  }
  const ch = P(-0.6, -0.6, 40);
  b.rect(px(ch) - 2, py(ch) - 10, 4, 10, PAL.rust[2]);
  b.rect(px(ch) - 3, py(ch) - 11, 6, 2, PAL.rust[0]);
  // water crane and coal stage beside the near gates
  const cr = along ? P(0.95, -0.95) : P(-0.95, 0.95);
  b.rect(px(cr) - 1, py(cr) - 22, 2, 22, PAL.iron[2]);
  b.rect(px(cr) - 1, py(cr) - 22, 8, 2, PAL.iron[1]);
  b.set(px(cr) + 6, py(cr) - 19, PAL.cyan);
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
  const W = 26;
  const H = 46;
  const b = new PixelBuf(W, H);
  const postX = 14;
  // post, base and ladder
  b.rect(postX, 6, 2, 38, PAL.iron[2]);
  b.rect(postX - 1, 6, 4, 2, PAL.iron[1]);
  b.rect(postX - 2, 42, 6, 3, PAL.iron[0]);
  for (let y = 12; y < 42; y += 3) b.rect(postX + 3, y, 3, 1, PAL.iron[3]);
  b.rect(postX + 3, 10, 1, 32, PAL.iron[1]);
  b.rect(postX + 5, 10, 1, 32, PAL.iron[1]);
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
      const stripe = i >= len - 4 && i <= len - 2;
      const c: RGB = stripe ? PAL.white : col;
      b.set(x, y, c);
      b.set(x, y + 1, stripe ? [190, 190, 184] : dark);
      if (fishtail && i === len) {
        b.set(x, y, PAL.outline);
      }
    }
    // pivot bolt
    b.set(px, py, PAL.iron[3]);
  };
  const up = (i: number) => (Math.PI / 4) * (i / (SEMAPHORE_STEPS - 1));
  // home arm: red, raises 45° for clear
  arm(postX, 8, up(m), 12, PAL.red, [110, 36, 30], false);
  // distant arm: yellow fishtail, drops 45° for clear
  arm(postX, 24, -up(d), 11, PAL.amber, [140, 96, 30], true);
  // lamps: colour they currently show
  const homeClear = m >= SEMAPHORE_STEPS - 1;
  const distClear = d >= SEMAPHORE_STEPS - 1;
  b.rect(postX + 2, 7, 3, 3, homeClear ? PAL.cyan : PAL.red);
  b.set(postX + 3, 8, homeClear ? [190, 240, 250] : [230, 120, 100]);
  b.rect(postX + 2, 23, 3, 3, distClear ? PAL.cyan : PAL.amber);
  b.set(postX + 3, 24, distClear ? [190, 240, 250] : [240, 200, 120]);
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
      Math.round(a.y) + 1,
      Math.round(c.x),
      Math.round(c.y) + 1,
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
  const mastH = hv ? 34 : 26;
  // mast at the +side edge, bracket over the track, wire along the tile at wire height
  const m = proj(OX, OY, 0.42 * side.x, 0.42 * side.y);
  const mx = Math.round(m.x);
  const my = Math.round(m.y);
  b.rect(mx - 1, my - mastH, hv ? 3 : 2, mastH, PAL.iron[1]);
  b.rect(mx - 2, my - 1, hv ? 5 : 4, 2, PAL.iron[0]);
  const over = proj(OX, OY, 0, 0, mastH - 4);
  b.line(mx, my - mastH + 3, Math.round(over.x), Math.round(over.y), PAL.iron[2]);
  const wireZ = mastH - 6;
  const a = proj(OX, OY, -0.5 * dir.x, -0.5 * dir.y, wireZ);
  const c = proj(OX, OY, 0.5 * dir.x, 0.5 * dir.y, wireZ);
  b.line(Math.round(a.x), Math.round(a.y), Math.round(c.x), Math.round(c.y), [190, 170, 120]);
  if (hv)
    b.line(
      Math.round(a.x),
      Math.round(a.y) - 2,
      Math.round(c.x),
      Math.round(c.y) - 2,
      [190, 170, 120],
    );
  if (axis === 'x') {
    const a2 = proj(OX, OY, 0, -0.5, wireZ);
    const c2 = proj(OX, OY, 0, 0.5, wireZ);
    b.line(Math.round(a2.x), Math.round(a2.y), Math.round(c2.x), Math.round(c2.y), [190, 170, 120]);
  }
  // insulator
  b.set(Math.round(over.x), Math.round(over.y) + 1, PAL.white);
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
    b.rect(Math.round(p.x) - 1, Math.round(p.y) - 22, 2, 22, PAL.timber[2]);
  }
  drawCylinder(b, OX, OY, 0, 0, 0.19, 22, 18, PAL.timber, PAL.timber[2], 33);
  const band = proj(OX, OY, 0, 0);
  for (let x = -12; x <= 12; x++) {
    const y = Math.round(band.y) - 30 + Math.round(Math.sqrt(Math.max(0, 1 - (x / 12) ** 2)) * 6);
    b.set(Math.round(band.x) + x, y, PAL.iron[1]);
  }
  const top = proj(OX, OY, 0, 0, 40);
  for (let r = 12; r >= 0; r--) {
    const y = Math.round(top.y) - (12 - r);
    for (let x = -r; x <= r; x++) b.set(Math.round(top.x) + x, y, PAL.roofSlate[(x + r) % 3]);
  }
  const sp = proj(OX, OY, 0.22, 0.05);
  b.rect(Math.round(sp.x) - 2, Math.round(sp.y) - 26, 5, 2, PAL.iron[2]);
  b.rect(Math.round(sp.x) + 2, Math.round(sp.y) - 26, 2, 6, PAL.iron[2]);
  b.outline(PAL.outline, 170);
  return b;
}

/** Amber "!" marker shown over stations that lost their platform track. */
function warnMarker(color: RGB = PAL.amber, shape: 'triangle' | 'disc' = 'triangle'): PixelBuf {
  const b = new PixelBuf(14, 16);
  if (shape === 'triangle') {
    for (let y = 0; y < 14; y++) {
      const hw = Math.round((y / 13) * 6);
      for (let x = 7 - hw; x <= 7 + hw - 1; x++) b.set(x, y + 1, color);
    }
  } else b.ellipse(7, 8, 6, 6, [color, shade(color, 0.85)], 3, 0.3);
  b.rect(6, 4, 2, 6, PAL.outline);
  b.rect(6, 11, 2, 2, PAL.outline);
  b.outline(PAL.outline, 220);
  return b;
}

export function generateStructuresAtlas(): AtlasImage {
  const ab = new AtlasBuilder();
  ab.add('structures/station_1', stationL1().toImageData(), OX, OY);
  ab.add('structures/station_2', stationL2().toImageData(), OX, OY);
  ab.add('structures/station_3', stationL3().toImageData(), OX, OY);
  for (const r of [0, 1]) ab.add(`structures/depot_r${r}`, depot2(r).toImageData(), DOX, DOY);
  ab.add('structures/depot_1', depot2(0).toImageData(), DOX, DOY);
  for (const k of ['third_rail', 'catenary', 'hv_catenary'] as const)
    for (const ax of ['ns', 'ew', 'x'] as const)
      ab.add(`structures/supply_${k}_${ax}`, supplyOverlay(k, ax).toImageData(), OX, OY);
  for (let m = 0; m < SEMAPHORE_STEPS; m++)
    for (let d = 0; d < SEMAPHORE_STEPS; d++)
      ab.add(semaphoreFrame(m, d), semaphore(m, d).toImageData(), 15, 44);
  // the old names stay valid for the toolbar preview and old callers
  ab.add('structures/signal', semaphore(0, 0).toImageData(), 15, 44);
  ab.add('structures/signal_red', semaphore(0, 0).toImageData(), 15, 44);
  ab.add('structures/signal_green', semaphore(3, 3).toImageData(), 15, 44);
  ab.add('structures/water_tower', waterTower().toImageData(), OX, OY);
  ab.add('structures/warn', warnMarker().toImageData(), 7, 15);
  ab.add('structures/alert', warnMarker(PAL.red, 'disc').toImageData(), 7, 15);
  ab.add('structures/note', warnMarker(PAL.cyanDark, 'disc').toImageData(), 7, 15);
  for (const [fam, gen] of Object.entries(STATION_FAMILIES))
    for (let l = 1; l <= 3; l++) ab.add(`structures/${fam}_${l}`, gen(l).toImageData(), OX, OY);
  for (const [id, gen] of Object.entries(BUILDING_SPRITES))
    ab.add(`structures/${id}`, gen().toImageData(), OX, OY);
  for (const [id, gen] of Object.entries(DECOR_SPRITES))
    ab.add(`structures/${id}`, gen().toImageData(), OX, OY);
  for (const [id, gen] of Object.entries(HOUSE_SPRITES))
    ab.add(`structures/${id}`, gen().toImageData(), OX, OY);
  ab.add('structures/power_line', powerLine().toImageData(), 8, 35);
  return ab.build(1024);
}
