import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { PNG } from 'pngjs';

// Read-only assessment: this script never rewrites or geometrically corrects source art.
const [guidePath, candidatePath, outputArg] = process.argv.slice(2);
if (!guidePath || !candidatePath)
  throw new Error('Usage: node check-guide.mjs guide.png candidate.png [qa directory]');
const guide = PNG.sync.read(readFileSync(guidePath));
const candidate = PNG.sync.read(readFileSync(candidatePath));
const folder = resolve(outputArg ?? 'assets/source/bridges-v2/qa');
mkdirSync(folder, { recursive: true });
const stem = basename(candidatePath, '.png');
function geometry(p) {
  const mask = new Uint8Array(p.width * p.height);
  let left = p.width,
    right = -1,
    top = p.height,
    bottom = -1,
    count = 0,
    empty = 0,
    opaque = 0;
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const a = p.data[(y * p.width + x) * 4 + 3];
      if (a === 0) empty++;
      if (a === 255) opaque++;
      if (a > 128) {
        mask[y * p.width + x] = 1;
        count++;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  const edge = [];
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const i = y * p.width + x;
      if (
        mask[i] &&
        (x === 0 ||
          y === 0 ||
          x === p.width - 1 ||
          y === p.height - 1 ||
          !mask[i - 1] ||
          !mask[i + 1] ||
          !mask[i - p.width] ||
          !mask[i + p.width])
      )
        edge.push([x, y]);
    }
  return { mask, edge, bounds: { left, top, right, bottom }, count, empty, opaque };
}
function distances(from, to) {
  return from
    .map(([x, y]) => {
      let best = Infinity;
      for (const [tx, ty] of to) {
        const d = (x - tx) ** 2 + (y - ty) ** 2;
        if (d < best) best = d;
        if (best === 0) break;
      }
      return Math.sqrt(best);
    })
    .sort((a, b) => a - b);
}
const g = geometry(guide),
  c = geometry(candidate);
const a = distances(g.edge, c.edge),
  b = distances(c.edge, g.edge);
const summarize = (d) => ({
  max: d.at(-1),
  p95: d[Math.floor(d.length * 0.95)],
  outside4px: d.filter((x) => x > 4).length,
  total: d.length,
});
const sameCanvas = candidate.width === guide.width && candidate.height === guide.height;
let intersect = 0,
  union = 0;
for (let y = 0; y < Math.max(guide.height, candidate.height); y++)
  for (let x = 0; x < Math.max(guide.width, candidate.width); x++) {
    const gm = x < guide.width && y < guide.height && g.mask[y * guide.width + x];
    const cm = x < candidate.width && y < candidate.height && c.mask[y * candidate.width + x];
    if (gm && cm) intersect++;
    if (gm || cm) union++;
  }
const report = {
  guide: guidePath,
  candidate: candidatePath,
  dimensions: {
    guide: [guide.width, guide.height],
    candidate: [candidate.width, candidate.height],
  },
  sameCanvas,
  guideBounds: g.bounds,
  candidateBounds: c.bounds,
  boundsDelta: Object.fromEntries(Object.keys(g.bounds).map((k) => [k, c.bounds[k] - g.bounds[k]])),
  guideToCandidate: summarize(a),
  candidateToGuide: summarize(b),
  silhouetteIoU: intersect / union,
  alpha: { transparent: c.empty, opaque: c.opaque, foreground: c.count },
  tolerancePx: 4.5,
  within4px: sameCanvas && a.at(-1) < 4.5 && b.at(-1) < 4.5,
  notes: [
    'The brief says about 4px: acceptance uses maximum distance rounding to 4 at whole-pixel precision (<4.5px). Exact unrounded distances and counts above 4 are retained.',
    'Distances use alpha >128 contours and unmodified canvas coordinates. No registration, crop, scaling or fitting is applied.',
    'Timber railing holes are intentional departures from the solid guide; assess those cutouts separately.',
    'Face boundaries and straight cut ends also need visual inspection.',
  ],
};
// Requested 50% candidate over the guide, in the original canvas coordinates.
const overlay = new PNG({ width: guide.width, height: guide.height });
const edgeView = new PNG({ width: guide.width, height: guide.height });
for (let y = 0; y < guide.height; y++)
  for (let x = 0; x < guide.width; x++) {
    const i = (y * guide.width + x) * 4,
      ci = (y * candidate.width + x) * 4;
    const bg = ((x >> 4) + (y >> 4)) % 2 ? 230 : 246;
    const ga = guide.data[i + 3] / 255;
    const ca =
      x < candidate.width && y < candidate.height ? (candidate.data[ci + 3] / 255) * 0.5 : 0;
    for (let k = 0; k < 3; k++) {
      const base = guide.data[i + k] * ga + bg * (1 - ga);
      overlay.data[i + k] = Math.round((candidate.data[ci + k] ?? 0) * ca + base * (1 - ca));
      edgeView.data[i + k] = bg;
    }
    overlay.data[i + 3] = edgeView.data[i + 3] = 255;
  }
for (const [x, y] of g.edge) {
  const i = (y * guide.width + x) * 4;
  edgeView.data[i] = 20;
  edgeView.data[i + 1] = 100;
  edgeView.data[i + 2] = 220;
}
for (const [x, y] of c.edge)
  if (x < guide.width && y < guide.height) {
    const i = (y * guide.width + x) * 4;
    edgeView.data[i] = 235;
    edgeView.data[i + 1] = 40;
    edgeView.data[i + 2] = 120;
  }
writeFileSync(resolve(folder, stem + '-overlay.png'), PNG.sync.write(overlay));
writeFileSync(resolve(folder, stem + '-edges.png'), PNG.sync.write(edgeView));
writeFileSync(resolve(folder, stem + '-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (!report.within4px) process.exitCode = 1;
