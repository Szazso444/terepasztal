// How large a family's building stands in each of its views, once the pictures are laid onto the
// footprint as the game will show them: the height of the silhouette above the near corner, the
// whole height of the picture, and its area. A building that is the same size from every side
// has about the same figures in every view.
//   node .cache/bulk_measure.mjs <buildings-v2 folder> <family> <footprint>
import { readFileSync, existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import { FOOTPRINTS } from '../tools/building-kit.mjs';
import { fitGroup, normalisePicture } from '../tools/building-fit.mjs';

const [root, family, fpId] = process.argv.slice(2);
const fp = FOOTPRINTS[fpId];
const solid = (png, x, y) => png.data[(y * png.width + x) * 4 + 3] > 128;
const out = {};
for (let age = 0; age < 6; age++) {
  const pngs = [0, 1, 2, 3].map((rot) => {
    const file = `${root}/${family}/${family}-a${age}-r${rot}.png`;
    return existsSync(file) ? PNG.sync.read(readFileSync(file)) : null;
  });
  const fits = fitGroup(pngs, fpId);
  fits.forEach((fit, rot) => {
    if (!fit) return;
    const png = normalisePicture(pngs[rot], fit, fpId, 1);
    let top = png.height,
      bottom = 0,
      left = png.width,
      right = 0,
      area = 0;
    for (let y = 0; y < png.height; y++)
      for (let x = 0; x < png.width; x++)
        if (solid(png, x, y)) {
          area++;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
          if (x < left) left = x;
          if (x > right) right = x;
        }
    // the near corner: the lowest solid pixel of the picture's middle fifth
    const mid = Math.round((left + right) / 2);
    let corner = { x: mid, y: 0 };
    for (let x = Math.round(mid - (right - left) / 10); x <= mid + (right - left) / 10; x++)
      for (let y = png.height - 1; y >= 0; y--)
        if (solid(png, x, y)) {
          if (y > corner.y) corner = { x, y };
          break;
        }
    // how far up the silhouette runs unbroken above the near corner
    let up = corner.y;
    while (up > 0 && solid(png, corner.x, up - 1)) up--;
    out[`a${age}-r${rot}`] = {
      width: +((right - left) / fp.scale).toFixed(2),
      height: +((bottom - top) / fp.scale).toFixed(2),
      overCorner: +((corner.y - up) / fp.scale).toFixed(2),
      area: +(area / fp.scale ** 2).toFixed(2),
    };
  });
}
console.log(JSON.stringify(out, null, 1));
