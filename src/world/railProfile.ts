import { levelAt } from './elevation';
import type { GameMap } from './tiles';
import type { TrackGraph } from './track';
import { Dir, DIR_DX, DIR_DY, opposite } from '../engine/iso';

/**
 * One piece of a rail line's height profile, in tile coordinates along the line's axis: level `a`
 * at `from`, level `b` at `to`. A span with a === b is level track; otherwise the rail climbs with
 * eased ends (a vertical curve on the first and last tile, constant grade between).
 */
export interface RailSpan {
  from: number;
  to: number;
  a: number;
  b: number;
}
/** The rail over one straight track tile: its axis and the profile spans within reach of it. */
export interface RailBed {
  axis: 'x' | 'y';
  spans: RailSpan[];
  /** The rail is carried by a bridge here; the ground under it keeps its own shape. */
  bridge?: boolean;
  /** The rail is level across this tile and its overhang: a plain flat piece. */
  flat: boolean;
  /** A crossing: the profile of the line along the other axis. */
  cross?: RailBed;
  /** The tile's own level on the line: its terrain, or the deck of the bridge platform under it. */
  level?: number;
}
/**
 * A bridge platform as the profile sees it. `deck` is the height the player set, in levels;
 * without one the deck is automatic and takes the level of the higher rail it meets.
 */
export interface DeckPlatform {
  deck?: number;
}
export type PlatformAt = (x: number, y: number) => DeckPlatform | undefined;

type Levels = Pick<GameMap, 'w' | 'h' | 'terrain'>;

/** Rail height in levels at position `t` along the bed's axis. */
export function railLevel(bed: RailBed, t: number): number {
  const spans = bed.spans;
  if (t <= spans[0].from) return spans[0].a;
  for (const s of spans) if (t <= s.to) return t < s.from ? s.a : spanLevel(s, t);
  return spans[spans.length - 1].b;
}

function spanLevel(s: RailSpan, t: number) {
  const rise = s.b - s.a;
  if (!rise) return s.a;
  const length = s.to - s.from,
    ease = Math.min(1, length / 2),
    grade = rise / (length - ease),
    u = t - s.from;
  if (u <= 0) return s.a;
  if (u >= length) return s.b;
  if (u < ease) return s.a + (grade * u * u) / (2 * ease);
  if (u > length - ease) return s.b - (grade * (length - u) ** 2) / (2 * ease);
  return s.a + grade * (ease / 2) + grade * (u - ease);
}

/**
 * Pieces that may climb: every link runs straight through the tile (straight, crossing, class
 * transition, bridge piece). Their axes; empty for curves, switches and wide-piece members.
 */
export function climbAxes(links: readonly (readonly [number, number])[]): ('x' | 'y')[] {
  if (!links.length || links.some(([a, b]) => a !== opposite(b as Dir))) return [];
  return links.map(([a]) => (a === Dir.E || a === Dir.W ? 'x' : 'y'));
}

/**
 * Deck level of a curve or switch carried by bridge platforms: the deck the player set under it,
 * else the level of the rails it meets (neighbours across its links that stand on the ground or
 * on a deck set by hand; automatic decks adapt to it instead), else its highest tile. Null when
 * its own decks or the rails it meets disagree, or the deck would sit below the ground under one
 * of its tiles.
 */
export function supportedDeck(
  map: Levels,
  members: readonly { x: number; y: number; links: readonly (readonly [number, number])[] }[],
  platformAt: PlatformAt,
): number | null {
  const inside = new Set(members.map((m) => m.y * map.w + m.x)),
    meets = new Set<number>(),
    own = new Set<number>();
  let top = 0;
  for (const m of members) {
    top = Math.max(top, levelAt(map, m.x, m.y));
    const set = platformAt(m.x, m.y)?.deck;
    if (set !== undefined) own.add(set);
    for (const link of m.links)
      for (const d of link) {
        const nx = m.x + DIR_DX[d],
          ny = m.y + DIR_DY[d];
        if (inside.has(ny * map.w + nx)) continue;
        const there = platformAt(nx, ny);
        if (there && there.deck === undefined) continue;
        meets.add(Math.max(there?.deck ?? 0, levelAt(map, nx, ny)));
      }
  }
  if (meets.size > 1 || own.size > 1) return null;
  const deck = own.size ? [...own][0] : meets.size ? [...meets][0] : top;
  if (meets.size && !meets.has(deck)) return null;
  return deck < top ? null : deck;
}

