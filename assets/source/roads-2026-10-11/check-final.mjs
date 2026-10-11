#!/usr/bin/env node
/**
 * Checks the 19 finished road and crossing pictures against the exact geometry and writes
 * final-check.json, then composes them into a small network for review.
 *
 *   node assets/source/roads-2026-10-11/check-final.mjs
 *
 * The geometry comes from geometry.json and crossing-geometry.json (not from finish-roads.mjs),
 * so the check does not share the finishing code. Per picture: a 1024x1024 RGBA canvas; alpha 0
 * outside the diamond and outside the band and verge (|offset| > 0.28); fully opaque inside
 * the band (|offset| <= 0.25); partial alpha only within one texel at atlas resolution 4 (two
 * canvas pixels) of an outline; the content registered on the anchor (512, 832); for crossings,
 * a dark groove centred on each rail line. Across pictures, after reducing each one to
 * resolution 4 (diamond 256x128): every piece that meets an edge midpoint shows the same
 * cross-section there, and opposite edges have the same opaque span, so neighbours join.
 *
 * Also writes review/final-network.png (the pieces composed at resolution 4 on a flat grass
 * fill, with plain grey rails at the exact offsets under the crossings) and
 * review/final-network-1x.png (the same at game scale). Exits 1 if any check fails.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const geometry = JSON.parse(readFileSync(`${ROOT}/geometry.json`, 'utf8'));
const crossingGeometry = JSON.parse(readFileSync(`${ROOT}/crossing-geometry.json`, 'utf8'));
const SIZE = geometry.footprint.canvas[0];
const [AX, AY] = geometry.anchor;
const HALF = geometry.bandWidth / 2;
const VERGE = HALF + geometry.vergeMaximum;
const DECK_OUT = crossingGeometry.deckOutsideRail;
const TEXEL = 2; // canvas pixels per texel at atlas resolution 4
// 8-bit levels, premultiplied. Curves leave the straight line inside the first texel (inner verge
// radius 0.22), which moves their antialiased outline by a few hundredths of a pixel there.
const COLOUR_TOLERANCE = 6;
// Tile units per texel at resolution 4, across a line along tile x or tile y.
const ACROSS_TEXEL = Math.hypot(1 / 512, 1 / 256) * TEXEL;
const MIDS = { ne: [0, -0.5], se: [0.5, 0], sw: [0, 0.5], nw: [-0.5, 0] };
const OPPOSITE = { ne: 'sw', se: 'nw', sw: 'ne', nw: 'se' };

const toTile = (px, py) => {
  const a = (px - AX) / 256,
    b = (py - AY) / 128;
  return [(a + b) / 2, (b - a) / 2];
};
const toCanvas = (x, y) => [AX + 256 * (x - y), AY + 128 * (x + y)];
const inDiamond = (x, y) => Math.max(Math.abs(x), Math.abs(y)) <= 0.5;
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Distance from a road piece's centre line, as make-guides.mjs draws the band. */
function roadDistance(piece, x, y) {
  if (piece.corner) return Math.abs(Math.hypot(x - piece.corner[0], y - piece.corner[1]) - 0.5);
  return Math.min(
    ...piece.edges.map((e) => {
      const [a, b] = MIDS[e];
      const t = Math.max(0, Math.min(1, (x * a + y * b) / (a * a + b * b)));
      return Math.hypot(x - t * a, y - t * b);
    }),
  );
}

/** Canvas pixels from (px, py) to the level set f = level, by the local gradient. */
function pixelsTo(f, px, py, level) {
  const gx = (f(px + 1, py) - f(px - 1, py)) / 2,
    gy = (f(px, py + 1) - f(px, py - 1)) / 2;
  return Math.abs(f(px, py) - level) / (Math.hypot(gx, gy) || 1e-9);
}

