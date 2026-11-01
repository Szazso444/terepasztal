import { Container, Graphics, Texture, TilingSprite } from 'pixi.js';
import { DIR_DX, DIR_DY, tileToWorld, type Dir } from '../engine/iso';
import { hash2 } from '../engine/rng';
import type { GameMap } from '../world/tiles';
import { Terrain } from '../world/tiles';
import { headwaterAt, waterfallAt } from '../world/waterfalls';

/**
 * Moving water over the painted ground, the art demo's Animated water (the author's decision of
 * 2026-10-12, #365; "the water animation is very good", 2026-10-16). Still water carries two layers
 * of ripples drifting apart, so patches of glints come and go; rivers carry streaks that run
 * downstream along their channel, fine ones over broad faint ones; falls carry white streaks and
 * flecks of foam; a headwater rings out. All of it follows the clock, so nothing loops or jumps.
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

  constructor(
    private readonly map: GameMap,
    private readonly elevation: (x: number, y: number) => number,
    private readonly built: (x: number, y: number) => boolean,
  ) {
    const texture = rippleTexture();
    if (texture) {
      this.layers = [0, 1].map(() => new TilingSprite({ texture, width: 16, height: 16 }));
      this.ripples.addChild(...this.layers);
      this.ripples.addChild(this.mask);
      this.ripples.mask = this.mask;
    }
    this.root.addChild(this.ripples, this.strokes);
    this.root.visible = false;
  }

  /** The still water ripples may show on: tiles of it with water on all four sides. */
  private rebuildMask(tiles: number) {
    this.masked = tiles;
    const { map, mask } = this;
    const { w, h, terrain } = map;
    mask.clear();
    const water = (i: number) => terrain[i] === Terrain.Water;
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!water(i) || map.flowDir?.[i] || !this.built(x, y)) continue;
        if (!water(i - 1) || !water(i + 1) || !water(i - w) || !water(i + w)) continue;
        const p = tileToWorld(x, y);
        mask.poly([p.x, p.y - 16, p.x + 32, p.y, p.x, p.y + 16, p.x - 32, p.y]);
      }
    mask.fill(0xffffff);
  }

  /** One frame: `view` null hides it all. `tiles` counts the built tiles, for the mask. */
  update(dt: number, clock: number, view: View | null, rows: () => Rows, tiles: number) {
    this.root.visible = view !== null;
    if (!view) return;
    if (this.layers.length) {
      if (tiles !== this.masked) this.rebuildMask(tiles);
      const drifts = [
        [2.1, 0.7, 0.9, 0.5],
        [-1.4, 1.1, 0.65, -0.5],
      ];
      this.layers.forEach((l, k) => {
        const [vx, vy, alpha, sx] = drifts[k];
        l.position.set(view.x, view.y);
        l.setSize(view.w, view.h);
        l.alpha = alpha;
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
    this.drawStreaks(clock, view, rows());
  }

  private drawStreaks(clock: number, view: View, rows: Rows) {
    const { map, strokes: g, fine, broad, falling, point } = this;
    for (const list of [fine, broad, falling]) for (const b of list) b.length = 0;
    g.clear();
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
    draw(broad, STREAK, 1.9, 0.4);
    draw(fine, STREAK, 0.7, 0.4);
    draw(falling, FOAM, 1.1, 0.85);
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
