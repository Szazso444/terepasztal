import { hash2 } from '../engine/rng';
import { MAX_LEVEL } from './elevation';
import type { MapGenParams } from './mapgen';
import { fbm, valueNoise } from './noise';
import type { Rect as Span } from './rivers';
import { Terrain, climateAtIndex, lowGround, type GameMap } from './tiles';

/**
 * Generated mountains (docs/superpowers/specs/2026-10-30-tunnels-design.md, section 3a).
 *
 * A low noise over world tiles marks the massifs (massifAt). Map generation lifts the elevation
 * under them, so rivers drain away from them, and sculptMountains then raises their ground in one
 * of three shapes, falling away toward water and toward what is kept clear. Everything here reads
 * world tiles: a level depends on the seed and on the tiles within SCULPT_REACH, never on where a
 * map ends, so a map that grows keeps the levels it had.
 */

/** The share of the mountains each shape takes; a tuning value. */
export const MOUNTAIN_SHAPES = { hill: 0.7, ridge: 0.2, tower: 0.1 };

/** A mountain's shape: the model-railway hill, a long ridge or a rock tower. */
export type MountainShape = keyof typeof MOUNTAIN_SHAPES;

/**
 * How far from a tile its level reads: DISTANCE_CAP tiles for how deep a tile lies, and as many
 * again for the steepest-step pass, in which a tile further off than MAX_LEVEL steps lowers
 * nothing, as a step rises one level at least.
 */
export const SCULPT_REACH = 32;
/** A tile deeper than this into a massif, or further than this from water, reads as this. */
const DISTANCE_CAP = 16;

/**
 * massifAt above this is a massif: 37.9% of all tiles over 400 seeds. The noise is broad, so one map
 * of 160 x 160 can stand far from that, with 18 points of spread between maps.
 */
export const MASSIF_LINE = 0.59;

/** The two sides of a chamfer distance: 5 along a side, 7 across a corner, in whole numbers. */
const SIDE = 5;
const CORNER = 7;

const clamp = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const ease = (t: number) => t * t * (3 - 2 * t);

/** A low noise over world tiles, broad bumps with a little fine edge. MASSIF_LINE cuts it. */
export function massifAt(wx: number, wy: number, seed: number): number {
  return fbm(wx / 70, wy / 70, seed, 3) + 0.09 * fbm(wx / 10, wy / 10, seed + 40, 3);
}

/** The elevation massifLift adds at the heart of a massif, and where it starts and ends. */
const LIFT = 0.8;
const LIFT_FROM = MASSIF_LINE - 0.05;
const LIFT_TO = MASSIF_LINE + 0.08;
/** No lift this far from the start chunk's centre, full lift this far out, before the wobble. */
const LIFT_CLEAR = 30;
const LIFT_FULL = 54;
/** How many tiles a noise moves those distances, end to end; it keeps the ring from a clean circle. */
const LIFT_WOBBLE = 24;
/** Past the corners of the start chunk, in tiles: no lift nearer, however the noise falls. */
const LIFT_NONE = 23;
/** The tiles past LIFT_NONE over which the fade comes in, so it has no step where the clear ends. */
const LIFT_RAMP = 12;
/** How much a slope as steep as the lift gets moves a tile in the flood's order, end to end. */
const WANDER = 0.18;

/**
 * How far out of the start the lift has come at world tile (`wx`, `wy`), `dx`, `dy` from the start
 * chunk's centre, 0 to 1. The ring it rises on follows no line of the grid: a long straight slope
 * sends every river down it side by side. It is 0 up to LIFT_NONE and comes in smoothly from there,
 * where the noise alone would put a step of up to 0.2 on that line.
 */
export function liftFade(wx: number, wy: number, dx: number, dy: number, seed: number): number {
  const far = Math.hypot(dx, dy);
  if (far <= LIFT_NONE) return 0;
  if (far >= LIFT_FULL + LIFT_WOBBLE / 2) return 1;
  const wobbled = far + LIFT_WOBBLE * (fbm(wx / 20, wy / 20, seed + 70, 3) - 0.5);
  const fade = clamp((wobbled - LIFT_CLEAR) / (LIFT_FULL - LIFT_CLEAR));
  return fade * ease(clamp((far - LIFT_NONE) / LIFT_RAMP));
}

