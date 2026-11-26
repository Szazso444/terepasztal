/**
 * Which parts each tile of a textured bridge draws (bridgeMeshes.ts builds them). Pure: no Pixi,
 * so it runs under Node.
 *
 * A deck covers its whole tile, so decks of neighbouring bridge tiles always meet at the tile seam.
 * Under narrow gauge it pulls in on its free edges (`ACROSS`, `NARROW`) and still meets its
 * neighbours at the seam and the bank at its ends. Two bridge tiles that share an edge merge into one bridge when they are of one material,
 * their decks meet at the same height all along the edge and, when both are spans (straight rail
 * or a road), they run the same way: parallel lines on adjacent bridge tiles make one wide
 * bridge. A merged edge has no parapet, and the supports under it are shared: one pier wall, post
 * line or arched wall stands under the seam instead of one under each tile.
 *
 * A deck carries rail or a road, and spans merge whatever each carries: a road deck beside a rail
 * deck of one material, on the same axis and at the same height, makes one wide bridge with the
 * rail on one half and the road on the other, its parapets on the two outer long edges only. A
 * pad under curved or switched rail has no axis of its own, so it merges with rail only.
 */
import { railLevel, type RailBed } from '../world/railProfile';

export type BridgeMaterial = 'wood' | 'stone';
/** What a deck carries: `road` is a platform with a road and no rail on it. */
export type BridgeCarries = 'rail' | 'road';

/** Along offsets (tile units from the tile centre) at which a deck's height is sampled. */
export const DECK_SAMPLES = [-0.5, -0.25, 0, 0.25, 0.5] as const;
/** World px two deck heights may differ by and still meet. */
const MEET = 0.5;

export interface BridgeSite {
  x: number;
  y: number;
  material: BridgeMaterial;
  /** Rail when absent, as every deck was before roads went on bridges. */
  carries?: BridgeCarries;
  /** 1 along x, 0 along y, null a square pad under a curve, switch or crossing. */
  axis: 0 | 1 | null;
  /**
   * Deck top (the rail level, or a road deck's `roadDeckSamples`) in world px up at each of
   * DECK_SAMPLES along the axis. A pad's deck is level: its first sample stands for all.
   */
  deck: readonly number[];
  /**
   * Per edge (N, E, S, W), whether a track crosses it, or on a road deck the road runs on through
   * it: a pad keeps those free of parapets, and over water a deck's end there rests on the bank.
   */
  open?: readonly boolean[];
  /** Raised by the player above the ground or water: a viaduct's tall supports stand under it. */
  raised?: boolean;
  /** It carries narrow gauge only: its free edges pull in (`NARROW`). */
  narrow?: boolean;
}

/** Per edge, in iso Dir order (N -y, E +x, S +y, W -x): it meets a bridge tile it merges with. */
export type Joins = [boolean, boolean, boolean, boolean];
const N = 0,
  E = 1,
  S = 2,
  W = 3;
const DX = [0, 1, 0, -1],
  DY = [-1, 0, 1, 0];

/**
 * A straight bridge tile's deck samples: the rail level of its line (`bed`, centred at `centre`
 * along the axis) at each of DECK_SAMPLES, in world px up (`step` px a level). The deck top then
 * follows the rail across the tile and meets the next tile's deck where the rail does.
 */
export function deckSamples(bed: RailBed, centre: number, step: number): number[] {
  return DECK_SAMPLES.map((l) => railLevel(bed, centre + l) * step);
}

/**
 * A road deck's samples (#506), in world px up: a road has no rail profile, so its deck runs
 * straight from the ground `from` where its run of road decks leaves one bank, at along coordinate
 * `start`, to the ground `to` where it reaches the other, at `end`, and the road on each bank runs
 * on to it at its own height. Read at DECK_SAMPLES about the tile centre `centre`, never below
 * `floor` (over water, the waterline's deck).
 */
export function roadDeckSamples(
  centre: number,
  start: number,
  from: number,
  end: number,
  to: number,
  floor = -Infinity,
): number[] {
  return DECK_SAMPLES.map((l) => {
    const t = end > start ? Math.max(0, Math.min(1, (centre + l - start) / (end - start))) : 0.5;
    return Math.max(floor, from + (to - from) * t);
  });
}

/** Deck height (world px up) at along offset `l` in [-0.5, 0.5]. */
export function deckAt(site: Pick<BridgeSite, 'axis' | 'deck'>, l: number): number {
  const d = site.deck;
  if (site.axis === null || d.length < DECK_SAMPLES.length) return d[0];
  const t = (Math.max(-0.5, Math.min(0.5, l)) + 0.5) * (d.length - 1),
    i = Math.min(d.length - 2, Math.floor(t));
  return d[i] + (d[i + 1] - d[i]) * (t - i);
}
/** Deck height at a point given in tile offsets from the tile centre. */
export function deckAtOffset(site: Pick<BridgeSite, 'axis' | 'deck'>, dx: number, dy: number) {
  return deckAt(site, site.axis === 0 ? dy : dx);
}

