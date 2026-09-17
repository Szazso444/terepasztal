#!/usr/bin/env node
/**
 * Bake reference crops straight into sprite frames.
 *
 *   node tools/bake-refs.mjs props
 *
 * The third route into the atlas, beside an asset program and an imported mesh. The concept
 * boards in docs/art-direction already contain the object, drawn: `scratchpad/extract-refs.mjs`
 * cuts it out, this brings it down to the tile's scale and puts it through the same pixel medium
 * the rendered assets go through -- the palette, the contour, the ground shadow -- so a frame from
 * this route sits beside one from the others.
 *
 * It keeps everything a render throws away: the oak's gnarled bole, the birch's fine branching,
 * the dead tree's twigs. What it cannot do is produce anything the board did not draw. There is
 * one facing, one lighting, and exactly the variants the board happened to contain, so it suits
 * static scenery and cannot touch rolling stock, which needs 25 facings of the same vehicle.
 *
 * Sizes come from docs/art-direction/frame-inventory.json, scaled by ART_SCALE, so a baked
 * reference lands on the tile at the same size as the sprite it replaces.
 *
 * The two routes compose rather than compete. Run this after `tools/render-assets.mjs <group>`
 * and it overlays the rendered frames wherever a reference exists, leaving everything else as the
 * programs rendered it.
 *
 * The board draws two specimens per family and the game asks for three, and mixing the two
 * sources *inside* one family is worse than either alone -- a drawn birch beside a modelled one
 * reads as a mistake. So a family with any reference gets all of its variants from the board: the
 * missing one is a sibling mirrored and taken to its own size, which is the same trick the
 * renderer already plays on rolling stock, and gives a different silhouette rather than a copy.
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pixelate } from './pixelate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ART_SCALE = 2; // src/engine/iso.ts
const REF = join(ROOT, 'art-src', 'ref');

const group = process.argv[2];
if (!group) {
  console.error('usage: node tools/bake-refs.mjs <group>');
  process.exit(2);
}

const inventory = JSON.parse(
  readFileSync(join(ROOT, 'docs', 'art-direction', 'frame-inventory.json'), 'utf8'),
);
const size = Object.fromEntries(inventory.filter((f) => f.group === group).map((f) => [f.key, f]));
// the kit's ramps, from the same place the rendered route gets them
const palette = JSON.parse(
  /PALETTE (\{.*\})/.exec(
    execFileSync(
      process.env.PYTHON ?? 'python3',
      [join(ROOT, 'art-src', 'render_asset.py'), '--palette'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ),
  )[1],
);

/** Box filter with alpha weighting, so a downscaled edge does not smear the paper back in. */
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
      const j1 = Math.max(Math.floor(y * sy) + 1, Math.floor((y + 1) * sy));
      const i1 = Math.max(Math.floor(x * sx) + 1, Math.floor((x + 1) * sx));
      for (let j = Math.floor(y * sy); j < j1; j++)
        for (let i = Math.floor(x * sx); i < i1; i++) {
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

// straight into the group's render directory, over the top of what the programs produced
/** Every reference this group has, by frame key. */
const refs = {};
for (const file of readdirSync(REF).filter((f) => f.endsWith('.png') && f !== 'index.png')) {
  refs[`${group}/${file.replace(/^.*?_/, '').replace(/\.png$/, '')}`] = join(REF, file);
}
const family = (key) => key.replace(/_\d+$/, '');
const covered = new Set(Object.keys(refs).map(family));
/** For a key with no reference, a sibling of the same family to mirror; undefined if none. */
function sibling(key) {
  if (refs[key] || !covered.has(family(key))) return undefined;
  const sibs = Object.keys(refs).filter((k) => family(k) === family(key));
  return sibs[key.charCodeAt(key.length - 1) % sibs.length];
}

const outDir = join(ROOT, 'art-src', group);
mkdirSync(outDir, { recursive: true });
const atlasPath = join(outDir, 'atlas.json');
const frames = existsSync(atlasPath) ? JSON.parse(readFileSync(atlasPath, 'utf8')).frames : {};
let n = 0;
let mirrored = 0;

/** Flip an image left to right. */
function mirror(src) {
  const dst = new PNG({ width: src.width, height: src.height });
  for (let y = 0; y < src.height; y++)
    for (let x = 0; x < src.width; x++) {
      const s = (y * src.width + (src.width - 1 - x)) * 4;
      const d = (y * src.width + x) * 4;
      for (let k = 0; k < 4; k++) dst.data[d + k] = src.data[s + k];
    }
  return dst;
}
for (const key of Object.keys(size)) {
  const want = size[key];
  const own = refs[key];
  const from = own ?? (sibling(key) && refs[sibling(key)]);
  if (!from) continue;
  const src = own ? PNG.sync.read(readFileSync(from)) : mirror(PNG.sync.read(readFileSync(from)));
  if (!own) mirrored++;
  // match the sprite's height and keep the drawing's own proportions
  const h = want.height * ART_SCALE;
  const w = Math.max(1, Math.round((src.width / src.height) * h));
  const out = join(outDir, `${key.split('/').slice(1).join('_')}.png`);
  writeFileSync(out, PNG.sync.write(resize(src, w, h)));
  pixelate(out, { palette, alphaCut: 120, outline: false });
  // the board draws each specimen standing on its own base, so the ground contact is the bottom
  // of what it drew, and the anchor is the horizontal middle of that
  frames[key] = { ax: Math.round(w / 2), ay: h - 1 };
  n++;
}
writeFileSync(atlasPath, `${JSON.stringify({ frames }, null, 2)}\n`);
const total = Object.keys(frames).length;
console.log(
  `bake-refs: ${n} from the board (${mirrored} mirrored from a sibling), ` +
    `${total - n} left as rendered -> ${outDir}`,
);
execFileSync(process.execPath, [join(ROOT, 'tools', 'pack-atlas.mjs'), group], {
  stdio: 'inherit',
});
