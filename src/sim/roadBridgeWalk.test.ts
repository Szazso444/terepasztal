import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain, type GameMap } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Rng } from '../engine/rng';
import { Builder, type LinePiece } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { resetStationIds } from './stations';
import { rules, DEFAULT_RULES } from './rules';
import { bridgeSpan, roadDeckAxis, roadDecks, type RoadDecks } from './bridges';
import {
  OFF_ROAD_STEP,
  PeopleSim,
  WALK_MARGIN,
  findWalk,
  roadStep,
  walkable,
  type Person,
} from './people';
import { SEEDS, forAll, shrinkArray } from '../testing/property';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  resetStationIds(1);
  vi.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error('the walkers drew from Math.random');
  });
});
afterEach(() => vi.restoreAllMocks());

type Tile = { x: number; y: number };
const S = 48;
/** A straight's turn: 0 runs north to south, 1 east to west. */
const NS = 0;
const EW = 1;

/** A grass site of S by S tiles, built in the editor's way, with `water` tiles of water. */
function site(water: (x: number, y: number) => boolean) {
  const map = emptyMap(3, S, S, Terrain.Grass);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) if (water(x, y)) map.terrain[y * S + x] = Terrain.Water;
  const track = new TrackGraph(S, S);
  const builder = new Builder(map, new RegionState(map), track, new Economy(), new Stockpile());
  builder.free = true;
  return { map, track, builder, roads: builder.roads, decks: roadDecks(builder) };
}
type Site = ReturnType<typeof site>;

/**
 * A bridge dragged as a line from (x, y), `n` tiles along `rot`: a platform on each tile, and on
 * each a straight (`rail`), or once it stands a road (`road`), or nothing (`bare`). False when the
 * builder refuses the line or a road on it.
 */
function bridge(
  w: Site,
  x: number,
  y: number,
  n: number,
  rot: number,
  carries: 'rail' | 'road' | 'bare',
  id = 'bridge_wood',
) {
  const pieces: LinePiece[] = [];
  for (let i = 0; i < n; i++) {
    const t = rot === EW ? { x: x + i, y } : { x, y: y + i };
    pieces.push({ kind: 'platform', ...t, defId: id });
    if (carries === 'rail')
      pieces.push({ kind: 'track', ...t, item: { kind: 'straight', cls: 'branch' }, rot });
  }
  if (!w.builder.placeLine(pieces)) return false;
  // a road on each platform the line laid; on one already paved the builder refuses another
  if (carries === 'road') return pieces.map((p) => w.builder.placeRoad(p.x, p.y)).every(Boolean);
  return true;
}

/** The fewest steps from `a` to `b` in 8 directions over ground `walkable` gives, map-wide. */
function fewestSteps(map: GameMap, a: Tile, b: Tile, decks: RoadDecks | null): number | null {
  const dist = new Map<number, number>([[a.y * map.w + a.x, 0]]);
  const queue = [a];
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    const d = dist.get(c.y * map.w + c.x)!;
    if (c.x === b.x && c.y === b.y) return d;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = { x: c.x + dx, y: c.y + dy };
        if ((!dx && !dy) || !walkable(map, n.x, n.y, decks) || dist.has(n.y * map.w + n.x))
          continue;
        dist.set(n.y * map.w + n.x, d + 1);
        queue.push(n);
      }
  }
  return null;
}

/** What a walk costs: 1 a step along a road, OFF_ROAD_STEP any other (`findWalk`). */
const costOf = (w: Site, path: Tile[]) =>
  path.slice(1).reduce((sum, t, i) => sum + (roadStep(w.roads, path[i], t) ? 1 : OFF_ROAD_STEP), 0);

/** What breaks the rules of a walk over road bridges (#502) on `w`; '' when nothing does. */
function brokenWalk(w: Site, path: Tile[]): string {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) return `step ${i} is no step`;
    const water = w.map.terrain[b.y * S + b.x] === Terrain.Water;
    if (water && !w.builder.bridgeAt(b.x, b.y)) return `step ${i} onto water at ${b.x},${b.y}`;
    if (water && w.track.has(b.x, b.y)) return `step ${i} onto rails over water at ${b.x},${b.y}`;
    if (water && !w.roads.has(b.x, b.y)) return `step ${i} onto a bare platform at ${b.x},${b.y}`;
    for (const t of [a, b]) {
      const axis = w.decks.axis(t.x, t.y);
      if (axis !== null && (axis === EW ? dy !== 0 : dx !== 0))
        return `step ${i} ${dx},${dy} goes off the deck at ${t.x},${t.y} across its axis`;
    }
  }
  return '';
}

