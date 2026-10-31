import { DEFAULT_MAP_PARAMS, emptyMap, generateMap, type MapGenParams } from './mapgen';
import { Dir, DIR_DX, DIR_DY } from '../engine/iso';
import { MAX_LEVEL, NO_LEVEL, levelTarget, tileLevels } from './elevation';
import { FLOW_CAP } from './rivers';
import {
  FALL_BITS,
  MAX_DROP,
  fallAt,
  fallDrop,
  fallEdge,
  fallFeature,
  isFeature,
} from './waterfalls';
import { Terrain, Biome, type GameMap, type PropInstance, type PropKind } from './tiles';

/**
 * Stored chunks: the ground of a generated world as it was generated, one chunk at a time, so a
 * change to map generation reaches only the chunks generated after it.
 *
 * A chunk is the block of CHUNK_TILES x CHUNK_TILES world tiles from (`cx * 32`, `cy * 32`), keyed
 * by its world chunk coordinate: map tile `x` lies in chunk `floor((originX + x) / 32)`. Growing
 * the map around the start adds chunks and never moves one.
 *
 * Each chunk is one base64 text, written once when the chunk is generated and kept as it is from
 * then on: a load reads a text of any version and never writes it again, and a chunk is written
 * in today's version only when it is written anyway (a part of a chunk the map grows over, see
 * buildMap). Every version's bytes begin the same:
 *
 * - the encoding version, 1 to CHUNK_VERSION;
 * - the rectangle of the chunk it holds: x0, y0, w, h, a byte each. A game's map holds whole
 *   chunks (0, 0, 32, 32); a map whose edge is off the chunk grid holds part of one.
 *
 * Versions 1 to 4 then hold, in order:
 *
 * - terrain, the rectangle's tiles in rows, as runs of one byte: the terrain id (0 to 15) in the
 *   high four bits and the run's length less one in the low four, where 15 means 16 or more and a
 *   varint after it holds the length less 16;
 * - biome ids, as runs the same way;
 * - from version 2, climate ids (GameMap.climate), as runs the same way. The climate is the biome
 *   but where a landform relabels it (a lake, a river, a beach, a mountain), so its runs are long;
 *   a map with no climate plane stores its biome there;
 * - variant, two bits a tile (0 to 3), four tiles a byte from the low bits up;
 * - props: a varint count of the tiles that have any; for each of those tiles a varint of the
 *   tiles skipped since the one before, times four, plus its prop count less one (3: four or
 *   more, and a varint after it holds the count less four); then each of its props as one byte,
 *   the kind's index in PROP_KINDS plus 32 times the variant (for an index over 30 or a variant
 *   over 7 the byte is 31, and a varint index and a varint variant follow), and the offsets `ox`
 *   and `oy` in 256ths of a tile, a signed byte each;
 * - from version 3, the water level of each tile (GameMap.waterSurface, 0 to 15) as runs the same
 *   way, then the rivers: a varint count of the tiles with a downstream side (GameMap.flowDir), and
 *   for each of those tiles a varint of the tiles skipped since the one before, then a varint of
 *   its flow (GameMap.flow, at most FLOW_CAP) times four plus its side less one. Both live only on
 *   water, so a chunk without a river spends a byte or two on them;
 * - from version 4, the water features (GameMap.feature, laid out in waterfalls.ts: a waterfall's
 *   drop and edge, and bits kept for #356): a varint count of the tiles whose byte is not 0, and
 *   for each of those tiles a varint of the tiles skipped since the one before, then its byte. A
 *   chunk without a waterfall spends a byte on them, and a waterfall two or three more.
 *
 * Version 5 (#392) holds every plane of version 4, read back the same, in about a sixth of its
 * text for a generated world. After the rectangle comes the seed its guesses are made from, the
 * map's seed as it is, whatever number that is (one of another kind, which a save may carry, as
 * Number(seed), in the head and every guess alike): an integer below 2^52 in size as a varint,
 * zigzagged (2v for v of 0 or more, -2v - 1 below), and any other as the varint 2^53 - 1 followed
 * by the eight bytes of its float64, the lowest first. Then the chunk's cx and cy, each a varint
 * zigzagged the same way, or 0 where it is 2^40 or more in size. The rest of the text
 * is one stream of LZMA's range coder (RangeWriter) without its first byte, which is always 0;
 * a text that leaves bytes over, or runs out before its last plane, is not one encodeChunk wrote.
 * Every bit of the stream is coded at even odds ("raw") or under a context: two counts, of the 0s
 * and 1s it has coded in this chunk, give a 0 the odds (zeros + 1/2) / (zeros + ones + 1), in
 * 4096ths rounded down, and are halved, rounding up, once together they pass 255. Every count
 * starts at 0 in each chunk, so a chunk reads alone. In order:
 *
 * - terrain, then climate, then biome, tile by tile in rows (codePlane): whether the tile is its
 *   left neighbour's (in the first column its upper one's), else its upper neighbour's, else its
 *   upper right one's, each asked only for a value not asked yet, under contexts of which of those
 *   neighbours are alike; else its four bits, the highest first. A biome tile is asked first
 *   whether it is the tile's climate, under its terrain and whether the tile before it was; the
 *   plane's other contexts are by the tile's terrain too;
 * - variants: map generation draws each from its world tile (wx, wy) as floor(hash(wx, wy, seed)
 *   * 4) (emptyMap), where hash is hash2 of src/engine/rng.ts as it stood for version 5, copied
 *   here as tileHash so that a change to hash2 cannot change a text. Each row is first asked
 *   whether all its tiles are that guess; if not, each tile's variant less the guess, mod 4, is
 *   two bits;
 * - water levels, then downstream sides: whether the plane has any tile not 0, and if so the
 *   plane as terrain is, its contexts by whether the tile is water (a side above 4 is refused);
 *   then, where there is a side, each river tile's flow: against the flow of its left or upper
 *   neighbour when that runs into it or it runs into that, the difference as Elias gamma (count:
 *   its length in context bits, the rest raw) and a sign, else the flow itself as Elias gamma;
 * - water features: whether there are any, and if so for each tile whether it has one (by whether
 *   it has a side), its drop's three bits, and its edge: whether it is the tile's side, else two
 *   bits; a byte isFeature refuses is refused;
 * - props, tile by tile in rows: whether the tile has any, by terrain, climate and a band of
 *   decorateProps' scatter hash s = hash(wx, wy, seed + 5) (0 below 0.85, else 1 + min(5,
 *   floor((s - 0.85) * 40))); whether it has more than one, two, three, by terrain and the hash
 *   decorateProps counts trees by, min(2, floor(hash(wx, wy, seed + 6) * 2.5)); four or more, the
 *   count less four as raw Elias gamma (rawCount). Then its first three props each: the kind's
 *   five bits by terrain and climate (31: the index less 31 follows as raw Elias gamma); the
 *   variant, asked against floor(h * 3), floor(h * 4) and floor(h * 2) in turn, by kind, for
 *   decorateProps' h = hash(wx + k, wy - k, seed + 9) of prop k, else whether it is over 3 and its
 *   two bits, or the variant less 4 as raw Elias gamma; and each offset in 256ths of a tile, asked
 *   whether it is decorateProps' (hash(3wx + k, wy, seed + 7) - 0.5) * 0.7 for `ox` and
 *   (hash(wx, 3wy + k, seed + 8) - 0.5) * 0.7 for `oy`, else whether it is 0, else a raw signed
 *   byte. A fourth prop and later is all raw: five bits of kind, the variant as Elias gamma and
 *   the two offset bytes, 22 bits or more, so a corrupt count cannot make props of no text.
 *
 * Version 6 (the tunnels) holds everything version 5 does, in the same bytes, and after the props
 * the generated levels (GameMap.generatedLevel): whether the plane has any tile that is not
 * NO_LEVEL, and if so the plane as the water levels are, five bits a value, its contexts by the
 * tile's terrain. A value is 0 to MAX_LEVEL, or 31 for NO_LEVEL; any other is refused. A map
 * with no plane is stored as one with no tile set, and a chunk of version 5 or earlier reads
 * with every tile at NO_LEVEL.
 *
 * The guesses are only that: a variant, prop or offset that is not the guess costs more bits and
 * reads back as it was, and a map whose generator draws them otherwise is stored all the same.
 * Changing anything here, a guess or a context included, is a new CHUNK_VERSION.
 *
 * Varints are unsigned LEB128. Offsets are rounded to the nearest 256th of a tile in every
 * version, so a stored prop sits at most a 512th of a tile from where generation put it; buildMap
 * gives every chunk, new or loaded, as its text decodes, so a world looks the same before and
 * after a load.
 *
 * A later plane joins under a bump of CHUNK_VERSION, at a place in the bytes its version names,
 * and a chunk of an older version decodes with that plane empty: version 1 holds no climate, and
 * its climate is its biome; versions 1 and 2 hold no water levels, flow or sides, so their water
 * is at level 0 and their rivers have neither; versions 1 to 3 hold no water features, so they
 * have no waterfalls; versions 1 to 5 hold no generated levels, so every tile of theirs is at
 * NO_LEVEL.
 */

