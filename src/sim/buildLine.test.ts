import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import {
  TrackGraph,
  TRACK_ITEMS,
  footprintOf,
  rotationCount,
  transitionRot,
  type TrackClass,
  type TrackItem,
} from '../world/track';
import { Dir } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { sfx } from '../engine/audio';
import type { Cost } from '../data/content';
import { Builder, type LinePiece } from './build';
import { BUILDING_DEFS } from './buildings';
import { bridgeCapacity } from './bridges';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { rules, DEFAULT_RULES } from './rules';
import { forAll, shrinkArray } from '../testing/property';
import { STR } from '../strings';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  vi.mocked(sfx).mockClear();
});

// A dragged line of track, or a bridge with its rail, is priced and laid as a whole: every piece
// or none, never over other track, and judged as if its earlier pieces stood already.

const RES = ['wood', 'stone', 'iron'];
const BRIDGES = BUILDING_DEFS.filter((d) => d.bridge).map((d) => d.id);

function world(size = 24) {
  const map = emptyMap(4242, size, size, Terrain.Grass),
    track = new TrackGraph(size, size),
    stock = new Stockpile(),
    economy = new Economy();
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  const builder = new Builder(map, regions, track, economy, stock);
  for (const k of RES) stock.amounts.set(k, 1000);
  const ground = (x: number, y: number, t: Terrain) => (map.terrain[y * size + x] = t);
  const held = () => RES.map((k) => stock.get(k));
  return { map, track, builder, stock, economy, ground, held };
}
type World = ReturnType<typeof world>;

const STRAIGHT: TrackItem = { kind: 'straight', cls: 'regular' };
/** A straight running east-west at (x, y). */
const ew = (x: number, y: number, cls: TrackClass = 'regular'): LinePiece => ({
  kind: 'track',
  x,
  y,
  item: { kind: 'straight', cls },
  rot: 1,
});
const platform = (x: number, y: number, defId = 'bridge_wood'): LinePiece => ({
  kind: 'platform',
  x,
  y,
  defId,
});
/** East-west straights from x0 to x1 on row y. */
const run = (x0: number, x1: number, y: number) =>
  Array.from({ length: x1 - x0 + 1 }, (_, i) => ew(x0 + i, y));
/** A bridge from x0 to x1 on row y: each tile's platform, then the straight on it. */
const bridge = (x0: number, x1: number, y: number, defId = 'bridge_wood') =>
  Array.from({ length: x1 - x0 + 1 }, (_, i) => [platform(x0 + i, y, defId), ew(x0 + i, y)]).flat();

/** Everything a line may change, copied, so a piece changed in place shows too. */
function snapshot(w: World) {
  return JSON.parse(
    JSON.stringify({
      track: [...w.track.pieces.entries()],
      version: w.track.version,
      buildings: [...w.builder.buildings.entries()],
      stock: w.held(),
      money: w.economy.money,
    }),
  ) as unknown;
}
const vec = (c: Cost) => RES.map((k) => c[k] ?? 0);
const spent = (before: number[], after: number[]) => before.map((v, i) => v - after[i]);
const times = (c: Cost, n: number) =>
  Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v * n]));

/** Lay one piece with the single-piece tools; true when it went down. */
function single(w: World, p: LinePiece) {
  return p.kind === 'track'
    ? w.builder.placeTrack(p.x, p.y, p.item, p.rot)
    : !!w.builder.placeBuilding(p.x, p.y, p.defId, 0);
}
/** The piece stands where the line asks for it. */
function stands(w: World, p: LinePiece) {
  if (p.kind === 'platform') return w.builder.buildingAt(p.x, p.y)?.id === p.defId;
  const q = w.track.get(p.x, p.y);
  const n = rotationCount(p.item.kind);
  return (
    !!q &&
    q.kind === p.item.kind &&
    q.cls === p.item.cls &&
    (((q.rot - p.rot) % n) + n) % n === 0 &&
    (!q.unit || (q.unit.ax === p.x && q.unit.ay === p.y))
  );
}

