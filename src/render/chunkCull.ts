import { Bounds, Matrix, getLocalBounds, type Container, type Renderer } from 'pixi.js';
import { worldToTile } from '../engine/iso';
import { CHUNK_TILES } from '../world/chunks';

/** Pixi's change counters: a transform, tint or visibility change bumps one, a texture the other. */
type Counted = Container & { _didContainerChangeTick: number; _didViewChangeTick: number };

/**
 * What a layer knows of one child beside its change counters (`ChunkCull.seen`): its bounds in
 * the layer's space and the chunk it is filed under (none while it is not culled).
 */
interface Member {
  child: Counted;
  /** where it is in the layer's list of members */
  index: number;
  /** a child with children of its own and no cull area: its counters do not see them move */
  deep: boolean;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  chunk: Chunk | null;
}

/** The children of a layer whose centres lie in one CHUNK_TILES square of tiles. */
interface Chunk {
  members: Set<Member>;
  /** the bounds of everything filed here since it was last empty, in the layer's space */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** where it was last found: OUT of view, IN it, or on its EDGE; null before the first look */
  shown: number | null;
}

const OUT = 0,
  IN = 1,
  EDGE = 2;

/** How far (screen px) past the screen's edge a chunk still counts as in view. */
const SLACK = 2;

const bounds = new Bounds(),
  matrix = new Matrix();

/**
 * Culling for one flat layer, by chunk. Pixi's culler measured every cullable child of the layer
 * every frame; here the layer is closed to it (`cullableChildren` off) and its children are filed
 * by the CHUNK_TILES square of tiles their centre lies in. A chunk's area is the union of what was
 * filed in it, so one rectangle test shows or hides all of it, and only a chunk whose answer
 * changed (the camera moved) or whose children changed has its children's `culled` set again. A
 * chunk on the edge of the view tests its children one by one by the bounds kept for them, so no
 * more is drawn than Pixi's culler drew.
 *
 * The children stay where they are, so the layer keeps its depth order across chunk edges. A child
 * is measured again only when one of Pixi's change counters on it moved (`_didContainerChangeTick`
 * for transform, visibility and tint, `_didViewChangeTick` for texture and geometry); a child with
 * children of its own and no cull area is measured every frame, as those do not move its counters.
 * A child that is not cullable (at its last change) is never culled, as with Pixi's culler. Only
 * ever too much is drawn, never too little: a chunk's area grows with what is filed in it and
 * starts afresh only when it empties.
 */
export class ChunkCull {
  /**
   * The layer's children, in no order, side by side with what is known of them: the per-frame
   * check reads only `kids` and `seen`, which lie together in memory, and touches the rest only
   * for a child that changed.
   */
  private members: Member[] = [];
  private kids: Counted[] = [];
  /** per child: its two change counters when last measured, and 1 when it is `deep` */
  private seen = new Float64Array(3 * 64);
  private byChild = new Map<Container, Member>();
  private chunks = new Map<number, Chunk>();
  /** chunks whose children changed since the last update */
  private dirty = new Set<Chunk>();
  /** the screen in the layer's space at the last update */
  private view = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private looked = false;
  /** How many children the last update measured. */
  measured = 0;

  constructor(readonly layer: Container) {
    layer.cullableChildren = false;
    for (const child of layer.children) this.join(child);
    layer.on('childAdded', (child: Container) => this.join(child));
    layer.on('childRemoved', (child: Container) => this.forget(child));
  }

