import { Container, Graphics, MeshSimple, Texture, TilingSprite } from 'pixi.js';
import { DIR_DX, DIR_DY, tileToWorld, type Dir } from '../engine/iso';
import { hash2 } from '../engine/rng';
import type { GameMap } from '../world/tiles';
import { Terrain } from '../world/tiles';
import { headwaterAt, waterfallAt } from '../world/waterfalls';
import { landscapeNoise } from './landscapeModel';
import { paintedWater } from './terrainMaterials';

/**
 * Moving water over the painted ground, the art demo's Animated water (the author's decision of
 * 2026-10-12, #365; "the water animation is very good", 2026-10-16). Still water carries two layers
 * of ripples drifting apart, so patches of glints come and go; rivers carry streaks that run
 * downstream along their channel, fine ones over broad faint ones; falls carry white streaks and
 * flecks of foam; a headwater rings out. All of it follows the clock, so nothing loops or jumps.
 *
 * The wind moves the still water (the Swell of the demo at its Gentle strength, the author's
 * default): fine crests and long swells lie across it and travel downwind, dark patches of gusts run
 * over them, and on the shores it blows toward each wave breaks into a line of foam that runs up and
 * draws back, leaving wet sand behind it. The crests and gusts lie on the ground plane, turned to the
 * wind, so the GPU moves them and a change of wind needs no new picture. The swells lie on a mesh over
 * the view whose picture follows a travel time: they slow in the shallows, so near a shore they bunch
 * up and turn to meet it. In a hard wind white caps form and fade, and rain rings the water. In a
 * calm only the ripples show.
 *
 * The streaks are drawn by alpha bucket, a path a bucket, so a screen of river is a few draws.
 */

/** Tiles a second a river's streak runs (the demo's FLOW_V). */
const FLOW = 0.42;
/** Seconds between redraws of the streaks. */
const REFRESH = 1 / 30;
/** Past this many river tiles in view each carries fewer streaks. */
const BUSY_TILES = 500;
/** Alpha buckets of a kind of streak. */
const BUCKETS = 8;
const STREAK = 0xe4f3ee;
const FOAM = 0xe0ddd2;

/** Which way water enters tile (x, y): the fullest river running into it, or -1. */
export function inflow(map: GameMap, x: number, y: number): number {
  let best = -1;
  let flow = -1;
  for (let d = 0; d < 4; d++) {
    const nx = x - DIR_DX[d as Dir];
    const ny = y - DIR_DY[d as Dir];
    if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
    const n = ny * map.w + nx;
    if (map.flowDir?.[n] === d + 1 && map.flow![n] > flow) {
      best = d;
      flow = map.flow![n];
    }
  }
  return best;
}

/**
 * The point `u` (0 to 1) of a river's way through its tile, from the tile's middle: in by side
 * `from` (the Dir the water is travelling as it enters; -1 straight on) and out along `to`.
 */
export function channelPoint(from: number, to: number, u: number, out: number[]) {
  const ox = DIR_DX[to as Dir] / 2;
  const oy = DIR_DY[to as Dir] / 2;
  const ix = from < 0 ? -ox : -DIR_DX[from as Dir] / 2;
  const iy = from < 0 ? -oy : -DIR_DY[from as Dir] / 2;
  const v = 1 - u;
  out[0] = v * v * ix + u * u * ox;
  out[1] = v * v * iy + u * u * oy;
}

/** A tile of ripples, the game's own short curved strokes in loose clusters. Null under Node. */
function rippleTexture(): Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 768;
  c.height = 384;
  const x = c.getContext('2d');
  if (!x) return null;
  x.scale(2, 2);
  x.lineCap = 'round';
  const clusters: number[][] = [];
  for (let k = 0; k < 14; k++)
    clusters.push([hash2(k, 1, 7) * 384, hash2(k, 2, 7) * 192, 0.4 + 0.6 * hash2(k, 3, 7)]);
  for (let k = 0; k < 150; k++) {
    const q = clusters[k % clusters.length];
    const px = q[0] + (hash2(k, 4, 7) - 0.5) * 70;
    const py = q[1] + (hash2(k, 5, 7) - 0.5) * 34;
    const l = 4 + hash2(k, 6, 7) * 8;
    const a = (0.18 + hash2(k, 8, 7) * 0.3) * q[2];
    x.strokeStyle = `rgba(214,236,228,${a.toFixed(2)})`;
    x.lineWidth = 0.8 + hash2(k, 9, 7) * 0.4;
    for (const ox of [-384, 0, 384])
      for (const oy of [-192, 0, 192]) {
        x.beginPath();
        x.moveTo(px + ox, py + oy);
        x.quadraticCurveTo(px + ox + l / 2, py + oy + 0.9, px + ox + l, py + oy - 0.2);
        x.stroke();
      }
  }
  return Texture.from(c);
}

/** A canvas of `w` x `h` filled pixel by pixel as a texture; null under Node. */
function painted(w: number, h: number, pixel: (x: number, y: number, out: number[]) => void) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const image = ctx.createImageData(w, h);
  const out = [0, 0, 0, 0];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      pixel(x, y, out);
      image.data.set(out, (y * w + x) * 4);
    }
  ctx.putImageData(image, 0, 0);
  return Texture.from(c);
}
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** The corner each side of a tile starts at, going round it clockwise. */
const CORNER_X = [-0.5, 0.5, 0.5, -0.5];
const CORNER_Y = [-0.5, -0.5, 0.5, 0.5];
/** Ground px a tile side spans on the ground plane. */
const TILE_GROUND = 32 * Math.SQRT2;
/** Ground px between two swell crests in the picture: 1.12 tiles, the Gentle swell in a breeze. */
const SWELL_PERIOD = 64;
const SWELL_ROWS = 4;