/** Deck heights along edge `d`, at its start, middle and end in increasing map coordinate. */
function edgeHeights(s: BridgeSite, d: number): number[] {
  return [-0.5, 0, 0.5].map((v) =>
    d === N || d === S
      ? deckAtOffset(s, v, d === N ? -0.5 : 0.5)
      : deckAtOffset(s, d === W ? -0.5 : 0.5, v),
  );
}

/** Whether tile `a` merges with tile `b` across `a`'s edge `d`. */
export function merges(a: BridgeSite, b: BridgeSite, d: number): boolean {
  if (a.material !== b.material) return false;
  const road = a.carries === 'road' || b.carries === 'road';
  if (road && (a.axis === null || b.axis === null)) return false;
  if (a.axis !== null && b.axis !== null && a.axis !== b.axis) return false;
  const ha = edgeHeights(a, d),
    hb = edgeHeights(b, (d + 2) % 4);
  return ha.every((h, i) => Math.abs(h - hb[i]) <= MEET);
}

/** The merged edges of every bridge tile, by tile index (y * w + x). */
export function bridgeJoins(sites: readonly BridgeSite[], w: number): Map<number, Joins> {
  const at = new Map(sites.map((s) => [s.y * w + s.x, s])),
    out = new Map<number, Joins>();
  for (const s of sites) {
    const j: Joins = [false, false, false, false];
    for (let d = 0; d < 4; d++) {
      const nx = s.x + DX[d],
        ny = s.y + DY[d],
        n = nx >= 0 && nx < w ? at.get(ny * w + nx) : undefined;
      j[d] = !!n && merges(s, n, d);
    }
    out.set(s.y * w + s.x, j);
  }
  return out;
}

/** A box footprint in tile offsets from the tile centre. */
export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
export interface BridgePlan {
  /** The deck slab: the whole tile, less what a narrow deck pulls in on its free edges. */
  deck: Rect;
  /** Low walls on the deck's free edges; `near` ones (the +x and +y sides) draw over trains. */
  parapets: (Rect & { near: boolean })[];
  /** Masonry piers or square posts from the ground up to the deck's underside. */
  piers: Rect[];
  /** Timber bents along a span: a post at each end, braces and a cap, at across offset `w`. */
  trestles: number[];
  /** Arched masonry walls along a span (stone over water), at across offset `w`. */
  arches: number[];
  /** Masonry between a span's arched walls at each tile end: the bulk of its piers. */
  blocks: Rect[];
  /**
   * The deck's end on its +x (`e`) and +y (`s`) edge rests on the bank's abutment, so its end face
   * is not drawn: over water, where the track leaves the bridge for a tile it does not merge with.
   * The line's bed carries on there, wherever the painted water reaches past the tile.
   */
  abutments: { e: boolean; s: boolean };
}

/** Across offsets from the tile centre, all in one place: a deck's edge is the tile's. */
export const ACROSS = {
  /** Half the deck. */
  deck: 0.5,
  /** Inner face of a parapet; its outer face is the deck edge. */
  parapet: 0.44,
  /** A lone bridge's outer supports. */
  support: { pier: 0.38, trestle: 0.38, arch: 0.44 },
} as const;
export const PARAPET = ACROSS.parapet;
/** The same under narrow gauge: a bridge is as wide as its track. */
export const NARROW = {
  deck: 0.3,
  parapet: 0.24,
  support: { pier: 0.2, trestle: 0.2, arch: 0.24 },
} as const;
/** Along offset and half thickness of the stone piers under a span over land. */
export const PIER_AT = 0.38;
const PIER_HALF = 0.07;
/** Half the opening of a tile's arch, and the masonry left at each tile end: a pier's half. */
export const ARCH_OPEN = 0.36;
const PIER_LENGTH = 0.5 - ARCH_OPEN;
/** Half side of a pad's corner pier. */
const PAD_PIER = { stone: 0.09, wood: 0.045 } as const;

/** World px of a support under a deck at `deck` over ground or water at `surface`, both px up. */
export function pierLength(deck: number, surface: number) {
  return Math.max(0, deck - surface);
}

/** World px one storey of a raised timber trestle stands. */
export const STOREY = 20;
/** How many storeys of bracing a raised trestle `height` world px tall has. */
export function trestleStoreys(height: number) {
  return Math.max(1, Math.round(height / STOREY));
}

/** Tile offsets of the point `l` along and `w` across a span of the given axis. */
export function spanPoint(axis: 0 | 1, l: number, w: number) {
  return axis === 1 ? { x: l, y: w } : { x: w, y: l };
}
function spanRect(axis: 0 | 1, l0: number, l1: number, w0: number, w1: number): Rect {
  const a = spanPoint(axis, l0, w0),
    b = spanPoint(axis, l1, w1);
  return {
    x0: Math.min(a.x, b.x),
    x1: Math.max(a.x, b.x),
    y0: Math.min(a.y, b.y),
    y1: Math.max(a.y, b.y),
  };
}

