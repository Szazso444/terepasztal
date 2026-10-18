import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TrackGraph } from '../world/track';
import { Dir } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { content, type LocoDef } from '../data/content';
import { Train } from './trains';
import { rules, DEFAULT_RULES } from './rules';
import { forAll, shrinkInt } from '../testing/property';
import {
  BRIDGE_SLOW_FACTOR,
  BRIDGE_SLOW_SHARE,
  bridgeSpan,
  roadDeckAxis,
  slowsOnBridge,
} from './bridges';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { Builder } from './build';
import { Economy } from './economy';
import { Stockpile } from './stockpile';

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

// ------------------------------------------------------------------ road platforms (#493)

const SIDE = 12;
/** A water map with no rules in the way, and a builder on it. */
function deckWorld() {
  const map = emptyMap(5, SIDE, SIDE, Terrain.Water);
  const track = new TrackGraph(SIDE, SIDE);
  const builder = new Builder(map, new RegionState(map), track, new Economy(), new Stockpile());
  builder.free = true;
  return { map, track, builder };
}
/** Stand a platform of `id` on (x, y), asking no rule. */
function deck(builder: Builder, x: number, y: number, id = 'bridge_wood') {
  const b = { id, x, y, acc: 0, active: false, rate: 0, rot: 0 };
  builder.buildings.set(y * SIDE + x, b);
  return b;
}

describe('the span of road platforms', () => {
  it('joins a run of road platforms of one material along the road, each at its place', () => {
    for (const axis of [0, 1] as const) {
      const { builder } = deckWorld();
      const at = (i: number) => (axis ? { x: 2 + i, y: 5 } : { x: 5, y: 2 + i });
      const decks = [0, 1, 2, 3].map((i) => deck(builder, at(i).x, at(i).y));
      for (let i = -1; i <= 4; i++) builder.roads.add(at(i).x, at(i).y);
      decks.forEach((b, i) =>
        expect(bridgeSpan(builder, b), `${axis} ${i}`).toEqual({
          material: 'wood',
          axis,
          index: i,
          length: 4,
        }),
      );
    }
  });

  it('parts at a change of material, at a platform with rail, and at one with no road', () => {
    const { builder } = deckWorld();
    const ids = ['bridge_wood', 'bridge_wood', 'bridge_stone', 'bridge_stone', 'bridge_wood'];
    const decks = ids.map((id, i) => deck(builder, 1 + i, 5, id));
    for (let x = 0; x <= 6; x++) builder.roads.add(x, 5);
    expect(decks.map((b) => bridgeSpan(builder, b).length)).toEqual([2, 2, 2, 2, 1]);
    expect(decks.map((b) => bridgeSpan(builder, b).index)).toEqual([0, 1, 0, 1, 0]);
    // beside a platform carrying rail: the road platform is a span of one, and the rail
    // platforms make their span by the rail as before
    const other = deckWorld().builder;
    const row = [1, 2, 3].map((x) => deck(other, x, 5));
    other.roads.add(0, 5);
    other.roads.add(1, 5);
    other.track.place(2, 5, 'straight', 1);
    other.track.place(3, 5, 'straight', 1);
    expect(bridgeSpan(other, row[0])).toEqual({ material: 'wood', axis: 1, index: 0, length: 1 });
    expect(bridgeSpan(other, row[1])).toEqual({ material: 'wood', axis: 1, index: 0, length: 2 });
    expect(bridgeSpan(other, row[2])).toEqual({ material: 'wood', axis: 1, index: 1, length: 2 });
    // a platform with neither rail nor a road is a span of one
    const bare = deck(other, 8, 8);
    expect(bridgeSpan(other, bare)).toEqual({ material: 'wood', axis: 0, index: 0, length: 1 });
  });

  it('reads its axis from the road: both sides first, then one, north to south on a tie', () => {
    const { builder } = deckWorld();
    deck(builder, 5, 5);
    builder.roads.add(5, 5);
    expect(roadDeckAxis(builder, 5, 5)).toBe(0);
    builder.roads.add(6, 5);
    expect(roadDeckAxis(builder, 5, 5)).toBe(1);
    builder.roads.add(5, 4);
    expect(roadDeckAxis(builder, 5, 5)).toBe(0);
    // a bare platform counts as the road running on; a platform with rail does not
    deck(builder, 4, 5);
    expect(roadDeckAxis(builder, 5, 5)).toBe(1);
    builder.track.place(4, 5, 'straight', 1);
    expect(roadDeckAxis(builder, 5, 5)).toBe(0);
    builder.roads.add(5, 6);
    expect(roadDeckAxis(builder, 5, 5)).toBe(0);
  });

  it('is the same span from each of its platforms, in any layout', () => {
    const IDS = ['bridge_wood', 'bridge_stone'];
    // runs of platforms down or across the map, most of them with a road, some with rail, and
    // roads anywhere besides
    const draw = (rng: Rng) => ({
      decks: Array.from({ length: rng.int(0, 8) }, () => {
        const x = rng.int(0, SIDE - 1),
          y = rng.int(0, SIDE - 1),
          across = rng.chance(0.5);
        return Array.from({ length: rng.int(1, 5) }, (_, i) => ({
          x: across ? x + i : x,
          y: across ? y : y + i,
          id: rng.pick(IDS),
          road: rng.chance(0.8),
          rail: rng.chance(0.1),
        })).filter((d) => d.x < SIDE && d.y < SIDE);
      }).flat(),
      roads: Array.from({ length: rng.int(0, 30) }, () => ({
        x: rng.int(0, SIDE - 1),
        y: rng.int(0, SIDE - 1),
      })),
    });
    let joined = 0;
    forAll(draw, (c) => {
      const { builder } = deckWorld();
      for (const d of c.decks) {
        deck(builder, d.x, d.y, d.id);
        if (d.rail && !builder.track.has(d.x, d.y)) builder.track.place(d.x, d.y, 'straight', 0);
        if (d.road) builder.roads.add(d.x, d.y);
      }
      for (const r of c.roads) builder.roads.add(r.x, r.y);
      for (const b of builder.buildings.values()) {
        if (builder.track.has(b.x, b.y) || !builder.roads.has(b.x, b.y)) continue;
        const s = bridgeSpan(builder, b);
        const dx = s.axis ? 1 : 0,
          dy = s.axis ? 0 : 1;
        if (s.length > 1) joined++;
        for (let i = 0; i < s.length; i++) {
          const x = b.x + (i - s.index) * dx,
            y = b.y + (i - s.index) * dy;
          const m = builder.bridgeAt(x, y);
          expect(m, `${x},${y}`).toBeTruthy();
          expect(!builder.track.has(x, y) && builder.roads.has(x, y), `${x},${y}`).toBe(true);
          expect(bridgeSpan(builder, m!), `${x},${y} from ${b.x},${b.y}`).toEqual({
            ...s,
            index: i,
          });
        }
        // and the span ends where it says: the next tile along either end is no member of it
        for (const [x, y] of [
          [b.x - (s.index + 1) * dx, b.y - (s.index + 1) * dy],
          [b.x + (s.length - s.index) * dx, b.y + (s.length - s.index) * dy],
        ]) {
          const n = builder.bridgeAt(x, y);
          if (n && !builder.track.has(x, y) && builder.roads.has(x, y)) {
            const t = bridgeSpan(builder, n);
            expect(t.material === s.material && t.axis === s.axis, `${x},${y}`).toBe(false);
          }
        }
      }
    });
    expect(joined, 'spans of more than one platform').toBeGreaterThan(20);
  });
});
