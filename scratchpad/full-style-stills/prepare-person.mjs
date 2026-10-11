import fs from 'node:fs';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { trimSource, resample } from '../../tools/illustrated-sprites.mjs';
const dir = new URL('./assets/', import.meta.url);
fs.mkdirSync(dir, { recursive: true });
const original = new URL('passenger-source-v1.png', dir);
if (!fs.existsSync(original))
  fs.copyFileSync(
    'C:/Users/Zso/.codex/generated_images/01a0d5dc-73ec-76f3-b6fb-8fe6e7e1e1be/exec-1231ac91-9e08-4eb8-9db2-bdc720f68215.png',
    original,
  );
const source = PNG.sync.read(fs.readFileSync(original));
assert.equal(source.data[3], 0, 'Generated passenger requires transparent margins');
const trimmed = trimSource(source),
  height = 44,
  width = Math.round((trimmed.width / trimmed.height) * height);
const sprite = resample(trimmed, width, height);
const atlas = new PNG({ width: width + 4, height: height + 4 });
PNG.bitblt(sprite, atlas, 0, 0, width, height, 2, 2);
fs.writeFileSync(new URL('people.png', dir), PNG.sync.write(atlas));
fs.writeFileSync(
  new URL('people.json', dir),
  JSON.stringify(
    {
      resolution: 4,
      partial: true,
      frames: {
        'people/walker_0_f0': { x: 2, y: 2, w: width, h: height, ax: width / 2, ay: height },
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ logicalHeight: height / 4, transparent: true, frames: 1 }));
