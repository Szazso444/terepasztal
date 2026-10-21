import type { Sprite, Texture } from 'pixi.js';
import {
  FIELD_RES,
  FieldModel,
  SITE_RADIUS,
  siteKey,
  type FieldFrame,
  type FieldJob,
  type FieldPicture,
  type FieldSite,
} from './wheatField';

/**
 * Most of a frame's time the fields' pictures may take (ms). A picture takes several frames' share;
 * its job stops between two columns or a few rows and goes on in the next frame.
 */
export const FIELD_BUDGET_MS = 1;

/** What the fields' pictures are made from, as the world renderer has it. */
export interface WheatHost {
  /** The site of the field tile at map tile (x, y) as it is drawn now; null where it is not. */
  site(x: number, y: number): FieldSite | null;
  /**
   * The variants' pictures, 0 to 2; 'wait' while they are read, null where none can be (no
   * canvas, as under Node).
   */
  frames(): readonly (FieldFrame | null)[] | null | 'wait';
  /** A texture of a picture, FIELD_RES texels per world px. */
  texture(p: FieldPicture): Texture;
  /** The part of the world in view (world px), whose tiles are built first; null before a view. */
  view(): { x: number; y: number; w: number; h: number } | null;
}

/** A picture a field tile's sprite shows, and what it was painted for. */
interface Shown {
  key: string;
  texture: Texture;
  /** world px from the tile's centre to its top-left, and its size */
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The wheat fields' pictures (#444, wheatField.ts), one per field tile's sprite, worked out again
 * when anything within a field tile's reach changes (`near`), a little each frame (`update`), the
 * tiles in view first. Until a tile's picture is built, and wherever it cannot be, its sprite shows
 * its atlas frame. A sprite made again for the same field shows the picture it had at once.
 */
export class WheatFields {
  /** Each field tile's sprite, by tile (y * w + x), and the atlas frame it was made with. */
  private readonly sprites = new Map<
    number,
    { sprite: Sprite; frame: Texture; ax: number; ay: number }
  >();
  private readonly shown = new Map<number, Shown>();
  /** Tiles whose picture may have changed. */
  private readonly queue = new Set<number>();
  private job: { tile: number; key: string; job: FieldJob } | null = null;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {}

  /** Tile `i`'s field sprite, made from its atlas frame; null when it goes. */
  set(i: number, sprite: Sprite | null) {
    if (!sprite) this.sprites.delete(i);
    else {
      this.sprites.set(i, {
        sprite,
        frame: sprite.texture,
        ax: sprite.anchor.x,
        ay: sprite.anchor.y,
      });
      const shown = this.shown.get(i);
      if (shown) show(sprite, shown);
    }
    this.queue.add(i);
  }

  /** The sprite tile `i`'s field is drawn with, if it has one. */
  sprite(i: number) {
    return this.sprites.get(i)?.sprite;
  }

  /**
   * Something on the tiles from (x0, y0) to (x1, y1) changed: the field tiles whose pictures read
   * them (SITE_RADIUS round) are looked at again.
   */
  near(x0: number, y0: number, x1 = x0, y1 = y0) {
    const R = SITE_RADIUS;
    for (let y = Math.max(0, Math.floor(y0) - R); y <= Math.min(this.h - 1, Math.ceil(y1) + R); y++)
      for (
        let x = Math.max(0, Math.floor(x0) - R);
        x <= Math.min(this.w - 1, Math.ceil(x1) + R);
        x++
      ) {
        const i = y * this.w + x;
        if (this.sprites.has(i) || this.shown.has(i)) this.queue.add(i);
      }
  }

  /** Whether any picture is waiting to be looked at or painted. */
  get busy() {
    return this.queue.size > 0 || !!this.job;
  }

  /**
   * Look at and paint pictures while `more()` says there is time, the tiles in view first. A
   * picture painted is made into its texture in a call of its own, the next: the canvas and its
   * upload are never added to a call's painting.
   */
  update(host: WheatHost, more: () => boolean) {
    if (this.job?.job.done) {
      this.complete(host);
      return;
    }
    while (more()) {
      if (!this.job) {
        const tile = this.next(host.view());
        if (tile < 0) return;
        this.queue.delete(tile);
        const site = this.sprites.has(tile) ? host.site(tile % this.w, (tile / this.w) | 0) : null;
        if (!site) {
          this.drop(tile);
          continue;
        }
        const key = siteKey(site),
          shown = this.shown.get(tile);
        if (shown?.key === key) continue;
        const frames = host.frames();
        if (frames === 'wait') {
          this.queue.add(tile);
          return;
        }
        if (!frames) {
          this.drop(tile);
          continue;
        }
        this.job = { tile, key, job: new FieldModel(site).job(frames) };
      }
      this.job.job.run(more);
      return;
    }
  }

  /** Show the picture just painted, made into its texture, unless its tile changed meanwhile. */
  private complete(host: WheatHost) {
    const { tile, key, job } = this.job!;
    this.job = null;
    const entry = this.sprites.get(tile),
      site = entry ? host.site(tile % this.w, (tile / this.w) | 0) : null;
    // changed while it was painted: it is looked at again
    if (site && siteKey(site) !== key) {
      this.queue.add(tile);
      return;
    }
    this.queue.delete(tile);
    const p = job.result;
    if (!entry || !site || !p) {
      this.drop(tile);
      return;
    }
    const old = this.shown.get(tile),
      shown: Shown = {
        key,
        texture: host.texture(p),
        left: p.left,
        top: p.top,
        width: p.width / FIELD_RES,
        height: p.height / FIELD_RES,
      };
    this.shown.set(tile, shown);
    show(entry.sprite, shown);
    old?.texture.destroy(true);
  }

  /** The next tile to look at: one in view first, then the nearest to the view's middle. */
  private next(view: { x: number; y: number; w: number; h: number } | null) {
    let best = -1,
      score = Infinity;
    for (const i of this.queue) {
      if (!view) return i;
      const x = i % this.w,
        y = (i / this.w) | 0,
        px = (x - y) * 32,
        py = (x + y) * 16,
        inside =
          px > view.x - 64 &&
          px < view.x + view.w + 64 &&
          py > view.y - 48 &&
          py < view.y + view.h + 48,
        s = (inside ? 0 : 1e9) + Math.hypot(px - (view.x + view.w / 2), py - (view.y + view.h / 2));
      if (s < score) {
        score = s;
        best = i;
      }
    }
    return best;
  }

  /** Tile `i` shows no picture: its sprite goes back to its atlas frame, the texture is freed. */
  private drop(i: number) {
    const shown = this.shown.get(i);
    if (!shown) return;
    this.shown.delete(i);
    const entry = this.sprites.get(i);
    if (entry && !entry.sprite.destroyed) {
      entry.sprite.texture = entry.frame;
      entry.sprite.anchor.set(entry.ax, entry.ay);
    }
    shown.texture.destroy(true);
  }

  /** Free every picture (the world is destroyed). */
  destroy() {
    this.job?.job.cancel();
    this.job = null;
    for (const shown of this.shown.values()) shown.texture.destroy(true);
    this.shown.clear();
    this.queue.clear();
  }
}

/** Show a picture on a field tile's sprite: its texture, anchored at the tile's centre. */
function show(sprite: Sprite, shown: Shown) {
  if (sprite.destroyed) return;
  sprite.texture = shown.texture;
  sprite.anchor.set(-shown.left / shown.width, -shown.top / shown.height);
}
