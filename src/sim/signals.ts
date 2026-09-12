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

const BLOCK_CAP = 40;

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
    path?: { x: number; y: number; in: Dir; out: Dir }[],
  ): { tiles: { x: number; y: number }[]; next: SignalPost | null } {
    const tiles: { x: number; y: number }[] = [];
    if (path) {
      const i = path.findIndex((s) => s.x === post.x && s.y === post.y && s.out === post.dir);
      if (i >= 0) {
        for (let j = i + 1; j < path.length && tiles.length < BLOCK_CAP; j++) {
          const s = path[j];
          tiles.push({ x: s.x, y: s.y });
          const next = this.governs(s.x, s.y, s.out);
          if (next) return { tiles, next };
        }
        return { tiles, next: null };
      }
    }
    let x = post.x;
    let y = post.y;
    let entry = opposite(post.dir);
    let out: Dir | undefined = post.dir;
    for (let n = 0; n < BLOCK_CAP && out !== undefined; n++) {
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
  /** Aspect a post shows for the route (a train's path, or the straight continuation). */
  aspect(
    post: SignalPost,
    occupied: (x: number, y: number) => boolean,
    path?: { x: number; y: number; in: Dir; out: Dir }[],
  ): Aspect {
    const b = this.blockBeyond(post, path);
    if (b.tiles.some((t) => occupied(t.x, t.y))) return 'red';
    if (b.next) {
      const b2 = this.blockBeyond(b.next, path);
      if (b2.tiles.some((t) => occupied(t.x, t.y))) return 'yellow';
    }
    return 'green';
  }
  /**
   * Along a train's remaining path: arc of the first signal at danger (the train must stop
   * before its guarded tile) and the arc of the next signal ahead when it shows caution (the
   * train must be able to stop there).
   */
  ahead(
    path: { x: number; y: number; in: Dir; out: Dir; arc: number }[],
    occupied: (x: number, y: number) => boolean,
  ): { stopArc: number | null; cautionArc: number | null } {
    let stopArc: number | null = null;
    let cautionArc: number | null = null;
    for (let i = 0; i < path.length; i++) {
      const s = path[i];
      const post = this.governs(s.x, s.y, s.out);
      if (!post) continue;
      const a = this.aspect(post, occupied, path);
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