describe('a line of track', () => {
  it('lays every piece, charges the sum of their prices and plays one sound', () => {
    const w = world();
    w.ground(6, 5, Terrain.Forest);
    w.ground(7, 5, Terrain.Sand);
    const line = run(4, 9, 5);
    const sum: Cost = {};
    for (const p of line)
      for (const [k, v] of Object.entries(w.builder.checkTrack(p.x, p.y, STRAIGHT, 1).cost))
        sum[k] = (sum[k] ?? 0) + v;
    const c = w.builder.checkLine(line);
    expect(c.ok).toBe(true);
    expect(c.cost).toEqual(sum);
    expect(c.at).toBeUndefined();
    expect(c.steps).toHaveLength(line.length);
    const before = w.held();
    expect(w.builder.placeLine(line)).toBe(true);
    expect(spent(before, w.held())).toEqual(vec(sum));
    for (const p of line) expect(stands(w, p)).toBe(true);
    expect(sfx).toHaveBeenCalledTimes(1);
  });

  it('places nothing when one piece is blocked, and leaves money and stock as they were', () => {
    for (const [block, at, reason] of [
      [(w: World) => w.ground(7, 5, Terrain.Rock), 3, STR.build.rock],
      [(w: World) => w.ground(8, 5, Terrain.Water), 4, STR.build.needBridge],
      [(w: World) => w.builder.placeBuilding(5, 5, 'windmill'), 1, STR.build.occupied],
    ] as const) {
      const w = world();
      block(w);
      vi.mocked(sfx).mockClear();
      const line = run(4, 9, 5);
      const before = snapshot(w);
      const c = w.builder.checkLine(line);
      expect(c).toMatchObject({ ok: false, at, reason });
      expect(snapshot(w)).toEqual(before);
      expect(w.builder.placeLine(line)).toBe(false);
      expect(snapshot(w)).toEqual(before);
      expect(sfx).not.toHaveBeenCalled();
    }
  });

  it('refuses a line running off the map', () => {
    const w = world();
    const before = snapshot(w);
    expect(w.builder.checkLine(run(-1, 3, 5))).toMatchObject({
      ok: false,
      at: 0,
      reason: STR.build.offMap,
    });
    expect(w.builder.placeLine(run(-1, 3, 5))).toBe(false);
    expect(snapshot(w)).toEqual(before);
  });

  it('skips matching track at no cost and leaves it as it stands', () => {
    const w = world();
    expect(w.builder.placeTrack(6, 5, STRAIGHT, 1)).toBe(true);
    // a straight turned a half turn runs the same way: it matches too
    expect(w.builder.placeTrack(7, 5, STRAIGHT, 3)).toBe(true);
    const six = w.track.get(6, 5),
      seven = w.track.get(7, 5);
    const line = run(4, 9, 5);
    const one = w.builder.checkTrack(4, 5, STRAIGHT, 1).cost;
    const c = w.builder.checkLine(line);
    expect(c.ok).toBe(true);
    expect(c.steps.map((s) => !!s.skip)).toEqual([false, false, true, true, false, false]);
    expect(c.steps[2].cost).toEqual({});
    expect(c.cost).toEqual(times(one, 4));
    const before = w.held();
    expect(w.builder.placeLine(line)).toBe(true);
    expect(spent(before, w.held())).toEqual(vec(times(one, 4)));
    expect(w.track.get(6, 5)).toBe(six);
    expect(w.track.get(7, 5)).toBe(seven);
  });

  it('skips a piece the line itself laid earlier', () => {
    const w = world();
    const line = [...run(4, 6, 5), ew(5, 5)];
    const c = w.builder.checkLine(line);
    expect(c.ok).toBe(true);
    expect(c.steps[3].skip).toBe(true);
    expect(c.cost).toEqual(times(w.builder.checkTrack(4, 5, STRAIGHT, 1).cost, 3));
  });

  it('refuses a line over any other track and removes nothing', () => {
    const others: [TrackItem, number][] = [
      [STRAIGHT, 0],
      [{ kind: 'straight', cls: 'high_speed' }, 0],
      [{ kind: 'curve', cls: 'narrow' }, 0],
      [{ kind: 'crossing', cls: 'regular', cls2: 'regular' }, 0],
      [{ kind: 'transition', cls: 'regular' }, transitionRot(Dir.E)],
    ];
    for (const [item, rot] of others) {
      const w = world();
      expect(w.builder.placeTrack(7, 5, item, rot)).toBe(true);
      const there = w.track.get(7, 5);
      const before = snapshot(w);
      const line = run(4, 9, 5);
      expect(w.builder.checkLine(line), item.kind).toMatchObject({
        ok: false,
        at: 3,
        reason: STR.build.trackInWay,
      });
      expect(w.builder.placeLine(line)).toBe(false);
      expect(snapshot(w)).toEqual(before);
      expect(w.track.get(7, 5)).toBe(there);
      // the single-piece tool still lays a piece over another one-tile piece
      expect(w.builder.placeTrack(7, 5, STRAIGHT, 1)).toBe(true);
    }
  });

  it('refuses a line through a member of a wide piece', () => {
    const w = world();
    expect(w.builder.placeTrack(7, 4, { kind: 'curve', cls: 'regular' }, 0)).toBe(true);
    const line = run(4, 9, 5);
    const c = w.builder.checkLine(line);
    const hit = line.findIndex((p) => w.track.has(p.x, p.y));
    expect(hit).toBeGreaterThanOrEqual(0);
    expect(c).toMatchObject({ ok: false, at: hit, reason: STR.build.trackInWay });
  });

  it('places nothing when the total is more than the stock, though each piece alone is not', () => {
    const w = world();
    const one = w.builder.checkTrack(4, 5, STRAIGHT, 1).cost;
    for (const k of RES) w.stock.amounts.set(k, 3 * (one[k] ?? 0));
    const line = run(4, 8, 5);
    for (const p of line) expect(w.builder.checkTrack(p.x, p.y, STRAIGHT, 1).ok).toBe(true);
    const total = times(one, 5);
    const missing = Object.entries(w.stock.missing(total))
      .map(([k, v]) => `${v} ${k}`)
      .join(', ');
    const before = snapshot(w);
    const c = w.builder.checkLine(line);
    expect(c).toMatchObject({ ok: false, reason: STR.build.needResources(missing) });
    expect(c.cost).toEqual(total);
    expect(c.at).toBeUndefined();
    expect(w.builder.placeLine(line)).toBe(false);
    expect(snapshot(w)).toEqual(before);
    // with exactly the total in stock, the line goes down and leaves nothing
    for (const k of RES) w.stock.amounts.set(k, total[k] ?? 0);
    expect(w.builder.placeLine(line)).toBe(true);
    expect(w.held()).toEqual([0, 0, 0]);
  });

  it("judges each piece with the line's earlier pieces standing", () => {
    const w = world();
    const fast = ew(4, 5, 'high_speed');
    // alone, the wide straight beside the high-speed one's tile could go
    expect(w.builder.checkTrack(5, 5, STRAIGHT, 1).ok).toBe(true);
    expect(w.builder.checkLine([fast, ew(5, 5)])).toMatchObject({
      ok: false,
      at: 1,
      reason: STR.build.needTransition,
    });
    const through: LinePiece = {
      kind: 'track',
      x: 5,
      y: 5,
      item: { kind: 'transition', cls: 'regular' },
      rot: transitionRot(Dir.W),
    };
    expect(w.builder.checkLine([fast, through, ew(6, 5)]).ok).toBe(true);
    expect(w.builder.placeLine([fast, through, ew(6, 5)])).toBe(true);
    expect(w.track.connected(4, 5, Dir.E) && w.track.connected(5, 5, Dir.E)).toBe(true);
  });

  it('costs nothing in the editor', () => {
    const w = world();
    w.builder.free = true;
    const before = w.held();
    const c = w.builder.checkLine(run(4, 9, 5));
    expect(c.ok).toBe(true);
    expect(c.cost).toEqual({});
    expect(w.builder.placeLine(run(4, 9, 5))).toBe(true);
    expect(w.held()).toEqual(before);
  });
});

