import fs from 'node:fs';
import { PNG } from 'pngjs';
import { measureBase } from '../../../../tools/building-fit.mjs';
import { pictureOf } from '../../../../tools/building-check.mjs';

// Analysis only: no returned picture is resampled or modified on disk.
const N = 256;
function fill(mask, w, h) {
  const seen = new Uint8Array(mask.length),
    q = new Int32Array(mask.length);
  let a = 0,
    b = 0;
  const add = (i) => {
    if (!mask[i] && !seen[i]) {
      seen[i] = 1;
      q[b++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    add(x);
    add((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    add(y * w);
    add(y * w + w - 1);
  }
  while (a < b) {
    const i = q[a++],
      x = i % w,
      y = Math.floor(i / w);
    if (x) add(i - 1);
    if (x < w - 1) add(i + 1);
    if (y) add(i - w);
    if (y < h - 1) add(i + w);
  }
  return Uint8Array.from(seen, (x) => 1 - x);
}
function inside(x, y, polys) {
  let yes = false;
  for (const p of polys) {
    let on = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const a = p[i],
        b = p[j];
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0])
        on = !on;
    }
    if (on) yes = true;
  }
  return yes;
}
function edge(m, w, h) {
  const a = [];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      let i = y * w + x;
      if (m[i] && (!m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w])) a.push([x, y]);
    }
  return a;
}
function opening(m, w, h, r) {
  const e = new Uint8Array(m.length),
    d = new Uint8Array(m.length),
    off = [];
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) off.push([x, y]);
  for (let y = r; y < h - r; y++)
    for (let x = r; x < w - r; x++) {
      let ok = true;
      for (const [dx, dy] of off)
        if (!m[(y + dy) * w + x + dx]) {
          ok = false;
          break;
        }
      e[y * w + x] = +ok;
    }
  for (let y = r; y < h - r; y++)
    for (let x = r; x < w - r; x++)
      if (e[y * w + x]) for (const [dx, dy] of off) d[(y + dy) * w + x + dx] = 1;
  return d;
}
function directed(a, b) {
  let max = 0;
  for (const p of a) {
    let min = Infinity;
    for (const q of b) {
      const v = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
      if (v < min) min = v;
    }
    max = Math.max(max, min);
  }
  return Math.sqrt(max);
}
export function measure(file, view) {
  const p = PNG.sync.read(fs.readFileSync(file)),
    w = p.width,
    h = p.height,
    s0 = w / 1024;
  const j = JSON.parse(fs.readFileSync(`G:/DEV/wt/scaffolds-535/big_farm-${view}.json`));
  const m = Uint8Array.from({ length: w * h }, (_, i) => +(p.data[i * 4 + 3] > 128)),
    filled = fill(m, w, h);
  const target = new Uint8Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++)
      target[y * N + x] = +inside((x + 0.5) * 4, (y + 0.5) * 4, j.outline_polygon_px);
  // Transform the returned mask by f and dx/dy in canvas coordinates, around the canvas centre.
  function iou(f, dx, dy) {
    let it = 0,
      un = 0;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const px = Math.round((((x + 0.5) * 4 - 512 - dx) / f + 512) * s0),
          py = Math.round((((y + 0.5) * 4 - 512 - dy) / f + 512) * s0);
        const a = px >= 0 && py >= 0 && px < w && py < h ? filled[py * w + px] : 0,
          b = target[y * N + x];
        it += a & b;
        un += a | b;
      }
    return it / un;
  }
  let best = { f: 1, dx: 0, dy: 0, iou: iou(1, 0, 0) };
  const atS0 = best.iou;
  for (let f = 0.85; f <= 1.1501; f += 0.03)
    for (let dx = -96; dx <= 96; dx += 16)
      for (let dy = -96; dy <= 96; dy += 16) {
        const v = iou(f, dx, dy);
        if (v > best.iou) best = { f, dx, dy, iou: v };
      }
  for (const [sf, sd] of [
    [0.01, 4],
    [0.002, 1],
  ]) {
    const old = { ...best };
    for (let f = old.f - 2 * sf; f <= old.f + 2 * sf + 0.00001; f += sf)
      for (let dx = old.dx - 2 * sd; dx <= old.dx + 2 * sd; dx += sd)
        for (let dy = old.dy - 2 * sd; dy <= old.dy + 2 * sd; dy += sd) {
          if (f < 0.85 || f > 1.15) continue;
          const v = iou(f, dx, dy);
          if (v > best.iou) best = { f, dx, dy, iou: v };
        }
  }
  const opened = opening(filled, w, h, Math.max(1, Math.round(2 * s0)));
  const pe = edge(opened, w, h).map(([x, y]) => [
    (x / s0 - 512) * best.f + 512 + best.dx,
    (y / s0 - 512) * best.f + 512 + best.dy,
  ]);
  const tm = new Uint8Array(1024 * 1024);
  for (let y = 0; y < 1024; y++)
    for (let x = 0; x < 1024; x++)
      tm[y * 1024 + x] = +inside(x + 0.5, y + 0.5, j.outline_polygon_px);
  const te = edge(tm, 1024, 1024);
  const hausdorff = Math.max(directed(pe, te), directed(te, pe));
  let xmin = w,
    ymin = h,
    xmax = 0,
    ymax = 0,
    white = 0,
    amber = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (p.data[i + 3] <= 128) continue;
      xmin = Math.min(xmin, x);
      xmax = Math.max(xmax, x);
      ymin = Math.min(ymin, y);
      ymax = Math.max(ymax, y);
      const [r, g, b] = p.data.subarray(i, i + 3);
      if (r >= 236 && g >= 228 && b >= 208) white++;
      if (Math.hypot(r - 232, g - 170, b - 72) <= 12) amber++;
    }
  const base = measureBase(p);
  const light = [];
  for (const [a, b] of [
    [base.w, base.s],
    [base.s, base.e],
  ]) {
    let sum = 0,
      n = 0;
    for (let t = 0.2; t < 0.8; t += 0.01)
      for (let up = 12; up < 50; up += 3) {
        const x = Math.round(a[0] + (b[0] - a[0]) * t),
          y = Math.round(a[1] + (b[1] - a[1]) * t - up * s0),
          i = (y * w + x) * 4;
        if (x >= 0 && y >= 0 && x < w && y < h && p.data[i + 3] > 128) {
          sum += 0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2];
          n++;
        }
      }
    light.push(n ? sum / n : null);
  }
  delete base.top;
  delete base.low;
  const record = JSON.parse(fs.readFileSync(new URL('./prompts.json', import.meta.url))),
    call = record.calls.find((c) => c.file === file);
  const height = call?.measured.height ?? null;
  return {
    file,
    view,
    nameMetadata: pictureOf(file),
    returned: [w, h],
    s0,
    silhouette: {
      iouAtS0: atS0,
      bestFit: best,
      boundaryDeviationCanvasPx: hausdorff,
      pass: best.iou >= 0.9 && hausdorff <= 24,
      method:
        '256px grid IoU coarse-to-fine, pixel boundary symmetric Euclidean Hausdorff after 2 canvas px opening',
    },
    opaqueBox: [xmin, ymin, xmax, ymax],
    base,
    baseWidthMachine: base.e[0] - base.w[0],
    baseWidthByEye: call?.measured.baseWidth ?? null,
    heldWidth: 694 * s0,
    kMachine: (694 * s0) / (base.e[0] - base.w[0]),
    height,
    scaffoldReference: record.scaffoldReference[view],
    r0Reference: record.r0Reference,
    lightEstimate: {
      lowerLeft: light[0],
      lowerRight: light[1],
      eyeConfirmed: call?.measured.light ?? null,
      pass: call?.measured.light.leftLighter ?? null,
    },
    highlights: { nearWhite: white, nearAmber: amber, pass: 'reported only; never refuses' },
  };
}
if (process.argv[2])
  console.log(JSON.stringify(measure(process.argv[2], process.argv[3]), null, 2));
