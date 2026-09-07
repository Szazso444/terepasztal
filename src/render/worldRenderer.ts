import { Container, Sprite, Rectangle, Graphics } from 'pixi.js';
import type { AtlasRegistry } from '../engine/atlas';
import { tileToWorld, depthKey, ELEV_PX, HALF_W, HALF_H, TILE_H } from '../engine/iso';
import { Terrain, Biome, type GameMap, type PropInstance, idx } from '../world/tiles';
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
  readonly track = new Container();
  readonly objects = new Container();
  readonly overlay = new Container(); // cursors, ghosts – drawn over objects
  readonly fog = new Container();
  /** additive ground lights (per-tile lighting), drawn over track and under objects */
  readonly lights = new Container();
  /** out-of-map void ring */
  readonly border = new Container();
  private trackSprites = new Map<number, Sprite>();
  private structures = new Map<string, Sprite>();
  private groundSprites: Sprite[] = [];
  private fogShapes = new Map<number, Graphics>();
  /** regions whose ground and props have been built */
  private builtRegions = new Set<number>();
  private waterSprites: { s: Sprite; base: string }[] = [];
  private waterPhase = 0;
  private waterFrame = 0;
  /** number of void tiles drawn around the playable map */
  static readonly BORDER = 8;
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
    this.track.cullableChildren = true;
    this.border.cullableChildren = true;
    this.lights.cullableChildren = true;
    this.root.addChild(
      this.border,
      this.ground,
      this.track,
      this.lights,
      this.objects,
      this.fog,
      this.overlay,
    );
    this.buildBorder();
    this.buildGround();
    this.buildProps();
    this.rebuildFog();
  }

  private groundFrame(x: number, y: number): string {
    const i = idx(this.map, x, y);
    const t = this.map.terrain[i] as Terrain;
    const v = this.map.variant[i];
    const b = this.map.biome[i] as Biome;
    switch (t) {
      case Terrain.Grass:
        return b === Biome.Plains
          ? `terrain/plains_${v}`
          : b === Biome.Taiga
            ? `terrain/taiga_${v}`
            : b === Biome.Swamp
              ? `terrain/swamp_${v}`
              : b === Biome.Desert
                ? `terrain/desert_${v}`
                : `terrain/grass_${v}`;
      case Terrain.Forest:
        return b === Biome.Swamp ? `terrain/swamp_${v}` : `terrain/forest_${v}`;
      case Terrain.Hill:
        return this.flattened.has(i) ? `terrain/hillcut_${v}` : `terrain/hill_${v % 3}`;
      case Terrain.Water:
        return `terrain/water_${v % 3}_f0`;
      case Terrain.Rock:
        return `terrain/rock_${v}`;
      case Terrain.Mountain:
        return `terrain/mountain_${v % 3}`;
      case Terrain.Sand:
        return b === Biome.Desert ? `terrain/desert_${v}` : `terrain/sand_${v}`;
    }
  }

  /** Ground for every revealed region; hidden regions are built when they get revealed. */
  private buildGround() {
    const { w, h } = this.map;
    this.groundSprites = new Array(w * h);
    this.ground.sortableChildren = true;
    for (let i = 0; i < this.regions.unlocked.length; i++)
      if (this.regions.isRevealed(i)) this.buildRegion(i);
  }
  /** Build ground sprites (in culled CHUNK blocks) and props of one region once. */
  private buildRegion(ri: number) {
    if (this.builtRegions.has(ri)) return;
    this.builtRegions.add(ri);
    const r = this.regions.regionRect(ri);
    const { w, h } = this.map;
    const x1 = Math.min(w, r.x + r.w);
    const y1 = Math.min(h, r.y + r.h);
    for (let cy0 = r.y; cy0 < y1; cy0 += CHUNK)
      for (let cx0 = r.x; cx0 < x1; cx0 += CHUNK) {
        const chunk = new Container();
        chunk.cullable = true;
        chunk.cullableChildren = false;
        const tiles: { x: number; y: number }[] = [];
        for (let y = cy0; y < Math.min(y1, cy0 + CHUNK); y++)
          for (let x = cx0; x < Math.min(x1, cx0 + CHUNK); x++) tiles.push({ x, y });
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
          minY = Math.min(minY, s.y - HALF_H - 2 * ELEV_PX);
          maxY = Math.max(maxY, s.y + HALF_H);
        }
        chunk.cullArea = new Rectangle(minX, minY, maxX - minX, maxY - minY);
        // draw order: blocks with smaller (x+y) first so hill faces layer correctly
        chunk.zIndex = Math.floor(cx0 / CHUNK) + Math.floor(cy0 / CHUNK);
        this.ground.addChild(chunk);
      }
    this.ground.sortChildren();
    for (let y = r.y; y < y1; y++)
      for (let x = r.x; x < x1; x++) {
        const i = idx(this.map, x, y);
        const list = this.map.props.get(i);
        if (list && !this.propSprites.has(i)) this.buildPropsAt(i, list);
      }
    this.applyTintTo(r.x, r.y, x1, y1);
  }
  /** Is this tile's region built (revealed)? */
  isBuilt(x: number, y: number) {
    return this.builtRegions.has(this.regions.regionIndex(x, y));
  }

  private makeGroundSprite(x: number, y: number): Sprite {
    const frame = this.groundFrame(x, y);
    const f = this.atlas.get(frame);
    const s = new Sprite(f.texture);
    s.anchor.set(f.anchorX, f.anchorY);
    const p = tileToWorld(x, y);
    s.position.set(p.x, p.y);
    if (this.map.terrain[idx(this.map, x, y)] === Terrain.Water) {
      this.waterSprites.push({ s, base: frame.slice(0, -3) });
    }
    return s;
  }

  /** Re-texture a ground tile (after flattening a hill, etc). */
  refreshGround(x: number, y: number) {
    const i = idx(this.map, x, y);
    const s = this.groundSprites[i];
    if (!s) return;
    const frame = this.groundFrame(x, y);
    const f = this.atlas.get(frame);
    s.texture = f.texture;
    s.anchor.set(f.anchorX, f.anchorY);
    const isWater = this.map.terrain[i] === Terrain.Water;
    const wi = this.waterSprites.findIndex((w) => w.s === s);
    if (isWater && wi < 0) this.waterSprites.push({ s, base: frame.slice(0, -3) });
    else if (!isWater && wi >= 0) this.waterSprites.splice(wi, 1);
    s.tint = isWater ? 0xffffff : this.groundTint;
  }

  /**
   * Track was laid on the tile: push its trees and bushes to the sides of the rails (straight
   * pieces) or clear them (curves, switches, crossings need the whole tile).
   */
  displaceProps(x: number, y: number, links: [number, number][]) {
    const i = idx(this.map, x, y);
    const list = this.map.props.get(i);
    if (!list?.length) return;
    const ns = links.length === 1 && links[0].includes(0) && links[0].includes(2);
    const ew = links.length === 1 && links[0].includes(1) && links[0].includes(3);
    if (!ns && !ew) {
      this.map.props.delete(i);
      this.removeProps(x, y);
      return;
    }
    for (const p of list) {
      if (ns) {
        p.ox = p.ox >= 0 ? 0.4 : -0.4;
        p.oy = Math.max(-0.3, Math.min(0.3, p.oy));
      } else {
        p.oy = p.oy >= 0 ? 0.4 : -0.4;
        p.ox = Math.max(-0.3, Math.min(0.3, p.ox));
      }
    }
    this.rebuildProps(x, y);
  }
  /** Re-create the prop sprites of one tile from the map data (after terrain edits). */
  rebuildProps(x: number, y: number) {
    this.removeProps(x, y);
    const i = idx(this.map, x, y);
    const list = this.map.props.get(i);
    if (list) this.buildPropsAt(i, list);
  }

  /** Re-tile after terrain edits: ground texture, props, and objects standing on the tile. */
  retile(x: number, y: number) {
    if (!this.isBuilt(x, y)) return;
    this.refreshGround(x, y);
    this.rebuildProps(x, y);
    const i = idx(this.map, x, y);
    const p = tileToWorld(x, y);
    const t = this.trackSprites.get(i);
    if (t) t.position.set(p.x, p.y + this.elevationOf(x, y));
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
    const t = this.map.terrain[i];
    if (t === Terrain.Mountain) return -2 * ELEV_PX;
    return t === Terrain.Hill && !this.flattened.has(i) ? -ELEV_PX : 0;
  }

  private buildProps() {
    for (const [i, list] of this.map.props)
      if (this.isBuilt(i % this.map.w, Math.floor(i / this.map.w))) this.buildPropsAt(i, list);
  }
  private buildPropsAt(i: number, list: PropInstance[]) {
    {
      const x = i % this.map.w;
      const y = Math.floor(i / this.map.w);
      if (!this.isBuilt(x, y)) return;
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
        s.tint = this.propTint;
        s.visible = !this.flattened.has(i);
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

  /** One translucent diamond per revealed-but-unowned region; hidden regions draw nothing. */
  rebuildFog() {
    for (const g of this.fogShapes.values()) g.destroy();
    this.fogShapes.clear();
    for (let i = 0; i < this.regions.unlocked.length; i++) {
      if (!this.regions.isRevealed(i)) continue;
      this.buildRegion(i);
      if (this.regions.unlocked[i]) continue;
      const r = this.regions.regionRect(i);
      const x1 = Math.min(this.map.w, r.x + r.w);
      const y1 = Math.min(this.map.h, r.y + r.h);
      const a = tileToWorld(r.x, r.y);
      const b = tileToWorld(x1, r.y);
      const c = tileToWorld(x1, y1);
      const d = tileToWorld(r.x, y1);
      const g = new Graphics();
      g.poly([a.x, a.y - HALF_H, b.x, b.y - HALF_H, c.x, c.y - HALF_H, d.x, d.y - HALF_H]).fill({
        color: 0x08080c,
        alpha: 0.62,
      });
      g.cullable = true;
      this.fog.addChild(g);
      this.fogShapes.set(i, g);
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
    if (this.waterPhase > 0.28) {
      this.waterPhase = 0;
      this.waterFrame = (this.waterFrame + 1) % 4;
      for (const w of this.waterSprites) {
        w.s.texture = this.atlas.get(`${w.base}_f${this.waterFrame}`).texture;
      }
    }
  }

  /** Void ring outside the playable area so zooming out never shows raw background. */
  private buildBorder() {
    const B = WorldRenderer.BORDER;
    const { w, h } = this.map;
    const CH = 16;
    const chunks = new Map<
      string,
      { c: Container; minX: number; minY: number; maxX: number; maxY: number }
    >();
    for (let y = -B; y < h + B; y++)
      for (let x = -B; x < w + B; x++) {
        if (x >= 0 && y >= 0 && x < w && y < h) continue;
        const key = `${Math.floor(x / CH)},${Math.floor(y / CH)}`;
        let ch = chunks.get(key);
        if (!ch) {
          ch = {
            c: new Container(),
            minX: Infinity,
            minY: Infinity,
            maxX: -Infinity,
            maxY: -Infinity,
          };
          ch.c.cullable = true;
          ch.c.cullableChildren = false;
          chunks.set(key, ch);
          this.border.addChild(ch.c);
        }
        const f = this.atlas.get(`terrain/void_${(((x * 7 + y * 13) % 3) + 3) % 3}`);
        const sp = new Sprite(f.texture);
        sp.anchor.set(f.anchorX, f.anchorY);
        const pt = tileToWorld(x, y);
        sp.position.set(pt.x, pt.y);
        // fade towards the outside so the edge reads as deep water
        const d = Math.max(-x, -y, x - (w - 1), y - (h - 1));
        sp.alpha = 1;
        const k = Math.max(0.22, 1 - d * 0.11);
        const v = Math.round(255 * k);
        sp.tint = (v << 16) | (v << 8) | Math.min(255, Math.round(v * 1.1));
        ch.c.addChild(sp);
        ch.minX = Math.min(ch.minX, pt.x - HALF_W);
        ch.maxX = Math.max(ch.maxX, pt.x + HALF_W);
        ch.minY = Math.min(ch.minY, pt.y - HALF_H);
        ch.maxY = Math.max(ch.maxY, pt.y + HALF_H);
      }
    for (const ch of chunks.values())
      ch.c.cullArea = new Rectangle(ch.minX, ch.minY, ch.maxX - ch.minX, ch.maxY - ch.minY);
  }

  /** Multiply-tint every ground and prop sprite (seasons). Water and void are left alone. */
  private groundTint = 0xffffff;
  private propTint = 0xffffff;
  setSeasonTint(ground: number, props: number) {
    this.groundTint = ground;
    this.propTint = props;
    for (let i = 0; i < this.groundSprites.length; i++) {
      const s = this.groundSprites[i];
      if (!s) continue;
      if (this.map.terrain[i] === Terrain.Water) continue;
      s.tint = ground;
    }
    for (const list of this.propSprites.values()) for (const s of list) s.tint = props;
  }
  /** Apply the current season tint to a freshly built region. */
  private applyTintTo(x0: number, y0: number, x1: number, y1: number) {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = idx(this.map, x, y);
        const s = this.groundSprites[i];
        if (s && this.map.terrain[i] !== Terrain.Water) s.tint = this.groundTint;
        for (const p of this.propSprites.get(i) ?? []) p.tint = this.propTint;
      }
  }

  /** Show a track piece sprite on a tile (or clear it). Flat: lives in the track layer under objects. */
  /** Highlight colour per tile (path tracing); 0xffffff clears. Night shading is applied on top. */
  private trackHighlight = new Map<number, number>();
  private trackNight = 0;
  setTrackTint(x: number, y: number, color: number) {
    const i = idx(this.map, x, y);
    if (color === 0xffffff) this.trackHighlight.delete(i);
    else this.trackHighlight.set(i, color);
    const s = this.trackSprites.get(i);
    if (s) s.tint = this.trackColour(i);
  }
  private trackColour(i: number) {
    const hl = this.trackHighlight.get(i);
    if (hl !== undefined) return hl;
    // ballast is light; darken it with the night so the line does not glow through the dark
    const k = 1 - 0.55 * this.trackNight;
    const r = Math.round(0xc8 * k);
    const g = Math.round(0xc4 * k);
    const b = Math.round(0xbe * k + 0x20 * this.trackNight);
    return (r << 16) | (g << 8) | Math.min(255, b);
  }
  /** Darken every track sprite with the night (0 day .. 1 deep night). */
  setTrackNight(night: number) {
    if (Math.abs(night - this.trackNight) < 0.04) return;
    this.trackNight = night;
    for (const [i, s] of this.trackSprites) s.tint = this.trackColour(i);
  }
  setTrack(x: number, y: number, frame: string | null) {
    const i = idx(this.map, x, y);
    let s = this.trackSprites.get(i);
    if (!frame) {
      if (s) {
        s.destroy();
        this.trackSprites.delete(i);
      }
      return;
    }
    const f = this.atlas.get(frame);
    if (!s) {
      s = new Sprite(f.texture);
      s.cullable = true;
      this.track.addChild(s);
      this.trackSprites.set(i, s);
    } else s.texture = f.texture;
    s.anchor.set(f.anchorX, f.anchorY);
    s.tint = this.trackColour(i);
    const p = tileToWorld(x, y);
    s.position.set(p.x, p.y + this.elevationOf(x, y));
  }

  /** Place or update a tall structure sprite keyed by id in the depth-sorted object layer. */
  setStructure(id: string, x: number, y: number, frame: string, layer = 20, dy = 0, dx = 0) {
    const f = this.atlas.get(frame);
    let s = this.structures.get(id);
    if (!s) {
      s = new Sprite(f.texture);
      s.cullable = true;
      this.objects.addChild(s);
      this.structures.set(id, s);
    } else s.texture = f.texture;
    s.anchor.set(f.anchorX, f.anchorY);
    const p = tileToWorld(x, y);
    s.position.set(p.x + dx, p.y + this.elevationOf(x, y) + dy);
    s.zIndex = depthKey(x, y, layer);
    return s;
  }
  removeStructure(id: string) {
    const s = this.structures.get(id);
    if (s) {
      s.destroy();
      this.structures.delete(id);
    }
  }
  getStructure(id: string) {
    return this.structures.get(id);
  }

  /** Create a sprite in the overlay layer (ghost previews). */
  makeOverlaySprite(frame: string): Sprite {
    const f = this.atlas.get(frame);
    const s = new Sprite(f.texture);
    s.anchor.set(f.anchorX, f.anchorY);
    this.overlay.addChild(s);
    return s;
  }
  setSpriteFrame(s: Sprite, frame: string) {
    const f = this.atlas.get(frame);
    s.texture = f.texture;
    s.anchor.set(f.anchorX, f.anchorY);
  }

  /** World pixel position of the top surface of a tile centre (for placing sprites). */
  surfacePoint(x: number, y: number) {
    const p = tileToWorld(x, y);
    return { x: p.x, y: p.y + this.elevationOf(Math.floor(x + 0.5), Math.floor(y + 0.5)) };
  }
}

export const TILE_PIXEL_H = TILE_H;
