/** Draw the bridge kit v2 guides: exact block-outs of every piece in the game's projection.
 * node tools/bridge-kit-guides.mjs [output directory]
 * Every guide shares one 1024 x 1024 canvas with the tile centre at CENTRE and 8 canvas px per
 * game px, so pieces painted over their guides snap together without measuring. Faces are flat
 * greys by orientation (top light, left-facing mid, right-facing dark) with a dark outline.
 * Uses pngjs (dev dependency) only.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
const at = (x, y, z) => [CENTRE.x + SCALE * (x - y) * 32, CENTRE.y + SCALE * ((x + y) * 16 - z)];

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
/** Erase a shape: back to transparent. */
function cut(png, pts) {
  fill(png, pts, [0, 0, 0], 0);
}

const H = 0.5;
const pieces = {
  // Deck slab over the whole tile, far parapet on the edge away from the camera.
  deck(png, material, axis) {
    box(png, -H, H, -H, H, -KIT.deck, 0);
    const t = KIT.wall,
      h = KIT.parapet[material];
    boxAlong(png, axis, -H, H, -H, -H + t, 0, h);
  },
  // Near parapet: on the edge toward the camera, standing on the deck.
  rail(png, material, axis) {
    boxAlong(png, axis, -H, H, H - KIT.wall, H, 0, KIT.parapet[material]);
  },
  pad(png) {
    box(png, -H, H, -H, H, -KIT.deck, 0);
  },
  // Arch wall under the near deck edge: one opening per tile, half a pier at each cut end.
  arch(png, material, axis) {
    const z0 = -KIT.deck - KIT.arch,
      z1 = -KIT.deck;
    boxAlong(png, axis, -H, H, H - KIT.wall, H, z0, z1);
    const hole = [];
    for (let i = 0; i <= 24; i++) {
      const a = (Math.PI * i) / 24,
        l = -Math.cos(a) * 0.34,
        z = z0 + 13 * Math.sin(a) + 1;
      hole.push(axis === 'x' ? at(l, H, z) : at(H, l, z));
    }
    hole.push(axis === 'x' ? at(0.34, H, z0 - 2) : at(H, 0.34, z0 - 2));
    hole.push(axis === 'x' ? at(-0.34, H, z0 - 2) : at(H, -0.34, z0 - 2));
    cut(png, hole);
  },
  // Truss hung under the near deck edge: two chords and Warren diagonals, one V per tile.
  truss(png, material, axis) {
    const top = -KIT.deck,
      bottom = top - KIT.truss,
      w0 = H - KIT.wall,
      w1 = H;
    boxAlong(png, axis, -H, H, w0, w1, top - 3, top);
    boxAlong(png, axis, -H, H, w0, w1, bottom, bottom + 3);
    const strut = (l0, z0, l1, z1) => {
      const d = 0.035,
        pts =
          axis === 'x'
            ? [at(l0 - d, w1, z0), at(l0 + d, w1, z0), at(l1 + d, w1, z1), at(l1 - d, w1, z1)]
            : [at(w1, l0 - d, z0), at(w1, l0 + d, z0), at(w1, l1 + d, z1), at(w1, l1 - d, z1)];
      face(png, pts, axis === 'x' ? LEFT : RIGHT);
    };
    strut(-H + 0.035, top - 3, 0, bottom + 3);
    strut(0, bottom + 3, H - 0.035, top - 3);
  },
  // X brace between two posts under the near deck edge, from the deck down BRACE px.
  brace(png, material, axis) {
    const top = -KIT.deck,
      bottom = top - KIT.brace,
      w = H,
      d = 0.035,
      bar = (l0, z0, l1, z1) =>
        face(
          png,
          axis === 'x'
            ? [at(l0 - d, w, z0), at(l0 + d, w, z0), at(l1 + d, w, z1), at(l1 - d, w, z1)]
            : [at(w, l0 - d, z0), at(w, l0 + d, z0), at(w, l1 + d, z1), at(w, l1 - d, z1)],
          axis === 'x' ? LEFT : RIGHT,
        );
    bar(-0.4, top, 0.4, bottom);
    bar(-0.4, bottom, 0.4, top);
  },
  // A square pier or post centred under the tile, from the deck underside down its length.
  shaft(png, material) {
    const { side, length } = material === 'stone' ? KIT.pier : KIT.post,
      s = side / 2;
    box(png, -s, s, -s, s, -KIT.deck - length, -KIT.deck);
  },
};

const LIST = [
  ['stone-deck-x', 'deck', 'stone', 'x'],
  ['stone-deck-y', 'deck', 'stone', 'y'],
  ['stone-rail-x', 'rail', 'stone', 'x'],
  ['stone-rail-y', 'rail', 'stone', 'y'],
  ['stone-pad', 'pad', 'stone'],
  ['stone-pier', 'shaft', 'stone'],
  ['stone-arch-x', 'arch', 'stone', 'x'],
  ['stone-arch-y', 'arch', 'stone', 'y'],
  ['wood-deck-x', 'deck', 'wood', 'x'],
  ['wood-deck-y', 'deck', 'wood', 'y'],
  ['wood-rail-x', 'rail', 'wood', 'x'],
  ['wood-rail-y', 'rail', 'wood', 'y'],
  ['wood-pad', 'pad', 'wood'],
  ['wood-post', 'shaft', 'wood'],
  ['wood-brace-x', 'brace', 'wood', 'x'],
  ['wood-brace-y', 'brace', 'wood', 'y'],
  ['wood-truss-x', 'truss', 'wood', 'x'],
  ['wood-truss-y', 'truss', 'wood', 'y'],
];

/** Faint tile outline and centre mark, for the assembled review sheets only. */
function tileMark(png) {
  const t = [at(-H, -H, 0), at(H, -H, 0), at(H, H, 0), at(-H, H, 0)];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = t[i],
      [bx, by] = t[(i + 1) % 4];
    for (let s = 0; s <= 400; s++) {
      const x = Math.round(ax + ((bx - ax) * s) / 400),
        y = Math.round(ay + ((by - ay) * s) / 400),
        o = (y * SIZE + x) * 4;
      if (png.data[o + 3]) continue;
      png.data[o] = 60;
      png.data[o + 1] = 140;
      png.data[o + 2] = 220;
      png.data[o + 3] = 255;
    }
  }
}

export function build(output = 'assets/source/bridges-v2/guides') {
  mkdirSync(output, { recursive: true });
  for (const [name, kind, material, axis] of LIST) {
    const png = canvas();
    pieces[kind](png, material, axis);
    writeFileSync(join(output, `${name}.png`), PNG.sync.write(png));
  }
  // Assembled references: how the pieces stack on one tile, in draw order.
  for (const [material, water] of [
    ['stone', 'arch'],
    ['wood', 'truss'],
  ])
    for (const axis of ['x', 'y']) {
      const png = canvas();
      tileMark(png);
      pieces[water](png, material, axis);
      pieces.deck(png, material, axis);
      pieces.rail(png, material, axis);
      writeFileSync(join(output, `assembled-${material}-${axis}.png`), PNG.sync.write(png));
    }
  return LIST.length;
}

if (process.argv[1]?.endsWith('bridge-kit-guides.mjs'))
  console.log(`${build(process.argv[2])} guides`);
