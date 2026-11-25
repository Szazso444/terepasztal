import { describe, it, expect, beforeEach } from 'vitest';
import {
  MAX_PHASES,
  PhaseCounter,
  WHEEL_CYCLE_TILES,
  WheelRolls,
  phaseIndex,
  phaseKey,
} from './runningGear';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
import type { Rng } from '../engine/rng';
import { SIM_STEP } from '../sim/time';
import { consistPhysics } from '../sim/trains';
import { rules, DEFAULT_RULES } from '../sim/rules';
import { LOCOS, LEVEL_CAP, type LocoDef } from '../gacha/items';

const STILL = 'rolling/loco_rocket_body_f6';

/** An atlas stub holding `keys`, recording every key it is asked about. */
function stub(keys: Iterable<string> | 'all') {
  const asked: string[] = [];
  const set = keys === 'all' ? null : new Set(keys);
  return {
    asked,
    atlas: {
      has(key: string) {
        asked.push(key);
        return set === null || set.has(key);
      },
    },
  };
}

describe('phaseKey', () => {
  it('is the still key for phase 0 and `_w<k>` after it', () => {
    expect(phaseKey(STILL, 0)).toBe(STILL);
    expect(phaseKey(STILL, 1)).toBe(`${STILL}_w1`);
    expect(phaseKey(STILL, 11)).toBe(`${STILL}_w11`);
  });
});

describe('PhaseCounter', () => {
  it('counts the still frame and its consecutive phases', () => {
    const { atlas } = stub([STILL, `${STILL}_w1`, `${STILL}_w2`, `${STILL}_w4`]);
    // the gap at _w3 ends the run: _w4 is not a phase
    expect(new PhaseCounter(atlas).count(STILL)).toBe(3);
  });

  it('gives 1 to a still frame without _w1', () => {
    const { atlas } = stub([STILL, `${STILL}_w2`]);
    expect(new PhaseCounter(atlas).count(STILL)).toBe(1);
  });

  it('stops at MAX_PHASES when the atlas answers yes to everything', () => {
    const { atlas, asked } = stub('all');
    expect(new PhaseCounter(atlas).count(STILL)).toBe(MAX_PHASES);
    expect(MAX_PHASES).toBe(16);
    expect(asked.length).toBe(MAX_PHASES - 1);
  });

  it('asks the atlas about a key once', () => {
    const { atlas, asked } = stub([STILL, `${STILL}_w1`]);
    const counter = new PhaseCounter(atlas);
    expect(counter.count(STILL)).toBe(2);
    const probes = asked.length;
    for (let i = 0; i < 5; i++) expect(counter.count(STILL)).toBe(2);
    expect(asked.length).toBe(probes);
  });

  it('keeps each counter to its own atlas', () => {
    const a = new PhaseCounter(stub('all').atlas),
      b = new PhaseCounter(stub([STILL]).atlas);
    expect(a.count(STILL)).toBe(MAX_PHASES);
    expect(b.count(STILL)).toBe(1);
  });
});

describe('phaseIndex', () => {
  it('steps through every phase in order over one cycle, then wraps', () => {
    for (const n of [2, 3, 8, 16]) {
      const step = WHEEL_CYCLE_TILES / n;
      for (let k = 0; k < 3 * n; k++)
        // the middle of each phase's stretch of travel
        expect(phaseIndex((k + 0.5) * step, n), `n ${n}, step ${k}`).toBe(k % n);
    }
  });

  it('steps backwards for travel the other way', () => {
    const n = 8,
      step = WHEEL_CYCLE_TILES / n;
    for (let k = 1; k <= 2 * n; k++)
      expect(phaseIndex(-(k - 0.5) * step, n)).toBe(((-k % n) + n) % n);
  });

  it('gives the same phase for the same distance', () => {
    for (const roll of [0, 0.123, 7.77, -3.21])
      expect(phaseIndex(roll, 8)).toBe(phaseIndex(roll, 8));
  });

  it('stays in range for any distance', () => {
    const rolls = [-1e9, -0.01, -0, 1e15, 1e300, Number.MAX_VALUE, -Number.MAX_VALUE, NaN];
    for (const n of [1, 2, 7, 16])
      for (const roll of [...rolls, Infinity, -Infinity]) {
        const i = phaseIndex(roll, n);
        expect(Number.isInteger(i) && i >= 0 && i < n, `roll ${roll}, n ${n}: ${i}`).toBe(true);
        expect(Object.is(i, -0)).toBe(false);
      }
    expect(phaseIndex(NaN, 8)).toBe(0);
    expect(phaseIndex(Infinity, 8)).toBe(0);
  });

  it('is always 0 with one phase', () => {
    for (const roll of [0, 0.3, 1, -2.5, 1e9]) expect(phaseIndex(roll, 1)).toBe(0);
  });
});