/** The box findWalk searches first: the two ends' and WALK_MARGIN round it, inside the map. */
function boxOf(a: Tile, b: Tile) {
  return {
    x0: Math.max(0, Math.min(a.x, b.x) - WALK_MARGIN),
    y0: Math.max(0, Math.min(a.y, b.y) - WALK_MARGIN),
    x1: Math.min(S - 1, Math.max(a.x, b.x) + WALK_MARGIN),
    y1: Math.min(S - 1, Math.max(a.y, b.y) + WALK_MARGIN),
  };
}

/** A walker of `people` set off from `from` to `to` by its own `startWalk`; null when it is not. */
function started(people: PeopleSim, from: Tile, to: Tile): Tile[] | null {
  const p = { path: [], step: 0, x: 0, y: 0, state: 'idle' } as unknown as Person;
  const start = (
    people as unknown as {
      startWalk(p: Person, from: Tile, to: Tile, state: Person['state']): boolean;
    }
  ).startWalk.bind(people);
  return start(p, from, to, 'walk') ? p.path : null;
}

describe('walkers cross a road bridge (#502)', () => {
  /** A river five tiles wide, rows 20 to 24, from the west edge to x = 27, and land past it. */
  const RIVER = (x: number, y: number) => y >= 20 && y <= 24 && x <= 27;
  const FROM = { x: 10, y: 17 };
  const TO = { x: 10, y: 27 };
  /** The river with a five-tile road bridge down column 10 and a road onto each end. */
  function roadBridge() {
    const w = site(RIVER);
    expect(bridge(w, 10, 20, 5, NS, 'road')).toBe(true);
    for (const y of [19, 25]) expect(w.builder.placeRoad(10, y)).toBe(true);
    return w;
  }

  it('walks bank to bank over a five-tile road bridge, shorter than the long way round', () => {
    const w = roadBridge();
    const walk = findWalk(w.map, FROM, TO, w.roads, null, w.decks)!;
    expect(walk).not.toBeNull();
    expect(brokenWalk(w, walk)).toBe('');
    for (let y = 20; y <= 24; y++) expect(walk).toContainEqual({ x: 10, y });
    // the long way round the river's end at x = 27, on no bridge
    const round = fewestSteps(w.map, FROM, TO, null)!;
    expect(round).not.toBeNull();
    expect(walk.length - 1).toBeLessThan(round);
    // a walker sets off on that walk
    const people = new PeopleSim(w.map, w.builder, new Rng(1));
    expect(started(people, FROM, TO)).toEqual(walk);
    // and with no road decks given the river is in the way, as before there were road bridges
    expect(findWalk(w.map, FROM, TO, w.roads)).toBeNull();
  });

  it('finds no walk with the road off a deck, or the deck gone: startWalk is false as today', () => {
    for (const y of [20, 22, 24]) {
      const w = roadBridge();
      expect(w.builder.removeRoad(10, y)).toBe(true);
      expect(walkable(w.map, 10, y, w.decks), `bare at ${y}`).toBe(false);
      expect(findWalk(w.map, FROM, TO, w.roads, null, w.decks), `bare at ${y}`).toBeNull();
      expect(started(new PeopleSim(w.map, w.builder, new Rng(1)), FROM, TO)).toBeNull();
      expect(w.builder.removeBuilding(10, y)).toBe(true);
      expect(findWalk(w.map, FROM, TO, w.roads, null, w.decks), `gone at ${y}`).toBeNull();
      expect(started(new PeopleSim(w.map, w.builder, new Rng(1)), FROM, TO)).toBeNull();
    }
  });

  it('never sets foot on a bare platform or on a platform with rail', () => {
    for (const carries of ['bare', 'rail'] as const) {
      const w = site(RIVER);
      expect(bridge(w, 10, 19, 7, NS, carries), carries).toBe(true);
      for (let y = 20; y <= 24; y++) expect(walkable(w.map, 10, y, w.decks)).toBe(false);
      expect(findWalk(w.map, FROM, TO, w.roads, null, w.decks), carries).toBeNull();
    }
  });

  it('keeps to the deck: no step sideways off it, and the search widens to reach round', () => {
    // a river rows 20 to 30, a road bridge down column 10 over it, and a spit of land beside the
    // bridge at x = 11, from the south bank up to row 24: the one way onto the spit from the north
    // is down the whole bridge, off its far end and back up, out of the box the two ends span
    const w = site((x, y) => y >= 20 && y <= 30 && x <= 27 && !(x === 11 && y >= 24));
    expect(bridge(w, 10, 20, 11, NS, 'road')).toBe(true);
    for (const y of [19, 31]) expect(w.builder.placeRoad(10, y)).toBe(true);
    const from = { x: 10, y: 18 };
    const to = { x: 11, y: 24 };
    const walk = findWalk(w.map, from, to, w.roads, null, w.decks)!;
    expect(walk).not.toBeNull();
    expect(brokenWalk(w, walk)).toBe('');
    expect(walk).toContainEqual({ x: 10, y: 31 });
    const box = boxOf(from, to);
    expect(walk.some((t) => t.y > box.y1)).toBe(true);
    // the widening is the span's length and WALK_MARGIN, north and south of the box: no further
    for (const t of walk) expect(t.y).toBeLessThanOrEqual(box.y1 + 11 + WALK_MARGIN);
    expect(started(new PeopleSim(w.map, w.builder, new Rng(1)), from, to)).toEqual(walk);
  });

  it('steps onto a road deck on land only along it, and elsewhere on land as ever', () => {
    // a lone road platform on grass, running east to west: a walk past it diagonally goes round
    const w = site(() => false);
    expect(bridge(w, 10, 10, 3, EW, 'road')).toBe(true);
    expect(w.decks.axis(11, 10)).toBe(EW);
    const from = { x: 11, y: 9 };
    const to = { x: 12, y: 10 };
    const walk = findWalk(w.map, from, to, w.roads, null, w.decks)!;
    expect(brokenWalk(w, walk)).toBe('');
    expect(walk.length).toBeGreaterThan(2);
    // with no decks the land platform is grass to a walker, as before
    expect(findWalk(w.map, from, to, w.roads)).toEqual([from, to]);
  });
});

