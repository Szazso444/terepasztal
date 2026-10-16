/** Where each building frame stands on the ground, measured from the frame's own pixels.
 *
 *   node tools/building-ground.mjs            write src/art/buildingGround.json, print the findings
 *   node tools/building-ground.mjs --all      ... and every finding, not the count of each
 *   node tools/building-ground.mjs --check    say whether the file is what the frames give now
 *   node tools/building-ground.mjs --sheets [dir]   draw what it measured over the frames
 *                                             (default scratchpad/building-ground)
 *
 * The game's building frames come from two places: the generators in `src/art` (every frame,
 * with placeholder turns `_r1` to `_r3`) and the illustrated pair `public/assets/structures.*`
 * (a partial atlas laid over them). This tool builds the atlas the game builds, takes the frames
 * that belong to a building and measures each one, so that Rendering can fit yards, door paths,
 * plinths and contact shadows to the picture instead of to a guess. It writes one file for the
 * `structures` group, `src/art/buildingGround.json`; `src/art/buildingGround.ts` reads it.
 *
 * Per frame, in world px from the frame's anchor (texels / `resolution`, before the renderer's
 * scale reference), and for the frame's rotation:
 *
 *   footprint  the tiles it covers, as [dx, dy] from the footprint's corner tile (the lowest x
 *              and y), as `doorsOf` in src/sim/doors.ts counts them. The anchor is the
 *              footprint's centre on the ground.
 *   foot       where its walls meet the ground: the corners n, e, s, w (far, right, near, left)
 *              of a parallelogram. Its sides run on the picture's own ground lines, which are
 *              the game's 2:1 or near it (a slope of 0.33 to 0.67), and it reaches as far along
 *              the base as the base goes, across the gaps between piers. The two walls the
 *              camera sees run w to s (the S wall) and s to e (the E wall). Walls whose near
 *              corner stands above the anchor have no foot (stilts, a roof): what they stand on
 *              is.
 *   fit        "walls" when the foot is a straight base found in the picture; "outline" when the
 *              picture has no such base (machinery, heaps, a trestle) and the foot is the
 *              silhouette's lowest stand, on the game's 2:1.
 *   baked      world px squared of opaque pixels below the foot: ground painted into the picture
 *              or what stands in front of the walls; 0 for a clean cut-out.
 *   front      the wall the building's front faces (S, W, N, E for r0 to r3), the two foot
 *              corners of that wall in tile order, and whether the camera sees it.
 *   doors      only the doors a picture shows: kind, tile and side from `doorsOf`, the `reach`
 *              tile, the door's foot `point` on its wall as measured, its `width`, and its
 *              `offset` from the middle of its tile's share of the wall, in tiles.
 *
 * A door on a wall the camera cannot see, or one the picture does not show, has no entry:
 * nothing is guessed. Nothing here changes a pixel, a size or an anchor.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';
import { isMain } from './is-main.mjs';
import { FIT } from './building-fit.mjs';
import { writeWhole } from './building-kit.mjs';

/** Where the data is written. */
export const GROUND_FILE = 'src/art/buildingGround.json';
/** The atlas group these frames belong to. */
export const GROUP = 'structures';

/** A texel at least this opaque belongs to the building (building-fit's FIT.alpha). */
export const SOLID = 128;
/** A foot corner lies within this many world px of an opaque texel, or the data is wrong. */
export const REACH = 1;

export const MEASURE = {
  /** a wall rises at least this far (world px) in one opaque run from its foot */
  run: 8,
  /** feet this far apart (world px) along the base still belong to one wall: a row of piers */
  gap: 20,
  /** a wall's base is followed this far (world px) off its line, which the picture may bend */
  follow: 2,
  /** a wall's base slopes between these (building-fit's FIT.slope); the game's ground is 0.5 */
  slope: FIT.slope,
  /** the slopes tried between them */
  slopeStep: 0.01,
  /** lowest opaque runs kept per column as candidate feet */
  candidates: 4,
  /** a column counts for as much as its run in world px, up to this */
  cap: 16,
  /** how far (world px) a foot may be from its ground line */
  tolerance: 1,
  /** a straight base shorter than this (world px) is no wall */
  wall: 12,
  /** and each of the two walls the camera sees is at least this long (world px) */
  side: 3,
  /** a foot is moved up or down by at most this (world px) to stand on the picture */
  settle: 6,
  /** its near corner is at most this far (world px) above the anchor, the footprint's centre */
  floor: 2,
  /** lines that fit the base nearly as well as the best are tried too, this many at most */
  alternatives: 12,
  /** pixels this far (world px) under the foot's lines are below the foot */
  below: 1.5,
  /** this much (world px squared) opaque below the foot is ground painted into the picture */
  baked: 40,
};

export const DOOR = {
  /** colour distance (RGB) from the wall's own colour at that height that an opening shows */
  distance: 48,
  /** an opening starts at most this far (world px) above the foot: a step, a plinth */
  start: 10,
  /** an opening is this tall (world px) */
  minHeight: 6,
  maxHeight: 20,
  /** and this wide (world px), a door being 1.5 to 7 times taller than wide */
  minWidth: 2,
  maxWidth: 18,
  aspect: [1.5, 7],
  /** columns this close (world px) to a wall's ends are corner, not door */
  edge: 2,
  /** the wall is read this far (world px) up from its foot */
  zone: 34,
  /** a door's opening is this close (world px) to the foot, steps and a foot found below the wall */
  touch: 10,
  /** an opening this close to the foot stands on the ground: a door where the data has none */
  ground: 3,
  /** the picture's door is the opening nearest the middle of its tile, within this many tiles */
  near: 0.3,
};

