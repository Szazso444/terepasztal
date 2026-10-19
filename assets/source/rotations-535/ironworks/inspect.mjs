import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { pictureOf, checkFile } from '../../../../tools/building-check.mjs';
import { measureBase } from '../../../../tools/building-fit.mjs';

// Ironworks uses a chimney measured from its furnace foot, rather than a roof eave.
export function inspect(file, view, eye = {}, reference = null) {
  const png = PNG.sync.read(readFileSync(file));
  const auto = measureBase(png);
  const automaticCorners = auto && { w: auto.w, s: auto.s, e: auto.e };
  const corners = eye.corners ?? automaticCorners;
  let box = [png.width, png.height, -1, -1];
  let white = 0,
    amber = 0;
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      const [r, g, b, a] = png.data.subarray(i, i + 4);
      if (a <= 128) continue;
      box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
      if (r >= 236 && g >= 228 && b >= 208) white++;
      if (Math.hypot(r - 232, g - 170, b - 72) <= 12) amber++;
    }
  const width = corners.e[0] - corners.w[0];
  const result = {
    file,
    identity: pictureOf(file),
    returned: [png.width, png.height],
    opaqueBox: box,
    automaticCorners,
    corners,
    eye,
    width,
    limits: [659, 694, 729],
    tests: { width: width >= 659 && width <= 729 ? 'PASS' : 'FAIL' },
  };
  if (result.tests.width === 'FAIL') return { ...result, stoppedAfter: 'width' };
  const ll = corners.s[0] - corners.w[0],
    lr = corners.e[0] - corners.s[0];
  const slopes = [(corners.s[1] - corners.w[1]) / ll, (corners.s[1] - corners.e[1]) / lr];
  const check = checkFile(file, 't2x2', view);
  const heightRatio = (eye.furnaceFootY - eye.chimneyTopY) / width;
  Object.assign(result, {
    feet: [ll, lr],
    ratio: ll / lr,
    slopes,
    slopeErrors: slopes.map((s) => Math.abs(s - 0.5)),
    cameraError:
      check.camera?.by ??
      Math.max(Math.abs(check.fit?.camera?.elevation - 30), Math.abs(check.fit?.camera?.turn)),
    check: {
      ok: check.ok,
      problems: check.problems,
      camera: check.camera,
      fittedCamera: check.fit?.camera,
    },
    heightRatio,
    referenceHeightRatio: reference?.heightRatio,
    highlights: { white, amber },
    referenceHighlights: reference?.highlights,
  });
  Object.assign(result.tests, {
    plan: ll / lr >= 0.85 && ll / lr <= 1.15 ? 'PASS' : 'FAIL',
    camera: slopes.every((s) => Math.abs(s - 0.5) <= 0.03) && check.ok ? 'PASS' : 'FAIL',
    height:
      reference &&
      Number.isFinite(heightRatio) &&
      Math.abs(heightRatio / reference.heightRatio - 1) <= 0.15
        ? 'PASS'
        : 'FAIL',
    highlights:
      reference && white <= reference.highlights.white && amber <= reference.highlights.amber
        ? 'PASS'
        : 'FAIL',
    visual: eye.visual ?? 'UNMEASURED',
  });
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, view, eye = '{}'] = process.argv.slice(2);
  const record = JSON.parse(readFileSync(new URL('./prompts.json', import.meta.url)));
  console.log(
    JSON.stringify(
      inspect(
        file,
        Number(view),
        JSON.parse(eye),
        Number(view) === 0 ? record.oldReference : record.r0Reference,
      ),
      null,
      2,
    ),
  );
}
