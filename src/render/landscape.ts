import { Container, Sprite, Texture, Graphics } from 'pixi.js';
import { type LandscapeMap } from './landscapeModel';
import {
  buildRelief,
  reliefHeight,
  reliefCorners,
  reliefTileAtWorld,
  type TerrainRelief,
} from './terrainRelief';
import { hash2 } from '../engine/rng';
import { Terrain } from '../world/tiles';

/** Worker-painted illustrated chunks. Panning and simulation ticks never repaint terrain. */
export class Landscape {
  readonly root = new Container({ cullableChildren: true, sortableChildren: true });
  private worker: Worker | null = null;
  private relief: TerrainRelief;
  private version = 0;
  private loaded = false;
  private busy = false;
  private pending = new Set<string>();
  private chunks = new Map<
    string,
    { x: number; y: number; w: number; h: number; sprite: Sprite; details: Graphics }
  >();
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
        const old = c.sprite.texture;
        c.sprite.texture = Texture.from(canvas);
        c.sprite.texture.source.scaleMode = 'linear';
        c.sprite.position.set(data.left, data.top);
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
      for (const { sprite } of this.chunks.values())
        if (sprite.texture !== Texture.EMPTY) sprite.texture.destroy(true);
      this.chunks.clear();
      this.pending.clear();
    });
  }
  private fail() {
    this.failed = true;
    this.active = false;
    this.root.visible = false;
    this.statusChanged = true;
    this.worker?.terminate();
    this.pending.clear();
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
    this.chunks.set(id, { x, y, w, h, sprite, details });
    this.pending.add(id);
    this.pump();
  }
  setCity(tiles: ReadonlySet<number>) {
    this.city = tiles;
  }
  isPainted(x: number, y: number) {
    const chunk = this.chunks.get(`${Math.floor(x / 8) * 8},${Math.floor(y / 8) * 8}`);
    return !!chunk && chunk.sprite.texture !== Texture.EMPTY;
  }
  private pump() {
    if (!this.loaded || this.busy || this.failed || !this.pending.size) return;
    const id = this.pending.values().next().value!,
      c = this.chunks.get(id)!;
    this.busy = true;
    this.worker!.postMessage({ id, x: c.x, y: c.y, w: c.w, h: c.h, version: this.version });
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
        )
          this.pending.add(id);
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
  get chunkCount() {
    return this.chunks.size;
  }
}
