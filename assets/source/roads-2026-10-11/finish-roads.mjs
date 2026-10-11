#!/usr/bin/env node
/**
 * Finishing for #319: fits the author's road and crossing paintings to the exact tile geometry.
 *
 *   node assets/source/roads-2026-10-11/finish-roads.mjs
 *
 * The paintings are the material and the geometry is the shape. Prompting again does not hit
 * exact widths, so every final picture is resampled from the paintings through a mapping built
 * from geometry.json and crossing-geometry.json; only the rail grooves are drawn.
 *
 * Roads. Two strip textures are unwrapped from the paintings, one per direction so that each
 * keeps its own painted light: raw/road-straight-x.png for legs along tile x and
 * raw/road-straight-y.png for legs along tile y. A strip has an across coordinate u (tile units,
 * band |u| <= 0.25, moss verge to 0.28) and an along coordinate v that repeats seamlessly (the
 * ends are cross-faded) and is 0 at every edge midpoint, so every piece shows the same
 * cross-section where it meets its neighbour. The painted gravel edges, verge and ruts are found
 * per row and fitted with lines, then mapped piecewise-linearly onto the exact band; the along
 * scale matches the across scale so the stones keep their shape. road-straight-x was painted
 * with one central rut, so its strip takes the across profile (two ruts at u = +-0.1) of the
 * y strip while keeping its own stones and light.
 *
 * Pieces sample the strips along their own centre lines: straight legs run from the tile centre
 * to the edge midpoint, end pieces stop at the centre with a round cap (the ruts turn round in
 * it), curves bend the strips round the quarter circle of radius 0.5 and blend x into y by the
 * tangent's angle, and tees and the cross are the union of their legs: the through road's ruts
 * continue, the branch fades into it, and the gravel-to-verge edge follows the union's outline.
 *
 * Crossings. The road band is |offset along the track| <= 0.25 and crosses at right angles. The
 * deck covers the band between the rails and 0.1 tile outside each rail and is rectified from
 * the crossing paintings (raw/crossing-*-attempt-2.png): their painted deck edges and grooves are
 * found per row, fitted, and mapped onto the exact deck. Each rail is drawn as a thin dark groove
 * exactly at +-railOffset; outside the deck the road is the same gravel strip as the roads.
 *
 * Output: the 19 pictures at this folder's root, 1024x1024 RGBA, anchor (512, 832), opaque
 * inside, alpha 0 outside the band, the verge and the diamond, with a one-pixel antialiased
 * outline. check-final.mjs verifies them.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const geometry = JSON.parse(readFileSync(`${ROOT}/geometry.json`, 'utf8'));
const crossingGeometry = JSON.parse(readFileSync(`${ROOT}/crossing-geometry.json`, 'utf8'));

const SIZE = geometry.footprint.canvas[0];
const [AX, AY] = geometry.anchor;
const HALF = geometry.bandWidth / 2; // road band half-width, tile units
const VERGE = HALF + geometry.vergeMaximum; // outer edge of the moss verge
const DECK_OUT = crossingGeometry.deckOutsideRail; // deck beyond each rail
const RUT = 0.1; // rut centre lines
const RES = 1200; // strip samples per tile unit
const U_MAX = 0.3; // strip extent across
const MARGIN = 0.012; // keep the verge samples clear of the painted alpha fringe
const GROOVE = 0.02; // half-width of a rail groove: about the 1.25 px rail line in the game
const DECK_MARGIN = 0.006; // keep deck samples clear of the painted deck edge

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

function loadPainting(file) {
  const png = PNG.sync.read(readFileSync(`${ROOT}/${file}`));
  return { file, w: png.width, h: png.height, k: png.width / SIZE, data: png.data };
}

/** Premultiplied bilinear sample of a painting at tile point (x, y): rgb 0..255 times alpha. */
function sample(img, x, y, out) {
  const [cx, cy] = screen(x, y);
  const fx = cx * img.k - 0.5,
    fy = cy * img.k - 0.5;
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

/** Fits the painted alpha edges, gravel edges and (optionally) ruts of a straight road. */
function measureRoad(img, axis, withRuts) {
  const us = range(-0.62, 0.62, 0.002);
  const place = axis === 'x' ? (u, v) => [v, u] : (u, v) => [u, v];
  const rows = { v: [], alphaL: [], gravelL: [], rutL: [], rutR: [], gravelR: [], alphaR: [] };
  for (const v of range(-0.46, 0.46, 0.01)) {
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

/** Unwraps a straight road painting into a seamless strip on the exact cross-section. */
function buildStrip(img, axis, fits, withRuts) {
  // Source tile units per final tile unit, from the painted gravel width.
  const scale = (fits.gravelR.at(0) - fits.gravelL.at(0)) / (2 * HALF);
  const repeats = Math.ceil(scale / 0.86);
  const period = 1 / repeats; // divides one tile, so v = 0 lands on both edge midpoints
  const length = period * scale;
  const fade = Math.min(0.12, 0.92 - length);
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
      if (u < 0.14 || u > 0.2) continue;
      for (let c = 0; c < 3; c++) out[c] += m[iu * 3 + c];
      n++;
    }
    return out.map((x) => x / n);
  };
  const gx = plain(mx),
    gy = plain(my);
  for (let iu = 0; iu < stripX.nu; iu++) {
    const f = 1 - smoothstep(0.2, 0.24, Math.abs(-U_MAX + iu / RES));
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

/** Folds u back into the plain gravel between rut and edge, for interior blends. */
function fold(u) {
  const a = Math.abs(u);
  if (a <= 0.2) return u;
  const span = 0.07,
    e = (a - 0.2) % (2 * span);
  return Math.sign(u) * (e < span ? 0.2 - e : 0.13 + (e - span));
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
  const wb = smoothstep(0.09, 0.23, side) * (1 - smoothstep(0.24, 0.3, Math.abs(B.u)));
  const d = Math.min(T.d, bd),
    k = smoothstep(0.16, 0.2, d),
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

/**
 * Renders a picture from `pixel(x, y, rgb) -> alpha`. Pixels count as inside the diamond by
 * their centres, so neighbouring tiles cover the canvas without gaps or double edges; just
 * outside it the colour continues under alpha 0, so filtering never pulls in a dark fringe.
 */
function render(pixel) {
  const png = new PNG({ width: SIZE, height: SIZE });
  png.data.fill(0);
  const rgb = [0, 0, 0];
  for (let py = AY - 136; py < AY + 136; py++)
    for (let px = AX - 264; px < AX + 264; px++) {
      const a = (px + 0.5 - AX) / 256,
        b = (py + 0.5 - AY) / 128;
      const x = (a + b) / 2,
        y = (b - a) / 2;
      const alpha = pixel(x, y, rgb);
      const inDiamond = Math.max(Math.abs(x), Math.abs(y)) <= 0.5;
      const i = (py * SIZE + px) * 4;
      for (let c = 0; c < 3; c++) png.data[i + c] = Math.round(Math.min(255, Math.max(0, rgb[c])));
      png.data[i + 3] = inDiamond ? Math.round(255 * alpha) : 0;
    }
  return png;
}

const show = (fit) => `${fit.at(-0.25).toFixed(3)}..${fit.at(0.25).toFixed(3)}`;

const paintX = loadPainting('raw/road-straight-x.png'),
  paintY = loadPainting('raw/road-straight-y.png');
const fitsX = measureRoad(paintX, 'x', false),
  fitsY = measureRoad(paintY, 'y', true);
const builtX = buildStrip(paintX, 'x', fitsX, false),
  builtY = buildStrip(paintY, 'y', fitsY, true);
shareProfile(builtX.strip, builtY.strip);
const strips = { x: builtX.strip, y: builtY.strip };
for (const [name, fits, built] of [
  ['x', fitsX, builtX],
  ['y', fitsY, builtY],
]) {
  const knots = Object.entries(fits).map(([k, f]) => `${k} ${show(f)} (${f.kept}/${f.rows})`);
  console.log(`strip ${name}: ${knots.join(', ')}`);
  console.log(
    `  scale ${built.scale.toFixed(3)}, period ${built.period}, source ${built.start.toFixed(3)}..${(built.start + built.length + built.fade).toFixed(3)}, fade ${built.fade.toFixed(3)}`,
  );
}

for (const piece of geometry.pieces) {
  const png = render((x, y, rgb) => {
    const { d, grad } = roadPixel(piece, strips, x, y, rgb);
    return clamp01((VERGE - d) / perPixel(grad[0], grad[1]));
  });
  writeFileSync(`${ROOT}/${piece.id}.png`, PNG.sync.write(png));
  console.log(`wrote ${piece.id}.png`);
}

for (const piece of crossingGeometry.pieces) {
  const deck = measureDeck(loadPainting(`raw/${piece.id}-attempt-2.png`), piece, DECKS[piece.id]);
  const f = deck.fits;
  console.log(
    `${piece.id}: deck ${show(f.eL)} / ${show(f.eR)}, grooves ${show(f.gL)} / ${show(f.gR)}, groove colour ${deck.groove.map(Math.round)}`,
  );
  const png = render((x, y, rgb) => crossingPixel(piece, strips, deck, x, y, rgb));
  writeFileSync(`${ROOT}/${piece.id}.png`, PNG.sync.write(png));
  console.log(`wrote ${piece.id}.png`);
}
