/** Narrow bridge deck block-outs, derived from tools/bridge-kit-guides.mjs. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

export const SIZE = 1024;
/** Canvas px per game px (a tile is 64 x 32 game px, so 512 x 256 here). */
export const SCALE = 8;
/** Canvas position of the tile centre at deck level (z = 0). */
export const CENTRE = { x: 512, y: 360 };
/** Game-px dimensions shared with the renderer (src/render/bridgeKit.json in v2). */
export const KIT = {
  deck: 5,
  parapet: { stone: 5, wood: 7 },
  wall: 0.12,
  arch: 22,
  truss: 18,
  brace: 24,
  pier: { side: 0.2, length: 48 },
  post: { side: 0.07, length: 44 },
};
const TOP = [222, 222, 222],
  LEFT = [168, 168, 168],
  RIGHT = [118, 118, 118],
  LINE = [40, 40, 40];

/** Tile offset (x, y) at height z (game px) to canvas px. */
let frameScale = SCALE,
  frameCentre = CENTRE;
const at = (x, y, z) => [
  frameCentre.x + frameScale * (x - y) * 32,
  frameCentre.y + frameScale * ((x + y) * 16 - z),
];

function canvas() {
  return new PNG({ width: SIZE, height: SIZE });
}
function fill(png, pts, rgb, alpha = 255) {
  const ys = pts.map((p) => p[1]),
    y0 = Math.max(0, Math.floor(Math.min(...ys))),
    y1 = Math.min(SIZE - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5,
      xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i],
        [bx, by] = pts[(i + 1) % pts.length];
      if (ay === by || cy < Math.min(ay, by) || cy >= Math.max(ay, by)) continue;
      xs.push(ax + ((cy - ay) * (bx - ax)) / (by - ay));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (
        let x = Math.max(0, Math.ceil(xs[k] - 0.5));
        x <= Math.min(SIZE - 1, xs[k + 1] - 0.5);
        x++
      ) {
        const o = (y * SIZE + x) * 4;
        png.data[o] = rgb[0];
        png.data[o + 1] = rgb[1];
        png.data[o + 2] = rgb[2];
        png.data[o + 3] = alpha;
      }
  }
}
function outline(png, pts) {
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i],
      [bx, by] = pts[(i + 1) % pts.length],
      n = Math.ceil(Math.hypot(bx - ax, by - ay));
    for (let s = 0; s <= n; s++) {
      const x = ax + ((bx - ax) * s) / n,
        y = ay + ((by - ay) * s) / n;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const px = Math.round(x + dx),
            py = Math.round(y + dy);
          if (px < 0 || py < 0 || px >= SIZE || py >= SIZE) continue;
          const o = (py * SIZE + px) * 4;
          if (!png.data[o + 3]) continue;
          png.data[o] = LINE[0];
          png.data[o + 1] = LINE[1];
          png.data[o + 2] = LINE[2];
        }
    }
  }
}
const face = (png, pts, rgb) => {
  fill(png, pts, rgb);
  outline(png, pts);
};

/**
 * A box over the tile-space rectangle [x0, x1] x [y0, y1] from z0 to z1: the two faces the
 * camera sees (+y facing left, +x facing right) and the top.
 */
function box(png, x0, x1, y0, y1, z0, z1) {
  face(png, [at(x0, y1, z0), at(x1, y1, z0), at(x1, y1, z1), at(x0, y1, z1)], LEFT);
  face(png, [at(x1, y0, z0), at(x1, y1, z0), at(x1, y1, z1), at(x1, y0, z1)], RIGHT);
  face(png, [at(x0, y0, z1), at(x1, y0, z1), at(x1, y1, z1), at(x0, y1, z1)], TOP);
}
/** The same box along the other tile axis: `along` runs on y instead of x. */
function boxAlong(png, axis, l0, l1, w0, w1, z0, z1) {
  if (axis === 'x') box(png, l0, l1, w0, w1, z0, z1);
  else box(png, w0, w1, l0, l1, z0, z1);
}

