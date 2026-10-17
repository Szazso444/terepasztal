import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG, resample, box, json, read } from './pose-png.mjs';
import { contactOverlap } from './contact-overlap.mjs';
test('contact overlap aligns soles and centre columns while excluding the upper60percent', () => {
  function figure(width, height, left, top, scale = 1) {
    const png = new PNG({ width, height });
    for (let y = top; y < top + 10 * scale; y++)
      for (let x = left; x < left + 2 * scale; x++)
        png.data.set([71, 123, 130, 255], (y * width + x) * 4);
    return png;
  }
  const reference = figure(10, 20, 3, 2);
  const translated = figure(10, 24, 3, 5);
  assert.equal(contactOverlap(reference, translated).iou, 1);
  const doubled = figure(20, 40, 6, 8, 2);
  assert.equal(contactOverlap(reference, doubled).iou, 1);
  const differentLegs = figure(10, 20, 6, 2);
  assert.equal(contactOverlap(reference, differentLegs).iou, 0);
  translated.data[(5 * 10 + 3) * 4 + 3] = 0;
  const result = contactOverlap(
    reference,
    translated,
    { hatTop: 2, soleRow: 11 },
    { hatTop: 5, soleRow: 14 },
  );
  assert.equal(result.iou, 1);
  assert.equal(result.reference.pixels, 8);
  assert.equal(result.candidate.pixels, 8);
});
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
