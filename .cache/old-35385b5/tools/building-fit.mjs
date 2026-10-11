/** Find where a building stands in its picture, and lay the picture onto its footprint.
 *
 *   node tools/building-fit.mjs <id> [<id> ...]     print the measurement of pictures on disk
 *
 * An image generator keeps a guide's view but not its size or place: it fills the canvas, and its
 * ground lines are a little off the game's 2:1. So a picture is not required to match its guide to
 * the pixel. It is measured instead: the bases of its two visible walls are found, and from them
 * the scale, the place and the small camera correction that put it on its footprint. A building
 * whose foot is not two straight walls (a round tower, a yard of machinery) is placed by its
 * outline, without a camera correction. The check, the review sheets and the game's atlas all use
 * this one measurement.
 *
 * The correction is for small differences only. It stretches the picture, so a camera further
 * than FIT.camera degrees from the game's is not corrected into use: the check fails the picture
 * and it is painted again (`cameraOff`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { FOOTPRINTS, loadInventory, pictureFile, wallBase } from './building-kit.mjs';

export const FIT = {
  /** a wall base is trusted when its points span this share of its side of the picture */
  span: 0.6,
  /** how far a measured ground slope is used; the game's slopes are 0.5 and -0.5 */
  slope: [0.33, 0.67],
  /** degrees a picture's camera may be from the game's, in height and in turn */
  camera: 2,
  /**
   * a picture kept as the closest of its attempts is near enough within this many degrees: it is
   * marked, but not held against its family
   */
  near: 3,
  /** pixels more solid than this belong to the building */
  alpha: 128,
};

/** The highest and lowest building pixel of every column. */
function columns(png) {
  const { width: W, height: H, data } = png;
  const low = new Int32Array(W).fill(-1),
    top = new Int32Array(W).fill(-1);
  let minX = W,
    maxX = -1,
    area = 0;
  for (let x = 0; x < W; x++)
    for (let y = 0; y < H; y++)
      if (data[(y * W + x) * 4 + 3] > FIT.alpha) {
        if (top[x] < 0) top[x] = y;
        low[x] = y;
        if (x < minX) minX = x;
        maxX = x;
        area++;
      }
  return { low, top, minX, maxX, area };
}

/**
 * The straight line most of the points lie on, sloping the way `sign` says: the base of a wall,
 * whatever stands in front of it. Random pairs propose lines (the same pairs every run), the line
 * with most points near it wins, and a least-squares fit through those points refines it.
 */
function wallLine(pts, tol, sign) {
  if (pts.length < 8) return null;
  let best = null,
    seed = 12345;
  const pick = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return pts[seed % pts.length];
  };
  for (let i = 0; i < 500; i++) {
    const p = pick(),
      q = pick();
    if (Math.abs(p[0] - q[0]) < 16) continue;
    const a = (q[1] - p[1]) / (q[0] - p[0]);
    if (a * sign < 0.15 || a * sign > 1.2) continue;
    const b = p[1] - a * p[0];
    let n = 0;
    for (const r of pts) if (Math.abs(r[1] - (a * r[0] + b)) <= tol) n++;
    if (!best || n > best.n) best = { a, b, n };
  }
  if (!best) return null;
  let n = 0,
    sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0,
    from = Infinity,
    to = -Infinity;
  for (const [x, y] of pts) {
    if (Math.abs(y - (best.a * x + best.b)) > tol) continue;
    n++;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
    from = Math.min(from, x);
    to = Math.max(to, x);
  }
  const a = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return { a, b: (sy - a * sx) / n, from, to };
}

/** The line of slope `a` the points rest on, ignoring the few that reach lowest. */
function restLine(pts, a) {
  const c = pts.map(([x, y]) => y - a * x).sort((u, v) => u - v);
  return { a, b: c[Math.floor(c.length * 0.97)] };
}

/**
 * The building's foot in its picture: the base lines of the lower-left and lower-right wall, the
 * near corner `s` where they meet, and the outer corners `w` and `e`. `sure` says for each wall
 * whether a straight base was found.
 */
