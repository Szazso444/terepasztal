/** Where each building's chimney pots are, and what the quarry crane lets hang, measured from the
 * frame's own pixels.
 *
 *   node tools/building-life.mjs            write src/art/buildingLife.json, print what it found
 *   node tools/building-life.mjs --check    say whether the file is what the frames give now
 *
 * Rendering draws smoke from the pots and swings the crane's load, and neither can be found out
 * at run time. The game's building frames come from the generators in `src/art` and the
 * illustrated pair `public/assets/structures.*` laid over them; this takes the atlas the game
 * builds (`atlasFrames`, tools/building-ground.mjs), and for the frames listed below measures:
 *
 *   pots    a chimney stack's pots, one point per stack: the highest top of its pots (y) and the
 *           middle of the pot tops that are in the stack (x). That is what the demo that asked for
 *           this measured (issue #492). `work` is a works chimney, which always smokes.
 *   cranes  where the rope leaves the pulley (`pivot`) and the rectangles that hold the rope, the
 *           hook, the slings and the crate: the part of the picture that hangs free of the rest.
 *   mills   where a windmill's sails turn: the hub and the plane, read from the painted body's
 *           and the guide's records, not from the frame's pixels (`windmillHub`).
 *
 * Everything is in world px from the frame's anchor ((texel - anchor) / `resolution`), before the
 * renderer's scale reference, like buildingGround.json. A rectangle is [x0, y0, x1, y1], its left
 * and top edges inclusive and its right and bottom edges not, so a rectangle covers the texels
 * whose corners it holds.
 *
 * Which stacks and which crane there are is judged by eye, once, in the tables below: a chimney
 * is not told from a roof vent or a cupola by its pixels. Where the exact point is, is not: the
 * tool snaps each table entry to the picture. A group marked `exact` was measured by the demo and
 * its numbers are the issue's own; `potAt` on the same seed gives them to within a world px, which
 * the test holds it to. Only frames that show a pot or a crane are here: a frame that does not
 * (every turn `_r1` to `_r3` of the town, the townhouse, the warehouse and the farm, whose
 * placeholders draw no chimney, and of the quarry, whose crane is a thin cable and a plate) has
 * no entry rather than a guessed one. Nothing here changes a pixel, a size or an anchor.
 */
import { existsSync, readFileSync } from 'node:fs';
import { isMain } from './is-main.mjs';
import { SOLID, atlasFrames, gameModules } from './building-ground.mjs';
import { writeWhole } from './building-kit.mjs';
import { MODELS, WINDMILL } from './illustrated-sprites.mjs';

/** Where the data is written. */
export const LIFE_FILE = 'src/art/buildingLife.json';

/** Rounds to 2 decimals, as buildingGround.json does, and never to -0. */
const round = (v) => Math.round(v * 100) / 100 + 0;

export const MEASURE = {
  /** a pot stands at least this tall (world px) in a run no wider than `width` */
  rise: 3,
  width: 8,
  /** a seed finds the pot tops within this many world px of it */
  reach: 3,
  /** the rope is no wider than this (world px) */
  rope: 1,
  /** the hook is where the load is wider than the rope by more than this (world px) */
  hook: 0.75,
  /** the hook and the crate are cut in bands of this many world px, each as wide as its rows */
  band: 2,
  /** the cut leaves this much (world px) round what hangs, for the picture's soft edge */
  margin: 0.5,
};

const names = (...list) => list.map((n) => `structures/${n}`);
/** A works' frames by level: the plain one, then `_lv2` up, or `_1` up for a station's `count`. */
const levels = (id, count = 0) =>
  count
    ? Array.from({ length: count }, (_, i) => `${id}_${i + 1}`)
    : [id, `${id}_lv2`, `${id}_lv3`, `${id}_lv4`];
/** The frames that show one picture of `assets/source/models`. */
const modelFrames = (id) => JSON.parse(readFileSync(`${MODELS}/models.json`, 'utf8'))[id].frames;

