/**
 * Reference beside bake, at the same height, for every frame that has one.
 *
 *   node scratchpad/art-ref-compare.mjs props out.png [zoom]
 *
 * The reference crops from scratchpad/extract-refs.mjs are two or three times the size of the
 * sprite they inform, so comparing them honestly means bringing the reference down to the bake's
 * height first. Whatever survives that downscale is what the sprite is actually being asked to
 * carry; whatever does not was never going to make it into the atlas.
 *
 * The number under each pair is silhouette agreement: intersection over union of the two alpha
 * masks, after the reference is scaled to the bake's box. It is a blunt measure and it is meant
 * to be -- it catches a shape that is the wrong proportion or the wrong mass, not a shade.
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const [, , group, out, zoomArg] = process.argv;
if (!group || !out) {
  console.error('usage: node scratchpad/art-ref-compare.mjs <group> <out.png> [zoom]');
  process.exit(2);
}
const Z = Number(zoomArg ?? 3);
const atlas = PNG.sync.read(readFileSync(`public/assets/${group}.png`));
const meta = JSON.parse(readFileSync(`public/assets/${group}.json`, 'utf8')).frames;

/** Box-filter an RGBA image down to `w` x `h`, keeping alpha weighted so edges do not smear. */
function resize(src, w, h) {
  const dst = new PNG({ width: w, height: h });
  const sx = src.width / w;
  const sy = src.height / h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (
        let j = Math.floor(y * sy);
        j < Math.max(Math.floor(y * sy) + 1, Math.floor((y + 1) * sy));
        j++
      )
        for (
          let i = Math.floor(x * sx);
          i < Math.max(Math.floor(x * sx) + 1, Math.floor((x + 1) * sx));
          i++
        ) {
          if (i >= src.width || j >= src.height) continue;
          const o = (j * src.width + i) * 4;
          const av = src.data[o + 3] / 255;
          r += src.data[o] * av;
          g += src.data[o + 1] * av;
          b += src.data[o + 2] * av;
          a += av;
          n++;
        }
      const d = (y * w + x) * 4;
      dst.data[d] = a > 0 ? Math.round(r / a) : 0;
      dst.data[d + 1] = a > 0 ? Math.round(g / a) : 0;
      dst.data[d + 2] = a > 0 ? Math.round(b / a) : 0;
      dst.data[d + 3] = Math.round((a / Math.max(1, n)) * 255);
    }
  return dst;
}

const pairs = [];
for (const key of Object.keys(meta).sort()) {
  const file = `art-src/ref/${key.replace('/', '_')}.png`;
  if (!existsSync(file)) continue;
  const f = meta[key];
  const ref = resize(
    PNG.sync.read(readFileSync(file)),
    Math.max(1, Math.round(f.h * 1 * 1)) && f.w,
    f.h,
  );
  // silhouette agreement over the shared box
  let inter = 0;
  let union = 0;
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      const a = ref.data[(y * f.w + x) * 4 + 3] > 110;
      const b = atlas.data[((f.y + y) * atlas.width + (f.x + x)) * 4 + 3] > 110;
      if (a || b) union++;
      if (a && b) inter++;
    }
  pairs.push({ key, f, ref, iou: union ? inter / union : 0 });
}

const COLS = 5;
const cw = Math.max(...pairs.map((p) => p.f.w)) * 2 + 24;
const ch = Math.max(...pairs.map((p) => p.f.h)) + 20;
const rows = Math.ceil(pairs.length / COLS);
const sheet = new PNG({ width: COLS * cw * Z, height: rows * ch * Z });
const W = sheet.width;
for (let i = 0; i < W * sheet.height; i++) {
  const o = i * 4;
  const y = Math.floor(i / W);
  const x = i % W;
  const d = (Math.floor(x / (8 * Z)) + Math.floor(y / (8 * Z))) % 2;
  sheet.data[o] = d ? 112 : 122;
  sheet.data[o + 1] = d ? 134 : 146;
  sheet.data[o + 2] = d ? 70 : 76;
  sheet.data[o + 3] = 255;
}
const blit = (get, w, h, ox, oy) => {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = get(x, y);
      if (!c[3]) continue;
      for (let dy = 0; dy < Z; dy++)
        for (let dx = 0; dx < Z; dx++) {
          const d = (((oy + y) * Z + dy) * W + (ox + x) * Z + dx) * 4;
          for (let k = 0; k < 3; k++)
            sheet.data[d + k] = Math.round((c[k] * c[3] + sheet.data[d + k] * (255 - c[3])) / 255);
        }
    }
};
pairs.forEach((p, i) => {
  const { f, ref } = p;
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const oy = row * ch + (ch - f.h) - 4;
  const lx = col * cw + 6;
  const rx = lx + f.w + 12;
  blit((x, y) => ref.data.subarray((y * f.w + x) * 4, (y * f.w + x) * 4 + 4), f.w, f.h, lx, oy);
  blit(
    (x, y) =>
      atlas.data.subarray(
        ((f.y + y) * atlas.width + (f.x + x)) * 4,
        ((f.y + y) * atlas.width + (f.x + x)) * 4 + 4,
      ),
    f.w,
    f.h,
    rx,
    oy,
  );
});
writeFileSync(out, PNG.sync.write(sheet));
console.log(`${out} ${sheet.width}x${sheet.height} · ${pairs.length} pairs (reference | bake)`);
pairs
  .sort((a, b) => a.iou - b.iou)
  .forEach((p) => console.log(`  ${(p.iou * 100).toFixed(0).padStart(3)}%  ${p.key}`));