/** Pick the profile a point on a crossing rides: the line whose centreline it is nearer. */
export function bedFor(bed: RailBed, x: number, y: number): RailBed {
  if (!bed.cross) return bed;
  const offX = Math.abs(y - Math.round(y)),
    offY = Math.abs(x - Math.round(x)),
    near = offX <= offY ? 'x' : 'y';
  return bed.axis === near ? bed : bed.cross;
}

/**
 * Height profile of every straight rail line (rules: docs/rail-inclines.md). Each tile of a line
 * has a level: its terrain level, or on a bridge the deck: the height the player set, else the
 * level of the higher abutment. Tiles at
 * a level change are transitions (the rail bends a little), a level tile between two transitions
 * of one staircase keeps climbing (incline), and every other tile is level. A run of transitions
 * and inclines climbs from the level before it to the level after it, easing in and out; a crest
 * or dip inside a run levels out at the tile that turns. Recomputed whole on every track change,
 * so pieces conform to their neighbours as the line is extended.
 */
export function railProfile(
  map: Levels,
  track: TrackGraph,
  platformAt: PlatformAt = () => undefined,
): Map<number, RailBed> {
  const beds = new Map<number, RailBed>(),
    axesAt = (x: number, y: number) => {
      const p = track.get(x, y);
      return p && !p.unit ? climbAxes(p.links) : [];
    };
  for (const [k, p] of track.pieces) {
    const x = k % map.w,
      y = Math.floor(k / map.w);
    for (const axis of p.unit ? [] : climbAxes(p.links)) {
      const dx = axis === 'x' ? 1 : 0,
        dy = 1 - dx;
      // Start of a line: the tile behind carries no rail along the same axis.
      if (axesAt(x - dx, y - dy).includes(axis)) continue;
      const tiles: [number, number][] = [];
      for (let tx = x, ty = y; axesAt(tx, ty).includes(axis); tx += dx, ty += dy)
        tiles.push([tx, ty]);
      lineProfile(map, track, tiles, axis, platformAt, beds);
    }
  }
  // Curves and switches carried by bridge platforms sit at the deck (supportedDeck).
  for (const [k, p] of track.pieces) {
    const x = k % map.w,
      y = Math.floor(k / map.w);
    if (beds.has(k) || !platformAt(x, y)) continue;
    const members = (p.unit ? track.unitTiles(p.unit.ax, p.unit.ay) : [{ x, y }]).map((t) => ({
      ...t,
      links: track.get(t.x, t.y)?.links ?? [],
    }));
    const deck =
      supportedDeck(map, members, platformAt) ??
      Math.max(
        ...members.map((t) => Math.max(levelAt(map, t.x, t.y), platformAt(t.x, t.y)?.deck ?? 0)),
      );
    beds.set(k, {
      axis: 'x',
      spans: [{ from: x - 2, to: x + 2, a: deck, b: deck }],
      bridge: true,
      flat: true,
      level: deck,
    });
  }
  return beds;
}

function lineProfile(
  map: Levels,
  track: TrackGraph,
  tiles: [number, number][],
  axis: 'x' | 'y',
  platformAt: PlatformAt,
  beds: Map<number, RailBed>,
) {
  const start = axis === 'x' ? tiles[0][0] : tiles[0][1],
    platforms = tiles.map(([x, y]) => platformAt(x, y)),
    ground = tiles.map(([x, y]) => levelAt(map, x, y)),
    // A deck the player set is the tile's level like any terrace (never below the ground under
    // it); only automatic decks take the level of their abutments.
    set = platforms.map((p, i) =>
      p?.deck === undefined ? undefined : Math.max(p.deck, ground[i]),
    ),
    // A crossing holds both lines level at its centre, so the two rails meet.
    pinned = tiles.map(([x, y]) => (track.get(x, y)?.links.length ?? 0) > 1),
    { spans, levels } = lineSpans(
      ground.map((g, i) => set[i] ?? g),
      platforms.map((p, i) => !!p && set[i] === undefined),
      start,
      pinned,
    );
  tiles.forEach(([x, y], i) => {
    const c = start + i,
      k = y * map.w + x,
      near = spans.filter((s) => s.to > c - 1.5 && s.from < c + 1.5),
      close = near.filter((s) => s.to > c - 0.9 && s.from < c + 0.9),
      bed: RailBed = {
        axis,
        spans: near,
        bridge: platforms[i] ? true : undefined,
        flat: close.every((s) => s.a === s.b && s.a === levels[i]),
        level: levels[i],
      },
      other = beds.get(k);
    if (!other) beds.set(k, bed);
    // The climbing line leads (its piece bends); the other rides along as the crossing.
    else if (other.flat && !bed.flat) beds.set(k, { ...bed, cross: other });
    else beds.set(k, { ...other, cross: bed, flat: other.flat && bed.flat });
  });
}

