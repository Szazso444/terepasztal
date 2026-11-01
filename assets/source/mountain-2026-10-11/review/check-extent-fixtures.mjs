// Synthetic checker fixtures, not generated paintings or delivery assets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { measure } from '../check-extent.mjs';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp');
fs.mkdirSync(dir, { recursive: true });
const directions = { ne: [0, -1], se: [1, 0], sw: [0, 1], nw: [-1, 0] };
function fixture(edge, width = 1024, opaque = false, wrongStones = false) {
  const png = new PNG({ width, height: width });
  const s = width / 1024,
    [dx, dy] = directions[edge];
  for (let py = 0; py < width; py++)
    for (let px = 0; px < width; px++) {
      const sx = (px + 0.5) / s - 512,
        sy = (py + 0.5) / s - 512;
      const x = (sx / 512 + sy / 256) / 2,
        y = (sy / 256 - sx / 512) / 2;
      const radius = Math.hypot(sx / 724, sy / 362);
      const i = (py * width + px) * 4;
      if (opaque) png.data.set([255, 255, 255, 255], i);
      if (radius > 0.5) continue;
      const stone =
        x * dx + y * dy < 0 && (wrongStones ? radius > 0.22 && radius < 0.3 : radius >= 0.38);
      png.data.set(stone ? [180, 172, 160, 255] : [72, 124, 132, 255], i);
    }
  return png;
}
function run(name, png, edge) {
  const file = path.join(dir, name + '.png');
  fs.writeFileSync(file, PNG.sync.write(png));
  return measure(file, edge).measured;
}
let checks = 0;
for (const edge of Object.keys(directions))
  for (const size of [1024, 1254]) {
    assert.equal(run(edge + size, fixture(edge, size), edge).pass, true);
    checks++;
  }
assert.equal(run('opaque', fixture('ne', 1024, true), 'ne').pass, true);
checks++;
assert.equal(run('wrong-stones', fixture('ne', 1024, false, true), 'ne').checks.stones, false);
checks++;
const spill = fixture('ne');
spill.data.set([180, 172, 160, 255], (800 * 1024 + 512) * 4);
assert.equal(run('lower-spill', spill, 'ne').checks.lowerDiamond, false);
checks++;
const wrongShape = new PNG({ width: 1024, height: 768 });
assert.equal(run('non-square', wrongShape, 'ne').checks.box, false);
checks++;
const upperSpill = fixture('se');
upperSpill.data.set([180, 172, 160, 255], (180 * 1024 + 512) * 4);
assert.equal(run('upper-spill', upperSpill, 'se').checks.upperDiamond, false);
checks++;
const boxSpill = fixture('ne');
boxSpill.data.set([72, 124, 132, 255], (512 * 1024 + 100) * 4);
assert.equal(run('box-spill', boxSpill, 'ne').checks.box, false);
checks++;
const shifted = new PNG({ width: 1024, height: 1024 });
PNG.bitblt(fixture('ne'), shifted, 0, 0, 984, 1024, 40, 0);
assert.equal(run('shifted-centre', shifted, 'ne').checks.centre, false);
checks++;
const result = {
  passed: checks,
  properties: [
    'all four directions',
    'requested and returned scales',
    'opaque corner exclusion',
    'wrong stone radius rejected',
    'lower diamond spill rejected',
    'non-square rejected',
    'upper diamond spill rejected',
    'box enlargement rejected',
    'centre shift rejected',
  ],
};
fs.writeFileSync(
  path.join(dir, '../extent-fixture-results.json'),
  JSON.stringify(result, null, 2) + '\n',
);
console.log(JSON.stringify(result));
