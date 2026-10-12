#!/usr/bin/env node
/**
 * Composes the finished pictures on a real game capture, each on its own tile as the game draws
 * separate sprites, into review/final-on-game-z1.png and review/final-on-game-z2.png.
 *
 *   node assets/source/roads-2026-10-11/review-on-game.mjs [--pictures <dir>] [--out <prefix>]
 *
 * --pictures  the folder with the 19 pictures [this folder]
 * --out       the output path without "-z1.png" [review/final-on-game in this folder]
 *
 * The backgrounds are review/game-capture-z1.png and -z2.png, crops of a capture of the game at
 * zoom 1 and 2 described in review/game-capture.json: grass, with the regular track along tile
 * x on row 75 and the narrow track along tile y on column 88. A picture's canvas has 8 / zoom
 * canvas pixels per screen pixel, so each picture is reduced on its own (a premultiplied box
 * filter, as a sprite is filtered from its own texture) and laid over the capture back to front
 * with its anchor (512, 832) on its tile's centre. Where neighbouring pictures do not meet, the
 * grass shows through, so a seam shows as it would in the game.
 *
 * The network uses every road piece: a 3x3 block of the four curves, the four tees and a cross,
 * whose second cross leads a road south over the regular track (crossing-regular-r1), round a
 * curve and east past a tee (its branch ends at once) over the narrow track (crossing-narrow-r0)
 * to an end; and an L from an end round a curve over the regular track to an end. The other two
 * crossings (regular r0, narrow r1) need track the capture does not have; check-final.mjs puts
 * them in review/final-network.png on flat grass.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '');
  if (!['pictures', 'out'].includes(key) || process.argv[i + 1] === undefined)
    throw new Error(`unknown option or missing value: ${process.argv[i]} (see the header)`);
  args[key] = process.argv[i + 1];
}
const PICTURES = resolve(args.pictures ?? ROOT);
const OUT = resolve(args.out ?? `${ROOT}/review/final-on-game`);
const capture = JSON.parse(readFileSync(`${ROOT}/review/game-capture.json`, 'utf8'));
const geometry = JSON.parse(readFileSync(`${ROOT}/geometry.json`, 'utf8'));
const [AX, AY] = geometry.anchor;
// Canvas kept round the anchor: the diamond (+-256, +-128) and room for the bleed.
const CW = 280,
  CH = 152;

// [tx, ty, picture], map tiles.
const NETWORK = [
  [84, 71, 'road-curve-se-sw'],
  [85, 71, 'road-tee-closed-ne'],
  [86, 71, 'road-curve-sw-nw'],
  [84, 72, 'road-tee-closed-nw'],
  [85, 72, 'road-cross'],
  [86, 72, 'road-tee-closed-se'],
  [84, 73, 'road-curve-ne-se'],
  [85, 73, 'road-cross'],
  [86, 73, 'road-curve-nw-ne'],
  [85, 74, 'road-straight-y'],
  [85, 75, 'crossing-regular-r1'],
  [85, 76, 'road-straight-y'],
  [85, 77, 'road-curve-ne-se'],
  [86, 77, 'road-straight-x'],
  [87, 77, 'road-tee-closed-sw'],
  [87, 76, 'road-end-sw'],
  [88, 77, 'crossing-narrow-r0'],
  [89, 77, 'road-end-nw'],
  [89, 73, 'road-end-se'],
  [90, 73, 'road-curve-sw-nw'],
  [90, 74, 'road-straight-y'],
  [90, 75, 'crossing-regular-r1'],
  [90, 76, 'road-end-ne'],
];

const reduced = new Map();
/** The picture round its anchor, reduced S x S, premultiplied RGBA 0..1. */
function piece(id, S) {
  const key = `${id}/${S}`;
  if (reduced.has(key)) return reduced.get(key);
  const png = PNG.sync.read(readFileSync(`${PICTURES}/${id}.png`));
  const w = (2 * CW) / S,
    h = (2 * CH) / S,
    data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let dy = 0; dy < S; dy++)
        for (let dx = 0; dx < S; dx++) {
          const i = ((AY - CH + y * S + dy) * png.width + AX - CW + x * S + dx) * 4,
            a = png.data[i + 3] / 255;
          for (let c = 0; c < 3; c++) data[o + c] += (png.data[i + c] / 255) * a;
          data[o + 3] += a;
        }
      for (let c = 0; c < 4; c++) data[o + c] /= S * S;
    }
  const out = { w, h, data };
  reduced.set(key, out);
  return out;
}

const order = [...NETWORK].sort((p, q) => p[0] + p[1] - q[0] - q[1] || p[0] - q[0]);
for (const shot of capture.shots) {
  const bg = PNG.sync.read(readFileSync(`${ROOT}/review/${shot.file}`));
  const { width: W, height: H } = bg;
  const img = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H; i++)
    for (let c = 0; c < 3; c++) img[i * 3 + c] = bg.data[i * 4 + c] / 255;
  const S = 8 / shot.zoom;
  for (const [tx, ty, id] of order) {
    const cx = shot.tile00Centre[0] + tx * shot.stepTx[0] + ty * shot.stepTy[0] - shot.box[0],
      cy = shot.tile00Centre[1] + tx * shot.stepTx[1] + ty * shot.stepTy[1] - shot.box[1];
    const p = piece(id, S),
      ox = cx - CW / S,
      oy = cy - CH / S;
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        const X = ox + x,
          Y = oy + y;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const s = (y * p.w + x) * 4,
          d = (Y * W + X) * 3;
        for (let c = 0; c < 3; c++) img[d + c] = p.data[s + c] + img[d + c] * (1 - p.data[s + 3]);
      }
  }
  const out = new PNG({ width: W, height: H });
  for (let i = 0; i < W * H; i++) {
    for (let c = 0; c < 3; c++) out.data[i * 4 + c] = Math.round(img[i * 3 + c] * 255);
    out.data[i * 4 + 3] = 255;
  }
  const file = `${OUT}-z${shot.zoom}.png`;
  writeFileSync(file, PNG.sync.write(out));
  console.log(`wrote ${file} (${W}x${H})`);
}
