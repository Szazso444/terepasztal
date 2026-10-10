/**
 * Which parts each tile of a textured bridge draws (bridgeMeshes.ts builds them). Pure: no Pixi,
 * so it runs under Node.
 *
 * Every deck covers its whole tile, so decks of neighbouring bridge tiles always meet at the tile
 * seam. Two bridge tiles that share an edge merge into one bridge when they are of one material,
 * their decks meet at the same height all along the edge and, when both carry straight rail, the
 * rail runs the same way: parallel tracks on adjacent bridge tiles make one wide bridge. A merged
 * edge has no parapet, and the supports under it are shared: one pier wall, post line or arched
 * wall stands under the seam instead of one under each tile.
 */
import { railLevel, type RailBed } from '../world/railProfile';

export type BridgeMaterial = 'wood' | 'stone';

/** Along offsets (tile units from the tile centre) at which a deck's height is sampled. */
export const DECK_SAMPLES = [-0.5, -0.25, 0, 0.25, 0.5] as const;
/** World px two deck heights may differ by and still meet. */
const MEET = 0.5;

export interface BridgeSite {
  x: number;
  y: number;
  material: BridgeMaterial;
  /** 1 along x, 0 along y, null a square pad under a curve, switch or crossing. */
  axis: 0 | 1 | null;
  /**
   * Deck top (the rail level) in world px up at each of DECK_SAMPLES along the axis. A pad's
   * deck is level: its first sample stands for all.
   */
  deck: readonly number[];
  /** Per edge (N, E, S, W), whether a track crosses it: a pad keeps those free of parapets. */
  open?: readonly boolean[];
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
  /** The deck slab: always the whole tile. */
  deck: Rect;
  /** Low walls on the deck's free edges; `near` ones (the +x and +y sides) draw over trains. */
  parapets: (Rect & { near: boolean })[];
  /** Masonry piers or square posts from the ground up to the deck's underside. */
  piers: Rect[];
  /** Timber bents along a span: a post at each end, braces and a cap, at across offset `w`. */
  trestles: number[];
  /** Arched masonry walls along a span (stone over water), at across offset `w`. */
  arches: number[];
}

/** Inner face of a parapet, from the tile centre; its outer face is the deck edge. */
export const PARAPET = 0.44;
/** Across offset of a lone bridge's outer supports. */
const SUPPORT = { pier: 0.38, trestle: 0.38, arch: 0.44 } as const;
/** Along offset and half thickness of the stone piers under a span over land. */
export const PIER_AT = 0.38;
const PIER_HALF = 0.07;
/** Half side of a pad's corner pier. */
const PAD_PIER = { stone: 0.09, wood: 0.045 } as const;

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
 * in water (arched walls under stone, a trestle under timber) over those cut to the ground.
 */
export function bridgePlan(site: BridgeSite, joins: Joins, water: boolean): BridgePlan {
  const deck = { x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.5 },
    stone = site.material === 'stone';
  if (site.axis === null) return padPlan(site, joins, deck, stone);
  const axis = site.axis,
    // The span's far and near sides: -y and +y along x, -x and +x along y.
    [far, near] = axis === 1 ? [N, S] : [W, E],
    plan: BridgePlan = { deck, parapets: [], piers: [], trestles: [], arches: [] };
  if (!joins[far])
    plan.parapets.push({ ...spanRect(axis, -0.5, 0.5, -0.5, -PARAPET), near: false });
  if (!joins[near]) plan.parapets.push({ ...spanRect(axis, -0.5, 0.5, PARAPET, 0.5), near: true });
  // Support lines across the span: the outer ones of a lone bridge, and one under each merged
  // seam, owned by the tile on its far side so it is drawn once.
  const lines = (outer: number) => [...(joins[far] ? [] : [-outer]), joins[near] ? 0.5 : outer];
  if (!water && stone) {
    const w0 = joins[far] ? -0.5 : -SUPPORT.pier,
      w1 = joins[near] ? 0.5 : SUPPORT.pier;
    for (const l of [-PIER_AT, PIER_AT])
      plan.piers.push(spanRect(axis, l - PIER_HALF, l + PIER_HALF, w0, w1));
  } else if (stone) plan.arches = lines(SUPPORT.arch);
  else plan.trestles = lines(SUPPORT.trestle);
  return plan;
}

/**
 * A pad: parapets on the edges no track crosses and nothing merges with; a pier near each
 * corner, moved under the seam where an edge merges. A seam corner belongs to the tile on its
 * -x / -y side, so a block of pads stands on one grid of piers.
 */
function padPlan(site: BridgeSite, joins: Joins, deck: Rect, stone: boolean): BridgePlan {
  const open = site.open ?? [false, false, false, false],
    walls = [0, 1, 2, 3].map((d) => !joins[d] && !open[d]),
    parapets: BridgePlan['parapets'] = [];
  // Walls along x run the whole edge; walls along y stop where they meet one.
  if (walls[N]) parapets.push({ x0: -0.5, x1: 0.5, y0: -0.5, y1: -PARAPET, near: false });
  if (walls[S]) parapets.push({ x0: -0.5, x1: 0.5, y0: PARAPET, y1: 0.5, near: true });
  const y0 = walls[N] ? -PARAPET : -0.5,
    y1 = walls[S] ? PARAPET : 0.5;
  if (walls[W]) parapets.push({ x0: -0.5, x1: -PARAPET, y0, y1, near: false });
  if (walls[E]) parapets.push({ x0: PARAPET, x1: 0.5, y0, y1, near: true });
  const piers: Rect[] = [],
    h = PAD_PIER[stone ? 'stone' : 'wood'];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      if ((sx < 0 && joins[W]) || (sy < 0 && joins[N])) continue;
      const cx = sx > 0 && joins[E] ? 0.5 : sx * SUPPORT.pier,
        cy = sy > 0 && joins[S] ? 0.5 : sy * SUPPORT.pier;
      piers.push({ x0: cx - h, x1: cx + h, y0: cy - h, y1: cy + h });
    }
  return { deck, parapets, piers, trestles: [], arches: [] };
}
