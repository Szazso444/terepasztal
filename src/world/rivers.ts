import { Terrain } from './tiles';

/**
 * Rivers and lakes as the land drains (#341): the hydrology of the generator of the approved tile
 * tooltip demo, on the game's tiles and elevation.
 *
 * `drain` works on a rectangle of tiles, its `core`, and reads the planes up to two tiles around
 * it. Every core tile drains to the sea or off the core's edge along the land's slope, rain
 * gathers along the way, and where enough has gathered the water is a river; a basin on the
 * lowest ground is a lake, which overflows into a river at its lowest rim. What it decides for a
 * tile depends on the whole core, so mapgen.ts runs it once over a fixed square around the start
 * (its river region), never over a map, and a tile's water is the same whatever map holds it.
 *
 * The height thresholds are the demo's, in its own level steps (sea 0.24, a step 0.11), set on the
 * game's elevation by `levelSteps`; the rain a river needs is four times the demo's (RIVER_FLOW).
 */

/** What the river pass makes of a tile. */
export const enum WaterKind {
  /** land, as the ground has it */
  Land = 0,
  River = 1,
  /** still water that is not the sea: a basin filled to its rim, or the ground's own water */
  Lake = 2,
  /** the ground's water in the Ocean climate */
  Sea = 3,
  /** the ground's water that is too small or too near high ground to be a lake: land */
  Dry = 4,
}

/**
 * Rain a river needs, in tiles of rain, below level step 2 and from it up (thinner on slopes).
 * These and SIDE_STREAM_FLOW are four times the demo's 15, 33 and 27: at the demo's numbers a
 * 160-tile map was a tenth river and rarely had room for a large dry site (card `river-density`).
 */
export const RIVER_FLOW = 60;
export const HIGH_RIVER_FLOW = 132;
/** A side stream that is not the main inflow of the river it joins needs this much of its own. */
export const SIDE_STREAM_FLOW = 108;
/** A river this full runs two tiles wide, where both tiles are below the hills (level 0 or 1). */
export const WIDE_FLOW = 200;
/** The most rain a tile's flow records; a river gathering more records this. */
export const FLOW_CAP = 4095;
/** The fewest tiles of a lake. */
export const LAKE_TILES = 3;
/** How far a lake keeps from ground that can stand at level 2 or more, along either axis. */
export const LAKE_CLEARANCE = 2;

/** A real basin: its water stands this many level steps over the ground (the demo's 0.015). */
const LAKE_DEPTH = 0.015 / 0.11;
/** Rain grows with height from this many level steps above the sea (the demo's 0.55). */
const RAIN_FROM = (0.55 - 0.24) / 0.11;
/** Extra rain per level step above RAIN_FROM (the demo's 2 per unit). */
const RAIN_PER_STEP = 2 * 0.11;
/** A level step is never less than this in elevation, whatever the sliders say. */
const MIN_STEP = 0.01;

/** The elevation sliders the level steps are set by (MapGenParams). */
export interface LevelScale {
  waterLevel: number;
  hillLevel: number;
  rockLevel: number;
}

/**
 * Elevation `e` in the demo's level steps above the sea, unclamped. The demo's sea, hill line and
 * rock line (0, 3 and 4 steps) are the game's waterLevel, hillLevel and rockLevel, so below the
 * hill line a step is a third of (hillLevel - waterLevel), and above it rockLevel - hillLevel
 * (0.0933 and 0.12 at the default sliders). Sliders out of order are read as if a step were
 * MIN_STEP at least.
 */
export function levelSteps(s: LevelScale, e: number): number {
  return stepper(s)(e);
}

/** levelSteps for one scale, as a function of the elevation alone. */
function stepper(s: LevelScale): (e: number) => number {
  const sea = s.waterLevel;
  const hill = Math.max(s.hillLevel, sea + 3 * MIN_STEP);
  const rock = Math.max(s.rockLevel, hill + MIN_STEP);
  const below = 3 / (hill - sea);
  const above = 1 / (rock - hill);
  return (e) => (e < hill ? (e - sea) * below : 3 + (e - hill) * above);
}

/**
 * A flag of DrainInput.mark: no rain falls here and no river rises, runs or ends here, and no basin
 * fills; the land drains away from it, last (the start's middle, and the corners its patches go
 * on). The ground's own water here is a lake as anywhere else, and only its outlet runs here.
 */
