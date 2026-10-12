#!/usr/bin/env node
/**
 * Finishing for #319: the road and level-crossing pictures at the exact tile geometry, as the
 * author chose them on 2026-10-11.
 *
 *   node assets/source/roads-2026-10-11/finish-roads.mjs [--option value ...]
 *
 * Writes the 19 pictures (15 roads, 4 level crossings) to this folder's root, 1024x1024 RGBA in
 * the one-tile convention of tools/building-kit.mjs (FOOTPRINTS.t1, scale 8, anchor (512, 832)),
 * and finish.json, the parameters used and what was measured. check-final.mjs checks the
 * pictures. Only pngjs is needed, and every run writes the same bytes.
 *
 * The defaults are the author's choices (decision board, 2026-10-11, picked from composites on a
 * game capture):
 * - The road is 0.32 tile wide: the whole visible road.
 * - Edge B: no drawn verge. The gravel's edge fades into the grass over 0.05 tile, with a few
 *   grass tufts across it in the game's painted grass colours (colours.json).
 * - Level crossings: dressed stone on regular track and packed dirt on narrow track, after the
 *   author's base-v1 crossings (assets/source/base-v1/people-crossing-stone.png and
 *   people-crossing-dirt.png). A deck is as long along the track as the road is wide, flush with
 *   it, and reaches 0.06 tile past each rail (the sleeper ends). The rails stay thin slots in the
 *   rail colour, drawn as the game draws its rails on the track: a thin bright head with a thin
 *   dark side a rail's height below it on screen. Not black grooves.
 * - The gravel is toned to the colour of the composites, its ruts are softened to 0.45, and each
 *   joining leg runs on 2 world px past its tile edge.
 *
 * Options and their defaults:
 * --out <dir>          where the pictures and finish.json go [this folder]
 * --material codex     the road strips. codex: materials/road-strip-{x,y}.png (Codex, 8699ec3a);
 *                      drafts: raw/road-straight-{x,y}.png (the first paintings, 9dbeb5d)
 * --width 0.32         gravel width in tiles. The whole cross-section (its edges and the two ruts
 *                      at 0.4 of the half-width) scales with it, and so do the stones, because the
 *                      along scale follows the across scale
 * --edge blend         blend: no verge; the gravel darkens toward worn soil over its outer
 *                      0.06 tile, its alpha fades over --feather round an edge that wanders gently,
 *                      and tufts sit astride the edge. Edge wander and tufts are functions of the
 *                      tile position with period 1, so they match across every join.
 *                      crisp: the painted moss verge, --verge wide, with a one-pixel outline
 * --feather 0.05       blend: width of the alpha fade, tiles
 * --verge 0.03         crisp: width of the moss verge on each side, tiles
 * --crossing stone     stone: dressed stone on regular gauge, packed dirt on narrow;
 *                      stone-swapped: the other way round; timber: weathered planks in the game's
 *                      sleeper colours; painted: the decks rectified from
 *                      raw/crossing-*-attempt-2.png with dark grooves (the 0.5 finish)
 * --deck-margin 0.06   deck beyond each rail, tiles (painted: 0.1)
 * --deck-scale 0.8605  brightness scale of the stone and its pebbles: the one the author saw
 * --tone 182,162,133   the gravel's mean colour after toning, scaled per channel; or one number,
 *                      its mean luma, scaled uniformly; 0 keeps the painting's
 * --ruts 0.45          strength of the across profile (the ruts and the crown), 0 to 1
 * --bleed 2            world pixels a leg runs on past its tile edge, opaque parts only, so that
 *                      separately filtered sprites overlap instead of letting the grass through
 * --check 1            prints the join and bleed checks instead of writing pictures
 *
 * The 0.5-tile finish of 1dcd8e3, kept in raw/final-w0.5-moss-verge/, is byte for byte
 *   --material drafts --width 0.5 --edge crisp --crossing painted --tone 0 --ruts 1 --bleed 0
 *
 * How it works. The paintings are the material and the geometry is the shape: prompting again
 * does not hit exact widths, so every picture is resampled through a mapping built from
 * geometry.json and crossing-geometry.json; the new crossing decks and the tufts are drawn.
 *
 * Roads. Two strip textures are unwrapped, one per direction so that each keeps its own painted
 * light: one for legs along tile x, one for legs along tile y. A strip has an across coordinate u
 * (tile units, band |u| <= HALF) and an along coordinate v that repeats seamlessly (its ends are
 * cross-faded in the middle of the tile) and is 0 at every edge midpoint, so every piece shows
 * the same cross-section where it meets its neighbour. The painted alpha edges, gravel edges and
 * ruts are found row by row and fitted with lines, then mapped piecewise-linearly onto the exact
 * band; the along scale matches the across scale, so the stones keep their shape.
 *
 * The Codex strips are 1536x1024 and not on the tile canvas: drawn at 29 degrees instead of 26.6,
 * wider than the guide's band and several tiles long. Each strip's frame comes from its own
 * alpha: the two long sides, found column by column and fitted with lines, give the painted
 * direction and the centre. Rows are then laid along that direction (the angle is rectified) and
 * sampled across it along the other tile axis, and the row fits take up what is left, such as
 * the x strip's slight taper. One tile of road takes under two tiles from the middle of the
 * painting, so the strip repeats once a tile. The drafts are on the 1254 px tile canvas, and
 * road-straight-x was painted with one central rut, so its strip takes the across profile (two
 * ruts) of the y strip.
 *
 * Pieces sample the strips along their own centre lines: straight legs run from the tile centre
 * to the edge midpoint, end pieces stop at the centre with a round cap (the ruts turn round in
 * it), curves bend the strips round the quarter circle of radius 0.5 and blend x into y by the
 * tangent's angle, and tees and the cross are the union of their legs: the through road's ruts
 * continue, the branch fades into it, and the edge follows the union's outline.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const OPTIONS = [
  'out',
  'material',
  'width',
  'edge',
  'feather',
  'verge',
  'crossing',
  'deck-margin',
  'deck-scale',
  'tone',
  'ruts',
  'bleed',
  'check',
];
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '');
  if (!OPTIONS.includes(key) || process.argv[i + 1] === undefined)
    throw new Error(`unknown option or missing value: ${process.argv[i]} (see the header)`);
  args[key] = process.argv[i + 1];
}
const OUT = resolve(args.out ?? ROOT);
const geometry = JSON.parse(readFileSync(`${ROOT}/geometry.json`, 'utf8'));
const crossingGeometry = JSON.parse(readFileSync(`${ROOT}/crossing-geometry.json`, 'utf8'));
const colours = JSON.parse(readFileSync(`${ROOT}/colours.json`, 'utf8'));

const SIZE = geometry.footprint.canvas[0];
const [AX, AY] = geometry.anchor;
const MATERIAL = args.material ?? 'codex';
const HALF = +(args.width ?? 0.32) / 2; // road band half-width, tile units
const F = HALF / (geometry.bandWidth / 2); // cross-section scale against the guides' 0.5 road
const VERGE = HALF + +(args.verge ?? geometry.vergeMaximum); // outer edge of the moss verge
const EDGE = args.edge ?? 'blend';
const FEATHER = +(args.feather ?? 0.05); // blend: width of the alpha fade round the edge
const CROSSING = args.crossing ?? 'stone';
const DECK_OUT = +(
  args['deck-margin'] ?? (CROSSING === 'painted' ? crossingGeometry.deckOutsideRail : 0.06)
); // deck beyond each rail
const DECK_SCALE = +(args['deck-scale'] ?? 0.8605);
const TONE = String(args.tone ?? '182,162,133')
  .split(',')
  .map(Number); // a mean colour, or one mean luma; 0 keeps the painting's
const RUTS = +(args.ruts ?? 0.45);
const BLEED_PX = +(args.bleed ?? 2);
const BLEED = BLEED_PX / Math.hypot(32, 16); // world pixels -> tile units along an axis
// the new decks reach the road's outer edge: the verge's on crisp, the gravel's on blend
const DECK_HALF = EDGE === 'crisp' ? VERGE : HALF;
const RUT = 0.1 * F; // rut centre lines
const RES = 1200; // strip samples per tile unit
const U_MAX = 0.3; // strip extent across
const MARGIN = 0.012; // keep the verge samples clear of the painted alpha fringe
const GROOVE = 0.02; // half-width of a rail groove: about the 1.25 px rail line in the game
const DECK_MARGIN = 0.006; // keep deck samples clear of the painted deck edge
const STRIP_END = 0.3; // a long strip's square-cut ends, left out (source tile units)
const STRIP_FADE = 0.2; // a long strip's cross-fade (source tile units)
// blend: beyond this the strip is read mirrored back into the gravel, so the verge's moss never
// shows and the fading edge keeps the gravel's texture
const U_CLAMP = EDGE === 'blend' ? HALF - 0.008 * F : null;
for (const [k, v] of Object.entries({ HALF, VERGE, FEATHER, DECK_OUT, DECK_SCALE, RUTS, BLEED }))
  if (!Number.isFinite(v)) throw new Error(`bad ${k}`);
if (![1, 3].includes(TONE.length) || !TONE.every(Number.isFinite)) throw new Error('bad --tone');
if (!['codex', 'drafts'].includes(MATERIAL)) throw new Error(`--material ${MATERIAL}`);
if (!['crisp', 'blend'].includes(EDGE)) throw new Error(`--edge ${EDGE}`);
if (!['painted', 'timber', 'stone', 'stone-swapped'].includes(CROSSING))
  throw new Error(`--crossing ${CROSSING}`);

// The game's rails, measured on a capture of the game at zoom 2 and DPR 2 (Core's variant tool,
// 2026-10-11; averaged along 9 regular and 13 narrow tiles): about the nominal rail line
// (+-0.16 regular, +-0.08 narrow) the bright head peaks at -0.0095 tile (screen-up is -a on both
// rotations) and is about 0.013 wide; the dark side peaks a rail's height below it on screen, at
// +0.024 (regular) or +0.020 (narrow), as wide; between them the ground shows. A flush deck keeps
// exactly that: RAIL lists [centre, half-width, colour] for the head and the dark side, tuned so
// the composed deck's profile matches the track's beside it. The slabs and planks stop at
// RAIL_SLOT about the line, so no joint runs through a rail.
const RAIL = {
  regular: {
    head: [-0.0095, 0.0068, [192, 189, 156]],
    dark: [0.0245, 0.0068, [66, 67, 51]],
  },
  narrow: {
    head: [-0.0095, 0.0068, [184, 178, 148]],
    dark: [0.0205, 0.0068, [66, 64, 53]],
  },
};
const RAIL_SLOT = [-0.018, 0.033];
// Ballast half-width, measured the same way (track pixels to +-0.31 regular, fading out by
// +-0.35; +-0.145 narrow): no grass tufts are rooted on it.
const BALLAST = { regular: 0.36, narrow: 0.15 };
// The edge midpoints, which strip family meets them, and their outward normals (tile units).
const EDGES = {
  ne: { mid: [0, -0.5], axis: 'y', out: [0, -1] },
  se: { mid: [0.5, 0], axis: 'x', out: [1, 0] },
  sw: { mid: [0, 0.5], axis: 'y', out: [0, 1] },
  nw: { mid: [-0.5, 0], axis: 'x', out: [-1, 0] },
};
// A strip's across axis in tile coordinates: u = y along x, u = x along y.
const ACROSS = { x: [0, 1], y: [1, 0] };
const ALONG = { x: [1, 0], y: [0, 1] };

// Where each crossing painting's deck sits, as search windows for the fits (tile units across
// the track) and the centre of its painted road band along the track.
const DECKS = {
  'crossing-regular-r0': {
    tCentre: 0.125,
    groove: [
      [-0.16, -0.07],
      [0.3, 0.4],
    ],
    edge: [
      [-0.27, -0.17],
      [0.43, 0.51],
    ],
  },
  'crossing-regular-r1': {
    tCentre: 0.05,
    groove: [
      [-0.2, -0.12],
      [0.2, 0.3],
    ],
    edge: [
      [-0.33, -0.25],
      [0.31, 0.39],
    ],
  },
  'crossing-narrow-r0': {
    tCentre: 0.005,
    groove: [
      [-0.13, -0.06],
      [0.05, 0.13],
    ],
    edge: [
      [-0.24, -0.16],
      [0.16, 0.24],
    ],
  },
  'crossing-narrow-r1': {
    tCentre: 0.02,
    groove: [
      [-0.13, -0.02],
      [0.08, 0.2],
    ],
    edge: [
      [-0.27, -0.17],
      [0.18, 0.28],
    ],
  },
};

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const screen = (x, y) => [AX + 256 * (x - y), AY + 128 * (x + y)];
// Tile units per canvas pixel along a unit tile-space direction (gx, gy).
const perPixel = (gx, gy) => Math.hypot((gx - gy) / 512, (gx + gy) / 256);
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Piecewise-linear map through matching knot lists, extrapolating the end segments. */
function piecewise(x, from, to) {
  let i = 0;
  while (i < from.length - 2 && x > from[i + 1]) i++;
  return to[i] + ((x - from[i]) * (to[i + 1] - to[i])) / (from[i + 1] - from[i]);
}

