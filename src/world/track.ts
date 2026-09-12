import { Dir, rotateDir, opposite, DIR_DX, DIR_DY, type Vec2 } from '../engine/iso';
import { content, type Cost } from '../data/content';
import { rules } from '../sim/rules';
import { linkPoints, linkLength, isCurveLink, unitDef, type MemberLink } from './trackGeom';

const trackData = content.track;

/** Track classes. Everything about a class derives from `n`: curve footprint n×n, radius n − 0.5, cost. */
export type TrackClass = 'regular' | 'high_speed';
export const TRACK_CLASSES: TrackClass[] = ['regular', 'high_speed'];
export const CLASS_N: Record<TrackClass, number> = { regular: 1, high_speed: 2 };
export function classRadius(cls: TrackClass) {
  return CLASS_N[cls] - 0.5;
}
/** Cost multiplier of a class: `n`, plus half again above regular. */
export function classCostMul(cls: TrackClass) {
  const n = CLASS_N[cls];
  return n === 1 ? 1 : n * 1.5;
}

export type TrackKind = 'straight' | 'curve' | 'switch' | 'crossing' | 'bridge' | 'transition';
export const TRACK_KINDS: TrackKind[] = [
  'straight',
  'curve',
  'switch',
  'crossing',
  'bridge',
  'transition',
];
export type Link = [Dir, Dir];

/** A buildable entry: kind plus class (crossings carry a class per axis). */
export interface TrackItem {
  kind: TrackKind;
  cls: TrackClass;
  cls2?: TrackClass;
}
export const TRACK_ITEMS: TrackItem[] = [
  { kind: 'straight', cls: 'regular' },
  { kind: 'curve', cls: 'regular' },
  { kind: 'switch', cls: 'regular' },
  { kind: 'crossing', cls: 'regular', cls2: 'regular' },
  { kind: 'bridge', cls: 'regular' },
  { kind: 'transition', cls: 'regular' },
  { kind: 'straight', cls: 'high_speed' },
  { kind: 'curve', cls: 'high_speed' },
  { kind: 'switch', cls: 'high_speed' },
  { kind: 'crossing', cls: 'regular', cls2: 'high_speed' },
  { kind: 'crossing', cls: 'high_speed', cls2: 'high_speed' },
  { kind: 'bridge', cls: 'high_speed' },
];
export function itemKey(it: TrackItem) {
  return it.kind === 'crossing'
    ? `${it.kind}_${it.cls}_${it.cls2 ?? it.cls}`
    : `${it.kind}_${it.cls}`;
}

export interface TrackPiece {
  kind: TrackKind;
  rot: number;
  cls: TrackClass;
  /** crossings: class of the second axis (the E–W link at rotation 0) */
  cls2?: TrackClass;
  links: Link[];
  /** part of a multi-tile piece: anchor tile and member index */
  unit?: { ax: number; ay: number; member: number };
}

const BASE: Record<TrackKind, Link[][]> = {
  straight: [[[Dir.N, Dir.S]]],
  bridge: [[[Dir.N, Dir.S]]],
  transition: [[[Dir.N, Dir.S]]],
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
  return trackData.pieces[kind]?.rotations ?? (kind === 'transition' ? 2 : 1);
}

export function pieceLinks(kind: TrackKind, rot: number): Link[] {
  const n = rotationCount(kind);
  rot = ((rot % n) + n) % n;
  const families = BASE[kind];
  const fam = families[Math.floor(rot / 4) % families.length];
  const steps = rot % 4;
  return fam.map(([a, b]) => [rotateDir(a, steps), rotateDir(b, steps)] as Link);
}

/** Curves and switches of classes above regular span n × n tiles. */
export function isUnitKind(kind: TrackKind, cls: TrackClass) {
  return (kind === 'curve' || kind === 'switch') && CLASS_N[cls] > 1;
}

export function makePiece(
  kind: TrackKind,
  rot: number,
  cls: TrackClass = 'regular',
  cls2?: TrackClass,
): TrackPiece {
  const p: TrackPiece = { kind, rot, cls, links: pieceLinks(kind, rot) };
  if (kind === 'crossing') p.cls2 = cls2 ?? cls;
  return p;
}

/** Ratio matrix from track.json, scaled by class and the global track cost scale. */
export function pieceCost(kind: TrackKind, cls: TrackClass = 'regular', cls2?: TrackClass): Cost {
  const base = trackData.pieces[kind]?.cost ?? trackData.pieces.straight.cost;
  const top = cls2 && CLASS_N[cls2] > CLASS_N[cls] ? cls2 : cls;
  const mul = classCostMul(top) * rules.trackCostScale;
  const out: Cost = {};
  for (const [k, v] of Object.entries(base)) out[k] = Math.max(1, Math.round(v * mul));
  return out;
}