const round = (v, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits + 0;

/* ---------------------------------------------------------------- frames */

/** A frame: its key, size, anchor (texels), texels per world px, source and RGBA pixels. */
function frameOf(key, f, resolution, source, data) {
  return { key, w: f.w, h: f.h, ax: f.ax, ay: f.ay, resolution, source, data };
}

/**
 * The frames a generator makes, with their pixels. Node has no canvas: the generator is run with
 * stand-ins for `ImageData` and `document` whose context keeps what is put on it, and each frame
 * is read back from there. `generate` is `generateStructuresAtlas` from src/art/structures.ts.
 */
export function generatedFrames(generate) {
  class Pixels {
    constructor(a, b, c) {
      this.width = typeof a === 'number' ? a : b;
      this.height = typeof a === 'number' ? b : (c ?? a.length / 4 / b);
      this.data = typeof a === 'number' ? new Uint8ClampedArray(a * b * 4) : a;
    }
  }
  const puts = new Map();
  const context = new Proxy(
    {},
    {
      get: (_, name) =>
        name === 'putImageData' ? (img, x, y) => puts.set(`${x},${y}`, img) : () => undefined,
      set: () => true,
    },
  );
  const was = { ImageData: globalThis.ImageData, document: globalThis.document };
  globalThis.ImageData = Pixels;
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  };
  try {
    const atlas = generate();
    const out = new Map();
    for (const [key, f] of Object.entries(atlas.frames)) {
      const img = puts.get(`${f.x},${f.y}`);
      if (!img) throw new Error(`${key}: the generator put no pixels at ${f.x},${f.y}`);
      out.set(key, frameOf(key, f, atlas.resolution ?? 1, 'generated', img.data));
    }
    return out;
  } finally {
    for (const [name, value] of Object.entries(was))
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
  }
}

/** The frames of the shipped file pair of a group, or none when it has no pair. */
export function shippedFrames(group = GROUP, root = '.') {
  const json = join(root, 'public/assets', `${group}.json`);
  const png = join(root, 'public/assets', `${group}.png`);
  if (!existsSync(json) || !existsSync(png)) return { frames: new Map(), partial: true };
  const atlas = JSON.parse(readFileSync(json, 'utf8'));
  const sheet = PNG.sync.read(readFileSync(png));
  const frames = new Map();
  for (const [key, f] of Object.entries(atlas.frames)) {
    const out = new PNG({ width: f.w, height: f.h });
    PNG.bitblt(sheet, out, f.x, f.y, f.w, f.h, 0, 0);
    frames.set(key, frameOf(key, f, atlas.resolution ?? 1, 'illustrated', out.data));
  }
  return { frames, partial: atlas.partial === true };
}

/** The atlas the game builds for the group: the generator's frames, the file's laid over them. */
export function atlasFrames(generate, root = '.') {
  const shipped = shippedFrames(GROUP, root);
  const frames = shipped.partial ? generatedFrames(generate) : new Map();
  for (const [key, f] of shipped.frames) frames.set(key, f);
  return frames;
}

/* ---------------------------------------------------------------- which frame is which */

/** `structures/` frames that are not buildings: bridges, track overlays, signals, markers. */
const NOT_BUILDINGS =
  /^(bridge_|span_|landspan_|landpad_|supply_|semaphore_|signal|power_line$|warn$|alert$|note$)/;

/**
 * Every place def that has a picture, with the name its frames carry: a station by `art`, a works
 * and a decor by `id` (the way src/game.ts and src/sim/buildings.ts name them). Bridges, track
 * pieces and power parts have no frame of this kind (src/data/decor.json `onTrack`, `power`).
 */
export function placeDefs(root = '.') {
  const data = (file) => JSON.parse(readFileSync(join(root, 'src/data', file), 'utf8'));
  const out = [];
  const stations = data('stations.json').defs;
  for (const d of [...stations, ...data('stations_full.json')])
    out.push({ family: d.art, id: d.id, kind: d.depot ? 'depot' : 'station', def: d });
  for (const file of ['buildings.json', 'buildings_full.json'])
    for (const d of data(file))
      if (!d.bridge) out.push({ family: d.id, id: d.id, kind: 'works', def: d });
  for (const d of data('decor.json'))
    if (!d.onTrack && !d.power)
      out.push({ family: d.id, id: d.id, kind: d.residents ? 'house' : 'service', def: d });
  return out;
}

/**
 * What a frame is: its family, the rotation it shows and the place defs that use it, or null when
 * it is not a building frame. `names` is every frame key of the atlas. A frame ends in `_r<n>`,
 * 1 to 3, when it is a placeholder turn of the frame without it (`structureFrame`,
 * src/art/frames.ts); a depot's `_r<axis>` is the axis its gates run on, which is its rotation
 * until a turn says otherwise (`depot_r0_r2`, rotation 2).
 */
export function classify(key, names, places) {
  if (!key.startsWith('structures/')) return null;
  const name = key.slice('structures/'.length);
  if (NOT_BUILDINGS.test(name)) return null;
  let base = name;
  let rot = 0;
  const turn = /_r([1-3])$/.exec(name);
  if (turn && names.has(`structures/${name.slice(0, turn.index)}`)) {
    base = name.slice(0, turn.index);
    rot = Number(turn[1]);
  }
  const axis = /^(depot|depot_narrow)_r([01])(?:_lv\d+)?$/.exec(base);
  const family = axis ? axis[1] : base.replace(/(_lv\d+|_s\d+|_\d+)$/, '');
  if (axis && !rot) rot = Number(axis[2]);
  const defs = places.filter((p) => p.family === family);
  if (!defs.length)
    throw new Error(
      `${key} is neither a building frame of a def in src/data nor on the list of frames that are not buildings (NOT_BUILDINGS in tools/building-ground.mjs)`,
    );
  return { family, rot, defs };
}

