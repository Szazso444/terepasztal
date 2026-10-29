#!/usr/bin/env node
/**
 * Packs the painted track materials (specs/codex-track-lines.txt) for the track generator
 * (src/art/trackMaterials.ts): halves every picture from 512 to 256 px per tile, and makes the
 * strips (bed, edge) repeat every tile instead of every two, since one frame of straight track is
 * one tile long and must meet itself: the first tile of the strip is kept, and a narrow band at its
 * start is cross-faded into the strip's continuation past the tile, so the seam is the strip's own.
 *
 * Run: node tools/track-materials.mjs <track-art folder> [out folder]
 * The out folder defaults to public/assets/track-materials.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { isMain } from './is-main.mjs';

const LINES = ['narrow', 'branch', 'main', 'trunk'];
/** Files each line may have; the strips repeat along the track. */
const STRIPS = ['bed', 'edge'];
const SINGLES = ['sleeper', 'tufts', 'post'];
/** px per tile in the painted pictures and in the packed ones */
const SRC_PX = 512;
const OUT_PX = 256;
/** px of the packed strip cross-faded at its seam */
const SEAM = 24;

/** Halve a picture with a 2x2 box filter, alpha-weighted so transparent texels lend no colour. */
function half(png) {
  const w = Math.max(1, Math.floor(png.width / 2)),
    h = Math.max(1, Math.floor(png.height / 2));
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const sx = Math.min(png.width - 1, 2 * x + dx),
            sy = Math.min(png.height - 1, 2 * y + dy);
          const i = (sy * png.width + sx) * 4;
          const al = png.data[i + 3];
          r += png.data[i] * al;
          g += png.data[i + 1] * al;
          b += png.data[i + 2] * al;
          a += al;
        }
      const o = (y * w + x) * 4;
      out.data[o] = a ? Math.round(r / a) : 0;
      out.data[o + 1] = a ? Math.round(g / a) : 0;
      out.data[o + 2] = a ? Math.round(b / a) : 0;
      out.data[o + 3] = Math.round(a / 4);
    }
  return out;
}

/**
 * One tile of a strip that repeats every `period` px: columns 0..period-1 of the strip, the first
 * SEAM columns blended from the strip's continuation past the period (period + x) into the strip
 * itself, so column 0 continues column period - 1 exactly as the painting does.
 */
export function loopStrip(png, period) {
  const out = new PNG({ width: period, height: png.height });
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < period; x++) {
      const w = x < SEAM ? x / SEAM : 1;
      const a = (y * png.width + x) * 4,
        b = (y * png.width + ((period + x) % png.width)) * 4,
        o = (y * period + x) * 4;
      for (let k = 0; k < 4; k++)
        out.data[o + k] = Math.round(w * png.data[a + k] + (1 - w) * png.data[b + k]);
    }
  return out;
}

export function packMaterials(src, out) {
  const report = {};
  for (const line of LINES) {
    const dir = path.join(src, line);
    if (!fs.existsSync(dir)) continue;
    fs.mkdirSync(path.join(out, line), { recursive: true });
    report[line] = {};
    for (const name of [...STRIPS, ...SINGLES]) {
      const file = path.join(dir, `${name}.png`);
      if (!fs.existsSync(file)) continue;
      let png = half(PNG.sync.read(fs.readFileSync(file)));
      if (STRIPS.includes(name)) png = loopStrip(png, OUT_PX);
      fs.writeFileSync(path.join(out, line, `${name}.png`), PNG.sync.write(png));
      report[line][name] = [png.width, png.height];
    }
  }
  fs.writeFileSync(
    path.join(out, 'materials.json'),
    JSON.stringify({ pxPerTile: OUT_PX, lines: report }, null, 2) + '\n',
  );
  return report;
}

if (isMain(import.meta.url)) {
  const src = process.argv[2];
  if (!src) {
    console.error('usage: node tools/track-materials.mjs <track-art folder> [out folder]');
    process.exit(1);
  }
  const out = process.argv[3] ?? 'public/assets/track-materials';
  console.log(JSON.stringify(packMaterials(src, out), null, 2));
}