/** A painting on the tile canvas (the drafts: 1254 px for the 1024 canvas). */
function loadPainting(file) {
  const png = PNG.sync.read(readFileSync(`${ROOT}/${file}`));
  const k = png.width / SIZE;
  const toPixel = (x, y) => {
    const [cx, cy] = screen(x, y);
    return [cx * k, cy * k];
  };
  return { file, w: png.width, h: png.height, data: png.data, toPixel };
}

/**
 * A long road strip painted off the tile canvas (materials/road-strip-*.png). Its frame comes
 * from its own alpha: in every fourth pixel column the longest run with alpha over half is the
 * road, and the run's ends, fitted with lines over the middle 80% of the columns, are its long
 * sides. Their mean slope is the painted direction and their middle at the middle column is the
 * centre. A source tile point (along, across) lies at centre + along A + across C: A follows the
 * painted direction with the guide's horizontal step (320 px a tile unit), C is the guide's
 * isometric step along the other tile axis. `reach` is half the painted length in tile units.
 */
function loadStrip(file, axis) {
  const png = PNG.sync.read(readFileSync(`${ROOT}/${file}`));
  const { width: w, height: h, data } = png;
  const cols = [],
    tops = [],
    bottoms = [];
  for (let px = 0; px < w; px += 4) {
    let best = [0, -1],
      start = -1;
    for (let py = 0; py <= h; py++) {
      const on = py < h && data[(py * w + px) * 4 + 3] > 127;
      if (on && start < 0) start = py;
      if (!on && start >= 0) {
        if (py - 1 - start > best[1] - best[0]) best = [start, py - 1];
        start = -1;
      }
    }
    if (best[1] - best[0] < 20) continue;
    cols.push(px + 0.5);
    tops.push(best[0]);
    bottoms.push(best[1] + 1);
  }
  const n = cols.length,
    middle = (list) => list.slice(Math.floor(0.1 * n), Math.ceil(0.9 * n));
  const top = fitLine(middle(cols), middle(tops)),
    bottom = fitLine(middle(cols), middle(bottoms));
  const slope = (top.b + bottom.b) / 2,
    cx = (cols[0] + cols[n - 1]) / 2,
    cy = (top.at(cx) + bottom.at(cx)) / 2;
  const A = axis === 'x' ? [320, 320 * slope] : [-320, -320 * slope];
  const C = axis === 'x' ? [-320, 160] : [320, 160];
  const toPixel = (x, y) => {
    const [v, u] = axis === 'x' ? [x, y] : [y, x];
    return [cx + v * A[0] + u * C[0], cy + v * A[1] + u * C[1]];
  };
  const frame = {
    angle: (Math.atan(slope) * 180) / Math.PI,
    sides: [top.b, bottom.b].map((b) => (Math.atan(b) * 180) / Math.PI),
    centre: [cx, cy],
    reach: (cols[n - 1] - cols[0]) / 2 / 320,
  };
  return { file, w, h, data, toPixel, frame };
}

/** Premultiplied bilinear sample of a painting at tile point (x, y): rgb 0..255 times alpha. */
function sample(img, x, y, out) {
  const [cx, cy] = img.toPixel(x, y);
  const fx = cx - 0.5,
    fy = cy - 0.5;
  const x0 = Math.floor(fx),
    y0 = Math.floor(fy),
    tx = fx - x0,
    ty = fy - y0;
  out[0] = out[1] = out[2] = out[3] = 0;
  for (let n = 0; n < 4; n++) {
    const px = x0 + (n & 1),
      py = y0 + (n >> 1);
    const w = (n & 1 ? tx : 1 - tx) * (n >> 1 ? ty : 1 - ty);
    if (w === 0 || px < 0 || py < 0 || px >= img.w || py >= img.h) continue;
    const i = (py * img.w + px) * 4,
      a = (img.data[i + 3] / 255) * w;
    out[0] += img.data[i] * a;
    out[1] += img.data[i + 1] * a;
    out[2] += img.data[i + 2] * a;
    out[3] += a;
  }
  return out;
}

/** Least-squares line through (xs, ys), refitted once without outliers beyond 3 MADs. */
function fitLine(xs, ys) {
  const solve = (idx) => {
    let n = 0,
      sx = 0,
      sy = 0,
      sxx = 0,
      sxy = 0;
    for (const i of idx) {
      n++;
      sx += xs[i];
      sy += ys[i];
      sxx += xs[i] * xs[i];
      sxy += xs[i] * ys[i];
    }
    const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    return [(sy - b * sx) / n, b];
  };
  const all = xs.map((_, i) => i).filter((i) => Number.isFinite(ys[i]));
  let [a, b] = solve(all);
  const res = all.map((i) => Math.abs(ys[i] - (a + b * xs[i])));
  const mad = [...res].sort((p, q) => p - q)[res.length >> 1] * 1.4826;
  const keep = all.filter((_, j) => res[j] <= Math.max(3 * mad, 0.004));
  [a, b] = solve(keep);
  return { a, b, at: (x) => a + b * x, kept: keep.length, rows: all.length };
}

