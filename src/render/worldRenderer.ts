import { Container, Sprite, Rectangle } from 'pixi.js';
import type { AtlasRegistry } from '../engine/atlas';
import { tileToWorld, depthKey, ELEV_PX, HALF_W, HALF_H, TILE_H } from '../engine/iso';
import { Terrain, type GameMap, idx } from '../world/tiles';
import type { RegionState } from '../world/regions';
import type { Camera } from '../engine/camera';

const CHUNK = 8;

/**
 * Isometric world view. Ground tiles live in chunked static containers (culled per chunk);
 * everything with height lives in one depth-sorted object layer so trains can pass behind trees.
 */
export class WorldRenderer {
  readonly root = new Container();
  readonly ground = new Container();
  readonly objects = new Container();
  readonly overlay = new Container(); // cursors, ghosts – drawn over objects
  readonly fog = new Container();
  private groundSprites: Sprite[] = [];
  private fogSprites = new Map<number, Sprite>();
  private waterSprites: { s: Sprite; a: string; b: string }[] = [];
  private waterPhase = 0;
  private propSprites = new Map<number, Sprite[]>();
  /** Tiles that must render flat (track / station on hill). */
  private flattened = new Set<number>();

  constructor(
    readonly atlas: AtlasRegistry,
    readonly map: GameMap,
    readonly regions: RegionState,
  ) {
    this.objects.sortableChildren = true;
    this.objects.cullableChildren = true;
    this.ground.cullableChildren = true;
    this.fog.cullableChildren = true;
    this.root.addChild(this.ground, this.fog, this.objects, this.overlay);
    this.buildGround();
    this.buildProps();
    this.rebuildFog();
  }

  private groundFrame(x: number, y: number): string {
    const i = idx(this.map, x, y);
    const t = this.map.terrain[i] as Terrain;
    const v = this.map.variant[i];
    switch (t) {
      case Terrain.Grass:
        return `terrain/grass_${v}`;
      case Terrain.Forest:
        return `terrain/forest_${v}`;
      case Terrain.Hill:
        return this.flattened.has(i) ? `terrain/hillcut_${v}` : `terrain/hill_${v % 3}`;
      case Terrain.Water:
        return `terrain/water_${v % 3}`;
      case Terrain.Rock:
        return `terrain/rock_${v}`;
      case Terrain.Sand:
        return `terrain/sand_${v}`;
    }
  }

  private buildGround() {
    const { w, h } = this.map;
    this.groundSprites = new Array(w * h);
    const cx = Math.ceil(w / CHUNK);
    const cy = Math.ceil(h / CHUNK);
    for (let cyi = 0; cyi < cy; cyi++)
      for (let cxi = 0; cxi < cx; cxi++) {
        const chunk = new Container();
        chunk.cullable = true;
        chunk.cullableChildren = false;
        const tiles: { x: number; y: number }[] = [];
        for (let y = cyi * CHUNK; y < Math.min(h, (cyi + 1) * CHUNK); y++)
          for (let x = cxi * CHUNK; x < Math.min(w, (cxi + 1) * CHUNK); x++) tiles.push({ x, y });
        tiles.sort((a, b) => a.x + a.y - (b.x + b.y));
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        for (const t of tiles) {
          const s = this.makeGroundSprite(t.x, t.y);
          chunk.addChild(s);
          this.groundSprites[idx(this.map, t.x, t.y)] = s;
          minX = Math.min(minX, s.x - HALF_W);
          maxX = Math.max(maxX, s.x + HALF_W);
          minY = Math.min(minY, s.y - HALF_H - ELEV_PX);
          maxY = Math.max(maxY, s.y + HALF_H);
        }
        chunk.cullArea = new Rectangle(minX, minY, maxX - minX, maxY - minY);
        // chunk draw order: chunks with smaller (cx+cy) first so hill faces layer correctly
        chunk.zIndex = cxi + cyi;
        this.ground.addChild(chunk);
      }
    this.ground.sortableChildren = true;
    this.ground.sortChildren();
  }