// ---------------------------------------------------------------- seeded rivers and bridges

interface BridgeCase {
  /** the river runs across the map (EW) or down it (NS), at `at`, `width` tiles wide */
  river: { rot: number; at: number; width: number; end: number };
  bridges: { along: number; extra: number; carries: 'rail' | 'road' | 'bare'; id: string }[];
  /** road platforms on land: x, y and turn */
  land: { x: number; y: number; rot: number; n: number }[];
  /** land roads, as runs from (x, y) */
  roads: { x: number; y: number; rot: number; n: number }[];
  walks: { from: Tile; to: Tile }[];
}
function genBridges(rng: Rng): BridgeCase {
  const rot = rng.int(0, 1);
  const width = rng.int(1, 7);
  const at = rng.int(8, S - 8 - width);
  const tile = () => ({ x: rng.int(0, S - 1), y: rng.int(0, S - 1) });
  return {
    river: { rot, at, width, end: rng.chance(0.5) ? S : rng.int(S / 2, S - 1) },
    bridges: Array.from({ length: rng.int(0, 4) }, () => ({
      along: rng.int(2, S - 3),
      extra: rng.int(0, 2),
      carries: rng.pick(['road', 'road', 'rail', 'bare'] as const),
      id: rng.pick(['bridge_wood', 'bridge_stone']),
    })),
    land: Array.from({ length: rng.int(0, 3) }, () => ({
      ...tile(),
      rot: rng.int(0, 1),
      n: rng.int(1, 4),
    })),
    roads: Array.from({ length: rng.int(0, 6) }, () => ({
      ...tile(),
      rot: rng.int(0, 1),
      n: rng.int(2, 14),
    })),
    walks: Array.from({ length: 12 }, () => {
      const from = tile();
      // most walks go a town's way, some cross the map
      const near = rng.chance(0.7);
      const to = near
        ? {
            x: Math.min(S - 1, Math.max(0, from.x + rng.int(-14, 14))),
            y: Math.min(S - 1, Math.max(0, from.y + rng.int(-14, 14))),
          }
        : tile();
      return { from, to };
    }),
  };
}
function bridgeSite(c: BridgeCase) {
  const { rot, at, width, end } = c.river;
  // a river across the map is rows at.., one down it columns at.., as far as `end` along it
  const w = site((x, y) =>
    rot === EW ? y >= at && y < at + width && x < end : x >= at && x < at + width && y < end,
  );
  for (const b of c.bridges) {
    // across the river, the other way to it, from a bank to the other with `extra` on land
    const start = at - b.extra;
    const n = width + 2 * b.extra;
    if (rot === EW) bridge(w, b.along, start, n, NS, b.carries, b.id);
    else bridge(w, start, b.along, n, EW, b.carries, b.id);
  }
  for (const l of c.land) {
    const n = Math.min(l.n, S - (l.rot === EW ? l.x : l.y));
    bridge(w, l.x, l.y, n, l.rot, 'road');
  }
  for (const r of c.roads)
    for (let i = 0; i < r.n; i++)
      w.builder.placeRoad(r.rot === EW ? r.x + i : r.x, r.rot === EW ? r.y : r.y + i);
  return w;
}

