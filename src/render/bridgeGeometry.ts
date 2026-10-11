import { railLevel, type RailBed } from '../world/railProfile';

/**
 * Bridge platforms as geometry in the game's own projection. Every vertex is computed from
 * absolute tile coordinates and from the rail profile the track piece on the tile rides, so
 * neighbouring tiles share their edge vertices exactly, every level edge runs at 2:1, the deck top
 * is the rail height and every wall and pier ends on the ground sampled under it. The painted look
 * comes from flat material swatches (src/art/bridgeSwatches.json) mapped onto the faces.
 *
 * Pure: no Pixi, no DOM. The renderer turns the quads into meshes; tests read them directly.
 */
export type BridgeMaterial = 'wood' | 'stone';

/** Thickness of the deck slab in world pixels. */
export const SLAB = 5;
/** Levels the water surface lies below its banks as far as bridge supports are concerned. */
export const WATER_DROP = 2;

/** What the kit's pieces measure: world pixels up, tiles along. */
const KIT = {
  stone: {
    /** Parapet height above the deck and thickness in from the tile edge. */
    parapet: 6,
    thick: 0.125,
    /** The arch wall hung under each free edge. */
    hung: 15,
    /** Half a pier at each end of an edge: length along it, depth in from it. */
    leg: 0.17,
    depth: 0.16,
    /** Height of one leg swatch (four courses); courses stay level across the whole bridge. */
    repeat: 21.3,
    brace: 0,
  },
  wood: {
    parapet: 11,
    thick: 0.07,
    /** The truss hung under each free edge. */
    hung: 10,
    /** Half a post at each end of an edge. */
    leg: 0.045,
    depth: 0.07,
    repeat: 20,
    /** Height of one storey of cross bracing between the posts. */
    brace: 20,
  },
} as const;

/** Tile edges in direction order (engine/iso.ts Dir): north -y, east +x, south +y, west -x. */
export const EDGES = [0, 1, 2, 3] as const;
const DX = [0, 1, 0, -1],
  DY = [-1, 0, 1, 0];
/** The far edges: the camera looks at them from inside the tile. */
const FAR = [true, false, false, true];
/** Edges whose faces are seen from the lower left (normal +y); the others from the lower right. */
const LEFT = [true, false, true, false];

/** A bridge platform: where its deck stands and what it carries. */
export interface BridgeDeck {
  x: number;
  y: number;
  material: BridgeMaterial;
  /** World pixels one level rises. */
  step: number;
  /** Deck height in levels where no rail profile gives it. */
  deck: number;
  /** Rail profile of straight track on the tile: the deck follows it. */
  bed?: RailBed;
  /** Edges (direction order) the track on the tile runs across; absent without track. */
  rails?: readonly number[];
  /** Capacity upgrade, 1..4. */
  level: number;
  /** The tile is water: its supports stand in it. */
  water: boolean;
}
export interface BridgeEdge {
  /** Track crosses the edge. */
  rail: boolean;
  /** A parapet stands on the edge. */
  parapet: boolean;
  /** The slab side and the supports under the edge show: no platform across stands as high. */
  wall: boolean;
  /** The parapet / the wall does not continue on the next tile past the edge's start and end. */
  parapetEnds: [boolean, boolean];
  wallEnds: [boolean, boolean];
}
/** A platform with what stands on each of its four edges (direction order). */
export interface BridgeTile extends BridgeDeck {
  edges: BridgeEdge[];
}
/** Ground height in world pixels (up is positive) under a tile position. */
export type GroundAt = (x: number, y: number) => number;

/** One textured quad: four corners (tile x, tile y, world pixels up) and their swatch uvs. */
export interface BridgeQuad {
  key: string;
  p: number[];
  uv: number[];
}
export interface BridgeQuads {
  /** Below the water plane: shown only over water, under everything else. */
  sunk: BridgeQuad[];
  /** Supports, slab, far parapets, in drawing order. */
  body: BridgeQuad[];
  /** Parapets on the near edges: they stand in front of the train. */
  near: BridgeQuad[];
}

/** World pixel position of a point: screen x, screen y. */
export function project(x: number, y: number, z: number): [number, number] {
  return [(x - y) * 32, (x + y) * 16 - z];
}

/** Height of the deck surface over (x, y), in world pixels. */
export function deckTop(t: BridgeDeck, x: number, y: number): number {
  const bed = t.bed;
  if (!bed) return t.deck * t.step;
  return railLevel(bed, bed.axis === 'x' ? x : y) * t.step;
}

