import { describe, it, expect } from 'vitest';
import { Dir, DIRS, DIR_DX, DIR_DY, opposite } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
import { findPath, type PathSegment } from './pathfinding';
import {
  CLASS_N,
  TrackGraph,
  footprintOf,
  makePiece,
  pieceLinks,
  rotationCount,
  type TrackPiece,
} from './track';
import { isCurveLink, linkLength, unitDef, type SwitchForm } from './trackGeom';

// Properties of findPath on small seeded layouts, checked against an exhaustive search over
// (tile, entry) states. Every layout keeps to one class and has no transition pieces, so opensTo
// and connected() agree on it: nothing here says whether a path may cross a class or gauge break.

/** Narrow: every piece 1×1. Regular: straights and crossings 1×1, curves and switches 2×2. */
type Family = 'narrow' | 'regular';
type Kind = 'straight' | 'curve' | 'switch' | 'crossing';

interface Tile {
  x: number;
  y: number;
}

/** Inside tile (x, y), having entered through edge `in`: what findPath searches over. */
interface State extends Tile {
  in: Dir;
}

/** One placement; placements apply in order, so a later one overwrites the tiles it covers. */
interface Lay extends Tile {
  kind: Kind;
  rot: number;
  /** regular switches only */
  form?: SwitchForm;
}

/** access refuses entering a piece of this kind and rotation through this edge. */
interface Deny {
  kind: Kind;
  rot: number;
  entry: Dir;
}

interface Case {
  family: Family;
  w: number;
  h: number;
  lays: Lay[];
  start: State;
  targets: Tile[];
  /** present in cases run with callbacks: the tiles avoid rejects */
  avoid?: Tile[];
  /** present in cases run with callbacks: the entries access refuses */
  deny?: Deny[];
}

const EDGE = 'NESW';
/** The side of a regular curve's or switch's block. */
const N = CLASS_N.regular;
const KINDS: readonly Kind[] = ['straight', 'curve', 'switch'];

// ---------------------------------------------------------------------------------- layouts

function isUnit(family: Family, kind: Kind) {
  return family === 'regular' && (kind === 'curve' || kind === 'switch');
}

/** Narrow pieces and regular 1×1 pieces go down with set(), regular 2×2 pieces with place(). */
function layOn(g: TrackGraph, family: Family, l: Lay) {
  if (isUnit(family, l.kind)) g.place(l.x, l.y, l.kind, l.rot, 'regular', undefined, l.form);
  else g.set(l.x, l.y, makePiece(l.kind, l.rot, family));
}

function build(c: Case): TrackGraph {
  const g = new TrackGraph(c.w, c.h);
  for (const l of c.lays) layOn(g, c.family, l);
  return g;
}

function footprint(family: Family, l: Lay): Tile[] {
  return footprintOf(l.x, l.y, l.kind, l.rot, family);
}

/** The edges a piece has track on. */
function edgesOf(p: TrackPiece): Dir[] {
  return DIRS.filter((d) => p.links.some(([a, b]) => a === d || b === d));
}

const keyOf = (s: State) => `${s.x},${s.y},${s.in}`;
const tileKey = (t: Tile) => `${t.x},${t.y}`;

/** Where a train in `s` can go: out through an exit of its piece, into a tile that opens back. */
function nextStates(g: TrackGraph, s: State): State[] {
  return g
    .exits(s.x, s.y, s.in)
    .filter((o) => g.opensTo(s.x + DIR_DX[o], s.y + DIR_DY[o], opposite(o)))
    .map((o) => ({ x: s.x + DIR_DX[o], y: s.y + DIR_DY[o], in: opposite(o) }));
}

// ---------------------------------------------------------------------------------- costs

/** The cost of crossing tile (x, y) from edge `inDir` to edge `outDir`. */
type StepCost = (g: TrackGraph, x: number, y: number, inDir: Dir, outDir: Dir) => number;

const curvePenalty: StepCost = (g, x, y, i, o) =>
  g.get(x, y)!.kind === 'switch' && isCurveLink(i, o) ? 0.2 : 0;

/** findPath's step cost: the tile's crossing length, plus 0.2 for a switch's curve link. */
const stepCost: StepCost = (g, x, y, i, o) => g.segLength(x, y, i, o) + curvePenalty(g, x, y, i, o);

// Costs a search could plausibly use by mistake: the generator sets targets they rank wrongly.
/** The switch penalty left out. */
const rawLength: StepCost = (g, x, y, i, o) => g.segLength(x, y, i, o);
/** 2×2 pieces crossed as if made of one-tile links. */
const oneTileLength: StepCost = (g, x, y, i, o) => linkLength(i, o) + curvePenalty(g, x, y, i, o);
/** One per tile. */
const tileCount: StepCost = () => 1;

// ------------------------------------------------------------------------- the generator

const pairOf = (a: Dir, b: Dir) => (a < b ? `${a}${b}` : `${b}${a}`);

/** Every 1×1 piece by the edge pairs it links. */
const PIECES = (['straight', 'curve', 'switch', 'crossing'] as const).flatMap((kind) =>
  Array.from({ length: rotationCount(kind) }, (_, rot) => ({
    kind,
    rot,
    pairs: pieceLinks(kind, rot).map(([a, b]) => pairOf(a, b)),
  })),
);

/** A route through a 2×2 piece as text: each member's edge pairs on that route. */
function routeShape(kind: 'curve' | 'switch', rot: number, route: number) {
  const members = unitDef(kind, N, rot, 'turn').members;
  return members
    .map((m) => m.links.filter((l) => l.route === route).map((l) => pairOf(l.in, l.out)))
    .join('/');
}

