import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG, box, resample } from './pose-png.mjs';
import { contactOverlap } from './contact-overlap.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const guidesRoot = path.resolve(root, '../../people-v3-guides');
const manifest = JSON.parse(fs.readFileSync(path.join(guidesRoot, 'manifest.json')));
// Copied predicates from tools/atlas-cap.mjs; no colour correction is performed.
const isOverWhite = (r, g, b) => r >= 236 && g >= 228 && b >= 208;
function isAmberStrong(r, g, b) {
  const max = Math.max(r, g, b),
    d = max - Math.min(r, g, b);
  if (!d) return false;
  const h =
    (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return h >= 25 && h <= 50 && d / max >= 0.62 && max / 255 >= 0.85;
}
export function measure(file, guide) {
  const bytes = fs.readFileSync(file),
    original = PNG.sync.read(bytes);
  const s = original.width / 1024,
    shapePass = original.height === 1536 * s;
  if (!shapePass)
    return { file, returned: [original.width, original.height], shapePass, pass: false };
  const png =
    s === 1
      ? original
      : resample(original, 1024, 1536, 1 / s, [0, 0], [0, 0], { cleanAlpha: false });
  const bounds = box(png),
    soleRow = bounds.y + bounds.height - 1;
  const feet = {};
  for (const side of ['right', 'left']) {
    const joints = ['Heel', 'Toe', 'Ankle'].map((j) => guide.canvas[side + j]);
    const x0 = Math.max(0, Math.floor(Math.min(...joints.map((j) => j[0])) - 30));
    const x1 = Math.min(1023, Math.ceil(Math.max(...joints.map((j) => j[0])) + 30));
    const bottom = Math.max(...joints.map((j) => j[1]));
    const y0 = Math.max(0, Math.floor(bottom - 145)),
      y1 = Math.min(1535, Math.floor(bottom + 30));
    let ylow = -1,
      cx = 0,
      cy = 0,
      count = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) if (png.data[(y * 1024 + x) * 4 + 3] > 128) ylow = y;
    for (let y = Math.max(y0, ylow - 40); y <= ylow; y++)
      for (let x = x0; x <= x1; x++)
        if (png.data[(y * 1024 + x) * 4 + 3] > 128) {
          cx += x;
          cy += y;
          count++;
        }
    cx /= count;
    cy /= count;
    feet[side] = {
      window: [x0, y0, x1, y1],
      ylow,
      cx,
      cy,
      f: (cx - 512 - 2 * (cy - guide.groundPoint[1])) / 1717.6,
    };
  }
  function top(x0, x1) {
    for (let y = 0; y < 1536; y++)
      for (let x = x0; x <= x1; x++) if (png.data[(y * 1024 + x) * 4 + 3] > 128) return y;
    return null;
  }
  const L = top(352, 412),
    R = top(614, 668);
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
  ].map((p) => original.data[p * 4 + 3]);
  return {
    file,
    returned: [original.width, original.height],
    shapePass,
    box: bounds,
    height: bounds.height,
    soleRow,
    feet,
    turned: { L, R, value: (R - L) / 960 },
    caps: { white, amber, pass: white === 0 && amber === 0 },
    rgba: {
      colourType: bytes[25],
      corners,
      pass: bytes[25] === 6 && corners.every((a) => a === 0),
    },
  };
}
function suite(arm) {
  const entries = [1, 2, 3, 4].map((pose) => {
    const guide = manifest.guides.find((g) => g.file === `back-${arm}-p${pose}.png`);
    return measure(path.join(guidesRoot, guide.file), guide);
  });
  const slides = [
    [0, 1, 'right'],
    [1, 2, 'right'],
    [2, 3, 'left'],
  ].map(([a, b, foot]) => entries[a].feet[foot].f - entries[b].feet[foot].f);
  const overlaps = [
    [0, 2],
    [1, 3],
  ].map(
    ([a, b]) =>
      contactOverlap(
        PNG.sync.read(fs.readFileSync(entries[a].file)),
        PNG.sync.read(fs.readFileSync(entries[b].file)),
      ).iou,
  );
  return { entries, slides, overlaps };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const swing = suite('swing'),
    shoulder = suite('shoulder');
  const expected = [0.1173, 0.0335, 0.0621];
  const calibrationPass =
    swing.slides.every((v, i) => Math.abs(v - expected[i]) < 0.00015) &&
    Math.abs(swing.overlaps[0] - 0.221) < 0.001 &&
    Math.abs(swing.overlaps[1] - 0.504) < 0.001;
  const report = { calibrationPass, swing, shoulder };
  const recordPath = path.join(root, 'prompts.json');
  const record = fs.existsSync(recordPath)
    ? JSON.parse(fs.readFileSync(recordPath))
    : { method: 'R7c-1 guide edits', callsUsed: 0, limit: 12, attempts: [] };
  record.calibration = report;
  for (const attempt of record.attempts) {
    if (!attempt.rawFile) continue;
    const guide = manifest.guides.find((g) => g.file === `back-shoulder-p${attempt.pose}.png`);
    attempt.measured = measure(path.join(root, attempt.rawFile), guide);
    console.log(
      JSON.stringify(
        {
          pose: attempt.pose,
          attempt: attempt.attempt,
          measured: attempt.measured,
          tests: attempt.tests,
        },
        null,
        2,
      ),
    );
  }
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n');
  fs.writeFileSync(
    path.join(root, 'checks/calibration.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(root, 'checks/measurements.json'),
    JSON.stringify(
      {
        calibration: report,
        attempts: record.attempts.map(({ pose, attempt, measured, tests }) => ({
          pose,
          attempt,
          measured,
          tests,
        })),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
  if (!calibrationPass) process.exitCode = 1;
}
