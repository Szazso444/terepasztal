import { Dir, DIR_DX, DIR_DY, opposite } from '../engine/iso';
import type { TrackGraph } from './track';
import { isCurveLink } from './trackGeom';

export interface PathSegment {
  x: number;
  y: number;
  in: Dir;
  out: Dir;
  /** which route of a multi-tile piece this crossing follows (set by TrackGraph.resolveRoutes) */
  route?: number;
}

/**
 * Dijkstra over (tile, entryEdge) states. A state means "inside tile, having entered through
 * that edge". Trains cannot reverse mid-tile, so this naturally handles switches and curves.
 * Returns the segment list starting at the start tile, or null.
 */
export function findPath(
  track: TrackGraph,
  start: { x: number; y: number; in: Dir },
  isTarget: (x: number, y: number) => boolean,
  maxCost = 100000,
  avoid?: (x: number, y: number) => boolean,
): PathSegment[] | null {
  const key = (x: number, y: number, d: Dir) => (y * track.w + x) * 4 + d;
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const heap = new MinHeap();
  const sk = key(start.x, start.y, start.in);
  dist.set(sk, 0);
  heap.push(0, sk);
  let found = -1;
  while (heap.size) {
    const [d, k] = heap.pop();
    if (d > (dist.get(k) ?? Infinity)) continue;
    const dir = (k % 4) as Dir;
    const tile = Math.floor(k / 4);
    const x = tile % track.w;
    const y = Math.floor(tile / track.w);
    // target test: the tile itself is a target (train stops at its centre); but not the start tile unless moved
    if (isTarget(x, y) && k !== sk) {
      found = k;
      break;
    }
    if (d > maxCost) break;
    for (const out of track.exits(x, y, dir)) {
      const nx = x + DIR_DX[out];
      const ny = y + DIR_DY[out];
      const nin = opposite(out);
      if (!track.opensTo(nx, ny, nin)) continue;
      if (avoid && avoid(nx, ny)) continue;
      const piece = track.get(x, y)!;
      let cost = track.segLength(x, y, dir, out);
      if (piece.kind === 'switch' && isCurveLink(dir, out)) cost += 0.2;
      const nk = key(nx, ny, nin);
      const nd = d + cost;
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd);
        prev.set(nk, k);
        heap.push(nd, nk);
      }
    }
  }
  if (found < 0) return null;
  // reconstruct states
  const states: number[] = [];
  let cur = found;
  while (cur !== undefined) {
    states.push(cur);
    if (cur === sk) break;
    cur = prev.get(cur)!;
  }
  states.reverse();
  const segs: PathSegment[] = [];
  for (let i = 0; i < states.length; i++) {
    const k = states[i];
    const dir = (k % 4) as Dir;
    const tile = Math.floor(k / 4);
    const x = tile % track.w;
    const y = Math.floor(tile / track.w);
    let out: Dir;
    if (i + 1 < states.length) {
      const nk = states[i + 1];
      const nin = (nk % 4) as Dir;
      out = opposite(nin);
    } else {
      // final tile: continue straight through if possible, else pick any exit
      const exits = track.exits(x, y, dir);
      out = exits.find((e) => e === opposite(dir)) ?? exits[0] ?? opposite(dir);
    }
    segs.push({ x, y, in: dir, out });
  }
  return segs;
}

/** Walk backwards from a tile/heading to collect the tiles behind a spawn point. */
export function walkBack(
  track: TrackGraph,
  x: number,
  y: number,
  entry: Dir,
  tiles: number,
): PathSegment[] {
  const out: PathSegment[] = [];
  let cx = x;
  let cy = y;
  let cin = entry;
  for (let i = 0; i < tiles; i++) {
    // go through the edge we entered from to the previous tile
    const px = cx + DIR_DX[cin];
    const py = cy + DIR_DY[cin];
    const pOut = opposite(cin);
    if (!track.opensTo(px, py, pOut)) break;
    const exits = track.exits(px, py, pOut);
    if (!exits.length) break;
    const pIn = exits.find((e) => e === opposite(pOut)) ?? exits[0];
    out.unshift({ x: px, y: py, in: pIn, out: pOut });
    cx = px;
    cy = py;
    cin = pIn;
  }
  return out;
}

class MinHeap {
  private a: [number, number][] = [];
  get size() {
    return this.a.length;
  }
  push(p: number, v: number) {
    const a = this.a;
    a.push([p, v]);
    let i = a.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (a[j][0] <= a[i][0]) break;
      [a[i], a[j]] = [a[j], a[i]];
      i = j;
    }
  }
  pop(): [number, number] {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}
