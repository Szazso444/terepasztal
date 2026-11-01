// Seeded traffic runs stepped tick by tick: every tick is folded into a digest of the whole train
// and claim state, held against golden values, and checked against the traffic and separation
// properties of docs/process/verification.md. The goldens pin the outcome of every step: they were
// recorded before #557 (route cursor, `aheadRun`, `ClaimMap`, the sections cache), re-recorded for
// #306 (see GOLDEN), and are a contract, not a number to update; a change that moves any train or
// claim by a millionth of a tile on any tick fails them.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash, type Hash } from 'node:crypto';
import { Dir } from '../engine/iso';
import type { PathSegment } from '../world/pathfinding';
import { Biome, Terrain } from '../world/tiles';
import { simWorld, line, station, type SimWorld } from '../testing/simWorld';
import {
  buildTrafficScenario,
  sharedTiles,
  SCENARIO_GDT,
  SCENARIO_TICK_RATE,
} from '../testing/trafficScenario';
import { blockingCycles } from './recovery';
import { rules, DEFAULT_RULES } from './rules';
import { setSupplyMode, DEFAULT_SUPPLY } from './supply';
import { SimStep } from './step';
import { SIM_STEP } from './time';
import { Train, defaultStop, resetTrainIds, type StopPlan } from './trains';
import { resetStationIds } from './stations';
import type { SignalLevel } from './signals';
import type { Fleet } from './fleet';
import type { Builder } from './build';
import { Traffic } from './traffic';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode(DEFAULT_SUPPLY);
  resetTrainIds();
  resetStationIds();
});

// ------------------------------------------------------------------------------------------------
// State digests

/** A float as an integer number of millionths, so the digest does not hang on the last bits. */
const r6 = (v: number) => (Number.isFinite(v) ? Math.round(v * 1e6) : String(v));

/** JSON with every non-integer number rounded to millionths. */
function roundedJSON(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    typeof v === 'number' && !Number.isInteger(v) ? r6(v) : v,
  );
}

/**
 * One tick of state: every train's state, place on its path, speed, claim limit and blocker, head
 * and tail poses; every claim in the claims map's order; the traffic counters, the active
 * recoveries and the signal tokens. With `full` (every hundredth tick), each train's save JSON.
 * Positions are kept to millionths of a tile, so the digest does not hang on the last bits of a
 * float.
 */
function tickState(fleet: Fleet, full: boolean): string {
  const parts: unknown[] = [];
  for (const t of fleet.trains) {
    const head = t.poses[0];
    const tail = t.poses[t.poses.length - 1];
    parts.push([
      t.id,
      t.state,
      r6(t.pathProgress),
      r6(t.pathTotal),
      r6(t.speed),
      r6(t.claimLimit),
      t.claimBlocker,
      t.blockedBy,
      head ? [r6(head.x), r6(head.y)] : null,
      tail ? [r6(tail.x), r6(tail.y)] : null,
      t.poses.length,
    ]);
    if (full) {
      // the colour code is the player's mark on a train: it moves nothing, and the goldens are older
      const saved: Partial<ReturnType<Train['toJSON']>> = t.toJSON();
      delete saved.colour;
      parts.push(roundedJSON(saved));
    }
  }
  parts.push([...fleet.traffic.claims]);
  parts.push(fleet.traffic.counters);
  parts.push([...fleet.traffic.recoveries.active.keys()]);
  parts.push([...fleet.signals.tokens]);
  return JSON.stringify(parts);
}

/** What a run must reproduce: the digest of every tick, its checkpoints and a summary. */
interface Outcome {
  /** sha1 over the state after every tick, first 16 hex digits */
  digest: string;
  /** the running digest after each quarter of the run, first 10 hex digits */
  quarters: string[];
  summary: string;
}

class Recorder {
  private hash: Hash = createHash('sha1');
  readonly quarters: string[] = [];
  constructor(private readonly ticks: number) {}
  add(tick: number, state: string) {
    this.hash.update(state);
    if ((tick + 1) % (this.ticks / 4) === 0)
      this.quarters.push(this.hash.copy().digest('hex').slice(0, 10));
  }
  done(summary: string): Outcome {
    return { digest: this.hash.digest('hex').slice(0, 16), quarters: this.quarters, summary };
  }
}