/** How far up the side of a massif world tile (`wx`, `wy`) stands, 0 to 1. */
const liftRise = (wx: number, wy: number, seed: number) =>
  clamp((massifAt(wx, wy, seed) - LIFT_FROM) / (LIFT_TO - LIFT_FROM));

/**
 * What a massif adds to the elevation of world tile (`wx`, `wy`), `dx`, `dy` from the start chunk's
 * centre: rising from below the massif's edge, so land drains away from it and rock lies where it
 * rises, and fading to nothing around the start chunk.
 */
export function massifLift(wx: number, wy: number, dx: number, dy: number, seed: number): number {
  const fade = liftFade(wx, wy, dx, dy, seed);
  if (fade === 0) return 0;
  return LIFT * ease(liftRise(wx, wy, seed)) * ease(fade);
}

/**
 * What the drainage adds to the height of a tile on the slope massifLift makes, a number of its own
 * for each tile and as large as the slope. Water runs across tile sides, so on a slope steeper than
 * the ground's noise every stream takes the same side down it, tile after tile, and rivers run in
 * straight parallel lines. The ground stays as it is: this moves only the order the flood reaches
 * tiles in (rivers.ts), and so the way water takes.
 */
export function massifWander(wx: number, wy: number, dx: number, dy: number, seed: number): number {
  const fade = liftFade(wx, wy, dx, dy, seed);
  if (fade === 0) return 0;
  const m = liftRise(wx, wy, seed);
  if (m === 0) return 0;
  const slope = 4 * m * (1 - m) * ease(fade) + 4 * fade * (1 - fade) * ease(m);
  return WANDER * slope * (hash2(wx, wy, seed + 60) - 0.5);
}

/** The noise behind the shapes: wavelength about 90 tiles, on 0 to 1 around 0.5. */
const shapeNoise = (wx: number, wy: number, seed: number) => fbm(wx / 90, wy / 90, seed + 200, 2);
/** The scale of the logistic curve the noise's spread follows. */
const SHAPE_SPREAD = 0.1;
/** The noise value below which a share `p` of the tiles lie. */
const shapeCut = (p: number) => 0.5 + SHAPE_SPREAD * Math.log(p / (1 - p));
/** Where hill gives way to ridge, and ridge to tower. */
const RIDGE_CUT = shapeCut(MOUNTAIN_SHAPES.hill);
const TOWER_CUT = shapeCut(MOUNTAIN_SHAPES.hill + MOUNTAIN_SHAPES.ridge);
/** The change of the noise across the 8 tiles shapes blend over, on average. */
const SHAPE_BLEND = 0.024;

/** How much of a tile with shape noise `n` is ridge and how much tower; the rest is hill. */
function shapeMix(n: number): { ridge: number; tower: number } {
  const past = (cut: number) => ease(clamp((n - cut) / SHAPE_BLEND + 0.5));
  const tower = past(TOWER_CUT);
  return { ridge: past(RIDGE_CUT) - tower, tower };
}

/** The shape that holds the most of tile (`wx`, `wy`). */
export function shapeAt(wx: number, wy: number, seed: number): MountainShape {
  const n = shapeNoise(wx, wy, seed);
  return n < RIDGE_CUT ? 'hill' : n < TOWER_CUT ? 'ridge' : 'tower';
}

/** A ridged noise, 0 to 1: sharp crests along the lines where a smooth noise crosses its middle. */
function ridged(x: number, y: number, seed: number, octaves = 4): number {
  let amp = 0.5;
  let f = 1;
  let total = 0;
  let norm = 0;
  let prev = 1;
  for (let i = 0; i < octaves; i++) {
    const r = 1 - Math.abs(2 * valueNoise(x * f, y * f, seed + i * 31) - 1);
    const q = r * r * prev;
    total += amp * q;
    norm += amp;
    prev = clamp(q * 2);
    amp *= 0.5;
    f *= 2.1;
  }
  return total / norm;
}

/** How high each shape stands: the one fixed factor of each, the same on every map. */
const HILL_HEIGHT = 26;
const RIDGE_HEIGHT = 30;
const TOWER_HEIGHT = 1;

