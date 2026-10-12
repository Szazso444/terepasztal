import fs from 'node:fs';
import { PNG } from 'pngjs';
const d = 'assets/source/bridges-narrow-2026-10-11/';
const read = (f) => PNG.sync.read(fs.readFileSync(f));
// Review composites only: never modify the source PNG.
function blit(dst, src, ox, oy, scale = 1) {
  for (let y = 0; y < Math.round(src.height * scale); y++)
    for (let x = 0; x < Math.round(src.width * scale); x++) {
      const sx = Math.min(src.width - 1, Math.floor(x / scale)),
        sy = Math.min(src.height - 1, Math.floor(y / scale));
      const i = (sy * src.width + sx) * 4,
        j = ((y + oy) * dst.width + x + ox) * 4;
      const a = src.data[i + 3] / 255,
        b = dst.data[j + 3] / 255,
        c = a + b * (1 - a);
      if (!c) continue;
      for (let k = 0; k < 3; k++)
        dst.data[j + k] = (src.data[i + k] * a + dst.data[j + k] * b * (1 - a)) / c;
      dst.data[j + 3] = c * 255;
    }
}
const p = read(d + 'raw/stone-deck-x-narrow-attempt-3.png'),
  s = p.width / 1024;
const joint = new PNG({
  width: p.width + 2 * Math.round(480 * s),
  height: p.height + 2 * Math.round(240 * s),
});
for (let n = 0; n < 3; n++) blit(joint, p, n * Math.round(480 * s), n * Math.round(240 * s));
fs.writeFileSync(d + 'review/stone-x-repaint-three-tiles.png', PNG.sync.write(joint));
const preview = new PNG({ width: 270, height: 100 });
preview.data.fill(0);
blit(preview, p, 0, 0, 64 / (960 * s));
// Scale reference-only previews by their measured one-tile long-axis span.
function longSpan(image, mirrored = false) {
  let left = image.width,
    right = -1,
    bottom = -1;
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++)
      if (image.data[(y * image.width + x) * 4 + 3] > 128) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
  let sum = 0,
    n = 0;
  for (let x = left; x <= right; x++)
    if (image.data[(bottom * image.width + x) * 4 + 3] > 128) {
      sum += x;
      n++;
    }
  return mirrored ? right - sum / n : sum / n - left;
}
const stoneY = read(d + 'stone-deck-y-narrow.png');
const fullX = read('assets/source/bridges-v1/stone-deck-x.png');
blit(preview, stoneY, 90, 0, 32 / longSpan(stoneY, true));
blit(preview, fullX, 180, 0, 32 / longSpan(fullX));
fs.writeFileSync(d + 'review/stone-x-repaint-game-scale.png', PNG.sync.write(preview));
