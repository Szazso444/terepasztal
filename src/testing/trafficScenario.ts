// Headless port of the browser traffic fixture scratchpad/traffic-scenario.js: the same refuge
// line, trains and yield-resume pass, run on a bare Fleet with no Game, DOM, renderer or clock.
// Building is separate from driving, so a caller can step it with its own gdt and game time.
// Plain TypeScript with no test framework. The fleet imports src/engine/audio.ts, so a test that
// uses this mocks that module (src/sim/trafficScenario.test.ts shows how).

import { emptyMap } from '../world/mapgen';
import { Terrain, type GameMap } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { findPath, type PathSegment } from '../world/pathfinding';
import { Dir } from '../engine/iso';
import { content } from '../data/content';
import { Builder } from '../sim/build';
import { Stockpile } from '../sim/stockpile';
import { Economy } from '../sim/economy';
import { Fleet } from '../sim/fleet';
import { Train, type TrainState } from '../sim/trains';
import { Inventory } from '../gacha/inventory';

/** Side of the square grass map: the default `rules.mapSize`, room for the line at x 125. */
export const SCENARIO_MAP_SIZE = 160;
/** Row of the main line. */
export const SCENARIO_ROW = 110;
/** The plain runner's ticks per game second, as the browser script: tick n runs at n / 20. */
export const SCENARIO_TICK_RATE = 20;
/** The plain runner's step in game seconds. */
export const SCENARIO_GDT = 0.05;
/** The plain runner's tick budget, 240 game seconds at SCENARIO_GDT. */
export const SCENARIO_MAX_TICKS = 4800;
/** Train 2 has passed the refuge once its head stands west of this column. */
const PASS_X = 99;

/**
 * The private Train members the browser script drives directly, since JavaScript does not see
 * `private`. Reached through this view only, so the fixture makes the same calls without changing
 * Train.
 */
interface TrainInternals {
  trail: { seg: PathSegment }[];
  trackVersion: number;
  setPath(path: PathSegment[], map: GameMap, track: TrackGraph): void;
  reverseConsist(): void;
}
const internals = (t: Train) => t as unknown as TrainInternals;

/** One train's outcome. */
export interface ScenarioTrain {
  id: number;
  state: TrainState;
  /** `Train.yieldCount`: times it pulled aside (never reset here, no train reaches a station) */
  yields: number;
  /** `Train.blockedTime` now: seconds of the hold it is in, 0 when free */
  blockedTime: number;
  /** the longest `Train.blockedTime` seen after any tick */
  maxBlockedTime: number;
  /** game time of the step in which it reached the end of its route and left, or null */
  arrivedAt: number | null;
  /** its head tile when it left, or now if it has not */
  head: { x: number; y: number } | null;
}

/** What `result()` returns: the browser script's report, less timings, frames and rendering. */
export interface ScenarioResult {
  count: number;
  pinned: boolean;
  /** steps taken */
  ticks: number;
  /** game time of the last step */
  time: number;
  /** train 2, heading west against the others, has its head past the refuge */
  passed: boolean;
  trains: ScenarioTrain[];
  /** most recovery reservations active at once after any tick */
  maxActive: number;
  /** `Traffic.report` over the trains still in the fleet; `counters` covers the whole run */
  traffic: ReturnType<Fleet['traffic']['report']>;
}

export interface TrafficScenario {
  readonly map: GameMap;
  readonly track: TrackGraph;
  readonly builder: Builder;
  readonly fleet: Fleet;
  /** every scenario train in id order, those that left the fleet included; index 1 is train 2 */
  readonly trains: readonly Train[];
  /** each train's destination column on the main line */
  readonly destinations: ReadonlyMap<number, number>;
  /**
   * One tick: yielded trains resume where a clear route exists, `fleet.tick(gdt, now)` runs, and
   * trains that reached the end of their route (state `noRoute`) leave the fleet.
   */
  step(gdt: number, now: number): void;
  /** The browser script's early exit: train 2 is past the refuge and some train has yielded. */
  done(): boolean;
  result(): ScenarioResult;
}