export const KEEP_OUT = 1;
/** A flag of DrainInput.mark: water here stands at level 0 (its sides change after the pass). */
export const LOW = 2;
/** A flag of DrainInput.mark: no lake; the ground's own water here is land (a hill patch's room). */
export const DRY = 4;

/** A rectangle of tiles; `x1` and `y1` are exclusive. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface DrainInput extends LevelScale {
  /** the planes' width and height */
  w: number;
  h: number;
  /** the tiles that drain; the planes hold LAKE_CLEARANCE tiles or more around it */
  core: Rect;
  elev: Float32Array;
  /** the ground's terrain: Water where the ground has water */
  ground: Uint8Array;
  /** the terrain each tile has as land: the ground's, and for its water what it would be dry */
  land: Uint8Array;
  /** 1 where the ground's water is the sea */
  sea: Uint8Array;
  /** flags: KEEP_OUT, LOW, DRY */
  mark: Uint8Array;
  /**
   * The start chunk and the tile its water patch is centred on: when the pass leaves fewer than
   * four water tiles in the chunk, the 3 x 3 tiles around it (within the chunk) are a lake, as
   * the start guarantee would paint them, and overflow like any lake.
   */
  start?: { chunk: Rect; pond: { x: number; y: number } };
  /** when no river runs here, the fullest stream here becomes one (the start's 3 x 3 chunks) */
  near?: Rect;
}

export interface Drainage {
  /** WaterKind of each tile; Land outside the core */
  kind: Uint8Array;
  /** each river and lake tile's water level, 0 to 2; 0 elsewhere */
  surface: Uint8Array;
  /**
   * each river tile's flow: tiles of rain gathered, at least 1 (the start pond's outlet may run
   * over ground no rain falls on) and at most FLOW_CAP; 0 elsewhere
   */
  flow: Uint16Array;
  /** each river tile's downstream side as Dir + 1 (1 N, 2 E, 3 S, 4 W); 0 elsewhere */
  dir: Uint8Array;
  /** where water leaves the core across its edge, in the order of their tiles */
  exits: Exit[];
  /** whether the start chunk's water patch was laid as a lake */
  pond: boolean;
}

/** A core tile on its edge whose water leaves the core across it. */
export interface Exit {
  tile: number;
  /** the side it leaves across, Dir + 1 */
  dir: number;
  /** the rain it carries, at most FLOW_CAP */
  flow: number;
}

/** Tile offsets of the four sides, in Dir order (N, E, S, W). */
const SIDE_DX = [0, 1, 0, -1];
const SIDE_DY = [-1, 0, 1, 0];

/** A binary min-heap of tiles keyed by a number, ties broken by the lower tile index. */
class TileHeap {
  key = new Float64Array(1024);
  tile = new Int32Array(1024);
  size = 0;
  push(k: number, t: number) {
    if (this.size === this.key.length) {
      const key = new Float64Array(this.size * 2);
      key.set(this.key);
      this.key = key;
      const tile = new Int32Array(this.size * 2);
      tile.set(this.tile);
      this.tile = tile;
    }
    const { key, tile } = this;
    let c = this.size++;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (key[p] < k || (key[p] === k && tile[p] < t)) break;
      key[c] = key[p];
      tile[c] = tile[p];
      c = p;
    }
    key[c] = k;
    tile[c] = t;
  }
  pop(): number {
    const { key, tile } = this;
    const top = tile[0];
    const n = --this.size;
    const k = key[n];
    const t = tile[n];
    let c = 0;
    for (;;) {
      let m = 2 * c + 1;
      if (m >= n) break;
      if (m + 1 < n && (key[m + 1] < key[m] || (key[m + 1] === key[m] && tile[m + 1] < tile[m])))
        m++;
      if (key[m] > k || (key[m] === k && tile[m] > t)) break;
      key[c] = key[m];
      tile[c] = tile[m];
      c = m;
    }
    key[c] = k;
    tile[c] = t;
    return top;
  }
}

