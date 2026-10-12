import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG, resample, box, json, read } from './pose-png.mjs';
test('portrait cleanup removes faint specks and makes nearly opaque paint solid without changing RGB', () => {
  const source = new PNG({ width: 4, height: 1 });
  for (const [x, alpha] of [15, 16, 199, 200].entries())
    source.data.set([71, 123, 130, alpha], x * 4);
  const result = resample(source, 4, 1, 1, [0, 0], [0, 0]);
  assert.deepEqual(
    [3, 7, 11, 15].map((i) => result.data[i]),
    [0, 16, 199, 255],
  );
  assert.deepEqual([...result.data.subarray(12, 15)], [71, 123, 130]);
});
test('a sole below the guide baseline lands on the frame anchor using its measured row', () => {
  const source = new PNG({ width: 8, height: 12 });
  source.data.set([113, 80, 59, 253], (10 * 8 + 4) * 4);
  const result = resample(source, 16, 16, 1, [4, 10], [8, 13]);
  assert.deepEqual(box(result), { x: 8, y: 13, width: 1, height: 1 });
});
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
