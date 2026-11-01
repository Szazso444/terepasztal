import { tileToWorld } from '../engine/iso';
import { EDGE_STRIP_TILES, edgeTile, inEdgeStrip, type EdgeStrip } from '../world/edgeStrip';
import { Terrain } from '../world/tiles';
import { DEFAULT_RELIEF } from './terrainRelief';

/**
 * The shape of the edge strip (src/world/edgeStrip.ts), as arithmetic only: no Pixi here, so it runs
 * in the worker that builds the strip. The surface runs through the corners of the tiles, each at
 * the height the painted ground has there, so a mountain reads as a mountain and not as a stack of
 * boxes. A corner on water is at the water's level, so water lies flat.
 *
 * Each tile draws its back two sides, so every side is drawn once. What is hidden is worked out in
 * each block by itself: a block further back is painted over by the fills of a block before it when
 * both show, and when that block does not show, nothing of it may hide anything. The page gets
 * `StripMesh`es, flat arrays that cross from the worker without a copy, and only draws them
 * (edgeStripView.ts).
 */

/** The fill of ground, near the map: a shade over the page's own #0a0a0c, so a shape reads on it. */
const GROUND_FILL = [0x15, 0x17, 0x1c];
/** The fill of water, near the map. */
const WATER_FILL = [0x12, 0x35, 0x58];
/** What every fill fades to, tile by tile: the page's background. */
const FADED = [0x0a, 0x0a, 0x0c];
const GROUND_LINE = 0xffffff;
const WATER_LINE = 0x6fb4e6;
/** The alpha of a tile's sides right beside the map. */
const LINE_ALPHA = 0.5;
/** World pixels per level, as the painted ground has it. */
const STEP = DEFAULT_RELIEF.step;
/** Width in world pixels of the columns hidden lines are worked out in: a quarter of a tile side. */
const COLUMN = 8;
/** How far under what stands in front (world pixels) a line still shows: its own tile's edge. */
const SLACK = 0.5;

/** A point on screen, in world pixels. */
type Point = readonly [number, number];

/** One tile of the strip, ready to draw. */
export interface StripTile {
  x: number;
  y: number;
  water: boolean;
  /** tiles past the map, 1 right beside it to EDGE_STRIP_TILES */
  past: number;
  /** before the map on screen (past a lower edge only): drawn over it */
  front: boolean;
  /** its corners on screen: towards -x-y, +x-y, +x+y and -x+y, so top, right, bottom and left */
  corners: [Point, Point, Point, Point];
  /** whether the side towards +x, and the one towards +y, faces the map: a wall stands on it */
  wallX: boolean;
  wallY: boolean;
  /** the lines to draw for it, each as x0, y0, x1, y1: what shows of its sides */
  lines: number[];
}

/**
 * The level of the surface at tile corner (`cx`, `cy`), the corner of tile (cx, cy) towards -x-y:
 * the lowest water touching it, else the mean of the tiles round it. Where four tiles meet, that
 * mean is the painted ground's height on its soft slopes (terrainRelief.ts). It stays within a level
 * of the highest of them, or a lone peak, whose corners all hold the mean with lower ground, would
 * read low.
 */
export function cornerLevel(strip: EdgeStrip, cx: number, cy: number): number {
  const W = EDGE_STRIP_TILES;
  let sum = 0,
    n = 0,
    top = 0,
    water = Infinity;
  for (let y = cy - 1; y <= cy; y++)
    for (let x = cx - 1; x <= cx; x++) {
      if (x < -W || y < -W || x >= strip.w + W || y >= strip.h + W) continue;
      const t = edgeTile(strip, x, y);
      if (t.terrain === Terrain.Water) water = Math.min(water, t.level);
      sum += t.level;
      top = Math.max(top, t.level);
      n++;
    }
  return water !== Infinity ? water : Math.max(sum / n, top - 1);
}

/** Where tile corner (`cx`, `cy`) stands on screen. */
function cornerPoint(strip: EdgeStrip, cx: number, cy: number): Point {
  const p = tileToWorld(cx - 0.5, cy - 0.5);
  return [p.x, p.y - cornerLevel(strip, cx, cy) * STEP];
}

/**
 * The highest thing drawn so far in each column of the screen. The ground is a height field seen
 * from one fixed side, so a thing further back shows just where it rises over all that stands in
 * front of it. Tiles go in from the front to the back.
 */
