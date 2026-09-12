#!/usr/bin/env node
/**
 * Packs a folder of rendered PNG frames into an atlas the game can load.
 *
 * Output is `<out>/<group>.png` plus `<out>/<group>.json` in the shape
 * `src/engine/atlas.ts` expects: `{ frames: { "<name>": { x, y, w, h, ax, ay } } }`,
 * where `ax`/`ay` is the anchor in pixels from the frame's top-left.
 *
 *   node tools/pack-atlas.mjs rolling
 *   node tools/pack-atlas.mjs wagons --prefix rolling/ --src art-src/wagons
 *
 * Frame names are the file basenames with `--prefix` in front. The prefix defaults to
 * `<group>/`, but frame keys are global and need not match the group: the `wagons` group
 * supplies keys named `rolling/wagon_*`, so pass `--prefix rolling/` for it.
 *
 * Anchors, in order of precedence:
 *   1. `frames["<name>"].{ax,ay}` in `<src>/atlas.json`
 *   2. `anchor: {ax, ay}` in `<src>/atlas.json`, applied to every frame
 *   3. bottom-centre of the frame
 * Anchors are given against the untrimmed render, and trimming corrects them, so a fixed
 * camera and one `anchor` entry covers a whole group.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { PNG } from 'pngjs';

function parseArgs(argv) {
  const [group, ...rest] = argv;
  if (!group || group.startsWith('--')) {
    console.error('usage: node tools/pack-atlas.mjs <group> [--src DIR] [--out DIR] [--prefix P] [--max N] [--pad N] [--no-trim]');
    process.exit(2);
  }
  const opts = { group, src: `art-src/${group}`, out: 'public/assets', prefix: `${group}/`, max: 1024, pad: 1, trim: true };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--no-trim') opts.trim = false;
    else if (a === '--src') opts.src = rest[++i];
    else if (a === '--out') opts.out = rest[++i];
    else if (a === '--prefix') opts.prefix = rest[++i];
    else if (a === '--max') opts.max = Number(rest[++i]);
    else if (a === '--pad') opts.pad = Number(rest[++i]);
    else {
      console.error(`unknown option: ${a}`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(opts.max) || opts.max < 16) throw new Error('--max must be at least 16');
  if (!Number.isFinite(opts.pad) || opts.pad < 0) throw new Error('--pad must be 0 or more');
  return opts;
}

/** Tight bounds of the non-transparent pixels, or null when the image is empty. */
function opaqueBounds(png) {
  let x0 = png.width;
  let y0 = png.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++)
      if (png.data[(y * png.width + x) * 4 + 3] !== 0) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function blit(dst, src, dx, dy, box) {
  for (let y = 0; y < box.h; y++) {
    const from = ((box.y + y) * src.width + box.x) * 4;
    const to = ((dy + y) * dst.width + dx) * 4;
    src.data.copy(dst.data, to, from, from + box.w * 4);
  }
}

/** Shelf packer: same approach as the in-engine AtlasBuilder, so output looks familiar. */
function shelfPack(items, maxW, pad) {
  const sorted = [...items].sort((a, b) => b.box.h - a.box.h || a.name.localeCompare(b.name));
  let x = pad;
  let y = pad;
  let shelfH = 0;
  let usedW = 0;
  for (const it of sorted) {
    if (x + it.box.w + pad > maxW && shelfH > 0) {
      x = pad;
      y += shelfH + pad;
      shelfH = 0;
    }
    it.x = x;
    it.y = y;
    x += it.box.w + pad;
    shelfH = Math.max(shelfH, it.box.h);
    usedW = Math.max(usedW, x);
  }
  return { w: Math.max(1, usedW), h: Math.max(1, y + shelfH + pad) };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const src = resolve(opts.src);
  if (!existsSync(src)) throw new Error(`no such source folder: ${opts.src}`);

  const metaPath = join(src, 'atlas.json');
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
  const files = readdirSync(src).filter((f) => f.toLowerCase().endsWith('.png')).sort();
  if (!files.length) throw new Error(`no PNG frames in ${opts.src}`);

  const items = [];
  const skipped = [];
  for (const file of files) {
    const name = opts.prefix + basename(file, '.png');
    const png = PNG.sync.read(readFileSync(join(src, file)));
    const box = opts.trim ? opaqueBounds(png) : { x: 0, y: 0, w: png.width, h: png.height };
    if (!box) {
      skipped.push(name);
      continue;
    }
    // Anchor against the untrimmed render, then shifted by whatever the trim cut away.
    const a = meta.frames?.[name] ?? meta.anchor ?? { ax: png.width / 2, ay: png.height };
    items.push({ name, png, box, ax: a.ax - box.x, ay: a.ay - box.y, x: 0, y: 0 });
  }
  if (!items.length) throw new Error(`every frame in ${opts.src} is fully transparent`);

  const size = shelfPack(items, opts.max, opts.pad);
  const sheet = new PNG({ width: size.w, height: size.h });
  sheet.data.fill(0);
  const frames = {};
  for (const it of items) {
    blit(sheet, it.png, it.x, it.y, it.box);
    frames[it.name] = { x: it.x, y: it.y, w: it.box.w, h: it.box.h, ax: it.ax, ay: it.ay };
  }

  mkdirSync(resolve(opts.out), { recursive: true });
  const pngPath = join(resolve(opts.out), `${opts.group}.png`);
  const jsonPath = join(resolve(opts.out), `${opts.group}.json`);
  writeFileSync(pngPath, PNG.sync.write(sheet));
  // Sorted keys so a re-pack of unchanged art produces an unchanged file.
  const ordered = Object.fromEntries(Object.keys(frames).sort().map((k) => [k, frames[k]]));
  writeFileSync(jsonPath, `${JSON.stringify({ frames: ordered }, null, 2)}\n`);

  console.log(`${opts.group}: ${items.length} frames -> ${size.w}x${size.h}`);
  console.log(`  ${pngPath}`);
  console.log(`  ${jsonPath}`);
  if (skipped.length) console.log(`  skipped (fully transparent): ${skipped.join(', ')}`);
}

try {
  main();
} catch (e) {
  console.error(`pack-atlas: ${e.message}`);
  process.exit(1);
}
