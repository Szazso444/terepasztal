import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { TERRAIN_NAMES, Terrain, type PropInstance } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph, type TrackItem, type TrackPiece } from '../world/track';
import { Rng } from '../engine/rng';
import { DIRS, DIR_DX, DIR_DY, Dir, opposite } from '../engine/iso';
import { STR } from '../strings';
import { content, type BuildingDef, type DecorDef, type StationDef } from '../data/content';
import { Builder, buildingPlace, decorDef, decorPlace, stationPlace, type Decor } from './build';
import type { Building } from './buildings';
import { Economy } from './economy';
import { Station, resetStationIds, stationFootprint } from './stations';
import { rules, DEFAULT_RULES } from './rules';
import { BUILDING_ROTATIONS, wrapRotation } from './rotation';
import { SPUR_REACH, roadCost } from './roads';
import { doorsOf, hasDoors, type Door, type PlaceAt, type PlaceDef } from './doors';
import { PeopleSim, OFF_ROAD_STEP, doorstep, findWalk, roadStep } from './people';
import { ensureStartDepot } from './startDepot';
import { forAll, shrinkArray } from '../testing/property';
import { storeWith } from '../testing/storeFixtures';

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
 * below 32), and a builder that pays from a depot there: nothing in it until a test puts it there.
 */
