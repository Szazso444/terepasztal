import { hash2, hashString } from '../engine/rng';
import { CHUNK_TILES, chunkOf, parseChunkKey } from './chunks';
import { tileLevels } from './elevation';
import { BIOME_NAMES, Biome, Terrain, climateAtIndex, startRegion, type GameMap } from './tiles';

/**
 * Where rare landmarks stand (spec 2026-10-18-rare-landmarks-design.md, sections 1 and 2). A pure
 * function of the world seed, the world chunk coordinates and the stored tiles of the chunk being
 * generated, so the same seed gives the same landmarks whatever order the player expands in.
 *
 * `LandmarkSite` and `SiteRule` mirror a row of `src/data/landmarks.json` key for key, so the
 * engine passes the rows through as they are; this file imports nothing from src/sim or src/data.
 */

/** What a `near` rule looks for within r. */
export type NearKind = 'fresh water' | 'lake' | 'desert' | 'rock';

/** The terrain a landmark needs; "within r" is the footprint grown by r tiles on every side. */
export type SiteRule =
  /** every footprint tile is of this climate */
  | { kind: 'climateAll'; climate: string }
  /** this kind of ground lies within r */
  | { kind: 'near'; what: NearKind; r: number }
  /** at least n forest tiles within r */
  | { kind: 'forestCount'; n: number; r: number }
  /** the footprint stands at level n or higher */
  | { kind: 'levelAtLeast'; n: number }
  /** a tile this many levels higher lies within r */
  | { kind: 'cliff'; levels: number; r: number }
  /** all of these climates lie within r */
  | { kind: 'fourClimates'; climates: readonly string[]; r: number }
  | { kind: 'none' };

/**
 * A landmark as placement sees it: footprint `w` along +x and `d` along +y, its site rule, and
 * either `roll` (its band in the one roll per region, in data order) or `siteChance` (a site-led
 * landmark: the chance a chunk with a legal site places it). Further keys of a data row are ignored.
 */
export interface LandmarkSite {
  id: string;
  w: number;
  d: number;
  roll?: number;
  siteChance?: number;
  rule: SiteRule;
}

/** A placed landmark: its footprint's corner of least x and y, in map tiles, in chunk (cx, cy). */
export interface LandmarkPlacement {
  id: string;
  x: number;
  y: number;
  cx: number;
  cy: number;
}

export interface PlaceOptions {
  /** the tuning rule `landmarkChance`: scales every band and the site-led chance (default 1) */
  chance?: number;
  /**
   * The start chunk, in world chunk coordinates. Default: the chunk `startRegion(map)` names,
   * which is world chunk (1, 1) in a new game and stays there as the map grows by rings.
   */
  start?: { cx: number; cy: number };
}

/** Regions are 3 x 3 world chunks. */
export const REGION_CHUNKS = 3;
/** A footprint lies at least this many tiles inside its chunk: out of reach of `seam()`. */
export const CHUNK_MARGIN = 3;
/** Seeded candidate corners tried in an anchor chunk. */
export const MAX_CANDIDATES = 64;

/** The world chunk the game starts in. */
export function startChunk(map: GameMap): { cx: number; cy: number } {
  const { rx, ry } = startRegion(map);
  return { cx: chunkOf(map.originX) + rx, cy: chunkOf(map.originY) + ry };
}

const regionOf = (c: number) => Math.floor(c / REGION_CHUNKS);

/** A stateless draw in [0, 1) from the seed, two integers and a name. */
function draw(seed: number, a: number, b: number, name: string, k = 0): number {
  return hash2(a, b + k * 7919, (seed + hashString(name)) | 0);
}

/** The roll of region (rx, ry): the index of the rolled site in `rolled`, or -1 for none. */
function rolledIndex(
  seed: number,
  rx: number,
  ry: number,
  rolled: readonly Band[],
  chance: number,
) {
  const u = draw(seed, rx, ry, 'landmark');
  let from = 0;
  for (let i = 0; i < rolled.length; i++) {
    from += rolled[i].roll * chance;
    if (u < from) return i;
  }
  return -1;
}

/** The anchor chunk of region (rx, ry): one of its nine, picked by a second hash. */
export function anchorOf(seed: number, rx: number, ry: number) {
  const i = Math.min(8, Math.floor(draw(seed, rx, ry, 'anchor') * 9));
  return { cx: rx * REGION_CHUNKS + (i % 3), cy: ry * REGION_CHUNKS + Math.floor(i / 3) };
}

interface Band {
  site: LandmarkSite;
  roll: number;
}

