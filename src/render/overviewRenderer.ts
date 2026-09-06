import { Container, Graphics, Sprite, Text, Texture, ImageSource } from 'pixi.js';
import { Terrain, type GameMap } from '../world/tiles';
import type { RegionState } from '../world/regions';
import { PAL, css, hex } from '../art/palette';
import { STR } from '../strings';

/** Overview unit: pixels per tile in the layer's local space. */
export const OV_UNIT = 8;

export interface OverviewStation {
  id: number;
  x: number;
  y: number;
  name: string;
  level: number;
}
export interface OverviewTrain {
  id: number;
  x: number;
  y: number;
  name: string;
  heading: number;
}
export interface OverviewContract {
  id: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** 0..1 fraction of deadline remaining */
  remaining: number;
  label: string;
}
export interface OverviewSource {
  trackTiles(): Iterable<{ x: number; y: number; links: [number, number][] }>;
  stations(): OverviewStation[];
  trains(): OverviewTrain[];
  contracts(): OverviewContract[];
}

const FLAT_COLORS: Record<number, string> = {
  [Terrain.Grass]: css([58, 72, 44]),
  [Terrain.Forest]: css([42, 56, 36]),
  [Terrain.Hill]: css([94, 86, 60]),
  [Terrain.Water]: css([30, 46, 62]),
  [Terrain.Rock]: css([78, 76, 70]),
  [Terrain.Sand]: css([120, 108, 78]),
};

/** Flat top-down schematic of the whole map (the "strategic" layer). */
export class OverviewRenderer {
  readonly root = new Container();
  private terrain: Sprite;
  private regionLayer = new Graphics();
  private regionLabels = new Container();
  private trackG = new Graphics();
  private contractG = new Graphics();
  private stationLayer = new Container();
  private trainLayer = new Container();
  private stationNodes = new Map<number, Container>();
  private trainNodes = new Map<number, Container>();
  private contractLabels = new Map<number, Text>();
  private powerG = new Graphics();
  private pathG = new Graphics();
  /** tiles to highlight (a hovered train's predicted path), outermost leg first */
  highlight: { x: number; y: number }[][] = [];
  /** Set by the game: the tile currently hovered in overview space. */
  hover: { kind: 'station' | 'train'; id: number } | null = null;

  constructor(
    readonly map: GameMap,
    readonly regions: RegionState,
    private readonly source: OverviewSource,
  ) {
    this.terrain = new Sprite(this.buildTerrainTexture());
    this.terrain.scale.set(OV_UNIT);
    this.root.addChild(
      this.terrain,
      this.regionLayer,
      this.powerG,
      this.trackG,
      this.pathG,
      this.contractG,
      this.stationLayer,
      this.trainLayer,
      this.regionLabels,
    );
    this.rebuildRegions();
  }

  private buildTerrainTexture(): Texture {
    const c = document.createElement('canvas');
    c.width = this.map.w;
    c.height = this.map.h;
    const ctx = c.getContext('2d')!;
    for (let y = 0; y < this.map.h; y++)
      for (let x = 0; x < this.map.w; x++) {
        ctx.fillStyle = FLAT_COLORS[this.map.terrain[y * this.map.w + x]];
        ctx.fillRect(x, y, 1, 1);
      }
    return new Texture({ source: new ImageSource({ resource: c, scaleMode: 'nearest' }) });
  }

  /** Local-space rectangle of every revealed chunk (what the view should fit). */
  bounds() {
    const b = this.regions.revealedBounds();
    return { x: b.x * OV_UNIT, y: b.y * OV_UNIT, w: b.w * OV_UNIT, h: b.h * OV_UNIT };
  }

  rebuildRegions() {
    this.regionLayer.clear();
    this.regionLabels.removeChildren().forEach((c) => c.destroy());
    const rs = this.map.regionSize * OV_UNIT;
    for (let i = 0; i < this.regions.unlocked.length; i++) {
      const r = this.regions.regionRect(i);
      const x = r.x * OV_UNIT;
      const y = r.y * OV_UNIT;
      if (!this.regions.isRevealed(i)) {
        this.regionLayer.rect(x, y, rs, rs).fill({ color: 0x0a0a0c });
        continue;
      }
      if (!this.regions.unlocked[i]) {
        this.regionLayer.rect(x, y, rs, rs).fill({ color: 0x06060a, alpha: 0.72 });
        const t = new Text({
          text: `${STR.overview.locked}\n${STR.overview.price(this.regions.price(i))}\n${STR.overview.buyHint}`,
          style: { fontFamily: 'Georgia, serif', fontSize: 22, fill: 0x8a8578, align: 'center' },
        });
        t.anchor.set(0.5);
        t.position.set(x + rs / 2, y + rs / 2);
        this.regionLabels.addChild(t);
      }
      this.regionLayer.rect(x, y, rs, rs).stroke({ color: 0x2a2a2e, width: 2, alpha: 0.8 });
    }
  }

