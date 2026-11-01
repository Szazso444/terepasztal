import type { Sprite } from 'pixi.js';
import type { WindState } from '../sim/wind';
import { TREE_SWAY, gustAt, lot, treeLean } from './lifeMotion';

/** Trees are kept in cells of this many world px, so a frame looks only at those in view. */
const CELL = 256;
/** World px kept round the view: a tree's foot may stand this far outside it and still show. */
const MARGIN = 96;
/** How high up its height the gust that moves a tree is read. */
const GUST_AT = 0.7;
/** A tree reads the gust once in this many of its moves: a gust is slow, and dear to read. */
const GUST_EVERY = 4;

/** One tree: its sprite and what it was drawn at, and how it moves. */
interface Tree {
  s: Sprite;
  height: number;
  scaleY: number;
  amp: number;
  om: number;
  ph: number;
  /** the gust at the tree, and how many moves it was read ago */
  gust: number;
  since: number;
}
interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

const cellOf = (x: number, y: number) =>
  (Math.floor(y / CELL) + 0x8000) * 0x10000 + Math.floor(x / CELL) + 0x8000;

/**
 * Trees lean and sway in the game's own wind (#515), more in a gust. A tree is sheared about its
 * anchor, its foot, so the foot never moves; a push toward the camera squashes it a little. That
 * asks nothing of the renderer but a sprite's transform. Only trees in view move, half of them a
 * frame; in a calm, and for a player who asked for less motion, every tree stands as it was drawn.
 */
export class TreeSway {
  private readonly cells = new Map<number, Set<Tree>>();
  private readonly still =
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  /** seconds this has run */
  private t = 0;
  /** which half of the cells moves this frame, as a chequerboard */
  private even = false;

  /** Sprite `s`, already placed and scaled, is a `kind` of plant; one that does not sway is left. */
  add(s: Sprite, kind: string) {
    const sway = TREE_SWAY[kind];
    if (!sway) return;
    const [amp, hz] = sway,
      x = Math.round(s.x * 4),
      y = Math.round(s.y * 4),
      cell = cellOf(s.x, s.y);
    let trees = this.cells.get(cell);
    if (!trees) this.cells.set(cell, (trees = new Set()));
    trees.add({
      s,
      height: s.height,
      scaleY: s.scale.y,
      amp: amp * (0.85 + 0.3 * lot(x, y, 461)),
      om: 2 * Math.PI * hz * (0.88 + 0.24 * lot(x, y, 462)),
      ph: 6.2832 * lot(x, y, 463),
      gust: 0,
      since: Math.floor(lot(x, y, 464) * GUST_EVERY),
    });
  }

  /** Move the trees in `view` (world px) `dt` seconds on: 0 while the game is paused. */
  update(dt: number, wind: WindState, view: View) {
    if (this.still) return;
    this.t += dt;
    this.even = !this.even;
    const x0 = Math.floor((view.x - MARGIN) / CELL),
      x1 = Math.floor((view.x + view.w + MARGIN) / CELL),
      y0 = Math.floor((view.y - MARGIN) / CELL),
      y1 = Math.floor((view.y + view.h + MARGIN * 2) / CELL);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if ((((x + y) & 1) === 0) !== this.even) continue;
        const trees = this.cells.get(cellOf(x * CELL, y * CELL));
        if (trees) this.sway(trees, wind);
      }
  }

  private sway(trees: Set<Tree>, wind: WindState) {
    const s = wind.strength,
      { dir } = wind;
    for (const tree of trees) {
      const sprite = tree.s;
      if (sprite.destroyed) {
        trees.delete(tree);
        continue;
      }
      if (!sprite.visible) continue;
      if (--tree.since < 0) {
        tree.since = GUST_EVERY - 1;
        tree.gust = gustAt(s, dir, sprite.x, sprite.y - tree.height * GUST_AT, this.t);
      }
      const lean = treeLean(tree, s, tree.gust, this.t);
      sprite.skew.x = -lean * dir.x;
      sprite.scale.y = tree.scaleY * (1 - lean * dir.y);
    }
  }
}
