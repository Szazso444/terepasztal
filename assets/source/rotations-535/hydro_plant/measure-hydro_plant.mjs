import fs from 'node:fs';
import { PNG } from 'pngjs';
import { measureBase } from '../../../../tools/building-fit.mjs';
import { pictureOf, checkFile } from '../../../../tools/building-check.mjs';
const file = process.argv[2],
  png = PNG.sync.read(fs.readFileSync(file)),
  base = measureBase(png),
  eye = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3])) : null;
const corners = eye?.corners || { w: base.w, s: base.s, e: base.e };
const { w, s, e } = corners;
const W = e[0] - w[0],
  held = (394 * png.width) / 1024,
  k = held / W,
  toGuide = k / (png.width / 1024);
const slopes = [(s[1] - w[1]) / (s[0] - w[0]), (s[1] - e[1]) / (e[0] - s[0])],
  ratio = (s[0] - w[0]) / (e[0] - s[0]);
let box = [png.width, png.height, -1, -1],
  nearWhite = 0,
  nearAmber = 0,
  overshoot = 0;
for (let x = 0; x < png.width; x++) {
  let low = -1;
  for (let y = 0; y < png.height; y++) {
    const i = (y * png.width + x) * 4;
    if (png.data[i + 3] <= 128) continue;
    low = y;
    box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
    const [r, g, b] = png.data.subarray(i, i + 3);
    if (r >= 236 && g >= 228 && b >= 208) nearWhite++;
    if (Math.hypot(r - 232, g - 170, b - 72) <= 12) nearAmber++;
  }
  if (low < 0) continue;
  const X = 547.1458 + (x - s[0]) * toGuide,
    Y = 929.6271 + (low - s[1]) * toGuide;
  const lower = X <= 512 ? 832 + (X - 256) * 0.5 : 960 - (X - 512) * 0.5;
  overshoot = Math.max(overshoot, 256 - X, X - 768, Y - lower);
}
const check = checkFile(file, 't1', 0);
const height = eye?.eavesY !== undefined ? (s[1] - eye.eavesY) / W : null;
const result = {
  file,
  nameMetadata: pictureOf(file),
  returned: [png.width, png.height],
  opaqueBox: box,
  automatic: { w: base.w, s: base.s, e: base.e, slopes: base.slopes, sure: base.sure },
  corners,
  cornerMethod: eye ? 'by eye; automatic retained' : 'automatic',
  baseWidth: W,
  heldWidth: held,
  k,
  foot: [s[0] - w[0], e[0] - s[0]],
  footRatio: ratio,
  slopes,
  slopeDistances: slopes.map((n) => Math.abs(n - 0.5)),
  camera: check.fit?.camera || null,
  cameraError: check.fit?.camera
    ? Math.max(Math.abs(check.fit.camera.elevation - 30), Math.abs(check.fit.camera.turn))
    : null,
  cameraRefusal: check.camera || null,
  checkProblems: check.problems,
  largestOvershootGuidePx: overshoot,
  overshootLimitGuidePx: 16,
  height,
  heightTarget: 0.82,
  highlights: { nearWhite, nearAmber },
  tests: {
    width: 'measurement only',
    plan: ratio >= 1.22 && ratio <= 1.65,
    camera: slopes.every((n) => Math.abs(n - 0.5) <= 0.03) && check.ok,
    insideFootprint: overshoot <= 16,
    height: height === null ? null : Math.abs(height / 0.82 - 1) <= 0.15,
  },
  eye,
};
console.log(JSON.stringify(result, null, 2));