function boxSmooth(arr, r) {
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let s = 0,
      n = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(arr.length - 1, i + r); j++) {
      s += arr[j];
      n++;
    }
    out[i] = s / n;
  }
  return out;
}

/**
 * One averaged profile across a painting: `across` runs over `us`, `along` is the row position
 * (both tile units), `place(across, along)` gives the tile point.
 */
function profile(img, us, along, spread, place) {
  const al = new Float64Array(us.length),
    rg = new Float64Array(us.length),
    lu = new Float64Array(us.length),
    rgb = new Float64Array(us.length * 3),
    s = [0, 0, 0, 0];
  for (let i = 0; i < us.length; i++) {
    let r = 0,
      g = 0,
      b = 0,
      a = 0;
    for (const dv of [-1, -0.5, 0, 0.5, 1]) {
      const [x, y] = place(us[i], along + dv * spread);
      sample(img, x, y, s);
      r += s[0];
      g += s[1];
      b += s[2];
      a += s[3];
    }
    if (a > 1e-6) {
      r /= a;
      g /= a;
      b /= a;
    }
    al[i] = a / 5;
    rg[i] = al[i] > 0.5 ? r - g : -99;
    lu[i] = lum(r, g, b);
    rgb.set([r, g, b], i * 3);
  }
  return { al, rg, lu, rgb };
}

const range = (from, to, step) => {
  const out = [];
  for (let x = from; x <= to + 1e-9; x += step) out.push(+x.toFixed(6));
  return out;
};

/**
 * Fits the painted alpha edges, gravel edges and (optionally) ruts of a straight road, row by
 * row: across the one tile of a draft, or a strip's whole length but 0.3 tile at each end.
 */
function measureRoad(img, axis, withRuts) {
  const us = range(-0.62, 0.62, 0.002);
  const place = axis === 'x' ? (u, v) => [v, u] : (u, v) => [u, v];
  const rows = { v: [], alphaL: [], gravelL: [], rutL: [], rutR: [], gravelR: [], alphaR: [] };
  const reach = img.frame ? Math.floor((img.frame.reach - STRIP_END) * 50) / 50 : 0.46;
  for (const v of range(-reach, reach, 0.01)) {
    const { al, rg, lu } = profile(img, us, v, 0.01, place);
    // The longest fully opaque run is the painted road.
    let best = [0, -1];
    for (let i = 0; i < us.length;) {
      if (al[i] <= 0.98) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < us.length && al[j + 1] > 0.98) j++;
      if (j - i > best[1] - best[0]) best = [i, j];
      i = j + 1;
    }
    const centre = (best[0] + best[1]) >> 1;
    const rgS = boxSmooth(rg, 4),
      luS = boxSmooth(lu, 5);
    let l = centre,
      r = centre;
    while (l > best[0] && rgS[l] >= 7) l--;
    while (r < best[1] && rgS[r] >= 7) r++;
    rows.v.push(v);
    rows.alphaL.push(us[best[0]]);
    rows.alphaR.push(us[best[1]]);
    rows.gravelL.push(us[l]);
    rows.gravelR.push(us[r]);
    if (withRuts) {
      const mid = (us[l] + us[r]) / 2,
        hw = (us[r] - us[l]) / 2;
      const darkest = (lo, hi) => {
        let k = -1;
        for (let i = 0; i < us.length; i++)
          if (us[i] >= lo && us[i] <= hi && (k < 0 || luS[i] < luS[k])) k = i;
        return us[k];
      };
      rows.rutL.push(darkest(mid - 0.75 * hw, mid - 0.15 * hw));
      rows.rutR.push(darkest(mid + 0.15 * hw, mid + 0.75 * hw));
    }
  }
  const fits = {};
  for (const key of [
    'alphaL',
    'gravelL',
    'gravelR',
    'alphaR',
    ...(withRuts ? ['rutL', 'rutR'] : []),
  ])
    fits[key] = fitLine(rows.v, rows[key]);
  return fits;
}

/** A strip texture: rows along v (wrapping every `period` tile units), columns across u. */
function makeStrip(period) {
  const nu = Math.round(2 * U_MAX * RES) + 1,
    nv = Math.round(period * RES);
  return { period, nu, nv, rgb: new Float32Array(nu * nv * 3) };
}

/** Adds w times the strip's colour at (u, v) to out; u is clamped, v wraps. */
function acc(strip, u, v, w, out) {
  if (w <= 1e-6) return;
  if (U_CLAMP !== null && Math.abs(u) > U_CLAMP) u = Math.sign(u) * (2 * U_CLAMP - Math.abs(u));
  const fu = Math.min(Math.max((u + U_MAX) * RES, 0), strip.nu - 1.000001);
  let fv = v / strip.period;
  fv = (fv - Math.floor(fv)) * strip.nv;
  const iu = Math.floor(fu),
    tu = fu - iu;
  const iv = Math.floor(fv) % strip.nv,
    tv = fv - Math.floor(fv),
    iv1 = (iv + 1) % strip.nv;
  const a = (iv * strip.nu + iu) * 3,
    b = (iv1 * strip.nu + iu) * 3,
    d = strip.rgb;
  for (let c = 0; c < 3; c++) {
    const top = d[a + c] * (1 - tu) + d[a + 3 + c] * tu;
    const bot = d[b + c] * (1 - tu) + d[b + 3 + c] * tu;
    out[c] += w * (top * (1 - tv) + bot * tv);
  }
}

/**
 * Unwraps a straight road painting into a seamless strip on the exact cross-section. A draft
 * holds under one tile of road, so its strip may repeat two or three times a tile; a long strip
 * gives one whole tile from its middle, cross-faded over STRIP_FADE.
 */
function buildStrip(img, axis, fits, withRuts) {
  // Source tile units per final tile unit, from the painted gravel width.
  const scale = (fits.gravelR.at(0) - fits.gravelL.at(0)) / (2 * HALF);
  let period, length, fade;
  if (img.frame) {
    period = 1;
    length = scale;
    fade = STRIP_FADE;
    if ((length + fade) / 2 > img.frame.reach - STRIP_END)
      throw new Error(`${img.file} holds less than a tile of road at width ${2 * HALF}`);
  } else {
    const repeats = Math.ceil(scale / 0.86);
    period = 1 / repeats; // divides one tile, so v = 0 lands on both edge midpoints
    length = period * scale;
    fade = Math.min(0.12, 0.92 - length);
  }
  const start = -(length + fade) / 2;
  const strip = makeStrip(period);
  const target = withRuts ? [-VERGE, -HALF, -RUT, RUT, HALF, VERGE] : [-VERGE, -HALF, HALF, VERGE];
  const knots = (vs) =>
    withRuts
      ? [
          fits.alphaL.at(vs) + MARGIN,
          fits.gravelL.at(vs),
          fits.rutL.at(vs),
          fits.rutR.at(vs),
          fits.gravelR.at(vs),
          fits.alphaR.at(vs) - MARGIN,
        ]
      : [
          fits.alphaL.at(vs) + MARGIN,
          fits.gravelL.at(vs),
          fits.gravelR.at(vs),
          fits.alphaR.at(vs) - MARGIN,
        ];
  const pm = new Float64Array(strip.nu * strip.nv * 4);
  const s = [0, 0, 0, 0];
  const fadeT = fade / scale;
  for (let iv = 0; iv < strip.nv; iv++) {
    // Put the cross-fade in the middle of the tile, away from the edge midpoints.
    const t = (iv / RES + period / 2) % period;
    const parts =
      t < fadeT
        ? [
            [start + (t + period) * scale, 1 - smoothstep(0, 1, t / fadeT)],
            [start + t * scale, smoothstep(0, 1, t / fadeT)],
          ]
        : [[start + t * scale, 1]];
    for (const [vs, w] of parts) {
      const k = knots(vs);
      for (let iu = 0; iu < strip.nu; iu++) {
        const us = piecewise(-U_MAX + iu / RES, target, k);
        if (axis === 'x') sample(img, vs, us, s);
        else sample(img, us, vs, s);
        const o = (iv * strip.nu + iu) * 4;
        for (let c = 0; c < 4; c++) pm[o + c] += w * s[c];
      }
    }
  }
  // Where the painting is not opaque, fall back to the mean colour of that column.
  for (let iu = 0; iu < strip.nu; iu++) {
    const mean = [0, 0, 0];
    let n = 0;
    for (let iv = 0; iv < strip.nv; iv++) {
      const o = (iv * strip.nu + iu) * 4;
      if (pm[o + 3] < 0.98) continue;
      for (let c = 0; c < 3; c++) mean[c] += pm[o + c] / pm[o + 3];
      n++;
    }
    for (let c = 0; c < 3; c++) mean[c] = n ? mean[c] / n : 0;
    for (let iv = 0; iv < strip.nv; iv++) {
      const o = (iv * strip.nu + iu) * 4,
        a = Math.min(1, pm[o + 3]);
      for (let c = 0; c < 3; c++)
        strip.rgb[(iv * strip.nu + iu) * 3 + c] = pm[o + c] + (1 - a) * mean[c];
    }
  }
  return { strip, scale, period, fade, length, start };
}

