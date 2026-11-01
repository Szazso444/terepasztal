import { tileLevels } from '../world/elevation';
import { Terrain } from '../world/tiles';
import { Headwater, fallDrop, fallEdge, headwaterOf } from '../world/waterfalls';
import {
  Material,
  groundMaterial,
  landscapeNoise,
  materialAt,
  type LandscapeMap,
} from './landscapeModel';

/**
 * How rivers, falls and glaciers are painted: the approved art demo (v9.2, the v7 look) on the
 * game's tiles (#365). The painter draws a tile's material over the whole tile; a river or a
 * glacier is narrower than its tile, so this module says, for a point, how much of it is channel,
 * what the ground beside the channel is, and what a fall or an ice front lays over it.
 *
 * A channel runs through a tile along its legs, the sides water or ice leaves it by: two opposite
 * legs are a straight, two neighbouring ones an arc round the corner they share, one a dead end,
 * and three or four a junction. It meets the same channel at the middle of each edge, so tiles
 * join with no seam. Its edge wanders on world noise, never along a tile.
 */

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Tile offsets of the four sides, in Dir order (N, E, S, W), and each side's bit. */
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

/** A waterfall as the painter needs it. */
export interface Fall {
  /** the tile between whose middles it falls: the shared edge's middle, in map tiles */
  mx: number;
  my: number;
  /** the way it falls, a unit along one axis */
  dx: number;
  dy: number;
  /** whether its slope faces the view (over an E or S edge) */
  near: boolean;
  /** the wild sheet's fall picture for its side */
  sheet: number;
  /** heights of its brink and its foot, in world px */
  zHi: number;
  zLo: number;
  /** where along the sheet it reads, so two falls never match */
  uo: number;
  /** how long its slope is, in tiles */
  w: number;
}

/** The end of a glacier: the ice tile, and the way its melt leaves it. */
export interface IceFront {
  mx: number;
  my: number;
  dx: number;
  dy: number;
  near: boolean;
  sheet: number;
  zHi: number;
  zLo: number;
  /** whether it is the glacier's end, with its cave and its melt; else a step in the ice */
  end: boolean;
}

/** What the painter needs of a map's water, worked out once a map. */
export interface Channels {
  /** bits by side: the sides a channel leaves its tile by; 0 on any other tile */
  legs: Uint8Array;
  /** bits by side: the sides that are still water */
  still: Uint8Array;
  /** bits by side: the sides toward land at another level */
  rim: Uint8Array;
  /** 1 on land beside ice */
  iced: Uint8Array;
  /** the falls that reach each tile */
  falls: Map<number, Fall[]>;
  /** the ice fronts that reach each tile */
  fronts: Map<number, IceFront[]>;
  any: boolean;
}

const cache = new WeakMap<Uint8Array, Channels>();

/** Whether tile `i` is a river's: water with a way to go. An old chunk's water has none. */
export function isRiver(map: LandscapeMap, i: number): boolean {
  return map.terrain[i] === Terrain.Water && !!map.flowDir?.[i];
}

/**
 * The channels of `map`. `levels` is `relief.tiles` where the caller has it; `step` the world px
 * of a level. Kept with the terrain plane: a load or a growth of the map makes a new one, and
 * nothing a player does changes a river.
 */