// ------------------------------------------------------------------------------------------------
// Properties checked on every tick

/** The scan `Train.pathAhead` replaced: path points from half a tile behind the head, by tile. */
function scannedAhead(t: Train): string {
  const { path, pathPts, pathCum, pathPos } = t as unknown as {
    path: PathSegment[] | null;
    pathPts: { seg: PathSegment }[];
    pathCum: number[];
    pathPos: number;
  };
  const out: string[] = [];
  if (!path) return '';
  let last: PathSegment | null = null;
  for (let i = 0; i < pathPts.length; i++) {
    if (pathCum[i] < pathPos - 0.5) continue;
    const seg = pathPts[i].seg;
    if (seg === last) continue;
    last = seg;
    out.push(`${seg.x},${seg.y},${seg.in},${seg.out},${pathCum[i]}`);
  }
  return out.join(';');
}
const listedAhead = (t: Train) =>
  t
    .pathAhead()
    .map((p) => `${p.x},${p.y},${p.in},${p.out},${p.arc}`)
    .join(';');

/** The per-path index `Traffic.assign` reads since #557 (private; absent before it). */
interface KeptIndex {
  aheadIndex(ahead: readonly { x: number; y: number }[]): {
    keys: ArrayLike<number>;
    secs: ArrayLike<number>;
    k0: number;
  };
}

/**
 * The claims and sections `Traffic.assign` leaves, checked right after it runs, before any train
 * moves:
 * - the sections are those of the track as it is now: every track tile is in the section a
 *   `Traffic` built afresh on the same track puts it in;
 * - where `Traffic` keeps the section ids of a path (#557), they are the current ones, tile for
 *   tile along every moving train's path ahead;
 * - every tile under a train's cars is claimed by that train (occupied track wins), so no tile
 *   one train stands on is claimed by another;
 * - every claim belongs to a train in the fleet and lies under its cars, on its path ahead
 *   (moving trains only) or on a recovery route it owns: nothing stale survives the keep pass.
 * Returns the first breach, or null.
 */
function claimBreach(fleet: Fleet, builder: Builder): string | null {
  const traffic = fleet.traffic;
  const track = fleet.track;
  const w = track.w;
  const at = (key: number) => `${key % w},${Math.floor(key / w)}`;

  const fresh = new Traffic(track, builder);
  fresh.rebuildSections();
  // section ids are numbered in the order the flood finds them, so compare the partitions
  const ours = new Map<number, number>();
  const theirs = new Map<number, number>();
  for (const { x, y } of track.tiles()) {
    const a = traffic.sectionOf(x, y);
    const b = fresh.sectionOf(x, y);
    if (
      a > 0 !== b > 0 ||
      (a <= 0 && a !== b) ||
      (ours.get(b) ?? a) !== a ||
      (theirs.get(a) ?? b) !== b
    )
      return `${x},${y} is in section ${a}, but in ${b} of sections built afresh`;
    ours.set(b, a);
    theirs.set(a, b);
  }
  const index = (traffic as unknown as Partial<KeptIndex>).aheadIndex?.bind(traffic);
  if (index)
    for (const t of fleet.trains) {
      if (t.state !== 'moving') continue;
      const ahead = t.pathAhead();
      const { keys, secs, k0 } = index(ahead);
      for (let i = 0; i < ahead.length; i++) {
        const p = ahead[i];
        if (keys[k0 + i] !== p.y * w + p.x || secs[k0 + i] !== traffic.sectionOf(p.x, p.y))
          return `train ${t.id}'s kept path index is stale at ${p.x},${p.y} (${i} tiles ahead)`;
      }
    }

  const byId = new Map(fleet.trains.map((t) => [t.id, t]));
  const cars = new Map(fleet.trains.map((t) => [t.id, new Set(t.occupancyKeys(w))]));
  const ahead = new Map(
    fleet.trains.map((t) => [t.id, new Set(t.pathAhead().map((p) => p.y * w + p.x))]),
  );
  for (const t of fleet.trains)
    for (const key of cars.get(t.id)!) {
      const owner = traffic.claims.get(key);
      // two trains on one tile is a separation breach, which the separation check reports
      const shared = fleet.trains.some((o) => o !== t && cars.get(o.id)!.has(key));
      if (owner !== t.id && !shared)
        return `train ${t.id} stands on ${at(key)}, claimed by ${owner ?? 'nobody'}`;
    }
  for (const [key, owner] of traffic.claims) {
    const t = byId.get(owner);
    if (!t) return `${at(key)} is claimed by train ${owner}, which is not in the fleet`;
    if (
      !cars.get(owner)!.has(key) &&
      !(t.state === 'moving' && ahead.get(owner)!.has(key)) &&
      !traffic.recoveries.active.get(owner)?.tiles.has(key)
    )
      return `${at(key)} is claimed by train ${owner} (${t.state}), not under it, ahead of it or on its recovery`;
  }
  return null;
}

