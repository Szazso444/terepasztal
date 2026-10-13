import { Terrain, type GameMap } from '../world/tiles';
import type { StationDef } from '../data/content';
import type { Builder } from './build';
import type { Station } from './stations';
import { decorDef } from './build';
import { buildingDef } from './buildings';
import type { RoadTiles } from './roads';
import { Rng } from '../engine/rng';

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
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (!(len > 0)) return Infinity;
  const ux = (to.x - from.x) / len;
  const uy = (to.y - from.y) / len;
  // the tiles whose inside the way may cross: a tile's centre within half a tile of it
  const x0 = Math.floor(Math.min(from.x, to.x) - 0.5) + 1;
  const x1 = Math.ceil(Math.max(from.x, to.x) + 0.5) - 1;
  const y0 = Math.floor(Math.min(from.y, to.y) - 0.5) + 1;
  const y1 = Math.ceil(Math.max(from.y, to.y) + 0.5) - 1;
  let best = Infinity;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!closed(x, y) || standsOn(from, x, y)) continue;
      // the stretch of the way inside the tile, as distances from `from` along it
      const across = slab(from.x, ux, x);
      const down = slab(from.y, uy, y);
      if (!across || !down) continue;
      const enter = Math.max(0, across[0], down[0]);
      const leave = Math.min(len, across[1], down[1]);
      if (leave - enter > EDGE_EPS) best = Math.min(best, enter);
    }
  return best;
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
 */