/** Point at `s` along edge `e` (0..1, screen left to right) and `d` tiles in from it. */
function edgePoint(t: { x: number; y: number }, e: number, s: number, d = 0): [number, number] {
  switch (e) {
    case 0:
      return [t.x - 0.5 + s, t.y - 0.5 + d];
    case 2:
      return [t.x - 0.5 + s, t.y + 0.5 - d];
    case 1:
      return [t.x + 0.5 - d, t.y + 0.5 - s];
    default:
      return [t.x - 0.5 + d, t.y + 0.5 - s];
  }
}
/** The tile past the start (0) or the end (1) of edge `e`, along it. */
function along(t: { x: number; y: number }, e: number, end: 0 | 1): [number, number] {
  const k = end ? 1 : -1;
  return e === 0 || e === 2 ? [t.x + k, t.y] : [t.x, t.y - k];
}

/** Two ground points in screen order, left first. */
function across(p: [number, number], q: [number, number]): [[number, number], [number, number]] {
  return p[0] - p[1] <= q[0] - q[1] ? [p, q] : [q, p];
}

const EPS = 1e-6;
type DeckAt = (x: number, y: number) => BridgeDeck | undefined;

function edgeFacts(t: BridgeDeck, e: number, at: DeckAt) {
  const n = at(t.x + DX[e], t.y + DY[e]),
    rail = !!t.rails?.includes(e);
  let joined = !!n,
    covered = !!n;
  if (n)
    for (const s of [0, 1]) {
      const [x, y] = edgePoint(t, e, s),
        mine = deckTop(t, x, y),
        theirs = deckTop(n, x, y);
      if (Math.abs(mine - theirs) > EPS) joined = false;
      if (theirs < mine - EPS) covered = false;
    }
  return { rail, parapet: !!t.rails && !rail && !joined, wall: !covered };
}

/**
 * What stands on each edge of a platform, from the platforms around it (`at`). A parapet stands
 * on every edge of a tile with track that the track does not cross and that does not continue as
 * one deck onto the next platform: a 2x2 curve is fenced around its outside, two decks side by
 * side at one height are one double deck. The slab side and the supports show on every edge with
 * no platform at least as high across, the ends of the bridge included.
 */
export function bridgeTile(t: BridgeDeck, at: DeckAt): BridgeTile {
  const edges = EDGES.map((e): BridgeEdge => {
    const own = edgeFacts(t, e, at),
      ends = ([0, 1] as const).map((end) => {
        const [nx, ny] = along(t, e, end),
          n = at(nx, ny);
        if (!n) return { parapet: true, wall: true };
        const [x, y] = edgePoint(t, e, end),
          level = Math.abs(deckTop(n, x, y) - deckTop(t, x, y)) <= EPS,
          theirs = edgeFacts(n, e, at);
        return { parapet: !(level && theirs.parapet), wall: !(level && theirs.wall) };
      });
    return {
      ...own,
      parapetEnds: [ends[0].parapet, ends[1].parapet],
      wallEnds: [ends[0].wall, ends[1].wall],
    };
  });
  return { ...t, edges };
}

interface Lists {
  above: BridgeQuad[];
  sunk: BridgeQuad[] | null;
}
/** A height in world pixels over a ground point. */
type Height = (x: number, y: number) => number;

/**
 * A vertical face between ground points a and b (screen left to right), from `top` down to
 * `bottom`, in `cols` columns: each column takes its heights at its own ends, so a face along a
 * climbing deck follows the same curve the deck does. Each column ends on the ground under it
 * (`ground`), with its texture cut there, never stretched; nothing reaches below the ground. `v`
 * is either the swatch rows at the designed top and bottom, or the world height of one swatch
 * whose rows then repeat at fixed heights (masonry courses stay level whatever stands on them).
 * Parts below the water plane go to `lists.sunk`.
 */