/** Checks run on every tick of every scenario, failing with the scenario and the tick. */
class Watch {
  private tick = -1;
  constructor(
    private readonly name: string,
    private readonly fleet: Fleet,
  ) {
    const traffic = fleet.traffic;
    const assign = traffic.assign.bind(traffic);
    traffic.assign = (trains, now) => {
      assign(trains, now);
      const breach = claimBreach(fleet, fleet.builder);
      if (breach) throw new Error(`${this.name}, tick ${this.tick}: ${breach}`);
    };
  }
  /** Before the tick runs. */
  at(tick: number) {
    this.tick = tick;
  }
  /** After the tick ran. */
  after() {
    const shared = sharedTiles(this.fleet.trains, this.fleet.track.w);
    if (shared.length)
      throw new Error(`${this.name}, tick ${this.tick}: trains overlap ${JSON.stringify(shared)}`);
    for (const t of this.fleet.trains) {
      const listed = listedAhead(t);
      if (listed !== scannedAhead(t))
        throw new Error(
          `${this.name}, tick ${this.tick}: train ${t.id}'s path ahead is not the scan from its head`,
        );
    }
  }
}

// ------------------------------------------------------------------------------------------------
// The refuge scenario (src/testing/trafficScenario.ts)

/**
 * Blocking cycles of a run: the tick the first formed, the most ticks one stood, how many formed,
 * and the tick the one standing now formed (null when none stands).
 */
interface Cycles {
  first: number | null;
  longest: number;
  formed: number;
  open: number | null;
}

function refugeRun(count: number, pinned: boolean, ticks: number) {
  const name = `refuge ${count}${pinned ? ' pinned' : ''}`;
  const s = buildTrafficScenario(count, pinned);
  const watch = new Watch(name, s.fleet);
  const rec = new Recorder(ticks);
  const cycles: Cycles = { first: null, longest: 0, formed: 0, open: null };
  let firstRecovery: number | null = null;
  for (let tick = 0; tick < ticks; tick++) {
    watch.at(tick);
    s.step(SCENARIO_GDT, tick / SCENARIO_TICK_RATE);
    watch.after();
    if (firstRecovery === null && s.fleet.traffic.recoveries.active.size) firstRecovery = tick;
    const cycle = blockingCycles(s.fleet.trains).size > 0;
    if (cycle && cycles.open === null) {
      cycles.open = tick;
      cycles.formed++;
      cycles.first ??= tick;
    } else if (!cycle && cycles.open !== null) {
      cycles.longest = Math.max(cycles.longest, tick - cycles.open);
      cycles.open = null;
    }
    rec.add(tick, tickState(s.fleet, tick % 100 === 99));
  }
  const r = s.result();
  const summary = JSON.stringify({
    passed: r.passed,
    counters: r.traffic.counters,
    firstRecovery,
    cycles,
    trains: r.trains.map((t) => [t.id, t.state, t.yields, t.arrivedAt]),
  });
  return { result: r, cycles, firstRecovery, outcome: rec.done(summary) };
}

// ------------------------------------------------------------------------------------------------
// Scheduled lines: single track, trains meeting head-on

const stop = (id: number): StopPlan => ({
  ...defaultStop(id),
  load: 'none',
  unload: 'none',
  waitFull: false,
  maxDwell: 3,
});

/** Columns of the lines: track from LINE_X0 to LINE_X1, a road across every line at ROAD_X. */
const LINE_X0 = 4;
const LINE_X1 = 36;
const ROAD_X = 20;

