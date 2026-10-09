import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TrackGraph } from '../world/track';
import { Dir } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { content, type LocoDef } from '../data/content';
import { Train } from './trains';
import { rules, DEFAULT_RULES } from './rules';
import { forAll, shrinkInt } from '../testing/property';
import { BRIDGE_SLOW_FACTOR, BRIDGE_SLOW_SHARE, slowsOnBridge } from './bridges';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

// The bridge speed rule: a consist heavier than BRIDGE_SLOW_SHARE of a bridge's capacity crosses
// at BRIDGE_SLOW_FACTOR while any tile under it is a bridge, and at full speed otherwise. Checked
// for every locomotive in the content, so for every mass a single unit can have.

const W = 48;
const ROW = 10;
const LOCOS = content.locomotives;

/** `loco` alone, standing on a straight east-west line with its consist trailing west of x = 30. */
function standing(loco: LocoDef) {
  const track = new TrackGraph(W, W);
  for (let x = 2; x < W - 2; x++) track.place(x, ROW, 'straight', 1);
  const train = new Train([{ uid: 1, level: 0, def: loco }]);
  expect(train.spawnAt(track, 30, ROW, Dir.W)).toBe(true);
  const under = train.occupancyKeys(W);
  expect(under.length).toBeGreaterThan(0);
  return { track, train, under };
}

/** Puts a bridge of `capacity` tonnes on the track tile with key `k`. */
function bridgeAt(track: TrackGraph, k: number, capacity: number) {
  const piece = track.get(k % W, Math.floor(k / W));
  expect(piece).toBeTruthy();
  piece!.bridgeCapacity = capacity;
}

/** The capacity for which `mass` is `capacity * BRIDGE_SLOW_SHARE * ratio`. */
const capacityFor = (mass: number, ratio: number) => mass / (BRIDGE_SLOW_SHARE * ratio);

beforeEach(() => Object.assign(rules, DEFAULT_RULES));

describe('bridge speed threshold', () => {
  it.each(LOCOS.map((l) => [l.id, l] as const))(
    '%s crosses at the slow factor just above the threshold',
    (_, loco) => {
      const { track, train, under } = standing(loco);
      bridgeAt(track, under[0], capacityFor(train.mass, 1 + 1e-6));
      expect(train.bridgeSpeed(track)).toBe(BRIDGE_SLOW_FACTOR);
    },
  );

  it.each(LOCOS.map((l) => [l.id, l] as const))(
    '%s keeps full speed just below the threshold',
    (_, loco) => {
      const { track, train, under } = standing(loco);
      bridgeAt(track, under[0], capacityFor(train.mass, 1 - 1e-6));
      expect(train.bridgeSpeed(track)).toBe(1);
    },
  );

  it('slows a consist once, however many of the tiles under it are bridge', () => {
    for (const loco of LOCOS) {
      const { track, train, under } = standing(loco);
      for (const k of under) bridgeAt(track, k, capacityFor(train.mass, 1 + 1e-6));
      expect(train.bridgeSpeed(track), loco.id).toBe(BRIDGE_SLOW_FACTOR);
    }
  });

  it('slows exactly when slowsOnBridge holds for a bridge under the consist', () => {
    // margin: the consist weighs (1 + margin / 1000) of the threshold; never 0, never -1000
    const draw = (rng: Rng) => ({
      loco: rng.int(0, LOCOS.length - 1),
      margin: rng.int(1, 999) * (rng.chance(0.5) ? 1 : -1),
      under: rng.chance(0.5),
      at: rng.int(0, 1000),
    });
    type Case = ReturnType<typeof draw>;
    function* shrink(c: Case): Iterable<Case> {
      for (const loco of shrinkInt(c.loco)) yield { ...c, loco };
      const sign = Math.sign(c.margin);
      for (const m of shrinkInt(Math.abs(c.margin), 1)) yield { ...c, margin: sign * m };
    }
    forAll(
      draw,
      (c) => {
        const { track, train, under } = standing(LOCOS[c.loco]);
        const away: number[] = [];
        for (let x = 2; x < W - 2; x++) if (!under.includes(ROW * W + x)) away.push(ROW * W + x);
        const tiles = c.under ? under : away;
        const k = tiles[c.at % tiles.length];
        const capacity = capacityFor(train.mass, 1 + c.margin / 1000);
        bridgeAt(track, k, capacity);
        expect(slowsOnBridge(train.mass, capacity)).toBe(c.margin > 0);
        const slowed = c.under && c.margin > 0;
        expect(train.bridgeSpeed(track)).toBe(slowed ? BRIDGE_SLOW_FACTOR : 1);
      },
      { shrink },
    );
  });
});