export function channelsOf(map: LandscapeMap, step: number, relief?: ArrayLike<number>): Channels {
  const known = cache.get(map.terrain);
  if (known) return known;
  const levels = relief ?? tileLevels(map);
  const { w, h, terrain } = map;
  const legs = new Uint8Array(w * h);
  const still = new Uint8Array(w * h);
  const rim = new Uint8Array(w * h);
  const iced = new Uint8Array(w * h);
  const falls = new Map<number, Fall[]>();
  const fronts = new Map<number, IceFront[]>();
  let any = false;
  const add = <T>(on: Map<number, T[]>, i: number, v: T) => {
    const list = on.get(i);
    if (list) list.push(v);
    else on.set(i, [v]);
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const ice = terrain[i] === Terrain.Ice;
      if (!ice && !isRiver(map, i)) continue;
      any = true;
      const head = headwaterOf(map.feature?.[i] ?? 0) === Headwater.Melt;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        const t = terrain[n];
        const melt = headwaterOf(map.feature?.[n] ?? 0) === Headwater.Melt;
        if (ice) {
          if (t === Terrain.Ice || melt) legs[i] |= 1 << d;
          else iced[n] = 1;
        } else if (t === Terrain.Water) {
          legs[i] |= 1 << d;
          if (!isRiver(map, n)) still[i] |= 1 << d;
        } else if (t === Terrain.Ice && head) legs[i] |= 1 << d;
        else if (levels[n] !== levels[i]) rim[i] |= 1 << d;
      }
      const f = map.feature?.[i] ?? 0;
      const drop = fallDrop(f);
      if (drop) {
        const edge = fallEdge(f);
        const nx = x + DX[edge];
        const ny = y + DY[edge];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        const fall: Fall = {
          mx: x + DX[edge] / 2,
          my: y + DY[edge] / 2,
          dx: DX[edge],
          dy: DY[edge],
          near: edge === 1 || edge === 2,
          sheet: edge === 2 ? Material.FallLit : Material.FallShade,
          zHi: levels[i] * step,
          zLo: levels[n] * step,
          uo: (x * 37 + y * 19) % 64,
          w: 0.5,
        };
        for (const t of [i, n]) {
          add(falls, t, fall);
          for (const s of [-1, 1]) {
            const ax = (t % w) - s * fall.dy;
            const ay = Math.floor(t / w) + s * fall.dx;
            if (ax >= 0 && ay >= 0 && ax < w && ay < h) add(falls, ay * w + ax, fall);
          }
        }
      }
    }
  // an ice front stands on the edge between the last ice and its melt
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (terrain[i] !== Terrain.Ice) continue;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        const end = headwaterOf(map.feature?.[n] ?? 0) === Headwater.Melt;
        if (!end && !(terrain[n] === Terrain.Ice && levels[n] < levels[i])) continue;
        const front: IceFront = {
          mx: x + DX[d] / 2,
          my: y + DY[d] / 2,
          dx: DX[d],
          dy: DY[d],
          near: d === 1 || d === 2,
          sheet: d === 2 ? Material.CliffLit : Material.CliffShade,
          zHi: levels[i] * step,
          zLo: levels[n] * step,
          end,
        };
        add(fronts, i, front);
        add(fronts, n, front);
      }
    }
  const made = { legs, still, rim, iced, falls, fronts, any };
  cache.set(map.terrain, made);
  return made;
}

/** How far (a, b), from a tile's middle, lies from the channel along `legs`. */
function channelDistance(legs: number, a: number, b: number): number {
  const n = legs & 1 ? -b : -9; // along the leg north, b < 0
  const e = legs & 2 ? a : -9;
  const s = legs & 4 ? b : -9;
  const o = legs & 8 ? -a : -9;
  const count = (legs & 1) + ((legs >> 1) & 1) + ((legs >> 2) & 1) + ((legs >> 3) & 1);
  if (count === 2) {
    if (legs === 5) return Math.abs(a);
    if (legs === 10) return Math.abs(b);
    // an arc about the corner the two legs share
    const cx = legs & 2 ? 0.5 : -0.5;
    const cy = legs & 4 ? 0.5 : -0.5;
    return Math.abs(Math.hypot(a - cx, b - cy) - 0.5);
  }
  if (!count) return Math.hypot(a, b);
  let d = 9;
  if (n > -9) d = Math.min(d, n > 0 ? Math.abs(a) : Math.hypot(a, b));
  if (e > -9) d = Math.min(d, e > 0 ? Math.abs(b) : Math.hypot(a, b));
  if (s > -9) d = Math.min(d, s > 0 ? Math.abs(a) : Math.hypot(a, b));
  if (o > -9) d = Math.min(d, o > 0 ? Math.abs(b) : Math.hypot(a, b));
  return d;
}

/** Half the river's water at world point (wx, wy): it wanders, so no two banks run parallel. */
function waterline(wx: number, wy: number, seed: number) {
  return (
    0.35 +
    (landscapeNoise(wx * 3.1 + 19, wy * 3.1 + 41, seed) - 0.5) * 0.16 +
    (landscapeNoise(wx * 9.3 + 7, wy * 9.3 + 23, seed) - 0.5) * 0.05
  );
}

