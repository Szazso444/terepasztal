import type { WideClass } from '../world/reclass';
import { ReclassStroke } from './reclassStroke';
import { layRun, planRun, type RunPlan, type RunStep } from './autoCrossing';
import type { Sprite } from 'pixi.js';
import type { Input } from '../engine/input';
import { itemKey, footprintOf, isUnitKind, type TrackItem } from '../world/track';
import type { SupplyKind } from '../sim/catenary';
import { inBounds } from '../world/tiles';
import type { Builder } from '../sim/build';
import type { WorldRenderer } from '../render/worldRenderer';
import type { Station } from '../sim/stations';
import type { Tool } from './toolbar';
import { STR } from '../strings';
import { fmtCost, scaleCost } from '../sim/stockpile';
import { buildingDef, type Building } from '../sim/buildings';
import { stationSpan, stationDef } from '../sim/stations';
import type { Decor } from '../sim/build';
import { decorDef, decorOffset } from '../sim/build';
import type { Editor } from '../editor/editor';
import type { Terrain } from '../world/tiles';
import { structureFrame } from '../art/frames';
import { HALF_H } from '../engine/iso';
import { rules } from '../sim/rules';
import { HarvestCells, harvestBreakdown, weeklyOutput } from '../sim/stations';
import type { Season } from '../sim/weather';
import { nextToolRotation, stationGhostFrame, toolRotations } from './toolRotation';
import { placingTip, yieldLabel } from './placingTooltip';
import type { TipDoc } from './tooltipDoc';
import { tipKey, type Point, type TooltipStack } from './tooltipStack';
import {
  builderJudge,
  hoverStatus,
  judgeStroke,
  strokeStatus,
  strokeTiles,
  type RoadStep,
  type RoadStrokeCheck,
} from './roadStroke';
import { doorReachTiles } from './roadDoors';

const OK_TINT = 0x9be8ff;
const BAD_TINT = 0xff6a5a;
const REPLACE_TINT = 0xffc860;
/** the road tool's mark on a street door's reach tile: not the stroke's cyan or red */
const DOOR_TINT = 0xfff08a;
/** frames between two looks at the street doors while the road tool is in hand (#409) */
const DOOR_MARK_FRAMES = 30;

type Tile = { x: number; y: number };

/**
 * Where a harvest station's tool shows what it would make (#336): the placing tooltip as the root
 * of the tooltip stack, and the yield label over the tile. createPlayUi sets it; without it the
 * tool shows neither. `C` is what the stack draws, opaque here.
 */
export interface PlacingOut<C = unknown> {
  readonly stack: TooltipStack<C>;
  /** what the stack shows for a tooltip document */
  content(doc: TipDoc): C;
  /** the label's text over the screen point of a tile's top corner; null hides it */
  label(text: string | null, corner: Point | null): void;
  /** the season the yield is worked out for: the one production runs in */
  season(): Season;
}

