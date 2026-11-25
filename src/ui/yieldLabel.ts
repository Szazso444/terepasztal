import { el } from './dom';
import type { Point } from './tooltipStack';

/**
 * The yield label (#336): what a harvest station would make a week, floating over the tile it
 * would stand on while its tool is in hand. A DOM element in `#ui-root`, so it keeps its size at
 * every zoom; the pointer passes through it to the map (style.css).
 */
export class YieldLabel {
  readonly root = el('div', { id: 'yield-label' });
  private shown: string | null = null;

  constructor() {
    this.root.style.display = 'none';
  }

  /**
   * Show `text` above a tile whose top corner is at `corner` on the screen (the canvas's pixels,
   * which are `#ui-root`'s): centred on it, its box 16 px above it. Null hides it.
   */
  show(text: string | null, corner: Point | null) {
    if (text === null || corner === null) {
      if (this.shown !== null) this.root.style.display = 'none';
      this.shown = null;
      return;
    }
    if (this.shown === null) this.root.style.display = '';
    if (text !== this.shown) this.root.textContent = text;
    this.shown = text;
    this.root.style.left = `${Math.round(corner.x)}px`;
    this.root.style.top = `${Math.round(corner.y)}px`;
  }
}