interface Lines {
  w: SimWorld;
  rows: number[];
  /** `row:round` of every train a depot could not send out */
  refused: string[];
  /** puts the next train on every line, while there are trains left to add */
  spawn(round: number): void;
}

/**
 * `lines` straight single-track lines, seven rows apart, each with a depot at its west end, a
 * quarry near it and a warehouse near the east end. Every line gets `perLine` trains, one at the
 * start and one more every 150 ticks while the depot is clear. They run quarry to warehouse and
 * back: on the first line every second train sets off the other way, so they meet head-on at
 * once; on the second all set off east, following each other, and meet the next on its way back.
 * With `level`, signals stand every six tiles each way and the fleet runs at that level (with
 * null, none stand). One road crosses every line at ROAD_X.
 */
function linesWorld(
  seed: number,
  lines: number,
  perLine: number,
  level: SignalLevel | null,
): Lines {
  const w = simWorld({ size: 64, terrain: 'grass', seed });
  w.builder.free = true;
  for (let i = 0; i < w.regions.unlocked.length; i++) w.regions.own(i);
  w.economy.money = 1e9;
  const rows = Array.from({ length: lines }, (_, k) => 8 + 7 * k);
  for (const y of rows) line(w, LINE_X0, y, LINE_X1);
  const spawners: ((round: number) => void)[] = [];
  const refused: string[] = [];
  for (const [k, y] of rows.entries()) {
    const depot = station(w, 'depot', LINE_X0 - 2, y);
    const quarry = station(w, 'quarry', LINE_X0 + 8, y - 1);
    const warehouse = station(w, 'warehouse', LINE_X1 - 10, y - 1);
    // the depot's store keeps every train it sends out fuelled
    const store = w.stores.byKey(`st:${depot.id}`)!;
    for (const r of ['coal', 'water', 'oil']) store.add(r, 1e7);
    if (level)
      for (let x = LINE_X0 + 12; x < LINE_X1 - 4; x += 6) {
        w.builder.placeDecor(x, y, 'signal', Dir.E);
        w.builder.placeDecor(x + 3, y, 'signal', Dir.W);
      }
    spawners.push((round) => {
      const loco = w.inventory.add('f7', 0);
      const hopper = w.inventory.add('wood_hopper', 0);
      // the first line sends its trains out each way in turn, the second all east first
      const east = k % 2 === 1 || round % 2 === 0;
      const schedule = east
        ? [stop(quarry.id), stop(warehouse.id)]
        : [stop(warehouse.id), stop(quarry.id)];
      const t = w.fleet.create([loco.uid], [hopper.uid], schedule, undefined, 'schedule', depot.id);
      // a depot with a train still in its way sends none out: the summary counts them
      if (typeof t === 'string') {
        refused.push(`${y}:${round}`);
        return;
      }
      t.coal = t.coalCap;
      t.water = 1000;
      t.oil = 1e6;
    });
  }
  for (let y = rows[0] - 4; y <= rows[rows.length - 1] + 2; y++) w.builder.placeRoad(ROAD_X, y);
  if (level) w.fleet.signals.level = level;
  return {
    w,
    rows,
    refused,
    spawn: (round) => {
      if (round < perLine) for (const f of spawners) f(round);
    },
  };
}

/** Steps a lines world through SimStep, as the game does, with `disrupt` before each tick. */
function linesRun(name: string, lines: Lines, ticks: number, disrupt?: (tick: number) => void) {
  const { w, spawn } = lines;
  lines.spawn(0);
  const step = new SimStep(w);
  const ctx = { mode: 'play' as const, weather: false, stockCap: () => 1e9 };
  const watch = new Watch(name, w.fleet);
  const rec = new Recorder(ticks);
  for (let tick = 0; tick < ticks; tick++) {
    watch.at(tick);
    if (tick > 0 && tick % 150 === 0) spawn(tick / 150);
    disrupt?.(tick);
    w.clock.time += SIM_STEP;
    step.run(SIM_STEP, ctx);
    watch.after();
    rec.add(tick, tickState(w.fleet, tick % 100 === 99));
  }
  const states: Record<string, number> = {};
  for (const t of w.fleet.trains) states[t.state] = (states[t.state] ?? 0) + 1;
  const summary = JSON.stringify({
    trains: w.fleet.trains.length,
    refused: lines.refused,
    states,
    counters: w.fleet.traffic.counters,
    signals: w.fleet.signals.count,
    crossings: [...w.builder.roads.crossingKeys()].length,
    run: Math.round(w.fleet.trains.reduce((sum, t) => sum + t.distance, 0)),
  });
  return { w, outcome: rec.done(summary) };
}