export function isSwitch(p: TrackPiece) {
  return p.kind === 'switch';
}

/** Class a piece presents on edge `d`; transitions match anything. */
export function portClass(p: TrackPiece, d: Dir): TrackClass | 'any' {
  if (p.kind === 'transition') return 'any';
  if (p.kind === 'crossing') {
    const second = p.links[1];
    if (second && (second[0] === d || second[1] === d)) return p.cls2 ?? p.cls;
  }
  return p.cls;
}
export function classesJoin(a: TrackClass | 'any', b: TrackClass | 'any') {
  return a === 'any' || b === 'any' || a === b;
}

/** Tiles a piece would cover if its anchor were at (x,y). */
export function footprintOf(
  x: number,
  y: number,
  kind: TrackKind,
  rot: number,
  cls: TrackClass = 'regular',
): { x: number; y: number }[] {
  if (!isUnitKind(kind, cls)) return [{ x, y }];
  const def = unitDef(kind as 'curve' | 'switch', CLASS_N[cls], rot);
  return def.members.map((m) => ({ x: x + m.dx, y: y + m.dy }));
}

/** Frame name of a piece's sprite. */
export function pieceFrame(p: TrackPiece): string {
  const base =
    p.kind === 'crossing'
      ? `track/crossing_${p.cls}_${p.cls2 ?? p.cls}_${p.rot}`
      : `track/${p.kind}_${p.cls}_${p.rot}`;
  return p.unit ? `${base}_m${p.unit.member}` : base;
}