/**
 * How far past the limit a side toward land at another level sets, on tile `i` at (a, b): the water
 * keeps off that edge, so the bank lies between it and the slope. Next to a tile along the channel
 * without such a side the limit fades out, so the water never steps at a tile edge.
 */
function rimCap(
  c: Channels,
  map: LandscapeMap,
  i: number,
  a: number,
  b: number,
  wx: number,
  wy: number,
) {
  const bits = c.rim[i];
  if (!bits) return -9;
  const margin = 0.27 + 0.08 * landscapeNoise(wx * 5.1 + 3, wy * 5.1 + 7, map.seed);
  let out = -9;
  for (let d = 0; d < 4; d++) {
    if (!(bits & (1 << d))) continue;
    const toward = DX[d] * a + DY[d] * b;
    const along = DX[d] ? b : a;
    // the neighbour the point faces along the channel
    const step = along > 0 ? 1 : -1;
    const n = DX[d] ? i + step * map.w : i + step;
    const fade =
      n >= 0 && n < c.rim.length && c.rim[n] & (1 << d) ? 0 : smooth((Math.abs(along) - 0.2) / 0.3);
    out = Math.max(out, margin - 0.5 * fade - (0.5 - toward));
  }
  return out;
}

/** What a point of a river tile is: out of `riverAt`. */
export interface RiverPoint {
  /** how much is the river's water, 0 to 1 */
  water: number;
  /** how much of that water has turned to the still water it runs into, 0 to 1 */
  still: number;
  /** how much of the rest is the damp bank, 0 to 1 */
  bank: number;
}
/** The share of the river's water at (x, y) of river tile `i`. */
export function riverAt(
  c: Channels,
  map: LandscapeMap,
  i: number,
  x: number,
  y: number,
  out: RiverPoint,
) {
  const tx = i % map.w;
  const ty = (i - tx) / map.w;
  const a = x - tx;
  const b = y - ty;
  const wx = x + map.originX;
  const wy = y + map.originY;
  const ac = channelDistance(c.legs[i], a, b);
  let d = ac - waterline(wx, wy, map.seed);
  const cap = rimCap(c, map, i, a, b, wx, wy);
  if (cap > d) d = cap;
  let water = 1 - smooth((d + 0.03) / 0.06);
  let still = 0;
  const open = c.still[i];
  if (open)
    for (let s = 0; s < 4; s++) {
      if (!(open & (1 << s))) continue;
      const e = 0.5 - (DX[s] * a + DY[s] * b);
      // beside a mouth no spit of bank is left between the river and the still water
      water = Math.max(water, 1 - smooth((e - 0.27) / 0.06));
      still = Math.max(still, smooth((0.55 - e) / 0.55) * 0.9);
    }
  const n = landscapeNoise(wx * 4.1 + 3, wy * 4.1 + 77, map.seed);
  out.water = water;
  out.still = still;
  out.bank = (1 - smooth((d - 0.01 - 0.11 * n) / 0.09)) * (1 - smooth((ac - 0.46) / 0.05));
}

const point: RiverPoint = { water: 0, still: 0, bank: 0 };
/** How much of (x, y) on river tile `i` is water. The painter and bridges read the same line. */
export function riverWater(c: Channels, map: LandscapeMap, i: number, x: number, y: number) {
  riverAt(c, map, i, x, y, point);
  return point.water;
}

/**
 * The land beside a river at (x, y) of tile `i`: the material of the neighbour the point faces
 * across the nearer edge, else across the other, else the corner's, else the climate's ground.
 */
export function bankMaterial(map: LandscapeMap, i: number, x: number, y: number): number {
  const { w, h, terrain } = map;
  const tx = i % w;
  const ty = (i - tx) / w;
  const fx = x - tx;
  const fy = y - ty;
  const sx = fx > 0 ? 1 : -1;
  const sy = fy > 0 ? 1 : -1;
  const land = (nx: number, ny: number) =>
    nx >= 0 && ny >= 0 && nx < w && ny < h && terrain[ny * w + nx] !== Terrain.Water;
  const pick = (nx: number, ny: number) => materialAt(map, nx, ny);
  const xFirst = Math.abs(fx) >= Math.abs(fy);
  if (xFirst ? land(tx + sx, ty) : land(tx, ty + sy))
    return xFirst ? pick(tx + sx, ty) : pick(tx, ty + sy);
  if (xFirst ? land(tx, ty + sy) : land(tx + sx, ty))
    return xFirst ? pick(tx, ty + sy) : pick(tx + sx, ty);
  if (land(tx + sx, ty + sy)) return pick(tx + sx, ty + sy);
  return groundMaterial(map.climate?.[i] ?? map.biome[i]);
}