function meanProfile(strip) {
  const m = new Float64Array(strip.nu * 3);
  for (let iv = 0; iv < strip.nv; iv++)
    for (let i = 0; i < strip.nu * 3; i++) m[i] += strip.rgb[iv * strip.nu * 3 + i];
  return m.map((x) => x / strip.nv);
}

/** Gives the x strip the y strip's across profile (two ruts) at its own gravel tone. */
function shareProfile(stripX, stripY) {
  const mx = meanProfile(stripX),
    my = meanProfile(stripY);
  const plain = (m) => {
    const out = [0, 0, 0];
    let n = 0;
    for (let iu = 0; iu < stripX.nu; iu++) {
      const u = Math.abs(-U_MAX + iu / RES);
      if (u < 0.14 * F || u > 0.2 * F) continue;
      for (let c = 0; c < 3; c++) out[c] += m[iu * 3 + c];
      n++;
    }
    return out.map((x) => x / n);
  };
  const gx = plain(mx),
    gy = plain(my);
  for (let iu = 0; iu < stripX.nu; iu++) {
    const f = 1 - smoothstep(0.2 * F, 0.24 * F, Math.abs(-U_MAX + iu / RES));
    if (f <= 0) continue;
    const factor = [0, 1, 2].map(
      (c) => 1 + f * ((my[iu * 3 + c] * gx[c]) / gy[c] / mx[iu * 3 + c] - 1),
    );
    for (let iv = 0; iv < stripX.nv; iv++) {
      const o = (iv * stripX.nu + iu) * 3;
      for (let c = 0; c < 3; c++) stripX.rgb[o + c] = Math.min(255, stripX.rgb[o + c] * factor[c]);
    }
  }
}

/**
 * --ruts and --tone on both strips. Ruts: inside 0.2 of the painted half-width (ruts and crown)
 * each column's mean is pulled toward the plain gravel's by 1 - RUTS, so the stones stay and the
 * stripes soften. Tone: the gravel (|u| < HALF) of both strips together is scaled so its mean
 * colour is TONE (per channel), or its mean luma is TONE (one scale); the verge beyond keeps its
 * colour. Returns the scale per channel.
 */
function adjustStrips(list) {
  if (RUTS !== 1)
    for (const strip of list) {
      const m = meanProfile(strip);
      const plain = [0, 0, 0];
      let n = 0;
      for (let iu = 0; iu < strip.nu; iu++) {
        const u = Math.abs(-U_MAX + iu / RES);
        if (u < 0.14 * F || u > 0.2 * F) continue;
        for (let c = 0; c < 3; c++) plain[c] += m[iu * 3 + c];
        n++;
      }
      for (let c = 0; c < 3; c++) plain[c] /= n;
      for (let iu = 0; iu < strip.nu; iu++) {
        const f = (1 - RUTS) * (1 - smoothstep(0.17 * F, 0.21 * F, Math.abs(-U_MAX + iu / RES)));
        if (f <= 0) continue;
        for (let iv = 0; iv < strip.nv; iv++) {
          const o = (iv * strip.nu + iu) * 3;
          for (let c = 0; c < 3; c++) strip.rgb[o + c] -= f * (m[iu * 3 + c] - plain[c]);
        }
      }
    }
  if (TONE.length === 1 && !TONE[0]) return [1, 1, 1];
  const sum = [0, 0, 0, 0];
  let n = 0;
  for (const strip of list)
    for (let iv = 0; iv < strip.nv; iv++)
      for (let iu = 0; iu < strip.nu; iu++) {
        if (Math.abs(-U_MAX + iu / RES) > HALF - 0.01) continue;
        const o = (iv * strip.nu + iu) * 3,
          d = strip.rgb;
        sum[3] += lum(d[o], d[o + 1], d[o + 2]);
        for (let c = 0; c < 3; c++) sum[c] += d[o + c];
        n++;
      }
  const k = [0, 1, 2].map((c) =>
    TONE.length === 3 ? TONE[c] / (sum[c] / n) : TONE[0] / (sum[3] / n),
  );
  for (const strip of list)
    for (let iu = 0; iu < strip.nu; iu++) {
      const w = 1 - smoothstep(HALF, HALF + 0.008, Math.abs(-U_MAX + iu / RES));
      const f = k.map((kc) => 1 + (kc - 1) * w);
      for (let iv = 0; iv < strip.nv; iv++) {
        const o = (iv * strip.nu + iu) * 3;
        for (let c = 0; c < 3; c++) strip.rgb[o + c] *= f[c];
      }
    }
  return k;
}

/** Folds u back into the plain gravel between rut and edge, for interior blends. */
function fold(u) {
  const a = Math.abs(u);
  if (a <= 0.2 * F) return u;
  const span = 0.07 * F,
    e = (a - 0.2 * F) % (2 * span);
  return Math.sign(u) * (e < span ? 0.2 * F - e : 0.13 * F + (e - span));
}

/** A strip family's coordinates and distance at tile point (x, y) for the piece's legs. */
function legs(edges, axis, x, y) {
  const own = edges.filter((e) => EDGES[e].axis === axis);
  if (!own.length) return null;
  const u = axis === 'x' ? y : x,
    v = (axis === 'x' ? x : y) + 0.5;
  const n = ACROSS[axis],
    sg = u < 0 ? -1 : 1;
  if (own.length === 2)
    return { axis, u, v, d: Math.abs(u), grad: [n[0] * sg, n[1] * sg], legs: 2 };
  const edge = EDGES[own[0]],
    t = x * edge.out[0] + y * edge.out[1];
  if (t >= 0) return { axis, u, v, d: Math.abs(u), grad: [n[0] * sg, n[1] * sg], legs: 1, edge, t };
  const r = Math.hypot(x, y) || 1e-9;
  return { axis, u, v, d: r, grad: [x / r, y / r], legs: 1, edge, t, cap: true };
}

/** Colour (accumulated into out) and union distance of a road piece at tile point (x, y). */
function roadPixel(piece, strips, x, y, out) {
  out[0] = out[1] = out[2] = 0;
  if (piece.corner) {
    const [cx, cy] = piece.corner,
      dx = x - cx,
      dy = y - cy,
      r = Math.hypot(dx, dy) || 1e-9;
    const fam = {};
    for (const id of piece.edges) {
      const e = EDGES[id],
        mx = e.mid[0] - cx,
        my = e.mid[1] - cy,
        n = ACROSS[e.axis];
      const theta = Math.acos(Math.max(-1, Math.min(1, (dx * mx + dy * my) / (r * 0.5))));
      const side = (mx * n[0] + my * n[1]) / 0.5;
      // Along the curve: true arc length near the edge, so the first texels match a straight
      // leg's, easing into the centre line's arc length so the strip is not sheared.
      const s = theta * (r + (0.5 - r) * smoothstep(0.08, 0.45, theta));
      fam[e.axis] = { u: side * (r - 0.5), v: id === 'se' || id === 'sw' ? 1 - s : s, theta };
    }
    const wy = smoothstep(0.3, 0.7, fam.x.theta / (Math.PI / 2));
    acc(strips.x, fam.x.u, fam.x.v, 1 - wy, out);
    acc(strips.y, fam.y.u, fam.y.v, wy, out);
    const sg = r < 0.5 ? -1 : 1;
    return { d: Math.abs(r - 0.5), grad: [(sg * dx) / r, (sg * dy) / r] };
  }
  const fx = legs(piece.edges, 'x', x, y),
    fy = legs(piece.edges, 'y', x, y);
  if (!fx || !fy) {
    // Straight or end: one family.
    const f = fx || fy,
      strip = strips[f.axis];
    if (!f.cap) acc(strip, f.u, f.v, 1, out);
    else {
      // The cap beyond the centre: the strip turns round it, so the ruts meet in a U.
      const along = ALONG[f.axis],
        dir = -(f.edge.out[0] * along[0] + f.edge.out[1] * along[1]);
      const r = f.d,
        phi = Math.atan2(-f.t, Math.abs(f.u)),
        v = 0.5 + dir * r * phi;
      const plus = smoothstep(-0.3, 0.3, f.u / r);
      acc(strip, -r, v, 1 - plus, out);
      acc(strip, r, v, plus, out);
    }
    return { d: f.d, grad: f.grad };
  }
  // Tees and the cross: the family with two legs is the through road (the x road on the cross).
  const [T, B] = fx.legs === 2 ? [fx, fy] : [fy, fx];
  const bd = B.cap ? Infinity : B.d; // the branch's cap lies inside the through road
  let side;
  if (B.legs === 2) side = Math.abs(T.u);
  else {
    const m = B.edge.mid,
      n = ACROSS[T.axis];
    side = Math.sign(m[0] * n[0] + m[1] * n[1]) * T.u;
  }
  const wb =
    smoothstep(0.09 * F, 0.23 * F, side) * (1 - smoothstep(0.24 * F, 0.3 * F, Math.abs(B.u)));
  const d = Math.min(T.d, bd),
    k = smoothstep(0.16 * F, 0.2 * F, d),
    e = smoothstep(-0.015, 0.015, T.d - bd);
  acc(strips[T.axis], fold(T.u), T.v, (1 - k) * (1 - wb), out);
  acc(strips[B.axis], fold(B.u), B.v, (1 - k) * wb, out);
  acc(strips[T.axis], T.u, T.v, k * (1 - e), out);
  acc(strips[B.axis], B.u, B.v, k * e, out);
  return { d, grad: T.d <= bd ? T.grad : B.grad };
}