/** Chunk edge in world tiles: emptyMap's region size. */
export const CHUNK_TILES = 32;
/** The encoding encodeChunk writes; decodeChunk reads it and every one before it. */
export const CHUNK_VERSION = 6;

/**
 * The index a chunk stores each prop kind under. Only ever add to it: an index written into a save
 * keeps its kind for good. A kind of PropKind missing here does not compile.
 */
const KIND_INDEX = {
  tree: 0,
  pine: 1,
  rock: 2,
  bush: 3,
  birch: 4,
  spruce: 5,
  oak: 6,
  palm: 7,
  cactus: 8,
  deadtree: 9,
  flowers: 10,
  reeds: 11,
  boulder: 12,
  coal: 13,
  oil: 14,
  wheat: 15,
} satisfies Record<PropKind, number>;
/** Every prop kind, at the index a chunk stores it under. */
export const PROP_KINDS: readonly PropKind[] = (Object.keys(KIND_INDEX) as PropKind[]).sort(
  (a, b) => KIND_INDEX[a] - KIND_INDEX[b],
);

/** The stored chunks of one world: each chunk's text under its chunkKey. Plain JSON. */
export type ChunkStore = Record<string, string>;

/**
 * A map generator: generateMap with a world's production chain, `(s, p) => generateMap(s, p,
 * chain)`, or a stand-in for it in a test.
 */
export type MapGenerator = (seed: number, params: Partial<MapGenParams>) => GameMap;

/** The planes of a chunk's text. */
export interface ChunkPlanes {
  /** the encoding the text was written in */
  version: number;
  /** the rectangle of the chunk it holds, in tiles from the chunk's corner */
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** a value per tile of the rectangle, in rows */
  terrain: Uint8Array;
  biome: Uint8Array;
  /** the climate; a chunk of version 1 stores none, and its climate is its biome */
  climate: Uint8Array;
  variant: Uint8Array;
  /** props by tile of the rectangle (`y * w + x`) */
  props: Map<number, PropInstance[]>;
  /** the water levels, flow and downstream sides; all 0 in a chunk of version 1 or 2 */
  waterSurface: Uint8Array;
  flow: Uint16Array;
  flowDir: Uint8Array;
  /** the water features (waterfalls.ts); all 0, no waterfalls, in a chunk of version 1 to 3 */
  feature: Uint8Array;
  /** the generated levels (GameMap.generatedLevel); all NO_LEVEL in a chunk of version 1 to 5 */
  generatedLevel: Uint8Array;
}

/** What buildMap made. */
export interface BuiltMap {
  map: GameMap;
  /**
   * The store given with the text of every chunk generated now added. The texts given are kept as
   * they were, those of chunks the map does not cover included.
   */
  chunks: ChunkStore;
  /** keys of the chunks this call generated and stored, in rows */
  added: string[];
  /**
   * keys whose stored text decodeChunk refused (broken in a way it notices, or of a newer
   * CHUNK_VERSION): the map has them as generated now, and their text is kept, never replaced
   */
  unreadable: string[];
}

/** The key a chunk is stored under, "cx,cy". */
export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/** The chunk coordinates of a key, or null when chunkKey writes no such key. */
export function parseChunkKey(key: string): { cx: number; cy: number } | null {
  const m = /^(-?\d+),(-?\d+)$/.exec(key);
  if (!m) return null;
  const cx = Number(m[1]);
  const cy = Number(m[2]);
  // "-0,0", "01,2" or a number too long to be exact name no chunk of their own
  return Number.isSafeInteger(cx) && Number.isSafeInteger(cy) && chunkKey(cx, cy) === key
    ? { cx, cy }
    : null;
}

/** Whether `v` has the shape of a ChunkStore (its texts are not decoded). */
export function isChunkStore(v: unknown): v is ChunkStore {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.entries(v).every(([k, t]) => typeof t === 'string' && parseChunkKey(k) !== null);
}

/** The chunk world tile `t` lies in, along either axis. */
export const chunkOf = (t: number) => Math.floor(t / CHUNK_TILES);

/** The chunks a map covers any tile of, in rows; a missing origin is 0, as in MapGenParams. */
export function mapChunks(m: {
  w: number;
  h: number;
  originX?: number;
  originY?: number;
}): { cx: number; cy: number }[] {
  const ox = m.originX ?? 0;
  const oy = m.originY ?? 0;
  const out: { cx: number; cy: number }[] = [];
  for (let cy = chunkOf(oy); cy <= chunkOf(oy + m.h - 1); cy++)
    for (let cx = chunkOf(ox); cx <= chunkOf(ox + m.w - 1); cx++) out.push({ cx, cy });
  return out;
}

/** A rectangle of a chunk, in tiles from its corner. */
interface Part {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

/** The part of chunk (`cx`, `cy`) a map covers; null when it covers none. */
function coverage(
  map: Pick<GameMap, 'w' | 'h' | 'originX' | 'originY'>,
  cx: number,
  cy: number,
): Part | null {
  const ax = Math.max(cx * CHUNK_TILES, map.originX);
  const ay = Math.max(cy * CHUNK_TILES, map.originY);
  const bx = Math.min((cx + 1) * CHUNK_TILES, map.originX + map.w);
  const by = Math.min((cy + 1) * CHUNK_TILES, map.originY + map.h);
  if (ax >= bx || ay >= by) return null;
  return { x0: ax - cx * CHUNK_TILES, y0: ay - cy * CHUNK_TILES, w: bx - ax, h: by - ay };
}

/** Whether rectangle `a` of a chunk holds all of `b`. */
const holds = (a: Part, b: Part) =>
  a.x0 <= b.x0 && a.y0 <= b.y0 && a.x0 + a.w >= b.x0 + b.w && a.y0 + a.h >= b.y0 + b.h;

/** A byte buffer that grows as it is written. */
class Writer {
  buf = new Uint8Array(512);
  n = 0;
  byte(b: number) {
    if (this.n === this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.n++] = b;
  }
  varint(v: number) {
    while (v >= 0x80) {
      this.byte((v % 0x80) | 0x80);
      v = Math.floor(v / 0x80);
    }
    this.byte(v);
  }
  /** The eight bytes of `v`'s float64, the lowest first. */
  float64(v: number) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v, true);
    for (let k = 0; k < 8; k++) this.byte(b[k]);
  }
}

/** Thrown inside decodeChunk when the bytes run out or say something no chunk says. */
class Corrupt extends Error {}

class Reader {
  i = 0;
  constructor(readonly buf: Uint8Array) {}
  byte() {
    if (this.i >= this.buf.length) throw new Corrupt();
    return this.buf[this.i++];
  }
  /** A varint of versions 1 to 4: seven bytes at most. */
  varint() {
    let v = 0;
    for (let k = 0, scale = 1; k < 7; k++, scale *= 0x80) {
      const b = this.byte();
      v += (b & 0x7f) * scale;
      if (b < 0x80) return v;
    }
    throw new Corrupt();
  }
  /** A varint of version 5's head: eight bytes at most, and a safe integer. */
  long() {
    let v = 0;
    for (let k = 0, scale = 1; k < 8; k++, scale *= 0x80) {
      const b = this.byte();
      v += (b & 0x7f) * scale;
      if (b >= 0x80) continue;
      if (!Number.isSafeInteger(v)) throw new Corrupt();
      return v;
    }
    throw new Corrupt();
  }
  /** A float64 of eight bytes, the lowest first (version 5's head). */
  float64() {
    const b = new Uint8Array(8);
    for (let k = 0; k < 8; k++) b[k] = this.byte();
    return new DataView(b.buffer).getFloat64(0, true);
  }
}