function face(
  lists: Lists,
  key: string,
  a: readonly [number, number],
  b: readonly [number, number],
  top: Height,
  bottom: Height | null,
  u: readonly [number, number],
  v: readonly [number, number] | number,
  ground: GroundAt | null,
  cols: number,
) {
  const lerp = (p: number, q: number, f: number) => p + (q - p) * f,
    /** Top, designed bottom and real bottom of the face at `f` along it. */
    at = (f: number) => {
      const x = lerp(a[0], b[0], f),
        y = lerp(a[1], b[1], f),
        t = top(x, y),
        d = bottom ? bottom(x, y) : -Infinity;
      return {
        x,
        y,
        t,
        d,
        b: Math.max(d, ground ? ground(x, y) : -Infinity),
        u: lerp(u[0], u[1], f),
      };
    };
  for (let i = 0; i < cols; i++) {
    let c0 = at(i / cols),
      c1 = at((i + 1) / cols);
    const up0 = c0.t - c0.b > 1e-3,
      up1 = c1.t - c1.b > 1e-3;
    if (!up0 && !up1) continue;
    if (up0 !== up1) {
      // The ground rises over the face inside this column: it ends where the two meet.
      let lo = up0 ? (i + 1) / cols : i / cols,
        hi = up0 ? i / cols : (i + 1) / cols;
      for (let n = 0; n < 24; n++) {
        const mid = (lo + hi) / 2,
          c = at(mid);
        if (c.t > c.b) hi = mid;
        else lo = mid;
      }
      if (up0) c1 = at(hi);
      else c0 = at(hi);
    }
    const { x: x0, y: y0, t: t0, d: d0, u: u0 } = c0,
      { x: x1, y: y1, t: t1, d: d1, u: u1 } = c1,
      b0 = Math.min(t0, c0.b),
      b1 = Math.min(t1, c1.b);
    // One piece between heights `lo` and `hi`; `row` gives the swatch row of a height at an end.
    const piece = (
      list: BridgeQuad[],
      hi: number,
      lo: number,
      row0: (z: number) => number,
      row1: (z: number) => number,
    ) => {
      const zt0 = Math.max(lo, Math.min(t0, hi)),
        zt1 = Math.max(lo, Math.min(t1, hi)),
        zb0 = Math.min(zt0, Math.max(b0, lo)),
        zb1 = Math.min(zt1, Math.max(b1, lo));
      if (zt0 - zb0 < 1e-3 && zt1 - zb1 < 1e-3) return;
      list.push({
        key,
        p: [x0, y0, zt0, x1, y1, zt1, x1, y1, zb1, x0, y0, zb0],
        uv: [u0, row0(zt0), u1, row1(zt1), u1, row1(zb1), u0, row0(zb0)],
      });
    };
    if (typeof v === 'number') {
      const first = Math.floor(-Math.max(t0, t1) / v),
        last = Math.ceil(-Math.min(b0, b1) / v);
      for (let k = first; k < last; k++) {
        const hi = -k * v,
          row = (z: number) => (hi - z) / v;
        piece(hi <= 0 && lists.sunk ? lists.sunk : lists.above, hi, hi - v, row, row);
      }
    } else {
      const row0 = (z: number) => v[0] + ((t0 - z) / (t0 - d0)) * (v[1] - v[0]),
        row1 = (z: number) => v[0] + ((t1 - z) / (t1 - d1)) * (v[1] - v[0]);
      if (lists.sunk && Math.min(b0, b1) < 0) {
        piece(lists.above, Infinity, 0, row0, row1);
        piece(lists.sunk, 0, -Infinity, row0, row1);
      } else piece(lists.above, Infinity, -Infinity, row0, row1);
    }
  }
}

/**
 * Everything of one platform as textured quads. `land` is the land surface. Over a water tile
 * the supports go down `WATER_DROP` levels instead (a bank that rises inside the tile still stops
 * them), and what lies below the water plane is listed apart, for the renderer to show over water
 * only.
 */
