import { Container, Graphics } from 'pixi.js';
import { PAL, hex, shade } from '../art/palette';
import { buildingHeight, footprintWidth } from './halo';

/** A building being upgraded: its footprint (top-left tile and size) and how far the work is. */
export interface WorkBar {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0..1 */
  progress: number;
}

const BAR_H = 5;
/** Clearance between the building's top and the bar, in world pixels. */
const GAP = 10;
const FRAME = hex(PAL.outline);
const TRACK = hex(shade(PAL.amberDark, 0.55));
const FILL = hex(PAL.amber);
const SHINE = hex(PAL.white);

interface Bar {
  g: Graphics;
  /** what it was last drawn with, so an unchanged bar is not redrawn */
  width: number;
  filled: number;
}

/**
 * A small progress bar over each building being upgraded. `sync` is called every frame with
 * the works under way; the bars are kept between calls and only redrawn when their fill moves by
 * a pixel, and the ones not needed are hidden rather than thrown away.
 */
export class WorkBars {
  private bars: Bar[] = [];
  constructor(
    private readonly layer: Container,
    private readonly surface: (x: number, y: number) => { x: number; y: number },
  ) {}

  sync(works: readonly WorkBar[]) {
    for (let i = 0; i < works.length; i++) {
      const w = works[i];
      const bar = this.bars[i] ?? this.add();
      const width = Math.round(Math.min(48, Math.max(24, footprintWidth(w.w, w.h) * 0.45)));
      const progress = Number.isFinite(w.progress) ? Math.min(1, Math.max(0, w.progress)) : 0;
      const filled = Math.round(progress * (width - 2));
      if (width !== bar.width || filled !== bar.filled) draw(bar, width, filled);
      const p = this.surface(w.x + (w.w - 1) / 2, w.y + (w.h - 1) / 2);
      bar.g.position.set(Math.round(p.x), Math.round(p.y - buildingHeight(w.w, w.h) - GAP));
      bar.g.visible = true;
    }
    for (let i = works.length; i < this.bars.length; i++) this.bars[i].g.visible = false;
  }

  private add(): Bar {
    const g = new Graphics();
    g.cullable = true;
    this.layer.addChild(g);
    const bar = { g, width: -1, filled: -1 };
    this.bars.push(bar);
    return bar;
  }
}

/** A dark frame around a dim amber track, filled from the left in amber with a light top edge. */
function draw(bar: Bar, width: number, filled: number) {
  bar.width = width;
  bar.filled = filled;
  // whole pixels, so the bar stays crisp at an odd width
  const x = -Math.floor(width / 2);
  const y = -Math.floor(BAR_H / 2);
  const g = bar.g.clear();
  g.rect(x, y, width, BAR_H).fill({ color: FRAME, alpha: 0.85 });
  g.rect(x + 1, y + 1, width - 2, BAR_H - 2).fill(TRACK);
  if (filled > 0) {
    g.rect(x + 1, y + 1, filled, BAR_H - 2).fill(FILL);
    g.rect(x + 1, y + 1, filled, 1).fill({ color: SHINE, alpha: 0.6 });
  }
}