// Keep the narrow half-width in one place. Length remains one whole tile.
export const HALF_WIDTH = 0.3;
const HALF_LENGTH = 0.5;
const output = dirname(fileURLToPath(import.meta.url));
const geometry = {
  canvas: [SIZE, SIZE],
  scale: SCALE,
  centre: CENTRE,
  tileGamePx: [64, 32],
  projection: { xPerTile: 256, yPerTile: 128, zPerGamePx: -8 },
  axes: { x: 'NW-SE', y: 'NE-SW' },
  halfLength: HALF_LENGTH,
  halfWidth: HALF_WIDTH,
  widthTiles: 2 * HALF_WIDTH,
  slabZ: [-KIT.deck, 0],
  slabThicknessCanvasPx: 40,
  parapetWidthTiles: KIT.wall,
  parapetAcross: [-HALF_WIDTH, -HALF_WIDTH + KIT.wall],
  parapetHeightGamePx: KIT.parapet,
  reusedPartsMoveInTiles: 0.2,
  pads: 'full width',
  faceGreys: { top: TOP, left: LEFT, right: RIGHT, outline: LINE },
  pieces: {},
};
mkdirSync(join(output, 'guides'), { recursive: true });
for (const material of ['stone', 'wood'])
  for (const axis of ['x', 'y']) {
    const name = material + '-deck-' + axis + '-narrow';
    const png = canvas();
    boxAlong(png, axis, -HALF_LENGTH, HALF_LENGTH, -HALF_WIDTH, HALF_WIDTH, -KIT.deck, 0);
    boxAlong(
      png,
      axis,
      -HALF_LENGTH,
      HALF_LENGTH,
      -HALF_WIDTH,
      -HALF_WIDTH + KIT.wall,
      0,
      KIT.parapet[material],
    );
    const point = (l, w, z) => (axis === 'x' ? at(l, w, z) : at(w, l, z));
    const rect = (w0, w1, z) =>
      [
        [-HALF_LENGTH, w0],
        [HALF_LENGTH, w0],
        [HALF_LENGTH, w1],
        [-HALF_LENGTH, w1],
      ].map(([l, w]) => point(l, w, z));
    geometry.pieces[name] = {
      material,
      axis,
      along: [-HALF_LENGTH, HALF_LENGTH],
      across: [-HALF_WIDTH, HALF_WIDTH],
      topCorners: rect(-HALF_WIDTH, HALF_WIDTH, 0),
      bottomCorners: rect(-HALF_WIDTH, HALF_WIDTH, -KIT.deck),
      parapetTopCorners: rect(-HALF_WIDTH, -HALF_WIDTH + KIT.wall, KIT.parapet[material]),
      parapetBottomCorners: rect(-HALF_WIDTH, -HALF_WIDTH + KIT.wall, 0),
      faces: [
        {
          name: 'slab-near-long-edge',
          points: [
            point(-HALF_LENGTH, HALF_WIDTH, -KIT.deck),
            point(HALF_LENGTH, HALF_WIDTH, -KIT.deck),
            point(HALF_LENGTH, HALF_WIDTH, 0),
            point(-HALF_LENGTH, HALF_WIDTH, 0),
          ],
        },
        {
          name: 'slab-positive-cut',
          points: [
            point(HALF_LENGTH, -HALF_WIDTH, -KIT.deck),
            point(HALF_LENGTH, HALF_WIDTH, -KIT.deck),
            point(HALF_LENGTH, HALF_WIDTH, 0),
            point(HALF_LENGTH, -HALF_WIDTH, 0),
          ],
        },
        { name: 'slab-top', points: rect(-HALF_WIDTH, HALF_WIDTH, 0) },
        {
          name: 'parapet-inner-face',
          points: [
            point(-HALF_LENGTH, -HALF_WIDTH + KIT.wall, 0),
            point(HALF_LENGTH, -HALF_WIDTH + KIT.wall, 0),
            point(HALF_LENGTH, -HALF_WIDTH + KIT.wall, KIT.parapet[material]),
            point(-HALF_LENGTH, -HALF_WIDTH + KIT.wall, KIT.parapet[material]),
          ],
        },
        {
          name: 'parapet-positive-cut',
          points: [
            point(HALF_LENGTH, -HALF_WIDTH, 0),
            point(HALF_LENGTH, -HALF_WIDTH + KIT.wall, 0),
            point(HALF_LENGTH, -HALF_WIDTH + KIT.wall, KIT.parapet[material]),
            point(HALF_LENGTH, -HALF_WIDTH, KIT.parapet[material]),
          ],
        },
        {
          name: 'parapet-top',
          points: rect(-HALF_WIDTH, -HALF_WIDTH + KIT.wall, KIT.parapet[material]),
        },
      ],
    };
    writeFileSync(join(output, 'guides', name + '.png'), PNG.sync.write(png));
  }
