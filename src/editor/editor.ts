import { Terrain, inBounds, type GameMap } from '../world/tiles';
import { decorateProps } from '../world/mapgen';
import { hash2 } from '../engine/rng';
import { type LevelData, packBytes, saveLevel, EDITOR_DRAFT_KEY, newLevelId } from '../world/level';
import type { Builder } from '../sim/build';
import type { WorldRenderer } from '../render/worldRenderer';
import { rules } from '../sim/rules';

/**
 * Level editor state: terrain brush, level metadata, and conversion between the live world and
 * the stored level format. Building itself goes through the normal Builder in free mode.
 */
export class Editor {
  brushSize = 1;
  dirty = false;
  constructor(
    readonly map: GameMap,
    readonly builder: Builder,
    readonly world: WorldRenderer,
    public level: LevelData,
  ) {}

  /** Tiles covered by the brush around (x, y). */
  footprint(x: number, y: number): { x: number; y: number }[] {
    const r = this.brushSize - 1;
    const out: { x: number; y: number }[] = [];
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > r + (r > 1 ? 1 : 0)) continue;
        const tx = x + dx;
        const ty = y + dy;
        if (inBounds(this.map, tx, ty)) out.push({ x: tx, y: ty });
      }
    return out;
  }

  /** Paint terrain under the brush; anything built on those tiles is removed first. */
  paint(x: number, y: number, terrain: Terrain) {
    const tiles = this.footprint(x, y);
    let changed = false;
    for (const t of tiles) {
      const i = t.y * this.map.w + t.x;
      if (this.map.terrain[i] === terrain) continue;
      const st = this.builder.stationAt(t.x, t.y);
      if (st) this.builder.removeStation(st);
      if (this.builder.decorAt(t.x, t.y)) this.builder.removeDecor(t.x, t.y);
      if (this.builder.buildingAt(t.x, t.y)) this.builder.removeBuilding(t.x, t.y);
      if (this.builder.track.has(t.x, t.y)) this.builder.removeTrack(t.x, t.y);
      this.map.terrain[i] = terrain;
      this.map.variant[i] = Math.floor(hash2(t.x, t.y, this.map.seed + terrain) * 4);
      this.world.setFlattened(t.x, t.y, false);
      changed = true;
    }
    if (!changed) return;
    const xs = tiles.map((t) => t.x);
    const ys = tiles.map((t) => t.y);
    const rect = {
      x0: Math.min(...xs),
      y0: Math.min(...ys),
      x1: Math.max(...xs),
      y1: Math.max(...ys),
    };
    decorateProps(this.map, this.map.seed, rect);
    for (let ty = rect.y0; ty <= rect.y1; ty++)
      for (let tx = rect.x0; tx <= rect.x1; tx++) this.world.retile(tx, ty);
    this.dirty = true;
  }

  /** Fill the whole map with one terrain (clearing everything built). */
  fillAll(terrain: Terrain) {
    for (const s of [...this.builder.stations]) this.builder.removeStation(s);
    for (const d of [...this.builder.decor.values()]) this.builder.removeDecor(d.x, d.y);
    for (const b of [...this.builder.buildings.values()]) this.builder.removeBuilding(b.x, b.y);
    for (const t of [...this.builder.track.tiles()]) this.builder.removeTrack(t.x, t.y);
    for (let i = 0; i < this.map.terrain.length; i++) {
      this.map.terrain[i] = terrain;
      this.map.variant[i] = Math.floor(
        hash2(i % this.map.w, Math.floor(i / this.map.w), this.map.seed + terrain) * 4,
      );
    }
    decorateProps(this.map, this.map.seed);
    for (let y = 0; y < this.map.h; y++)
      for (let x = 0; x < this.map.w; x++) {
        this.world.setFlattened(x, y, false);
        this.world.retile(x, y);
      }
    this.dirty = true;
  }

  /** Snapshot the live world into the level record. */
  collect(): LevelData {
    const l = this.level;
    l.w = this.map.w;
    l.h = this.map.h;
    l.seed = this.map.seed;
    l.terrain = packBytes(this.map.terrain);
    l.variant = packBytes(this.map.variant);
    l.biome = packBytes(this.map.biome);
    l.track = [...this.builder.track.tiles()].map((t) => [t.x, t.y, t.piece.kind, t.piece.rot]);
    l.stations = this.builder.stations.map((s) => ({
      defId: s.def.id,
      x: s.x,
      y: s.y,
      level: s.level,
      name: s.name,
    }));
    l.decor = [...this.builder.decor.values()].map((d) => [d.x, d.y, d.id, d.rot]);
    l.buildings = [...this.builder.buildings.values()].map((b) => [b.x, b.y, b.id]);
    l.updatedAt = Date.now();
    return l;
  }

  save(): boolean {
    const ok = saveLevel(this.collect());
    if (ok) {
      this.dirty = false;
      this.saveDraft();
    }
    return ok;
  }

  /** Copy the level under a new id and name. */
  saveAs(name: string): boolean {
    this.collect();
    this.level = { ...this.level, id: newLevelId(), name, createdAt: Date.now() };
    return this.save();
  }

  saveDraft() {
    try {
      sessionStorage.setItem(EDITOR_DRAFT_KEY, JSON.stringify(this.collect()));
    } catch {
      /* ignore */
    }
  }

  /** Default start block from the current rules. */
  static defaultStart(): LevelData['start'] {
    return {
      money: rules.startMoney,
      tickets: rules.startTickets,
      reputation: rules.startReputation,
      tier: 0,
    };
  }
}