const spacingHash = (seed: number, rx: number, ry: number) => draw(seed, rx, ry, 'spacing');

/**
 * Whether region (rx, ry) rolls a landmark that the spacing rule leaves standing: when an
 * 8-neighbouring region also rolls one and the two anchor chunks touch (8-neighbour), the one with
 * the lower spacing hash drops out. This reads rolls only, never stored state.
 */
function standsAfterSpacing(
  seed: number,
  rx: number,
  ry: number,
  rolled: readonly Band[],
  chance: number,
): Band | null {
  const i = rolledIndex(seed, rx, ry, rolled, chance);
  if (i < 0) return null;
  const a = anchorOf(seed, rx, ry);
  const mine = spacingHash(seed, rx, ry);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = rx + dx;
      const ny = ry + dy;
      if (rolledIndex(seed, nx, ny, rolled, chance) < 0) continue;
      const b = anchorOf(seed, nx, ny);
      if (Math.abs(a.cx - b.cx) > 1 || Math.abs(a.cy - b.cy) > 1) continue;
      const theirs = spacingHash(seed, nx, ny);
      // a tie cannot be told apart by the hash; the region further along the rows drops out
      if (theirs > mine || (theirs === mine && (ny > ry || (ny === ry && nx > rx)))) return null;
    }
  return rolled[i];
}

const NAME_ID = new Map<string, number>(BIOME_NAMES.map((n, i) => [n, i]));

/** The tiles of one chunk that a rule and the legality rules read, in chunk coordinates. */
interface Ground {
  terrain: Uint8Array;
  climate: Uint8Array;
  biome: Uint8Array;
  levels: Uint8Array;
  /** 1 where a coal, oil or wheat prop stands */
  deposit: Uint8Array;
}

const C = CHUNK_TILES;

/**
 * The stored tiles of chunk (cx, cy), or null when the map does not hold all of it. Levels are
 * read from the chunk alone: a tile 3 or more from the chunk's edge has the same level there as in
 * the whole map (the map border caps a tile at 1 plus its distance, which reaches MAX_LEVEL at 3),
 * so a footprint at the margin never sees the difference, and the window of a rule that reaches the
 * edge sees the same level whatever the neighbouring chunks hold.
 */
function groundOf(map: GameMap, cx: number, cy: number): Ground | null {
  const ox = cx * C - map.originX;
  const oy = cy * C - map.originY;
  if (ox < 0 || oy < 0 || ox + C > map.w || oy + C > map.h) return null;
  const terrain = new Uint8Array(C * C);
  const climate = new Uint8Array(C * C);
  const biome = new Uint8Array(C * C);
  const water = new Uint8Array(C * C);
  const deposit = new Uint8Array(C * C);
  for (let y = 0; y < C; y++)
    for (let x = 0; x < C; x++) {
      const k = (oy + y) * map.w + ox + x;
      const j = y * C + x;
      terrain[j] = map.terrain[k];
      biome[j] = map.biome[k];
      climate[j] = climateAtIndex(map, k);
      water[j] = map.waterSurface?.[k] ?? 0;
      const props = map.props.get(k);
      if (props?.some((p) => p.kind === 'coal' || p.kind === 'oil' || p.kind === 'wheat'))
        deposit[j] = 1;
    }
  const levels = tileLevels({ w: C, h: C, terrain, waterSurface: water });
  return { terrain, climate, biome, levels, deposit };
}

/**
 * Legal ground: every footprint tile buildable (not water, rock or mountain), at one elevation,
 * with no deposit prop. A footprint is in the map by construction (it lies inside a chunk the map
 * holds). There is no structure check: placement runs only for chunks generated just now, and a
 * newly generated chunk has no track, station, building, decor, road or house in it.
 */
function legal(g: Ground, x: number, y: number, w: number, d: number): boolean {
  const l0 = g.levels[y * C + x];
  for (let j = y; j < y + d; j++)
    for (let i = x; i < x + w; i++) {
      const k = j * C + i;
      const t = g.terrain[k];
      if (t === Terrain.Water || t === Terrain.Rock || t === Terrain.Mountain) return false;
      if (g.levels[k] !== l0 || g.deposit[k]) return false;
    }
  return true;
}

/** Whether `f` holds for any tile of the footprint grown by r (counting up to `need`). */
function countWindow(
  x: number,
  y: number,
  w: number,
  d: number,
  r: number,
  f: (k: number) => boolean,
  need = 1,
): boolean {
  let n = 0;
  for (let j = y - r; j < y + d + r; j++)
    for (let i = x - r; i < x + w + r; i++) if (f(j * C + i) && ++n >= need) return true;
  return false;
}