/** Checks one road (`kind` 'road') or crossing picture against its exact shape. */
function checkPicture(id, png, kind, piece) {
  const res = {
    id,
    canvas: [png.width, png.height],
    rgba: png.colorType === 6,
    outsideDiamond: 0,
    outsideBand: 0,
    bandNotOpaque: 0,
    softEdgeTooWide: 0,
  };
  const centre = (px, py) => toTile(px + 0.5, py + 0.5);
  // A distance function over pixel coordinates for the outline check.
  let fields;
  if (kind === 'road') fields = [[(px, py) => roadDistance(piece, ...centre(px, py)), VERGE]];
  else {
    const g = piece.railOffset,
      r = piece.rotation;
    const u = (px, py) => Math.abs(centre(px, py)[r === 0 ? 1 : 0]);
    const a = (px, py) => Math.abs(centre(px, py)[r === 0 ? 0 : 1]);
    fields = [
      [u, VERGE],
      [u, HALF],
      [a, g + DECK_OUT],
    ];
  }
  let bbox = [Infinity, Infinity, -Infinity, -Infinity],
    expected = [Infinity, Infinity, -Infinity, -Infinity];
  const grow = (b, px, py) => {
    b[0] = Math.min(b[0], px);
    b[1] = Math.min(b[1], py);
    b[2] = Math.max(b[2], px);
    b[3] = Math.max(b[3], py);
  };
  for (let py = 0; py < png.height; py++)
    for (let px = 0; px < png.width; px++) {
      const alpha = png.data[(py * png.width + px) * 4 + 3];
      if (Math.abs(px + 0.5 - AX) > 262 || Math.abs(py + 0.5 - AY) > 134) {
        // Well outside the diamond: only transparency matters.
        if (alpha > 0) {
          res.outsideDiamond++;
          grow(bbox, px, py);
        }
        continue;
      }
      const [x, y] = centre(px, py);
      const diamond = inDiamond(x, y);
      let outside, inside;
      if (kind === 'road') {
        const d = roadDistance(piece, x, y);
        outside = d > VERGE;
        inside = d <= HALF;
      } else {
        const g = piece.railOffset,
          u = Math.abs(piece.rotation === 0 ? y : x),
          a = Math.abs(piece.rotation === 0 ? x : y);
        const slack = ACROSS_TEXEL; // the deck's sides may soften outwards by a texel
        outside = u > VERGE || (a < g + DECK_OUT - slack && u > HALF + slack);
        inside = u <= HALF;
      }
      if (diamond && !outside) grow(expected, px, py);
      if (alpha > 0) grow(bbox, px, py);
      if (alpha > 0 && !diamond) res.outsideDiamond++;
      if (alpha > 0 && diamond && outside) res.outsideBand++;
      if (diamond && inside && alpha < 255) res.bandNotOpaque++;
      if (alpha > 0 && alpha < 255 && diamond) {
        const near = fields.some(([f, level]) => pixelsTo(f, px, py, level) <= TEXEL);
        if (!near) res.softEdgeTooWide++;
      }
    }
  res.bbox = bbox;
  res.expectedBbox = expected;
  res.anchor = [AX, AY];
  res.anchorOffBy = Math.max(...bbox.map((v, i) => Math.abs(v - expected[i])));
  res.passes =
    res.canvas[0] === SIZE &&
    res.canvas[1] === SIZE &&
    res.rgba &&
    res.outsideDiamond === 0 &&
    res.outsideBand === 0 &&
    res.bandNotOpaque === 0 &&
    res.softEdgeTooWide === 0 &&
    res.anchorOffBy <= 1;
  return res;
}

/** Bilinear sample of straight (non-premultiplied) colour at a canvas point. */
function sampleCanvas(png, cx, cy) {
  const fx = cx - 0.5,
    fy = cy - 0.5,
    x0 = Math.floor(fx),
    y0 = Math.floor(fy),
    tx = fx - x0,
    ty = fy - y0;
  const out = [0, 0, 0];
  for (let n = 0; n < 4; n++) {
    const px = x0 + (n & 1),
      py = y0 + (n >> 1),
      w = (n & 1 ? tx : 1 - tx) * (n >> 1 ? ty : 1 - ty),
      i = (py * png.width + px) * 4;
    for (let c = 0; c < 3; c++) out[c] += png.data[i + c] * w;
  }
  return out;
}

