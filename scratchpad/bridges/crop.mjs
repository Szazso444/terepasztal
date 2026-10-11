// Crop a region of a PNG and enlarge it (nearest), for looking at details of a render.
//   node scratchpad/bridges/crop.mjs <in.png> <x> <y> <w> <h> [scale=3] [out.png]
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const [input, x, y, w, h, scale = '3', out = 'scratchpad/bridges/crop.png'] = process.argv.slice(2);
const src = PNG.sync.read(readFileSync(input)),
  k = +scale,
  dst = new PNG({ width: +w * k, height: +h * k });
for (let yy = 0; yy < dst.height; yy++)
  for (let xx = 0; xx < dst.width; xx++) {
    const sx = Math.min(src.width - 1, +x + Math.floor(xx / k)),
      sy = Math.min(src.height - 1, +y + Math.floor(yy / k));
    src.data.copy(dst.data, (yy * dst.width + xx) * 4, (sy * src.width + sx) * 4, (sy * src.width + sx) * 4 + 4);
  }
writeFileSync(out, PNG.sync.write(dst));
console.log(out, dst.width, dst.height);
