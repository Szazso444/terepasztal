import { readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { PNG } from 'pngjs';

const inputDir = resolve(process.argv[2] ?? 'assets/source/base-v1');
const reportPath = join(inputDir, 'alpha-report.json');
const indexPath = join(inputDir, 'index.html');
let queue = { assets: [] };
try {
  queue = JSON.parse(await readFile(join(inputDir, 'generation-queue.json'), 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const jobsByFile = new Map(queue.assets.map((job) => [job.filename, job]));
let designIssues = [];
try {
  const review = JSON.parse((await readFile(join(inputDir, 'design-review.json'), 'utf8')).replace(/^\uFEFF/, ''));
  designIssues = review.issues.filter((issue) => issue.status !== 'resolved');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

function decodePng(buffer) {
  return new Promise((resolvePng, rejectPng) => {
    new PNG().parse(buffer, (error, png) => {
      if (error) rejectPng(error);
      else resolvePng(png);
    });
  });
}

function pngColorType(buffer) {
  if (buffer.length < 26 || buffer.readUInt32BE(0) !== 0x89504e47) return null;
  return buffer[25];
}

function analyzePixels(png) {
  let transparent = 0;
  let partial = 0;
  let opaque = 0;
  let nearOpaque = 0;
  let maxAlpha = 0;
  let minX = png.width;
  let minY = png.height;
  let maxX = -1;
  let maxY = -1;
  const edgeMaxAlpha = { top: 0, right: 0, bottom: 0, left: 0 };

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const alpha = png.data[(png.width * y + x) * 4 + 3];
      if (y === 0) edgeMaxAlpha.top = Math.max(edgeMaxAlpha.top, alpha);
      if (x === png.width - 1) edgeMaxAlpha.right = Math.max(edgeMaxAlpha.right, alpha);
      if (y === png.height - 1) edgeMaxAlpha.bottom = Math.max(edgeMaxAlpha.bottom, alpha);
      if (x === 0) edgeMaxAlpha.left = Math.max(edgeMaxAlpha.left, alpha);
      maxAlpha = Math.max(maxAlpha, alpha);
      if (alpha === 0) {
        transparent += 1;
      } else {
        if (alpha === 255) opaque += 1;
        else partial += 1;
        if (alpha >= 250) nearOpaque += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  const bbox = maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  const touchesEdges = bbox
    ? {
        top: bbox.y === 0,
        right: bbox.x + bbox.width === png.width,
        bottom: bbox.y + bbox.height === png.height,
        left: bbox.x === 0,
      }
    : { top: false, right: false, bottom: false, left: false };
  const centralX0 = Math.floor(png.width * 0.25);
  const centralX1 = Math.ceil(png.width * 0.75);
  const centralY0 = Math.floor(png.height * 0.25);
  const centralY1 = Math.ceil(png.height * 0.75);
  let centralPixels = 0;
  for (let y = centralY0; y < centralY1; y += 1) {
    for (let x = centralX0; x < centralX1; x += 1) {
      if (png.data[(png.width * y + x) * 4 + 3] > 0) centralPixels += 1;
    }
  }
  const totalPixels = png.width * png.height;

  return {
    width: png.width,
    height: png.height,
    pixels: {
      transparent,
      partial,
      opaque,
      nearOpaque,
      total: totalPixels,
      maxAlpha,
    },
    nearOpaqueRatio: nearOpaque / Math.max(1, totalPixels - transparent),
    centralCoverageRatio: centralPixels / Math.max(1, (centralX1 - centralX0) * (centralY1 - centralY0)),
    bbox,
    touchesEdges,
    edgeMaxAlpha,
    warnings: Object.entries(touchesEdges)
      .filter(([, touches]) => touches)
      .map(([edge]) => `non-transparent pixels touch the ${edge} edge (maximum alpha ${edgeMaxAlpha[edge]}/255)`),
  };
}

function previewHtml(images) {
  const imageTags = images
    .map(
      ({ name, width, height, valid, pendingDesignReview, warnings = [] }) =>
        `      <figure data-name="${name}"><div class="frame"><a href="${encodeURI(name)}" target="_blank"><img loading="lazy" src="${encodeURI(name)}" alt="${name}"${width && height ? ` width="${width}" height="${height}"` : ''}></a></div><figcaption>${name}<small>${width ?? '?'} × ${height ?? '?'} · ${valid ? 'Alpha check passed' : 'Alpha check failed'}${warnings.length ? ` · ${warnings.length} edge warning(s)` : ''}${pendingDesignReview ? ' · Design correction pending' : ''}</small></figcaption></figure>`,
    )
    .join('\n');
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Willowline source asset library</title>
<style>
  :root { color-scheme: light dark; font: 14px system-ui, sans-serif; }
  body { margin: 0; padding: 1rem; background: #f4f4f4; color: #222; }
  body.dark { background: #20242a; color: #eee; }
  body.checker { background-color: #d0d0d0; background-image: linear-gradient(45deg,#aaa 25%,transparent 25%),linear-gradient(-45deg,#aaa 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#aaa 75%),linear-gradient(-45deg,transparent 75%,#aaa 75%); background-size: 24px 24px; background-position: 0 0,0 12px,12px -12px,-12px 0; }
  nav { position: sticky; top: 0; padding: .75rem; background: inherit; } button { margin-right: .5rem; padding: .35rem .7rem; }
  main { display: grid; grid-template-columns: repeat(auto-fill,minmax(220px,1fr)); gap: 1rem; }
  figure { margin: 0; } .frame { min-height: 160px; display: grid; place-items: center; padding: .75rem; background: #fff; } body.dark .frame { background: #111; }
  .frame a { display: block; width: 100%; }
  body.checker .frame { background-color: #d0d0d0; background-image: conic-gradient(#aaa 25%, #ddd 0 50%, #aaa 0 75%, #ddd 0); background-size: 24px 24px; }
  small { display: block; opacity: .7; margin-top: .25rem; } input { padding: .5rem; max-width: 20rem; } figure[hidden] { display: none; }
  img { width: 100%; height: 280px; object-fit: contain; image-rendering: pixelated; } figcaption { overflow-wrap: anywhere; padding-top: .35rem; }
</style>
<h1>Willowline source asset library</h1>
<p>${images.length} generated source images. Alpha checks do not certify design accuracy, tile joins, anchors or runtime readiness.</p>
<p><a href="RAILCRAFT.md">Railcraft integration and track behavior</a> · <a href="railcraft-specifications.json">Per-vehicle mechanical specifications</a> · <a href="coverage.json">Asset coverage</a></p>
<nav><button data-bg="light">Light</button><button data-bg="dark">Dark</button><button data-bg="checker">Checker</button><input type="search" aria-label="Filter assets" placeholder="Filter assets…"></nav>
<main>
${imageTags}
</main>
<script>for (const button of document.querySelectorAll('button')) button.onclick = () => { document.body.className = button.dataset.bg; }; document.querySelector('input').oninput = (event) => { for (const figure of document.querySelectorAll('figure')) figure.hidden = !figure.dataset.name.includes(event.target.value.toLowerCase()); };</script>
`;
}

const entries = (await readdir(inputDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.png')
  .sort((a, b) => a.name.localeCompare(b.name));

const assets = [];
const failures = [];
for (const entry of entries) {
  const name = entry.name;
  const path = join(inputDir, name);
  try {
    const buffer = await readFile(path);
    const colorType = pngColorType(buffer);
    if (colorType !== 6 && colorType !== 4) throw new Error(`PNG color type ${colorType ?? 'unknown'} has no alpha channel`);
    const analysis = analyzePixels(await decodePng(buffer));
    const intentionalTranslucency = jobsByFile.get(name)?.id.startsWith('fx.');
    const sparseOverlay = jobsByFile.get(name)?.id === 'terrain.cursor';
    const failed =
      analysis.width === 0 ||
      analysis.height === 0 ||
      analysis.pixels.transparent === 0 ||
      analysis.pixels.maxAlpha === 0 ||
      (!intentionalTranslucency && (analysis.pixels.nearOpaque === 0 || analysis.nearOpaqueRatio < 0.5)) ||
      (!intentionalTranslucency && !sparseOverlay && analysis.centralCoverageRatio < 0.1);
    const pendingDesignReview = designIssues.some((issue) => issue.id === jobsByFile.get(name)?.id);
    const result = { name, colorType, intentionalTranslucency: Boolean(intentionalTranslucency), pendingDesignReview, ...analysis, valid: !failed };
    assets.push(result);
    if (failed) failures.push(name);
  } catch (error) {
    const result = { name, valid: false, error: error instanceof Error ? error.message : String(error) };
    assets.push(result);
    failures.push(name);
  }
}

const report = {
  inputDirectory: relative(process.cwd(), inputDir) || '.',
  imageCount: assets.length,
  valid: entries.length > 0 && failures.length === 0,
  failures,
  assets,
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(indexPath, previewHtml(assets));

console.log(`Scanned ${assets.length} PNG image${assets.length === 1 ? '' : 's'} in ${inputDir}`);
for (const asset of assets) {
  if (asset.error) console.error(`FAIL ${asset.name}: ${asset.error}`);
  else console.log(`${asset.valid ? 'OK' : 'FAIL'} ${asset.name}: ${asset.width}x${asset.height}, transparent=${asset.pixels.transparent}, partial=${asset.pixels.partial}, opaque=${asset.pixels.opaque}, nearOpaque=${asset.pixels.nearOpaque}, maxAlpha=${asset.pixels.maxAlpha}, centralCoverage=${asset.centralCoverageRatio.toFixed(3)}, bbox=${JSON.stringify(asset.bbox)}`);
  for (const warning of asset.warnings ?? []) console.warn(`WARN ${asset.name}: ${warning}`);
}
if (entries.length === 0) {
  console.error('FAIL no PNG images found');
  process.exitCode = 1;
} else if (failures.length > 0) {
  process.exitCode = 1;
}