/**
 * Profile spans of one straight line whose tiles have the given terrain levels, the first tile
 * centred at `start` along the axis. Returns the spans and the rail level of each tile.
 */
export function lineSpans(
  terrain: readonly number[],
  bridge: readonly boolean[] = [],
  start = 0,
  pinned: readonly boolean[] = [],
) {
  const n = terrain.length,
    r = [...terrain],
    along = (i: number) => start + i;
  // A bridge deck carries the rail level from its higher abutment across the dip.
  for (let i = 0; i < n; i++) {
    if (!bridge[i]) continue;
    let j = i;
    while (j + 1 < n && bridge[j + 1]) j++;
    const ends = [i > 0 ? r[i - 1] : null, j + 1 < n ? r[j + 1] : null].filter(
      (v): v is number => v !== null,
    );
    const deck = ends.length ? Math.max(...ends) : Math.max(...r.slice(i, j + 1));
    for (let k = i; k <= j; k++) r[k] = deck;
    i = j;
  }
  const L = (i: number) => r[Math.max(0, Math.min(n - 1, i))],
    change = (i: number) => L(i + 1) - L(i),
    // Transitions: a level change at either edge.
    bent = r.map((_, i) => change(i - 1) !== 0 || change(i) !== 0),
    // Inclines: a level tile between two transitions of one staircase.
    moving = bent.map(
      (b, i) =>
        b ||
        (i > 0 &&
          i < n - 1 &&
          bent[i - 1] &&
          bent[i + 1] &&
          change(i - 2) !== 0 &&
          Math.sign(change(i - 2)) === Math.sign(change(i + 1))),
    );
  const spans: RailSpan[] = [];
  for (let i = 0; i < n;) {
    if (!moving[i]) {
      spans.push({ from: along(i) - 0.5, to: along(i) + 0.5, a: r[i], b: r[i] });
      i++;
      continue;
    }
    let q = i;
    while (q + 1 < n && moving[q + 1]) q++;
    // Knots: the run's ends, and each crest or dip inside it, held level across its tiles.
    const knots: [number, number][] = [[along(i) - 0.5, L(i - 1)]];
    for (let u = i; u <= q;) {
      let v = u;
      while (v + 1 <= q && r[v + 1] === r[u]) v++;
      const before = u === i ? L(i - 1) : r[u - 1],
        after = v === q ? L(q + 1) : r[v + 1];
      if (Math.sign(r[u] - before) * Math.sign(r[u] - after) > 0)
        knots.push([along(u), r[u]], [along(v), r[u]]);
      u = v + 1;
    }
    for (let u = i; u <= q; u++) if (pinned[u]) knots.push([along(u), r[u]]);
    knots.push([along(q) + 0.5, L(q + 1)]);
    knots.sort((a, b) => a[0] - b[0]);
    for (let k = 1; k < knots.length; k++)
      if (knots[k][0] > knots[k - 1][0])
        spans.push({ from: knots[k - 1][0], to: knots[k][0], a: knots[k - 1][1], b: knots[k][1] });
    i = q + 1;
  }
  return { spans, levels: r, moving };
}

/** Speed while climbing: half. */
export const CLIMB_SPEED = 0.5;
/** Speed while descending: a fifth faster. */
export const DESCENT_SPEED = 1.2;
/**
 * Speed multiplier for a train crossing tile (x, y) from its `inDir` edge to its `outDir` edge:
 * climbing when the rail leaves the tile higher than it enters, descending when lower.
 */
export function railGrade(
  beds: ReadonlyMap<number, RailBed>,
  w: number,
  x: number,
  y: number,
  inDir: Dir,
  outDir: Dir,
) {
  const tile = beds.get(y * w + x),
    axis = inDir === Dir.E || inDir === Dir.W ? 'x' : 'y',
    bed = tile?.cross && tile.axis !== axis ? tile.cross : tile;
  if (!bed || bed.flat || bed.axis !== axis) return 1;
  const centre = bed.axis === 'x' ? x : y,
    edge = (d: Dir) => centre + 0.5 * (d === Dir.E || d === Dir.S ? 1 : -1),
    from = railLevel(bed, edge(inDir)),
    to = railLevel(bed, edge(outDir));
  return to > from + 1e-6 ? CLIMB_SPEED : to < from - 1e-6 ? DESCENT_SPEED : 1;
}
