import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';

const folder = fileURLToPath(new URL('.', import.meta.url));
const manifest = JSON.parse(
  readFileSync(folder + 'generation-prompts.json', 'utf8').replace(/^\uFEFF/, ''),
);
const selected = process.argv.slice(2);
const jobs = manifest.assets.filter((a) => !selected.length || selected.includes(a.filename));
const report = { expected: 18, found: 0, errors: [], assets: [] };
const images = [];
for (const job of jobs) {
  if (!existsSync(folder + job.filename)) {
    report.errors.push('Missing: ' + job.filename);
    continue;
  }
  const buffer = readFileSync(folder + job.filename);
  const png = PNG.sync.read(buffer);
  const { width: w, height: h, data } = png;
  let transparent = 0,
    opaque = 0,
    nearOpaque = 0,
    fringe = 0,
    maxAlpha = 0;
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a === 0) transparent++;
      if (a === 255) opaque++;
      if (a >= 250) nearOpaque++;
      if (a > 0 && a <= 64) fringe++;
      maxAlpha = Math.max(maxAlpha, a);
      if (a > 64) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  const record = {
    filename: job.filename,
    width: w,
    height: h,
    colorType: buffer[25],
    sha256: createHash('sha256').update(buffer).digest('hex'),
    transparent,
    opaque,
    nearOpaque,
    fringeAlpha1to64: fringe,
    maxAlpha,
    solidBounds: { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 },
    warnings: [],
  };
  if (buffer[25] !== 6 || transparent === 0 || nearOpaque === 0)
    report.errors.push('Invalid RGBA cutout: ' + job.filename);
  if (x0 === 0 || y0 === 0 || x1 === w - 1 || y1 === h - 1)
    report.errors.push('Solid silhouette clipped: ' + job.filename);
  if (fringe)
    record.warnings.push(
      'Low-alpha fringe: keep original; trimSource removes alpha <=64 downstream.',
    );
  if (opaque < nearOpaque * 0.9)
    record.warnings.push('Most solid pixels are near-opaque (250-254), not exactly 255.');
  if (Math.min(x0 / w, y0 / h, (w - x1 - 1) / w, (h - y1 - 1) / h) < 0.09)
    record.warnings.push('Solid margin is below approximately 10%.');
  report.assets.push(record);
  report.found++;
  images.push({ png, record });
}

// A small QA derivative only. Source PNG bytes are never rewritten.
const columns = selected.length ? 2 : 3;
const cw = 380,
  ch = 310;
const sheet = new PNG({
  width: columns * cw,
  height: Math.max(1, Math.ceil(images.length / columns)) * ch,
});
for (let y = 0; y < sheet.height; y++)
  for (let x = 0; x < sheet.width; x++) {
    const i = (y * sheet.width + x) * 4,
      c = ((x >> 4) + (y >> 4)) % 2 ? 229 : 244;
    sheet.data[i] = sheet.data[i + 1] = sheet.data[i + 2] = c;
    sheet.data[i + 3] = 255;
  }
images.forEach(({ png, record }, n) => {
  const b = record.solidBounds,
    s = Math.min((cw - 40) / b.width, (ch - 40) / b.height);
  const dw = Math.round(b.width * s),
    dh = Math.round(b.height * s);
  const ox = (n % columns) * cw + Math.floor((cw - dw) / 2),
    oy = Math.floor(n / columns) * ch + Math.floor((ch - dh) / 2);
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      const si =
        ((b.y + Math.min(b.height - 1, Math.floor(y / s))) * png.width +
          b.x +
          Math.min(b.width - 1, Math.floor(x / s))) *
        4;
      const di = ((oy + y) * sheet.width + ox + x) * 4,
        a = png.data[si + 3] / 255;
      for (let c = 0; c < 3; c++)
        sheet.data[di + c] = Math.round(png.data[si + c] * a + sheet.data[di + c] * (1 - a));
    }
});
const prefix = selected.length ? 'review-selection' : 'contact-sheet';
writeFileSync(folder + prefix + '.png', PNG.sync.write(sheet));
if (!selected.length) {
  writeFileSync(folder + 'alpha-report.json', JSON.stringify(report, null, 2) + '\n');
  const cards = report.assets
    .map(
      (a) =>
        `<figure><a href="${a.filename}"><img loading="lazy" src="${a.filename}"></a><figcaption><b>${a.filename}</b><br>${a.width} × ${a.height}<br><small>${a.warnings.join('<br>')}</small></figcaption></figure>`,
    )
    .join('\n');
  writeFileSync(
    folder + 'index.html',
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Bridge kit v1</title><style>body{font:16px system-ui;margin:32px;background:#eee9de;color:#292b26}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}figure{margin:0;background:white;border:1px solid #bbb;padding:12px}img{display:block;width:100%;height:300px;object-fit:contain;background:repeating-conic-gradient(#e0e0e0 0% 25%,#fff 0% 50%) 0/20px 20px}figcaption{padding:12px 0;line-height:1.5}small{color:#686044}a{color:inherit}</style><h1>Bridge kit v1</h1><p>${report.found}/18 original source PNGs. <a href="README.md">Review notes</a> · <a href="generation-prompts.json">Exact prompts</a> · <a href="alpha-report.json">Alpha and SHA-256 report</a></p><p>Source art for downstream atlas integration. Separate x/y generations preserve upper-left lighting. Click an image to inspect its original.</p><main>${cards}</main></html>\n`,
  );
}
console.log(
  JSON.stringify({
    found: report.found,
    expected: jobs.length,
    errors: report.errors,
    report: folder + 'alpha-report.json',
    preview: folder + prefix + '.png',
  }),
);
if (report.errors.length) process.exitCode = 1;
