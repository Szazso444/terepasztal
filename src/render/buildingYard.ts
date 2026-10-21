import type { FrameGround, Side } from '../art/buildingGround';
import { DIR_DX, DIR_DY } from '../engine/iso';
import { Material } from './landscapeModel';
import { surfaceColor, surfaceNoise } from './terrainMaterials';
import type { PavingDoor } from './townPaving';

/**
 * Building yards (#436, step 2 of the ground fit the author approved on the art demo,
 * 2026-10-13): a worn patch painted into the ground under each building's foot and 0.1 to 0.2
 * tile round it (`foot` in src/art/buildingGround.json, #435), with a noise-broken edge that
 * blends into the tile's own ground, the way the town paving is painted (townPaving.ts), and a
 * worn path from each door out to the yard's edge, or on to the road next door. A station's and a
 * warehouse's yard is a platform that reaches the track's ballast and ends in a straight kerb.
 *
 * Everything here is a function of the map point and the yards, never of the chunk being painted,
 * so neighbouring chunks agree pixel for pixel. Points are map tile coordinates (a tile's centre at
 * whole numbers, as the painter reads them); the noise runs on world coordinates (map plus origin),
 * so a map that grows keeps its picture. Pure: the paint workers and the tests run it.
 */

/** The ground a yard is worn into, by the building that stands on it (`yardKind`). */
export type YardKind = 'earth' | 'sand' | 'gravel' | 'cinder' | 'grit';

/**
 * Each kind's colour before the light. Earth and sand are ground and take the season's tint like
 * it; gravel, cinder and grit are stone and keep their colour under it, as the paving does. All
 * stay well below the semantic colours (the cursor white, the selection amber).
 */
export const YARD_COLOURS: Readonly<Record<YardKind, readonly [number, number, number]>> = {
  // trodden earth (the farm, the mill, the sawmill)
  earth: [142, 116, 82],
  // packed sand (the pump by the water; earth on sand and desert)
  sand: [178, 156, 112],
  // warm grey gravel (stations, warehouses, the town), near the ballast's grey
  gravel: [150, 145, 135],
  // grey-brown cinder, no green in it (the railway's works and the industry)
  cinder: [126, 120, 107],
  // pale stone grit (the quarry)
  grit: [166, 160, 150],
};
/** How much of the ground's own colour shows inside a yard of each kind. */
const MIX: Readonly<Record<YardKind, number>> = {
  earth: 0.12,
  sand: 0.15,
  gravel: 0,
  cinder: 0,
  grit: 0,
};
/** How far past its foot each kind of yard reaches (tiles), before its edge breaks up. */
export const YARD_MARGIN: Readonly<Record<YardKind, number>> = {
  earth: 0.2,
  sand: 0.14,
  gravel: 0.12,
  cinder: 0.1,
  grit: 0.18,
};
/** Stone: it keeps its own colour under the season's tint. */
const STONY: Readonly<Record<YardKind, boolean>> = {
  earth: false,
  sand: false,
  gravel: true,
  cinder: true,
  grit: true,
};
/** The kinds as numbers, the order the painter keeps them in. */
const KINDS: readonly YardKind[] = ['earth', 'sand', 'gravel', 'cinder', 'grit'];

/** The kerb's coping stones and its face (the stone of the station's platform). */
const COPING = [176, 170, 160] as const,
  KERB_FACE = [170, 163, 152] as const;
/**
 * How far a platform's kerb stands past its footprint toward the track (tiles): its face and the
 * dark line at its foot end where the ballast's fringe begins, 0.29 tile and a little more from the
 * track's middle (trackIllustrated.ts), so the platform reaches the ballast.
 */
export const KERB_OUT = 0.14;
/** The edge band over which a yard fades into the ground (tiles), and its wobble. */
const EDGE = 0.07,
  WOBBLE = 0.06,
  RIPPLE = 0.025;
/** A door path's half width at the door (tiles); it narrows by 30 % to its end. */
const PATH_HALF = 0.075;
/** How far past a yard's margin a door path runs when no road is next door (tiles). */
const PATH_PAST = 0.16;
/**
 * The most a yard's picture reaches past its shape (tiles): its margin plus the edge band and the
 * wobble, and the kerb's foot line. Farther out it changes nothing (`yardTiles`).
 */
const REACH = EDGE + WOBBLE + RIPPLE + 0.05;

