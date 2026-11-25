/**
 * Block signalling (spec §9). Semaphores stand on track tiles and guard the tile in front of
 * them (`rot`). A train governed by a signal may pass it only when the block beyond, up to the
 * next signal facing the same way, holds no other train (absolute block); when that block is
 * clear but the one after it is taken the signal shows caution and the train approaches so that
 * it can stop at the next signal. Token working is stricter: a plain section may hold one train
 * at a time, whichever way it travels, and the token returns only when the train has left.
 *
 * Track with no signals behaves as before: the claims in `traffic.ts` remain the fallback. Levels
 * beyond absolute block (CTC, in-cab) shorten the headway a following train keeps.
 */
import { Dir, DIR_DX, DIR_DY, opposite } from '../engine/iso';
import type { TrackGraph } from '../world/track';
import type { Decor } from './build';

export type SignalLevel = 'auto' | 'token' | 'absolute_block' | 'ctc' | 'in_cab';
export const SIGNAL_LEVELS: SignalLevel[] = ['auto', 'token', 'absolute_block', 'ctc', 'in_cab'];
/** tiles a following train keeps behind the one ahead, by level (R17: headway in tiles) */
export const HEADWAY: Record<SignalLevel, number> = {
  auto: 0,
  token: 0,
  absolute_block: 10,
  ctc: 6,
  in_cab: 3,
};
export type Aspect = 'red' | 'yellow' | 'green';

export interface SignalPost {
  x: number;
  y: number;
  /** direction the signal faces along the track: trains moving this way are governed */
  dir: Dir;
}

