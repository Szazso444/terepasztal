import { Terrain, type GameMap } from '../world/tiles';
import type { StationDef } from '../data/content';
import type { Builder } from './build';
import type { Station } from './stations';
import { decorDef } from './build';
import { buildingDef } from './buildings';
import type { RoadTiles } from './roads';
import { streetDoor, type Door } from './doors';
import { Rng } from '../engine/rng';
import { DIR_DX, DIR_DY } from '../engine/iso';
import type { RoadDecks } from './bridges';
import { roadDecks } from './bridges';

/**
 * What a walker does for a living, which follows from where it lives. The ids are what the art
 * keys its figures by (`people/<profession>_...`).
 */
export const PROFESSIONS = [
  'passenger',
  'lumberjack',
  'stone_mason',
  'farmer',
  'pump_hand',
  'railway_worker',
] as const;
export type Profession = (typeof PROFESSIONS)[number];

/** The profession of those who live at a station of this kind and gather from the ground. */
const GATHERER: Record<string, Profession> = {
  lumber: 'lumberjack',
  quarry: 'stone_mason',
  farm: 'farmer',
  pump: 'pump_hand',
};

/**
 * Who lives at a station: the gatherers by their kind of yard or field, passengers at a station
 * that takes passengers, and railway workers at any other (a depot, a warehouse, a mine).
 */
export function stationProfession(def: Pick<StationDef, 'id' | 'accepts'>): Profession {
  return GATHERER[def.id] ?? (def.accepts.includes('passengers') ? 'passenger' : 'railway_worker');
}

export interface Place {
  x: number;
  y: number;
  key: string;
  /** what the crew here goes out to gather */
  gathers: Terrain | null;
  /** what those who live here do */
  profession: Profession;
  /**
   * its street door (`streetDoor`, src/sim/doors.ts): walkers idle in front of it, and their walks
   * from and to the place start and end outside it (`doorstep`)
   */
  door: Door;
}
export type PersonState =
  'inside' | 'idle' | 'walk' | 'gather' | 'toStation' | 'waiting' | 'return';
export interface Person {
  id: number;
  x: number;
  y: number;
  home: string;
  outfit: number;
  /** from the place the walker lives at; a boarding or alighting figure is a passenger */
  profession: Profession;
  /** on its way home from a gather tile with the haul; only a picture, it changes nothing */
  carrying: boolean;
  state: PersonState;
  /** seconds left in the current state */
  timer: number;
  path: { x: number; y: number }[];
  step: number;
  /** transient walkers (boarding / alighting) vanish at the end of their path */
  transient: boolean;
  /** station a traveller waits at */
  stationId: number | null;
}

/** tiles a second, for every walker whatever its profession or the ground under it */
export const WALK_SPEED = 0.2;
/** a figure boarding or alighting hurries */
export const BOARDING_SPEED_MUL = 1.5;
/** along a road a walker goes this many times its pace (Q36 a), and a walk counts it so */
export const ROAD_SPEED_MUL = 2;
/** furthest a person walks from home on foot */
const ROAM = 6;
/** furthest station a traveller walks to */
export const STATION_REACH = 14;
/** day fraction window when people are outside: after WAKE and before SLEEP */
export const WAKE = 0.27;
export const SLEEP = 0.85;
/** mixed into the map seed so the walkers draw their own stream */
const PEOPLE_SEED = 0x9e091e;

/**
 * How fast a walker goes, in tiles a second. One pace for every profession and every kind of
 * ground, faster for a figure boarding or alighting, and faster still along a road (`onRoad`,
 * `roadStep`): there every walker goes ROAD_SPEED_MUL times the pace, a boarding figure no faster
 * than any other. Off a road the fastest is at most half the top speed of the slowest engine; on
 * one, a walker is still slower than any engine, so a walker never outpaces a train.
 */
export function walkSpeed(p: Pick<Person, 'transient'>, onRoad = false): number {
  return WALK_SPEED * Math.max(p.transient ? BOARDING_SPEED_MUL : 1, onRoad ? ROAD_SPEED_MUL : 1);
}

/**
 * A step from tile `a` to tile `b` goes along a road: both hold one and they share a side, as a
 * road's pieces join (src/sim/roads.ts). A diagonal step, or one on or off a road, goes at the
 * walker's pace off the road.
 */
export function roadStep(
  roads: RoadTiles | null | undefined,
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  return (
    !!roads &&
    Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1 &&
    roads.has(a.x, a.y) &&
    roads.has(b.x, b.y)
  );
}

/** The level crossing on (x, y) is closed to walkers now (`CrossingWatch.closed`, crossings.ts). */
export type CrossingClosed = (x: number, y: number) => boolean;

/**
 * What a walker held at the edge of a closed level crossing reads to walk round it (#447), as
 * `CrossingWatch` in crossings.ts gives it.
 */
export interface CrossingDetour {
  /** the closed crossing on (x, y) is held closed only by trains standing out of fuel or power */
  detour(x: number, y: number): boolean;
  /** a car of a train stands on (x, y) */
  occupied(x: number, y: number): boolean;
}

/**
 * Game seconds between a walker's tries for a way round a crossing only trains out of fuel or power
 * hold closed, while it finds none: a walker's time over one tile off a road (1 / WALK_SPEED at 0.2
 * tiles a second), often enough to see another crossing open or a train move off, and seldom enough
 * that a crowd at the edge costs little.
 */