class Horizon {
  private top: Float32Array;
  private first: number;
  constructor(strip: EdgeStrip) {
    const W = EDGE_STRIP_TILES;
    this.first = Math.floor(tileToWorld(-W, strip.h + W).x / COLUMN) - 1;
    const last = Math.ceil(tileToWorld(strip.w + W, -W).x / COLUMN) + 1;
    this.top = new Float32Array(last - this.first);
  }
  /** Forgets all that was drawn. */
  clear() {
    this.top.fill(Infinity);
  }
  /** Calls `each` for the columns line `a` to `b` crosses, with the line's height in each. */
  private walk(a: Point, b: Point, each: (column: number, y: number) => void) {
    const [l, r] = a[0] <= b[0] ? [a, b] : [b, a];
    const from = Math.round(l[0] / COLUMN);
    const to = Math.round(r[0] / COLUMN);
    for (let c = from; c < to; c++)
      each(c, l[1] + ((r[1] - l[1]) * ((c + 0.5) * COLUMN - l[0])) / (r[0] - l[0]));
  }
  raise(a: Point, b: Point) {
    this.walk(a, b, (c, y) => {
      const i = c - this.first;
      if (y < this.top[i]) this.top[i] = y;
    });
  }
  /** Adds what shows of line `a` to `b` to `out`, whole stretches of columns at a time. */
  showing(a: Point, b: Point, out: number[]) {
    const at = (x: number) => a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
    let open: number | null = null;
    const close = (x: number) => {
      if (open !== null) out.push(open, at(open), x, at(x));
      open = null;
    };
    this.walk(a, b, (c, y) => {
      const x = c * COLUMN;
      if (y <= this.top[c - this.first] + SLACK) open ??= x;
      else close(x);
    });
    close(Math.max(a[0], b[0]));
  }
}

/** Works out what shows of the sides of `tiles`, one block's, in order from the back to the front. */
function hideLines(horizon: Horizon, tiles: StripTile[]) {
  horizon.clear();
  for (let i = tiles.length - 1; i >= 0; i--) {
    const t = tiles[i];
    const [top, right, bottom, left] = t.corners;
    // a side with no tile before it, as the map is, is this tile's to draw too; the tile's own
    // surface lies behind that side, so it is not in the way
    if (t.wallX) horizon.showing(bottom, right, t.lines);
    if (t.wallY) horizon.showing(left, bottom, t.lines);
    horizon.raise(left, top);
    horizon.raise(top, right);
    horizon.raise(left, bottom);
    horizon.raise(bottom, right);
    horizon.showing(left, top, t.lines);
    horizon.showing(top, right, t.lines);
  }
}

/** The tiles past one edge region, of one layer, from the back to the front. */
export interface StripBlock {
  /** the region of the map the tiles lie past */
  region: number;
  /** the layer: before the map on screen, over it, or behind it */
  front: boolean;
  tiles: StripTile[];
}

/** The block a tile past the map belongs to: the region nearest it, and the layer it is drawn in. */
export function blockOfTile(
  x: number,
  y: number,
  w: number,
  h: number,
  regionOf: (x: number, y: number) => number,
) {
  return {
    region: regionOf(Math.max(0, Math.min(w - 1, x)), Math.max(0, Math.min(h - 1, y))),
    front: x >= 0 && y >= 0,
  };
}

/**
 * The strip's tiles by the region (`regionOf`, of a map tile) they lie past, the nearest there is,
 * in the order they are drawn: from the back to the front, the two layers apart
 * (`StripTile.front`).
 */
export function stripBlocks(
  strip: EdgeStrip,
  regionOf: (x: number, y: number) => number,
): StripBlock[] {
  const { w, h } = strip;
  const W = EDGE_STRIP_TILES;
  const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const tiles: StripTile[] = [];
  for (let y = -W; y < h + W; y++)
    for (let x = -W; x < w + W; x++) {
      if (!inEdgeStrip(x, y, w, h)) continue;
      const front = x >= 0 && y >= 0;
      tiles.push({
        x,
        y,
        water: edgeTile(strip, x, y).terrain === Terrain.Water,
        past: Math.max(-x, -y, x - (w - 1), y - (h - 1)),
        front,
        corners: [
          cornerPoint(strip, x, y),
          cornerPoint(strip, x + 1, y),
          cornerPoint(strip, x + 1, y + 1),
          cornerPoint(strip, x, y + 1),
        ],
        wallX: !front && inMap(x + 1, y),
        wallY: !front && inMap(x, y + 1),
        lines: [],
      });
    }
  tiles.sort((a, b) => a.x + a.y - (b.x + b.y));
  const blocks = new Map<string, StripBlock>();
  for (const t of tiles) {
    const { region, front } = blockOfTile(t.x, t.y, w, h, regionOf);
    const key = `${front ? 1 : 0},${region}`;
    let block = blocks.get(key);
    if (!block) blocks.set(key, (block = { region, front, tiles: [] }));
    block.tiles.push(t);
  }
  const horizon = new Horizon(strip);
  for (const block of blocks.values()) hideLines(horizon, block.tiles);
  // the tiles are in order, so each block is, and the first of a block says where it stands
  const depth = (b: StripBlock) => b.tiles[0].x + b.tiles[0].y;
  return [...blocks.values()].sort((a, b) => depth(a) - depth(b));
}

