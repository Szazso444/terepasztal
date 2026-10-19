import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { read, box, resample } from './pose-png.mjs';
import { contactOverlap } from './contact-overlap.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const guidesRoot = path.resolve(root, '../../people-v3-guides');
const manifest = JSON.parse(fs.readFileSync(path.join(guidesRoot, 'manifest.json')));
// Copied from tools/atlas-cap.mjs; no colour adjustment is made to measured pixels.
const isOverWhite = (r, g, b) => r >= 236 && g >= 228 && b >= 208;
function isAmberStrong(r, g, b) {
  const max = Math.max(r, g, b),
    d = max - Math.min(r, g, b);
  if (!d) return false;
  const h =
    (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return h >= 25 && h <= 50 && d / max >= 0.62 && max / 255 >= 0.85;
}
function opaque(p, x, y) {
  return x >= 0 && y >= 0 && x < p.width && y < p.height && p.data[(y * p.width + x) * 4 + 3] > 128;
}
function foot(p, g, side) {
  const joints = ['Heel', 'Toe', 'Ankle'].map((j) => g.canvas[side + j]);
  const x0 = Math.floor(Math.min(...joints.map((j) => j[0])) - 30);
  const x1 = Math.ceil(Math.max(...joints.map((j) => j[0])) + 30);
  const bottom = Math.max(...joints.map((j) => j[1]));
  const y0 = Math.round(bottom) - 145,
    y1 = Math.round(bottom) + 30;
  let ylow = -1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (opaque(p, x, y)) ylow = y;
  let sx = 0,
    sy = 0,
    count = 0;
  for (let y = ylow - 40; y <= ylow; y++)
    for (let x = x0; x <= x1; x++)
      if (opaque(p, x, y)) {
        sx += x;
        sy += y;
        count++;
      }
  const cx = sx / count,
    cy = sy / count;
  return { ylow, cx, cy, pixels: count, f: (cx - 512 - 2 * (cy - g.groundPoint[1])) / 1717.6 };
}
function columnTop(p, left, right, minimum = 0) {
  for (let y = minimum; y < p.height; y++)
    for (let x = left; x <= right; x++) if (opaque(p, x, y)) return y;
  return null;
}
export function measure(file, g) {
  file = path.resolve(file);
  const bytes = fs.readFileSync(file),
    original = read(file);
  if (original.width * 3 !== original.height * 2)
    return { shapePass: false, width: original.width, height: original.height };
  const p =
    original.width === 1024
      ? original
      : resample(original, 1024, 1536, 1024 / original.width, [0, 0], [0, 0], {
          cleanAlpha: false,
        });
  const bounds = box(p);
  let white = 0,
    amber = 0;
  for (let i = 0; i < original.data.length; i += 4)
    if (original.data[i + 3] >= 16) {
      if (isOverWhite(...original.data.subarray(i, i + 3))) white++;
      if (isAmberStrong(...original.data.subarray(i, i + 3))) amber++;
    }
  const corners = [
    0,
    original.width - 1,
    (original.height - 1) * original.width,
    original.width * original.height - 1,
  ].map((i) => original.data[i * 4 + 3]);
  const L = columnTop(p, 352, 412),
    R = columnTop(p, 614, 668);
  return {
    shapePass: true,
    width: original.width,
    height: original.height,
    bounds,
    soleRow: bounds.y + bounds.height - 1,
    figureHeight: bounds.height,
    feet: { right: foot(p, g, 'right'), left: foot(p, g, 'left') },
    turn: { L, R, ratio: (R - L) / 960 },
    caps: { white, amber, pass: white === 0 && amber === 0 },
    rgba: {
      colourType: bytes[25],
      corners,
      pass: bytes[25] === 6 && corners.every((a) => a === 0),
    },
    groundPoint: g.groundPoint,
  };
}
export function guideSet(arm) {
  const entries = [1, 2, 3, 4].map((n) =>
    manifest.guides.find((g) => g.file === `back-${arm}-p${n}.png`),
  );
  const measurements = entries.map((g) => measure(path.join(guidesRoot, g.file), g));
  const slides = [
    [0, 1, 'right'],
    [1, 2, 'right'],
    [2, 3, 'left'],
  ].map(([a, b, s]) => measurements[a].feet[s].f - measurements[b].feet[s].f);
  const overlaps = [
    [0, 2],
    [1, 3],
  ].map(
    ([a, b]) =>
      contactOverlap(
        read(path.join(guidesRoot, entries[a].file)),
        read(path.join(guidesRoot, entries[b].file)),
      ).iou,
  );
  return { entries, measurements, slides, overlaps };
}
export function evaluate(file, pose, prior = {}) {
  const targets = guideSet('shoulder');
  const g = targets.entries[pose - 1],
    target = targets.measurements[pose - 1];
  const m = measure(file, g);
  if (!m.shapePass)
    return { measurements: m, pass: false, failedTests: [7], reason: 'Not a 2:3 image' };
  const tests = {
    1: {
      height: m.figureHeight,
      target: target.figureHeight,
      relativeError: m.figureHeight / target.figureHeight - 1,
      pass: Math.abs(m.figureHeight / target.figureHeight - 1) <= 0.03,
    },
    2: {
      soleRow: m.soleRow,
      target: 1440,
      difference: m.soleRow - 1440,
      pass: Math.abs(m.soleRow - 1440) <= 8,
    },
    3: { feet: m.feet, slide: null, pass: true, status: pose === 1 ? 'pair pending' : 'checked' },
    4: {
      contactOverlap: null,
      pass: true,
      status: pose < 3 ? 'pair pending' : 'not a pass rule for P2/P4',
    },
    5: {
      ...m.turn,
      target: target.turn,
      difference: m.turn.ratio - target.turn.ratio,
      rawColumnPass: Math.abs(m.turn.ratio - target.turn.ratio) <= 0.03,
      pass: null,
      status: 'Requires visual isolation of shoulder tops when axe or cap intersects the columns',
      visualReview: 'pending',
    },
    6: m.caps,
    7: { ...m.rgba, shapePass: true, pass: m.rgba.pass },
  };
  if (pose > 1 && prior[pose - 1]) {
    const side = pose === 4 ? 'left' : 'right';
    const earlier = measure(prior[pose - 1], targets.entries[pose - 2]);
    const slide = earlier.feet[side].f - m.feet[side].f;
    tests[3].slide = {
      side,
      actual: slide,
      target: targets.slides[pose - 2],
      difference: slide - targets.slides[pose - 2],
    };
    tests[3].pass = Math.abs(tests[3].slide.difference) <= 0.01;
  }
  if (pose >= 3 && prior[pose - 2]) {
    const overlap = contactOverlap(read(path.resolve(prior[pose - 2])), read(path.resolve(file)));
    tests[4] = {
      contactOverlap: overlap,
      pass: pose === 4 || overlap.pass,
      status: pose === 4 ? 'informational' : 'checked',
    };
  }
  const failedTests = Object.entries(tests)
    .filter(([, v]) => v.pass === false)
    .map(([k]) => Number(k));
  return { measurements: m, tests, failedTests, unresolvedTests: [5], pass: false };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2]) {
    const pose = Number(process.argv[2]);
    if (![1, 2, 3, 4].includes(pose) || !process.argv[3])
      throw Error('Usage: node measure-v3.mjs [pose input.png]');
    console.log(JSON.stringify(evaluate(process.argv[3], pose), null, 2));
  } else {
    const result = { backSwing: guideSet('swing'), backShoulder: guideSet('shoulder') };
    console.log(JSON.stringify(result, null, 2));
    fs.writeFileSync(
      path.join(root, 'checks/guide-measurements.json'),
      JSON.stringify(result, null, 2) + '\n',
    );
  }
}
