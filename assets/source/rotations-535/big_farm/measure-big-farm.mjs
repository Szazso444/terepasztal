import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { pictureOf, checkFile } from '../../../../tools/building-check.mjs';
import { measureBase, cameraOff, fitPicture } from '../../../../tools/building-fit.mjs';
export function measure(file, view, { corners = null, eavesY = null, r0 = null } = {}) {
  const p = PNG.sync.read(readFileSync(file)),
    m = measureBase(p);
  const auto = m && { w: m.w, s: m.s, e: m.e, slopes: m.slopes, sure: m.sure };
  const b = corners ?? auto;
  if (!b) throw Error('No base');
  const width = b.e[0] - b.w[0],
    scale = p.width / 1024;
  const result = {
    picture: pictureOf(file),
    returned: [p.width, p.height],
    automatic: auto,
    corners: b,
    width,
    widthLimits: [659 * scale, 729 * scale],
    tests: { width: width >= 659 * scale && width <= 729 * scale ? 'PASS' : 'FAIL' },
  };
  if (result.tests.width === 'FAIL') return { ...result, stoppedAfter: 'width' };
  const ll = b.s[0] - b.w[0],
    lr = b.e[0] - b.s[0];
  result.feet = [ll, lr];
  result.ratio = ll / lr;
  result.slopes = [(b.s[1] - b.w[1]) / ll, (b.s[1] - b.e[1]) / lr];
  result.slopeErrors = result.slopes.map((x) => Math.abs(x - 0.5));
  result.opaqueBox = [p.width, p.height, -1, -1];
  let white = 0,
    amber = 0;
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const i = (y * p.width + x) * 4;
      if (p.data[i + 3] <= 128) continue;
      const [r, g, b] = p.data.subarray(i, i + 3),
        q = result.opaqueBox;
      q[0] = Math.min(q[0], x);
      q[1] = Math.min(q[1], y);
      q[2] = Math.max(q[2], x);
      q[3] = Math.max(q[3], y);
      if (r >= 236 && g >= 228 && b >= 208) white++;
      if (Math.hypot(r - 232, g - 170, b - 72) <= 12) amber++;
    }
  result.highlights = { nearWhite: white, nearAmber: amber };
  result.height =
    eavesY === null ? null : { eavesY, pixels: b.s[1] - eavesY, ratio: (b.s[1] - eavesY) / width };
  const c = checkFile(file, 't1', view);
  result.check = { ok: c.ok, problems: c.problems, notes: c.notes };
  result.camera = cameraOff(fitPicture(p, 't1', view));
  const limits = view === 2 ? [0.42, 0.57] : [1.7, 2.3];
  result.tests.plan = result.ratio >= limits[0] && result.ratio <= limits[1] ? 'PASS' : 'FAIL';
  result.tests.camera = result.slopeErrors.every((x) => x <= 0.03) && c.ok ? 'PASS' : 'FAIL';
  result.tests.height =
    r0 && result.height && Math.abs(result.height.ratio / r0.height.ratio - 1) <= 0.15
      ? 'PASS'
      : 'FAIL';
  result.tests.highlights =
    r0 && white <= r0.highlights.nearWhite && amber <= r0.highlights.nearAmber ? 'PASS' : 'FAIL';
  return result;
}

// Reproduce the recorded outer-corner reading. Raw PNG bytes are never changed.
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/measure-big-farm.mjs')) {
  const [file, view = '1'] = process.argv.slice(2);
  const record = JSON.parse(readFileSync(new URL('./prompts.json', import.meta.url), 'utf8'));
  const name = file.replaceAll('\\', '/').split('/').pop();
  const attempt = record.attempts.find((a) => a.file.split('/').pop() === name);
  const options = {
    r0: record.r0Reference,
    ...(attempt ? { corners: attempt.measured.corners } : {}),
  };
  console.log(JSON.stringify(measure(file, Number(view), options), null, 2));
}