/** The planes of a chunk's rectangle: ChunkPlanes but its version and rectangle. */
type Tiles = Omit<ChunkPlanes, 'version' | 'x0' | 'y0' | 'w' | 'h'>;

/** An offset within a tile as a chunk stores it: in 256ths of a tile, -128 to 127. */
const offsetSteps = (v: number) => Math.max(-128, Math.min(127, Math.round(v * 256))) | 0;
/** A byte read as a signed one, -128 to 127. */
const signed = (b: number) => (b < 128 ? b : b - 256);

// Versions 1 to 4, which decodeChunk still reads.

/** A plane of ids 0 to 15 as runs (versions 1 to 4). */
function readRuns(r: Reader, n: number): Uint8Array {
  const plane = new Uint8Array(n);
  for (let i = 0; i < n;) {
    const b = r.byte();
    const len = (b & 15) < 15 ? (b & 15) + 1 : 16 + r.varint();
    if (i + len > n) throw new Corrupt();
    plane.fill(b >> 4, i, i + len);
    i += len;
  }
  return plane;
}

function readProp(r: Reader): PropInstance {
  const b = r.byte();
  let kind = b & 31;
  let variant = b >> 5;
  if (kind === 31) {
    kind = r.varint();
    variant = r.varint();
  }
  if (kind >= PROP_KINDS.length) throw new Corrupt();
  return {
    kind: PROP_KINDS[kind],
    variant,
    ox: signed(r.byte()) / 256,
    oy: signed(r.byte()) / 256,
  };
}

/** The planes of a text of version 1 to 4 after its rectangle; null where they say what none do. */
function readOldPlanes(r: Reader, version: number, n: number): Tiles | null {
  const terrain = readRuns(r, n);
  const biome = readRuns(r, n);
  const climate = version >= 2 ? readRuns(r, n) : biome.slice();
  const variant = new Uint8Array(n);
  for (let i = 0; i < n; i += 4) {
    const b = r.byte();
    for (let k = 0; k < 4 && i + k < n; k++) variant[i + k] = (b >> (2 * k)) & 3;
  }
  const props = new Map<number, PropInstance[]>();
  const tiles = r.varint();
  for (let t = 0, last = -1; t < tiles; t++) {
    const head = r.varint();
    const i = last + 1 + Math.floor(head / 4);
    const more = head % 4;
    const count = more < 3 ? more + 1 : 4 + r.varint();
    if (i >= n) return null;
    const list: PropInstance[] = [];
    // every prop takes three bytes or more, so a corrupt count runs out of bytes
    for (let k = 0; k < count; k++) list.push(readProp(r));
    props.set(i, list);
    last = i;
  }
  const waterSurface = version >= 3 ? readRuns(r, n) : new Uint8Array(n);
  const flow = new Uint16Array(n);
  const flowDir = new Uint8Array(n);
  if (version >= 3) {
    const rivers = r.varint();
    for (let t = 0, last = -1; t < rivers; t++) {
      const i = last + 1 + r.varint();
      if (i >= n) return null;
      const v = r.varint();
      if (v >= (FLOW_CAP + 1) * 4) return null;
      flow[i] = Math.floor(v / 4);
      flowDir[i] = (v % 4) + 1;
      last = i;
    }
  }
  const feature = new Uint8Array(n);
  if (version >= 4) {
    const tiles = r.varint();
    for (let t = 0, last = -1; t < tiles; t++) {
      const i = last + 1 + r.varint();
      if (i >= n) return null;
      const f = r.byte();
      if (!f || !isFeature(f)) return null;
      feature[i] = f;
      last = i;
    }
  }
  const generatedLevel = new Uint8Array(n).fill(NO_LEVEL);
  return {
    terrain,
    biome,
    climate,
    variant,
    props,
    waterSurface,
    flow,
    flowDir,
    feature,
    generatedLevel,
  };
}

// Versions 5 and 6 (see the encoding above). Every number and choice below is part of the encoding: a
// change to any of them is a new CHUNK_VERSION, with this one kept for the texts it wrote.

/**
 * Map generation's hash of a world tile as it stood when version 5 was written (hash2 in
 * src/engine/rng.ts), copied so that a later change to hash2 cannot change a stored chunk.
 */
function tileHash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** What version 5 guesses from: a seed, and the world tile of the rectangle's first tile. */
interface Guess {
  seed: number;
  wx: number;
  wy: number;
}
/** A chunk coordinate version 5 guesses from; any other stands as 0. */
const GUESS_LIMIT = 2 ** 40;
const guessable = (v: number) => (Number.isSafeInteger(v) && Math.abs(v) < GUESS_LIMIT ? v : 0);
/** The seeds version 5's head holds as a zigzagged varint: the integers below this in size. */
const SEED_LIMIT = 2 ** 52;
/** The varint after which the head holds the seed as its float64; no zigzagged seed is it. */
const SEED_FLOAT = 2 ** 53 - 1;
const zigzag = (v: number) => (v < 0 ? -2 * v - 1 : 2 * v);
const unzigzag = (u: number) => (u % 2 ? -(u + 1) / 2 : u / 2);

/** The odds a context gives a 0, in 4096ths. */
const ODDS_BITS = 12;
/** A context's two counts are halved once together they pass this. */
const COUNT_LIMIT = 255;
/** The range coder hands on a byte whenever its range falls below this. */
const RANGE_TOP = 0x1000000;

/**
 * Version 5's coder, the same calls encoding and decoding, so the two cannot drift apart: an
 * encoder codes the bit or the value it is given and returns it, a decoder ignores what it is
 * given and returns what it reads.
 */
interface Coder {
  /** A bit (0 or 1) under context `k` of `ctx`, a pair of counts that learn its odds. */
  bit(ctx: Uint16Array, k: number, b: number): number;
  /** The `n` low bits of `v` (up to 53) at even odds, the highest first. */
  raw(v: number, n: number): number;
}

/**
 * The odds a context of `zeros` 0s and `ones` 1s gives a 0, at `zeros * 256 + ones`: (zeros + 1/2)
 * / (zeros + ones + 1), in 4096ths rounded down, 8 to 4088 (learn keeps the two under 256).
 */
const ODDS = new Uint16Array(256 * 256);
for (let zeros = 0; zeros < 256; zeros++)
  for (let ones = 0; zeros + ones < 256; ones++)
    ODDS[zeros * 256 + ones] = Math.floor(
      ((2 * zeros + 1) << ODDS_BITS) / (2 * (zeros + ones) + 2),
    );
/** The odds context `k` of `ctx` gives a 0. */
const zeroOdds = (ctx: Uint16Array, k: number) => ODDS[ctx[2 * k] * 256 + ctx[2 * k + 1]];
function learn(ctx: Uint16Array, k: number, b: number) {
  const j = 2 * k;
  ctx[j + b]++;
  if (ctx[j] + ctx[j + 1] > COUNT_LIMIT) {
    ctx[j] = (ctx[j] + 1) >> 1;
    ctx[j + 1] = (ctx[j + 1] + 1) >> 1;
  }
}

/** LZMA's range encoder: a 32-bit range, its low end carried into the bytes already written. */
class RangeWriter implements Coder {
  private low = 0;
  private range = 0xffffffff;
  private cache = 0;
  private pending = 0;
  private first = true;
  constructor(private readonly out: Writer) {}
  bit(ctx: Uint16Array, k: number, b: number): number {
    const bound = (this.range >>> ODDS_BITS) * zeroOdds(ctx, k);
    if (b) {
      this.low += bound;
      this.range -= bound;
    } else this.range = bound;
    learn(ctx, k, b);
    while (this.range < RANGE_TOP) {
      this.range *= 256;
      this.shift();
    }
    return b;
  }
  raw(v: number, n: number): number {
    for (let k = n - 1; k >= 0; k--) {
      this.range = this.range >>> 1;
      if (Math.floor(v / 2 ** k) % 2) this.low += this.range;
      while (this.range < RANGE_TOP) {
        this.range *= 256;
        this.shift();
      }
    }
    return v;
  }
  private shift() {
    if (this.low < 0xff000000 || this.low >= 0x100000000) {
      const carry = this.low >= 0x100000000 ? 1 : 0;
      // the first byte is always 0 (no carry reaches it), so it is left out
      if (!this.first) this.out.byte((this.cache + carry) & 0xff);
      else if (carry) throw new Error('the range coder carried into its first byte');
      else this.first = false;
      for (; this.pending > 0; this.pending--) this.out.byte((0xff + carry) & 0xff);
      this.cache = Math.floor(this.low / RANGE_TOP) & 0xff;
    } else this.pending++;
    this.low = (this.low % RANGE_TOP) * 256;
  }
  /** Writes out the rest: the four bytes of the low end. */
  finish() {
    for (let k = 0; k < 5; k++) this.shift();
  }
}