/** Finds the dark groove near each rail line across the deck and measures its centre. */
function checkGrooves(png, piece) {
  const g = piece.railOffset,
    r = piece.rotation;
  const point = (a, t) => toCanvas(...(r === 0 ? [a, t] : [t, a]));
  const rails = [];
  for (const rail of [-g, g]) {
    const as = [];
    for (let a = rail - 0.05; a <= rail + 0.05 + 1e-9; a += 0.001) as.push(a);
    const l = as.map((a) => {
      let s = 0;
      for (const t of [-0.2, -0.1, 0, 0.1, 0.2]) s += lum(...sampleCanvas(png, ...point(a, t)));
      return s / 5;
    });
    let k = 0;
    for (let i = 1; i < l.length; i++) if (l[i] < l[k]) k = i;
    const ends = as
      .map((a, i) => (Math.abs(a - rail) >= 0.04 ? l[i] : null))
      .filter((v) => v !== null);
    const ref = ends.reduce((p, q) => p + q, 0) / ends.length;
    const half = (l[k] + ref) / 2;
    let lo = k,
      hi = k;
    while (lo > 0 && l[lo - 1] < half) lo--;
    while (hi < l.length - 1 && l[hi + 1] < half) hi++;
    const centre = (as[lo] + as[hi]) / 2;
    rails.push({
      expected: rail,
      centre: +centre.toFixed(4),
      width: +(as[hi] - as[lo]).toFixed(4),
      contrast: Math.round(ref - l[k]),
      passes: Math.abs(centre - rail) <= 0.004 && ref - l[k] >= 60,
    });
  }
  return rails;
}

/** Premultiplied box reduction by `f`, as Float32 RGBA in 0..255. */
function reduce(png, f) {
  const w = png.width / f,
    h = png.height / f,
    out = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let dy = 0; dy < f; dy++)
        for (let dx = 0; dx < f; dx++) {
          const i = ((y * f + dy) * png.width + x * f + dx) * 4,
            a = png.data[i + 3] / 255;
          out[o] += png.data[i] * a;
          out[o + 1] += png.data[i + 1] * a;
          out[o + 2] += png.data[i + 2] * a;
          out[o + 3] += png.data[i + 3];
        }
      for (let c = 0; c < 4; c++) out[o + c] /= f * f;
    }
  return { w, h, data: out };
}

/** Bilinear sample of a reduced image at canvas-scale point (cx, cy). */
function sampleReduced(img, f, cx, cy) {
  const fx = cx / f - 0.5,
    fy = cy / f - 0.5,
    x0 = Math.floor(fx),
    y0 = Math.floor(fy),
    tx = fx - x0,
    ty = fy - y0;
  const out = [0, 0, 0, 0];
  for (let n = 0; n < 4; n++) {
    const px = x0 + (n & 1),
      py = y0 + (n >> 1),
      w = (n & 1 ? tx : 1 - tx) * (n >> 1 ? ty : 1 - ty),
      i = (py * img.w + px) * 4;
    for (let c = 0; c < 4; c++) out[c] += img.data[i + c] * w;
  }
  return out;
}

/** The resolution-4 cross-section just inside an edge midpoint, across the road. */
function crossSection(img, edge) {
  const [mx, my] = MIDS[edge],
    along = mx === 0 ? [1, 0] : [0, 1],
    inward = [-2 * mx, -2 * my],
    depth = 0.006; // under one texel inside the edge
  const samples = [];
  for (let s = -0.32; s <= 0.32 + 1e-9; s += 1 / 256) {
    const x = mx + along[0] * s + inward[0] * depth,
      y = my + along[1] * s + inward[1] * depth;
    samples.push(sampleReduced(img, TEXEL, ...toCanvas(x, y)));
  }
  return samples;
}