describe('WheelRolls', () => {
  it('starts a train at 0 and adds the distance it runs', () => {
    const r = new WheelRolls();
    expect(r.advance(1, 40, false)).toBe(0);
    expect(r.advance(1, 40.25, false)).toBeCloseTo(0.25, 12);
    expect(r.advance(1, 41, false)).toBeCloseTo(1, 12);
  });

  it('counts down while the train runs tail first', () => {
    const r = new WheelRolls();
    r.advance(1, 10, true);
    expect(r.advance(1, 10.5, true)).toBeCloseTo(-0.5, 12);
    expect(r.advance(1, 11, false)).toBeCloseTo(0, 12);
  });

  it('keeps the roll of a train at rest, also when it turns round', () => {
    const r = new WheelRolls();
    r.advance(1, 3, false);
    const roll = r.advance(1, 3.3, false);
    expect(r.advance(1, 3.3, false)).toBe(roll);
    expect(r.advance(1, 3.3, true)).toBe(roll);
    expect(r.advance(1, 3.3, false)).toBe(roll);
  });

  it('does not turn when the distance goes down, and measures from the new value', () => {
    const r = new WheelRolls();
    r.advance(1, 50, false);
    const roll = r.advance(1, 50.2, false)!;
    expect(r.advance(1, 2, false)).toBe(roll);
    expect(r.advance(1, 2.1, false)).toBeCloseTo(roll + 0.1, 12);
  });

  it('has no roll for a missing or non-finite distance', () => {
    const r = new WheelRolls();
    r.advance(1, 5, false);
    r.advance(1, 5.4, false);
    for (const d of [undefined, NaN, Infinity, -Infinity]) {
      expect(r.advance(1, d, false)).toBeUndefined();
      expect(r.has(1)).toBe(false);
    }
    // the next finite distance is a first sight
    expect(r.advance(1, 9, false)).toBe(0);
  });

  it('forgets a dropped train', () => {
    const r = new WheelRolls();
    r.advance(1, 0, false);
    r.advance(2, 0, false);
    r.advance(1, 0.4, false);
    r.drop(1);
    expect(r.has(1)).toBe(false);
    expect(r.has(2)).toBe(true);
    expect(r.advance(1, 0.9, false)).toBe(0);
  });
});

// ------------------------------------------------------------------ properties

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** A roll inside the m-th stretch of WHEEL_CYCLE_TILES / n, at share u of it. */
interface StretchCase {
  n: number;
  m: number;
  u: number;
}

function* shrinkStretch(c: StretchCase): Iterable<StretchCase> {
  for (const m of shrinkInt(c.m)) yield { ...c, m };
  for (const n of shrinkInt(c.n, 1)) yield { ...c, n };
  if (c.u !== 0.5) yield { ...c, u: 0.5 };
}

/** A double from 64 random bits: subnormals, huge values, infinities and NaNs all turn up. */
function anyDouble(rng: Rng): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setUint32(0, Math.floor(rng.next() * 2 ** 32));
  view.setUint32(4, Math.floor(rng.next() * 2 ** 32));
  return view.getFloat64(0);
}

