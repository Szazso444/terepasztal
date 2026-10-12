import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const directions = { ne: [0, -1], se: [1, 0], sw: [0, 1], nw: [-1, 0] };
export function measure(file, edge) {
  const bytes = fs.readFileSync(file),
    png = PNG.sync.read(bytes);
  const s = png.width / 1024,
    [dx, dy] = directions[edge];
  const square = png.width === png.height;
  const expected = [150, 331, 874, 693].map((n) => n * s);
  const corners = [
    0,
    (png.width - 1) * 4,
    (png.height - 1) * png.width * 4,
    (png.height * png.width - 1) * 4,
  ];
  const opaqueBackground = corners.every((i) => png.data[i + 3] > 128);
  const corner = [0, 1, 2].map((c) => corners.reduce((sum, i) => sum + png.data[i + c], 0) / 4);
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  let painted = 0,
    lowerOutside = 0,
    upperOutside = 0,
    upperBeyondAllowance = 0;
  let stones = 0,
    stoneRing = 0,
    stoneTopAllowance = 0;
  for (let py = 0; py < png.height; py++)
    for (let px = 0; px < png.width; px++) {
      const i = (py * png.width + px) * 4,
        [r, g, b, a] = png.data.subarray(i, i + 4);
      const active = opaqueBackground
        ? a > 128 &&
          Math.max(Math.abs(r - corner[0]), Math.abs(g - corner[1]), Math.abs(b - corner[2])) > 40
        : a > 128;
      if (!active) continue;
      painted++;
      left = Math.min(left, px);
      right = Math.max(right, px);
      top = Math.min(top, py);
      bottom = Math.max(bottom, py);
      const sx = (px + 0.5) / s - 512,
        sy = (py + 0.5) / s - 512;
      const x = (sx / 512 + sy / 256) / 2,
        y = (sy / 256 - sx / 512) / 2;
      const t = x * dx + y * dy;
      const radius = Math.hypot(sx / 724, sy / 362);
      const nonWater = b <= r + 15;
      const brightStone = nonWater && 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
      // Pixel-centre slack (half a pixel) only, no percent-based outside tolerance.
      const slack = 0.5 / s / 512;
      if (x > 0.5 + slack || y > 0.5 + slack) lowerOutside++;
      if (x < -0.5 - slack || y < -0.5 - slack) {
        upperOutside++;
        const rise = Math.max(-0.5 - x, -0.5 - y) * 512;
        if (!(t < 0 && sy < 0 && nonWater && rise <= 36)) upperBeyondAllowance++;
      }
      if (t < 0 && radius > 0.2 && brightStone) {
        stones++;
        if (radius >= 0.38 && radius <= 0.5) stoneRing++;
        else if (sy < 0) {
          // Only far-rim tops may project past the ring. Their foot must be
          // reachable by a vertical descent of <=36 requested-canvas pixels.
          for (let rise = 1; rise <= 36; rise++) {
            const footR = Math.hypot(sx / 724, (sy + rise) / 362);
            const fx = (sx / 512 + (sy + rise) / 256) / 2;
            const fy = ((sy + rise) / 256 - sx / 512) / 2;
            if (
              footR >= 0.38 &&
              footR <= 0.5 &&
              fx * dx + fy * dy < 0 &&
              Math.abs(fx) <= 0.5 &&
              Math.abs(fy) <= 0.5
            ) {
              stoneTopAllowance++;
              break;
            }
          }
        }
      }
    }
  const box = [left, top, right, bottom];
  const centre = [(left + right) / 2, bottom - 181 * s];
  const centreError = Math.hypot(centre[0] - 512 * s, centre[1] - 512 * s);
  const boxPass =
    square &&
    painted > 0 &&
    Math.abs(left - expected[0]) <= 36 * s &&
    Math.abs(right - expected[2]) <= 36 * s &&
    Math.abs(bottom - expected[3]) <= 18 * s &&
    top >= expected[1] - 54 * s &&
    top <= expected[1] + 18 * s;
  const centrePass = square && centreError <= 36 * s;
  const stoneRingFraction = stones ? stoneRing / stones : 0;
  const stoneAllowedFraction = stones ? (stoneRing + stoneTopAllowance) / stones : 0;
  const checks = {
    square,
    rgba: bytes[25] === 6,
    box: boxPass,
    centre: centrePass,
    lowerDiamond: lowerOutside === 0,
    upperDiamond: upperBeyondAllowance === 0,
    stones: stoneAllowedFraction >= 0.9,
  };
  return {
    returned: [png.width, png.height],
    measured: {
      scale: s,
      opaqueBackground,
      expectedBox: expected,
      paintedBox: box,
      centre,
      centreError,
      paintedPixels: painted,
      lowerOutside,
      upperOutside,
      upperBeyondAllowance,
      stonePixels: stones,
      stoneRingPixels: stoneRing,
      stoneTopAllowancePixels: stoneTopAllowance,
      stoneRingFraction,
      stoneAllowedFraction,
      checks,
      failed: Object.entries(checks)
        .filter(([, pass]) => !pass)
        .map(([name]) => name),
      pass: Object.values(checks).every(Boolean),
    },
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const promptsPath = path.join(dir, 'prompts.json');
  const prompts = JSON.parse(fs.readFileSync(promptsPath, 'utf8'));
  const candidates = prompts.filter((p) => p.centred === true);
  for (const p of candidates) {
    if (p.generationError && !fs.existsSync(path.join(dir, p.file))) continue;
    const edge = p.id.match(/^spring-(ne|se|sw|nw)-attempt-/)?.[1];
    Object.assign(p, measure(path.join(dir, p.file), edge));
  }
  fs.writeFileSync(promptsPath, JSON.stringify(prompts, null, 2) + '\n');
  console.log(
    JSON.stringify(
      candidates.map(({ id, returned, measured }) => ({ id, returned, measured })),
      null,
      2,
    ),
  );
}