/** The opaque span (alpha >= half) of a cross-section, in tile units along the edge. */
function span(samples) {
  const idx = samples.map((s, i) => (s[3] >= 127.5 ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return null;
  const at = (i) => -0.32 + i / 256;
  return { from: +at(idx[0]).toFixed(4), to: +at(idx.at(-1)).toFixed(4) };
}

const report = [],
  reduced = {},
  pictures = {};
for (const piece of geometry.pieces) {
  const png = PNG.sync.read(readFileSync(`${ROOT}/${piece.id}.png`));
  pictures[piece.id] = png;
  report.push(checkPicture(piece.id, png, 'road', piece));
}
for (const piece of crossingGeometry.pieces) {
  const png = PNG.sync.read(readFileSync(`${ROOT}/${piece.id}.png`));
  pictures[piece.id] = png;
  const res = checkPicture(piece.id, png, 'crossing', piece);
  res.grooves = checkGrooves(png, piece);
  res.passes = res.passes && res.grooves.every((g) => g.passes);
  report.push(res);
}
for (const [id, png] of Object.entries(pictures)) reduced[id] = reduce(png, TEXEL);

// Every picture that meets an edge shows the same resolution-4 cross-section there.
const edgesOf = Object.fromEntries([
  ...geometry.pieces.map((p) => [p.id, p.edges]),
  ...crossingGeometry.pieces.map((p) => [p.id, p.roadEdges]),
]);
const joins = {};
for (const edge of Object.keys(MIDS)) {
  const ids = Object.keys(edgesOf).filter((id) => edgesOf[id].includes(edge));
  const sections = Object.fromEntries(ids.map((id) => [id, crossSection(reduced[id], edge)]));
  const ref = sections[ids[0]];
  const pieces = ids.map((id) => {
    let max = 0,
      sum = 0,
      n = 0;
    sections[id].forEach((s, i) =>
      s.forEach((v, c) => {
        const diff = Math.abs(v - ref[i][c]);
        max = Math.max(max, diff);
        sum += diff;
        n++;
      }),
    );
    return {
      id,
      maxDiff: +max.toFixed(2),
      meanDiff: +(sum / n).toFixed(3),
      span: span(sections[id]),
    };
  });
  joins[edge] = { reference: ids[0], span: span(ref), pieces };
}
// Both sides of a shared edge measure position along it the same way (tile x or tile y), so
// the neighbour's opposite edge must show the same span.
const sameSpan = (p, q) =>
  !!p &&
  !!q &&
  Math.abs(p.from - q.from) <= 1 / 256 + 1e-9 &&
  Math.abs(p.to - q.to) <= 1 / 256 + 1e-9;
for (const edge of Object.keys(MIDS)) {
  const join = joins[edge];
  join.matchesOpposite = sameSpan(join.span, joins[OPPOSITE[edge]].span);
  join.passes =
    join.matchesOpposite &&
    join.pieces.every((p) => p.maxDiff <= COLOUR_TOLERANCE && sameSpan(p.span, join.span));
}

const failures = [
  ...report.filter((r) => !r.passes).map((r) => r.id),
  ...Object.entries(joins)
    .filter(([, j]) => !j.passes)
    .map(([e]) => `join ${e}`),
];
writeFileSync(
  `${ROOT}/final-check.json`,
  JSON.stringify(
    {
      status: failures.length ? 'failed' : 'passed',
      failures,
      rules: {
        canvas: SIZE,
        anchor: [AX, AY],
        band: `|offset| <= ${HALF} opaque`,
        verge: `alpha 0 beyond |offset| ${VERGE}`,
        softEdge: `partial alpha within ${TEXEL} canvas px (one texel at resolution 4) of an outline`,
        grooves: 'groove centre within 0.004 tile of +-railOffset, contrast >= 60',
        joins: `resolution-4 cross-section at each edge midpoint within ${COLOUR_TOLERANCE} levels of the reference, same opaque span on opposite edges`,
      },
      pictures: report,
      joins,
    },
    null,
    2,
  ) + '\n',
);

// The review network: cell (i, j) is the tile at world (i, j).
const NETWORK = [
  ['road-curve-se-sw', 0, 0],
  ['road-tee-closed-ne', 1, 0],
  ['road-curve-sw-nw', 2, 0],
  ['road-tee-closed-nw', 0, 1],
  ['road-cross', 1, 1],
  ['road-tee-closed-se', 2, 1],
  ['road-curve-ne-se', 0, 2],
  ['road-tee-closed-sw', 1, 2],
  ['road-curve-nw-ne', 2, 2],
  ['road-end-se', 0, 5],
  ['road-straight-x', 1, 5],
  ['road-straight-x', 2, 5],
  ['road-end-nw', 3, 5],
  ['road-end-sw', 5, 0],
  ['road-straight-y', 5, 1],
  ['road-straight-y', 5, 2],
  ['road-end-ne', 5, 3],
  ['road-end-se', 0, 7],
  ['crossing-regular-r0', 1, 7],
  ['road-straight-x', 2, 7],
  ['crossing-narrow-r0', 3, 7],
  ['road-end-nw', 4, 7],
  ['road-end-sw', 7, 0],
  ['crossing-regular-r1', 7, 1],
  ['road-straight-y', 7, 2],
  ['crossing-narrow-r1', 7, 3],
  ['road-end-ne', 7, 4],
];
// Rails: [axis the track runs along, fixed coordinate, offset, from, to].
const RAILS = [
  ['y', 1, 0.16, 5.5, 8.5],
  ['y', 3, 0.08, 5.5, 8.5],
  ['x', 1, 0.16, 5.5, 8.5],
  ['x', 3, 0.08, 5.5, 8.5],
];
const GRASS = [104, 120, 66],
  RAIL = [150, 148, 142],
  RAIL_HALF = 0.022; // the game's 1.25 px rail line
// Resolution 4: a tile is 256x128 texels, world (x, y) sits at (OX + T(x - y), OY + T/2 (x + y)).
const T = 128,
  MARGIN = 48;
const corners = [
  ...NETWORK.flatMap(([, i, j]) => [
    [i - 0.5, j - 0.5],
    [i + 0.5, j + 0.5],
    [i + 0.5, j - 0.5],
    [i - 0.5, j + 0.5],
  ]),
  ...RAILS.flatMap(([axis, at, , from, to]) =>
    [from, to].map((s) => (axis === 'x' ? [s, at] : [at, s])),
  ),
].map(([x, y]) => [T * (x - y), (T / 2) * (x + y)]);
const fit = (v) => Math.ceil(v / 4) * 4; // whole game pixels, so tiles land on the 1x grid
const OX = fit(MARGIN - Math.min(...corners.map((p) => p[0]))),
  OY = fit(MARGIN - Math.min(...corners.map((p) => p[1])));
const W = fit(OX + Math.max(...corners.map((p) => p[0])) + MARGIN),
  H = fit(OY + Math.max(...corners.map((p) => p[1])) + MARGIN);
const net = new Float32Array(W * H * 4);
for (const [id, i, j] of NETWORK) {
  const img = reduced[id],
    left = OX + T * (i - j) - AX / TEXEL,
    top = OY + (T / 2) * (i + j) - AY / TEXEL;
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const s = (y * img.w + x) * 4;
      if (!img.data[s + 3]) continue;
      const o = ((top + y) * W + left + x) * 4;
      for (let c = 0; c < 4; c++) net[o + c] += img.data[s + c];
    }
}
const out = new PNG({ width: W, height: H });
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const a = (x + 0.5 - OX) / T,
      b = (y + 0.5 - OY) / (T / 2);
    const wx = (a + b) / 2,
      wy = (b - a) / 2;
    let base = GRASS;
    for (const [axis, at, g, from, to] of RAILS) {
      const along = axis === 'x' ? wx : wy,
        across = axis === 'x' ? wy : wx;
      if (along < from || along > to) continue;
      for (const rail of [at - g, at + g]) {
        const cover = Math.min(
          1,
          Math.max(0, (RAIL_HALF - Math.abs(across - rail)) / ACROSS_TEXEL + 0.5),
        );
        if (cover > 0) base = base.map((v, c) => v + (RAIL[c] - v) * cover);
      }
    }
    const o = (y * W + x) * 4,
      alpha = Math.min(1, net[o + 3] / 255);
    for (let c = 0; c < 3; c++) out.data[o + c] = Math.round(net[o + c] + base[c] * (1 - alpha));
    out.data[o + 3] = 255;
  }