frameScale = 15;
frameCentre = { x: 512, y: 512 };
const centred = canvas();
box(centred, -HALF_LENGTH, HALF_LENGTH, -HALF_WIDTH, HALF_WIDTH, -KIT.deck, 0);
box(centred, -HALF_LENGTH, HALF_LENGTH, -HALF_WIDTH, -HALF_WIDTH + KIT.wall, 0, KIT.parapet.stone);
writeFileSync(join(output, 'guides', 'stone-deck-x-narrow-centred.png'), PNG.sync.write(centred));
geometry.stoneDeckXCentred = {
  canvas: [1024, 1024],
  scale: 15,
  centre: frameCentre,
  tileGamePx: [64, 32],
  tileCanvasPx: [960, 480],
  axis: 'x',
  axes: { x: 'NW-SE', y: 'NE-SW' },
  projection: {
    xPerTile: 480,
    yPerTile: 240,
    zPerGamePx: -15,
    formula: '(512+480*(x-y),512+240*(x+y)-15*z)',
  },
  along: [-0.5, 0.5],
  across: [-HALF_WIDTH, HALF_WIDTH],
  halfWidth: HALF_WIDTH,
  widthTiles: 0.6,
  slabZ: [-5, 0],
  slabThicknessGamePx: 5,
  slabThicknessCanvasPx: 75,
  topCorners: [
    [416, 320],
    [896, 560],
    [608, 704],
    [128, 464],
  ],
  bottomCorners: [
    [416, 395],
    [896, 635],
    [608, 779],
    [128, 539],
  ],
  sideFace: [
    [128, 464],
    [608, 704],
    [608, 779],
    [128, 539],
  ],
  cutEnd: [
    [896, 560],
    [608, 704],
    [608, 779],
    [896, 635],
  ],
  parapetEdgeY: -0.3,
  parapetAcross: [-0.3, -0.18],
  parapetWidthTiles: 0.12,
  parapetZ: [0, 5],
  parapetHeightGamePx: 5,
  parapetTopCorners: [
    [416, 245],
    [896, 485],
    [838.4, 513.8],
    [358.4, 273.8],
  ],
  parapetBottomCorners: [
    [416, 320],
    [896, 560],
    [838.4, 588.8],
    [358.4, 348.8],
  ],
  parapetInnerFace: [
    [358.4, 273.8],
    [838.4, 513.8],
    [838.4, 588.8],
    [358.4, 348.8],
  ],
  parapetCutEnd: [
    [896, 485],
    [838.4, 513.8],
    [838.4, 588.8],
    [896, 560],
  ],
  box: {
    left: 128,
    right: 896,
    top: 245,
    bottom: 779,
    width: 768,
    height: 534,
    centre: [512, 512],
    canvasWidthFraction: 0.75,
  },
  lowestCorner: [608, 779],
  sideHorizontalSpan: 480,
  cutEndHorizontalSpan: 288,
  widthRatio: 0.6,
  faceGreys: geometry.faceGreys,
  kitFrameMapping: {
    scale: 8 / 15,
    sourceCentre: [512, 512],
    targetCentre: [512, 360],
    targetScale: 8,
    formula: '(512,360)+(8/15)*(p-(512,512))',
  },
};
writeFileSync(join(output, 'geometry.json'), JSON.stringify(geometry, null, 2) + '\n');
console.log('Wrote four original guides, centred stone x guide and geometry.json');
