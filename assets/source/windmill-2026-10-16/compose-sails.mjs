import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';

const input = process.argv[2];
if (!input) throw new Error('Usage: node compose-sails.mjs <raw arm PNG>');
const src = PNG.sync.read(readFileSync(input));
if (src.width !== src.height) throw new Error('The arm canvas must be square');
const side = src.width,
  centre = (side - 1) / 2;
const index = (x, y) => y * side + x;
const alpha = (p, x, y) => p.data[index(x, y) * 4 + 3];
const candidates = new Uint8Array(side * side);
for (let y = 0; y < side; y++)
  for (let x = 0; x < side; x++) {
    if (Math.hypot(x - centre, y - centre) > side * 0.12) continue;
    const i = index(x, y) * 4;
    const max = Math.max(...src.data.subarray(i, i + 3));
    const min = Math.min(...src.data.subarray(i, i + 3));
    if (
      src.data[i + 3] > 128 &&
      (max ? (max - min) / max : 0) < 0.25 &&
      max / 255 >= 0.12 &&
      max / 255 <= 0.65
    )
      candidates[index(x, y)] = 1;
  }
// Remove thin grey timber rims before choosing the largest connected iron face.
const face = new Uint8Array(candidates.length);
for (let y = 3; y < side - 3; y++)
  for (let x = 3; x < side - 3; x++) {
    let solid = true;
    for (let dy = -3; dy <= 3 && solid; dy++)
      for (let dx = -3; dx <= 3; dx++)
        if (!candidates[index(x + dx, y + dy)]) {
          solid = false;
          break;
        }
    if (solid) face[index(x, y)] = 1;
  }
let plate = [];
for (let seed = 0; seed < face.length; seed++) {
  if (!face[seed]) continue;
  const component = [seed];
  face[seed] = 0;
  for (let k = 0; k < component.length; k++) {
    const i = component[k],
      x = i % side,
      y = Math.floor(i / side);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const xx = x + dx,
        yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= side || yy >= side) continue;
      const j = index(xx, yy);
      if (face[j]) {
        face[j] = 0;
        component.push(j);
      }
    }
  }
  if (component.length > plate.length) plate = component;
}
if (plate.length < 100) throw new Error('No connected iron plate found near the centre');
// In the bar's coordinates the plate is a square. Its edge extrema give its
// geometric centre; this avoids bias towards its brighter face or bolt holes.
let umin = Infinity,
  umax = -Infinity,
  vmin = Infinity,
  vmax = -Infinity;
for (const i of plate) {
  const x = i % side,
    y = Math.floor(i / side);
  const u = (x - y) / Math.SQRT2,
    v = (x + y) / Math.SQRT2;
  umin = Math.min(umin, u);
  umax = Math.max(umax, u);
  vmin = Math.min(vmin, v);
  vmax = Math.max(vmax, v);
}
const uc = (umin + umax) / 2,
  vc = (vmin + vmax) / 2;
const plateCentre = [(uc + vc) / Math.SQRT2, (vc - uc) / Math.SQRT2];
const shift = plateCentre.map((v) => Math.round(centre - v));
const halfU = (umax - umin) / 2 + 3,
  halfV = (vmax - vmin) / 2 + 3;
const plateRadius = Math.hypot(halfU, halfV);
const shifted = new PNG({ width: side, height: side });
let canvasLostPixels = 0;
for (let y = 0; y < side; y++)
  for (let x = 0; x < side; x++) {
    const xx = x + shift[0],
      yy = y + shift[1],
      i = index(x, y) * 4;
    if (xx < 0 || yy < 0 || xx >= side || yy >= side) {
      if (src.data[i + 3] > 128) canvasLostPixels++;
      continue;
    }
    src.data.copy(shifted.data, index(xx, yy) * 4, i, i + 4);
  }
const out = new PNG({ width: side, height: side });
const left = Math.floor(centre) + 1,
  bottom = Math.ceil(centre) - 1;
let quarterPixels = 0,
  borderPixels = 0,
  reach = 0;
const borderCounts = { left: 0, top: 0, right: 0, bottom: 0 };
for (let y = 0; y <= bottom; y++)
  for (let x = left; x < side; x++) {
    const i = index(x, y) * 4;
    if (alpha(shifted, x, y) > 64) reach = Math.max(reach, Math.hypot(x - centre, y - centre));
    if (alpha(shifted, x, y) > 128) {
      quarterPixels++;
      if (x === left) borderCounts.left++;
      if (y === 0) borderCounts.top++;
      if (x === side - 1) borderCounts.right++;
      if (y === bottom) borderCounts.bottom++;
      if (x === left || y === 0 || x === side - 1 || y === bottom) borderPixels++;
    }
    let xx = x,
      yy = y;
    for (let turn = 0; turn < 4; turn++) {
      shifted.data.copy(out.data, index(xx, yy) * 4, i, i + 4);
      [xx, yy] = [side - 1 - yy, xx];
    }
  }
// Restore only the original central plate, once. The oriented plate bounds,
// expanded by six pixels, exclude the timber stock outside the iron face.
for (let y = 0; y < side; y++)
  for (let x = 0; x < side; x++) {
    const dx = x - shift[0] - plateCentre[0],
      dy = y - shift[1] - plateCentre[1];
    const u = (dx - dy) / Math.SQRT2,
      v = (dx + dy) / Math.SQRT2;
    if (Math.hypot(dx, dy) > plateRadius + 6 || Math.abs(u) > halfU + 6 || Math.abs(v) > halfV + 6)
      continue;
    const i = index(x, y) * 4;
    if (shifted.data[i + 3]) shifted.data.copy(out.data, i, i, i + 4);
  }
// Sample perpendicular runs at one-pixel steps along the diagonal stock.
let frameWidth = 0;
for (let u = Math.ceil(0.4 * reach); u <= Math.floor(0.8 * reach); u++) {
  let run = 0;
  for (let v = -Math.ceil(reach); v <= Math.ceil(reach); v++) {
    const x = Math.round(centre + (u + v) / Math.SQRT2);
    const y = Math.round(centre + (v - u) / Math.SQRT2);
    if (x >= left && x < side && y >= 0 && y <= bottom && alpha(shifted, x, y) > 128) {
      run++;
      frameWidth = Math.max(frameWidth, run);
    } else run = 0;
  }
}
const frameWidthShare = frameWidth / reach,
  lostBorderShare = borderPixels / quarterPixels;
const failures = [];
if (frameWidthShare < 0.27) failures.push('frame width below 0.27 of reach');
if (lostBorderShare > 0.01) failures.push('lost border pixels exceed 1% of quarter pixels');
if (canvasLostPixels) failures.push('recentering clips painted pixels at the canvas edge');
const attempt = /windmill-sail-arm-attempt-(\d+)\.png$/.exec(input)?.[1] ?? 'test';
const folder = new URL(`composed/${attempt}/`, import.meta.url);
mkdirSync(folder, { recursive: true });
writeFileSync(new URL('windmill-sails-front.png', folder), PNG.sync.write(out));
console.log(
  JSON.stringify(
    {
      returned: [side, side],
      plateCentre,
      plateShift: shift,
      shiftedPlateCentre: plateCentre.map((v, i) => v + shift[i]),
      plateRadius,
      platePixels: plate.length,
      quarterPixels,
      borderCounts,
      lostBorderPixels: borderPixels,
      lostBorderShare,
      canvasLostPixels,
      reach,
      frameWidth,
      frameWidthShare,
      failures,
    },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
