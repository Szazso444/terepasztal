import fs from 'node:fs';
import { PNG } from 'pngjs';
import { pictureOf, checkFile } from '../../../../tools/building-check.mjs';
import { measureBase } from '../../../../tools/building-fit.mjs';
const dir = 'assets/source/rotations-535/power_plant';
export function measure(file, view, { corners, eavesY, reference = false } = {}) {
  const png = PNG.sync.read(fs.readFileSync(file)),
    b = measureBase(png),
    auto = { w: b.w, s: b.s, e: b.e, slopes: b.slopes, sure: b.sure },
    c = corners ?? auto;
  const width = c.e[0] - c.w[0],
    r = {
      file,
      picture: pictureOf(file),
      size: [png.width, png.height],
      automaticCorners: auto,
      corners: c,
      manualOverride: !!corners,
      width,
      limits: [688, 724, 760],
      tests: { width: reference || (width >= 688 && width <= 760) ? 'PASS' : 'FAIL' },
    };
  let box = [png.width, png.height, -1, -1],
    white = 0,
    amber = 0;
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4,
        [R, G, B, A] = png.data.subarray(i, i + 4);
      if (A <= 128) continue;
      box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
      if (R >= 236 && G >= 228 && B >= 208) white++;
      if (Math.hypot(R - 232, G - 170, B - 72) <= 12) amber++;
    }
  r.opaqueBox = box;
  if (r.tests.width === 'FAIL') return { ...r, stoppedAfter: 'width' };
  const ll = c.s[0] - c.w[0],
    lr = c.e[0] - c.s[0],
    slopes = [(c.s[1] - c.w[1]) / ll, (c.s[1] - c.e[1]) / lr];
  const elevation = (Math.asin(Math.sqrt(slopes[0] * slopes[1])) * 180) / Math.PI - 30,
    turn = (Math.atan(Math.sqrt(slopes[0] / slopes[1])) * 180) / Math.PI - 45;
  const check = checkFile(file, 't1', view, { camera: false });
  const problems = check.problems.filter((p) => !p.includes('camera'));
  Object.assign(r, {
    feet: [ll, lr],
    ratio: ll / lr,
    slopes,
    slopeErrors: slopes.map((s) => Math.abs(s - 0.5)),
    cameraError: { elevation, turn, by: Math.max(Math.abs(elevation), Math.abs(turn)) },
    check: { problems },
    eavesY,
    height: eavesY == null ? null : (c.s[1] - eavesY) / width,
    highlights: { nearWhite: white, nearAmber: amber },
  });
  const baseline = reference
    ? null
    : JSON.parse(fs.readFileSync(dir + '/prompts.json')).r0Reference;
  Object.assign(r.tests, {
    plan:
      ll / lr >= (view === 2 ? 1.27 : 0.57) && ll / lr <= (view === 2 ? 1.72 : 0.77)
        ? 'PASS'
        : 'FAIL',
    camera:
      slopes.every((s) => Math.abs(s - 0.5) <= 0.03) && problems.length === 0 ? 'PASS' : 'FAIL',
    height:
      baseline && r.height
        ? Math.abs(r.height / baseline.height - 1) <= 0.15
          ? 'PASS'
          : 'FAIL'
        : 'REFERENCE',
    highlights: baseline
      ? white <= baseline.highlights.nearWhite && amber <= baseline.highlights.nearAmber
        ? 'PASS'
        : 'FAIL'
      : 'REFERENCE',
  });
  return r;
}
const [file, view, opt] = process.argv.slice(2);
if (file && process.argv[1].replaceAll('\\', '/').endsWith('/measure-power.mjs'))
  console.log(JSON.stringify(measure(file, +view, opt ? JSON.parse(opt) : {}), null, 2));