/** Fits a crossing painting's deck edges and grooves along the track. */
function measureDeck(img, piece, spec) {
  const us = range(-0.62, 0.62, 0.002);
  const place = piece.rotation === 0 ? (a, t) => [a, t] : (a, t) => [t, a];
  const rows = { t: [], eL: [], gL: [], gR: [], eR: [] };
  const grooveColours = [];
  for (const t of range(spec.tCentre - 0.24, spec.tCentre + 0.24, 0.02)) {
    const { lu, rgb } = profile(img, us, t, 0.008, place);
    const luS = boxSmooth(lu, 1),
      luE = boxSmooth(lu, 2);
    const pick = ([lo, hi], score) => {
      let k = -1;
      for (let i = 3; i < us.length - 3; i++)
        if (us[i] >= lo && us[i] <= hi && (k < 0 || score(i) < score(k))) k = i;
      return k;
    };
    const gL = pick(spec.groove[0], (i) => luS[i]),
      gR = pick(spec.groove[1], (i) => luS[i]);
    // Gravel to deck darkens going in, deck to gravel brightens going out.
    const eL = pick(spec.edge[0], (i) => luE[i + 3] - luE[i - 3]),
      eR = pick(spec.edge[1], (i) => luE[i - 3] - luE[i + 3]);
    rows.t.push(t);
    rows.eL.push(us[eL]);
    rows.gL.push(us[gL]);
    rows.gR.push(us[gR]);
    rows.eR.push(us[eR]);
    for (const g of [gL, gR]) grooveColours.push([rgb[g * 3], rgb[g * 3 + 1], rgb[g * 3 + 2]]);
  }
  const fits = Object.fromEntries(
    ['eL', 'gL', 'gR', 'eR'].map((k) => [k, fitLine(rows.t, rows[k])]),
  );
  const median = (c) =>
    grooveColours.map((x) => x[c]).sort((p, q) => p - q)[grooveColours.length >> 1];
  // The deck's mean colour, a fallback for any sample on the painting's own outline.
  const mean = [0, 0, 0],
    s = [0, 0, 0, 0];
  let n = 0;
  for (const t of range(spec.tCentre - 0.2, spec.tCentre + 0.2, 0.02))
    for (let a = fits.gL.at(t); a <= fits.gR.at(t); a += 0.01) {
      sample(img, ...place(a, t), s);
      if (s[3] < 0.98) continue;
      for (let c = 0; c < 3; c++) mean[c] += s[c] / s[3];
      n++;
    }
  return {
    img,
    place,
    tCentre: spec.tCentre,
    fits,
    groove: [0, 1, 2].map(median),
    mean: mean.map((x) => x / n),
  };
}

function crossingPixel(piece, strips, deck, x, y, out) {
  const g = piece.railOffset,
    axis = piece.rotation === 0 ? 'x' : 'y';
  const u = axis === 'x' ? y : x,
    v = (axis === 'x' ? x : y) + 0.5;
  const a = axis === 'x' ? x : y;
  const px = perPixel(1, 0); // the same for both axes
  // The deck spans the band (no verge beside it); the road's verge stops at its edge.
  const inside = clamp01((g + DECK_OUT - Math.abs(a)) / px + 0.5);
  const alphaRoad = clamp01((VERGE - Math.abs(u)) / px);
  const alphaDeck = clamp01((HALF - Math.abs(u)) / px + 1);
  const road = [0, 0, 0];
  acc(strips[axis], u, v, 1, road);
  let col = road;
  if (inside > 0) {
    const ts = u + deck.tCentre,
      f = deck.fits;
    const as = piecewise(
      a,
      [-(g + DECK_OUT), -g, g, g + DECK_OUT],
      [f.eL.at(ts) + DECK_MARGIN, f.gL.at(ts), f.gR.at(ts), f.eR.at(ts) - DECK_MARGIN],
    );
    const s = sample(deck.img, ...deck.place(as, ts), [0, 0, 0, 0]);
    const dk = [0, 1, 2].map((c) => s[c] + (1 - Math.min(1, s[3])) * deck.mean[c]);
    const groove = clamp01((GROOVE - Math.abs(Math.abs(a) - g)) / px + 0.5);
    for (let c = 0; c < 3; c++) dk[c] += (deck.groove[c] - dk[c]) * groove;
    col = [0, 1, 2].map((c) => road[c] + (dk[c] - road[c]) * inside);
  }
  out[0] = col[0];
  out[1] = col[1];
  out[2] = col[2];
  return alphaRoad * (1 - inside) + alphaDeck * inside;
}

// ---- Variants: hashing and noise -----------------------------------------------------------