/** LZMA's range decoder over the bytes left in `r`, which it must read to the last. */
class RangeReader implements Coder {
  private range = 0xffffffff;
  private code = 0;
  constructor(private readonly r: Reader) {
    for (let k = 0; k < 4; k++) this.code = this.code * 256 + r.byte();
    if (this.code >= this.range) throw new Corrupt();
  }
  bit(ctx: Uint16Array, k: number): number {
    const bound = (this.range >>> ODDS_BITS) * zeroOdds(ctx, k);
    let b = 0;
    if (this.code < bound) this.range = bound;
    else {
      this.code -= bound;
      this.range -= bound;
      b = 1;
    }
    learn(ctx, k, b);
    while (this.range < RANGE_TOP) {
      this.range *= 256;
      this.code = this.code * 256 + this.r.byte();
    }
    return b;
  }
  raw(_v: number, n: number): number {
    let v = 0;
    for (let k = 0; k < n; k++) {
      this.range = this.range >>> 1;
      let b = 0;
      if (this.code >= this.range) {
        this.code -= this.range;
        b = 1;
        // the sliver an odd range leaves above both halves holds nothing an encoder writes
        if (this.code >= this.range) throw new Corrupt();
      }
      v = v * 2 + b;
      while (this.range < RANGE_TOP) {
        this.range *= 256;
        this.code = this.code * 256 + this.r.byte();
      }
    }
    return v;
  }
}

/**
 * `u` (0 to 2^53 - 1) at even odds, as Elias gamma: the number of bits of `u + 1` less one, as
 * that many 1s and a 0, then those bits of `u + 1` below its highest. Every bit of it takes a bit
 * of the text, so a count read from a corrupt one cannot grow without the text growing with it.
 */
function rawCount(c: Coder, u: number): number {
  let top = 0;
  for (let v = u + 1; v >= 2; v = Math.floor(v / 2)) top++;
  let len = 0;
  while (c.raw(len < top ? 1 : 0, 1)) if (++len > 53) throw new Corrupt();
  const v = 2 ** len - 1 + c.raw(u + 1 - 2 ** len, len);
  if (!Number.isSafeInteger(v)) throw new Corrupt();
  return v;
}

/** The most bits a count of the flow (`count`) takes. */
const COUNT_STEPS = 16;
/** `u` (0 to 2^16 - 2) as Elias gamma, its 1s and 0 under contexts `at` to `at + 15` of `ctx`. */
function count(c: Coder, ctx: Uint16Array, at: number, u: number): number {
  let top = 0;
  for (let v = u + 1; v >= 2; v = Math.floor(v / 2)) top++;
  let len = 0;
  while (c.bit(ctx, at + len, len < top ? 1 : 0)) if (++len >= COUNT_STEPS) throw new Corrupt();
  return 2 ** len - 1 + c.raw(u + 1 - 2 ** len, len);
}

/** A tile plane's contexts for a group: 4, 2 and 1 for the neighbours, 15 for the four bits. */
const PLANE_CTX = 22;
/** The same for a plane of five bits a value (the generated levels): 31 for the bits. */
const LEVEL_CTX = 38;
/** What a chunk text holds for NO_LEVEL: all five bits set. */
const NO_STORED = 31;
/** The groups a tile plane's tiles fall in: as many as there are ids. */
const PLANE_GROUPS = 16;

/**
 * Tile `v` (0 to 15, or to 31 with `bits` of 5) of a plane, under the contexts of its group from
 * `at`: whether it is its left neighbour's `L`, else its upper neighbour's `U`, else its upper
 * right one's `R`, each asked only when it is a value not asked yet nor `skip`; else its bits, the
 * highest first. `L` is -1 for the rectangle's first tile, which has no neighbour.
 */
function tileValue(
  c: Coder,
  ctx: Uint16Array,
  at: number,
  v: number,
  L: number,
  U: number,
  R: number,
  skip: number,
  bits = 4,
): number {
  if (L >= 0) {
    if (L !== skip && c.bit(ctx, at + (L === U ? 1 : 0) + (U === R ? 2 : 0), v === L ? 1 : 0))
      return L;
    if (U !== L && U !== skip && c.bit(ctx, at + 4 + (U === R ? 1 : 0), v === U ? 1 : 0)) return U;
    if (R !== L && R !== U && R !== skip && c.bit(ctx, at + 6, v === R ? 1 : 0)) return R;
  }
  let node = 1;
  for (let k = bits - 1; k >= 0; k--) node = 2 * node + c.bit(ctx, at + 6 + node, (v >> k) & 1);
  return node - 2 ** bits;
}

/** codePlane's contexts, kept between calls (coding never runs inside itself), cleared for each. */
const planeContexts = new Uint16Array(2 * PLANE_GROUPS * (PLANE_CTX + 2));

/**
 * A plane of values 0 to 15 in rows (tileValue), each tile in the group `groups` gives it (or
 * group 0). With `first`, each tile is first asked whether it is `first`'s value there, under a
 * context of its group and whether the tile before it was.
 */
function codePlane(
  c: Coder,
  plane: Uint8Array,
  w: number,
  h: number,
  groups: Uint8Array | null,
  first: Uint8Array | null,
) {
  const ctx = planeContexts.fill(0);
  const firstAt = PLANE_GROUPS * PLANE_CTX;
  for (let y = 0, i = 0; y < h; y++)
    for (let x = 0; x < w; x++, i++) {
      const g = groups ? groups[i] : 0;
      const up = y > 0 ? plane[i - w] : -1;
      const L = x > 0 ? plane[i - 1] : up;
      const U = up >= 0 ? up : L;
      const R = y > 0 && x + 1 < w ? plane[i - w + 1] : U;
      let skip = -1;
      if (first) {
        skip = first[i];
        const j = x > 0 ? i - 1 : i - w;
        const took = j >= 0 && plane[j] === first[j] ? 1 : 0;
        if (c.bit(ctx, firstAt + 2 * g + took, plane[i] === skip ? 1 : 0)) {
          plane[i] = skip;
          continue;
        }
      }
      plane[i] = tileValue(c, ctx, g * PLANE_CTX, plane[i], L, U, R, skip);
    }
}

/** codeLevels' contexts, kept between calls like planeContexts. */
const levelContexts = new Uint16Array(2 * PLANE_GROUPS * (LEVEL_CTX + 2));

/**
 * The generated levels (version 6): whether any tile is set, and if so every tile as a value of
 * five bits (tileValue) in the contexts of its terrain. The plane in memory holds NO_LEVEL where
 * the text holds NO_STORED; a decoder is given a plane of NO_LEVEL.
 */
function codeLevels(c: Coder, plane: Uint8Array, terrain: Uint8Array, w: number, h: number) {
  const stored = plane.map((v) => (v === NO_LEVEL ? NO_STORED : v));
  const any = new Uint16Array(2);
  if (!c.bit(any, 0, stored.some((v) => v !== NO_STORED) ? 1 : 0)) return;
  const ctx = levelContexts.fill(0);
  for (let y = 0, i = 0; y < h; y++)
    for (let x = 0; x < w; x++, i++) {
      const up = y > 0 ? stored[i - w] : -1;
      const L = x > 0 ? stored[i - 1] : up;
      const U = up >= 0 ? up : L;
      const R = y > 0 && x + 1 < w ? stored[i - w + 1] : U;
      const v = tileValue(c, ctx, terrain[i] * LEVEL_CTX, stored[i], L, U, R, -1, 5);
      if (v > MAX_LEVEL && v !== NO_STORED) throw new Corrupt();
      stored[i] = v;
      plane[i] = v === NO_STORED ? NO_LEVEL : v;
    }
}

