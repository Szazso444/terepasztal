import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { trimSource, resample } from '../../../tools/illustrated-sprites.mjs';
import { smoothPng } from '../../../tools/pixel-art.mjs';

const folder = dirname(fileURLToPath(import.meta.url));
const root = resolve(folder, '../../..');
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const file = args[0];
const kind = option('--kind');
const height = Number(option('--height'));
if (!file || !['willow', 'mangrove'].includes(kind) || !(height > 0))
  throw new Error(
    'Usage: check-tree.mjs <file> --kind mangrove|willow --height <px> [--foot x,y] [--record]',
  );
const input = PNG.sync.read(readFileSync(resolve(file)));
let left = input.width,
  top = input.height,
  right = -1,
  bottom = -1;
let edgePixels = 0,
  partial = 0,
  count = 0,
  overCursorWhite = 0,
  amberStrength = 0,
  cyan = 0;
const luminance = [];
for (let y = 0; y < input.height; y++)
  for (let x = 0; x < input.width; x++) {
    const i = (y * input.width + x) * 4;
    const [r, g, b, a] = input.data.subarray(i, i + 4);
    if (a > 0 && a <= 250) partial++;
    if (a > 64) {
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      if (x < 8 || y < 8 || x >= input.width - 8 || y >= input.height - 8) edgePixels++;
    }
    if (a <= 128) continue;
    count++;
    if (r >= 236 && g >= 228 && b >= 208) overCursorWhite++;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      delta = max - min;
    const saturation = max ? delta / max : 0;
    let hue =
      delta === 0
        ? 0
        : max === r
          ? 60 * ((g - b) / delta)
          : max === g
            ? 60 * ((b - r) / delta + 2)
            : 60 * ((r - g) / delta + 4);
    hue = (hue + 360) % 360;
    if (hue >= 25 && hue <= 50 && saturation >= 0.62 && max / 255 >= 0.85) amberStrength++;
    if (hue >= 165 && hue <= 215 && saturation >= 0.25 && max / 255 >= 0.35) cyan++;
    luminance.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
  }
if (!count) throw new Error('No opaque object pixels');
const alpha = (x, y) => input.data[(y * input.width + x) * 4 + 3];
let footAuto,
  x0 = input.width,
  x1 = -1;
if (kind === 'willow') {
  for (let y = bottom; y >= top && !footAuto; y--) {
    let bestStart = 0,
      bestLength = 0,
      start = left;
    for (let x = left; x <= right + 1; x++) {
      if (x <= right && alpha(x, y) > 128) continue;
      const length = x - start;
      if (length > bestLength) {
        bestStart = start;
        bestLength = length;
      }
      start = x + 1;
    }
    if (bestLength) footAuto = [bestStart + (bestLength - 1) / 2, y];
  }
} else {
  for (let y = Math.ceil(top + (bottom - top + 1) * 0.75); y <= bottom; y++)
    for (let x = left; x <= right; x++)
      if (alpha(x, y) > 128) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
      }
  if (x1 < x0) throw new Error('No root pixels in the lowest quarter');
  footAuto = [(x0 + x1) / 2, bottom - (x1 - x0) / 4];
}
const foot = args.includes('--foot') ? option('--foot').split(',').map(Number) : footAuto;
if (foot.length !== 2 || foot.some((v) => !Number.isFinite(v)) || foot[1] <= top)
  throw new Error('Invalid foot');
