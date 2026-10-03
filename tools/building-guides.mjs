/** Draw the building guides: a grey block-out per footprint and rotation, in the game's projection.
 * node tools/building-guides.mjs [output directory]
 * A picture is painted as an edit of its guide, so every picture of a footprint comes out with the
 * same camera, scale and position. The footprint is a low plinth; on it stands a plain block whose
 * front carries a door, and whose end walls carry the portals when it is a depot. Faces are flat
 * greys by the way they look: top light, lower-left wall mid, lower-right wall dark.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  FOOTPRINTS,
  ROOT,
  ROTATIONS,
  WALL_INSET,
  footprintTiles,
  project,
  wallRole,
} from './building-kit.mjs';

export const GREY = {
  top: [222, 222, 222],
  left: [168, 168, 168],
  right: [118, 118, 118],
  line: [40, 40, 40],
  plinthTop: [190, 190, 190],
  plinthLeft: [140, 140, 140],
  plinthRight: [96, 96, 96],
  opening: [56, 56, 56],
};
/** Game px. The plinth is the footprint; the block stands on it, set in from its edge. */
const PLINTH = 4;
const HEIGHT = { t1: 40, t1tall: 40, t1x2: 34, t2x2: 46 };
/** Openings per footprint: `at` is the offset along the wall from its middle, in tiles. */
const OPENINGS = {
  t1: { front: [{ at: 0, width: 0.24, height: 20 }] },
  t1tall: { front: [{ at: 0, width: 0.24, height: 20 }] },
  t1x2: {
    front: [{ at: 0, width: 0.16, height: 18 }],
    side: [{ at: 0, width: 0.44, height: 24 }],
  },
  t2x2: {
    front: [{ at: 0, width: 0.16, height: 18 }],
    side: [
      { at: -0.5, width: 0.5, height: 30 },
      { at: 0.5, width: 0.5, height: 30 },
    ],
  },
};

export function guideFile(fpId, rot) {
  return `${ROOT}/guides/${fpId}-r${rot}.png`;
}

/** The block of a guide: tile offsets from the footprint centre, heights in game px. */
export function blockOf(fpId, rot) {
  const { w, h } = footprintTiles(FOOTPRINTS[fpId], rot);
  const x1 = w / 2 - WALL_INSET,
    y1 = h / 2 - WALL_INSET;
  return { x0: -x1, y0: -y1, x1, y1, z0: PLINTH, z1: PLINTH + HEIGHT[fpId] };
}

/** Fill a polygon given as canvas points (even-odd scanline, pixel centres). */
export function fillPoly(png, pts, rgb, alpha = 255) {
  const ys = pts.map((p) => p[1]);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(png.height - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      if (ay === by || cy < Math.min(ay, by) || cy >= Math.max(ay, by)) continue;
      xs.push(ax + ((cy - ay) * (bx - ax)) / (by - ay));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(png.width - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = from; x <= to; x++) {
        const o = (y * png.width + x) * 4;
        png.data[o] = rgb[0];
        png.data[o + 1] = rgb[1];
        png.data[o + 2] = rgb[2];
        png.data[o + 3] = alpha;
      }
    }
  }
}

/** Outline a polygon with a line `width` px thick. */
export function strokePoly(png, pts, rgb, width = 3) {
  const r = width / 2;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = (-(by - ay) / len) * r,
      ny = ((bx - ax) / len) * r;
    fillPoly(
      png,
      [
        [ax + nx, ay + ny],
        [bx + nx, by + ny],
        [bx - nx, by - ny],
        [ax - nx, ay - ny],
      ],
      rgb,
    );
    fillPoly(
      png,
      [
        [ax - r, ay - r],
        [ax + r, ay - r],
        [ax + r, ay + r],
        [ax - r, ay + r],
      ],
      rgb,
    );
  }
}

/** The three faces of a box the camera sees, as canvas polygons. */
export function boxFaces(fp, b) {
  const p = (x, y, z) => project(fp, x, y, z);
  return {
    top: [p(b.x0, b.y0, b.z1), p(b.x1, b.y0, b.z1), p(b.x1, b.y1, b.z1), p(b.x0, b.y1, b.z1)],
    left: [p(b.x0, b.y1, b.z0), p(b.x1, b.y1, b.z0), p(b.x1, b.y1, b.z1), p(b.x0, b.y1, b.z1)],
    right: [p(b.x1, b.y0, b.z0), p(b.x1, b.y1, b.z0), p(b.x1, b.y1, b.z1), p(b.x1, b.y0, b.z1)],
  };
}

function drawBox(png, fp, b, colours) {
  const faces = boxFaces(fp, b);
  fillPoly(png, faces.top, colours.top);
  fillPoly(png, faces.left, colours.left);
  fillPoly(png, faces.right, colours.right);
  for (const face of Object.values(faces)) strokePoly(png, face, GREY.line);
}

/** One guide: plinth, block, and the openings of the walls the camera sees. */
export function drawGuide(fpId, rot) {
  const fp = FOOTPRINTS[fpId];
  const png = new PNG({ width: fp.canvas[0], height: fp.canvas[1] });
  const { w, h } = footprintTiles(fp, rot);
  drawBox(
    png,
    fp,
    { x0: -w / 2, y0: -h / 2, x1: w / 2, y1: h / 2, z0: 0, z1: PLINTH },
    { top: GREY.plinthTop, left: GREY.plinthLeft, right: GREY.plinthRight },
  );
  const b = blockOf(fpId, rot);
  drawBox(png, fp, b, GREY);
  // the S wall runs along x at y1, the E wall along y at x1
  for (const wall of ['S', 'E']) {
    const role = wallRole(wall, rot);
    const list = OPENINGS[fpId][role === 'front' ? 'front' : role === 'back' ? 'none' : 'side'];
    for (const o of list ?? []) {
      const a = o.at - o.width / 2,
        c = o.at + o.width / 2,
        top = b.z0 + o.height;
      const pts =
        wall === 'S'
          ? [
              project(fp, a, b.y1, b.z0),
              project(fp, c, b.y1, b.z0),
              project(fp, c, b.y1, top),
              project(fp, a, b.y1, top),
            ]
          : [
              project(fp, b.x1, a, b.z0),
              project(fp, b.x1, c, b.z0),
              project(fp, b.x1, c, top),
              project(fp, b.x1, a, top),
            ];
      fillPoly(png, pts, GREY.opening);
      strokePoly(png, pts, GREY.line);
    }
  }
  return png;
}

/** Write a guide for every footprint and rotation. */
export function writeGuides(root = '.') {
  const out = [];
  for (const fpId of Object.keys(FOOTPRINTS))
    for (const r of ROTATIONS) {
      const file = join(root, guideFile(fpId, r.index));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, PNG.sync.write(drawGuide(fpId, r.index)));
      out.push(file);
    }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = writeGuides(process.argv[2] ?? '.');
  console.log(`${files.length} guides in ${dirname(files[0])}`);
}