function world() {
  const map = emptyMap(7, W, W, Terrain.Grass);
  const regions = new RegionState(map);
  regions.load([true, false, false, false]);
  const track = new TrackGraph(W, W);
  // the depot the builder pays from, in reach of the whole owned chunk
  const { stores, depot: stock } = storeWith({}, { x: 16, y: 16 });
  const builder = new Builder(map, regions, track, new Economy(), stores);
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
    // a bridge platform on land is no place: a road may stand on it (#493)
    const w = world();
    w.builder.buildings.set(5 * W + 5, {
      id: 'bridge_wood',
      x: 5,
      y: 5,
      acc: 0,
      active: false,
      rate: 0,
    });
    w.stock.add('stone', 100);
    expect(refusal(w, { x: 5, y: 5 })).toBeNull();
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
 * Track a station turned to `rot` at CORNER (or at `corner`) needs beside it: a straight on the
 * tile in front of it, along its front, where its platform is.
 */
function platformFor(w: World, rot: number, corner: Tile = CORNER) {
  const d = FRONT[wrapRotation(rot)];
  const t = { x: corner.x + DIR_DX[d], y: corner.y + DIR_DY[d] };
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
 * stood before it.
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
  if (!before.some((r) => sideTo(last, r) !== undefined))
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
        const payer = Object.keys(price).length ? w.stock.key : undefined;
        expect(check(w, e, rot), what).toEqual({ ok: true, cost: price, payer });
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
        expect(Object.fromEntries(w.stock.amounts), what).toEqual({
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

  it('lays no road when none is within SPUR_REACH tiles, and the next road laid beside its door joins it', () => {
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
      // no lone road tile at the door, which nobody could see or take up
      expect(spur).toEqual([]);
      expect(w.roads.has(10, 11)).toBe(false);
      expect(w.builder.roadServes(decorPlace(w.builder.decorAt(10, 10)!))).toBe(false);
      // the player's road comes up beside its door: the door gets its reach tile, and they join
      pave(w, [{ x: 11, y: 11 }]);
      expect(w.roads.size).toBe(3);
      expect(sidesIn(w.builder.roadLinks(10, 11).sides)).toEqual([Dir.N, Dir.E]);
    }
  });

  it('joins a road that runs on past a reach tile, never another door’s reach tile standing alone', () => {
    const w = world();
    w.builder.free = true;
    // houses with no road near lay none: two five tiles apart, two side by side, and one further on
    for (const x of [10, 15, 16, 20])
      expect(w.builder.placeDecor(x, 10, 'townhouse', 0)).not.toBeNull();
    expect(roadsOf(w)).toEqual([]);
    // the player lays a road on each reach tile, the two side by side as a run of two: a reach
    // tile alone, or a few side by side, is no road for a spur to join
    pave(
      w,
      [10, 15, 16, 20].map((x) => ({ x, y: 11 })),
    );
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
        // the way round either end of the line is longer than SPUR_REACH: no road
        expect(spur).toEqual([]);
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

describe('placing a place away from every road', () => {
  /** Why the tile outside a door refuses what the player could build on it, '' when nothing does. */
  function refusedAt(w: World, t: Tile, rot: number): string {
    const refusals = [
      w.builder.canPlaceDecor(t.x, t.y, 'townhouse'),
      w.builder.checkBuilding(t.x, t.y, 'windmill', rot).reason,
      w.builder.checkStation(t.x, t.y, 'depot', rot).reason,
      w.builder.checkTrack(t.x, t.y, { kind: 'curve', cls: 'regular' }, rot).reason,
      w.builder.checkTrack(t.x, t.y, { kind: 'straight', cls: 'high_speed' }, rot).reason,
    ];
    const road: (string | null)[] = [
      STR.build.roadInWay,
      STR.build.roadOnBuilding,
      STR.build.crossingStraight,
      STR.build.crossingHighSpeed,
      STR.build.crossingAlong,
    ];
    return refusals.find((r) => r && road.includes(r)) ?? '';
  }

  it('lays no road tile at its door: none to see, none in the way, no crossing made (#455)', () => {
    for (const e of PLACED)
      for (const rot of ROTATIONS) {
        const what = label(e, rot);
        const w = world();
        w.builder.free = true;
        const p = place(w, e, rot);
        const [door] = streetOf(p);
        expect(roadsOf(w), what).toEqual([]);
        expect(w.builder.roadServes(p), what).toBe(false);
        expect(w.builder.roadLinks(door.reach.x, door.reach.y).doors, what).toBe(0);
        expect(refusedAt(w, door.reach, rot), what).toBe('');
        // a plain straight laid across the tile outside the door is a straight and no crossing
        expect(w.builder.placeTrack(door.reach.x, door.reach.y, STRAIGHT, EW), what).toBe(true);
        expect(w.roads.isCrossing(door.reach.x, door.reach.y), what).toBe(false);
        expect(roadsOf(w), what).toEqual([]);
      }
  });

  it('lays none for any door of a game, the start depot included, but the road the player lays', () => {
    const w = world();
    w.builder.free = true;
    ['townhouse', 'water_tower', 'fuel_stop'].forEach((id, i) =>
      expect(w.builder.placeDecor(5 + 4 * i, 5, id, 0), id).not.toBeNull(),
    );
    expect(w.builder.placeBuilding(5, 12, 'windmill', 0)).not.toBeNull();
    const depot = ensureStartDepot(w.builder, 'depot', { x: 20, y: 20 });
    expect(depot).not.toBeNull();
    expect(roadsOf(w)).toEqual([]);
    expect(w.builder.roadServes(stationPlace(depot!))).toBe(false);
    // a road the player lays within reach of a door still brings that door its spur, free
    pave(w, [{ x: 5, y: 8 }]);
    expect(roadsOf(w).length).toBeGreaterThan(1);
    expect(w.builder.roadServes(decorPlace(w.builder.decorAt(5, 5)!))).toBe(true);
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
    expect(w.builder.checkRoad(10, 16)).toEqual({ ok: true, cost: roadCost(), payer: w.stock.key });
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
  // slow: seeded sites of builder steps, every spur checked rule by rule, 1 s alone; the limit is
  // room for a busy machine
  it('keeps every rule a road keeps, from the door to a road, off every platform', () => {
    /** spurs of more than one tile, spur tiles on track (level crossings), spurs a road brought */
    const seen = { spurs: 0, crossings: 0, near: 0 };
    forAll(
      genSite,
      (c: Site) => {
        // the player's way, region lock and all, with the stock to pay for whatever is built
        const w = world();
        const b = w.builder;
        for (const id of ['wood', 'stone', 'iron']) w.stock.amounts.set(id, 1e6);
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
  }, 30_000);
});

// ------------------------------------------------------------------ the spur against an exhaustive search

/** A tile's key, `y * W + x`; -1 off the map, so no tile off it ever matches one on it. */
const keyOf = (t: Tile) => (t.x < 0 || t.y < 0 || t.x >= W || t.y >= W ? -1 : t.y * W + t.x);
const tileOf = (k: number): Tile => ({ x: k % W, y: Math.floor(k / W) });
const stepTo = (t: Tile, d: Dir): Tile => ({ x: t.x + DIR_DX[d], y: t.y + DIR_DY[d] });
const entryOf = (id: string) => PLACES.find((e) => e.def.id === id)!;

/**
 * Whether `e` has doors, read from its def apart from `hasDoors`: every station, a works with a
 * crew that is no bridge platform, a decor with a crew or residents (a service stop, a house).
 */
function doorsByRule(e: Entry): boolean {
  if (e.kind === 'station') return true;
  if (e.kind === 'works') return (e.def as BuildingDef).crew > 0 && !(e.def as BuildingDef).bridge;
  const def = e.def as DecorDef;
  return def.crew > 0 || !!def.residents;
}
/**
 * The street doors of everything standing that has doors (`doorsByRule`), read from the builder's
 * lists apart from `doorPlaces`: the stations', then the works', then the decor's, each in its
 * list's order.
 */
function doorsByHand(w: World): Door[] {
  const b = w.builder;
  const out: Door[] = [];
  for (const s of b.stations) out.push(...streetOf({ def: s.def, x: s.x, y: s.y, rot: s.rot }));
  for (const k of b.buildings.values()) {
    const def = content.buildings.find((d) => d.id === k.id)!;
    if (doorsByRule({ kind: 'works', def }))
      out.push(...streetOf({ def, x: k.x, y: k.y, rot: k.rot ?? 0 }));
  }
  for (const d of b.decor.values()) {
    const def = decorDef(d.id);
    if (doorsByRule({ kind: 'decor', def }))
      out.push(...streetOf({ def, x: d.x, y: d.y, rot: d.rot }));
  }
  return out;
}
/** What no spur takes: each station's platform (a gate tile with track), each depot's gates. */
function keptOffByHand(w: World): Set<number> {
  const out = new Set<number>();
  for (const s of w.builder.stations)
    for (const g of s.gateTiles()) if (s.def.depot || w.track.has(g.x, g.y)) out.add(keyOf(g));
  return out;
}
/** A plain one-tile straight of regular or narrow track: the one piece a road may cross. */
const plainStraight = (p: TrackPiece | undefined): p is TrackPiece =>
  !!p && p.kind === 'straight' && !p.unit && p.cls !== 'high_speed';

/**
 * Whether a road may stand on `t` with the roads `roads` laid, the rules of #318 and #408 written
 * out again: on the player's land, whoever places (a spur keeps to it), on ground that is not
 * water, rock or a mountain, with no road on it, off every station and works and every decor that
 * stands off the rails, off `off`; on track only across a plain straight whose rails run on to no
 * road, and never where a level crossing beside it has its rails run on to it.
 */
function roadMayStand(w: World, t: Tile, roads: Set<number>, off: Set<number>): boolean {
  const { map, track, builder, regions } = w;
  const k = keyOf(t);
  if (k < 0 || !regions.isTileUnlocked(t.x, t.y) || roads.has(k) || off.has(k)) return false;
  const ground = map.terrain[k];
  if (ground === Terrain.Water || ground === Terrain.Rock || ground === Terrain.Mountain)
    return false;
  if (builder.stationAt(t.x, t.y) || builder.buildingAt(t.x, t.y)) return false;
  const d = builder.decorAt(t.x, t.y);
  if (d && !decorDef(d.id).onTrack) return false;
  const p = track.get(t.x, t.y);
  if (p && (!plainStraight(p) || p.links[0].some((s) => roads.has(keyOf(stepTo(t, s))))))
    return false;
  return DIRS.every((s) => {
    const n = stepTo(t, s);
    const q = roads.has(keyOf(n)) ? track.get(n.x, n.y) : undefined;
    return !plainStraight(q) || !q.links[0].includes(opposite(s));
  });
}
/**
 * The road tiles a spur may join: every run of road, tile to side-sharing tile, that holds a tile
 * which is no street door's reach.
 */
function networkByHand(roads: Set<number>, reaches: Set<number>): Set<number> {
  const out = new Set<number>();
  const done = new Set<number>();
  for (const start of roads) {
    if (done.has(start)) continue;
    const run = [start];
    done.add(start);
    for (let i = 0; i < run.length; i++)
      for (const d of DIRS) {
        const n = keyOf(stepTo(tileOf(run[i]), d));
        if (roads.has(n) && !done.has(n)) {
          done.add(n);
          run.push(n);
        }
      }
    if (run.some((k) => !reaches.has(k))) for (const k of run) out.add(k);
  }
  return out;
}
/**
 * The fewest tiles of a legal spur from `from` to the network, by exhaustive search over every
 * simple path of at most `bound` tiles: each tile one a road may stand on (`roadMayStand`) with
 * the roads and the path's tiles before it laid, the last beside a network road. Infinity when
 * there is none. A path that could not end shorter than the best found, or within the bound, is
 * cut by the Manhattan distance to the nearest network road, which never overstates what is left.
 */
function fewestLegal(
  w: World,
  from: Tile,
  roads: Set<number>,
  net: Set<number>,
  off: Set<number>,
  bound = SPUR_REACH,
): number {
  const goals = [...net].map(tileOf);
  if (!goals.length) return Infinity;
  const left = (t: Tile) =>
    Math.max(1, Math.min(...goals.map((g) => Math.abs(g.x - t.x) + Math.abs(g.y - t.y))) - 1);
  const laid = new Set(roads);
  let best = Infinity;
  const visit = (t: Tile, n: number) => {
    laid.add(keyOf(t));
    if (DIRS.some((d) => net.has(keyOf(stepTo(t, d))))) best = Math.min(best, n);
    else if (n + left(t) <= bound && n + left(t) < best)
      for (const d of DIRS) {
        const m = stepTo(t, d);
        if (roadMayStand(w, m, laid, off)) visit(m, n + 1);
      }
    laid.delete(keyOf(t));
  };
  visit(from, 1);
  return best;
}
/**
 * What is wrong with `spur`, laid for the door whose reach is `from` over `roads`, as a legal spur
 * to the network `net`; '' when nothing is.
 */
function legalFault(
  w: World,
  spur: Tile[],
  from: Tile,
  roads: Set<number>,
  net: Set<number>,
  off: Set<number>,
): string {
  if (!spur.length) return 'nothing laid';
  if (!same(spur[0], from)) return `starts at ${at(spur[0])}, not the reach ${at(from)}`;
  const laid = new Set(roads);
  for (let i = 0; i < spur.length; i++) {
    const t = spur[i];
    if (i && sideTo(spur[i - 1], t) === undefined)
      return `${at(spur[i - 1])} and ${at(t)} share no side`;
    if (!roadMayStand(w, t, laid, off)) return `${at(t)} breaks a road rule`;
    laid.add(keyOf(t));
  }
  const last = spur[spur.length - 1];
  if (!DIRS.some((d) => net.has(keyOf(stepTo(last, d)))))
    return `ends at ${at(last)}, beside no road of the network`;
  return '';
}

type SiteOp =
  | { op: 'place'; x: number; y: number; id: string; rot: number }
  | { op: 'road'; x: number; y: number };
/**
 * A seeded box of land in a ring of water, so nothing beyond it counts: some of it rough ground,
 * straights of every class and curves, roads, places standing as a save from before spurs holds
 * them (some with the reach tile of their door laid), then what the player does, placing and
 * laying roads, or the editor doing it. A third of the boxes are long and narrow, so spurs meet
 * SPUR_REACH and pass it; many run on past x 32, where the player's land ends.
 */
function genBox(rng: Rng) {
  const long = rng.chance(0.35);
  const box = {
    x: long ? rng.int(12, 19) : rng.int(22, 29),
    y: rng.int(3, 20),
    w: long ? rng.int(13, 16) : rng.int(3, 8),
    h: long ? rng.int(1, 3) : rng.int(3, 6),
  };
  const inBox = () => ({ x: box.x + rng.int(0, box.w - 1), y: box.y + rng.int(0, box.h - 1) });
  const ids = ['townhouse', 'townhouse', 'water_tower', 'fuel_stop', 'windmill', 'station'];
  const ground = Array.from({ length: rng.int(0, Math.floor((box.w * box.h) / 6)) }, () => ({
    ...inBox(),
    n: rng.int(0, 2),
  }));
  const track = Array.from({ length: rng.int(0, 5) }, () => {
    const kind = rng.chance(0.85) ? ('straight' as const) : ('curve' as const);
    return {
      ...inBox(),
      kind,
      cls: rng.pick(['regular', 'regular', 'narrow', 'high_speed'] as const),
      rot: kind === 'straight' ? rng.int(0, 1) : rng.int(0, 7),
    };
  });
  const roads = Array.from({ length: rng.int(0, 6) }, inBox);
  const old = Array.from({ length: rng.int(0, 3) }, () => ({
    ...inBox(),
    id: rng.pick([...ids, 'depot']),
    rot: rng.int(0, 3),
    stub: rng.chance(0.5),
  }));
  const ops = Array.from({ length: rng.int(1, 5) }, (): SiteOp => {
    const t = inBox();
    if (rng.chance(0.35)) return { op: 'road', ...t };
    return {
      op: 'place',
      ...t,
      id: rng.pick([...ids, 'depot', 'narrow_depot']),
      rot: rng.int(0, 3),
    };
  });
  // a long box often has its one road at its west end, and a house placed 11 to 13 tiles east of it
  // first: a spur of about SPUR_REACH tiles, or none
  if (long && rng.chance(0.6)) {
    const y = () => box.y + rng.int(0, box.h - 1);
    roads.splice(0, roads.length, { x: box.x, y: y() });
    const x = box.x + rng.int(11, 13);
    ops.unshift({ op: 'place', x, y: y(), id: 'townhouse', rot: rng.int(0, 3) });
  }
  // a quarter of them in the editor's way: no price, no lock, and still no spur off the player's land
  return { box, ground, track, roads, old, ops, free: rng.chance(0.25) };
}
type Box = ReturnType<typeof genBox>;
/** The boxes are small and quick to search: six hundred of them. */
const BOX_SEEDS = Array.from({ length: 600 }, (_, i) => i + 1);
function* shrinkBox(c: Box): Iterable<Box> {
  if (c.free) yield { ...c, free: false };
  for (const ops of shrinkArray(c.ops)) if (ops.length) yield { ...c, ops };
  for (const old of shrinkArray(c.old)) yield { ...c, old };
  for (const roads of shrinkArray(c.roads)) yield { ...c, roads };
  for (const track of shrinkArray(c.track)) yield { ...c, track };
  for (const ground of shrinkArray(c.ground)) yield { ...c, ground };
}

/** What placing `e` with its corner at (x, y) turned to `rot` would cost, and whether it may. */
function checkAt(w: World, e: Entry, x: number, y: number, rot: number) {
  if (e.kind === 'station') return w.builder.checkStation(x, y, e.def.id, rot);
  if (e.kind === 'works') return w.builder.checkBuilding(x, y, e.def.id, rot);
  return w.builder.checkDecor(x, y, e.def.id);
}
/** Place `e` through the builder; where it stands, as a place, or null when it was refused. */
function placeAt(w: World, e: Entry, x: number, y: number, rot: number): PlaceAt | null {
  const b = w.builder;
  const done =
    e.kind === 'station'
      ? b.placeStation(x, y, e.def.id, rot)
      : e.kind === 'works'
        ? b.placeBuilding(x, y, e.def.id, rot)
        : b.placeDecor(x, y, e.def.id, rot);
  return done && { def: e.def, x, y, rot: done.rot ?? 0 };
}

/** Lay the box: its water ring, its ground, its track and roads, and what stands from before. */
function boxWorld(c: Box): World {
  rules.narrowUnlocked = 1;
  const w = world();
  const { box } = c;
  for (let y = box.y - 1; y <= box.y + box.h; y++)
    for (let x = box.x - 1; x <= box.x + box.w; x++)
      if (x < box.x || y < box.y || x >= box.x + box.w || y >= box.y + box.h)
        w.map.terrain[y * W + x] = Terrain.Water;
  for (const g of c.ground)
    w.map.terrain[g.y * W + g.x] = [Terrain.Water, Terrain.Rock, Terrain.Mountain][g.n];
  freely(w, () => {
    for (const t of c.track) w.builder.placeTrack(t.x, t.y, { kind: t.kind, cls: t.cls }, t.rot);
    // on the player's land, as the player lays them; nothing with a door stands yet, so no spur
    for (const r of c.roads) if (w.regions.isTileUnlocked(r.x, r.y)) w.builder.placeRoad(r.x, r.y);
  });
  for (const o of c.old) {
    const e = entryOf(o.id);
    if (!freely(w, () => checkAt(w, e, o.x, o.y, o.rot).ok)) continue;
    const p = stand(w, e, o.x, o.y, o.rot);
    const roads = new Set(roadsOf(w).map(keyOf));
    for (const d of streetOf(p))
      if (o.stub && roadMayStand(w, d.reach, roads, keptOffByHand(w)))
        w.roads.add(d.reach.x, d.reach.y);
  }
  // the player's way from here: the region lock, and the stock to pay for anything
  stockUp(w);
  return w;
}
/** Stock enough of everything to pay for any place and any road. */
function stockUp(w: World) {
  const ids = [content.stations.defs, content.buildings, content.decor].flatMap((defs) =>
    defs.flatMap((d) => Object.keys(d.cost)),
  );
  for (const id of new Set([...ids, ...Object.keys(roadCost())])) w.stock.amounts.set(id, 1e6);
}

describe('every spur, against an exhaustive search', () => {
  // slow: seeded boxes of builder steps, every spur checked against a search, 0.7 s alone; the
  // limit is room for a busy machine
  it('is the fewest tiles a legal spur takes, or no road where none is; only the price is paid', () => {
    /**
     * spurs of more than one tile, of SPUR_REACH tiles, over track, brought by a road laid; doors
     * whose fewest legal tiles are just beyond SPUR_REACH
     */
    const seen = { spurs: 0, atBound: 0, crossings: 0, near: 0, beyond: 0 };
    forAll(
      genBox,
      (c) => {
        const w = boxWorld(c);
        const b = w.builder;
        b.free = c.free;
        c.ops.forEach((o, i) => {
          const step = `op ${i} ${JSON.stringify(o)}`;
          const before = roadsOf(w);
          const stock = Object.fromEntries(w.stock.amounts);
          const roads = new Set(before.map(keyOf));
          /** the doors that may get a spur */
          let doors: Door[];
          let price: Record<string, number>;
          let laid: Tile[];
          if (o.op === 'place') {
            const e = entryOf(o.id);
            const check = checkAt(w, e, o.x, o.y, o.rot);
            const p = placeAt(w, e, o.x, o.y, o.rot);
            expect(!!p, `${step}: ${check.reason}`).toBe(check.ok);
            laid = roadsOf(w).slice(before.length);
            if (!p) {
              expect(laid, step).toEqual([]);
              expect(Object.fromEntries(w.stock.amounts), step).toEqual(stock);
              return;
            }
            price = check.cost as Record<string, number>;
            doors = doorsByRule(e) ? streetOf(p) : [];
          } else {
            const check = b.checkRoad(o.x, o.y);
            const done = b.placeRoad(o.x, o.y);
            expect(done, `${step}: ${check.reason}`).toBe(check.ok);
            const added = roadsOf(w).slice(before.length);
            if (!done) {
              expect(added, step).toEqual([]);
              expect(Object.fromEntries(w.stock.amounts), step).toEqual(stock);
              return;
            }
            expect(check.cost, step).toEqual(c.free ? {} : roadCost());
            expect(added[0], step).toEqual({ x: o.x, y: o.y });
            laid = added.slice(1);
            roads.add(keyOf(o));
            price = check.cost as Record<string, number>;
            doors = doorsByHand(w).filter(
              (d) =>
                Math.abs(d.reach.x - o.x) + Math.abs(d.reach.y - o.y) <= SPUR_REACH &&
                !roads.has(keyOf(d.reach)),
            );
            if (laid.length) seen.near++;
          }
          expect(roadsOf(w).slice(0, before.length), step).toEqual(before);
          // the price and nothing more, however many tiles of spur were laid
          const paid = Object.fromEntries(
            Object.entries(stock).map(([id, n]) => [id, n - (price[id] ?? 0)]),
          );
          expect(Object.fromEntries(w.stock.amounts), `${step}: the stock`).toEqual(paid);
          // door by door, in the builder's order, each spur judged on the roads before it
          const off = keptOffByHand(w);
          const reaches = new Set(doorsByHand(w).map((d) => keyOf(d.reach)));
          let used = 0;
          for (const d of doors) {
            const what = `${step}: the door on ${at(d.tile)}, reach ${at(d.reach)}, laid ${JSON.stringify(laid)}`;
            if (!roadMayStand(w, d.reach, roads, off)) continue;
            const net = networkByHand(roads, reaches);
            const fewest = fewestLegal(w, d.reach, roads, net, off);
            const want = fewest < Infinity ? fewest : 0;
            const spur = laid.slice(used, used + want);
            if (fewest < Infinity) {
              expect(spur.length, `${what}: a legal spur of ${fewest} tiles`).toBe(fewest);
              expect(legalFault(w, spur, d.reach, roads, net, off), what).toBe('');
              if (spur.length > 1) seen.spurs++;
              if (spur.length === SPUR_REACH) seen.atBound++;
              if (spur.some((t) => w.track.has(t.x, t.y))) seen.crossings++;
            } else {
              expect(spur, `${what}: no road within reach`).toEqual([]);
              if (fewestLegal(w, d.reach, roads, net, off, SPUR_REACH + 2) < Infinity)
                seen.beyond++;
            }
            for (const t of spur) roads.add(keyOf(t));
            used += spur.length;
          }
          expect(laid.slice(used), `${step}: tiles laid for no door`).toEqual([]);
          // the editor lays roads off the player's land; the spurs were judged above
          if (!c.free) expect(broken(w), step).toBe('');
        });
      },
      { shrink: shrinkBox, seeds: BOX_SEEDS },
    );
    // not vacuous: spurs were laid, over track too, and for roads laid near a door
    expect(seen.spurs).toBeGreaterThanOrEqual(80);
    expect(seen.atBound).toBeGreaterThanOrEqual(4);
    expect(seen.beyond).toBeGreaterThanOrEqual(5);
    expect(seen.crossings).toBeGreaterThanOrEqual(8);
    expect(seen.near).toBeGreaterThanOrEqual(25);
  }, 30_000);

  it('is laid where the first of the shortest ways would run along a line the spur crosses', () => {
    // A line ends at (23, 7), a straight east to west; a water tower at (24, 8) faces north, so its
    // reach tile (24, 7) is where the rails of that straight run on to; a road is at (23, 9). Of
    // the shortest ways there, five tiles each, one goes north and round to cross the straight on
    // (23, 7) and down to (23, 8), but no road may cross there: its rails run on to the reach
    // tile's road. Another goes east and round by (25, 9) to (24, 9), and keeps every rule.
    const w = world();
    w.builder.free = true;
    expect(w.builder.placeTrack(23, 7, STRAIGHT, EW)).toBe(true);
    pave(w, [{ x: 23, y: 9 }]);
    const before = roadsOf(w);
    expect(w.builder.placeDecor(24, 8, 'water_tower', 2)).not.toBeNull();
    const tower = decorPlace(w.builder.decorAt(24, 8)!);
    const [door] = streetOf(tower);
    expect(door.reach).toEqual({ x: 24, y: 7 });
    const roads = new Set(before.map(keyOf));
    const net = networkByHand(roads, new Set([keyOf(door.reach)]));
    const off = keptOffByHand(w);
    expect(fewestLegal(w, door.reach, roads, net, off)).toBe(5);
    const spur = roadsOf(w).slice(before.length);
    expect(spur, `laid ${JSON.stringify(spur)}`).toHaveLength(5);
    expect(legalFault(w, spur, door.reach, roads, net, off)).toBe('');
    expect(w.builder.roadServes(tower)).toBe(true);

    // the same for a tower from before spurs, when the player lays that road
    const old = world();
    old.builder.free = true;
    expect(old.builder.placeTrack(23, 7, STRAIGHT, EW)).toBe(true);
    const was = stand(old, entryOf('water_tower'), 24, 8, 2);
    const [reach] = streetOf(was).map((d) => d.reach);
    pave(old, [{ x: 23, y: 9 }]);
    const [road, ...laid] = roadsOf(old);
    const paved = new Set([keyOf(road)]);
    const joined = networkByHand(paved, new Set([keyOf(reach)]));
    expect(laid, `laid ${JSON.stringify(laid)}`).toHaveLength(5);
    expect(legalFault(old, laid, reach, paved, joined, keptOffByHand(old))).toBe('');
    expect(old.builder.roadServes(was)).toBe(true);
  });

  it('is laid for a road laid within SPUR_REACH of the door, whichever road it joins, and not for one further', () => {
    for (const gap of [SPUR_REACH, SPUR_REACH + 1]) {
      const w = world();
      w.builder.free = true;
      // a road two tiles east of the reach tile of a house from before spurs, which has no road
      pave(w, [{ x: 12, y: 11 }]);
      const house = stand(w, HOUSE, 10, 10, 0);
      // the player lays a road `gap` tiles south of the reach tile: the spur joins the nearer road
      pave(w, [{ x: 10, y: 11 + gap }]);
      expect(roadsOf(w).slice(2), `${gap}`).toEqual(
        gap <= SPUR_REACH
          ? [
              { x: 10, y: 11 },
              { x: 11, y: 11 },
            ]
          : [],
      );
      expect(w.builder.roadServes(house), `${gap}`).toBe(gap <= SPUR_REACH);
    }
  });
});

// ------------------------------------------------------------------ no stub, in any order (#455)

const ROUGH = [Terrain.Water, Terrain.Rock, Terrain.Mountain];
const PLACED_IDS = PLACED.map((e) => e.def.id);

type BareOp =
  | { op: 'place'; id: string; x: number; y: number; rot: number }
  | { op: 'remove'; n: number }
  | { op: 'turn'; n: number }
  | { op: 'depot'; id: string; x: number; y: number };
/**
 * A seeded patch of land with no road on it and rough ground in places, and what the player does
 * there: places set down close together, taken up and turned, and the game granting its depot.
 */
function genBare(rng: Rng) {
  const spot = () => ({ x: rng.int(8, 26), y: rng.int(8, 26) });
  const ground = Array.from({ length: rng.int(0, 25) }, () => ({ ...spot(), n: rng.int(0, 2) }));
  const ops = Array.from({ length: rng.int(4, 24) }, (): BareOp => {
    const r = rng.next();
    if (r < 0.1) return { op: 'remove', n: rng.int(0, 99) };
    if (r < 0.2) return { op: 'turn', n: rng.int(0, 99) };
    if (r < 0.25) return { op: 'depot', id: rng.pick(['depot', 'narrow_depot']), ...spot() };
    return { op: 'place', id: rng.pick(PLACED_IDS), ...spot(), rot: rng.int(0, 3) };
  });
  return { ground, ops, free: rng.chance(0.4) };
}
type Bare = ReturnType<typeof genBare>;
function* shrinkBare(c: Bare): Iterable<Bare> {
  if (c.free) yield { ...c, free: false };
  for (const ops of shrinkArray(c.ops)) yield { ...c, ops };
  for (const ground of shrinkArray(c.ground)) yield { ...c, ground };
}

type Pair = ReturnType<typeof genPair>;
/**
 * A seeded place and one road to lay, either side of SPUR_REACH tiles from its door, over rough
 * ground and lines of track, paying or in the editor's way.
 */
function genPair(rng: Rng) {
  const corner = { x: rng.int(8, 22), y: rng.int(8, 22) };
  const within = (v: number) => Math.min(30, Math.max(1, v));
  const near = (reach: number) => ({
    x: within(corner.x + rng.int(-reach, reach)),
    y: within(corner.y + rng.int(-reach, reach)),
  });
  const reach = rng.chance(0.25) ? 16 : 9;
  return {
    id: rng.pick(PLACED_IDS),
    ...corner,
    rot: rng.int(0, 3),
    road: near(reach),
    ground: Array.from({ length: rng.int(0, 16) }, () => ({ ...near(8), n: rng.int(0, 2) })),
    lines: Array.from({ length: rng.int(0, 2) }, () => ({
      ...near(8),
      n: rng.int(3, 10),
      across: rng.chance(0.5),
      cls: rng.pick(['regular', 'regular', 'narrow', 'high_speed'] as const),
    })),
    free: rng.chance(0.3),
  };
}
function* shrinkPair(c: Pair): Iterable<Pair> {
  if (c.free) yield { ...c, free: false };
  for (const lines of shrinkArray(c.lines)) yield { ...c, lines };
  for (const ground of shrinkArray(c.ground)) yield { ...c, ground };
}
/** The ground of a pair, with its track and the platform a station needs, and the stock to pay. */
function pairWorld(c: Pair): World {
  rules.narrowUnlocked = 1;
  const w = world();
  for (const g of c.ground) w.map.terrain[g.y * W + g.x] = ROUGH[g.n];
  freely(w, () => {
    for (const l of c.lines)
      for (let k = 0; k < l.n; k++)
        w.builder.placeTrack(
          l.across ? l.x + k : l.x,
          l.across ? l.y : l.y + k,
          { kind: 'straight', cls: l.cls },
          l.across ? EW : NS,
        );
  });
  if (wantsTrack(entryOf(c.id))) platformFor(w, c.rot, c);
  stockUp(w);
  w.builder.free = c.free;
  return w;
}
/** The pair's place set down and its road laid, in one order or the other. */
function inOrder(c: Pair, roadFirst: boolean) {
  const w = pairWorld(c);
  const told: string[] = [];
  w.builder.onRoadChanged = (x, y) => told.push(at({ x, y }));
  const done = { placed: false, laid: false };
  const lay = () => (done.laid = w.builder.placeRoad(c.road.x, c.road.y));
  const set = () => (done.placed = !!placeAt(w, entryOf(c.id), c.x, c.y, c.rot));
  if (roadFirst) {
    lay();
    set();
  } else {
    set();
    lay();
  }
  return { w, told, roads: roadsOf(w), ...done };
}

/**
 * The ground a place of any kind needs at `corner`, turned to `rot`, beyond grass: track beside a
 * station, a hill under a works that wants one, the deposit a works mines, and water on a side of
 * its footprint, the one furthest from its street door.
 */
function groundFor(w: World, e: Entry, rot: number, corner: Tile) {
  if (wantsTrack(e)) platformFor(w, rot, corner);
  const wants = e.def as { terrain?: string; deposit?: string; needsWater?: boolean };
  const k = corner.y * W + corner.x;
  if (wants.terrain === 'hill') w.map.terrain[k] = Terrain.Hill;
  if (wants.deposit)
    w.map.props.set(k, [{ kind: wants.deposit as PropInstance['kind'], variant: 0, ox: 0, oy: 0 }]);
  if (wants.needsWater) {
    const p: PlaceAt = { def: e.def, x: corner.x, y: corner.y, rot };
    const [door] = streetOf(p);
    const apart = (t: Tile) => Math.abs(t.x - door.reach.x) + Math.abs(t.y - door.reach.y);
    const [side] = ringOf(tilesOf(p))
      .filter((t) => !w.track.has(t.x, t.y) && !same(t, door.reach))
      .sort((a, b) => apart(b) - apart(a));
    w.map.terrain[side.y * W + side.x] = Terrain.Water;
  }
}

describe('a place and a road, with no stub between them (#455)', () => {
  // slow: 200 seeds of up to 24 builder steps, 1.5 s alone; the limit is room for a busy machine
  it('a patch with no road stays without one, whatever is placed, turned and taken up on it', () => {
    const seen = { placed: 0, removed: 0, turned: 0, depots: 0, crowded: 0 };
    forAll(
      genBare,
      (c) => {
        rules.narrowUnlocked = 1;
        const w = world();
        for (const g of c.ground) w.map.terrain[g.y * W + g.x] = ROUGH[g.n];
        stockUp(w);
        w.builder.free = c.free;
        const told: string[] = [];
        w.builder.onRoadChanged = (x, y) => told.push(at({ x, y }));
        c.ops.forEach((o, i) => {
          const step = `op ${i} ${JSON.stringify(o)}`;
          if (o.op === 'place') {
            const e = entryOf(o.id);
            if (wantsTrack(e)) platformFor(w, o.rot, o);
            if (placeAt(w, e, o.x, o.y, o.rot)) seen.placed++;
          } else if (o.op === 'depot') {
            if (ensureStartDepot(w.builder, o.id, o)) seen.depots++;
          } else {
            const standing = w.builder.doorPlaces();
            const p = standing[o.n % Math.max(1, standing.length)];
            if (p && remove(w, p)) {
              seen.removed++;
              if (o.op === 'turn' && placeAt(w, entryOf(p.def.id), p.x, p.y, p.rot + 1))
                seen.turned++;
            }
          }
          // not one road tile, none told to the renderer
          expect(roadsOf(w), step).toEqual([]);
          expect(told, step).toEqual([]);
        });
        const places = w.builder.doorPlaces();
        for (const p of places)
          expect(w.builder.roadServes(p), `${p.def.id} at ${p.x},${p.y}`).toBe(false);
        // places whose doors face the footprints of others, as they do in a town
        const doors = places.flatMap(streetOf);
        for (const p of places)
          if (doors.some((d) => tilesOf(p).some((t) => same(t, d.reach)))) seen.crowded++;
      },
      { shrink: shrinkBare, seeds: Array.from({ length: 200 }, (_, i) => i + 1) },
    );
    // not vacuous: places stood, were taken up and turned, depots granted, doors faced footprints
    expect(seen.placed).toBeGreaterThanOrEqual(1000);
    expect(seen.removed).toBeGreaterThanOrEqual(250);
    expect(seen.turned).toBeGreaterThanOrEqual(120);
    expect(seen.depots).toBeGreaterThanOrEqual(70);
    expect(seen.crowded).toBeGreaterThanOrEqual(20);
  }, 30_000);

  // slow: 400 seeds, two worlds each, 0.7 s alone; the limit is room for a busy machine
  it('come to the same roads whichever is first: the road laid after a place brings the spur the road before it would', () => {
    const seen = { compared: 0, refused: 0, spurs: 0, bare: 0, atBound: 0, crossings: 0 };
    forAll(
      genPair,
      (c) => {
        const first = inOrder(c, false);
        const second = inOrder(c, true);
        // each tile laid is told, in the order laid, and nothing else is
        expect(first.told, 'place then road: told').toEqual(first.roads.map(at));
        expect(second.told, 'road then place: told').toEqual(second.roads.map(at));
        // a place on the road, or a road on the place, is refused in one order and not the other
        if (!(first.placed && first.laid && second.placed && second.laid)) {
          seen.refused++;
          return;
        }
        seen.compared++;
        expect(second.roads, 'road then place, against place then road').toEqual(first.roads);
        const spur = first.roads.length - 1;
        if (spur === 0) seen.bare++;
        else if (spur > 1) seen.spurs++;
        if (spur === SPUR_REACH) seen.atBound++;
        if (first.roads.some((t) => first.w.track.has(t.x, t.y))) seen.crossings++;
      },
      { shrink: shrinkPair, seeds: Array.from({ length: 400 }, (_, i) => i + 1) },
    );
    // not vacuous: both orders were compared, with spurs laid, none laid, at the bound, over track
    expect(seen.compared).toBeGreaterThanOrEqual(250);
    expect(seen.spurs).toBeGreaterThanOrEqual(120);
    expect(seen.bare).toBeGreaterThanOrEqual(60);
    expect(seen.atBound).toBeGreaterThanOrEqual(15);
    expect(seen.crossings).toBeGreaterThanOrEqual(8);
  }, 15_000);

  it('grants the start depot its spur to a road within SPUR_REACH tiles, free, and none to a road beyond', () => {
    rules.narrowUnlocked = 1;
    for (const id of ['depot', 'narrow_depot'])
      for (const near of [true, false]) {
        const what = `${id}, road ${near ? 'near' : 'far'}`;
        const w = world();
        if (near) roadRow(w);
        else pave(w, [{ x: 31, y: 31 }]);
        const before = roadsOf(w);
        // a builder that pays, with nothing in stock: the grant and its spur cost nothing
        const depot = ensureStartDepot(w.builder, id, { x: 16, y: 12 });
        expect(depot, what).not.toBeNull();
        const place = stationPlace(depot!);
        const [door] = streetOf(place);
        const after = roadsOf(w);
        expect(after.slice(0, before.length), what).toEqual(before);
        const spur = after.slice(before.length);
        expect(
          Object.values(Object.fromEntries(w.stock.amounts)).every((n) => n === 0),
          what,
        ).toBe(true);
        expect(w.builder.roadServes(place), what).toBe(near);
        if (!near) {
          expect(spur, what).toEqual([]);
          continue;
        }
        expect(spurProblem(spur, door, before), what).toBe('');
        const gates = depot!.gateTiles();
        for (const t of spur)
          expect(
            gates.some((g) => same(g, t)),
            `${what} ${at(t)}`,
          ).toBe(false);
        expect(broken(w), what).toBe('');
      }
  });

  // slow: 540 worlds, 0.7 s alone; the limit is room for a busy machine
  it('holds for every kind of place with a door, at every turn: no road, or the straight spur to a road at the bound, and none one tile past it', () => {
    const at15 = { x: 15, y: 15 };
    const seen = { cases: 0, bare: 0, spurs: 0, past: 0, kinds: new Set<string>() };
    for (const e of PLACES)
      for (const rot of ROTATIONS) {
        const ghost: PlaceAt = { def: e.def, x: at15.x, y: at15.y, rot };
        const doors = streetOf(ghost);
        expect(doors, label(e, rot)).toHaveLength(1);
        const [door] = doors;
        const out = sideTo(door.tile, door.reach)!;
        const along = (k: number) => ({
          x: door.reach.x + DIR_DX[out] * k,
          y: door.reach.y + DIR_DY[out] * k,
        });
        // no road at all, then a road `gap` tiles out from the reach tile, on the line away from the
        // door, laid before the place or after it
        for (const gap of [0, SPUR_REACH, SPUR_REACH + 1])
          for (const roadFirst of gap ? [true, false] : [false]) {
            const what = `${label(e, rot)}, ${gap ? `road ${gap} out, ${roadFirst ? 'first' : 'second'}` : 'no road'}`;
            const w = world();
            w.builder.free = true;
            groundFor(w, e, rot, at15);
            const told: string[] = [];
            w.builder.onRoadChanged = (x, y) => told.push(at({ x, y }));
            const lay = () => gap && pave(w, [along(gap)]);
            const set = () => {
              const why = checkAt(w, e, at15.x, at15.y, rot).reason;
              const p = placeAt(w, e, at15.x, at15.y, rot);
              expect(p, `${what}: ${why}`).not.toBeNull();
              return p!;
            };
            let p: PlaceAt;
            if (roadFirst) {
              lay();
              p = set();
            } else {
              p = set();
              lay();
            }
            const spur =
              gap && gap <= SPUR_REACH ? Array.from({ length: gap }, (_, k) => along(k)) : [];
            const want = gap ? [along(gap), ...spur] : [];
            expect(roadsOf(w), what).toEqual(want);
            expect(told, `${what}: told`).toEqual(want.map(at));
            expect(w.builder.roadServes(p), what).toBe(spur.length > 0);
            seen.cases++;
            seen.kinds.add(e.def.id);
            if (!gap) seen.bare++;
            else if (spur.length) seen.spurs++;
            else seen.past++;
          }
      }
    // not vacuous: every kind with a door, at four turns, with nothing, a spur and a road too far
    expect(seen.kinds.size).toBe(PLACES.length);
    expect(seen.cases).toBe(PLACES.length * ROTATIONS.length * 5);
    expect(seen.bare).toBe(PLACES.length * ROTATIONS.length);
    expect(seen.spurs).toBe(PLACES.length * ROTATIONS.length * 2);
    expect(seen.past).toBe(PLACES.length * ROTATIONS.length * 2);
  }, 15_000);
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

describe('a walker from a door with no road outside it (#455)', () => {
  it('steps out on the tile outside the door, track across it or none, and walks off the road to the other door', () => {
    const w = world();
    w.builder.free = true;
    // a line east to west along row 11, a passenger station on it at (20, 10), a house at (10, 10)
    for (let x = 16; x <= 26; x++) w.track.place(x, 11, 'straight', EW, 'regular');
    const st = w.builder.placeStation(20, 10, 'station', 0)!;
    expect(st).not.toBeNull();
    expect(w.builder.placeDecor(10, 10, 'townhouse', 0)).not.toBeNull();
    // nothing near them is a road, so no door got a tile of one
    expect(roadsOf(w)).toEqual([]);
    const house = decorPlace(w.builder.decorAt(10, 10)!);
    const [home] = streetOf(house);
    const [station] = streetOf(stationPlace(st));
    const crossing = (x: number, y: number) => w.roads.isCrossing(x, y);
    expect(doorstep(w.map, home, crossing)).toEqual(home.reach);
    expect(doorstep(w.map, station, crossing)).toEqual(station.reach);
    // a straight laid across the tile outside the house's door is no level crossing: nobody is
    // set down beside it instead
    expect(w.builder.placeTrack(home.reach.x, home.reach.y, STRAIGHT, EW)).toBe(true);
    expect(doorstep(w.map, home, crossing)).toEqual(home.reach);

    const people = new PeopleSim(w.map, w.builder, new Rng(3));
    let walk: { x: number; y: number }[] | null = null;
    for (let t = 0; t < 4000 && !walk; t++) {
      people.tick(1, 12, 0.5);
      const p = people.persons.find((q) => q.home === 'd10,10' && q.state === 'toStation');
      if (p) walk = p.path;
    }
    expect(walk, 'a walk from the house to the station').not.toBeNull();
    const path = walk!;
    expect(path[0]).toEqual(home.reach);
    expect(path.at(-1)).toEqual(station.reach);
    expect(path).toEqual(findWalk(w.map, home.reach, station.reach, w.roads));
    // every step is off a road, there being none
    expect(path.slice(1).some((t, i) => roadStep(w.roads, path[i], t))).toBe(false);
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