describe('walks over seeded rivers and bridges (#502)', () => {
  // Slow: 100 seeded sites of a dozen walks each, about 0.6 s alone; the limit is twenty-five times.
  it('keep to the rules, and are what they were wherever no road deck lies in the box', () => {
    let decked = 0;
    let unchanged = 0;
    forAll(
      genBridges,
      (c) => {
        const w = bridgeSite(c);
        for (const { from, to } of c.walks) {
          if (!walkable(w.map, from.x, from.y) || !walkable(w.map, to.x, to.y)) continue;
          const walk = findWalk(w.map, from, to, w.roads, null, w.decks);
          const before = findWalk(w.map, from, to, w.roads);
          const pair = `${from.x},${from.y} to ${to.x},${to.y}`;
          if (walk) {
            expect(walk[0], pair).toEqual(from);
            expect(walk.at(-1), pair).toEqual(to);
            expect(brokenWalk(w, walk), pair).toBe('');
          }
          const box = boxOf(from, to);
          let deckInBox = false;
          for (let y = box.y0; y <= box.y1; y++)
            for (let x = box.x0; x <= box.x1; x++)
              if (w.decks.axis(x, y) !== null) deckInBox = true;
          if (!deckInBox) {
            unchanged++;
            expect(walk, pair).toEqual(before);
            continue;
          }
          decked++;
          // a road bridge only adds ways: a walk that set foot on no deck is still there, as cheap
          const onDeck = (p: Tile[]) => p.some((t) => w.builder.bridgeAt(t.x, t.y));
          if (before && !onDeck(before)) {
            expect(walk, pair).not.toBeNull();
            expect(costOf(w, walk!), pair).toBeLessThanOrEqual(costOf(w, before));
          }
        }
      },
      {
        seeds: SEEDS,
        shrink: function* (c) {
          for (const walks of shrinkArray(c.walks)) yield { ...c, walks };
          for (const bridges of shrinkArray(c.bridges)) yield { ...c, bridges };
          for (const land of shrinkArray(c.land)) yield { ...c, land };
          for (const roads of shrinkArray(c.roads)) yield { ...c, roads };
        },
      },
    );
    // the seeds reach both kinds of walk
    expect(decked).toBeGreaterThan(50);
    expect(unchanged).toBeGreaterThan(50);
  }, 15_000);

  it('cross every road bridge over a river from edge to edge, bank to bank', () => {
    let crossed = 0;
    forAll(
      genBridges,
      (c) => {
        const w = bridgeSite({ ...c, river: { ...c.river, end: S } });
        const { rot, at, width } = c.river;
        c.bridges.forEach((b, i) => {
          if (b.carries !== 'road') return;
          // two to four tiles off each landing, a tile or two to one side or the other
          const rng = new Rng(i + 1);
          const off = () => b.along + rng.int(-2, 2);
          const near = at - b.extra - rng.int(2, 4);
          const far = at + width + b.extra - 1 + rng.int(2, 4);
          if (near < 0 || far >= S) return;
          const from = rot === EW ? { x: off(), y: near } : { x: near, y: off() };
          const to = rot === EW ? { x: off(), y: far } : { x: far, y: off() };
          if (!walkable(w.map, from.x, from.y) || !walkable(w.map, to.x, to.y)) return;
          // a bridge whose line was refused, or whose road was not paved on every deck, is no way
          // over; nor one a road crosses on land, where that deck reads the crossing road's axis
          for (let k = -b.extra; k < width + b.extra; k++) {
            const t = rot === EW ? { x: b.along, y: at + k } : { x: at + k, y: b.along };
            if (w.decks.axis(t.x, t.y) !== (rot === EW ? NS : EW)) return;
          }
          const pair = `${from.x},${from.y} to ${to.x},${to.y}`;
          const walk = findWalk(w.map, from, to, w.roads, null, w.decks);
          expect(walk, pair).not.toBeNull();
          expect(brokenWalk(w, walk!), pair).toBe('');
          expect(findWalk(w.map, from, to, w.roads), pair).toBeNull();
          crossed++;
        });
      },
      { seeds: SEEDS },
    );
    expect(crossed).toBeGreaterThan(30);
  });
});