/* ---------------------------------------------------------------- the foot */

/**
 * How far (texels) the point (x, y) is from the nearest opaque texel, a texel being the square
 * [i, i + 1] x [j, j + 1]; Infinity when none is within `limit` texels.
 */
export function solidGap(frame, x, y, limit = (REACH + 1) * frame.resolution) {
  const { w, h, data } = frame;
  const reach = Math.ceil(limit);
  let best = Infinity;
  for (let j = Math.floor(y) - reach; j <= Math.floor(y) + reach; j++)
    for (let i = Math.floor(x) - reach; i <= Math.floor(x) + reach; i++) {
      if (i < 0 || j < 0 || i >= w || j >= h || data[(j * w + i) * 4 + 3] < SOLID) continue;
      best = Math.min(
        best,
        Math.hypot(Math.max(i - x, 0, x - (i + 1)), Math.max(j - y, 0, y - (j + 1))),
      );
    }
  return best <= limit ? best : Infinity;
}

/**
 * Per column, the bottoms of the lowest opaque runs that rise `MEASURE.run` world px: where a
 * wall might stand on the ground there. A thinner run lower down is paint on the ground, a bench
 * or a post; the runs above it are kept too, so that a wall behind a pond is still a candidate.
 */
function footCandidates(frame) {
  const { w, h, data, resolution: d } = frame;
  const need = Math.ceil(MEASURE.run * d);
  const out = [];
  for (let x = 0; x < w; x++) {
    const list = [];
    let y = h - 1;
    while (y >= 0 && list.length < MEASURE.candidates) {
      while (y >= 0 && data[(y * w + x) * 4 + 3] < SOLID) y--;
      if (y < 0) break;
      const bottom = y;
      while (y >= 0 && data[(y * w + x) * 4 + 3] >= SOLID) y--;
      if (bottom - y >= need) list.push({ y: bottom + 1, run: bottom - y });
    }
    out.push(list);
  }
  return out;
}

/**
 * The base that a start (the near corner `xs`, `ys` of the best stretch of base, texels) belongs
 * to, followed outward along each wall for as long as it goes on. A picture's ground lines are not
 * always the game's 2:1 (an image generator is a little off): once the game's own slope has put
 * the near corner where the base is, each wall's line pivots on it to the slope in `MEASURE.slope`
 * whose line has most of the wall's columns close to it, the game's 0.5 unless another is clearly
 * better, and is moved to where those columns stand. The near corner is where the two lines meet,
 * and the walls are followed again from there. A gap of more than `MEASURE.gap` world px ends a
 * wall. Texels; null when the base is shorter than `MEASURE.wall` world px, or either wall
 * shorter than `MEASURE.side`.
 */
function followBase(cand, x0, x1, start, d) {
  const band = Math.max(1, Math.round(MEASURE.follow * d)) + 0.5;
  const reach = MEASURE.gap * d;
  /**
   * The columns outward from the near corner `at` that stand on the line of slope `a` through it,
   * moved `down` texels: the nearest candidate of each, `dy` its distance below the line through
   * the corner itself.
   */
  const collect = (at, side, a, down = 0) => {
    const slope = side < 0 ? a : -a;
    const pts = [];
    // the columns left of the corner, or right of it: one whose middle is on it is neither's
    const from = side < 0 ? Math.ceil(at[0] - 0.5) - 1 : Math.floor(at[0] - 0.5) + 1;
    let last = from - side;
    for (let x = from; x >= x0 && x <= x1; x += side) {
      if (Math.abs(x - last) > reach) break;
      const y = at[1] + slope * (x + 0.5 - at[0]);
      let near = null;
      for (const c of cand[x]) {
        const off = Math.abs(c.y - y - down);
        if (off <= band && (!near || off < near.off))
          near = { off, x, y: c.y, dy: c.y - y, run: c.run };
      }
      if (near) {
        pts.push(near);
        last = x;
      }
    }
    return pts;
  };
  const weight = (pts) => pts.reduce((sum, p) => sum + Math.min(p.run, MEASURE.cap * d), 0);
  /** the same, a column counting the less the further it lies from the line */
  const closeness = (pts) =>
    pts.reduce((sum, p) => sum + Math.min(p.run, MEASURE.cap * d) * (1 - (p.off / band) ** 2), 0);
  /** a slope's columns, the line moved once to where the columns near it stand */
  const along = (at, side, a) => {
    const first = collect(at, side, a);
    if (!first.length) return { a, pts: first, close: 0 };
    const pts = collect(at, side, a, first.reduce((sum, p) => sum + p.dy, 0) / first.length);
    return { a, pts, close: closeness(pts) };
  };
  /** the slope with the most columns close to its line: the game's own unless another is clearly better */
  const bestSlope = (at, side, free) => {
    let best = along(at, side, 0.5);
    const steps = free ? Math.round(0.5 / MEASURE.slopeStep) : 0;
    for (let k = 1; k <= steps; k++)
      for (const a of [0.5 - k * MEASURE.slopeStep, 0.5 + k * MEASURE.slopeStep]) {
        if (a < MEASURE.slope[0] || a > MEASURE.slope[1]) continue;
        const found = along(at, side, a);
        if (found.close > best.close + 0.5 * MEASURE.cap * d) best = found;
      }
    return best;
  };
  let at = [start.xs, start.ys];
  let left = [],
    right = [];
  let slopes = [0.5, 0.5];
  // first with the game's slope, to put the near corner where the base is; then the slopes are free
  for (let round = 0; round < 3; round++) {
    const free = round > 0;
    const l = bestSlope(at, -1, free);
    const r = bestSlope(at, 1, free);
    left = l.pts;
    right = r.pts;
    if (left.length < 4 || right.length < 4) {
      if (free) break;
      continue;
    }
    slopes = [l.a, r.a];
    // each line moved to where its columns stand, and the near corner to where the lines meet
    const shift = (pts) => pts.reduce((sum, p) => sum + p.dy, 0) / pts.length;
    const lb = at[1] + shift(left) - l.a * at[0];
    const rb = at[1] + shift(right) + r.a * at[0];
    const meet = (rb - lb) / (l.a + r.a);
    if (!Number.isFinite(meet) || meet <= x0 || meet >= x1 + 1) break;
    at = [meet, lb + l.a * meet];
  }
  const xl = left.length ? left[left.length - 1].x : at[0];
  const xr = right.length ? right[right.length - 1].x + 1 : at[0];
  if (xr - xl < MEASURE.wall * d || at[0] - xl < MEASURE.side * d || xr - at[0] < MEASURE.side * d)
    return null;
  // how far the columns lie from the lines the foot is drawn on, texels each: of fits that cover
  // as much, the one that sits closer on its base is the better placed
  const miss = (pts, slope) =>
    pts.reduce((sum, p) => sum + Math.abs(p.y - (at[1] + slope * (p.x + 0.5 - at[0]))), 0);
  const error = (miss(left, slopes[0]) + miss(right, -slopes[1])) / (left.length + right.length);
  return { s: at, slopes, xl, xr, score: weight(left) + weight(right), error };
}