/** A gentle foot, then a steep rocky core along crests. `e` is how deep the tile lies. */
function hillLevel(wx: number, wy: number, e: number, s: number): number {
  const foot = Math.min(4, e * 0.5);
  const crest = ridged(wx / 24, wy / 24, s + 3) ** 1.25;
  const core = clamp((e - 5) / 9);
  return foot + HILL_HEIGHT * crest * core * (0.65 + 0.7 * fbm(wx / 30, wy / 30, s + 11, 2));
}
/** The steepest a hill rises: a level a tile on its foot, 2 or 3 above. */
function hillRise(wx: number, wy: number, level: number, s: number): number {
  if (level < 4.5) return 1;
  return 2 + Math.floor(clamp((fbm(wx / 11, wy / 11, s + 9, 4) - 0.42) / 0.2) * 1.99);
}

function ridgeLevel(wx: number, wy: number, e: number, s: number): number {
  return 1 + RIDGE_HEIGHT * ridged(wx / 30, wy / 30, s + 3) ** 1.5 * clamp(e / 10);
}
/** A ridge's steepest step, 1 to 3 by a noise: long even slopes with cliffs here and there. */
function ridgeRise(wx: number, wy: number, s: number): number {
  return 1 + Math.floor(clamp((fbm(wx / 13, wy / 13, s + 9, 4) - 0.34) / 0.33) * 2.99);
}

/** Tiles of the grid towers are scattered on, one a cell. */
const TOWER_CELL = 12;
/** Low broken ground, with a tower in each cell of the grid around the tile. */
function towerLevel(wx: number, wy: number, e: number, s: number): number {
  let level = Math.min(2 + 2 * fbm(wx / 9, wy / 9, s + 2, 4), e * 0.5);
  const cx = Math.floor(wx / TOWER_CELL);
  const cy = Math.floor(wy / TOWER_CELL);
  const wobble = 1 + 0.5 * (fbm(wx / 4, wy / 4, s + 16, 2) - 0.5);
  for (let b = -1; b <= 1; b++)
    for (let a = -1; a <= 1; a++) {
      const ax = cx + a;
      const ay = cy + b;
      const tx = (ax + 0.2 + 0.6 * hash2(ax, ay, s + 12)) * TOWER_CELL;
      const ty = (ay + 0.2 + 0.6 * hash2(ax, ay, s + 13)) * TOWER_CELL;
      const radius = 3 + 3 * hash2(ax, ay, s + 14);
      const top = TOWER_HEIGHT * (8 + 9 * hash2(ax, ay, s + 15));
      const q = (Math.hypot(wx - tx, wy - ty) * wobble) / radius;
      if (q < 1) level = Math.max(level, top * clamp(e / 4) * (1 - q ** 1.7));
    }
  return level;
}

/** How many rings of Rock stand around a Mountain tile. */
const RING = 2;

/** The level rock starts at on a massif with the rockLevel slider at ROCK_SLIDER, its default. */
const ROCK_FROM = 6;
const ROCK_SLIDER = 0.76;
/** How many levels the rock line moves for the whole of the slider's scale, 0 to 1. */
const ROCK_SLIDE = 10;
/** How far above the rock line mountain starts. */
const MOUNTAIN_ABOVE_ROCK = 4;
/** The noise above which a slope is wooded with forestDensity at FOREST_SLIDER, its default. */
const FOREST_FROM = 0.47;
const FOREST_SLIDER = 0.56;

/** What the sculpt reads of the field map generation works on. */
export type SculptField = Pick<GameMap, 'w' | 'h' | 'originX' | 'originY' | 'terrain'> &
  Pick<Partial<GameMap>, 'waterSurface'>;

/** What the cover reads besides: the climate of each tile. */
export type CoverField = SculptField & Pick<GameMap, 'biome'> & Pick<Partial<GameMap>, 'climate'>;

/** The map's sliders that move the cover's lines. */
export type CoverSliders = Pick<MapGenParams, 'rockLevel' | 'forestDensity'>;

/**
 * Chamfer distances up to DISTANCE_CAP tiles over the `w` x `h` plane `a`, which holds SIDE times
 * the cap on open tiles and 0 where distance is measured from, in fifths of a tile.
 */
function chamfer(a: Int32Array, w: number, h: number) {
  for (let y = 0; y < h; y++)
    for (let x = 0, i = y * w; x < w; x++, i++) {
      let v = a[i];
      if (x) v = Math.min(v, a[i - 1] + SIDE);
      if (y) {
        v = Math.min(v, a[i - w] + SIDE);
        if (x) v = Math.min(v, a[i - w - 1] + CORNER);
        if (x < w - 1) v = Math.min(v, a[i - w + 1] + CORNER);
      }
      a[i] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1, i = y * w + x; x >= 0; x--, i--) {
      let v = a[i];
      if (x < w - 1) v = Math.min(v, a[i + 1] + SIDE);
      if (y < h - 1) {
        v = Math.min(v, a[i + w] + SIDE);
        if (x < w - 1) v = Math.min(v, a[i + w + 1] + CORNER);
        if (x) v = Math.min(v, a[i + w - 1] + CORNER);
      }
      a[i] = v;
    }
}