/**
 * The chimneys, by picture. `keys` are frames that share the seeds (the same picture, or the same
 * placement in a turn); `at` are texels in the picture, one per stack; `work` is a works chimney.
 * `exact` seeds are the demo's numbers, taken as they stand.
 */
export const POT_GROUPS = [
  // the 3D models' pictures (assets/source/models), every level the same picture:
  // town hall, a chimney on each gable, the cupola is no chimney
  {
    keys: names('town_1', 'town_2', 'town_3', 'town_4', 'town_5'),
    work: false,
    at: [
      [77.5, 1],
      [272, 98],
    ],
  },
  // townhouses
  {
    keys: names('townhouse', 'townhouse_2', 'townhouse_3', 'townhouse_4'),
    work: false,
    exact: true,
    at: [[175.5, 6]],
  },
  { keys: names('townhouse_s0'), work: false, exact: true, at: [[121.5, 4]] },
  { keys: names('townhouse_s1', 'townhouse_s2'), work: false, exact: true, at: [[142.4, 5]] },
  // stations: one stack, the clock gable is none; a turned placeholder has a stove pipe at the back
  {
    keys: names('station_1', 'station_2', 'station_3', 'station_4', 'station_5'),
    work: false,
    at: [[136.5, 1]],
  },
  { keys: names('station_2_r1', 'station_2_r3'), work: false, at: [[26.5, 1]] },
  { keys: names('station_2_r2'), work: false, at: [[19.5, 1]] },
  // warehouses: the two end stacks; the middle one is too broad to be told from the roof
  {
    keys: names('warehouse_1', 'warehouse_2', 'warehouse_3', 'warehouse_4', 'warehouse_5'),
    work: false,
    at: [
      [77.5, 1],
      [272.5, 85],
    ],
  },
  // sawmills: one works chimney, a brick stack from level 3 in the turns
  {
    keys: names('lumber_1', 'lumber_2', 'lumber_3', 'lumber_4', 'lumber_5'),
    work: true,
    at: [[133.5, 1]],
  },
  { keys: names('lumber_3_r1', 'lumber_3_r3'), work: true, at: [[32.5, 1]] },
  { keys: names('lumber_3_r2'), work: true, at: [[25.5, 1]] },
  {
    keys: names('lumber_4_r1', 'lumber_4_r3', 'lumber_5_r1', 'lumber_5_r3'),
    work: true,
    at: [[34, 2]],
  },
  { keys: names('lumber_4_r2', 'lumber_5_r2'), work: true, at: [[26, 2]] },
  // farms: the farmhouse chimney, not the silo
  { keys: names('farm_1', 'farm_2', 'farm_3', 'farm_4', 'farm_5'), work: false, at: [[155, 1]] },
  // pumping stations: one works chimney of twin pots
  { keys: names('pump_1'), work: true, exact: true, at: [[120.3, 6]] },
  { keys: names('pump_2'), work: true, at: [[136, 8]] },
  { keys: names('pump_3'), work: true, at: [[149.5, 9]] },
  { keys: names('pump_4', 'pump_5'), work: true, at: [[175, 11]] },
  { keys: names('pump_1_r1', 'pump_1_r3'), work: true, at: [[17.5, 1]] },
  { keys: names('pump_1_r2'), work: true, at: [[20.5, 1]] },
  { keys: names('pump_2_r1', 'pump_2_r3'), work: true, at: [[27.5, 1]] },
  { keys: names('pump_2_r2'), work: true, at: [[15.5, 1]] },
  { keys: names('pump_3_r1', 'pump_3_r3'), work: true, at: [[30, 1]] },
  { keys: names('pump_3_r2'), work: true, at: [[17, 1]] },
  { keys: names('pump_4_r1', 'pump_4_r3', 'pump_5_r1', 'pump_5_r3'), work: true, at: [[30.5, 2]] },
  { keys: names('pump_4_r2', 'pump_5_r2'), work: true, at: [[24.5, 2]] },
  // the works Codex painted (2026-10-29): every level one picture, one works chimney. A `stack` is
  // too broad for a spike: its seed is a texel inside it, near the top. The wire mill's stack has
  // a dome on it and the substation none, so neither smokes.
  { keys: names(...levels('quarry', 5)), work: true, at: [[156, 8]] },
  { keys: names(...levels('grinder')), work: true, at: [[174.5, 16]] },
  { keys: names(...levels('refinery')), work: true, at: [[410.5, 110]] },
  { keys: names(...levels('kiln')), work: true, stack: true, at: [[88, 15]] },
  { keys: names(...levels('power_plant')), work: true, stack: true, at: [[521, 27]] },
  { keys: names(...levels('ironworks')), work: true, stack: true, at: [[75, 15]] },
  { keys: names(...levels('diesel_refinery')), work: true, stack: true, at: [[182, 90]] },
  // the depot: the three stacks that rise out of its outline, in each of its four views; lit by
  // lot like a house's
  {
    keys: modelFrames('depot-r0'),
    work: false,
    at: [
      [206, 0],
      [77, 86],
      [401, 98],
    ],
  },
  {
    keys: modelFrames('depot-r1'),
    work: false,
    at: [
      [268, 1],
      [399, 43],
      [79, 79],
    ],
  },
  {
    keys: modelFrames('depot-r2'),
    work: false,
    at: [
      [215, 1],
      [86, 65],
      [406, 122],
    ],
  },
  {
    keys: modelFrames('depot-r3'),
    work: false,
    at: [
      [271, 2],
      [401, 67],
      [76, 99],
    ],
  },
];

