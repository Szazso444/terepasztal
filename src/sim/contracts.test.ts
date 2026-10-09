import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Rng } from '../engine/rng';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { resetStationIds } from './stations';
import { rules, DEFAULT_RULES, daySeconds } from './rules';
import { ContractBoard, type Contract } from './contracts';
import type { DeliveryEvent } from './trains';
import { forAll, shrinkArray, shrinkInt, SEEDS } from '../testing/property';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

/** Three producers and two towns along one line: several cargo routes to draw offers from. */
function world() {
  const map = emptyMap(4242, 96, 96, Terrain.Grass),
    track = new TrackGraph(96, 96),
    economy = new Economy();
  const builder = new Builder(map, new RegionState(map), track, economy, new Stockpile());
  builder.free = true;
  for (let x = 2; x < 90; x++) track.place(x, 30, 'straight', 1);
  for (const [x, id] of [
    [10, 'farm'],
    [20, 'lumber'],
    [30, 'quarry'],
    [50, 'town'],
    [80, 'town'],
  ] as const)
    expect(builder.placeStation(x, 31, id)).not.toBeNull();
  return { builder, economy };
}

const SEED = 0x5eed;
const NOW = 1000;
/** `n` offers in a row; unless forced the board skips a duplicate of an open offer (null). */
const draw = (board: ContractBoard, n: number, force = false): (Contract | null)[] =>
  Array.from({ length: n }, () => board.generate(NOW, force));
/** What a save file carries: the board through JSON text. */
const saved = (board: ContractBoard) => JSON.parse(JSON.stringify(board.toJSON())) as unknown;

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  resetStationIds(1);
  vi.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error('the board drew from Math.random');
  });
});
afterEach(() => vi.restoreAllMocks());

describe('ContractBoard randomness', () => {
  it('draws the same offers after a load as the board that was saved', () => {
    const { builder, economy } = world();
    const a = new ContractBoard(new Rng(SEED), builder, economy);
    expect(a.canGenerate()).toBe(true);
    draw(a, 5);
    const save = saved(a);
    const b = new ContractBoard(new Rng(SEED), builder, economy);
    b.load(save as ReturnType<ContractBoard['toJSON']>);
    const fromA = draw(a, 5);
    expect(fromA.some((c) => c !== null)).toBe(true);
    expect(draw(b, 5)).toEqual(fromA);
    // and they stay in step on offers that are never skipped
    const forcedA = draw(a, 5, true);
    expect(forcedA.every((c) => c !== null)).toBe(true);
    expect(draw(b, 5, true)).toEqual(forcedA);
  });

  it('resumes the stream from a save taken after any number of offers', () => {
    const { builder, economy } = world();
    for (const at of [0, 1, 3, 12]) {
      const ra = new Rng(SEED);
      const a = new ContractBoard(ra, builder, economy);
      draw(a, at);
      const rb = new Rng(SEED ^ 0xffff);
      const b = new ContractBoard(rb, builder, economy);
      b.load(saved(a) as ReturnType<ContractBoard['toJSON']>);
      const next = (rng: Rng) => Array.from({ length: 16 }, () => rng.next());
      expect(next(rb)).toEqual(next(ra));
    }
  });

  it('keeps the reseeded stream for a save written before the board kept its state', () => {
    const { builder, economy } = world();
    const a = new ContractBoard(new Rng(SEED), builder, economy);
    draw(a, 5);
    const old = saved(a) as Record<string, unknown>;
    delete old.rng;
    const b = new ContractBoard(new Rng(SEED), builder, economy);
    b.load(old as ReturnType<ContractBoard['toJSON']>);
    expect(b.toJSON().rng).toBe(new Rng(SEED).state);
    expect(b.contracts).toEqual(a.contracts);
  });
});

// ------------------------------------------------------------------ properties over boards
//
// Seeded boards: producers and takers on either side of a line, an age, a board stream, and a run
// of what a game does to a board (offers drawn or forced, time passing with its refreshes, expiry
// and failures, offers accepted or declined, contracts cancelled or delivered to) with a save
// taken after any step of it.

const LINE = 30;
const KINDS = ['farm', 'lumber', 'quarry', 'pump', 'station', 'town', 'warehouse'] as const;

interface Spot {
  x: number;
  side: -1 | 1;
  kind: (typeof KINDS)[number];
}
type Op =
  | { k: 'offer'; force: boolean }
  | { k: 'wait'; days: number }
  | { k: 'accept'; i: number }
  | { k: 'decline'; i: number }
  | { k: 'cancel'; i: number }
  | { k: 'deliver'; i: number; share: number };
