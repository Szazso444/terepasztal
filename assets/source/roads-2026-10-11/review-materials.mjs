import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const require = createRequire(process.env.ROAD_TOOLING ? `${process.env.ROAD_TOOLING}/package.json` : import.meta.url);
const sharp = require('sharp');
const root = fileURLToPath(new URL('.', import.meta.url));
const pieces = [
  { id: 'road-strip-x', corners: [[55, 216], [231, 125], [1484, 836], [1297, 932]], role: 'Long x road; two parallel ruts' },
  { id: 'road-strip-y', corners: [[10, 862], [180, 968], [1528, 210], [1352, 116]], role: 'Long y road; two parallel ruts' },
  { id: 'crossing-material-regular', role: 'Uniform limestone setts with two timber check-plank bands' },
  { id: 'crossing-material-narrow', role: 'Uniform timber planking' },
];
const report = [], layers = [];
for (let n = 0; n < pieces.length; n++) {
  const piece = pieces[n];
  const file = `materials/${piece.id}.png`;
  const { data, info } = await sharp(`${root}/${file}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let clear = 0, opaque = 0, partial = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] === 0) clear++;
    else if (data[i] === 255) opaque++;
    else partial++;
  }
  const sections = [];
  if (piece.corners) {
    const [a, b, c, d] = piece.corners;
    for (let section = 0; section < 8; section++) {
      const rgb = [0, 0, 0];
      let samples = 0;
      for (let k = 0; k < 20; k++) for (let j = 0; j < 20; j++) {
        const u = 0.1 + 0.8 * (section + (k + 0.5) / 20) / 8;
        const v = 0.15 + 0.7 * (j + 0.5) / 20;
        const px = Math.round((1 - u) * ((1 - v) * a[0] + v * b[0]) + u * ((1 - v) * d[0] + v * c[0]));
        const py = Math.round((1 - u) * ((1 - v) * a[1] + v * b[1]) + u * ((1 - v) * d[1] + v * c[1]));
        const offset = (py * info.width + px) * 4;
        if (data[offset + 3] < 250) continue;
        for (let channel = 0; channel < 3; channel++) rgb[channel] += data[offset + channel];
        samples++;
      }
      sections.push({ section, meanRgb: rgb.map(v => Number((v / samples).toFixed(2))), samples });
    }
  }
  report.push({ id: piece.id, file, role: piece.role, width: info.width, height: info.height, channels: info.channels, alphaZero: clear, alphaOpaque: opaque, alphaPartial: partial, longitudinalSections: sections, visualReview: 'Smooth continuous material; no conspicuous unique marks. Geometry is assigned by downstream script.' });
  // Composite explicitly: the raw viewer can expose hidden RGB at alpha zero as a false glow.
  const panel = await sharp(`${root}/${file}`).flatten({ background: '#626b6c' }).resize(768, 512).png().toBuffer();
  layers.push({ input: panel, left: (n % 2) * 768, top: Math.floor(n / 2) * 552 + 40 });
  const label = Buffer.from(`<svg width="768" height="40"><text x="20" y="28" font-family="sans-serif" font-size="23" fill="#e4d5b5">${piece.id}</text></svg>`);
  layers.push({ input: label, left: (n % 2) * 768, top: Math.floor(n / 2) * 552 });
}
await sharp({ create: { width: 1536, height: 1104, channels: 4, background: '#39443b' } }).composite(layers).png().toFile(`${root}/review/materials-sheet.png`);
writeFileSync(`${root}/materials.json`, JSON.stringify({ purpose: 'Four source paintings; downstream script owns final tile shape, position, dimensions and grid joins.', generationTool: 'built-in imagegen', selectedAttempt: 'original; quieter palette than alpha-correction attempts', fittingScript: null, fittingStatus: 'Path requested from user; script not present in this checkout or origin/develop.', notes: ['Do not treat these as finished 64x32 road frames.', 'Alpha-zero pixels retain RGB; composite using alpha instead of viewing raw RGB.', 'Longitudinal samples compare interior gravel colour along each road; they are measurements, not a tile-geometry test.'], sources: report }, null, 2) + '\n');
console.log(JSON.stringify(report.map(p => ({ id: p.id, width: p.width, height: p.height, channels: p.channels, sectionMeans: p.longitudinalSections.map(s => s.meanRgb) })), null, 2));
