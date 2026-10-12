import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

// Read-only measurement. The optional --report file is the only file this tool writes.
const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const file = args[0],
  edge = args[1];
if (!file || !['ne', 'se', 'sw', 'nw'].includes(edge)) {
  throw new Error('Usage: node check-extent.mjs <PNG path> <ne|se|sw|nw> [--report <JSON path>]');
}
const source = PNG.sync.read(fs.readFileSync(path.resolve(file)));
const guide = PNG.sync.read(
  fs.readFileSync(path.join(root, 'guides', `river-mouth-${edge}-centred.png`)),
);
const geometry = JSON.parse(
  fs.readFileSync(path.join(root, 'river-geometry.json'), 'utf8'),
).mouthsCentred;
const s = source.width / 1024;
const corners = [
  [0, 0],
  [source.width - 1, 0],
  [0, source.height - 1],
  [source.width - 1, source.height - 1],
].map(([x, y]) =>
  Array.from(source.data.subarray((y * source.width + x) * 4, (y * source.width + x) * 4 + 4)),
);
const opaqueBackground = corners.every(
  (c) => c[3] === 255 && c.slice(0, 3).every((v, i) => Math.abs(v - corners[0][i]) <= 5),
);
const painted = (x, y) => {
  if (x < 0 || y < 0 || x >= source.width || y >= source.height) return false;
  const i = (y * source.width + x) * 4;
  return opaqueBackground
    ? [0, 1, 2].some((c) => Math.abs(source.data[i + c] - corners[0][c]) > 40)
    : source.data[i + 3] > 128;
};
let minX = source.width,
  minY = source.height,
  maxX = -1,
  maxY = -1,
  intersection = 0,
  union = 0,
  count = 0;
for (let y = 0; y < source.height; y++)
  for (let x = 0; x < source.width; x++) {
    const p = painted(x, y);
    const gx = Math.min(1023, Math.floor((x + 0.5) / s)),
      gy = Math.min(1023, Math.floor((y + 0.5) / s));
    const g = gy >= 0 && gy < 1024 && guide.data[(gy * 1024 + gx) * 4 + 3] > 0;
    if (p) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      count++;
    }
    if (p && g) intersection++;
    if (p || g) union++;
  }
const square = source.width === source.height;
const box = count ? [minX, minY, maxX + 1, maxY + 1] : null;
const width = count ? maxX - minX + 1 : 0,
  height = count ? maxY - minY + 1 : 0;
const centre = count ? [(minX + maxX + 1) / 2, (minY + maxY + 1) / 2] : null;
const centreDistance = centre ? Math.hypot(centre[0] - 512 * s, centre[1] - 512 * s) : null;
const boxPass =
  square &&
  Math.abs(width - 768 * s) <= 0.05 * 768 * s &&
  Math.abs(height - 384 * s) <= 0.05 * 384 * s &&
  centreDistance <= 38 * s;
const iou = square && union ? intersection / union : null;
function channel(t) {
  const [cx, cy] = geometry[edge].middleCentre;
  const hits = [],
    step = 1 / 2048;
  // Scan beyond the expected banks, so excess width or lateral shifts cannot be hidden.
  for (let j = 0; j <= 3072; j++) {
    const u = -0.75 + j * step;
    const [tx, ty] = { ne: [u, -t], se: [t, u], sw: [u, t], nw: [-t, u] }[edge];
    const x = Math.floor((cx + 256 * (tx - ty)) * s),
      y = Math.floor((cy + 128 * (tx + ty)) * s);
    if (!painted(x, y)) continue;
    const i = (y * source.width + x) * 4;
    if (source.data[i + 2] - source.data[i] > 15) hits.push(u);
  }
  const bounds = hits.length ? [hits[0] - step / 2, hits.at(-1) + step / 2] : null;
  const waterWidth = bounds ? bounds[1] - bounds[0] : 0;
  const centreOffset = bounds ? (bounds[0] + bounds[1]) / 2 : null;
  return {
    t,
    waterBounds: bounds,
    waterWidth,
    centreOffset,
    pass:
      square &&
      waterWidth >= 0.72 &&
      waterWidth <= 0.8 &&
      centreOffset !== null &&
      Math.abs(centreOffset) <= 0.04,
  };
}
const channels = [channel(-0.25), channel(0)];
const failures = [];
if (!square) failures.push('non-square return');
if (!boxPass) failures.push('box');
if (iou === null || iou < 0.9) failures.push('IoU');
for (const c of channels) if (!c.pass) failures.push(`channel at t=${c.t}`);
const report = {
  file,
  edge,
  returned: [source.width, source.height],
  scale: s,
  square,
  mask: opaqueBackground ? 'difference from corner colour >40' : 'alpha >128',
  paintedPixels: count,
  box: {
    actual: box,
    expected: [128, 320, 896, 704].map((v) => v * s),
    width,
    height,
    centre,
    centreDistance,
    widthErrorFraction: Math.abs(width - 768 * s) / (768 * s),
    heightErrorFraction: Math.abs(height - 384 * s) / (384 * s),
    pass: boxPass,
  },
  overlap: { intersection, union, iou, minimum: 0.9, pass: iou !== null && iou >= 0.9 },
  channels,
  passed: failures.length === 0,
  failures,
};
const text = JSON.stringify(report, null, 2) + '\n';
const reportIndex = args.indexOf('--report');
if (reportIndex !== -1) fs.writeFileSync(path.resolve(args[reportIndex + 1]), text);
process.stdout.write(text);