// ---------------------------------------------------------------- oracle, live decks, towns

/** Is walk cost `a` lighter than `b`: cheaper, or as cheap with fewer steps off the road. */
const lighter = (a: { cost: number; off: number }, b: { cost: number; off: number }) =>
  a.cost < b.cost || (a.cost === b.cost && a.off < b.off);
/** A walk's cost as findWalk weighs it: the cost, then its steps off the road between equals. */
function weighOf(w: Site, path: Tile[]) {
  let off = 0;
  path.slice(1).forEach((t, i) => (off += roadStep(w.roads, path[i], t) ? 0 : 1));
  return { cost: costOf(w, path), off };
}
type Box = ReturnType<typeof boxOf>;
const inBox = (b: Box, t: Tile) => t.x >= b.x0 && t.y >= b.y0 && t.x <= b.x1 && t.y <= b.y1;
/** Whether (x, y) of `w` carries a road deck: a bridge platform with a road and no rail. */
const isDeck = (w: Site, x: number, y: number) =>
  !!w.builder.bridgeAt(x, y) && w.roads.has(x, y) && !w.track.has(x, y);
/** The tiles of `w` with a road deck on them. */
function deckTiles(w: Site): Tile[] {
  const out: Tile[] = [];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (isDeck(w, x, y)) out.push({ x, y });
  return out;
}
/**
 * The box of the second search, from the rules of #502 as Core wrote them: wider along each axis a
 * road deck in `box` runs on, on both sides, by the longest span there (`bridgeSpan`) and
 * WALK_MARGIN, inside the map; null with no road deck in it.
 */
function widerBox(w: Site, box: Box): Box | null {
  let ns = 0;
  let ew = 0;
  for (let y = box.y0; y <= box.y1; y++)
    for (let x = box.x0; x <= box.x1; x++) {
      if (!isDeck(w, x, y)) continue;
      const span = bridgeSpan(w.builder, w.builder.bridgeAt(x, y)!);
      if (span.axis === EW) ew = Math.max(ew, span.length);
      else ns = Math.max(ns, span.length);
    }
  if (!ns && !ew) return null;
  const ox = ew ? ew + WALK_MARGIN : 0;
  const oy = ns ? ns + WALK_MARGIN : 0;
  return {
    x0: Math.max(0, box.x0 - ox),
    y0: Math.max(0, box.y0 - oy),
    x1: Math.min(S - 1, box.x1 + ox),
    y1: Math.min(S - 1, box.y1 + oy),
  };
}
/**
 * The lightest walk from `a` to `b` inside `box` by the rules of #502, the slow obvious way:
 * relax every legal step until nothing changes. A step goes to a king's neighbour that is open
 * ground, a road deck over water, or `b`, and where either end is a road deck it goes one tile
 * straight along that deck's axis (`roadDeckAxis`). Nothing is walked on from `b`. Null when none.
 */
function lightest(w: Site, a: Tile, b: Tile, box: Box) {
  const deckAxis = (x: number, y: number) =>
    isDeck(w, x, y) ? roadDeckAxis(w.builder, x, y) : null;
  const along = (axis: 0 | 1 | null, dx: number, dy: number) =>
    axis === null || (axis === EW ? dy === 0 : dx === 0);
  const best = new Map<number, { cost: number; off: number }>([
    [a.y * S + a.x, { cost: 0, off: 0 }],
  ]);
  const queue = [a];
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    if (c.x === b.x && c.y === b.y) continue;
    const here = best.get(c.y * S + c.x)!;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = { x: c.x + dx, y: c.y + dy };
        if ((!dx && !dy) || !inBox(box, n)) continue;
        const ground = w.map.terrain[n.y * S + n.x];
        const open =
          ground === Terrain.Water
            ? deckAxis(n.x, n.y) !== null
            : ground !== Terrain.Rock && ground !== Terrain.Mountain;
        if (!open && !(n.x === b.x && n.y === b.y)) continue;
        if (!along(deckAxis(c.x, c.y), dx, dy) || !along(deckAxis(n.x, n.y), dx, dy)) continue;
        const road = roadStep(w.roads, c, n);
        const next = {
          cost: here.cost + (road ? 1 : OFF_ROAD_STEP),
          off: here.off + (road ? 0 : 1),
        };
        const there = best.get(n.y * S + n.x);
        if (there && !lighter(next, there)) continue;
        best.set(n.y * S + n.x, next);
        queue.push(n);
      }
  }
  return best.get(b.y * S + b.x) ?? null;
}