export function measureBase(png) {
  const { low, top, minX, maxX, area } = columns(png);
  if (maxX < 0) return null;
  const tol = Math.max(3, Math.round((maxX - minX) * 0.006));
  const side = (from, to) => {
    const pts = [];
    for (let x = from; x <= to; x++) if (low[x] >= 0) pts.push([x, low[x]]);
    return pts;
  };
  const meet = (l, r) => (r.b - l.b) / (l.a - r.a);
  let split = minX;
  for (let x = minX; x <= maxX; x++) if (low[x] > low[split]) split = x;
  let l = null,
    r = null;
  // the near corner is where the two bases meet: find the bases, split there, find them again
  for (let i = 0; i < 3; i++) {
    l = wallLine(side(minX, split), tol, 1);
    r = wallLine(side(split, maxX), tol, -1);
    if (!l || !r) break;
    const x = Math.round(meet(l, r));
    if (!(x > minX && x < maxX)) break;
    split = x;
  }
  const spans = (line, from, to) =>
    !!line && (line.to - line.from) / Math.max(1, to - from) >= FIT.span;
  const sure = [spans(l, minX, split), spans(r, split, maxX)];
  if (!sure[0]) l = restLine(side(minX, split), 0.5);
  if (!sure[1]) r = restLine(side(split, maxX), -0.5);
  const sx = meet(l, r),
    sy = l.a * sx + l.b;
  // an outer corner: the outermost columns whose lowest pixel is still on the base
  const on = (line, x, by) => low[x] >= 0 && Math.abs(low[x] - (line.a * x + line.b)) <= by;
  const corners = (byL, byR) => {
    let wx = Math.round(sx),
      ex = Math.round(sx);
    for (let x = minX; x < sx; x++)
      if (on(l, x, byL) && on(l, x + 1, byL) && on(l, x + 2, byL)) {
        wx = x;
        break;
      }
    for (let x = maxX; x > sx; x--)
      if (on(r, x, byR) && on(r, x - 1, byR) && on(r, x - 2, byR)) {
        ex = x;
        break;
      }
    return [wx, ex];
  };
  let [wx, ex] = corners(tol * 2, tol * 2);
  // a foot that is not a straight wall curves away from its line: follow it a tenth of its width
  if (!sure[0] || !sure[1]) {
    const by = Math.max(tol * 2, Math.round((ex - wx) * 0.1));
    [wx, ex] = corners(sure[0] ? tol * 2 : by, sure[1] ? tol * 2 : by);
  }
  if (ex - wx < 8) return null;
  return {
    sure,
    slopes: [l.a, r.a],
    w: [wx, l.a * wx + l.b],
    s: [sx, sy],
    e: [ex, r.a * ex + r.b],
    top,
    low,
    minX,
    maxX,
    area,
  };
}

/** The game's camera looks down at this many degrees, on a building turned 45 degrees. */
const ELEVATION = 30;

const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));
const rad = (deg) => (deg * Math.PI) / 180;
// `+ 0` turns a rounded -0 into 0, so the record reads the same either way
const round = (v, digits = 1) => Math.round(v * 10 ** digits) / 10 ** digits + 0;

/**
 * Where the camera stood, read from the two ground lines. The game's camera looks down at 30
 * degrees on a building turned 45 degrees, which draws the lines at 0.5 and -0.5. `elevation` is
 * how far it looked down (lower: both lines flatter, less roof seen); `turn` is how far the
 * building was turned from 45 degrees, positive towards its lower-right wall (that wall's foot
 * flatter, the other steeper).
 */
function cameraOf([pos, neg]) {
  const elevation = (Math.asin(Math.min(1, Math.sqrt(pos * -neg))) * 180) / Math.PI;
  const turn = (Math.atan(Math.sqrt(pos / -neg)) * 180) / Math.PI - 45;
  return { elevation: round(elevation), turn: round(turn) };
}

/**
 * How far a picture's camera is from the game's, from its measurement. With both wall feet found:
 * `elevation` and `turn`, degrees from the game's (looking down from higher, and turned towards
 * the lower-right wall, are positive), and `by`, the larger of the two. With one foot found there
 * is no telling the camera's height from the building's turn: `foot` is that wall (0 lower left,
 * 1 lower right) and `slope` its foot's, and the camera is off when no camera near the game's
 * draws a foot so steep or so flat. `off` says the picture has to be painted again. Null when no
 * straight wall foot was found: there is nothing to judge the camera by.
 */