/** The reach of a rule beyond its footprint, in tiles. */
function reach(rule: SiteRule): number {
  switch (rule.kind) {
    case 'near':
    case 'forestCount':
    case 'cliff':
    case 'fourClimates':
      return rule.r;
    default:
      return 0;
  }
}

function meets(g: Ground, s: LandmarkSite, x: number, y: number): boolean {
  const { rule: r, w, d } = s;
  switch (r.kind) {
    case 'none':
      return true;
    case 'climateAll': {
      const id = NAME_ID.get(r.climate);
      return !countWindow(x, y, w, d, 0, (k) => g.climate[k] !== id);
    }
    case 'near':
      switch (r.what) {
        case 'fresh water':
          return countWindow(
            x,
            y,
            w,
            d,
            r.r,
            (k) => g.biome[k] === Biome.Lake || g.biome[k] === Biome.River,
          );
        case 'lake':
          return countWindow(x, y, w, d, r.r, (k) => g.biome[k] === Biome.Lake);
        case 'desert':
          return countWindow(x, y, w, d, r.r, (k) => g.climate[k] === Biome.Desert);
        case 'rock':
          return countWindow(
            x,
            y,
            w,
            d,
            r.r,
            (k) => g.terrain[k] === Terrain.Rock || g.terrain[k] === Terrain.Mountain,
          );
      }
      return false;
    case 'forestCount':
      return countWindow(x, y, w, d, r.r, (k) => g.terrain[k] === Terrain.Forest, r.n);
    case 'levelAtLeast':
      return g.levels[y * C + x] >= r.n;
    case 'cliff': {
      const l0 = g.levels[y * C + x];
      return countWindow(x, y, w, d, r.r, (k) => g.levels[k] >= l0 + r.levels);
    }
    case 'fourClimates': {
      const seen = new Set<number>();
      countWindow(x, y, w, d, r.r, (k) => (seen.add(g.climate[k]), false));
      return r.climates.every((c) => seen.has(NAME_ID.get(c) ?? -1));
    }
  }
}

/** Whether a footprint of `s` at chunk tile (x, y) is legal and meets its rule. */
function fits(g: Ground, s: LandmarkSite, x: number, y: number): boolean {
  return legal(g, x, y, s.w, s.d) && meets(g, s, x, y);
}

/** The corners a footprint may take: it and the rule's window both stay in the chunk's margin. */
function cornerRange(s: LandmarkSite) {
  const lo = Math.max(CHUNK_MARGIN, reach(s.rule));
  return { lo, hiX: C - lo - s.w, hiY: C - lo - s.d };
}

/** Up to MAX_CANDIDATES seeded corners in the chunk; the first that fits wins. */
function findCorner(g: Ground, seed: number, cx: number, cy: number, s: LandmarkSite) {
  const { lo, hiX, hiY } = cornerRange(s);
  if (hiX < lo || hiY < lo) return null;
  const nx = hiX - lo + 1;
  const ny = hiY - lo + 1;
  for (let k = 0; k < MAX_CANDIDATES; k++) {
    const x = lo + Math.floor(draw(seed, cx, cy, `${s.id}/x`, k) * nx);
    const y = lo + Math.floor(draw(seed, cx, cy, `${s.id}/y`, k) * ny);
    if (fits(g, s, x, y)) return { x, y };
  }
  return null;
}

/** The corners at which a footprint of `s` fits in the chunk, in rows, up to `limit` of them. */
function sitesOf(g: Ground, s: LandmarkSite, limit = Infinity) {
  const { lo, hiX, hiY } = cornerRange(s);
  const out: { x: number; y: number }[] = [];
  for (let y = lo; y <= hiY; y++)
    for (let x = lo; x <= hiX; x++) if (fits(g, s, x, y) && out.push({ x, y }) >= limit) return out;
  return out;
}

/**
 * The landmarks of the chunks in `added` (keys "cx,cy", as buildMap reports them), as map tiles.
 * Only a chunk in `added` ever gets one, and only when the map holds all of it, so a chunk already
 * stored never gains a landmark. `sites` are the data rows in data order: the rolled ones (with a
 * `roll`) make the bands of the region roll, the site-led ones (with a `siteChance`) are looked
 * for in every added chunk. The start chunk gets none, and the footprint of any lies at least
 * CHUNK_MARGIN tiles inside its chunk. The result does not depend on the order of `added`, nor on
 * which other chunks were generated in the same call or earlier.
 */
