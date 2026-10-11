import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { trimSource, resample } from '../../tools/illustrated-sprites.mjs';
const root = 'scratchpad/building-poc',
  source = 'assets/source/building-poc-v1';
mkdirSync(`${root}/sprites`, { recursive: true });
const read = (p) => PNG.sync.read(readFileSync(p));
function bounds(p) {
  let l = p.width,
    t = p.height,
    r = -1,
    b = -1;
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++)
      if (p.data[(y * p.width + x) * 4 + 3] > 64) {
        l = Math.min(l, x);
        r = Math.max(r, x);
        t = Math.min(t, y);
        b = Math.max(b, y);
      }
  return { l, t, r, b, w: r - l + 1, h: b - t + 1 };
}
const frames = {},
  sheet = new PNG({ width: 1024, height: 640 });
for (const [type, tiles] of [
  ['house', 1],
  ['station', 2],
])
  for (let rotation = 0; rotation < 4; rotation++) {
    const key = `${type}-${rotation}`,
      raw = read(`${source}/${key}.png`),
      clean = trimSource(raw),
      guide = bounds(read(`${root}/guides/${key}.png`));
    const targetW = (guide.w * 52) / 170,
      targetH = (guide.h * 70) / 220;
    const scale = Math.min(targetW / clean.width, targetH / clean.height);
    const w = Math.round(clean.width * scale * 4),
      h = Math.round(clean.height * scale * 4);
    const sprite = resample(clean, w, h);
    writeFileSync(`${root}/sprites/${key}.png`, PNG.sync.write(sprite));
    // Keep the ground centre from the guide, align the bottom, preserve source aspect ratio.
    const centreOffset = (((guide.l + guide.r) / 2 - 384) * 52) / 170;
    frames[key] = {
      tiles,
      rotation,
      w: w / 4,
      h: h / 4,
      ax: w / 8 - centreOffset,
      ay: h / 4 - ((guide.b - 540) * 52) / 170,
      source: `${source}/${key}.png`,
      projectionVerified: false,
    };
    const thumbScale = Math.min(240 / clean.width, 300 / clean.height),
      thumb = resample(
        clean,
        Math.round(clean.width * thumbScale),
        Math.round(clean.height * thumbScale),
      );
    const ox = rotation * 256 + Math.floor((256 - thumb.width) / 2),
      oy = (type === 'house' ? 0 : 320) + 310 - thumb.height;
    PNG.bitblt(thumb, sheet, 0, 0, thumb.width, thumb.height, ox, oy);
  }
writeFileSync(`${root}/sprites/manifest.json`, JSON.stringify({ density: 4, frames }, null, 2));
writeFileSync(`${root}/sprites/contact-sheet.png`, PNG.sync.write(sheet));
console.log('Eight sprites built with guide-derived anchors and uniform scaling.');
