import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';

const local = (p) => new URL(p, import.meta.url);
const read = (p) => PNG.sync.read(readFileSync(p));
const save = (p, png) => writeFileSync(local(p), PNG.sync.write(png));
const src = read(process.argv[2]);
const hub = JSON.parse(readFileSync(local('hub.json'), 'utf8'));
const side = src.width,
  centre = (side - 1) / 2;
let reach = 0,
  weight = 0,
  sumX = 0,
  sumY = 0,
  intersection = 0,
  union = 0;
let white = 0,
  amber = 0;
const tips = [null, null, null, null],
  distances = [0, 0, 0, 0];
for (let y = 0; y < src.height; y++)
  for (let x = 0; x < side; x++) {
    const i = (y * side + x) * 4,
      alpha = src.data[i + 3];
    weight += alpha;
    sumX += x * alpha;
    sumY += y * alpha;
    if (alpha > 64) {
      const d = Math.hypot(x - centre, y - centre);
      reach = Math.max(reach, d);
      const q = y < centre ? (x >= centre ? 0 : 1) : x < centre ? 2 : 3;
      if (d > distances[q]) {
        distances[q] = d;
        tips[q] = [x, y];
      }
    }
    const turned = src.height === side && src.data[(x * side + side - 1 - y) * 4 + 3] > 128;
    if (alpha > 128 && turned) intersection++;
    if (alpha > 128 || turned) union++;
    if (alpha <= 128) continue;
    const [r, g, b] = src.data.subarray(i, i + 3);
    if (r >= 236 && g >= 228 && b >= 208) white++;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      delta = max - min;
    let hue =
      delta === 0
        ? 0
        : max === r
          ? 60 * (((g - b) / delta) % 6)
          : max === g
            ? 60 * ((b - r) / delta + 2)
            : 60 * ((r - g) / delta + 4);
    if (hue < 0) hue += 360;
    if (hue >= 25 && hue <= 50 && (max ? delta / max : 0) >= 0.62 && max / 255 >= 0.85) amber++;
  }
const centroid = [sumX / weight, sumY / weight];
const centroidMiss = Math.hypot(centroid[0] - centre, centroid[1] - centre);
const quarterTurnOverlap = intersection / union;
const failures = [];
if (src.height !== side) failures.push('picture is not square');
if (reach > 0.49 * side || reach < 0.4 * side) failures.push('reach outside 0.40–0.49 of side');
if (centroidMiss > 0.01 * side) failures.push('alpha centroid farther than 1% of side from centre');
if (quarterTurnOverlap < 0.8) failures.push('quarter-turn overlap below 0.80');
if (white) failures.push(`${white} cursor-white pixels`);
if (amber) failures.push(`${amber} selection-amber pixels`);
if (tips.some((p) => !p)) throw new Error('A sail quadrant is empty');

// Solve A = M S^T (S S^T)^-1, with each point relative to its fixed hub.
const sailVectors = tips.map(([x, y]) => [x - centre, y - centre]);
const masterVectors = hub.masterTips.map(([x, y]) => [x - hub.masterHub[0], y - hub.masterHub[1]]);
let xx = 0,
  xy = 0,
  yy = 0,
  ux = 0,
  uy = 0,
  vx = 0,
  vy = 0;
for (let k = 0; k < 4; k++) {
  const [x, y] = sailVectors[k],
    [u, v] = masterVectors[k];
  xx += x * x;
  xy += x * y;
  yy += y * y;
  ux += u * x;
  uy += u * y;
  vx += v * x;
  vy += v * y;
}
const det = xx * yy - xy * xy;
const a = (ux * yy - uy * xy) / det,
  b = (uy * xx - ux * xy) / det;
const c = (vx * yy - vy * xy) / det,
  d = (vy * xx - vx * xy) / det;
hub.sailAffine = [
  [a, b],
  [c, d],
];
hub.sailScale = reach / (masterVectors.reduce((sum, [x, y]) => sum + Math.hypot(x, y), 0) / 4);
hub.sailAngle = (Math.atan2(-masterVectors[0][1], masterVectors[0][0]) * 180) / Math.PI;
hub.fitMiss = Math.max(
  ...sailVectors.map(([x, y], k) =>
    Math.hypot(a * x + b * y - masterVectors[k][0], c * x + d * y - masterVectors[k][1]),
  ),
);
writeFileSync(local('hub.json'), JSON.stringify(hub, null, 2) + '\n');