/** A deterministic hash of three integers to [0, 1). */
function hash(i, j, k) {
  let h =
    (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(k | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise on the integer lattice; with `period` it wraps every `period` cells. */
function vn(x, y, seed, period = 0) {
  const i = Math.floor(x),
    j = Math.floor(y),
    tx = x - i,
    ty = y - j;
  const sx = tx * tx * (3 - 2 * tx),
    sy = ty * ty * (3 - 2 * ty);
  const w = (a, b) => {
    let p = i + a,
      q = j + b;
    if (period) {
      p = ((p % period) + period) % period;
      q = ((q % period) + period) % period;
    }
    return hash(p, q, seed);
  };
  return (w(0, 0) * (1 - sx) + w(1, 0) * sx) * (1 - sy) + (w(0, 1) * (1 - sx) + w(1, 1) * sx) * sy;
}

const mix = (p, q, t) => [0, 1, 2].map((c) => p[c] + (q[c] - p[c]) * t);
const GRASS = colours.grass; // dark to light
const EARTH = mix(colours.grass[1], colours.dirt[1], 0.5); // worn soil at a blended edge

// ---- Variants: the blended edge ----------------------------------------------------------------

/**
 * How far the band's edge wanders (tile units): gently, about 0.012 at most either way, in long
 * swells rather than notches. Every term has period 1 in x and y, so the edge is the same on
 * both sides of every tile join (and the same on every tile, since a piece is one picture).
 */
const wander = (x, y) =>
  (vn(x * 5, y * 5, 11, 5) - 0.5) * 0.02 + (vn(x * 13, y * 13, 12, 13) - 0.5) * 0.006;

const TUFT_CELLS = 20; // jittered tuft sites per tile unit, period 1
const TUFT_REACH = 2; // cells searched round a pixel: a tuft is up to about 20 canvas pixels tall
// Tile units from a tuft's root to its visual middle, 35% of the mean blade height (13.5 canvas
// pixels; the clump at the root weighs more than the thin tips): screen-up is -x -y. Tufts are
// placed by that middle, so they sit astride the edge on the upper side of a road (root on the
// gravel, blades over the grass) as on the lower (root in the grass, blades over the gravel),
// and the road looks equally wide on both sides.
const TUFT_LIFT = (0.35 * 13.5) / 256;

/**
 * The distance a tuft is gated by. Near an edge the piece has a leg on (within 0.13 tile,
 * further than any tuft reaches), it is the point's offset along that edge from its midpoint:
 * every piece that meets there computes the same number for the same point, whether it is a
 * straight, a curve or a crossing, so tufts at a join are identical on both sides. Deeper in
 * the tile it is the piece's own distance from the centre line.
 */
function rootDistance(legEdges, dist) {
  return (x, y) => {
    let s = Infinity,
      along = 0;
    for (const e of legEdges) {
      const { out } = EDGES[e];
      const n = Math.abs(x * out[0] + y * out[1] - 0.5);
      if (n < s) {
        s = n;
        along = Math.abs(out[0] !== 0 ? y : x);
      }
    }
    const w = smoothstep(0.13, 0.17, s);
    if (w <= 0) return along;
    const d = dist(x, y);
    return w >= 1 ? d : along + (d - along) * w;
  };
}

/** How much a tuft grows by how far its middle lies from the centre line: astride the edge. */
const tuftGate = (d) =>
  smoothstep(HALF - 0.032, HALF - 0.016, d) * (1 - smoothstep(HALF + 0.016, HALF + 0.032, d));

/**
 * The tuft rooted in cell (i, j), in this tile's coordinates; null if the cell has none.
 * distAt(x, y) is the gating distance (rootDistance); tufts are cached per piece. A tuft grows
 * whole or not at all (no flat stubs), in the game grass's darker three tones.
 */
function tuftAt(i, j, distAt, cache) {
  const key = i * 4096 + j;
  if (cache.has(key)) return cache.get(key);
  const im = ((i % TUFT_CELLS) + TUFT_CELLS) % TUFT_CELLS,
    jm = ((j % TUFT_CELLS) + TUFT_CELLS) % TUFT_CELLS;
  const tx = (i + 0.1 + 0.8 * hash(im, jm, 1)) / TUFT_CELLS,
    ty = (j + 0.1 + 0.8 * hash(im, jm, 2)) / TUFT_CELLS;
  // patches: some stretches of edge are tufted, others bare
  const patch = vn(tx * 5, ty * 5, 21, 5);
  let t = null;
  if (hash(im, jm, 0) < 0.05 + 0.75 * patch) {
    const G = tuftGate(distAt(tx - TUFT_LIFT, ty - TUFT_LIFT));
    if (G > 0.35) {
      const grow = 0.7 + 0.3 * G;
      const nb = 3 + Math.floor(hash(im, jm, 3) * 3);
      const blades = [];
      for (let b = 0; b < nb; b++) {
        const hb = hash(im, jm, 10 + b);
        const bx = (b - (nb - 1) / 2) * 3.2 + (hb - 0.5) * 2;
        blades.push({
          bx,
          lean: bx * 0.55 + (hash(im, jm, 20 + b) - 0.5) * 4,
          h: (10 + 7 * hb) * grow,
          w: 2.0 * grow,
          tone: 2 + ((b + Math.floor(hash(im, jm, 4) * 2)) % 2),
        });
      }
      t = {
        tx,
        ty,
        blades,
        clump: [nb * 1.8 * grow + 1.5, 2.3 * grow + 0.8],
        base: hash(im, jm, 5) < 0.4 ? 1 : 2,
      };
    }
  }
  cache.set(key, t);
  return t;
}

/** Coverage and colour of the grass tufts at tile point (x, y). */
function tuft(x, y, distAt, cache) {
  const ci = Math.floor(x * TUFT_CELLS),
    cj = Math.floor(y * TUFT_CELLS);
  let best = null;
  for (let di = -TUFT_REACH; di <= TUFT_REACH; di++)
    for (let dj = -TUFT_REACH; dj <= TUFT_REACH; dj++) {
      const t = tuftAt(ci + di, cj + dj, distAt, cache);
      if (!t) continue;
      // canvas pixels from the root, screen axes (y down)
      const sx = 256 * (x - t.tx - (y - t.ty)),
        sy = 128 * (x - t.tx + (y - t.ty));
      if (sy > 6 || sy < -24 || Math.abs(sx) > 20) continue;
      // the clump the blades grow from: darker, its lower rim the darkest (contact)
      const [rx, ry] = t.clump;
      const e = Math.hypot(sx / rx, (sy - 0.5) / ry);
      const cc = clamp01((1 - e) * Math.min(rx, ry) + 0.5);
      if (cc > 0 && (!best || cc > best.cov))
        best = { cov: cc, rgb: GRASS[sy > 0.6 && e > 0.55 ? t.base - 1 : t.base] };
      for (const b of t.blades) {
        // distance to the blade's centre line from (bx, 0) to (bx + lean, -h), tapering to the tip
        const ax = b.bx,
          dx = b.lean,
          dy = -b.h;
        const L2 = dx * dx + dy * dy;
        if (L2 < 1) continue;
        const q = clamp01(((sx - ax) * dx + sy * dy) / L2);
        const dist = Math.hypot(sx - ax - q * dx, sy - q * dy);
        const cov = clamp01(b.w * (1 - 0.85 * q) - dist + 0.5);
        if (cov <= 0 || (best && cov <= best.cov)) continue;
        const k = q < 0.3 ? t.base : q > 0.7 ? Math.min(3, b.tone + 1) : b.tone;
        best = { cov, rgb: GRASS[k] };
      }
    }
  return best;
}

/**
 * The blended edge: the gravel darkens toward worn soil over its outer 0.06 tile, so the road
 * never ends on its lightest tone, its alpha fades over FEATHER round a wandering edge (calm
 * scales the wander, 0 beside a crossing deck), and tufts sit over it (times tuftWeight).
 * Colour in rgb, returns alpha.
 */
function blendEdge(x, y, d, rgb, tuftWeight, distAt, cache, calm = 1) {
  const e = d - calm * wander(x, y);
  const k = 0.5 * smoothstep(HALF - 0.06, HALF, e);
  for (let c = 0; c < 3; c++) rgb[c] += (EARTH[c] - rgb[c]) * k;
  const ag = 1 - smoothstep(HALF - FEATHER / 2, HALF + FEATHER / 2, e);
  if (tuftWeight <= 0 || d > HALF + 0.1 || d < HALF - 0.1) return ag;
  const t = tuft(x, y, distAt, cache);
  if (!t) return ag;
  const tc = t.cov * tuftWeight,
    alpha = tc + ag * (1 - tc);
  if (alpha > 1e-6)
    for (let c = 0; c < 3; c++) rgb[c] = (t.rgb[c] * tc + rgb[c] * ag * (1 - tc)) / alpha;
  return alpha;
}

// ---- Variants: flush level-crossing decks ------------------------------------------------------

const LIGHT = [-0.949, -0.316]; // the upper-left light as a tile-space direction (x, y)

/** Shade of a rectangle's rim at (a, u): >0 lit, <0 away from the light, 0 inside. */
function rim(a, u, a0, a1, u0, u1, L, width) {
  let s = 0;
  const edges = [
    [a - a0, -L[0]],
    [a1 - a, L[0]],
    [u - u0, -L[1]],
    [u1 - u, L[1]],
  ];
  for (const [dist, lit] of edges) if (dist < width) s += lit * (1 - dist / width);
  return Math.max(-1, Math.min(1, s));
}

/** The deck's three fields across the track: outside the left rail, between, outside the right. */
function deckRegions(g) {
  const outer = g + DECK_OUT;
  return [
    [-outer, -g + RAIL_SLOT[0]],
    [-g + RAIL_SLOT[1], g + RAIL_SLOT[0]],
    [g + RAIL_SLOT[1], outer],
  ];
}

/**
 * Weathered planks: the game's sleeper tones greyed toward its ballast's light tones, a step
 * lighter than the sleepers beside them and a step darker than the gravel, so the deck reads as
 * timber on the road without merging with the sleepers or reading as a hole.
 */
function timber(piece, a, u, L) {
  const g = piece.railOffset,
    regions = deckRegions(g);
  const ri = a < -g ? 0 : a > g ? 2 : 1;
  const [r0, r1] = regions[ri];
  const n = Math.max(1, Math.round((r1 - r0) / 0.046));
  const w = (r1 - r0) / n,
    k = Math.min(n - 1, Math.max(0, Math.floor((a - r0) / w)));
  const a0 = r0 + k * w,
    a1 = a0 + w;
  const S = piece.gauge === 'regular' ? colours.sleeperRegular : colours.sleeperNarrow;
  const B = colours.ballast;
  const light = mix(S[2], B[3], 0.6),
    dark = mix(S[2], B[2], 0.5);
  // under the rail, between head and dark side: the planks' shadowed edge
  if (a < r0 || a > r1) return mix(dark, mix(S[0], B[0], 0.5), 0.35);
  const id = ri * 16 + k;
  let col = mix(dark, light, 0.25 + 0.75 * hash(id, 3, 7));
  // grain: slow along the plank, a little faster across it
  const grain = vn(u * 16 + id * 3.1, ((a - a0) / w) * 2.5, 31) - 0.5;
  col = col.map((c) => c * (1 + 0.12 * grain));
  if (k < n - 1 && a1 - a < 0.005) return mix(S[0], B[0], 0.5); // joint between planks
  const s = rim(a, u, a0, a1, -DECK_HALF, DECK_HALF, L, 0.009);
  if (s > 0) col = mix(col, mix(B[3], [255, 248, 220], 0.25), 0.55 * s);
  else if (s < 0) col = mix(col, mix(S[0], B[0], 0.5), -0.5 * s);
  return col;
}

function stone(piece, a, u, L) {
  const g = piece.railOffset,
    regions = deckRegions(g);
  const ri = a < -g ? 0 : a > g ? 2 : 1;
  const [r0, r1] = regions[ri];
  const n = Math.max(1, Math.round((r1 - r0) / 0.14));
  const w = (r1 - r0) / n,
    k = Math.min(n - 1, Math.max(0, Math.floor((a - r0) / w)));
  const a0 = r0 + k * w,
    a1 = a0 + w;
  const col = ri * 4 + k; // column id, staggers the joints along the road
  const m = Math.max(1, Math.round((2 * DECK_HALF) / 0.16));
  const Ls = (2 * DECK_HALF) / m,
    off = (col % 2) * 0.5 * Ls;
  const j = Math.floor((u + DECK_HALF - off) / Ls);
  const u0 = Math.max(-DECK_HALF, -DECK_HALF + off + j * Ls),
    u1 = Math.min(DECK_HALF, -DECK_HALF + off + (j + 1) * Ls);
  const T = STONE; // dark (joint) to light (highlight)
  if (a < r0 || a > r1) return mix(T[1], T[0], 0.35); // under the rail: the slabs' shadowed edge
  const J = 0.006;
  if ((k > 0 && a - a0 < J / 2) || (k < n - 1 && a1 - a < J / 2)) return T[0];
  if ((u0 > -DECK_HALF && u - u0 < J / 2) || (u1 < DECK_HALF && u1 - u < J / 2)) return T[0];
  // broad mottling in three tones, each slab a little different
  const h = hash(col, j, 5);
  const v = vn(a * 34 + h * 9, u * 34, 51) * 0.7 + vn(a * 90, u * 90, 52) * 0.3 + (h - 0.5) * 0.25;
  let c = v < 0.4 ? T[1] : v < 0.66 ? T[2] : T[3];
  // sparse chips
  const ci = Math.floor(a * 60),
    cj = Math.floor(u * 60);
  if (hash(ci, cj, 53) < 0.05 && Math.hypot(a * 60 - ci - 0.5, u * 60 - cj - 0.5) < 0.22)
    c = mix(c, T[0], 0.55);
  const s = rim(a, u, a0, a1, u0, u1, L, 0.011);
  if (s > 0) c = mix(c, T[4], 0.75 * s);
  else if (s < 0) c = mix(c, T[0], -0.45 * s);
  return c;
}

function dirt(piece, a, u) {
  const D = DIRT; // dark to light
  const v = vn(a * 28, u * 28, 61) * 0.65 + vn(a * 75, u * 75, 62) * 0.35;
  let c = v < 0.3 ? D[1] : v < 0.62 ? D[2] : D[3];
  if (vn(a * 18, u * 18, 63) < 0.16) c = mix(c, D[0], 0.6);
  // pebbles: a pale stone lit from the upper left, darker underneath
  const P = 0.03,
    ci = Math.floor(a / P),
    cj = Math.floor(u / P);
  for (let di = -1; di <= 1; di++)
    for (let dj = -1; dj <= 1; dj++) {
      const i = ci + di,
        j = cj + dj;
      if (hash(i, j, 64) > 0.22) continue;
      const pa = (i + 0.2 + 0.6 * hash(i, j, 65)) * P,
        pu = (j + 0.2 + 0.6 * hash(i, j, 66)) * P;
      const r = 0.004 + 0.003 * hash(i, j, 67);
      const da = a - pa,
        du = u - pu;
      if (Math.hypot(da, du) < r) {
        const lit = -(da * LIGHT[0] + du * LIGHT[1]) / r; // approximate, rotation-free
        return lit > 0.2 ? PEBBLE : mix(PEBBLE, D[0], 0.45);
      }
    }
  return c;
}

/** The flush deck at (a across the track, u along it), with the rails as the game draws them. */
function deckColour(piece, a, u, axis) {
  const g = piece.railOffset;
  const L = axis === 'x' ? LIGHT : [LIGHT[1], LIGHT[0]]; // (along a, along u)
  const regular = piece.gauge === 'regular';
  const style =
    CROSSING === 'timber' ? 'timber' : (CROSSING === 'stone') === regular ? 'stone' : 'dirt';
  let m =
    style === 'timber'
      ? timber(piece, a, u, L)
      : style === 'stone'
        ? stone(piece, a, u, L)
        : dirt(piece, a, u);
  const side = a < 0 ? -1 : 1,
    t = a - side * g;
  const px = perPixel(1, 0);
  const line = (c, hw) => clamp01((t - c + hw) / px + 0.5) * clamp01((c + hw - t) / px + 0.5);
  const R = RAIL[piece.gauge];
  // the pale stone and dirt also get a thin dark flangeway just above the head, or the head
  // would not stand out from them
  if (style !== 'timber') {
    const [hc, hw] = R.head;
    m = mix(m, style === 'stone' ? STONE[0] : DIRT[0], 0.75 * line(hc - hw - 0.004, 0.004));
  }
  m = mix(m, R.dark[2], line(R.dark[0], R.dark[1]));
  return mix(m, R.head[2], line(R.head[0], R.head[1]));
}

/** A flush crossing: the road strip with the chosen edge, and the deck over the track. */
function crossingPixelFlush(piece, strips, x, y, out, cache) {
  const g = piece.railOffset,
    axis = piece.rotation === 0 ? 'x' : 'y';
  const u = axis === 'x' ? y : x,
    v = (axis === 'x' ? x : y) + 0.5;
  const a = axis === 'x' ? x : y;
  const px = perPixel(1, 0);
  const inside = clamp01((g + DECK_OUT - Math.abs(a)) / px + 0.5);
  const road = [0, 0, 0];
  acc(strips[axis], u, v, 1, road);
  let alphaRoad;
  if (EDGE === 'crisp') alphaRoad = clamp01((VERGE - Math.abs(u)) / px);
  else {
    // no tufts on the ballast beside the rails or close to the deck's ends, and the edge runs
    // straight into the deck's corners
    const b = Math.max(BALLAST[piece.gauge] + 0.01, g + DECK_OUT + 0.08);
    const distAt = rootDistance(axis === 'x' ? ['nw', 'se'] : ['ne', 'sw'], (tx, ty) => {
      const [ra, ru] = axis === 'x' ? [tx, ty] : [ty, tx];
      return Math.abs(ra) < b ? Infinity : Math.abs(ru);
    });
    const calm = smoothstep(g + DECK_OUT, g + DECK_OUT + 0.12, Math.abs(a));
    alphaRoad = blendEdge(x, y, Math.abs(u), road, 1, distAt, cache, calm);
  }
  if (inside <= 0) {
    out[0] = road[0];
    out[1] = road[1];
    out[2] = road[2];
    return alphaRoad;
  }
  // the deck is exactly as long along the track as the road is wide outside
  const deck = deckColour(piece, a, u, axis);
  const alphaDeck = clamp01((DECK_HALF - Math.abs(u)) / px + 0.5);
  const wr = alphaRoad * (1 - inside),
    wd = alphaDeck * inside,
    alpha = wr + wd;
  for (let c = 0; c < 3; c++)
    out[c] =
      alpha > 1e-6 ? (road[c] * wr + deck[c] * wd) / alpha : inside > 0.5 ? deck[c] : road[c];
  return alpha;
}

/**
 * Renders a picture from `pixel(x, y, rgb) -> alpha`. Pixels count as inside the diamond by
 * their centres, so neighbouring tiles cover the canvas without gaps or double edges; just
 * outside it the colour continues under alpha 0, so filtering never pulls in a dark fringe.
 * With --bleed, `bleed(x, y, rgb)` gives the alpha outside the diamond instead (see bleedFn).
 */
function render(pixel, bleed) {
  const png = new PNG({ width: SIZE, height: SIZE });
  png.data.fill(0);
  const rgb = [0, 0, 0];
  const M = bleed ? 16 : 0;
  for (let py = AY - 136 - M; py < AY + 136 + M; py++)
    for (let px = AX - 264 - M; px < AX + 264 + M; px++) {
      const a = (px + 0.5 - AX) / 256,
        b = (py + 0.5 - AY) / 128;
      const x = (a + b) / 2,
        y = (b - a) / 2;
      let alpha = pixel(x, y, rgb);
      const inDiamond = Math.max(Math.abs(x), Math.abs(y)) <= 0.5;
      if (!inDiamond) alpha = bleed ? bleed(x, y, rgb) : 0;
      const i = (py * SIZE + px) * 4;
      for (let c = 0; c < 3; c++) png.data[i + c] = Math.round(Math.min(255, Math.max(0, rgb[c])));
      png.data[i + 3] = Math.round(255 * alpha);
    }
  return png;
}

const show = (fit) => `${fit.at(-0.25).toFixed(3)}..${fit.at(0.25).toFixed(3)}`;

// The road strips: Codex's long strips, or the first drafts (whose x road has one rut).
const SOURCES = {
  codex: { x: ['materials/road-strip-x.png', true], y: ['materials/road-strip-y.png', true] },
  drafts: { x: ['raw/road-straight-x.png', false], y: ['raw/road-straight-y.png', true] },
}[MATERIAL];
const built = {};
for (const axis of ['x', 'y']) {
  const [file, withRuts] = SOURCES[axis];
  const img = MATERIAL === 'codex' ? loadStrip(file, axis) : loadPainting(file);
  const fits = measureRoad(img, axis, withRuts);
  built[axis] = { file, frame: img.frame, fits, ...buildStrip(img, axis, fits, withRuts) };
}
if (MATERIAL === 'drafts') shareProfile(built.x.strip, built.y.strip);
const TONE_K = adjustStrips([built.x.strip, built.y.strip]);
const strips = { x: built.x.strip, y: built.y.strip };
for (const [name, b] of Object.entries(built)) {
  const knots = Object.entries(b.fits).map(([k, f]) => `${k} ${show(f)} (${f.kept}/${f.rows})`);
  console.log(`strip ${name} (${b.file}): ${knots.join(', ')}`);
  if (b.frame)
    console.log(
      `  painted at ${b.frame.angle.toFixed(2)} deg (sides ${b.frame.sides.map((a) => a.toFixed(2)).join(', ')}), reach ${b.frame.reach.toFixed(3)}`,
    );
  console.log(
    `  scale ${b.scale.toFixed(3)}, period ${b.period}, source ${b.start.toFixed(3)}..${(b.start + b.length + b.fade).toFixed(3)}, fade ${b.fade.toFixed(3)}`,
  );
}

/** The gravel's mean colour (|u| < HALF - 0.01) over both strips. */
function gravelMean(list) {
  const sum = [0, 0, 0];
  let n = 0;
  for (const strip of list)
    for (let iv = 0; iv < strip.nv; iv++)
      for (let iu = 0; iu < strip.nu; iu++) {
        if (Math.abs(-U_MAX + iu / RES) > HALF - 0.01) continue;
        for (let c = 0; c < 3; c++) sum[c] += strip.rgb[(iv * strip.nu + iu) * 3 + c];
        n++;
      }
  return sum.map((s) => s / n);
}
const GRAVEL = gravelMean([strips.x, strips.y]);
console.log(
  `gravel mean ${GRAVEL.map((c) => c.toFixed(0)).join(',')} (luma ${lum(...GRAVEL).toFixed(0)}), tone scale ${TONE_K.map((k) => k.toFixed(3)).join(',')}, ruts ${RUTS}`,
);
// The author's stone at the brightness the author saw (--deck-scale). The author's dirt is an
// orange-brown much more saturated than the gravel: it keeps its own brightness and goes 60% of
// the way to the gravel's hue, so it reads as packed earth of the same road rather than a stain.
const STONE = colours.stone.map((c) => c.map((v) => v * DECK_SCALE));
const gravelHue = GRAVEL.map((c) => c / lum(...GRAVEL));
const DIRT = colours.dirt.map((c) =>
  mix(
    c,
    gravelHue.map((h) => h * lum(...c)),
    0.6,
  ),
);
const PEBBLE = colours.pebble.map((v) => v * DECK_SCALE);

// One pixel function per picture: (x, y, rgb) -> alpha, in the picture's tile coordinates.
const pixelFns = new Map();
for (const piece of geometry.pieces) {
  const cache = new Map(),
    scratch = [0, 0, 0];
  const distAt = rootDistance(piece.edges, (x, y) => roadPixel(piece, strips, x, y, scratch).d);
  pixelFns.set(piece.id, (x, y, rgb) => {
    const { d, grad } = roadPixel(piece, strips, x, y, rgb);
    if (EDGE === 'crisp') return clamp01((VERGE - d) / perPixel(grad[0], grad[1]));
    return blendEdge(x, y, d, rgb, 1, distAt, cache);
  });
}
for (const piece of crossingGeometry.pieces) {
  if (CROSSING === 'painted') {
    const deck = measureDeck(loadPainting(`raw/${piece.id}-attempt-2.png`), piece, DECKS[piece.id]);
    pixelFns.set(piece.id, (x, y, rgb) => crossingPixel(piece, strips, deck, x, y, rgb));
  } else {
    const cache = new Map();
    pixelFns.set(piece.id, (x, y, rgb) => crossingPixelFlush(piece, strips, x, y, rgb, cache));
  }
}
const legsOf = new Map(geometry.pieces.map((p) => [p.id, p.edges]));
for (const p of crossingGeometry.pieces)
  legsOf.set(p.id, p.rotation === 0 ? ['nw', 'se'] : ['ne', 'sw']);

/**
 * --bleed: beyond a leg's edge, up to BLEED along its normal, a picture carries on as the
 * straight road of that leg's axis (what a straight neighbour shows there; a curve's first
 * texels are a straight's too), but only where that is nearly opaque, so the overlap never
 * thickens the soft edge. Elsewhere outside the diamond alpha stays 0.
 */
function bleedFn(id) {
  if (!BLEED) return null;
  const legs = legsOf.get(id);
  return (x, y, rgb) => {
    for (const e of legs) {
      const { out, axis } = EDGES[e];
      const n = x * out[0] + y * out[1],
        t = -x * out[1] + y * out[0];
      if (n > 0.5 && n <= 0.5 + BLEED && Math.abs(t) <= 0.5) {
        const al = pixelFns.get(`road-straight-${axis}`)(x, y, rgb);
        return al * smoothstep(0.85, 1, al);
      }
    }
    return 0;
  };
}

/**
 * Join check: every picture that leaves by an edge against every picture that enters by the
 * opposite edge, evaluated at the same world points on the shared edge (each in its own tile
 * coordinates). Reports the largest colour difference (0..255, on pixels with alpha > 0.5) and
 * alpha difference (0..1) per edge direction. With --bleed it also compares each picture's
 * bleed with the neighbour's own pixels under it (colour where both are opaque, 0..255).
 */
function checkJoins() {
  const opposite = { ne: 'sw', sw: 'ne', se: 'nw', nw: 'se' };
  const rows = [];
  for (const e of ['se', 'sw', 'nw', 'ne']) {
    const { mid, out } = EDGES[e];
    const tan = [-out[1], out[0]];
    let worst = { dc: 0, da: 0 },
      bleedMax = 0,
      bleedSum = 0,
      bleedN = 0,
      bleedAt = '-';
    for (const [a, ea] of legsOf)
      for (const [b, eb] of legsOf) {
        if (!ea.includes(e) || !eb.includes(opposite[e])) continue;
        const fa = pixelFns.get(a),
          fb = pixelFns.get(b),
          ba = bleedFn(a);
        const ca = [0, 0, 0],
          cb = [0, 0, 0];
        for (let t = -0.45; t <= 0.45; t += 0.0025) {
          const x = mid[0] + t * tan[0],
            y = mid[1] + t * tan[1];
          if (e === 'se' || e === 'sw') {
            const aa = fa(x, y, ca),
              ab = fb(x - out[0], y - out[1], cb);
            const da = Math.abs(aa - ab);
            const dc =
              aa > 0.5 && ab > 0.5 ? Math.max(...[0, 1, 2].map((c) => Math.abs(ca[c] - cb[c]))) : 0;
            if (da > worst.da) worst = { ...worst, da, daAt: `${a} | ${b} t=${t.toFixed(3)}` };
            if (dc > worst.dc) worst = { ...worst, dc, dcAt: `${a} | ${b} t=${t.toFixed(3)}` };
          }
          if (!ba) continue;
          for (let k = 1; k <= 4; k++) {
            const dn = (BLEED * k) / 4,
              px = x + dn * out[0],
              py = y + dn * out[1];
            const aa = ba(px, py, ca),
              ab = fb(px - out[0], py - out[1], cb);
            if (aa < 0.98 || ab < 0.98) continue;
            const dc = Math.max(...[0, 1, 2].map((c) => Math.abs(ca[c] - cb[c])));
            bleedSum += dc;
            bleedN++;
            if (dc > bleedMax) {
              bleedMax = dc;
              bleedAt = `${a} over ${b} t=${t.toFixed(3)} +${dn.toFixed(3)}`;
            }
          }
        }
      }
    if (e === 'se' || e === 'sw')
      rows.push(
        `${e}/${opposite[e]}: max colour diff ${worst.dc.toFixed(1)} (${worst.dcAt ?? '-'}), max alpha diff ${worst.da.toFixed(3)} (${worst.daAt ?? '-'})`,
      );
    if (BLEED)
      rows.push(
        `bleed over ${e}: colour diff under the neighbour mean ${(bleedSum / Math.max(1, bleedN)).toFixed(1)}, max ${bleedMax.toFixed(1)} (${bleedAt})`,
      );
  }
  return rows;
}

if (args.check) {
  for (const r of checkJoins()) console.log(r);
  process.exit(0);
}

const r4 = (v) => +v.toFixed(4);
mkdirSync(OUT, { recursive: true });
writeFileSync(
  `${OUT}/finish.json`,
  JSON.stringify(
    {
      about:
        'Written by finish-roads.mjs: the options the 19 pictures beside it were made with, and what it measured.',
      material: MATERIAL,
      width: r4(2 * HALF),
      edge: EDGE,
      verge: EDGE === 'crisp' ? r4(VERGE - HALF) : 0,
      feather: EDGE === 'blend' ? FEATHER : 0,
      crossing: CROSSING,
      deckMargin: DECK_OUT,
      deckHalfLength: r4(CROSSING === 'painted' ? HALF : DECK_HALF),
      deckScale: CROSSING === 'painted' ? 0 : DECK_SCALE,
      tone: TONE,
      toneScale: TONE_K.map(r4),
      gravelMean: GRAVEL.map(r4),
      ruts: RUTS,
      bleedWorldPx: BLEED_PX,
      strips: Object.fromEntries(
        Object.entries(built).map(([axis, b]) => [
          axis,
          {
            file: b.file,
            ...(b.frame && {
              paintedAngle: r4(b.frame.angle),
              paintedSides: b.frame.sides.map(r4),
              centrePx: b.frame.centre.map(r4),
              reach: r4(b.frame.reach),
            }),
            // each fit: [value at v = 0, slope per tile unit along], source tile units
            fits: Object.fromEntries(
              Object.entries(b.fits).map(([k, f]) => [k, [r4(f.a), r4(f.b)]]),
            ),
            scale: r4(b.scale),
            period: r4(b.period),
            source: [r4(b.start), r4(b.start + b.length + b.fade)],
            fade: r4(b.fade),
          },
        ]),
      ),
    },
    null,
    2,
  ) + '\n',
);
for (const [id, fn] of pixelFns)
  writeFileSync(`${OUT}/${id}.png`, PNG.sync.write(render(fn, bleedFn(id))));
console.log(`wrote ${pixelFns.size} pictures and finish.json to ${OUT}`);