export class Signals {
  level: SignalLevel = 'auto';
  private posts = new Map<number, SignalPost>();
  /** section id -> train holding its token */
  readonly tokens = new Map<number, number>();
  constructor(readonly track: TrackGraph) {}
  key(x: number, y: number) {
    return y * this.track.w + x;
  }
  /** Re-index the semaphores from the decor list. */
  rebuild(decor: Iterable<Decor>) {
    this.posts.clear();
    this.postsBuilt++;
    for (const d of decor)
      if (d.id === 'signal')
        this.posts.set(this.key(d.x, d.y), { x: d.x, y: d.y, dir: d.rot as Dir });
  }
  get count() {
    return this.posts.size;
  }
  postAt(x: number, y: number): SignalPost | null {
    return this.posts.get(this.key(x, y)) ?? null;
  }
  /** Is a train that leaves tile (x,y) through `out` governed by a signal there? */
  governs(x: number, y: number, out: Dir): SignalPost | null {
    const p = this.postAt(x, y);
    return p && p.dir === out ? p : null;
  }
  /**
   * The block beyond a signal: the tiles from the guarded tile up to and including the tile
   * before the next signal facing the same way. Without a path the walk continues straight (or
   * takes the only exit) so the post can show an aspect of its own.
   */
  blockBeyond(
    post: SignalPost,
    path?: readonly { x: number; y: number; in: Dir; out: Dir }[],
  ): { tiles: { x: number; y: number }[]; next: SignalPost | null } {
    if (path) {
      const i = path.findIndex((s) => s.x === post.x && s.y === post.y && s.out === post.dir);
      if (i >= 0) {
        const tiles: { x: number; y: number }[] = [];
        for (let j = i + 1; j < path.length && tiles.length < this.track.w * this.track.h; j++) {
          const s = path[j];
          tiles.push({ x: s.x, y: s.y });
          const next = this.governs(s.x, s.y, s.out);
          if (next) return { tiles, next };
        }
        const tail = path[path.length - 1];
        if (tail) {
          const onward = this.walk(tail.x, tail.y, tail.out);
          const seen = new Set(tiles.map((p) => this.key(p.x, p.y)));
          for (const t of onward.tiles) {
            const k = this.key(t.x, t.y);
            if (seen.has(k)) continue;
            seen.add(k);
            tiles.push(t);
          }
          return { tiles, next: onward.next };
        }
        return { tiles, next: null };
      }
    }
    const walked = this.walk(post.x, post.y, post.dir);
    return { tiles: [...walked.tiles], next: walked.next };
  }
  /** Walks seen since the track or the posts last changed, by `key(x, y) * 4 + out`. */
  private walks = new Map<number, Block>();
  private walksFor = { track: -1, posts: -1 };
  /** Times the posts were re-indexed, so walks over the old ones go stale. */
  private postsBuilt = 0;
  /** `blockBeyond` without a path, from a post at (x, y) facing `out`; kept while nothing changes. */
  private walk(x: number, y: number, out: Dir): Block {
    if (this.walksFor.track !== this.track.version || this.walksFor.posts !== this.postsBuilt) {
      this.walks.clear();
      this.walksFor = { track: this.track.version, posts: this.postsBuilt };
    }
    const k = this.key(x, y) * 4 + out;
    let b = this.walks.get(k);
    if (!b) {
      b = this.walkFrom(x, y, out);
      this.walks.set(k, b);
    }
    return b;
  }
  private walkFrom(x: number, y: number, dir: Dir): Block {
    const tiles: { x: number; y: number }[] = [];
    let entry = opposite(dir);
    let out: Dir | undefined = dir;
    const seen = new Set<string>();
    for (let n = 0; n < this.track.w * this.track.h && out !== undefined; n++) {
      const key = `${x},${y},${out}`;
      if (seen.has(key)) break;
      seen.add(key);
      if (!this.track.connected(x, y, out)) break;
      x += DIR_DX[out];
      y += DIR_DY[out];
      entry = opposite(out);
      tiles.push({ x, y });
      const exits = this.track.exits(x, y, entry);
      out = exits.find((e) => e === opposite(entry)) ?? exits[0];
      if (out !== undefined) {
        const next = this.governs(x, y, out);
        if (next) return { tiles, next };
      }
    }
    return { tiles, next: null };
  }
  /** Every post's own aspect by post key, as `postAspects` last left it. */
  private shown = new Map<number, Aspect>();
  /** tile key -> keys of the posts whose own aspect looks at it (its block and the next one) */
  private watchers = new Map<number, number[]>();
  /** the taken tiles `shown` was worked out for */
  private shownTaken = new Set<number>();
  private shownFor = { track: -1, posts: -1 };
  /**
   * Every post's own aspect (`aspect` without a path) by post key, for the tiles in `taken` (tile
   * keys trains stand on). Kept between calls: only the posts whose block, or the block after it,
   * holds a tile that was taken or freed since the last call are looked at again, and all of them
   * once the track or the posts change.
   */
  postAspects(taken: {
    has(key: number): boolean;
    keys(): Iterable<number>;
  }): ReadonlyMap<number, Aspect> {
    const occupied = (x: number, y: number) => taken.has(this.key(x, y));
    if (this.shownFor.track !== this.track.version || this.shownFor.posts !== this.postsBuilt) {
      this.shownFor = { track: this.track.version, posts: this.postsBuilt };
      this.shown.clear();
      this.watchers.clear();
      for (const [k, post] of this.posts) {
        const b = this.walk(post.x, post.y, post.dir);
        const tiles = b.next
          ? [...b.tiles, ...this.walk(b.next.x, b.next.y, b.next.dir).tiles]
          : b.tiles;
        for (const t of tiles) {
          const tk = this.key(t.x, t.y);
          const list = this.watchers.get(tk);
          if (!list) this.watchers.set(tk, [k]);
          else if (list[list.length - 1] !== k) list.push(k);
        }
        this.shown.set(k, this.aspect(post, occupied));
      }
      this.shownTaken = new Set(taken.keys());
      return this.shown;
    }
    const again = new Set<number>();
    const changed = (tk: number) => {
      for (const k of this.watchers.get(tk) ?? []) again.add(k);
    };
    for (const tk of taken.keys())
      if (!this.shownTaken.has(tk)) {
        this.shownTaken.add(tk);
        changed(tk);
      }
    for (const tk of this.shownTaken)
      if (!taken.has(tk)) {
        this.shownTaken.delete(tk);
        changed(tk);
      }
    for (const k of again) this.shown.set(k, this.aspect(this.posts.get(k)!, occupied));
    return this.shown;
  }
  /** Aspect a post shows for the route (a train's path, or the straight continuation). */
  aspect(
    post: SignalPost,
    occupied: (x: number, y: number) => boolean,
    path?: readonly { x: number; y: number; in: Dir; out: Dir }[],
  ): Aspect {
    const taken = (b: Block) => b.tiles.some((t) => occupied(t.x, t.y));
    const block = (p: SignalPost) =>
      path ? this.blockBeyond(p, path) : this.walk(p.x, p.y, p.dir);
    const b = block(post);
    if (taken(b)) return 'red';
    if (b.next && taken(block(b.next))) return 'yellow';
    return 'green';
  }
  /**
   * Along a train's remaining path: arc of the first signal at danger (the train must stop
   * before its guarded tile) and the arc of the next signal ahead when it shows caution (the
   * train must be able to stop there).
   *
   * Each post's aspect is `aspect(post, occupied, path)`; the path is walked once: the posts on it
   * and the first place each governs are found in one pass, and each block is checked at most
   * once.
   */
  ahead(
    path: readonly { x: number; y: number; in: Dir; out: Dir; arc: number }[],
    occupied: (x: number, y: number) => boolean,
  ): { stopArc: number | null; cautionArc: number | null } {
    // where posts govern the path, and the first such place of each post (`blockBeyond`'s
    // findIndex): a post matches only where it governs
    const at: number[] = [];
    const first = new Map<number, number>();
    for (let i = 0; i < path.length; i++) {
      const s = path[i];
      if (!this.governs(s.x, s.y, s.out)) continue;
      at.push(i);
      const k = this.key(s.x, s.y) * 4 + s.out;
      if (!first.has(k)) first.set(k, i);
    }
    if (!at.length) return { stopArc: null, cautionArc: null };
    // the block beyond the post governing path[i], as `blockBeyond(post, path)` finds it: path
    // tiles up to the next post on the path, or to its end and on along the track
    const nextAt = new Map<number, number>();
    for (let n = 0; n + 1 < at.length; n++) nextAt.set(at[n], at[n + 1]);
    // `blockBeyond` takes at most this many path tiles before it goes on from the path's end
    const cap = this.track.w * this.track.h;
    const nextIn = (i: number) => {
      const q = nextAt.get(i);
      return q !== undefined && q - i <= cap ? q : undefined;
    };
    const tail = path[path.length - 1];
    const takenFrom = new Map<number, boolean>();
    const onPathTaken = (i: number) => {
      let t = takenFrom.get(i);
      if (t === undefined) {
        const q = nextIn(i);
        const end = q ?? Math.min(path.length - 1, i + cap);
        t = false;
        for (let j = i + 1; j <= end && !t; j++) t = occupied(path[j].x, path[j].y);
        if (!t && q === undefined)
          t = this.walk(tail.x, tail.y, tail.out).tiles.some((p) => occupied(p.x, p.y));
        takenFrom.set(i, t);
      }
      return t;
    };
    const nextOf = (i: number): SignalPost | null => {
      const q = nextIn(i);
      if (q !== undefined) return this.governs(path[q].x, path[q].y, path[q].out);
      return this.walk(tail.x, tail.y, tail.out).next;
    };
    const firstOf = (p: SignalPost) => first.get(this.key(p.x, p.y) * 4 + p.dir);
    const taken = (p: SignalPost) => {
      const i = firstOf(p);
      if (i !== undefined) return onPathTaken(i);
      return this.walk(p.x, p.y, p.dir).tiles.some((t) => occupied(t.x, t.y));
    };
    let stopArc: number | null = null;
    let cautionArc: number | null = null;
    for (const i of at) {
      const s = path[i];
      const post = this.governs(s.x, s.y, s.out)!;
      // the post's own block: from where it first governs the path
      const j = firstOf(post)!;
      let a: Aspect = 'green';
      if (onPathTaken(j)) a = 'red';
      else {
        const n = nextOf(j);
        if (n && taken(n)) a = 'yellow';
      }
      const next = path[i + 1];
      const arc = next ? next.arc : s.arc + 1;
      if (a === 'red') {
        stopArc = arc;
        break;
      }
      if (a === 'yellow' && cautionArc === null) cautionArc = arc;
    }
    return { stopArc, cautionArc };
  }
}

/** A block: its tiles and the post at its far end, if any. */
interface Block {
  readonly tiles: readonly { x: number; y: number }[];
  readonly next: SignalPost | null;
}