/**
 * The fits of a building's foot in its picture, the one that covers most of the base first. The
 * base of a wall is a line going up and away from the near corner on each side, near the game's
 * slope of 1/2: the places to look are the near corners (xs, ys) whose two such lines have most
 * wall columns on them, a column counting for the height of its run, and each is followed along
 * its base (`followBase`) as far as the base goes. Where no such base is long enough, the
 * silhouette's lowest stand is added (`fit` "outline"): the lowest tight pair of lines over the
 * tall columns. Nothing here depends on which way round the picture is drawn. In texels; an empty
 * list for an empty frame.
 */
export function footFits(frame) {
  const d = frame.resolution;
  const cand = footCandidates(frame);
  let x0 = Infinity,
    x1 = -1;
  cand.forEach((list, x) => {
    if (list.length) {
      x0 = Math.min(x0, x);
      x1 = x;
    }
  });
  if (x1 < 0) return [];
  const tol = Math.max(1, Math.round(MEASURE.tolerance * d));
  const lift = (c, x, xs) => c.y + 0.5 * Math.abs(x + 0.5 - xs);

  // for each near corner column the lines with most columns on them
  const span = frame.h + frame.w + 8;
  const bins = new Float64Array(span * 2);
  const last = new Int32Array(span * 2);
  const perColumn = [];
  for (let xs = x0; xs <= x1 + 1; xs++) {
    bins.fill(0);
    last.fill(-1);
    for (let x = x0; x <= x1; x++)
      for (const c of cand[x]) {
        const v = Math.round(lift(c, x, xs)) + span;
        const weight = Math.min(c.run, MEASURE.cap * d);
        for (let b = v - tol; b <= v + tol; b++)
          if (last[b] !== x) {
            last[b] = x;
            bins[b] += weight;
          }
      }
    let best = null;
    for (let b = 0; b < bins.length; b++)
      if (!best || bins[b] > best.score || (bins[b] === best.score && b - span > best.ys))
        best = { score: bins[b], xs, ys: b - span };
    perColumn.push(best);
  }
  // the best few, one for each place along the base: a base made of several volumes has several.
  // Taken by score, a score at a time, so that equal scores neither shadow each other nor depend
  // on which end of the picture is looked at first: neighbours of one score are one place.
  const picks = [];
  const levels = [...new Set(perColumn.map((p) => p.score))].sort((p, q) => q - p);
  for (const score of levels) {
    if (picks.length >= MEASURE.alternatives || score < levels[0] * 0.5) break;
    const free = perColumn.filter(
      (p) =>
        p.score === score &&
        picks.every((q) => Math.abs(q.xs - p.xs) > 4 * d || Math.abs(q.ys - p.ys) > 2 * tol),
    );
    for (let i = 0; i < free.length;) {
      let j = i;
      while (j + 1 < free.length && free[j + 1].xs === free[j].xs + 1) j++;
      const run = free.slice(i, j + 1);
      picks.push({
        score,
        xs: (run[0].xs + run[run.length - 1].xs) / 2,
        ys: run.reduce((sum, p) => sum + p.ys, 0) / run.length,
      });
      i = j + 1;
    }
  }
  const fits = [];
  for (const best of picks) {
    const walls = followBase(cand, x0, x1, best, d);
    if (walls) fits.push({ fit: 'walls', ...walls });
  }
  // the fit that covers most of the base first; of equals the one that sits closest on it, then the
  // lower one, which stands nearer the camera, then the one nearer the middle of the picture, and
  // only then the left one. Nothing before the last depends on which way round the picture is
  // drawn, so that a picture and its mirror image give mirror images of one foot, even where two
  // volumes look alike.
  const settled = (f) => Math.round(f.error * 1e6);
  const middle = (f) => Math.abs((f.xl + f.xr) / 2 - frame.w / 2);
  fits.sort(
    (a, b) =>
      b.score - a.score ||
      settled(a) - settled(b) ||
      b.s[1] - a.s[1] ||
      middle(a) - middle(b) ||
      a.xl - b.xl,
  );
  const kept = fits.filter(
    (f, i) =>
      !fits
        .slice(0, i)
        .some(
          (g) =>
            Math.abs(g.xl - f.xl) <= d &&
            Math.abs(g.xr - f.xr) <= d &&
            Math.abs(g.s[1] - f.s[1]) <= d,
        ),
  );
  fits.length = 0;
  fits.push(...kept);
  // where there is no straight base: the tight pair of lines over the tall columns
  const tall = [];
  for (let x = x0; x <= x1; x++) {
    const c = cand[x].find((k) => k.run >= 12 * d);
    if (c) tall.push({ x, y: c.y });
  }
  if (tall.length < 3) return fits;
  // the lowest stand: where the lines are lowest, the middle of a stretch of equally low ones
  let tight = null;
  for (let xs = tall[0].x; xs <= tall[tall.length - 1].x + 1; xs++) {
    const v = tall.map((t) => t.y + 0.5 * Math.abs(t.x + 0.5 - xs)).sort((p, q) => p - q);
    const ys = v[Math.floor(v.length * 0.95)];
    if (!tight || ys < tight.ys) tight = { from: xs, to: xs, ys };
    else if (ys === tight.ys) tight.to = xs;
  }
  tight.xs = (tight.from + tight.to) / 2;
  const trim = Math.floor(tall.length * 0.03);
  fits.push({
    fit: 'outline',
    s: [tight.xs, tight.ys],
    xl: tall[trim].x,
    xr: tall[tall.length - 1 - trim].x + 1,
  });
  return fits;
}