/** The flow of each river tile, from a river tile before it in rows that it runs to or from. */
function codeFlow(c: Coder, flow: Uint16Array, flowDir: Uint8Array, w: number, h: number) {
  const steps = new Uint16Array(2 * 3 * COUNT_STEPS);
  const sign = new Uint16Array(2 * 2);
  for (let y = 0, i = 0; y < h; y++)
    for (let x = 0; x < w; x++, i++) {
      const d = flowDir[i];
      if (!d) continue;
      // 0: the left or upper tile runs into this one; 1: this one runs into it; 2: neither
      const l = x > 0 ? flowDir[i - 1] : 0;
      const u = y > 0 ? flowDir[i - w] : 0;
      let ref = 0;
      let rel = 2;
      if (l && (l === Dir.E + 1 || d === Dir.W + 1)) {
        ref = flow[i - 1];
        rel = l === Dir.E + 1 ? 0 : 1;
      } else if (u && (u === Dir.S + 1 || d === Dir.N + 1)) {
        ref = flow[i - w];
        rel = u === Dir.S + 1 ? 0 : 1;
      }
      let v: number;
      if (rel === 2) v = count(c, steps, 2 * COUNT_STEPS, flow[i]);
      else {
        const m = count(c, steps, rel * COUNT_STEPS, Math.abs(flow[i] - ref));
        v = m && c.bit(sign, rel, flow[i] < ref ? 1 : 0) ? ref - m : ref + m;
      }
      if (v < 0 || v > FLOW_CAP) throw new Corrupt();
      flow[i] = v;
    }
}

/** The water features: per tile whether it has one, then its drop and edge (waterfalls.ts). */
function codeFeatures(c: Coder, feature: Uint8Array, flowDir: Uint8Array) {
  const ctx = new Uint16Array(2 * 13);
  for (let i = 0; i < feature.length; i++) {
    const f = feature[i];
    const side = flowDir[i];
    if (!c.bit(ctx, side ? 1 : 0, f ? 1 : 0)) continue;
    let drop = 1;
    for (let k = 2; k >= 0; k--) drop = 2 * drop + c.bit(ctx, 1 + drop, (f >> k) & 1);
    let edge: number;
    if (side && c.bit(ctx, 9, fallEdge(f) === side - 1 ? 1 : 0)) edge = side - 1;
    else {
      let node = 1;
      for (let k = 1; k >= 0; k--) node = 2 * node + c.bit(ctx, 9 + node, (fallEdge(f) >> k) & 1);
      edge = node - 4;
    }
    const v = (drop - 8) | (edge << 3);
    if (!v || !isFeature(v)) throw new Corrupt();
    feature[i] = v;
  }
}

/**
 * The contexts of the props, one set kept between chunks (coding never runs inside itself) and
 * cleared for each, as a chunk's text is read without any other.
 */
class PropContexts {
  /** whether a tile has props: by terrain, climate and the scatter hash (codeProps) */
  has = new Uint16Array(2 * 16 * 16 * 7);
  /** whether it has more than 1, 2 and 3: by terrain and the count hash (codeProps) */
  count = new Uint16Array(2 * 16 * 3 * 3);
  /** the kind's five bits: by terrain and climate */
  kind = new Uint16Array(2 * 16 * 16 * 32);
  /** the variant: whether it is each guess, or over 3, then its two bits: by kind */
  variant = new Uint16Array(2 * 32 * 4);
  small = new Uint16Array(2 * 32 * 4);
  /** each offset: whether it is the guess, else whether it is 0: by kind */
  offset = new Uint16Array(2 * 32 * 4);
  clear(): this {
    for (const a of [this.has, this.count, this.kind, this.variant, this.small, this.offset])
      a.fill(0);
    return this;
  }
}
const propContexts = new PropContexts();

/** The index of a prop's kind (KIND_INDEX); 0 to decode, where there is no prop yet. */
function propKind(p: PropInstance | undefined): number {
  if (!p) return 0;
  const k: number | undefined = KIND_INDEX[p.kind];
  if (k === undefined) throw new Error(`chunk encoding has no prop kind ${String(p.kind)}`);
  return k;
}
/** A prop's variant, a safe integer 0 or more; 0 to decode. */
function propVariant(p: PropInstance | undefined): number {
  if (!p) return 0;
  if (!Number.isSafeInteger(p.variant) || p.variant < 0)
    throw new Error(`a prop variant is 0 or more, not ${p.variant}`);
  return p.variant;
}

/** An offset in steps (offsetSteps): the guess, else 0, else its byte. */
function offset(c: Coder, ctx: Uint16Array, at: number, s: number, guess: number): number {
  if (c.bit(ctx, at, s === guess ? 1 : 0)) return guess;
  if (guess !== 0 && c.bit(ctx, at + 1, s === 0 ? 1 : 0)) return 0;
  return signed(c.raw(s & 0xff, 8));
}

/**
 * Prop `k` (0 to 2) of world tile (`wx`, `wy`), its kind under the tile's `group`: the prop read,
 * or `p` itself when encoding.
 */
function guessedProp(
  c: Coder,
  m: PropContexts,
  p: PropInstance | undefined,
  group: number,
  wx: number,
  wy: number,
  k: number,
  seed: number,
): PropInstance {
  const index = propKind(p);
  let node = 1;
  for (let b = 4; b >= 0; b--)
    node = 2 * node + c.bit(m.kind, group * 32 + node, (Math.min(index, 31) >> b) & 1);
  let kind = node - 32;
  if (kind === 31) kind += rawCount(c, index - 31);
  if (kind >= PROP_KINDS.length) throw new Corrupt();
  const at = Math.min(kind, 31) * 4;
  // decorateProps' variant: floor(hash * V), for V of 3, 4 or 2 by kind and climate
  const want = propVariant(p);
  const hv = tileHash(wx + k, wy - k, seed + 9);
  const g3 = Math.floor(hv * 3);
  const g4 = Math.floor(hv * 4);
  const g2 = Math.floor(hv * 2);
  let variant: number;
  if (c.bit(m.variant, at, want === g3 ? 1 : 0)) variant = g3;
  else if (g4 !== g3 && c.bit(m.variant, at + 1, want === g4 ? 1 : 0)) variant = g4;
  else if (g2 !== g3 && g2 !== g4 && c.bit(m.variant, at + 2, want === g2 ? 1 : 0)) variant = g2;
  else if (c.bit(m.variant, at + 3, want > 3 ? 1 : 0)) variant = 4 + rawCount(c, want - 4);
  else {
    let v = 1;
    for (let b = 1; b >= 0; b--) v = 2 * v + c.bit(m.small, at + v, (want >> b) & 1);
    variant = v - 4;
  }
  // decorateProps' offsets: (hash - 0.5) * 0.7 of a tile
  const gx = offsetSteps((tileHash(wx * 3 + k, wy, seed + 7) - 0.5) * 0.7);
  const gy = offsetSteps((tileHash(wx, wy * 3 + k, seed + 8) - 0.5) * 0.7);
  const ox = offset(c, m.offset, at, p ? offsetSteps(p.ox) : 0, gx);
  const oy = offset(c, m.offset, at + 2, p ? offsetSteps(p.oy) : 0, gy);
  return p ?? { kind: PROP_KINDS[kind], variant, ox: ox / 256, oy: oy / 256 };
}

/** A tile's fourth prop or later, all at even odds (22 bits or more): the prop read, or `p`. */
function rawProp(c: Coder, p: PropInstance | undefined): PropInstance {
  const index = propKind(p);
  let kind = c.raw(Math.min(index, 31), 5);
  if (kind === 31) kind += rawCount(c, index - 31);
  if (kind >= PROP_KINDS.length) throw new Corrupt();
  const variant = rawCount(c, propVariant(p));
  const ox = signed(c.raw((p ? offsetSteps(p.ox) : 0) & 0xff, 8));
  const oy = signed(c.raw((p ? offsetSteps(p.oy) : 0) & 0xff, 8));
  return p ?? { kind: PROP_KINDS[kind], variant, ox: ox / 256, oy: oy / 256 };
}

