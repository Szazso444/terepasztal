import type { Sprite } from 'pixi.js';
import type { Input } from '../engine/input';
import { rotationCount, type TrackKind } from '../world/track';
import { inBounds } from '../world/tiles';
import type { Builder } from '../sim/build';
import type { WorldRenderer } from '../render/worldRenderer';
import type { Station } from '../sim/stations';
import type { Tool } from './toolbar';
import { STR } from '../strings';
import { fmtMoney } from './dom';
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
  private dragStart: { x: number; y: number } | null = null;
  private selectSprite: Sprite;
  selected: Station | null = null;
  onSelect: ((s: Station | null) => void) | null = null;
  onStatus: ((text: string) => void) | null = null;
  onToolChanged: ((t: Tool) => void) | null = null;
  hoverStation: Station | null = null;
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
    this.selected = s;
    this.selectSprite.visible = !!s;
    if (s) {
      const p = this.world.surfacePoint(s.x, s.y);
      this.selectSprite.position.set(p.x, p.y);
    }
    this.onSelect?.(s);
  }

  private clearGhost() {
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
    if (inp.wasPressed('Escape')) {
      if (this.tool.kind !== 'none') this.setTool({ kind: 'none' });
      else this.select(null);
    }
    if (inp.wasPressed('KeyR')) {
      if (this.tool.kind === 'track') this.rot = (this.rot + 1) % rotationCount(this.tool.piece);
      else if (this.tool.kind === 'decor')
        this.rot = (this.rot + 1) % decorDef(this.tool.defId).rotations;
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
      case 'decor':
        this.updateDecorTool(t, inMap);
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
    }
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
    const tool = this.tool as { kind: 'track'; piece: TrackKind };
    const inp = this.input;
    // drag-laying straights
    if (tool.piece === 'straight' || tool.piece === 'bridge') {
      if (inp.buttonPressed.has(0) && inMap) this.dragStart = { x: t.x, y: t.y };
      if (this.dragStart && inp.buttons.has(0)) {
        const line = this.lineTiles(this.dragStart, t);
        this.showLineGhosts(line, tool.piece);
        this.status(
          line.length > 1
            ? `${line.length} x ${tool.piece}: ${fmtMoney(this.lineCost(line, tool.piece))}`
            : this.pieceStatus(t, tool.piece),
        );
        return;
      }
      if (this.dragStart && inp.buttonReleased.has(0)) {
        const line = this.lineTiles(this.dragStart, t);
        this.dragStart = null;
        for (const g of this.lineGhosts) g.destroy();
        this.lineGhosts = [];
        if (line.length === 1) this.builder.placeTrack(t.x, t.y, tool.piece, this.rot);
        else for (const l of line) this.builder.placeTrack(l.x, l.y, tool.piece, l.rot);
        return;
      }
    } else {
      for (const c of inp.clicks)
        if (c.button === 0 && inMap) this.builder.placeTrack(t.x, t.y, tool.piece, this.rot);
    }
    if (!inMap) {
      if (this.ghost) this.ghost.visible = false;
      this.ghostDiamond.visible = false;
      return;
    }
    const check = this.builder.checkTrack(t.x, t.y, tool.piece);
    const g = this.ensureGhost(`track/${tool.piece}_${this.rot}`);
    this.placeGhostAt(g, t.x, t.y, check.ok);
    const existing = this.builder.track.get(t.x, t.y);
    if (check.ok && existing && (existing.kind !== tool.piece || existing.rot !== this.rot))
      g.tint = REPLACE_TINT;
    this.world.setSpriteFrame(
      this.ghostDiamond,
      check.ok ? 'terrain/ghost_ok' : 'terrain/ghost_bad',
    );
    this.placeGhostAt(this.ghostDiamond, t.x, t.y, true);
    this.ghostDiamond.tint = 0xffffff;
    this.status(this.pieceStatus(t, tool.piece));
  }

  private pieceStatus(t: { x: number; y: number }, piece: TrackKind) {
    const check = this.builder.checkTrack(t.x, t.y, piece);
    const existing = this.builder.track.get(t.x, t.y);
    const replacing = !!existing && (existing.kind !== piece || existing.rot !== this.rot);
    const parts = [
      check.ok
        ? replacing
          ? STR.build.replace(existing!.kind, fmtMoney(check.cost))
          : STR.build.cost(fmtMoney(check.cost))
        : (check.reason ?? ''),
      STR.build.rotate,
    ];
    if (piece === 'straight' || piece === 'bridge') parts.push(STR.build.dragHint);
    return parts.filter(Boolean).join('   ');
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

  private lineCost(line: { x: number; y: number }[], piece: TrackKind) {
    let c = 0;
    for (const l of line) {
      const ch = this.builder.checkTrack(l.x, l.y, piece);
      if (ch.ok) c += ch.cost;
    }
    return c;
  }

  private showLineGhosts(line: { x: number; y: number; rot: number }[], piece: TrackKind) {
    if (this.ghost) this.ghost.visible = false;
    this.ghostDiamond.visible = false;
    while (this.lineGhosts.length < line.length) {
      const g = this.world.makeOverlaySprite(`track/${piece}_0`);
      g.alpha = 0.75;
      this.lineGhosts.push(g);
    }
    for (let i = 0; i < this.lineGhosts.length; i++) {
      const g = this.lineGhosts[i];
      if (i >= line.length) {
        g.visible = false;
        continue;
      }
      const l = line[i];
      this.world.setSpriteFrame(g, `track/${piece}_${l.rot}`);
      const ok = this.builder.checkTrack(l.x, l.y, piece).ok;
      this.placeGhostAt(g, l.x, l.y, ok);
    }
  }

  private updateStationTool(t: { x: number; y: number }, inMap: boolean) {
    const tool = this.tool as { kind: 'station'; defId: string };
    if (!inMap) {
      if (this.ghost) this.ghost.visible = false;
      this.ghostDiamond.visible = false;
      return;
    }
    const check = this.builder.checkStation(t.x, t.y, tool.defId);
    const g = this.ensureGhost('structures/station_1');
    this.placeGhostAt(g, t.x, t.y, check.ok);
    this.world.setSpriteFrame(
      this.ghostDiamond,
      check.ok ? 'terrain/ghost_ok' : 'terrain/ghost_bad',
    );
    this.placeGhostAt(this.ghostDiamond, t.x, t.y, true);
    this.ghostDiamond.tint = 0xffffff;
    this.status(check.ok ? STR.build.cost(fmtMoney(check.cost)) : (check.reason ?? ''));
    for (const c of this.input.clicks) {
      if (c.button === 0) {
        const s = this.builder.placeStation(t.x, t.y, tool.defId);
        if (s) {
          this.setTool({ kind: 'none' });
          this.select(s);
        }
      }
    }
  }

  private updateDecorTool(t: { x: number; y: number }, inMap: boolean) {
    const tool = this.tool as { kind: 'decor'; defId: string };
    if (!inMap) {
      if (this.ghost) this.ghost.visible = false;
      this.ghostDiamond.visible = false;
      return;
    }
    const def = decorDef(tool.defId);
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
    const parts = [check.ok ? STR.build.cost(fmtMoney(check.cost)) : (check.reason ?? '')];
    if (def.rotations > 1) parts.push(STR.build.rotate);
    this.status(parts.join('   '));
    for (const c of this.input.clicks)
      if (c.button === 0) this.builder.placeDecor(t.x, t.y, tool.defId, this.rot);
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
    const refund = st
      ? Math.round(st.def.cost * 0.5)
      : dec
        ? this.builder.decorRefund(dec)
        : piece
          ? this.builder.refundFor(piece)
          : 0;
    this.status(refund ? STR.build.refund(fmtMoney(refund)) : '');
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
        this.select(st ?? null);
      }
    }
  }

  removeAt(x: number, y: number): boolean {
    const st = this.builder.stationAt(x, y);
    if (st) {
      if (this.selected === st) this.select(null);
      return this.builder.removeStation(st);
    }
    if (this.builder.decorAt(x, y)) return this.builder.removeDecor(x, y);
    return this.builder.removeTrack(x, y);
  }

  private status(s: string) {
    this.onStatus?.(s);
  }
}