interface BoardCase {
  stations: Spot[];
  tier: number;
  stream: number;
  ops: Op[];
  /** the save is taken after this many ops, 0..ops.length */
  saveAt: number;
}

function genOp(rng: Rng): Op {
  const r = rng.next();
  if (r < 0.35) return { k: 'offer', force: false };
  if (r < 0.45) return { k: 'offer', force: true };
  if (r < 0.65) return { k: 'wait', days: rng.pick([0.05, 0.25, 1, 3]) };
  if (r < 0.8) return { k: 'accept', i: rng.int(0, 7) };
  if (r < 0.85) return { k: 'decline', i: rng.int(0, 7) };
  if (r < 0.9) return { k: 'cancel', i: rng.int(0, 7) };
  return { k: 'deliver', i: rng.int(0, 7), share: rng.pick([0.25, 0.5, 1]) };
}

function genBoard(rng: Rng): BoardCase {
  const spot = (kind: Spot['kind']): Spot => ({
    x: rng.int(3, 92),
    side: rng.chance(0.5) ? -1 : 1,
    kind,
  });
  // a producer and a taker first, so most boards have a route to offer on; then anything
  const stations = [spot(rng.pick(KINDS.slice(0, 4))), spot(rng.pick(KINDS.slice(5)))];
  for (let i = rng.int(0, 5); i > 0; i--) stations.push(spot(rng.pick(KINDS)));
  const ops = Array.from({ length: rng.int(0, 40) }, () => genOp(rng));
  return {
    stations,
    tier: rng.int(0, 2),
    stream: rng.int(0, 0xffffffff),
    ops,
    saveAt: rng.int(0, ops.length),
  };
}

/** Fewer ops, an earlier save, fewer stations, an earlier age. */
function* shrinkBoard(c: BoardCase): Iterable<BoardCase> {
  for (const ops of shrinkArray(c.ops)) yield { ...c, ops, saveAt: Math.min(c.saveAt, ops.length) };
  for (const saveAt of shrinkInt(c.saveAt)) yield { ...c, saveAt };
  for (const stations of shrinkArray(c.stations)) if (stations.length) yield { ...c, stations };
  for (const tier of shrinkInt(c.tier)) yield { ...c, tier };
}

function line(c: BoardCase) {
  resetStationIds(1);
  const map = emptyMap(4242, 96, 96, Terrain.Grass),
    track = new TrackGraph(96, 96);
  const builder = new Builder(map, new RegionState(map), track, new Economy(), new Stockpile());
  builder.free = true;
  for (let x = 2; x < 94; x++) track.place(x, LINE, 'straight', 1);
  // a spot already taken, or a town too close to another, is left out
  for (const s of c.stations) builder.placeStation(s.x, LINE + s.side, s.kind);
  return builder;
}

/** A board with its own purse and clock; the game saves those apart from the board. */
interface Desk {
  board: ContractBoard;
  economy: Economy;
  now: number;
}
function desk(builder: Builder, c: BoardCase, stream: number): Desk {
  const economy = new Economy();
  economy.tier = c.tier;
  return { board: new ContractBoard(new Rng(stream), builder, economy), economy, now: 0 };
}

/** One op on a desk: what the board answered, and the purse after it. */
function act(d: Desk, op: Op): string {
  const { board, economy } = d;
  let out: unknown = null;
  if (op.k === 'offer') out = board.generate(d.now, op.force);
  else if (op.k === 'wait') {
    d.now += op.days * daySeconds();
    board.tick(d.now);
    out = board.contracts.map((c) => c.status);
  } else {
    const list = op.k === 'accept' || op.k === 'decline' ? board.offers : board.active;
    const c = list[op.i % Math.max(1, list.length)];
    if (!c) out = null;
    else if (op.k === 'accept') out = board.accept(c, d.now);
    else if (op.k === 'decline') out = (board.decline(c), c.status);
    else if (op.k === 'cancel') out = board.cancel(c);
    else {
      const station = board.builder.stationById(c.destId);
      const amount = Math.max(1, Math.round((c.amount - c.delivered) * op.share));
      out = station
        ? board.onDelivery({ cargo: c.cargo, amount, origin: c.originId, station } as DeliveryEvent)
        : null;
    }
  }
  return `${JSON.stringify(out)}|${economy.money},${economy.tickets},${economy.earned}`;
}
const run = (d: Desk, ops: readonly Op[]) => ops.map((op) => act(d, op));

