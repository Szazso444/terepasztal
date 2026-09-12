import type { Sprite } from 'pixi.js';
import type { Input } from '../engine/input';
import { rotationCount, itemKey, footprintOf, isUnitKind, type TrackItem } from '../world/track';
import type { SupplyKind } from '../sim/catenary';
import { inBounds } from '../world/tiles';
import type { Builder } from '../sim/build';
import type { WorldRenderer } from '../render/worldRenderer';
import type { Station } from '../sim/stations';
import type { Tool } from './toolbar';
import { STR } from '../strings';
import { fmtCost, scaleCost } from '../sim/stockpile';
import { buildingDef, type Building } from '../sim/buildings';
import { stationDef, LEVELS } from '../sim/stations';
import type { Decor } from '../sim/build';
import { rules } from '../sim/rules';
import { cargoDef } from '../sim/cargo';
import { decorDef, decorOffset } from '../sim/build';
import type { Editor } from '../editor/editor';
import type { Terrain } from '../world/tiles';

const OK_TINT = 0x9be8ff;
const BAD_TINT = 0xff6a5a;
const REPLACE_TINT = 0xffc860;

/** Interactive placement: ghost previews, rotation, drag-laying, removal, selection. */
export class BuildController {
  tool: Tool = { kind: 'none' };
  rot = 0;
  private ghost: Sprite | null = null;
  private ghostDiamond: Sprite;
  private lineGhosts: Sprite[] = [];
  private reachGhosts: Sprite[] = [];
  /** reach (Chebyshev tiles) highlighted around the cursor while placing; 0 = none */
  reach = 0;
  private dragStart: { x: number; y: number } | null = null;
  private selectSprite: Sprite;
  selected: Station | null = null;
  onSelect: ((s: Station | null) => void) | null = null;
  onStatus: ((text: string) => void) | null = null;
  onToolChanged: ((t: Tool) => void) | null = null;
  hoverStation: Station | null = null;
  hoverBuilding: Building | null = null;
  selectedBuilding: Building | null = null;
  onSelectBuilding: ((b: Building | null) => void) | null = null;
  selectedDecor: Decor | null = null;
  onSelectDecor: ((d: Decor | null) => void) | null = null;
  /** a town station was just placed: the game asks for its name */
  onTownPlaced: ((s: Station) => void) | null = null;
  /** set in editor mode */
  editor: Editor | null = null;
  private lastPaint = '';

  constructor(
    private readonly input: Input,
    private readonly builder: Builder,
    private readonly world: WorldRenderer,
    private readonly tileUnderMouse: () => { x: number; y: number },
  ) {
    this.ghostDiamond = world.makeOverlaySprite('terrain/ghost_ok');
    this.ghostDiamond.visible = false;
    this.selectSprite = world.makeOverlaySprite('terrain/select');
    this.selectSprite.visible = false;
  }

  setTool(t: Tool) {
    this.tool = t;
    this.rot = 0;
    this.dragStart = null;
    this.clearGhost();
    if (t.kind !== 'none') this.select(null);
    this.onToolChanged?.(t);
  }

  select(s: Station | null) {
    if (s) this.selectBuilding(null);
    this.selected = s;
    this.selectSprite.visible = !!s;
    if (s) {
      const p = this.world.surfacePoint(s.x, s.y);
      this.selectSprite.position.set(p.x, p.y);
    }
    this.onSelect?.(s);
  }

  private clearGhost() {
    for (const g of this.reachGhosts) g.visible = false;
    if (this.ghost) {
      this.ghost.destroy();
      this.ghost = null;
    }
    for (const g of this.lineGhosts) g.destroy();
    this.lineGhosts = [];
    this.ghostDiamond.visible = false;
  }