/**
 * The quarry cranes, by picture: a texel inside the rope, the row where the rope leaves the pulley
 * (`top`), and `stop`, where something of the building touches the load: a broken line of texels,
 * drawn by eye, and what lies below it is the building's. Codex's painted quarry (2026-10-30) hangs
 * its crate in clear air, every level the same picture, but for the beam and its iron shoe that it
 * all but rests on.
 */
export const CRANE_GROUPS = [
  {
    keys: names('quarry_1', 'quarry_2', 'quarry_3', 'quarry_4', 'quarry_5'),
    rope: [23, 42],
    top: 34,
    stop: [
      [18, 114],
      [24, 110],
      [28, 107.8],
      [40, 101],
      [43, 100.5],
      [44.2, 98],
      [51, 95],
    ],
  },
];

/** The windmill's body frames: every level shows the one painted body. */
export const MILL_FRAMES = names('windmill', 'windmill_lv2', 'windmill_lv3', 'windmill_lv4');

/**
 * Where the sails sit on the windmill's body, which stands on the tile with the tower's foot
 * (`addWindmillFrames`, tools/illustrated-sprites.mjs): the hub in world px from the frame's
 * anchor, from the painted body's own record, and the plane the cross turns in from the guide's,
 * the matrix that lays its face-on picture into that plane. Only the view the game shows: its
 * buildings do not turn (#564).
 */
export function windmillHub() {
  const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
  const body = read(`${WINDMILL}/hub.json`);
  const { scale } = body.numbers;
  return {
    hub: [
      round((body.hub[0] - body.footCentre[0]) / scale),
      round((body.hub[1] - body.footCentre[1]) / scale),
    ],
    plane: read('assets/source/buildings-v2/guides/windmill-r0-hub.json').cross.affine,
  };
}

/* ---------------------------------------------------------------- reading a frame */

/** The texel's opacity, 0 outside the frame. */
const alpha = (f, x, y) =>
  x < 0 || y < 0 || x >= f.w || y >= f.h ? 0 : f.data[(y * f.w + x) * 4 + 3];

/** The run of texels at least `min` opaque in row `y` that holds column `x`, as [first, last]. */
function runAt(f, x, y, min) {
  if (alpha(f, x, y) < min) return null;
  let a = x;
  let b = x;
  while (alpha(f, a - 1, y) >= min) a--;
  while (alpha(f, b + 1, y) >= min) b++;
  return [a, b];
}