  private makeGroundSprite(x: number, y: number): Sprite {
    const frame = this.groundFrame(x, y);
    const f = this.atlas.get(frame);
    const s = new Sprite(f.texture);
    s.anchor.set(f.anchorX, f.anchorY);
    const p = tileToWorld(x, y);
    s.position.set(p.x, p.y);
    if (this.map.terrain[idx(this.map, x, y)] === Terrain.Water) {
      const alt = frame + '_b';
      if (this.atlas.has(alt)) this.waterSprites.push({ s, a: frame, b: alt });
    }
    return s;
  }

  /** Re-texture a ground tile (after flattening a hill, etc). */
  refreshGround(x: number, y: number) {
    const s = this.groundSprites[idx(this.map, x, y)];
    if (!s) return;
    const f = this.atlas.get(this.groundFrame(x, y));
    s.texture = f.texture;
    s.anchor.set(f.anchorX, f.anchorY);
  }

  setFlattened(x: number, y: number, flat: boolean) {
    const i = idx(this.map, x, y);
    if (flat) this.flattened.add(i);
    else this.flattened.delete(i);
    this.refreshGround(x, y);
    for (const s of this.propSprites.get(i) ?? []) s.visible = !flat;
  }
  isFlattened(x: number, y: number) {
    return this.flattened.has(idx(this.map, x, y));
  }
  /** Ground-level y offset for objects standing on a tile (raised hills lift them). */
  elevationOf(x: number, y: number) {
    const i = idx(this.map, x, y);
    return this.map.terrain[i] === Terrain.Hill && !this.flattened.has(i) ? -ELEV_PX : 0;
  }

  private buildProps() {
    for (const [i, list] of this.map.props) {
      const x = i % this.map.w;
      const y = Math.floor(i / this.map.w);
      const sprites: Sprite[] = [];
      for (const p of list) {
        const key = `props/${p.kind}_${p.variant}`;
        if (!this.atlas.has(key)) continue;
        const f = this.atlas.get(key);
        const s = new Sprite(f.texture);
        s.anchor.set(f.anchorX, f.anchorY);
        const wp = tileToWorld(x + p.ox, y + p.oy);
        s.position.set(Math.round(wp.x), Math.round(wp.y + this.elevationOf(x, y)));
        s.zIndex = depthKey(x + p.ox, y + p.oy, 10);
        s.cullable = true;
        this.objects.addChild(s);
        sprites.push(s);
      }
      if (sprites.length) this.propSprites.set(i, sprites);
    }
  }

  removeProps(x: number, y: number) {
    const i = idx(this.map, x, y);
    for (const s of this.propSprites.get(i) ?? []) s.destroy();
    this.propSprites.delete(i);
  }

  rebuildFog() {
    for (const s of this.fogSprites.values()) s.destroy();
    this.fogSprites.clear();
    const f = this.atlas.get('terrain/fog');
    for (let y = 0; y < this.map.h; y++)
      for (let x = 0; x < this.map.w; x++) {
        if (this.regions.isTileUnlocked(x, y)) continue;
        const s = new Sprite(f.texture);
        s.anchor.set(f.anchorX, f.anchorY);
        const p = tileToWorld(x, y);
        s.position.set(p.x, p.y + this.elevationOf(x, y));
        s.cullable = true;
        this.fog.addChild(s);
        this.fogSprites.set(idx(this.map, x, y), s);
      }
  }

  /** Apply camera transform. */
  applyCamera(cam: Camera) {
    const z = cam.zoom;
    this.root.scale.set(z);
    this.root.position.set(
      Math.round(cam.viewW / 2 - cam.x * z),
      Math.round(cam.viewH / 2 - cam.y * z),
    );
  }

  animate(dt: number) {
    this.waterPhase += dt;
    if (this.waterPhase > 0.9) {
      this.waterPhase = 0;
      for (const w of this.waterSprites) {
        const cur = w.s.texture === this.atlas.get(w.a).texture ? w.b : w.a;
        w.s.texture = this.atlas.get(cur).texture;
      }
    }
  }

  /** World pixel position of the top surface of a tile centre (for placing sprites). */
  surfacePoint(x: number, y: number) {
    const p = tileToWorld(x, y);
    return { x: p.x, y: p.y + this.elevationOf(Math.floor(x + 0.5), Math.floor(y + 0.5)) };
  }
}

export const TILE_PIXEL_H = TILE_H;