/** Interactive placement: ghost previews, rotation, drag-laying, removal, selection. */
export class BuildController {
  tool: Tool = { kind: 'none' };
  rot = 0;
  private ghost: Sprite | null = null;
  private ghostDiamond: Sprite;
  private lineGhosts: Sprite[] = [];
  private reachGhosts: Sprite[] = [];
  /** the road tool's marks, one per distinct street-door reach tile; apart from `lineGhosts` */
  private doorMarks: Sprite[] = [];
  /** the reach tiles `doorMarks` stand on, as of the last look at the doors */
  private doorTiles: Tile[] = [];
  /** what the last look at the doors saw (counts of places) and how many frames ago it was */
  private doorSeen = '';
  private doorAge = 0;
  /** reach (Chebyshev tiles) highlighted around the cursor while placing; 0 = none */
  reach = 0;
  private dragStart: { x: number; y: number } | null = null;
  private selectSprite: Sprite;
  selected: Station | null = null;
  onSelect: ((s: Station | null) => void) | null = null;
  onStatus: ((text: string) => void) | null = null;
  onToolChanged: ((t: Tool) => void) | null = null;
  /** Upgrade / Downgrade: the stroke under way while the button is held */
  private stroke = new ReclassStroke();
  /** how many trains may not run on high-speed track, for the Upgrade tool's status line */
  barredTrains: (() => { barred: number; total: number }) | null = null;
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
  /** this frame's Escape closed the tooltip stack (the keymap reads it first): it does nothing here */
  private escapeSpent = false;
  /** the placing tooltip and the yield label's way out, set by createPlayUi */
  placing: PlacingOut | null = null;
  /** the tile the placing root stands for, as of the last frame it was not locked */
  private placingRoot: (Tile & { key: string }) | null = null;
  /** the tile of a locked placing root: its label and lit tiles stay there */
  private placingHeld: Tile | null = null;
  /** the counted tiles of the label's breakdown, kept from frame to frame */
  private readonly placingCells = new HarvestCells();

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
    // the same shape in another type (Q / E) keeps its turn
    const sameShape =
      this.tool.kind === 'track' && t.kind === 'track' && this.tool.item.kind === t.item.kind;
    this.tool = t;
    if (!sameShape) this.rot = 0;
    this.stroke.stop();
    this.dragStart = null;
    this.clearGhost();
    this.dropPlacing();
    if (t.kind !== 'none') this.select(null);
    this.onToolChanged?.(t);
  }

  /**
   * The tile the tool in hand places on, for the harvest layer (`HarvestHighlight.follow`'s
   * `placing`): a locked placing tooltip's tile, else `hover`.
   */
  placingAt(hover: Tile | null): Tile | null {
    return this.placingHeld ?? hover;
  }

  /** This frame's Escape is spent: it closed the tooltips, so the tool and the selection stay. */
  takeEscape() {
    this.escapeSpent = true;
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
    for (const g of this.doorMarks) g.visible = false;
    this.doorSeen = '';
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
    const escape = inp.wasPressed('Escape') && !this.escapeSpent;
    this.escapeSpent = false;
    if (escape) {
      if (this.tool.kind !== 'none') this.setTool({ kind: 'none' });
      else this.select(null);
    }
    // track, decor, stations and works turn; anything else keeps its rotation
    if (inp.wasPressed('KeyR') && this.turns()) this.rot = nextToolRotation(this.tool, this.rot);
    if (inp.wasPressed('Delete') && inMap && active) this.removeAt(t.x, t.y);
    this.updatePlacing(active, t, inMap);
    if (!active) {
      // over a panel or outside the field: a stroke does not carry on to where the cursor returns
      this.stroke.stop();
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
      case 'reclass':
        this.updateReclassTool(t, inMap);
        break;
      case 'road':
        this.updateRoadTool(t, inMap);
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
      for (const g of this.doorMarks) g.visible = false;
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
        const line = this.runTiles(this.dragStart, t);
        const plan = planRun(this.builder, line, item);
        this.showRunGhosts(plan);
        this.status(
          line.length > 1 ? this.runStatus(plan, item) : this.pieceStatus(t, item, plan.steps[0]),
        );
        return;
      }
      if (this.dragStart && inp.buttonReleased.has(0)) {
        const line = this.runTiles(this.dragStart, t);
        this.dragStart = null;
        for (const g of this.lineGhosts) g.destroy();
        this.lineGhosts = [];
        layRun(this.builder, planRun(this.builder, line, item));
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
    // a straight over a line across it previews the crossing it would lay there
    const step =
      item.kind === 'straight'
        ? planRun(this.builder, [{ ...t, rot: this.rot }], item).steps[0]
        : null;
    const shown = step?.crossing ? step.item : item,
      rot = step?.crossing ? step.rot : this.rot;
    const check = step ?? this.builder.checkTrack(t.x, t.y, item, this.rot);
    const key = itemKey(shown);
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
      const g = this.ensureGhost(`track/${key}_${rot}`);
      this.placeGhostAt(g, t.x, t.y, check.ok);
      const existing = this.builder.track.get(t.x, t.y);
      if (check.ok && existing && !step?.stands) g.tint = REPLACE_TINT;
    }
    this.world.setSpriteFrame(
      this.ghostDiamond,
      check.ok ? 'terrain/ghost_ok' : 'terrain/ghost_bad',
    );
    this.placeGhostAt(this.ghostDiamond, t.x, t.y, true);
    this.ghostDiamond.tint = 0xffffff;
    this.status(this.pieceStatus(t, item, step ?? undefined));
  }

  /** The status line for one piece; `step` is a straight's tile as a run would lay it. */
  private pieceStatus(t: { x: number; y: number }, item: TrackItem, step?: RunStep) {
    const check = step ?? this.builder.checkTrack(t.x, t.y, item, this.rot);
    const existing = this.builder.track.get(t.x, t.y);
    const replacing = !!existing && check.ok && !step?.crossing;
    const parts = [
      check.ok
        ? replacing
          ? STR.build.replace(existing!.kind, fmtCost(check.cost))
          : STR.build.cost(fmtCost(check.cost))
        : (check.reason ?? ''),
      step?.crossing && check.ok ? STR.build.autoCrossings(1) : '',
      STR.build.rotate,
    ];
    if (item.kind === 'straight' || item.kind === 'bridge') parts.push(STR.build.dragHint);
    return parts.filter(Boolean).join('   ');
  }

  /** Ghost sprites for several tiles at once (wide pieces, drag lines). */
  private showGhosts(
    list: { x: number; y: number; frame: string; ok?: boolean; tint?: number }[],
    ok: boolean,
  ) {
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
      if (l.tint !== undefined && (l.ok ?? ok)) g.tint = l.tint;
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

  /** The tiles a drag lays from `a` to `b`; a press released where it started is one piece at the tool's turn. */
  private runTiles(a: { x: number; y: number }, b: { x: number; y: number }) {
    const line = this.lineTiles(a, b);
    return line.length === 1 ? [{ x: b.x, y: b.y, rot: this.rot }] : line;
  }

  /** A run's status: its pieces and price, the crossings it lays by itself, and where it stops. */
  private runStatus(plan: RunPlan, item: TrackItem) {
    const parts = [`${plan.end} x ${item.kind}: ${fmtCost(plan.cost)}`];
    if (plan.crossings) parts.push(STR.build.autoCrossings(plan.crossings));
    if (plan.reason) parts.push(plan.reason);
    return parts.join('   ');
  }

  /** A run's ghosts: red where a tile is refused and from where the run stops, amber on its crossings. */
  private showRunGhosts(plan: RunPlan) {
    if (this.ghost) this.ghost.visible = false;
    this.showGhosts(
      plan.steps.map((s, i) => ({
        x: s.x,
        y: s.y,
        frame: `track/${itemKey(s.item)}_${s.rot}`,
        ok: s.ok && i < plan.end,
        tint: s.crossing && !s.stands ? REPLACE_TINT : undefined,
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
    const check = this.builder.checkStation(t.x, t.y, tool.defId, this.rot);
    const def = stationDef(tool.defId);
    const g = this.ensureGhost(stationGhostFrame(this.world.atlas, def, this.rot));
    // a sprite of more than one tile is anchored at its footprint centre
    const span = stationSpan(def, this.rot);
    this.placeGhostAt(g, t.x + (span.w - 1) / 2, t.y + (span.h - 1) / 2, check.ok);
    this.world.setSpriteFrame(
      this.ghostDiamond,
      check.ok ? 'terrain/ghost_ok' : 'terrain/ghost_bad',
    );
    this.placeGhostAt(this.ghostDiamond, t.x, t.y, true);
    this.ghostDiamond.tint = 0xffffff;
    // the tile diamond shows under a one-tile station only; a wider one's picture covers its tiles
    this.ghostDiamond.visible = span.w === 1 && span.h === 1;
    // what a harvest station would make is the placing tooltip's (updatePlacing), not the line's
    const parts = [check.ok ? STR.build.cost(fmtCost(check.cost)) : (check.reason ?? '')];
    if (this.turns()) parts.push(STR.build.rotate);
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
    const g = this.ensureGhost(structureFrame(this.world.atlas, `structures/${def.id}`, this.rot));
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
    if (this.turns()) parts.push(STR.build.rotate);
    if (def.id === 'signal')
      parts.push(STR.signals.governsTravel(STR.signals.directions[this.rot]));
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
    // a bridge platform does not turn: it stays at rotation 0
    const rot = this.turns() ? this.rot : 0;
    const check = this.builder.checkBuilding(t.x, t.y, tool.defId, rot);
    const g = this.ensureGhost(structureFrame(this.world.atlas, `structures/${def.id}`, rot));
    this.placeGhostAt(g, t.x, t.y, check.ok);
    this.world.setSpriteFrame(
      this.ghostDiamond,
      check.ok ? 'terrain/ghost_ok' : 'terrain/ghost_bad',
    );
    this.placeGhostAt(this.ghostDiamond, t.x, t.y, true);
    this.ghostDiamond.tint = 0xffffff;
    const parts = [check.ok ? STR.build.cost(fmtCost(check.cost)) : (check.reason ?? '')];
    if (this.turns()) parts.push(STR.build.rotate);
    this.status(parts.join('   '));
    for (const c of this.input.clicks)
      if (c.button === 0) this.builder.placeBuilding(t.x, t.y, tool.defId, rot);
  }

  /** Whether R turns the tool in hand. */
  private turns() {
    return toolRotations(this.tool) > 1;
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
    // a bridge platform loses its rail or its road first, as removeAt does
    const bridge = !!bld && !!buildingDef(bld.id).bridge;
    const bridgeRail = bridge && !!piece;
    const bridgeRoad = bridge && !bridgeRail && this.builder.roads.has(t.x, t.y);
    // what removeAt takes off the tile first
    const refund = st
      ? scaleCost(st.def.cost, 0.5)
      : bld
        ? bridgeRoad
          ? this.builder.roadRefund()
          : bridgeRail
            ? this.builder.refundFor(piece!)
            : this.builder.buildingRefund(bld)
        : dec
          ? this.builder.decorRefund(dec)
          : this.builder.roads.has(t.x, t.y)
            ? this.builder.roadRefund()
            : piece
              ? this.builder.refundFor(piece)
              : {};
    this.status(Object.keys(refund).length ? STR.build.refund(fmtCost(refund)) : '');
    for (const c of this.input.clicks) if (c.button === 0) this.removeAt(t.x, t.y);
  }

  /**
   * Roads (#328): press and drag a straight run, let go to lay it, tile by tile (`placeRoad`). The
   * drag shows the build preview's diamond on each tile, red where the release would not lay a
   * road, with the total cost and every reason a tile is refused in the status line. Before the
   * press the one tile under the cursor shows, priced or refused.
   */
  private updateRoadTool(t: Tile, inMap: boolean) {
    const inp = this.input;
    if (this.ghost) this.ghost.visible = false;
    this.ghostDiamond.visible = false;
    this.showDoorMarks();
    // a press starts a stroke on the map, none off it
    if (inp.buttonPressed.has(0)) this.dragStart = inMap ? { x: t.x, y: t.y } : null;
    if (this.dragStart && inp.buttons.has(0)) {
      const stroke = this.roadStroke(this.dragStart, t);
      this.showRoadMarks(stroke.steps);
      this.status(strokeStatus(stroke));
      return;
    }
    if (this.dragStart && inp.buttonReleased.has(0)) {
      const tiles = strokeTiles(this.dragStart, this.roadEnd(t));
      this.dragStart = null;
      for (const g of this.lineGhosts) g.visible = false;
      for (const r of tiles) this.builder.placeRoad(r.x, r.y);
      return;
    }
    // the button is up: a stroke whose release fell over a panel lays nothing, and is over
    this.dragStart = null;
    if (!inMap) {
      for (const g of this.lineGhosts) g.visible = false;
      this.status('');
      return;
    }
    const one = this.roadStroke(t, t);
    this.showRoadMarks(one.steps);
    this.status(hoverStatus(one.steps[0], !!this.builder.bridgeAt(t.x, t.y)));
  }

  /**
   * A faint marker on the reach tile of each street door, so the player sees where a road meets a
   * building. `streetDoors()` allocates, so the tiles are read again only when the tool was just
   * taken up, the number of stations, works or decor changed, or DOOR_MARK_FRAMES passed (a place
   * turned in place keeps its counts); the markers are the pool's own, never the stroke's.
   */
  private showDoorMarks() {
    const b = this.builder;
    const seen = `${b.stations.length},${b.buildings.size},${b.decor.size}`;
    if (seen !== this.doorSeen || ++this.doorAge >= DOOR_MARK_FRAMES) {
      this.doorSeen = seen;
      this.doorAge = 0;
      this.doorTiles = doorReachTiles(b.streetDoors(), (x, y) => inBounds(b.map, x, y));
    }
    while (this.doorMarks.length < this.doorTiles.length) {
      const g = this.world.makeOverlaySprite('terrain/select');
      g.alpha = 0.7;
      g.tint = DOOR_TINT;
      this.doorMarks.push(g);
    }
    this.doorMarks.forEach((g, i) => {
      const t = this.doorTiles[i];
      g.visible = !!t;
      if (!t) return;
      const p = this.world.surfacePoint(t.x, t.y);
      g.position.set(p.x, p.y);
    });
  }

  /**
   * The tile a road stroke ends on with the cursor on `t`: that tile, kept on the map. The one
   * place a stroke's end is decided.
   */
  private roadEnd(t: Tile): Tile {
    const { w, h } = this.builder.map;
    return { x: Math.max(0, Math.min(w - 1, t.x)), y: Math.max(0, Math.min(h - 1, t.y)) };
  }

  /** The road stroke from `start` to the cursor on `t`, judged as its release would lay it. */
  private roadStroke(start: Tile, t: Tile): RoadStrokeCheck {
    return judgeStroke(strokeTiles(start, this.roadEnd(t)), builderJudge(this.builder));
  }

  /** The build preview's tile diamond on each tile of a road stroke: red where it is refused. */
  private showRoadMarks(steps: readonly RoadStep[]) {
    this.showGhosts(
      steps.map((s) => ({
        x: s.x,
        y: s.y,
        frame: s.state === 'refused' ? 'terrain/ghost_bad' : 'terrain/ghost_ok',
      })),
      true,
    );
    // the frame carries the colour, as the one-tile diamond's does
    for (let i = 0; i < steps.length; i++) this.lineGhosts[i].tint = 0xffffff;
  }

  /**
   * Upgrade / Downgrade: convert the piece under the cursor on a press, and every tile the cursor
   * enters while the button stays down. Each step knows the tile it came from, so a crossing
   * converts the line the stroke runs along.
   */
  private updateReclassTool(t: { x: number; y: number }, inMap: boolean) {
    const tool = this.tool as { kind: 'reclass'; target: WideClass };
    const inp = this.input;
    const track = this.builder.track;
    if (this.ghost) this.ghost.visible = false;
    const isCrossing = (p: { x: number; y: number }) => track.get(p.x, p.y)?.kind === 'crossing';
    const convert = (
      steps: { tile: { x: number; y: number }; from?: { x: number; y: number } }[],
    ) => {
      for (const s of steps) this.builder.reclassTrack([s.tile], tool.target, s.from);
    };
    const down = inp.buttons.has(0);
    if (!down) convert(this.stroke.release());
    if (!inMap) {
      this.stroke.stop();
      this.ghostDiamond.visible = false;
      return;
    }
    if (down) convert(this.stroke.move(t, isCrossing));
    const upgrade = tool.target === 'high_speed';
    const what = upgrade ? STR.toolbar.upgrade : STR.toolbar.downgrade;
    // an upgrade bars every train without in-cab signalling from the line: say so before it is done
    const trains = upgrade ? this.barredTrains?.() : null;
    const warning = trains?.barred
      ? ` · ${STR.build.reclassBarred(trains.barred, trains.total)}`
      : '';
    const piece = track.get(t.x, t.y);
    if (!piece) {
      this.ghostDiamond.visible = false;
      this.status(STR.build.reclassIdle(what) + warning);
      return;
    }
    const from = down ? this.stroke.entry(t, piece.kind === 'crossing') : undefined;
    const check = this.builder.checkReclass([t], tool.target, from);
    // red only where something stops the conversion; track already converted is fine
    const fine = check.ok || check.reason === STR.build.reclass.nothing;
    this.world.setSpriteFrame(this.ghostDiamond, fine ? 'terrain/ghost_ok' : 'terrain/ghost_bad');
    this.placeGhostAt(this.ghostDiamond, t.x, t.y, true);
    this.ghostDiamond.tint = 0xffffff;
    this.status(
      (check.changes.length
        ? Object.keys(check.cost).length
          ? `${STR.build.reclassCost(what, fmtCost(check.cost))}${check.ok ? '' : ` (${check.reason})`}`
          : STR.build.reclassFree(what)
        : (check.reason ?? '')) + warning,
    );
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
    // a platform comes down only bare: its rail or its road comes off first, the next use takes it
    if (bld && buildingDef(bld.id).bridge && this.builder.track.has(x, y))
      return this.builder.removeTrack(x, y);
    if (bld && buildingDef(bld.id).bridge && this.builder.roads.has(x, y))
      return this.builder.removeRoad(x, y);
    if (bld) {
      if (this.selectedBuilding === bld) this.selectBuilding(null);
      return this.builder.removeBuilding(x, y);
    }
    const dec = this.builder.decorAt(x, y);
    if (dec) {
      if (this.selectedDecor === dec) this.selectDecor(null);
      return this.builder.removeDecor(x, y);
    }
    // a level crossing loses its road first, and stays plain track
    if (this.builder.roads.has(x, y)) return this.builder.removeRoad(x, y);
    return this.builder.removeTrack(x, y);
  }

  private status(s: string) {
    this.onStatus?.(s);
  }

  // ---------------------------------------------------------------- the placing tooltip (#336)

  /** The station kind of a harvest station's tool in hand (one with a `terrain`), else null. */
  private harvestTool(): string | null {
    const t = this.tool;
    return t.kind === 'station' && stationDef(t.defId).terrain ? t.defId : null;
  }

  /**
   * With a harvest station's tool in hand, the placing tooltip is the tooltip stack's root: for
   * the hovered tile, or for the tile it locked on, which keeps it while the pointer moves on. The
   * yield label floats over that tile where the station can stand. Over a panel or out of the
   * window the pointer has left the field: an open root closes and its label goes, a locked one
   * after its time. The game leaves the stack
   * alone while a tool is in hand (`Game.updateRtsTooltip`), and any other tool shows no root.
   */
  private updatePlacing(active: boolean, t: Tile, inMap: boolean) {
    const out = this.placing;
    const defId = this.harvestTool();
    this.placingHeld = null;
    if (!out || defId === null) {
      out?.label(null, null);
      return;
    }
    const inp = this.input;
    // as Game.hoverTip tells the stack where the pointer is: out of the window it has left the
    // field like over a panel, though the field stays active and its last place is still a tile
    const onField = active && inp.mouseInside;
    const here =
      onField && inMap
        ? {
            x: t.x,
            y: t.y,
            key: tipKey({ kind: 'tile', x: t.x, y: t.y, tool: `station:${defId}` }),
          }
        : null;
    const season = out.season();
    const build = (at: Tile) => () => out.content(this.placingDoc(at.x, at.y, defId, season));
    if (onField)
      out.stack.hover(
        here?.key ?? null,
        inp.mouseX,
        inp.mouseY,
        here ? build(here) : () => out.content([]),
      );
    else if (!inp.overTips) out.stack.leave();
    const root = out.stack.fieldRoot;
    const kept = this.placingRoot;
    if (kept && root === kept.key && out.stack.isLocked(0)) this.placingHeld = kept;
    else this.placingRoot = here;
    const at = this.placingHeld ? kept : here;
    if (!at) {
      out.label(null, null);
      return;
    }
    // what it says follows the funds, the season and the tuning, a few times a second
    out.stack.update(at.key, build(at));
    const b = this.placingYield(at.x, at.y, defId, season);
    out.label(b === null ? null : yieldLabel(b), b === null ? null : this.cornerOnScreen(at));
  }

  /** The placing tooltip of a `defId` on (x, y) in `season`. */
  private placingDoc(x: number, y: number, defId: string, season: Season): TipDoc {
    const def = stationDef(defId);
    const check = this.builder.checkStation(x, y, defId, this.rot);
    return placingTip({
      name: def.name,
      refusal: check.ok ? null : (check.reason ?? ''),
      breakdown: check.ok
        ? harvestBreakdown(this.builder.map, x, y, defId, 1, season, rules)
        : null,
      cargo: def.produces.filter((p) => p.level <= 1).map((p) => p.cargo),
      weeklyAtLevel1: weeklyOutput(1, 1),
    });
  }

  /** Units a week a level 1 `defId` would make on (x, y), null where it cannot stand. */
  private placingYield(x: number, y: number, defId: string, season: Season): number | null {
    if (!this.builder.checkStation(x, y, defId, this.rot).ok) return null;
    const b = harvestBreakdown(this.builder.map, x, y, defId, 1, season, rules, this.placingCells);
    return b?.perWeek ?? null;
  }

  /** Where a tile's top corner is on the screen, in the canvas's pixels. */
  private cornerOnScreen(t: Tile): Point {
    const p = this.world.surfacePoint(t.x, t.y);
    const r = this.world.root;
    return { x: r.x + p.x * r.scale.x, y: r.y + (p.y - HALF_H) * r.scale.y };
  }

  /** A tool put down: the placing tooltip goes with it, and so does the label. */
  private dropPlacing() {
    if (this.placingRoot || this.placingHeld) this.placing?.stack.closeAll();
    this.placingRoot = null;
    this.placingHeld = null;
    this.placing?.label(null, null);
  }
}
