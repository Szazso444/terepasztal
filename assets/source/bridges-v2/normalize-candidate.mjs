import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { resample } from '../../../tools/illustrated-sprites.mjs';

// User-authorized exception: uniformly convert the entire canvas, never its object bounds.
// Raw imagegen PNGs are retained separately. No cropping, translation, masking or warping.
const [source, output] = process.argv.slice(2);
if (!source || !output || source === output)
  throw new Error('Supply distinct input and output PNGs');
const png = PNG.sync.read(readFileSync(source));
if (png.width !== png.height)
  throw new Error('Only square canvases can be uniformly converted to 1024');
writeFileSync(output, PNG.sync.write(resample(png, 1024, 1024)));
console.log(
  JSON.stringify({
    source,
    output,
    from: [png.width, png.height],
    to: [1024, 1024],
    method: 'full-canvas uniform area resampling',
  }),
);