/** Fine crests along x, lit, with their trough just downwind: ripples of the wind. */
function crestTexture(): Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const x = c.getContext('2d');
  if (!x) return null;
  x.lineCap = 'round';
  const strokes: number[][] = [];
  for (let k = 0; k < 420; k++) {
    const cx = hash2(k % 16, 1, 21) * 1024;
    const cy = hash2(k % 16, 2, 21) * 512;
    const near = hash2(k, 3, 21) < 0.75;
    const px = near ? cx + (hash2(k, 4, 21) - 0.5) * 220 : hash2(k, 4, 21) * 1024;
    const py = near ? cy + (hash2(k, 5, 21) - 0.5) * 140 : hash2(k, 5, 21) * 512;
    const l = 5 + hash2(k, 6, 21) * 8;
    strokes.push([px, py, l, (0.2 + 0.3 * hash2(k, 7, 21)) * (near ? 0.8 : 0.5)]);
  }
  for (const dark of [true, false]) {
    x.lineWidth = dark ? 1 : 0.8;
    for (const [px, py, l, a] of strokes) {
      x.strokeStyle = dark
        ? `rgba(14,46,60,${(a * 0.62).toFixed(3)})`
        : `rgba(212,238,232,${a.toFixed(3)})`;
      const oy = dark ? 1.6 : 0;
      for (const qx of [-1024, 0, 1024])
        for (const qy of [-512, 0, 512]) {
          x.beginPath();
          x.moveTo(px + qx - l / 2, py + qy + oy);
          x.quadraticCurveTo(px + qx, py + qy + oy + l * 0.2, px + qx + l / 2, py + qy + oy);
          x.stroke();
        }
    }
  }
  return Texture.from(c);
}

/**
 * Long crests along x, a row every SWELL_PERIOD ground px, in stretches that come and go: each lit
 * on its windward face and shaded in its lee, with a fine top line. Rows differ, and the picture
 * wraps both ways.
 */
function swellTexture() {
  const W = 1024;
  const H = SWELL_PERIOD * SWELL_ROWS;
  const TAU = Math.PI * 2;
  return painted(W, H, (x, y, out) => {
    const row = Math.floor(y / SWELL_PERIOD);
    const u = (x / W) * TAU;
    // a crest wanders along its length: no swell is ruled
    const d =
      y -
      (row + 0.5) * SWELL_PERIOD +
      3.4 * Math.sin(u * (5 + row) + row * 1.7) +
      1.8 * Math.sin(u * (13 + 2 * row) + row * 3.1);
    const n =
      0.5 +
      0.3 * Math.sin(u * (3 + row) + row * 2.1) +
      0.2 * Math.sin(u * (7 + 2 * row) + row * 4.3 + 1.1 * Math.sin(u * 2 + row));
    const run = smooth((n - 0.42) / 0.45);
    const lit = run * 0.2 * smooth((d + 24) / 20) * smooth((3 - d) / 7);
    const line = run * run * 0.22 * Math.max(0, 1 - Math.abs(d + 0.5) / 1.4);
    const dark = run * 0.2 * smooth((d + 1) / 5) * smooth((14 - d) / 8);
    const a = Math.min(1, lit + line + dark * (1 - lit));
    const light = lit + line;
    const k = a > 0 ? light / (light + dark || 1) : 0;
    out[0] = 8 + (160 - 8) * k;
    out[1] = 36 + (212 - 36) * k;
    out[2] = 50 + (210 - 50) * k;
    out[3] = 255 * a;
  });
}

/** Soft dark patches for the gusts, wrapping both ways. */
function gustTexture() {
  const S = 512;
  const TAU = Math.PI * 2;
  return painted(S, S, (x, y, out) => {
    const u = (x / S) * TAU;
    const v = (y / S) * TAU;
    const g =
      0.5 +
      0.27 * Math.sin(2 * v + 1.3 * Math.sin(u + 1)) +
      0.13 * Math.sin(3 * v + 1.7 + 0.9 * Math.sin(2 * u)) +
      0.1 * Math.sin(u + v);
    out[0] = 10;
    out[1] = 34;
    out[2] = 46;
    out[3] = 255 * smooth((g - 0.45) / 0.5);
  });
}

