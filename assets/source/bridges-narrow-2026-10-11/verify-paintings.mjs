import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const dir = dirname(fileURLToPath(import.meta.url));
const geometry = JSON.parse(readFileSync(join(dir, 'geometry.json')));
const entries = JSON.parse(readFileSync(join(dir, 'prompts.json')));
mkdirSync(join(dir, 'review'), { recursive: true });
const read = (path) => PNG.sync.read(readFileSync(path));
const save = (name, png) => writeFileSync(join(dir, 'review', name), PNG.sync.write(png));
const round = (n) => Math.round(n * 100) / 100;
function boundary(png) {
  const points = [];
  const solid = (x, y) =>
    x >= 0 &&
    y >= 0 &&
    x < png.width &&
    y < png.height &&
    png.data[(y * png.width + x) * 4 + 3] >= 128;
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++)
      if (
        solid(x, y) &&
        (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1))
      )
        points.push([x + 0.5, y + 0.5]);
  return points;
}
// Review-only resampling: never write over a source painting.
function preview(png, width = 128) {
  const height = Math.round((png.height * width) / png.width),
    out = new PNG({ width, height });
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * png.width) / width),
        x1 = Math.floor(((x + 1) * png.width) / width);
      const y0 = Math.floor((y * png.height) / height),
        y1 = Math.floor(((y + 1) * png.height) / height);
      let a = 0,
        r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (let sy = y0; sy < y1; sy++)
        for (let sx = x0; sx < x1; sx++) {
          const o = (sy * png.width + sx) * 4,
            alpha = png.data[o + 3] / 255;
          a += alpha;
          r += png.data[o] * alpha;
          g += png.data[o + 1] * alpha;
          b += png.data[o + 2] * alpha;
          n++;
        }
      const o = (y * width + x) * 4;
      if (a) {
        out.data[o] = r / a;
        out.data[o + 1] = g / a;
        out.data[o + 2] = b / a;
        out.data[o + 3] = (255 * a) / n;
      }
    }
  return out;
}
for (const entry of entries) {
  const png = read(join(dir, entry.file)),
    guide = read(join(dir, '../../../', entry.references[0]));
  entry.returned = [png.width, png.height];
  const histogram = {};
  let zero = 0,
    opaque = 0,
    partial = 0;
  for (let i = 3; i < png.data.length; i += 4) {
    const a = png.data[i];
    histogram[a] = (histogram[a] ?? 0) + 1;
    if (a === 0) zero++;
    else if (a === 255) opaque++;
    else partial++;
  }
  entry.alpha = {
    alphaHistogram: histogram,
    solidSurfacesFullyOpaque: partial === 0,
    transparentPixels: zero,
    opaquePixels: opaque,
    partialPixels: partial,
    cornerAlpha: [
      3,
      (png.width - 1) * 4 + 3,
      (png.height - 1) * png.width * 4 + 3,
      png.data.length - 1,
    ].map((i) => png.data[i]),
  };
  if (!zero) throw Error(entry.id + ': missing transparent background');
  const points = boundary(png),
    sx = png.width / 1024,
    sy = png.height / 1024;
  entry.edgeOffsets = {
    units: 'canvas pixels at returned size',
    method:
      'For every face edge, 21 samples excluding vertices; shortest Euclidean distance to alpha>=128 silhouette boundary. Unsigned distances include internal face joins, which are labelled separately. No fitting or silhouette alteration.',
    faces: [],
  };
  for (const face of geometry.pieces[entry.geometryId ?? entry.id].faces) {
    const edges = [];
    for (let i = 0; i < face.points.length; i++) {
      const a = face.points[i],
        b = face.points[(i + 1) % face.points.length],
        dist = [];
      let exterior = 0;
      for (let j = 0; j < 21; j++) {
        const t = 0.05 + (0.9 * j) / 20,
          x = (a[0] + (b[0] - a[0]) * t) * sx,
          y = (a[1] + (b[1] - a[1]) * t) * sy;
        let best = Infinity;
        for (const p of points) best = Math.min(best, Math.hypot(p[0] - x, p[1] - y));
        dist.push(best);
        const gx = x / sx,
          gy = y / sy,
          len = Math.hypot(b[0] - a[0], b[1] - a[1]),
          nx = -(b[1] - a[1]) / len,
          ny = (b[0] - a[0]) / len;
        const alpha = (xx, yy) => {
          xx = Math.round(xx);
          yy = Math.round(yy);
          return xx < 0 || yy < 0 || xx >= 1024 || yy >= 1024
            ? 0
            : guide.data[(yy * 1024 + xx) * 4 + 3];
        };
        if (!alpha(gx + nx * 3, gy + ny * 3) || !alpha(gx - nx * 3, gy - ny * 3)) exterior++;
      }
      edges.push({
        from: a.map((v, k) => round(v * (k ? sy : sx))),
        to: b.map((v, k) => round(v * (k ? sy : sx))),
        kind: exterior > 10 ? 'outer silhouette' : 'face join',
        mean: round(dist.reduce((a, b) => a + b, 0) / dist.length),
        min: round(Math.min(...dist)),
        max: round(Math.max(...dist)),
        samples: dist.map(round),
      });
    }
    entry.edgeOffsets.faces.push({ name: face.name, edges });
  }
  const overlay = new PNG({ width: png.width, height: png.height });
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++) {
      const o = (y * png.width + x) * 4,
        go = (Math.min(1023, Math.floor(y / sy)) * 1024 + Math.min(1023, Math.floor(x / sx))) * 4;
      const a = png.data[o + 3] / 510,
        ga = guide.data[go + 3] / 255,
        oa = a + ga * (1 - a);
      for (let c = 0; c < 3; c++)
        overlay.data[o + c] = oa
          ? (png.data[o + c] * a + guide.data[go + c] * ga * (1 - a)) / oa
          : 0;
      overlay.data[o + 3] = oa * 255;
    }
  save(entry.id + '-overlay-50.png', overlay);
  save(entry.id + '-128.png', preview(png));
  save(entry.id + '-guide-128.png', preview(guide));
  const ref = read(join(dir, '../../../', entry.references[2]));
  save(entry.id + '-full-reference-128.png', preview(ref));
  if (entry.status !== 'rejected') entry.status = 'requires-opacity-review';
  console.log(
    JSON.stringify({
      id: entry.id,
      returned: entry.returned,
      dominantSurfaceAlpha: Object.entries(histogram)
        .filter(([a]) => Number(a) >= 128)
        .sort((a, b) => b[1] - a[1])[0]?.[0],
      outerEdgeMeanRange: entry.edgeOffsets.faces
        .flatMap((f) => f.edges)
        .filter((e) => e.kind === 'outer silhouette')
        .map((e) => e.mean),
    }),
  );
}
writeFileSync(join(dir, 'prompts.json'), JSON.stringify(entries, null, 2) + '\n');