/**
 * The foot of a building in its picture, in texels: the best of `footFits` that stands on the
 * picture (`settle`) with the least change, the highest scoring one among those that need
 * hardly any. Null when none does.
 */
export function measureFoot(frame) {
  const d = frame.resolution;
  const fits = footFits(frame);
  // a straight base first, the silhouette only where none stands on the picture
  for (const kind of ['walls', 'outline']) {
    let best = null;
    for (const fit of fits.filter((f) => f.fit === kind)) {
      const settled = settle(frame, fit);
      if (!settled) continue;
      const moved = Math.abs(settled.dy);
      if (moved <= d) return { fit: kind, ...settled };
      if (!best || moved < best.moved) best = { moved, foot: { fit: kind, ...settled } };
    }
    if (best) return best.foot;
  }
  return null;
}

/**
 * The foot's corners for a fit: its near corner `s`, the slopes of its two walls and its outer
 * corners at columns `xl` and `xr`, the whole drawn up or down by at most `MEASURE.settle` world
 * px, and an outer corner in along its line, until every corner stands on the picture, within
 * `REACH` of an opaque texel: the foot is a measure of the base, and a corner off the picture is a
 * measure that missed it. The smallest change wins; null when no change brings the foot onto the
 * picture.
 */
function settle(frame, { s, xl, xr, slopes = [0.5, 0.5] }) {
  const d = frame.resolution;
  const [left, right] = slopes;
  const on = (p) => solidGap(frame, p[0], p[1]) <= REACH * d * 0.9;
  // the anchor is the footprint's centre on the ground: walls whose near corner stands above it
  // are on stilts or a roof, not on the ground, and drawing them down would be no measure
  if (s[1] < frame.ay - MEASURE.floor * d) return null;
  const steps = [0];
  for (let i = 1; i <= MEASURE.settle * d; i++) steps.push(-i, i);
  for (const dy of steps) {
    const near = [s[0], s[1] + dy];
    if (!on(near)) continue;
    let w = [xl, near[1] - left * (s[0] - xl)];
    let e = [xr, near[1] - right * (xr - s[0])];
    while (!on(w) && w[0] < near[0] - 1) w = [w[0] + 1, w[1] + left];
    while (!on(e) && e[0] > near[0] + 1) e = [e[0] - 1, e[1] + right];
    const far = [w[0] + e[0] - near[0], w[1] + e[1] - near[1]];
    // both walls the camera sees have some length
    const long = near[0] - w[0] >= 2 * d && e[0] - near[0] >= 2 * d;
    if (long && on(w) && on(e) && on(far)) return { s: near, w, e, n: far, dy };
  }
  return null;
}

/**
 * How much of the picture lies below the foot, in world px squared of opaque texels, between its
 * outer corners: ground painted into the picture (a yard, a pond, a field) and what stands in
 * front of the walls. A clean cut-out has none.
 */
export function belowFoot(frame, foot) {
  const { w, h, data, resolution: d } = frame;
  let count = 0;
  // each wall's own slope: the picture's ground lines are near the game's 2:1, not always on it
  const left = (foot.s[1] - foot.w[1]) / (foot.s[0] - foot.w[0]);
  const right = (foot.s[1] - foot.e[1]) / (foot.e[0] - foot.s[0]);
  for (let x = Math.max(0, Math.floor(foot.w[0])); x < Math.min(w, Math.ceil(foot.e[0])); x++) {
    const line =
      x + 0.5 < foot.s[0]
        ? foot.w[1] + (x + 0.5 - foot.w[0]) * left
        : foot.s[1] - (x + 0.5 - foot.s[0]) * right;
    for (let y = Math.max(0, Math.floor(line + MEASURE.below * d)); y < h; y++)
      if (data[(y * w + x) * 4 + 3] >= SOLID) count++;
  }
  return count / (d * d);
}