describe('a bridge line', () => {
  /** What the same pieces cost laid one by one with the single-piece tools, on a twin world. */
  function oneByOne(make: () => World, line: LinePiece[]) {
    const twin = make();
    const before = twin.held();
    for (const p of line) expect(single(twin, p), JSON.stringify(p)).toBe(true);
    return spent(before, twin.held());
  }
  function laysWhole(make: () => World, line: LinePiece[]) {
    const w = make();
    const c = w.builder.checkLine(line);
    expect(c.ok, c.reason).toBe(true);
    const before = w.held();
    expect(w.builder.placeLine(line)).toBe(true);
    expect(spent(before, w.held())).toEqual(vec(c.cost));
    expect(vec(c.cost)).toEqual(oneByOne(make, line));
    for (const p of line) expect(stands(w, p), JSON.stringify(p)).toBe(true);
    for (const p of line)
      if (p.kind === 'platform')
        expect(w.track.get(p.x, p.y)?.bridgeCapacity).toBe(
          bridgeCapacity(w.builder.buildingAt(p.x, p.y)!),
        );
    return w;
  }

  it('lays the platforms and the rail on them over water in one stroke', () => {
    const make = () => {
      const w = world();
      for (let x = 10; x <= 15; x++) w.ground(x, 8, Terrain.Water);
      return w;
    };
    laysWhole(make, [ew(9, 8), ...bridge(10, 15, 8), ew(16, 8)]);
  });

  it('lays a bridge across land', () => {
    laysWhole(world, bridge(10, 15, 8, 'bridge_stone'));
  });

  it('lays a bridge across water and land mixed', () => {
    const make = () => {
      const w = world();
      for (const x of [10, 11, 13, 15]) w.ground(x, 8, Terrain.Water);
      w.ground(12, 8, Terrain.Hill);
      return w;
    };
    laysWhole(make, [ew(9, 8), ...bridge(10, 15, 8)]);
  });

  it('skips the platforms and rail of a bridge half built', () => {
    const w = world();
    for (let x = 10; x <= 15; x++) w.ground(x, 8, Terrain.Water);
    for (const x of [10, 11]) {
      expect(w.builder.placeBuilding(x, 8, 'bridge_wood')).not.toBeNull();
      expect(w.builder.placeTrack(x, 8, STRAIGHT, 1)).toBe(true);
    }
    const kept = w.builder.buildingAt(10, 8);
    const line = bridge(10, 15, 8);
    const c = w.builder.checkLine(line);
    expect(c.ok).toBe(true);
    expect(c.steps.slice(0, 4).every((s) => s.skip)).toBe(true);
    expect(c.steps.slice(4).some((s) => s.skip)).toBe(false);
    expect(w.builder.placeLine(line)).toBe(true);
    expect(w.builder.buildingAt(10, 8)).toBe(kept);
    for (const p of line) expect(stands(w, p)).toBe(true);
  });

  it('refuses a bridge whose span cannot stand, and lays none of it', () => {
    const rock = (w: World) => w.ground(12, 8, Terrain.Rock);
    const works = (w: World) => {
      w.ground(13, 8, Terrain.Grass);
      expect(w.builder.placeBuilding(13, 8, 'windmill')).not.toBeNull();
    };
    const stone = (w: World) =>
      expect(w.builder.placeBuilding(11, 8, 'bridge_stone')).not.toBeNull();
    const none = () => {};
    const cases: [string, (w: World) => void, LinePiece[], number, string][] = [
      ['rock under a platform', rock, bridge(10, 15, 8), 4, STR.build.badTerrain],
      ['a works on the span', works, bridge(10, 15, 8), 6, STR.build.occupied],
      ['the other material standing', stone, bridge(10, 15, 8), 2, STR.build.occupied],
      [
        'rail without its platform',
        none,
        [...bridge(10, 11, 8), ew(12, 8)],
        4,
        STR.build.needBridge,
      ],
      ['the rail listed first', none, [ew(10, 8), platform(10, 8)], 0, STR.build.needBridge],
      ['the rail listed first on land', none, [ew(9, 8), platform(9, 8)], 1, STR.build.occupied],
    ];
    for (const [what, set, line, at, reason] of cases) {
      const w = world();
      for (let x = 10; x <= 15; x++) w.ground(x, 8, Terrain.Water);
      set(w);
      const before = snapshot(w);
      expect(w.builder.checkLine(line), what).toMatchObject({ ok: false, at, reason });
      expect(w.builder.placeLine(line), what).toBe(false);
      expect(snapshot(w), what).toEqual(before);
    }
  });

  it('takes only bridge platforms as platform pieces', () => {
    const w = world();
    expect(() => w.builder.checkLine([platform(4, 4, 'windmill')])).toThrow();
  });
});