describe('phaseIndex properties', () => {
  it('shows phase m mod n inside the m-th stretch of a cycle, either sign, and a cycle on', () => {
    forAll(
      (rng): StretchCase => ({
        n: rng.int(1, MAX_PHASES),
        // near the origin, where a train starts, and far out, where a long game ends up
        m: rng.chance(0.5) ? rng.int(-64, 64) : rng.int(-(2 ** 40), 2 ** 40),
        // clear of the stretch's ends, so rounding cannot move the roll across one
        u: rng.range(0.05, 0.95),
      }),
      ({ n, m, u }) => {
        const roll = ((m + u) * WHEEL_CYCLE_TILES) / n;
        expect(phaseIndex(roll, n), `roll ${roll}`).toBe(mod(m, n));
        expect(phaseIndex(roll + WHEEL_CYCLE_TILES, n), 'a cycle on').toBe(mod(m, n));
        expect(phaseIndex(roll - WHEEL_CYCLE_TILES, n), 'a cycle back').toBe(mod(m, n));
      },
      { shrink: shrinkStretch },
    );
  });

  it('moves at most one phase per short step, the way of travel, and visits every phase', () => {
    forAll(
      (rng) => {
        const n = rng.int(2, MAX_PHASES);
        return {
          n,
          start: rng.range(-10, 10),
          dir: rng.pick([1, -1]),
          // 3n steps of a third to a whole phase's stretch: more than one full cycle
          steps: Array.from({ length: 3 * n }, () => rng.range(0.34, 0.999)),
        };
      },
      ({ n, start, dir, steps }) => {
        let roll = start,
          was = phaseIndex(roll, n);
        const seen = new Set([was]);
        for (const s of steps) {
          roll += (dir * s * WHEEL_CYCLE_TILES) / n;
          const now = phaseIndex(roll, n);
          // forwards the same phase or the next; backwards the same or the one before
          expect([0, mod(dir, n)], `roll ${roll}: ${was} -> ${now}`).toContain(mod(now - was, n));
          seen.add(now);
          was = now;
        }
        expect(seen.size).toBe(n);
      },
    );
  });

  it('gives an integer phase in 0..n-1, never -0, for any double, and the same one again', () => {
    forAll(
      (rng) => ({
        n: rng.int(1, MAX_PHASES),
        roll: rng.chance(0.2)
          ? rng.pick([NaN, Infinity, -Infinity, -0, Number.MAX_VALUE, -Number.MIN_VALUE])
          : anyDouble(rng),
      }),
      ({ n, roll }) => {
        const i = phaseIndex(roll, n);
        expect(Number.isInteger(i) && i >= 0 && i < n, `phase ${i}`).toBe(true);
        expect(Object.is(i, -0), 'phase -0').toBe(false);
        expect(phaseIndex(roll, n)).toBe(i);
        if (n === 1 || !Number.isFinite(roll)) expect(i).toBe(0);
      },
    );
  });
});

/** Still keys, each with a run of `_w` frames from 1 and stray ones past a gap; queries of them. */
interface AtlasCase {
  runs: number[];
  strays: number[][];
  /** [counter 0 or 1, key index] */
  queries: [number, number][];
}

function atlasOf(runs: number[], strays: number[][]) {
  const keys = runs.map((_, i) => `rolling/loco_k${i}_body_f${i}`);
  const held = new Set<string>();
  runs.forEach((r, i) => {
    held.add(keys[i]);
    for (let k = 1; k <= r; k++) held.add(phaseKey(keys[i], k));
    for (const k of strays[i]) held.add(phaseKey(keys[i], r + 1 + k));
  });
  const asked: string[] = [];
  const atlas = {
    has(key: string) {
      asked.push(key);
      return held.has(key);
    },
  };
  return { keys, asked, atlas };
}

describe('PhaseCounter properties', () => {
  it('counts 1 + the run of _w frames up to MAX_PHASES, probing each name once, per counter', () => {
    forAll(
      (rng): AtlasCase => {
        const keys = rng.int(1, 5);
        return {
          runs: Array.from({ length: keys }, () => rng.int(0, MAX_PHASES + 4)),
          strays: Array.from({ length: keys }, () =>
            Array.from({ length: rng.int(0, 3) }, () => rng.int(1, 6)),
          ),
          queries: Array.from({ length: rng.int(1, 30) }, () => [
            rng.int(0, 1),
            rng.int(0, keys - 1),
          ]),
        };
      },
      ({ runs, strays, queries }) => {
        // two counters over two atlases with the same keys and different runs
        const runsOf = [runs, [...runs].reverse()];
        const atlases = runsOf.map((r) => atlasOf(r, strays));
        const counters = atlases.map((a) => new PhaseCounter(a.atlas));
        for (const [c, i] of queries)
          expect(counters[c].count(atlases[c].keys[i]), `counter ${c}, key ${i}`).toBe(
            Math.min(MAX_PHASES, 1 + runsOf[c][i]),
          );
        for (const [c, a] of atlases.entries()) {
          const queried = new Set(queries.filter(([q]) => q === c).map(([, i]) => a.keys[i]));
          // each name once, only _w names of keys asked about, at most MAX_PHASES - 1 a key
          expect(new Set(a.asked).size, `counter ${c} asked a name twice`).toBe(a.asked.length);
          for (const key of a.keys) {
            const probes = a.asked.filter((k) => k.startsWith(`${key}_w`)).length;
            expect(probes, `counter ${c}, ${key}`).toBeLessThanOrEqual(
              queried.has(key) ? MAX_PHASES - 1 : 0,
            );
          }
          const own = (k: string) => [...queried].some((key) => k.startsWith(`${key}_w`));
          expect(
            a.asked.filter((k) => !own(k)),
            `counter ${c}: stray probes`,
          ).toEqual([]);
          // remembered: asking again probes nothing
          const before = a.asked.length;
          for (const key of queried) counters[c].count(key);
          expect(a.asked.length, `counter ${c} probed again`).toBe(before);
        }
      },
      {
        shrink: function* (c) {
          for (const queries of shrinkArray(c.queries)) if (queries.length) yield { ...c, queries };
          for (let i = 0; i < c.runs.length; i++)
            for (const r of shrinkInt(c.runs[i]))
              yield { ...c, runs: c.runs.map((x, k) => (k === i ? r : x)) };
        },
      },
    );
  });
});

