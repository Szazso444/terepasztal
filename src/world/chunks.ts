import { DEFAULT_MAP_PARAMS, emptyMap, generateMap, type MapGenParams } from './mapgen';
import { DIR_DX, DIR_DY } from '../engine/iso';
import { levelTarget } from './elevation';
import { FLOW_CAP } from './rivers';
import { FALL_BITS, MAX_DROP, fallAt, fallDrop, fallFeature, isFeature } from './waterfalls';
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
 * then on. Its bytes, in order:
 *
 * - the encoding version, CHUNK_VERSION;
 * - the rectangle of the chunk it holds: x0, y0, w, h, a byte each. A game's map holds whole
 *   chunks (0, 0, 32, 32); a map whose edge is off the chunk grid holds part of one;
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
 * Varints are unsigned LEB128. Offsets are rounded to the nearest 256th of a tile, so a stored
 * prop sits at most a 512th of a tile from where generation put it; buildMap gives every chunk,
 * new or loaded, as its text decodes, so a world looks the same before and after a load.
 *
 * A later plane joins under a bump of CHUNK_VERSION, at a place in the bytes its version names,
 * and a chunk of an older version decodes with that plane empty: version 1 holds no climate, and
 * its climate is its biome; versions 1 and 2 hold no water levels, flow or sides, so their water
 * is at level 0 and their rivers have neither; versions 1 to 3 hold no water features, so they
 * have no waterfalls.
 */

/** Chunk edge in world tiles: emptyMap's region size. */
export const CHUNK_TILES = 32;
/** The encoding encodeChunk writes; decodeChunk reads it and every one before it. */
export const CHUNK_VERSION = 4;

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
   * keys whose stored text could not be read (corrupt, or of a newer CHUNK_VERSION): the map has
   * them as generated now, and their text is kept, never replaced
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
  buf = new Uint8Array(2048);
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
  varint() {
    let v = 0;
    for (let k = 0, scale = 1; k < 7; k++, scale *= 0x80) {
      const b = this.byte();
      v += (b & 0x7f) * scale;
      if (b < 0x80) return v;
    }
    throw new Corrupt();
  }
}

/** A plane of ids 0 to 15 as runs (see the encoding above). */
function writeRuns(out: Writer, plane: Uint8Array, name: string) {
  for (let i = 0; i < plane.length;) {
    const v = plane[i];
    if (v > 15)
      throw new Error(`chunk encoding ${CHUNK_VERSION} holds ${name} ids 0 to 15, not ${v}`);
    let end = i + 1;
    while (end < plane.length && plane[end] === v) end++;
    const len = end - i;
    if (len < 16) out.byte((v << 4) | (len - 1));
    else {
      out.byte((v << 4) | 15);
      out.varint(len - 16);
    }
    i = end;
  }
}
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

/** An offset within a tile as a chunk stores it: in 256ths of a tile, -128 to 127. */
const offsetSteps = (v: number) => Math.max(-128, Math.min(127, Math.round(v * 256)));

