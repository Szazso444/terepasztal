#!/usr/bin/env node
/**
 * Export asset programs to glTF for the runtime 3D renderer (route 3).
 *
 *   node tools/export-models.mjs
 *
 * The same programs the sprite bake renders (tools/render-assets.mjs) are exported to
 * `public/models/<key>.glb` here, so both renderers draw from one library. Requires `bpy`
 * (`pip install bpy`). The .glb files are build output and are gitignored.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PY = process.env.PYTHON ?? 'python3';

/** Same manifest shape as the sprite bake: program -> key. */
const ASSETS = [{ module: 'art-src/structures/station.py', key: 'structures/station_1' }];

mkdirSync(join(ROOT, 'public', 'models'), { recursive: true });
for (const { module, key } of ASSETS) {
  const out = join(ROOT, 'public', 'models', `${key.replace('/', '_')}.glb`);
  process.stdout.write(`export ${key} ... `);
  execFileSync(PY, [join(ROOT, 'art-src', 'export_asset.py'), join(ROOT, module), out], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  console.log('ok');
}
