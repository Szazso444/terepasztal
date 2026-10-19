import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { pictureOf, checkFile } from '../../../../tools/building-check.mjs';
import { measureBase } from '../../../../tools/building-fit.mjs';
export function measure(file, view, eavesY = null, corners = null) {
  const png = PNG.sync.read(readFileSync(file)),
    base = measureBase(png),
    automaticCorners = { w: base.w, s: base.s, e: base.e };
  const { w, s, e } = corners ?? automaticCorners,
    width = e[0] - w[0],
    factor = png.width / 1024;
  const result = {
    size: [png.width, png.height],
    picture: pictureOf(file),
    automaticCorners,
    corners: { w, s, e },
    width,
    widthLimits: [441 * factor, 487 * factor],
    tests: {},
  };
  let box = [png.width, png.height, -1, -1];
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++)
      if (png.data[(y * png.width + x) * 4 + 3] > 128) {
        box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
      }
  result.opaqueBox = box;
  result.tests.width =
    width >= result.widthLimits[0] && width <= result.widthLimits[1] ? 'PASS' : 'FAIL';
  if (result.tests.width === 'FAIL') {
    result.stoppedAfter = 'width';
    return result;
  }
  const feet = [s[0] - w[0], e[0] - s[0]],
    slopes = [(s[1] - w[1]) / feet[0], (s[1] - e[1]) / feet[1]],
    check = checkFile(file, 't1tall', view);
  const ref = JSON.parse(readFileSync(new URL('./prompts.json', import.meta.url))).r0Reference;
  let nearWhite = 0,
    nearAmber = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b, a] = png.data.subarray(i, i + 4);
    if (a <= 128) continue;
    if (r >= 236 && g >= 228 && b >= 208) nearWhite++;
    if (Math.hypot(r - 232, g - 170, b - 72) <= 12) nearAmber++;
  }
  Object.assign(result, {
    feet,
    ratio: feet[0] / feet[1],
    slopes,
    slopeErrors: slopes.map((v) => Math.abs(v - 0.5)),
    camera: {
      errorDegrees:
        check.camera?.by ??
        Math.max(
          Math.abs((check.fit?.camera?.elevation ?? 30) - 30),
          Math.abs((check.fit?.camera?.turn ?? 45) - 45),
        ),
      reported: check.camera,
      fitted: check.fit?.camera,
    },
    check: { ok: check.ok, problems: check.problems, notes: check.notes },
    height: eavesY === null ? null : (s[1] - eavesY) / width,
    eavesY,
    highlights: { nearWhite, nearAmber },
  });
  Object.assign(result.tests, {
    plan: result.ratio >= 0.85 && result.ratio <= 1.15 ? 'PASS' : 'FAIL',
    camera: slopes.every((v) => Math.abs(v - 0.5) <= 0.03) && check.ok ? 'PASS' : 'FAIL',
    height:
      eavesY === null
        ? 'PENDING'
        : Math.abs(result.height / ref.height - 1) <= 0.15
          ? 'PASS'
          : 'FAIL',
    highlights:
      nearWhite <= ref.highlights.nearWhite && nearAmber <= ref.highlights.nearAmber
        ? 'PASS'
        : 'FAIL',
    visual: 'PENDING',
  });
  return result;
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/measure-house.mjs'))
  console.log(
    JSON.stringify(
      measure(
        process.argv[2],
        Number(process.argv[3]),
        process.argv[4] === undefined ? null : Number(process.argv[4]),
      ),
      null,
      2,
    ),
  );