export function walkable(map: GameMap, x: number, y: number) {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
  const t = map.terrain[y * map.w + x];
  return t !== Terrain.Water && t !== Terrain.Rock && t !== Terrain.Mountain;
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

/**
 * The cheapest walk between two tiles over walkable ground, in 8 directions, inside the box the two
 * ends span and WALK_MARGIN tiles round it; null when there is none. A step along a road costs 1
 * and any other OFF_ROAD_STEP, so a walk takes a road wherever that costs less, and of two walks
 * that cost the same the one with fewer steps off the road: a walker keeps to a road round a
 * corner rather than cut it. A diagonal step off a road costs what a straight one does, as it
 * always has, so a walk may still leave a road for a diagonal across the grass that costs less.
 * Tiles are searched lightest first, and of equal ones the one reached first, and the first way
 * found to a tile is kept unless a lighter one comes: with no road it is the breadth-first walk it
 * has always been, step for step.
 */
export function findWalk(
  map: GameMap,
  from: { x: number; y: number },
  to: { x: number; y: number },
  roads?: RoadTiles | null,
): { x: number; y: number }[] | null {
  const margin = WALK_MARGIN;
  const x0 = Math.max(0, Math.min(from.x, to.x) - margin);
  const y0 = Math.max(0, Math.min(from.y, to.y) - margin);
  const x1 = Math.min(map.w - 1, Math.max(from.x, to.x) + margin);
  const y1 = Math.min(map.h - 1, Math.max(from.y, to.y) + margin);
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
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
        const nk = key(nx, ny);
        const next =
          w + (roadStep(roads, { x: cx, y: cy }, { x: nx, y: ny }) ? alongRoad : offRoad);
        if (next >= weight[nk]) continue;
        if (!walkable(map, nx, ny) && !(nx === to.x && ny === to.y)) continue;
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

/**
 * The population as a few quiet walkers: everyone belongs to a station, works or service and
 * spends most of the day inside; now and then someone steps out to idle by the door, walks to a
 * nearby resource tile to gather, or goes to the closest station to catch a train with a coach.
 * Each has the profession of the place it lives at. Nobody sets out at night, and one caught on
 * the way to a station turns home. A walker waits in front of a level crossing while it is closed
 * (src/sim/crossings.ts). Nothing here changes the map.
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
  constructor(
    readonly map: GameMap,
    private readonly builder: Builder,
    rng?: Rng,
  ) {
    this.rng = rng ?? new Rng(map.seed ^ PEOPLE_SEED);
  }
  private rnd() {
    return this.rng.next();
  }

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
          key: `s${s.id}`,
          gathers: this.gatherTerrain[s.def.id] ?? null,
          profession: stationProfession(s.def),
        });
    for (const b of this.builder.buildings.values())
      if (!b.work && buildingDef(b.id).crew > 0)
        out.push({
          x: b.x,
          y: b.y,
          key: `b${b.x},${b.y}`,
          gathers: null,
          profession: 'railway_worker',
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
  private spawnTransient(st: Station, plat: { x: number; y: number }, boarding: boolean) {
    const from = boarding ? st : plat;
    const to = boarding ? plat : st;
    const path = findWalk(this.map, from, to, this.builder.roads) ?? [from, to];
    this.persons.push({
      id: this.nextId++,
      x: from.x + (this.rnd() - 0.5) * 0.4,
      y: from.y + (this.rnd() - 0.5) * 0.4,
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

  private startWalk(
    p: Person,
    from: { x: number; y: number },
    to: { x: number; y: number },
    state: PersonState,
  ) {
    const path = findWalk(this.map, from, to, this.builder.roads);
    if (!path || path.length < 2) return false;
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
   * (`advance`); with none given, every crossing is open.
   */
  tick(
    gdt: number,
    population: number,
    dayFraction: number,
    crossingClosed: CrossingClosed | null = null,
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
        if (!this.advance(p, gdt, crossingClosed)) this.persons.splice(i, 1);
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
          home,
          this.builder.roads,
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
            p.x = home.x + (this.rnd() - 0.5) * 0.8;
            p.y = home.y + 0.3 + this.rnd() * 0.4;
            p.state = 'idle';
            p.timer = 6 + this.rnd() * 14;
          } else if (r < 0.92 && home.gathers !== null) {
            const spot = this.nearestTile(home, home.gathers);
            if (!spot || !this.startWalk(p, home, spot, 'gather')) p.timer = 10;
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
            if (st && this.startWalk(p, home, st, 'toStation')) p.stationId = st.id;
            else p.timer = 10;
          }
          break;
        }
        case 'idle':
          p.timer -= gdt;
          if (p.timer <= 0 || !daytime) {
            p.state = 'inside';
            p.timer = 20 + this.rnd() * 60;
          }
          break;
        case 'gather':
        case 'toStation':
        case 'return':
          // night fell on the way to a station: turn for home from where it stands
          if (p.state === 'toStation' && !daytime && this.turnHome(p, home)) break;
          if (!this.advance(p, gdt, crossingClosed)) {
            if (p.state === 'gather') {
              p.state = 'idle';
              p.timer = 8 + this.rnd() * 10;
              // walk back afterwards, carrying what it gathered
              if (this.turnHome(p, home)) p.carrying = true;
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
            // no train came: walk home
            const st = this.builder.stationById(p.stationId ?? -1);
            if (st && this.startWalk(p, st, home, 'return')) break;
            p.state = 'inside';
            p.timer = 30;
          }
          break;
        case 'walk':
          if (!this.advance(p, gdt, crossingClosed)) {
            p.state = 'inside';
            p.timer = 20 + this.rnd() * 40;
          }
          break;
      }
    }
  }

  /** Turn for home from the tile the walker stands on; false when there is no way. */
  private turnHome(p: Person, home: Place) {
    const back = findWalk(
      this.map,
      { x: Math.round(p.x), y: Math.round(p.y) },
      home,
      this.builder.roads,
    );
    if (!back || back.length < 2) return false;
    p.path = back;
    p.step = 0;
    p.state = 'return';
    p.timer = 0;
    return true;
  }

  /**
   * Move along the path; returns false once the end is reached. A step is the walker's state, the
   * time, the roads under the leg it walks (`roadStep`) and the level crossings closed now
   * (`clearAhead`), nothing else, and draws no random number. A walker goes no further than the
   * edge of a closed crossing it is not on yet and waits there, its path, state and timer as they
   * were, until the crossing opens; one already on a crossing goes on.
   */
  private advance(p: Person, gdt: number, crossingClosed: CrossingClosed | null) {
    const next = p.path[p.step + 1];
    if (!next) return false;
    const speed = walkSpeed(p, roadStep(this.builder.roads, p.path[p.step], next));
    const dx = next.x - p.x;
    const dy = next.y - p.y;
    const d = Math.hypot(dx, dy);
    let stepLen = speed * gdt;
    if (crossingClosed) stepLen = Math.min(stepLen, clearAhead(p, next, crossingClosed));
    if (d <= stepLen) {
      p.x = next.x;
      p.y = next.y;
      p.step++;
    } else {
      p.x += (dx / d) * stepLen;
      p.y += (dy / d) * stepLen;
    }
    return true;
  }
}
