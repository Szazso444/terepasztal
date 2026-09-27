/** Pack the modular bridge kit (assets/source/bridges-v1) into the `bridges` atlas group.
 * node tools/bridge-kit.mjs [source directory] [output directory]
 * A source directory with a guides/ folder (bridges-v2 and later) is fitted to its guides.
 * Each source is trimmed, measured against the tile it stands for, and resampled to the
 * illustrated density. Geometry the renderer needs (deck thickness, wall heights, shaft
 * lengths) goes to src/render/bridgeKit.json. Uses pngjs (dev dependency) only.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { trimSource, resample, packFrames } from './illustrated-sprites.mjs';
import * as GUIDES from './bridge-kit-guides.mjs';

const DENSITY = 4;
const SOURCE = 'assets/source/bridges-v1';
/** Kinds: slab (a 1-tile deck or pad), edge (a wall on the near tile edge), shaft (a pier). */
const PIECES = {
  'stone-deck-x': { kind: 'slab', free: 'left' },
  'stone-deck-y': { kind: 'slab', free: 'right' },
  'stone-pad': { kind: 'slab', free: 'left' },
  'stone-rail-x': { kind: 'edge', thick: 0.12 },
  'stone-rail-y': { kind: 'edge', thick: 0.12 },
  'stone-arch-x': { kind: 'edge', thick: 0.14 },
  'stone-arch-y': { kind: 'edge', thick: 0.14 },
  'stone-pier': { kind: 'shaft', side: 0.2 },
  'wood-deck-x': { kind: 'slab', free: 'left' },
  'wood-deck-y': { kind: 'slab', free: 'right' },
  'wood-pad': { kind: 'slab', free: 'left' },
  'wood-rail-x': { kind: 'edge', thick: 0.08 },
  'wood-rail-y': { kind: 'edge', thick: 0.08 },
  'wood-truss-x': { kind: 'edge', thick: 0.08 },
  'wood-truss-y': { kind: 'edge', thick: 0.08 },
  'wood-brace-x': { kind: 'edge', thick: 0.05 },
  'wood-brace-y': { kind: 'edge', thick: 0.05 },
  'wood-post': { kind: 'shaft', side: 0.07 },
};

const opaque = (p, x, y) => p.data[(y * p.width + x) * 4 + 3] > 128;
function bounds(p) {
  let left = p.width,
    right = -1,
    top = p.height,
    bottom = -1;
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++)
      if (opaque(p, x, y)) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  return { left, right, top, bottom };
}
/** Opaque run length down one column, from its first opaque pixel. */
function run(p, x) {
  let y = 0;
  while (y < p.height && !opaque(p, x, y)) y++;
  let n = 0;
  while (y + n < p.height && opaque(p, x, y + n)) n++;
  return n;
}
/** Mean x of the opaque pixels on the lowest row. */
function lowest(p, bottom) {
  let sum = 0,
    n = 0;
  for (let x = 0; x < p.width; x++)
    if (opaque(p, x, bottom)) {
      sum += x;
      n++;
    }
  return sum / n;
}

/**
 * v2: every source was painted over its guide (tools/bridge-kit-guides.mjs), so its silhouette
 * is fitted onto the guide's and the anchors come from the guide's known geometry instead of
 * being measured.
 */
