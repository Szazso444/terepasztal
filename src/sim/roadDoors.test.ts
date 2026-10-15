import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { TERRAIN_NAMES, Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph, type TrackItem } from '../world/track';
import { Rng } from '../engine/rng';
import { DIRS, DIR_DX, DIR_DY, Dir } from '../engine/iso';
import { STR } from '../strings';
import { content, type DecorDef, type StationDef } from '../data/content';
import { Builder, buildingPlace, decorDef, decorPlace, stationPlace, type Decor } from './build';
import type { Building } from './buildings';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Station, resetStationIds, stationFootprint } from './stations';
import { rules, DEFAULT_RULES } from './rules';
import { BUILDING_ROTATIONS, wrapRotation } from './rotation';
import { SPUR_REACH, roadCost } from './roads';
import { doorsOf, hasDoors, type Door, type PlaceAt, type PlaceDef } from './doors';
import { PeopleSim, OFF_ROAD_STEP, doorstep, findWalk, roadStep } from './people';
import { forAll, shrinkArray } from '../testing/property';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  resetStationIds(1);
  vi.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error('the roads drew from Math.random');
  });
});
afterEach(() => vi.restoreAllMocks());

const W = 64;
/** Every rotation, r0 to r3. */
const ROTATIONS = Array.from({ length: BUILDING_ROTATIONS }, (_, r) => r);
/** A straight's turn: 0 runs north to south, 1 east to west. */
const NS = 0;
const EW = 1;
const STRAIGHT: TrackItem = { kind: 'straight', cls: 'regular' };

type Tile = { x: number; y: number };
const same = (a: Tile, b: Tile) => a.x === b.x && a.y === b.y;
const at = (t: Tile) => `${t.x},${t.y}`;

/**
 * A grass map of 64 by 64 tiles, four chunks of which the player owns the north-west one (x and y
 * below 32), and a builder that pays: nothing in stock until a test puts it there.
 */
function world() {
  const map = emptyMap(7, W, W, Terrain.Grass);
  const regions = new RegionState(map);
  regions.load([true, false, false, false]);
  const track = new TrackGraph(W, W);
  const stock = new Stockpile();
  const builder = new Builder(map, regions, track, new Economy(), stock);
  return { map, regions, track, stock, builder, roads: builder.roads };
}
type World = ReturnType<typeof world>;

/** Run `fn` in the editor's way (no price, no lock), then restore the builder. */
function freely<T>(w: World, fn: () => T): T {
  const was = w.builder.free;
  w.builder.free = true;
  try {
    return fn();
  } finally {
    w.builder.free = was;
  }
}
/** Lay roads by the rules, free of charge, failing the test when one is refused. */
function pave(w: World, tiles: Tile[]) {
  freely(w, () => {
    for (const t of tiles)
      expect(w.builder.placeRoad(t.x, t.y), `road at ${at(t)}: ${refusal(w, t)}`).toBe(true);
  });
}
const refusal = (w: World, t: Tile) => w.builder.checkRoad(t.x, t.y).reason ?? null;
/** The road tiles, in the order they were laid. */
const roadsOf = (w: World) => w.roads.list();

type Kind = 'station' | 'works' | 'decor';
interface Entry {
  kind: Kind;
  def: PlaceDef;
}
/**
 * Every kind of place in the loaded content, read apart from `hasDoors`: each station, each works
 * but a bridge platform, and each decor that stands off the rails (a house, a water tower, a fuel
 * stop).
 */
const PLACES: Entry[] = [
  ...content.stations.defs.map((def) => ({ kind: 'station' as const, def })),
  ...content.buildings.filter((d) => !d.bridge).map((def) => ({ kind: 'works' as const, def })),
  ...content.decor.filter((d) => !d.onTrack).map((def) => ({ kind: 'decor' as const, def })),
];
const label = (e: Entry, rot: number) => `${e.def.id} r${rot}`;
/** A station that needs track beside it: any but a depot, whose rails run through its shed. */
const wantsTrack = (e: Entry) => e.kind === 'station' && !(e.def as StationDef).depot;

/**
 * Stand a place on the builder's lists with its corner at (x, y), turned to `rot`, as a save
 * loads it: no rule is asked and no road laid.
 */
function stand(w: World, e: Entry, x: number, y: number, turn: number): PlaceAt {
  const b = w.builder;
  const rot = wrapRotation(turn);
  if (e.kind === 'station') {
    const s = new Station(e.def.id, x, y);
    s.rot = rot;
    b.stations.push(s);
    return stationPlace(s);
  }
  if (e.kind === 'works') {
    const works: Building = { id: e.def.id, x, y, acc: 0, rot, active: false, rate: 0 };
    b.buildings.set(y * W + x, works);
    return buildingPlace(works);
  }
  const d: Decor = { id: e.def.id, x, y, rot: rot % (e.def as DecorDef).rotations };
  b.decor.set(y * W + x, d);
  return decorPlace(d);
}
/** Take a place `stand` stood off the builder's lists again. */
function unstand(w: World, p: PlaceAt) {
  const b = w.builder;
  const i = b.stations.findIndex((s) => s.x === p.x && s.y === p.y);
  if (i >= 0) b.stations.splice(i, 1);
  b.buildings.delete(p.y * W + p.x);
  b.decor.delete(p.y * W + p.x);
}
/** The tiles a place covers. */
function tilesOf(p: PlaceAt): Tile[] {
  return 'accepts' in p.def ? stationFootprint(p.def.id, p.x, p.y, p.rot) : [{ x: p.x, y: p.y }];
}
/** The tiles outside a footprint that share a side with it. */
function ringOf(tiles: Tile[]): Tile[] {
  const out: Tile[] = [];
  for (const t of tiles)
    for (const d of DIRS) {
      const n = { x: t.x + DIR_DX[d], y: t.y + DIR_DY[d] };
      if (!tiles.some((f) => same(f, n)) && !out.some((o) => same(o, n))) out.push(n);
    }
  return out;
}
/** The street doors of a place, as #406 turns them (`doorsOf`). */
const streetOf = (p: PlaceAt): Door[] =>
  doorsOf(p.def, p.x, p.y, p.rot).filter((d) => d.kind === 'street');