/**
 * The refuge scenario of scratchpad/traffic-scenario.js. A regular main line runs along
 * SCENARIO_ROW from x 20 to 125. A switch at x 100 leads to the refuge, an eight-tile siding down
 * that column on the next eight rows; with more than three trains and `pinned` unset there is a
 * switch and siding every ten tiles from x 50 to 100. Trains 1 (head at x 103) and 3 (x 97) head
 * east to x 120, either side of the switch; train 2 (x 109) heads west to x 92, against both on
 * single track. Trains 4 to `count` queue behind train 3 five tiles apart, also eastbound. With
 * `pinned`, train 4 instead stands at x 115 heading west to x 92, so train 2 has no room to back
 * away.
 */
export function buildTrafficScenario(count = 3, pinned = false): TrafficScenario {
  const map = emptyMap(4242, SCENARIO_MAP_SIZE, SCENARIO_MAP_SIZE, Terrain.Grass);
  const track = new TrackGraph(SCENARIO_MAP_SIZE, SCENARIO_MAP_SIZE);
  const stock = new Stockpile();
  const economy = new Economy();
  const builder = new Builder(map, new RegionState(map), track, economy, stock);
  builder.free = true;
  const fleet = new Fleet(track, builder, map, new Inventory(), economy, stock);

  const y = SCENARIO_ROW;
  for (let x = 20; x <= 125; x++) track.place(x, y, 'straight', 1);
  for (const x of count > 3 && !pinned ? [50, 60, 70, 80, 90, 100] : [100]) {
    track.place(x, y, 'switch', 1);
    for (let sy = y + 1; sy <= y + 8; sy++) track.place(x, sy, 'straight', 0);
  }

  const trains: Train[] = [];
  const destinations = new Map<number, number>();
  const def = content.locomotives.find((d) => d.id === 'f7');
  if (!def) throw new Error('The traffic scenario needs the f7 locomotive');
  const make = (id: number, head: number, entry: Dir, dest: number) => {
    const train = new Train([{ uid: 1000 + id, def, level: 0 }], 'Traffic test ' + id, 100 + id);
    if (!train.spawnAt(track, head, y, entry))
      throw new Error(`Train ${id} cannot stand at ${head},${y}`);
    train.oil = 1e6;
    train.coal = 1e6;
    train.water = 1e6;
    const path = findPath(track, { x: head, y, in: entry }, (x, sy) => x === dest && sy === y);
    if (!path) throw new Error(`Train ${id} has no route from ${head},${y} to ${dest},${y}`);
    internals(train).setPath(path, map, track);
    internals(train).trackVersion = track.version;
    train.state = 'moving';
    trains.push(train);
    fleet.trains.push(train);
    destinations.set(train.id, dest);
  };
  make(1, 103, Dir.W, 120);
  make(2, 109, Dir.E, 92);
  make(3, 97, Dir.W, 120);
  for (let id = 4; id <= count; id++)
    if (pinned && id === 4) make(id, 115, Dir.E, 92);
    else make(id, 97 - (id - 3) * 5, Dir.W, 120);

  const arrived = new Map<number, { at: number; head: { x: number; y: number } | null }>();
  const maxBlocked = new Map<number, number>();
  let ticks = 0;
  let time = 0;
  let maxActive = 0;

  // One-shot virtual exits keep this fixture focused on traffic, not platform loading. A yielded
  // train resumes its original trip only when a clear route exists; arrivals leave the fixture so
  // an intentionally missing station cannot become a permanent jam.
  const resumeYielded = () => {
    for (const train of trains) {
      if (arrived.has(train.id) || train.state !== 'yielding') continue;
      const avoid = (x: number, sy: number) =>
        fleet.occupied(x, sy, train.id) || fleet.traffic.claimedBy(x, sy, train.id) !== null;
      const dest = destinations.get(train.id);
      for (const flip of [false, true]) {
        // A shallow copy previews the reversed head; reverseConsist replaces, never mutates, the
        // trail and pose arrays it shares with the real train.
        const preview = Object.assign(
          Object.create(Object.getPrototypeOf(train) as object) as Train,
          train,
        );
        if (flip) internals(preview).reverseConsist();
        const head = internals(preview).trail.at(-1)!.seg;
        const path = findPath(track, head, (x, sy) => x === dest && sy === y, 10000, avoid);
        if (!path) continue;
        if (flip) internals(train).reverseConsist();
        internals(train).setPath(path, map, track);
        train.state = 'moving';
        internals(train).trackVersion = track.version;
        break;
      }
    }
  };

  const step = (gdt: number, now: number) => {
    resumeYielded();
    fleet.tick(gdt, now);
    maxActive = Math.max(maxActive, fleet.traffic.recoveries.active.size);
    for (const t of trains) {
      if (arrived.has(t.id)) continue;
      maxBlocked.set(t.id, Math.max(maxBlocked.get(t.id) ?? 0, t.blockedTime));
      if (t.state === 'noRoute') {
        arrived.set(t.id, { at: now, head: t.headTile });
        fleet.trains.splice(fleet.trains.indexOf(t), 1);
      }
    }
    ticks++;
    time = now;
  };

  const passed = () => (trains[1].headTile?.x ?? Infinity) < PASS_X;

  return {
    map,
    track,
    builder,
    fleet,
    trains,
    destinations,
    step,
    done: () => passed() && trains.some((t) => t.yieldCount > 0),
    result: () => ({
      count,
      pinned,
      ticks,
      time,
      passed: passed(),
      trains: trains.map((t) => ({
        id: t.id,
        state: t.state,
        yields: t.yieldCount,
        blockedTime: t.blockedTime,
        maxBlockedTime: maxBlocked.get(t.id) ?? 0,
        arrivedAt: arrived.get(t.id)?.at ?? null,
        head: arrived.get(t.id)?.head ?? t.headTile,
      })),
      maxActive,
      traffic: fleet.traffic.report(fleet.trains),
    }),
  };
}

