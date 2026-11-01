import { Container, ImageSource, Sprite, Texture } from 'pixi.js';
import { tileToWorld, worldToTile } from '../engine/iso';
import { levelAt } from '../world/elevation';
import { Biome, Terrain, idx, terrainAt, type GameMap } from '../world/tiles';
import { ease, lot } from './lifeMotion';

/** Tiles to a side of a cell: puddles are found once a cell and kept while the ground is wet. */
const CELL = 8;
/** Of the tiles in a wet hollow, the share that hold a puddle; and the share of ground in hollows. */
const PUDDLE_SHARE = 0.26;
const HOLLOW_SHARE = 0.45;
/** Tiles to a side of a hollow: puddles lie in groups. */
const HOLLOW = 5;
/** Seconds of game time for the ground to wet in the rain, and to dry after it. */
const WET_TIME = 35;
const DRY_TIME = 110;
/** Wetness below this is dry ground, and nothing is drawn. */
const DRY = 0.02;
/** How much rain has to show for the ground to wet at all. */
const RAIN_WETS = 0.08;
/** A ripple's life in seconds, and the rain it needs. */
const RIPPLE_LIFE = 1.1;
const RIPPLE_RAIN = 0.12;
/** The most rings on the water at once, and a ring's picture in canvas px. */
const MAX_RINGS = 300;
const RING_PICTURE = 40;
/** The puddle's picture: canvas px wide, and how many there are. */
const PICTURE = 128;
const VARIANTS = 5;

/** Ground that holds water when it rains: grass and forest floor, not sand, rock or swamp. */
const HOLDS_WATER: ReadonlySet<number> = new Set([Biome.Plains, Biome.Forest, Biome.Taiga]);

/** One puddle on a tile. */
export interface PuddleSite {
  x: number;
  y: number;
  /** where on the tile: tile units from its centre */
  ox: number;
  oy: number;
  /** its width in world px when the ground is at its wettest */
  width: number;
  variant: number;
  /** when its ripples start: a share of their life */
  phase: number;
}

/**
 * The puddle on tile (x, y), or null: on flat ground that holds water, in groups by the hollows of
 * the land, the same ones every rain. `map` is read and nothing is kept. Whether something stands
 * on the tile is the caller's to say.
 */
export function puddleAt(map: GameMap, x: number, y: number): PuddleSite | null {
  const t = terrainAt(map, x, y);
  if (t !== Terrain.Grass && t !== Terrain.Forest) return null;
  if (!HOLDS_WATER.has(map.biome[idx(map, x, y)])) return null;
  if (map.props.has(idx(map, x, y))) return null;
  if (lot(Math.floor(x / HOLLOW), Math.floor(y / HOLLOW), 501) >= HOLLOW_SHARE) return null;
  if (lot(x, y, 502) >= PUDDLE_SHARE) return null;
  const level = levelAt(map, x, y);
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ])
    if (levelAt(map, x + dx, y + dy) !== level) return null;
  return {
    x,
    y,
    ox: (lot(x, y, 503) - 0.5) * 0.5,
    oy: (lot(x, y, 504) - 0.5) * 0.5,
    width: 14 + 22 * lot(x, y, 505),
    variant: Math.floor(lot(x, y, 506) * VARIANTS),
    phase: lot(x, y, 507),
  };
}

/** How many rings the rain makes on the water at once, over a view of `area` square world px. */
export const ringCount = (area: number) =>
  Math.max(40, Math.min(MAX_RINGS, Math.round(7.5e-4 * area)));

/**
 * Ring `i` at time `t`: where in the view it starts, 0..1 each way, how far through its life it is,
 * and how faint it is. Each ring comes back at a new place every time round.
 */
export function ringAt(i: number, t: number) {
  const period = 0.9 + 0.6 * lot(i, 3, 501),
    phase = t / period + lot(i, 4, 502),
    turn = Math.floor(phase),
    age = phase - turn;
  return {
    u: lot(i, turn, 503),
    v: lot(i, turn, 504),
    age,
    alpha: (1 - age) * (1 - age) * (0.6 + 0.4 * lot(i, turn, 505)),
  };
}

/** The ground's wetness `dt` seconds on: wets in the rain, dries slowly after it, 0..1. */
export function nextWetness(wet: number, rain: number, dt: number) {
  const next =
    rain > RAIN_WETS
      ? ease(wet, Math.min(1, rain * 1.4), dt, WET_TIME)
      : ease(wet, 0, dt, DRY_TIME);
  return next < 0.002 ? 0 : next;
}