/* ---------------------------------------------------------------- the doors */

const median = (a) => a.slice().sort((p, q) => p - q)[Math.floor(a.length / 2)];

/**
 * The openings on one visible wall, from `a` to `b` (its foot corners in texels, `a` the left
 * one): columns where the wall differs from its own colour at that height by `DOOR.distance`, in
 * a run that starts near the foot and is as tall as a door, side by side for as wide as one.
 * The wall's colour at each height is the median of the wall, so that a plinth or a band of
 * brick is not a door. Each has its columns `from` to `to` and the rows `lo` to `hi` above the
 * foot (texels).
 */
export function openingsOnWall(frame, a, b) {
  const { w, h, data, resolution: d } = frame;
  const x0 = Math.ceil(a[0] + DOOR.edge * d),
    x1 = Math.floor(b[0] - DOOR.edge * d);
  if (x1 - x0 < 4 * d) return [];
  const slope = (b[1] - a[1]) / (b[0] - a[0]);
  const baseY = (x) => a[1] + (x + 0.5 - a[0]) * slope - 1;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] >= SOLID;
  const rows = Math.ceil(DOOR.zone * d);
  const colour = (x, y) => {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const ref = [];
  for (let k = 0; k < rows; k++) {
    const c = [[], [], []];
    for (let x = x0; x <= x1; x++) {
      const y = Math.round(baseY(x) - k);
      if (!solid(x, y)) continue;
      colour(x, y).forEach((v, i) => c[i].push(v));
    }
    ref.push(c[0].length >= 8 ? c.map(median) : null);
  }
  const runs = [];
  for (let x = x0; x <= x1; x++) {
    const hit = [];
    for (let k = 0; k < rows; k++) {
      const y = Math.round(baseY(x) - k);
      const r = ref[k];
      if (!r || !solid(x, y)) {
        hit.push(0);
        continue;
      }
      const c = colour(x, y);
      hit.push(Math.hypot(c[0] - r[0], c[1] - r[1], c[2] - r[2]) > DOOR.distance ? 1 : 0);
    }
    // the lowest run that starts near the foot (one clear row inside it is bridged)
    let found = null;
    for (let k = 0; k <= DOOR.start * d && !found; k++) {
      if (!hit[k]) continue;
      let e = k;
      while (e + 1 < rows && (hit[e + 1] || (e + 2 < rows && hit[e + 2]))) e++;
      const height = (e - k + 1) / d;
      if (height >= DOOR.minHeight && height <= DOOR.maxHeight) found = { lo: k, hi: e };
      k = e;
    }
    runs.push(found);
  }
  const out = [];
  let from = -1;
  for (let i = 0; i <= runs.length; i++) {
    if (i < runs.length && runs[i]) {
      if (from < 0) from = i;
    } else if (from >= 0) {
      const width = (i - from) / d;
      const here = runs.slice(from, i);
      const lo = Math.min(...here.map((r) => r.lo)),
        hi = Math.max(...here.map((r) => r.hi));
      const aspect = (hi - lo + 1) / d / width;
      if (
        width >= DOOR.minWidth &&
        width <= DOOR.maxWidth &&
        aspect >= DOOR.aspect[0] &&
        aspect <= DOOR.aspect[1]
      )
        out.push({ from: x0 + from, to: x0 + i, lo, hi, baseY });
      from = -1;
    }
  }
  return out;
}

/* ---------------------------------------------------------------- one frame */

/** The wall a building's front faces at rotation 0 to 3 (src/sim/rotation.ts). */
const SIDES = ['S', 'W', 'N', 'E'];
/** The sides of `Dir` in src/engine/iso.ts, by value: N 0, E 1, S 2, W 3. */
const DIR_NAMES = ['N', 'E', 'S', 'W'];

/**
 * The ground data of one frame: `frame` its pixels, `info` what `classify` says it is, `doorsOf`
 * and `placeSpan` from src/sim/doors.ts. Returns the entry and what was found wrong or missing
 * (`notes`), which the findings list.
 */
