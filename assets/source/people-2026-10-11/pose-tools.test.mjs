import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG, resample, box, json, read } from './pose-png.mjs';
test('area averaging integrates premultiplied alpha without transparent colour fringes', () => {
  const source = new PNG({ width: 2, height: 2 });
  for (let y = 0; y < 2; y++) {
    source.data.set([255, 0, 0, 255], y * 8);
    source.data.set([0, 0, 255, 0], y * 8 + 4);
  }
  const result = resample(source, 1, 1, 0.5, [0, 0], [0, 0]);
  assert.deepEqual([...result.data], [255, 0, 0, 128]);
});
test('one uniform scale places the body anchor and an asymmetric load without recentering', () => {
  const source = new PNG({ width: 10, height: 10 });
  source.data.set([255, 0, 0, 255], (5 * 10 + 5) * 4);
  source.data.set([0, 255, 0, 255], (5 * 10 + 1) * 4);
  const result = resample(source, 16, 16, 0.5, [5, 5], [8, 8]);
  assert.deepEqual(
    [...result.data.subarray((8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 4)],
    [255, 0, 0, 64],
  );
  assert.deepEqual(
    [...result.data.subarray((8 * 16 + 6) * 4, (8 * 16 + 6) * 4 + 4)],
    [0, 255, 0, 64],
  );
});
test('all36 guides carry the exact requested canvas, sole line, head cap and hip anchor', () => {
  const geometry = json('pose-geometry.json');
  let count = 0;
  for (const strip of Object.values(geometry.strips))
    for (const frame of strip.frames) {
      const image = read(frame.guide),
        b = box(image);
      assert.equal(image.width, 1024);
      assert.equal(image.height, 1536);
      assert.equal(frame.joints.hips[0], 512);
      assert.deepEqual(frame.bodyAnchor, [512, 1344]);
      assert.equal(b.y, 192);
      assert.equal(b.y + b.height, 1344);
      assert.deepEqual(b, frame.box);
      count++;
    }
  assert.equal(count, 36);
});
