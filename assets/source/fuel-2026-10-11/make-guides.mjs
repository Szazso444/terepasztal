import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { FOOTPRINTS, project } from '../../../tools/building-kit.mjs';
import { GREY, boxFaces, fillPoly, strokePoly } from '../../../tools/building-guides.mjs';

const fp = FOOTPRINTS.t1;
const root = 'assets/source/fuel-2026-10-11/guides';
mkdirSync(root, { recursive: true });

function box(png, bounds, colours = GREY) {
  const faces = boxFaces(fp, bounds);
  for (const name of ['top', 'left', 'right']) fillPoly(png, faces[name], colours[name]);
  for (const face of Object.values(faces)) strokePoly(png, face, GREY.line);
}

for (const view of [1, 3, 2]) {
  const png = new PNG({ width: 1024, height: 1024 });
  box(
    png,
    { x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.5, z0: 0, z1: 4 },
    {
      top: GREY.plinthTop,
      left: GREY.plinthLeft,
      right: GREY.plinthRight,
    },
  );
  const [cx, cy] = view === 1 ? [-0.18, -0.47] : view === 3 ? [0.18, 0.47] : [0.47, -0.18];
  const post = { x0: cx - 0.03, x1: cx + 0.03, y0: cy - 0.03, y1: cy + 0.03, z0: 4, z1: 50 };
  if (view === 1) box(png, post);
  const [x, y] = view === 2 ? [0.44, 0.18] : [0.18, 0.44];
  box(png, { x0: -x, x1: x, y0: -y, y1: y, z0: 4, z1: 21 });
  box(png, { x0: -x + 0.02, x1: x - 0.02, y0: -y + 0.02, y1: y - 0.02, z0: 21, z1: 44 });
  if (view !== 1) box(png, post);
  if (view === 3) {
    const pts = [
      [0.06, 4],
      [0.22, 4],
      [0.22, 18],
      [0.06, 18],
    ].map(([y, z]) => project(fp, 0.18, y, z));
    fillPoly(png, pts, GREY.opening);
    strokePoly(png, pts, GREY.line);
  }
  const file = `${root}/fuel_pump-r${view}.png`;
  writeFileSync(file, PNG.sync.write(png));
  console.log(file);
}
