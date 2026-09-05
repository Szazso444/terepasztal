import { Dir, rotateDir, opposite, DIR_DX, DIR_DY } from '../engine/iso';
import trackData from '../data/track.json';

export type TrackKind = 'straight' | 'curve' | 'switch' | 'crossing' | 'bridge';
export const TRACK_KINDS: TrackKind[] = ['straight', 'curve', 'switch', 'crossing', 'bridge'];
export type Link = [Dir, Dir];

export interface TrackPiece {
  kind: TrackKind;
  rot: number;
  links: Link[];
}

const BASE: Record<TrackKind, Link[][]> = {
  straight: [[[Dir.N, Dir.S]]],
  bridge: [[[Dir.N, Dir.S]]],
  curve: [[[Dir.N, Dir.E]]],
  crossing: [
    [
      [Dir.N, Dir.S],
      [Dir.E, Dir.W],
    ],
  ],
  // two mirror families of 4 rotations each
  switch: [
    [
      [Dir.N, Dir.S],
      [Dir.N, Dir.E],
    ],
    [
      [Dir.N, Dir.S],
      [Dir.N, Dir.W],
    ],
  ],
};

export function rotationCount(kind: TrackKind): number {
  return trackData.pieces[kind].rotations;
}

export function pieceLinks(kind: TrackKind, rot: number): Link[] {
  const n = rotationCount(kind);
  rot = ((rot % n) + n) % n;
  const families = BASE[kind];
  const fam = families[Math.floor(rot / 4) % families.length];
  const steps = rot % 4;
  return fam.map(([a, b]) => [rotateDir(a, steps), rotateDir(b, steps)] as Link);
}

export function makePiece(kind: TrackKind, rot: number): TrackPiece {
  return { kind, rot, links: pieceLinks(kind, rot) };
}

export function pieceCost(kind: TrackKind) {
  return trackData.pieces[kind].cost;
}

export function isSwitch(p: TrackPiece) {
  return p.kind === 'switch';
}

/** The rail network: one piece per tile. Connectivity is implicit from link directions. */
export class TrackGraph {
  readonly pieces = new Map<number, TrackPiece>();
  version = 0;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {}
  key(x: number, y: number) {
    return y * this.w + x;
  }
  get(x: number, y: number): TrackPiece | undefined {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return undefined;
    return this.pieces.get(this.key(x, y));
  }
  set(x: number, y: number, p: TrackPiece) {
    this.pieces.set(this.key(x, y), p);
    this.version++;
  }
  remove(x: number, y: number) {
    this.pieces.delete(this.key(x, y));
    this.version++;
  }
  has(x: number, y: number) {
    return this.pieces.has(this.key(x, y));
  }
  /** Does the piece at (x,y) have a link touching edge d? */
  opensTo(x: number, y: number, d: Dir): boolean {
    const p = this.get(x, y);
    if (!p) return false;
    return p.links.some(([a, b]) => a === d || b === d);
  }
  /** Is the edge d of tile (x,y) connected to matching track on the neighbour? */
  connected(x: number, y: number, d: Dir): boolean {
    return this.opensTo(x, y, d) && this.opensTo(x + DIR_DX[d], y + DIR_DY[d], opposite(d));
  }
  /** Exits reachable when entering tile (x,y) through edge `entry`. */
  exits(x: number, y: number, entry: Dir): Dir[] {
    const p = this.get(x, y);
    if (!p) return [];
    const out: Dir[] = [];
    for (const [a, b] of p.links) {
      if (a === entry) out.push(b);
      else if (b === entry) out.push(a);
    }
    return out;
  }
  *tiles(): IterableIterator<{ x: number; y: number; piece: TrackPiece }> {
    for (const [k, piece] of this.pieces) yield { x: k % this.w, y: Math.floor(k / this.w), piece };
  }
}