/** The side of `from` that `to`, a tile beside it, lies across. */
const sideTo = (from: Tile, to: Tile) =>
  DIRS.find((d) => from.x + DIR_DX[d] === to.x && from.y + DIR_DY[d] === to.y);
/** The sides set in a mask of `1 << Dir` bits. */
const sidesIn = (mask: number) => DIRS.filter((d) => mask & (1 << d));

// ------------------------------------------------------------------ the footprint

describe('a road and a footprint', () => {
  it('is refused on every tile of every place at every rotation, the two-tile ones too', () => {
    let wide = 0;
    for (const e of PLACES)
      for (const rot of ROTATIONS) {
        const w = world();
        const p = stand(w, e, 10, 10, rot);
        const tiles = tilesOf(p);
        if (tiles.length > 1) wide++;
        w.stock.add('stone', 100);
        for (const t of tiles) {
          expect(refusal(w, t), `${label(e, rot)} ${at(t)}`).toBe(STR.build.roadOnBuilding);
          expect(w.builder.placeRoad(t.x, t.y)).toBe(false);
          // in the editor's way too
          expect(freely(w, () => w.builder.placeRoad(t.x, t.y))).toBe(false);
        }
        expect(w.roads.size, label(e, rot)).toBe(0);
        expect(w.stock.get('stone')).toBe(100);
      }
    // the depot's two by two and the narrow shed's two by one, at every rotation
    expect(wide).toBeGreaterThanOrEqual(8);
    // a bridge platform on land is no place, and no road stands on it either
    const w = world();
    w.builder.buildings.set(5 * W + 5, {
      id: 'bridge_wood',
      x: 5,
      y: 5,
      acc: 0,
      active: false,
      rate: 0,
    });
    expect(refusal(w, { x: 5, y: 5 })).toBe(STR.build.roadOnBuilding);
  });

  it('keeps every place off its tile: the placement check gives the road as the reason', () => {
    rules.narrowUnlocked = 1;
    for (const e of PLACES)
      for (const rot of ROTATIONS) {
        const probe = world();
        const tiles = tilesOf(stand(probe, e, 10, 10, rot));
        for (const t of tiles) {
          const w = world();
          w.builder.free = true;
          w.roads.add(t.x, t.y);
          const why =
            e.kind === 'station'
              ? w.builder.checkStation(10, 10, e.def.id, rot).reason
              : e.kind === 'works'
                ? w.builder.checkBuilding(10, 10, e.def.id, rot).reason
                : w.builder.canPlaceDecor(10, 10, e.def.id);
          expect(why, `${label(e, rot)} with a road on ${at(t)}`).toBe(STR.build.roadInWay);
        }
      }
  });
});

// ------------------------------------------------------------------ links and service

describe('a road beside a place', () => {
  it('links into it and serves it on the reach tile of a street door alone, towards the door', () => {
    for (const e of PLACES)
      for (const rot of ROTATIONS) {
        const w = world();
        const p = stand(w, e, 10, 10, rot);
        const tiles = tilesOf(p);
        const street = streetOf(p);
        const platforms = doorsOf(p.def, p.x, p.y, p.rot).filter((d) => d.kind === 'platform');
        expect(street.length, label(e, rot)).toBeGreaterThan(0);
        for (const t of ringOf(tiles)) {
          const what = `${label(e, rot)} road on ${at(t)}`;
          w.roads.add(t.x, t.y);
          const doors = street.filter((d) => same(d.reach, t));
          const links = w.builder.roadLinks(t.x, t.y);
          // the door bits point at the doors' tiles in the footprint, and nowhere else
          const into = sidesIn(links.doors).map((d) => ({
            x: t.x + DIR_DX[d],
            y: t.y + DIR_DY[d],
          }));
          expect(into.map(at).sort(), what).toEqual(doors.map((d) => at(d.tile)).sort());
          for (const d of doors) expect(sideTo(t, d.tile), what).toBeDefined();
          // no other road: it joins nothing but the doors
          expect(links.sides, what).toBe(links.doors);
          expect(w.builder.roadServes(p), what).toBe(doors.length > 0);
          // a platform door's tile is no way in for a road
          if (platforms.some((d) => same(d.reach, t)) && !doors.length)
            expect(links.doors, what).toBe(0);
          w.roads.remove(t.x, t.y);
        }
        // a road all round: each tile joins its neighbours and, on a street reach, the door
        for (const t of ringOf(tiles)) w.roads.add(t.x, t.y);
        for (const t of ringOf(tiles)) {
          const links = w.builder.roadLinks(t.x, t.y);
          expect(links.sides & ~links.doors, at(t)).toBe(w.roads.joins(t.x, t.y));
          expect(links.doors !== 0, at(t)).toBe(street.some((d) => same(d.reach, t)));
        }
        // no road on a tile: nothing to join
        expect(w.builder.roadLinks(0, 0)).toEqual({ sides: 0, doors: 0 });
      }
  });

  it('stops serving a place turned away from it, and stays where it is', () => {
    for (const e of PLACES)
      for (const rot of ROTATIONS) {
        const w = world();
        const p = stand(w, e, 10, 10, rot);
        for (const d of streetOf(p)) w.roads.add(d.reach.x, d.reach.y);
        expect(w.builder.roadServes(p)).toBe(true);
        const before = roadsOf(w);
        unstand(w, p);
        const turned = stand(w, e, 10, 10, rot + 1);
        // a quarter turn moves every street door of every place there is
        for (const d of streetOf(turned))
          expect(
            before.some((t) => same(t, d.reach)),
            label(e, rot),
          ).toBe(false);
        expect(w.builder.roadServes(turned), label(e, rot)).toBe(false);
        expect(roadsOf(w)).toEqual(before);
        for (const t of before) expect(w.builder.roadLinks(t.x, t.y).doors, at(t)).toBe(0);
      }
  });

  it('serves only what has doors: every station, works with a crew, house and service stop', () => {
    const defs = [...content.stations.defs, ...content.buildings, ...content.decor];
    expect(defs.filter(hasDoors).map((d) => d.id)).toEqual(PLACES.map((e) => e.def.id));
    const w = world();
    PLACES.forEach((e, i) => stand(w, e, 2 + 4 * (i % 7), 2 + 4 * Math.floor(i / 7), 0));
    // and what has none: a bridge platform, a signal, a power pole
    w.builder.buildings.set(30 * W + 30, {
      id: 'bridge_wood',
      x: 30,
      y: 30,
      acc: 0,
      active: false,
      rate: 0,
    });
    w.builder.decor.set(30 * W + 28, { id: 'signal', x: 28, y: 30, rot: 0 });
    w.builder.decor.set(30 * W + 26, { id: 'power_line', x: 26, y: 30, rot: 0 });
    expect(w.builder.doorPlaces().map((p) => p.def.id)).toEqual(PLACES.map((e) => e.def.id));
  });
});

