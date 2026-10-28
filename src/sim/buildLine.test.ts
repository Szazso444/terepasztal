import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import {
  TrackGraph,
  TRACK_ITEMS,
  footprintOf,
  isUnitKind,
  itemKey,
  rotationCount,
  type TrackClass,
  type TrackItem,
  type TrackPiece,
} from '../world/track';
import { Dir, DIR_DX, DIR_DY } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { sfx } from '../engine/audio';
import type { Cost } from '../data/content';
import { Builder, type LinePiece } from './build';
import { BUILDING_DEFS } from './buildings';
import { bridgeCapacity } from './bridges';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { resetStationIds } from './stations';
import { rules, DEFAULT_RULES } from './rules';
import { forAll, shrinkArray, type ForAllOptions } from '../testing/property';
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

const STRAIGHT: TrackItem = { kind: 'straight', cls: 'branch' };
/** A straight running east-west at (x, y). */
const ew = (x: number, y: number, cls: TrackClass = 'branch'): LinePiece => ({
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
      // rock takes track only as the continuation of a line: the line starts on it, joining none
      [(w: World) => w.ground(4, 5, Terrain.Rock), 0, STR.build.mountainLine],
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
      [{ kind: 'straight', cls: 'narrow' }, 0],
      [{ kind: 'curve', cls: 'narrow' }, 0],
      [{ kind: 'crossing', cls: 'branch', cls2: 'branch' }, 0],
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
    expect(w.builder.placeTrack(7, 4, { kind: 'curve', cls: 'branch' }, 0)).toBe(true);
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
    const first = ew(4, 5, 'narrow');
    // alone, the wide straight beside the narrow one's tile could go
    expect(w.builder.checkTrack(5, 5, STRAIGHT, 1).ok).toBe(true);
    expect(w.builder.checkLine([first, ew(5, 5)])).toMatchObject({
      ok: false,
      at: 1,
      reason: STR.build.gaugeBreak,
    });
    // laid in the narrow gauge the line goes down, joined through
    const narrow = [first, ew(5, 5, 'narrow'), ew(6, 5, 'narrow')];
    expect(w.builder.checkLine(narrow).ok).toBe(true);
    expect(w.builder.placeLine(narrow)).toBe(true);
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
      ['rock under a platform', rock, bridge(10, 15, 8), 4, STR.build.nothingOn.rock],
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

  it('refuses a platform piece off the map, though its tile key is a standing platform', () => {
    const w = world(24);
    // a tile's key is y * 24 + x: (-1, 5) shares one with (23, 4), and (24, 4) with (0, 5)
    expect(w.builder.placeBuilding(23, 4, 'bridge_wood')).not.toBeNull();
    expect(w.builder.placeBuilding(0, 5, 'bridge_wood')).not.toBeNull();
    const before = snapshot(w);
    for (const p of [platform(-1, 5), platform(24, 4)]) {
      expect(w.builder.checkLine([p]), JSON.stringify(p)).toMatchObject({
        ok: false,
        at: 0,
        reason: STR.build.offMap,
      });
      expect(w.builder.placeLine([p])).toBe(false);
    }
    expect(snapshot(w)).toEqual(before);
  });

  it('stands a curve on uneven ground on the platforms the same line lays before it', () => {
    const w = world();
    const curve: LinePiece = {
      kind: 'track',
      x: 6,
      y: 6,
      item: { kind: 'curve', cls: 'branch' },
      rot: 0,
    };
    const tiles = footprintOf(6, 6, 'curve', 0, 'branch'),
      decks = tiles.map((t) => platform(t.x, t.y));
    const uneven = new Set(tiles.map((t) => `${t.x},${t.y}`));
    w.builder.groundCheck = (x, y, need) => need === 'straight' || !uneven.has(`${x},${y}`);
    const notSmooth = { ok: false, at: 0, reason: STR.build.notSmooth };
    expect(w.builder.checkLine([curve])).toMatchObject(notSmooth);
    // the platforms listed after the curve come too late for it
    expect(w.builder.checkLine([curve, ...decks])).toMatchObject(notSmooth);
    const c = w.builder.checkLine([...decks, curve]);
    expect(c.ok, c.reason).toBe(true);
    const before = w.held();
    expect(w.builder.placeLine([...decks, curve])).toBe(true);
    expect(spent(before, w.held())).toEqual(vec(c.cost));
    for (const t of tiles) {
      expect(w.track.get(t.x, t.y)?.unit).toMatchObject({ ax: 6, ay: 6 });
      expect(w.track.get(t.x, t.y)?.bridgeCapacity).toBe(
        bridgeCapacity(w.builder.buildingAt(t.x, t.y)!),
      );
    }
  });
});