/**
 * The levels the mountains give the tiles of `span` (field tiles), as a plane of the field, 0
 * elsewhere and where the ground stays as it is: the shapes over the massifs, falling away to
 * nothing at their edge, toward water and toward `keepClear`, with neighbours at most 4 apart.
 * Reads the field's terrain up to SCULPT_REACH tiles around `span`, and changes nothing.
 */
export function sculptMountains(
  field: SculptField,
  span: Span,
  keepClear: Span,
  seed: number,
): Uint8Array {
  const { w, h, originX, originY, terrain } = field;
  const x0 = Math.max(0, span.x0 - SCULPT_REACH);
  const y0 = Math.max(0, span.y0 - SCULPT_REACH);
  const x1 = Math.min(w, span.x1 + SCULPT_REACH);
  const y1 = Math.min(h, span.y1 + SCULPT_REACH);
  const out = new Uint8Array(w * h);
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (bw <= 0 || bh <= 0) return out;
  const n = bw * bh;
  const cap = DISTANCE_CAP * SIDE;
  // tiles from what a mountain leaves alone, and tiles in from the edge of the massif as well
  const far = new Int32Array(n).fill(cap);
  const deep = new Int32Array(n);
  for (let y = y0, k = 0; y < y1; y++)
    for (let x = x0; x < x1; x++, k++) {
      const kept = x >= keepClear.x0 && y >= keepClear.y0 && x < keepClear.x1 && y < keepClear.y1;
      if (kept || terrain[y * w + x] === Terrain.Water) far[k] = 0;
      else if (massifAt(x + originX, y + originY, seed) > MASSIF_LINE) deep[k] = cap;
    }
  chamfer(far, bw, bh);
  chamfer(deep, bw, bh);
  // the levels before the steepest-step pass; a tile further out than the cap from `span` lowers
  // nothing in it, so those stay at the top
  const levels = new Float64Array(n).fill(MAX_LEVEL);
  const rise = new Float64Array(n).fill(1);
  for (let y = Math.max(y0, span.y0 - DISTANCE_CAP); y < Math.min(y1, span.y1 + DISTANCE_CAP); y++)
    for (
      let x = Math.max(x0, span.x0 - DISTANCE_CAP);
      x < Math.min(x1, span.x1 + DISTANCE_CAP);
      x++
    ) {
      const k = (y - y0) * bw + x - x0;
      const e = deep[k] / SIDE;
      if (e === 0) {
        levels[k] = 0;
        continue;
      }
      const wx = x + originX;
      const wy = y + originY;
      const { ridge, tower } = shapeMix(shapeNoise(wx, wy, seed));
      const hill = 1 - ridge - tower;
      let level = 0;
      let steep = 0;
      if (hill > 0) {
        const v = hillLevel(wx, wy, e, seed);
        level += hill * v;
        steep += hill * hillRise(wx, wy, v, seed);
      }
      if (ridge > 0) {
        level += ridge * ridgeLevel(wx, wy, e, seed);
        steep += ridge * ridgeRise(wx, wy, seed);
      }
      if (tower > 0) {
        level += tower * towerLevel(wx, wy, e, seed);
        steep += tower * 4;
      }
      // no higher than level 1 within LAKE_CLEARANCE tiles of water, along either axis
      levels[k] = Math.min(MAX_LEVEL, level, Math.max(0, far[k] / SIDE - 3) * 2);
      rise[k] = steep;
    }
  // no tile above a neighbour by more than its rise: the lowest wins, however far it carries
  for (let changed = true; changed;) {
    changed = false;
    const relax = (k: number, from: number) => {
      const v = levels[from] + rise[k];
      if (v < levels[k]) {
        levels[k] = v;
        changed = true;
      }
    };
    for (let y = 0; y < bh; y++)
      for (let x = 0, k = y * bw; x < bw; x++, k++) {
        if (x) relax(k, k - 1);
        if (y) relax(k, k - bw);
      }
    for (let y = bh - 1; y >= 0; y--)
      for (let x = bw - 1, k = y * bw + x; x >= 0; x--, k--) {
        if (x < bw - 1) relax(k, k + 1);
        if (y < bh - 1) relax(k, k + bw);
      }
  }
  for (let y = Math.max(y0, span.y0); y < Math.min(y1, span.y1); y++)
    for (let x = Math.max(x0, span.x0); x < Math.min(x1, span.x1); x++)
      out[y * w + x] = Math.round(levels[(y - y0) * bw + x - x0]);
  return out;
}