/** Bilinear sample in premultiplied alpha; outside the canvas is transparent. */
function sample(p, x, y) {
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    fx = x - x0,
    fy = y - y0;
  let alpha = 0,
    r = 0,
    g = 0,
    b = 0;
  for (const [xx, wx] of [
    [x0, 1 - fx],
    [x0 + 1, fx],
  ])
    for (const [yy, wy] of [
      [y0, 1 - fy],
      [y0 + 1, fy],
    ]) {
      if (xx < 0 || yy < 0 || xx >= p.width || yy >= p.height) continue;
      const i = (yy * p.width + xx) * 4,
        w = (wx * wy * p.data[i + 3]) / 255;
      alpha += w;
      r += w * p.data[i];
      g += w * p.data[i + 1];
      b += w * p.data[i + 2];
    }
  return alpha ? [r / alpha, g / alpha, b / alpha, alpha * 255] : [0, 0, 0, 0];
}
function transform(p, width, height, inverse) {
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      out.data.set(sample(p, ...inverse(x, y)).map(Math.round), (y * width + x) * 4);
  return out;
}
const body = read(local('windmill-a0-r0.png'));
const master = read('assets/source/base-v1/windmill.png');
// Diagnostics need room above the master canvas: the independent sails can sweep
// beyond its top. This padding is only on the sheets, never on either deliverable.
const padTop = Math.max(0, Math.ceil(reach * Math.hypot(c, d) - hub.hub[1])) + 8;
function padded(p) {
  const out = new PNG({ width: p.width, height: p.height + padTop });
  PNG.bitblt(p, out, 0, 0, p.width, p.height, 0, padTop);
  return out;
}
const background = padded(body),
  paddedMaster = padded(master);
function composite(angle) {
  const rad = (angle * Math.PI) / 180,
    co = Math.cos(rad),
    si = Math.sin(rad);
  const turned = transform(src, side, src.height, (x, y) => [
    centre + co * (x - centre) + si * (y - centre),
    centre - si * (x - centre) + co * (y - centre),
  ]);
  const determinant = a * d - b * c;
  const sail = transform(turned, background.width, background.height, (x, y) => {
    const u = x - hub.hub[0],
      v = y - padTop - hub.hub[1];
    return [centre + (d * u - b * v) / determinant, centre + (-c * u + a * v) / determinant];
  });
  const out = new PNG({ width: background.width, height: background.height });
  for (let i = 0; i < out.data.length; i += 4) {
    const sa = sail.data[i + 3] / 255,
      ba = background.data[i + 3] / 255,
      alpha = sa + ba * (1 - sa);
    for (let ch = 0; ch < 3; ch++)
      out.data[i + ch] = alpha
        ? Math.round((sail.data[i + ch] * sa + background.data[i + ch] * ba * (1 - sa)) / alpha)
        : 0;
    out.data[i + 3] = Math.round(alpha * 255);
  }
  return out;
}
function scale(p, sx, sy) {
  return transform(p, Math.round(p.width * sx), Math.round(p.height * sy), (x, y) => [
    (x + 0.5) / sx - 0.5,
    (y + 0.5) / sy - 0.5,
  ]);
}
mkdirSync(local('checks/'), { recursive: true });
const left = scale(paddedMaster, 1 / 3, 1 / 3),
  right = scale(composite(0), 1 / 3, 1 / 3);
const overlay = new PNG({ width: left.width + right.width, height: left.height });
PNG.bitblt(left, overlay, 0, 0, left.width, left.height, 0, 0);
PNG.bitblt(right, overlay, 0, 0, right.width, right.height, left.width, 0);
save('checks/sails-overlay.png', overlay);
const cells = [0, 15, 30, 45, 60, 75].map((angle) => scale(composite(angle), 0.102, 0.0847));
cells.push(scale(paddedMaster, 0.102, 0.0847));
const sheet = new PNG({ width: cells[0].width * 3 * 7, height: cells[0].height * 3 });
for (let k = 0; k < cells.length; k++) {
  const p = cells[k];
  for (let y = 0; y < p.height * 3; y++)
    for (let x = 0; x < p.width * 3; x++) {
      const i = (Math.floor(y / 3) * p.width + Math.floor(x / 3)) * 4;
      p.data.copy(sheet.data, (y * sheet.width + k * p.width * 3 + x) * 4, i, i + 4);
    }
}
save('checks/sails-turn.png', sheet);
console.log(
  JSON.stringify(
    {
      returned: [src.width, src.height],
      reach,
      reachFraction: reach / side,
      centroid,
      centroidMiss,
      quarterTurnOverlap,
      cursorWhitePixels: white,
      selectionAmberPixels: amber,
      tips,
      sailScale: hub.sailScale,
      sailAngle: hub.sailAngle,
      sailAffine: hub.sailAffine,
      fitMiss: hub.fitMiss,
      failures,
    },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
