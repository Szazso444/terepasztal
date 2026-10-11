// Mechanical export of image_gen paintings at the author's smaller source size.
// NODE_PATH must expose sharp. No scene or character pixels are painted here.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = __dirname;
const W = 768, H = 512, CW = 192, FH = 360, BASE = 480;
function bounds(data, w, h, threshold = 128) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] >= threshold) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (x1 < 0) throw new Error('Empty frame');
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
function cleanMask(data, w, h) {
  const n = w * h, seen = new Uint8Array(n), queue = new Int32Array(n);
  const components = [];
  for (let start = 0; start < n; start++) {
    if (seen[start] || data[start * 4 + 3] < 128) continue;
    let read = 0, end = 1; queue[0] = start; seen[start] = 1;
    while (read < end) {
      const p = queue[read++], x = p % w, y = Math.floor(p / w);
      for (const q of [x ? p-1 : -1, x+1 < w ? p+1 : -1, y ? p-w : -1, y+1 < h ? p+w : -1]) {
        if (q >= 0 && !seen[q] && data[q*4+3] >= 128) { seen[q] = 1; queue[end++] = q; }
      }
    }
    components.push(Array.from(queue.subarray(0, end)));
  }
  components.sort((a,b) => b.length-a.length);
  if (!components.length) throw new Error('No figure');
  const keep = new Uint8Array(n);
  // Preserve substantial detached tool/bucket portions; discard stray edge fragments.
  for (const c of components) if (c.length >= components[0].length * 0.012) for (const p of c) keep[p] = 1;
  for (let p = 0; p < n; p++) {
    data[p*4+3] = keep[p] ? 255 : 0;
    if (!keep[p]) data[p*4] = data[p*4+1] = data[p*4+2] = 0;
  }
  return components.map(c => c.length);
}
async function pack(entry) {
  entry = { ...entry, generatedPath:path.resolve(root,entry.generatedPath) };
  const meta = await sharp(entry.generatedPath).metadata();
  const sw = Math.floor(meta.width / 4), frames = [], notes = [];
  if (meta.width % 4) notes.push('working canvas width rounded to four equal source columns');
  for (let k = 0; k < 4; k++) {
    const { data, info } = await sharp(entry.generatedPath).ensureAlpha().extract({ left:k*sw, top:0, width:sw, height:meta.height }).raw().toBuffer({ resolveWithObject:true });
    const componentAreas = cleanMask(data, sw, meta.height);
    const box = bounds(data, sw, meta.height);
    if (box.left === 0 || box.left + box.width === sw) notes.push('frame ' + k + ': source silhouette touches column edge; inspect for clipping');
    const rw = Math.min(176, Math.round(box.width * FH / box.height));
    if (rw < Math.round(box.width * FH / box.height)) notes.push('frame ' + k + ': width constrained to fit column');
    const pixels = await sharp(data, { raw:info }).extract(box).resize(rw, FH, { fit:'fill', kernel:'lanczos3' }).raw().toBuffer();
    for (let p = 0; p < pixels.length; p += 4) {
      if (pixels[p+3] <= 8) pixels[p] = pixels[p+1] = pixels[p+2] = pixels[p+3] = 0;
      else if (pixels[p+3] >= 245) pixels[p+3] = 255;
    }
    // Centre the complete silhouette; keep all tool tips inside the frame.
    const left = Math.round((CW-rw)/2), top = BASE-FH+1;
    const png = await sharp(pixels, { raw:{ width:rw, height:FH, channels:4 } }).png().toBuffer();
    const tiny = await sharp(png).resize({ height:9 }).png().toBuffer();
    fs.mkdirSync(path.join(root,'review','native'), { recursive:true });
    await sharp(tiny).toFile(path.join(root,'review','native',entry.id+'-f'+k+'-9px.png'));
    frames.push({ input:png, left:k*CW+left, top, sourceBounds:box, componentAreas, width:rw });
  }
  await sharp({ create:{ width:W, height:H, channels:4, background:'#00000000' } }).composite(frames.map(({input,left,top})=>({input,left,top}))).png().toFile(path.join(root,entry.file));
  const measurements = [];
  for (let k = 0; k < 4; k++) {
    const { data } = await sharp(path.join(root,entry.file)).extract({ left:k*CW, top:0, width:CW, height:H }).raw().toBuffer({ resolveWithObject:true });
    const b = bounds(data, CW, H, 1);
    if (b.top+b.height-1 !== BASE) throw new Error(entry.id + ': baseline');
    if (b.left < 1 || b.left+b.width >= CW) throw new Error(entry.id + ': final clipping');
    measurements.push({ frame:k, anchor:[CW*k+CW/2,BASE], bounds:b, sourceBounds:frames[k].sourceBounds });
  }
  return { canvas:[W,H], rgba:true, phaseCount:4, figureHeight:FH, gameHeight:9, frames:measurements, notes, visualReview:'pending' };
}
(async()=>{
  const manifest = JSON.parse(fs.readFileSync(path.join(root,'generation-manifest.json'),'utf8'));
  const oldPath = path.join(root,'variations-qa.json');
  const report = fs.existsSync(oldPath) ? JSON.parse(fs.readFileSync(oldPath,'utf8')) : {};
  const ids = process.argv.slice(2);
  for (const entry of manifest) if (!ids.length || ids.includes(entry.id)) {
    report[entry.id] = await pack(entry);
    console.log(entry.id + ': exported; ' + report[entry.id].notes.join('; '));
  }
  fs.writeFileSync(oldPath, JSON.stringify(report,null,2)+'\n');
})().catch(error=>{ console.error(error); process.exitCode=1; });