/**
 * The board's save as text. Rng.state is not kept to 32 bits (src/engine/rng.ts), so a live
 * stream and the same stream restored from a save name it with numbers 2^32 apart: compare the
 * stream itself, its low 32 bits.
 */
function saveText(board: ContractBoard) {
  const j = board.toJSON();
  return JSON.stringify({ ...j, rng: j.rng >>> 0 });
}

/** Throws at the first op where two runs part. */
function sameRun(what: string, want: string[], got: string[], from: number, ops: readonly Op[]) {
  for (let i = 0; i < Math.max(want.length, got.length); i++)
    if (want[i] !== got[i])
      throw new Error(
        `${what}: the runs part at op ${from + i} (${JSON.stringify(ops[i])})\n  want ${want[i]}\n  got  ${got[i]}`,
      );
}

describe('ContractBoard randomness, over seeded boards', () => {
  it('answers the same from the same seed', () => {
    let offered = 0;
    forAll(
      genBoard,
      (c) => {
        const builder = line(c);
        const a = desk(builder, c, c.stream);
        const b = desk(builder, c, c.stream);
        const want = run(a, c.ops);
        sameRun('two boards from one seed', want, run(b, c.ops), 0, c.ops);
        expect(saveText(b.board)).toBe(saveText(a.board));
        if (a.board.contracts.length > 1) offered++;
      },
      { shrink: shrinkBoard },
    );
    // the runs are worth comparing: most boards draw more than one offer
    expect(offered).toBeGreaterThan(SEEDS.length / 2);
  });

  it('carries on the same after a save taken after any op', () => {
    let resumed = 0;
    forAll(
      genBoard,
      (c) => {
        const builder = line(c);
        const head = c.ops.slice(0, c.saveAt);
        const tail = c.ops.slice(c.saveAt);
        const a = desk(builder, c, c.stream);
        run(a, head);
        const save = JSON.stringify(a.board.toJSON());

        // loaded into a board on another stream, the clock and purse carried over by the game
        const b = desk(builder, c, (c.stream ^ 0x5a5a5a5a) >>> 0);
        b.board.load(JSON.parse(save) as ReturnType<ContractBoard['toJSON']>);
        Object.assign(b, { now: a.now });
        Object.assign(b.economy, {
          money: a.economy.money,
          tickets: a.economy.tickets,
          earned: a.economy.earned,
        });
        // a twin of a that reloads its own save in place
        const twin = desk(builder, c, c.stream);
        run(twin, head);
        twin.board.load(
          JSON.parse(JSON.stringify(twin.board.toJSON())) as ReturnType<ContractBoard['toJSON']>,
        );

        const want = run(a, tail);
        sameRun('loaded on another stream', want, run(b, tail), c.saveAt, tail);
        sameRun('reloaded in place', want, run(twin, tail), c.saveAt, tail);
        expect(saveText(b.board)).toBe(saveText(a.board));
        expect(saveText(twin.board)).toBe(saveText(a.board));
        if (a.board.contracts.length > 0 && tail.some((op) => op.k === 'offer')) resumed++;
      },
      { shrink: shrinkBoard },
    );
    expect(resumed).toBeGreaterThan(SEEDS.length / 4);
  });

  it('keeps its own stream when a save has no number for it', () => {
    const junk: ((rng: Rng) => unknown)[] = [
      () => undefined,
      () => null,
      (rng) => String(rng.int(0, 1000)),
      () => true,
      (rng) => [rng.int(0, 1000)],
      (rng) => ({ state: rng.int(0, 1000) }),
    ];
    forAll(
      (rng) => ({ c: genBoard(rng), stream: rng.int(0, 0xffffffff), rng: rng.pick(junk)(rng) }),
      ({ c, stream, rng }) => {
        const builder = line(c);
        const a = desk(builder, c, c.stream);
        run(a, c.ops);
        const old = JSON.parse(JSON.stringify(a.board.toJSON())) as Record<string, unknown>;
        if (rng === undefined) delete old.rng;
        else old.rng = rng;
        const b = desk(builder, c, stream);
        b.board.load(old as ReturnType<ContractBoard['toJSON']>);
        expect(b.board.toJSON().rng).toBe(new Rng(stream).state);
        // everything else the save holds is back
        const { rng: _a, ...want } = a.board.toJSON();
        const { rng: _b, ...got } = b.board.toJSON();
        void _a;
        void _b;
        expect(JSON.parse(JSON.stringify(got))).toEqual(JSON.parse(JSON.stringify(want)));
      },
      { shrink: ({ c, ...rest }) => [...shrinkBoard(c)].map((s) => ({ c: s, ...rest })) },
    );
  });
});