/**
 * The tops of everything narrow that rises out of the silhouette: a texel row whose run of solid
 * texels starts a shape (nothing solid above it) and stays at most `MEASURE.width` wide for
 * `MEASURE.rise` world px below it. Pots, but also vents, spires and the tips of a roof; which
 * of them is a chimney is for the tables above. [x, y] in texels: the run's middle, its top row.
 */
export function spikes(frame, { rise = MEASURE.rise, width = MEASURE.width } = {}) {
  const rows = Math.round(rise * frame.resolution);
  const wide = width * frame.resolution;
  const out = [];
  for (let y = 0; y < frame.h; y++) {
    for (let x = 0; x < frame.w; x++) {
      const run = runAt(frame, x, y, SOLID);
      if (!run) continue;
      const [a, b] = run;
      x = b;
      let covered = false;
      for (let i = a - 1; i <= b + 1; i++) if (alpha(frame, i, y - 1) >= SOLID) covered = true;
      if (covered) continue;
      const mid = (a + b) >> 1;
      let narrow = true;
      for (let d = 0; d < rows && narrow; d++) {
        const r = runAt(frame, mid, y + d, SOLID);
        narrow = r !== null && r[1] - r[0] + 1 <= wide;
      }
      if (narrow) out.push([(a + b + 1) / 2, y]);
    }
  }
  return out;
}

/** The stack near a seed: the highest pot top, and the middle of the tops near it. */
export function potAt(frame, seed) {
  const reach = MEASURE.reach * frame.resolution;
  const near = spikes(frame).filter(([x, y]) => Math.hypot(x - seed[0], y - seed[1]) <= reach);
  if (!near.length)
    throw new Error(`${frame.key}: no pot top within ${MEASURE.reach} px of ${seed}`);
  return [near.reduce((s, p) => s + p[0], 0) / near.length, Math.min(...near.map((p) => p[1]))];
}

/** A stack too broad for `spikes` from a texel inside it: the middle of its run at its top. */
export function stackAt(frame, seed) {
  const [x] = seed;
  let [, y] = seed;
  if (alpha(frame, x, y) < SOLID) throw new Error(`${frame.key}: ${seed} is not on a stack`);
  while (alpha(frame, x, y - 1) >= SOLID) y--;
  const [a, b] = runAt(frame, x, y + 1, SOLID);
  return [(a + b + 1) / 2, y];
}

/**
 * What hangs from a rope that holds the texel `rope`, in texels: the pivot, and the rectangles
 * of the load. The rope is followed up to where the pulley's wheel widens it and down through
 * the hook, the slings and the crate, row by row, each row's runs of visible texels that touch
 * the row above, until the crate narrows to the point it stands on the cart: there the cart's
 * rim begins and the load ends. The rope is a rectangle of its own; the hook and the crate are
 * another, so that the cut is no wider than the picture is.
 */
