#!/usr/bin/env node
/**
 * Checks the 19 finished road and crossing pictures against the exact geometry and the author's
 * choices of 2026-10-11, writes final-check.json, and composes the pieces into a small network
 * for review.
 *
 *   node assets/source/roads-2026-10-11/check-final.mjs
 *
 * The geometry comes from geometry.json and crossing-geometry.json, and the choices are written
 * out below, not taken from finish-roads.mjs, so the check does not share the finishing code.
 *
 * Per picture: a 1024x1024 RGBA canvas. The road is 0.32 tile wide: every pixel within 0.12 of
 * the centre line (the band less half the feather and the edge's wander) is opaque, the mean
 * alpha across the edge (tufts left out) falls through one half within 0.01 of 0.16, and it
 * fades over about the 0.05 feather rather than at a hard outline. Grass tufts (the pixels
 * greener than red) sit only across the edge, 0.06 to 0.26 from the centre line, and nothing
 * reaches past them. Outside the diamond only the bleed shows: up to 2 world px past each
 * joining edge, within the road and its tufts.
 *
 * Bleed: wherever a picture's bleed lies over a neighbour (every picture that joins it there),
 * the neighbour is at least as opaque, so the overlap never widens the road or lights its edge,
 * and the colours agree.
 *
 * Joins: each picture reduced to atlas resolution 4 (the diamond 256x128); every picture that
 * meets an edge midpoint shows the same cross-section there, and the road there is 0.32 wide and
 * centred on the midpoint. Across each edge line, the road's width and centre step no more than
 * they drift over the same distance on either side, so neighbours join at the same place and
 * width.
 *
 * Crossings: the deck is opaque across the road band and as long along the track as the road is
 * wide, with nothing beside it over the track; it ends 0.06 tile past each rail (0.22 regular,
 * 0.14 narrow); on each rail line the slot shows the game's rail, a bright head 0.0095 tile
 * screen-up of the line and a dark side a rail's height below it (0.0245 regular, 0.0205
 * narrow), in the rail colour rather than black. The stone deck (regular) is paler than the dirt
 * deck (narrow). Tone: the straight roads' gravel has the composites' mean colour.
 *
 * Also writes review/final-network.png (every piece at resolution 4 on a flat grass fill, the
 * crossings over plain grey rails at the exact offsets) and review/final-network-1x.png (the same
 * at game scale). Exits 1 if any check fails.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const geometry = JSON.parse(readFileSync(`${ROOT}/geometry.json`, 'utf8'));
const crossingGeometry = JSON.parse(readFileSync(`${ROOT}/crossing-geometry.json`, 'utf8'));
const SIZE = geometry.footprint.canvas[0];
const [AX, AY] = geometry.anchor;

// The author's choices (decision board, 2026-10-11).
const WIDTH = 0.32; // the whole visible road, tiles
const HALF = WIDTH / 2;
const FEATHER = 0.05; // the edge fades into the grass over this, tiles
const WANDER = 0.015; // how far the soft edge may wander from the band, tiles
// Tufts sit across the edge: rooted on the gravel their blades rise over the grass, rooted in
// the grass they rise over the gravel, up to about 0.07 tile on screen.
const TUFT_IN = 0.1; // how far inside the band's edge a tuft may reach, tiles
const TUFT_OUT = 0.1; // how far past the band's edge a tuft may reach, tiles
// A tuft pixel is greener than red by this much; the gravel, its worn edge, the decks and the
// rails' dark side are not.
const isTuft = (r, g) => g >= r + 3;
const DECK_MARGIN = 0.06; // deck beyond each rail, tiles
const BLEED = 2 / Math.hypot(32, 16); // 2 world px past a joining edge, tiles along its normal
const GRAVEL = [182, 162, 133]; // the gravel's mean colour in the composites
// The game's rail as measured on a capture (tiles across the track from the rail line; screen-up
// is negative on both rotations): the head's centre and the dark side's centre.
const RAIL = { regular: { head: -0.0095, dark: 0.0245 }, narrow: { head: -0.0095, dark: 0.0205 } };

const TEXEL = 2; // canvas pixels per texel at atlas resolution 4
const PX = Math.hypot(1 / 512, 1 / 256); // tiles per canvas pixel across a line along x or y
// 8-bit levels, premultiplied, at resolution 4. Curves leave the straight line inside the first
// texel, which moves their soft edge by a few hundredths of a pixel there.
const COLOUR_TOLERANCE = 6;
const MIDS = { ne: [0, -0.5], se: [0.5, 0], sw: [0, 0.5], nw: [-0.5, 0] };
const OUT = { ne: [0, -1], se: [1, 0], sw: [0, 1], nw: [-1, 0] };
const OPPOSITE = { ne: 'sw', se: 'nw', sw: 'ne', nw: 'se' };

const toTile = (px, py) => {
  const a = (px - AX) / 256,
    b = (py - AY) / 128;
  return [(a + b) / 2, (b - a) / 2];
};
const toCanvas = (x, y) => [AX + 256 * (x - y), AY + 128 * (x + y)];
const inDiamond = (x, y) => Math.max(Math.abs(x), Math.abs(y)) <= 0.5;
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const round = (v, d = 4) => +v.toFixed(d);

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

/** The picture's description: its legs and its distance from the road's centre line. */
const pieces = [
  ...geometry.pieces.map((p) => ({
    id: p.id,
    kind: 'road',
    legs: p.edges,
    dist: (x, y) => roadDistance(p, x, y),
  })),
  ...crossingGeometry.pieces.map((p) => ({
    id: p.id,
    kind: 'crossing',
    legs: p.roadEdges,
    gauge: p.gauge,
    rotation: p.rotation,
    g: p.railOffset,
    // u along the track (across the road), a across the track
    u: (x, y) => (p.rotation === 0 ? y : x),
    a: (x, y) => (p.rotation === 0 ? x : y),
    dist: (x, y) => Math.abs(p.rotation === 0 ? y : x),
  })),
];
const pictures = Object.fromEntries(
  pieces.map((p) => [p.id, PNG.sync.read(readFileSync(`${ROOT}/${p.id}.png`))]),
);
const alphaAt = (png, px, py) =>
  px < 0 || py < 0 || px >= png.width || py >= png.height
    ? 0
    : png.data[(py * png.width + px) * 4 + 3];