/** Seeds of the yards' noise. */
const SEED_WOBBLE = 4451,
  SEED_RIPPLE = 4452,
  SEED_BREAK = 4453,
  SEED_TONE = 4454,
  SEED_GRAIN = 4455,
  SEED_LUMP = 4456,
  SEED_RUST = 4457,
  SEED_PATCH = 4458,
  SEED_JOINT = 4459;

/** The direction each side faces, in map tiles. */
const SIDE: Readonly<Record<Side, readonly [number, number]>> = {
  N: [DIR_DX[0], DIR_DY[0]],
  E: [DIR_DX[1], DIR_DY[1]],
  S: [DIR_DX[2], DIR_DY[2]],
  W: [DIR_DX[3], DIR_DY[3]],
};

/**
 * A platform out to a kerb toward the track: the anchor, the direction toward the track, the kerb's
 * distance from the anchor along it, and the platform's stretch along the kerb (along `-dy, dx`).
 */
export interface Kerb {
  x: number;
  y: number;
  dx: number;
  dy: number;
  at: number;
  from: number;
  to: number;
  /** the kerb's face shows: it faces the camera (S or E) */
  face: boolean;
}
/** A worn path from a door: where it starts, its direction and length; `open` runs on to a road. */
export interface YardPath {
  x: number;
  y: number;
  dx: number;
  dy: number;
  length: number;
  open: boolean;
}
/** A building's yard as the painter reads it, in map tile coordinates. */
export interface Yard {
  kind: YardKind;
  /** the foot's corners n, e, s, w (far, right, near, left), x and y each */
  foot: number[];
  margin: number;
  kerb: Kerb | null;
  paths: YardPath[];
}
/** Where a building stands: its anchor (the footprint's centre) and the scale it is drawn at. */
export interface YardSite {
  x: number;
  y: number;
  scale: number;
  /** its tile's ground is sand or desert: a farm's earth is packed sand there */
  sandy: boolean;
}

/** World px from an anchor, on the ground, to map tiles from it. */
export function groundTiles(x: number, y: number): [number, number] {
  return [x / 64 + y / 32, y / 32 - x / 64];
}