interface OracleCase {
  site: BridgeCase;
  /** each end a tile, or (its deck not null) the deck-th road deck of the site, mod their count */
  walks: { from: Tile; to: Tile; fromDeck: number | null; toDeck: number | null }[];
}
function genOracle(rng: Rng): OracleCase {
  const site = genBridges(rng);
  const deck = () => (rng.chance(0.4) ? rng.int(0, 999) : null);
  const walks = site.walks.slice(0, 8).map((wk) => ({ ...wk, fromDeck: deck(), toDeck: deck() }));
  if (rng.chance(0.5)) {
    // two road bridges side by side over a wide river, and walks from the middle of one to the
    // other: off the end of the first, along the bank and on to the second, which reach past the
    // box when the bridges are long
    const { rot, at, width } = (site.river = { ...site.river, width: rng.int(5, 7) });
    const along = rng.int(2, S - 12);
    const gap = rng.int(2, 9);
    const extra = rng.int(0, 2);
    for (const x of [along, along + gap])
      site.bridges.push({ along: x, extra, carries: 'road', id: 'bridge_wood' });
    for (let n = 0; n < 5; n++) {
      const tile = (x: number, i: number) => (rot === EW ? { x, y: at + i } : { x: at + i, y: x });
      const from = tile(along, rng.int(0, width - 1));
      const to = tile(along + gap, rng.int(0, width - 1));
      walks.push({
        ...(rng.chance(0.5) ? { from, to } : { from: to, to: from }),
        fromDeck: null,
        toDeck: null,
      });
    }
  }
  return { site: { ...site, walks: [] }, walks };
}

describe('walks over road bridges, against the slow obvious search (#502)', () => {
  // Slow: 100 seeded sites, each walk searched again by relaxing every step, about 1 s alone; the
  // limit is twenty times that.
  it('cost what the lightest legal walk in the box costs, else in the wider box, else none', () => {
    let first = 0;
    let wide = 0;
    let none = 0;
    let fromDeck = 0;
    forAll(
      genOracle,
      (c) => {
        const w = bridgeSite(c.site);
        const decks = deckTiles(w);
        for (const wk of c.walks) {
          const pick = (t: Tile, d: number | null) =>
            d !== null && decks.length ? decks[d % decks.length] : t;
          const from = pick(wk.from, wk.fromDeck);
          const to = pick(wk.to, wk.toDeck);
          if (!walkable(w.map, from.x, from.y, w.decks) || !walkable(w.map, to.x, to.y, w.decks))
            continue;
          const pair = `${from.x},${from.y} to ${to.x},${to.y}`;
          const walk = findWalk(w.map, from, to, w.roads, null, w.decks);
          const box = boxOf(from, to);
          const inFirst = lightest(w, from, to, box);
          const wider = inFirst ? null : widerBox(w, box);
          const want = inFirst ?? (wider ? lightest(w, from, to, wider) : null);
          if (!want) {
            none++;
            expect(walk, `${pair}: there is no legal walk`).toBeNull();
            continue;
          }
          expect(walk, `${pair}: a legal walk exists`).not.toBeNull();
          expect(walk![0], pair).toEqual(from);
          expect(walk!.at(-1), pair).toEqual(to);
          expect(brokenWalk(w, walk!), pair).toBe('');
          expect(weighOf(w, walk!), pair).toEqual(want);
          const within = inFirst ? box : wider!;
          for (const t of walk!) expect(inBox(within, t), `${pair}: ${t.x},${t.y}`).toBe(true);
          if (inFirst) first++;
          else wide++;
          if (w.map.terrain[from.y * S + from.x] === Terrain.Water) fromDeck++;
        }
      },
      {
        seeds: SEEDS,
        shrink: function* (c) {
          for (const walks of shrinkArray(c.walks)) yield { ...c, walks };
          const s = c.site;
          for (const bridges of shrinkArray(s.bridges)) yield { ...c, site: { ...s, bridges } };
          for (const land of shrinkArray(s.land)) yield { ...c, site: { ...s, land } };
          for (const roads of shrinkArray(s.roads)) yield { ...c, site: { ...s, roads } };
        },
      },
    );
    // the seeds reach every outcome, and walks that set out from a deck over water
    expect(first).toBeGreaterThan(300);
    expect(wide).toBeGreaterThan(15);
    expect(none).toBeGreaterThan(20);
    expect(fromDeck).toBeGreaterThan(80);
  }, 20_000);
});