// ------------------------------------------------------------------ the spur

/** One of each sort of place the player places, with the footprints of two and four tiles. */
const PLACED: Entry[] = [
  'station',
  'depot',
  'narrow_depot',
  'windmill',
  'townhouse',
  'water_tower',
  'fuel_stop',
].map((id) => PLACES.find((e) => e.def.id === id)!);
/** The townhouse, the place the tests below stand where they need a door. */
const HOUSE = PLACES.find((e) => e.def.id === 'townhouse')!;
/** Where `placed` puts a place's corner. */
const CORNER = { x: 14, y: 12 };
/** The front of a place turned to `rot` faces S, W, N and E at r0 to r3 (src/sim/rotation.ts). */
const FRONT: Dir[] = [Dir.S, Dir.W, Dir.N, Dir.E];

/**
 * Track a station turned to `rot` at CORNER needs beside it: a straight on the tile in front of it,
 * along its front, where its platform is.
 */
function platformFor(w: World, rot: number) {
  const d = FRONT[wrapRotation(rot)];
  const t = { x: CORNER.x + DIR_DX[d], y: CORNER.y + DIR_DY[d] };
  if (!w.track.has(t.x, t.y)) w.track.place(t.x, t.y, 'straight', d % 2 === 0 ? EW : NS, 'regular');
}
/** What placing `e` turned to `rot` at CORNER would cost and whether the rules let it. */
function check(w: World, e: Entry, rot: number) {
  const { x, y } = CORNER;
  if (e.kind === 'station') return w.builder.checkStation(x, y, e.def.id, rot);
  if (e.kind === 'works') return w.builder.checkBuilding(x, y, e.def.id, rot);
  return w.builder.checkDecor(x, y, e.def.id);
}
/** Place `e` turned to `rot` at CORNER through the builder, as the player does. */
function place(w: World, e: Entry, rot: number): PlaceAt {
  const { x, y } = CORNER;
  const b = w.builder;
  if (wantsTrack(e)) platformFor(w, rot);
  const why = check(w, e, rot).reason;
  const p =
    e.kind === 'station'
      ? b.placeStation(x, y, e.def.id, rot)
      : e.kind === 'works'
        ? b.placeBuilding(x, y, e.def.id, rot)
        : b.placeDecor(x, y, e.def.id, rot);
  expect(p, `${label(e, rot)}: ${why}`).not.toBeNull();
  if (p instanceof Station) return stationPlace(p);
  return e.kind === 'works' ? buildingPlace(p as Building) : decorPlace(p as Decor);
}
/** Take what `place` placed up again, as the player does. */
function remove(w: World, p: PlaceAt) {
  const b = w.builder;
  const s = b.stations.find((q) => q.x === p.x && q.y === p.y);
  if (s) return b.removeStation(s);
  return b.removeBuilding(p.x, p.y) || b.removeDecor(p.x, p.y);
}
/** A road along row 6, from x 4 to 28, where the land is the player's. */
function roadRow(w: World) {
  const row = Array.from({ length: 25 }, (_, i) => ({ x: 4 + i, y: 6 }));
  pave(w, row);
}

/**
 * The fewest tiles a road from `from` to a tile beside one of `roads` takes, counted apart from the
 * spur search: over tiles a road may be laid on (`checkRoad` in the editor's way), with no track on
 * them, off every depot's gates, on the player's land, from one tile to the next across a side.
 * Infinity when there is none. The worlds it is asked about have track only where a spur never
 * goes (platforms), so it is the length of the shortest spur.
 */
