#!/usr/bin/env node
/**
 * Render asset programs to sprite frames, then pack them into the atlases the game loads.
 *
 *   node tools/render-assets.mjs                 # every asset in the manifest
 *   node tools/render-assets.mjs structures      # one group
 *
 * For each asset it runs `art-src/render_asset.py` in its own Blender process (one asset per
 * process is the reset boundary), captures the anchor the render prints, writes the group's
 * `art-src/<group>/atlas.json`, and finally runs `tools/pack-atlas.mjs` per touched group so the
 * result lands in `public/assets/<group>.{png,json}`. Requires `bpy` on the Python path
 * (`pip install bpy`); the game itself never depends on any of this.
 *
 * Frames render at PX_PER_TILE (default 64) so a sprite matches the tile's world scale and drops
 * straight onto the grid. Raising it is the "art scale" engine change, made once, everywhere.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pixelate } from './pixelate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Match the engine's art scale: iso.ts ships ART_SCALE 2, i.e. a 128 px tile. The bake renders at
// the same density so a baked frame drops onto the grid beside a generated one.
const PX_PER_TILE = Number(process.env.PX_PER_TILE ?? 128);
const PY = process.env.PYTHON ?? 'python3';

/**
 * The manifest: which asset program renders which atlas frame key.
 *
 * `variants: n` renders the program n times, passing 0..n-1 as the variant, and appends `_0`..
 * `_{n-1}` to the key. That is how the props keep the three silhouettes per family the art
 * direction requires, from one program each.
 */
const ASSETS = [
  { module: 'art-src/structures/station.py', key: 'structures/station_1' },
  { module: 'art-src/structures/windmill.py', key: 'structures/windmill' },
  { module: 'art-src/structures/townhouse.py', key: 'structures/townhouse' },
  { module: 'art-src/structures/warehouse.py', key: 'structures/warehouse_1' },
  { module: 'art-src/structures/water_tower.py', key: 'structures/water_tower' },
  { module: 'art-src/structures/fuel_stop.py', key: 'structures/fuel_stop' },
  { module: 'art-src/structures/kiln.py', key: 'structures/kiln' },
  { module: 'art-src/structures/pump.py', key: 'structures/pump_1' },
  { module: 'art-src/structures/lumber.py', key: 'structures/lumber_1' },
  { module: 'art-src/props/tree.py', key: 'props/tree', variants: 3 },
  { module: 'art-src/props/oak.py', key: 'props/oak', variants: 3 },
  { module: 'art-src/props/birch.py', key: 'props/birch', variants: 3 },
  { module: 'art-src/props/pine.py', key: 'props/pine', variants: 3 },
  { module: 'art-src/props/spruce.py', key: 'props/spruce', variants: 3 },
  { module: 'art-src/props/bush.py', key: 'props/bush', variants: 3 },
  { module: 'art-src/props/deadtree.py', key: 'props/deadtree', variants: 2 },
  { module: 'art-src/props/rock.py', key: 'props/rock', variants: 3 },
  { module: 'art-src/props/boulder.py', key: 'props/boulder', variants: 3 },
];

/** Expand `variants` into one render each, so the loop below only ever sees a single frame. */
const FRAMES = ASSETS.flatMap(({ module, key, variants }) =>
  variants === undefined
    ? [{ module, key, variant: 0 }]
    : Array.from({ length: variants }, (_, v) => ({ module, key: `${key}_${v}`, variant: v })),
);

function group(key) {
  return key.split('/')[0];
}
function basename(key) {
  return key.split('/').slice(1).join('_');
}

const want = process.argv.slice(2);
const assets = want.length ? FRAMES.filter((a) => want.includes(group(a.key))) : FRAMES;
if (!assets.length) {
  console.error(`no assets for: ${want.join(', ') || '(all)'}`);
  process.exit(2);
}

const anchors = {}; // group -> { frameKey: {ax, ay} }
for (const { module, key, variant } of assets) {
  const g = group(key);
  const outDir = join(ROOT, 'art-src', g);
  mkdirSync(outDir, { recursive: true });
  const png = join(outDir, `${basename(key)}.png`);
  const modPath = join(ROOT, module);
  if (!existsSync(modPath)) throw new Error(`missing asset program: ${module}`);
  process.stdout.write(`render ${key} ... `);
  const log = execFileSync(
    PY,
    [join(ROOT, 'art-src', 'render_asset.py'), modPath, png, String(PX_PER_TILE), String(variant)],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  const read = (tag) => {
    const m = new RegExp(`${tag} (\\{.*\\})`).exec(log);
    if (!m) throw new Error(`no ${tag} from ${module}:\n${log}`);
    return JSON.parse(m[1]);
  };
  const anchor = read('ANCHOR');
  const { r: shadowR } = read('SHADOW');
  // Cycles renders smooth and full-colour; band it into the game's hard-edged, palette-limited
  // medium before the packer ever sees it, so a baked frame sits beside a generated one. The
  // shadow follows the snap, because it is the one thing that stays translucent.
  pixelate(png, {
    palette: read('PALETTE'),
    materials: read('MATERIALS'),
    idPath: join(outDir, 'id', `${basename(key)}.png`),
    // the cluster noise varies per frame, so two variants of a family do not share a pattern
    seed: [...key].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7),
    shadow: {
      // the procedural props centre the ellipse one pixel below the anchor row (src/art/props.ts)
      cx: anchor.ax,
      cy: anchor.ay + PX_PER_TILE / 64,
      rx: shadowR,
      scale: PX_PER_TILE / 64,
    },
  });
  (anchors[g] ??= {})[key] = anchor;
  console.log('ok');
}

for (const [g, frames] of Object.entries(anchors)) {
  // atlas.json carries the untrimmed anchor per frame; pack-atlas trims and corrects it
  writeFileSync(join(ROOT, 'art-src', g, 'atlas.json'), JSON.stringify({ frames }, null, 2) + '\n');
  process.stdout.write(`pack ${g} ... `);
  execFileSync(process.execPath, [join(ROOT, 'tools', 'pack-atlas.mjs'), g], { stdio: 'inherit' });
}