/** How the swash of a wave stands `u` waves after it broke (the demo's swashAt). */
const swash = [0, 0, 0, 0];
function swashAt(u: number, ua: number) {
  swash[0] = swash[1] = swash[2] = swash[3] = 0;
  if (u < -ua || u >= 1.3) return;
  if (u < 0) {
    const q = (u + ua) / ua;
    swash[0] = -(1 - q);
    swash[1] = smooth(q / 0.45) * (0.45 + 0.55 * q);
    return;
  }
  swash[3] = u < 0.3 ? 1 - (1 - u / 0.3) * (1 - u / 0.3) : 1 - smooth((u - 0.42) / 0.88);
  if (u < 0.3) {
    const q = u / 0.3;
    swash[0] = swash[2] = 1 - (1 - q) * (1 - q);
    swash[1] = 1;
  } else if (u < 0.82) {
    const q = (u - 0.3) / 0.52;
    swash[0] = swash[2] = 1 - smooth(q);
    swash[1] = 1 - smooth(Math.min(1, q * 1.3));
  }
}
/** Samples of a tile's edge of shore. */
const EDGE_SAMPLES = 5;
/** How far upwind open water counts, in tiles. */
const FETCH = 7;
/** The widest view, in world px, that still draws the shore's waves. */
const SHORE_VIEW = 2600;
/** Tile distance from land past which water is deep: swells there run as a plain train. */
const DEEP = 6;
/** Directions of wind a travel time is worked out for, round the compass. */
const WIND_TURNS = 64;
/** The swell's wavelength in tiles: the picture's period, SWELL_PERIOD ground px. */
const SWELL_TILES = SWELL_PERIOD / TILE_GROUND;
/** The wind strength from which white caps form. */
const CAPS_FROM = 0.45;
/**
 * How long water `depth` tiles from land takes to cross a tile, deep water 1. Shallow water is
 * slower, as the shallow-water wave speed has it.
 */
export function slowness(depth: number): number {
  return 1 / Math.sqrt(Math.tanh(Math.max(0.4, depth) / 1.5));
}
/**
 * Travel times of a swell over a `w` x `h` plane, by fast sweeping: where `depth` is DEEP or more
 * it is the plain train along (`tx`, `ty`), and from there it runs on into the shallows at
 * `slowness`, so its fronts bend toward the shore.
 */
export function travelTimes(depth: Uint8Array, w: number, h: number, tx: number, ty: number) {
  const n = w * h;
  const t = new Float32Array(n).fill(Infinity);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (depth[y * w + x] >= DEEP) t[y * w + x] = x * tx + y * ty;
  const relax = (x: number, y: number) => {
    const i = y * w + x;
    if (depth[i] >= DEEP) return;
    const a = Math.min(x > 0 ? t[i - 1] : Infinity, x < w - 1 ? t[i + 1] : Infinity);
    const b = Math.min(y > 0 ? t[i - w] : Infinity, y < h - 1 ? t[i + w] : Infinity);
    const f = slowness(depth[i]);
    const low = Math.min(a, b);
    if (low === Infinity) return;
    const s =
      Math.abs(a - b) >= f ? low + f : (a + b + Math.sqrt(2 * f * f - (a - b) * (a - b))) / 2;
    if (s < t[i]) t[i] = s;
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) relax(x, y);
    for (let y = 0; y < h; y++) for (let x = w - 1; x >= 0; x--) relax(x, y);
    for (let y = h - 1; y >= 0; y--) for (let x = 0; x < w; x++) relax(x, y);
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) relax(x, y);
  }
  // a map with no deep water has only the plain train
  for (let i = 0; i < n; i++) if (t[i] === Infinity) t[i] = (i % w) * tx + Math.floor(i / w) * ty;
  return t;
}

/** The wind as the water reads it (`WindState`). */
export type WaterWind = { strength: number; tile: { x: number; y: number } };
const CALM: WaterWind = { strength: 0, tile: { x: 1, y: 0 } };

type View = { x: number; y: number; w: number; h: number };
/** The rows of tiles in a view (`viewTileRows`). */
type Rows = { y0: number; y1: number; x0(y: number): number; x1(y: number): number };

export class WaterMotion {
  readonly root = new Container();
  private strokes = new Graphics();
  private ripples = new Container();
  private mask = new Graphics();
  private layers: TilingSprite[] = [];
  private masked = -1;
  private since = REFRESH;
  private fine: number[][] = Array.from({ length: BUCKETS }, () => []);
  private broad: number[][] = Array.from({ length: BUCKETS }, () => []);
  private falling: number[][] = Array.from({ length: BUCKETS }, () => []);
  private point = [0, 0];
  /** The ground plane the wind's layers lie on, and those layers. */
  private plane = new Container();
  private crests: TilingSprite | null = null;
  private swell: Texture | null = null;
  /** The swells' mesh over the view, the block of tiles it covers, and each vertex's tile. */
  private mesh: MeshSimple | null = null;
  private block = { x0: 0, y0: 0, x1: -1, y1: -1, step: 0 };
  private meshTiles = new Int32Array(0);
  private depth = new Uint8Array(0);
  private travel = new Float32Array(0);
  private travelFor = -1;
  private swellDir = { x: 1, y: 0 };
  private gusts: TilingSprite | null = null;
  private swellAt = 0;
  private crestAt = 0;
  private gustAt = 0;
  /** The shore: its samples in tile units, their way up the shore, and the sample after each. */
  private shore = {
    n: 0,
    x: new Float32Array(0),
    y: new Float32Array(0),
    nx: new Float32Array(0),
    ny: new Float32Array(0),
    z: new Float32Array(0),
    next: new Int32Array(0),
    energy: new Float32Array(0),
  };
  private energyFor = -1;
  /** The first sample of each shore edge, by `tile * 4 + side`. */
  private edges = new Map<number, number>();
  private wet: number[][] = Array.from({ length: BUCKETS }, () => []);
  private film: number[][] = Array.from({ length: BUCKETS }, () => []);
  private foam: number[][] = Array.from({ length: BUCKETS }, () => []);
  private clots: number[][] = Array.from({ length: BUCKETS }, () => []);
  private caps: number[][] = Array.from({ length: BUCKETS }, () => []);