/**
 * The rivers and lakes of `p.core`. Steps, each the demo's unless it says otherwise:
 *
 * 1. Drainage. A priority flood from the sea and the core's edge, lowest ground first, ties by
 *    tile index: each tile drains into the neighbour it was first reached from. Out of a basin
 *    that is the way over its lowest rim, so the drainage crosses a basin along one channel
 *    rather than filling it flat (the demo filled it; the basins it would fill are the lakes
 *    below). A tile's spill level is the highest ground on its way out.
 * 2. Lakes, only on the lowest ground: a tile whose spill level stands LAKE_DEPTH steps over it
 *    and less than a step over the sea (not where KEEP_OUT), or the ground's own inland water (not
 *    where DRY); with no ground within LAKE_CLEARANCE tiles at step 2 or more, or Hill or Rock; in
 *    a group of LAKE_TILES or more across sides. The ground's water that is no lake is Dry: land.
 * 3. Flow. Rain is 1 + RAIN_PER_STEP for every step above RAIN_FROM; each tile passes what it
 *    gathered to the tile it drains into.
 * 4. Rivers: land that gathered RIVER_FLOW, or HIGH_RIVER_FLOW at step 2 or more; none where
 *    KEEP_OUT, where no rain falls either. No river ends on land (the issue's rule; the demo had
 *    none): one that drains onto land needing more rain to be one runs on down until it meets
 *    water or the core's edge, whatever it gathers, so the next step sees each river's whole way.
 * 5. One channel: a river tile that is not the main inflow of the river it joins (its fullest
 *    inflow, ties by tile index), with less than SIDE_STREAM_FLOW, is land again, and so is
 *    every river tile upstream of it. A river into a lake or the sea is never removed.
 * 6. Outlets (the issue's rule; the demo had none): each lake overflows at its fullest exit, and
 *    the way from there is river until it meets water or the core's edge, whatever it gathers,
 *    so an outlet may join a river with less than SIDE_STREAM_FLOW. The start's pond and nearby
 *    river (see DrainInput) are laid here, running on the same way.
 * 7. Width (#341): a river of WIDE_FLOW or more on land below the hills takes the tile beside
 *    it, east of a river along y and south of one along x, where that is land below the hills.
 * 8. Levels (#341): a river tile on Hill ground stands at level 2 (0 where LOW, and beside the
 *    core's edge, whose other side it does not know), any other water at 0, lowered to one above
 *    the lowest of its four sides (as tileLevels lowers every tile), to the level of the water it
 *    receives where that is lower, and to 1 in a 2 x 2 block of river tiles, until nothing
 *    changes. So water never rises downstream, and drops one level at a time.
 */
