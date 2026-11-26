import { MAX_LEVEL, tileLevels } from './elevation';
import { FLOW_CAP, WaterKind, type Drainage, type Rect } from './rivers';
import { Terrain } from './tiles';

/**
 * Glaciers (#355): where a river would run on above the snow line it is ice, a channel a tile wide,
 * and below the ice its melt runs down to the river's old source.
 *
 * The rule is the approved tile tooltip demo's, run on the rivers `drain` leaves, so every glacier
 * has a river below it. From each river source (a river tile no river or lake runs into) the main
 * stream is traced uphill over land: the upstream tile with the most rain, ties to the lower
 * index, for at most MELT_TILES tiles, stopping at the first tile at MAX_LEVEL, the snow line. A
 * trace that gets there turns its tiles into river and its last tile into ice, and the ice runs on
 * uphill the same way, over land at MAX_LEVEL, for at most ICE_TILES more tiles.
 *
 * A river's main stream need not lead to the highest ground, so a field at MAX_LEVEL can be left
 * with no trace (a third of them were, and no longer limit helped). Such a field gets a glacier
 * from the other end: from its tile with the most rain the land's drainage is followed down, as
 * far as MELT_TILES tiles, to the water it reaches, and the way is laid the same.
 *
 * The ice is the Ice channel of the approved art demo (the author, 2026-10-12): it does not stop at
 * the snow line but runs on down the way while the land stands at ICE_LOW or more, stepping down a
 * level as the land does, and only below that does its melt start. So a glacier is a tile wide and
 * a few tiles longer than ICE_TILES; channels side by side make wider ice, rarely. The trace runs on the river plan's tiles (mapgen.ts) and only there: the short
 * local streams beyond the plan's region have no glaciers.
 *
 * The tiles are laid over the ground after the mountains have risen (raiseMountains), which they
 * must not change: an Ice tile keeps the level of the Mountain it replaces (its waterSurface holds
 * it, levelTarget), and a melt tile's water stands at the level of the land it replaces, or lower
 * where the water upstream of it already came down, as water never rises downstream.
 */

/**
 * The longest trace from a source to the snow line. The demo's 10 tiles, doubled as its rain is
 * quadrupled (RIVER_FLOW): a river rises twice as far down the drainage as in the demo.
 */
export const MELT_TILES = 20;
/** The most ice above the trace's top tile. */
export const ICE_TILES = 4;
/** The lowest land the ice runs down over: one level below the snow line. */
export const ICE_LOW = MAX_LEVEL - 1;
/** How far a trace keeps from the core's edge: the ground beyond it may change after the plan. */
const EDGE = 4;

/** What the glacier pass makes of a tile. */
export const enum GlacierKind {
  None = 0,
  /** river laid by the trace */
  Melt = 1,
  Ice = 2,
  /** the highest melt tile of a trace: the headwater below the ice (#356) */
  Head = 3,
}

export interface GlacierInput {
  w: number;
  h: number;
  /** the tiles `drain` drained */
  core: Rect;
  /** the terrain with the mountains risen, water where the drainage has water */
  terrain: Uint8Array;
  /** where no trace goes: the start chunk's ground changes after the plan */
  keepOut: Uint8Array;
  drainage: Drainage;
}

/** One glacier: its tiles from the water it runs into up. */
interface Trace {
  /** the water it runs into */
  source: number;
  melt: number[];
  /** each melt tile's water level */
  levels: number[];
  ice: number[];
  /** each ice tile's level */
  iceLevels: number[];
}

/** The four sides of a tile as offsets along a row of `w`. */
const sides = (i: number, w: number) => [i - w, i + 1, i + w, i - 1];

/**
 * The glaciers of `p.core`, as a plane of GlacierKind, with the water level, flow and side of each
 * melt tile written into the drainage's planes (its `kind` stays land: the ground under a melt tile
 * has to stay land until the mountains have risen).
 */