export function placeLandmarks(
  seed: number,
  map: GameMap,
  added: readonly string[],
  sites: readonly LandmarkSite[],
  options: PlaceOptions = {},
): LandmarkPlacement[] {
  const chance = options.chance ?? 1;
  const start = options.start ?? startChunk(map);
  const rolled: Band[] = [];
  const led: (LandmarkSite & { siteChance: number })[] = [];
  for (const s of sites) {
    if (s.siteChance !== undefined) led.push({ ...s, siteChance: s.siteChance });
    else if (s.roll !== undefined) rolled.push({ site: s, roll: s.roll });
  }
  const out: LandmarkPlacement[] = [];
  for (const key of added) {
    const at = parseChunkKey(key);
    if (!at) continue;
    const { cx, cy } = at;
    if (cx === start.cx && cy === start.cy) continue;
    const ox = cx * C - map.originX;
    const oy = cy * C - map.originY;
    let g: Ground | null | undefined;
    const ground = () => (g === undefined ? (g = groundOf(map, cx, cy)) : g);
    // the house wins: a chunk with one holds no rolled landmark
    let house = false;
    for (const s of led) {
      if (draw(seed, cx, cy, s.id) >= Math.min(1, s.siteChance * chance)) continue;
      const gr = ground();
      if (!gr) continue;
      const all = sitesOf(gr, s);
      if (!all.length) continue;
      const pick =
        all[Math.min(all.length - 1, Math.floor(draw(seed, cx, cy, `${s.id}/pick`) * all.length))];
      out.push({ id: s.id, x: ox + pick.x, y: oy + pick.y, cx, cy });
      house = true;
    }
    if (house) continue;
    const rx = regionOf(cx);
    const ry = regionOf(cy);
    const a = anchorOf(seed, rx, ry);
    if (a.cx !== cx || a.cy !== cy) continue;
    const band = standsAfterSpacing(seed, rx, ry, rolled, chance);
    if (!band) continue;
    const gr = ground();
    if (!gr) continue;
    const at2 = findCorner(gr, seed, cx, cy, band.site);
    if (at2) out.push({ id: band.site.id, x: ox + at2.x, y: oy + at2.y, cx, cy });
  }
  return out;
}

/**
 * The share of the rolled landmark's band (not yet a placement): which landmark the region
 * (rx, ry) rolls once the spacing rule has run, or null. Exposed so a test can count rolls without
 * generating a map.
 */
export function rolledLandmark(
  seed: number,
  rx: number,
  ry: number,
  sites: readonly LandmarkSite[],
  chance = 1,
): { id: string; anchor: { cx: number; cy: number } } | null {
  const rolled = sites.filter((s) => s.roll !== undefined).map((s) => ({ site: s, roll: s.roll! }));
  const band = standsAfterSpacing(seed, rx, ry, rolled, chance);
  return band ? { id: band.site.id, anchor: anchorOf(seed, rx, ry) } : null;
}

/** The unspaced roll of region (rx, ry): the id of the landmark whose band it falls in, or null. */
export function rollOf(
  seed: number,
  rx: number,
  ry: number,
  sites: readonly LandmarkSite[],
  chance = 1,
): string | null {
  const rolled = sites.filter((s) => s.roll !== undefined).map((s) => ({ site: s, roll: s.roll! }));
  const i = rolledIndex(seed, rx, ry, rolled, chance);
  return i < 0 ? null : rolled[i].site.id;
}

/** Whether the site-led draw of landmark `id` in chunk (cx, cy) succeeds (its siteChance). */
export function siteDraw(
  seed: number,
  cx: number,
  cy: number,
  s: LandmarkSite,
  chance = 1,
): boolean {
  return draw(seed, cx, cy, s.id) < Math.min(1, (s.siteChance ?? 0) * chance);
}

/**
 * Every corner, in map tiles, at which a footprint of each of `sites` fits in chunk (cx, cy) of the
 * map, one list per site: the whole search that placement samples with its seeded candidates. The
 * lists are empty when the map holds less than the whole chunk. `limit` stops each search early.
 * Exposed for the calibration test and the review scene.
 */
export function sitesInChunk(
  map: GameMap,
  cx: number,
  cy: number,
  sites: readonly LandmarkSite[],
  limit = Infinity,
): { x: number; y: number }[][] {
  const g = groundOf(map, cx, cy);
  if (!g) return sites.map(() => []);
  const ox = cx * C - map.originX;
  const oy = cy * C - map.originY;
  return sites.map((s) => sitesOf(g, s, limit).map((p) => ({ x: ox + p.x, y: oy + p.y })));
}