// ---------------------------------------------------------------------------------- properties

const W = 12;
// mostly ground a line can cross, with water for bridges and now and then rock
const GROUND = [
  ...Array<Terrain>(12).fill(Terrain.Grass),
  ...Array<Terrain>(4).fill(Terrain.Water),
  Terrain.Sand,
  Terrain.Forest,
  Terrain.Hill,
  Terrain.Rock,
];
const CLASSES: TrackClass[] = ['regular', 'high_speed', 'narrow'];

/** A world of W x W tiles, track and platforms already laid, and a line to lay over it. */
interface Case {
  ground: number[];
  stock: number[];
  existing: LinePiece[];
  line: LinePiece[];
}

function anyPiece(rng: Rng, x: number, y: number): LinePiece {
  if (rng.chance(0.2)) return platform(x, y, rng.pick(BRIDGES));
  const item = rng.pick(TRACK_ITEMS);
  return { kind: 'track', x, y, item, rot: rng.int(0, rotationCount(item.kind) - 1) };
}

function drawCase(rng: Rng): Case {
  const ground = Array.from({ length: W * W }, () => rng.pick(GROUND));
  const stock = RES.map(() => rng.int(0, 200));
  // a run along one axis of one class, mostly on the map; now and then a piece of another class
  const n = rng.int(1, 8),
    alongX = rng.chance(0.5),
    cls = rng.pick(CLASSES),
    inside = rng.chance(0.9);
  let x = inside ? rng.int(0, alongX ? W - n : W - 1) : rng.int(-1, W),
    y = inside ? rng.int(0, alongX ? W - 1 : W - n) : rng.int(-1, W);
  const line: LinePiece[] = [];
  for (let i = 0; i < n; i++) {
    const straight: LinePiece = {
      kind: 'track',
      x,
      y,
      item: { kind: 'straight', cls: rng.chance(0.1) ? rng.pick(CLASSES) : cls },
      rot: alongX ? 1 : 0,
    };
    const onMap = x >= 0 && y >= 0 && x < W && y < W;
    const water = onMap && ground[y * W + x] === Terrain.Water;
    if (rng.chance(water ? 0.85 : 0.15)) {
      // a bridge tile: its platform, then the rail (now and then the wrong way round)
      const pair = [platform(x, y, rng.pick(BRIDGES)), straight];
      line.push(...(rng.chance(0.05) ? pair.reverse() : pair));
    } else line.push(rng.chance(0.1) ? anyPiece(rng, x, y) : straight);
    if (alongX) x++;
    else y++;
  }
  // some of the line stands already, and other pieces lie about, now and then in its way
  const existing = line.filter(() => rng.chance(0.15));
  for (let i = rng.int(0, 4); i > 0; i--) {
    const on = rng.chance(0.3) ? rng.pick(line) : { x: rng.int(0, W - 1), y: rng.int(0, W - 1) };
    existing.push(anyPiece(rng, on.x, on.y));
  }
  return { ground, stock, existing, line };
}