export function measureFrame(frame, info, { doorsOf, placeSpan }) {
  const notes = [];
  const d = frame.resolution;
  const world = (p) => [round((p[0] - frame.ax) / d), round((p[1] - frame.ay) / d)];
  const { rot, defs } = info;

  const spans = defs.map((p) => placeSpan(p.def));
  if (spans.some((s) => s.w !== spans[0].w || s.h !== spans[0].h))
    throw new Error(`${frame.key}: the defs that share it differ in footprint`);
  const turned = rot % 2 === 1;
  const W = turned ? spans[0].h : spans[0].w;
  const H = turned ? spans[0].w : spans[0].h;
  const footprint = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) footprint.push([x, y]);

  const doors = defs.map((p) => doorsOf(p.def, 0, 0, rot));
  const same = doors.every((list) => JSON.stringify(list) === JSON.stringify(doors[0]));
  if (!same) throw new Error(`${frame.key}: the defs that share it differ in their doors`);

  const foot = measureFoot(frame);
  if (!foot)
    return { entry: null, notes: ['no foot: the frame has no wall that stands on the ground'] };
  if (foot.fit === 'outline') notes.push('foot: no straight base, the silhouette stands in for it');
  // counted under the foot as it is written, to two decimals, so that the file says what it counts
  const written = Object.fromEntries(
    ['n', 'e', 's', 'w'].map((c) => {
      const [x, y] = world(foot[c]);
      return [c, [x * d + frame.ax, y * d + frame.ay]];
    }),
  );
  const baked = Math.round(belowFoot(frame, written));
  if (baked >= MEASURE.baked)
    notes.push(`baked ground: ${baked} world px² opaque below the foot (a yard, a pond, props)`);

  // the corners in tile order: n (0,0), e (W,0), s (W,H), w (0,H)
  const corners = { n: foot.n, e: foot.e, s: foot.s, w: foot.w };
  const front = SIDES[rot];
  const edges = { S: ['w', 's'], E: ['e', 's'], N: ['n', 'e'], W: ['n', 'w'] };
  const visible = front === 'S' || front === 'E';

  // visible walls: S runs w to s along x, E runs e to s along y
  const walls = {
    S: { a: foot.w, b: foot.s, count: W, from: (x) => x, tileOf: (t) => t.x },
    E: { a: foot.s, b: foot.e, count: H, from: (x) => 1 - x, tileOf: (t) => t.y },
  };
  const found = [];
  const openings = {};
  for (const [side, wall] of Object.entries(walls))
    openings[side] = openingsOnWall(frame, wall.a, wall.b).filter((o) => o.lo <= DOOR.touch * d);
  const taken = new Set();
  for (const door of doors[0]) {
    const name = DIR_NAMES[door.side];
    const wall = walls[name];
    if (!wall) continue;
    const index = wall.tileOf(door.tile);
    const span = wall.b[0] - wall.a[0];
    // the opening nearest the middle of the door's tile, if it is near enough to be that door
    let pick = null;
    openings[name].forEach((o, i) => {
      const fraction = wall.from(((o.from + o.to) / 2 - wall.a[0]) / span);
      const away = Math.abs((fraction - (index + 0.5) / wall.count) * wall.count);
      if (away > DOOR.near || taken.has(`${name}${i}`)) return;
      if (!pick || away < pick.away) pick = { o, i, fraction, away };
    });
    const label = `${door.kind} door at tile ${door.tile.x},${door.tile.y} on ${name}`;
    if (!pick) {
      notes.push(`${label}: not seen`);
      continue;
    }
    taken.add(`${name}${pick.i}`);
    const x = (pick.o.from + pick.o.to) / 2;
    const offset = round((pick.fraction - (index + 0.5) / wall.count) * wall.count);
    found.push({
      kind: door.kind,
      tile: [door.tile.x, door.tile.y],
      side: name,
      reach: [door.reach.x, door.reach.y],
      point: world([x, pick.o.baseY(x) + 1 - pick.o.lo]),
      width: round((pick.o.to - pick.o.from) / d, 1),
      offset,
    });
    if (Math.abs(offset) > 0.05)
      notes.push(
        `${label}: the picture's door is ${offset > 0 ? '+' : ''}${offset} tile off the middle`,
      );
  }
  // a door-shaped opening that stands on the ground where the data has no door
  for (const [side, list] of Object.entries(openings))
    list.forEach((o, i) => {
      if (taken.has(`${side}${i}`) || o.lo > DOOR.ground * d) return;
      notes.push(
        `door-shaped opening on ${side} the data has no door for, at x ${round((o.from - frame.ax) / d, 1)}`,
      );
    });
  const entry = {
    source: frame.source,
    rot,
    footprint,
    foot: ['n', 'e', 's', 'w'].map((c) => world(corners[c])),
    fit: foot.fit,
    baked,
    front: {
      side: front,
      edge: edges[front].map((c) => world(corners[c])),
      visible,
    },
    doors: found,
  };
  return { entry, notes };
}

/* ---------------------------------------------------------------- the file */

/**
 * The ground data of every building frame in `frames` (the atlas, `atlasFrames`), and the
 * findings that go with it: per frame, what the picture does not give. `mods` are the game's own
 * code the tool must not copy: `doorsOf` and `placeSpan` (src/sim/doors.ts).
 */
export function buildGround(frames, places, mods) {
  const names = new Set(frames.keys());
  const out = {};
  const findings = {};
  for (const key of [...frames.keys()].sort()) {
    const info = classify(key, names, places);
    if (!info) continue;
    const { entry, notes } = measureFrame(frames.get(key), info, mods);
    if (entry) out[key] = entry;
    if (notes.length) findings[key] = notes;
  }
  return { data: { version: 1, frames: out }, findings };
}

/** The file's text: prettier's own formatting of the data, so that `format:check` leaves it be. */
export async function serialise(data, root = '.') {
  const { format, resolveConfig } = await import('prettier');
  const file = join(root, GROUND_FILE);
  const options = (await resolveConfig(file)) ?? {};
  return format(JSON.stringify(data), { ...options, parser: 'json' });
}

/** The game's own code the tool reads, through a Vite server so that it need not be compiled. */
async function gameModules(root) {
  const { createServer } = await import('vite');
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const structures = await server.ssrLoadModule('/src/art/structures.ts');
    const doors = await server.ssrLoadModule('/src/sim/doors.ts');
    return {
      generate: structures.generateStructuresAtlas,
      doorsOf: doors.doorsOf,
      placeSpan: doors.placeSpan,
      close: () => server.close(),
    };
  } catch (e) {
    await server.close();
    throw e;
  }
}

/** The findings as text: counts per kind of finding, then each frame with what is wrong. */
export function describe(findings, total) {
  const lines = [];
  const kinds = new Map();
  for (const [key, notes] of Object.entries(findings))
    for (const note of notes) {
      const kind = note
        .replace(/at tile \d+,\d+ /, '')
        .replace(/at x -?[\d.]+/, '')
        .replace(/is [-+]?[\d.]+ tile off/, 'is N tile off')
        .replace(/baked ground: \d+/, 'baked ground: N');
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      lines.push(`${key}: ${note}`);
    }
  const head = [`${total} building frames, ${Object.keys(findings).length} with findings`];
  for (const [kind, n] of [...kinds].sort((a, b) => b[1] - a[1]))
    head.push(`${String(n).padStart(5)}  ${kind}`);
  return [...head, '', ...lines].join('\n');
}