export function loadOf(frame, rope, pivot = null) {
  const res = frame.resolution;
  let top = rope[1];
  const ropeWide = Math.round(MEASURE.rope * res);
  const width = (y) => {
    const r = runAt(frame, rope[0], y, SOLID);
    return r ? r[1] - r[0] + 1 : Infinity;
  };
  if (width(top) > ropeWide) throw new Error(`${frame.key}: ${rope} is not on the rope`);
  while (width(top - 1) <= ropeWide) top--;
  const run = runAt(frame, rope[0], top, SOLID);
  const at = pivot ?? [(run[0] + run[1] + 1) / 2, top - 2];
  const first = top - 1;

  // row by row: the visible runs that touch the row above
  const rows = [];
  let prev = [runAt(frame, rope[0], first, 1)];
  for (let y = first; y < frame.h; y++) {
    const touch = [];
    if (y === first) touch.push(prev[0]);
    else
      for (let x = 0; x < frame.w; x++) {
        const r = runAt(frame, x, y, 1);
        if (!r) continue;
        x = r[1];
        if (prev.some(([a, b]) => r[0] <= b + 1 && r[1] >= a - 1)) touch.push(r);
      }
    if (!touch.length) break;
    prev = touch;
    rows.push({
      y,
      x0: Math.min(...touch.map((r) => r[0])),
      x1: Math.max(...touch.map((r) => r[1])),
    });
  }
  const w = (r) => r.x1 - r.x0 + 1;
  // the load ends at the first row that stops narrowing once it is under half the widest row
  // so far, the crate being by then many ropes wide: the next row is the cart's
  let end = rows.length - 1;
  let widest = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    widest = Math.max(widest, w(rows[i]));
    if (widest > 6 * ropeWide && w(rows[i]) < widest / 2 && w(rows[i + 1]) > w(rows[i])) {
      end = i;
      break;
    }
  }
  // what hangs, whole: the visible texels joined to the rope inside those rows, which takes in a
  // hook's tip that is joined to the rest from below
  const last = rows[end].y;
  const joined = new Set();
  const todo = [[rope[0], rope[1]]];
  while (todo.length) {
    const [x, y] = todo.pop();
    const id = y * frame.w + x;
    if (y < first || y > last || alpha(frame, x, y) < 1 || joined.has(id)) continue;
    joined.add(id);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) todo.push([x + dx, y + dy]);
  }
  const load = rows.slice(0, end + 1).map(({ y }) => {
    const xs = [];
    for (let x = 0; x < frame.w; x++) if (joined.has(y * frame.w + x)) xs.push(x);
    return { y, x0: xs[0], x1: xs.at(-1) };
  });

  // the rope's rows are as wide as the rope; the hook's are wider
  const base = load
    .slice(3, 9)
    .map(w)
    .sort((a, b) => a - b)[2];
  const hook = load.findIndex((r, i) => i >= 3 && w(r) > base + Math.round(MEASURE.hook * res));
  const m = Math.round(MEASURE.margin * res);
  const own = (x, y) => joined.has(y * frame.w + x);
  // the smallest box round the rows with the margin, or with less where something else of the
  // picture (a cart's rim, close to the crate's corner) would come inside it; a band that
  // cannot be cleared by less is cut in two, down to a single row
  const box = (list, margin = m) => {
    const x0 = Math.min(...list.map((r) => r.x0)) - margin;
    const x1 = Math.max(...list.map((r) => r.x1)) + 1 + margin;
    const y0 = list[0].y;
    const y1 = list.at(-1).y + 1;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++)
        if (alpha(frame, x, y) > 0 && !own(x, y)) {
          if (margin > 0) return box(list, margin - 1);
          if (list.length > 1) {
            const half = list.length >> 1;
            return [...box(list.slice(0, half)), ...box(list.slice(half))];
          }
          return [[x0, y0, x1, y1]];
        }
    return [[x0, y0, x1, y1]];
  };
  // the rope, then the hook and the crate in bands that follow their outline
  const step = Math.round(MEASURE.band * res);
  const rects = [...box(load.slice(0, hook < 0 ? load.length : hook))];
  for (let i = hook; hook >= 0 && i < load.length; i += step)
    rects.push(...box(load.slice(i, i + step)));
  return { pivot: at, rects };
}

/**
 * What hangs from the rope that holds the texel `rope`, cut from the picture along a line drawn
 * by eye (`CRANE_GROUPS`): every visible texel joined to the rope from `top` down, row by row,
 * and the pivot on the rope's top row. For a load `loadOf` cannot tell from what it nearly touches.
 */