export const DETOUR_RETRY = 5;
/** Seconds of the wait for the next try within which it is due, against rounding in the sums. */
const RETRY_EPS = 1e-9;

/** Tiles inside a tile's edge a walker has to be to stand on that tile, against rounding. */
const EDGE_EPS = 1e-6;

/** A walker at `p` stands on tile (x, y): inside its edge; one on the edge stands beside it. */
function standsOn(p: { x: number; y: number }, x: number, y: number): boolean {
  return Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) < 0.5 - EDGE_EPS;
}

/**
 * How far a walker at `from` may go straight towards `to` before it sets foot on a closed level
 * crossing (`closed`) it does not stand on yet: to the edge of the first such tile the way enters,
 * or Infinity when it enters none. A crossing the walker stands on does not hold it, and neither
 * does one the way only touches at a corner or an edge.
 */
export function clearAhead(
  from: { x: number; y: number },
  to: { x: number; y: number },
  closed: CrossingClosed,
): number {
  return heldAt(from, to, closed).at;
}

/**
 * `clearAhead`'s distance, and the closed crossings the way sets foot on there: none when it sets
 * foot on none, and more than one only where it enters two at once.
 */
function heldAt(
  from: { x: number; y: number },
  to: { x: number; y: number },
  closed: CrossingClosed,
): { at: number; tiles: { x: number; y: number }[] } {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (!(len > 0)) return { at: Infinity, tiles: [] };
  const ux = (to.x - from.x) / len;
  const uy = (to.y - from.y) / len;
  // the tiles whose inside the way may cross: a tile's centre within half a tile of it
  const x0 = Math.floor(Math.min(from.x, to.x) - 0.5) + 1;
  const x1 = Math.ceil(Math.max(from.x, to.x) + 0.5) - 1;
  const y0 = Math.floor(Math.min(from.y, to.y) - 0.5) + 1;
  const y1 = Math.ceil(Math.max(from.y, to.y) + 0.5) - 1;
  let best = Infinity;
  const entered: { x: number; y: number; enter: number }[] = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!closed(x, y) || standsOn(from, x, y)) continue;
      // the stretch of the way inside the tile, as distances from `from` along it
      const across = slab(from.x, ux, x);
      const down = slab(from.y, uy, y);
      if (!across || !down) continue;
      const enter = Math.max(0, across[0], down[0]);
      const leave = Math.min(len, across[1], down[1]);
      if (leave - enter > EDGE_EPS) {
        best = Math.min(best, enter);
        entered.push({ x, y, enter });
      }
    }
  return {
    at: best,
    tiles: entered.filter((t) => t.enter <= best + EDGE_EPS).map(({ x, y }) => ({ x, y })),
  };
}

/**
 * Where a walker set down at `p` rather than walking there stands instead when `p` is on a level
 * crossing (`isCrossing`): on that crossing's edge, where the way from `p` straight towards
 * `toward` leaves it. Null when `p` is on no crossing, or `toward` is on the same one.
 */
export function offCrossing(
  p: { x: number; y: number },
  toward: { x: number; y: number },
  isCrossing: (x: number, y: number) => boolean,
): { x: number; y: number } | null {
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  if (!standsOn(p, x, y) || standsOn(toward, x, y) || !isCrossing(x, y)) return null;
  const len = Math.hypot(toward.x - p.x, toward.y - p.y);
  const ux = (toward.x - p.x) / len;
  const uy = (toward.y - p.y) / len;
  // `p` is inside the tile on both axes, so the way leaves it where it first leaves either
  const leave = Math.min(len, slab(p.x, ux, x)![1], slab(p.y, uy, y)![1]);
  return { x: p.x + ux * leave, y: p.y + uy * leave };
}

/**
 * Where the line `p + t * u` lies less than half a tile from `c`, on one axis: the range of t, or
 * null when it never does.
 */
function slab(p: number, u: number, c: number): [number, number] | null {
  if (u === 0) return Math.abs(p - c) < 0.5 ? [-Infinity, Infinity] : null;
  const a = (c - 0.5 - p) / u;
  const b = (c + 0.5 - p) / u;
  return a < b ? [a, b] : [b, a];
}

/** What a save keeps of the walkers: their random stream. The persons start over on load. */
export interface PeopleJSON {
  rng: number;
}

/**
 * Ground a walker may step on. A list of its own, which today leaves out the terrains where
 * nothing can be built (`unbuildable` in build.ts); a change to that helper does not reach it.
 * Water is walkable only where `decks` has a road deck on it (#502): a bridge platform that carries
 * a road and no rail. A bare platform, one with rail, and water with none stay off the way; with no
 * `decks`, all water does, as before there were road bridges.
 */
export function walkable(map: GameMap, x: number, y: number, decks?: RoadDecks | null) {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
  const t = map.terrain[y * map.w + x];
  if (t === Terrain.Water) return !!decks && decks.axis(x, y) !== null;
  return t !== Terrain.Rock && t !== Terrain.Mountain;
}

/**
 * A step of (dx, dy) on or off a road deck of `axis` (`RoadDecks.axis`) goes along the deck, one
 * tile straight: east or west on a deck that runs east to west (1), north or south on one that
 * runs north to south (0), never sideways off it nor diagonally. Off any deck (null) every step is.
 */