/** The props, tile by tile in rows. `lists` holds them by tile to encode; null to decode. */
function codeProps(
  c: Coder,
  t: Tiles,
  w: number,
  h: number,
  g: Guess,
  lists: (PropInstance[] | undefined)[] | null,
) {
  const m = propContexts.clear();
  for (let y = 0, i = 0; y < h; y++)
    for (let x = 0; x < w; x++, i++) {
      const list = lists ? lists[i] : undefined;
      const want = list ? list.length : 0;
      const ter = t.terrain[i];
      const group = ter * 16 + t.climate[i];
      const wx = g.wx + x;
      const wy = g.wy + y;
      // decorateProps scatters props on open ground where a hash of the tile passes a threshold
      // of its climate's, all of them above 0.85; and gives a forest tile 1 + floor(hash * 2.5)
      const scatter = tileHash(wx, wy, g.seed + 5);
      const band = scatter < 0.85 ? 0 : 1 + Math.min(5, Math.floor((scatter - 0.85) * 40));
      if (!c.bit(m.has, group * 7 + band, want ? 1 : 0)) continue;
      const trees = Math.min(2, Math.floor(tileHash(wx, wy, g.seed + 6) * 2.5));
      const at = (ter * 3 + trees) * 3;
      let n = 1;
      if (c.bit(m.count, at, want > 1 ? 1 : 0)) {
        n = 2;
        if (c.bit(m.count, at + 1, want > 2 ? 1 : 0)) {
          n = 3;
          if (c.bit(m.count, at + 2, want > 3 ? 1 : 0)) n = 4 + rawCount(c, want - 4);
        }
      }
      const out: PropInstance[] | null = lists ? null : [];
      for (let k = 0; k < n; k++) {
        const p = list?.[k];
        const read = k < 3 ? guessedProp(c, m, p, group, wx, wy, k, g.seed) : rawProp(c, p);
        out?.push(read);
      }
      if (out) t.props.set(i, out);
    }
}

