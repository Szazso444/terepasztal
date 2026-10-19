/** Read-only review-2 measurements. Run from repository root:
 * node assets/source/rotations-535/measure.mjs FILE VIEW [PARAPET_Y] [MASTER_HEIGHT_RATIO]
 * pictureOf identifies standard filenames; PNG decoding uses pngjs because pictureOf
 * returns filename metadata, not pixels. No fitting or report files are written.
 */
import { readFileSync, existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import { pictureOf, checkFile } from '../../../tools/building-check.mjs';
import { measureBase } from '../../../tools/building-fit.mjs';

export function highlights(png) {
  let white = 0,
    amber = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b, a] = png.data.subarray(i, i + 4);
    if (a <= 128) continue;
    if (r >= 236 && g >= 228 && b >= 208) white++;
    if (Math.hypot(r - 232, g - 170, b - 72) <= 12) amber++;
  }
  return { white, amber };
}

export function measure(file, view, parapetY = null, masterHeight = null) {
  const png = PNG.sync.read(readFileSync(file));
  const hydro = /hydro_plant/.test(file);
  const pump = /(?:^|[\\/])pump[\\/]/.test(file);
  const rotation = Number(String(view).replace('r', ''));
  const limits = pump
    ? [441, 464, 487].map((n) => (n * png.width) / 1024)
    : hydro
      ? [374, 394, 414].map((n) => (n * png.width) / 1024)
      : [659, 694, 729];
  const planRatio = hydro ? ([0, 2].includes(rotation) ? 1.439 : 0.695) : 1;
  const heightRatio = pump ? 310 / 894 : hydro ? 0.82 : 0.31;
  const base = measureBase(png);
  let x0 = png.width,
    y0 = png.height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++) {
      if (png.data[(y * png.width + x) * 4 + 3] <= 128) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  const result = {
    size: [png.width, png.height],
    picture: pictureOf(file),
    opaqueBox: [x0, y0, x1, y1],
    base: base && { w: base.w, s: base.s, e: base.e, sure: base.sure },
    width: base ? base.e[0] - base.w[0] : null,
    widthLimits: limits,
    tests: {},
  };
  result.tests.width =
    base && result.width >= limits[0] && result.width <= limits[2] ? 'PASS' : 'FAIL';
  if (result.tests.width === 'FAIL') {
    result.stoppedAfter = 'width';
    return result;
  }
  const ll = base.s[0] - base.w[0],
    lr = base.e[0] - base.s[0];
  result.feet = [ll, lr];
  result.ratio = ll / lr;
  result.tests.plan = Math.abs(result.ratio / planRatio - 1) <= 0.15 ? 'PASS' : 'FAIL';
  result.slopes = base.slopes;
  result.slopeErrors = base.slopes.map((s) => Math.abs(Math.abs(s) - 0.5));
  const check = checkFile(file, pump || hydro ? 't1' : 't2x2', rotation);
  result.check = {
    ok: check.ok,
    problems: check.problems,
    camera: check.camera,
    fittedCamera: check.fit?.camera,
  };
  result.tests.camera =
    base.sure.every(Boolean) && result.slopeErrors.every((e) => e <= 0.03) && check.ok
      ? 'PASS'
      : 'FAIL';
  result.height =
    parapetY === null
      ? null
      : {
          parapetY,
          pixels: base.s[1] - parapetY,
          ratio: (base.s[1] - parapetY) / result.width,
          planRatio: heightRatio,
          masterRatio: masterHeight,
        };
  result.tests.height =
    result.height === null
      ? 'PENDING_EYE'
      : Math.abs(result.height.ratio / heightRatio - 1) <= 0.15 &&
          (masterHeight === null || Math.abs(result.height.ratio / masterHeight - 1) <= 0.15)
        ? 'PASS'
        : 'FAIL';
  result.highlights = highlights(png);
  const master = pump
    ? 'assets/source/base-v1/pump.png'
    : hydro
      ? rotation === 0
        ? 'assets/source/base-v1/hydro-plant.png'
        : 'assets/source/rotations-535/hydro_plant/hydro_plant-r0.png'
      : rotation === 0
        ? 'assets/source/base-v1/substation.png'
        : 'assets/source/rotations-535/battery/substation-r0.png';
  result.highlightReference = {
    file: master,
    ...(existsSync(master) ? highlights(PNG.sync.read(readFileSync(master))) : {}),
  };
  result.tests.highlights =
    result.highlights.white <= result.highlightReference.white &&
    result.highlights.amber <= result.highlightReference.amber
      ? 'PASS'
      : 'FAIL';
  result.tests.visual = 'PENDING_EYE';
  return result;
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/measure.mjs')) {
  const [file, view, top, master] = process.argv.slice(2);
  console.log(
    JSON.stringify(
      measure(
        file,
        view,
        top === undefined ? null : Number(top),
        master === undefined ? null : Number(master),
      ),
      null,
      2,
    ),
  );
}