function alongDeck(axis: 0 | 1 | null, dx: number, dy: number) {
  return axis === null || (axis ? dy === 0 : dx === 0);
}

/**
 * Where a walk out of a door starts and a walk to it ends: the tile outside it (`Door.reach`), or
 * the door's own tile where nobody stands outside it: off the map, on ground nobody walks on
 * (`walkable`), or on a level crossing (`isCrossing`), where nobody is set down.
 */
export function doorstep(
  map: GameMap,
  door: Door,
  isCrossing: (x: number, y: number) => boolean,
): { x: number; y: number } {
  const { reach } = door;
  return walkable(map, reach.x, reach.y) && !isCrossing(reach.x, reach.y) ? reach : door.tile;
}

/** Tiles a walk may stray beyond the box its two ends span (`findWalk`). */
export const WALK_MARGIN = 4;
/**
 * What a step off a road costs a walk: ROAD_SPEED_MUL against the 1 of a step along a road
 * (`roadStep`), as the time it takes, counted as the search has always counted steps off a road:
 * each alike, straight or diagonal.
 */
export const OFF_ROAD_STEP = ROAD_SPEED_MUL;

/** Tiles of a walk search by weight, the one reached first among equals first: a binary heap. */
class WalkQueue {
  private readonly weight: number[] = [];
  private readonly order: number[] = [];
  private readonly tile: number[] = [];
  private reached = 0;
  get size() {
    return this.tile.length;
  }
  private before(i: number, j: number) {
    const a = this.weight[i];
    const b = this.weight[j];
    return a < b || (a === b && this.order[i] < this.order[j]);
  }
  private swap(i: number, j: number) {
    for (const list of [this.weight, this.order, this.tile])
      [list[i], list[j]] = [list[j], list[i]];
  }
  push(weight: number, tile: number) {
    this.weight.push(weight);
    this.order.push(this.reached++);
    this.tile.push(tile);
    for (let i = this.size - 1; i > 0;) {
      const up = (i - 1) >> 1;
      if (!this.before(i, up)) break;
      this.swap(i, up);
      i = up;
    }
  }
  /** The lightest tile and its weight; the queue must not be empty. */
  pop(): [weight: number, tile: number] {
    const top: [number, number] = [this.weight[0], this.tile[0]];
    this.swap(0, this.size - 1);
    this.weight.pop();
    this.order.pop();
    this.tile.pop();
    for (let i = 0; ;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < this.size && this.before(l, m)) m = l;
      if (r < this.size && this.before(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
}

/** The tiles a walk search may step on: x0 to x1 and y0 to y1, both ends in. */
interface WalkBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The cheapest walk between two tiles over walkable ground, in 8 directions, inside the box the two
 * ends span and WALK_MARGIN tiles round it; null when there is none. A step along a road costs 1
 * and any other OFF_ROAD_STEP, so a walk takes a road wherever that costs less, and of two walks
 * that cost the same the one with fewer steps off the road: a walker keeps to a road round a
 * corner rather than cut it. A diagonal step off a road costs what a straight one does, as it
 * always has, so a walk may still leave a road for a diagonal across the grass that costs less.
 * Tiles are searched lightest first, and of equal ones the one reached first, and the first way
 * found to a tile is kept unless a lighter one comes: with no road it is the breadth-first walk it
 * has always been, step for step. A walk never steps on a tile `avoid` names, `to` among them; it
 * may set out from one.
 *
 * A walk crosses a road bridge where `decks` gives one (#502): it steps on a road deck over water
 * (`walkable`), and onto, along and off any road deck, over land too, only one tile straight along
 * the deck's axis (`alongDeck`). Where no walk is found in the box and a road deck lies in it, the
 * search is made once more in a box wider along each axis a deck there runs on, on both sides, by
 * the longest such span (`RoadDecks.length`) and WALK_MARGIN, so a walk that takes a bridge
 * reaching out of the box finds the far bank. With no road deck in the box, a walk is what it was
 * before there were road bridges, step for step.
 */
export function findWalk(
  map: GameMap,
  from: { x: number; y: number },
  to: { x: number; y: number },
  roads?: RoadTiles | null,
  avoid?: ((x: number, y: number) => boolean) | null,
  decks?: RoadDecks | null,
): { x: number; y: number }[] | null {
  const box = {
    x0: Math.max(0, Math.min(from.x, to.x) - WALK_MARGIN),
    y0: Math.max(0, Math.min(from.y, to.y) - WALK_MARGIN),
    x1: Math.min(map.w - 1, Math.max(from.x, to.x) + WALK_MARGIN),
    y1: Math.min(map.h - 1, Math.max(from.y, to.y) + WALK_MARGIN),
  };
  const walk = searchWalk(map, from, to, box, roads, avoid, decks);
  if (walk || !decks) return walk;
  const wide = widened(map, box, decks);
  return wide ? searchWalk(map, from, to, wide, roads, avoid, decks) : null;
}

/**
 * The box a walk search that found nothing in `box` tries once more (`findWalk`): wider by the
 * longest span of a road deck in it and WALK_MARGIN, on both sides, east and west for a deck that
 * runs east to west, north and south for one that runs north to south, inside the map. Null where
 * no road deck lies in `box`, or the map leaves no room to widen it.
 */
function widened(map: GameMap, box: WalkBox, decks: RoadDecks): WalkBox | null {
  // the longest span on each axis: [north to south, east to west]
  const longest = [0, 0];
  for (let y = box.y0; y <= box.y1; y++)
    for (let x = box.x0; x <= box.x1; x++) {
      const axis = decks.axis(x, y);
      if (axis !== null) longest[axis] = Math.max(longest[axis], decks.length(x, y));
    }
  const ox = longest[1] && longest[1] + WALK_MARGIN;
  const oy = longest[0] && longest[0] + WALK_MARGIN;
  const wide = {
    x0: Math.max(0, box.x0 - ox),
    y0: Math.max(0, box.y0 - oy),
    x1: Math.min(map.w - 1, box.x1 + ox),
    y1: Math.min(map.h - 1, box.y1 + oy),
  };
  const same = wide.x0 === box.x0 && wide.y0 === box.y0 && wide.x1 === box.x1 && wide.y1 === box.y1;
  return same ? null : wide;
}

/** `findWalk`'s search inside `box`. */
function searchWalk(
  map: GameMap,
  from: { x: number; y: number },
  to: { x: number; y: number },
  { x0, y0, x1, y1 }: WalkBox,
  roads: RoadTiles | null | undefined,
  avoid: ((x: number, y: number) => boolean) | null | undefined,
  decks: RoadDecks | null | undefined,
): { x: number; y: number }[] | null {
  const W = x1 - x0 + 1;
  const H = y1 - y0 + 1;
  // A walk's weight is its cost in units of more than any walk in the box has steps, plus its
  // steps off the road: the cost decides, and the steps off the road only between equal costs.
  const unit = W * H + 1;
  const alongRoad = unit;
  const offRoad = OFF_ROAD_STEP * unit + 1;
  const prev = new Int32Array(W * H).fill(-2);
  const weight = new Float64Array(W * H).fill(Infinity);
  const key = (x: number, y: number) => (y - y0) * W + (x - x0);
  const sk = key(from.x, from.y);
  const tk = key(to.x, to.y);
  prev[sk] = -1;
  weight[sk] = 0;
  const queue = new WalkQueue();
  queue.push(0, sk);
  while (queue.size) {
    const [w, k] = queue.pop();
    // reached again more lightly since: that entry is the one that counts
    if (w !== weight[k]) continue;
    if (k === tk) break;
    const cx = (k % W) + x0;
    const cy = Math.floor(k / W) + y0;
    // the deck the walker stands on, which it leaves only along its axis
    const here = decks ? decks.axis(cx, cy) : null;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        if (!alongDeck(here, dx, dy)) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
        const nk = key(nx, ny);
        const next =
          w + (roadStep(roads, { x: cx, y: cy }, { x: nx, y: ny }) ? alongRoad : offRoad);
        if (next >= weight[nk]) continue;
        if (!walkable(map, nx, ny, decks) && !(nx === to.x && ny === to.y)) continue;
        if (decks && !alongDeck(decks.axis(nx, ny), dx, dy)) continue;
        if (avoid?.(nx, ny)) continue;
        prev[nk] = k;
        weight[nk] = next;
        queue.push(next, nk);
      }
  }
  if (prev[tk] === -2) return null;
  const out: { x: number; y: number }[] = [];
  for (let k = tk; k >= 0; k = prev[k]) out.push({ x: (k % W) + x0, y: Math.floor(k / W) + y0 });
  return out.reverse();
}

/**
 * The place nearest to (x, y) by |dx| + |dy|, as a traveller's station reach is measured, ties
 * going to the one listed first; null when there is none. It has no reach limit, so while any
 * place is open a walker whose home closed always gets one.
 */
function nearestPlace(places: readonly Place[], x: number, y: number): Place | null {
  let best: Place | null = null;
  let bestD = Infinity;
  for (const pl of places) {
    const d = Math.abs(pl.x - x) + Math.abs(pl.y - y);
    if (d < bestD) {
      best = pl;
      bestD = d;
    }
  }
  return best;
}

/** The key of the place a station is (`Place.key`). */
const stationKey = (id: number) => `s${id}`;

/**
 * The population as a few quiet walkers: everyone belongs to a station, works or service and
 * spends most of the day inside; now and then someone steps out to idle by the door, walks to a
 * nearby resource tile to gather, or goes to the closest station to catch a train with a coach.
 * The door is the place's street door (src/sim/doors.ts), turned with the place: walkers idle in
 * front of it, and a walk out of a place or back to it, a station's too, starts or ends on the
 * tile outside it (`doorstep`). Between two places whose doors face one tile that walk has no
 * length: the walker is there at once and arrives on its next step (`startWalk`). Each has the
 * profession of the place it lives at. Nobody sets out at night, and one caught on the way to a
 * station turns home. A walker waits in front of a level crossing while it is closed
 * (src/sim/crossings.ts), or walks round it when only trains out of fuel or power hold it closed
 * (`walkRound`), and none is set down on one (`offCrossing`). Nothing here changes the map.
 */
export class PeopleSim {
  persons: Person[] = [];
  private nextId = 1;
  private readonly rng: Rng;
  private gatherTerrain: Record<string, Terrain | null> = {
    farm: Terrain.Grass,
    lumber: Terrain.Forest,
    quarry: Terrain.Hill,
    pump: Terrain.Water,
  };
  /** Without `rng` the walkers draw from a stream seeded by the map. */
  /** The road bridges a walk may cross (`findWalk`), as the builder has them at each step. */
  private readonly decks: RoadDecks;
  constructor(
    readonly map: GameMap,
    private readonly builder: Builder,
    rng?: Rng,
  ) {
    this.rng = rng ?? new Rng(map.seed ^ PEOPLE_SEED);
    this.decks = roadDecks(builder);
  }
  private rnd() {
    return this.rng.next();
  }
  /** The tile is a level crossing (`Roads.isCrossing`). */
  private readonly isCrossing = (x: number, y: number) => this.builder.roads.isCrossing(x, y);
  /** Where a walk out of the door starts and a walk to it ends (`doorstep`). */
  private doorstepOf(door: Door) {
    return doorstep(this.map, door, this.isCrossing);
  }
  /**
   * Each walker that found no way round a crossing it waits at (`walkRound`): the walk it waits on,
   * and the game seconds to its next try. Kept while it waits there on that walk; not saved, as the
   * walkers are not.
   */
  private readonly retry = new WeakMap<Person, { path: Person['path']; left: number }>();
  /**
   * Each walker that stopped on a tile's edge after walking: the tile it walked off onto that edge,
   * the one its way crossed just before it (`standingAt`). Not saved, as the walkers are not.
   */
  private readonly stood = new WeakMap<Person, { x: number; y: number }>();

  toJSON(): PeopleJSON {
    return { rng: this.rng.state };
  }
  /** Resume a saved stream; anything without one keeps the stream seeded from the map. */
  load(j: unknown) {
    const rng = (j as Partial<PeopleJSON> | null | undefined)?.rng;
    if (typeof rng === 'number') this.rng.state = rng;
  }

  /**
   * Where walkers live, go back to and set out from to gather. A station or works closed for its
   * upgrade has no crew and is none, so nobody lives or gathers there: on the next tick its
   * walkers move to the open place nearest to where they stand (`nearestPlace`). A house being
   * upgraded keeps its residents and stays one.
   */
  places(): Place[] {
    const out: Place[] = [];
    for (const s of this.builder.stations)
      if (!s.closed)
        out.push({
          x: s.x,
          y: s.y,
          key: stationKey(s.id),
          gathers: this.gatherTerrain[s.def.id] ?? null,
          profession: stationProfession(s.def),
          door: streetDoor(s.def, s.x, s.y, s.rot),
        });
    for (const b of this.builder.buildings.values())
      if (!b.work && buildingDef(b.id).crew > 0)
        out.push({
          x: b.x,
          y: b.y,
          key: `b${b.x},${b.y}`,
          gathers: null,
          profession: 'railway_worker',
          door: streetDoor(buildingDef(b.id), b.x, b.y, b.rot ?? 0),
        });
    for (const d of this.builder.decor.values())
      if (decorDef(d.id).crew > 0 || decorDef(d.id).residents)
        out.push({
          x: d.x,
          y: d.y,
          key: `d${d.x},${d.y}`,
          gathers: null,
          // a house is lived in; any other service stop is a railway worker's post
          profession: decorDef(d.id).residents ? 'passenger' : 'railway_worker',
          door: streetDoor(decorDef(d.id), d.x, d.y, d.rot),
        });
    return out;
  }

  /** People outside right now. */
  get outside() {
    return this.persons.filter((p) => p.state !== 'inside').length;
  }
  /** Travellers waiting on a station's tile. */
  waitingAt(stationId: number) {
    return this.persons.filter((p) => p.state === 'waiting' && p.stationId === stationId);
  }

  /** A train with a coach loaded `n` passengers here: waiting travellers board (vanish). */
  board(st: Station, n: number) {
    const waiting = this.waitingAt(st.id);
    const take = Math.min(waiting.length, Math.max(1, Math.round(n)));
    for (let k = 0; k < take; k++) {
      const i = this.persons.indexOf(waiting[k]);
      if (i >= 0) this.persons.splice(i, 1);
    }
    // the rest of the load is abstract cargo; show a couple of extra figures stepping aboard
    const plat = this.builder.platformTiles(st)[0];
    if (plat)
      for (let k = take; k < Math.min(3, Math.round(n)); k++) this.spawnTransient(st, plat, true);
  }
  /** Passengers alighted: a few figures walk from the platform to a nearby building and settle. */
  alight(st: Station, n: number) {
    const plat = this.builder.platformTiles(st)[0];
    if (!plat) return;
    const count = Math.min(3, Math.max(1, Math.round(n)));
    for (let k = 0; k < count; k++) this.spawnTransient(st, plat, false);
  }
  /**
   * A figure stepping off a train onto the platform, or out of the station to board one. One set
   * down on a level crossing (a platform a road crosses) stands on its edge, on its way off it.
   */
  private spawnTransient(st: Station, plat: { x: number; y: number }, boarding: boolean) {
    const from = boarding ? st : plat;
    const to = boarding ? plat : st;
    const path = findWalk(this.map, from, to, this.builder.roads, null, this.decks) ?? [from, to];
    const at = {
      x: from.x + (this.rnd() - 0.5) * 0.4,
      y: from.y + (this.rnd() - 0.5) * 0.4,
    };
    const off = offCrossing(at, path[1] ?? to, this.isCrossing);
    this.persons.push({
      id: this.nextId++,
      x: off?.x ?? at.x,
      y: off?.y ?? at.y,
      home: '',
      outfit: Math.floor(this.rnd() * 4),
      profession: 'passenger',
      carrying: false,
      state: 'walk',
      timer: 0,
      path,
      step: 0,
      transient: true,
      stationId: null,
    });
  }

  private nearestTile(from: Place, t: Terrain): { x: number; y: number } | null {
    let best: { x: number; y: number; d: number } | null = null;
    for (let dy = -ROAM; dy <= ROAM; dy++)
      for (let dx = -ROAM; dx <= ROAM; dx++) {
        const x = from.x + dx;
        const y = from.y + dy;
        if (x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) continue;
        const tt = this.map.terrain[y * this.map.w + x];
        if (tt !== t && !(t === Terrain.Hill && tt === Terrain.Rock)) continue;
        const d = Math.abs(dx) + Math.abs(dy) + this.rnd() * 2;
        if (!best || d < best.d) best = { x, y, d };
      }
    if (!best) return null;
    // stand next to water / rock rather than on it
    if (!walkable(this.map, best.x, best.y)) {
      for (const [ox, oy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        if (walkable(this.map, best.x + ox, best.y + oy)) return { x: best.x + ox, y: best.y + oy };
      }
      return null;
    }
    return best;
  }

  /**
   * Set the walker off on the walk `findWalk` gives from `from` to `to`, at its start, in `state`;
   * false when there is none. A walk from a tile to itself is none, but where `there` says the
   * walker is already where it goes: from one place to another whose door faces the same tile as
   * its own, so the two doorsteps are one. That walk is the tile alone, and the walker arrives at
   * its end on its next step, as at the end of any walk.
   */
  private startWalk(
    p: Person,
    from: { x: number; y: number },
    to: { x: number; y: number },
    state: PersonState,
    there = false,
  ) {
    const path = findWalk(this.map, from, to, this.builder.roads, null, this.decks);
    if (!path || path.length < (there ? 1 : 2)) return false;
    p.path = path;
    p.step = 0;
    p.x = from.x;
    p.y = from.y;
    p.state = state;
    return true;
  }

  /**
   * One step of `gdt` game seconds for `population` walkers at `dayFraction` of the day. A walker
   * stops at the edge of a level crossing `crossingClosed` holds closed and goes on when it opens
   * (`advance`); with none given, every crossing is open. At one that `detour` says only trains out
   * of fuel or power hold closed, it walks round instead (`walkRound`); with none given, it waits
   * at every closed crossing.
   */
  tick(
    gdt: number,
    population: number,
    dayFraction: number,
    crossingClosed: CrossingClosed | null = null,
    detour: CrossingDetour | null = null,
  ) {
    population = Math.min(160, Math.max(0, Math.floor(population)));
    const places = this.places();
    const byKey = new Map(places.map((p) => [p.key, p]));
    const regular = this.persons.filter((p) => !p.transient);
    while (regular.length < population && places.length) {
      const home = places[Math.floor(this.rnd() * places.length)];
      const p: Person = {
        id: this.nextId++,
        x: home.x,
        y: home.y,
        home: home.key,
        outfit: Math.floor(this.rnd() * 4),
        profession: home.profession,
        carrying: false,
        state: 'inside',
        timer: 5 + this.rnd() * 40,
        path: [],
        step: 0,
        transient: false,
        stationId: null,
      };
      regular.push(p);
      this.persons.push(p);
    }
    while (regular.length > population) {
      const p = regular.pop()!;
      const i = this.persons.indexOf(p);
      if (i >= 0) this.persons.splice(i, 1);
    }
    const daytime = dayFraction > WAKE && dayFraction < SLEEP;
    for (let i = this.persons.length - 1; i >= 0; i--) {
      const p = this.persons[i];
      if (p.transient) {
        if (!this.advance(p, gdt, crossingClosed, detour)) this.persons.splice(i, 1);
        continue;
      }
      // a home that closed or went: the nearest open place to where the walker stands, no draw
      const known = byKey.get(p.home);
      const home = known ?? nearestPlace(places, p.x, p.y);
      if (!home) continue;
      p.home = home.key;
      p.profession = home.profession;
      // the way home led to a place that is gone or closed: walk to the new home from here
      if (!known && p.state === 'return') {
        const back = findWalk(
          this.map,
          { x: Math.round(p.x), y: Math.round(p.y) },
          this.doorstepOf(home.door),
          this.builder.roads,
          null,
          this.decks,
        );
        if (back && back.length >= 2) {
          p.path = back;
          p.step = 0;
        }
      }
      switch (p.state) {
        case 'inside': {
          p.timer -= gdt;
          if (p.timer > 0 || !daytime) break;
          // step outside: mostly idling, sometimes gathering, rarely a train trip
          const r = this.rnd();
          if (r < 0.65) {
            // in front of its street door, at most a fifth of a tile out from the door's tile, but
            // never on a level crossing there: then short of that tile's edge, the same draw spread
            // over that. The first draw places it along the door's side, the second out from it:
            // for a door facing S, x then y, as before there were doors.
            const { tile, side, reach } = home.door;
            const out = this.isCrossing(reach.x, reach.y) ? 0.2 : 0.4;
            const nx = DIR_DX[side];
            const ny = DIR_DY[side];
            const along = (this.rnd() - 0.5) * 0.8;
            const away = this.rnd() * out;
            p.x = tile.x + nx * 0.3 + nx * away + ny * along;
            p.y = tile.y + ny * 0.3 + ny * away - nx * along;
            p.state = 'idle';
            p.timer = 6 + this.rnd() * 14;
          } else if (r < 0.92 && home.gathers !== null) {
            const spot = this.nearestTile(home, home.gathers);
            // a gather tile under its own home is none: it stays in, as it always has. One on its
            // doorstep is a walk of no length: it gathers there
            const under = spot && spot.x === home.x && spot.y === home.y;
            if (
              !spot ||
              under ||
              !this.startWalk(p, this.doorstepOf(home.door), spot, 'gather', true)
            )
              p.timer = 10;
          } else {
            const st = this.builder.stations
              .filter(
                (s) =>
                  s.accepts('passengers') &&
                  Math.abs(s.x - home.x) + Math.abs(s.y - home.y) <= STATION_REACH,
              )
              .sort(
                (a, b) =>
                  Math.abs(a.x - home.x) +
                  Math.abs(a.y - home.y) -
                  (Math.abs(b.x - home.x) + Math.abs(b.y - home.y)),
              )[0];
            // a station whose street door faces the tile its own door faces is there at once; its
            // own station is none, as it always was
            if (
              st &&
              this.startWalk(
                p,
                this.doorstepOf(home.door),
                this.doorstepOf(streetDoor(st.def, st.x, st.y, st.rot)),
                'toStation',
                home.key !== stationKey(st.id),
              )
            )
              p.stationId = st.id;
            else p.timer = 10;
          }
          break;
        }
        case 'idle': {
          // a level crossing laid where it idles, or the tile it gathered on with no way home:
          // it stands at the crossing's edge, on the side of its home's door
          const off = offCrossing(p, home.door.tile, this.isCrossing);
          if (off) {
            p.x = off.x;
            p.y = off.y;
          }
          p.timer -= gdt;
          if (p.timer <= 0 || !daytime) {
            p.state = 'inside';
            p.timer = 20 + this.rnd() * 60;
          }
          break;
        }
        case 'gather':
        case 'toStation':
        case 'return':
          // night fell on the way to a station: turn for home from where it stands
          if (p.state === 'toStation' && !daytime && this.turnHome(p, home)) break;
          if (!this.advance(p, gdt, crossingClosed, detour)) {
            if (p.state === 'gather') {
              p.state = 'idle';
              p.timer = 8 + this.rnd() * 10;
              // walk back afterwards, carrying what it gathered: from its doorstep, a walk of no
              // length
              if (this.turnHome(p, home, true)) p.carrying = true;
            } else if (p.state === 'toStation') {
              p.state = 'waiting';
              p.timer = 60 + this.rnd() * 90;
            } else {
              p.state = 'inside';
              p.carrying = false;
              p.timer = 20 + this.rnd() * 60;
            }
          }
          break;
        case 'waiting':
          p.timer -= gdt;
          if (p.timer <= 0 || !daytime) {
            // no train came: walk home, out of the station's street door and in by its own, at once
            // where the two face one tile, but for one whose home is now the station
            const st = this.builder.stationById(p.stationId ?? -1);
            if (
              st &&
              this.startWalk(
                p,
                this.doorstepOf(streetDoor(st.def, st.x, st.y, st.rot)),
                this.doorstepOf(home.door),
                'return',
                home.key !== stationKey(st.id),
              )
            )
              break;
            p.state = 'inside';
            p.timer = 30;
          }
          break;
        case 'walk':
          if (!this.advance(p, gdt, crossingClosed, detour)) {
            p.state = 'inside';
            p.timer = 20 + this.rnd() * 40;
          }
          break;
      }
    }
  }

  /**
   * Turn for home's door from the tile the walker stands on; false when there is no way, and when
   * it stands on its doorstep but where `there` takes that for a walk of no length (`startWalk`).
   */
  private turnHome(p: Person, home: Place, there = false) {
    const back = findWalk(
      this.map,
      { x: Math.round(p.x), y: Math.round(p.y) },
      this.doorstepOf(home.door),
      this.builder.roads,
      null,
      this.decks,
    );
    if (!back || back.length < (there ? 1 : 2)) return false;
    p.path = back;
    p.step = 0;
    p.state = 'return';
    p.timer = 0;
    return true;
  }

  /**
   * Move along the path; returns false once the end is reached. A step is the walker's state, the
   * time, the roads under the leg it walks (`roadStep`), the level crossings closed now
   * (`clearAhead`) and the tile it walked off onto an edge it stands on (`standingAt`), nothing
   * else, and draws no random number. A walker goes no further than the edge of a closed crossing
   * it is not on yet and waits there, its path, state and timer as they were, until the crossing
   * opens; one already on a crossing goes on, and one on the edge of the tile it stands at may go
   * back into it while only trains out of fuel or power hold it closed (`closedTo`). At the edge of
   * one that `detour` says only such trains hold closed, it walks round (`walkRound`).
   */
  private advance(
    p: Person,
    gdt: number,
    crossingClosed: CrossingClosed | null,
    detour: CrossingDetour | null,
  ) {
    const next = p.path[p.step + 1];
    if (!next) return false;
    const speed = walkSpeed(p, roadStep(this.builder.roads, p.path[p.step], next));
    const dx = next.x - p.x;
    const dy = next.y - p.y;
    const d = Math.hypot(dx, dy);
    let stepLen = speed * gdt;
    // the closed crossings it stops at the edge of in this step, if any
    let held: { x: number; y: number }[] = [];
    if (crossingClosed) {
      const ahead = heldAt(p, next, this.closedTo(p, crossingClosed, detour));
      if (ahead.at <= stepLen) {
        stepLen = ahead.at;
        held = ahead.tiles;
      }
    }
    if (d <= stepLen) {
      p.x = next.x;
      p.y = next.y;
      p.step++;
    } else {
      p.x += (dx / d) * stepLen;
      p.y += (dy / d) * stepLen;
      // stopped on a tile's edge: it stands at the tile its way crossed just before it
      if (stepLen > EDGE_EPS && !standsOn(p, Math.round(p.x), Math.round(p.y)))
        this.stood.set(p, {
          x: Math.round(p.x - (dx / d) * EDGE_EPS),
          y: Math.round(p.y - (dy / d) * EDGE_EPS),
        });
    }
    if (crossingClosed && detour && held.length && held.every((t) => detour.detour(t.x, t.y)))
      this.walkRound(p, gdt, crossingClosed, detour);
    else this.retry.delete(p);
    return true;
  }

  /**
   * The tile a walker on a tile's edge stands at: the one it walked off onto that edge, while it is
   * on that tile or its edge still. Null where it never walked off a tile onto an edge, as for one
   * set down on an edge that has not walked since, and where it stands off that tile.
   */
  private standingAt(p: Person): { x: number; y: number } | null {
    const t = this.stood.get(p);
    return t && Math.max(Math.abs(p.x - t.x), Math.abs(p.y - t.y)) <= 0.5 + EDGE_EPS ? t : null;
  }

  /**
   * The crossings that hold a walker at `p`: those `crossingClosed` closes, but for the tile it
   * stands at (`standingAt`) while only trains standing out of fuel or power close it (`detour`),
   * as it never left that tile (#447). Of its legs, only one back into that tile enters it.
   */
  private closedTo(
    p: Person,
    crossingClosed: CrossingClosed,
    detour: CrossingDetour | null,
  ): CrossingClosed {
    const own = detour && this.standingAt(p);
    if (!own || !detour.detour(own.x, own.y)) return crossingClosed;
    return (x, y) => !(x === own.x && y === own.y) && crossingClosed(x, y);
  }

  /**
   * A walker at the edge of a closed crossing that only trains standing out of fuel or power hold
   * closed (#447) looks for a way round it at once: the walk `findWalk` gives from the tile it
   * stands at to the end of its walk, on no crossing closed now and no tile a car stands on, and
   * taken in place of the walk it had. It goes from where it stands straight on to that walk's
   * next tile, or back to the middle of the tile it stands at first where the way straight on would
   * cut a corner of one of those. It never left the tile it walked off onto the edge, so it steps
   * back into that tile even where a car stands on it or it is a crossing closed since, unless a
   * train that may still move closes it: then, as with none, it waits at the edge as it was and
   * tries again every DETOUR_RETRY game seconds. A try is the walker's place and walk, the map, the
   * roads and the crossings, and changes the walk alone: no random number, state or timer.
   */
  private walkRound(
    p: Person,
    gdt: number,
    crossingClosed: CrossingClosed,
    detour: CrossingDetour,
  ) {
    const wait = this.retry.get(p);
    if (wait?.path === p.path) {
      wait.left -= gdt;
      if (wait.left > RETRY_EPS) return;
    }
    if (this.findRound(p, crossingClosed, detour)) this.retry.delete(p);
    else this.retry.set(p, { path: p.path, left: DETOUR_RETRY });
  }

  /** Give the walker its way round (`walkRound`); false when there is none. */
  private findRound(p: Person, crossingClosed: CrossingClosed, detour: CrossingDetour) {
    const next = p.path[p.step + 1];
    const end = p.path[p.path.length - 1];
    const avoid = (x: number, y: number) => crossingClosed(x, y) || detour.occupied(x, y);
    // the tile it stands at: the one it walked off onto the crossing's edge, or, for one set down
    // there that has not walked since, the one its way crosses just before the edge
    const own = this.standingAt(p);
    const len = Math.hypot(next.x - p.x, next.y - p.y);
    const back = own ?? {
      x: Math.round(p.x - ((next.x - p.x) / len) * EDGE_EPS),
      y: Math.round(p.y - ((next.y - p.y) / len) * EDGE_EPS),
    };
    const walk = findWalk(this.map, back, end, this.builder.roads, avoid, this.decks);
    if (!walk) return false;
    const path =
      walk.length > 1 && clearAhead(p, walk[1], avoid) === Infinity ? walk : [back, ...walk];
    // back into the tile it walked off onto the edge, whatever else keeps it off, but for a crossing
    // a train that may still move closes
    const reenter = !!own && (!crossingClosed(own.x, own.y) || detour.detour(own.x, own.y));
    const first = reenter
      ? (x: number, y: number) => !(x === back.x && y === back.y) && avoid(x, y)
      : avoid;
    if (clearAhead(p, path[1], first) !== Infinity) return false;
    p.path = path;
    p.step = 0;
    return true;
  }
}