/**
 * How much of (x, y) of Ice tile `i` is ice, the rest the foot of the moraine banks either side: the
 * ice channel, flat ice between banks of rubble.
 */
export function iceAt(c: Channels, map: LandscapeMap, i: number, x: number, y: number) {
  const tx = i % map.w;
  const ty = (i - tx) / map.w;
  const wx = x + map.originX;
  const wy = y + map.originY;
  // full width: the banks of rubble lie on the tiles beside it, the edge between wandering
  const line = 0.42 + (landscapeNoise(wx * 3.7 + 11, wy * 3.7 + 2, map.seed) - 0.5) * 0.12;
  return 1 - smooth((channelDistance(c.legs[i], x - tx, y - ty) - line + 0.02) / 0.04);
}

/** How much moraine lies at (x, y) of land tile `i` beside ice: the bank, thinning out away from it. */
export function moraineAt(map: LandscapeMap, i: number, x: number, y: number) {
  const { w, h, terrain } = map;
  const tx = i % w;
  const ty = (i - tx) / w;
  let d = 9;
  for (let s = 0; s < 4; s++) {
    const nx = tx + DX[s];
    const ny = ty + DY[s];
    if (nx < 0 || ny < 0 || nx >= w || ny >= h || terrain[ny * w + nx] !== Terrain.Ice) continue;
    d = Math.min(d, 0.5 - (DX[s] * (x - tx) + DY[s] * (y - ty)));
  }
  const n = landscapeNoise((x + map.originX) * 4.3, (y + map.originY) * 4.3, map.seed + 9);
  return 1 - smooth((d - 0.6 - 0.4 * n) / 0.2);
}

/** A colour with how much it covers: what a fall or a front lays over the painted ground. */
export interface Lay {
  r: number;
  g: number;
  b: number;
  a: number;
  /** how much the ground under it darkens: wet rock */
  dark: number;
}
const CAP = [224, 221, 210];
const KNEE = 14;
const soft = (v: number, cap: number) => {
  const k = cap - KNEE;
  return v <= k ? v : k + KNEE * (1 - Math.exp(-(v - k) / KNEE));
};
function over(o: Lay, r: number, g: number, b: number, a: number) {
  if (a <= 0) return;
  const na = o.a + a * (1 - o.a);
  o.r = (o.r * o.a * (1 - a) + r * a) / na;
  o.g = (o.g * o.a * (1 - a) + g * a) / na;
  o.b = (o.b * o.a * (1 - a) + b * a) / na;
  o.a = na;
}
const n2 = (x: number, y: number) => landscapeNoise(x, y, 1187);
const white = (o: Lay, L: number, a: number) =>
  over(o, soft(224 * L, CAP[0]), soft(236 * L, CAP[1]), soft(232 * L, CAP[2]), a);

/** Broken white clots, measured on screen so a steep bank does not stretch them. */
function spray(o: Lay, sx: number, sy: number, dens: number, seed: number, L: number) {
  if (dens <= 0.02) return;
  const pn =
    0.66 * n2(sx * 0.32 + seed, sy * 0.38 + 3) + 0.34 * n2(sx * 0.75 + 7, sy * 0.85 + seed);
  const thr = 1 - 0.5 * dens;
  const pf = smooth((pn - thr) / 0.035);
  const dp = smooth((n2(sx * 1.5 + 11, sy * 1.7 + seed) - 1 + 0.2 * dens) / 0.03) * 0.85;
  const a = Math.max(pf, dp);
  if (a > 0) white(o, L * 0.96, a * 0.95);
}

/** Reads a fall or cliff picture of the wild sheet: u and v wrap at 1. */
export type SheetRead = (material: number, u: number, v: number, out: number[]) => void;
const texel = [0, 0, 0];