function fewestTiles(w: World, from: Tile, roads: Tile[]): number {
  const gates = w.builder
    .depots()
    .flatMap((s) => s.gateTiles())
    .map(at);
  const open = (t: Tile) =>
    freely(w, () => !w.builder.checkRoad(t.x, t.y).reason) &&
    w.regions.isTileUnlocked(t.x, t.y) &&
    !w.track.has(t.x, t.y) &&
    !gates.includes(at(t));
  const isRoad = (t: Tile) => roads.some((r) => same(r, t));
  const dist = new Map<string, number>([[at(from), 1]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i];
    const n = dist.get(at(t))!;
    const next = DIRS.map((d) => ({ x: t.x + DIR_DX[d], y: t.y + DIR_DY[d] }));
    if (next.some(isRoad)) return n;
    for (const q of next)
      if (!dist.has(at(q)) && open(q)) {
        dist.set(at(q), n + 1);
        queue.push(q);
      }
  }
  return Infinity;
}

/**
 * What a spur laid from a door must be, '' when it is: from the door's reach tile, each tile beside
 * the one before it across a side, no more than SPUR_REACH tiles, and its last beside a road that
 * stood before it, unless it is the reach tile alone.
 */
function spurProblem(spur: Tile[], door: Door, before: Tile[]): string {
  if (!spur.length) return 'no spur';
  if (!same(spur[0], door.reach))
    return `starts at ${at(spur[0])}, not the reach ${at(door.reach)}`;
  if (spur.length > SPUR_REACH) return `${spur.length} tiles long`;
  for (let i = 1; i < spur.length; i++)
    if (sideTo(spur[i - 1], spur[i]) === undefined)
      return `${at(spur[i - 1])} and ${at(spur[i])} share no side`;
  const last = spur.at(-1)!;
  if (spur.length > 1 && !before.some((r) => sideTo(last, r) !== undefined))
    return `ends at ${at(last)}, beside no road`;
  return '';
}