// ------------------------------------------------------------------------------------------------
// The runs and their goldens

/**
 * Every run's outcome. Recorded on develop before #557 (1586dc42), and re-recorded once, with the
 * author's yes, for the local stores (#306): a crew now owes its food train by train instead of
 * the whole fleet slowing in a famine, so the unfed trains here run at full speed for their first
 * day and carry `owed` in their saved state. A run that differs has changed what the simulation
 * does on some tick, which is a question for the author, not a number to re-record.
 */
const GOLDEN: Record<string, Outcome> = {
  'refuge 3': {
    digest: 'c01d3611251b83a7',
    quarters: ['ba97373ffe', '1490beddf6', '354b2c5923', 'c01d361125'],
    summary:
      '{"passed":true,"counters":{"stuck":0,"deadlocks":0,"overlaps":0,"yields":2,"headOn":0,"waits":774},"firstRecovery":80,"cycles":{"first":0,"longest":81,"formed":2,"open":null},"trains":[[101,"noRoute",1,35.9],[102,"noRoute",0,24.7],[103,"noRoute",1,57.05]]}',
  },
  'refuge 4 pinned': {
    digest: '3febb6196946afcf',
    quarters: ['86d9ef05cc', 'bd6ab4fb9f', 'c3aeb86a15', '3febb61969'],
    summary:
      '{"passed":true,"counters":{"stuck":0,"deadlocks":0,"overlaps":0,"yields":2,"headOn":0,"waits":1269},"firstRecovery":80,"cycles":{"first":0,"longest":81,"formed":2,"open":null},"trains":[[101,"noRoute",1,41.8],[102,"noRoute",0,24.7],[103,"noRoute",1,62.95],[104,"noRoute",0,30.6]]}',
  },
  'refuge 8': {
    digest: '543466583562f3f6',
    quarters: ['181d764348', '4b608b3d29', 'a1da614d63', '5434665835'],
    summary:
      '{"passed":true,"counters":{"stuck":1,"deadlocks":0,"overlaps":0,"yields":2,"headOn":0,"waits":5666},"firstRecovery":80,"cycles":{"first":0,"longest":81,"formed":2,"open":null},"trains":[[101,"noRoute",1,76.6],[102,"noRoute",1,97.55],[103,"noRoute",0,33.15],[104,"noRoute",0,37.5],[105,"noRoute",0,43.4],[106,"noRoute",0,49.3],[107,"noRoute",0,55.2],[108,"noRoute",0,61.1]]}',
  },
  'lines none': {
    digest: '4245f478be971ff3',
    quarters: ['a6844eb0a1', '7777d56506', 'f91a69a6a8', '4245f478be'],
    summary:
      '{"trains":4,"refused":["8:2","15:2"],"states":{"moving":2,"yielding":2},"counters":{"stuck":0,"deadlocks":0,"overlaps":0,"yields":2,"headOn":0,"waits":780},"signals":0,"crossings":4,"run":141}',
  },
  'lines auto': {
    digest: '5e4ff08a9d4b1b0c',
    quarters: ['a6844eb0a1', '1d3e1e8f0d', 'bacbff04dd', '5e4ff08a9d'],
    summary:
      '{"trains":4,"refused":["8:2","15:2"],"states":{"yielding":2,"moving":2},"counters":{"stuck":0,"deadlocks":0,"overlaps":0,"yields":4,"headOn":0,"waits":535},"signals":12,"crossings":4,"run":140}',
  },
  'lines token': {
    digest: '79769ccff8b10067',
    quarters: ['6ad82fe547', '4402549045', 'a014b626ef', '79769ccff8'],
    summary:
      '{"trains":4,"refused":["8:2","15:2"],"states":{"moving":2,"yielding":2},"counters":{"stuck":0,"deadlocks":0,"overlaps":0,"yields":2,"headOn":0,"waits":780},"signals":12,"crossings":4,"run":141}',
  },
  'lines absolute_block': {
    digest: '21eae0eed8003171',
    quarters: ['7e0b518345', 'c792c54acf', '4256c8ad49', '21eae0eed8'],
    summary:
      '{"trains":4,"refused":["8:2","15:2"],"states":{"yielding":2,"moving":2},"counters":{"stuck":0,"deadlocks":0,"overlaps":0,"yields":4,"headOn":0,"waits":375},"signals":12,"crossings":4,"run":142}',
  },
  'lines ctc': {
    digest: 'fd670b77dfb11e08',
    quarters: ['f63583d754', '6d582ad898', 'ceae147464', 'fd670b77df'],
    summary:
      '{"trains":4,"refused":["8:2","15:2"],"states":{"yielding":2,"moving":2},"counters":{"stuck":0,"deadlocks":0,"overlaps":0,"yields":4,"headOn":0,"waits":535},"signals":12,"crossings":4,"run":141}',
  },
  'lines in_cab': {
    digest: '21eae0eed8003171',
    quarters: ['7e0b518345', 'c792c54acf', '4256c8ad49', '21eae0eed8'],
    summary:
      '{"trains":4,"refused":["8:2","15:2"],"states":{"yielding":2,"moving":2},"counters":{"stuck":0,"deadlocks":0,"overlaps":0,"yields":4,"headOn":0,"waits":375},"signals":12,"crossings":4,"run":142}',
  },
  'disrupted lines': {
    digest: 'f3e60c8c4e1da8da',
    quarters: ['d2b19ba542', 'daf726a120', '92c2c252bf', 'f3e60c8c4e'],
    summary:
      '{"trains":4,"refused":["8:2","15:2"],"states":{"yielding":2,"moving":2},"counters":{"stuck":1,"deadlocks":0,"overlaps":0,"yields":5,"headOn":0,"waits":520},"signals":12,"crossings":4,"run":149}',
  },
};

