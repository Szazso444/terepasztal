import { levelAt, type Elevated } from './elevation';
import { Terrain } from './tiles';
import type { TrackGraph, TrackPiece } from './track';
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
}

/** What a profile reads levels from: the terrain, and the water levels where the map has them. */
type Levels = Elevated;
/**
 * The height a bridge platform's deck is stored at, in levels (absolute, like the terrain's);
 * undefined where the platform is automatic or there is none.
 */
export type DeckAt = (x: number, y: number) => number | undefined;

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
 * Pieces that may climb: every link runs straight through the tile (straight, crossing,
 * bridge piece). Their axes; empty for curves, switches and wide-piece members.
 */
export function climbAxes(links: readonly (readonly [number, number])[]): ('x' | 'y')[] {
  if (!links.length || links.some(([a, b]) => a !== opposite(b as Dir))) return [];
  return links.map(([a]) => (a === Dir.E || a === Dir.W ? 'x' : 'y'));
}

/**
 * Deck level of a curve or switch carried by bridge platforms: the level of the rails it meets
 * off the bridge (neighbours across its links that stand on the ground), or its highest tile when
 * every neighbour is on a platform too. A stored deck under it comes first. Null when the rails
 * it meets or its stored decks disagree, or the deck would sit below the ground under one of its
 * tiles.
 */
export function supportedDeck(
  map: Levels,
  members: readonly { x: number; y: number; links: readonly (readonly [number, number])[] }[],
  bridgeAt: (x: number, y: number) => boolean,
  deckAt: DeckAt = () => undefined,
): number | null {
  const inside = new Set(members.map((m) => m.y * map.w + m.x)),
    meets = new Set<number>(),
    stored = new Set<number>();
  let top = 0;
  for (const m of members) {
    top = Math.max(top, levelAt(map, m.x, m.y));
    const own = deckAt(m.x, m.y);
    if (own !== undefined) stored.add(own);
    for (const link of m.links)
      for (const d of link) {
        const nx = m.x + DIR_DX[d],
          ny = m.y + DIR_DY[d];
        if (inside.has(ny * map.w + nx) || bridgeAt(nx, ny)) continue;
        meets.add(levelAt(map, nx, ny));
      }
  }
  if (stored.size > 1 || (!stored.size && meets.size > 1)) return null;
  const deck = stored.size ? [...stored][0] : meets.size ? [...meets][0] : top;
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
 * has a level: its terrain level, or on a bridge the deck: its stored height (`deckAt`), else the
 * level of the higher abutment. The rail ramps up to a stored deck one level per tile. Tiles at
 * a level change are transitions (the rail bends a little), a level tile between two transitions
 * of one staircase keeps climbing (incline), and every other tile is level. A run of transitions
 * and inclines climbs from the level before it to the level after it, easing in and out; a crest
 * or dip inside a run levels out at the tile that turns. Recomputed whole on every track change,
 * so pieces conform to their neighbours as the line is extended.
 */
export function railProfile(
  map: Levels,
  track: TrackGraph,
  bridgeAt: (x: number, y: number) => boolean = () => false,
  deckAt: DeckAt = () => undefined,
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
      lineProfile(map, track, tiles, axis, bridgeAt, deckAt, beds);
    }
  }
  // Curves and switches carried by bridge platforms sit at the deck (supportedDeck).
  for (const [k, p] of track.pieces) {
    const x = k % map.w,
      y = Math.floor(k / map.w);
    if (beds.has(k) || !bridgeAt(x, y)) continue;
    const members = (p.unit ? track.unitTiles(p.unit.ax, p.unit.ay) : [{ x, y }]).map((t) => ({
      ...t,
      links: track.get(t.x, t.y)?.links ?? [],
    }));
    const deck =
      supportedDeck(map, members, bridgeAt, deckAt) ??
      Math.max(...members.map((t) => Math.max(levelAt(map, t.x, t.y), deckAt(t.x, t.y) ?? 0)));
    beds.set(k, {
      axis: 'x',
      spans: [{ from: x - 2, to: x + 2, a: deck, b: deck }],
      bridge: true,
      flat: true,
    });
  }
  return beds;
}

