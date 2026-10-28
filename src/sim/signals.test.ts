import { describe, it, expect } from 'vitest';
import { TrackGraph } from '../world/track';
import { Dir, DIR_DX, DIR_DY, opposite } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { forAll } from '../testing/property';
import { Signals, type Aspect, type SignalPost } from './signals';

type Step = { x: number; y: number; in: Dir; out: Dir; arc: number };

/**
 * The evaluation `Signals` had before it walked a path once: `blockBeyond` searches the path from
 * its start for every post and dedupes with `some`, and `ahead` asks `aspect` of every post on the
 * path. It is the oracle the faster code must agree with.
 */
class Oracle {
  constructor(
    private readonly s: Signals,
    private readonly track: TrackGraph,
  ) {}
  blockBeyond(
    post: SignalPost,
    path?: readonly Step[],
  ): { tiles: { x: number; y: number }[]; next: SignalPost | null } {
    const tiles: { x: number; y: number }[] = [];
    if (path) {
      const i = path.findIndex((s) => s.x === post.x && s.y === post.y && s.out === post.dir);
      if (i >= 0) {
        for (let j = i + 1; j < path.length && tiles.length < this.track.w * this.track.h; j++) {
          const s = path[j];
          tiles.push({ x: s.x, y: s.y });
          const next = this.s.governs(s.x, s.y, s.out);
          if (next) return { tiles, next };
        }
        const tail = path[path.length - 1];
        if (tail) {
          const onward = this.blockBeyond({ x: tail.x, y: tail.y, dir: tail.out });
          for (const t of onward.tiles)
            if (!tiles.some((p) => p.x === t.x && p.y === t.y)) tiles.push(t);
          return { tiles, next: onward.next };
        }
        return { tiles, next: null };
      }
    }
    let x = post.x;
    let y = post.y;
    let entry = opposite(post.dir);
    let out: Dir | undefined = post.dir;
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
        const next = this.s.governs(x, y, out);
        if (next) return { tiles, next };
      }
    }
    return { tiles, next: null };
  }
  aspect(
    post: SignalPost,
    occupied: (x: number, y: number) => boolean,
    path?: readonly Step[],
  ): Aspect {
    const b = this.blockBeyond(post, path);
    if (b.tiles.some((t) => occupied(t.x, t.y))) return 'red';
    if (b.next) {
      const b2 = this.blockBeyond(b.next, path);
      if (b2.tiles.some((t) => occupied(t.x, t.y))) return 'yellow';
    }
    return 'green';
  }
  ahead(path: readonly Step[], occupied: (x: number, y: number) => boolean) {
    let stopArc: number | null = null;
    let cautionArc: number | null = null;
    for (let i = 0; i < path.length; i++) {
      const s = path[i];
      const post = this.s.governs(s.x, s.y, s.out);
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

/** A line along row 1 from x 1 to `len`, posts on it, a run along it and the tiles trains hold. */
interface Layout {
  len: number;
  /** a second line on row 3 joined by nothing, so walks from it stay on it */
  spur: boolean;
  posts: { x: number; y: number; dir: Dir }[];
  /** the run's tiles: x on row 1 and the way it goes there; it may turn back and run on again */
  run: { x: number; east: boolean }[];
  taken: number[];
}

const W = 64;

function draw(rng: Rng): Layout {
  const len = rng.int(3, W - 2);
  const posts: Layout['posts'] = [];
  const at = new Set<number>();
  for (let n = rng.int(0, 12); n > 0; n--) {
    const x = rng.int(1, len);
    if (at.has(x)) continue;
    at.add(x);
    posts.push({ x, y: 1, dir: rng.chance(0.5) ? Dir.E : Dir.W });
  }
  const spur = rng.chance(0.3);
  if (spur) posts.push({ x: rng.int(1, 8), y: 3, dir: Dir.E });
  // a run that may turn back now and then, so a tile can be run the same way twice
  const run: Layout['run'] = [];
  let x = rng.int(1, len);
  let east = rng.chance(0.5);
  for (let n = rng.int(0, 3 * len); n > 0; n--) {
    run.push({ x, east });
    if (rng.chance(0.08)) east = !east;
    const nx = x + (east ? 1 : -1);
    if (nx < 1 || nx > len) east = !east;
    else x = nx;
  }
  const taken = Array.from({ length: rng.int(0, 6) }, () => rng.int(0, len + 1));
  return { len, spur, posts, run, taken };
}

function build(l: Layout) {
  const track = new TrackGraph(W, 6);
  for (let x = 1; x <= l.len; x++) track.place(x, 1, 'straight', 1);
  if (l.spur) for (let x = 1; x <= 10; x++) track.place(x, 3, 'straight', 1);
  const signals = new Signals(track);
  signals.rebuild(l.posts.map((p) => ({ id: 'signal', x: p.x, y: p.y, rot: p.dir })) as never);
  const path: Step[] = l.run.map((s, i) => ({
    x: s.x,
    y: 1,
    in: s.east ? Dir.W : Dir.E,
    out: s.east ? Dir.E : Dir.W,
    arc: i,
  }));
  const taken = new Set(l.taken);
  const occupied = (x: number, y: number) => y === 1 && taken.has(x);
  return { track, signals, path, occupied, oracle: new Oracle(signals, track) };
}

/** Everything `Signals` answers about a layout, against the oracle. */
function agree(l: Layout) {
  const { track, signals, path, occupied, oracle } = build(l);
  const check = () => {
    expect(signals.ahead(path, occupied)).toEqual(oracle.ahead(path, occupied));
    for (const p of l.posts) {
      const post = signals.postAt(p.x, p.y)!;
      expect(signals.aspect(post, occupied, path)).toBe(oracle.aspect(post, occupied, path));
      expect(signals.aspect(post, occupied)).toBe(oracle.aspect(post, occupied));
      expect(signals.blockBeyond(post, path)).toEqual(oracle.blockBeyond(post, path));
      expect(signals.blockBeyond(post)).toEqual(oracle.blockBeyond(post));
    }
  };
  check();
  // asked again, from the kept walks
  check();
  // the track changes under the kept walks: a tile goes, then comes back
  if (l.len > 4) {
    track.remove(Math.ceil(l.len / 2), 1);
    check();
    track.place(Math.ceil(l.len / 2), 1, 'straight', 1);
    check();
  }
  // the posts change: every one turns round
  signals.rebuild(
    l.posts.map((p) => ({ id: 'signal', x: p.x, y: p.y, rot: opposite(p.dir) })) as never,
  );
  l.posts = l.posts.map((p) => ({ ...p, dir: opposite(p.dir) }));
  check();
}

describe('signal evaluation', () => {
  it('gives the aspects, blocks and stops of the path-scanning evaluation on any line, posts and run', () => {
    forAll(draw, (l) => agree(structuredClone(l)));
  });

  it('walks a path once: a long run past many posts costs about as much per tile as a short one', () => {
    // timing is not checked here (no clocks in tests); the count of occupancy checks is
    const l: Layout = {
      len: W - 2,
      spur: false,
      posts: Array.from({ length: 12 }, (_, i) => ({ x: 2 + 5 * i, y: 1, dir: Dir.E })),
      run: Array.from({ length: 60 }, (_, i) => ({ x: 1 + i, east: true })),
      taken: [],
    };
    const { signals, path } = build(l);
    let calls = 0;
    const count = () => {
      calls++;
      return false;
    };
    signals.ahead(path, count);
    // every tile of every block is looked at once: at most the run and the walk on from its end
    expect(calls).toBeLessThanOrEqual(path.length + W);
  });
});
