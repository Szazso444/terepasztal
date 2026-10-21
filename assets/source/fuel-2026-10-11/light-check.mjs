import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

export function brickLuma(png, box) {
  const [x0, y0, x1, y1] = box;
  const values = [];
  for (let y = Math.max(0, y0); y < Math.min(png.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(png.width, x1); x++) {
      const i = (y * png.width + x) * 4;
      const [r, g, b, a] = png.data.subarray(i, i + 4);
      if (a > 200 && r >= g + 25 && g >= b - 10) values.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
    }
  }
  values.sort((a, b) => a - b);
  const half = Math.floor(values.length / 2);
  const median = !values.length
    ? null
    : values.length % 2
      ? values[half]
      : (values[half - 1] + values[half]) / 2;
  return { box, pixels: values.length, median };
}

export function checkLight(png, boxes) {
  const walls = boxes.map((box) => brickLuma(png, box));
  const ratio =
    walls[0].median && walls[1].median !== null ? walls[1].median / walls[0].median : null;
  return { walls, rightToLeft: ratio, pass: ratio !== null && ratio <= 0.85 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [file, ...args] = process.argv.slice(2);
  const boxes = args.map((arg) => arg.split(',').map(Number));
  if (
    !file ||
    boxes.length !== 2 ||
    boxes.some((b) => b.length !== 4 || b.some((n) => !Number.isInteger(n)))
  ) {
    throw new Error('Usage: node light-check.mjs <picture> <x0,y0,x1,y1> <x0,y0,x1,y1>');
  }
  console.log(
    JSON.stringify({ file, ...checkLight(PNG.sync.read(readFileSync(file)), boxes) }, null, 2),
  );
}