describe('placing a place near a road', () => {
  it('lays a spur from its street door to the road, free, as short as a road there can be', () => {
    for (const e of PLACED)
      for (const rot of ROTATIONS) {
        const what = label(e, rot);
        const w = world();
        roadRow(w);
        const before = roadsOf(w);
        if (wantsTrack(e)) platformFor(w, rot);
        // the price and seven stone more
        const price = check(w, e, rot).cost;
        for (const [k, v] of Object.entries(price)) w.stock.add(k, v);
        w.stock.add('stone', 7);
        expect(check(w, e, rot), what).toEqual({ ok: true, cost: price });
        // what it stands on decides the shortest spur: worked out on a twin with no spur
        const twin = world();
        roadRow(twin);
        if (wantsTrack(e)) platformFor(twin, rot);
        const ghost = stand(twin, e, CORNER.x, CORNER.y, rot);
        const [door] = streetOf(ghost);
        const fewest = fewestTiles(twin, door.reach, before);

        const p = place(w, e, rot);
        expect(streetOf(p), what).toEqual([door]);
        const after = roadsOf(w);
        expect(after.slice(0, before.length), what).toEqual(before);
        const spur = after.slice(before.length);
        expect(spurProblem(spur, door, before), what).toBe('');
        expect(spur.length, what).toBe(fewest);
        expect(spur.length, what).toBeGreaterThan(1);
        // the price was taken and nothing more: the seven stone are left
        expect(w.stock.toJSON().amounts, what).toEqual({
          ...Object.fromEntries(Object.keys(price).map((k) => [k, 0])),
          stone: 7,
        });
        expect(w.builder.roadServes(p), what).toBe(true);
        const into = w.builder.roadLinks(door.reach.x, door.reach.y).doors;
        expect(
          sidesIn(into).map((d) =>
            at({ x: door.reach.x + DIR_DX[d], y: door.reach.y + DIR_DY[d] }),
          ),
          what,
        ).toEqual([at(door.tile)]);
      }
  });

  it('turned, lays the spur of the door where it faces now; the old spur stays, a road like any other', () => {
    let turnedOntoSpur = 0;
    for (const e of PLACED)
      for (const rot of ROTATIONS) {
        const what = label(e, rot);
        const w = world();
        w.builder.free = true;
        roadRow(w);
        // the station's platforms for both turns, laid first: the spur keeps off them
        if (wantsTrack(e)) {
          platformFor(w, rot);
          platformFor(w, rot + 1);
        }
        const first = place(w, e, rot);
        const [was] = streetOf(first);
        const old = roadsOf(w);
        expect(remove(w, first), what).toBe(true);
        expect(roadsOf(w), `${what}: taking it up takes no road up`).toEqual(old);
        // a footprint that turns onto the old spur is refused for it, and the road stays
        const footprint = tilesOf({ ...first, rot: rot + 1 });
        if (footprint.some((t) => old.some((r) => same(r, t)))) {
          expect(check(w, e, rot + 1).reason, what).toBe(STR.build.roadInWay);
          turnedOntoSpur++;
          continue;
        }
        const turned = place(w, e, rot + 1);
        const [door] = streetOf(turned);
        const after = roadsOf(w);
        expect(after.slice(0, old.length), what).toEqual(old);
        const spur = after.slice(old.length);
        // its new door may face a tile of the old spur, which serves it as it is
        if (spur.length) expect(spurProblem(spur, door, old), what).toBe('');
        else
          expect(
            old.some((t) => same(t, door.reach)),
            what,
          ).toBe(true);
        expect(w.builder.roadServes(turned), what).toBe(true);
        // the old reach tile keeps its road, which no longer leads into a door
        expect(w.roads.has(was.reach.x, was.reach.y), what).toBe(true);
        expect(w.builder.roadLinks(was.reach.x, was.reach.y).doors, what).toBe(0);
      }
    // the narrow shed turns its two tiles across its old spur
    expect(turnedOntoSpur).toBeGreaterThan(0);
  });

  it('lays its reach tile alone when no road is within SPUR_REACH tiles, and the next road beside it joins it', () => {
    for (const gap of [SPUR_REACH, SPUR_REACH + 1]) {
      const w = world();
      w.builder.free = true;
      // a road straight south of a house's door, `gap` tiles of spur away
      pave(w, [{ x: 10, y: 11 + gap }]);
      expect(w.builder.placeDecor(10, 10, 'townhouse', 0)).not.toBeNull();
      const spur = roadsOf(w).slice(1);
      if (gap === SPUR_REACH) {
        expect(spur).toEqual(Array.from({ length: gap }, (_, i) => ({ x: 10, y: 11 + i })));
        continue;
      }
      expect(spur).toEqual([{ x: 10, y: 11 }]);
      expect(w.roads.joins(10, 11)).toBe(0);
      // the player's road comes up beside it: they join, and nothing more is laid
      pave(w, [{ x: 11, y: 11 }]);
      expect(w.roads.size).toBe(3);
      expect(sidesIn(w.builder.roadLinks(10, 11).sides)).toEqual([Dir.N, Dir.E]);
    }
  });

  it('joins a road the player laid, never another door’s reach tile standing alone', () => {
    const w = world();
    w.builder.free = true;
    // two houses five tiles apart and no road: each gets its reach tile alone
    expect(w.builder.placeDecor(10, 10, 'townhouse', 0)).not.toBeNull();
    expect(w.builder.placeDecor(15, 10, 'townhouse', 0)).not.toBeNull();
    expect(roadsOf(w)).toEqual([
      { x: 10, y: 11 },
      { x: 15, y: 11 },
    ]);
    // two houses side by side face tiles side by side: still no road the player laid
    expect(w.builder.placeDecor(16, 10, 'townhouse', 0)).not.toBeNull();
    expect(roadsOf(w)).toHaveLength(3);
    expect(w.builder.placeDecor(20, 10, 'townhouse', 0)).not.toBeNull();
    expect(roadsOf(w)).toHaveLength(4);
    // the player lays a tile beside the first: that run is a road now, and the next house joins it
    pave(w, [{ x: 10, y: 12 }]);
    expect(roadsOf(w)).toHaveLength(5);
    expect(w.builder.placeDecor(13, 13, 'townhouse', 0)).not.toBeNull();
    const [door] = streetOf(decorPlace(w.builder.decorAt(13, 13)!));
    const spur = roadsOf(w).slice(5);
    const run = [
      { x: 10, y: 11 },
      { x: 10, y: 12 },
    ];
    expect(spurProblem(spur, door, run)).toBe('');
    // from (13, 14) to beside the run: four steps
    expect(spur).toHaveLength(5);
  });

  it('crosses a plain straight at right angles, and goes round what no road may cross', () => {
    for (const cls of ['regular', 'narrow', 'high_speed'] as const) {
      const w = world();
      w.builder.free = true;
      // a line east to west along row 13, and a road beyond it, south of a house's door
      for (let x = 5; x <= 15; x++)
        expect(w.builder.placeTrack(x, 13, { kind: 'straight', cls }, EW), `${cls} ${x}`).toBe(
          true,
        );
      pave(w, [{ x: 10, y: 15 }]);
      expect(w.builder.placeDecor(10, 10, 'townhouse', 0)).not.toBeNull();
      const spur = roadsOf(w).slice(1);
      if (cls === 'high_speed') {
        // the way round either end of the line is longer than SPUR_REACH: the reach tile alone
        expect(spur).toEqual([{ x: 10, y: 11 }]);
        continue;
      }
      expect(spur, cls).toEqual([11, 12, 13, 14].map((y) => ({ x: 10, y })));
      expect(w.roads.isCrossing(10, 13), cls).toBe(true);
      expect(w.roads.has(9, 13) || w.roads.has(11, 13), cls).toBe(false);
    }
    // never along a line: one runs north to south beside the door, water west of it, and the
    // road is across it
    const w = world();
    w.builder.free = true;
    for (let y = 8; y <= 20; y++)
      expect(w.builder.placeTrack(11, y, STRAIGHT, NS), `${y}`).toBe(true);
    for (let x = 3; x <= 10; x++) w.map.terrain[15 * W + x] = Terrain.Water;
    pave(w, [{ x: 12, y: 18 }]);
    expect(w.builder.placeDecor(10, 10, 'townhouse', 0)).not.toBeNull();
    const [door] = streetOf(decorPlace(w.builder.decorAt(10, 10)!));
    const spur = roadsOf(w).slice(1);
    expect(spurProblem(spur, door, [{ x: 12, y: 18 }])).toBe('');
    const on = spur.flatMap((t, i) => (w.track.has(t.x, t.y) ? [i] : []));
    expect(on).toHaveLength(1);
    const [i] = on;
    expect(w.roads.isCrossing(spur[i].x, spur[i].y)).toBe(true);
    expect(spur[i - 1].y === spur[i].y && spur[i + 1].y === spur[i].y).toBe(true);
    expect(broken(w)).toBe('');
  });

  it('lays nothing where the reach tile takes no road, and nothing for what has no door', () => {
    const w = world();
    w.builder.free = true;
    roadRow(w);
    // water on the tile outside the house's door
    w.map.terrain[11 * W + 10] = Terrain.Water;
    expect(w.builder.placeDecor(10, 10, 'townhouse', 0)).not.toBeNull();
    // a works whose door faces another's tile: the kiln's door got its spur, the windmill's none
    expect(w.builder.placeBuilding(20, 11, 'kiln', 0)).not.toBeNull();
    const roads = roadsOf(w).length;
    expect(w.builder.placeBuilding(20, 10, 'windmill', 0)).not.toBeNull();
    expect(w.builder.roadServes(buildingPlace(w.builder.buildingAt(20, 10)!))).toBe(false);
    expect(w.builder.roadServes(buildingPlace(w.builder.buildingAt(20, 11)!))).toBe(true);
    // a signal and a power pole have no door
    w.track.place(5, 20, 'straight', EW, 'regular');
    expect(w.builder.placeDecor(5, 20, 'signal', 0)).not.toBeNull();
    expect(w.builder.placeDecor(7, 7, 'power_line', 0)).not.toBeNull();
    expect(roadsOf(w)).toHaveLength(roads);
    expect(w.roads.has(10, 11)).toBe(false);
  });
});