const k = (height + (kind === 'willow' ? 6 : 0)) / (foot[1] - top);
const anchor = [foot[0], foot[1] - (kind === 'willow' ? 6 / k : 0)];
const drawn = {
  width: (right - left + 1) * k * 1.2,
  footFromCentre: (anchor[0] - (left + right) / 2) * k * 1.2,
  belowFoot: (bottom - foot[1]) * k,
  ...(kind === 'mangrove' ? { rootSpread: (x1 - x0) * k * 1.2 } : {}),
};
const trimmed = trimSource(input);
const packed = smoothPng(
  resample(
    trimmed,
    Math.round(((trimmed.width * k * 4) / 1.5) * 1.2),
    Math.round((trimmed.height * k * 4) / 1.5),
  ),
  2,
);
const packedAnchor = [
  ((anchor[0] - left) * packed.width) / trimmed.width,
  ((anchor[1] - top) * packed.height) / trimmed.height,
];
const atlas = PNG.sync.read(readFileSync(join(root, 'public/assets/props.png')));
const oakFrame = JSON.parse(readFileSync(join(root, 'public/assets/props.json'), 'utf8')).frames[
  'props/oak_2'
];
const oak = new PNG({ width: oakFrame.w, height: oakFrame.h });
PNG.bitblt(atlas, oak, oakFrame.x, oakFrame.y, oakFrame.w, oakFrame.h, 0, 0);
function composite(dst, src, dx, dy) {
  dx = Math.round(dx);
  dy = Math.round(dy);
  for (let y = 0; y < src.height; y++)
    for (let x = 0; x < src.width; x++) {
      if (x + dx < 0 || y + dy < 0 || x + dx >= dst.width || y + dy >= dst.height) continue;
      const i = (y * src.width + x) * 4,
        o = ((y + dy) * dst.width + x + dx) * 4,
        a = src.data[i + 3] / 255;
      for (let c = 0; c < 3; c++)
        dst.data[o + c] = Math.round(src.data[i + c] * a + dst.data[o + c] * (1 - a));
      dst.data[o + 3] = 255;
    }
}
function scene(zoom) {
  const out = new PNG({ width: 220 * zoom, height: 120 * zoom });
  for (let i = 0; i < out.data.length; i += 4) out.data.set([124, 143, 60, 255], i);
  function tile(cx, cy, colour) {
    for (let y = 0; y < out.height; y++)
      for (let x = 0; x < out.width; x++)
        if (Math.abs((x + 0.5) / zoom - cx) / 32 + Math.abs((y + 0.5) / zoom - cy) / 16 <= 1)
          out.data.set([...colour, 255], (y * out.width + x) * 4);
  }
  const bank = [98, 116, 48],
    water = [71, 123, 130];
  if (kind === 'mangrove') {
    tile(58, 74, bank);
    tile(90, 90, water);
    tile(122, 106, water);
  } else {
    tile(90, 90, bank);
    tile(122, 106, water);
    tile(58, 106, bank);
  }
  function stand(png, ax, ay, x) {
    const factor = (1.5 / 4) * zoom;
    const small = resample(png, Math.round(png.width * factor), Math.round(png.height * factor));
    composite(
      out,
      small,
      x * zoom - (ax * small.width) / png.width,
      90 * zoom - (ay * small.height) / png.height,
    );
  }
  stand(packed, ...packedAnchor, 90);
  stand(oak, oakFrame.ax, oakFrame.ay, 170);
  for (let y = 81 * zoom; y < 90 * zoom; y++)
    for (let x = 29 * zoom; x < 32 * zoom; x++)
      out.data.set([98, 107, 108, 255], (y * out.width + x) * 4);
  return out;
}
const look = new PNG({ width: 1760, height: 480 });
for (const zoom of [1, 2]) {
  const src = scene(zoom),
    magnify = 4 / zoom;
  for (let y = 0; y < 480; y++)
    for (let x = 0; x < 880; x++) {
      const i = (Math.floor(y / magnify) * src.width + Math.floor(x / magnify)) * 4;
      src.data.copy(look.data, (y * look.width + x + (zoom - 1) * 880) * 4, i, i + 4);
    }
}
mkdirSync(join(folder, 'checks'), { recursive: true });
const lookName = `checks/${basename(file, '.png')}-look.png`;
writeFileSync(join(folder, lookName), PNG.sync.write(look));
luminance.sort((a, b) => a - b);
const result = {
  returned: [input.width, input.height],
  edgePixels,
  partialAlphaPct: (100 * partial) / (input.width * input.height),
  box: [left, top, right, bottom],
  footAuto,
  foot,
  anchor,
  kind,
  height,
  k,
  drawn,
  overCursorWhite,
  amberStrength,
  cyanWaterPct: (100 * cyan) / count,
  lumP99: luminance[Math.ceil(luminance.length * 0.99) - 1],
  look: lookName,
};
if (args.includes('--record')) {
  const path = join(folder, 'trees.json');
  const records = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  records[basename(file)] = result;
  writeFileSync(path, JSON.stringify(records, null, 2) + '\n');
}
console.log(JSON.stringify(result));