/**
 * The parts one bridge tile draws, from its merged edges. `water` picks the supports that stand
 * in water (arched walls under stone, a trestle under timber) over those cut to the ground; a
 * raised stone span stands on arched walls over land too: a viaduct.
 */
export function bridgePlan(site: BridgeSite, joins: Joins, water: boolean): BridgePlan {
  const stone = site.material === 'stone',
    across = site.narrow ? NARROW : ACROSS,
    // A deck reaches the seam along its span and where it merges or, as a pad, where rail leaves.
    edge = (d: number, along: boolean) =>
      along || joins[d] || (site.axis === null && site.open?.[d]) ? 0.5 : across.deck,
    deck: Rect = {
      x0: -edge(W, site.axis === 1),
      x1: edge(E, site.axis === 1),
      y0: -edge(N, site.axis === 0),
      y1: edge(S, site.axis === 0),
    },
    abutment = (d: number) => water && !joins[d] && !!site.open?.[d],
    abutments = { e: abutment(E), s: abutment(S) };
  if (site.axis === null) return padPlan(site, joins, deck, stone, abutments, across);
  const axis = site.axis,
    // The span's far and near sides: -y and +y along x, -x and +x along y.
    [far, near] = axis === 1 ? [N, S] : [W, E],
    plan: BridgePlan = {
      deck,
      parapets: [],
      piers: [],
      trestles: [],
      arches: [],
      blocks: [],
      abutments,
    };
  const side = across.deck,
    wall = across.parapet;
  if (!joins[far]) plan.parapets.push({ ...spanRect(axis, -0.5, 0.5, -side, -wall), near: false });
  if (!joins[near]) plan.parapets.push({ ...spanRect(axis, -0.5, 0.5, wall, side), near: true });
  // Support lines across the span: the outer ones of a lone bridge, and one under each merged
  // seam, owned by the tile on its far side so it is drawn once.
  const lines = (outer: number) => [...(joins[far] ? [] : [-outer]), joins[near] ? 0.5 : outer];
  if (!water && stone && !site.raised) {
    const w0 = joins[far] ? -0.5 : -across.support.pier,
      w1 = joins[near] ? 0.5 : across.support.pier;
    for (const l of [-PIER_AT, PIER_AT])
      plan.piers.push(spanRect(axis, l - PIER_HALF, l + PIER_HALF, w0, w1));
  } else if (stone) {
    plan.arches = lines(across.support.arch);
    const w0 = joins[far] ? -0.5 : plan.arches[0],
      w1 = plan.arches[plan.arches.length - 1];
    plan.blocks = [-0.5, ARCH_OPEN].map((l) => spanRect(axis, l, l + PIER_LENGTH, w0, w1));
  } else plan.trestles = lines(across.support.trestle);
  return plan;
}

/**
 * A pad: parapets on the edges no track crosses and nothing merges with; a pier near each
 * corner, moved under the seam where an edge merges. A seam corner belongs to the tile on its
 * -x / -y side, so a block of pads stands on one grid of piers.
 */
function padPlan(
  site: BridgeSite,
  joins: Joins,
  deck: Rect,
  stone: boolean,
  abutments: BridgePlan['abutments'],
  across: typeof ACROSS | typeof NARROW,
): BridgePlan {
  const open = site.open ?? [false, false, false, false],
    walls = [0, 1, 2, 3].map((d) => !joins[d] && !open[d]),
    parapets: BridgePlan['parapets'] = [];
  // Walls along x run the whole edge; walls along y stop where they meet one.
  const inner = across.parapet;
  if (walls[N]) parapets.push({ x0: deck.x0, x1: deck.x1, y0: deck.y0, y1: -inner, near: false });
  if (walls[S]) parapets.push({ x0: deck.x0, x1: deck.x1, y0: inner, y1: deck.y1, near: true });
  const y0 = walls[N] ? -inner : deck.y0,
    y1 = walls[S] ? inner : deck.y1;
  if (walls[W]) parapets.push({ x0: deck.x0, x1: -inner, y0, y1, near: false });
  if (walls[E]) parapets.push({ x0: inner, x1: deck.x1, y0, y1, near: true });
  const piers: Rect[] = [],
    h = PAD_PIER[stone ? 'stone' : 'wood'];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      if ((sx < 0 && joins[W]) || (sy < 0 && joins[N])) continue;
      const cx = sx > 0 && joins[E] ? 0.5 : sx * across.support.pier,
        cy = sy > 0 && joins[S] ? 0.5 : sy * across.support.pier;
      piers.push({ x0: cx - h, x1: cx + h, y0: cy - h, y1: cy + h });
    }
  return { deck, parapets, piers, trestles: [], arches: [], blocks: [], abutments };
}