/** The longest a blocking cycle may stand in the refuge scenario before it is broken: 10 s. */
const CYCLE_BOUND = 200;

/** The refuge runs: trains, pinned, ticks (past the last arrival). */
const REFUGE = [
  [3, false, 1200],
  [4, true, 1280],
  [8, false, 2000],
] as const;

/** Signal levels of the lines runs; null is no signals at all. */
const LEVELS = [null, 'auto', 'token', 'absolute_block', 'ctc', 'in_cab'] as const;

/** Ticks of a lines run. */
const LINE_TICKS = 1200;

function check(name: string, outcome: Outcome) {
  expect(outcome, `${name}: the digests of every tick`).toEqual(GOLDEN[name]);
}

describe('the refuge scenario, tick by tick', () => {
  // slow because the scenario runs past its last arrival with every check after every tick:
  // 0.3 to 0.8 s alone, so 30 s
  it.each(REFUGE)(
    '%i trains (pinned: %s): claims, separation and the path ahead hold on every tick, the jam is broken in bounded time, and every tick is as before',
    (count, pinned, ticks) => {
      const name = `refuge ${count}${pinned ? ' pinned' : ''}`;
      const { result, cycles, firstRecovery, outcome } = refugeRun(count, pinned, ticks);
      // the head-on jam forms at once, a coordinated recovery breaks it, and none is left
      expect(
        {
          cycleSeen: cycles.first !== null,
          recovered: firstRecovery !== null,
          cycleOpen: cycles.open,
          cycleWithinBound: cycles.longest <= CYCLE_BOUND,
          deadlocks: result.traffic.counters.deadlocks,
          overlaps: result.traffic.counters.overlaps,
          passed: result.passed,
          arrived: result.trains.every((t) => t.arrivedAt !== null),
        },
        `${name}: ${outcome.summary}`,
      ).toEqual({
        cycleSeen: true,
        recovered: true,
        cycleOpen: null,
        cycleWithinBound: true,
        deadlocks: 0,
        overlaps: 0,
        passed: true,
        arrived: true,
      });
      check(name, outcome);
    },
    30_000,
  );
});