/** Which leg's bleed strip a point outside the diamond is in, or null. */
function bleedLeg(piece, x, y) {
  for (const e of piece.legs) {
    const [ox, oy] = OUT[e];
    const n = x * ox + y * oy,
      t = -x * oy + y * ox;
    if (n > 0.5 && n <= 0.5 + BLEED + PX && Math.abs(t) <= HALF + TUFT_OUT) return e;
  }
  return null;
}

/** Shape, edge, tufts and bleed of one picture. */
function checkPicture(piece) {
  const png = pictures[piece.id];
  const res = {
    id: piece.id,
    canvas: [png.width, png.height],
    rgba: png.colorType === 6,
    coreNotOpaque: 0,
    beyondTufts: 0,
    tuftsOffEdge: 0,
    outsideDiamond: 0,
  };
  // the mean alpha of the road (tufts left out) in bins of distance from the centre line
  const BIN = 0.0025,
    bins = Array.from({ length: Math.ceil(0.3 / BIN) }, () => [0, 0]);
  const deckEdge = piece.kind === 'crossing' ? piece.g + DECK_MARGIN : 0;
  let tuftRange = [Infinity, -Infinity],
    reach = 0;
  for (let py = 0; py < png.height; py++)
    for (let px = 0; px < png.width; px++) {
      const i = (py * png.width + px) * 4,
        alpha = png.data[i + 3];
      const [x, y] = toTile(px + 0.5, py + 0.5);
      if (!inDiamond(x, y)) {
        if (alpha > 0 && !bleedLeg(piece, x, y)) res.outsideDiamond++;
        continue;
      }
      const d = piece.dist(x, y);
      if (d <= HALF - FEATHER / 2 - WANDER && alpha < 255) res.coreNotOpaque++;
      if (alpha === 0) continue;
      reach = Math.max(reach, d);
      if (d > HALF + TUFT_OUT) res.beyondTufts++;
      const tuft = isTuft(png.data[i], png.data[i + 1]);
      if (tuft) {
        tuftRange = [Math.min(tuftRange[0], d), Math.max(tuftRange[1], d)];
        if (d < HALF - TUFT_IN) res.tuftsOffEdge++;
      }
      // the soft edge, measured where the road runs on its own (not over a crossing's deck)
      if (piece.kind === 'crossing' && Math.abs(piece.a(x, y)) < deckEdge + 0.15) continue;
      if (!tuft && d < 0.3) {
        bins[Math.floor(d / BIN)][0] += alpha / 255;
        bins[Math.floor(d / BIN)][1]++;
      }
    }
  // add the transparent pixels to the bins
  for (let py = AY - 140; py < AY + 140; py++)
    for (let px = AX - 270; px < AX + 270; px++) {
      if (png.data[(py * png.width + px) * 4 + 3] !== 0) continue;
      const [x, y] = toTile(px + 0.5, py + 0.5);
      if (!inDiamond(x, y)) continue;
      if (piece.kind === 'crossing' && Math.abs(piece.a(x, y)) < deckEdge + 0.15) continue;
      const d = piece.dist(x, y);
      if (d < 0.3) bins[Math.floor(d / BIN)][1]++;
    }
  const profile = bins.map(([s, n], k) => [(k + 0.5) * BIN, n ? s / n : 1]);
  const crossing = (level) => {
    for (let k = 1; k < profile.length; k++)
      if (profile[k - 1][1] >= level && profile[k][1] < level) {
        const [d0, a0] = profile[k - 1],
          [d1, a1] = profile[k];
        return d0 + ((a0 - level) * (d1 - d0)) / (a0 - a1);
      }
    return NaN;
  };
  res.edge = {
    half: round(crossing(0.5)),
    from90to10: round(crossing(0.1) - crossing(0.9)),
    reach: round(reach),
    tufts: tuftRange[0] === Infinity ? null : tuftRange.map((v) => round(v)),
  };
  res.passes =
    res.canvas[0] === SIZE &&
    res.canvas[1] === SIZE &&
    res.rgba &&
    res.coreNotOpaque === 0 &&
    res.beyondTufts === 0 &&
    res.tuftsOffEdge === 0 &&
    res.outsideDiamond === 0 &&
    Math.abs(res.edge.half - HALF) <= 0.01 &&
    res.edge.from90to10 >= 0.4 * FEATHER &&
    res.edge.from90to10 <= FEATHER + 2 * WANDER;
  return res;
}

