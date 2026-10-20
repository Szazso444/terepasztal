import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { roundCamera } from '../../../tools/building-fit.mjs';
import { checkFile } from '../../../tools/building-check.mjs';

export function measure(file, eye) {
  const png = PNG.sync.read(readFileSync(file));
  const { width, height, data } = png;
  const low = Array(width).fill(-1);
  const box = [width, height, -1, -1];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= 128) continue;
      low[x] = y;
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], y);
    }
  const totalWidth = box[2] - box[0] + 1;
  const cols = low.map((y, x) => (y >= box[3] - 0.4 * totalWidth ? x : -1)).filter((x) => x >= 0);
  const W = cols.at(-1) - cols[0] + 1,
    xc = (cols[0] + cols.at(-1)) / 2,
    yc = box[3] - 0.25 * W,
    s = W / 42.99;
  const camera = roundCamera(png),
    check = checkFile(file, 't1', 0, { round: true });
  const apex = (yc - box[1]) / W;
  const [[sx1, sy1], [sx2, sy2]] = eye.stub;
  const slope = (sy2 - sy1) / (sx1 - sx2);
  const [hx, hy] = eye.hub,
    hub = [(hx - xc) / s, (hy - yc) / s - 4];
  const hubOffset = [hub[0] + 16, hub[1] + 34],
    hubDistance = Math.hypot(...hubOffset);
  const [dl, dt, dr, db] = eye.door;
  const doorPosition = ((dl + dr) / 2 - xc) / W,
    doorHeight = (db - dt) / W;
  let timber = 0,
    white = 0,
    amber = 0;
  const inRect = (x, y, r) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] <= 128) continue;
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (r >= 236 && g >= 228 && b >= 208) white++;
      if (Math.hypot(r - 232, g - 170, b - 72) <= 12) amber++;
      const mx = Math.max(r, g, b),
        mn = Math.min(r, g, b),
        d = mx - mn;
      let h =
        d === 0
          ? 0
          : mx === r
            ? 60 * (((g - b) / d) % 6)
            : mx === g
              ? 60 * ((b - r) / d + 2)
              : 60 * ((r - g) / d + 4);
      if (h < 0) h += 360;
      if (
        h >= 8 &&
        h <= 48 &&
        mx > 0 &&
        d / mx >= 0.45 &&
        mx / 255 <= 0.6 &&
        !inRect(x, y, eye.door) &&
        !inRect(x, y, eye.hubBox)
      )
        timber++;
    }
  const tests = {
    camera: camera !== null && camera.ratio >= 0.46 && camera.ratio <= 0.54 && camera.by <= 2,
    tower: apex >= 1.05 && apex <= 1.16,
    stub: slope >= 0.42 && slope <= 0.58,
    hub: hubDistance <= 2,
    doorPosition: Math.abs(doorPosition + 0.354) <= 0.04,
    doorHeight: Math.abs(doorHeight - 0.251) <= 0.03,
    timber: timber <= 25,
    amber: amber === 0,
    white: white === 0,
    check: check.ok,
    eye: eye.pass,
  };
  const numbers = {
    returned: [width, height],
    box,
    footWidth: W,
    footCentre: [xc, yc],
    scale: s,
    widthOverShort: W / Math.min(width, height),
    camera,
    apexOverW: apex,
    stubSlope: slope,
    hubFromAnchorWorld: hub,
    hubOffset,
    hubDistance,
    doorPosition,
    doorHeight,
    pixels: { timber, white, amber },
    check,
    tests,
    eye,
  };
  for (const [k, v] of Object.entries(tests)) console.log(`${v ? 'PASS' : 'FAIL'} ${k}`);
  console.log(JSON.stringify(numbers, null, 2));
  return numbers;
}
if (process.argv[2]) {
  const n = measure(process.argv[2], JSON.parse(readFileSync(process.argv[3], 'utf8')));
  if (process.argv[4]) writeFileSync(process.argv[4], JSON.stringify(n, null, 2) + '\n');
}