export function drain(p: DrainInput): Drainage {
  const { w, core, elev, ground, land, sea, mark } = p;
  const n = w * p.h;
  const { x0, y0, x1, y1 } = core;
  const inCore = (x: number, y: number) => x >= x0 && y >= y0 && x < x1 && y < y1;
  const r = LAKE_CLEARANCE;
  const stepsOf = stepper(p);

  // 1. drainage; a tile not reached yet drains into -2, one the flood starts from into -1
  const down = new Int32Array(n).fill(-2);
  const spill = new Float32Array(n);
  const order = new Int32Array((x1 - x0) * (y1 - y0));
  let on = 0;
  const heap = new TileHeap();
  let seas = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0, i = y * w + x; x < x1; x++, i++) {
      if (sea[i]) {
        down[i] = -1;
        spill[i] = p.waterLevel;
        seas++;
      } else if (x === x0 || y === y0 || x === x1 - 1 || y === y1 - 1) {
        down[i] = -1;
        spill[i] = elev[i];
        // land kept out drains last, after everything else has found its way to the sea
        heap.push(mark[i] & KEEP_OUT ? elev[i] + 1e3 : elev[i], i);
      }
    }
  const reach = (i: number, j: number) => {
    down[j] = i;
    spill[j] = Math.max(elev[j], spill[i]);
    heap.push(mark[j] & KEEP_OUT ? elev[j] + 1e3 : elev[j], j);
  };
  const visit = (i: number) => {
    order[on++] = i;
    const x = i % w;
    const y = (i - x) / w;
    if (y > y0 && down[i - w] === -2) reach(i, i - w);
    if (x < x1 - 1 && down[i + 1] === -2) reach(i, i + 1);
    if (y < y1 - 1 && down[i + w] === -2) reach(i, i + w);
    if (x > x0 && down[i - 1] === -2) reach(i, i - 1);
  };
  // the sea first, below everything, in reading order, then the rest lowest first
  for (let y = y0; y < y1 && seas; y++)
    for (let x = x0, i = y * w + x; x < x1; x++, i++) if (sea[i]) visit(i);
  while (heap.size) visit(heap.pop());

  // 2. lakes, away from high ground: ground that can stand at level 2 or more (Hill, Rock that
  // may be a mountain) or at step 2 or more. `near` counts the high tiles within r along a row,
  // a window sliding along it.
  const near = new Uint8Array(n);
  const ups = new Uint8Array(x1 - x0 + 2 * r);
  for (let y = y0 - r; y < y1 + r; y++) {
    const row = y * w;
    const high = (x: number) => {
      const t = ground[row + x];
      return t === Terrain.Hill || t === Terrain.Rock || stepsOf(elev[row + x]) >= 2 ? 1 : 0;
    };
    for (let x = x0 - r; x < x1 + r; x++) ups[x - x0 + r] = high(x);
    let count = 0;
    for (let k = 0; k < 2 * r; k++) count += ups[k];
    for (let x = x0; x < x1; x++) {
      count += ups[x - x0 + 2 * r];
      near[row + x] = count;
      count -= ups[x - x0];
    }
  }
  const kind = new Uint8Array(n);
  const candidate = new Uint8Array(n);
  const acc = new Float32Array(n);
  for (let y = y0; y < y1; y++)
    for (let x = x0, i = y * w + x; x < x1; x++, i++) {
      // 3. rain, here as the lakes go
      const steps = stepsOf(elev[i]);
      const kept = mark[i] & KEEP_OUT;
      acc[i] = kept ? 0 : 1 + RAIN_PER_STEP * Math.max(0, steps - RAIN_FROM);
      if (sea[i]) {
        kind[i] = WaterKind.Sea;
        continue;
      }
      const wet = ground[i] === Terrain.Water;
      if (wet) kind[i] = WaterKind.Dry;
      if (mark[i] & DRY) continue;
      if (!wet) {
        // the start keeps the ground's own water, but no basin there fills
        if (kept || spill[i] <= elev[i]) continue;
        const s = stepsOf(spill[i]);
        if (s - steps <= LAKE_DEPTH || Math.floor(s) > 0) continue;
      }
      let high = 0;
      for (let d = -r; d <= r && !high; d++) high = near[i + d * w];
      if (!high) candidate[i] = 1;
    }
  const lakeOf = new Int32Array(n).fill(-1);
  const lakes: number[][] = [];
  for (let y = y0; y < y1; y++)
    for (let x = x0, i = y * w + x; x < x1; x++, i++) {
      if (!candidate[i] || lakeOf[i] !== -1) continue;
      const members = groupOf(i, w, candidate, lakeOf, lakes.length, inCore);
      if (members.length >= LAKE_TILES) {
        for (const k of members) kind[k] = WaterKind.Lake;
        lakes.push(members);
      } else for (const k of members) lakeOf[k] = -2;
    }

  // 3. flow, from the top of the flood down
  for (let k = on - 1; k >= 0; k--) {
    const i = order[k];
    if (down[i] >= 0) acc[down[i]] += acc[i];
  }

  // 4. rivers, and 5. the main inflow of each tile: its fullest, ties to the lower index
  const isLand = (i: number) => kind[i] === WaterKind.Land || kind[i] === WaterKind.Dry;
  const main = new Int32Array(n).fill(-1);
  for (let y = y0; y < y1; y++)
    for (let x = x0, i = y * w + x; x < x1; x++, i++) {
      const d = down[i];
      if (d >= 0) {
        const m = main[d];
        if (m < 0 || acc[i] > acc[m] || (acc[i] === acc[m] && i < m)) main[d] = i;
      }
      if (!isLand(i) || mark[i] & KEEP_OUT) continue;
      const need = stepsOf(elev[i]) >= 2 ? HIGH_RIVER_FLOW : RIVER_FLOW;
      if (acc[i] >= need) kind[i] = WaterKind.River;
    }
  // the way down from `from` is river until it meets water or the core's edge
  const runDown = (from: number) => {
    for (let i = from; i >= 0 && isLand(i); i = down[i]) kind[i] = WaterKind.River;
  };
  // no river ends on land: one that drains onto ground needing more rain runs on regardless,
  // before the one-channel rule, which then sees where it joins
  for (let y = y0; y < y1; y++)
    for (let x = x0, i = y * w + x; x < x1; x++, i++)
      if (kind[i] === WaterKind.River) runDown(down[i]);
  // 5. one channel, downstream first
  const pruned = new Uint8Array(n);
  for (let k = 0; k < on; k++) {
    const c = order[k];
    const d = down[c];
    if (kind[c] !== WaterKind.River || d < 0) continue;
    if (pruned[d] || (kind[d] === WaterKind.River && main[d] !== c && acc[c] < SIDE_STREAM_FLOW)) {
      pruned[c] = 1;
      kind[c] = ground[c] === Terrain.Water ? WaterKind.Dry : WaterKind.Land;
    }
  }

  // 6. outlets, each running down as far as a river does
  const lakeExits: number[] = [];
  /** Lays each lake's outlet; the lakes from `first` on. */
  const outlets = (first: number) => {
    for (let l = first; l < lakes.length; l++) {
      let best = -1;
      for (const t of lakes[l]) {
        const d = down[t];
        if (d >= 0 && lakeOf[d] === l) continue;
        if (best < 0 || acc[t] > acc[best] || (acc[t] === acc[best] && t < best)) best = t;
      }
      // a lake that holds the whole core has nowhere to go
      if (best < 0) continue;
      if (down[best] < 0) lakeExits.push(best);
      else runDown(down[best]);
    }
  };
  outlets(0);
  let pond = false;
  if (p.start) {
    const { chunk, pond: at } = p.start;
    let wet = 0;
    for (let y = chunk.y0; y < chunk.y1; y++)
      for (let x = chunk.x0; x < chunk.x1; x++) {
        const k = kind[y * w + x];
        if (k === WaterKind.River || k === WaterKind.Lake || k === WaterKind.Sea) wet++;
      }
    if (wet < 4) {
      pond = true;
      const members: number[] = [];
      for (let y = at.y - 1; y <= at.y + 1; y++)
        for (let x = at.x - 1; x <= at.x + 1; x++) {
          if (x < chunk.x0 || y < chunk.y0 || x >= chunk.x1 || y >= chunk.y1) continue;
          const i = y * w + x;
          // a lake it touches joins it
          if (kind[i] === WaterKind.Lake && lakeOf[i] >= 0) continue;
          kind[i] = WaterKind.Lake;
          members.push(i);
        }
      // the pond and any lake beside it are one lake, overflowing once
      const merged = new Set(members);
      for (const i of members) {
        const x = i % w;
        const y = (i - x) / w;
        for (let d = 0; d < 4; d++) {
          const j = (y + SIDE_DY[d]) * w + x + SIDE_DX[d];
          const l = lakeOf[j];
          if (l >= 0 && kind[j] === WaterKind.Lake) for (const k of lakes[l]) merged.add(k);
        }
      }
      for (const k of merged) lakeOf[k] = lakes.length;
      lakes.push([...merged].sort((a, b) => a - b));
      outlets(lakes.length - 1);
    }
  }
  const around: Rect | undefined = p.near;
  if (around) {
    let fullest = -1;
    let any = false;
    for (let y = around.y0; y < around.y1 && !any; y++)
      for (let x = around.x0; x < around.x1; x++) {
        const i = y * w + x;
        if (kind[i] === WaterKind.River) {
          any = true;
          break;
        }
        if (!isLand(i) || mark[i] & KEEP_OUT) continue;
        if (fullest < 0 || acc[i] > acc[fullest] || (acc[i] === acc[fullest] && i < fullest))
          fullest = i;
      }
    if (!any && fullest >= 0) runDown(fullest);
  }

  // 7. width
  const raised = (i: number) => land[i] === Terrain.Hill && !(mark[i] & LOW);
  const wide = new Int32Array(n).fill(-1);
  for (let y = y0; y < y1; y++)
    for (let x = x0, i = y * w + x; x < x1; x++, i++) {
      if (kind[i] !== WaterKind.River || acc[i] < WIDE_FLOW || raised(i)) continue;
      const d = down[i];
      // across the way it flows: along x it widens south, along y east
      const alongX = d >= 0 ? Math.abs(d - i) === 1 : x === x0 || x === x1 - 1;
      const sx = alongX ? x : x + 1;
      const sy = alongX ? y + 1 : y;
      if (!inCore(sx, sy)) continue;
      const s = sy * w + sx;
      if (!isLand(s) || raised(s) || mark[s] & KEEP_OUT) continue;
      kind[s] = WaterKind.River;
      wide[s] = i;
    }

  // 8. levels, over the river tiles downstream first, so a pass from the back carries a level all
  // the way down
  const wet = (i: number) => kind[i] !== WaterKind.Land && kind[i] !== WaterKind.Dry;
  const surface = new Uint8Array(n);
  let count = 0;
  for (let k = 0; k < on; k++) if (kind[order[k]] === WaterKind.River) count++;
  const rivers = new Int32Array(count);
  // where each river tile's water goes: the tile it drains into, a widened tile its own river's
  // next tile where that is water and else its river tile
  const into = new Int32Array(n).fill(-1);
  for (let k = 0, q = 0; k < on; k++) {
    const i = order[k];
    if (kind[i] !== WaterKind.River) continue;
    rivers[q++] = i;
    if (raised(i)) surface[i] = 2;
    const m = wide[i];
    if (m < 0) into[i] = down[i];
    else {
      const next = down[m] >= 0 ? down[m] + (i - m) : -1;
      const nx = next % w;
      into[i] = next >= 0 && inCore(nx, (next - nx) / w) && wet(next) ? next : m;
    }
  }
  const target = (i: number) => {
    if (wet(i)) return surface[i];
    const t = land[i];
    return t === Terrain.Hill ? 2 : t === Terrain.Mountain ? 4 : 0;
  };
  for (let changed = true; changed;) {
    changed = false;
    for (let k = 0; k < count; k++) {
      const i = rivers[k];
      let v = surface[i];
      if (v === 0) continue;
      const x = i % w;
      const y = (i - x) / w;
      for (let d = 0; d < 4 && v > 0; d++) {
        const nx = x + SIDE_DX[d];
        const ny = y + SIDE_DY[d];
        v = inCore(nx, ny) ? Math.min(v, target(ny * w + nx) + 1) : 0;
      }
      if (v > 1 && inBlock(i, w, kind, inCore)) v = 1;
      if (v !== surface[i]) {
        surface[i] = v;
        changed = true;
      }
    }
    // downstream never above upstream: upstream tiles first
    for (let k = count - 1; k >= 0; k--) {
      const i = rivers[k];
      const j = into[i];
      if (j >= 0 && kind[j] === WaterKind.River && surface[j] > surface[i]) {
        surface[j] = surface[i];
        changed = true;
      }
    }
  }

  // flow and direction
  const flow = new Uint16Array(n);
  const dir = new Uint8Array(n);
  const rain = (i: number) => Math.min(FLOW_CAP, Math.max(1, Math.round(acc[i])));
  /** Dir + 1 across the core's edge from edge tile `i` (an x edge first at a corner). */
  const outward = (i: number) => {
    const x = i % w;
    const y = (i - x) / w;
    return (x === x0 ? 3 : x === x1 - 1 ? 1 : y === y0 ? 0 : 2) + 1;
  };
  const exits: Exit[] = lakeExits.map((i) => ({ tile: i, dir: outward(i), flow: rain(i) }));
  for (let k = 0; k < count; k++) {
    const i = rivers[k];
    const j = into[i];
    flow[i] = rain(wide[i] >= 0 ? wide[i] : i);
    if (j >= 0) dir[i] = sideOf(j - i, w) + 1;
    else {
      dir[i] = outward(i);
      exits.push({ tile: i, dir: dir[i], flow: flow[i] });
    }
  }
  exits.sort((a, b) => a.tile - b.tile);
  return { kind, surface, flow, dir, exits, pond };
}