/**
 * The bleed over every neighbour: each bleed pixel against the same world point in every picture
 * that joins across that edge. `widens` counts bleed pixels more opaque than a neighbour there
 * (by more than 4 levels); the colours are compared where both are opaque.
 */
function checkBleed(piece) {
  const png = pictures[piece.id];
  const out = {};
  for (const e of piece.legs) {
    const [ox, oy] = OUT[e];
    const dx = -256 * (ox - oy),
      dy = -128 * (ox + oy); // canvas offset of the same world point in the neighbour
    const neighbours = pieces.filter((p) => p.legs.includes(OPPOSITE[e]));
    let pixels = 0,
      widens = 0,
      sum = 0,
      n = 0,
      max = 0;
    const diffs = [];
    for (let py = AY - 150; py < AY + 150; py++)
      for (let px = AX - 280; px < AX + 280; px++) {
        const i = (py * png.width + px) * 4,
          alpha = png.data[i + 3];
        if (!alpha) continue;
        const [x, y] = toTile(px + 0.5, py + 0.5);
        if (inDiamond(x, y) || bleedLeg(piece, x, y) !== e) continue;
        pixels++;
        for (const nb of neighbours) {
          const q = pictures[nb.id],
            j = ((py + dy) * q.width + px + dx) * 4;
          if (alpha > alphaAt(q, px + dx, py + dy) + 4) widens++;
          if (alpha < 250 || q.data[j + 3] < 250) continue;
          const diff = Math.max(...[0, 1, 2].map((c) => Math.abs(png.data[i + c] - q.data[j + c])));
          sum += diff;
          n++;
          max = Math.max(max, diff);
          diffs.push(diff);
        }
      }
    diffs.sort((p, q) => p - q);
    out[e] = {
      pixels,
      widens,
      meanDiff: round(n ? sum / n : 0, 2),
      p99Diff: diffs.length ? diffs[Math.floor(0.99 * (diffs.length - 1))] : 0,
      maxDiff: max,
      passes: pixels > 0 && widens === 0 && (n ? sum / n : 0) <= 2,
    };
  }
  return out;
}