export function cutLoad(frame, { rope, top, stop }) {
  const below = (x, y) => {
    const at = stop.findIndex(([sx]) => x + 0.5 < sx);
    if (at <= 0) return false;
    const [[x0, y0], [x1, y1]] = [stop[at - 1], stop[at]];
    return y + 0.5 > y0 + ((y1 - y0) * (x + 0.5 - x0)) / (x1 - x0);
  };
  const joined = new Set();
  const rows = new Map();
  const todo = [rope];
  while (todo.length) {
    const [x, y] = todo.pop();
    const id = y * frame.w + x;
    if (y < top || joined.has(id) || alpha(frame, x, y) < 1 || below(x, y)) continue;
    joined.add(id);
    const row = rows.get(y);
    rows.set(y, row ? [Math.min(row[0], x), Math.max(row[1], x)] : [x, x]);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) todo.push([x + dx, y + dy]);
  }
  const rects = [];
  for (const y of [...rows.keys()].sort((a, b) => a - b)) {
    const [a, b] = rows.get(y);
    const last = rects.at(-1);
    if (last && last[0] === a && last[2] === b + 1) last[3] = y + 1;
    else rects.push([a, y, b + 1, y + 1]);
  }
  const [a, b] = rows.get(top);
  return { pivot: [(a + b + 1) / 2, top], rects };
}

/* ---------------------------------------------------------------- the data */

/**
 * A texel position in world px from the frame's anchor, rounded but never past the frame's top or
 * left edge (a pot on the picture's top row of an anchor with a fraction stays inside its frame).
 */
const world = (f, x, y) => {
  const edge = (v) => Math.ceil(v * 100 - 1e-9) / 100 + 0;
  return [
    Math.max(round((x - f.ax) / f.resolution), edge(-f.ax / f.resolution)),
    Math.max(round((y - f.ay) / f.resolution), edge(-f.ay / f.resolution)),
  ];
};

/**
 * The data of every frame in the tables, from the atlas `frames` (`atlasFrames`):
 * `{ pots: { frame: [{ dx, dy, work }] }, cranes: { frame: { pivot, load } } }`, keys sorted.
 */
export function buildLife(frames) {
  const frame = (key) => {
    const f = frames.get(key);
    if (!f) throw new Error(`${key} is not a frame of the atlas`);
    return f;
  };
  const pots = {};
  for (const g of POT_GROUPS)
    for (const key of g.keys) {
      const f = frame(key);
      pots[key] = g.at.map((seed) => {
        const at = g.exact ? seed : g.stack ? stackAt(f, seed) : potAt(f, seed);
        const [dx, dy] = world(f, ...at);
        return { dx, dy, work: g.work };
      });
    }
  const cranes = {};
  for (const g of CRANE_GROUPS)
    for (const key of g.keys) {
      const f = frame(key);
      const found = cutLoad(f, g);
      cranes[key] = {
        pivot: world(f, ...found.pivot),
        load: found.rects.map(([x0, y0, x1, y1]) => [...world(f, x0, y0), ...world(f, x1, y1)]),
      };
    }
  const mills = {};
  for (const key of MILL_FRAMES) {
    frame(key);
    mills[key] = windmillHub();
  }
  const sorted = (o) =>
    Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, o[k]]),
    );
  return { pots: sorted(pots), cranes: sorted(cranes), mills: sorted(mills) };
}

/** The file's text: prettier's own formatting of the data, so that `format:check` leaves it be. */
export async function serialise(data) {
  const { format, resolveConfig } = await import('prettier');
  const options = (await resolveConfig(LIFE_FILE)) ?? {};
  return format(JSON.stringify(data), { ...options, parser: 'json' });
}

async function main(args) {
  const mods = await gameModules('.');
  try {
    const data = buildLife(atlasFrames(mods.generate));
    const text = await serialise(data);
    const stacks = Object.values(data.pots).reduce((n, list) => n + list.length, 0);
    const found = `${Object.keys(data.pots).length} frames with ${stacks} pots, ${Object.keys(data.cranes).length} with a crane`;
    if (args.includes('--check')) {
      const now = existsSync(LIFE_FILE) ? readFileSync(LIFE_FILE, 'utf8') : '';
      if (now === text) {
        console.log(`${LIFE_FILE} is what the frames give: ${found}`);
        return 0;
      }
      console.error(`${LIFE_FILE} is not what the frames give: run node tools/building-life.mjs`);
      return 1;
    }
    writeWhole(LIFE_FILE, text);
    console.log(`wrote ${LIFE_FILE}: ${found}`);
    return 0;
  } finally {
    await mods.close();
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
