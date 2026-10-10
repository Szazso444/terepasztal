import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import { trimSource, resample } from '../../tools/illustrated-sprites.mjs';
const base = 'assets/source/building-poc-v1',
  out = 'scratchpad/building-poc/sprites';
const plan = JSON.parse(readFileSync(`${base}/remaining-building-plan.json`));
const manifest = JSON.parse(readFileSync(`${out}/manifest.json`));
const assets = [],
  missing = [];
for (const a of plan.assets) {
  const files = Array.from({ length: 4 }, (_, r) => `${base}/remaining/${a.key}-${r}.png`);
  if (!files.every(existsSync)) {
    missing.push(a.key);
    continue;
  }
  const material = /farm|lumber|windmill|kiln/.test(a.key)
    ? 'dirt'
    : /town/.test(a.key)
      ? 'stone'
      : 'gravel';
  for (let r = 0; r < 4; r++) {
    const src = trimSource(PNG.sync.read(readFileSync(files[r])));
    // Conservative fit to one/two-cell ground envelope, no warp or independent axis scaling.
    // Door/industrial scale still requires per-asset visual calibration.
    const targetWidth = a.proposedTiles === 1 ? 80 : 136;
    const scale = Math.min(targetWidth / src.width, 190 / src.height);
    const w = Math.max(4, Math.round(src.width * scale * 4)),
      h = Math.max(4, Math.round(src.height * scale * 4));
    const png = resample(src, w, h),
      key = `${a.key}-${r}`;
    writeFileSync(`${out}/${key}.png`, PNG.sync.write(png));
    manifest.frames[key] = {
      tiles: a.proposedTiles,
      rotation: r,
      w: w / 4,
      h: h / 4,
      ax: w / 8,
      ay: h / 4 - (a.proposedTiles + 1) * 13 * 0.82,
      source: files[r],
      material,
      projectionVerified: false,
      scaleVerified: false,
    };
  }
  assets.push({
    key: a.key,
    id: a.id,
    tiles: a.proposedTiles,
    material,
    reference: a.reference,
    source: a.source,
  });
  a.status = 'generated-first-pass';
}
manifest.buildings = [
  { key: 'house', id: 'House', tiles: 1, material: 'stone' },
  { key: 'station', id: 'Passenger station', tiles: 2, material: 'stone' },
  ...assets,
];
writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));
writeFileSync(`${base}/remaining-building-plan.json`, JSON.stringify(plan, null, 2));
writeFileSync(
  `${out}/remaining-report.json`,
  JSON.stringify(
    {
      completedBuildings: assets.length,
      completedFacings: assets.length * 4,
      missing,
      notes:
        'First-pass sources and footprint-fitted sprites; projection, human scale and direction continuity require visual approval.',
    },
    null,
    2,
  ),
);
console.log({
  completedBuildings: assets.length,
  facings: assets.length * 4,
  missing: missing.length,
});
if (process.argv.includes('--require-all') && missing.length)
  throw Error('Missing building sets: ' + missing.join(', '));
