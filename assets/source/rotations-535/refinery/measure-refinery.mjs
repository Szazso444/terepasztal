// Read-only refinery review. Width is the first gate; refused widths stop here.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { pictureOf, checkFile } from '../../../../tools/building-check.mjs';
import { measureBase } from '../../../../tools/building-fit.mjs';

export function measureRefinery(file, view, options = {}) {
  const png = PNG.sync.read(readFileSync(file));
  const auto = measureBase(png);
  const automaticCorners = auto && {
    w: auto.w,
    s: auto.s,
    e: auto.e,
    sure: auto.sure,
    slopes: auto.slopes,
  };
  const corners = options.corners ?? automaticCorners;
  let box = [png.width, png.height, -1, -1];
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++) {
      if (png.data[(y * png.width + x) * 4 + 3] <= 128) continue;
      box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
    }
  const width = corners ? corners.e[0] - corners.w[0] : null;
  const scale = png.width / 1024,
    limits = [441, 464, 487].map((n) => n * scale);
  const result = {
    size: [png.width, png.height],
    identity: pictureOf(file),
    opaqueBox: box,
    automaticCorners,
    corners,
    manualReason: options.manualReason ?? null,
    width,
    limits,
    tests: { width: width != null && width >= limits[0] && width <= limits[2] ? 'PASS' : 'FAIL' },
  };
  if (result.tests.width === 'FAIL') return { ...result, stoppedAfter: 'width' };
  const ll = corners.s[0] - corners.w[0],
    lr = corners.e[0] - corners.s[0];
  const slopes = [(corners.s[1] - corners.w[1]) / ll, (corners.s[1] - corners.e[1]) / lr];
  const check = checkFile(file, 't1', view);
  const elevationError = (Math.asin(Math.sqrt(slopes[0] * slopes[1])) * 180) / Math.PI - 30;
  const turnError = (Math.atan(Math.sqrt(slopes[0] / slopes[1])) * 180) / Math.PI - 45;
  let nearWhite = 0,
    nearAmber = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b, a] = png.data.subarray(i, i + 4);
    if (a <= 128) continue;
    if (r >= 236 && g >= 228 && b >= 208) nearWhite++;
    if (Math.hypot(r - 232, g - 170, b - 72) <= 12) nearAmber++;
  }
  const ref = options.r0Reference;
  const height = options.columnTopY == null ? null : (corners.s[1] - options.columnTopY) / width;
  Object.assign(result, {
    feet: [ll, lr],
    ratio: ll / lr,
    slopes,
    slopeErrors: slopes.map((s) => Math.abs(s - 0.5)),
    cameraError: check.camera?.by ?? Math.max(Math.abs(elevationError), Math.abs(turnError)),
    check: { ok: check.ok, problems: check.problems, camera: check.camera },
    columnTopY: options.columnTopY ?? null,
    height,
    highlights: { nearWhite, nearAmber },
  });
  Object.assign(result.tests, {
    plan: ll / lr >= 0.85 && ll / lr <= 1.15 ? 'PASS' : 'FAIL',
    camera: slopes.every((s) => Math.abs(s - 0.5) <= 0.03) && check.ok ? 'PASS' : 'FAIL',
    height:
      height == null || !ref
        ? 'UNMEASURED'
        : Math.abs(height / ref.height - 1) <= 0.15
          ? 'PASS'
          : 'FAIL',
    highlights: !ref
      ? 'UNMEASURED'
      : nearWhite <= ref.highlights.nearWhite && nearAmber <= ref.highlights.nearAmber
        ? 'PASS'
        : 'FAIL',
    visual: options.visual ?? 'UNMEASURED',
  });
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, view, opts] = process.argv.slice(2);
  console.log(
    JSON.stringify(measureRefinery(file, Number(view), opts ? JSON.parse(opts) : {}), null, 2),
  );
}