describe('a road the player lays', () => {
  it('costs what it always cost, and no more when a door near it gets its spur', () => {
    const w = world();
    // a house from before spurs: its door has no road
    const house = stand(w, HOUSE, 10, 10, 0);
    const [door] = streetOf(house);
    w.stock.add('stone', 10);
    w.stock.add('wood', 10);
    expect(w.builder.checkRoad(10, 16)).toEqual({ ok: true, cost: roadCost() });
    expect(w.builder.placeRoad(10, 16)).toBe(true);
    expect(w.stock.get('stone')).toBe(10 - roadCost().stone);
    expect(w.stock.get('wood')).toBe(10);
    // the house got its spur, free: from its door down to the road just laid
    const spur = roadsOf(w).slice(1);
    expect(spurProblem(spur, door, [{ x: 10, y: 16 }])).toBe('');
    expect(spur).toEqual([11, 12, 13, 14, 15].map((y) => ({ x: 10, y })));
    expect(w.builder.roadServes(house)).toBe(true);
    // the next one costs the same, and lays nothing else: the door has its road
    expect(w.builder.placeRoad(10, 17)).toBe(true);
    expect(w.stock.get('stone')).toBe(10 - 2 * roadCost().stone);
    expect(w.roads.size).toBe(spur.length + 2);
  });

  it('gives a door with no road its spur when it is within SPUR_REACH tiles, and none further', () => {
    for (const gap of [SPUR_REACH, SPUR_REACH + 1]) {
      const w = world();
      w.builder.free = true;
      const house = stand(w, HOUSE, 10, 10, 0);
      // `gap` tiles south of the tile outside its door, as |dx| + |dy| counts them
      pave(w, [{ x: 10, y: 11 + gap }]);
      expect(w.builder.roadServes(house), `${gap}`).toBe(gap <= SPUR_REACH);
      expect(w.roads.size, `${gap}`).toBe(gap <= SPUR_REACH ? gap + 1 : 1);
    }
  });

  it('when taken up, a tile of a spur gives back what any road gives back', () => {
    for (const rate of [DEFAULT_RULES.refundRate, 1]) {
      rules.refundRate = rate;
      const w = world();
      w.stock.add('stone', 10);
      const house = stand(w, HOUSE, 10, 10, 0);
      expect(w.builder.placeRoad(10, 14)).toBe(true);
      expect(w.builder.roadServes(house)).toBe(true);
      const stone = w.stock.get('stone');
      expect(w.builder.removeRoad(10, 12)).toBe(true);
      expect(w.stock.get('stone')).toBe(stone + (w.builder.roadRefund().stone ?? 0));
    }
  });
});

// ------------------------------------------------------------------ every spur keeps the rules

const SIDE = 40;
const KINDS = ['station', 'depot', 'narrow_depot', 'windmill', 'townhouse', 'water_tower'];
type Op =
  | { op: 'road'; x: number; y: number; n: number; across: boolean }
  | { op: 'track'; x: number; y: number; n: number; across: boolean; cls: TrackItem['cls'] }
  | { op: 'piece'; x: number; y: number; kind: TrackItem['kind']; rot: number }
  | { op: 'place'; x: number; y: number; id: string; rot: number; old: boolean };
/**
 * A seeded site: rough ground, lines of track, runs of road and places among them, some of them
 * `old`: standing as a save from before spurs holds them, with no road to their doors.
 */
function genSite(rng: Rng) {
  const at = () => ({ x: rng.int(14, SIDE - 1), y: rng.int(14, SIDE - 1) });
  const ground = Array.from({ length: rng.int(0, 30) }, () => ({ ...at(), n: rng.int(0, 2) }));
  const ops: Op[] = Array.from({ length: rng.int(10, 40) }, (): Op => {
    const r = rng.next();
    const p = at();
    if (r < 0.25) return { op: 'road', ...p, n: rng.int(1, 12), across: rng.chance(0.5) };
    if (r < 0.45)
      return {
        op: 'track',
        ...p,
        n: rng.int(2, 12),
        across: rng.chance(0.5),
        cls: rng.pick(['regular', 'regular', 'narrow', 'high_speed'] as const),
      };
    if (r < 0.55)
      return {
        op: 'piece',
        ...p,
        kind: rng.pick(['curve', 'switch'] as const),
        rot: rng.int(0, 7),
      };
    return { op: 'place', ...p, id: rng.pick(KINDS), rot: rng.int(0, 3), old: rng.chance(0.3) };
  });
  return { ground, ops };
}
type Site = ReturnType<typeof genSite>;