/**
 * What fall `f` lays over map point (x, y) of surface height `z`: the demo's `fallAt`. The sheet is
 * as wide as the river's own water, its sides wandering down the fall line, and over a near edge it
 * starts as the river's dark smooth water and breaks into white streaks toward the foot, landing in
 * a pool of foam a little wider than the river. Over a far edge the water bends over a lip that
 * wanders across the river. `water` is how much of the point is river water.
 */
export function fallAt(
  f: Fall,
  map: LandscapeMap,
  x: number,
  y: number,
  z: number,
  water: number,
  read: SheetRead,
  o: Lay,
) {
  const rx = x - f.mx;
  const ry = y - f.my;
  const along = rx * f.dx + ry * f.dy;
  const across = ry * f.dx - rx * f.dy;
  const aa = Math.abs(across);
  const foot = f.w / 2;
  const t = (along + foot) / f.w;
  const fa = along - foot;
  if (t < (f.near ? -0.3 : -0.62) || fa > 0.8 || aa > 0.72) return;
  const L = 1 + 0.06 * (z / 13.86);
  const tt = t < 0 ? 0 : t > 1 ? 1 : t;
  const sw =
    (n2(along * 9 + f.uo, across * 2 + 3) - 0.5) * 0.1 +
    (n2(along * 23 + 5, across * 6 + f.uo) - 0.5) * 0.045;
  const wl = 0.33;
  const ed = aa - wl - sw;
  const sx = (x - y) * 32;
  const sy = (x + y) * 16 - z;
  let pool = 0;
  if (f.near && fa > -0.14 && fa < 0.62) {
    const pw = wl + 0.1 + 0.05 * n2(along * 6 + f.uo, across * 5 + 2);
    const pc = fa - 0.1;
    const pe = (pc / (pc < 0 ? 0.2 : 0.26)) ** 2 + (aa / pw) ** 2;
    pool = 1 - smooth((pe - 0.86 + (n2(x * 11 + 3, y * 11 + f.uo) - 0.5) * 0.3) / 0.07);
  }
  if (f.near) {
    const ew = (n2(across * 7 + f.uo, 2.1) - 0.5) * 0.16;
    const onSlope = smooth((t + 0.06 + ew) / 0.14) * (1 - smooth((t - 1 - ew) / 0.14));
    if (ed > -0.05 && onSlope > 0) {
      const bw = 0.05 + 0.1 * n2(along * 8 + 3, across * 4 + f.uo);
      o.dark = Math.max(
        o.dark,
        onSlope * smooth((ed + 0.03) / 0.04) * (1 - smooth((ed - bw) / 0.02)) * 0.28,
      );
    }
    const k =
      (1 - smooth((ed + 0.012) / 0.03)) *
      smooth((t + 0.03) / 0.1) *
      (1 - smooth((t - 1.03) / 0.08));
    if (k > 0) {
      const u = -across * 64 + f.uo;
      const v = 2 * ((along + foot) * 16 + f.zHi - z);
      read(f.sheet, u / 64, v / 80, texel);
      let r = texel[0] * L;
      let g = texel[1] * L;
      let b = texel[2] * L;
      const glass = (1 - smooth((t - 0.04) / 0.3)) * 0.6;
      r += (60 * L - r) * glass;
      g += (126 * L - g) * glass;
      b += (134 * L - b) * glass;
      const nw = n2(u * 0.17 + x * 7, v * 0.035 + y * 5) + 0.35 * n2(u * 0.5 + 3, v * 0.09 + 1);
      const wh = Math.min(1, smooth((t - 0.18) / 0.6) * (0.3 + 0.7 * smooth((nw - 0.5) / 0.45)));
      const wl2 = L * (0.95 + 0.08 * n2(u * 0.3, v * 0.2 + 9));
      r += (soft(224 * wl2, CAP[0]) - r) * wh * 0.85;
      g += (soft(236 * wl2, CAP[1]) - g) * wh * 0.85;
      b += (soft(232 * wl2, CAP[2]) - b) * wh * 0.85;
      over(o, r, g, b, k);
    }
    if (ed > -0.08) {
      const reach = 0.04 + 0.13 * tt + 0.06 * n2(along * 5 + f.uo, across * 3 + 7);
      const on = smooth((t + 0.1 + ew) / 0.2) * (1 - smooth((fa - 0.2) / 0.2));
      const dens =
        on *
        (0.42 + 0.8 * tt) *
        smooth((ed + 0.08) / 0.05) *
        (1 - smooth((ed - reach * 0.4) / (reach * 0.6 + 0.02)));
      spray(o, sx, sy, Math.min(1, dens), f.uo, L);
    }
  } else {
    // over a far edge: the lip wanders up and down the river and bends over into white water
    const inW = 1 - smooth((ed + 0.01) / 0.04);
    const lip = 0.12 + 0.14 * (n2(across * 3.3 + f.uo, 4.1) - 0.5) + 0.12 * (aa / wl) ** 2 * -1;
    const u = t - lip;
    if (inW > 0 && t < 0.5) {
      over(
        o,
        26 * L,
        70 * L,
        80 * L,
        smooth((u + 0.4) / 0.28) * (1 - smooth(u / 0.02)) * 0.42 * inW,
      );
      const reach = 0.1 + 0.56 * smooth((n2(across * 2.6 + f.uo + 11, 5.3) - 0.3) / 0.45);
      const tg = smooth((u + reach) / (0.8 * reach)) * (1 - smooth((u - 0.03) / 0.05));
      if (tg > 0) {
        const tn = n2(across * 22 + f.uo, u * 2.4 + 5) + 0.35 * n2(across * 53 + 3, u * 5.5 + f.uo);
        white(o, L * 0.96, smooth((tn - 1.12 + 0.8 * tg) / 0.035) * tg * 0.94 * inW);
      }
      const ww = smooth(u / 0.025) * (1 - smooth((t - 0.34) / 0.08));
      if (ww > 0) {
        const cl = smooth(
          (n2(across * 19 + f.uo, u * 14 + 2) + 0.45 * n2(across * 43 + 7, u * 30 + f.uo) - 0.62) /
            0.3,
        );
        white(o, L * 0.95, ww * (0.7 + 0.28 * cl) * inW);
      }
    }
    if (t > -0.6 && t < 0.9 && ed < 0.2) {
      const sb = smooth((t + 0.06) / 0.08) * (1 - smooth((t - 0.6) / 0.15));
      spray(o, sx, sy, sb * 0.7 * (1 - smooth((ed - 0.04) / 0.08)), f.uo + 17, L);
    }
  }
  // where the water lands: white foam fanning down the river, over dark pool water
  if (fa > -0.14) {
    const inCh = Math.max((1 - smooth((ed + 0.005) / 0.035)) * (fa < 0 ? 1 : water), pool);
    const lob =
      (n2(across * 7 + f.uo, fa * 5 + 3) - 0.5) * 0.3 +
      (n2(across * 17 + 1, fa * 11 + f.uo) - 0.5) * 0.1;
    const reach =
      (f.near ? 0.2 : 0.12) + (f.near ? 0.3 : 0.24) * (1 - Math.min(1, aa / 0.35)) + lob;
    const dens = smooth((fa + 0.12) / 0.1) * (1 - smooth((fa - reach) / 0.14)) * inCh;
    if (fa > -0.06) {
      const deep = Math.max(
        inCh * smooth((fa + 0.04) / 0.08) * (1 - smooth((fa - 0.5) / 0.22)) * (f.near ? 0.42 : 0.3),
        pool * (1 - water) * 0.94,
      );
      over(o, 26 * L, 66 * L, 78 * L, deep);
      if (f.near) {
        const rimFoam =
          Math.min(1, pool * (1 - pool) * 5) *
          smooth((n2(x * 13 + f.uo, y * 13 + 5) + 0.4 * n2(x * 29 + 3, y * 29 + 1) - 0.5) / 0.08) *
          (1 - water * 0.5);
        white(o, L, rimFoam * 0.92);
      }
    }
    const pat = smooth(
      (0.7 * n2(across * 11 + f.uo, fa * 9 + 3) + 0.5 * n2(across * 27, fa * 21) - 0.5) / 0.09,
    );
    white(o, L * (0.93 + 0.12 * n2(x * 15 + 5, y * 15)), dens * (0.22 + 0.75 * pat));
  }
}