describe('a walker reads the road decks as they stand (#502)', () => {
  it('crosses once the road is laid on the deck, and not once it is taken off again', () => {
    const w = site((x, y) => y >= 20 && y <= 24 && x <= 27);
    expect(bridge(w, 10, 20, 5, NS, 'bare')).toBe(true);
    for (const y of [19, 25]) expect(w.builder.placeRoad(10, y)).toBe(true);
    const people = new PeopleSim(w.map, w.builder, new Rng(1));
    const from = { x: 10, y: 17 };
    const to = { x: 10, y: 27 };
    expect(started(people, from, to)).toBeNull();
    for (let y = 20; y <= 24; y++) expect(w.builder.placeRoad(10, y)).toBe(true);
    const walk = started(people, from, to)!;
    expect(walk).not.toBeNull();
    expect(walk).toEqual(findWalk(w.map, from, to, w.roads, null, w.decks));
    expect(w.builder.removeRoad(10, 22)).toBe(true);
    expect(started(people, from, to)).toBeNull();
  });
});

// Seeded towns: a line with stations either side, crewed works, houses and roads, a river past
// them crossed by bridges, a population and a day running on. A case is played twice from the
// same seed, once as PeopleSim plays it and once with its road decks taken away, which is the walk
// search as it was before #502 (the oracles in roads.test.ts pin that one).

