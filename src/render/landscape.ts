import { Container, Sprite, Texture, Graphics } from 'pixi.js';
import { type LandscapeMap } from './landscapeModel';
import {
  buildRelief,
  reliefHeight,
  reliefCorners,
  reliefTileAtWorld,
  RELIEF_MAX,
  type TerrainRelief,
} from './terrainRelief';
import { hash2 } from '../engine/rng';
import { Terrain } from '../world/tiles';

/** Raster pixels per world pixel of the close-view chunk copies. */
const SHARP_SCALE = 2;
/** Screen pixels per world pixel above which chunks in view get a close-view copy. */
const SHARP_FROM = 1.4;
/** Close-view copies kept at once, nearest the view centre first (about 2.5 MB each). */
const SHARP_LIMIT = 48;
type Chunk = {
  x: number;
  y: number;
  w: number;
  h: number;
  sprite: Sprite;
  details: Graphics;
  base: Texture;
  sharp: Texture | null;
  sharpVersion: number;
};
type View = { x: number; y: number; w: number; h: number };

/**
 * Worker-painted illustrated chunks. Panning and simulation ticks never repaint the base cache;
 * close views add a limited set of double-resolution copies around the camera.
 */
export class Landscape {
  readonly root = new Container({ cullableChildren: true, sortableChildren: true });
  private worker: Worker | null = null;
  private relief: TerrainRelief;
  private version = 0;
  private loaded = false;
  private busy = false;
  private pending = new Set<string>();
  private sharpPending = new Set<string>();
  private flight: { id: string; scale: number; version: number } | null = null;
  private sharpShown = false;
  private focusKey = '';
  private chunks = new Map<string, Chunk>();
  private tint = 0xffffff;
  private dirtyTiles: { x: number; y: number }[] = [];
  private allDirty = false;
  private invalid = false;
  private heightsDirty = false;
  private statusChanged = false;
  failed = false;
  active = false;
  paintCount = 0;
  paintMilliseconds = 0;
  sharpPaintCount = 0;
  sharpPaintMilliseconds = 0;
  visibilityVersion = 0;
  private city: ReadonlySet<number> = new Set();
  constructor(
    private readonly map: LandscapeMap,
    private readonly flat: ReadonlySet<number>,
  ) {
    this.relief = buildRelief(map, flat);
    try {
      this.worker = new Worker(new URL('./landscape.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onerror = () => this.fail();
      this.worker.onmessage = ({ data }) => {
        if (this.root.destroyed) return;
        if (data.error) {
          console.warn(data.error);
          this.fail();
          return;
        }
        if (data.loaded) {
          this.loaded = true;
          this.pump();
          return;
        }
        this.busy = false;
        this.flight = null;
        if (data.version !== this.version) {
          this.pump();
          return;
        }
        const c = this.chunks.get(data.id);
        if (!c) {
          this.pump();
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = data.width;
        canvas.height = data.height;
        canvas
          .getContext('2d')!
          .putImageData(new ImageData(data.pixels, data.width, data.height), 0, 0);
        const texture = Texture.from(canvas);
        texture.source.scaleMode = 'linear';
        c.sprite.position.set(data.left, data.top);
        if (data.scale > 1) {
          c.sharp?.destroy(true);
          c.sharp = texture;
          c.sharpVersion = data.version;
          this.show(c);
          this.sharpPaintCount++;
          this.sharpPaintMilliseconds += data.ms;
          this.pump();
          return;
        }
        const old = c.base;
        c.base = texture;
        if (c.sharp && c.sharpVersion !== data.version) {
          c.sharp.destroy(true);
          c.sharp = null;
        }
        this.show(c);
        c.details.clear();
        c.details.position.set(data.left, data.top);
        const grass: Float32Array = data.grass;
        for (let group = 0; group < 2; group++) {
          for (let i = 0; i < grass.length; i += 4) {
            if (grass[i + 3] !== group) continue;
            const sx = grass[i],
              sy = grass[i + 1],
              length = grass[i + 2];
            c.details
              .moveTo(sx - 1.2, sy)
              .lineTo(sx - 1.5, sy - length * 0.65)
              .moveTo(sx - 0.35, sy)
              .lineTo(sx - 0.45, sy - length)
              .moveTo(sx + 0.45, sy)
              .lineTo(sx + 0.7, sy - length * 0.82)
              .moveTo(sx + 1.1, sy)
              .lineTo(sx + 1.65, sy - length * 0.5);
          }
          const base = group ? [131, 145, 70] : [172, 175, 84];
          let colour = 0;
          for (let j = 0; j < 3; j++)
            colour |=
              Math.round((base[j] * ((data.tint >> (16 - j * 8)) & 255)) / 255) << (16 - j * 8);
          c.details.stroke({ color: colour, width: 0.65, alpha: group ? 0.65 : 0.68 });
        }
        this.paintCount++;
        this.paintMilliseconds += data.ms;
        if (old !== Texture.EMPTY) old.destroy(true);
        else this.visibilityVersion++;
        this.pending.delete(data.id);
        this.pump();
      };
      this.worker.postMessage({
        url: new URL(`${import.meta.env.BASE_URL}assets/terrain-surfaces.png`, location.href).href,
      });
      this.sync();
    } catch {
      this.fail();
    }
    this.root.on('destroyed', () => {
      this.worker?.terminate();
      for (const c of this.chunks.values()) {
        if (c.base !== Texture.EMPTY) c.base.destroy(true);
        c.sharp?.destroy(true);
      }
      this.chunks.clear();
      this.pending.clear();
      this.sharpPending.clear();
    });
  }
  private fail() {
    this.failed = true;
    this.active = false;
    this.root.visible = false;
    this.statusChanged = true;
    this.worker?.terminate();
    this.pending.clear();
    this.sharpPending.clear();
  }
  private show(c: Chunk) {
    const sharp = this.sharpShown && c.sharp;
    c.sprite.texture = sharp || c.base;
    c.sprite.scale.set(sharp ? 1 / SHARP_SCALE : 1);
  }
  /**
   * Called with the camera's world rectangle and screen pixels per world pixel. Close views
   * repaint the chunks nearest the centre at SHARP_SCALE; the base cache stays for everything else.
   */
  focus(view: View, pixelScale: number) {
    if (this.failed) return;
    const shown = pixelScale > SHARP_FROM;
    if (shown !== this.sharpShown) {
      this.sharpShown = shown;
      for (const c of this.chunks.values()) this.show(c);
    }
    const key = shown ? `${view.x},${view.y},${view.w},${view.h},${this.version}` : '';
    if (key === this.focusKey) return;
    this.focusKey = key;
    this.sharpPending.clear();
    if (!shown) return;
    // Chunks in view rank first, each group nearest the centre first.
    const cx = view.x + view.w / 2,
      cy = view.y + view.h / 2,
      rank = (c: Chunk) => {
        const left = (c.x - c.y - c.h) * 32 - 4,
          top = (c.x + c.y - 1) * 16 - RELIEF_MAX - 5,
          width = (c.w + c.h) * 32 + 8,
          height = (c.w + c.h) * 16 + RELIEF_MAX + 12;
        const outside =
          left > view.x + view.w ||
          top > view.y + view.h ||
          left + width < view.x ||
          top + height < view.y;
        return (outside ? 1e9 : 0) + Math.hypot(left + width / 2 - cx, top + height / 2 - cy);
      };
    const near = [...this.chunks]
      .map(([id, c]) => ({ id, c, d: rank(c) }))
      .sort((a, b) => a.d - b.d);
    near.forEach(({ id, c, d }, i) => {
      const wanted = d < 1e9 && i < SHARP_LIMIT;
      if (wanted && c.sharpVersion !== this.version && !this.flying(id, SHARP_SCALE))
        this.sharpPending.add(id);
      // Copies ranked beyond the limit are released; out-of-view ones rank last.
      if (i >= SHARP_LIMIT && c.sharp) {
        c.sharp.destroy(true);
        c.sharp = null;
        c.sharpVersion = -1;
        this.show(c);
      }
    });
    this.pump();
  }
  private flying(id: string, scale: number) {
    const f = this.flight;
    return !!f && f.id === id && f.scale === scale && f.version === this.version;
  }
  private sync() {
    this.worker?.postMessage({
      map: {
        w: this.map.w,
        h: this.map.h,
        seed: this.map.seed,
        originX: this.map.originX,
        originY: this.map.originY,
        terrain: this.map.terrain,
        biome: this.map.biome,
      },
      relief: this.relief,
      version: this.version,
      tint: this.tint,
      city: [...this.city],
    });
  }
  add(x: number, y: number, w: number, h: number) {
    const id = `${x},${y}`;
    if (this.chunks.has(id) || this.failed) return;
    const sprite = new Sprite({ cullable: true }),
      details = new Graphics({ cullable: true });
    sprite.zIndex = x + y;
    details.zIndex = x + y + 0.01;
    this.root.addChild(sprite, details);
    this.chunks.set(id, {
      x,
      y,
      w,
      h,
      sprite,
      details,
      base: Texture.EMPTY,
      sharp: null,
      sharpVersion: -1,
    });
    this.pending.add(id);
    this.focusKey = '';
    this.pump();
  }
  setCity(tiles: ReadonlySet<number>) {
    this.city = tiles;
  }
  isPainted(x: number, y: number) {
    const chunk = this.chunks.get(`${Math.floor(x / 8) * 8},${Math.floor(y / 8) * 8}`);
    return !!chunk && chunk.base !== Texture.EMPTY;
  }
  /**
   * Base paints come first, except for chunks already showing a close-view copy: those are
   * repainted sharp first, so an edit never drops a close view back to the blurrier cache.
   */
  private pump() {
    if (!this.loaded || this.busy || this.failed) return;
    let id: string | undefined,
      scale = 1;
    for (const p of this.pending)
      if (!(this.sharpShown && this.chunks.get(p)!.sharp)) {
        id = p;
        break;
      }
    if (id === undefined && this.sharpPending.size) {
      id = this.sharpPending.values().next().value!;
      scale = SHARP_SCALE;
      this.sharpPending.delete(id);
    }
    id ??= this.pending.values().next().value;
    if (id === undefined) return;
    const c = this.chunks.get(id)!;
    this.busy = true;
    this.flight = { id, scale, version: this.version };
    this.worker!.postMessage({ id, x: c.x, y: c.y, w: c.w, h: c.h, version: this.version, scale });
  }
  invalidate(x: number, y: number) {
    if (this.failed) return;
    this.invalid = true;
    this.heightsDirty = true;
    this.dirtyTiles.push({ x, y });
  }
  private updateHeights() {
    if (this.heightsDirty) {
      this.relief = buildRelief(this.map, this.flat);
      this.heightsDirty = false;
    }
  }
  /** Returns true when prop/structure anchors need to be refreshed. */
  flush() {
    let changed = this.statusChanged;
    this.statusChanged = false;
    if (this.failed) return changed;
    if (this.invalid) {
      this.invalid = false;
      this.updateHeights();
      this.version++;
      this.sync();
      for (const [id, c] of this.chunks)
        if (
          this.allDirty ||
          this.dirtyTiles.some(
            (p) => p.x >= c.x - 6 && p.x < c.x + c.w + 6 && p.y >= c.y - 6 && p.y < c.y + c.h + 6,
          )
        ) {
          this.pending.add(id);
          if (this.sharpShown && c.sharp) this.sharpPending.add(id);
        }
      changed = this.dirtyTiles.length > 0;
      this.dirtyTiles = [];
      this.allDirty = false;
      this.pump();
    }
    if (!this.active && this.ready) {
      this.active = true;
      changed = true;
    }
    return changed;
  }
  elevation(x: number, y: number) {
    this.updateHeights();
    return -reliefHeight(this.map, this.relief, x, y);
  }
  tileAtWorld(x: number, y: number) {
    this.updateHeights();
    return reliefTileAtWorld(this.map, this.relief, x, y);
  }
  /** Original illustrated silhouettes only at sparse, unbuildable local summits. */
  summit(x: number, y: number) {
    if (this.failed || this.map.terrain[y * this.map.w + x] !== Terrain.Mountain) return false;
    this.updateHeights();
    if (Math.min(...reliefCorners(this.map, this.relief, x, y)) < 10) return false;
    const rank = hash2(x + this.map.originX, y + this.map.originY, this.map.seed + 601);
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx,
          yy = y + dy;
        if (
          xx < 0 ||
          yy < 0 ||
          xx >= this.map.w ||
          yy >= this.map.h ||
          this.map.terrain[yy * this.map.w + xx] !== Terrain.Mountain
        )
          continue;
        if (hash2(xx + this.map.originX, yy + this.map.originY, this.map.seed + 601) > rank)
          return false;
      }
    return true;
  }
  setTint(tint: number) {
    if (tint === this.tint || this.failed) return;
    this.tint = tint;
    this.invalid = true;
    this.allDirty = true;
  }
  get ready() {
    return this.loaded && !this.failed && !this.pending.size && !this.invalid;
  }
  /** Base cache ready and every wanted close-view copy painted. */
  get sharpReady() {
    return this.ready && !this.sharpPending.size && !this.busy;
  }
  get chunkCount() {
    return this.chunks.size;
  }
}