  constructor(
    private readonly map: GameMap,
    private readonly elevation: (x: number, y: number) => number,
    private readonly built: (x: number, y: number) => boolean,
  ) {
    const texture = rippleTexture();
    if (texture) {
      this.layers = [0, 1].map(() => new TilingSprite({ texture, width: 16, height: 16 }));
      this.ripples.addChild(...this.layers);
      this.addWindLayers();
      this.ripples.addChild(this.mask);
      this.ripples.mask = this.mask;
    }
    this.root.addChild(this.ripples, this.strokes);
    this.root.visible = false;
  }

  /** The wind's layers, on a plane turned and squashed as the tiles are. */
  private addWindLayers() {
    const crests = crestTexture();
    this.swell = swellTexture();
    if (this.swell) this.swell.source.addressMode = 'repeat';
    const gusts = gustTexture();
    if (!crests || !gusts) return;
    const { w, h } = this.map;
    const side = (w + h + 8) * TILE_GROUND;
    const make = (texture: Texture) => {
      const s = new TilingSprite({ texture, width: side, height: side });
      s.anchor.set(0.5);
      s.position.set((w * TILE_GROUND) / 2, (h * TILE_GROUND) / 2);
      return s;
    };
    this.gusts = make(gusts);
    this.gusts.tileScale.set(2);
    this.crests = make(crests);
    this.plane.addChild(this.gusts, this.crests);
    this.plane.rotation = Math.PI / 4;
    const squash = new Container();
    squash.scale.set(1, 0.5);
    squash.addChild(this.plane);
    this.ripples.addChild(squash);
  }