describe('scheduled single-track lines, tick by tick', () => {
  // slow because a whole SimStep world runs 1200 ticks with every check after every tick: about
  // 0.6 s alone, so 30 s
  it.each(LEVELS)(
    'signals %s: claims, separation and the path ahead hold on every tick, and every tick is as before',
    (level) => {
      const name = `lines ${level ?? 'none'}`;
      const { w, outcome } = linesRun(name, linesWorld(4242, 2, 3, level), LINE_TICKS);
      // not vacuous: the trains ran, met and waited, the road crosses both lines
      expect(w.fleet.trains.length, outcome.summary).toBeGreaterThanOrEqual(4);
      expect(w.fleet.traffic.counters.waits, outcome.summary).toBeGreaterThan(0);
      expect(w.fleet.traffic.counters.overlaps, outcome.summary).toBe(0);
      expect([...w.builder.roads.crossingKeys()].length, outcome.summary).toBeGreaterThanOrEqual(2);
      check(name, outcome);
    },
    30_000,
  );

  // slow because a whole SimStep world runs 1400 ticks with every check after every tick: about
  // 0.8 s alone, so 30 s
  it('through reloads, track taken up and relaid under a line, and schedules reversed mid-run', () => {
    const lines = linesWorld(777, 2, 3, 'absolute_block');
    const { w, rows } = lines;
    const done: string[] = [];
    const reload = () => {
      // every train saved and loaded, as a reload does
      for (let i = 0; i < w.fleet.trains.length; i++) {
        const j = JSON.parse(JSON.stringify(w.fleet.trains[i].toJSON())) as ReturnType<
          Train['toJSON']
        >;
        w.fleet.trains[i] = Train.fromJSON(j, w.track);
      }
      done.push('reload');
    };
    const { outcome } = linesRun('disrupted lines', lines, 1400, (tick) => {
      if (tick === 300 || tick === 800) reload();
      if (tick === 400 && w.builder.removeTrack(26, rows[0])) done.push('cut 1');
      if (tick === 520) line(w, LINE_X0, rows[0], LINE_X1);
      if (tick === 600) {
        // every second train runs its stops the other way round
        w.fleet.trains.forEach((t, i) => {
          if (i % 2 === 1) w.fleet.setSchedule(t, [...t.schedule].reverse());
        });
        done.push('reversed');
      }
      if (tick === 900 && w.builder.removeTrack(21, rows[1])) done.push('cut 2');
      if (tick === 1000) line(w, LINE_X0, rows[1], LINE_X1);
    });
    expect(done).toEqual(['reload', 'cut 1', 'reversed', 'reload', 'cut 2']);
    expect(w.fleet.traffic.counters.overlaps, outcome.summary).toBe(0);
    check('disrupted lines', outcome);
  }, 30_000);
});