export function bridgeQuads(t: BridgeTile, land: GroundAt): BridgeQuads {
  const kit = KIT[t.material],
    m = `bridgemat/${t.material}`,
    out: BridgeQuads = { sunk: [], body: [], near: [] },
    ground: GroundAt = t.water
      ? (x, y) => {
          const g = land(x, y);
          return g > 0.5 ? g : -WATER_DROP * t.step;
        }
      : land,
    walls: Lists = { above: out.body, sunk: t.water ? out.sunk : null },
    bed = t.bed,
    /** The axis the deck climbs along, where it does. */
    climbs = bed && !bed.flat ? bed.axis : null,
    top: Height = (x, y) => deckTop(t, x, y),
    /** `dz` above (or below) the deck surface. */
    off =
      (dz: number): Height =>
      (x, y) =>
        deckTop(t, x, y) + dz,
    under = off(-SLAB),
    /** The foot of the wall hung under an edge: where its legs start. */
    foot = off(-SLAB - kit.hung),
    P = (e: number, s: number, d = 0) => edgePoint(t, e, s, d);
  /** Columns a face along edge `e` needs: one where the deck and the ground are level. */
  const columns = (e: number) => {
    if (climbs && (climbs === 'x') === LEFT[e]) return 8;
    const g0 = ground(...P(e, 0));
    for (let i = 1; i <= 8; i++) if (Math.abs(ground(...P(e, i / 8)) - g0) > 0.01) return 8;
    return 1;
  };

  // Supports under an edge: far edges first, the camera sees their inner side in the deck's shade.
  const supports = (e: number) => {
    const edge = t.edges[e];
    if (!edge.wall) return;
    const far = FAR[e],
      side = LEFT[e] ? 'l' : 'r',
      turned = LEFT[e] ? 'r' : 'l',
      shade = far ? '-shade' : '',
      cols = columns(e);
    if (t.material === 'stone' && edge.rail) {
      // An end of the bridge: a plain abutment wall across it, down from the slab.
      for (let i = 0; i < 8; i++)
        face(
          walls,
          `${m}-leg-${side}${shade}`,
          P(e, i / 8),
          P(e, (i + 1) / 8),
          under,
          null,
          i % 2 ? [0.5, 1] : [0, 0.5],
          kit.repeat,
          ground,
          1,
        );
      return;
    }
    const leg = (s0: number, s1: number, u: readonly [number, number]) =>
      face(
        walls,
        `${m}-leg-${side}${shade}`,
        P(e, s0),
        P(e, s1),
        foot,
        null,
        u,
        kit.repeat,
        ground,
        2,
      );
    /** The side of a leg that faces the camera, `kit.depth` deep in from the edge at `s`. */
    const legSide = (s: number) => {
      const [p, q] = across(P(e, s), P(e, s, kit.depth));
      face(walls, `${m}-leg-${turned}`, p, q, foot, null, [0, 0.8], kit.repeat, ground, 1);
    };
    if (!far) {
      // Leg sides stand behind the wall: l faces show the side toward +x, r faces toward +y.
      legSide(LEFT[e] ? kit.leg : 1 - kit.leg);
      if (edge.wallEnds[LEFT[e] ? 1 : 0]) legSide(LEFT[e] ? 1 : 0);
    }
    // Two half legs meet at a tile joint as one pier or post: each takes half the swatch.
    leg(0, kit.leg, [0.5, 1]);
    leg(1 - kit.leg, 1, [0, 0.5]);
    if (kit.brace)
      for (let k = 0; k < 4; k++) {
        const p = P(e, kit.leg),
          q = P(e, 1 - kit.leg),
          storey = off(-SLAB - kit.hung - k * kit.brace);
        // A storey too low to show its crossing is left open.
        if (storey(...p) - ground(...p) < 6 && storey(...q) - ground(...q) < 6) break;
        face(
          walls,
          `${m}-brace-${side}${shade}`,
          p,
          q,
          storey,
          off(-SLAB - kit.hung - (k + 1) * kit.brace),
          [0, 1],
          [0, 1],
          ground,
          cols === 1 ? 1 : 4,
        );
      }
    face(
      walls,
      `${m}-hung-${side}${shade}`,
      P(e, 0),
      P(e, 1),
      under,
      foot,
      [0, 1],
      [0, 1],
      ground,
      cols,
    );
  };
  for (const e of [0, 3, 2, 1]) supports(e);

  // The slab: its top, and its side on the near edges that show.
  const strips = climbs ? 8 : 1,
    alongX = !bed || bed.axis === 'x',
    // Timber planks lie across the track.
    turn = t.material === 'wood' && (bed ? alongX : !!t.rails?.includes(1));
  for (let i = 0; i < strips; i++) {
    const f0 = i / strips - 0.5,
      f1 = (i + 1) / strips - 0.5,
      c: [number, number][] = alongX
        ? [
            [t.x + f0, t.y - 0.5],
            [t.x + f1, t.y - 0.5],
            [t.x + f1, t.y + 0.5],
            [t.x + f0, t.y + 0.5],
          ]
        : [
            [t.x - 0.5, t.y + f0],
            [t.x + 0.5, t.y + f0],
            [t.x + 0.5, t.y + f1],
            [t.x - 0.5, t.y + f1],
          ];
    out.body.push({
      key: `${m}-top`,
      p: c.flatMap((p) => [p[0], p[1], top(...p)]),
      uv: c.flatMap((p) => {
        const u = p[0] - t.x + 0.5,
          v = p[1] - t.y + 0.5;
        return turn ? [v, u] : [u, v];
      }),
    });
  }
  for (const e of [2, 1])
    if (t.edges[e].wall)
      face(
        walls,
        `${m}-edge-${LEFT[e] ? 'l' : 'r'}`,
        P(e, 0),
        P(e, 1),
        top,
        under,
        [0, 1],
        [0, 1],
        ground,
        columns(e),
      );

  // Parapets stand on the deck: the far ones are part of the body, the near ones stand in front
  // of whatever rides the deck.
  const parapet = (e: number) => {
    const edge = t.edges[e];
    if (!edge.parapet) return;
    const far = FAR[e],
      side = LEFT[e] ? 'l' : 'r',
      turned = LEFT[e] ? 'r' : 'l',
      list = far ? out.body : out.near,
      lists: Lists = { above: list, sunk: null },
      cols = climbs && (climbs === 'x') === LEFT[e] ? 8 : 1,
      stone = t.material === 'stone',
      // The face the camera sees: the outer one on a near edge, the inner one on a far edge.
      d = far && stone ? kit.thick : 0,
      h = kit.parapet,
      crown = off(h);
    // The end that faces the camera, where the run stops: the far end of an l wall (+x), the
    // near end of an r wall (+y).
    const end = LEFT[e] ? 1 : 0;
    if (edge.parapetEnds[end]) {
      const [p, q] = across(P(e, end), P(e, end, kit.thick));
      face(
        lists,
        stone ? `${m}-parapet-${turned}` : `${m}-leg-${turned}`,
        p,
        q,
        crown,
        top,
        stone ? [0, kit.thick] : [0, 1],
        stone ? [0, 1] : [0, h / kit.repeat],
        null,
        1,
      );
    }
    face(
      lists,
      `${m}-parapet-${side}`,
      P(e, 0, d),
      P(e, 1, d),
      crown,
      top,
      [0, 1],
      [0, 1],
      null,
      cols,
    );
    if (stone)
      for (let i = 0; i < cols; i++) {
        const s0 = i / cols,
          s1 = (i + 1) / cols,
          c = [P(e, s0, kit.thick), P(e, s1, kit.thick), P(e, s1), P(e, s0)];
        list.push({
          key: `${m}-parapet-top`,
          p: c.flatMap((p) => [p[0], p[1], crown(...p)]),
          uv: [s0, 0, s1, 0, s1, 1, s0, 1],
        });
      }
    // Capacity upgrades: a pilaster per level on each parapet, standing a little above it.
    for (let k = 1; k < t.level; k++) {
      const s = k / t.level,
        w = stone ? 0.07 : 0.035,
        rise = off(h + 3),
        // Its side toward the camera: the far end of an l wall, the near end of an r wall.
        [p, q] = across(P(e, LEFT[e] ? s + w : s - w), P(e, LEFT[e] ? s + w : s - w, kit.thick));
      face(
        lists,
        stone ? `${m}-parapet-${turned}` : `${m}-leg-${turned}`,
        p,
        q,
        rise,
        stone ? crown : top,
        stone ? [0, kit.thick] : [0, 1],
        stone ? [0, 3 / h] : [0, (h + 3) / kit.repeat],
        null,
        1,
      );
      face(
        lists,
        `${m}-leg-${side}`,
        P(e, s - w, d),
        P(e, s + w, d),
        rise,
        top,
        [0.1, 0.9],
        [0.02, (h + 3) / kit.repeat],
        null,
        1,
      );
      if (stone) {
        const c = [P(e, s - w, kit.thick), P(e, s + w, kit.thick), P(e, s + w), P(e, s - w)];
        list.push({
          key: `${m}-parapet-top`,
          p: c.flatMap((p) => [p[0], p[1], rise(...p)]),
          uv: [0.02, 0, 0.23, 0, 0.23, 1, 0.02, 1],
        });
      }
    }
  };
  for (const e of [0, 3]) parapet(e);
  for (const e of [2, 1]) parapet(e);
  return out;
}