/** Bilinear sample of straight (non-premultiplied) colour and alpha at a canvas point. */
function sampleCanvas(png, cx, cy) {
  const fx = cx - 0.5,
    fy = cy - 0.5,
    x0 = Math.floor(fx),
    y0 = Math.floor(fy),
    tx = fx - x0,
    ty = fy - y0;
  const out = [0, 0, 0, 0];
  for (let n = 0; n < 4; n++) {
    const px = x0 + (n & 1),
      py = y0 + (n >> 1),
      w = (n & 1 ? tx : 1 - tx) * (n >> 1 ? ty : 1 - ty),
      i = (py * png.width + px) * 4;
    for (let c = 0; c < 4; c++) out[c] += png.data[i + c] * w;
  }
  return out;
}

/** The deck of a crossing: opacity, extent, flush sides, rail slots and mean colour. */
function checkDeck(piece) {
  const png = pictures[piece.id];
  const g = piece.g,
    end = g + DECK_MARGIN;
  // canvas point from (a across the track, u along it)
  const point = (a, u) => (piece.rotation === 0 ? toCanvas(a, u) : toCanvas(u, a));
  let holes = 0,
    beside = 0;
  for (let py = AY - 140; py < AY + 140; py++)
    for (let px = AX - 270; px < AX + 270; px++) {
      const [x, y] = toTile(px + 0.5, py + 0.5);
      if (!inDiamond(x, y)) continue;
      const a = Math.abs(piece.a(x, y)),
        u = Math.abs(piece.u(x, y)),
        alpha = png.data[(py * png.width + px) * 4 + 3];
      if (a <= end - PX && u <= HALF - PX && alpha < 255) holes++;
      if (a <= end - 2 * PX && u >= HALF + PX && alpha > 0) beside++;
    }
  // Where the deck ends across the track: just outside the band the deck leaves nothing and
  // the road beyond it fades in, so alpha there rises at the deck's end.
  const ends = [];
  for (const side of [-1, 1]) {
    const u = HALF + 0.01;
    let found = NaN;
    for (let a = g; a <= g + 0.2; a += 0.0005) {
      const s = sampleCanvas(png, ...point(side * a, u)),
        s2 = sampleCanvas(png, ...point(side * a, -u));
      if (s[3] + s2[3] > 2 * 0.1 * 255) {
        found = a;
        break;
      }
    }
    ends.push(round(found));
  }
  // The slots: luma across each rail, averaged along the deck.
  const slots = [];
  for (const rail of [-g, g]) {
    const as = [],
      ls = [],
      cols = [];
    for (let a = rail - 0.04; a <= rail + 0.05 + 1e-9; a += 0.0005) {
      let l = 0;
      const col = [0, 0, 0];
      const us = [];
      for (let u = -HALF + 0.02; u <= HALF - 0.02 + 1e-9; u += 0.004) us.push(u);
      for (const u of us) {
        const s = sampleCanvas(png, ...point(a, u));
        l += lum(s[0], s[1], s[2]);
        for (let c = 0; c < 3; c++) col[c] += s[c];
      }
      as.push(a - rail);
      ls.push(l / us.length);
      cols.push(col.map((v) => v / us.length));
    }
    const pick = (lo, hi, better) => {
      let k = -1;
      for (let i = 0; i < as.length; i++)
        if (as[i] >= lo && as[i] <= hi && (k < 0 || better(ls[i], ls[k]))) k = i;
      return k;
    };
    const h = pick(-0.025, 0.005, (p, q) => p > q),
      d = pick(0.005, 0.04, (p, q) => p < q);
    const R = RAIL[piece.gauge];
    const deck = ls.filter((_, i) => as[i] >= 0.04);
    const ground = deck.reduce((p, q) => p + q, 0) / deck.length;
    slots.push({
      rail,
      head: round(as[h]),
      dark: round(as[d]),
      headLuma: Math.round(ls[h]),
      darkLuma: Math.round(ls[d]),
      darkColour: cols[d].map((v) => Math.round(v)),
      deckLuma: Math.round(ground),
      passes:
        Math.abs(as[h] - R.head) <= 0.004 &&
        Math.abs(as[d] - R.dark) <= 0.004 &&
        ls[h] - ls[d] >= 60 &&
        ls[d] >= 40,
    });
  }
  // The deck's mean colour between the rails, away from the slots.
  const mean = [0, 0, 0];
  let n = 0;
  for (let a = -g + 0.04; a <= g - 0.025 + 1e-9; a += 0.005)
    for (let u = -HALF + 0.02; u <= HALF - 0.02 + 1e-9; u += 0.005) {
      const s = sampleCanvas(png, ...point(a, u));
      for (let c = 0; c < 3; c++) mean[c] += s[c];
      n++;
    }
  const colour = mean.map((v) => Math.round(v / n));
  return {
    holes,
    beside,
    ends,
    expectedEnd: round(end),
    slots,
    colour,
    luma: Math.round(lum(...colour)),
    passes:
      holes === 0 &&
      beside === 0 &&
      ends.every((e) => Math.abs(e - end) <= 2 * PX) &&
      slots.every((s) => s.passes),
  };
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
  // Tufts left out: they differ a little either side of an edge line, as grass does. The
  // samples are premultiplied, so a tuft's green leads its red by 3 times alpha.
  const road = (s) => s[3] >= 127.5 && s[1] < s[0] + (3 * s[3]) / 255;
  const idx = samples.map((s, i) => (road(s) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return null;
  const at = (i) => -0.32 + i / 256;
  return { from: round(at(idx[0])), to: round(at(idx.at(-1))) };
}

const report = pieces.map(checkPicture);
for (const r of report) {
  const piece = pieces.find((p) => p.id === r.id);
  r.bleed = checkBleed(piece);
  r.passes = r.passes && Object.values(r.bleed).every((b) => b.passes);
  if (piece.kind === 'crossing') {
    r.deck = checkDeck(piece);
    r.passes = r.passes && r.deck.passes;
  }
}
const reduced = Object.fromEntries(
  Object.entries(pictures).map(([id, png]) => [id, reduce(png, TEXEL)]),
);

// Every picture that meets an edge shows the same resolution-4 cross-section there, centred on
// the edge's midpoint.
const joins = {};
for (const edge of Object.keys(MIDS)) {
  const ids = pieces.filter((p) => p.legs.includes(edge)).map((p) => p.id);
  const sections = Object.fromEntries(ids.map((id) => [id, crossSection(reduced[id], edge)]));
  const ref = sections[ids[0]];
  const list = ids.map((id) => {
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
    return { id, maxDiff: round(max, 2), meanDiff: round(sum / n, 3), span: span(sections[id]) };
  });
  joins[edge] = { reference: ids[0], span: span(ref), pieces: list };
}
const sameSpan = (p, q) =>
  !!p &&
  !!q &&
  Math.abs(p.from - q.from) <= 1 / 256 + 1e-9 &&
  Math.abs(p.to - q.to) <= 1 / 256 + 1e-9;

/**
 * Across an edge line, at full resolution: the alpha of every picture that leaves by `edge`,
 * 0.002 tile inside it, against every picture that enters by the opposite edge, 0.002 tile
 * inside that, at the same position along the line (the two points are 0.004 tile, about a
 * pixel, apart in the world). The soft edge and the tufts make single samples jitter, so the road
 * is measured by its alpha integrated along the line: its width (the integral) and its centre
 * (the alpha-weighted mean position). These drift a little along the road as the edge wanders,
 * so what is checked is that they step across the edge line no more than they step over the same
 * distance on either side of it (lines 0.004 further in): within 0.002 tile, so the road runs on
 * across the join at the same place and width.
 */
function acrossEdge(edge) {
  const [ox, oy] = OUT[edge],
    tangent = [-oy, ox],
    [mx, my] = MIDS[edge];
  const STEP = 0.001;
  // [width, centre] of a picture along the line at signed depth from the edge (+ = outward)
  const extent = (id, [bx, by], depth) => {
    let w = 0,
      m = 0;
    for (let t = -0.3; t <= 0.3 + 1e-9; t += STEP) {
      const x = bx + depth * ox + t * tangent[0],
        y = by + depth * oy + t * tangent[1];
      const a = sampleCanvas(pictures[id], ...toCanvas(x, y))[3] / 255;
      w += a;
      m += a * t;
    }
    return [w * STEP, m / w];
  };
  const leaving = pieces.filter((p) => p.legs.includes(edge)).map((p) => p.id);
  const entering = pieces.filter((p) => p.legs.includes(OPPOSITE[edge])).map((p) => p.id);
  const step = [0, 0],
    worst = [0, 0];
  for (const a of leaving)
    for (const b of entering) {
      const a2 = extent(a, [mx, my], -0.002),
        a6 = extent(a, [mx, my], -0.006),
        b2 = extent(b, [-mx, -my], 0.002),
        b6 = extent(b, [-mx, -my], 0.006);
      for (const k of [0, 1]) {
        const jump = b2[k] - a2[k],
          beside = (a2[k] - a6[k] + b6[k] - b2[k]) / 2;
        if (Math.abs(jump - beside) >= worst[k]) {
          worst[k] = Math.abs(jump - beside);
          step[k] = jump;
        }
      }
    }
  return {
    pairs: leaving.length * entering.length,
    widthStep: round(step[0]),
    widthStepBeyondDrift: round(worst[0]),
    centreStep: round(step[1]),
    centreStepBeyondDrift: round(worst[1]),
    passes: worst[0] <= 0.002 && worst[1] <= 0.002,
  };
}

/** Width (alpha integrated along the line) and centre of a section, tufts left out. */
function roadExtent(samples) {
  let w = 0,
    m = 0;
  samples.forEach((s, i) => {
    if (s[3] > 0 && isTuft((255 * s[0]) / s[3], (255 * s[1]) / s[3])) return; // premultiplied
    const t = -0.32 + i / 256,
      a = s[3] / 255;
    w += a;
    m += a * t;
  });
  return { width: round(w / 256), centre: round(m / w) };
}

for (const edge of Object.keys(MIDS)) {
  const join = joins[edge];
  join.across = acrossEdge(edge);
  Object.assign(join, roadExtent(crossSection(reduced[join.reference], edge)));
  join.passes =
    join.across.passes &&
    Math.abs(join.centre) <= WANDER &&
    Math.abs(join.width - WIDTH) <= 0.02 &&
    join.pieces.every((p) => p.maxDiff <= COLOUR_TOLERANCE && sameSpan(p.span, join.span));
}

// Stone on regular, dirt on narrow: the stone is the paler deck.
const deckLuma = (gauge) =>
  report.filter((r) => r.deck && pieces.find((p) => p.id === r.id).gauge === gauge);
const materials = {
  regular: deckLuma('regular').map((r) => r.deck.luma),
  narrow: deckLuma('narrow').map((r) => r.deck.luma),
};
materials.passes = Math.min(...materials.regular) >= Math.max(...materials.narrow) + 15;

// Tone: the straight roads' gravel (within 0.12 of the centre line) has the composites' colour.
const tone = { expected: GRAVEL };
{
  const sum = [0, 0, 0];
  let n = 0;
  for (const id of ['road-straight-x', 'road-straight-y']) {
    const png = pictures[id],
      piece = pieces.find((p) => p.id === id);
    for (let py = AY - 140; py < AY + 140; py++)
      for (let px = AX - 270; px < AX + 270; px++) {
        const [x, y] = toTile(px + 0.5, py + 0.5);
        if (!inDiamond(x, y) || piece.dist(x, y) > HALF - FEATHER / 2 - WANDER) continue;
        const i = (py * png.width + px) * 4;
        for (let c = 0; c < 3; c++) sum[c] += png.data[i + c];
        n++;
      }
  }
  tone.mean = sum.map((s) => round(s / n, 1));
  tone.passes = tone.mean.every((v, c) => Math.abs(v - GRAVEL[c]) <= 4);
}

const failures = [
  ...report.filter((r) => !r.passes).map((r) => r.id),
  ...Object.entries(joins)
    .filter(([, j]) => !j.passes)
    .map(([e]) => `join ${e}`),
  ...(materials.passes ? [] : ['materials']),
  ...(tone.passes ? [] : ['tone']),
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
        width: `${WIDTH} tile: opaque within ${round(HALF - FEATHER / 2 - WANDER)} of the centre line, mean alpha 0.5 within 0.01 of ${HALF}`,
        feather: `90% to 10% of the mean alpha over ${0.4 * FEATHER} to ${round(FEATHER + 2 * WANDER)} tile`,
        tufts: `greener than red (by 3) only past ${round(HALF - TUFT_IN)}; nothing past ${round(HALF + TUFT_OUT)}`,
        bleed: `outside the diamond only up to ${round(BLEED)} tile (2 world px) past a joining edge and within the band; never more opaque than a neighbour under it (4 levels); mean colour difference to it at most 2 levels`,
        joins: `resolution-4 cross-section at each edge midpoint within ${COLOUR_TOLERANCE} levels of the reference; the road there (alpha integrated along the edge, tufts left out) ${WIDTH} +- 0.02 wide and centred within ${WANDER}; across the edge line, every leaving and entering picture's integrated width and centre step no more than 0.002 beyond their drift over the same distance on either side`,
        deck: `opaque over the band to ${DECK_MARGIN} past each rail, nothing beside it, its end within two pixels of there`,
        slots:
          'head within 0.004 of the line + -0.0095, dark side within 0.004 of + 0.0245 (regular) or 0.0205 (narrow), head at least 60 luma above the dark side, the dark side at least 40 (not black)',
        materials: 'the stone deck (regular) at least 15 luma paler than the dirt deck (narrow)',
        tone: `the straight roads' gravel within 4 levels of ${GRAVEL.join(',')}`,
      },
      pictures: report,
      joins,
      materials,
      tone,
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
  RAIL_GREY = [150, 148, 142],
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
// The ground, then the pieces back to front, each laid over what is under it.
const net = new Float32Array(W * H * 3);
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
          Math.max(0, (RAIL_HALF - Math.abs(across - rail)) / (PX * TEXEL) + 0.5),
        );
        if (cover > 0) base = base.map((v, c) => v + (RAIL_GREY[c] - v) * cover);
      }
    }
    net.set(base, (y * W + x) * 3);
  }