describe('a train through a tunnel', () => {
  const ROW = 20;
  const WEST = 8;
  const EAST = 40;
  const PEAK_X = 24;
  /** A square hill of 7 on the line, a level a tile down each side to level 0, 7 tiles off. */
  const hillLevel = (x: number, y: number) =>
    Math.max(0, 7 - Math.max(Math.abs(x - PEAK_X), Math.abs(y - ROW)));
  type Ground = 'flat' | 'tunnel' | 'over the hill';

  /**
   * One train running to and fro between a quarry and a warehouse on one line, on flat ground, or
   * through the hill by a dug tunnel, or up and over it. The stations stand off the hill in every
   * case, and nothing else differs. It is laid from the west end, with the Drill on inside.
   * `rock` is what the hill is made of from level 3 up, where the tunnel runs dug: the banks either
   * side, and the cuts in them, stay grass in the Plains.
   */
  function tunnelRun(ground: Ground, ticks: number, rock?: { terrain: Terrain; biome: Biome }) {
    const w = simWorld({ size: 64, terrain: 'grass', seed: 4242 });
    w.builder.free = true;
    for (let i = 0; i < w.regions.unlocked.length; i++) w.regions.own(i);
    if (ground !== 'flat')
      w.map.groundLevel = Uint8Array.from({ length: w.map.w * w.map.h }, (_, i) =>
        hillLevel(i % w.map.w, Math.floor(i / w.map.w)),
      );
    if (rock)
      w.map.terrain.forEach((_, i) => {
        if (hillLevel(i % w.map.w, Math.floor(i / w.map.w)) < 3) return;
        w.map.terrain[i] = rock.terrain;
        w.map.biome[i] = rock.biome;
      });
    if (ground === 'tunnel') {
      const drag = Array.from({ length: 15 }, (_, i) => ({ x: PEAK_X - 7 + i, y: ROW }));
      expect(w.builder.dig(drag), w.builder.checkDig(drag).reason).toBe(true);
      expect(w.builder.underground.portals()).toHaveLength(2);
      const dug = drag.filter((t) => w.builder.underground.isDug(t.x, t.y)).map((t) => t.x);
      const [first, last] = [dug[0], dug[dug.length - 1]];
      line(w, WEST, ROW, first - 1);
      w.builder.insideMode = true;
      line(w, first, ROW, last);
      w.builder.insideMode = false;
      line(w, last + 1, ROW, EAST);
      // the rail a train runs on stands level at the floor, the ground over it where it was
      for (let x = first; x <= last; x++) {
        const bed = w.fleet.railBeds.get(ROW * w.map.w + x);
        expect(bed, `column ${x}`).toMatchObject({ bridge: true, flat: true });
      }
    } else line(w, WEST, ROW, EAST);
    const depot = station(w, 'depot', WEST - 2, ROW);
    const quarry = station(w, 'quarry', WEST + 2, ROW - 1);
    const warehouse = station(w, 'warehouse', EAST - 2, ROW - 1);
    const store = w.stores.byKey(`st:${depot.id}`)!;
    for (const r of ['coal', 'water', 'oil']) store.add(r, 1e7);
    const t = w.fleet.create(
      [w.inventory.add('f7', 0).uid],
      [w.inventory.add('wood_hopper', 0).uid],
      [stop(quarry.id), stop(warehouse.id)],
      undefined,
      'schedule',
      depot.id,
    );
    if (typeof t === 'string') throw new Error(t);
    t.coal = t.coalCap;
    t.water = 1000;
    t.oil = 1e6;
    const step = new SimStep(w);
    const ctx = { mode: 'play' as const, weather: false, stockCap: () => 1e9 };
    /** The tile the head stands on, tick by tick. */
    const path: string[] = [];
    const rec = new Recorder(ticks);
    for (let tick = 0; tick < ticks; tick++) {
      w.clock.time += SIM_STEP;
      step.run(SIM_STEP, ctx);
      path.push(`${t.headTile?.x},${t.headTile?.y}`);
      rec.add(tick, tickState(w.fleet, tick % 100 === 99));
    }
    return { t, path, outcome: rec.done(`${t.state} ${r6(t.distance)}`) };
  }

  // slow because three whole SimStep worlds run 2400 ticks: under a second alone, so 30 s
  it('a train crosses a tunnel on the same path and time as the same line on flat ground', () => {
    const TICKS = 2400;
    const flat = tunnelRun('flat', TICKS);
    const tunnel = tunnelRun('tunnel', TICKS);
    // not vacuous: the train ran the whole way, through the tunnel and back
    expect(flat.t.distance).toBeGreaterThan(2 * (EAST - WEST - 4));
    expect(new Set(flat.path).has(`${PEAK_X},${ROW}`)).toBe(true);
    expect(tunnel.path).toEqual(flat.path);
    expect(tunnel.outcome).toEqual(flat.outcome);
    // and the check can see a hill: the same line up and over runs slower
    const over = tunnelRun('over the hill', TICKS);
    expect(over.outcome.digest).not.toBe(flat.outcome.digest);
    expect(over.t.distance).toBeLessThan(flat.t.distance);
  }, 30_000);

  // slow because two whole SimStep worlds run 2400 ticks each: under a second alone, so 30 s
  it.each([
    ['stone in the Mountain biome', Terrain.Mountain, Biome.Mountain],
    ['a Hill in the Plains', Terrain.Hill, Biome.Plains],
  ])(
    'inside %s a train runs as on flat ground, tick by tick',
    (_name, terrain, biome) => {
      const TICKS = 2400;
      const flat = tunnelRun('flat', TICKS);
      const tunnel = tunnelRun('tunnel', TICKS, { terrain, biome });
      expect(new Set(flat.path).has(`${PEAK_X},${ROW}`)).toBe(true);
      expect(tunnel.path).toEqual(flat.path);
      expect(tunnel.outcome).toEqual(flat.outcome);
    },
    30_000,
  );
});