/** An uneven shape round (cx, cy), flattened to lie on the ground: no two alike, no straight edge. */
function blob(g: CanvasRenderingContext2D, variant: number, cx: number, cy: number, r: number) {
  const points = Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * 6.2832,
      d = r * (0.62 + 0.5 * lot(variant, i, 508));
    return [cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.46];
  });
  g.beginPath();
  for (let i = 0; i <= points.length; i++) {
    const [ax, ay] = points[i % points.length],
      [bx, by] = points[(i + 1) % points.length],
      mx = (ax + bx) / 2,
      my = (ay + by) / 2;
    if (i === 0) g.moveTo(mx, my);
    else g.quadraticCurveTo(ax, ay, mx, my);
  }
  g.fill();
}

function canvas(height: number) {
  const c = document.createElement('canvas');
  c.width = PICTURE;
  c.height = height;
  return c;
}

/** Shallow water on wet earth: the mud round it, the sky in it, the ground showing at its edge. */
function puddleCanvas(variant: number) {
  const c = canvas(PICTURE / 2),
    g = c.getContext('2d')!,
    x = PICTURE / 2,
    y = PICTURE / 4,
    r = PICTURE * 0.34;
  g.filter = 'blur(3px)';
  g.fillStyle = 'rgba(44,38,24,0.42)';
  blob(g, variant, x, y + 1, r * 1.16);
  g.filter = 'blur(1.2px)';
  g.fillStyle = 'rgba(78,92,92,0.86)';
  blob(g, variant, x, y, r);
  g.filter = 'none';
  g.globalCompositeOperation = 'source-atop';
  const sky = g.createLinearGradient(0, y - r * 0.5, 0, y + r * 0.5);
  sky.addColorStop(0, 'rgba(164,180,186,0.6)');
  sky.addColorStop(0.5, 'rgba(112,130,134,0.15)');
  sky.addColorStop(1, 'rgba(40,46,40,0.4)');
  g.fillStyle = sky;
  g.fillRect(0, 0, PICTURE, PICTURE / 2);
  return c;
}

/** A ring in still water, seen flat. */
function rippleCanvas() {
  const c = canvas(PICTURE / 2),
    g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(206,216,218,0.7)';
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(PICTURE / 2, PICTURE / 4, PICTURE * 0.42, PICTURE * 0.2, 0, 0, 6.2832);
  g.stroke();
  return c;
}

/** A thin pale ring, for the water. */
function waterRingCanvas() {
  const c = document.createElement('canvas');
  c.width = RING_PICTURE;
  c.height = RING_PICTURE / 2;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(228,239,243,1)';
  g.lineWidth = 3.4;
  g.beginPath();
  g.ellipse(
    RING_PICTURE / 2,
    RING_PICTURE / 4,
    RING_PICTURE * 0.42,
    RING_PICTURE * 0.2,
    0,
    0,
    6.2832,
  );
  g.stroke();
  return c;
}

const textureOf = (resource: HTMLCanvasElement) =>
  new Texture({
    source: new ImageSource({ resource, scaleMode: 'linear', autoGenerateMipmaps: true }),
  });

interface Puddle {
  site: PuddleSite;
  water: Sprite;
  ripple: Sprite;
}
interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Puddles that gather in the hollows while it rains and dry slowly after it, with rings in them
 * under the rain. They lie on the ground, under everything that stands on it, and nothing is drawn
 * or looked up on dry ground.
 */
export class Puddles {
  /** how wet the ground is, 0..1 */
  wetness = 0;
  private readonly cells = new Map<number, { root: Container; puddles: Puddle[] }>();
  private shown = new Set<number>();
  private pictures: Texture[] | null = null;
  private ring: Texture | null = null;
  private t = 0;
  private readonly waterRings = new Container();
  private readonly rings: Sprite[] = [];
  private ringPicture: Texture | null = null;

  constructor(
    private readonly map: GameMap,
    private readonly layer: Container,
    /** where a tile's ground is, in world px */
    private readonly surface: (x: number, y: number) => { x: number; y: number },
    /** nothing stands on the tile, and it is drawn */
    private readonly free: (x: number, y: number) => boolean,
  ) {}

  /** Something was built or cleared on (x, y): the cell's puddles are found anew. */
  invalidate(x: number, y: number) {
    const key = this.cellOf(Math.floor(x / CELL), Math.floor(y / CELL));
    this.cells.get(key)?.root.destroy({ children: true });
    this.cells.delete(key);
    this.shown.delete(key);
  }

  private cellOf(cx: number, cy: number) {
    return cy * 0x10000 + cx;
  }