  /**
   * The waterline of the still water's shores, sampled along each tile edge where water meets land:
   * the point where the painter's water gives way, found along the edge's normal.
   */
  private rebuildShore() {
    const { map } = this;
    const { w, h, terrain } = map;
    const xs: number[] = [];
    const ys: number[] = [];
    const nxs: number[] = [];
    const nys: number[] = [];
    const zs: number[] = [];
    const next: number[] = [];
    this.edges.clear();
    const land = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < w && y < h && terrain[y * w + x] !== Terrain.Water;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (terrain[i] !== Terrain.Water || map.flowDir?.[i] || !this.built(x, y)) continue;
        for (let d = 0; d < 4; d++) {
          const dx = DIR_DX[d as Dir];
          const dy = DIR_DY[d as Dir];
          if (!land(x + dx, y + dy)) continue;
          this.edges.set(i * 4 + d, xs.length);
          for (let k = 0; k < EDGE_SAMPLES; k++) {
            const along = (k + 0.5) / EDGE_SAMPLES - 0.5;
            const bx = x - dy * along;
            const by = y + dx * along;
            let lo = 0;
            let hi = 1;
            for (let s = 0; s < 5; s++) {
              const mid = (lo + hi) / 2;
              if (paintedWater(map, bx + dx * mid, by + dy * mid) >= 0.5) lo = mid;
              else hi = mid;
            }
            const px = bx + dx * lo;
            const py = by + dy * lo;
            xs.push(px);
            ys.push(py);
            nxs.push(dx);
            nys.push(dy);
            zs.push(this.elevation(px, py));
            next.push(k + 1 < EDGE_SAMPLES ? xs.length : -1);
          }
        }
      }
    this.shore = {
      n: xs.length,
      x: Float32Array.from(xs),
      y: Float32Array.from(ys),
      nx: Float32Array.from(nxs),
      ny: Float32Array.from(nys),
      z: Float32Array.from(zs),
      next: Int32Array.from(next),
      energy: new Float32Array(xs.length),
    };
    this.energyFor = -1;
    this.rebuildDepth();
  }

  /** How far each tile lies from land, up to DEEP, for the swells and the white caps. */
  private rebuildDepth() {
    const { w, h, terrain } = this.map;
    const depth = new Uint8Array(w * h).fill(DEEP);
    let edge: number[] = [];
    for (let i = 0; i < w * h; i++)
      if (terrain[i] !== Terrain.Water) {
        depth[i] = 0;
        edge.push(i);
      }
    for (let d = 1; d < DEEP && edge.length; d++) {
      const out: number[] = [];
      for (const i of edge)
        for (const n of [i - 1, i + 1, i - w, i + w])
          if (n >= 0 && n < w * h && depth[n] === DEEP) {
            depth[n] = d;
            out.push(n);
          }
      edge = out;
    }
    this.depth = depth;
    this.travelFor = -1;
  }

  /** The swells' travel times for this wind, to the nearest of WIND_TURNS. */
  private swellTravel(wind: WaterWind) {
    const turn = Math.round((Math.atan2(wind.tile.y, wind.tile.x) / (Math.PI * 2)) * WIND_TURNS);
    if (turn === this.travelFor) return;
    this.travelFor = turn;
    const a = (turn / WIND_TURNS) * Math.PI * 2;
    this.swellDir = { x: Math.cos(a), y: Math.sin(a) };
    this.travel = travelTimes(this.depth, this.map.w, this.map.h, this.swellDir.x, this.swellDir.y);
    this.block.step = 0;
  }

  /** The block of tiles under `view`, a vertex every few tiles as it widens. */
  private swellMesh(view: View) {
    const { map, block } = this;
    const { w, h } = map;
    const sx = (p: number, q: number) => p / 64 + q / 32;
    const sy = (p: number, q: number) => q / 32 - p / 64;
    const pad = 4;
    const xs = [sx(view.x, view.y), sx(view.x + view.w, view.y), sx(view.x, view.y + view.h)];
    xs.push(sx(view.x + view.w, view.y + view.h));
    const ys = [sy(view.x, view.y), sy(view.x + view.w, view.y), sy(view.x, view.y + view.h)];
    ys.push(sy(view.x + view.w, view.y + view.h));
    const x0 = Math.max(0, Math.floor(Math.min(...xs)) - pad);
    const x1 = Math.min(w - 1, Math.ceil(Math.max(...xs)) + pad);
    const y0 = Math.max(0, Math.floor(Math.min(...ys)) - pad);
    const y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)) + pad);
    const step = x1 - x0 > 110 ? 3 : x1 - x0 > 60 ? 2 : 1;
    const inside =
      block.step === step &&
      x0 >= block.x0 &&
      y0 >= block.y0 &&
      x1 <= block.x1 &&
      y1 <= block.y1 &&
      block.x1 - block.x0 < 2.2 * (x1 - x0 + 1);
    if (inside) return;
    const bx0 = Math.max(0, x0 - 12);
    const by0 = Math.max(0, y0 - 12);
    const bx1 = Math.min(w - 1, x1 + 12);
    const by1 = Math.min(h - 1, y1 + 12);
    this.block = { x0: bx0, y0: by0, x1: bx1, y1: by1, step };
    const cols = Math.ceil((bx1 - bx0) / step) + 1;
    const rows = Math.ceil((by1 - by0) / step) + 1;
    const vertices = new Float32Array(cols * rows * 2);
    const uvs = new Float32Array(cols * rows * 2);
    const tiles = new Int32Array(cols * rows);
    const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x = Math.min(w - 1, bx0 + c * step);
        const y = Math.min(h - 1, by0 + r * step);
        const k = r * cols + c;
        const p = tileToWorld(x, y);
        vertices[k * 2] = p.x;
        vertices[k * 2 + 1] = p.y;
        tiles[k] = y * w + x;
      }
    for (let r = 0, o = 0; r < rows - 1; r++)
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        indices[o++] = a;
        indices[o++] = a + 1;
        indices[o++] = a + cols;
        indices[o++] = a + 1;
        indices[o++] = a + cols + 1;
        indices[o++] = a + cols;
      }
    this.meshTiles = tiles;
    this.mesh?.destroy();
    this.mesh = new MeshSimple({ texture: this.swell!, vertices, uvs, indices });
    this.ripples.addChild(this.mesh);
    this.ripples.setChildIndex(this.mask, this.ripples.children.length - 1);
  }

  /** Slides the swells' picture along their travel times. */
  private moveSwell(alpha: number) {
    const mesh = this.mesh;
    if (!mesh) return;
    mesh.alpha = alpha;
    const uvs = mesh.geometry.uvs;
    const { meshTiles, travel, swellDir, swellAt } = this;
    const w = this.map.w;
    const rows = SWELL_TILES * SWELL_ROWS;
    const across = TILE_GROUND / 1024;
    for (let k = 0; k < meshTiles.length; k++) {
      const i = meshTiles[k];
      const x = i % w;
      const y = (i - x) / w;
      uvs[k * 2] = (-swellDir.y * x + swellDir.x * y) * across;
      uvs[k * 2 + 1] = (travel[i] - swellAt) / rows;
    }
    mesh.geometry.getBuffer('aUV').update();
  }

  /** How hard the waves reach each sample in this wind: the way it faces, and the water upwind. */
  private shoreEnergy(wind: WaterWind) {
    const bucket = Math.round((Math.atan2(wind.tile.y, wind.tile.x) / (Math.PI * 2)) * 32);
    if (bucket === this.energyFor) return;
    this.energyFor = bucket;
    const { shore, map } = this;
    const { w, h, terrain } = map;
    for (let p = 0; p < shore.n; p++) {
      const facing = shore.nx[p] * wind.tile.x + shore.ny[p] * wind.tile.y;
      if (facing <= 0.05) {
        shore.energy[p] = 0;
        continue;
      }
      let open = 0;
      for (let k = 1; k <= FETCH; k++) {
        const x = Math.round(shore.x[p] - wind.tile.x * k);
        const y = Math.round(shore.y[p] - wind.tile.y * k);
        if (x < 0 || y < 0 || x >= w || y >= h || terrain[y * w + x] !== Terrain.Water) break;
        open++;
      }
      shore.energy[p] = facing * (open / FETCH);
    }
  }

  /** The waves breaking on the shores in view, the demo's drawShore at its Swell and Gentle. */
  private drawShore(clock: number, view: View, wind: WaterWind) {
    const { shore, wet, film, foam, clots } = this;
    const s = wind.strength;
    if (s < 0.05 || !shore.n || view.w > SHORE_VIEW) return;
    this.shoreEnergy(wind);
    const lam = 1.3 + 1.1 * s;
    const T = 3.4 + 1.2 * s;
    const ph = clock / T;
    const R0 = 0.06 + 0.2 * s;
    const B0 = 0.16 + 0.22 * s;
    const ua = 0.32;
    const seed = this.map.seed;
    const tox = wind.tile.x;
    const toy = wind.tile.y;
    const at = (p: number, off: number, out: number[], o: number) => {
      const x = shore.x[p] + shore.nx[p] * off;
      const y = shore.y[p] + shore.ny[p] * off;
      out[o] = (x - y) * 32;
      out[o + 1] = (x + y) * 16 + shore.z[p];
    };
    const q: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let a = 0; a < shore.n; a++) {
      const b = shore.next[a];
      if (b < 0) continue;
      const e = shore.energy[a];
      if (e < 0.02) continue;
      const wx = (shore.x[a] - shore.y[a]) * 32;
      const wy = (shore.x[a] + shore.y[a]) * 16;
      if (wx < view.x - 40 || wx > view.x + view.w + 40 || wy < view.y - 40) continue;
      if (wy > view.y + view.h + 40) continue;
      const along = shore.x[a] * -toy + shore.y[a] * tox;
      const way = shore.x[a] * tox + shore.y[a] * toy;
      const psa = way / lam - ph + 0.05 * (2 * landscapeNoise(along * 0.7, clock * 0.09, seed) - 1);
      const way2 = shore.x[b] * tox + shore.y[b] * toy;
      const psb =
        way2 / lam - ph + 0.05 * (2 * landscapeNoise(along * 0.7, clock * 0.09, seed) - 1);
      const R = R0 * e ** 0.6;
      const B = B0 * Math.sqrt(e);
      const fk = smooth(e / 0.22);
      for (let m = Math.floor(psa - 1.3) + 1; m <= Math.floor(psa + ua); m++) {
        const big = 0.8 + 0.4 * hash2(m, a >> 4, 61);
        swashAt(psa - m, ua);
        const a0 = swash[0];
        const a1 = swash[1];
        const aWet = swash[3];
        const aFilm = swash[2];
        swashAt(psb - m, ua);
        const b0 = swash[0];
        const bWet = swash[3];
        const bFilm = swash[2];
        const ribbon = (out: number[][], ka: number, kb: number, tone: number) => {
          if (ka * big * R < 0.004 && kb * big * R < 0.004) return;
          const bucket = Math.min(BUCKETS - 1, Math.round(tone * BUCKETS));
          at(a, 0, q, 0);
          at(b, 0, q, 2);
          at(b, kb * big * R, q, 4);
          at(a, ka * big * R, q, 6);
          out[bucket].push(...q);
        };
        ribbon(wet, aWet, bWet, 0.5);
        ribbon(film, aFilm, bFilm, 0.5);
        const lace = smooth((landscapeNoise(along * 2.1 + m * 13.7, m * 5.31, seed) - 0.2) / 0.42);
        const fo = a1 * fk * lace;
        if (fo < 0.05) continue;
        const bucket = Math.min(BUCKETS - 1, Math.round(fo * BUCKETS));
        at(a, a0 >= 0 ? a0 * R * big : a0 * B, q, 0);
        at(b, b0 >= 0 ? b0 * R * big : b0 * B, q, 2);
        foam[bucket].push(q[0], q[1], q[2], q[3]);
        const clot = smooth((landscapeNoise(along * 5.3 + m * 7.9, m * 3.7, seed) - 0.52) / 0.2);
        if (clot > 0.1)
          clots[Math.min(BUCKETS - 1, Math.round(fo * clot * BUCKETS))].push(
            q[0],
            q[1],
            q[2],
            q[3],
          );
      }
    }
  }

  /** The still water ripples may show on, out to the painted waterline on its shores. */
  private rebuildMask(tiles: number) {
    this.masked = tiles;
    const { map, mask } = this;
    const { w, h, terrain } = map;
    mask.clear();
    const water = (i: number) => terrain[i] === Terrain.Water;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!water(i) || map.flowDir?.[i] || !this.built(x, y)) continue;
        const poly: number[] = [];
        for (let d = 0; d < 4; d++) {
          const first = this.edges.get(i * 4 + d);
          if (first === undefined) {
            const p = tileToWorld(x + CORNER_X[d], y + CORNER_Y[d]);
            poly.push(p.x, p.y);
          } else
            for (let k = 0; k < EDGE_SAMPLES; k++) {
              const p = tileToWorld(this.shore.x[first + k], this.shore.y[first + k]);
              poly.push(p.x, p.y);
            }
        }
        mask.poly(poly);
      }
    mask.fill(0xffffff);
  }

  /** One frame: `view` null hides it all. `tiles` counts the built tiles, for the mask. */
  update(
    dt: number,
    clock: number,
    view: View | null,
    rows: () => Rows,
    tiles: number,
    wind: WaterWind = CALM,
    rain = 0,
  ) {
    this.root.visible = view !== null;
    if (!view) return;
    if (tiles !== this.masked) {
      this.rebuildShore();
      if (this.layers.length) this.rebuildMask(tiles);
      this.masked = tiles;
    }
    const blown = smooth(wind.strength / 0.2);
    if (this.crests && this.gusts) {
      const s = wind.strength;
      const turn = Math.atan2(-wind.tile.x, wind.tile.y);
      for (const l of [this.crests, this.gusts]) l.rotation = turn;
      // a tile downwind every so many seconds, the crests slower than the swell's crests, the
      // gusts' bands fastest; each keeps its own place as the wind changes
      this.crestAt += dt * (0.08 + 0.14 * s) * TILE_GROUND;
      this.swellAt += dt * ((1.3 + 1.1 * s) / (3.4 + 1.2 * s));
      this.gustAt += dt * (40 + 200 * s) * 0.7;
      this.crests.tilePosition.y = this.crestAt;
      this.gusts.tilePosition.y = this.gustAt;
      this.crests.alpha = blown * (0.5 + 0.3 * s);
      if (this.swell) {
        this.swellTravel(wind);
        this.swellMesh(view);
        this.moveSwell(blown * (0.4 + 0.3 * s));
      }
      this.gusts.alpha = blown * (0.05 + 0.06 * s);
    }
    if (this.layers.length) {
      const drifts = [
        [2.1, 0.7, 0.9, 0.5],
        [-1.4, 1.1, 0.65, -0.5],
      ];
      this.layers.forEach((l, k) => {
        const [vx, vy, alpha, sx] = drifts[k];
        l.position.set(view.x, view.y);
        l.setSize(view.w, view.h);
        l.alpha = alpha * (1 - 0.8 * blown);
        l.tileScale.set(sx, 0.5);
        l.tilePosition.set(
          -view.x + clock * vx,
          -view.y + clock * vy + 1.5 * Math.sin(clock * 0.45 + alpha * 5),
        );
      });
    }
    this.since += dt;
    if (this.since < REFRESH) return;
    this.since = 0;
    this.drawStreaks(clock, view, rows(), wind, rain);
  }

  private drawStreaks(clock: number, view: View, rows: Rows, wind: WaterWind, rain: number) {
    const { map, strokes: g, fine, broad, falling, point, wet, film, foam, clots, caps } = this;
    for (const list of [fine, broad, falling, wet, film, foam, clots, caps])
      for (const b of list) b.length = 0;
    g.clear();
    this.drawShore(clock, view, wind);
    this.drawCaps(clock, view, rows, wind);
    this.rainRings(clock, view, rain);
    const { w, flowDir } = map;
    const inView: number[] = [];
    for (let y = rows.y0; y <= rows.y1; y++)
      for (let x = rows.x0(y), x1 = rows.x1(y); x <= x1; x++) {
        const side = flowDir?.[y * w + x];
        if (side && map.terrain[y * w + x] === Terrain.Water && this.built(x, y)) inView.push(x, y);
      }
    const busy = inView.length / 2 > BUSY_TILES;
    const margin = 24;
    for (let k = 0; k < inView.length; k += 2) {
      const x = inView[k];
      const y = inView[k + 1];
      const c = tileToWorld(x, y);
      if (
        c.x < view.x - margin ||
        c.x > view.x + view.w + margin ||
        c.y < view.y - margin ||
        c.y > view.y + view.h + margin + 60
      )
        continue;
      const i = y * w + x;
      const to = flowDir![i] - 1;
      const from = inflow(map, x, y);
      const fall = waterfallAt(map, x, y);
      const z = this.elevation(x, y);
      const wx = x + map.originX;
      const wy = y + map.originY;
      const lay = (out: number[][], seed: number, half: number, base: number, len: number) => {
        const pace = 0.7 + 0.6 * hash2(wx, wy, seed);
        const r = (clock * FLOW * pace + hash2(wx, wy, seed + 1)) % 1;
        const u = r * (1 - len);
        // a fall's own streaks take over on its slope
        if (fall && u + len > 0.5) return;
        const fade = Math.sin(r * Math.PI);
        const a = Math.min(BUCKETS - 1, Math.floor((base * fade * BUCKETS) / 0.4));
        if (a < 1) return;
        const across = (hash2(wx, wy, seed + 2) - 0.5) * half * 2;
        channelPoint(from, to, u, point);
        const ax = point[0];
        const ay = point[1];
        channelPoint(from, to, u + len, point);
        const dx = point[0] - ax;
        const dy = point[1] - ay;
        const n = Math.hypot(dx, dy) || 1;
        const px = (-dy / n) * across;
        const py = (dx / n) * across;
        const p = tileToWorld(x + ax + px, y + ay + py);
        const q = tileToWorld(x + point[0] + px, y + point[1] + py);
        out[a].push(p.x, p.y + z, q.x, q.y + z);
      };
      const count = busy ? 2 : 6;
      for (let s = 0; s < (busy ? 1 : 2); s++) lay(broad, 96 + s * 5, 0.08, 0.1, 0.28);
      for (let s = 0; s < count; s++) lay(fine, 131 + s * 5, 0.135, 0.3, 0.14);
      if (fall) this.fallStreaks(x, y, to, wx, wy, clock);
      if (headwaterAt(map, x, y)) this.spring(c.x, c.y + z, clock, hash2(wx, wy, 94));
    }
    const draw = (lists: number[][], color: number, width: number, top: number) => {
      lists.forEach((b, a) => {
        if (!b.length) return;
        for (let k = 0; k < b.length; k += 4) g.moveTo(b[k], b[k + 1]).lineTo(b[k + 2], b[k + 3]);
        g.stroke({ color, width, alpha: (a / BUCKETS) * top, cap: 'round' });
      });
    };
    const quads = (lists: number[][], color: number, top: number) => {
      lists.forEach((b, a) => {
        if (!b.length) return;
        for (let k = 0; k < b.length; k += 8)
          g.moveTo(b[k], b[k + 1])
            .lineTo(b[k + 2], b[k + 3])
            .lineTo(b[k + 4], b[k + 5])
            .lineTo(b[k + 6], b[k + 7])
            .closePath();
        g.fill({ color, alpha: (a / BUCKETS) * top });
      });
    };
    quads(wet, 0x7a5428, 0.3);
    quads(film, 0xb0dad4, 0.3);
    draw(foam, 0xdceae6, 2.4, 0.26);
    draw(clots, 0xe0ece8, 1.6, 0.55);
    draw(foam, 0xe4eeea, 0.8, 0.8);
    draw(caps, 0xe2ece8, 1.3, 0.75);
    draw(broad, STREAK, 1.9, 0.4);
    draw(fine, STREAK, 0.7, 0.4);
    draw(falling, FOAM, 1.1, 0.85);
  }

  /** White caps out on open water in a hard wind: each forms, drifts downwind and fades. */
  private drawCaps(clock: number, view: View, rows: Rows, wind: WaterWind) {
    const s = wind.strength;
    if (s < CAPS_FROM || view.w > SHORE_VIEW) return;
    const { map, caps, depth } = this;
    const { w, terrain } = map;
    const tox = wind.tile.x;
    const toy = wind.tile.y;
    const odds = (s - CAPS_FROM) * 0.55;
    for (let y = rows.y0; y <= rows.y1; y++)
      for (let x = rows.x0(y), x1 = rows.x1(y); x <= x1; x++) {
        const i = y * w + x;
        if (terrain[i] !== Terrain.Water || depth[i] < 2 || map.flowDir?.[i]) continue;
        const wx = x + map.originX;
        const wy = y + map.originY;
        const period = 2.4 + 1.8 * hash2(wx, wy, 73);
        const c = clock / period + hash2(wx, wy, 74);
        const m = Math.floor(c);
        const f = c - m;
        if (f > 0.5 || hash2(wx + m, wy, 75) > odds) continue;
        const a = smooth(f / 0.07) * (1 - smooth((f - 0.1) / 0.4));
        const bucket = Math.min(BUCKETS - 1, Math.floor(a * BUCKETS));
        if (bucket < 1) continue;
        const along = hash2(wx, wy + m, 76) - 0.5 + 0.05 + 0.22 * f;
        const side = hash2(wx + 1, wy + m, 77) - 0.5;
        const px = x + tox * along - toy * side;
        const py = y + toy * along + tox * side;
        const l = 0.06 + 0.05 * hash2(wx, wy + m, 78) + 0.03 * s;
        const p = tileToWorld(px + toy * l, py - tox * l);
        const q = tileToWorld(px - toy * l, py + tox * l);
        caps[bucket].push(p.x, p.y, q.x, q.y);
      }
  }

  /** Rain on the water: rings that open and fade at places picked afresh for each drop. */
  private rainRings(clock: number, view: View, rain: number) {
    if (rain < 0.05) return;
    const { map, strokes: g } = this;
    const count = Math.min(300, Math.round(7.5e-4 * view.w * view.h * rain));
    const rings: number[][] = [[], [], [], []];
    for (let i = 0; i < count; i++) {
      const period = 0.9 + 0.6 * hash2(i, 3, 501);
      const ph = clock / period + hash2(i, 4, 502);
      const c = Math.floor(ph);
      const u = ph - c;
      const x = view.x + hash2(i, c, 503) * view.w;
      const y = view.y + hash2(i, c, 504) * view.h;
      const tx = x / 64 + y / 32;
      const ty = y / 32 - x / 64;
      if (tx < 0 || ty < 0 || tx > map.w - 1 || ty > map.h - 1) continue;
      if (paintedWater(map, tx, ty) < 0.9) continue;
      const fade = (1 - u) * (1 - u) * (0.6 + 0.4 * hash2(i, c, 505));
      rings[Math.min(3, Math.floor(fade * 4))].push(x, y, 3.4 * (0.3 + 0.7 * Math.sqrt(u)));
    }
    rings.forEach((list, q) => {
      if (!list.length) return;
      for (let k = 0; k < list.length; k += 3)
        g.ellipse(list[k], list[k + 1], list[k + 2], list[k + 2] / 2);
      g.stroke({ color: 0xe4eff3, width: 0.6, alpha: 0.1 + 0.11 * q });
    });
  }

  /** The white water running down a fall's slope, and its flecks at the foot. */
  private fallStreaks(x: number, y: number, to: number, wx: number, wy: number, clock: number) {
    const dx = DIR_DX[to as Dir];
    const dy = DIR_DY[to as Dir];
    for (let k = 0; k < 12; k++) {
      const seed = hash2(wx + k, wy, 97);
      const t = (clock * (0.9 + seed * 0.5) + seed * 9) % 1;
      const across = (hash2(wx, wy + k, 98) - 0.5) * 0.6;
      const along = 0.22 + t * 0.62;
      const ex = x + dx * along - dy * across;
      const ey = y + dy * along + dx * across;
      const fx = ex + dx * 0.11;
      const fy = ey + dy * 0.11;
      const a = tileToWorld(ex, ey);
      const b = tileToWorld(fx, fy);
      const bucket = Math.min(BUCKETS - 1, Math.floor(Math.sin(t * Math.PI) * BUCKETS));
      if (bucket < 1) continue;
      this.falling[bucket].push(
        a.x,
        a.y + this.elevation(ex, ey),
        b.x,
        b.y + this.elevation(fx, fy),
      );
    }
  }

  private spring(px: number, py: number, clock: number, h: number) {
    const g = this.strokes;
    const t = (clock * 1.2 + h * 5) % 1;
    g.ellipse(px, py, 2 + t * 7, 1 + t * 3.5).stroke({
      color: 0xcde2e0,
      width: 0.7,
      alpha: 0.45 * (1 - t),
    });
    g.circle(px, py, 0.9).fill({ color: FOAM, alpha: 0.85 });
  }
}
