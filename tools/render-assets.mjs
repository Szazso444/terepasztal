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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PX_PER_TILE = Number(process.env.PX_PER_TILE ?? 64);
const PY = process.env.PYTHON ?? 'python3';

/** The manifest: which asset program renders which atlas frame key. */
const ASSETS = [
  { module: 'art-src/structures/station.py', key: 'structures/station_1' },
  { module: 'art-src/structures/windmill.py', key: 'structures/windmill' },
  { module: 'art-src/structures/townhouse.py', key: 'structures/townhouse' },
];

function group(key) {
  return key.split('/')[0];
}
function basename(key) {
  return key.split('/').slice(1).join('_');
}

const want = process.argv.slice(2);
const assets = want.length ? ASSETS.filter((a) => want.includes(group(a.key))) : ASSETS;
if (!assets.length) {
  console.error(`no assets for: ${want.join(', ') || '(all)'}`);
  process.exit(2);
}

const anchors = {}; // group -> { frameKey: {ax, ay} }
for (const { module, key } of assets) {
  const g = group(key);
  const outDir = join(ROOT, 'art-src', g);
  mkdirSync(outDir, { recursive: true });
  const png = join(outDir, `${basename(key)}.png`);
  const modPath = join(ROOT, module);
  if (!existsSync(modPath)) throw new Error(`missing asset program: ${module}`);
  process.stdout.write(`render ${key} ... `);
  const log = execFileSync(
    PY,
    [join(ROOT, 'art-src', 'render_asset.py'), modPath, png, String(PX_PER_TILE)],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  const m = /ANCHOR (\{.*\})/.exec(log);
  if (!m) throw new Error(`no anchor from ${module}:\n${log}`);
  (anchors[g] ??= {})[key] = JSON.parse(m[1]);
  console.log('ok');
}

for (const [g, frames] of Object.entries(anchors)) {
  // atlas.json carries the untrimmed anchor per frame; pack-atlas trims and corrects it
  writeFileSync(join(ROOT, 'art-src', g, 'atlas.json'), JSON.stringify({ frames }, null, 2) + '\n');
  process.stdout.write(`pack ${g} ... `);
  execFileSync(process.execPath, [join(ROOT, 'tools', 'pack-atlas.mjs'), g], { stdio: 'inherit' });
}