  /** Tint every electrified tile; called when poles or plants change. */
  rebuildPower(grid: { poweredTiles(): Iterable<{ x: number; y: number }> }) {
    this.powerG.clear();
    for (const t of grid.poweredTiles())
      this.powerG
        .rect(t.x * OV_UNIT, t.y * OV_UNIT, OV_UNIT, OV_UNIT)
        .fill({ color: 0x5ad0ff, alpha: 0.22 });
  }

  /** Redraw dynamic content. Cheap enough to run each frame while the overview is visible. */
  refresh() {
    const U = OV_UNIT;
    // highlighted path of the hovered train
    this.pathG.clear();
    this.highlight.forEach((leg, li) => {
      const col = li === 0 ? hex(PAL.cyan) : li === 1 ? hex(PAL.amber) : hex(PAL.white);
      for (const t of leg)
        this.pathG.rect(t.x * U + 1, t.y * U + 1, U - 2, U - 2).fill({ color: col, alpha: 0.55 });
    });
    // track
    this.trackG.clear();
    for (const t of this.source.trackTiles()) {
      const cx = (t.x + 0.5) * U;
      const cy = (t.y + 0.5) * U;
      for (const [a, b] of t.links) {
        const pa = edgePoint(a, U);
        const pb = edgePoint(b, U);
        this.trackG
          .moveTo(cx + pa.x, cy + pa.y)
          .lineTo(cx, cy)
          .lineTo(cx + pb.x, cy + pb.y);
      }
    }
    this.trackG.stroke({ color: hex(PAL.railLight), width: 2, alpha: 0.9 });
    // stations
    const stations = this.source.stations();
    const seenS = new Set<number>();
    for (const s of stations) {
      seenS.add(s.id);
      let node = this.stationNodes.get(s.id);
      if (!node) {
        node = new Container();
        const g = new Graphics();
        g.label = 'g';
        const label = new Text({
          text: s.name,
          style: {
            fontFamily: 'Georgia, serif',
            fontSize: 13,
            fill: hex(PAL.white),
            stroke: { color: 0x000000, width: 3 },
          },
        });
        label.label = 'label';
        label.anchor.set(0.5, 0);
        label.position.set(0, 8);
        node.addChild(g, label);
        node.eventMode = 'static';
        this.stationLayer.addChild(node);
        this.stationNodes.set(s.id, node);
      }
      node.position.set((s.x + 0.5) * U, (s.y + 0.5) * U);
      const g = node.getChildByLabel('g') as Graphics;
      const hovered = this.hover?.kind === 'station' && this.hover.id === s.id;
      g.clear();
      const r = 4 + s.level;
      g.circle(0, 0, r + 2).fill({ color: 0x000000, alpha: 0.6 });
      g.circle(0, 0, r).fill({ color: hovered ? hex(PAL.amber) : hex(PAL.cyan) });
      g.circle(0, 0, r).stroke({ color: hovered ? hex(PAL.white) : hex(PAL.cyanDark), width: 1.5 });
      (node.getChildByLabel('label') as Text).text = s.name;
    }
    for (const [id, n] of this.stationNodes)
      if (!seenS.has(id)) {
        n.destroy();
        this.stationNodes.delete(id);
      }
    // trains
    const trains = this.source.trains();
    const seenT = new Set<number>();
    for (const t of trains) {
      seenT.add(t.id);
      let node = this.trainNodes.get(t.id);
      if (!node) {
        node = new Container();
        const g = new Graphics();
        g.label = 'g';
        node.addChild(g);
        this.trainLayer.addChild(node);
        this.trainNodes.set(t.id, node);
      }
      node.position.set((t.x + 0.5) * U, (t.y + 0.5) * U);
      node.rotation = t.heading;
      const hovered = this.hover?.kind === 'train' && this.hover.id === t.id;
      const g = node.getChildByLabel('g') as Graphics;
      g.clear();
      g.poly([7, 0, -5, -4, -3, 0, -5, 4]).fill({
        color: hovered ? hex(PAL.white) : hex(PAL.amber),
      });
      g.poly([7, 0, -5, -4, -3, 0, -5, 4]).stroke({ color: 0x000000, width: 1 });
    }
    for (const [id, n] of this.trainNodes)
      if (!seenT.has(id)) {
        n.destroy();
        this.trainNodes.delete(id);
      }
    // contracts
    this.contractG.clear();
    const contracts = this.source.contracts();
    const seenC = new Set<number>();
    for (const c of contracts) {
      seenC.add(c.id);
      const ax = (c.from.x + 0.5) * U;
      const ay = (c.from.y + 0.5) * U;
      const bx = (c.to.x + 0.5) * U;
      const by = (c.to.y + 0.5) * U;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len;
      const ny = dy / len;
      const sx = ax + nx * 10;
      const sy = ay + ny * 10;
      const ex = bx - nx * 12;
      const ey = by - ny * 12;
      const urgent = c.remaining < 0.25;
      const col = urgent ? hex(PAL.red) : hex(PAL.amber);
      this.contractG.moveTo(sx, sy).lineTo(ex, ey).stroke({ color: col, width: 2, alpha: 0.85 });
      // arrow head
      this.contractG
        .poly([
          ex,
          ey,
          ex - nx * 8 + ny * 5,
          ey - ny * 8 - nx * 5,
          ex - nx * 8 - ny * 5,
          ey - ny * 8 + nx * 5,
        ])
        .fill({ color: col });
      // deadline ring at destination
      const mx = (sx + ex) / 2;
      const my = (sy + ey) / 2;
      this.contractG.circle(mx, my, 9).fill({ color: 0x000000, alpha: 0.7 });
      this.contractG.circle(mx, my, 9).stroke({ color: 0x3a3a40, width: 2 });
      const start = -Math.PI / 2;
      this.contractG
        .moveTo(mx + 9 * Math.cos(start), my + 9 * Math.sin(start))
        .arc(mx, my, 9, start, start + Math.PI * 2 * Math.max(0.02, c.remaining))
        .stroke({ color: col, width: 2 });
      let label = this.contractLabels.get(c.id);
      if (!label) {
        label = new Text({
          text: c.label,
          style: {
            fontFamily: 'Verdana, sans-serif',
            fontSize: 10,
            fill: 0xd8cfb8,
            stroke: { color: 0x000000, width: 3 },
          },
        });
        label.anchor.set(0.5, 0);
        this.contractG.parent!.addChild(label);
        this.contractLabels.set(c.id, label);
      }
      label.text = c.label;
      label.position.set(mx, my + 11);
    }
    for (const [id, l] of this.contractLabels)
      if (!seenC.has(id)) {
        l.destroy();
        this.contractLabels.delete(id);
      }
    this.resolveLabelOverlaps();
  }