mkdirSync(`${ROOT}/review`, { recursive: true });
writeFileSync(`${ROOT}/review/final-network.png`, PNG.sync.write(out));
const small = reduce(out, 4);
const out1 = new PNG({ width: small.w, height: small.h });
for (let i = 0; i < small.data.length; i++) out1.data[i] = Math.round(small.data[i]);
writeFileSync(`${ROOT}/review/final-network-1x.png`, PNG.sync.write(out1));

for (const r of report) {
  const extra = r.grooves
    ? ` grooves ${r.grooves.map((g) => `${g.centre}/${g.expected}`).join(' ')}`
    : '';
  console.log(
    `${r.passes ? 'pass' : 'FAIL'} ${r.id}: outside ${r.outsideDiamond}/${r.outsideBand}, not opaque ${r.bandNotOpaque}, wide edge ${r.softEdgeTooWide}, anchor off ${r.anchorOffBy}${extra}`,
  );
}
for (const [edge, j] of Object.entries(joins))
  console.log(
    `${j.passes ? 'pass' : 'FAIL'} join ${edge}: span ${j.span.from}..${j.span.to}, opposite ${j.matchesOpposite}, worst diff ${Math.max(...j.pieces.map((p) => p.maxDiff))} (${j.pieces.length} pieces)`,
  );
if (failures.length) {
  console.error(`check-final: ${failures.length} failure(s): ${failures.join(', ')}`);
  process.exit(1);
}
console.log('check-final: all 19 pictures pass');