/**
 * What grows on the massifs among the tiles of `span`, outside `keepClear`: what the tile's climate
 * makes of low ground (lowGround), wooded where a noise says so on the slopes, then rock from
 * level 6 and mountain from level 10 at the default sliders, the lines wobbling by a noise, with
 * rock at any height on a step of 3 or more. `levels` is sculptMountains' plane, read a tile
 * around `span`. So what the elevation lift made of the ground under a mountain goes: a valley
 * floor is grass or desert sand, not a rock field. Water stays water, and so does the ground beside
 * water above level 1, whose level holds that water up (rivers.ts). A Mountain tile keeps two rings
 * of Rock, as it does wherever it stands: the tiles RING or more inside `span` get them, read off
 * `span`. Writes the terrain of `field`.
 */
export function coverMountains(
  field: CoverField,
  levels: Uint8Array,
  span: Span,
  keepClear: Span,
  seed: number,
  sliders: CoverSliders,
) {
  const { w, h, originX, originY, terrain, waterSurface } = field;
  const rockFrom = ROCK_FROM + ROCK_SLIDE * (sliders.rockLevel - ROCK_SLIDER);
  const mountainFrom = rockFrom + MOUNTAIN_ABOVE_ROCK;
  const forestFrom = FOREST_FROM + (sliders.forestDensity - FOREST_SLIDER);
  const kept = (x: number, y: number) =>
    x >= keepClear.x0 && y >= keepClear.y0 && x < keepClear.x1 && y < keepClear.y1;
  const holdsWater = (i: number) => terrain[i] === Terrain.Water && (waterSurface?.[i] ?? 0) > 1;
  for (let y = Math.max(1, span.y0); y < Math.min(h - 1, span.y1); y++)
    for (let x = Math.max(1, span.x0); x < Math.min(w - 1, span.x1); x++) {
      const i = y * w + x;
      if (holdsWater(i - 1) || holdsWater(i + 1) || holdsWater(i - w) || holdsWater(i + w))
        continue;
      const wx = x + originX;
      const wy = y + originY;
      if (terrain[i] === Terrain.Water || massifAt(wx, wy, seed) <= MASSIF_LINE) continue;
      if (kept(x, y)) continue;
      const v = levels[i];
      const wobbled = v + 3 * (fbm(wx / 6, wy / 6, seed + 21, 2) - 0.5);
      const steep = Math.max(
        Math.abs(v - levels[i - 1]),
        Math.abs(v - levels[i + 1]),
        Math.abs(v - levels[i - w]),
        Math.abs(v - levels[i + w]),
      );
      if (wobbled >= mountainFrom) terrain[i] = Terrain.Mountain;
      else if (wobbled >= rockFrom || steep >= 3) terrain[i] = Terrain.Rock;
      else {
        const wooded = v >= 1 && fbm(wx / 9, wy / 9, seed + 22, 3) > forestFrom;
        terrain[i] = lowGround(climateAtIndex(field, i), wooded);
      }
    }
  const inner = { x0: span.x0 + RING, y0: span.y0 + RING, x1: span.x1 - RING, y1: span.y1 - RING };
  for (let y = Math.max(0, span.y0); y < Math.min(h, span.y1); y++)
    for (let x = Math.max(0, span.x0); x < Math.min(w, span.x1); x++) {
      if (terrain[y * w + x] !== Terrain.Mountain) continue;
      for (let ny = Math.max(inner.y0, y - RING); ny <= Math.min(inner.y1 - 1, y + RING); ny++)
        for (let nx = Math.max(inner.x0, x - RING); nx <= Math.min(inner.x1 - 1, x + RING); nx++) {
          const n = ny * w + nx;
          const t = terrain[n];
          if (t === Terrain.Mountain || t === Terrain.Rock || t === Terrain.Water) continue;
          if (!kept(nx, ny)) terrain[n] = Terrain.Rock;
        }
    }
}