/** One reading a renderer frame feeds WheelRolls, or a drop. */
type RollOp =
  { id: number; drop: true } | { id: number; distance: number | undefined; reversed: boolean };

describe('WheelRolls properties', () => {
  it("a train's roll is its rises since its last first sight, signed by its direction then", () => {
    forAll(
      (rng) => {
        // distances in 64ths of a tile, so every sum is exact and the oracle can ask for equality
        const at = new Map<number, number>(),
          rev = new Map<number, boolean>();
        return Array.from({ length: rng.int(1, 60) }, (): RollOp => {
          const id = rng.int(1, 3);
          if (rng.chance(0.05)) return { id, drop: true };
          if (rng.chance(0.3)) rev.set(id, !rev.get(id));
          const reversed = !!rev.get(id);
          const kind = rng.next();
          if (kind < 0.06)
            return { id, distance: rng.pick([undefined, NaN, Infinity, -Infinity]), reversed };
          let d = at.get(id) ?? rng.int(0, 64 * 500) / 64;
          // a fall (a load or a re-placement), else a run of 0 to 12/64 tiles
          if (kind < 0.14) d = rng.int(0, Math.floor(d * 64)) / 64;
          else d += rng.int(0, 12) / 64;
          at.set(id, d);
          return { id, distance: d, reversed };
        });
      },
      (ops) => {
        const rolls = new WheelRolls();
        // the oracle: each train's finite readings since its last drop or non-finite reading
        const since = new Map<number, { d: number; reversed: boolean }[]>();
        for (const [step, op] of ops.entries()) {
          const where = `op ${step}, train ${op.id}`;
          if ('drop' in op) {
            rolls.drop(op.id);
            since.delete(op.id);
          } else if (typeof op.distance !== 'number' || !Number.isFinite(op.distance)) {
            expect(rolls.advance(op.id, op.distance, op.reversed), where).toBeUndefined();
            since.delete(op.id);
          } else {
            const list = since.get(op.id) ?? [];
            list.push({ d: op.distance, reversed: op.reversed });
            since.set(op.id, list);
            let want = 0;
            for (let k = 1; k < list.length; k++) {
              const rise = list[k].d - list[k - 1].d;
              if (rise > 0) want += list[k].reversed ? -rise : rise;
            }
            expect(rolls.advance(op.id, op.distance, op.reversed), where).toBe(want);
          }
          for (const id of [1, 2, 3])
            expect(rolls.has(id), `${where}: has ${id}`).toBe(since.has(id));
        }
      },
      { shrink: (ops) => shrinkArray(ops) },
    );
  });
});

describe('WHEEL_CYCLE_TILES basis', () => {
  beforeEach(() => {
    Object.assign(rules, DEFAULT_RULES);
  });

  /** Top speed, tiles a game second, of a locomotive running alone at item level `level`. */
  const topSpeed = (def: LocoDef, level: number) =>
    consistPhysics([{ def, level, mode: 'leading', engaged: true }], []).vMax;

  it('no locomotive at any item level runs half a wheel turn in one sim step at 1x', () => {
    // the phase moves once a sim step, and half a turn or more reads as turning backwards
    expect(LOCOS.length).toBeGreaterThan(0);
    for (const def of LOCOS)
      for (let level = 1; level <= LEVEL_CAP; level++)
        expect(topSpeed(def, level) * SIM_STEP, `${def.id} at level ${level}`).toBeLessThan(
          WHEEL_CYCLE_TILES / 2,
        );
  });

  it('no locomotive at level 1 runs over a tenth of a turn a frame at 60 fps', () => {
    // so up to 10 phases change at most once per rendered frame, the constant's stated basis
    for (const def of LOCOS)
      expect(topSpeed(def, 1) * 10, def.id).toBeLessThanOrEqual(60 * WHEEL_CYCLE_TILES);
  });
});