export function traceGlaciers(p: GlacierInput): Uint8Array {
  const { w, h, core, terrain, keepOut, drainage: d } = p;
  const { kind, down, acc, surface, flow, dir } = d;
  const levels = tileLevels({ w, h, terrain, waterSurface: surface });
  const ix0 = core.x0 + EDGE;
  const iy0 = core.y0 + EDGE;
  const ix1 = core.x1 - EDGE;
  const iy1 = core.y1 - EDGE;
  const land = (i: number) => {
    const x = i % w;
    const y = (i - x) / w;
    if (x < ix0 || y < iy0 || x >= ix1 || y >= iy1 || keepOut[i]) return false;
    return kind[i] === WaterKind.Land || kind[i] === WaterKind.Dry;
  };
  const taken = new Uint8Array(w * h);
  /** The land tile upstream of `i` with the most rain that `ok` allows, or -1. */
  const uphill = (i: number, ok: (n: number) => boolean) => {
    let best = -1;
    for (const n of sides(i, w)) {
      if (down[n] !== i || taken[n] || !land(n) || !ok(n)) continue;
      if (best < 0 || acc[n] > acc[best] || (acc[n] === acc[best] && n < best)) best = n;
    }
    return best;
  };
  const traces: Trace[] = [];
  /** Lays the way up from water tile `s`, its last tile the first of the ice; false if it can't. */
  const lay = (s: number, way: number[]) => {
    const top = way[way.length - 1];
    const melt = way.slice(0, -1);
    // the water comes down from the ice; it may not stand below the water it runs into
    const heights: number[] = [];
    let level = MAX_LEVEL;
    for (let k = melt.length - 1; k >= 0; k--) {
      level = Math.min(level, levels[melt[k]]);
      heights.unshift(level);
    }
    if (level < surface[s]) return false;
    const ice = [top];
    const iceLevels: number[] = [MAX_LEVEL];
    // the ice runs on down the mountain as far as its land stands high
    while (
      melt.length &&
      heights[heights.length - 1] >= ICE_LOW &&
      terrain[melt[melt.length - 1]] === Terrain.Mountain
    ) {
      ice.unshift(melt.pop()!);
      iceLevels.unshift(heights.pop()!);
    }
    for (let k = 0; k < ICE_TILES; k++) {
      const next = uphill(ice[ice.length - 1], (n) => levels[n] >= MAX_LEVEL && !ice.includes(n));
      if (next < 0) break;
      ice.push(next);
      iceLevels.push(MAX_LEVEL);
    }
    for (const t of way) taken[t] = 1;
    for (const t of ice) taken[t] = 1;
    traces.push({ source: s, melt, levels: heights, ice, iceLevels });
    return true;
  };
  for (let y = iy0; y < iy1; y++)
    for (let x = ix0, s = y * w + x; x < ix1; x++, s++) {
      if (kind[s] !== WaterKind.River) continue;
      const fed = sides(s, w).some(
        (n) => down[n] === s && (kind[n] === WaterKind.River || kind[n] === WaterKind.Lake),
      );
      if (fed) continue;
      const way: number[] = [];
      for (let at = s; way.length < MELT_TILES;) {
        const next = uphill(at, (n) => !way.includes(n));
        if (next < 0) break;
        way.push(next);
        at = next;
        if (levels[next] >= MAX_LEVEL) break;
      }
      const top = way[way.length - 1];
      if (top !== undefined && levels[top] >= MAX_LEVEL) lay(s, way);
    }
  // the fields at MAX_LEVEL no trace reached, each from its tile with the most rain
  const seen = new Uint8Array(w * h);
  const high = (i: number) => land(i) && levels[i] >= MAX_LEVEL;
  for (let y = iy0; y < iy1; y++)
    for (let x = ix0, start = y * w + x; x < ix1; x++, start++) {
      if (seen[start] || !high(start)) continue;
      seen[start] = 1;
      const field = [start];
      let wet = false;
      for (let k = 0; k < field.length; k++) {
        wet ||= taken[field[k]] === 1;
        for (const n of sides(field[k], w))
          if (!seen[n] && high(n)) {
            seen[n] = 1;
            field.push(n);
          }
      }
      if (wet) continue;
      let top = field[0];
      for (const t of field) if (acc[t] > acc[top] || (acc[t] === acc[top] && t < top)) top = t;
      const way = [top];
      let to = down[top];
      while (to >= 0 && way.length <= MELT_TILES && land(to) && !taken[to]) {
        way.unshift(to);
        to = down[to];
      }
      const k = to >= 0 ? kind[to] : WaterKind.Land;
      if (k === WaterKind.River || k === WaterKind.Lake || k === WaterKind.Sea) lay(to, way);
    }
  // A melt tile that comes down early can pull an ice tile beside it below its level: such a
  // glacier is left out, and the tiles around it stay land.
  const kept = checkLevels(p, traces);
  const plane = new Uint8Array(w * h);
  for (const t of kept) {
    t.melt.forEach((i, k) => {
      plane[i] = k === t.melt.length - 1 ? GlacierKind.Head : GlacierKind.Melt;
      surface[i] = t.levels[k];
      flow[i] = Math.min(FLOW_CAP, Math.max(1, Math.round(acc[i])));
      dir[i] = sideOf(down[i] - i, w) + 1;
    });
    if (!t.melt.length && kind[t.source] === WaterKind.River) plane[t.source] = GlacierKind.Head;
    t.ice.forEach((i, k) => {
      plane[i] = GlacierKind.Ice;
      surface[i] = t.iceLevels[k];
    });
  }
  return plane;
}

/** The traces of `traces` whose ice keeps its levels with the kept traces' water on the map. */
function checkLevels(p: GlacierInput, traces: Trace[]): Trace[] {
  const { w, h, terrain, drainage: d } = p;
  let kept = traces;
  for (;;) {
    const t = terrain.slice();
    const s = d.surface.slice();
    for (const g of kept)
      g.melt.forEach((i, k) => {
        t[i] = Terrain.Water;
        s[i] = g.levels[k];
      });
    const levels = tileLevels({ w, h, terrain: t, waterSurface: s });
    const next = kept.filter((g) => g.ice.every((i, k) => levels[i] >= g.iceLevels[k]));
    if (next.length === kept.length) return kept;
    kept = next;
  }
}

/** The Dir of the side a tile `delta` away (along a row of `w`) lies on. */
function sideOf(delta: number, w: number): number {
  return delta === -w ? 0 : delta === 1 ? 1 : delta === w ? 2 : 3;
}
