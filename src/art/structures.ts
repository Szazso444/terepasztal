import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import { PAL, shade, type RGB } from './palette';
import { PixelBuf } from './pixels';
import { drawPrism, drawCylinder, proj, fillPoly } from './iso3d';
import { hash2 } from '../engine/rng';

const W = 96;
const H = 84;
const OX = 48;
const OY = 68;

/** Flat stone platform slab covering most of the tile. */
function platform(b: PixelBuf, seed: number, lenX = 0.94, lenY = 0.94) {
  const pts = [
    proj(OX, OY, -lenX / 2, -lenY / 2),
    proj(OX, OY, lenX / 2, -lenY / 2),
    proj(OX, OY, lenX / 2, lenY / 2),
    proj(OX, OY, -lenX / 2, lenY / 2),
  ];
  // raised edge: draw slab 3px tall
  const lift = pts.map((p) => ({ x: p.x, y: p.y - 3 }));
  fillPoly(b, pts, (x, y) => shade(PAL.stone[2], 0.8 + 0.1 * hash2(x, y, seed)));
  fillPoly(b, lift, (x, y) => {
    const n = hash2(x >> 1, y >> 1, seed + 1);
    const c = PAL.stone[Math.min(2, Math.floor(n * 3))];
    // paving lines
    return (x + 2 * y) % 8 === 0 ? shade(c, 0.85) : c;
  });
}

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
  platform(b, 11);
  // timber shed at the back corner
  drawPrism(b, {
    ox: OX,
    oy: OY - 3,
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
  const d = proj(OX, OY - 3, 0.05, 0.07);
  b.rect(Math.round(d.x) - 1, Math.round(d.y) - 9, 3, 8, PAL.trunkDark);
  const w = proj(OX, OY - 3, -0.25, 0.07);
  b.rect(Math.round(w.x) - 1, Math.round(w.y) - 10, 3, 3, PAL.amberDark);
  // bench + lantern on the front
  lantern(b, 0.32, 0.3);
  const bench = proj(OX, OY - 3, 0.05, 0.36);
  b.rect(Math.round(bench.x) - 5, Math.round(bench.y) - 4, 10, 2, PAL.timber[1]);
  b.rect(Math.round(bench.x) - 5, Math.round(bench.y) - 2, 1, 2, PAL.timber[2]);
  b.rect(Math.round(bench.x) + 4, Math.round(bench.y) - 2, 1, 2, PAL.timber[2]);
  b.outline(PAL.outline, 170);
  return b;
}

function stationL2(): PixelBuf {
  const b = new PixelBuf(W, H);
  platform(b, 12);
  // stone building with slate roof
  drawPrism(b, {
    ox: OX,
    oy: OY - 3,
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
  drawCylinder(b, OX, OY - 3, -0.32, -0.28, 0.05, 30, 8, PAL.stone, PAL.stone[2], 6);
  // windows row on +y face
  for (const tx of [-0.32, -0.1, 0.12]) {
    const w = proj(OX, OY - 3, tx, 0.09);
    b.rect(Math.round(w.x) - 1, Math.round(w.y) - 14, 3, 4, PAL.amberDark);
    b.set(Math.round(w.x), Math.round(w.y) - 13, PAL.amber);
  }
  const d = proj(OX, OY - 3, 0.2, 0.09);
  b.rect(Math.round(d.x) - 2, Math.round(d.y) - 10, 4, 9, PAL.trunkDark);
  // canopy along the front edge
  const c0 = proj(OX, OY - 3, -0.44, 0.22);
  const c1 = proj(OX, OY - 3, 0.36, 0.22);
  const c2 = proj(OX, OY - 3, 0.36, 0.42);
  const c3 = proj(OX, OY - 3, -0.44, 0.42);
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
  return b;
}

function stationL3(): PixelBuf {
  const b = new PixelBuf(W, H);
  platform(b, 13, 1, 1);
  // main hall
  drawPrism(b, {
    ox: OX,
    oy: OY - 3,
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
    oy: OY - 3,
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
  const clock = proj(OX, OY - 3, -0.42, 0.0);
  b.rect(Math.round(clock.x) - 2, Math.round(clock.y) - 37, 5, 5, PAL.white);
  b.set(Math.round(clock.x), Math.round(clock.y) - 35, PAL.outline);
  b.set(Math.round(clock.x), Math.round(clock.y) - 36, PAL.outline);
  b.set(Math.round(clock.x) + 1, Math.round(clock.y) - 35, PAL.outline);
  // arched windows
  for (const tx of [-0.2, -0.02, 0.16, 0.32]) {
    const w = proj(OX, OY - 3, tx, 0.09);
    b.rect(Math.round(w.x) - 1, Math.round(w.y) - 17, 3, 6, PAL.amberDark);
    b.set(Math.round(w.x), Math.round(w.y) - 18, PAL.amberDark);
    b.set(Math.round(w.x), Math.round(w.y) - 15, PAL.amber);
  }
  // long iron canopy
  const c0 = proj(OX, OY - 3, -0.5, 0.2);
  const c1 = proj(OX, OY - 3, 0.5, 0.2);
  const c2 = proj(OX, OY - 3, 0.5, 0.48);
  const c3 = proj(OX, OY - 3, -0.5, 0.48);
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
  return b;
}

function depot(): PixelBuf {
  const b = new PixelBuf(W, H);
  platform(b, 21, 0.96, 0.96);
  // engine shed: long brick prism with a wide arch door on the +x face
  drawPrism(b, {
    ox: OX,
    oy: OY - 3,
    cx: 0,
    cy: 0,
    angle: 0,
    len: 0.9,
    wid: 0.62,
    h: 24,
    top: PAL.roofSlate,
    side: PAL.rust.map((c) => shade(c, 0.75)),
    ridge: 8,
    roof: PAL.roofSlate,
    seed: 9,
  });
  const door = proj(OX, OY - 3, 0.45, 0);
  const dx = Math.round(door.x);
  const dy = Math.round(door.y);
  for (let y = -16; y < 0; y++)
    b.line(dx - 4, dy + y - 2, dx + 4, dy + y + 2, y > -3 ? PAL.outline : shade(PAL.iron[0], 0.8));
  drawCylinder(b, OX, OY - 3, -0.3, -0.2, 0.05, 30, 10, PAL.stone, PAL.stone[2], 10);
  b.outline(PAL.outline, 170);
  return b;
}

/** Semaphore post; `aspect` picks which lamp is lit. */
function signal(aspect: 'red' | 'green' | 'off'): PixelBuf {
  const b = new PixelBuf(12, 28);
  b.rect(5, 8, 2, 20, PAL.iron[2]);
  b.rect(4, 26, 4, 2, PAL.iron[0]);
  b.rect(2, 2, 8, 7, PAL.iron[0]);
  b.rect(3, 3, 6, 5, PAL.iron[1]);
  const dim: RGB = [60, 40, 40];
  const dimG: RGB = [36, 60, 60];
  b.rect(3, 4, 2, 3, aspect === 'red' ? PAL.red : dim);
  b.rect(7, 4, 2, 3, aspect === 'green' ? PAL.cyan : dimG);
  if (aspect === 'red') b.set(3, 4, [230, 120, 100]);
  if (aspect === 'green') b.set(7, 4, [190, 240, 250]);
  b.outline(PAL.outline, 170);
  return b;
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
function warnMarker(): PixelBuf {
  const b = new PixelBuf(14, 16);
  for (let y = 0; y < 14; y++) {
    const hw = Math.round((y / 13) * 6);
    for (let x = 7 - hw; x <= 7 + hw - 1; x++) b.set(x, y + 1, PAL.amber);
  }
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
  ab.add('structures/depot', depot().toImageData(), OX, OY);
  ab.add('structures/signal', signal('off').toImageData(), 6, 27);
  ab.add('structures/signal_red', signal('red').toImageData(), 6, 27);
  ab.add('structures/signal_green', signal('green').toImageData(), 6, 27);
  ab.add('structures/water_tower', waterTower().toImageData(), OX, OY);
  ab.add('structures/warn', warnMarker().toImageData(), 7, 15);
  return ab.build(512);
}