describe('a line through a depot', () => {
  it('tells the depot its gates are served, as the single-piece tools do, and no more', () => {
    const make = () => {
      resetStationIds(1);
      const w = world();
      w.builder.free = true;
      const depot = w.builder.placeStation(8, 5, 'depot', 0)!;
      w.builder.free = false;
      return { w, depot, log: listen(w.builder) };
    };
    const { w, depot, log } = make(),
      twin = make();
    const gates = depot.gateTiles(),
      y = gates[0].y;
    const xs = gates.filter((g) => g.y === y).map((g) => g.x);
    const line = run(Math.min(...xs) - 1, Math.max(...xs) + 1, y);
    expect(w.builder.checkLine(line).ok).toBe(true);
    expect(log).toEqual([]);
    expect(w.builder.placeLine(line)).toBe(true);
    for (const p of line) expect(single(twin.w, p)).toBe(true);
    expect(log).toContain(`orphaned ${depot.id} false`);
    expect(log).toEqual(twin.log);
    expect(w.builder.platformTiles(depot).length).toBeGreaterThan(0);
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
const CLASSES: TrackClass[] = ['branch', 'narrow'];

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

// ---------------------------------------------------------------- properties over scenes
// A scene adds what a line can meet besides ground, track and platforms: locked tiles, ground
// that is not level or too steep (`groundCheck`), stations, decor, the editor and narrow gauge
// still locked. Its line wanders and turns, mixes kinds and classes (wide pieces included) and
// goes back over its own tiles. The runs `drawCase` draws are scenes too.

interface Scene extends Case {
  /** tiles outside the player's regions */
  locked: number[];
  /** tiles the ground calls not level; null leaves `groundCheck` unset (level everywhere) */
  unlevel: number[] | null;
  /** tiles of `unlevel` a straight cannot climb */
  steep: number[];
  /** stations put up in the editor after the standing track */
  stations: { x: number; y: number; id: string; rot: number }[];
  /** decor put up in the editor after the stations */
  decor: { x: number; y: number; id: string; rot: number }[];
  /** the line is laid in the editor */
  free: boolean;
  /** narrow gauge is open (`rules.narrowUnlocked`) */
  narrow: boolean;
}

const AMPLE = RES.map(() => 1e6);
const SCENE_GROUND = [
  ...Array<Terrain>(16).fill(Terrain.Grass),
  ...Array<Terrain>(3).fill(Terrain.Water),
  Terrain.Sand,
  Terrain.Forest,
  Terrain.Hill,
  Terrain.Hill,
  Terrain.Rock,
];
const STATIONS = ['depot', 'narrow_depot', 'station', 'warehouse'];
const DECOR = ['signal', 'power_line', 'water_tower'];

const fromCase = (c: Case): Scene => ({
  ...c,
  locked: [],
  unlevel: null,
  steep: [],
  stations: [],
  decor: [],
  free: false,
  narrow: true,
});

function drawScene(rng: Rng): Scene {
  // A tidy scene's line lays only rails of its class, on platforms over water, on ground without
  // rock, so that most can be laid. Now and then a line runs off the map; otherwise it turns back
  // at the edge.
  const tidy = rng.chance(0.6),
    leaves = rng.chance(0.05);
  const ground = Array.from({ length: W * W }, () => {
    const t = rng.pick(SCENE_GROUND);
    return tidy && t === Terrain.Rock ? Terrain.Grass : t;
  });
  const onMap = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < W;
  const cls = rng.pick(CLASSES);
  const turns = TRACK_ITEMS.filter(
    (i) => i.cls === cls && (i.kind === 'curve' || i.kind === 'switch'),
  );
  const others = TRACK_ITEMS.filter((i) => (i.cls === cls || i.cls2 === cls) && !turns.includes(i));
  const line: LinePiece[] = [];
  let x = rng.int(1, W - 2),
    y = rng.int(1, W - 2),
    d = rng.int(0, 3);
  for (let n = rng.int(1, 8); n > 0; n--) {
    const r = tidy ? rng.next() * 0.65 : rng.next();
    let step = 1;
    if (r < 0.35) {
      const water = onMap(x, y) && ground[y * W + x] === Terrain.Water;
      if (rng.chance(water ? (tidy ? 1 : 0.8) : 0.1)) line.push(platform(x, y, rng.pick(BRIDGES)));
      line.push({ kind: 'track', x, y, item: { kind: 'straight', cls }, rot: d % 2 });
    } else if (r < 0.65) {
      // a turn or a switch, or another piece of the class
      const item = rng.pick(r < 0.55 ? turns : others),
        rot = rng.int(0, rotationCount(item.kind) - 1);
      if (isUnitKind(item.kind, item.cls)) {
        // a wide piece covers this tile and the next, and spreads to one side or the other
        const side = rng.int(0, 1),
          ax = x - (d === Dir.W ? 1 : d % 2 === 0 ? side : 0),
          ay = y - (d === Dir.N ? 1 : d % 2 === 1 ? side : 0);
        // tidy, on a platform over water, and now and then on one under each tile, which lets it
        // stand on uneven ground
        const decked = tidy && rng.chance(0.3);
        for (const t of footprintOf(ax, ay, item.kind, rot, item.cls)) {
          const water = onMap(t.x, t.y) && ground[t.y * W + t.x] === Terrain.Water;
          if (decked || (tidy && water)) line.push(platform(t.x, t.y, rng.pick(BRIDGES)));
        }
        line.push({ kind: 'track', x: ax, y: ay, item, rot });
        step = 2;
      } else {
        line.push({ kind: 'track', x, y, item, rot });
        if (rng.chance(0.5)) d = rng.int(0, 3);
      }
    } else if (r < 0.72) line.push(platform(x, y, rng.pick(BRIDGES)));
    else if (r < 0.87 && line.length) {
      // back over the line's own tiles: the same piece, the same piece a tile over, or another
      const old = rng.pick(line),
        how = rng.next();
      if (how < 0.4) line.push({ ...old });
      else if (how < 0.7)
        line.push({ ...old, x: old.x + rng.int(-1, 1), y: old.y + rng.int(-1, 1) });
      else line.push(anyPiece(rng, old.x, old.y));
    } else line.push(anyPiece(rng, x, y));
    const nx = x + step * DIR_DX[d as Dir],
      ny = y + step * DIR_DY[d as Dir];
    if (leaves || onMap(nx, ny)) [x, y] = [nx, ny];
    else d = (d + 2) % 4;
  }
  // standing pieces: some of the line's own (some a half turn round, some of other classes), some
  // a tile over, others
  const existing: LinePiece[] = [];
  for (let i = rng.int(0, tidy ? 3 : 6); i > 0; i--) {
    const how = rng.next(),
      p = line.length ? rng.pick(line) : undefined;
    if (p && how < 0.25) existing.push({ ...p });
    else if (p?.kind === 'track' && how < 0.32)
      existing.push({ ...p, rot: p.rot + rotationCount(p.item.kind) });
    else if (p?.kind === 'track' && how < 0.4) {
      const kin = TRACK_ITEMS.filter(
        (t) => t.kind === p.item.kind && itemKey(t) !== itemKey(p.item),
      );
      if (kin.length) existing.push({ ...p, item: rng.pick(kin) });
    } else if (p && how < 0.5)
      existing.push({ ...p, x: p.x + rng.int(-1, 1), y: p.y + rng.int(-1, 1) });
    else existing.push(anyPiece(rng, rng.int(0, W - 1), rng.int(0, W - 1)));
  }
  const unlevel = rng.chance(0.4)
    ? ground.flatMap((g, i) => (g === Terrain.Hill || rng.chance(0.1) ? [i] : []))
    : null;
  // a site beside the line, where its gates may meet it; several, as some will not stand
  const site = () => {
    const p = line.length ? rng.pick(line) : { x: rng.int(0, W - 1), y: rng.int(0, W - 1) };
    return { x: p.x + rng.int(-2, 2), y: p.y + rng.int(-2, 2) };
  };
  const tries = (n: number, ids: string[]) =>
    Array.from({ length: n }, () => ({ ...site(), id: rng.pick(ids), rot: rng.int(0, 3) }));
  return {
    ground,
    stock: rng.chance(tidy ? 0.7 : 0.4) ? AMPLE : RES.map(() => rng.int(0, 150)),
    existing,
    line,
    locked: rng.chance(0.2)
      ? Array.from({ length: rng.int(1, 6) }, () => rng.int(0, W * W - 1))
      : [],
    unlevel,
    steep: unlevel ? unlevel.filter(() => rng.chance(0.3)) : [],
    stations: rng.chance(0.3) ? tries(4, STATIONS) : [],
    decor: rng.chance(0.3) ? tries(3, DECOR) : [],
    free: rng.chance(0.1),
    narrow: rng.chance(0.85),
  };
}

function* shrinkScene(s: Scene): Iterable<Scene> {
  for (const line of shrinkArray(s.line)) yield { ...s, line };
  for (const existing of shrinkArray(s.existing)) yield { ...s, existing };
  for (const stations of shrinkArray(s.stations)) yield { ...s, stations };
  for (const decor of shrinkArray(s.decor)) yield { ...s, decor };
  for (const locked of shrinkArray(s.locked)) yield { ...s, locked };
  if (s.unlevel) yield { ...s, unlevel: null, steep: [] };
  if (s.steep.length) yield { ...s, steep: [] };
  if (s.free) yield { ...s, free: false };
  if (!s.narrow) yield { ...s, narrow: true };
  if (s.stock !== AMPLE) yield { ...s, stock: AMPLE };
  for (let i = 0; i < s.ground.length; i++)
    if (s.ground[i] !== Terrain.Grass)
      yield { ...s, ground: s.ground.map((t, j) => (j === i ? Terrain.Grass : t)) };
}
/** A scene for a failure message, its ground as the [x, y, terrain] of each tile not grass. */
const formatScene = (s: Scene) =>
  JSON.stringify({
    ...s,
    ground: s.ground.flatMap((t, i) =>
      t === Terrain.Grass ? [] : [[i % W, Math.floor(i / W), t]],
    ),
  });

/** The scene's world: what stands is put up in the editor, then the line's mode and stock. */
function stage(s: Scene, stock = s.stock) {
  Object.assign(rules, DEFAULT_RULES);
  rules.narrowUnlocked = s.narrow ? 1 : 0;
  resetStationIds(1);
  const w = world(W),
    b = w.builder;
  s.ground.forEach((t, i) => (w.map.terrain[i] = t));
  b.free = true;
  for (const p of s.existing) single(w, p);
  for (const st of s.stations) b.placeStation(st.x, st.y, st.id, st.rot);
  for (const d of s.decor) b.placeDecor(d.x, d.y, d.id, d.rot);
  const locked = new Set(s.locked);
  b.regions.isTileUnlocked = (x, y) => !locked.has(y * W + x);
  if (s.unlevel) {
    const unlevel = new Set(s.unlevel),
      steep = new Set(s.steep);
    b.groundCheck = (x, y, need) => !(need === 'level' ? unlevel : steep).has(y * W + x);
  }
  b.free = s.free;
  RES.forEach((k, i) => w.stock.amounts.set(k, stock[i]));
  return w;
}

/** Every callback the builder fires from now on, in order, as text. */
function listen(b: Builder) {
  const log: string[] = [];
  b.onTrackChanged = (x, y) => log.push(`track ${x},${y}`);
  b.onBuildingChanged = (o, gone) => log.push(`building ${o.id} ${o.x},${o.y} ${o.rot} ${gone}`);
  b.onIndustryPlaced = (x, y) => log.push(`industry ${x},${y}`);
  b.onStationOrphaned = (st, orphaned) => log.push(`orphaned ${st.id} ${orphaned}`);
  b.onStationChanged = (st, gone) => log.push(`station ${st.id} ${gone}`);
  b.onDecorChanged = (d, gone) => log.push(`decor ${d.id} ${d.x},${d.y} ${gone}`);
  b.onSupplyChanged = (x, y) => log.push(`supply ${x},${y}`);
  b.onUpgraded = (e) => log.push(`upgraded ${e.x},${e.y}`);
  b.onReclassed = (tiles) => log.push(`reclassed ${tiles.length}`);
  return log;
}

/** The world a line may touch, by value: track, buildings, decor, stations, stock and money. */
function state(w: World, withStock = true) {
  return JSON.parse(
    JSON.stringify({
      track: [...w.track.pieces.entries()],
      version: w.track.version,
      buildings: [...w.builder.buildings.entries()],
      decor: [...w.builder.decor.entries()],
      stations: w.builder.stations.map((s) => [s.id, s.x, s.y, s.rot]),
      stock: withStock ? w.held() : null,
      money: w.economy.money,
    }),
  ) as unknown;
}
/** The objects standing, to compare by identity: one replaced by an equal copy shows there. */
const objects = (w: World): object[] => [
  ...w.track.pieces.values(),
  ...w.builder.buildings.values(),
  ...w.builder.decor.values(),
  ...w.builder.stations,
];
/** The same objects, each the very one it was. */
const same = (a: object[], b: object[]) => a.length === b.length && a.every((o, i) => o === b[i]);
/** What a tile's track is, a switch's form aside (the track around it chooses that). */
const sort = (p: TrackPiece) => [p.kind, p.cls, p.cls2, p.rot, p.unit?.ax, p.unit?.ay];
const sounds = () => vi.mocked(sfx).mock.calls.length;

/**
 * Q25 b's matching piece, stated apart from the builder: on a tile of the map, a platform of the
 * same bridge, or track of the same kind and classes (both axes of a crossing) at the same turn
 * (modulo the kind's rotations) with its anchor on this tile.
 */
function matches(w: World, p: LinePiece) {
  if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= W) return false;
  if (p.kind === 'platform') return w.builder.buildingAt(p.x, p.y)?.id === p.defId;
  const q = w.track.get(p.x, p.y),
    n = rotationCount(p.item.kind);
  return (
    !!q &&
    q.kind === p.item.kind &&
    q.cls === p.item.cls &&
    (q.cls2 ?? q.cls) === (p.item.cls2 ?? p.item.cls) &&
    (((q.rot - p.rot) % n) + n) % n === 0 &&
    (isUnitKind(p.item.kind, p.item.cls) ? q.unit?.ax === p.x && q.unit.ay === p.y : !q.unit)
  );
}
/** The single-piece tool's own verdict on a piece. */
const alone = (w: World, p: LinePiece) =>
  p.kind === 'track'
    ? w.builder.checkTrack(p.x, p.y, p.item, p.rot)
    : w.builder.checkBuilding(p.x, p.y, p.defId, 0);

// Scenes run three hundred seeds: a hundred lay too few wide pieces and station gates.
const GENERATORS: [string, (rng: Rng) => Scene, ForAllOptions<Scene>][] = [
  ['runs', (rng) => fromCase(drawCase(rng)), {}],
  ['scenes', drawScene, { seeds: Array.from({ length: 300 }, (_, i) => i + 1) }],
];

describe.each(GENERATORS)('lines over seeded %s', (_name, gen, seeds) => {
  const options: ForAllOptions<Scene> = { shrink: shrinkScene, format: formatScene, ...seeds };
  // slow because each seeded line is judged piece by piece against a twin world that lays it with
  // the single-piece tools: 0.51 s alone, so a limit of 30 s
  it('judges every piece as the single-piece tools would after the passed pieces before it', () => {
    // The oracle walks the line on a twin world with ample stock and lays, with the single-piece
    // tools, only the pieces the line passes. Every verdict, refused pieces and those after them
    // included, is the twin's at that point: skipped exactly when a matching piece stands, passed
    // at the single tool's price on tiles free of track, refused for the single tool's reason or,
    // for track in the way, with track on the footprint. The total, the first refusal and the
    // verdict follow from the steps. An accepted line leaves the twin's world, fires the twin's
    // callbacks in the twin's order with one sound, and removes nothing.
    forAll(
      gen,
      (s) => {
        const w = stage(s),
          twin = stage(s, AMPLE);
        const log = listen(w.builder),
          heard = listen(twin.builder);
        const before = state(w),
          standing = objects(w),
          sorts = new Map([...w.track.pieces].map(([k, p]) => [k, sort(p)])),
          quiet = sounds();
        const check = w.builder.checkLine(s.line);
        expect(state(w), 'checkLine changed the world').toEqual(before);
        expect(same(objects(w), standing), 'checkLine replaced an object').toBe(true);
        expect(log, 'checkLine fired a callback').toEqual([]);
        expect(sounds(), 'checkLine played a sound').toBe(quiet);
        expect(check.steps).toHaveLength(s.line.length);

        const total: Cost = {};
        let first: number | undefined;
        let lays = false;
        s.line.forEach((p, i) => {
          const step = check.steps[i],
            at = `step ${i} ${JSON.stringify(p)}`;
          const matching = matches(twin, p);
          expect(!!step.skip, `${at}: skipped exactly when a matching piece stands`).toBe(matching);
          if (matching) return expect(step, at).toEqual({ ok: true, cost: {}, skip: true });
          const tool = alone(twin, p);
          const tracked =
            p.kind === 'track' &&
            footprintOf(p.x, p.y, p.item.kind, p.rot, p.item.cls).some((t) =>
              twin.track.has(t.x, t.y),
            );
          if (step.ok) {
            expect(tracked, `${at}: passed over track`).toBe(false);
            expect(tool, `${at}: the single tool's verdict`).toEqual({ ok: true, cost: step.cost });
            expect(single(twin, p), at).toBe(true);
            for (const [k, v] of Object.entries(step.cost)) total[k] = (total[k] ?? 0) + v;
            lays = true;
            return;
          }
          first ??= i;
          if (step.reason === STR.build.trackInWay)
            expect(tracked, `${at}: track in the way`).toBe(true);
          else
            expect(tool, `${at}: the single tool's refusal`).toMatchObject({
              ok: false,
              reason: step.reason,
            });
        });
        expect(check.at, 'the first refusal').toBe(first);
        expect(check.cost, 'the total of the passed pieces').toEqual(total);
        const short = !s.free && !w.stock.canAfford(total);
        expect(check.ok).toBe(first === undefined && !short);
        if (first !== undefined) expect(check.reason).toBe(check.steps[first].reason);
        else if (short) {
          const missing = Object.entries(w.stock.missing(total))
            .map(([k, v]) => `${v} ${k}`)
            .join(', ');
          expect(check.reason).toBe(STR.build.needResources(missing));
        }

        const held = w.held(),
          hush = sounds();
        expect(w.builder.placeLine(s.line)).toBe(check.ok);
        if (!check.ok) {
          expect(state(w), 'a refused line changed the world').toEqual(before);
          expect(same(objects(w), standing), 'a refused line replaced an object').toBe(true);
          expect(log, 'a refused line fired a callback').toEqual([]);
          expect(sounds(), 'a refused line played a sound').toBe(hush);
          return;
        }
        expect(spent(held, w.held()), 'charged the total').toEqual(s.free ? [0, 0, 0] : vec(total));
        expect(state(w, false), 'the world laid one by one').toEqual(state(twin, false));
        expect(log, 'the callbacks one by one').toEqual(heard);
        expect(sounds() - hush, 'one sound when anything was laid').toBe(lays ? 1 : 0);
        // nothing removed: each tile keeps its track, and each building, decor and station stands
        for (const [k, was] of sorts) {
          const q = w.track.pieces.get(k);
          expect(q && sort(q), `tile ${k} kept its track`).toEqual(was);
        }
        const still = new Set(objects(w));
        for (const o of standing)
          if (!('links' in o)) expect(still.has(o), 'a building, decor or station kept').toBe(true);
      },
      options,
    );
  }, 30_000);

  it('lays an accepted line once: laying it again skips every piece, free and silent', () => {
    forAll(
      gen,
      (s) => {
        const w = stage(s);
        if (!w.builder.placeLine(s.line)) return;
        for (const k of RES) w.stock.amounts.set(k, 0);
        const log = listen(w.builder);
        const before = state(w),
          standing = objects(w),
          quiet = sounds();
        const again = w.builder.checkLine(s.line);
        expect(again.ok, again.reason).toBe(true);
        expect(again.cost).toEqual({});
        expect(again.steps.every((st) => st.skip)).toBe(true);
        expect(w.builder.placeLine(s.line)).toBe(true);
        expect(state(w)).toEqual(before);
        expect(same(objects(w), standing), 'an object was replaced').toBe(true);
        expect(log).toEqual([]);
        expect(sounds()).toBe(quiet);
      },
      options,
    );
  });

  it('lays a line the stock covers exactly, and nothing when one resource is one short', () => {
    forAll(
      gen,
      (s) => {
        if (s.free) return;
        const whole = stage(s, AMPLE).builder.checkLine(s.line);
        if (whole.at !== undefined) return;
        const need = vec(whole.cost);
        need.forEach((v, i) => {
          if (v === 0) return;
          const w = stage(
            s,
            need.map((u, j) => (j === i ? u - 1 : u)),
          );
          const before = state(w);
          const c = w.builder.checkLine(s.line);
          expect(c).toMatchObject({
            ok: false,
            cost: whole.cost,
            reason: STR.build.needResources(`1 ${RES[i]}`),
          });
          expect(c.at).toBeUndefined();
          expect(w.builder.placeLine(s.line)).toBe(false);
          expect(state(w)).toEqual(before);
        });
        const w = stage(s, need);
        expect(w.builder.placeLine(s.line)).toBe(true);
        expect(w.held()).toEqual([0, 0, 0]);
      },
      options,
    );
  });
});