function buildV2(dir) {
  const { SCALE, CENTRE, KIT } = GUIDES,
    frames = [],
    geometry = {},
    toAtlas = DENSITY / SCALE,
    at = (x, y, z) => [CENTRE.x + SCALE * (x - y) * 32, CENTRE.y + SCALE * ((x + y) * 16 - z)];
  for (const name of Object.keys(PIECES)) {
    const src = trimSource(PNG.sync.read(readFileSync(join(dir, `${name}.png`)))),
      guide = PNG.sync.read(readFileSync(join(dir, 'guides', `${name}.png`))),
      g = bounds(guide),
      gw = g.right - g.left + 1,
      gh = g.bottom - g.top + 1,
      material = name.startsWith('stone') ? 'stone' : 'wood';
    // Anchor and geometry in guide space, as the renderer expects them (see PIECES kinds).
    let anchor, geo;
    if (/-(deck|pad)/.test(name)) [anchor, geo] = [at(0, 0, 0), { thickness: KIT.deck }];
    else if (/-rail-/.test(name)) [anchor, geo] = [at(0, 0, 0), { height: KIT.parapet[material] }];
    else if (/-(arch|truss|brace)-/.test(name)) {
      const height = name.includes('arch') ? KIT.arch : name.includes('truss') ? KIT.truss : KIT.brace;
      anchor = at(0, 0, -KIT.deck - height);
      geo = name.includes('brace') ? { height, along: 1 } : { height };
    } else {
      const shaft = material === 'stone' ? KIT.pier : KIT.post;
      [anchor, geo] = [at(0, 0, -KIT.deck), { length: shaft.length }];
    }
    const w = Math.max(1, Math.round(gw * toAtlas)),
      h = Math.max(1, Math.round(gh * toAtlas));
    frames.push({
      key: `bridgekit/${name}`,
      png: resample(src, w, h),
      ax: (anchor[0] - g.left) * toAtlas,
      ay: (anchor[1] - g.top) * toAtlas,
    });
    geometry[name] = geo;
  }
  return { frames, geometry };
}

export function build(output = 'public/assets', dir = SOURCE) {
  if (existsSync(join(dir, 'guides'))) {
    const { frames, geometry } = buildV2(dir);
    return write(output, frames, geometry);
  }
  const frames = [],
    geometry = {};
  for (const [name, piece] of Object.entries(PIECES)) {
    const src = trimSource(PNG.sync.read(readFileSync(join(dir, `${name}.png`)))),
      b = bounds(src),
      width = b.right - b.left + 1;
    // s: source pixels per game pixel.
    let s, ax, ay;
    const g = {};
    if (piece.kind === 'slab') {
      // A one-tile slab spans exactly one tile width; its bottom vertex sits the slab thickness
      // below the top face's bottom vertex. The anchor is the top face centre, at deck level.
      s = width / 64;
      const column = piece.free === 'left' ? b.left + Math.ceil(s) : b.right - Math.ceil(s);
      g.thickness = Math.max(2, run(src, column) / s - 1);
      ax = (b.left + b.right) / 2;
      ay = b.bottom - (16 + g.thickness) * s;
    } else if (piece.kind === 'edge') {
      // A wall one tile long on the near tile edge: 32 px across plus its own thickness. Its
      // lowest point is the tile's bottom vertex at the wall's foot.
      s = width / (32 * (1 + piece.thick));
      ax = lowest(src, b.bottom);
      ay = b.bottom - 16 * s;
      const x = Math.round(ax - s);
      let top = 0;
      while (top < src.height && !opaque(src, x, top)) top++;
      g.height = (b.bottom - top) / s;
    } else {
      // A square shaft `side` tiles across; anchor at the centre of its top face.
      s = width / (64 * piece.side);
      ax = (b.left + b.right) / 2;
      ay = b.top + 16 * piece.side * s;
      g.length = (b.bottom - ay) / s;
    }
    const k = DENSITY / s,
      w = Math.max(1, Math.round(src.width * k)),
      h = Math.max(1, Math.round(src.height * k));
    frames.push({
      key: `bridgekit/${name}`,
      png: resample(src, w, h),
      ax: ax * k,
      ay: ay * k,
    });
    geometry[name] = Object.fromEntries(
      Object.entries(g).map(([key, v]) => [key, Math.round(v * 100) / 100]),
    );
  }
  return write(output, frames, geometry);
}

function write(output, frames, geometry) {
  const packed = packFrames(frames);
  writeFileSync(join(output, 'bridges.png'), PNG.sync.write(packed.sheet));
  writeFileSync(
    join(output, 'bridges.json'),
    JSON.stringify({ resolution: DENSITY, partial: true, frames: packed.frames }, null, 2) + '\n',
  );
  writeFileSync('src/render/bridgeKit.json', JSON.stringify(geometry, null, 2) + '\n');
  return geometry;
}

if (process.argv[1]?.endsWith('bridge-kit.mjs'))
  console.log(JSON.stringify(build(process.argv[3], process.argv[2])));
