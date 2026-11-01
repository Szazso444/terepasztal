import { Graphics, type Container } from 'pixi.js';
import { tileToWorld } from '../engine/iso';
import {
  EDGE_STRIP_TILES,
  edgeTile,
  inEdgeStrip,
  type EdgeStrip,
  type EdgeStripRequest,
} from '../world/edgeStrip';
import { Terrain } from '../world/tiles';
import { DEFAULT_RELIEF } from './terrainRelief';

/**
 * The picture of the edge strip (src/world/edgeStrip.ts): the ground past the map as a dark
 * wireframe at its true height, white lines along the tile sides, water in blue. The surface runs
 * through the corners of the tiles, each at the height the painted ground has there, so a mountain
 * reads as a mountain and not as a stack of boxes. A corner on water is at the water's level, so
 * water lies flat.
 *
 * It is drawn once, when the strip comes in, in two layers: what lies behind the map (past its two
 * upper edges) under the ground, and what lies before it (past its two lower edges) over the map,
 * so a mountain in front of the map stands in front of it as it will when the map grows. Each tile
 * draws its back two sides, so every side is drawn once. A block of tiles shows while the edge
 * region beside it does (`revealed`): the strip goes on from the ground in view, never from the
 * dark of a region still hidden.
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
 * mean is the painted ground's height on its soft slopes (terrainRelief.ts).
 */
export function cornerLevel(strip: EdgeStrip, cx: number, cy: number): number {
  const W = EDGE_STRIP_TILES;
  let sum = 0,
    n = 0,
    water = Infinity;
  for (let y = cy - 1; y <= cy; y++)
    for (let x = cx - 1; x <= cx; x++) {
      if (x < -W || y < -W || x >= strip.w + W || y >= strip.h + W) continue;
      const t = edgeTile(strip, x, y);
      if (t.terrain === Terrain.Water) water = Math.min(water, t.level);
      sum += t.level;
      n++;
    }
  return water !== Infinity ? water : sum / n;
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
    this.top = new Float32Array(last - this.first).fill(Infinity);
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

/** Works out what shows of the sides of `tiles`, one layer's, in order from the back to the front. */
function hideLines(strip: EdgeStrip, tiles: StripTile[]) {
  const horizon = new Horizon(strip);
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
  tiles: StripTile[];
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
  hideLines(
    strip,
    tiles.filter((t) => !t.front),
  );
  hideLines(
    strip,
    tiles.filter((t) => t.front),
  );
  const blocks = new Map<string, StripBlock>();
  for (const t of tiles) {
    const region = regionOf(Math.max(0, Math.min(w - 1, t.x)), Math.max(0, Math.min(h - 1, t.y)));
    const key = `${t.front ? 1 : 0},${region}`;
    let block = blocks.get(key);
    if (!block) blocks.set(key, (block = { region, tiles: [] }));
    block.tiles.push(t);
  }
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

/** The tile's surface, and its walls down to the ground, whose foot the map covers. */
function fillTile(g: Graphics, t: StripTile) {
  const color = faded(t.water ? WATER_FILL : GROUND_FILL, stripFade(t.past));
  const [top, right, bottom, left] = t.corners;
  const ground = (dx: number, dy: number): Point => {
    const p = tileToWorld(t.x + dx, t.y + dy);
    return [p.x, p.y];
  };
  if (t.wallX) g.poly([...right, ...bottom, ...ground(0.5, 0.5), ...ground(0.5, -0.5)]).fill(color);
  if (t.wallY) g.poly([...left, ...bottom, ...ground(0.5, 0.5), ...ground(-0.5, 0.5)]).fill(color);
  g.poly([...top, ...right, ...bottom, ...left]).fill(color);
}

/**
 * The lines of a block, one path to each colour and fade. They go on one pixel wide at every zoom
 * (`pixelLine`), and in one batch after the fills, which is why what is hidden is cut out of them
 * beforehand rather than painted over.
 */
function lineTiles(g: Graphics, tiles: StripTile[]) {
  for (const water of [false, true])
    for (let past = 1; past <= EDGE_STRIP_TILES; past++) {
      let any = false;
      for (const t of tiles) {
        if (t.past !== past || t.water !== water) continue;
        for (let i = 0; i < t.lines.length; i += 4) {
          g.moveTo(t.lines[i], t.lines[i + 1]).lineTo(t.lines[i + 2], t.lines[i + 3]);
          any = true;
        }
      }
      if (any)
        g.stroke({
          pixelLine: true,
          color: water ? WATER_LINE : GROUND_LINE,
          alpha: LINE_ALPHA * stripFade(past),
        });
    }
}

/** A block as drawn. */
export interface StripShape {
  region: number;
  shape: Graphics;
}

/** Draws the strip into `back` and `front`, a Graphics a block: the camera culls them by block. */
export function drawEdgeStrip(
  strip: EdgeStrip,
  regionOf: (x: number, y: number) => number,
  back: Container,
  front: Container,
): StripShape[] {
  return stripBlocks(strip, regionOf).map(({ region, tiles }) => {
    const shape = new Graphics();
    shape.cullable = true;
    for (const t of tiles) fillTile(shape, t);
    lineTiles(shape, tiles);
    (tiles[0].front ? front : back).addChild(shape);
    return { region, shape };
  });
}

/** Builds the strip in a worker; null where there are no workers, or the build failed. */
export function buildEdgeStrip(req: EdgeStripRequest): Promise<EdgeStrip | null> {
  if (typeof Worker === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const worker = new Worker(new URL('../world/edgeStrip.worker.ts', import.meta.url), {
      type: 'module',
    });
    const done = (strip: EdgeStrip | null) => {
      worker.terminate();
      resolve(strip);
    };
    worker.onmessage = (e: MessageEvent<EdgeStrip | null>) => done(e.data);
    worker.onerror = () => done(null);
    worker.postMessage(req);
  });
}