for (const [id, i, j] of [...NETWORK].sort((p, q) => p[1] + p[2] - q[1] - q[2] || p[1] - q[1])) {
  const img = reduced[id],
    left = OX + T * (i - j) - AX / TEXEL,
    top = OY + (T / 2) * (i + j) - AY / TEXEL;
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const s = (y * img.w + x) * 4,
        alpha = img.data[s + 3] / 255;
      if (!alpha) continue;
      const o = ((top + y) * W + left + x) * 3;
      for (let c = 0; c < 3; c++) net[o + c] = img.data[s + c] + net[o + c] * (1 - alpha);
    }
}
const out = new PNG({ width: W, height: H });
for (let k = 0; k < W * H; k++) {
  for (let c = 0; c < 3; c++) out.data[k * 4 + c] = Math.round(net[k * 3 + c]);
  out.data[k * 4 + 3] = 255;
}
mkdirSync(`${ROOT}/review`, { recursive: true });
writeFileSync(`${ROOT}/review/final-network.png`, PNG.sync.write(out));
const small = reduce(out, 4);
const out1 = new PNG({ width: small.w, height: small.h });
for (let k = 0; k < small.data.length; k++) out1.data[k] = Math.round(small.data[k]);
writeFileSync(`${ROOT}/review/final-network-1x.png`, PNG.sync.write(out1));