/** What every road must keep to; '' when it does. */
function broken(w: World): string {
  const { map, track, builder, roads, regions } = w;
  for (const { x, y } of roads.list()) {
    const where = `road at ${x},${y}`;
    const t = map.terrain[y * map.w + x];
    if (t === Terrain.Water || t === Terrain.Rock || t === Terrain.Mountain)
      return `${where} on ${TERRAIN_NAMES[t]}`;
    if (!regions.isTileUnlocked(x, y)) return `${where} on land the player does not own`;
    if (builder.stationAt(x, y)) return `${where} on a station`;
    if (builder.buildingAt(x, y)) return `${where} on a works`;
    const d = builder.decorAt(x, y);
    if (d && !decorDef(d.id).onTrack) return `${where} on a ${d.id}`;
    const p = track.get(x, y);
    if (!p) continue;
    if (p.kind !== 'straight' || p.unit || p.cls === 'high_speed')
      return `${where} on a ${p.kind} ${p.cls}`;
    for (const s of p.links[0])
      if (roads.has(x + DIR_DX[s], y + DIR_DY[s])) return `${where} along its track`;
  }
  return '';
}

describe('every spur', () => {
  it('keeps every rule a road keeps, from the door to a road, off every platform', () => {
    /** spurs of more than one tile, spur tiles on track (level crossings), spurs a road brought */
    const seen = { spurs: 0, crossings: 0, near: 0 };
    forAll(
      genSite,
      (c: Site) => {
        // the player's way, region lock and all, with the stock to pay for whatever is built
        const w = world();
        const b = w.builder;
        for (const id of ['wood', 'stone', 'iron']) w.stock.add(id, 1e6);
        for (const g of c.ground)
          w.map.terrain[g.y * W + g.x] = [Terrain.Water, Terrain.Rock, Terrain.Mountain][g.n];
        /** what a spur keeps off: every station's platform and every depot's gates */
        const kept = () =>
          new Set(
            b.stations.flatMap((s) => (s.def.depot ? s.gateTiles() : b.platformTiles(s))).map(at),
          );
        const count = (spur: Tile[]) => {
          if (spur.length > 1) seen.spurs++;
          seen.crossings += spur.filter((t) => w.track.has(t.x, t.y)).length;
        };
        c.ops.forEach((o, i) => {
          const step = `op ${i} ${JSON.stringify(o)}`;
          if (o.op === 'road' || o.op === 'track')
            for (let k = 0; k < o.n; k++) {
              const x = o.across ? o.x + k : o.x;
              const y = o.across ? o.y : o.y + k;
              if (o.op === 'track') {
                b.placeTrack(x, y, { kind: 'straight', cls: o.cls }, o.across ? EW : NS);
                continue;
              }
              // a road laid: the tile, then the spurs of the doors near it with no road
              const before = roadsOf(w);
              const bare = b.streetDoors().filter((d) => !w.roads.has(d.reach.x, d.reach.y));
              const off = kept();
              const laid = b.placeRoad(x, y);
              const after = roadsOf(w);
              expect(after.slice(0, before.length), step).toEqual(before);
              const added = after.slice(before.length);
              if (!laid) expect(added, step).toEqual([]);
              else expect(added[0], step).toEqual({ x, y });
              const extra = added.slice(1);
              const near = bare.filter(
                (d) => Math.abs(d.reach.x - x) + Math.abs(d.reach.y - y) <= SPUR_REACH,
              );
              for (const t of extra)
                expect(off.has(at(t)), `${step}: ${at(t)} on a platform`).toBe(false);
              if (extra.length) {
                seen.near++;
                expect(
                  near.some((d) => same(d.reach, extra[0])),
                  step,
                ).toBe(true);
                count(extra);
              }
            }
          else if (o.op === 'piece')
            b.placeTrack(o.x, o.y, { kind: o.kind, cls: 'regular' }, o.rot);
          else if (o.old) {
            // where the rules would let it stand: then stood there as a save holds it, no road
            const e = PLACES.find((q) => q.def.id === o.id)!;
            const ok = freely(w, () =>
              e.kind === 'station'
                ? b.checkStation(o.x, o.y, o.id, o.rot).ok
                : e.kind === 'works'
                  ? b.checkBuilding(o.x, o.y, o.id, o.rot).ok
                  : b.checkDecor(o.x, o.y, o.id).ok,
            );
            if (ok) stand(w, e, o.x, o.y, o.rot);
          } else {
            const before = roadsOf(w);
            const e = PLACES.find((q) => q.def.id === o.id)!;
            const placed =
              e.kind === 'station'
                ? b.placeStation(o.x, o.y, o.id, o.rot)
                : e.kind === 'works'
                  ? b.placeBuilding(o.x, o.y, o.id, o.rot)
                  : b.placeDecor(o.x, o.y, o.id, o.rot);
            const after = roadsOf(w);
            expect(after.slice(0, before.length), step).toEqual(before);
            const spur = after.slice(before.length);
            if (!placed) expect(spur, step).toEqual([]);
            else if (spur.length) {
              const p =
                placed instanceof Station
                  ? stationPlace(placed)
                  : e.kind === 'works'
                    ? buildingPlace(placed as Building)
                    : decorPlace(placed as Decor);
              const [door] = streetOf(p);
              expect(spurProblem(spur, door, before), step).toBe('');
              const off = kept();
              for (const t of spur) expect(off.has(at(t)), `${step}: ${at(t)}`).toBe(false);
              count(spur);
            }
          }
          expect(broken(w), step).toBe('');
        });
      },
      { shrink: (c) => [...shrinkArray(c.ops)].map((ops) => ({ ...c, ops })) },
    );
    // not vacuous: spurs were laid, across track too, and for roads laid near doors
    expect(seen.spurs).toBeGreaterThanOrEqual(50);
    expect(seen.crossings).toBeGreaterThanOrEqual(3);
    expect(seen.near).toBeGreaterThanOrEqual(10);
  });
});