/** The Dir of the side a tile `delta` away (along a row of `w`) lies on. */
function sideOf(delta: number, w: number): number {
  return delta === -w ? 0 : delta === 1 ? 1 : delta === w ? 2 : 3;
}

/** Whether river tile `i` is one of a 2 x 2 block of river tiles. */
function inBlock(
  i: number,
  w: number,
  kind: Uint8Array,
  inCore: (x: number, y: number) => boolean,
): boolean {
  const x = i % w;
  const y = (i - x) / w;
  const river = (xx: number, yy: number) => inCore(xx, yy) && kind[yy * w + xx] === WaterKind.River;
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    if (river(x + dx, y) && river(x, y + dy) && river(x + dx, y + dy)) return true;
  return false;
}

/** The tiles of `on` joined to `start` across sides, each labelled `label` in `group`. */
function groupOf(
  start: number,
  w: number,
  on: Uint8Array,
  group: Int32Array,
  label: number,
  inCore: (x: number, y: number) => boolean,
): number[] {
  const members = [start];
  group[start] = label;
  for (let k = 0; k < members.length; k++) {
    const i = members[k];
    const x = i % w;
    const y = (i - x) / w;
    for (let d = 0; d < 4; d++) {
      const nx = x + SIDE_DX[d];
      const ny = y + SIDE_DY[d];
      if (!inCore(nx, ny)) continue;
      const j = ny * w + nx;
      if (on[j] && group[j] === -1) {
        group[j] = label;
        members.push(j);
      }
    }
  }
  return members.sort((a, b) => a - b);
}