  /** Called every frame while the RTS view is active and the pointer is not over UI. */
  update(active: boolean) {
    const inp = this.input;
    const t = this.tileUnderMouse();
    const inMap = inBounds(this.builder.map, t.x, t.y);
    this.hoverStation = inMap ? (this.builder.stationAt(t.x, t.y) ?? null) : null;
    this.hoverBuilding = inMap ? (this.builder.buildingAt(t.x, t.y) ?? null) : null;
    if (inp.wasPressed('Escape')) {
      if (this.tool.kind !== 'none') this.setTool({ kind: 'none' });
      else this.select(null);
    }
    if (inp.wasPressed('KeyR')) {
      if (this.tool.kind === 'track')
        this.rot = (this.rot + 1) % rotationCount(this.tool.item.kind);
      else if (this.tool.kind === 'decor')
        this.rot = (this.rot + 1) % decorDef(this.tool.defId).rotations;
      else if (this.tool.kind === 'station' && (stationDef(this.tool.defId).size ?? 1) > 1)
        this.rot = (this.rot + 1) % 2;
    }
    if (inp.wasPressed('Delete') && inMap && active) this.removeAt(t.x, t.y);
    if (!active) {
      this.clearGhostVisibility(false);
      return;
    }
    this.clearGhostVisibility(true);
    // right click: remove if something is there, else cancel the tool
    for (const c of inp.clicks) {
      if (c.button === 2) {
        const ct = this.tileUnderMouse();
        if (!this.removeAt(ct.x, ct.y) && this.tool.kind !== 'none') this.setTool({ kind: 'none' });
        else if (this.tool.kind === 'none') this.select(null);
      }
    }
    switch (this.tool.kind) {
      case 'track':
        this.updateTrackTool(t, inMap);
        break;
      case 'station':
        this.updateStationTool(t, inMap);
        break;
      case 'supply':
        this.updateSupplyTool(t, inMap);
        break;
      case 'decor':
        this.updateDecorTool(t, inMap);
        break;
      case 'building':
        this.updateBuildingTool(t, inMap);
        break;
      case 'remove':
        this.updateRemoveTool(t, inMap);
        break;
      case 'terrain':
        this.updateTerrainTool(t, inMap);
        break;
      default:
        this.updateSelectTool(t, inMap);
    }
  }