interface TownCase {
  mapSeed: number;
  river: { at: number; width: number; end: number };
  bridges: { x: number; carries: 'rail' | 'road' | 'bare' }[];
  stations: { x: number; side: -1 | 1; kind: string }[];
  works: { x: number; y: number; id: 'windmill' | 'kiln' }[];
  houses: { x: number; y: number; rot: number }[];
  roads: { x: number; y: number; rot: number; n: number }[];
  population: number;
  gdt: number;
  day0: number;
  dayStep: number;
}
const TOWN_LINE = 12;
const TOWN_TICKS = 400;
function genTown(rng: Rng): TownCase {
  const side = (): -1 | 1 => (rng.chance(0.5) ? -1 : 1);
  const width = rng.int(1, 4);
  const at = rng.int(17, 21);
  // a house or works on the north side of the line, or on the river's south bank, where the
  // nearest station is across the water
  const y = () =>
    rng.chance(0.4) ? rng.int(3, TOWN_LINE - 3) : rng.int(at + width, at + width + 3);
  const stations = Array.from({ length: rng.int(1, 3) }, () => ({
    x: rng.int(4, S - 5),
    side: side(),
    kind: rng.pick(['station', 'station', 'farm', 'lumber', 'pump']),
  }));
  return {
    mapSeed: rng.int(0, 0x7fffffff),
    river: { at, width, end: rng.chance(0.5) ? S : rng.int(20, S - 1) },
    // most bridges stand near a station, where the walks to it go
    bridges: Array.from({ length: rng.int(0, 3) }, () => ({
      x: Math.min(S - 3, Math.max(2, rng.pick(stations).x + rng.int(-8, 8))),
      carries: rng.pick(['road', 'road', 'rail', 'bare'] as const),
    })),
    stations,
    works: Array.from({ length: rng.int(0, 3) }, () => ({
      x: rng.int(2, S - 3),
      y: y(),
      id: rng.chance(0.5) ? ('windmill' as const) : ('kiln' as const),
    })),
    houses: Array.from({ length: rng.int(0, 5) }, () => ({
      x: Math.min(S - 3, Math.max(2, rng.pick(stations).x + rng.int(-6, 6))),
      y: y(),
      rot: rng.int(0, 3),
    })),
    roads: Array.from({ length: rng.int(0, 6) }, () => ({
      x: rng.int(0, S - 1),
      y: rng.int(0, S - 1),
      rot: rng.int(0, 1),
      n: rng.int(2, 14),
    })),
    population: rng.int(4, 40),
    gdt: rng.pick([0.5, 1, 2.5]),
    day0: rng.next(),
    dayStep: rng.pick([0, 0.002, 0.01]),
  };
}
/** The town of `c`; with `roadBridges` false, each road bridge is left bare instead. */
function town(c: TownCase, roadBridges: boolean) {
  const { at, width, end } = c.river;
  const w = site((x, y) => y >= at && y < at + width && x < end);
  w.map.seed = c.mapSeed;
  for (let x = 2; x < S - 2; x++) w.track.place(x, TOWN_LINE, 'straight', 1);
  for (const b of c.bridges) {
    const carries = b.carries === 'road' && !roadBridges ? 'bare' : b.carries;
    bridge(w, b.x, at - 1, width + 2, NS, carries);
  }
  for (const s of c.stations) w.builder.placeStation(s.x, TOWN_LINE + s.side, s.kind);
  for (const k of c.works) w.builder.placeBuilding(k.x, k.y, k.id);
  for (const h of c.houses) w.builder.placeDecor(h.x, h.y, 'townhouse', h.rot);
  for (const r of c.roads)
    for (let i = 0; i < r.n; i++)
      w.builder.placeRoad(r.rot === EW ? r.x + i : r.x, r.rot === EW ? r.y : r.y + i);
  return w;
}
/** Where everyone stands after each tick, and every walk the walkers set off on. */
function playTown(people: PeopleSim, c: TownCase) {
  const trace: string[] = [];
  const walks: Tile[][] = [];
  const seen = new Set<Tile[]>();
  for (let t = 0; t < TOWN_TICKS; t++) {
    people.tick(c.gdt, c.population, (c.day0 + t * c.dayStep) % 1);
    for (const p of people.persons)
      if (p.path.length && !seen.has(p.path)) {
        seen.add(p.path);
        walks.push(p.path);
      }
    trace.push(people.persons.map((p) => `${p.state} ${p.x} ${p.y} ${p.path.length}`).join(';'));
  }
  return { trace, walks };
}
/** `people` with its road decks taken away: every findWalk it makes is given none. */
const withoutDecks = (people: PeopleSim) => {
  (people as unknown as { decks: RoadDecks | null }).decks = null;
  return people;
};
function* shrinkTown(c: TownCase): Iterable<TownCase> {
  for (const bridges of shrinkArray(c.bridges)) yield { ...c, bridges };
  for (const roads of shrinkArray(c.roads)) yield { ...c, roads };
  for (const houses of shrinkArray(c.houses)) yield { ...c, houses };
  for (const works of shrinkArray(c.works)) yield { ...c, works };
  for (const stations of shrinkArray(c.stations)) if (stations.length) yield { ...c, stations };
}
const TOWN_SEEDS = SEEDS.slice(0, 40);

describe('walkers in seeded towns by a river (#502)', () => {
  // Slow: 40 towns played twice for 400 ticks, about 0.9 s alone; the limit is twenty times that.
  it('walk as before road bridges where no bridge carries a road', { timeout: 20_000 }, () => {
    let walked = 0;
    forAll(
      genTown,
      (c) => {
        const a = town(c, false);
        const now = playTown(new PeopleSim(a.map, a.builder), c);
        const b = town(c, false);
        const before = playTown(withoutDecks(new PeopleSim(b.map, b.builder)), c);
        walked += now.walks.length;
        expect(now.trace).toEqual(before.trace);
      },
      { seeds: TOWN_SEEDS, shrink: shrinkTown },
    );
    expect(walked).toBeGreaterThan(150);
  });

  // Slow: 40 towns played for 400 ticks, about 0.3 s alone; the limit is over thirty times that.
  it('keep off water, rails and bare decks, and to the deck', { timeout: 10_000 }, () => {
    let crossed = 0;
    forAll(
      genTown,
      (c) => {
        const w = town(c, true);
        for (const walk of playTown(new PeopleSim(w.map, w.builder), c).walks) {
          // a tile repeated (a walker already where it goes) is no step
          const steps = walk.filter((t, i) => !i || t.x !== walk[i - 1].x || t.y !== walk[i - 1].y);
          expect(brokenWalk(w, steps), JSON.stringify(walk)).toBe('');
          if (steps.some((t) => w.map.terrain[t.y * S + t.x] === Terrain.Water)) crossed++;
        }
      },
      { seeds: TOWN_SEEDS, shrink: shrinkTown },
    );
    expect(crossed).toBeGreaterThan(20);
  });
});