export function cameraOff(fit) {
  const camera = fit.camera ?? (fit.sure[0] && fit.sure[1] ? cameraOf(fit.measured) : null);
  if (camera) {
    const elevation = round(camera.elevation - ELEVATION);
    const by = Math.max(Math.abs(elevation), Math.abs(camera.turn));
    return { off: by > FIT.camera, by, elevation, turn: camera.turn };
  }
  const foot = fit.sure.indexOf(true);
  if (foot < 0) return null;
  const slope = fit.measured[foot];
  // the flattest and the steepest foot a camera within the limit draws
  const flat = Math.sin(rad(ELEVATION - FIT.camera)) * Math.tan(rad(45 - FIT.camera)),
    steep = Math.sin(rad(ELEVATION + FIT.camera)) * Math.tan(rad(45 + FIT.camera));
  return { off: Math.abs(slope) < flat || Math.abs(slope) > steep, by: null, foot, slope };
}

/**
 * How a picture goes onto its footprint's canvas. A point (x, y) of the picture lands at
 * X = centre.x + scale * (x - cx), Y = centre.y + scale * (vertical * y + shear * x - cy):
 * `vertical` and `shear` turn the measured ground slopes into 0.5 and -0.5 and leave upright edges
 * upright; `scale` makes the foot as wide as the walls of the footprint; (cx, cy) is the middle of
 * the foot. Null when the picture is empty. With `rectify: false` the camera is left as the
 * generator drew it and only scale and place are set (for looking at what came back). With
 * `fully` the measured slopes are used however far they are from the game's: for a picture that
 * is shown to the generator as a reference, where the wall feet it will copy matter more than
 * the picture's proportions.
 */
export function fitPicture(png, fpId, rot, { rectify = true, fully = false } = {}) {
  const m = measureBase(png);
  if (!m) return null;
  const fp = FOOTPRINTS[fpId];
  const target = wallBase(fp, rot);
  const used = (slope) => (fully ? slope : clamp(slope, FIT.slope));
  const slopes = [
    rectify && m.sure[0] ? used(m.slopes[0]) : 0.5,
    rectify && m.sure[1] ? -used(-m.slopes[1]) : -0.5,
  ];
  const vertical = 1 / (slopes[0] - slopes[1]),
    shear = (-(slopes[0] + slopes[1]) * vertical) / 2;
  const up = (x, y) => vertical * y + shear * x;
  const scale = (target.e[0] - target.w[0]) / (m.e[0] - m.w[0]);
  const cx = (m.w[0] + m.e[0]) / 2,
    cy = (up(...m.w) + up(...m.e)) / 2;
  const place = (x, y) => [fp.centre[0] + scale * (x - cx), fp.centre[1] + scale * (up(x, y) - cy)];
  let topY = Infinity,
    lowY = -Infinity;
  for (let x = m.minX; x <= m.maxX; x++) {
    if (m.top[x] < 0) continue;
    topY = Math.min(topY, place(x, m.top[x])[1]);
    lowY = Math.max(lowY, place(x, m.low[x])[1]);
  }
  return {
    method: m.sure[0] && m.sure[1] ? 'base' : 'outline',
    sure: m.sure,
    measured: m.slopes.map((s) => round(s, 3)),
    slopes: slopes.map((s) => round(s, 3)),
    base: { w: m.w.map((v) => round(v)), s: m.s.map((v) => round(v)), e: m.e.map((v) => round(v)) },
    scale: round(scale, 4),
    vertical: round(vertical, 4),
    shear: round(shear, 4),
    cx: round(cx),
    cy: round(cy),
    box: {
      left: round(place(m.minX, 0)[0]),
      top: round(topY),
      right: round(place(m.maxX, 0)[0]),
      bottom: round(lowY),
    },
    camera: m.sure[0] && m.sure[1] ? cameraOf(m.slopes) : null,
    // picture pixels the building covers
    area: m.area,
  };
}

/** The same fit with the building `g` times as large, grown about the footprint's centre. */
function rescaled(fit, fp, g) {
  if (Math.abs(g - 1) < 1e-9) return fit;
  const about = (v, c) => round(c + (v - c) * g);
  return {
    ...fit,
    scale: round(fit.scale * g, 4),
    box: {
      left: about(fit.box.left, fp.centre[0]),
      top: about(fit.box.top, fp.centre[1]),
      right: about(fit.box.right, fp.centre[0]),
      bottom: about(fit.box.bottom, fp.centre[1]),
    },
  };
}