  private clearGhostVisibility(v: boolean) {
    if (!v) {
      if (this.ghost) this.ghost.visible = false;
      this.ghostDiamond.visible = false;
      for (const g of this.lineGhosts) g.visible = false;
      for (const g of this.reachGhosts) g.visible = false;
    }
  }
  /** Faint diamonds on every tile within `r` of the cursor (what a service or pole would cover). */
  private showReach(t: { x: number; y: number }, r: number) {
    const need = r > 0 ? (2 * r + 1) * (2 * r + 1) - 1 : 0;
    while (this.reachGhosts.length < need) {
      const g = this.world.makeOverlaySprite('terrain/select');
      g.alpha = 0.35;
      this.reachGhosts.push(g);
    }
    let k = 0;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (!dx && !dy) continue;
        const g = this.reachGhosts[k++];
        const x = t.x + dx;
        const y = t.y + dy;
        if (!inBounds(this.builder.map, x, y)) {
          g.visible = false;
          continue;
        }
        const p = this.world.surfacePoint(x, y);
        g.position.set(p.x, p.y);
        g.visible = true;
      }
    for (; k < this.reachGhosts.length; k++) this.reachGhosts[k].visible = false;
  }

  private ensureGhost(frame: string): Sprite {
    if (!this.ghost) {
      this.ghost = this.world.makeOverlaySprite(frame);
      this.ghost.alpha = 0.75;
    } else this.world.setSpriteFrame(this.ghost, frame);
    this.ghost.visible = true;
    return this.ghost;
  }

  private placeGhostAt(g: Sprite, x: number, y: number, ok: boolean) {
    const p = this.world.surfacePoint(x, y);
    g.position.set(p.x, p.y);
    g.tint = ok ? OK_TINT : BAD_TINT;
    g.visible = true;
  }

  private updateTrackTool(t: { x: number; y: number }, inMap: boolean) {
    const tool = this.tool as { kind: 'track'; item: TrackItem };
    const item = tool.item;
    const inp = this.input;
    // drag-laying straights
    if (item.kind === 'straight' || item.kind === 'bridge') {
      if (inp.buttonPressed.has(0) && inMap) this.dragStart = { x: t.x, y: t.y };
      if (this.dragStart && inp.buttons.has(0)) {
        const line = this.lineTiles(this.dragStart, t);
        this.showLineGhosts(line, item);
        this.status(
          line.length > 1
            ? `${line.length} x ${item.kind}: ${fmtCost(this.lineCost(line, item))}`
            : this.pieceStatus(t, item),
        );
        return;
      }
      if (this.dragStart && inp.buttonReleased.has(0)) {
        const line = this.lineTiles(this.dragStart, t);
        this.dragStart = null;
        for (const g of this.lineGhosts) g.destroy();
        this.lineGhosts = [];
        if (line.length === 1) this.builder.placeTrack(t.x, t.y, item, this.rot);
        else for (const l of line) this.builder.placeTrack(l.x, l.y, item, l.rot);
        return;
      }
    } else {
      for (const c of inp.clicks)
        if (c.button === 0 && inMap) this.builder.placeTrack(t.x, t.y, item, this.rot);
    }
    if (!inMap) {
      if (this.ghost) this.ghost.visible = false;
      this.ghostDiamond.visible = false;
      for (const g of this.lineGhosts) g.visible = false;
      return;
    }
    const check = this.builder.checkTrack(t.x, t.y, item, this.rot);
    const key = itemKey(item);
    if (isUnitKind(item.kind, item.cls)) {
      // one ghost per footprint tile
      if (this.ghost) this.ghost.visible = false;
      const tiles = footprintOf(t.x, t.y, item.kind, this.rot, item.cls);
      this.showGhosts(
        tiles.map((f, i) => ({ x: f.x, y: f.y, frame: `track/${key}_${this.rot}_m${i}` })),
        check.ok,
      );
    } else {
      for (const g of this.lineGhosts) g.visible = false;
      const g = this.ensureGhost(`track/${key}_${this.rot}`);
      this.placeGhostAt(g, t.x, t.y, check.ok);
      const existing = this.builder.track.get(t.x, t.y);
      if (check.ok && existing) g.tint = REPLACE_TINT;
    }
    this.world.setSpriteFrame(
      this.ghostDiamond,
      check.ok ? 'terrain/ghost_ok' : 'terrain/ghost_bad',
    );
    this.placeGhostAt(this.ghostDiamond, t.x, t.y, true);
    this.ghostDiamond.tint = 0xffffff;
    this.status(this.pieceStatus(t, item));
  }

  private pieceStatus(t: { x: number; y: number }, item: TrackItem) {
    const check = this.builder.checkTrack(t.x, t.y, item, this.rot);
    const existing = this.builder.track.get(t.x, t.y);
    const replacing = !!existing && check.ok;
    const parts = [
      check.ok
        ? replacing
          ? STR.build.replace(existing!.kind, fmtCost(check.cost))
          : STR.build.cost(fmtCost(check.cost))
        : (check.reason ?? ''),
      STR.build.rotate,
    ];
    if (item.kind === 'straight' || item.kind === 'bridge') parts.push(STR.build.dragHint);
    return parts.filter(Boolean).join('   ');
  }

  /** Ghost sprites for several tiles at once (wide pieces, drag lines). */
  private showGhosts(list: { x: number; y: number; frame: string; ok?: boolean }[], ok: boolean) {
    this.ghostDiamond.visible = false;
    while (this.lineGhosts.length < list.length) {
      const g = this.world.makeOverlaySprite(list[0].frame);
      g.alpha = 0.75;
      this.lineGhosts.push(g);
    }
    for (let i = 0; i < this.lineGhosts.length; i++) {
      const g = this.lineGhosts[i];
      if (i >= list.length) {
        g.visible = false;
        continue;
      }
      const l = list[i];
      this.world.setSpriteFrame(g, l.frame);
      this.placeGhostAt(g, l.x, l.y, l.ok ?? ok);
    }
  }

  private lineTiles(a: { x: number; y: number }, b: { x: number; y: number }) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const out: { x: number; y: number; rot: number }[] = [];
    if (Math.abs(dx) >= Math.abs(dy)) {
      const s = Math.sign(dx) || 1;
      for (let i = 0; i <= Math.abs(dx); i++) out.push({ x: a.x + i * s, y: a.y, rot: 1 });
    } else {
      const s = Math.sign(dy) || 1;
      for (let i = 0; i <= Math.abs(dy); i++) out.push({ x: a.x, y: a.y + i * s, rot: 0 });
    }
    return out;
  }

  private lineCost(line: { x: number; y: number; rot: number }[], item: TrackItem) {
    const c: Record<string, number> = {};
    for (const l of line) {
      const ch = this.builder.checkTrack(l.x, l.y, item, l.rot);
      if (ch.ok) for (const [k, v] of Object.entries(ch.cost)) c[k] = (c[k] ?? 0) + v;
    }
    return c;
  }

  private showLineGhosts(line: { x: number; y: number; rot: number }[], item: TrackItem) {
    if (this.ghost) this.ghost.visible = false;
    const key = itemKey(item);
    this.showGhosts(
      line.map((l) => ({
        x: l.x,
        y: l.y,
        frame: `track/${key}_${l.rot}`,
        ok: this.builder.checkTrack(l.x, l.y, item, l.rot).ok,
      })),
      true,
    );
  }

  private updateStationTool(t: { x: number; y: number }, inMap: boolean) {
    const tool = this.tool as { kind: 'station'; defId: string };
    if (!inMap) {
      if (this.ghost) this.ghost.visible = false;
      this.ghostDiamond.visible = false;
      return;
    }
    const check = this.builder.checkStation(t.x, t.y, tool.defId);
    const def = stationDef(tool.defId);
    const size = def.size ?? 1;
    const fam = size > 1 ? `structures/${def.art}_r${this.rot % 2}` : `structures/${def.art}_1`;
    const g = this.ensureGhost(this.world.atlas.has(fam) ? fam : 'structures/station_1');
    // a two-tile sprite is anchored at its footprint centre
    this.placeGhostAt(g, t.x + (size - 1) / 2, t.y + (size - 1) / 2, check.ok);
    this.world.setSpriteFrame(
      this.ghostDiamond,
      check.ok ? 'terrain/ghost_ok' : 'terrain/ghost_bad',
    );
    this.placeGhostAt(this.ghostDiamond, t.x, t.y, true);
    this.ghostDiamond.tint = 0xffffff;
    this.ghostDiamond.visible = size === 1;
    const parts = [check.ok ? STR.build.cost(fmtCost(check.cost)) : (check.reason ?? '')];
    if (size > 1) parts.push(STR.build.rotate);
    if (def.terrain) {
      const f = this.builder.harvestFactor(t.x, t.y, tool.defId);
      const perWeek = LEVELS.production[0] * rules.productionMul * f * 7;
      const cargo = def.produces[0]?.cargo;
      parts.push(STR.build.harvest(Math.round(perWeek), cargo ? cargoDef(cargo).name : '', f));
    }
    this.status(parts.join('   '));
    for (const c of this.input.clicks) {
      if (c.button === 0) {
        const s = this.builder.placeStation(t.x, t.y, tool.defId, this.rot);
        if (s) {
          this.setTool({ kind: 'none' });
          this.select(s);
          if (s.def.id === 'town') this.onTownPlaced?.(s);
        }
      }
    }
  }

  /** Electrification: drag along a line of track; tiles without track are skipped. */
  private updateSupplyTool(t: { x: number; y: number }, inMap: boolean) {
    const tool = this.tool as { kind: 'supply'; supply: SupplyKind };
    const inp = this.input;
    const frameOf = (x: number, y: number) => {
      const p = this.builder.track.get(x, y);
      const links = p?.links ?? [];
      const ns = links.some((l) => l.includes(0) && l.includes(2));
      const ew = links.some((l) => l.includes(1) && l.includes(3));
      return `structures/supply_${tool.supply}_${ns && !ew ? 'ns' : ew && !ns ? 'ew' : 'x'}`;
    };
    if (inp.buttonPressed.has(0) && inMap) this.dragStart = { x: t.x, y: t.y };
    if (this.dragStart && inp.buttons.has(0)) {
      const line = this.lineTiles(this.dragStart, t).filter((l) =>
        this.builder.track.has(l.x, l.y),
      );
      this.showGhosts(
        line.map((l) => ({
          x: l.x,
          y: l.y,
          frame: frameOf(l.x, l.y),
          ok: this.builder.checkSupply(l.x, l.y, tool.supply).ok,
        })),
        true,
      );
      const cost: Record<string, number> = {};
      for (const l of line) {
        const ch = this.builder.checkSupply(l.x, l.y, tool.supply);
        if (ch.ok) for (const [k, v] of Object.entries(ch.cost)) cost[k] = (cost[k] ?? 0) + v;
      }
      this.status(`${line.length} x ${STR.toolbar.supply[tool.supply]}: ${fmtCost(cost)}`);
      return;
    }
    if (this.dragStart && inp.buttonReleased.has(0)) {
      const line = this.lineTiles(this.dragStart, t);
      this.dragStart = null;
      for (const g of this.lineGhosts) g.destroy();
      this.lineGhosts = [];
      for (const l of line) this.builder.placeSupply(l.x, l.y, tool.supply);
      return;
    }
    if (!inMap) {
      if (this.ghost) this.ghost.visible = false;
      this.ghostDiamond.visible = false;
      return;
    }
    const check = this.builder.checkSupply(t.x, t.y, tool.supply);
    const g = this.ensureGhost(frameOf(t.x, t.y));
    this.placeGhostAt(g, t.x, t.y, check.ok);
    this.world.setSpriteFrame(
      this.ghostDiamond,
      check.ok ? 'terrain/ghost_ok' : 'terrain/ghost_bad',
    );
    this.placeGhostAt(this.ghostDiamond, t.x, t.y, true);
    this.ghostDiamond.tint = 0xffffff;
    this.status(
      [
        check.ok ? STR.build.cost(fmtCost(check.cost)) : (check.reason ?? ''),
        STR.build.dragHint,
      ].join('   '),
    );
  }

  private updateDecorTool(t: { x: number; y: number }, inMap: boolean) {
    const tool = this.tool as { kind: 'decor'; defId: string };
    if (!inMap) {
      if (this.ghost) this.ghost.visible = false;
      this.ghostDiamond.visible = false;
      return;
    }
    const def = decorDef(tool.defId);
    this.showReach(t, def.power ? 2 : (def.radius ?? 0));
    const check = this.builder.checkDecor(t.x, t.y, tool.defId);
    const g = this.ensureGhost(def.id === 'signal' ? 'structures/signal' : `structures/${def.id}`);
    this.placeGhostAt(g, t.x, t.y, check.ok);
    const off = decorOffset({ id: def.id, rot: this.rot });
    g.position.set(g.position.x + off.dx, g.position.y + off.dy);
    this.world.setSpriteFrame(
      this.ghostDiamond,
      check.ok ? 'terrain/ghost_ok' : 'terrain/ghost_bad',
    );
    this.placeGhostAt(this.ghostDiamond, t.x, t.y, true);
    this.ghostDiamond.tint = 0xffffff;
    const parts = [check.ok ? STR.build.cost(fmtCost(check.cost)) : (check.reason ?? '')];
    if (def.rotations > 1) parts.push(STR.build.rotate);
    this.status(parts.join('   '));
    for (const c of this.input.clicks)
      if (c.button === 0) this.builder.placeDecor(t.x, t.y, tool.defId, this.rot);
  }

  private updateBuildingTool(t: { x: number; y: number }, inMap: boolean) {
    const tool = this.tool as { kind: 'building'; defId: string };
    if (!inMap) {
      if (this.ghost) this.ghost.visible = false;
      this.ghostDiamond.visible = false;
      return;
    }
    const def = buildingDef(tool.defId);
    this.showReach(t, def.power ? 2 : 0);
    const check = this.builder.checkBuilding(t.x, t.y, tool.defId);
    const g = this.ensureGhost(`structures/${def.id}`);
    this.placeGhostAt(g, t.x, t.y, check.ok);
    this.world.setSpriteFrame(
      this.ghostDiamond,
      check.ok ? 'terrain/ghost_ok' : 'terrain/ghost_bad',
    );
    this.placeGhostAt(this.ghostDiamond, t.x, t.y, true);
    this.ghostDiamond.tint = 0xffffff;
    this.status(check.ok ? STR.build.cost(fmtCost(check.cost)) : (check.reason ?? ''));
    for (const c of this.input.clicks)
      if (c.button === 0) this.builder.placeBuilding(t.x, t.y, tool.defId);
  }

  private updateRemoveTool(t: { x: number; y: number }, inMap: boolean) {
    if (this.ghost) this.ghost.visible = false;
    if (!inMap) {
      this.ghostDiamond.visible = false;
      return;
    }
    const piece = this.builder.track.get(t.x, t.y);
    const st = this.builder.stationAt(t.x, t.y);
    this.world.setSpriteFrame(this.ghostDiamond, 'terrain/ghost_bad');
    this.placeGhostAt(this.ghostDiamond, t.x, t.y, true);
    this.ghostDiamond.tint = 0xffffff;
    const dec = this.builder.decorAt(t.x, t.y);
    const bld = this.builder.buildingAt(t.x, t.y);
    const refund = st
      ? scaleCost(st.def.cost, 0.5)
      : bld
        ? this.builder.buildingRefund(bld)
        : dec
          ? this.builder.decorRefund(dec)
          : piece
            ? this.builder.refundFor(piece)
            : {};
    this.status(Object.keys(refund).length ? STR.build.refund(fmtCost(refund)) : '');
    for (const c of this.input.clicks) if (c.button === 0) this.removeAt(t.x, t.y);
  }

  private updateTerrainTool(t: { x: number; y: number }, inMap: boolean) {
    const tool = this.tool as { kind: 'terrain'; terrain: Terrain };
    if (this.ghost) this.ghost.visible = false;
    this.ghostDiamond.visible = false;
    if (!inMap || !this.editor) {
      for (const g of this.lineGhosts) g.visible = false;
      return;
    }
    const tiles = this.editor.footprint(t.x, t.y);
    while (this.lineGhosts.length < tiles.length) {
      const g = this.world.makeOverlaySprite('terrain/ghost_ok');
      g.alpha = 0.8;
      this.lineGhosts.push(g);
    }
    for (let i = 0; i < this.lineGhosts.length; i++) {
      const g = this.lineGhosts[i];
      if (i >= tiles.length) {
        g.visible = false;
        continue;
      }
      this.world.setSpriteFrame(g, 'terrain/ghost_ok');
      this.placeGhostAt(g, tiles[i].x, tiles[i].y, true);
      g.tint = 0xffffff;
    }
    this.status(STR.editor.brushHint);
    if (this.input.buttons.has(0)) {
      const key = `${t.x},${t.y},${tool.terrain},${this.editor.brushSize}`;
      if (key !== this.lastPaint) {
        this.lastPaint = key;
        this.editor.paint(t.x, t.y, tool.terrain);
      }
    } else this.lastPaint = '';
  }

  private updateSelectTool(t: { x: number; y: number }, inMap: boolean) {
    if (this.ghost) this.ghost.visible = false;
    this.ghostDiamond.visible = false;
    this.status('');
    for (const c of this.input.clicks) {
      if (c.button === 0 && inMap) {
        const st = this.builder.stationAt(t.x, t.y);
        const bld = st ? null : (this.builder.buildingAt(t.x, t.y) ?? null);
        const dec = st || bld ? null : (this.builder.decorAt(t.x, t.y) ?? null);
        this.select(st ?? null);
        this.selectBuilding(bld);
        this.selectDecor(dec);
      }
    }
  }
  selectBuilding(b: Building | null) {
    if (this.selectedBuilding === b) return;
    this.selectedBuilding = b;
    this.onSelectBuilding?.(b);
  }
  selectDecor(d: Decor | null) {
    if (this.selectedDecor === d) return;
    this.selectedDecor = d;
    this.onSelectDecor?.(d);
  }

  removeAt(x: number, y: number): boolean {
    const st = this.builder.stationAt(x, y);
    if (st) {
      if (this.selected === st) this.select(null);
      return this.builder.removeStation(st);
    }
    const bld = this.builder.buildingAt(x, y);
    if (bld) {
      if (this.selectedBuilding === bld) this.selectBuilding(null);
      return this.builder.removeBuilding(x, y);
    }
    const dec = this.builder.decorAt(x, y);
    if (dec) {
      if (this.selectedDecor === dec) this.selectDecor(null);
      return this.builder.removeDecor(x, y);
    }
    return this.builder.removeTrack(x, y);
  }

  private status(s: string) {
    this.onStatus?.(s);
  }
}
