import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const file = args[0];
const source = PNG.sync.read(fs.readFileSync(path.resolve(file)));
const geometry = JSON.parse(
  fs.readFileSync(path.join(root, 'fall-geometry.json'), 'utf8'),
).plungeFoamSwCentred;
const s = source.width / 1024;
const square = source.width === source.height;
const corners = [
  [0, 0],
  [source.width - 1, 0],
  [0, source.height - 1],
  [source.width - 1, source.height - 1],
].map(([x, y]) =>
  Array.from(source.data.subarray((y * source.width + x) * 4, (y * source.width + x) * 4 + 4)),
);
const opaque = corners.every(
  (c) => c[3] === 255 && c.slice(0, 3).every((v, i) => Math.abs(v - corners[0][i]) <= 5),
);
let minX = source.width,
  minY = source.height,
  maxX = -1,
  maxY = -1;
let paintedPixels = 0,
  intersection = 0,
  union = 0,
  foamPixels = 0;
const zones = [0, 0];
let foamOutside = 0,
  paintedOutside = 0;
for (let y = 0; y < source.height; y++) {
  for (let x = 0; x < source.width; x++) {
    const i = (y * source.width + x) * 4;
    const [r, g, b, a] = source.data.subarray(i, i + 4);
    const painted = opaque ? [r, g, b].some((v, c) => Math.abs(v - corners[0][c]) > 40) : a > 128;
    // Never compare a non-square return against a scaled square guide.
    const dx = (x + 0.5) / s - 544,
      dy = (y + 0.5) / s - 496;
    const tx = dx / 512 + dy / 256,
      ty = dy / 256 - dx / 512;
    const inBand = square && tx >= -1.375 && tx <= 1.375 && ty >= 0 && ty <= 0.25;
    if (painted) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      paintedPixels++;
      if (square && !inBand) paintedOutside++;
      if (0.2126 * r + 0.7152 * g + 0.0722 * b >= 185 && Math.abs(r - b) < 40) {
        foamPixels++;
        if (inBand) zones[ty <= 0.1 ? 0 : 1]++;
        else if (square) foamOutside++;
      }
    }
    if (square && painted && inBand) intersection++;
    if (square && (painted || inBand)) union++;
  }
}
const box = paintedPixels ? [minX, minY, maxX + 1, maxY + 1] : null;
const width = paintedPixels ? maxX - minX + 1 : 0;
const height = paintedPixels ? maxY - minY + 1 : 0;
const centre = box ? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] : null;
const centreDistance =
  square && centre ? Math.hypot(centre[0] - 512 * s, centre[1] - 512 * s) : null;
const widthErrorFraction = square ? Math.abs(width - 768 * s) / (768 * s) : null;
const heightErrorFraction = square ? Math.abs(height - 384 * s) / (384 * s) : null;
const passed =
  square &&
  paintedPixels > 0 &&
  widthErrorFraction <= 0.05 &&
  heightErrorFraction <= 0.05 &&
  centreDistance <= 38 * s;
const report = {
  file,
  returned: [source.width, source.height],
  square,
  scale: s,
  mask: opaque ? 'difference from corner colour >40' : 'alpha >128',
  paintedPixels,
  box: {
    actual: box,
    expected: square ? geometry.box.map((v) => v * s) : null,
    width,
    height,
    centre,
    centreDistance,
    widthErrorFraction,
    heightErrorFraction,
    pass: passed,
  },
  iou: square && union ? intersection / union : null,
  paintedOutsideBand: square ? paintedOutside : null,
  foam: {
    definition: 'painted; luma >=185; abs(red-blue) <40',
    pixels: foamPixels,
    zoneShares: square && foamPixels ? zones.map((v) => v / foamPixels) : null,
    zoneRanges: [
      [0, 0.1],
      [0.1, 0.25],
    ],
    outsideShare: square && foamPixels ? foamOutside / foamPixels : null,
  },
  passed,
  failures: passed ? [] : [square ? 'box' : 'non-square return'],
};
const reportIndex = args.indexOf('--report');
const output = JSON.stringify(report, null, 2) + '\n';
if (reportIndex !== -1) fs.writeFileSync(path.resolve(args[reportIndex + 1]), output);
process.stdout.write(output);