  /**
   * Push overlapping labels down so close stations and contracts stay readable. Runs on the
   * label set as laid out this frame; base positions are re-applied before each pass.
   */
  private resolveLabelOverlaps() {
    const entries: { t: Text; baseX: number; baseY: number; parentY: number }[] = [];
    for (const node of this.stationNodes.values()) {
      const t = node.getChildByLabel('label') as Text;
      entries.push({ t, baseX: node.x, baseY: node.y + 8, parentY: node.y });
    }
    for (const t of this.contractLabels.values())
      entries.push({ t, baseX: t.x, baseY: t.y, parentY: 0 });
    entries.sort((a, b) => a.baseY - b.baseY || a.baseX - b.baseX);
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    for (const e of entries) {
      const w = e.t.width + 4;
      const h = e.t.height + 1;
      let y = e.baseY;
      for (let tries = 0; tries < 8; tries++) {
        const hit = placed.find(
          (p) => Math.abs(p.x - e.baseX) * 2 < p.w + w && y < p.y + p.h && y + h > p.y,
        );
        if (!hit) break;
        y = hit.y + hit.h;
      }
      placed.push({ x: e.baseX, y, w, h });
      e.t.y = y - e.parentY;
    }
  }

  /** Overview-local point -> tile coords (fractional). */
  localToTile(lx: number, ly: number) {
    return { x: lx / OV_UNIT, y: ly / OV_UNIT };
  }

  /** Find the station or train under an overview-local point. */
  pick(lx: number, ly: number): { kind: 'station' | 'train'; id: number } | null {
    const U = OV_UNIT;
    let best: { kind: 'station' | 'train'; id: number; d: number } | null = null;
    for (const t of this.source.trains()) {
      const d = Math.hypot((t.x + 0.5) * U - lx, (t.y + 0.5) * U - ly);
      if (d < 9 && (!best || d < best.d)) best = { kind: 'train', id: t.id, d };
    }
    for (const s of this.source.stations()) {
      const d = Math.hypot((s.x + 0.5) * U - lx, (s.y + 0.5) * U - ly);
      if (d < 12 && (!best || d < best.d)) best = { kind: 'station', id: s.id, d };
    }
    return best ? { kind: best.kind, id: best.id } : null;
  }
}

function edgePoint(dir: number, U: number) {
  switch (dir) {
    case 0:
      return { x: 0, y: -U / 2 };
    case 1:
      return { x: U / 2, y: 0 };
    case 2:
      return { x: 0, y: U / 2 };
    default:
      return { x: -U / 2, y: 0 };
  }
}