  /**
   * Cull the layer's children for a screen `width` x `height` px at the origin: run as the frame
   * is rendered, after everything has moved. `toScreen` is the layer's transform to the screen,
   * by default worked out from its parents now.
   */
  update(width: number, height: number, toScreen?: Matrix) {
    const layer = this.layer;
    if (!layer.visible) return;
    this.look(toScreen ?? layer.getGlobalTransform(matrix, false), width, height);
    const kids = this.kids,
      seen = this.seen;
    this.measured = 0;
    for (let i = 0, k = 0; i < kids.length; i++, k += 3) {
      const child = kids[i];
      if (
        seen[k] === child._didContainerChangeTick &&
        seen[k + 1] === child._didViewChangeTick &&
        !seen[k + 2]
      )
        continue;
      const m = this.members[i];
      seen[k] = child._didContainerChangeTick;
      seen[k + 1] = child._didViewChangeTick;
      this.measured++;
      if (!child.cullable || !child.measurable || !child.includeInBuild) {
        if (m.chunk) this.leave(m, m.chunk);
        m.deep = false;
        seen[k + 2] = 0;
        this.setCulled(m, false);
        continue;
      }
      this.measure(m);
      seen[k + 2] = m.deep ? 1 : 0;
      this.file(m);
      const chunk = m.chunk!;
      if (chunk.shown !== null && !this.dirty.has(chunk))
        this.setCulled(m, this.hides(chunk.shown, m));
    }
    const v = this.view;
    for (const chunk of this.looked ? this.chunks.values() : this.dirty) {
      const shown =
        chunk.maxX <= v.x0 || chunk.minX >= v.x1 || chunk.maxY <= v.y0 || chunk.minY >= v.y1
          ? OUT
          : chunk.minX >= v.x0 && chunk.maxX <= v.x1 && chunk.minY >= v.y0 && chunk.maxY <= v.y1
            ? IN
            : EDGE;
      // a chunk on the edge of the view sorts its children one by one, by their own bounds
      if (shown === chunk.shown && shown !== EDGE && !this.dirty.has(chunk)) continue;
      chunk.shown = shown;
      for (const m of chunk.members) this.setCulled(m, this.hides(shown, m));
    }
    this.dirty.clear();
  }

  /** Is `m`, filed in a chunk found `shown`, to be culled? */
  private hides(shown: number, m: Member) {
    if (shown !== EDGE) return shown === OUT;
    const v = this.view;
    return m.maxX <= v.x0 || m.minX >= v.x1 || m.maxY <= v.y0 || m.minY >= v.y1;
  }

  /** The screen in the layer's space; `looked` says whether it moved since the last update. */
  private look(m: Matrix, width: number, height: number) {
    const v = this.view;
    let x0 = -Infinity,
      x1 = Infinity,
      y0 = -Infinity,
      y1 = Infinity;
    // the inverse of an axis-aligned transform; a turned or skewed layer is not culled at all
    if (!m.b && !m.c && m.a && m.d) {
      const ax = (-SLACK - m.tx) / m.a,
        bx = (width + SLACK - m.tx) / m.a,
        ay = (-SLACK - m.ty) / m.d,
        by = (height + SLACK - m.ty) / m.d;
      x0 = Math.min(ax, bx);
      x1 = Math.max(ax, bx);
      y0 = Math.min(ay, by);
      y1 = Math.max(ay, by);
    }
    this.looked = x0 !== v.x0 || x1 !== v.x1 || y0 !== v.y0 || y1 !== v.y1;
    v.x0 = x0;
    v.x1 = x1;
    v.y0 = y0;
    v.y1 = y1;
  }

  /** A child joined the layer: it is measured and filed at the next update. */
  private join(child: Container) {
    if (this.byChild.has(child)) this.forget(child);
    const m: Member = {
      child: child as Counted,
      index: this.members.length,
      deep: false,
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      chunk: null,
    };
    this.byChild.set(child, m);
    this.members.push(m);
    this.kids.push(m.child);
    if (this.seen.length < 3 * this.kids.length) {
      const grown = new Float64Array(this.seen.length * 2);
      grown.set(this.seen);
      this.seen = grown;
    }
    const k = 3 * m.index;
    this.seen[k] = this.seen[k + 1] = -1;
    this.seen[k + 2] = 0;
  }

  /** `m`'s bounds in the layer's space, by its cull area where it has one. */
  private measure(m: Member) {
    const child = m.child as Counted & Partial<Viewed>;
    child.updateLocalTransform();
    const t = child.localTransform;
    m.deep = !child.cullArea && child.children.length > 0;
    if (
      !child.cullArea &&
      !m.deep &&
      child.renderPipeId &&
      !child.boundsArea &&
      !child.effects?.length
    ) {
      // a sprite, mesh or graphics alone: its own bounds through its transform, as Pixi measures it
      const b = child.bounds!;
      if (b.minX <= b.maxX && b.minY <= b.maxY) {
        corners(m, b.minX, b.minY, b.maxX, b.maxY, t);
        return;
      }
    }
    if (child.cullArea) {
      bounds.clear();
      bounds.addRect(child.cullArea, t);
    } else getLocalBounds(child, bounds, t);
    m.minX = bounds.minX;
    m.minY = bounds.minY;
    m.maxX = bounds.maxX;
    m.maxY = bounds.maxY;
  }