/** The building a frame key names (`structures/station_2_r1` is a `station`). */
function nameOf(frame: string) {
  return frame.replace(/^structures\//, '');
}
/**
 * The yard of the building a frame shows: trodden earth at the farm, the mills and the sawmill
 * (packed sand on sand or desert ground), packed sand at the pump by the water, warm grey gravel
 * at stations, warehouses, the town hall and the houses, pale grit at the quarry, and grey-brown
 * cinder at the railway's works (the depots, the fuel stop, the water tower, the substation) and
 * at every other works.
 */
export function yardKind(frame: string, sandy: boolean): YardKind {
  const name = nameOf(frame);
  if (/^(farm|windmill|grinder|lumber)/.test(name)) return sandy ? 'sand' : 'earth';
  if (/^pump/.test(name)) return 'sand';
  if (/^(station|warehouse|town)/.test(name)) return 'gravel';
  if (/^quarry/.test(name)) return 'grit';
  return 'cinder';
}
/** Does the building's yard end in a platform's kerb toward the track? Stations and warehouses. */
export function hasKerb(frame: string) {
  return /^(station|warehouse)_/.test(nameOf(frame));
}

/**
 * The yard of the building showing `frame`, with its ground data `ground`, standing at `site`.
 * `doors` are street doors (#406, `streetDoors`); those on a tile of its footprint get a path
 * too where the picture does not show them (a wall the camera does not see), from the middle of
 * their tile's share of the foot's wall. `road` says whether a road lies on a tile: a path whose
 * door reaches one runs on to its middle.
 */
export function buildingYard(
  frame: string,
  ground: FrameGround,
  site: YardSite,
  doors: readonly PavingDoor[],
  road: (x: number, y: number) => boolean,
): Yard {
  const kind = yardKind(frame, site.sandy),
    margin = YARD_MARGIN[kind],
    k = site.scale;
  const foot: number[] = [];
  for (const [px, py] of ground.foot) {
    const [tx, ty] = groundTiles(px * k, py * k);
    foot.push(site.x + tx, site.y + ty);
  }
  const { x: cx, y: cy } = cornerTile(ground, site.x, site.y);
  let kerb: Kerb | null = null;
  if (hasKerb(frame)) {
    const [ux, uy] = SIDE[ground.front.side];
    let edge = -Infinity,
      from = Infinity,
      to = -Infinity;
    for (const [dx, dy] of ground.footprint)
      edge = Math.max(edge, (cx + dx - site.x) * ux + (cy + dy - site.y) * uy + 0.5);
    for (let i = 0; i < 8; i += 2) {
      const v = -(foot[i] - site.x) * uy + (foot[i + 1] - site.y) * ux;
      from = Math.min(from, v);
      to = Math.max(to, v);
    }
    kerb = {
      x: site.x,
      y: site.y,
      dx: ux,
      dy: uy,
      at: edge + KERB_OUT,
      from,
      to,
      face: ground.front.side === 'S' || ground.front.side === 'E',
    };
  }
  const paths: YardPath[] = [];
  const path = (x: number, y: number, side: Side, rx: number, ry: number) => {
    const [dx, dy] = SIDE[side],
      open = road(rx, ry);
    paths.push({
      x,
      y,
      dx,
      dy,
      length: open ? (rx - x) * dx + (ry - y) * dy - 0.05 : margin + PATH_PAST,
      open,
    });
  };
  const shown = new Set<string>();
  for (const d of ground.doors) {
    // the door's point is where its opening meets the ground in the picture, a step or more above
    // its wall's foot line: the door stands on that line, straight below the point
    const [a, b] = WALL[d.side],
      [ax, ay] = ground.foot[a],
      [bx, by] = ground.foot[b],
      t = bx === ax ? 0.5 : Math.max(0, Math.min(1, (d.point[0] - ax) / (bx - ax))),
      [tx, ty] = groundTiles((ax + (bx - ax) * t) * k, (ay + (by - ay) * t) * k);
    path(site.x + tx, site.y + ty, d.side, cx + d.reach[0], cy + d.reach[1]);
    shown.add(`${cx + d.tile[0]},${cy + d.tile[1]},${d.side}`);
  }
  const inside = new Set(ground.footprint.map(([dx, dy]) => `${cx + dx},${cy + dy}`));
  for (const d of doors) {
    const side = (['N', 'E', 'S', 'W'] as const)[d.side];
    if (!inside.has(`${d.tile.x},${d.tile.y}`) || shown.has(`${d.tile.x},${d.tile.y},${side}`))
      continue;
    const [x, y] = wallPoint(foot, side, d.tile.x, d.tile.y);
    path(x, y, side, d.tile.x + DIR_DX[d.side], d.tile.y + DIR_DY[d.side]);
  }
  return { kind, foot, margin, kerb, paths };
}

/** The footprint's corner tile (its lowest x and y) of a building anchored at map point (x, y). */
function cornerTile(ground: FrameGround, x: number, y: number) {
  // the anchor is the middle of its tiles
  let mx = 0,
    my = 0;
  for (const [dx, dy] of ground.footprint) {
    mx += dx / ground.footprint.length;
    my += dy / ground.footprint.length;
  }
  return { x: Math.round(x - mx), y: Math.round(y - my) };
}
/** The tiles a building anchored at map point (x, y) covers. */
export function footprintTiles(ground: FrameGround, x: number, y: number) {
  const corner = cornerTile(ground, x, y);
  return ground.footprint.map(([dx, dy]) => ({ x: corner.x + dx, y: corner.y + dy }));
}

/** The foot's corners (n, e, s, w) that each side's wall runs between. */
const WALL: Readonly<Record<Side, readonly [number, number]>> = {
  N: [0, 1],
  E: [1, 2],
  S: [2, 3],
  W: [3, 0],
};
/**
 * Where a door on `side` of tile (tx, ty) meets the foot's wall on that side: the point of the
 * wall level with the tile's middle along it.
 */
function wallPoint(foot: readonly number[], side: Side, tx: number, ty: number): [number, number] {
  const [a, b] = WALL[side],
    ax = foot[a * 2],
    ay = foot[a * 2 + 1],
    bx = foot[b * 2],
    by = foot[b * 2 + 1];
  const [ux, uy] = SIDE[side];
  // along the wall, perpendicular to the side's direction: (-uy, ux)
  const along = (x: number, y: number) => -(x - tx) * uy + (y - ty) * ux,
    da = along(ax, ay),
    db = along(bx, by),
    t = da === db ? 0.5 : Math.max(0, Math.min(1, da / (da - db)));
  return [ax + (bx - ax) * t, ay + (by - ay) * t];
}

/** The box of map points a yard's picture can reach: x0, y0, x1, y1. */
function yardBox(yard: Yard): [number, number, number, number] {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const take = (x: number, y: number, r: number) => {
    x0 = Math.min(x0, x - r);
    y0 = Math.min(y0, y - r);
    x1 = Math.max(x1, x + r);
    y1 = Math.max(y1, y + r);
  };
  const r = yard.margin + REACH;
  for (let i = 0; i < 8; i += 2) take(yard.foot[i], yard.foot[i + 1], r);
  const kb = yard.kerb;
  if (kb)
    for (const along of [kb.from, kb.to])
      take(kb.x + kb.dx * kb.at - kb.dy * along, kb.y + kb.dy * kb.at + kb.dx * along, r);
  for (const p of yard.paths) {
    take(p.x, p.y, PATH_HALF + 0.08);
    take(p.x + p.dx * p.length, p.y + p.dy * p.length, PATH_HALF + 0.08);
  }
  return [x0, y0, x1, y1];
}
/**
 * The tiles (`y * w + x`) whose picture a yard can change: every point it paints lies on one of
 * them. Placing or removing the building repaints these.
 */
export function yardTiles(yard: Yard, w: number, h: number): number[] {
  const [x0, y0, x1, y1] = yardBox(yard),
    out: number[] = [];
  for (let y = Math.max(0, Math.round(y0)); y <= Math.min(h - 1, Math.round(y1)); y++)
    for (let x = Math.max(0, Math.round(x0)); x <= Math.min(w - 1, Math.round(x1)); x++)
      out.push(y * w + x);
  return out;
}
/** Whether two yards paint the same picture. */
export function sameYard(a: Yard | null, b: Yard | null) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const sstep = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * Distance from (px, py) to the convex quadrilateral `q` (four corners, x and y each, in either
 * turn): negative inside, in tiles.
 */
function quadDistance(q: Float64Array, o: number, px: number, py: number) {
  let best = Infinity,
    inside = 0;
  for (let i = 0; i < 4; i++) {
    const ax = q[o + i * 2],
      ay = q[o + i * 2 + 1],
      j = (i + 1) & 3,
      bx = q[o + j * 2],
      by = q[o + j * 2 + 1],
      ex = bx - ax,
      ey = by - ay,
      wx = px - ax,
      wy = py - ay,
      cross = ex * wy - ey * wx;
    inside += cross > 0 ? 1 : cross < 0 ? -1 : 0;
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1))),
      dx = wx - ex * t,
      dy = wy - ey * t,
      d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  const d = Math.sqrt(best);
  return inside === 4 || inside === -4 ? -d : d;
}