  private build(cx: number, cy: number) {
    this.pictures ??= Array.from({ length: VARIANTS }, (_, i) => textureOf(puddleCanvas(i)));
    this.ring ??= textureOf(rippleCanvas());
    const root = new Container(),
      puddles: Puddle[] = [];
    for (let y = cy * CELL; y < (cy + 1) * CELL && y < this.map.h; y++)
      for (let x = cx * CELL; x < (cx + 1) * CELL && x < this.map.w; x++) {
        const site = this.free(x, y) ? puddleAt(this.map, x, y) : null;
        if (!site) continue;
        const ground = this.surface(x, y),
          p = tileToWorld(site.ox, site.oy),
          origin = tileToWorld(0, 0),
          water = new Sprite(this.pictures[site.variant]),
          ripple = new Sprite(this.ring);
        for (const s of [water, ripple]) {
          s.anchor.set(0.5);
          s.position.set(ground.x + p.x - origin.x, ground.y + p.y - origin.y);
          root.addChild(s);
        }
        puddles.push({ site, water, ripple });
      }
    this.layer.addChild(root);
    const cell = { root, puddles };
    this.cells.set(this.cellOf(cx, cy), cell);
    return cell;
  }

  /** Rings where the rain falls on water: each picks a spot in the view and shows if it is water. */
  private ringTheWater(rain: number, view: View, zoom: number) {
    const n = rain > RIPPLE_RAIN ? ringCount(view.w * view.h) : 0,
      radius = 3.4 / Math.min(1, Math.sqrt(zoom));
    if (n && !this.waterRings.parent) this.layer.addChild(this.waterRings);
    this.waterRings.visible = n > 0;
    for (let i = 0; i < n; i++) {
      let s = this.rings[i];
      if (!s) {
        this.ringPicture ??= textureOf(waterRingCanvas());
        s = new Sprite(this.ringPicture);
        s.anchor.set(0.5);
        this.waterRings.addChild(s);
        this.rings[i] = s;
      }
      const r = ringAt(i, this.t),
        x = view.x + r.u * view.w,
        y = view.y + r.v * view.h,
        tile = worldToTile(x, y),
        tx = Math.round(tile.x),
        ty = Math.round(tile.y),
        water =
          tx >= 0 &&
          ty >= 0 &&
          tx < this.map.w &&
          ty < this.map.h &&
          terrainAt(this.map, tx, ty) === Terrain.Water;
      s.visible = water;
      if (!water) continue;
      s.position.set(x, y);
      s.scale.set((radius * (0.3 + 0.7 * Math.sqrt(r.age)) * 2) / (RING_PICTURE * 0.84));
      s.alpha = r.alpha * Math.min(1, rain * 1.4) * 0.9;
    }
    for (let i = n; i < this.rings.length; i++) this.rings[i].visible = false;
  }

  /**
   * The ground `dt` game seconds on under `rain` (0..1), the puddles and the rings on the water in
   * `view` (world px), drawn at `zoom`.
   */
  update(dt: number, rain: number, view: View, zoom = 1) {
    this.t += dt;
    this.ringTheWater(rain, view, zoom);
    this.wetness = nextWetness(this.wetness, rain, dt);
    const wet = this.wetness;
    if (wet < DRY) {
      if (this.cells.size) this.clear();
      return;
    }
    const shown = new Set<number>(),
      corners = [
        worldToTile(view.x, view.y),
        worldToTile(view.x + view.w, view.y),
        worldToTile(view.x, view.y + view.h),
        worldToTile(view.x + view.w, view.y + view.h),
      ],
      x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x)) / CELL)),
      x1 = Math.min(
        Math.floor((this.map.w - 1) / CELL),
        Math.floor(Math.max(...corners.map((c) => c.x)) / CELL),
      ),
      y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y)) / CELL)),
      y1 = Math.min(
        Math.floor((this.map.h - 1) / CELL),
        Math.floor(Math.max(...corners.map((c) => c.y)) / CELL),
      );
    const scale = 0.5 + 0.5 * wet,
      alpha = Math.min(1, wet * 2) * 0.8,
      ringing = rain > RIPPLE_RAIN;
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const key = this.cellOf(cx, cy),
          cell = this.cells.get(key) ?? this.build(cx, cy);
        shown.add(key);
        cell.root.visible = true;
        for (const p of cell.puddles) {
          const k = (p.site.width * scale) / PICTURE;
          p.water.scale.set(k);
          p.water.alpha = alpha;
          p.ripple.visible = ringing;
          if (!ringing) continue;
          const age = (this.t / RIPPLE_LIFE + p.site.phase) % 1;
          p.ripple.scale.set(k * (0.15 + 0.6 * age));
          p.ripple.alpha = alpha * (1 - age) * 0.45;
        }
      }
    for (const key of this.shown) {
      const cell = this.cells.get(key);
      if (cell && !shown.has(key)) cell.root.visible = false;
    }
    this.shown = shown;
  }

  /** The ground is dry: the next rain finds its puddles afresh. */
  private clear() {
    for (const cell of this.cells.values()) cell.root.destroy({ children: true });
    this.cells.clear();
    this.shown.clear();
  }
}