/** The planes of version 5 or 6 after the head, encoded from `t` and `lists`, or decoded into `t`. */
function codeTiles(
  c: Coder,
  t: Tiles,
  w: number,
  h: number,
  g: Guess,
  lists: (PropInstance[] | undefined)[] | null,
  version: number,
) {
  const { terrain, biome, climate, variant, waterSurface, flow, flowDir, feature } = t;
  codePlane(c, terrain, w, h, null, null);
  codePlane(c, climate, w, h, null, null);
  codePlane(c, biome, w, h, terrain, climate);
  // each variant as what it adds (mod 4) to emptyMap's, floor(hash * 4) of its world tile: first
  // for each row whether it adds nothing on any tile
  const rest = new Uint16Array(2 * 4);
  const guess = new Uint8Array(w);
  for (let y = 0, i = 0; y < h; y++, i += w) {
    let none = 1;
    for (let x = 0; x < w; x++) {
      guess[x] = Math.floor(tileHash(g.wx + x, g.wy + y, g.seed) * 4);
      if (variant[i + x] !== guess[x]) none = 0;
    }
    if (c.bit(rest, 0, none)) {
      variant.set(guess, i);
      continue;
    }
    for (let x = 0; x < w; x++) {
      const r = (variant[i + x] - guess[x]) & 3;
      const hi = c.bit(rest, 1, r >> 1);
      variant[i + x] = (guess[x] + 2 * hi + c.bit(rest, 2 + hi, r & 1)) & 3;
    }
  }
  // the water planes' groups, and whether each is there at all (a decoder's are all 0 so far)
  const water = new Uint8Array(w * h);
  let levels = 0;
  let rivers = 0;
  let features = 0;
  for (let i = 0; i < w * h; i++) {
    if (terrain[i] === Terrain.Water) water[i] = 1;
    levels |= waterSurface[i];
    rivers |= flowDir[i];
    features |= feature[i];
  }
  const any = new Uint16Array(2 * 3);
  if (c.bit(any, 0, levels ? 1 : 0)) codePlane(c, waterSurface, w, h, water, null);
  if (c.bit(any, 1, rivers ? 1 : 0)) {
    codePlane(c, flowDir, w, h, water, null);
    for (let i = 0; i < w * h; i++) if (flowDir[i] > 4) throw new Corrupt();
    codeFlow(c, flow, flowDir, w, h);
  }
  if (c.bit(any, 2, features ? 1 : 0)) codeFeatures(c, feature, flowDir);
  codeProps(c, t, w, h, g, lists);
  if (version >= 6) codeLevels(c, t.generatedLevel, terrain, w, h);
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(text: string): Uint8Array | null {
  let s: string;
  try {
    s = atob(text);
  } catch {
    return null;
  }
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * The text of chunk (`cx`, `cy`): the part of it `map` covers, as the map has it. Call it on a map
 * as generated, before anything is built on it or repaired under it. Throws when the map does not
 * cover the chunk, and when it holds what this encoding cannot (a terrain, biome, climate or water
 * level id over 15, a generated level over MAX_LEVEL that is not NO_LEVEL, a variant over 3, a prop
 * kind PROP_KINDS lacks, a feature byte isFeature refuses), so a generator that makes one has to
 * come with a new CHUNK_VERSION.
 */
export function encodeChunk(map: GameMap, cx: number, cy: number): string {
  return encodeWith(map, cx, cy, null);
}

/** A map's props by the chunk they lie in (chunkIndex), each as its map tile and its list. */
type PropsByChunk = Map<number, [number, PropInstance[]][]>;
/** Chunk (`cx`, `cy`)'s place in a PropsByChunk of `map`. */
const chunkIndex = (map: GameMap, cx: number, cy: number) =>
  (cy - chunkOf(map.originY)) * (chunkOf(map.originX + map.w - 1) - chunkOf(map.originX) + 1) +
  cx -
  chunkOf(map.originX);
/** The props of `map` by chunk: read once for many chunks, rather than tile by tile for each. */
function propsByChunk(map: GameMap): PropsByChunk {
  const out: PropsByChunk = new Map();
  for (const [i, list] of map.props) {
    if (!Number.isInteger(i) || i < 0 || i >= map.w * map.h) continue;
    const x = i % map.w;
    const k = chunkIndex(map, chunkOf(map.originX + x), chunkOf(map.originY + (i - x) / map.w));
    const entries = out.get(k);
    if (entries) entries.push([i, list]);
    else out.set(k, [[i, list]]);
  }
  return out;
}

/**
 * encodeChunk, with the props of the chunk's map tiles as `entries` gives them (propsByChunk), or
 * read off the map tile by tile when it is null.
 */
function encodeWith(
  map: GameMap,
  cx: number,
  cy: number,
  entries: [number, PropInstance[]][] | null,
): string {
  const c = coverage(map, cx, cy);
  if (!c) throw new Error(`the map does not cover chunk ${chunkKey(cx, cy)}`);
  const n = c.w * c.h;
  const t: Tiles = {
    terrain: new Uint8Array(n),
    biome: new Uint8Array(n),
    climate: new Uint8Array(n),
    variant: new Uint8Array(n),
    props: new Map(),
    waterSurface: new Uint8Array(n),
    flow: new Uint16Array(n),
    flowDir: new Uint8Array(n),
    feature: new Uint8Array(n),
    generatedLevel: new Uint8Array(n).fill(NO_LEVEL),
  };
  // the map tile of the rectangle's first tile
  const mx = cx * CHUNK_TILES + c.x0 - map.originX;
  const my = cy * CHUNK_TILES + c.y0 - map.originY;
  const copy = (to: Uint8Array | Uint16Array, from: Uint8Array | Uint16Array | undefined) => {
    if (from)
      for (let y = 0, j = 0; y < c.h; y++)
        for (let x = 0, i = (my + y) * map.w + mx; x < c.w; x++, i++, j++) to[j] = from[i];
  };
  copy(t.terrain, map.terrain);
  copy(t.biome, map.biome);
  copy(t.climate, map.climate ?? map.biome);
  copy(t.variant, map.variant);
  copy(t.waterSurface, map.waterSurface);
  copy(t.flow, map.flow);
  copy(t.flowDir, map.flowDir);
  copy(t.feature, map.feature);
  copy(t.generatedLevel, map.generatedLevel);
  const v = CHUNK_VERSION;
  const ids = (name: string, id: number) =>
    new Error(`chunk encoding ${v} holds ${name} ids 0 to 15, not ${id}`);
  const lists: (PropInstance[] | undefined)[] = new Array(n);
  if (entries)
    for (const [i, list] of entries) {
      const x = i % map.w;
      lists[((i - x) / map.w - my) * c.w + x - mx] = list;
    }
  else
    for (let y = 0; y < c.h; y++)
      for (let x = 0; x < c.w; x++) lists[y * c.w + x] = map.props.get((my + y) * map.w + mx + x);
  for (let i = 0; i < n; i++) {
    if (t.terrain[i] > 15) throw ids('terrain', t.terrain[i]);
    if (t.biome[i] > 15) throw ids('biome', t.biome[i]);
    if (t.climate[i] > 15) throw ids('climate', t.climate[i]);
    if (t.waterSurface[i] > 15) throw ids('water level', t.waterSurface[i]);
    if (t.variant[i] > 3)
      throw new Error(`chunk encoding ${v} holds variants 0 to 3, not ${t.variant[i]}`);
    if (t.generatedLevel[i] > MAX_LEVEL && t.generatedLevel[i] !== NO_LEVEL)
      throw new Error(
        `chunk encoding ${v} holds levels 0 to ${MAX_LEVEL}, not ${t.generatedLevel[i]}`,
      );
    // a prop's kind and variant are checked as it is coded (propKind, propVariant)
    if (!lists[i]?.length) lists[i] = undefined;
  }
  for (let i = 0; i < n; i++) {
    const d = t.flowDir[i];
    if (d > 4) throw new Error(`chunk encoding ${v} holds sides 1 to 4, not ${d}`);
    if (!d && t.flow[i]) throw new Error(`chunk encoding ${v} holds flow on a river tile only`);
    if (t.flow[i] > FLOW_CAP)
      throw new Error(`chunk encoding ${v} holds flow up to ${FLOW_CAP}, not ${t.flow[i]}`);
    if (!isFeature(t.feature[i]))
      throw new Error(
        `chunk encoding ${v} holds waterfalls of 1 to ${MAX_DROP} levels and no ` +
          `other feature, not the byte ${t.feature[i]}`,
      );
  }
  const out = new Writer();
  for (const b of [CHUNK_VERSION, c.x0, c.y0, c.w, c.h]) out.byte(b);
  // the seed as it is, so that the guesses are generation's for any seed a world may have; as a
  // number, so that a seed of another kind a save may carry ('7412') is the one number in the head
  // and in every guess (seed + 5 is 7417, not '74125'), as decodeChunk reads it
  const seed = Number(map.seed);
  if (Number.isInteger(seed) && Math.abs(seed) < SEED_LIMIT) out.varint(zigzag(seed));
  else {
    out.varint(SEED_FLOAT);
    out.float64(seed);
  }
  const gx = guessable(cx);
  const gy = guessable(cy);
  for (const k of [gx, gy]) out.varint(zigzag(k));
  const coder = new RangeWriter(out);
  const g = { seed, wx: gx * CHUNK_TILES + c.x0, wy: gy * CHUNK_TILES + c.y0 };
  codeTiles(coder, t, c.w, c.h, g, lists, CHUNK_VERSION);
  coder.finish();
  return toBase64(out.buf.subarray(0, out.n));
}

/**
 * The planes of a chunk's text; null when it is of a newer encoding, or reading it runs out of
 * bytes, leaves bytes over or meets a value no chunk holds, so a text cut short or run on is never
 * read. No version holds a check of its bytes beyond that: a text with bytes changed, put in or
 * taken out may still read, to other planes than were written.
 */
export function decodeChunk(text: string): ChunkPlanes | null {
  const bytes = fromBase64(text);
  if (!bytes) return null;
  const r = new Reader(bytes);
  try {
    const version = r.byte();
    if (version < 1 || version > CHUNK_VERSION) return null;
    const x0 = r.byte();
    const y0 = r.byte();
    const w = r.byte();
    const h = r.byte();
    if (w < 1 || h < 1 || x0 + w > CHUNK_TILES || y0 + h > CHUNK_TILES) return null;
    const n = w * h;
    let t: Tiles | null;
    if (version < 5) t = readOldPlanes(r, version, n);
    else {
      const head = r.long();
      const seed = head === SEED_FLOAT ? r.float64() : unzigzag(head);
      const gx = unzigzag(r.long());
      const gy = unzigzag(r.long());
      t = {
        terrain: new Uint8Array(n),
        biome: new Uint8Array(n),
        climate: new Uint8Array(n),
        variant: new Uint8Array(n),
        props: new Map(),
        waterSurface: new Uint8Array(n),
        flow: new Uint16Array(n),
        flowDir: new Uint8Array(n),
        feature: new Uint8Array(n),
        generatedLevel: new Uint8Array(n).fill(NO_LEVEL),
      };
      const g = { seed, wx: gx * CHUNK_TILES + x0, wy: gy * CHUNK_TILES + y0 };
      codeTiles(new RangeReader(r), t, w, h, g, null, version);
    }
    // bytes left over are not something encodeChunk writes
    if (!t || r.i !== bytes.length) return null;
    return { version, x0, y0, w, h, ...t };
  } catch (e) {
    if (e instanceof Corrupt) return null;
    throw e;
  }
}

/**
 * Writes chunk (`cx`, `cy`)'s planes into `map` wherever the map covers them: terrain, biome,
 * climate, variant, the water planes and features, and the props of those tiles, which replace the
 * map's own (the map takes the chunk's prop lists themselves, so decode a chunk again for another
 * map). A map with no climate plane is given one, its climate its biome until a chunk says
 * otherwise, and one with no water plane or feature plane is given it empty. A map with no level
 * plane is given one when the chunk sets any level, NO_LEVEL elsewhere. A plane the chunk's
 * version does not hold is empty there; for the climate that means it is the biome.
 */
export function placeChunk(map: GameMap, cx: number, cy: number, c: ChunkPlanes) {
  place(map, cx, cy, c, true);
}

/** placeChunk; with `clear` false only where the map holds no props on any tile of the chunk. */
function place(map: GameMap, cx: number, cy: number, c: ChunkPlanes, clear: boolean) {
  // the world tile of the rectangle's first tile
  const wx = cx * CHUNK_TILES + c.x0;
  const wy = cy * CHUNK_TILES + c.y0;
  const x0 = Math.max(wx, map.originX);
  const y0 = Math.max(wy, map.originY);
  const x1 = Math.min(wx + c.w, map.originX + map.w);
  const y1 = Math.min(wy + c.h, map.originY + map.h);
  const climate = (map.climate ??= map.biome.slice());
  const surface = (map.waterSurface ??= new Uint8Array(map.w * map.h));
  const flow = (map.flow ??= new Uint16Array(map.w * map.h));
  const flowDir = (map.flowDir ??= new Uint8Array(map.w * map.h));
  const feature = (map.feature ??= new Uint8Array(map.w * map.h));
  // the level plane is made only for a chunk that sets a level: a map from chunks of version 5
  // and earlier has none, and keeps the one-level rule
  let levels = map.generatedLevel;
  if (!levels && c.generatedLevel.some((v) => v !== NO_LEVEL))
    levels = map.generatedLevel = new Uint8Array(map.w * map.h).fill(NO_LEVEL);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y - map.originY) * map.w + x - map.originX;
      const j = (y - wy) * c.w + x - wx;
      map.terrain[i] = c.terrain[j];
      map.biome[i] = c.biome[j];
      map.variant[i] = c.variant[j];
      climate[i] = c.climate[j];
      surface[i] = c.waterSurface[j];
      flow[i] = c.flow[j];
      flowDir[i] = c.flowDir[j];
      feature[i] = c.feature[j];
      if (levels) levels[i] = c.generatedLevel[j];
      if (!clear) continue;
      const list = c.props.get(j);
      if (list) map.props.set(i, list);
      else map.props.delete(i);
    }
  if (clear) return;
  for (const [j, list] of c.props) {
    const x = wx + (j % c.w);
    const y = wy + Math.floor(j / c.w);
    if (x >= x0 && y >= y0 && x < x1 && y < y1)
      map.props.set((y - map.originY) * map.w + x - map.originX, list);
  }
}