/** For each 2×2 curve rotation, the turn switch rotations whose diverging lane is that arc. */
const SWITCHES_ON_ARC: number[][] = [0, 1, 2, 3].map((rot) =>
  [0, 1, 2, 3, 4, 5, 6, 7].filter(
    (s) => routeShape('switch', s, 1) === routeShape('curve', rot, 0),
  ),
);

/**
 * Turn switches that sit on a side of a regular loop with their arc turning in: on the left and
 * right sides the arc leaves the block on row `anchor y + at`, on the top and bottom on column
 * `anchor x + at`.
 */
const SIDE_SWITCHES = {
  left: [
    { rot: 0, at: 1 },
    { rot: 6, at: 0 },
  ],
  right: [
    { rot: 4, at: 1 },
    { rot: 2, at: 0 },
  ],
  top: [
    { rot: 1, at: 0 },
    { rot: 7, at: 1 },
  ],
  bottom: [
    { rot: 5, at: 0 },
    { rot: 3, at: 1 },
  ],
};

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * A loop's bounds. Regular loops mostly sit on the grid of 2×2 blocks, where two loops that meet
 * line up one's straights with the other's arcs; half the time a loop takes one side's line, or
 * two opposite sides' lines, from an earlier loop, so the two meet.
 */
function loopRect(rng: Rng, family: Family, w: number, h: number, others: Rect[]): Rect | null {
  const span = family === 'narrow' ? 1 : 2 * N - 1;
  if (w <= span || h <= span) return null;
  let r: Rect;
  if (family === 'regular' && rng.chance(0.8)) {
    const [cw, ch] = [w >> 1, h >> 1];
    const [i0, j0] = [rng.int(0, cw - 2), rng.int(0, ch - 2)];
    const [i1, j1] = [rng.int(i0 + 1, cw - 1), rng.int(j0 + 1, ch - 1)];
    r = { x0: 2 * i0, y0: 2 * j0, x1: 2 * i1 + 1, y1: 2 * j1 + 1 };
  } else {
    const x0 = rng.int(0, w - 1 - span);
    const y0 = rng.int(0, h - 1 - span);
    r = { x0, y0, x1: rng.int(x0 + span, w - 1), y1: rng.int(y0 + span, h - 1) };
  }
  if (others.length && rng.chance(0.5)) {
    const o = rng.pick(others);
    const keys = rng.pick([['x0'], ['y0'], ['x1'], ['y1'], ['x0', 'x1'], ['y0', 'y1']] as const);
    const shared = { ...r };
    for (const k of keys) shared[k] = o[k];
    if (shared.x1 - shared.x0 >= span && shared.y1 - shared.y0 >= span) return shared;
  }
  return r;
}

/** The tiles round a rectangle's outline, clockwise from its top-left corner. */
function outline({ x0, y0, x1, y1 }: Rect): Tile[] {
  const tiles: Tile[] = [];
  for (let x = x0; x < x1; x++) tiles.push({ x, y: y0 });
  for (let y = y0; y < y1; y++) tiles.push({ x: x1, y });
  for (let x = x1; x > x0; x--) tiles.push({ x, y: y1 });
  for (let y = y1; y > y0; y--) tiles.push({ x: x0, y });
  return tiles;
}

const toward = (a: Tile, b: Tile) =>
  DIRS.find((d) => a.x + DIR_DX[d] === b.x && a.y + DIR_DY[d] === b.y)!;

/**
 * Narrow loops laid as one network: the outlines of the rectangles, joined wherever they meet.
 * Each tile on an outline opens to exactly its neighbours along the outlines, so where outlines
 * touch or cross the tile is a switch (its throat at either end of the straight) or a crossing,
 * and no edge is left open but a few stubs for the growth to follow. Laid breadth first, so each
 * piece goes on the neighbour across an open edge of one already laid and opens back to it.
 */