/** `from` faded towards the background by how much of a tile is left, 0 to 1. */
function faded(from: readonly number[], k: number) {
  const c = from.map((v, i) => Math.round(FADED[i] + (v - FADED[i]) * k));
  return (c[0] << 16) | (c[1] << 8) | c[2];
}

/** How much of a tile's fill and lines is left `past` tiles from the map. */
export const stripFade = (past: number) => 1 - (past - 1) / EDGE_STRIP_TILES;

/** A block as the worker hands it to the page, in the order it is drawn. */
export interface StripMesh {
  region: number;
  front: boolean;
  /** the shapes to fill, each four corners, eight numbers: walls and tiles, back to front */
  quads: Float32Array;
  /** the colour of each shape */
  colors: Uint32Array;
  /** the lines, each as x0, y0, x1, y1 */
  lines: Float32Array;
  /** the runs of lines of one look, three numbers each: where it ends in `lines`, colour, alpha */
  runs: Float32Array;
}

/** The shapes of a tile: its walls down to the ground, whose foot the map covers, and its surface. */
function tileShapes(t: StripTile): { color: number; quad: number[] }[] {
  const color = faded(t.water ? WATER_FILL : GROUND_FILL, stripFade(t.past));
  const [top, right, bottom, left] = t.corners;
  const ground = (dx: number, dy: number): Point => {
    const p = tileToWorld(t.x + dx, t.y + dy);
    return [p.x, p.y];
  };
  const out: { color: number; quad: number[] }[] = [];
  if (t.wallX)
    out.push({ color, quad: [...right, ...bottom, ...ground(0.5, 0.5), ...ground(0.5, -0.5)] });
  if (t.wallY)
    out.push({ color, quad: [...left, ...bottom, ...ground(0.5, 0.5), ...ground(-0.5, 0.5)] });
  out.push({ color, quad: [...top, ...right, ...bottom, ...left] });
  return out;
}

/** The lines of a block, in runs of one colour and fade: one path to each when drawn. */
function lineRuns(tiles: StripTile[]) {
  const lines: number[] = [];
  const runs: number[] = [];
  for (const water of [false, true])
    for (let past = 1; past <= EDGE_STRIP_TILES; past++) {
      const from = lines.length;
      for (const t of tiles)
        if (t.past === past && t.water === water) for (const v of t.lines) lines.push(v);
      if (lines.length > from)
        runs.push(lines.length, water ? WATER_LINE : GROUND_LINE, LINE_ALPHA * stripFade(past));
    }
  return { lines, runs };
}

/** A block as flat arrays. */
export function stripMesh({ region, front, tiles }: StripBlock): StripMesh {
  const shapes = tiles.flatMap(tileShapes);
  const { lines, runs } = lineRuns(tiles);
  return {
    region,
    front,
    quads: Float32Array.from(shapes.flatMap((s) => s.quad)),
    colors: Uint32Array.from(shapes, (s) => s.color),
    lines: Float32Array.from(lines),
    runs: Float32Array.from(runs),
  };
}

/** The strip as its worker answers with it. */
export function stripMeshes(
  strip: EdgeStrip,
  regionOf: (x: number, y: number) => number,
): StripMesh[] {
  return stripBlocks(strip, regionOf).map(stripMesh);
}

/** The buffers of `meshes`, to hand over rather than copy. */
export function meshBuffers(meshes: StripMesh[]): ArrayBuffer[] {
  return meshes.flatMap((m) =>
    [m.quads, m.colors, m.lines, m.runs].map((a) => a.buffer as ArrayBuffer),
  );
}
