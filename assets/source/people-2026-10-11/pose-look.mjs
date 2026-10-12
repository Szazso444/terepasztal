import { root, json, read, write, PNG } from './pose-png.mjs';
const id = process.argv[2],
  e = json('prompts.json')['redo-2026-10-11'].findLast((e) => e.id === id && e.file);
if (!e) throw Error('Recorded painting not found');
const source = read(e.file),
  look = new PNG({ width: source.width, height: source.height });
let white = 0,
  amber = 0,
  foreground = 0,
  opaque = 0,
  nonzero = 0;
for (let p = 0; p < source.data.length; p += 4) {
  const a = source.data[p + 3] / 255;
  nonzero += a > 0 ? 1 : 0;
  for (let n = 0; n < 3; n++)
    look.data[p + n] = Math.round(source.data[p + n] * a + [120, 128, 76][n] * (1 - a));
  look.data[p + 3] = 255;
  if (source.data[p + 3] > 128) {
    foreground++;
    opaque += source.data[p + 3] >= 245 ? 1 : 0;
    const [r, g, b] = source.data.subarray(p, p + 3);
    if (r >= 236 && g >= 228 && b >= 208) white++;
    if (r >= 232 && g >= 150 && g <= 190 && b <= 90 && r - b >= 150) amber++;
  }
}
write('checks/' + id + '-look.png', look);
console.log(
  JSON.stringify({
    file: 'checks/' + id + '-look.png',
    foreground,
    nearOpaqueFraction: opaque / foreground,
    whiteCapViolations: white,
    strongAmberPixels: amber,
    nonzeroAlphaPixels: nonzero,
  }),
);
