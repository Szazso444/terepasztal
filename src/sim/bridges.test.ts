import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TrackGraph, type TrackClass } from '../world/track';
import { Dir, opposite } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { content, type LocoDef } from '../data/content';
import { Train } from './trains';
import { rules, DEFAULT_RULES } from './rules';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
import { buildingDef } from './buildings';
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

// ------------------------------------------------------------------ rail platforms beside roads

/** One platform of a seeded layout, with what stands on it. */
interface RailDeck {
  x: number;
  y: number;
  id: string;
  /**
   * a straight of `cls` turned `rot` (0 north to south, 1 east to west), a narrow curve or switch
   * at any turn, or none
   */
  rail: { kind: 'straight' | 'curve' | 'switch'; rot: number; cls: TrackClass } | null;
  road: boolean;
}
interface RailCase {
  decks: RailDeck[];
  roads: { x: number; y: number }[];
}
/** Runs of platforms, most with a straight along the run, of one material or two; roads anywhere. */
function drawRails(rng: Rng): RailCase {
  const IDS = ['bridge_wood', 'bridge_stone'];
  const CLASSES: TrackClass[] = ['branch', 'branch', 'narrow', 'branch'];
  const decks = Array.from({ length: rng.int(1, 7) }, () => {
    const x = rng.int(0, SIDE - 1),
      y = rng.int(0, SIDE - 1),
      rot = rng.int(0, 1),
      id = rng.pick(IDS),
      mixed = rng.chance(0.3);
    return Array.from({ length: rng.int(1, 6) }, (_, i): RailDeck => {
      const r = rng.next();
      const rail: RailDeck['rail'] =
        r < 0.7
          ? { kind: 'straight', rot, cls: rng.pick(CLASSES) }
          : r < 0.8
            ? { kind: 'straight', rot: 1 - rot, cls: 'branch' }
            : r < 0.88
              ? { kind: rng.pick(['curve', 'switch'] as const), rot: rng.int(0, 7), cls: 'narrow' }
              : null;
      return {
        x: rot ? x + i : x,
        y: rot ? y : y + i,
        id: mixed ? rng.pick(IDS) : id,
        rail,
        road: !rail && rng.chance(0.6),
      };
    }).filter((d) => d.x < SIDE && d.y < SIDE);
  }).flat();
  const roads = Array.from({ length: rng.int(0, 40) }, () => ({
    x: rng.int(0, SIDE - 1),
    y: rng.int(0, SIDE - 1),
  }));
  return { decks, roads };
}
/** The layout of `c` on a fresh water map, with its roads unless `roads` is false. */
function layRails(c: RailCase, roads = true) {
  const w = deckWorld();
  for (const d of c.decks) {
    if (w.builder.buildingAt(d.x, d.y)) continue;
    deck(w.builder, d.x, d.y, d.id);
    if (d.rail) w.track.place(d.x, d.y, d.rail.kind, d.rail.rot, d.rail.cls);
    else if (d.road && roads) w.builder.roads.add(d.x, d.y);
  }
  // roads beside and around the rail, never on it: the build rules keep a road off a railed deck
  if (roads) for (const r of c.roads) if (!w.track.has(r.x, r.y)) w.builder.roads.add(r.x, r.y);
  return w;
}

describe('the span of rail platforms, with roads beside them (#493)', () => {
  it('is the run of joined straights along its axis on one material, and no road moves it', () => {
    const seen = { joined: 0, besideRoad: 0, partedByMaterial: 0, partedUnjoined: 0 };
    forAll(
      drawRails,
      (c) => {
        const w = layRails(c);
        const bare = layRails(c, false);
        const { builder, track } = w;
        const material = (x: number, y: number) =>
          buildingDef(builder.bridgeAt(x, y)!.id).bridge!.material;
        // the piece on (x, y) has a straight link along `axis`
        const straightOn = (x: number, y: number, axis: number) =>
          !!track
            .get(x, y)
            ?.links.some(
              ([a, b]) =>
                opposite(a) === b &&
                (axis ? a === Dir.E || a === Dir.W : a === Dir.N || a === Dir.S),
            );
        for (const b of builder.buildings.values()) {
          if (!track.has(b.x, b.y)) continue;
          const at = `${b.x},${b.y}`;
          const s = bridgeSpan(builder, b);
          // no road changes a rail platform's span: it is the span with every road gone
          expect(s, `${at} with roads`).toEqual(
            bridgeSpan(bare.builder, bare.builder.bridgeAt(b.x, b.y)!),
          );
          if (
            [-1, 1].some((k) => builder.roads.has(b.x + k, b.y) || builder.roads.has(b.x, b.y + k))
          )
            seen.besideRoad++;
          if (s.length > 1) seen.joined++;
          expect(s.material, at).toBe(material(b.x, b.y));
          const dx = s.axis ? 1 : 0,
            dy = s.axis ? 0 : 1;
          const step = s.axis ? Dir.E : Dir.S;
          // every member is a platform of the span's material with rail along the axis, joined
          // to the next one, and gives the same span
          for (let i = 0; i < s.length; i++) {
            const x = b.x + (i - s.index) * dx,
              y = b.y + (i - s.index) * dy;
            const where = `${x},${y} in the span of ${at}`;
            const m = builder.bridgeAt(x, y);
            expect(m, where).toBeTruthy();
            expect(material(x, y), where).toBe(s.material);
            if (s.length > 1) expect(straightOn(x, y, s.axis), where).toBe(true);
            if (i + 1 < s.length) expect(track.connected(x, y, step), where).toBe(true);
            expect(bridgeSpan(builder, m!), where).toEqual({ ...s, index: i });
          }
          // and it ends where nothing more joins: past each end, no platform of its material
          // with a straight along the axis joined to the end
          if (!straightOn(b.x, b.y, s.axis)) continue;
          for (const k of [-1, 1]) {
            const ex = b.x + (k < 0 ? -s.index : s.length - 1 - s.index) * dx,
              ey = b.y + (k < 0 ? -s.index : s.length - 1 - s.index) * dy;
            const nx = ex + k * dx,
              ny = ey + k * dy;
            if (!builder.bridgeAt(nx, ny) || !straightOn(nx, ny, s.axis)) continue;
            const joined = track.connected(ex, ey, k > 0 ? step : opposite(step));
            const same = material(nx, ny) === s.material;
            if (joined && !same) seen.partedByMaterial++;
            if (same && !joined) seen.partedUnjoined++;
            expect(joined && same, `${nx},${ny} past the span of ${at}`).toBe(false);
          }
        }
      },
      { shrink: (c) => [...shrinkArray(c.decks)].map((decks) => ({ ...c, decks })) },
    );
    // the seeds reach long spans, rail beside roads, and spans parted by a change of material
    // and by a straight that does not join
    for (const [what, n] of Object.entries(seen)) expect(n, what).toBeGreaterThan(20);
  });
});
