import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { measureBase, cameraOff, fitPicture } from '../../../../tools/building-fit.mjs';
import { pictureOf, checkFile } from '../../../../tools/building-check.mjs';
export function measure(file, view, height = null) {
  const p = PNG.sync.read(readFileSync(file)),
    m = measureBase(p),
    width = m.e[0] - m.w[0],
    limits = [441, 464, 487].map((x) => (x * p.width) / 1024);
  const out = {
    returned: [p.width, p.height],
    picture: pictureOf(file),
    automaticCorners: { w: m.w, s: m.s, e: m.e },
    width,
    widthLimits: limits,
    tests: { width: width >= limits[0] && width <= limits[2] ? 'PASS' : 'FAIL' },
  };
  if (out.tests.width === 'FAIL') {
    out.stoppedAfter = 'width';
    return out;
  }
  out.feet = [m.s[0] - m.w[0], m.e[0] - m.s[0]];
  out.ratio = out.feet[0] / out.feet[1];
  out.slopes = m.slopes;
  out.slopeErrors = m.slopes.map((x) => Math.abs(Math.abs(x) - 0.5));
  const c = checkFile(file, 't1', view);
  out.camera = cameraOff(fitPicture(p, 't1', view));
  out.check = { ok: c.ok, problems: c.problems };
  let white = 0,
    amber = 0;
  out.opaqueBox = [p.width, p.height, -1, -1];
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const i = (y * p.width + x) * 4,
        [r, g, b, a] = p.data.subarray(i, i + 4);
      if (a <= 128) continue;
      const q = out.opaqueBox;
      q[0] = Math.min(q[0], x);
      q[1] = Math.min(q[1], y);
      q[2] = Math.max(q[2], x);
      q[3] = Math.max(q[3], y);
      if (r >= 236 && g >= 228 && b >= 208) white++;
      if (Math.hypot(r - 232, g - 170, b - 72) <= 12) amber++;
    }
  out.highlights = { nearWhite: white, nearAmber: amber };
  out.heightNumber = height === null ? null : height / width;
  out.tests.plan = out.ratio >= 0.85 && out.ratio <= 1.15 ? 'PASS' : 'FAIL';
  out.tests.camera = out.slopeErrors.every((x) => x <= 0.03) && c.ok ? 'PASS' : 'FAIL';
  out.tests.height =
    out.heightNumber !== null && Math.abs(out.heightNumber / (347 / 893) - 1) <= 0.15
      ? 'PASS'
      : 'FAIL';
  out.tests.highlights = white <= 2337 && amber === 0 ? 'PASS' : 'FAIL';
  return out;
}
const args = process.argv.slice(2);
if (args.length)
  console.log(
    JSON.stringify(measure(args[0], Number(args[1]), args[2] ? Number(args[2]) : null), null, 2),
  );