/** Floats per yard in `BuildingYards`' table. */
const STRIDE = 20;
/** Floats per path. */
const PATH = 6;

/**
 * The yards of one map, as the painter reads them at any map point: which tiles they reach, and
 * each yard's weight and colour there.
 */
export class BuildingYards {
  /** Per yard: kind, margin, foot (8), kerb (x, y, dx, dy, at, from, to, face; NaN for none), paths. */
  private readonly table: Float64Array;
  private readonly paths: Float64Array;
  /** Per yard: its first path and how many. */
  private readonly pathAt: Int32Array;
  /** The yards that reach each tile (indices into the table), for the tiles flagged. */
  private readonly at = new Map<number, number[]>();
  private readonly flags: Uint8Array;
  /** The last point read (`weigh`): its weight, the share of path in it and its yard. */
  weight = 0;
  path = 0;
  private yard = -1;
  /** The kerb's darkening at its foot, at the last point read (1 for none). */
  private foot = 1;
  /** The kerb's coping and face at the last point read. */
  private coping = 0;
  private face = 0;
  constructor(
    readonly w: number,
    readonly h: number,
    readonly originX: number,
    readonly originY: number,
    yards: readonly Yard[],
  ) {
    const n = yards.length;
    this.table = new Float64Array(n * STRIDE);
    this.pathAt = new Int32Array(n * 2);
    let paths = 0;
    for (const y of yards) paths += y.paths.length;
    this.paths = new Float64Array(paths * PATH);
    this.flags = new Uint8Array(w * h);
    let p = 0;
    yards.forEach((yard, i) => {
      const o = i * STRIDE,
        t = this.table;
      t[o] = KINDS.indexOf(yard.kind);
      t[o + 1] = yard.margin;
      for (let c = 0; c < 8; c++) t[o + 2 + c] = yard.foot[c];
      const kb = yard.kerb;
      if (kb) {
        t[o + 10] = kb.x;
        t[o + 11] = kb.y;
        t[o + 12] = kb.dx;
        t[o + 13] = kb.dy;
        t[o + 14] = kb.at;
        t[o + 15] = kb.from;
        t[o + 16] = kb.to;
        t[o + 17] = kb.face ? 1 : 0;
      } else t[o + 10] = NaN;
      this.pathAt[i * 2] = p;
      this.pathAt[i * 2 + 1] = yard.paths.length;
      for (const q of yard.paths) {
        this.paths.set([q.x, q.y, q.dx, q.dy, q.length, q.open ? 1 : 0], p * PATH);
        p++;
      }
      for (const k of yardTiles(yard, w, h)) {
        this.flags[k] = 1;
        const list = this.at.get(k);
        if (list) list.push(i);
        else this.at.set(k, [i]);
      }
    });
  }
  /** Can a yard change the picture anywhere on the tile with index `k` (`y * w + x`)? */
  near(k: number) {
    return this.flags[k] === 1;
  }
  /** Does the point read last (`weigh`) take paint: a yard, or a kerb's foot line? */
  get touched() {
    return this.weight > 0 || this.foot < 1;
  }
  /**
   * How much yard there is at map point (x, y) on tile `k`, into `weight` (0 to 1), with the share
   * of door path in it into `path`; the strongest yard there is the one painted. 0 off every yard.
   */
  weigh(x: number, y: number, k: number) {
    this.weight = this.path = 0;
    this.yard = -1;
    this.foot = 1;
    this.coping = this.face = 0;
    const list = this.flags[k] === 1 ? this.at.get(k) : undefined;
    if (!list) return 0;
    const wx = x + this.originX,
      wy = y + this.originY,
      t = this.table,
      ps = this.paths;
    // the wobble of the edges, read only once a yard is near enough for it to matter
    let wobble = NaN,
      best = 0,
      bestPath = 0,
      foot = 1,
      coping = 0,
      face = 0;
    for (const i of list) {
      const o = i * STRIDE,
        margin = t[o + 1];
      let d = quadDistance(t, o + 2, x, y),
        e = -Infinity,
        along = 0;
      const kerbed = !Number.isNaN(t[o + 10]);
      if (kerbed) {
        // the platform: from the anchor out to the kerb, along the foot's stretch
        const rx = x - t[o + 10],
          ry = y - t[o + 11],
          ux = t[o + 12],
          uy = t[o + 13],
          u = rx * ux + ry * uy,
          at = t[o + 14];
        along = -rx * uy + ry * ux;
        e = u - at;
        const qu = Math.abs(u - at / 2) - at / 2,
          qv = Math.abs(along - (t[o + 15] + t[o + 16]) / 2) - (t[o + 16] - t[o + 15]) / 2,
          box =
            Math.sqrt(Math.max(qu, 0) ** 2 + Math.max(qv, 0) ** 2) + Math.min(Math.max(qu, qv), 0);
        if (box < d) d = box;
      }
      // the nearest door path, before the wobble: how far out of it the point lies
      const p0 = this.pathAt[i * 2],
        pn = this.pathAt[i * 2 + 1];
      let pathOut = Infinity;
      for (let p = p0; p < p0 + pn; p++) {
        const q = p * PATH,
          len = ps[q + 4];
        let u = ((x - ps[q]) * ps[q + 2] + (y - ps[q + 1]) * ps[q + 3]) / len;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const ex = x - (ps[q] + ps[q + 2] * len * u),
          ey = y - (ps[q + 1] + ps[q + 3] * len * u);
        pathOut = Math.min(pathOut, Math.sqrt(ex * ex + ey * ey) - PATH_HALF * (1 - 0.3 * u));
      }
      // too far from the yard, its paths and its kerb for any wobble to reach the point
      if (
        d - WOBBLE - RIPPLE >= margin + EDGE &&
        pathOut - (WOBBLE + RIPPLE) * 0.35 >= 0.04 &&
        !(kerbed && e > -0.08 && e < 0.06)
      )
        continue;
      if (Number.isNaN(wobble))
        wobble =
          (surfaceNoise(wx * 5.3, wy * 5.3, SEED_WOBBLE) - 0.5) * 2 * WOBBLE +
          (surfaceNoise(wx * 13, wy * 13, SEED_RIPPLE) - 0.5) * 2 * RIPPLE;
      d += wobble;
      let w = 1 - sstep((d - margin + EDGE) / (2 * EDGE));
      // its outer part breaks up into the ground round it
      if (w > 0 && d > 0)
        w *=
          1 -
          (t[o] === 3 ? 0.6 : 0.55) *
            sstep((surfaceNoise(wx * 9, wy * 9, SEED_BREAK) - 0.58) / 0.12) *
            sstep(d / margin);
      let cop = 0,
        fc = 0,
        ft = 1,
        // what is left past the kerb: nothing of the yard nor of a door path
        cut = 1;
      if (kerbed) {
        // the kerb fades out at the platform's ends; past them the yard stops a little further on
        cut = 1 - sstep((e - 0.04) / 0.012);
        const ends =
          sstep((along - t[o + 15] - 0.02) / 0.06) * sstep((t[o + 16] - along - 0.02) / 0.06);
        if (ends > 0 && e > -0.08 && e < 0.06) {
          // a kerb facing the camera shows its face past the coping; one facing away does not
          const shows = t[o + 17] === 1,
            edge = shows ? 0.012 : 0;
          cop = (sstep((e + 0.07) / 0.008) - sstep((e + (shows ? 0.018 : 0)) / 0.006)) * ends;
          fc = shows ? (sstep((e + 0.018) / 0.006) - sstep((e - edge) / 0.006)) * ends : 0;
          const past = sstep((e - edge) / 0.006) * ends;
          cut *= 1 - past;
          ft = 1 - 0.5 * past * (1 - sstep((e - edge - 0.018) / 0.012));
        }
        w *= cut;
      }
      let pw = 0;
      for (let p = p0; p < p0 + pn; p++) {
        const q = p * PATH,
          len = ps[q + 4];
        let u = ((x - ps[q]) * ps[q + 2] + (y - ps[q + 1]) * ps[q + 3]) / len;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const ex = x - (ps[q] + ps[q + 2] * len * u),
          ey = y - (ps[q + 1] + ps[q + 3] * len * u),
          ds = Math.sqrt(ex * ex + ey * ey) + wobble * 0.35,
          half = PATH_HALF * (1 - 0.3 * u),
          s = (1 - sstep((ds - half) / 0.04)) * (ps[q + 5] ? 1 : 1 - sstep((u - 0.7) / 0.3));
        if (s > pw) pw = s;
      }
      pw *= cut;
      const here = Math.max(w, pw);
      if (here > best || (cop + fc > coping + face && here >= best)) {
        best = here;
        bestPath = pw;
        this.yard = i;
        coping = cop;
        face = fc;
      }
      if (ft < foot) foot = ft;
    }
    this.weight = best;
    this.path = bestPath;
    this.foot = foot;
    this.coping = coping;
    this.face = face;
    return best;
  }
  /**
   * Paints the yard read last (`weigh`) at map point (x, y) over `ground`, the ground's colour
   * before the season's tint, in place. `share` scales the yard's weight there (the land's share
   * of the point, less on a steep bank); `tint` is the season's tint the painter puts on the
   * ground after, which a stone yard is kept out of. `source` is the surface sheet the painter
   * reads, whose desert ground gives the yard its broad clusters; `part` a scratch colour.
   */
  paint(
    x: number,
    y: number,
    ground: number[],
    share: number,
    tint: number,
    source: Uint8ClampedArray,
    part: number[],
  ) {
    // the kerb's foot line is the yard's paint too: it takes only the yard's share of the point
    const i = this.yard,
      foot = 1 - (1 - this.foot) * share;
    if (i < 0) {
      if (foot < 1) for (let c = 0; c < 3; c++) ground[c] *= foot;
      return;
    }
    const kind = KINDS[this.table[i * STRIDE]],
      wt = this.weight * share,
      wx = x + this.originX,
      wy = y + this.originY,
      stony = STONY[kind];
    // the game's desert ground for its broad clusters, recoloured
    surfaceColor(source, Material.Desert, wx, wy, part);
    const texture = (part[0] + part[1] + part[2]) / desertMean(source);
    let k =
      1 +
      (texture - 1) * (stony ? 0.6 : 0.85) +
      (surfaceNoise(wx * 4.1, wy * 4.1, SEED_TONE) - 0.5) * 0.12;
    if (stony) {
      // stones about a world px across, lit on their upper left, with darker gaps between them
      const f = kind === 'grit' ? 30 : 36,
        p = surfaceNoise(wx * f, wy * f, SEED_GRAIN),
        lit = surfaceNoise((wx - 0.0075) * f, (wy - 0.0025) * f, SEED_GRAIN);
      k *=
        1 + sstep((p - 0.54) / 0.08) * (0.02 + 0.45 * (p - lit)) - 0.05 * sstep((0.42 - p) / 0.08);
      // cinder in small patches: dark clinker lumps
      if (kind === 'cinder')
        k *= 1 - 0.16 * sstep((surfaceNoise(wx * 17, wy * 17, SEED_LUMP) - 0.66) / 0.05);
    } else k *= 1 + 0.07 * sstep((surfaceNoise(wx * 2.2, wy * 2.2, SEED_PATCH) - 0.6) / 0.15);
    const base = YARD_COLOURS[kind],
      mix = MIX[kind];
    let r = base[0] * (1 - mix) + ground[0] * mix,
      g = base[1] * (1 - mix) + ground[1] * mix,
      b = base[2] * (1 - mix) + ground[2] * mix;
    if (kind === 'cinder') {
      const rust = sstep((surfaceNoise(wx * 7, wy * 7, SEED_RUST) - 0.66) / 0.1) * 0.5;
      r += 14 * rust;
      g += 4 * rust;
    }
    // a path is trodden harder: a little darker
    k *= 1 - 0.08 * this.path;
    // the platform's kerb: pale coping stones with joints, then the kerb's lit face
    const coping = this.coping,
      face = this.face;
    if (coping > 0) {
      const t = this.table,
        o = i * STRIDE,
        along = -(x - t[o + 10]) * t[o + 13] + (y - t[o + 11]) * t[o + 12],
        joint = Math.abs(((((along * 7.5) % 1) + 1) % 1) - 0.5) > 0.46 ? 0.86 : 1,
        lift = (1.1 + 0.04 * (surfaceNoise(along * 7.5, 3, SEED_JOINT) - 0.5)) * joint;
      k += (lift - k) * coping;
      r += (COPING[0] - r) * coping;
      g += (COPING[1] - g) * coping;
      b += (COPING[2] - b) * coping;
    }
    if (face > 0) {
      // the face toward S is lit from the upper left; the one toward E is in its own shade
      const t = this.table,
        lit = t[i * STRIDE + 13] !== 0 ? 1 : 0.78;
      k += (lit - k) * face;
      r += (KERB_FACE[0] - r) * face;
      g += (KERB_FACE[1] - g) * face;
      b += (KERB_FACE[2] - b) * face;
    }
    if (stony) {
      // stone takes no tint: undo the one the painter puts on the ground after this
      r /= Math.max(1, (tint >> 16) & 255) / 255;
      g /= Math.max(1, (tint >> 8) & 255) / 255;
      b /= Math.max(1, tint & 255) / 255;
    }
    ground[0] = (ground[0] + (r * k - ground[0]) * wt) * foot;
    ground[1] = (ground[1] + (g * k - ground[1]) * wt) * foot;
    ground[2] = (ground[2] + (b * k - ground[2]) * wt) * foot;
  }
}

const means = new WeakMap<Uint8Array | Uint8ClampedArray, number>();
/** The mean of r + g + b over the desert cell of a surface sheet (`samples`, ten square cells). */
function desertMean(samples: Uint8ClampedArray) {
  let mean = means.get(samples);
  if (mean !== undefined) return mean;
  const size = Math.round(Math.sqrt(samples.length / 40)),
    from = Material.Desert * size * size * 4;
  let sum = 0;
  for (let k = from; k < from + size * size * 4; k += 4)
    sum += samples[k] + samples[k + 1] + samples[k + 2];
  mean = sum / (size * size) || 1;
  means.set(samples, mean);
  return mean;
}