/** The rail network: one piece per tile; multi-tile pieces store one member piece per tile. */
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
  /** Low-level: write one tile (1×1 pieces). Prefer `place`. */
  set(x: number, y: number, p: TrackPiece) {
    this.pieces.set(this.key(x, y), p);
    this.version++;
  }
  /** Low-level: clear one tile. Prefer `removeAt`. */
  remove(x: number, y: number) {
    this.pieces.delete(this.key(x, y));
    this.version++;
  }
  has(x: number, y: number) {
    return this.pieces.has(this.key(x, y));
  }
  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  /**
   * Place a piece with its anchor at (x,y). Multi-tile pieces write every member tile; the
   * blocked inner tiles get a piece with no links. Returns the tiles written.
   */
  place(
    x: number,
    y: number,
    kind: TrackKind,
    rot: number,
    cls: TrackClass = 'regular',
    cls2?: TrackClass,
  ): { x: number; y: number }[] {
    if (!isUnitKind(kind, cls)) {
      this.set(x, y, makePiece(kind, rot, cls, cls2));
      return [{ x, y }];
    }
    const def = unitDef(kind as 'curve' | 'switch', CLASS_N[cls], rot);
    const out: { x: number; y: number }[] = [];
    def.members.forEach((m, i) => {
      const mx = x + m.dx;
      const my = y + m.dy;
      if (!this.inBounds(mx, my)) return;
      const links: Link[] = [];
      for (const l of m.links)
        if (!links.some(([a, b]) => (a === l.in && b === l.out) || (a === l.out && b === l.in)))
          links.push([l.in, l.out]);
      this.pieces.set(this.key(mx, my), {
        kind,
        rot,
        cls,
        links,
        unit: { ax: x, ay: y, member: i },
      });
      out.push({ x: mx, y: my });
    });
    this.version++;
    return out;
  }
  /** Remove the piece covering (x,y), whole unit included. Returns the tiles cleared. */
  removeAt(x: number, y: number): { x: number; y: number }[] {
    const p = this.get(x, y);
    if (!p) return [];
    const tiles = this.unitTiles(x, y);
    for (const t of tiles) this.pieces.delete(this.key(t.x, t.y));
    this.version++;
    return tiles;
  }
  /** Every tile of the piece covering (x,y) (just the tile itself for 1×1 pieces). */
  unitTiles(x: number, y: number): { x: number; y: number }[] {
    const p = this.get(x, y);
    if (!p) return [];
    if (!p.unit) return [{ x, y }];
    return footprintOf(p.unit.ax, p.unit.ay, p.kind, p.rot, p.cls).filter((t) => {
      const q = this.get(t.x, t.y);
      return q?.unit && q.unit.ax === p.unit!.ax && q.unit.ay === p.unit!.ay;
    });
  }
  /** Anchor piece of the piece covering (x,y): the tile that is saved. */
  anchorOf(x: number, y: number): { x: number; y: number } {
    const p = this.get(x, y);
    return p?.unit ? { x: p.unit.ax, y: p.unit.ay } : { x, y };
  }
  /** Per-tile geometry of a member of a multi-tile piece (null for 1×1 pieces). */
  memberLinks(x: number, y: number): MemberLink[] | null {
    const p = this.get(x, y);
    if (!p?.unit) return null;
    return unitDef(p.kind as 'curve' | 'switch', CLASS_N[p.cls], p.rot).members[p.unit.member]
      .links;
  }
  /** Does the piece at (x,y) have a link touching edge d? */
  opensTo(x: number, y: number, d: Dir): boolean {
    const p = this.get(x, y);
    if (!p) return false;
    return p.links.some(([a, b]) => a === d || b === d);
  }
  /** Is the edge d of tile (x,y) connected to matching track of a compatible class on the neighbour? */
  connected(x: number, y: number, d: Dir): boolean {
    if (!this.opensTo(x, y, d)) return false;
    const nx = x + DIR_DX[d];
    const ny = y + DIR_DY[d];
    if (!this.opensTo(nx, ny, opposite(d))) return false;
    const p = this.get(x, y)!;
    const q = this.get(nx, ny)!;
    if (p.unit && q.unit && p.unit.ax === q.unit.ax && p.unit.ay === q.unit.ay) return true;
    return classesJoin(portClass(p, d), portClass(q, opposite(d)));
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
  /**
   * Geometry of one tile crossing from `in` to `out`: points relative to the tile centre, arc
   * length and curve radius. Member tiles of a multi-tile piece use their own polylines; where two
   * routes share a tile with the same edges (a switch's throat) `routeHint` picks the one meant.
   */
  segGeom(
    x: number,
    y: number,
    inDir: Dir,
    outDir: Dir,
    routeHint?: number,
    samples = 8,
  ): { pts: Vec2[]; len: number; radius: number | null; route: number | null } {
    const ml = this.memberLinks(x, y);
    if (ml) {
      const fits = ml.filter(
        (l) => (l.in === inDir && l.out === outDir) || (l.in === outDir && l.out === inDir),
      );
      if (fits.length) {
        const pick = fits.find((l) => l.route === routeHint) ?? fits[0];
        const pts = pick.in === inDir ? pick.pts : [...pick.pts].reverse();
        return { pts, len: pick.len, radius: pick.radius, route: pick.route };
      }
    }
    const radius = isCurveLink(inDir, outDir) ? 0.5 : null;
    return {
      pts: linkPoints(inDir, outDir, samples),
      len: linkLength(inDir, outDir),
      radius,
      route: null,
    };
  }
  /**
   * Fill in `route` for path segments inside multi-tile pieces. Where a tile's edges fit two
   * routes (a switch's throat) the route shared with the neighbouring segments of the same piece
   * wins, so the throat draws the arc when the path diverges and the straight when it does not.
   */
  resolveRoutes(path: { x: number; y: number; in: Dir; out: Dir; route?: number }[]) {
    for (let i = 0; i < path.length; i++) {
      const seg = path[i];
      const p = this.get(seg.x, seg.y);
      const ml = p?.unit ? this.memberLinks(seg.x, seg.y) : null;
      if (!ml || !p?.unit) {
        seg.route = undefined;
        continue;
      }
      const fits = ml.filter(
        (l) => (l.in === seg.in && l.out === seg.out) || (l.in === seg.out && l.out === seg.in),
      );
      if (fits.length <= 1) {
        seg.route = fits[0]?.route;
        continue;
      }
      const candidates = new Set(fits.map((l) => l.route));
      for (const j of [i + 1, i - 1]) {
        const o = path[j];
        if (!o) continue;
        const q = this.get(o.x, o.y);
        if (!q?.unit || q.unit.ax !== p.unit.ax || q.unit.ay !== p.unit.ay) continue;
        const oml = this.memberLinks(o.x, o.y) ?? [];
        const routes = oml
          .filter((l) => (l.in === o.in && l.out === o.out) || (l.in === o.out && l.out === o.in))
          .map((l) => l.route);
        const shared = routes.find((r) => candidates.has(r));
        if (shared !== undefined) {
          seg.route = shared;
          break;
        }
      }
      if (seg.route === undefined) seg.route = fits[0].route;
    }
  }
  /** Shortest crossing length of a tile from `in` to `out` (for path costs). */
  segLength(x: number, y: number, inDir: Dir, outDir: Dir): number {
    const ml = this.memberLinks(x, y);
    if (ml) {
      let best = Infinity;
      for (const l of ml)
        if ((l.in === inDir && l.out === outDir) || (l.in === outDir && l.out === inDir))
          best = Math.min(best, l.len);
      if (best < Infinity) return best;
    }
    return linkLength(inDir, outDir);
  }
  *tiles(): IterableIterator<{ x: number; y: number; piece: TrackPiece }> {
    for (const [k, piece] of this.pieces) yield { x: k % this.w, y: Math.floor(k / this.w), piece };
  }
  /** Anchor tiles only: what a save stores. */
  *anchors(): IterableIterator<{ x: number; y: number; piece: TrackPiece }> {
    for (const t of this.tiles()) if (!t.piece.unit || t.piece.unit.member === 0) yield t;
  }
}