/** What runTrafficScenario may be given besides the scenario; every field is optional. */
export interface RunOptions {
  /** ticks before it gives up (default SCENARIO_MAX_TICKS) */
  maxTicks?: number;
  /** called after every step, before the early exit is checked */
  afterStep?: (scenario: TrafficScenario, now: number) => void;
}

/**
 * The browser script's loop: a fresh scenario stepped by SCENARIO_GDT at game time
 * tick / SCENARIO_TICK_RATE, up to `maxTicks`, stopping after the tick in which `done()` first
 * holds.
 */
export function runTrafficScenario(
  count = 3,
  pinned = false,
  options: RunOptions = {},
): ScenarioResult {
  const { maxTicks = SCENARIO_MAX_TICKS, afterStep } = options;
  const scenario = buildTrafficScenario(count, pinned);
  for (let tick = 0; tick < maxTicks; tick++) {
    const now = tick / SCENARIO_TICK_RATE;
    scenario.step(SCENARIO_GDT, now);
    afterStep?.(scenario, now);
    if (scenario.done()) break;
  }
  return scenario.result();
}

/**
 * Tiles under the cars of two trains at once, by the tile rule the traffic counter uses
 * (`Train.occupancyKeys`), one entry per pair and tile. Empty when the trains stand apart.
 */
export function sharedTiles(
  trains: readonly Train[],
  w: number,
): { a: number; b: number; x: number; y: number }[] {
  const out: { a: number; b: number; x: number; y: number }[] = [];
  const keys = trains.map((t) => new Set(t.occupancyKeys(w)));
  for (let i = 0; i < trains.length; i++)
    for (let j = i + 1; j < trains.length; j++)
      for (const k of keys[i])
        if (keys[j].has(k))
          out.push({ a: trains[i].id, b: trains[j].id, x: k % w, y: Math.floor(k / w) });
  return out;
}