/**
 * The text of every chunk a map covers, under its key. Only for a map as generated (see
 * encodeChunk); a game builds its map and its store with buildMap.
 */
export function encodeMap(map: GameMap): ChunkStore {
  const store: ChunkStore = {};
  const props = propsByChunk(map);
  for (const { cx, cy } of mapChunks(map))
    store[chunkKey(cx, cy)] = encodeWith(map, cx, cy, props.get(chunkIndex(map, cx, cy)) ?? []);
  return store;
}

/**
 * The map of a generated world, from its stored chunks. Each chunk the map covers comes from its
 * text in `chunks`. A chunk with no text is generated with `generate`, and its text added to the
 * store, so the next call reads it instead. `generate` runs at most once, on the whole of `params`
 * (where the start chunk lies shapes generation), and not at all when every chunk is stored. The
 * default is generateMap of the default production chain; a game passes a generator with its
 * save's chain.
 *
 * A stored chunk that holds less of itself than the map now covers (a map whose edge was off the
 * chunk grid, grown since) keeps its tiles and has the rest generated, and its text is replaced by
 * one of all the map covers. A text that cannot be read is reported and kept (see BuiltMap).
 *
 * The map has every chunk as its text decodes, generated ones too: props where the store puts
 * them (see the encoding above), and a climate plane, which is the biome in a chunk stored before
 * the plane. Whatever is later built on the map or repaired under it, the store keeps the ground as
 * generated. Where a generated tile meets a stored one, the generated side is fitted to it before
 * it is stored (seam: a river that ran on into a stored chunk ends in a pond).
 */
export function buildMap(
  seed: number,
  params: Partial<MapGenParams>,
  chunks: ChunkStore,
  generate: MapGenerator = generateMap,
): BuiltMap {
  const p: MapGenParams = { ...DEFAULT_MAP_PARAMS, ...params };
  const frame = { w: p.w, h: p.h, originX: p.originX ?? 0, originY: p.originY ?? 0 };
  const plan = mapChunks(frame).map(({ cx, cy }) => {
    const key = chunkKey(cx, cy);
    const text = Object.hasOwn(chunks, key) ? chunks[key] : undefined;
    const stored = typeof text === 'string' ? decodeChunk(text) : null;
    const whole = !!stored && holds(stored, coverage(frame, cx, cy)!);
    return { cx, cy, key, text, stored, whole };
  });
  let map: GameMap;
  const stored = plan.every((c) => c.whole);
  if (stored) map = emptyMap(seed, frame.w, frame.h, Terrain.Grass, frame.originX, frame.originY);
  else {
    map = generate(seed, p);
    const { w, h, originX, originY } = map;
    if (w !== frame.w || h !== frame.h || originX !== frame.originX || originY !== frame.originY)
      throw new Error(
        `the generator made a ${w} x ${h} map at (${originX}, ${originY}), not ` +
          `${frame.w} x ${frame.h} at (${frame.originX}, ${frame.originY})`,
      );
  }
  const out: ChunkStore = { ...chunks };
  const added: string[] = [];
  const unreadable: string[] = [];
  // an empty map has no props for a chunk to clear, and chunks never overlap
  for (const c of plan) if (c.stored) place(map, c.cx, c.cy, c.stored, !stored);
  if (plan.some((c) => c.stored) && !stored) {
    const kept = new Uint8Array(map.w * map.h);
    for (const c of plan) {
      if (!c.stored) continue;
      const wx = c.cx * CHUNK_TILES + c.stored.x0 - map.originX;
      const wy = c.cy * CHUNK_TILES + c.stored.y0 - map.originY;
      for (let y = Math.max(0, wy); y < Math.min(map.h, wy + c.stored.h); y++)
        kept.fill(1, y * map.w + Math.max(0, wx), y * map.w + Math.min(map.w, wx + c.stored.w));
    }
    seam(map, kept);
  }
  // placing a chunk changes the props of its own tiles only, so this holds for every other
  const props = stored ? null : propsByChunk(map);
  for (const c of plan) {
    if (c.whole) continue;
    // generated now, any stored tiles kept, and given as a later load will decode it
    const text = encodeWith(map, c.cx, c.cy, props?.get(chunkIndex(map, c.cx, c.cy)) ?? []);
    placeChunk(map, c.cx, c.cy, decodeChunk(text)!);
    if (c.text !== undefined && !c.stored) unreadable.push(c.key);
    else {
      out[c.key] = text;
      added.push(c.key);
    }
  }
  // a tile no chunk set a level for (a chunk of version 5 or earlier beside one of version 6) is
  // at the level the old rule gives it, so that those tiles are as they were stored
  const levels = map.generatedLevel;
  if (levels?.includes(NO_LEVEL)) {
    const { w, h, terrain, waterSurface } = map;
    const legacy = tileLevels({ w, h, terrain, waterSurface });
    for (let i = 0; i < levels.length; i++) if (levels[i] === NO_LEVEL) levels[i] = legacy[i];
  }
  return { map, chunks: out, added, unreadable };
}

/**
 * The seam between stored tiles (1 in `stored`) and tiles generated now, which a generator that
 * changed in between may not have made to fit (#339's seam rule):
 *
 * - a new river whose way runs into a stored tile that is not water ends at the seam in a pond on
 *   the new side: its last tile is a lake (Lake biome, no flow, no side);
 * - new water stands no higher than one level above a stored tile beside it (levelTarget), and a
 *   river never higher than the water it runs from, so its levels still never rise downstream;
 * - new water's waterfalls are those of its levels as they now stand (fallAt). Where a new river
 *   runs off the map, the generator saw the tile it runs into and the map does not: its drop is
 *   the generator's less what the seam lowered it by.
 *
 * A stored river that runs into a new tile is left as it is, its waterfall too: a chunk stored
 * before CHUNK_VERSION 3 does not say which way its rivers run, and one stored before version 4
 * has no waterfalls. Coasts, lake edges and biome edges cut at the seam are accepted as they fall,
 * and the levels across it stay within one step (tileLevels).
 */
function seam(map: GameMap, stored: Uint8Array) {
  const { w, h, terrain } = map;
  const surface = map.waterSurface!;
  const flow = map.flow!;
  const flowDir = map.flowDir!;
  const ahead = (i: number, d: number) => {
    const x = i % w;
    const y = (i - x) / w;
    const nx = x + DIR_DX[d - 1];
    const ny = y + DIR_DY[d - 1];
    return nx < 0 || ny < 0 || nx >= w || ny >= h ? -1 : ny * w + nx;
  };
  const fresh: number[] = [];
  for (let i = 0; i < w * h; i++) if (!stored[i] && terrain[i] === Terrain.Water) fresh.push(i);
  // the levels the generator gave, for its waterfalls off the map
  const generated = Uint8Array.from(fresh, (i) => surface[i]);
  for (const i of fresh) {
    const d = flowDir[i];
    if (!d) continue;
    const n = ahead(i, d);
    if (n >= 0 && stored[n] && terrain[n] !== Terrain.Water) {
      map.biome[i] = Biome.Lake;
      flow[i] = 0;
      flowDir[i] = 0;
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const i of fresh) {
      let v = surface[i];
      if (!v) continue;
      for (let d = 1; d <= 4; d++) {
        const n = ahead(i, d);
        if (n >= 0) v = Math.min(v, levelTarget(map, n) + 1);
      }
      if (v < surface[i]) {
        surface[i] = v;
        changed = true;
      }
    }
    for (const i of fresh) {
      const n = flowDir[i] ? ahead(i, flowDir[i]) : -1;
      if (n >= 0 && !stored[n] && surface[n] > surface[i]) {
        surface[n] = surface[i];
        changed = true;
      }
    }
  }
  const feature = map.feature!;
  fresh.forEach((i, k) => {
    const d = flowDir[i];
    let fall: number;
    if (d && ahead(i, d) < 0) {
      const drop = fallDrop(feature[i]) - (generated[k] - surface[i]);
      fall = drop > 0 ? fallFeature(drop, d - 1) : 0;
    } else fall = fallAt(map, i);
    feature[i] = (feature[i] & ~FALL_BITS) | fall;
  });
}
