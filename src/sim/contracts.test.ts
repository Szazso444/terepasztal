import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Rng } from '../engine/rng';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { resetStationIds } from './stations';
import { rules, DEFAULT_RULES } from './rules';
import { ContractBoard, type Contract } from './contracts';

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
});

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
