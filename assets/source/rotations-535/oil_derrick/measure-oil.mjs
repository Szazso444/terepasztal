import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { pictureOf, checkFile } from '../../../../tools/building-check.mjs';
import { measureBase, cameraOff, fitPicture } from '../../../../tools/building-fit.mjs';

// Oil derrick uses a 2 x 1 footprint. The shared lane helper may serve 1 x 1 jobs.
export function measure(
  file,
  view,
  { corners = null, postHeightPx = null, reference = null } = {},
) {
  const p = PNG.sync.read(readFileSync(file));
  const m = measureBase(p);
  if (!m) throw Error('No measurable base');
  const automaticCorners = { w: m.w, s: m.s, e: m.e };
  const b = corners ?? automaticCorners;
  const width = b.e[0] - b.w[0],
    scale = p.width / 1024;
  const limits = { min: 659 * scale, held: 694 * scale, max: 729 * scale };
  const out = {
    file,
    picture: pictureOf(file),
    returned: [p.width, p.height],
    automaticCorners,
    corners: b,
    width,
    limits,
    tests: { width: width >= limits.min && width <= limits.max ? 'PASS' : 'FAIL' },
  };
  if (out.tests.width === 'FAIL') {
    out.remainingTests = 'SKIPPED: width refused';
    return out;
  }
  const ll = b.s[0] - b.w[0],
    lr = b.e[0] - b.s[0];
  out.feet = [ll, lr];
  out.ratio = ll / lr;
  out.ratioLimits = view % 2 ? [0.42, 0.57] : [1.7, 2.3];
  out.slopes = [(b.s[1] - b.w[1]) / ll, (b.s[1] - b.e[1]) / lr];
  out.slopeErrors = out.slopes.map((x) => Math.abs(x - 0.5));
  let white = 0,
    amber = 0;
  out.opaqueBox = [p.width, p.height, -1, -1];
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const i = (y * p.width + x) * 4;
      const [r, g, b, a] = p.data.subarray(i, i + 4);
      if (a <= 128) continue;
      const q = out.opaqueBox;
      q[0] = Math.min(q[0], x);
      q[1] = Math.min(q[1], y);
      q[2] = Math.max(q[2], x);
      q[3] = Math.max(q[3], y);
      if (r >= 236 && g >= 228 && b >= 208) white++;
      if (Math.hypot(r - 232, g - 170, b - 72) <= 12) amber++;
    }
  const check = checkFile(file, 't1', view);
  out.check = { ok: check.ok, problems: check.problems, notes: check.notes };
  out.camera = cameraOff(fitPicture(p, 't1', view));
  out.postHeightPx = postHeightPx;
  out.heightNumber = postHeightPx === null ? null : postHeightPx / width;
  out.highlights = { nearWhite: white, nearAmber: amber };
  Object.assign(out.tests, {
    plan: out.ratio >= out.ratioLimits[0] && out.ratio <= out.ratioLimits[1] ? 'PASS' : 'FAIL',
    camera: out.slopeErrors.every((x) => x <= 0.03) && check.ok ? 'PASS' : 'FAIL',
    height:
      reference &&
      postHeightPx !== null &&
      Math.abs(out.heightNumber / reference.heightNumber - 1) <= 0.15
        ? 'PASS'
        : 'FAIL',
    highlights:
      reference &&
      white <= reference.highlights.nearWhite &&
      amber <= reference.highlights.nearAmber
        ? 'PASS'
        : 'FAIL',
  });
  return out;
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/measure-oil.mjs')) {
  const [file, v, options = '{}'] = process.argv.slice(2);
  console.log(JSON.stringify(measure(file, Number(v), JSON.parse(options)), null, 2));
}