/** Where the cave of an ice front opens along its edge, and how far either way, in tiles. */
const CAVE_C = 0.035;
const CAVE_HW = 0.23;

/**
 * What ice front `f` lays over map point (x, y) of surface height `z`: on the bank between the last
 * ice and its melt, the ice cliff with a broken lip and a low dark cave, its floor the meltwater,
 * and past the foot a milky tongue of melt between piles of rubble. A front that faces away shows
 * only the tongue. The ice's edge is one clean step, so a player sees which ice is the higher.
 */
export function frontAt(f: IceFront, x: number, y: number, z: number, read: SheetRead, o: Lay) {
  const e = (x - f.mx) * f.dx + (y - f.my) * f.dy;
  const al = (x - f.mx) * f.dy - (y - f.my) * f.dx;
  if (e < -0.3 || e > 0.8 || Math.abs(al) > 0.6) return;
  const face = f.zHi - f.zLo;
  const hF = z - f.zLo;
  const depth = f.zHi - z;
  if (f.near && hF > 0.2 && depth > -0.2 && e < 0.3) {
    const half = 0.42 + 0.07 * (1 - hF / face) + 0.05 * (n2(depth * 0.4 + al * 3, 17.3) - 0.5);
    const iw = smooth((half - Math.abs(al)) / 0.04);
    if (iw > 0) {
      read(f.sheet, al + 0.5, depth / 16, texel);
      const lum = texel[0] * 0.3 + texel[1] * 0.59 + texel[2] * 0.11;
      const lc = (168 + (lum - 172) * 1.3) * (1.04 - 0.2 * (1 - hF / face));
      let r = texel[0] + (lc * 0.72 - texel[0]) * 0.88;
      let g = texel[1] + (lc * 1.0 - texel[1]) * 0.88;
      let b = texel[2] + (lc * 1.12 - texel[2]) * 0.88;
      const block = Math.floor(al * 15 + 0.6 * n2(al * 3 + 1, 5.1));
      const jag = 0.3 + 1.8 * n2(block * 7.3, 2.1);
      if (depth < jag) {
        const lit = 0.92 + 0.1 * n2(block * 3.1, 9.2);
        r = 214 * lit;
        g = 222 * lit;
        b = 228 * lit;
      }
      const dirt = 1 - smooth((hF - 0.6 - 1.2 * n2(al * 11 + 3, 2.2)) / 0.8);
      r += (118 - r) * dirt * 0.6;
      g += (112 - g) * dirt * 0.6;
      b += (100 - b) * dirt * 0.6;
      const cx = (al - CAVE_C) / CAVE_HW;
      if (f.end && Math.abs(cx) < 1) {
        const H =
          face * (0.52 + 0.06 * n2(al * 7 + 2, 4.4)) * Math.sqrt(1 - cx * cx) * (1 + 0.28 * cx);
        if (hF < H) {
          const q = hF / H;
          const deep = smooth((0.8 - Math.abs(cx)) / 0.5) * smooth((0.95 - q) / 0.45);
          let mr = 92 + (22 - 92) * deep;
          let mg = 160 + (60 - 160) * deep;
          let mb = 188 + (96 - 188) * deep;
          const floor = 1 - smooth((hF - 0.4) / 0.9);
          mr += (84 - mr) * floor;
          mg += (160 - mg) * floor;
          mb += (170 - mb) * floor;
          const k = smooth((H - hF) / 0.8);
          r += (mr - r) * k;
          g += (mg - g) * k;
          b += (mb - b) * k;
        }
      }
      over(o, r, g, b, iw);
    }
  }
  if (f.end && e > 0.1 && e < 0.8) {
    const past = e - 0.25;
    const nA = n2(x * 7 + 3, y * 7 + 11);
    const nB = n2(x * 17 + 5, y * 17 + 2);
    const ac = Math.abs(al - CAVE_C);
    const tw = CAVE_HW * (0.85 + 0.9 * Math.max(0, past)) + (nA - 0.5) * 0.08;
    const tg =
      (1 - smooth((ac - tw) / 0.04)) *
      (1 - smooth((past - 0.14 - 0.3 * nA) / 0.12)) *
      (0.65 + 0.35 * smooth((nB - 0.35) / 0.3));
    over(o, soft(150, CAP[0]), soft(204, CAP[1]), soft(204, CAP[2]), tg * 0.8);
    white(o, 1, tg * smooth((nB - 0.62) / 0.1) * (1 - smooth((past - 0.22) / 0.1)));
  }
}