/**
 * The views of one building (index = rotation, null where a view is not made), brought to one
 * size.
 *
 * A generator fills its canvas rather than keeping a scale, so the same building comes back
 * larger in one view than in the next. Its wall base is no sure measure either: a silo that stands
 * beside the barn in one view and behind it in another makes the base wider there, and the barn
 * would be laid down smaller. What every view of a building shares is how much building there is
 * to see, the area it covers. So each view is fitted by its own base, and then the views are
 * scaled to cover the same area, their mean scale staying what the bases said. `size` then makes
 * the whole family larger or smaller on its tile (a depot stands a little larger than its
 * footprint, so that the rails fit its portals).
 */
export function fitGroup(pngs, fpId, { size = 1, rectify = true } = {}) {
  const fp = FOOTPRINTS[fpId];
  const fits = pngs.map((png, rot) => (png ? fitPicture(png, fpId, rot, { rectify }) : null));
  const made = fits.filter(Boolean);
  if (!made.length) return fits;
  const sizeOf = (f) => Math.sqrt(f.area * f.vertical) * f.scale;
  const mean = Math.exp(made.reduce((a, f) => a + Math.log(sizeOf(f)), 0) / made.length);
  return fits.map((f) => (f ? rescaled(f, fp, (mean / sizeOf(f)) * size) : null));
}

/** One sample of a picture between its pixels, colour weighted by coverage. */
function sample(src, x, y, acc) {
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  const fx = x - x0,
    fy = y - y0;
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < 2; i++) {
      const xx = x0 + i,
        yy = y0 + j;
      if (xx < 0 || yy < 0 || xx >= src.width || yy >= src.height) continue;
      const o = (yy * src.width + xx) * 4;
      const a = (src.data[o + 3] / 255) * (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
      acc[0] += src.data[o] * a;
      acc[1] += src.data[o + 1] * a;
      acc[2] += src.data[o + 2] * a;
      acc[3] += a;
    }
}

/**
 * The picture on its footprint's canvas, placed by `fit`. `shrink` divides the canvas, for review
 * sheets and for the game's atlas: every output pixel averages the picture's pixels under it.
 */
export function normalisePicture(png, fit, fpId, shrink = 1) {
  const fp = FOOTPRINTS[fpId];
  const W = Math.round(fp.canvas[0] / shrink),
    H = Math.round(fp.canvas[1] / shrink);
  const out = new PNG({ width: W, height: H });
  // samples per output pixel along each axis: about one per picture pixel
  const n = Math.max(1, Math.min(8, Math.ceil(shrink / fit.scale)));
  const acc = [0, 0, 0, 0];
  // only where the building is: the rest of the canvas stays empty
  const x0 = Math.max(0, Math.floor(fit.box.left / shrink) - 2),
    x1 = Math.min(W - 1, Math.ceil(fit.box.right / shrink) + 2),
    y0 = Math.max(0, Math.floor(fit.box.top / shrink) - 2),
    y1 = Math.min(H - 1, Math.ceil(fit.box.bottom / shrink) + 2);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      acc[0] = acc[1] = acc[2] = acc[3] = 0;
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          // the centre of the sample on the full canvas, then back into the picture
          const X = (x + (i + 0.5) / n) * shrink - 0.5,
            Y = (y + (j + 0.5) / n) * shrink - 0.5;
          const sx = (X - fp.centre[0]) / fit.scale + fit.cx;
          const sy = ((Y - fp.centre[1]) / fit.scale + fit.cy - fit.shear * sx) / fit.vertical;
          sample(png, sx, sy, acc);
        }
      if (acc[3] <= 0) continue;
      const o = (y * W + x) * 4;
      out.data[o] = Math.round(acc[0] / acc[3]);
      out.data[o + 1] = Math.round(acc[1] / acc[3]);
      out.data[o + 2] = Math.round(acc[2] / acc[3]);
      out.data[o + 3] = Math.round((255 * acc[3]) / (n * n));
    }
  return out;
}

function main(ids) {
  const inventory = loadInventory();
  if (!ids.length) {
    console.error('give picture ids, for example depot-a0-r0');
    return 1;
  }
  let bad = 0;
  for (const id of ids) {
    const m = /^(.+)-a(\d)-r(\d)$/.exec(id);
    const f = m && inventory.find((x) => x.family === m[1]);
    const file = f && pictureFile(f.family, Number(m[2]), Number(m[3]));
    if (!f || !existsSync(file)) {
      console.log(`${id}: no such picture`);
      bad++;
      continue;
    }
    const fit = fitPicture(PNG.sync.read(readFileSync(file)), f.footprint, Number(m[3]));
    console.log(`${id}: ${fit ? JSON.stringify(fit) : 'empty picture'}`);
  }
  return bad ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
