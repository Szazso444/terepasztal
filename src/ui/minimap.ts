import { HALF_W, HALF_H, tileToWorld } from '../engine/iso';
import type { Camera } from '../engine/camera';
import { Terrain, type GameMap } from '../world/tiles';
import type { RegionState } from '../world/regions';
import { el } from './dom';
import { STR } from '../strings';

export interface MinimapMarks {
  track: { x: number; y: number }[];
  stations: { x: number; y: number }[];
  trains: { x: number; y: number }[];
}

const COLORS: Record<number, string> = {
  [Terrain.Grass]: '#465a36',
  [Terrain.Forest]: '#2f4028',
  [Terrain.Hill]: '#6a6246',
  [Terrain.Water]: '#22364a',
  [Terrain.Rock]: '#5a5852',
  [Terrain.Sand]: '#8a7c58',
};

/** Diamond-shaped minimap drawn in the same iso projection as the world (2 px per tile width). */
export class Minimap {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private readonly sx: number;
  private readonly sy: number;
  private readonly ox: number;
  private readonly oy: number;

  constructor(
    private readonly map: GameMap,
    private readonly regions: RegionState,
    private readonly cam: Camera,
    onNavigate: (wx: number, wy: number) => void,
  ) {
    const W = 216;
    const H = 118;
    this.canvas = el('canvas', { width: String(W), height: String(H) });
    this.ctx = this.canvas.getContext('2d')!;
    this.root = el(
      'div',
      { id: 'minimap', class: 'panel' },
      el('div', { class: 'panel-title', text: STR.minimap.title }),
      this.canvas,
    );
    // world px -> minimap px
    this.sx = (W - 8) / ((map.w + map.h) * HALF_W);
    this.sy = (H - 8) / ((map.w + map.h) * HALF_H);
    this.ox = W / 2;
    this.oy = 4 + HALF_H * this.sy;
    this.base = document.createElement('canvas');
    this.base.width = W;
    this.base.height = H;
    this.rebuildBase();
    const nav = (e: MouseEvent) => {
      const r = this.canvas.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / r.width) * W;
      const my = ((e.clientY - r.top) / r.height) * H;
      onNavigate((mx - this.ox) / this.sx, (my - this.oy) / this.sy);
    };
    this.canvas.addEventListener('mousedown', (e) => {
      nav(e);
      const move = (ev: MouseEvent) => nav(ev);
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }

  rebuildBase() {
    const c = this.base.getContext('2d')!;
    c.clearRect(0, 0, this.base.width, this.base.height);
    const tw = HALF_W * 2 * this.sx;
    const th = HALF_H * 2 * this.sy;
    for (let y = 0; y < this.map.h; y++)
      for (let x = 0; x < this.map.w; x++) {
        const p = tileToWorld(x, y);
        const px = this.ox + p.x * this.sx;
        const py = this.oy + p.y * this.sy;
        if (!this.regions.isTileRevealed(x, y)) continue;
        c.fillStyle = COLORS[this.map.terrain[y * this.map.w + x]];
        c.fillRect(px - tw / 2, py - th / 2, Math.max(1, tw), Math.max(1, th));
        if (!this.regions.isTileUnlocked(x, y)) {
          c.fillStyle = 'rgba(0,0,0,0.6)';
          c.fillRect(px - tw / 2, py - th / 2, Math.max(1, tw), Math.max(1, th));
        }
      }
  }

  draw(marks: MinimapMarks) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);
    const dot = (tx: number, ty: number, col: string, s: number) => {
      const p = tileToWorld(tx, ty);
      ctx.fillStyle = col;
      ctx.fillRect(
        Math.round(this.ox + p.x * this.sx - s / 2),
        Math.round(this.oy + p.y * this.sy - s / 2),
        s,
        s,
      );
    };
    for (const t of marks.track) dot(t.x, t.y, '#9a9ea4', 1);
    for (const s of marks.stations) dot(s.x, s.y, '#60c8d8', 3);
    for (const t of marks.trains) dot(t.x, t.y, '#e0a040', 3);
    const r = this.cam.viewRect();
    ctx.strokeStyle = '#d8cfb8';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.round(this.ox + r.x * this.sx) + 0.5,
      Math.round(this.oy + r.y * this.sy) + 0.5,
      Math.round(r.w * this.sx),
      Math.round(r.h * this.sy),
    );
  }
}