  /** File `m` under the chunk its centre lies in, growing that chunk's area to hold it. */
  private file(m: Member) {
    const t = worldToTile((m.minX + m.maxX) / 2, (m.minY + m.maxY) / 2),
      key = Math.floor(t.x / CHUNK_TILES) * 65536 + Math.floor(t.y / CHUNK_TILES);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = {
        members: new Set(),
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity,
        shown: null,
      };
      this.chunks.set(key, chunk);
    }
    if (m.chunk !== chunk) {
      if (m.chunk) this.leave(m, m.chunk);
      m.chunk = chunk;
      chunk.members.add(m);
      if (chunk.shown === null) this.dirty.add(chunk);
    }
    if (m.minX < chunk.minX || m.minY < chunk.minY || m.maxX > chunk.maxX || m.maxY > chunk.maxY) {
      chunk.minX = Math.min(chunk.minX, m.minX);
      chunk.minY = Math.min(chunk.minY, m.minY);
      chunk.maxX = Math.max(chunk.maxX, m.maxX);
      chunk.maxY = Math.max(chunk.maxY, m.maxY);
      this.dirty.add(chunk);
    }
  }

  private leave(m: Member, chunk: Chunk) {
    m.chunk = null;
    chunk.members.delete(m);
    if (chunk.members.size) return;
    // an empty chunk starts its area afresh
    chunk.minX = chunk.minY = Infinity;
    chunk.maxX = chunk.maxY = -Infinity;
    chunk.shown = null;
    this.dirty.delete(chunk);
  }

  /** `child` left the layer: it is unfiled and shown. */
  private forget(child: Container) {
    const m = this.byChild.get(child);
    if (!m) return;
    if (m.chunk) this.leave(m, m.chunk);
    const last = this.members.pop()!;
    this.kids.pop();
    if (last !== m) {
      const to = m.index,
        from = 3 * this.members.length;
      this.members[to] = last;
      this.kids[to] = last.child;
      last.index = to;
      this.seen.copyWithin(3 * to, from, from + 3);
    }
    this.byChild.delete(child);
    if (!child.destroyed && child.culled) child.culled = false;
  }

  /**
   * Set `m.child.culled`. That bumps the change counter it is measured by; a child measured as it
   * stands keeps counting as measured, so being culled is no change that measures it again.
   */
  private setCulled(m: Member, culled: boolean) {
    const child = m.child;
    if (child.culled === culled) return;
    const k = 3 * m.index,
      current = this.seen[k] === child._didContainerChangeTick;
    child.culled = culled;
    if (current) this.seen[k] = child._didContainerChangeTick;
  }
}

/** A child that draws itself: Pixi's view containers (sprites, meshes, graphics). */
interface Viewed {
  renderPipeId: string;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** `m`'s bounds: the box (x0, y0)-(x1, y1) through transform `t`. */
function corners(m: Member, x0: number, y0: number, x1: number, y1: number, t: Matrix) {
  const ax = t.a * x0,
    bx = t.a * x1,
    cy = t.c * y0,
    dy = t.c * y1,
    by0 = t.b * x0,
    by1 = t.b * x1,
    d0 = t.d * y0,
    d1 = t.d * y1;
  m.minX = Math.min(ax, bx) + Math.min(cy, dy) + t.tx;
  m.maxX = Math.max(ax, bx) + Math.max(cy, dy) + t.tx;
  m.minY = Math.min(by0, by1) + Math.min(d0, d1) + t.ty;
  m.maxY = Math.max(by0, by1) + Math.max(d0, d1) + t.ty;
}

/**
 * Cull `layers` by chunk (`ChunkCull`) as `root` renders, each from its own transform to the screen
 * the renderer draws. Returns the culls, by layer.
 */
export function cullByChunk(root: Container, layers: Container[]) {
  const culls = layers.map((layer) => new ChunkCull(layer));
  const previous = root.onRender;
  root.onRender = (renderer: Renderer) => {
    previous?.(renderer);
    if (!root.visible) return;
    const { width, height } = renderer.screen;
    for (const cull of culls) cull.update(width, height);
  };
  return culls;
}