// ------------------------------------------------------------------ walkers and the save

describe('a walker from a house to a station', () => {
  it('goes by the road between their street doors where it is quicker, from one reach tile to the other', () => {
    const w = world();
    w.builder.free = true;
    // a line east to west along row 11, a passenger station on it at (20, 10): its street door
    // faces north, to (20, 9)
    for (let x = 16; x <= 26; x++) w.track.place(x, 11, 'straight', EW, 'regular');
    const st = w.builder.placeStation(20, 10, 'station', 0)!;
    expect(st).not.toBeNull();
    // a road the player lays from beside the station's door west, then down to row 11
    pave(w, [...Array.from({ length: 9 }, (_, i) => ({ x: 19 - i, y: 9 })), { x: 11, y: 10 }]);
    // a house at (10, 10), its door facing south to (10, 11): its spur joins the road
    expect(w.builder.placeDecor(10, 10, 'townhouse', 0)).not.toBeNull();
    const house = decorPlace(w.builder.decorAt(10, 10)!);
    const [home] = streetOf(house);
    const [station] = streetOf(stationPlace(st));
    expect(w.builder.roadServes(house)).toBe(true);
    expect(w.builder.roadServes(stationPlace(st))).toBe(true);
    const crossing = (x: number, y: number) => w.roads.isCrossing(x, y);
    expect(doorstep(w.map, home, crossing)).toEqual(home.reach);
    expect(doorstep(w.map, station, crossing)).toEqual(station.reach);

    // walkers step out at midday until one from the house sets off for the station
    const people = new PeopleSim(w.map, w.builder, new Rng(3));
    const key = `d10,10`;
    let walk: { x: number; y: number }[] | null = null;
    for (let t = 0; t < 4000 && !walk; t++) {
      people.tick(1, 12, 0.5);
      const p = people.persons.find((q) => q.home === key && q.state === 'toStation');
      if (p) walk = p.path;
    }
    expect(walk, 'a walk from the house to the station').not.toBeNull();
    const path = walk!;
    expect(path[0]).toEqual(home.reach);
    expect(path.at(-1)).toEqual(station.reach);
    expect(path).toEqual(findWalk(w.map, home.reach, station.reach, w.roads));
    // along the road every step: quicker than the way straight across, which is shorter in tiles
    const straight = findWalk(w.map, home.reach, station.reach)!;
    const cost = (q: Tile[]) =>
      q.slice(1).reduce((s, t, i) => s + (roadStep(w.roads, q[i], t) ? 1 : OFF_ROAD_STEP), 0);
    expect(path.slice(1).every((t, i) => roadStep(w.roads, path[i], t))).toBe(true);
    expect(straight.length).toBeLessThan(path.length);
    expect(cost(path)).toBeLessThan(cost(straight));
  });
});

describe('roads to doors and the save', () => {
  it('need no key of their own: the roads and the turns saved give back every link and service', () => {
    for (const rot of ROTATIONS) {
      const w = world();
      w.builder.free = true;
      roadRow(w);
      const placed = PLACED.map((e, i) => {
        // each in its own spot, turned to `rot`
        const x = 4 + 6 * (i % 4);
        const y = 12 + 7 * Math.floor(i / 4);
        if (wantsTrack(e)) {
          const d = FRONT[rot];
          w.track.place(x + DIR_DX[d], y + DIR_DY[d], 'straight', d % 2 === 0 ? EW : NS, 'regular');
        }
        if (e.kind === 'station') return stationPlace(w.builder.placeStation(x, y, e.def.id, rot)!);
        if (e.kind === 'works') return buildingPlace(w.builder.placeBuilding(x, y, e.def.id, rot)!);
        return decorPlace(w.builder.placeDecor(x, y, e.def.id, rot)!);
      });
      // what a save keeps: the roads, each station as its JSON, works and decor with their turns
      const saved = JSON.parse(
        JSON.stringify({
          roads: w.roads.toJSON(),
          stations: w.builder.stations.map((s) => s.toJSON()),
          buildings: [...w.builder.buildings.values()],
          decor: [...w.builder.decor.values()].map((d) => [d.x, d.y, d.id, d.rot]),
        }),
      );
      const back = world();
      back.roads.load(saved.roads);
      for (const s of saved.stations) back.builder.stations.push(Station.fromJSON(s));
      for (const b of saved.buildings) back.builder.buildings.set(b.y * W + b.x, b);
      for (const [x, y, id, r] of saved.decor)
        back.builder.decor.set(y * W + x, { id, x, y, rot: r });
      expect(back.roads.toJSON()).toEqual(w.roads.toJSON());
      const doors = w.builder.streetDoors();
      expect(back.builder.streetDoors()).toEqual(doors);
      for (const p of placed) expect(back.builder.roadServes(p), `${p.def.id} r${rot}`).toBe(true);
      for (const t of roadsOf(w))
        expect(back.builder.roadLinks(t.x, t.y), at(t)).toEqual(w.builder.roadLinks(t.x, t.y));
    }
  });
});
