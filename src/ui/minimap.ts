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
  [Terrain.Mountain]: '#7a7874',
};

/** Cool taiga, muddy swamp, pale desert: tint the terrain colour by biome (grass/forest only). */
export function biomeShade(css: string, biome: number, terrain: number): string {
  if (terrain !== 0 && terrain !== 1) return css;
  const m = /^#([0-9a-f]{6})$/i.exec(css);
  if (!m) return css;
  let r = parseInt(m[1].slice(0, 2), 16);
  let g = parseInt(m[1].slice(2, 4), 16);
  let b = parseInt(m[1].slice(4, 6), 16);
  if (biome === 0) {
    r += 18;
    g += 14;
  } else if (biome === 3) {
    r -= 10;
    b += 22;
  } else if (biome === 4) {
    r += 10;
    g -= 14;
    b -= 10;
  } else if (biome === 2) {
    r += 40;
    g += 24;
  }
  const c = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Diamond-shaped minimap drawn in the same iso projection as the world (2 px per tile width). */
export class Minimap {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private sx = 1;
  private sy = 1;
  private ox = 0;
  private oy = 0;
  private readonly W: number;
  private readonly H: number;

  constructor(
    private readonly map: GameMap,
    private readonly regions: RegionState,
    private readonly cam: Camera,
    onNavigate: (wx: number, wy: number) => void,
  ) {
    const W = 432;
    const H = 236;
    this.W = W;
    this.H = H;
    this.canvas = el('canvas', { width: String(W), height: String(H) });
    this.ctx = this.canvas.getContext('2d')!;
    this.root = el(
      'div',
      { id: 'minimap', class: 'panel' },
      el('div', { class: 'panel-title', text: STR.minimap.title }),
      this.canvas,
    );
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

  /** Fit the revealed chunks into the canvas (world px -> minimap px). */
  private fit() {
    const b = this.regions.revealedBounds();
    const W = this.W;
    const H = this.H;
    // corners of the revealed rectangle in world space
    const pts = [
      tileToWorld(b.x, b.y),
      tileToWorld(b.x + b.w, b.y),
      tileToWorld(b.x, b.y + b.h),
      tileToWorld(b.x + b.w, b.y + b.h),
    ];
    const minX = Math.min(...pts.map((p) => p.x)) - HALF_W;
    const maxX = Math.max(...pts.map((p) => p.x)) + HALF_W;
    const minY = Math.min(...pts.map((p) => p.y)) - HALF_H;
    const maxY = Math.max(...pts.map((p) => p.y)) + HALF_H;
    const s = Math.min((W - 8) / (maxX - minX), (H - 8) / (maxY - minY));
    this.sx = s;
    this.sy = s;
    this.ox = W / 2 - ((minX + maxX) / 2) * s;
    this.oy = H / 2 - ((minY + maxY) / 2) * s;
  }

  rebuildBase() {
    this.fit();
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
        c.fillStyle = biomeShade(
          COLORS[this.map.terrain[y * this.map.w + x]],
          this.map.biome[y * this.map.w + x],
          this.map.terrain[y * this.map.w + x],
        );
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