for (const r of report) {
  const bleed = Object.entries(r.bleed)
    .map(([e, b]) => `${e} ${b.widens}/${b.meanDiff}/${b.maxDiff}`)
    .join(' ');
  const deck = r.deck
    ? ` deck ${r.deck.holes}/${r.deck.beside} ends ${r.deck.ends.join(',')}/${r.deck.expectedEnd} slots ${r.deck.slots.map((s) => `${s.head},${s.dark}`).join(' ')} luma ${r.deck.luma}`
    : '';
  console.log(
    `${r.passes ? 'pass' : 'FAIL'} ${r.id}: core ${r.coreNotOpaque}, beyond ${r.beyondTufts}, tufts ${r.tuftsOffEdge}, outside ${r.outsideDiamond}, edge ${r.edge.half}/${r.edge.from90to10} reach ${r.edge.reach} tufts ${r.edge.tufts}; bleed ${bleed}${deck}`,
  );
}
for (const [edge, j] of Object.entries(joins))
  console.log(
    `${j.passes ? 'pass' : 'FAIL'} join ${edge}: span ${j.span?.from}..${j.span?.to} (width ${j.width}, centre ${j.centre}), worst diff ${Math.max(...j.pieces.map((p) => p.maxDiff))} (${j.pieces.length} pieces); across: width step ${j.across.widthStep} (${j.across.widthStepBeyondDrift} beyond the drift), centre step ${j.across.centreStep} (${j.across.centreStepBeyondDrift}) (${j.across.pairs} pairs)`,
  );
console.log(
  `${materials.passes ? 'pass' : 'FAIL'} materials: stone ${materials.regular}, dirt ${materials.narrow}`,
);
console.log(`${tone.passes ? 'pass' : 'FAIL'} tone: ${tone.mean} (${GRAVEL})`);
if (failures.length) {
  console.error(`check-final: ${failures.length} failure(s): ${failures.join(', ')}`);
  process.exit(1);
}
console.log(`check-final: all ${report.length} pictures, the joins, materials and tone pass`);