function lineProfile(
  map: Levels,
  track: TrackGraph,
  tiles: [number, number][],
  axis: 'x' | 'y',
  bridgeAt: (x: number, y: number) => boolean,
  deckAt: DeckAt,
  beds: Map<number, RailBed>,
) {
  const start = axis === 'x' ? tiles[0][0] : tiles[0][1],
    bridge = tiles.map(([x, y]) => bridgeAt(x, y)),
    // A crossing holds both lines level at its centre, so the two rails meet.
    pinned = tiles.map(([x, y]) => (track.get(x, y)?.links.length ?? 0) > 1),
    terrain = tiles.map(([x, y]) => levelAt(map, x, y)),
    // A deck over water is never below the water's level.
    under = tiles.map(([x, y], i) =>
      map.terrain[y * map.w + x] === Terrain.Water ? terrain[i] : 0,
    ),
    decks = tiles.map(([x, y], i) => (bridge[i] ? deckAt(x, y) : undefined)),
    // A curve or switch on a stored deck at an end of the line: the rail ramps up to it too.
    [back, on] = axis === 'x' ? [Dir.W, Dir.E] : [Dir.N, Dir.S],
    beyond = ([x, y]: [number, number], d: Dir) =>
      track.connected(x, y, d) ? deckAt(x + DIR_DX[d], y + DIR_DY[d]) : undefined,
    { spans, levels } = lineSpans(terrain, bridge, start, pinned, under, decks, [
      beyond(tiles[0], back),
      beyond(tiles[tiles.length - 1], on),
    ]);
  tiles.forEach(([x, y], i) => {
    const c = start + i,
      k = y * map.w + x,
      near = spans.filter((s) => s.to > c - 1.5 && s.from < c + 1.5),
      close = near.filter((s) => s.to > c - 0.9 && s.from < c + 0.9),
      bed: RailBed = {
        axis,
        spans: near,
        bridge: bridge[i] || undefined,
        flat: close.every((s) => s.a === s.b && s.a === levels[i]),
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
 * centred at `start` along the axis. `under` is the least a bridge deck may stand at over each
 * tile: the level of the water under it (raised water), 0 where none is given. `decks` is the
 * height stored for a deck, undefined where it is automatic, and `ends` the stored decks the line
 * meets just past its two ends: the rail ramps up to a stored deck one level per tile, over ground
 * that lies lower. Returns the spans and the rail level of each tile.
 */
export function lineSpans(
  terrain: readonly number[],
  bridge: readonly boolean[] = [],
  start = 0,
  pinned: readonly boolean[] = [],
  under: readonly number[] = [],
  decks: readonly (number | undefined)[] = [],
  ends: readonly [number?, number?] = [],
) {
  const n = terrain.length,
    r = [...terrain],
    along = (i: number) => start + i,
    stored = (i: number) => (bridge[i] ? decks[i] : undefined),
    automatic = (i: number) => bridge[i] && stored(i) === undefined,
    [before, after] = ends;
  // A stored deck stands at its height, never below the ground or the water under it.
  for (let i = 0; i < n; i++) {
    const deck = stored(i);
    if (deck !== undefined) r[i] = Math.max(deck, terrain[i], under[i] ?? 0);
  }
  // An automatic deck carries the rail level from its higher abutment across the dip, and stands
  // no lower than the water it crosses.
  for (let i = 0; i < n; i++) {
    if (!automatic(i)) continue;
    let j = i;
    while (j + 1 < n && automatic(j + 1)) j++;
    const ends = [i > 0 ? r[i - 1] : null, j + 1 < n ? r[j + 1] : null].filter(
      (v): v is number => v !== null,
    );
    const deck = Math.max(
      ends.length ? Math.max(...ends) : Math.max(...r.slice(i, j + 1)),
      ...under.slice(i, j + 1),
    );
    for (let k = i; k <= j; k++) r[k] = deck;
    i = j;
  }
  // The rail ramps up to each stored deck from both sides.
  for (const [from, to, step, end] of [
    [0, n, 1, before],
    [n - 1, -1, -1, after],
  ] as const) {
    let reach = (end ?? -Infinity) - 1;
    for (let i = from; i !== to; i += step) {
      if (stored(i) !== undefined) reach = r[i];
      else r[i] = Math.max(r[i], reach);
      reach--;
    }
  }
  const L = (i: number) => (i < 0 ? (before ?? r[0]) : i >= n ? (after ?? r[n - 1]) : r[i]),
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

/** Where the rail ramps to a stored deck (`rampReach`). */
export interface RampReach {
  /** The straight tiles the ramps lift above the ground. */
  climbs: { x: number; y: number }[];
  /** Tiles that would have to be lifted but must stay level. */
  blocked: { x: number; y: number }[];
}
/**
 * What ramping up to the stored decks `decks` does to the track leading away from them, one level
 * per tile (`lineSpans`). A ramp may only rise under a plain straight: a curve, switch, crossing
 * or a tile `stays` names must stay level, so it is reported in `blocked`. A ramp ends where it
 * reaches the ground, where the rail ends, and at a tile of `decks` or one `stops` names (another
 * stored deck, whose own ramps are its own).
 */
export function rampReach(
  map: Levels,
  pieceAt: (x: number, y: number) => Pick<TrackPiece, 'links' | 'unit'> | undefined,
  decks: readonly { x: number; y: number; deck: number }[],
  stays: (x: number, y: number) => boolean = () => false,
  stops: (x: number, y: number) => boolean = () => false,
): RampReach {
  const inside = new Set(decks.map((t) => t.y * map.w + t.x)),
    seen = new Set<number>(),
    climbs: RampReach['climbs'] = [],
    blocked: RampReach['blocked'] = [];
  for (const t of decks)
    for (const d of new Set(pieceAt(t.x, t.y)?.links.flat())) {
      const back = opposite(d);
      let need = t.deck,
        x = t.x,
        y = t.y;
      for (;;) {
        x += DIR_DX[d];
        y += DIR_DY[d];
        need--;
        const k = y * map.w + x,
          q = pieceAt(x, y);
        if (inside.has(k) || stops(x, y) || !q?.links.flat().includes(back)) break;
        if (need <= levelAt(map, x, y)) break;
        const plain = !q.unit && q.links.length === 1 && q.links[0].includes(d);
        if (!plain || stays(x, y)) {
          if (!seen.has(k)) blocked.push({ x, y });
          seen.add(k);
          break;
        }
        if (!seen.has(k)) climbs.push({ x, y });
        seen.add(k);
      }
    }
  return { climbs, blocked };
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