/* ---------------------------------------------------------------- sheets */

/** How the frames of each source are drawn on a sheet: texels to pixels, columns, frames a page. */
const SHEETS = {
  illustrated: { scale: 0.5, cols: 10, per: 40 },
  generated: { scale: 3, cols: 12, per: 60 },
};
const PAPER = [118, 134, 104];
const INK = {
  wall: [255, 0, 255],
  hidden: [0, 230, 230],
  front: [255, 140, 0],
  door: [0, 255, 0],
  anchor: [255, 0, 0],
};

/**
 * A page of frames with what was measured drawn over each: the foot (the two walls the camera sees
 * in magenta, the two it does not in cyan), the front wall in orange, each door's point and a
 * door's height of green above it, and the anchor in red. `keys` are the frames, `data` the file.
 */
export function sheetOf(frames, data, keys, { scale, cols }) {
  const size = (f) => [Math.ceil(f.w * scale), Math.ceil(f.h * scale)];
  const cell = [
    Math.max(...keys.map((k) => size(frames.get(k))[0])) + 6,
    Math.max(...keys.map((k) => size(frames.get(k))[1])) + 6,
  ];
  const sheet = new PNG({
    width: cols * cell[0],
    height: Math.ceil(keys.length / cols) * cell[1],
  });
  for (let i = 0; i < sheet.width * sheet.height; i++) sheet.data.set([...PAPER, 255], i * 4);
  const put = (x, y, rgb) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < sheet.width && y < sheet.height)
      sheet.data.set([...rgb, 255], (y * sheet.width + x) * 4);
  };
  const line = (a, b, rgb) => {
    const n = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))) + 1;
    for (let i = 0; i <= n; i++)
      put(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, rgb);
  };
  keys.forEach((key, i) => {
    const f = frames.get(key);
    const e = data[key];
    const d = f.resolution;
    const [w, h] = size(f);
    // the frame stands on the bottom of its cell
    const ox = (i % cols) * cell[0] + 3;
    const oy = Math.floor(i / cols) * cell[1] + cell[1] - 3 - h;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const s =
          (Math.min(f.h - 1, Math.floor(y / scale)) * f.w +
            Math.min(f.w - 1, Math.floor(x / scale))) *
          4;
        const a = f.data[s + 3] / 255;
        const o = ((oy + y) * sheet.width + ox + x) * 4;
        for (let c = 0; c < 3; c++)
          sheet.data[o + c] = Math.round(f.data[s + c] * a + sheet.data[o + c] * (1 - a));
      }
    const at = (p) => [ox + (f.ax + p[0] * d) * scale, oy + (f.ay + p[1] * d) * scale];
    const [n, ee, s, ww] = e.foot.map(at);
    line(n, ee, INK.hidden);
    line(n, ww, INK.hidden);
    line(ww, s, INK.wall);
    line(s, ee, INK.wall);
    line(...e.front.edge.map(at), INK.front);
    for (const door of e.doors) {
      const p = at(door.point);
      line(p, [p[0], p[1] - 9 * d * scale], INK.door);
    }
    const a = at([0, 0]);
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      put(a[0] + dx, a[1] + dy, INK.anchor);
  });
  return sheet;
}

/** Sheets of every frame in `data`, by source, a few dozen to a page, into `dir`. */
export function writeSheets(frames, data, dir) {
  mkdirSync(dir, { recursive: true });
  const files = [];
  for (const [source, look] of Object.entries(SHEETS)) {
    const keys = Object.keys(data).filter((k) => data[k].source === source);
    for (let page = 0; page * look.per < keys.length; page++) {
      const file = join(dir, `${source}-${page + 1}.png`);
      const sheet = sheetOf(frames, data, keys.slice(page * look.per, (page + 1) * look.per), look);
      writeWhole(file, PNG.sync.write(sheet));
      files.push(file);
    }
  }
  return files;
}

async function main(args) {
  const root = '.';
  const mods = await gameModules(root);
  try {
    const frames = atlasFrames(mods.generate, root);
    const { data, findings } = buildGround(frames, placeDefs(root), mods);
    const text = await serialise(data, root);
    const count = Object.keys(data.frames).length;
    if (args.includes('--sheets')) {
      const dir = args[args.indexOf('--sheets') + 1] ?? 'scratchpad/building-ground';
      const files = writeSheets(
        frames,
        data.frames,
        dir.startsWith('--') ? 'scratchpad/building-ground' : dir,
      );
      console.log(`${files.length} sheets in ${dirname(files[0])}`);
      return 0;
    }
    if (args.includes('--check')) {
      const now = existsSync(GROUND_FILE) ? readFileSync(GROUND_FILE, 'utf8') : '';
      if (now === text) {
        console.log(`${GROUND_FILE} is what the ${count} frames give`);
        return 0;
      }
      console.error(
        `${GROUND_FILE} is not what the frames give: run node tools/building-ground.mjs`,
      );
      return 1;
    }
    writeWhole(GROUND_FILE, text);
    console.log(`wrote ${GROUND_FILE}`);
    const report = describe(findings, count);
    console.log(args.includes('--all') ? report : report.split('\n').slice(0, 24).join('\n'));
    return 0;
  } finally {
    await mods.close();
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
