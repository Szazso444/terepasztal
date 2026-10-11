// Mechanical sprite-strip export; painted content is supplied by image_gen.
// Run with Node.js and sharp available in NODE_PATH.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = __dirname;
const report = {};
function box(data, width, height, threshold = 128) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] < threshold) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (x1 < 0) throw new Error('Empty figure');
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
async function frame(file, column) {
  let pipeline = sharp(path.join(root, 'inputs', file)).ensureAlpha();
  if (column !== undefined) pipeline = pipeline.extract({ left: 384 * column, top: 0, width: 384, height: 1024 });
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  // Keep the figure's connected silhouette, excluding neighbouring-frame spill.
  const n = info.width * info.height, seen = new Uint8Array(n), queue = new Int32Array(n);
  let largest = [];
  for (let start = 0; start < n; start++) {
    if (seen[start] || data[start * 4 + 3] < 128) continue;
    let read = 0, end = 1; queue[0] = start; seen[start] = 1;
    while (read < end) {
      const pos = queue[read++], x = pos % info.width, y = Math.floor(pos / info.width);
      for (const next of [x > 0 ? pos - 1 : -1, x + 1 < info.width ? pos + 1 : -1, y > 0 ? pos - info.width : -1, y + 1 < info.height ? pos + info.width : -1]) {
        if (next >= 0 && !seen[next] && data[next * 4 + 3] >= 128) { seen[next] = 1; queue[end++] = next; }
      }
    }
    if (end > largest.length) largest = Array.from(queue.subarray(0, end));
  }
  const keep = new Uint8Array(n);
  for (const pos of largest) keep[pos] = 1;
  for (let pos = 0; pos < n; pos++) if (!keep[pos]) data[pos * 4 + 3] = 0;
  const bounds = box(data, info.width, info.height);
  // The generator returns near-opaque interiors and RGB under alpha-zero pixels.
  // Collapse its foreground mask before export, then resample smooth edge coverage.
  for (let i = 0; i < data.length; i += 4) {
    data[i + 3] = data[i + 3] >= 128 ? 255 : 0;
    if (!data[i + 3]) data[i] = data[i + 1] = data[i + 2] = 0;
  }
  const width = Math.min(320, Math.round(bounds.width * 720 / bounds.height));
  if (width >= 380) throw new Error('Figure exceeds column');
  const resized = await sharp(data, { raw: info }).extract(bounds)
    .resize(width, 720, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();
  let sum = 0, count = 0;
  // Centre on the upper body, excluding the swinging legs.
  for (let y = 155; y < 270; y++) for (let x = 0; x < width; x++) {
    if (resized[(y * width + x) * 4 + 3] >= 128) { sum += x; count++; }
  }
  const centre = Math.round(sum / count);
  const left = 192 - centre;
  if (left < 1 || left + width >= 384) throw new Error('Insufficient transparent margin: ' + JSON.stringify({file, column, left, width, centre}));
  for (let i = 0; i < resized.length; i += 4) {
    if (resized[i + 3] <= 8) resized[i] = resized[i + 1] = resized[i + 2] = resized[i + 3] = 0;
    else if (resized[i + 3] >= 245) resized[i + 3] = 255;
  }
  return {
    input: await sharp(resized, { raw: { width, height: 720, channels: 4 } }).png().toBuffer(),
    left, top: 241, width, sourceBounds: bounds, centre
  };
}
async function strip(name, sources) {
  const frames = [];
  for (const source of sources) frames.push(await frame(...source));
  const file = path.join(root, name);
  await sharp({ create: { width: 1536, height: 1024, channels: 4, background: '#00000000' } })
    .composite(frames.map((f, k) => ({ input: f.input, left: 384 * k + f.left, top: f.top })))
    .png().toFile(file);
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const measurements = [];
  for (let k = 0; k < 4; k++) {
    const c = await sharp(file).extract({ left: 384 * k, top: 0, width: 384, height: 1024 }).raw().toBuffer();
    const bounds = box(c, 384, 1024, 1);
    if (bounds.top + bounds.height - 1 !== 960) throw new Error('Baseline error');
    const tiny = await sharp(frames[k].input).resize({ height: 9 }).png().toBuffer();
    await sharp(tiny).toFile(path.join(root, 'review', name.replace('.png', '-f' + k + '-9px.png')));
    measurements.push({ frame: k, anchor: [192 + 384 * k, 960], bounds, sourceBounds: frames[k].sourceBounds, nativePreviewHeight: 9 });
  }
  if (info.channels !== 4 || data[3] !== 0) throw new Error('RGBA/transparency error');
  report[name] = { canvas: [1536, 1024], rgba: true, frames: measurements };
}
(async () => {
  fs.mkdirSync(path.join(root, 'review'), { recursive: true });
  await strip('passenger-front-walk.png', [['front.png', 0], ['front.png', 1], ['front-contact.png'], ['front.png', 3]]);
  await strip('passenger-back-walk.png', [['back.png', 0], ['back.png', 1], ['back-contact.png'], ['back-passing.png']]);
  fs.writeFileSync(path.join(root, 'passenger-qa.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