function narrowLoops(rng: Rng, w: number, h: number, rects: Rect[]): Lay[] {
  const edges = new Map<number, Set<Dir>>();
  const join = (t: Tile, d: Dir) => {
    const k = t.y * w + t.x;
    if (!edges.has(k)) edges.set(k, new Set());
    edges.get(k)!.add(d);
  };
  for (const r of rects) {
    const ring = outline(r);
    ring.forEach((t, i) => {
      const next = ring[(i + 1) % ring.length];
      join(t, toward(t, next));
      join(next, toward(next, t));
    });
  }
  for (const [k, e] of edges) {
    const free = DIRS.filter((d) => {
      const nx = (k % w) + DIR_DX[d];
      const ny = Math.floor(k / w) + DIR_DY[d];
      return !e.has(d) && nx >= 0 && ny >= 0 && nx < w && ny < h && !edges.has(ny * w + nx);
    });
    if (e.size === 2 && free.length && rng.chance(0.1)) e.add(rng.pick(free));
  }
  const pieceAt = (k: number): Lay => {
    const e = [...edges.get(k)!];
    let pairs = [pairOf(Dir.N, Dir.S), pairOf(Dir.E, Dir.W)];
    if (e.length === 2) pairs = [pairOf(e[0], e[1])];
    if (e.length === 3) {
      // a straight through two of them, the third leaving either end of it
      const a = e.find((d) => e.includes(opposite(d)))!;
      const b = e.find((d) => d !== a && d !== opposite(a))!;
      pairs = [pairOf(a, opposite(a)), pairOf(rng.pick([a, opposite(a)]), b)];
    }
    const p = PIECES.find(
      (q) => q.pairs.length === pairs.length && pairs.every((x) => q.pairs.includes(x)),
    )!;
    return { kind: p.kind, rot: p.rot, x: k % w, y: Math.floor(k / w) };
  };
  const lays: Lay[] = [];
  const seen = new Set<number>();
  for (const first of rng.shuffle([...edges.keys()])) {
    if (seen.has(first)) continue;
    seen.add(first);
    const queue = [first];
    while (queue.length) {
      const k = queue.shift()!;
      lays.push(pieceAt(k));
      for (const d of edges.get(k)!) {
        const n = (Math.floor(k / w) + DIR_DY[d]) * w + (k % w) + DIR_DX[d];
        if (edges.has(n) && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
  }
  return lays;
}

/**
 * A regular loop: 2×2 curves at the corners (rotations 1, 2, 3 and 0 clockwise from the top left)
 * and straights between, laid round from the top-left corner with each piece on the neighbour
 * across the last one's open edge. Some corners are switches and some sides crossings, whose
 * spare edges the growth follows.
 */
function regularLoop(rng: Rng, { x0, y0, x1, y1 }: Rect): Lay[] {
  const corner = (rot: number, x: number, y: number): Lay =>
    rng.chance(0.1)
      ? { kind: 'switch', rot: rng.pick(SWITCHES_ON_ARC[rot]), x, y, form: 'turn' }
      : { kind: 'curve', rot, x, y };
  const side = (x: number, y: number, rot: number): Lay =>
    rng.chance(0.05) ? { kind: 'crossing', rot: 0, x, y } : { kind: 'straight', rot, x, y };
  const lays = [corner(1, x0, y0)];
  for (let x = x0 + 2; x <= x1 - 2; x++) lays.push(side(x, y0, 1));
  lays.push(corner(2, x1 - 1, y0));
  for (let y = y0 + 2; y <= y1 - 2; y++) lays.push(side(x1, y, 0));
  lays.push(corner(3, x1 - 1, y1 - 1));
  for (let x = x1 - 2; x >= x0 + 2; x--) lays.push(side(x, y1, 1));
  lays.push(corner(0, x0, y1 - 1));
  for (let y = y1 - 2; y >= y0 + 2; y--) lays.push(side(x0, y, 0));
  return lays;
}

/**
 * A chord across a regular loop: a turn switch on each of two opposite sides, their arcs turning
 * in to meet a line of straights, laid from one switch across to the other. Empty when the loop
 * has no room for both switches between its corners.
 */
function regularChord(rng: Rng, r: Rect): Lay[] {
  const tall = r.y1 - r.y0 >= 5;
  const wide = r.x1 - r.x0 >= 5;
  if (!tall && !wide) return [];
  const across = tall && (!wide || rng.chance(0.5));
  const [lo, hi] = across ? [r.y0, r.y1] : [r.x0, r.x1];
  // both blocks lie on their side between its corners
  const options = (across ? SIDE_SWITCHES.left : SIDE_SWITCHES.top)
    .flatMap((a) => (across ? SIDE_SWITCHES.right : SIDE_SWITCHES.bottom).map((b) => ({ a, b })))
    .map(({ a, b }) => ({
      a,
      b,
      from: lo + 2 + Math.max(a.at, b.at),
      to: hi - 3 + Math.min(a.at, b.at),
    }))
    .filter((o) => o.from <= o.to);
  if (!options.length) return [];
  const { a, b, from, to } = rng.pick(options);
  const line = rng.int(from, to);
  const lays: Lay[] = [];
  if (across) {
    lays.push({ kind: 'switch', rot: a.rot, x: r.x0, y: line - a.at, form: 'turn' });
    for (let x = r.x0 + 2; x <= r.x1 - 2; x++) lays.push({ kind: 'straight', rot: 1, x, y: line });
    lays.push({ kind: 'switch', rot: b.rot, x: r.x1 - 1, y: line - b.at, form: 'turn' });
  } else {
    lays.push({ kind: 'switch', rot: a.rot, x: line - a.at, y: r.y0, form: 'turn' });
    for (let y = r.y0 + 2; y <= r.y1 - 2; y++) lays.push({ kind: 'straight', rot: 0, x: line, y });
    lays.push({ kind: 'switch', rot: b.rot, x: line - b.at, y: r.y1 - 1, form: 'turn' });
  }
  return lays;
}

/**
 * What to lay for `l` over the regular track already on its tiles: `l` itself where they are
 * empty or hold only straights it runs along; otherwise the piece that holds both, which is a
 * crossing where two straights cross and a turn switch where a straight runs along a curve's
 * block. Null when the track holds `l` already or no piece holds both.
 */
function mergeLay(g: TrackGraph, l: Lay): Lay | null {
  if (!isUnit('regular', l.kind)) {
    const have = g.get(l.x, l.y);
    if (!have) return l;
    const along = pieceLinks(l.kind, l.rot);
    if (have.unit) {
      if (have.kind !== 'curve') return null;
      return switchOver(g, have.rot, have.unit.ax, have.unit.ay, { ...l, pairs: along });
    }
    const pairs = new Set(have.links.map(([a, b]) => pairOf(a, b)));
    const before = pairs.size;
    for (const [a, b] of along) pairs.add(pairOf(a, b));
    if (pairs.size === before) return null;
    const both = PIECES.find(
      (p) => p.pairs.length === pairs.size && p.pairs.every((k) => pairs.has(k)),
    );
    return both ? { kind: both.kind, rot: both.rot, x: l.x, y: l.y } : null;
  }
  const members = unitDef(l.kind as 'curve' | 'switch', N, l.rot, l.form).members;
  const runsAlong = members.every((m) => {
    const p = g.get(l.x + m.dx, l.y + m.dy);
    const mine = m.links.map((k) => pairOf(k.in, k.out));
    return !p || (!p.unit && p.links.every(([a, b]) => mine.includes(pairOf(a, b))));
  });
  if (runsAlong) return l;
  return l.kind === 'curve' ? switchOver(g, l.rot, l.x, l.y) : null;
}

/**
 * The turn switch anchored at (x, y) whose diverging lane is the arc of a 2×2 curve of rotation
 * `curve`, if one holds every link already on its block and the straight `extra`.
 */
function switchOver(
  g: TrackGraph,
  curve: number,
  x: number,
  y: number,
  extra?: Tile & { pairs: [Dir, Dir][] },
): Lay | null {
  for (const rot of SWITCHES_ON_ARC[curve]) {
    const holds = unitDef('switch', N, rot, 'turn').members.every((m) => {
      const at = { x: x + m.dx, y: y + m.dy };
      const mine = m.links.map((k) => pairOf(k.in, k.out));
      const p = g.get(at.x, at.y);
      // the curve's own members hold part of the arc; any other 2×2 piece is in the way
      if (p?.unit && (p.unit.ax !== x || p.unit.ay !== y)) return false;
      const wanted = [...(p && !p.unit ? p.links : [])];
      if (extra && extra.x === at.x && extra.y === at.y) wanted.push(...extra.pairs);
      return wanted.every(([a, b]) => mine.includes(pairOf(a, b)));
    });
    if (holds) return { kind: 'switch', rot, x, y, form: 'turn' };
  }
  return null;
}

/** Every way to lay a piece of `kind` so that tile (x, y) has track opening on `edge`. */
function laysOpening(family: Family, kind: Kind, x: number, y: number, edge: Dir): Lay[] {
  const out: Lay[] = [];
  for (let rot = 0; rot < rotationCount(kind); rot++) {
    if (!isUnit(family, kind)) {
      if (pieceLinks(kind, rot).some(([a, b]) => a === edge || b === edge))
        out.push({ kind, rot, x, y });
      continue;
    }
    const forms: SwitchForm[] = kind === 'switch' ? ['turn', 'parallel'] : ['turn'];
    for (const form of forms) {
      for (const m of unitDef(kind as 'curve' | 'switch', N, rot, form).members) {
        if (!m.links.some((l) => l.in === edge || l.out === edge)) continue;
        const lay: Lay = { kind, rot, x: x - m.dx, y: y - m.dy };
        if (kind === 'switch') lay.form = form;
        out.push(lay);
      }
    }
  }
  return out;
}

/**
 * How a placement meets the track around it: `met` counts its edges that meet track opening back;
 * `bad` counts its edges that run off the grid or into track that does not open back, and the
 * neighbours opening towards it that it does not open back to.
 */
function fit(g: TrackGraph, family: Family, l: Lay): { met: number; bad: number } {
  const tiles = isUnit(family, l.kind)
    ? unitDef(l.kind as 'curve' | 'switch', N, l.rot, l.form).members.map((m) => ({
        x: l.x + m.dx,
        y: l.y + m.dy,
        edges: m.links.flatMap((k) => [k.in, k.out]),
      }))
    : [{ x: l.x, y: l.y, edges: pieceLinks(l.kind, l.rot).flat() }];
  const inside = (x: number, y: number) => tiles.some((t) => t.x === x && t.y === y);
  let met = 0;
  let bad = 0;
  for (const t of tiles)
    for (const d of DIRS) {
      const nx = t.x + DIR_DX[d];
      const ny = t.y + DIR_DY[d];
      if (inside(nx, ny)) continue;
      const opens = t.edges.includes(d);
      const back = g.opensTo(nx, ny, opposite(d));
      if (opens && back) met++;
      else if (back || (opens && (!g.inBounds(nx, ny) || g.has(nx, ny)))) bad++;
    }
  return { met, bad };
}

/** Does a train in `start` come to a switch it can leave two ways, both leading on? */
function choiceAhead(g: TrackGraph, start: State): boolean {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const s = stack.pop()!;
    if (seen.has(keyOf(s))) continue;
    seen.add(keyOf(s));
    const next = nextStates(g, s);
    if (next.length > 1) return true;
    stack.push(...next);
  }
  return false;
}

/** The least cost by `cost` from `start` to every state a train there reaches. */
function lengthsFrom(g: TrackGraph, start: State, cost: StepCost): { s: State; d: number }[] {
  const best = new Map<string, { s: State; d: number }>([[keyOf(start), { s: start, d: 0 }]]);
  for (let changed = true; changed;) {
    changed = false;
    for (const { s, d } of [...best.values()])
      for (const n of nextStates(g, s)) {
        const there = d + cost(g, s.x, s.y, s.in, opposite(n.in));
        if (there < (best.get(keyOf(n))?.d ?? Infinity)) {
          best.set(keyOf(n), { s: n, d: there });
          changed = true;
        }
      }
  }
  return [...best.values()];
}

/** The least cost by `cost` from `start` to each tile, the start state itself not counted. */
function tileLengths(g: TrackGraph, start: State, cost: StepCost): Map<string, number> {
  const out = new Map<string, number>();
  for (const { s, d } of lengthsFrom(g, start, cost))
    if (keyOf(s) !== keyOf(start))
      out.set(tileKey(s), Math.min(d, out.get(tileKey(s)) ?? Infinity));
  return out;
}

/**
 * A duel: two tiles that findPath's cost and a cost it could use by mistake rank the other way
 * round, so a search with that mistake ends on the wrong one. Empty when the layout has none.
 */
function duelTargets(rng: Rng, g: TrackGraph, family: Family, start: State): Tile[] {
  const mistakes =
    family === 'narrow' ? [rawLength, tileCount] : [rawLength, oneTileLength, tileCount];
  const mine = tileLengths(g, start, stepCost);
  for (const mistake of rng.shuffle(mistakes)) {
    const theirs = [...tileLengths(g, start, mistake)];
    const duels = theirs.flatMap(([a, da]) =>
      theirs
        .filter(([b, db]) => da < db - 1e-9 && mine.get(a)! > mine.get(b)! + 1e-9)
        .map(([b]) => [a, b]),
    );
    if (duels.length)
      return rng.pick(duels).map((k) => {
        const [x, y] = k.split(',').map(Number);
        return { x, y };
      });
  }
  return [];
}

/** A race: every tile first reached at or past a horizon, so each branch's first one competes. */
function raceTargets(rng: Rng, ahead: { s: State; d: number }[], start: State): Tile[] {
  const horizon = rng.pick(ahead).d;
  const before = new Set([
    tileKey(start),
    ...ahead.filter((e) => e.d < horizon).map((e) => tileKey(e.s)),
  ]);
  return ahead.filter((e) => !before.has(tileKey(e.s))).map((e) => ({ x: e.s.x, y: e.s.y }));
}

/** A band: tiles at nearly the same length, so the penalty or the member lengths decide. */
function bandTargets(rng: Rng, ahead: { s: State; d: number }[]): Tile[] {
  const from = rng.pick(ahead).d;
  const width = rng.range(0.05, 0.5);
  return ahead
    .filter((e) => e.d >= from && e.d <= from + width)
    .map((e) => ({ x: e.s.x, y: e.s.y }));
}

/**
 * A few tiles: now and then only tiles the train cannot reach, so the search has to give up;
 * otherwise mostly tiles on track the start tile reaches ignoring direction, some on any track,
 * some anywhere.
 */
function fewTargets(rng: Rng, g: TrackGraph, start: State, track: Tile[]): Tile[] {
  const reach = tileLengths(g, start, tileCount);
  const behind = track.filter((t) => !reach.has(tileKey(t)));
  const count = rng.int(1, 3);
  if (behind.length && rng.chance(0.4))
    return Array.from({ length: count }, () => rng.pick(behind)).map(({ x, y }) => ({ x, y }));
  const near = [...g.reach([g.key(start.x, start.y)])].map((k) => ({
    x: k % g.w,
    y: Math.floor(k / g.w),
  }));
  return Array.from({ length: count }, () => {
    const r = rng.next();
    const t = r < 0.6 ? rng.pick(near) : r < 0.85 ? rng.pick(track) : null;
    return t ? { x: t.x, y: t.y } : { x: rng.int(0, g.w - 1), y: rng.int(0, g.h - 1) };
  });
}

/**
 * A case on a 3×3 to 6×6 narrow grid, or a 4×4 to 8×8 regular one (its curves and switches take
 * 2×2 tiles). The layout is loops joined where they meet (or, now and then, one piece), grown
 * further: each new piece goes on the empty neighbour across an open edge of the track so far,
 * turned to open back to it, so most layouts hold paths. A stray piece may then land anywhere,
 * overwriting what it covers. Most starts have a choice of way ahead, and most target sets make
 * the ways ahead compete, since uniformly random rotations give a path in few cases and grown
 * track alone rarely gives a choice that turns on the cost.
 */
function genCase(family: Family, callbacks: boolean) {
  return (rng: Rng): Case => {
    const [lo, hi] = family === 'narrow' ? [3, 6] : [4, 8];
    const w = rng.int(lo, hi);
    const h = rng.int(lo, hi);
    const g = new TrackGraph(w, h);
    const lays: Lay[] = [];
    const lay = (l: Lay) => {
      lays.push(l);
      layOn(g, family, l);
    };

    if (rng.chance(0.9)) {
      const rects: Rect[] = [];
      for (let i = rng.int(2, 4); i > 0; i--) {
        const r = loopRect(rng, family, w, h, rects);
        if (r) rects.push(r);
      }
      if (family === 'narrow') narrowLoops(rng, w, h, rects).forEach(lay);
      else
        for (const r of rects)
          for (const l of [...regularLoop(rng, r), ...regularChord(rng, r)]) {
            const m = mergeLay(g, l);
            if (m) lay(m);
          }
    }

    // growth: mostly a placement that covers nothing and meets all the track around it, which
    // closes loops; sometimes any placement, which may cover track or fall off the grid
    const fits = (l: Lay) =>
      footprint(family, l).every((t) => g.inBounds(t.x, t.y) && !g.has(t.x, t.y));
    const choose = (options: Lay[]) => {
      const clean = options.filter(fits);
      if (!clean.length || rng.chance(0.05)) return rng.pick(options);
      const fitted = clean.map((l) => ({ l, ...fit(g, family, l) }));
      const whole = fitted.filter((f) => f.bad === 0);
      if (whole.length) {
        const kind = rng.pick([...new Set(whole.map((f) => f.l.kind))]);
        return rng.pick(whole.filter((f) => f.l.kind === kind)).l;
      }
      const least = Math.min(...fitted.map((f) => f.bad - f.met));
      return rng.pick(fitted.filter((f) => f.bad - f.met === least)).l;
    };
    if (!lays.length) {
      const [x0, y0] = [rng.int(0, w - 1), rng.int(0, h - 1)];
      lay(choose(laysOpening(family, rng.pick(KINDS), x0, y0, rng.pick(DIRS))));
    }
    for (let i = rng.int(3, w * h); i > 0; i--) {
      const open: State[] = [];
      for (const t of g.tiles())
        for (const d of edgesOf(t.piece)) {
          const nx = t.x + DIR_DX[d];
          const ny = t.y + DIR_DY[d];
          if (g.inBounds(nx, ny) && !g.has(nx, ny)) open.push({ x: nx, y: ny, in: opposite(d) });
        }
      if (!open.length) break;
      // an empty tile that two open edges point at closes a loop when filled
      const closing = open.filter((e) => open.filter((o) => tileKey(o) === tileKey(e)).length > 1);
      const e = rng.pick(closing.length && rng.chance(0.7) ? closing : open);
      const kinds = rng.chance(0.2) ? [...KINDS, 'crossing' as const] : KINDS;
      lay(choose(kinds.flatMap((k) => laysOpening(family, k, e.x, e.y, e.in))));
    }
    if (rng.chance(0.5)) {
      const kind = rng.pick(KINDS);
      const rot = rng.int(0, rotationCount(kind) - 1);
      const l: Lay = { kind, rot, x: rng.int(0, w - 1), y: rng.int(0, h - 1) };
      if (isUnit(family, kind) && kind === 'switch') l.form = rng.pick(['turn', 'parallel']);
      lay(l);
    }

    let track = [...g.tiles()].filter((t) => t.piece.links.length > 0);
    if (!track.length) {
      lay({ kind: 'straight', rot: 0, x: 0, y: 0 });
      track = [...g.tiles()].filter((t) => t.piece.links.length > 0);
    }
    const states = track.flatMap((t) => edgesOf(t.piece).map((d) => ({ x: t.x, y: t.y, in: d })));
    const moving = states.filter((s) => nextStates(g, s).length > 0);
    const choosing = moving.filter((s) => choiceAhead(g, s));
    const pickStart = rng.next();
    const start = rng.pick(
      choosing.length && pickStart < 0.75
        ? choosing
        : moving.length && pickStart < 0.95
          ? moving
          : states,
    );

    const mode = rng.next();
    let targets = mode < 0.4 ? duelTargets(rng, g, family, start) : [];
    const ahead = lengthsFrom(g, start, rawLength).filter((e) => e.d > 0);
    if (!targets.length && ahead.length && mode < 0.62) targets = raceTargets(rng, ahead, start);
    else if (!targets.length && ahead.length && mode < 0.72) targets = bandTargets(rng, ahead);
    if (!targets.length) targets = fewTargets(rng, g, start, track);
    if (rng.chance(0.25)) targets.push({ x: start.x, y: start.y });
    const unique = [...new Map(targets.map((t) => [tileKey(t), t])).values()];

    const c: Case = { family, w, h, lays, start, targets: unique };
    if (!callbacks) return c;
    const trackTile = () => {
      const t = rng.pick(track);
      return { x: t.x, y: t.y };
    };
    c.avoid = [];
    for (let i = rng.int(0, 3); i > 0; i--) c.avoid.push(trackTile());
    // the start tile is exempt from avoid, so it is worth avoiding now and then
    if (rng.chance(0.3)) c.avoid.push({ x: start.x, y: start.y });
    c.deny = [];
    for (let i = rng.int(0, 2); i > 0; i--) {
      const t = rng.pick(track);
      const entry = rng.pick(edgesOf(t.piece));
      c.deny.push({ kind: t.piece.kind as Kind, rot: t.piece.rot, entry });
    }
    return c;
  };
}

// --------------------------------------------------------------------------------- shrinking

/** A case the properties apply to: the start is track opening on its entry edge. */
function valid(c: Case): boolean {
  const inside = (t: Tile) => t.x >= 0 && t.y >= 0 && t.x < c.w && t.y < c.h;
  if (c.w < 1 || c.h < 1 || !c.targets.length || !inside(c.start)) return false;
  // set() does not check bounds, so a 1×1 piece off the grid would alias another tile
  if (c.lays.some((l) => !isUnit(c.family, l.kind) && !inside(l))) return false;
  return build(c).opensTo(c.start.x, c.start.y, c.start.in);
}

/** The same case on a smaller grid; whatever no longer fits is dropped. */
function crop(c: Case, w: number, h: number): Case {
  const inside = (t: Tile) => t.x < w && t.y < h;
  const out: Case = {
    ...c,
    w,
    h,
    lays: c.lays.filter((l) => footprint(c.family, l).some(inside)),
    targets: c.targets.filter(inside),
  };
  if (c.avoid) out.avoid = c.avoid.filter(inside);
  return out;
}

function* shrinkLay(l: Lay): Iterable<Lay> {
  if (l.kind !== 'straight') yield { kind: 'straight', rot: l.rot % 2, x: l.x, y: l.y };
  if (l.form === 'parallel') yield { ...l, form: 'turn' };
  for (const rot of shrinkInt(l.rot)) yield { ...l, rot };
}

/** Smaller valid cases: fewer pieces, targets and rejections, a smaller grid, simpler pieces. */
function* shrinkCase(c: Case): Iterable<Case> {
  function* candidates(): Iterable<Case> {
    for (const lays of shrinkArray(c.lays)) yield { ...c, lays };
    for (const targets of shrinkArray(c.targets)) yield { ...c, targets };
    if (c.avoid) for (const avoid of shrinkArray(c.avoid)) yield { ...c, avoid };
    if (c.deny) for (const deny of shrinkArray(c.deny)) yield { ...c, deny };
    for (const w of shrinkInt(c.w, 1)) yield crop(c, w, c.h);
    for (const h of shrinkInt(c.h, 1)) yield crop(c, c.w, h);
    for (const lays of shrinkArray(c.lays, shrinkLay))
      if (lays.length === c.lays.length) yield { ...c, lays };
  }
  for (const candidate of candidates()) if (valid(candidate)) yield candidate;
}

function formatCase(c: Case): string {
  const at = (t: Tile) => `(${t.x},${t.y})`;
  const parts = [
    `${c.family} ${c.w}x${c.h}`,
    `start ${at(c.start)} in ${EDGE[c.start.in]}`,
    `targets ${c.targets.map(at).join(' ')}`,
  ];
  if (c.avoid) parts.push(`avoid [${c.avoid.map(at).join(' ')}]`);
  if (c.deny)
    parts.push(`deny [${c.deny.map((d) => `${d.kind}/${d.rot} by ${EDGE[d.entry]}`).join(' ')}]`);
  const lay = (l: Lay) => `${l.kind}/${l.rot}${l.form === 'parallel' ? 'p' : ''}@${at(l)}`;
  parts.push(`lays ${c.lays.map(lay).join(' ')}`);
  return parts.join('; ');
}

/** Runs a property over seeded cases of a family, shrinking a failure to its smallest layout. */
function forAllCases(
  family: Family,
  callbacks: boolean,
  property: (c: Case, g: TrackGraph) => boolean | void,
) {
  forAll(genCase(family, callbacks), (c) => property(c, build(c)), {
    shrink: shrinkCase,
    format: formatCase,
    // each call builds a layout and searches it twice; this keeps a failure's report in time
    shrinkBudget: 2000,
  });
}

// ------------------------------------------------------------------------- the oracle

/** The callbacks findPath gets for a case; avoid and access stay undefined without them. */
function callbacksOf(c: Case) {
  const targets = new Set(c.targets.map(tileKey));
  const isTarget = (x: number, y: number) => targets.has(tileKey({ x, y }));
  const avoided = new Set((c.avoid ?? []).map(tileKey));
  const avoid = c.avoid ? (x: number, y: number) => avoided.has(tileKey({ x, y })) : undefined;
  const deny = c.deny;
  const access = deny
    ? (piece: TrackPiece, entry: Dir) =>
        !deny.some((d) => d.kind === piece.kind && d.rot === piece.rot && d.entry === entry)
    : undefined;
  return { isTarget, avoid, access };
}

function run(c: Case, g: TrackGraph): PathSegment[] | null {
  const { isTarget, avoid, access } = callbacksOf(c);
  return findPath(g, c.start, isTarget, undefined, avoid, access);
}

/** A path's cost: every tile but the last, at whose centre the train stops. */
function pathCost(g: TrackGraph, p: PathSegment[], cost = stepCost): number {
  let sum = 0;
  for (let i = 0; i + 1 < p.length; i++) sum += cost(g, p[i].x, p[i].y, p[i].in, p[i].out);
  return sum;
}

/**
 * The oracle: the least cost of reaching a target, by Bellman-Ford over every (tile, entry) state
 * relaxed to a fixpoint, with findPath's step rule and step cost. An arrival is any state but the
 * start whose tile is a target, and nothing continues past one. Null when no arrival is reachable.
 */
function oracle(c: Case, g: TrackGraph, cost = stepCost): number | null {
  const { isTarget, avoid, access } = callbacksOf(c);
  const id = (x: number, y: number, d: Dir) => (y * c.w + x) * 4 + d;
  const startId = id(c.start.x, c.start.y, c.start.in);
  const arrival = (x: number, y: number, d: Dir) => id(x, y, d) !== startId && isTarget(x, y);
  const dist: number[] = new Array(c.w * c.h * 4).fill(Infinity);
  dist[startId] = 0;
  for (let pass = 0, changed = true; changed; pass++) {
    if (pass > dist.length) throw new Error('the oracle did not reach a fixpoint');
    changed = false;
    for (let y = 0; y < c.h; y++)
      for (let x = 0; x < c.w; x++)
        for (const d of DIRS) {
          const here = dist[id(x, y, d)];
          if (here === Infinity || arrival(x, y, d)) continue;
          for (const out of g.exits(x, y, d)) {
            const nx = x + DIR_DX[out];
            const ny = y + DIR_DY[out];
            const nin = opposite(out);
            if (!g.opensTo(nx, ny, nin)) continue;
            if (avoid && avoid(nx, ny)) continue;
            if (access && !access(g.get(nx, ny)!, nin)) continue;
            const there = here + cost(g, x, y, d, out);
            if (there < dist[id(nx, ny, nin)]) {
              dist[id(nx, ny, nin)] = there;
              changed = true;
            }
          }
        }
  }
  let best = Infinity;
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++)
      for (const d of DIRS) if (arrival(x, y, d)) best = Math.min(best, dist[id(x, y, d)]);
  return best === Infinity ? null : best;
}

// ------------------------------------------------------------------------- the properties

const at = (s: PathSegment) => `(${s.x},${s.y}) ${EDGE[s.in]}->${EDGE[s.out]}`;

/** Legal: starts in the start state, steps edge to edge, follows the pieces, ends on a target. */
function expectLegal(c: Case, g: TrackGraph, p: PathSegment[]) {
  const { isTarget } = callbacksOf(c);
  // the start state is never an arrival, so a path leaves its first tile
  expect(p.length, 'a path has at least two segments').toBeGreaterThanOrEqual(2);
  expect({ x: p[0].x, y: p[0].y, in: p[0].in }, 'the first segment is the start').toEqual(c.start);
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1];
    const b = p[i];
    const step = `step ${i}: ${at(a)} then ${at(b)}`;
    expect({ x: b.x, y: b.y }, step).toEqual({ x: a.x + DIR_DX[a.out], y: a.y + DIR_DY[a.out] });
    expect(b.in, step).toBe(opposite(a.out));
    expect(g.opensTo(b.x, b.y, b.in), `${step}: the piece opens to the entry`).toBe(true);
  }
  for (let i = 0; i + 1 < p.length; i++)
    expect(g.exits(p[i].x, p[i].y, p[i].in), `segment ${i}: ${at(p[i])}`).toContain(p[i].out);
  const last = p[p.length - 1];
  expect(isTarget(last.x, last.y), `the last segment ${at(last)} is a target`).toBe(true);
}