function* shrinkCase(c: Case): Iterable<Case> {
  for (const line of shrinkArray(c.line)) yield { ...c, line };
  for (const existing of shrinkArray(c.existing)) yield { ...c, existing };
  for (let i = 0; i < c.ground.length; i++)
    if (c.ground[i] !== Terrain.Grass)
      yield { ...c, ground: c.ground.map((t, j) => (j === i ? Terrain.Grass : t)) };
}

/** The case's world: its ground, its standing pieces (laid in the editor) and its stock. */
function build(c: Case, stock = c.stock) {
  const w = world(W);
  c.ground.forEach((t, i) => (w.map.terrain[i] = t));
  w.builder.free = true;
  for (const p of c.existing) single(w, p);
  w.builder.free = false;
  RES.forEach((k, i) => w.stock.amounts.set(k, stock[i]));
  return w;
}

describe('lines over seeded worlds', () => {
  it('lays a line exactly when checkLine passes it, then charges exactly its total', () => {
    forAll(
      drawCase,
      (c) => {
        const w = build(c);
        const before = snapshot(w);
        const check = w.builder.checkLine(c.line);
        expect(snapshot(w), 'checkLine changed the world').toEqual(before);
        expect(check.steps).toHaveLength(c.line.length);
        expect(check.ok).toBe(check.at === undefined && w.stock.canAfford(check.cost));
        const held = w.held();
        expect(w.builder.placeLine(c.line)).toBe(check.ok);
        if (!check.ok) {
          expect(snapshot(w), 'a refused line changed the world').toEqual(before);
          return;
        }
        expect(spent(held, w.held())).toEqual(vec(check.cost));
        for (const p of c.line) expect(stands(w, p), JSON.stringify(p)).toBe(true);
      },
      { shrink: shrinkCase },
    );
  });

  it('judges each piece as the single-piece tools would after the pieces before it', () => {
    // with ample stock, a line is refused only by a piece; up to it, the single-piece tools lay
    // the same pieces one by one at the same prices, and the piece itself is refused alike
    const ample = RES.map(() => 1e6);
    forAll(
      drawCase,
      (c) => {
        const w = build(c, ample),
          twin = build(c, ample);
        const check = w.builder.checkLine(c.line);
        const stop = check.at ?? c.line.length;
        for (let i = 0; i < stop; i++) {
          const p = c.line[i];
          if (check.steps[i].skip) {
            expect(stands(twin, p), `step ${i} skipped`).toBe(true);
            continue;
          }
          const held = twin.held();
          expect(single(twin, p), `step ${i}`).toBe(true);
          expect(spent(held, twin.held()), `step ${i} price`).toEqual(vec(check.steps[i].cost));
        }
        if (check.at !== undefined) {
          const p = c.line[check.at];
          if (check.reason === STR.build.trackInWay) {
            expect(p.kind).toBe('track');
            if (p.kind === 'track') {
              const tiles = footprintOf(p.x, p.y, p.item.kind, p.rot, p.item.cls);
              expect(tiles.some((t) => twin.track.has(t.x, t.y))).toBe(true);
            }
          } else {
            const alone =
              p.kind === 'track'
                ? twin.builder.checkTrack(p.x, p.y, p.item, p.rot)
                : twin.builder.checkBuilding(p.x, p.y, p.defId, 0);
            expect(alone).toMatchObject({ ok: false, reason: check.reason });
          }
          return;
        }
        expect(check.ok).toBe(true);
        expect(w.builder.placeLine(c.line)).toBe(true);
        expect(snapshot(w)).toEqual(snapshot(twin));
      },
      { shrink: shrinkCase },
    );
  });
});