function writeProp(out: Writer, p: PropInstance) {
  const kind: number | undefined = KIND_INDEX[p.kind];
  if (kind === undefined) throw new Error(`chunk encoding has no prop kind ${String(p.kind)}`);
  const v = p.variant;
  if (!Number.isSafeInteger(v) || v < 0) throw new Error(`a prop variant is 0 or more, not ${v}`);
  if (kind < 31 && v < 8) out.byte(kind | (v << 5));
  else {
    out.byte(31);
    out.varint(kind);
    out.varint(v);
  }
  out.byte(offsetSteps(p.ox) & 0xff);
  out.byte(offsetSteps(p.oy) & 0xff);
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
  const ox = r.byte();
  const oy = r.byte();
  return {
    kind: PROP_KINDS[kind],
    variant,
    ox: (ox < 128 ? ox : ox - 256) / 256,
    oy: (oy < 128 ? oy : oy - 256) / 256,
  };
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
 * cover the chunk, and when it holds what this encoding cannot (a terrain, biome or climate id over
 * 15, a variant over 3, a prop kind PROP_KINDS lacks, a feature byte isFeature refuses), so a
 * generator that makes one has to come with a new CHUNK_VERSION.
 */
export function encodeChunk(map: GameMap, cx: number, cy: number): string {
  const c = coverage(map, cx, cy);
  if (!c) throw new Error(`the map does not cover chunk ${chunkKey(cx, cy)}`);
  const n = c.w * c.h;
  const terrain = new Uint8Array(n);
  const biome = new Uint8Array(n);
  const climate = new Uint8Array(n);
  const variant = new Uint8Array(n);
  const surface = new Uint8Array(n);
  const flow = new Uint16Array(n);
  const flowDir = new Uint8Array(n);
  const feature = new Uint8Array(n);
  // the map tile of the rectangle's first tile
  const mx = cx * CHUNK_TILES + c.x0 - map.originX;
  const my = cy * CHUNK_TILES + c.y0 - map.originY;
  for (let y = 0; y < c.h; y++) {
    const from = (my + y) * map.w + mx;
    terrain.set(map.terrain.subarray(from, from + c.w), y * c.w);
    biome.set(map.biome.subarray(from, from + c.w), y * c.w);
    climate.set((map.climate ?? map.biome).subarray(from, from + c.w), y * c.w);
    variant.set(map.variant.subarray(from, from + c.w), y * c.w);
    if (map.waterSurface) surface.set(map.waterSurface.subarray(from, from + c.w), y * c.w);
    if (map.flow) flow.set(map.flow.subarray(from, from + c.w), y * c.w);
    if (map.flowDir) flowDir.set(map.flowDir.subarray(from, from + c.w), y * c.w);
    if (map.feature) feature.set(map.feature.subarray(from, from + c.w), y * c.w);
  }
  const out = new Writer();
  for (const b of [CHUNK_VERSION, c.x0, c.y0, c.w, c.h]) out.byte(b);
  writeRuns(out, terrain, 'terrain');
  writeRuns(out, biome, 'biome');
  writeRuns(out, climate, 'climate');
  for (let i = 0; i < n; i += 4) {
    let b = 0;
    for (let k = 0; k < 4 && i + k < n; k++) {
      const v = variant[i + k];
      if (v > 3) throw new Error(`chunk encoding ${CHUNK_VERSION} holds variants 0 to 3, not ${v}`);
      b |= v << (2 * k);
    }
    out.byte(b);
  }
  const tiles: [number, PropInstance[]][] = [];
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) {
      const list = map.props.get((my + y) * map.w + mx + x);
      if (list?.length) tiles.push([y * c.w + x, list]);
    }
  out.varint(tiles.length);
  let last = -1;
  for (const [i, list] of tiles) {
    const more = Math.min(list.length - 1, 3);
    out.varint((i - last - 1) * 4 + more);
    if (more === 3) out.varint(list.length - 4);
    for (const p of list) writeProp(out, p);
    last = i;
  }
  writeRuns(out, surface, 'water level');
  const rivers: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = flowDir[i];
    if (d > 4) throw new Error(`chunk encoding ${CHUNK_VERSION} holds sides 1 to 4, not ${d}`);
    if (d) rivers.push(i);
    else if (flow[i])
      throw new Error(`chunk encoding ${CHUNK_VERSION} holds flow on a river tile only`);
    if (flow[i] > FLOW_CAP)
      throw new Error(
        `chunk encoding ${CHUNK_VERSION} holds flow up to ${FLOW_CAP}, not ${flow[i]}`,
      );
  }
  out.varint(rivers.length);
  last = -1;
  for (const i of rivers) {
    out.varint(i - last - 1);
    out.varint(flow[i] * 4 + flowDir[i] - 1);
    last = i;
  }
  const features: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = feature[i];
    if (!isFeature(f))
      throw new Error(
        `chunk encoding ${CHUNK_VERSION} holds waterfalls of 1 to ${MAX_DROP} levels and no ` +
          `other feature, not the byte ${f}`,
      );
    if (f) features.push(i);
  }
  out.varint(features.length);
  last = -1;
  for (const i of features) {
    out.varint(i - last - 1);
    out.byte(feature[i]);
    last = i;
  }
  return toBase64(out.buf.subarray(0, out.n));
}

/** The planes of a chunk's text; null when the text is corrupt or of a newer encoding. */
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
    // bytes left over are not something encodeChunk writes
    if (r.i !== bytes.length) return null;
    return {
      version,
      x0,
      y0,
      w,
      h,
      terrain,
      biome,
      climate,
      variant,
      props,
      waterSurface,
      flow,
      flowDir,
      feature,
    };
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
 * otherwise, and one with no water plane or feature plane is given it empty. A plane the chunk's
 * version does not hold is empty there; for the climate that means it is the biome.
 */
export function placeChunk(map: GameMap, cx: number, cy: number, c: ChunkPlanes) {
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
      const list = c.props.get(j);
      if (list) map.props.set(i, list);
      else map.props.delete(i);
    }
}

/**
 * The text of every chunk a map covers, under its key. Only for a map as generated (see
 * encodeChunk); a game builds its map and its store with buildMap.
 */
export function encodeMap(map: GameMap): ChunkStore {
  const store: ChunkStore = {};
  for (const { cx, cy } of mapChunks(map)) store[chunkKey(cx, cy)] = encodeChunk(map, cx, cy);
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
  if (plan.every((c) => c.whole))
    map = emptyMap(seed, frame.w, frame.h, Terrain.Grass, frame.originX, frame.originY);
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
  for (const c of plan) if (c.stored) placeChunk(map, c.cx, c.cy, c.stored);
  if (plan.some((c) => c.stored) && plan.some((c) => !c.whole)) {
    const stored = new Uint8Array(map.w * map.h);
    for (const c of plan) {
      if (!c.stored) continue;
      const wx = c.cx * CHUNK_TILES + c.stored.x0 - map.originX;
      const wy = c.cy * CHUNK_TILES + c.stored.y0 - map.originY;
      for (let y = Math.max(0, wy); y < Math.min(map.h, wy + c.stored.h); y++)
        stored.fill(1, y * map.w + Math.max(0, wx), y * map.w + Math.min(map.w, wx + c.stored.w));
    }
    seam(map, stored);
  }
  for (const c of plan) {
    if (c.whole) continue;
    // generated now, any stored tiles kept, and given as a later load will decode it
    const text = encodeChunk(map, c.cx, c.cy);
    placeChunk(map, c.cx, c.cy, decodeChunk(text)!);
    if (c.text !== undefined && !c.stored) unreadable.push(c.key);
    else {
      out[c.key] = text;
      added.push(c.key);
    }
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
