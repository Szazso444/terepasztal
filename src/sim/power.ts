import type { GameMap } from '../world/tiles';
import type { Decor } from './build';
import type { Building } from './buildings';
import { decorDef } from './build';
import { buildingDef } from './buildings';

/**
 * Electric network. Poles (power-line decor) and power plants are nodes; nodes within two tiles of
 * each other connect. A component with at least one plant is live, and every tile within one tile of
 * a live node is powered. Rebuilt whenever decor or buildings change.
 */
export interface PowerNode {
  x: number;
  y: number;
  plant: boolean;
}
export interface PowerEdge {
  a: PowerNode;
  b: PowerNode;
  live: boolean;
}

export class PowerGrid {
  private powered: Uint8Array;
  private edgeList: PowerEdge[] = [];
  /** connections between nodes (for drawing wires) */
  edges() {
    return this.edgeList;
  }
  /** number of plants connected to a live component (all plants, by definition) */
  plants = 0;
  poles = 0;
  constructor(readonly map: GameMap) {
    this.powered = new Uint8Array(map.w * map.h);
  }

  rebuild(decor: Iterable<Decor>, buildings: Iterable<Building>) {
    this.powered.fill(0);
    const nodes: { x: number; y: number; plant: boolean }[] = [];
    for (const d of decor) if (decorDef(d.id).power) nodes.push({ x: d.x, y: d.y, plant: false });
    for (const b of buildings) {
      const def = buildingDef(b.id);
      if (def.power) nodes.push({ x: b.x, y: b.y, plant: true });
      else if (def.substation) nodes.push({ x: b.x, y: b.y, plant: false });
    }
    this.poles = nodes.filter((n) => !n.plant).length;
    this.plants = nodes.filter((n) => n.plant).length;
    // union-find over nodes within Chebyshev distance 2
    const parent = nodes.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const pairs: [number, number][] = [];
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        if (Math.max(Math.abs(nodes[i].x - nodes[j].x), Math.abs(nodes[i].y - nodes[j].y)) <= 2) {
          parent[find(i)] = find(j);
          pairs.push([i, j]);
        }
      }
    const live = new Set<number>();
    nodes.forEach((n, i) => {
      if (n.plant) live.add(find(i));
    });
    this.edgeList = pairs.map(([i, j]) => ({ a: nodes[i], b: nodes[j], live: live.has(find(i)) }));
    nodes.forEach((n, i) => {
      if (!live.has(find(i))) return;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = n.x + dx;
          const y = n.y + dy;
          if (x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) continue;
          this.powered[y * this.map.w + x] = 1;
        }
    });
  }

  isPowered(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) return false;
    return this.powered[y * this.map.w + x] === 1;
  }
  /** Tiles for the overview / minimap. */
  *poweredTiles(): IterableIterator<{ x: number; y: number }> {
    for (let i = 0; i < this.powered.length; i++)
      if (this.powered[i]) yield { x: i % this.map.w, y: Math.floor(i / this.map.w) };
  }
}