function expectNoReversal(p: PathSegment[]) {
  p.forEach((s, i) => expect(s.out, `segment ${i}: ${at(s)} reverses`).not.toBe(s.in));
}

function expectOptimal(c: Case, g: TrackGraph, p: PathSegment[] | null) {
  if (!p) return;
  const best = oracle(c, g);
  expect(best, 'the oracle finds a path too').not.toBeNull();
  const cost = pathCost(g, p);
  expect(Math.abs(cost - best!), `cost ${cost}, oracle ${best}`).toBeLessThanOrEqual(1e-9);
}

function expectComplete(c: Case, g: TrackGraph, p: PathSegment[] | null) {
  const best = oracle(c, g);
  const found = p ? 'found a path' : 'found none';
  expect(p === null, `findPath ${found}, oracle ${best}`).toBe(best === null);
}

describe.each(['narrow', 'regular'] as const)('findPath on seeded %s layouts', (family) => {
  it('returns a legal path: start state, edge to edge, along the pieces, to a target', () => {
    forAllCases(family, false, (c, g) => {
      const p = run(c, g);
      if (p) expectLegal(c, g, p);
    });
  });

  it('never reverses mid-tile, the final segment included', () => {
    forAllCases(family, false, (c, g) => {
      const p = run(c, g);
      if (p) expectNoReversal(p);
    });
  });

  it('costs exactly the exhaustive search minimum', () => {
    forAllCases(family, false, (c, g) => expectOptimal(c, g, run(c, g)));
  });

  it('returns null exactly when the exhaustive search finds no path', () => {
    forAllCases(family, false, (c, g) => expectComplete(c, g, run(c, g)));
  });

  it('never enters a tile avoid rejects or an entry access refuses', () => {
    forAllCases(family, true, (c, g) => {
      const p = run(c, g);
      if (!p) return;
      expectLegal(c, g, p);
      expectNoReversal(p);
      const { avoid, access } = callbacksOf(c);
      // the start tile is exempt: findPath asks both callbacks only when entering a tile
      for (let i = 1; i < p.length; i++) {
        const s = p[i];
        expect(avoid!(s.x, s.y), `segment ${i}: ${at(s)} is avoided`).toBe(false);
        expect(access!(g.get(s.x, s.y)!, s.in), `segment ${i}: ${at(s)} is refused`).toBe(true);
      }
    });
  });

  it('stays optimal and complete with avoid and access', () => {
    forAllCases(family, true, (c, g) => {
      const p = run(c, g);
      expectComplete(c, g, p);
      expectOptimal(c, g, p);
    });
  });

  it('runs on layouts that exercise it', () => {
    // The properties above hold vacuously where there is no path, or where no choice of path
    // turns on the switch penalty, the 2×2 member lengths or a callback. This pins the share of
    // cases where each of those is in play.
    const n = {
      cases: 0,
      paths: 0,
      switchCurves: 0,
      members: 0,
      penaltyDecides: 0,
      lengthsDecide: 0,
      guarded: 0,
      changed: 0,
    };
    forAll(genCase(family, false), (c) => {
      const g = build(c);
      const p = run(c, g);
      n.cases++;
      if (!p) return;
      n.paths++;
      const crossed = p.slice(0, -1);
      const piece = (s: PathSegment) => g.get(s.x, s.y)!;
      if (crossed.some((s) => piece(s).kind === 'switch' && isCurveLink(s.in, s.out)))
        n.switchCurves++;
      if (crossed.some((s) => piece(s).unit)) n.members++;
      // a path longer by another cost than that cost's least means a search by that cost would
      // have ended elsewhere: the penalty, or the member lengths, decided this one
      const decided = (cost: StepCost) => pathCost(g, p, cost) > oracle(c, g, cost)! + 1e-9;
      if (decided(rawLength)) n.penaltyDecides++;
      if (decided(oneTileLength)) n.lengthsDecide++;
    });
    forAll(genCase(family, true), (c) => {
      const g = build(c);
      const best = oracle(c, g);
      if (best !== null) n.guarded++;
      if (best !== oracle({ ...c, avoid: undefined, deny: undefined }, g)) n.changed++;
    });
    const share = (k: number) => k / n.cases;
    expect(share(n.paths), 'cases with a path').toBeGreaterThanOrEqual(0.6);
    expect(share(n.cases - n.paths), 'cases with no path').toBeGreaterThanOrEqual(0.05);
    expect(share(n.switchCurves), 'paths across a switch curve link').toBeGreaterThanOrEqual(0.2);
    expect(n.penaltyDecides, 'paths the switch penalty decides').toBeGreaterThan(0);
    if (family === 'regular') {
      expect(share(n.members), 'paths across a 2x2 piece').toBeGreaterThanOrEqual(0.5);
      expect(share(n.lengthsDecide), 'paths the member lengths decide').toBeGreaterThanOrEqual(
        0.05,
      );
    }
    expect(share(n.guarded), 'cases with callbacks and a path').toBeGreaterThanOrEqual(0.25);
    expect(share(n.changed), 'cases the callbacks change').toBeGreaterThanOrEqual(0.2);
  });
});
