import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { TERRAIN_NAMES, Terrain, type GameMap } from '../world/tiles';
import { RegionState } from '../world/regions';
import {
  TRACK_ITEMS,
  TrackGraph,
  footprintOf,
  type TrackItem,
  type TrackPiece,
} from '../world/track';
import { Rng } from '../engine/rng';
import { DIRS, DIR_DX, DIR_DY, Dir, opposite } from '../engine/iso';
import { STR } from '../strings';
import { content } from '../data/content';
import { Builder, decorDef, type LinePiece } from './build';
import { Economy } from './economy';
import { resetStationIds, stationFootprint } from './stations';
import { resetTrainIds } from './trains';
import { rules, DEFAULT_RULES } from './rules';
import { SimStep, startStock, type StepDomains } from './step';
import { Roads, SPUR_REACH, crossable, findSpur, roadCost } from './roads';
import { streetDoor } from './doors';
import {
  PeopleSim,
  OFF_ROAD_STEP,
  ROAD_SPEED_MUL,
  WALK_MARGIN,
  WALK_SPEED,
  BOARDING_SPEED_MUL,
  findWalk,
  roadStep,
  walkSpeed,
  walkable,
  type Person,
} from './people';
import { SAVE_VERSION, migrate, readSaveText, type SaveGame } from './save';
import { buildingFromJSON, buildingToJSON } from './buildings';
import { repairBuiltRoads, repairBuiltTiles } from '../engine/loadRepair';
import { bridgeSpan } from './bridges';
import { SEEDS, forAll, shrinkArray } from '../testing/property';
import { simWorld, line, station } from '../testing/simWorld';
import { depotWith, storeWith } from '../testing/storeFixtures';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  resetStationIds(1);
  resetTrainIds(1);
  vi.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error('the roads drew from Math.random');
  });
});
afterEach(() => vi.restoreAllMocks());

const W = 64;
const STRAIGHT: TrackItem = { kind: 'straight', cls: 'regular' };
const NARROW: TrackItem = { kind: 'straight', cls: 'narrow' };
const HIGH_SPEED: TrackItem = { kind: 'straight', cls: 'high_speed' };
/** A straight's turn: 0 runs north to south, 1 east to west. */
const NS = 0;
const EW = 1;

/**
 * A grass map of 64 by 64 tiles, four chunks of which the player owns the north-west one (x and y
 * below 32), and a builder that pays from a depot there: nothing in it until a test puts it there.
 */
function world(seed = 7) {
  const map = emptyMap(seed, W, W, Terrain.Grass);
  const regions = new RegionState(map);
  regions.load([true, false, false, false]);
  const track = new TrackGraph(W, W);
  // the depot the builder pays from, in reach of the whole owned chunk
  const { stores, depot: stock } = storeWith({}, { x: 16, y: 16 });
  const builder = new Builder(map, regions, track, new Economy(), stores);
  return { map, regions, track, stock, builder, roads: builder.roads };
}
type World = ReturnType<typeof world>;

/** Lay a piece in the editor's way (no price), failing the test when it is refused. */
function lay(w: World, x: number, y: number, item: TrackItem, rot: number) {
  const was = w.builder.free;
  w.builder.free = true;
  const ok = w.builder.placeTrack(x, y, item, rot);
  w.builder.free = was;
  expect(
    ok,
    `${item.kind} ${item.cls} at ${x},${y}: ${w.builder.checkTrack(x, y, item, rot).reason}`,
  ).toBe(true);
}
/** Lay roads free of charge, failing the test when one is refused. */
function pave(w: World, tiles: [number, number][]) {
  const was = w.builder.free;
  w.builder.free = true;
  for (const [x, y] of tiles)
    expect(
      w.builder.placeRoad(x, y),
      `road at ${x},${y}: ${w.builder.checkRoad(x, y).reason}`,
    ).toBe(true);
  w.builder.free = was;
}
/** The track as JSON: every piece by its tile, the version counter aside. */
const trackOf = (track: TrackGraph) => JSON.stringify([...track.pieces.entries()]);
const refusal = (w: World, x: number, y: number) => w.builder.checkRoad(x, y).reason ?? null;

// ------------------------------------------------------------------ laying a road

describe('laying a road', () => {
  it('costs stone and nothing else, as track.json gives it', () => {
    const cost = roadCost();
    expect(cost).toBe(content.track.road.cost);
    expect(Object.keys(cost)).toEqual(['stone']);
    expect(cost.stone).toBeGreaterThan(0);
    const w = world();
    w.stock.add('stone', 10);
    w.stock.add('wood', 10);
    w.stock.add('iron', 10);
    expect(w.builder.checkRoad(5, 5)).toEqual({
      ok: true,
      cost: { stone: cost.stone },
      payer: w.stock.key,
    });
    expect(w.builder.placeRoad(5, 5)).toBe(true);
    expect(w.roads.has(5, 5)).toBe(true);
    expect(w.stock.get('stone')).toBe(10 - cost.stone);
    for (const id of ['wood', 'iron']) expect(w.stock.get(id), id).toBe(10);
  });

  it('scales with the build cost tuning, as everything built does', () => {
    rules.buildCostMul = 3;
    const w = world();
    expect(w.builder.checkRoad(5, 5).cost).toEqual({ stone: 3 * roadCost().stone });
  });

  it('is refused without the stone, and takes nothing', () => {
    const w = world();
    w.stock.add('stone', roadCost().stone - 1);
    const was = JSON.stringify([...w.stock.amounts]);
    const c = w.builder.checkRoad(5, 5);
    expect(c.ok).toBe(false);
    expect(c.reason).toBe(STR.build.noStoreInReach(rules.buildReach, `1 stone`));
    expect(w.builder.placeRoad(5, 5)).toBe(false);
    expect(w.roads.has(5, 5)).toBe(false);
    expect(w.roads.size).toBe(0);
    expect(JSON.stringify([...w.stock.amounts])).toBe(was);
  });

  it('goes only on owned land', () => {
    const w = world();
    w.stock.add('stone', 100);
    expect(refusal(w, 31, 31)).toBeNull();
    for (const [x, y] of [
      [32, 5],
      [5, 32],
      [40, 40],
    ] as const) {
      expect(refusal(w, x, y), `${x},${y}`).toBe(STR.build.locked);
      expect(w.builder.placeRoad(x, y)).toBe(false);
    }
    expect(refusal(w, -1, 5)).toBe(STR.build.offMap);
    expect(refusal(w, 5, W)).toBe(STR.build.offMap);
    expect(w.roads.size).toBe(0);
    expect(w.stock.get('stone')).toBe(100);
  });

  it('goes only on buildable land: never on water, rock or a mountain', () => {
    const w = world();
    w.builder.free = true;
    const grounds: [Terrain, string | null][] = [
      [Terrain.Grass, null],
      [Terrain.Forest, null],
      [Terrain.Sand, null],
      [Terrain.Hill, null],
      [Terrain.Water, STR.build.nothingOn.water],
      [Terrain.Rock, STR.build.nothingOn.rock],
      [Terrain.Mountain, STR.build.nothingOn.mountain],
    ];
    grounds.forEach(([t, why], i) => {
      w.map.terrain[3 * W + 2 + 2 * i] = t;
      expect(refusal(w, 2 + 2 * i, 3), TERRAIN_NAMES[t]).toBe(why);
      expect(w.builder.placeRoad(2 + 2 * i, 3), TERRAIN_NAMES[t]).toBe(why === null);
    });
  });

  it('is refused on any tile of a station, a works or a house (#408)', () => {
    const w = world();
    w.builder.free = true;
    lay(w, 10, 10, STRAIGHT, EW);
    lay(w, 11, 10, STRAIGHT, EW);
    lay(w, 12, 10, STRAIGHT, EW);
    const depot = w.builder.placeStation(2, 20, 'depot')!;
    const farm = w.builder.placeStation(11, 11, 'farm')!;
    expect(depot).not.toBeNull();
    expect(farm).not.toBeNull();
    expect(w.builder.placeBuilding(20, 20, 'windmill')).not.toBeNull();
    expect(w.builder.placeDecor(5, 5, 'townhouse', 0)).not.toBeNull();
    expect(w.builder.placeDecor(7, 5, 'water_tower', 0)).not.toBeNull();
    const taken = [
      ...depot.footprint(),
      ...farm.footprint(),
      { x: 20, y: 20 },
      { x: 5, y: 5 },
      { x: 7, y: 5 },
    ];
    expect(depot.footprint().length).toBeGreaterThan(1);
    // the roads there are the places laid at their doors, no road being near (#408)
    const laid = w.roads.toJSON();
    const reaches = w.builder.streetDoors().map((d) => `${d.reach.x},${d.reach.y}`);
    for (const [x, y] of laid) expect(reaches, `${x},${y}`).toContain(`${x},${y}`);
    for (const t of taken) {
      expect(refusal(w, t.x, t.y), `${t.x},${t.y}`).toBe(STR.build.roadOnBuilding);
      expect(w.builder.placeRoad(t.x, t.y)).toBe(false);
    }
    expect(w.roads.toJSON()).toEqual(laid);
  });

  it('may share its tile with a signal or a power pole', () => {
    const w = world();
    w.builder.free = true;
    lay(w, 10, 10, STRAIGHT, EW);
    expect(w.builder.placeDecor(10, 10, 'signal', 0)).not.toBeNull();
    expect(w.builder.placeDecor(4, 4, 'power_line', 0)).not.toBeNull();
    expect(decorDef('signal').onTrack && decorDef('power_line').onTrack).toBe(true);
    expect(w.builder.placeRoad(10, 10)).toBe(true);
    expect(w.builder.placeRoad(4, 4)).toBe(true);
    // and the other way round
    expect(w.builder.placeRoad(12, 12)).toBe(true);
    expect(w.builder.placeDecor(12, 12, 'power_line', 0)).not.toBeNull();
  });

  it('keeps its tile from a station, a works, a platform or a house laid after it', () => {
    const w = world();
    w.builder.free = true;
    lay(w, 10, 10, STRAIGHT, EW);
    // the last tile of the shed a depot at (2, 20) would cover
    const shed = stationFootprint('depot', 2, 20, 0).at(-1)!;
    pave(w, [
      [10, 11],
      [20, 20],
      [5, 5],
      [shed.x, shed.y],
    ]);
    expect(w.builder.checkStation(10, 11, 'farm').reason).toBe(STR.build.roadInWay);
    expect(w.builder.checkStation(2, 20, 'depot').reason).toBe(STR.build.roadInWay);
    expect(w.builder.checkBuilding(20, 20, 'windmill').reason).toBe(STR.build.roadInWay);
    expect(w.builder.checkBuilding(20, 20, 'bridge_wood').reason).toBe(STR.build.roadInWay);
    expect(w.builder.canPlaceDecor(5, 5, 'townhouse')).toBe(STR.build.roadInWay);
    expect(w.builder.canPlaceDecor(5, 5, 'water_tower')).toBe(STR.build.roadInWay);
    // a town raising a house goes by the same rule
    expect(w.builder.spawnDecor(5, 5, 'townhouse', 0)).toBeNull();
    expect(w.builder.stations).toHaveLength(0);
    expect(w.builder.buildings.size).toBe(0);
    expect(w.builder.decor.size).toBe(0);
  });

  it('is refused where a road lies already, at no charge', () => {
    const w = world();
    w.stock.add('stone', 10);
    expect(w.builder.placeRoad(5, 5)).toBe(true);
    expect(refusal(w, 5, 5)).toBe(STR.build.roadHere);
    expect(w.builder.placeRoad(5, 5)).toBe(false);
    expect(w.stock.get('stone')).toBe(10 - roadCost().stone);
  });

  it('comes up for the refund share of its cost, the track of a crossing staying', () => {
    rules.refundRate = 1;
    const w = world();
    w.stock.add('stone', 10);
    lay(w, 6, 6, STRAIGHT, EW);
    const track = trackOf(w.track);
    expect(w.builder.placeRoad(6, 6)).toBe(true);
    expect(w.builder.roadRefund()).toEqual(roadCost());
    expect(w.builder.removeRoad(6, 6)).toBe(true);
    expect(w.stock.get('stone')).toBe(10);
    expect(w.roads.has(6, 6)).toBe(false);
    expect(trackOf(w.track)).toBe(track);
    // nothing to take up: nothing given
    expect(w.builder.removeRoad(6, 6)).toBe(false);
    expect(w.stock.get('stone')).toBe(10);
    // at the shipped refund share, what roadRefund says is what comes back
    rules.refundRate = DEFAULT_RULES.refundRate;
    expect(w.builder.placeRoad(6, 6)).toBe(true);
    const before = w.stock.get('stone');
    const back = w.builder.roadRefund().stone ?? 0;
    expect(w.builder.removeRoad(6, 6)).toBe(true);
    expect(w.stock.get('stone')).toBe(before + back);
  });

  it('tells the game which tile changed, once a change', () => {
    const w = world();
    w.builder.free = true;
    const seen: string[] = [];
    w.builder.onRoadChanged = (x, y) => seen.push(`${x},${y}`);
    w.builder.placeRoad(3, 4);
    w.builder.placeRoad(3, 4);
    w.builder.removeRoad(3, 4);
    w.builder.removeRoad(3, 4);
    w.builder.placeRoad(-1, 4);
    expect(seen).toEqual(['3,4', '3,4']);
  });
});

// ------------------------------------------------------------------ roads on bridge platforms

describe('a road on a bridge platform (#493)', () => {
  /** A world whose row 10, x from 12 to 16, is water: a river a bridge may span. */
  function river() {
    const w = world();
    w.builder.free = true;
    for (let x = 12; x <= 16; x++) w.map.terrain[10 * W + x] = Terrain.Water;
    return w;
  }
  const PLATFORMS = ['bridge_wood', 'bridge_stone'];

  it('goes on a platform with no rail, over water and over land, at a road price', () => {
    for (const id of PLATFORMS) {
      const w = river();
      expect(w.builder.placeBuilding(13, 10, id), id).not.toBeNull();
      expect(w.builder.placeBuilding(20, 20, id), id).not.toBeNull();
      w.builder.free = false;
      expect(w.builder.checkRoad(13, 10).cost, id).toEqual(w.builder.checkRoad(5, 5).cost);
      w.builder.free = true;
      pave(w, [
        [13, 10],
        [20, 20],
      ]);
      expect(w.builder.buildingAt(13, 10)?.id, id).toBe(id);
    }
  });

  it('is refused on water with no platform under it, and on rock or a mountain', () => {
    const w = river();
    expect(refusal(w, 14, 10)).toBe(STR.build.nothingOn.water);
    expect(w.builder.placeRoad(14, 10)).toBe(false);
    // no platform stands on rock or a mountain, so none carries a road there
    for (const t of [Terrain.Rock, Terrain.Mountain]) {
      w.map.terrain[3 * W + 3] = t;
      expect(w.builder.placeBuilding(3, 3, 'bridge_wood')).toBeNull();
      expect(refusal(w, 3, 3)).not.toBeNull();
    }
    expect(w.roads.size).toBe(0);
  });

  it('never shares its tile with rail, whichever is laid first', () => {
    const w = river();
    // rail first: the platform carries rail, and a road is refused there
    expect(
      w.builder.placeLine([
        { kind: 'platform', x: 13, y: 10, defId: 'bridge_wood' },
        { kind: 'track', x: 13, y: 10, item: STRAIGHT, rot: NS },
      ]),
    ).toBe(true);
    expect(refusal(w, 13, 10)).toBe(STR.build.bridgeCarriesRail);
    expect(w.builder.placeRoad(13, 10)).toBe(false);
    // a road first: the platform carries the road, and rail is refused there, alone or in a line
    expect(w.builder.placeBuilding(15, 10, 'bridge_stone')).not.toBeNull();
    pave(w, [[15, 10]]);
    const track = trackOf(w.track);
    for (const item of [STRAIGHT, NARROW])
      for (const rot of [NS, EW]) {
        expect(w.builder.checkTrack(15, 10, item, rot).reason).toBe(STR.build.bridgeCarriesRoad);
        expect(w.builder.placeTrack(15, 10, item, rot)).toBe(false);
        const c = w.builder.checkLine([{ kind: 'track', x: 15, y: 10, item, rot }]);
        expect(c.reason).toBe(STR.build.bridgeCarriesRoad);
      }
    expect(trackOf(w.track)).toBe(track);
    // and a road on land still makes a level crossing with track laid after it
    pave(w, [[5, 5]]);
    lay(w, 5, 5, STRAIGHT, EW);
    expect(w.roads.isCrossing(5, 5)).toBe(true);
  });

  it('keeps its platform: the platform comes up only once the road is off, as with rail', () => {
    rules.refundRate = 1;
    const w = river();
    w.builder.free = false;
    w.stock.add('stone', 100);
    w.stock.add('wood', 100);
    expect(w.builder.placeBuilding(13, 10, 'bridge_wood')).not.toBeNull();
    expect(w.builder.placeRoad(13, 10)).toBe(true);
    const stock = JSON.stringify([...w.stock.amounts]);
    expect(w.builder.removeBuilding(13, 10)).toBe(false);
    expect(w.builder.buildingAt(13, 10)?.id).toBe('bridge_wood');
    expect(w.roads.has(13, 10)).toBe(true);
    expect(JSON.stringify([...w.stock.amounts])).toBe(stock);
    expect(w.builder.removeRoad(13, 10)).toBe(true);
    expect(w.builder.removeBuilding(13, 10)).toBe(true);
    expect(w.builder.buildingAt(13, 10)).toBeUndefined();
  });

  it('is never a spur: a door near a platform gets its road round it', () => {
    const w = river();
    // a road north of the river, platforms all across it, and a house south of it: the spur
    // straight over a platform would be the shortest, and it goes round the river instead
    for (let x = 12; x <= 16; x++)
      expect(w.builder.placeBuilding(x, 10, 'bridge_wood')).not.toBeNull();
    pave(w, [
      [14, 7],
      [14, 8],
    ]);
    expect(w.builder.placeDecor(14, 12, 'townhouse', 0)).not.toBeNull();
    expect(w.roads.size, 'the spur').toBeGreaterThan(2);
    for (let x = 12; x <= 16; x++) expect(w.roads.has(x, 10), `${x}`).toBe(false);
  });

  it('comes back through a save and a load, and the load repair leaves it', () => {
    const w = river();
    for (let x = 12; x <= 16; x++)
      expect(w.builder.placeBuilding(x, 10, 'bridge_wood')).not.toBeNull();
    pave(w, [[11, 10], ...Array.from({ length: 5 }, (_, i) => [12 + i, 10] as [number, number])]);
    const read = readSaveText(
      JSON.stringify({
        ...oldSave(SAVE_VERSION),
        buildings: [...w.builder.buildings.values()].map(buildingToJSON),
        roads: w.roads.toJSON(),
      }),
    );
    if (!('save' in read)) throw new Error(read.error);
    expect(read.save.version).toBe(SAVE_VERSION);
    const back = river();
    for (const j of read.save.buildings ?? []) {
      const b = buildingFromJSON(j);
      back.builder.buildings.set(back.track.key(b.x, b.y), b);
    }
    back.roads.load(read.save.roads);
    for (const { x, y } of repairBuiltRoads(back.map, read.save)) back.roads.remove(x, y);
    expect(back.roads.toJSON()).toEqual(w.roads.toJSON());
    for (let x = 12; x <= 16; x++) {
      expect(back.builder.bridgeAt(x, 10), `${x}`).toBeTruthy();
      // the loaded platform keeps the rule: no rail on it, and it stays while its road does
      expect(back.builder.checkTrack(x, 10, STRAIGHT, EW).reason).toBe(STR.build.bridgeCarriesRoad);
      expect(back.builder.removeBuilding(x, 10)).toBe(false);
    }
  });
});

// ------------------------------------------------------------------ level crossings

describe('a level crossing', () => {
  it('is a road across a straight of regular or narrow track; the track is not changed', () => {
    for (const item of [STRAIGHT, NARROW])
      for (const rot of [NS, EW]) {
        const w = world();
        w.stock.add('stone', 10);
        // the line, two tiles either side of the crossing
        const along = (i: number): [number, number] => (rot === EW ? [8 + i, 10] : [10, 8 + i]);
        for (let i = 0; i < 5; i++) lay(w, ...along(i), item, rot);
        const track = trackOf(w.track);
        const version = w.track.version;
        // the road across it: on the line, then on either side
        const across = (i: number): [number, number] => (rot === EW ? [10, 9 + i] : [9 + i, 10]);
        for (let i = 0; i < 3; i++) {
          const [x, y] = across(i);
          expect(refusal(w, x, y), `${item.cls} ${rot} ${x},${y}`).toBeNull();
          expect(w.builder.placeRoad(x, y)).toBe(true);
        }
        expect(trackOf(w.track), 'the track').toBe(track);
        expect(w.track.version, 'the track version').toBe(version);
        expect(w.roads.isCrossing(10, 10)).toBe(true);
        expect([...w.roads.crossingKeys()]).toEqual([w.track.key(10, 10)]);
        // the road joins across the line and nowhere along it
        const bits = rot === EW ? (1 << 0) | (1 << 2) : (1 << 1) | (1 << 3);
        expect(w.roads.joins(10, 10)).toBe(bits);
      }
  });

  it('is refused along the track: no road runs on to the next tile of its line', () => {
    const w = world();
    w.builder.free = true;
    for (let x = 8; x <= 12; x++) lay(w, x, 10, STRAIGHT, EW);
    pave(w, [[10, 10]]);
    // the next tiles of the line, track on them
    expect(refusal(w, 9, 10)).toBe(STR.build.crossingAlong);
    expect(refusal(w, 11, 10)).toBe(STR.build.crossingAlong);
    // a road beyond the end of the line, where the crossing's rails run on to it
    const end = world();
    end.builder.free = true;
    lay(end, 10, 10, STRAIGHT, EW);
    pave(end, [[10, 10]]);
    expect(refusal(end, 11, 10)).toBe(STR.build.crossingAlong);
    expect(refusal(end, 9, 10)).toBe(STR.build.crossingAlong);
    expect(refusal(end, 10, 11)).toBeNull();
    // and a road already lying beyond the end: then the crossing is the one refused
    const before = world();
    before.builder.free = true;
    lay(before, 10, 10, STRAIGHT, EW);
    pave(before, [[11, 10]]);
    expect(refusal(before, 10, 10)).toBe(STR.build.crossingAlong);
    expect(before.roads.size).toBe(1);
  });

  it('is refused over a curve, a switch, a track crossing or a transition', () => {
    const pieces: [TrackItem, number][] = [
      [{ kind: 'curve', cls: 'regular' }, 0],
      [{ kind: 'curve', cls: 'narrow' }, 1],
      [{ kind: 'switch', cls: 'regular' }, 2],
      [{ kind: 'switch', cls: 'narrow' }, 5],
      [{ kind: 'crossing', cls: 'regular', cls2: 'regular' }, 0],
      [{ kind: 'crossing', cls: 'narrow', cls2: 'regular' }, 1],
      [{ kind: 'transition', cls: 'regular' }, 1],
      [{ kind: 'curve', cls: 'high_speed' }, 3],
    ];
    for (const [item, rot] of pieces) {
      const w = world();
      w.builder.free = true;
      lay(w, 10, 10, item, rot);
      const tiles = w.track.unitTiles(10, 10);
      // a wide curve or switch is refused on every tile it covers
      if (item.kind === 'curve' || item.kind === 'switch')
        expect(tiles.length, `${item.kind} ${item.cls}`).toBe(item.cls === 'narrow' ? 1 : 4);
      for (const t of tiles) {
        expect(refusal(w, t.x, t.y), `${item.kind} ${item.cls} at ${t.x},${t.y}`).toBe(
          STR.build.crossingStraight,
        );
        expect(w.builder.placeRoad(t.x, t.y)).toBe(false);
      }
      expect(w.roads.size).toBe(0);
    }
  });

  it('is refused across high-speed track', () => {
    for (const rot of [NS, EW]) {
      const w = world();
      w.builder.free = true;
      lay(w, 10, 10, HIGH_SPEED, rot);
      expect(refusal(w, 10, 10)).toBe(STR.build.crossingHighSpeed);
      expect(w.builder.placeRoad(10, 10)).toBe(false);
      expect(w.roads.size).toBe(0);
    }
  });

  it('holds whichever is laid first: track over a road keeps to the same rule', () => {
    const w = world();
    w.builder.free = true;
    // a road running east to west along row 10
    pave(w, [
      [8, 10],
      [9, 10],
      [10, 10],
      [11, 10],
      [12, 10],
    ]);
    // a line along the road is refused, across it is a level crossing
    expect(w.builder.checkTrack(10, 10, STRAIGHT, EW).reason).toBe(STR.build.crossingAlong);
    expect(w.builder.checkTrack(10, 10, HIGH_SPEED, NS).reason).toBe(STR.build.crossingHighSpeed);
    expect(w.builder.checkTrack(10, 10, { kind: 'curve', cls: 'narrow' }, 0).reason).toBe(
      STR.build.crossingStraight,
    );
    // a wide curve with any of its four tiles on the road
    const curve: TrackItem = { kind: 'curve', cls: 'regular' };
    expect(footprintOf(9, 9, 'curve', 0, 'regular').some((t) => w.roads.has(t.x, t.y))).toBe(true);
    expect(w.builder.checkTrack(9, 9, curve, 0).reason).toBe(STR.build.crossingStraight);
    const track = trackOf(w.track);
    expect(w.builder.placeTrack(10, 10, STRAIGHT, EW)).toBe(false);
    expect(trackOf(w.track)).toBe(track);
    expect(w.builder.placeTrack(10, 10, NARROW, NS)).toBe(true);
    expect(w.roads.isCrossing(10, 10)).toBe(true);
    // a dragged line goes by it too: the line along the road is refused at its first road tile
    const along = [8, 9].map((x) => ({
      kind: 'track' as const,
      x,
      y: 10,
      item: STRAIGHT,
      rot: EW,
    }));
    const c = w.builder.checkLine(along);
    expect(c.ok).toBe(false);
    expect(c.at).toBe(0);
    expect(c.reason).toBe(STR.build.crossingAlong);
    const across = [9, 10, 11].map((y) => ({
      kind: 'track' as const,
      x: 12,
      y,
      item: STRAIGHT,
      rot: NS,
    }));
    expect(w.builder.placeLine(across)).toBe(true);
    expect(w.roads.isCrossing(12, 10)).toBe(true);
  });

  it('keeps the track under it from becoming high speed or a transition', () => {
    const w = world();
    w.builder.free = true;
    for (let x = 4; x <= 24; x++) lay(w, x, 10, STRAIGHT, EW);
    pave(w, [
      [14, 9],
      [14, 10],
      [14, 11],
    ]);
    const track = trackOf(w.track);
    const stroke = [12, 13, 14, 15, 16].map((x) => ({ x, y: 10 }));
    const c = w.builder.checkReclass(stroke, 'high_speed');
    expect(c.ok).toBe(false);
    expect(c.reason).toBe(STR.build.crossingHighSpeed);
    expect(w.builder.reclassTrack(stroke, 'high_speed')).toBe(false);
    expect(trackOf(w.track)).toBe(track);
    // a stroke starting on the crossing makes a transition of its piece
    const from = [14, 15, 16, 17].map((x) => ({ x, y: 10 }));
    const plan = w.builder.checkReclass(from, 'high_speed');
    expect(plan.changes.find((p) => p.x === 14 && p.y === 10)?.kind).toBe('transition');
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe(STR.build.crossingStraight);
    expect(w.builder.reclassTrack(from, 'high_speed')).toBe(false);
    expect(trackOf(w.track)).toBe(track);
    // away from it the line converts
    const away = [5, 6, 7].map((x) => ({ x, y: 10 }));
    expect(w.builder.reclassTrack(away, 'high_speed')).toBe(true);
    expect(w.roads.isCrossing(14, 10)).toBe(true);
  });

  // slow: two 3000-tick runs of the whole sim step, about 1.4 s alone
  it(
    'lets trains run over it as they do over the same line without one',
    { timeout: 30_000 },
    () => {
      /** A quarry and a warehouse on a line with a train between them; roads across it or none. */
      const play = (crossings: boolean) => {
        const w = simWorld({ terrain: 'grass', size: 48 });
        depotWith(w, startStock(), { x: 4, y: 20 });
        line(w, 6, 20, 40);
        const quarry = station(w, 'quarry', 10, 19);
        const warehouse = station(w, 'warehouse', 34, 19);
        quarry.store('stone', 40);
        w.builder.free = true;
        if (crossings)
          for (const x of [16, 21, 26, 30]) for (const y of [19, 20, 21]) w.builder.placeRoad(x, y);
        w.builder.free = false;
        const loco = w.inventory.add('adler', 0);
        const hopper = w.inventory.add('wood_hopper', 0);
        const train = w.fleet.create([loco.uid], [hopper.uid], [quarry.id, warehouse.id]);
        if (typeof train === 'string') throw new Error(`fleet.create: ${train}`);
        const step = new SimStep(w);
        const ctx = { mode: 'play', weather: false } as const;
        const trace: string[] = [];
        const heads = new Set<string>();
        for (let i = 0; i < 3000; i++) {
          w.clock.run((gdt) => step.run(gdt, ctx));
          trace.push(JSON.stringify(w.fleet.trains.map((t) => t.toJSON())));
          const h = train.headTile;
          if (h) heads.add(`${h.x},${h.y}`);
        }
        return { w, trace, heads };
      };
      const plain = play(false);
      const crossed = play(true);
      expect(crossed.w.builder.roads.crossingKeys().size).toBe(4);
      // the train did go over the crossings
      for (const x of [16, 21, 26, 30]) expect(crossed.heads.has(`${x},20`), `${x},20`).toBe(true);
      expect(crossed.trace).toEqual(plain.trace);
    },
  );
});

// ------------------------------------------------------------------ the crossing keys

describe('the crossing keys', () => {
  it('are reachable from the step domains', () => {
    const w = simWorld({ terrain: 'grass', size: 32 });
    line(w, 4, 10, 20);
    w.builder.free = true;
    w.builder.placeRoad(8, 10);
    w.builder.placeRoad(8, 11);
    const d: StepDomains = w;
    expect([...d.builder.roads.crossingKeys()]).toEqual([w.track.key(8, 10)]);
    expect(d.builder.roads.has(8, 11)).toBe(true);
  });

  it('are the road tiles on a plain straight of regular or narrow track, whatever a save put where', () => {
    // A save is loaded without the build rules (`Roads.load`, the track as it was stored), so the
    // keys are read off the tiles, not off how they came to be: a road a rule would refuse, on a
    // curve, a switch or high-speed track, is no level crossing.
    forAll(
      (rng) => ({
        pieces: Array.from({ length: rng.int(0, 30) }, () => ({
          x: rng.int(0, 11),
          y: rng.int(0, 11),
          item: rng.pick(ITEMS),
          rot: rng.int(0, 7),
        })),
        roads: Array.from({ length: rng.int(0, 60) }, () => [rng.int(0, 11), rng.int(0, 11)]),
      }),
      (c) => {
        const track = new TrackGraph(12, 12);
        for (const p of c.pieces)
          if (
            footprintOf(p.x, p.y, p.item.kind, p.rot, p.item.cls).every((t) => !track.has(t.x, t.y))
          )
            track.place(p.x, p.y, p.item.kind, p.rot, p.item.cls, p.item.cls2);
        const roads = new Roads(track);
        roads.load(c.roads);
        const want = new Set<number>();
        for (let y = 0; y < 12; y++)
          for (let x = 0; x < 12; x++) {
            const p = track.get(x, y);
            if (p) expect(crossable(p), `${p.kind} ${p.cls} at ${x},${y}`).toBe(takesARoad(p));
            const crossing = roads.has(x, y) && !!p && takesARoad(p);
            expect(roads.isCrossing(x, y), `${x},${y}`).toBe(crossing);
            if (crossing) want.add(track.key(x, y));
          }
        expect([...roads.crossingKeys()].sort((a, b) => a - b)).toEqual(
          [...want].sort((a, b) => a - b),
        );
      },
      {
        shrink: function* (c) {
          for (const roads of shrinkArray(c.roads)) yield { ...c, roads };
          for (const pieces of shrinkArray(c.pieces)) yield { ...c, pieces };
        },
      },
    );
  });

  it('lose a crossing whose track is taken up, the road staying', () => {
    const w = world();
    w.builder.free = true;
    lay(w, 10, 10, NARROW, EW);
    pave(w, [[10, 10]]);
    expect(w.roads.crossingKeys().size).toBe(1);
    expect(w.builder.removeTrack(10, 10)).toBe(true);
    expect(w.roads.has(10, 10)).toBe(true);
    expect(w.roads.crossingKeys().size).toBe(0);
    // the road may run on along where the line was
    expect(refusal(w, 11, 10)).toBeNull();
  });
});

/** One thing a player could do on the builder, for the build sequences below. */
type Op =
  | { op: 'road' | 'unroad' | 'untrack'; x: number; y: number }
  | { op: 'track'; x: number; y: number; item: TrackItem; rot: number }
  | { op: 'reclass'; x: number; y: number; n: number; rot: number; hs: boolean }
  | { op: 'line'; x: number; y: number; n: number; rot: number; cls: TrackItem['cls'] }
  | { op: 'decor'; x: number; y: number; id: string }
  | { op: 'station' | 'works' | 'house' | 'signal'; x: number; y: number };
const ITEMS: TrackItem[] = [
  ...TRACK_ITEMS,
  { kind: 'straight', cls: 'narrow' },
  { kind: 'curve', cls: 'narrow' },
  { kind: 'switch', cls: 'narrow' },
  { kind: 'crossing', cls: 'narrow', cls2: 'narrow' },
];
const SIDE = 14;
function genOps(rng: Rng): { ground: number[]; ops: Op[] } {
  const at = () => ({ x: rng.int(1, SIDE - 2), y: rng.int(1, SIDE - 2) });
  const ground = Array.from({ length: rng.int(0, 6) }, () => rng.int(0, SIDE * SIDE - 1));
  const lines: Extract<Op, { op: 'line' }>[] = [];
  const ops: Op[] = Array.from({ length: rng.int(10, 80) }, (): Op => {
    const r = rng.next();
    const p = at();
    if (r < 0.3) {
      if (!lines.length || rng.chance(0.6)) return { op: 'road', ...p };
      // on a tile of a line dragged earlier, to cross it or run along it
      const l = rng.pick(lines);
      const i = rng.int(0, l.n - 1);
      return { op: 'road', ...(l.rot === EW ? { x: l.x + i, y: l.y } : { x: l.x, y: l.y + i }) };
    }
    if (r < 0.55) return { op: 'track', ...p, item: rng.pick(ITEMS), rot: rng.int(0, 7) };
    if (r < 0.62) return { op: 'unroad', ...p };
    if (r < 0.69) return { op: 'untrack', ...p };
    if (r < 0.76) {
      const hs = rng.chance(0.7);
      // mostly a stroke along a line dragged earlier, where there is track to convert
      if (!lines.length || rng.chance(0.2))
        return { op: 'reclass', ...p, n: rng.int(1, 6), rot: rng.int(0, 1), hs };
      const l = rng.pick(lines);
      const from = rng.int(0, l.n - 1);
      const n = rng.int(1, l.n - from);
      const start = l.rot === EW ? { x: l.x + from, y: l.y } : { x: l.x, y: l.y + from };
      return { op: 'reclass', ...start, n, rot: l.rot, hs };
    }
    if (r < 0.84) {
      const cls = rng.pick(['regular', 'regular', 'narrow', 'high_speed'] as const);
      const rot = rng.int(0, 1);
      // as long as the map leaves room for, from 2 to 10 tiles
      const n = Math.min(rng.int(2, 10), SIDE - (rot === EW ? p.x : p.y));
      const l = { op: 'line' as const, ...p, n, rot, cls };
      lines.push(l);
      return l;
    }
    if (r < 0.88) return { op: 'decor', ...p, id: rng.pick(content.decor).id };
    const op = rng.pick(['station', 'works', 'house', 'signal'] as const);
    if (!lines.length || rng.chance(0.5)) return { op, ...p };
    // beside a line dragged earlier, where a station finds its track and a crossing road runs on
    const l = rng.pick(lines);
    const i = rng.int(0, l.n - 1);
    const side = rng.pick([-1, 1]);
    return {
      op,
      ...(l.rot === EW ? { x: l.x + i, y: l.y + side } : { x: l.x + side, y: l.y + i }),
    };
  });
  return { ground, ops };
}
/** A dragged run of `n` straights from (x, y), down the map (turn 0) or across it (turn 1). */
function lineOf(o: Extract<Op, { op: 'line' }>): LinePiece[] {
  const out: LinePiece[] = [];
  for (let i = 0; i < o.n; i++) {
    const x = o.rot === EW ? o.x + i : o.x;
    const y = o.rot === EW ? o.y : o.y + i;
    out.push({ kind: 'track', x, y, item: { kind: 'straight', cls: o.cls }, rot: o.rot });
  }
  return out;
}
/**
 * A piece a road may cross, as the issue words it, kept apart from `crossable` so the test does
 * not take the rule from the code it checks: a one-tile straight of regular or narrow track.
 */
const takesARoad = (p: TrackPiece) =>
  p.kind === 'straight' && !p.unit && (p.cls === 'regular' || p.cls === 'narrow');
/** A small map to play the ops on, `ground` tiles of it water, rock or a mountain by turns. */
function site(c: { ground: number[]; ops: Op[] }) {
  const map = emptyMap(3, SIDE, SIDE, Terrain.Grass);
  c.ground.forEach((i, n) => {
    map.terrain[i] = [Terrain.Water, Terrain.Rock, Terrain.Mountain][n % 3];
  });
  const track = new TrackGraph(SIDE, SIDE);
  const builder = new Builder(
    map,
    new RegionState(map),
    track,
    new Economy(),
    storeWith({}).stores,
  );
  builder.free = true;
  return { map, track, builder, roads: builder.roads };
}
/** Do what `o` asks on the site's builder, in the editor's way (no price). */
function perform(w: ReturnType<typeof site>, o: Op) {
  const b = w.builder;
  switch (o.op) {
    case 'road':
      return b.placeRoad(o.x, o.y);
    case 'unroad':
      return b.removeRoad(o.x, o.y);
    case 'track':
      return b.placeTrack(o.x, o.y, o.item, o.rot);
    case 'untrack':
      return b.removeTrack(o.x, o.y);
    case 'reclass':
      // a stroke along the map's rows (turn 1) or down its columns (turn 0)
      return b.reclassTrack(
        Array.from({ length: o.n }, (_, i) =>
          o.rot === EW
            ? { x: Math.min(SIDE - 1, o.x + i), y: o.y }
            : { x: o.x, y: Math.min(SIDE - 1, o.y + i) },
        ),
        o.hs ? 'high_speed' : 'regular',
      );
    case 'line':
      return b.placeLine(lineOf(o));
    case 'decor':
      return !!b.placeDecor(o.x, o.y, o.id, 0);
    case 'station':
      return !!b.placeStation(o.x, o.y, 'farm');
    case 'works':
      return !!b.placeBuilding(o.x, o.y, 'windmill');
    case 'house':
      return !!b.placeDecor(o.x, o.y, 'townhouse', 0);
    case 'signal':
      return !!b.placeDecor(o.x, o.y, 'signal', 0);
  }
}
/** What every road must keep to, whatever was built in whatever order; '' when it does. */
function broken(w: ReturnType<typeof site>): string {
  const { map, track, builder, roads } = w;
  for (const { x, y } of roads.list()) {
    const at = `road at ${x},${y}`;
    const t = map.terrain[y * map.w + x];
    if (t === Terrain.Water || t === Terrain.Rock || t === Terrain.Mountain)
      return `${at} on ${TERRAIN_NAMES[t]}`;
    if (builder.stationAt(x, y)) return `${at} on a station`;
    if (builder.buildingAt(x, y)) return `${at} on a works`;
    const d = builder.decorAt(x, y);
    if (d && !decorDef(d.id).onTrack) return `${at} on a ${d.id}`;
    const p = track.get(x, y);
    if (!p) continue;
    if (!takesARoad(p)) return `${at} on a ${p.kind} ${p.cls}`;
    for (const d of p.links[0])
      if (roads.has(x + DIR_DX[d], y + DIR_DY[d])) return `${at} along its track`;
  }
  return '';
}

describe('roads, whatever is built in whatever order', () => {
  // slow: seeded sites of builder steps, the roads judged after each, 0.6 s alone; the limit is
  // room for a busy machine
  it('cross only plain straights of regular or narrow track at right angles, off every footprint', () => {
    forAll(
      genOps,
      (c) => {
        const w = site(c);
        c.ops.forEach((o, i) => {
          perform(w, o);
          expect(broken(w), `after op ${i} ${JSON.stringify(o)}`).toBe('');
        });
        // the keys are the road tiles on such straights, keyed as the track keys tiles
        const keys = new Set<number>();
        for (const { x, y } of w.roads.list()) {
          const p = w.track.get(x, y);
          if (p?.kind === 'straight' && p.cls !== 'high_speed') keys.add(w.track.key(x, y));
        }
        expect([...w.roads.crossingKeys()].sort((a, b) => a - b)).toEqual(
          [...keys].sort((a, b) => a - b),
        );
      },
      { shrink: (c) => [...shrinkArray(c.ops)].map((ops) => ({ ...c, ops })) },
    );
  }, 30_000);

  // slow: seeded sites of builder steps, the roads compared after each, 0.8 s alone; the limit is
  // room for a busy machine
  it('change only by a road laid or taken up, or by the spur of a place placed, which moves the version on and tells the game once a tile', () => {
    // A renderer keeps what it drew until `version` moves (#309, #329) and redraws the tile
    // `onRoadChanged` names: a change that moved neither would leave a stale picture, and one
    // made by anything but laying or taking up a road, or the free spur a place gets at its door
    // (#408), would be a road nobody laid.
    /** ops whose place has a street door, and so may lay a spur */
    const placing = new Set(['decor', 'station', 'works', 'house']);
    forAll(
      genOps,
      (c) => {
        const w = site(c);
        const told: string[] = [];
        w.builder.onRoadChanged = (x, y) => told.push(`${x},${y}`);
        const tiles = () => w.roads.toJSON().map(([x, y]) => `${x},${y}`);
        c.ops.forEach((o, i) => {
          const was = tiles();
          const version = w.roads.version;
          told.length = 0;
          const done = perform(w, o);
          const now = tiles();
          const at = `op ${i} ${JSON.stringify(o)}`;
          const gone = was.filter((t) => !now.includes(t));
          const added = now.filter((t) => !was.includes(t));
          const tile = `${o.x},${o.y}`;
          if (o.op === 'unroad') {
            expect(gone, `${at}: taken up`).toEqual(done ? [tile] : []);
            expect(added, `${at}: laid`).toEqual([]);
          } else {
            expect(gone, `${at}: taken up`).toEqual([]);
            // a road laid is laid first, any spur it brings after it
            if (o.op === 'road') expect(added[0], `${at}: laid`).toBe(done ? tile : undefined);
            else if (!done || !placing.has(o.op)) expect(added, `${at}: laid`).toEqual([]);
          }
          // what stood keeps its place in the list, and what is new comes after it
          expect(now, at).toEqual([...was.filter((t) => !gone.includes(t)), ...added]);
          if (!gone.length && !added.length) {
            expect(w.roads.version, `${at}: the version`).toBe(version);
            expect(told, `${at}: the game told`).toEqual([]);
          } else {
            expect(w.roads.version, `${at}: the version`).toBeGreaterThan(version);
            expect(told, `${at}: the game told`).toEqual([...gone, ...added]);
          }
        });
      },
      { shrink: (c) => [...shrinkArray(c.ops)].map((ops) => ({ ...c, ops })) },
    );
  }, 30_000);
});

// ------------------------------------------------------------------ roads and platforms, any order

/** One thing done on a site with a river, where bridge platforms carry rail or a road (#493). */
type DeckOp =
  | { op: 'deck'; x: number; y: number; id: string }
  | { op: 'road' | 'unroad' | 'untrack' | 'unbuild'; x: number; y: number }
  | { op: 'track'; x: number; y: number; item: TrackItem; rot: number }
  // a bridge dragged as a line: a platform under each tile, and on each a straight (`rail`) or,
  // once the line stands, a road (`road`), or nothing (`bare`)
  | {
      op: 'bridge';
      x: number;
      y: number;
      n: number;
      rot: number;
      id: string;
      carries: 'rail' | 'road' | 'bare';
      cls: TrackItem['cls'];
    }
  | { op: 'house' | 'pole' | 'signal'; x: number; y: number };
interface DeckCase {
  /** water tiles besides the river, then rock or a mountain by turns */
  ground: number[];
  ops: DeckOp[];
}
/** The river runs down the map at these columns, water from top to bottom. */
const RIVER = [5, 6, 7];
const DECKS = ['bridge_wood', 'bridge_stone'];
function genDeckOps(rng: Rng): DeckCase {
  const ground = Array.from({ length: rng.int(0, 8) }, () => rng.int(0, SIDE * SIDE - 1));
  // most things go where a platform may be: in the river or on its banks
  const at = () => ({
    x: rng.chance(0.65) ? rng.int(RIVER[0] - 1, RIVER[RIVER.length - 1] + 1) : rng.int(0, SIDE - 1),
    y: rng.int(0, SIDE - 1),
  });
  const ops = Array.from({ length: rng.int(10, 70) }, (): DeckOp => {
    const p = at();
    const r = rng.next();
    if (r < 0.2) return { op: 'deck', ...p, id: rng.pick(DECKS) };
    if (r < 0.42) return { op: 'road', ...p };
    if (r < 0.57) return { op: 'track', ...p, item: rng.pick(ITEMS), rot: rng.int(0, 7) };
    if (r < 0.7) {
      const rot = rng.int(0, 1);
      // across the river (turn 1) from its west bank, or down it (turn 0)
      const start = rot === EW ? { x: rng.int(2, RIVER[0]), y: p.y } : p;
      const n = Math.min(rng.int(1, 6), SIDE - (rot === EW ? start.x : start.y));
      const cls = rng.pick(['regular', 'regular', 'narrow'] as const);
      const carries = rng.pick(['rail', 'rail', 'road', 'road', 'bare'] as const);
      return { op: 'bridge', ...start, n, rot, id: rng.pick(DECKS), carries, cls };
    }
    if (r < 0.77) return { op: 'unroad', ...p };
    if (r < 0.84) return { op: 'untrack', ...p };
    if (r < 0.92) return { op: 'unbuild', ...p };
    return { op: rng.pick(['house', 'pole', 'signal'] as const), ...p };
  });
  return { ground, ops };
}
/** A grass site with the river down it and `ground` tiles of other ground, in the editor's way. */
function deckSite(c: DeckCase) {
  const map = emptyMap(3, SIDE, SIDE, Terrain.Grass);
  for (let y = 0; y < SIDE; y++) for (const x of RIVER) map.terrain[y * SIDE + x] = Terrain.Water;
  c.ground.forEach((i, n) => {
    map.terrain[i] = [Terrain.Water, Terrain.Rock, Terrain.Mountain][n % 3];
  });
  const track = new TrackGraph(SIDE, SIDE);
  const builder = new Builder(
    map,
    new RegionState(map),
    track,
    new Economy(),
    storeWith({}).stores,
  );
  builder.free = true;
  return { map, track, builder, roads: builder.roads };
}
type DeckSite = ReturnType<typeof deckSite>;
/** The track as a save holds it: each piece by its anchor. */
function anchorsOf(track: TrackGraph): SaveGame['track'] {
  const out: SaveGame['track'] = [];
  for (const a of track.anchors())
    out.push([a.x, a.y, a.piece.kind, a.piece.rot, a.piece.cls, a.piece.cls2]);
  return out;
}
/** Do what `o` asks; '' when it kept to the rule for a platform's removal, else what it broke. */
function performDeck(w: DeckSite, o: DeckOp): string {
  const b = w.builder;
  switch (o.op) {
    case 'deck':
      b.placeBuilding(o.x, o.y, o.id);
      return '';
    case 'road':
      b.placeRoad(o.x, o.y);
      return '';
    case 'unroad':
      b.removeRoad(o.x, o.y);
      return '';
    case 'track':
      b.placeTrack(o.x, o.y, o.item, o.rot);
      return '';
    case 'untrack':
      b.removeTrack(o.x, o.y);
      return '';
    case 'bridge': {
      const pieces: LinePiece[] = [];
      for (let i = 0; i < o.n; i++) {
        const x = o.rot === EW ? o.x + i : o.x,
          y = o.rot === EW ? o.y : o.y + i;
        pieces.push({ kind: 'platform', x, y, defId: o.id });
        if (o.carries === 'rail')
          pieces.push({ kind: 'track', x, y, item: { kind: 'straight', cls: o.cls }, rot: o.rot });
      }
      if (b.placeLine(pieces) && o.carries === 'road')
        for (const p of pieces) b.placeRoad(p.x, p.y);
      return '';
    }
    case 'unbuild': {
      // a platform with rail or a road on it stays, and what is on it stays with it
      const deck = b.bridgeAt(o.x, o.y);
      const loaded = w.track.has(o.x, o.y) || w.roads.has(o.x, o.y);
      const done = b.removeBuilding(o.x, o.y);
      if (deck && loaded && (done || b.bridgeAt(o.x, o.y) !== deck))
        return `the platform at ${o.x},${o.y} came up with something on it`;
      return '';
    }
    case 'house':
      b.placeDecor(o.x, o.y, 'townhouse', 0);
      return '';
    case 'pole':
      b.placeDecor(o.x, o.y, 'power_line', 0);
      return '';
    case 'signal':
      b.placeDecor(o.x, o.y, 'signal', 0);
      return '';
  }
}
/** The ground no road stands on unless a platform carries it, kept apart from `unbuildable`. */
const NO_ROAD_GROUND: readonly number[] = [Terrain.Water, Terrain.Rock, Terrain.Mountain];
/** What every platform and road keeps to, whatever was built in whatever order; '' when they do. */
function deckBroken(w: DeckSite): string {
  const { map, track, builder, roads } = w;
  for (let y = 0; y < SIDE; y++)
    for (let x = 0; x < SIDE; x++) {
      const at = `${x},${y}`;
      const deck = builder.bridgeAt(x, y);
      const rail = !!track.get(x, y);
      const road = roads.has(x, y);
      const ground = map.terrain[y * SIDE + x];
      if (deck && rail && road) return `a platform at ${at} carries rail and a road`;
      if (road && NO_ROAD_GROUND.includes(ground) && !(deck && !rail))
        return `a road at ${at} on ${TERRAIN_NAMES[ground]} with no bare platform under it`;
      if (road && builder.buildingAt(x, y) && !deck) return `a road at ${at} on a works`;
    }
  return '';
}

describe('roads and bridge platforms, whatever is built in whatever order (#493)', () => {
  // slow: seeded sites of builder steps, every tile judged after each step, 0.3 s alone; the limit
  // is room for a busy machine
  it('never put rail and a road on one platform, nor a road on water off a bare platform', () => {
    const seen = { roadDecks: 0, railDecks: 0, bareDecks: 0 };
    forAll(
      genDeckOps,
      (c) => {
        const w = deckSite(c);
        c.ops.forEach((o, i) => {
          const at = `after op ${i} ${JSON.stringify(o)}`;
          expect(performDeck(w, o), at).toBe('');
          expect(deckBroken(w), at).toBe('');
        });
        // and every platform answers both tools by what it carries: a road refuses rail and rail
        // a road, and a bare platform takes a road; water with no platform takes none. A platform
        // with either on it does not come up, and what is on it stays
        for (let y = 0; y < SIDE; y++)
          for (let x = 0; x < SIDE; x++) {
            const at = `${x},${y}`;
            const deck = w.builder.bridgeAt(x, y);
            const rail = !!w.track.get(x, y);
            const road = w.roads.has(x, y);
            if (deck && road) {
              seen.roadDecks++;
              for (const item of [STRAIGHT, NARROW])
                for (const rot of [NS, EW])
                  expect(w.builder.checkTrack(x, y, item, rot).reason, at).toBe(
                    STR.build.bridgeCarriesRoad,
                  );
            } else if (deck && rail) {
              seen.railDecks++;
              expect(w.builder.checkRoad(x, y).reason, at).toBe(STR.build.bridgeCarriesRail);
            }
            if (deck && (rail || road)) {
              const piece = w.track.get(x, y);
              expect(w.builder.removeBuilding(x, y), at).toBe(false);
              expect(w.builder.bridgeAt(x, y), at).toBe(deck);
              expect(w.track.get(x, y), at).toBe(piece);
              expect(w.roads.has(x, y), at).toBe(road);
            } else if (deck) {
              const dec = w.builder.decorAt(x, y);
              if (!dec || decorDef(dec.id).onTrack) {
                expect(w.builder.checkRoad(x, y).reason, at).toBeUndefined();
                seen.bareDecks++;
              }
            } else if (w.map.terrain[y * SIDE + x] === Terrain.Water)
              expect(w.builder.checkRoad(x, y).reason, at).toBe(STR.build.nothingOn.water);
          }
      },
      { shrink: (c) => [...shrinkArray(c.ops)].map((ops) => ({ ...c, ops })) },
    );
    // the seeds reach platforms with a road, platforms with rail, and bare ones open to a road
    for (const [what, n] of Object.entries(seen)) expect(n, what).toBeGreaterThan(200);
  }, 10_000);

  it('come back through a save and a load as they were, and the load repair takes nothing off', () => {
    let kept = 0;
    forAll(
      genDeckOps,
      (c) => {
        const w = deckSite(c);
        for (const o of c.ops) performDeck(w, o);
        const track = anchorsOf(w.track);
        const read = readSaveText(
          JSON.stringify({
            ...oldSave(SAVE_VERSION),
            track,
            buildings: [...w.builder.buildings.values()].map(buildingToJSON),
            roads: w.roads.toJSON(),
          }),
        );
        if (!('save' in read)) throw new Error(read.error);
        const save = read.save;
        // what the builder let stand, the repair leaves: no ground bent, no road taken off
        expect(repairBuiltTiles(w.map, save)).toEqual([]);
        expect(repairBuiltRoads(w.map, save)).toEqual([]);
        // loaded into a fresh site, the platforms, rail and roads stand where they stood
        const back = deckSite(c);
        for (const [x, y, kind, rot, cls, cls2] of save.track)
          back.track.place(x, y, kind, rot, cls, cls2);
        for (const j of save.buildings ?? []) {
          const b = buildingFromJSON(j);
          back.builder.buildings.set(back.track.key(b.x, b.y), b);
        }
        back.roads.load(save.roads);
        expect(back.roads.toJSON()).toEqual(w.roads.toJSON());
        expect(anchorsOf(back.track)).toEqual(track);
        expect(deckBroken(back)).toBe('');
        for (const b of w.builder.buildings.values()) {
          const at = `${b.x},${b.y}`;
          expect(back.builder.bridgeAt(b.x, b.y)?.id, at).toBe(w.builder.bridgeAt(b.x, b.y)?.id);
          if (!w.builder.bridgeAt(b.x, b.y) || !w.roads.has(b.x, b.y)) continue;
          kept++;
          // the loaded platform keeps the rule: it refuses rail, it stays while its road does,
          // and its span is the span it had
          expect(back.builder.checkTrack(b.x, b.y, STRAIGHT, EW).reason, at).toBe(
            STR.build.bridgeCarriesRoad,
          );
          expect(bridgeSpan(back.builder, back.builder.bridgeAt(b.x, b.y)!), at).toEqual(
            bridgeSpan(w.builder, b),
          );
          expect(back.builder.removeBuilding(b.x, b.y), at).toBe(false);
        }
      },
      { shrink: (c) => [...shrinkArray(c.ops)].map((ops) => ({ ...c, ops })) },
    );
    expect(kept, 'roads on platforms saved').toBeGreaterThan(200);
  });
});

// ------------------------------------------------------------------ the save

describe('roads and the save', () => {
  /** Roads laid by seeded hands on a small grass map, rules aside. */
  const someRoads = (rng: Rng) => {
    const roads = new Roads(new TrackGraph(20, 16));
    for (let n = rng.int(0, 40); n > 0; n--) roads.add(rng.int(0, 19), rng.int(0, 15));
    return roads;
  };

  it('come back as they were, tile for tile and join for join', () => {
    forAll(
      (rng) => someRoads(rng).toJSON(),
      (list) => {
        const a = new Roads(new TrackGraph(20, 16));
        a.load(list);
        const b = new Roads(new TrackGraph(20, 16));
        b.load(JSON.parse(JSON.stringify(a.toJSON())));
        expect(b.toJSON()).toEqual(a.toJSON());
        expect(b.toJSON()).toEqual(list);
        for (let y = 0; y < 16; y++)
          for (let x = 0; x < 20; x++) expect(b.joins(x, y), `${x},${y}`).toBe(a.joins(x, y));
      },
    );
  });

  it('come back with the game: a save of this version read back and loaded', () => {
    const w = world();
    w.builder.free = true;
    lay(w, 10, 10, STRAIGHT, EW);
    pave(w, [
      [10, 9],
      [10, 10],
      [10, 11],
      [3, 3],
    ]);
    const read = readSaveText(
      JSON.stringify({ ...oldSave(SAVE_VERSION), roads: w.roads.toJSON() }),
    );
    if (!('save' in read)) throw new Error(read.error);
    expect(read.save.version).toBe(SAVE_VERSION);
    const back = world();
    back.track.place(10, 10, 'straight', EW, 'regular');
    back.roads.load(read.save.roads);
    expect(back.roads.toJSON()).toEqual(w.roads.toJSON());
    expect([...back.roads.crossingKeys()]).toEqual([...w.roads.crossingKeys()]);
  });

  it('start empty in a file from before roads, and stay as they are in one since', () => {
    for (let version = 1; version < 20; version++) {
      const j = migrate(oldSave(version));
      expect(j.roads, `from v${version}`).toEqual([]);
    }
    // the step from v19 says so, and the steps after it say their own
    const v19 = migrate(oldSave(19));
    expect(v19.migrationNotes?.[0]).toBe(
      'v19→v20: no road had been built: the road list started empty',
    );
    // the step only fills in: a list the file has is kept
    const kept = migrate({ ...oldSave(19), roads: [[1, 2]] });
    expect(kept.roads).toEqual([[1, 2]]);
    const now = migrate({ ...oldSave(SAVE_VERSION), roads: [[4, 5]] });
    expect(now.roads).toEqual([[4, 5]]);
    expect(now.migrationNotes).toBeUndefined();
  });

  it('load only whole [x, y] pairs on the map, each tile once', () => {
    const roads = new Roads(new TrackGraph(8, 8));
    roads.add(1, 1);
    roads.load([
      [2, 3],
      [2, 3],
      [9, 1],
      [-1, 0],
      [1.5, 2],
      ['3', 4],
      [5],
      null,
      { x: 1 },
      [7, 7, 9],
    ]);
    expect(roads.toJSON()).toEqual([
      [2, 3],
      [7, 7],
    ]);
    for (const bad of [undefined, null, 5, 'roads', { 0: [1, 1] }]) {
      roads.load(bad);
      expect(roads.size, String(bad)).toBe(0);
    }
  });
});

/** A save of `version` with what every version has and nothing else. */
function oldSave(version: number): SaveGame {
  return {
    version,
    savedAt: 1,
    seed: 5,
    clock: { time: 0, speedIndex: 1 },
    economy: { money: 0, tickets: 0, tier: 0, granted: [] },
    track: [],
    stations: [],
    trains: [],
    contracts: { contracts: [] },
    inventory: { items: [] },
    gacha: {},
    camera: { x: 0, y: 0, zoomIndex: 2 },
    lastDay: 0,
  };
}

// ------------------------------------------------------------------ walkers

/**
 * The walk search as it was before roads: breadth first over walkable ground in 8 directions,
 * inside the box the two ends span and WALK_MARGIN round it.
 */
function breadthFirst(map: GameMap, from: { x: number; y: number }, to: { x: number; y: number }) {
  const margin = 4;
  const x0 = Math.max(0, Math.min(from.x, to.x) - margin);
  const y0 = Math.max(0, Math.min(from.y, to.y) - margin);
  const x1 = Math.min(map.w - 1, Math.max(from.x, to.x) + margin);
  const y1 = Math.min(map.h - 1, Math.max(from.y, to.y) + margin);
  const Wb = x1 - x0 + 1;
  const prev = new Int32Array(Wb * (y1 - y0 + 1)).fill(-2);
  const key = (x: number, y: number) => (y - y0) * Wb + (x - x0);
  const sk = key(from.x, from.y);
  const tk = key(to.x, to.y);
  prev[sk] = -1;
  const queue = [sk];
  let qi = 0;
  while (qi < queue.length) {
    const k = queue[qi++];
    if (k === tk) break;
    const cx = (k % Wb) + x0;
    const cy = Math.floor(k / Wb) + y0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
        const nk = key(nx, ny);
        if (prev[nk] !== -2) continue;
        if (!walkable(map, nx, ny) && !(nx === to.x && ny === to.y)) continue;
        prev[nk] = k;
        queue.push(nk);
      }
  }
  if (prev[tk] === -2) return null;
  const out: { x: number; y: number }[] = [];
  for (let k = tk; k >= 0; k = prev[k]) out.push({ x: (k % Wb) + x0, y: Math.floor(k / Wb) + y0 });
  return out.reverse();
}

/**
 * What a walk costs as the search counts it, 1 a step along a road and OFF_ROAD_STEP any other,
 * with its steps off the road, which decide between walks of equal cost.
 */
function costOf(roads: Roads, path: { x: number; y: number }[]) {
  let cost = 0;
  let off = 0;
  path.slice(1).forEach((q, i) => {
    if (roadStep(roads, path[i], q)) cost += 1;
    else {
      cost += OFF_ROAD_STEP;
      off++;
    }
  });
  return { cost, off };
}
/** Is walk cost `a` lighter than `b`: cheaper, or as cheap with fewer steps off the road. */
const lighter = (a: { cost: number; off: number }, b: { cost: number; off: number }) =>
  a.cost < b.cost || (a.cost === b.cost && a.off < b.off);
/** Seconds a walker at the plain pace takes along a walk, a road leg at the road's. */
const secondsOf = (roads: Roads, path: { x: number; y: number }[]) =>
  path
    .slice(1)
    .reduce(
      (n, q, i) =>
        n +
        Math.hypot(q.x - path[i].x, q.y - path[i].y) /
          walkSpeed({ transient: false }, roadStep(roads, path[i], q)),
      0,
    );

/**
 * The lightest cost of a walk inside the box (`costOf`, `lighter`), the slow obvious way: relax
 * every tile's eight neighbours until nothing changes. Null when there is no walk. A walk steps on
 * no tile `avoid` names, `to` among them; it may set out from one.
 */
function cheapest(
  map: GameMap,
  roads: Roads,
  from: { x: number; y: number },
  to: { x: number; y: number },
  avoid: (x: number, y: number) => boolean = () => false,
) {
  const x0 = Math.max(0, Math.min(from.x, to.x) - WALK_MARGIN);
  const y0 = Math.max(0, Math.min(from.y, to.y) - WALK_MARGIN);
  const x1 = Math.min(map.w - 1, Math.max(from.x, to.x) + WALK_MARGIN);
  const y1 = Math.min(map.h - 1, Math.max(from.y, to.y) + WALK_MARGIN);
  const best = new Map<string, { cost: number; off: number }>([
    [`${from.x},${from.y}`, { cost: 0, off: 0 }],
  ]);
  for (let changed = true; changed;) {
    changed = false;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const here = best.get(`${x},${y}`);
        // a walk ends at its target: nothing is walked on from it
        if (!here || (x === to.x && y === to.y)) continue;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if ((!dx && !dy) || nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
            if (!walkable(map, nx, ny) && !(nx === to.x && ny === to.y)) continue;
            if (avoid(nx, ny)) continue;
            const along = roadStep(roads, { x, y }, { x: nx, y: ny });
            const c = {
              cost: here.cost + (along ? 1 : OFF_ROAD_STEP),
              off: here.off + (along ? 0 : 1),
            };
            const there = best.get(`${nx},${ny}`);
            if (!there || lighter(c, there)) {
              best.set(`${nx},${ny}`, c);
              changed = true;
            }
          }
      }
  }
  return best.get(`${to.x},${to.y}`) ?? null;
}

/** A map of open ground with seeded ponds and rocks, and seeded roads on the open ground. */
function walkCase(rng: Rng) {
  const side = rng.int(8, 24);
  const blocked = Array.from({ length: rng.int(0, side * 2) }, () => rng.int(0, side * side - 1));
  const roads = Array.from({ length: rng.int(0, side * 3) }, () => [
    rng.int(0, side - 1),
    rng.int(0, side - 1),
  ]);
  // a road or two of whole runs, so a walk has some to take
  for (let n = rng.int(0, 3); n > 0; n--) {
    const across = rng.chance(0.5);
    const at = rng.int(0, side - 1);
    const a = rng.int(0, side - 1);
    const b = rng.int(0, side - 1);
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) roads.push(across ? [i, at] : [at, i]);
  }
  return {
    side,
    blocked,
    roads,
    from: [rng.int(0, side - 1), rng.int(0, side - 1)],
    to: [rng.int(0, side - 1), rng.int(0, side - 1)],
    seed: rng.int(0, 0xffff),
  };
}
type WalkCase = ReturnType<typeof walkCase>;
function walkWorld(c: WalkCase) {
  const map = emptyMap(c.seed, c.side, c.side, Terrain.Grass);
  c.blocked.forEach((i, n) => (map.terrain[i] = n % 2 ? Terrain.Water : Terrain.Rock));
  const roads = new Roads(new TrackGraph(c.side, c.side));
  for (const [x, y] of c.roads) if (walkable(map, x, y)) roads.add(x, y);
  const from = { x: c.from[0], y: c.from[1] };
  const to = { x: c.to[0], y: c.to[1] };
  return { map, roads, from, to };
}
function* shrinkWalk(c: WalkCase): Iterable<WalkCase> {
  for (const roads of shrinkArray(c.roads)) yield { ...c, roads };
  for (const blocked of shrinkArray(c.blocked)) yield { ...c, blocked };
}

describe('a walk with roads', () => {
  it('is the breadth-first walk it always was where there is no road', () => {
    forAll(
      walkCase,
      (c) => {
        const { map, from, to } = walkWorld(c);
        const old = breadthFirst(map, from, to);
        expect(findWalk(map, from, to)).toEqual(old);
        expect(findWalk(map, from, to, null)).toEqual(old);
        expect(findWalk(map, from, to, new Roads(new TrackGraph(c.side, c.side)))).toEqual(old);
      },
      { shrink: shrinkWalk },
    );
  });

  it('costs no more than any other walk inside its box, and never leaves the box', () => {
    forAll(
      walkCase,
      (c) => {
        const { map, roads, from, to } = walkWorld(c);
        const path = findWalk(map, from, to, roads);
        const best = cheapest(map, roads, from, to);
        if (!path) {
          expect(best, 'no walk found where there is one').toBeNull();
          return;
        }
        expect(path[0]).toEqual(from);
        expect(path.at(-1)).toEqual(to);
        path.slice(1).forEach((q, i) => {
          const p = path[i];
          expect(Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y)), `step ${i}`).toBe(1);
          expect(Math.abs(q.x - from.x) <= Math.abs(to.x - from.x) + 2 * WALK_MARGIN).toBe(true);
          expect(q.x).toBeGreaterThanOrEqual(Math.min(from.x, to.x) - WALK_MARGIN);
          expect(q.x).toBeLessThanOrEqual(Math.max(from.x, to.x) + WALK_MARGIN);
          expect(q.y).toBeGreaterThanOrEqual(Math.min(from.y, to.y) - WALK_MARGIN);
          expect(q.y).toBeLessThanOrEqual(Math.max(from.y, to.y) + WALK_MARGIN);
          if (i + 1 < path.length - 1) expect(walkable(map, q.x, q.y), `tile ${i + 1}`).toBe(true);
        });
        expect(costOf(roads, path)).toEqual(best);
        // a road only ever makes a walk cheaper
        const bare = findWalk(map, from, to);
        expect(bare).not.toBeNull();
        expect(lighter(costOf(roads, bare!), costOf(roads, path))).toBe(false);
      },
      { shrink: shrinkWalk },
    );
  });

  it('keeps off every tile it is told to avoid, its end among them, and costs no more than any walk that does (#447)', () => {
    // The walk round a crossing only trains out of fuel or power hold closed: the tiles to keep off
    // are seeded about the two ends, and now and then the start or the end is one of them.
    const seen = { rerouted: 0, refused: 0 };
    forAll(
      (rng) => {
        const c = walkCase(rng);
        const near = (at: number[]) => [
          Math.min(c.side - 1, Math.max(0, at[0] + rng.int(-3, 3))),
          Math.min(c.side - 1, Math.max(0, at[1] + rng.int(-3, 3))),
        ];
        const avoid = Array.from({ length: rng.int(0, 8) }, () =>
          near(rng.chance(0.5) ? c.from : c.to),
        );
        // and some across the way straight from one end to the other, short of both
        for (let n = rng.int(0, 4); n > 0; n--) {
          const f = rng.range(0.2, 0.8);
          avoid.push([
            Math.round(c.from[0] + (c.to[0] - c.from[0]) * f),
            Math.round(c.from[1] + (c.to[1] - c.from[1]) * f),
          ]);
        }
        if (rng.chance(0.15)) avoid.push([...c.from]);
        if (rng.chance(0.15)) avoid.push([...c.to]);
        return { ...c, avoid };
      },
      (c) => {
        const { map, roads, from, to } = walkWorld(c);
        const avoid = (x: number, y: number) => c.avoid.some(([ax, ay]) => ax === x && ay === y);
        const path = findWalk(map, from, to, roads, avoid);
        const best = cheapest(map, roads, from, to, avoid);
        const plain = findWalk(map, from, to, roads);
        if (!path) {
          expect(best, 'no walk found where there is one').toBeNull();
          if (plain) seen.refused++;
          return;
        }
        expect(best, 'a walk found where there is none').not.toBeNull();
        if (JSON.stringify(path) !== JSON.stringify(plain)) seen.rerouted++;
        expect(path[0]).toEqual(from);
        expect(path.at(-1)).toEqual(to);
        path.slice(1).forEach((q, i) => {
          const p = path[i];
          expect(Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y)), `step ${i}`).toBe(1);
          expect(avoid(q.x, q.y), `tile ${i + 1} at ${q.x},${q.y}`).toBe(false);
          expect(q.x).toBeGreaterThanOrEqual(Math.min(from.x, to.x) - WALK_MARGIN);
          expect(q.x).toBeLessThanOrEqual(Math.max(from.x, to.x) + WALK_MARGIN);
          expect(q.y).toBeGreaterThanOrEqual(Math.min(from.y, to.y) - WALK_MARGIN);
          expect(q.y).toBeLessThanOrEqual(Math.max(from.y, to.y) + WALK_MARGIN);
          if (i + 1 < path.length - 1) expect(walkable(map, q.x, q.y), `tile ${i + 1}`).toBe(true);
        });
        expect(costOf(roads, path)).toEqual(best);
        // told to avoid nothing, it is the walk it always was, step for step
        expect(findWalk(map, from, to, roads, () => false)).toEqual(plain);
      },
      {
        shrink: function* (c) {
          for (const avoid of shrinkArray(c.avoid)) yield { ...c, avoid };
          for (const w of shrinkWalk(c)) yield { ...w, avoid: c.avoid };
        },
      },
    );
    // not vacuous: the tiles to keep off turned some walks and left others none
    expect(seen.rerouted).toBeGreaterThanOrEqual(25);
    expect(seen.refused).toBeGreaterThanOrEqual(10);
  });

  it('takes a road round when the road is quicker than the way straight across', () => {
    const map = emptyMap(1, 40, 40, Terrain.Grass);
    const roads = new Roads(new TrackGraph(40, 40));
    // from (10, 20) up to row 17, along it to x 24 and down again to (24, 20)
    const loop: [number, number][] = [];
    for (let y = 20; y > 17; y--) loop.push([10, y]);
    for (let x = 10; x <= 24; x++) loop.push([x, 17]);
    for (let y = 18; y <= 20; y++) loop.push([24, y]);
    for (const [x, y] of loop) roads.add(x, y);
    const from = { x: 10, y: 20 };
    const to = { x: 24, y: 20 };
    const straight = findWalk(map, from, to)!;
    const round = findWalk(map, from, to, roads)!;
    expect(straight).toHaveLength(15);
    expect(round.map((p) => [p.x, p.y])).toEqual(loop);
    // longer in tiles, quicker on foot
    expect(round.length).toBeGreaterThan(straight.length);
    expect(secondsOf(roads, round)).toBeLessThan(secondsOf(roads, straight));
    // a road round that leaves the box is not taken: the box is the ends' and four tiles round
    const far = new Roads(new TrackGraph(40, 40));
    for (let y = 20; y > 14; y--) far.add(10, y);
    for (let x = 10; x <= 24; x++) far.add(x, 14);
    for (let y = 15; y <= 20; y++) far.add(24, y);
    expect(findWalk(map, from, to, far)).toEqual(straight);
  });

  it('is the walk a walker sets out on', () => {
    const map = emptyMap(1, 40, 40, Terrain.Grass);
    const track = new TrackGraph(40, 40);
    const builder = new Builder(
      map,
      new RegionState(map),
      track,
      new Economy(),
      storeWith({}).stores,
    );
    builder.free = true;
    for (let x = 4; x < 36; x++) track.place(x, 20, 'straight', EW);
    const st = builder.placeStation(10, 19, 'station')!;
    expect(st).not.toBeNull();
    // a road from (24, 19) up to row 16, along it and down to the tile above the station
    const road: [number, number][] = [];
    for (let y = 19; y > 16; y--) road.push([24, y]);
    for (let x = 24; x >= 10; x--) road.push([x, 16]);
    for (let y = 17; y <= 18; y++) road.push([10, y]);
    // no road was near the station when it was placed, so it laid none at its door (#455); the
    // road laid up to its door brings the tile above the station, free
    expect(builder.roads.toJSON()).toEqual([]);
    for (const [x, y] of road)
      expect(builder.roads.has(x, y) || builder.placeRoad(x, y), `${x},${y}`).toBe(true);
    const people = new PeopleSim(map, builder, new Rng(1));
    people.tick(0.05, 1, 0.5);
    const [p] = people.persons;
    // on its way home to a place that is gone: it walks to its new home from where it stands
    Object.assign(p, {
      home: 'gone',
      state: 'return',
      x: 24,
      y: 19,
      path: [
        { x: 24, y: 19 },
        { x: 25, y: 19 },
      ],
      step: 0,
      timer: 0,
    });
    const stream = people.toJSON().rng;
    people.tick(0.05, 1, 0.5);
    expect(p.home).toBe(`s${st.id}`);
    // to the station's street door, on its side away from the platform: where the road ends
    const door = { x: 10, y: 18 };
    expect(streetDoor(st.def, st.x, st.y, st.rot).reach).toEqual(door);
    const along = findWalk(map, { x: 24, y: 19 }, door, builder.roads)!;
    expect(p.path).toEqual(along);
    // the walk the roads give, not the one across the grass: up the road and along it, until a
    // cut across costs no more (a step off the road counts alike straight or diagonal)
    const bare = findWalk(map, { x: 24, y: 19 }, door)!;
    expect(along).not.toEqual(bare);
    expect(along.slice(0, 15).map((q) => [q.x, q.y])).toEqual(road.slice(0, 15));
    expect(costOf(builder.roads, along).cost).toBeLessThan(costOf(builder.roads, bare).cost);
    // and it walks its first leg, along the road, at the road's pace
    expect(Math.hypot(p.x - 24, p.y - 19)).toBeCloseTo(WALK_SPEED * ROAD_SPEED_MUL * 0.05, 9);
    expect(people.toJSON().rng).toBe(stream);
  });
});

/** Side of the town the walkers below live in. */
const TOWN = 48;
/** Seeded houses and service posts on either side of the town's line, and runs of road. */
function townCase(rng: Rng) {
  return {
    houses: Array.from({ length: rng.int(2, 8) }, () => ({
      x: rng.int(4, 43),
      y: rng.chance(0.5) ? rng.int(8, 20) : rng.int(28, 40),
      id: rng.pick(['townhouse', 'townhouse', 'water_tower', 'fuel_stop']),
    })),
    roads: Array.from({ length: rng.int(3, 12) }, () => ({
      across: rng.chance(0.5),
      at: rng.int(6, 42),
      a: rng.int(4, 43),
      b: rng.int(4, 43),
    })),
    stream: rng.int(0, 0xffffffff),
  };
}
type TownCase = ReturnType<typeof townCase>;
/**
 * A grass town with a line along row 24, a passenger station either side of it, a lumber yard with
 * a wood six tiles north and a quarry with a hill five tiles south, so walkers set out on walks
 * long enough for a road to change: to a station, to gather, home again. The case's houses and
 * roads go where the rules let them, in the editor's way.
 */
function townOf(c: TownCase) {
  const map = emptyMap(1, TOWN, TOWN, Terrain.Grass);
  for (let y = 15; y <= 17; y++)
    for (let x = 22; x <= 27; x++) map.terrain[y * TOWN + x] = Terrain.Forest;
  for (let y = 30; y <= 31; y++)
    for (let x = 14; x <= 18; x++) map.terrain[y * TOWN + x] = Terrain.Hill;
  const track = new TrackGraph(TOWN, TOWN);
  const builder = new Builder(
    map,
    new RegionState(map),
    track,
    new Economy(),
    storeWith({}).stores,
  );
  builder.free = true;
  for (let x = 4; x < 44; x++) track.place(x, 24, 'straight', EW);
  const stations = (
    [
      ['station', 12, 23],
      ['station', 34, 25],
      ['lumber', 24, 23],
      ['quarry', 16, 25],
    ] as const
  ).map(([id, x, y]) => {
    const st = builder.placeStation(x, y, id);
    if (!st) throw new Error(`${id} at ${x},${y}: ${builder.checkStation(x, y, id).reason}`);
    return st;
  });
  for (const h of c.houses) builder.placeDecor(h.x, h.y, h.id, 0);
  for (const r of c.roads)
    for (let i = Math.min(r.a, r.b); i <= Math.max(r.a, r.b); i++)
      if (r.across) builder.placeRoad(i, r.at);
      else builder.placeRoad(r.at, i);
  return { map, builder, stations };
}
/** The search a walk of this kind comes from in PeopleSim. */
const SEARCH: Record<string, string> = {
  gather: 'startWalk',
  toStation: 'startWalk',
  'return from waiting': 'startWalk',
  'return from gather': 'turnHome',
  'return from toStation': 'turnHome',
  'return from return': 'the way to a new home',
  boarding: 'spawnTransient',
};

describe('every walk a walker sets out on', () => {
  // slow: 25 towns of 2400 ticks with forty walkers, each walk searched twice more; about 1.5 s alone
  it(
    'is the walk the roads give between its ends, whichever search set it out',
    { timeout: 30_000 },
    () => {
      /** walks seen and walks a road changed, by the search they came from */
      const walks = new Map<string, number>();
      const changed = new Map<string, number>();
      forAll(
        townCase,
        (c) => {
          const w = townOf(c);
          const roads = w.builder.roads;
          const people = new PeopleSim(w.map, w.builder, new Rng(c.stream));
          const seen = new Map<Person, { path: Person['path']; state: string }>();
          let gone: { x: number; y: number; id: string; at: number } | null = null;
          for (let t = 0; t < 2400; t++) {
            // a train calls at a passenger station now and then: figures board or alight
            if (t % 97 === 0) {
              const st = w.stations[(t / 97) % 2];
              if (t % 2) people.board(st, 3);
              else people.alight(st, 3);
            }
            // a house a walker is on its way back to goes, and stands again two ticks later
            if (t % 151 === 0 && !gone) {
              const p = people.persons.find((q) => q.state === 'return' && q.home.startsWith('d'));
              const d =
                p &&
                w.builder.decorAt(...(p.home.slice(1).split(',').map(Number) as [number, number]));
              if (d && w.builder.removeDecor(d.x, d.y)) gone = { ...d, at: t + 2 };
            }
            if (gone?.at === t) {
              w.builder.placeDecor(gone.x, gone.y, gone.id, 0);
              gone = null;
            }
            people.tick(1, 40, (t % 600) / 600);
            for (const p of people.persons) {
              const was = seen.get(p);
              seen.set(p, { path: p.path, state: p.state });
              if (!p.path.length || p.path === was?.path) continue;
              const kind = p.transient
                ? 'boarding'
                : p.state === 'return'
                  ? `return from ${was?.state}`
                  : p.state;
              const search = SEARCH[kind];
              expect(search, `a walk of kind ${kind} at tick ${t}`).toBeDefined();
              const from = p.path[0];
              const to = p.path.at(-1)!;
              const found = findWalk(w.map, from, to, roads);
              // a boarding figure with no walk found goes straight from one end to the other
              expect(p.path, `${search}: ${kind} at tick ${t}`).toEqual(found ?? [from, to]);
              walks.set(search, (walks.get(search) ?? 0) + 1);
              if (JSON.stringify(findWalk(w.map, from, to)) !== JSON.stringify(found))
                changed.set(search, (changed.get(search) ?? 0) + 1);
            }
          }
        },
        {
          seeds: SEEDS.slice(0, 25),
          // each call is a whole run: shrink a little, not for long
          shrinkBudget: 60,
          shrink: function* (c) {
            for (const roads of shrinkArray(c.roads)) yield { ...c, roads };
            for (const houses of shrinkArray(c.houses)) yield { ...c, houses };
          },
        },
      );
      // Each search ran, and on walks a road changed: one that walked without the roads would have
      // failed above. A boarding figure's walk is one step from its station to the platform beside
      // it, which no road changes, so that search is only seen to run.
      for (const search of new Set(Object.values(SEARCH))) {
        expect(walks.get(search) ?? 0, `walks from ${search}`).toBeGreaterThan(0);
        if (search !== 'spawnTransient')
          expect(changed.get(search) ?? 0, `walks a road changed, from ${search}`).toBeGreaterThan(
            0,
          );
      }
    },
  );
});

describe('the pace on a road', () => {
  it('is twice the walking pace, and a boarding figure goes no faster than any other there', () => {
    expect(ROAD_SPEED_MUL).toBe(2);
    expect(walkSpeed({ transient: false }, true)).toBe(WALK_SPEED * ROAD_SPEED_MUL);
    expect(walkSpeed({ transient: true }, true)).toBe(WALK_SPEED * ROAD_SPEED_MUL);
    expect(walkSpeed({ transient: true }, false)).toBe(WALK_SPEED * BOARDING_SPEED_MUL);
    expect(walkSpeed({ transient: false }, false)).toBe(WALK_SPEED);
    expect(walkSpeed({ transient: false })).toBe(WALK_SPEED);
  });

  it('is a leg along the road: both tiles hold one and share a side', () => {
    const roads = new Roads(new TrackGraph(10, 10));
    for (const [x, y] of [
      [2, 2],
      [3, 2],
      [3, 3],
    ])
      roads.add(x, y);
    const leg = (a: [number, number], b: [number, number]) =>
      roadStep(roads, { x: a[0], y: a[1] }, { x: b[0], y: b[1] });
    expect(leg([2, 2], [3, 2])).toBe(true);
    expect(leg([3, 3], [3, 2])).toBe(true);
    // diagonal, on to the road, off it, far apart, no roads at all
    expect(leg([2, 2], [3, 3])).toBe(false);
    expect(leg([1, 2], [2, 2])).toBe(false);
    expect(leg([3, 3], [3, 4])).toBe(false);
    expect(leg([2, 2], [3, 3])).toBe(false);
    expect(roadStep(null, { x: 2, y: 2 }, { x: 3, y: 2 })).toBe(false);
  });

  it('is what a walker covers in a tick on each leg, on the road and off it', () => {
    forAll(
      (rng) => ({
        gdt: rng.pick([0.05, 0.25, 0.5, 1, 2]),
        boarding: rng.chance(0.5),
        state: rng.pick(['gather', 'toStation', 'return'] as const),
        stream: rng.int(0, 0xffffffff),
      }),
      (c) => {
        const map = emptyMap(1, 40, 40, Terrain.Grass);
        const track = new TrackGraph(40, 40);
        const builder = new Builder(
          map,
          new RegionState(map),
          track,
          new Economy(),
          storeWith({}).stores,
        );
        builder.free = true;
        for (let x = 4; x < 36; x++) track.place(x, 20, 'straight', EW);
        const st = builder.placeStation(10, 19, 'station')!;
        // a road along row 30 from x 5 to 30
        for (let x = 5; x <= 30; x++) builder.placeRoad(x, 30);
        const people = new PeopleSim(map, builder, new Rng(c.stream));
        people.tick(1, 1, 0.5);
        const p: Person = people.persons[0];
        // off the road to its first tile, then along it
        const path = [
          { x: 5, y: 32 },
          { x: 5, y: 31 },
          { x: 5, y: 30 },
          { x: 6, y: 30 },
          { x: 7, y: 30 },
          { x: 8, y: 30 },
        ];
        Object.assign(p, {
          home: `s${st.id}`,
          state: c.boarding ? 'walk' : c.state,
          transient: c.boarding,
          stationId: st.id,
          path,
          step: 0,
          x: 5,
          y: 32,
          timer: 0,
        });
        const pace = (onRoad: boolean) => walkSpeed(p, onRoad) * c.gdt;
        // each tick moves the walker the leg's pace, or to the leg's end when that is nearer
        for (let tick = 0; tick < 400 && p.step < path.length - 1; tick++) {
          const leg = p.step;
          const was = { x: p.x, y: p.y };
          const end = path[leg + 1];
          const left = Math.hypot(end.x - was.x, end.y - was.y);
          people.tick(c.gdt, 1, 0.5);
          const moved = Math.hypot(p.x - was.x, p.y - was.y);
          const onRoad = leg >= 2;
          expect(moved, `tick ${tick}, leg ${leg}`).toBeCloseTo(Math.min(left, pace(onRoad)), 9);
        }
        expect(p.step).toBe(path.length - 1);
      },
    );
  });
});

// ------------------------------------------------------------------ the spur search (#408)

/**
 * A seeded patch for `findSpur`: a small grid whose tiles may each hold a plain straight (rails
 * north to south or east to west), a road (of the network a spur joins, or not), or be closed to a
 * spur (`free` says no), and the reach tile a spur starts from, which holds no road. About a third
 * are corridors one or two tiles deep and 11 to 15 long, the start at the west end and the network
 * at the east end, so the bound of SPUR_REACH tiles is met and passed.
 */
interface SpurPatch {
  w: number;
  h: number;
  from: { x: number; y: number };
  rails: { x: number; y: number; ns: boolean }[];
  roads: { x: number; y: number; net: boolean }[];
  closed: { x: number; y: number }[];
  /** `findSpur` is asked with no network of its own: every road is one */
  anyRoad: boolean;
}
function genPatch(rng: Rng): SpurPatch {
  const corridor = rng.chance(0.35);
  const w = corridor ? rng.int(11, 15) : rng.int(1, 8);
  const h = corridor ? rng.int(1, 2) : rng.int(1, Math.min(6, Math.floor(40 / w)));
  const from = { x: corridor ? 0 : rng.int(0, w - 1), y: rng.int(0, h - 1) };
  const rails: SpurPatch['rails'] = [];
  const roads: SpurPatch['roads'] = [];
  const closed: SpurPatch['closed'] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (rng.chance(corridor ? 0.08 : 0.2)) rails.push({ x, y, ns: rng.chance(0.5) });
      // the start may be closed: `free` is not asked about it
      if (rng.chance(corridor ? 0.04 : 0.15)) closed.push({ x, y });
      else if (x === from.x && y === from.y) continue;
      else if (corridor ? x === w - 1 : rng.chance(0.12))
        roads.push({ x, y, net: corridor || rng.chance(0.7) });
    }
  return { w, h, from, rails, roads, closed, anyRoad: rng.chance(0.3) };
}
/**
 * A seeded patch round a hook, where the fewest steps run along the rails of the spur's own
 * crossing: a line of plain straights ends on a tile P, its rails running on to the tile A beyond
 * that end, and the start lies further along that way. A wall, closed tiles or roads of no network,
 * shuts the side of the line the network lies on from the patch's edge to A's row, so the way
 * crosses on P, or further along the line, or goes round its far end. Stepping on to A and round
 * it to P is as short as stepping aside before A, so the first of the shortest ways judged step by
 * step often runs through A, and the spur is another of that length, a longer one, or none.
 * Drawn north to south, then mirrored or not and turned to any of the four rotations, with
 * straights, closed tiles and roads scattered over the rest.
 */
function genHookPatch(rng: Rng): SpurPatch {
  const w = rng.int(4, 8);
  const h = rng.int(4, Math.min(8, Math.floor(48 / w)));
  const px = rng.int(1, w - 2);
  const py = rng.int(2, h - 1);
  const kept = new Set<string>();
  const keep = (x: number, y: number) => kept.add(`${x},${y}`);
  const rails: SpurPatch['rails'] = [];
  const roads: SpurPatch['roads'] = [];
  const closed: SpurPatch['closed'] = [];
  // the line, from P south
  for (let y = py; y < h && (y === py || rng.chance(0.6)); y++) {
    rails.push({ x: px, y, ns: true });
    keep(px, y);
  }
  // the start north of A, the way down to A open, and the tiles west of A and P
  const from = { x: px, y: rng.int(0, py - 2) };
  for (let y = from.y; y < py; y++) keep(px, y);
  keep(px - 1, py - 1);
  keep(px - 1, py);
  // the wall east of the start and A
  for (let y = 0; y < py; y++) {
    keep(px + 1, y);
    if (rng.chance(0.5)) closed.push({ x: px + 1, y });
    else roads.push({ x: px + 1, y, net: false });
  }
  // a network road east of the line, level with P or south of it
  const net = { x: rng.int(px + 1, w - 1), y: rng.int(py, h - 1) };
  roads.push({ ...net, net: true });
  keep(net.x, net.y);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (kept.has(`${x},${y}`)) continue;
      const r = rng.next();
      if (r < 0.08) rails.push({ x, y, ns: rng.chance(0.5) });
      else if (r < 0.14) closed.push({ x, y });
      else if (r < 0.18) roads.push({ x, y, net: rng.chance(0.5) });
    }
  // mirrored east to west or not, then turned a quarter clockwise `turns` times
  const mirror = rng.chance(0.5);
  const turns = rng.int(0, 3);
  const odd = turns % 2 === 1;
  const place = <T extends { x: number; y: number }>(t: T): T => {
    let x = mirror ? w - 1 - t.x : t.x;
    let y = t.y;
    let tall = h;
    for (let i = 0; i < turns; i++) {
      [x, y] = [tall - 1 - y, x];
      tall = tall === h ? w : h;
    }
    return { ...t, x, y };
  };
  return {
    w: odd ? h : w,
    h: odd ? w : h,
    from: place(from),
    rails: rails.map((r) => ({ ...place(r), ns: r.ns !== odd })),
    roads: roads.map(place),
    closed: closed.map(place),
    anyRoad: false,
  };
}
/** The patches are small and quick: four hundred of them, so the bound is met often enough. */
const PATCH_SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);
function* shrinkPatch(c: SpurPatch): Iterable<SpurPatch> {
  for (const rails of shrinkArray(c.rails)) yield { ...c, rails };
  for (const roads of shrinkArray(c.roads)) yield { ...c, roads };
  for (const closed of shrinkArray(c.closed)) yield { ...c, closed };
}

/** What the patch says of each tile, read from the case alone, apart from any track or roads. */
function patchRules(c: SpurPatch) {
  const at = (x: number, y: number) => `${x},${y}`;
  const rails = new Map(
    c.rails.map((r) => [at(r.x, r.y), r.ns ? [Dir.N, Dir.S] : [Dir.E, Dir.W]] as const),
  );
  const road = new Set(c.roads.map((r) => at(r.x, r.y)));
  const net = new Set(c.roads.filter((r) => r.net || c.anyRoad).map((r) => at(r.x, r.y)));
  const closed = new Set(c.closed.map((t) => at(t.x, t.y)));
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < c.w && y < c.h;
  /** a step from (x, y) across its side `d` runs along no rails, of either tile */
  const across = (x: number, y: number, d: Dir) =>
    !rails.get(at(x, y))?.includes(d) &&
    !rails.get(at(x + DIR_DX[d], y + DIR_DY[d]))?.includes(opposite(d));
  /** (x, y) shares a side with a network road, the step to it along no rails */
  const joins = (x: number, y: number) =>
    DIRS.some((d) => across(x, y, d) && net.has(at(x + DIR_DX[d], y + DIR_DY[d])));
  /** a tile after the first may carry the spur */
  const open = (x: number, y: number) =>
    inside(x, y) && !road.has(at(x, y)) && !closed.has(at(x, y));
  return { at, net, across, joins, open };
}

/**
 * The fewest tiles of a spur from the patch's start, by exhaustive search over every simple path
 * of at most `bound` tiles: each tile after the first open, and sharing no side either tile's
 * rails run through with any tile of the path before it (so each step crosses rails at right
 * angles, and no tile lies where the rails of another tile of the path run on to), the last
 * joining a network road across such a side too. Infinity when there is none. A path that could
 * not end shorter than the best found, or within the bound, is cut, by the Manhattan distance to
 * the nearest network road, which never overstates what is left.
 */
function fewestByHand(c: SpurPatch, bound: number): number {
  const { at, net, across, joins, open } = patchRules(c);
  const goals = [...net].map((k) => k.split(',').map(Number));
  if (!goals.length) return Infinity;
  /** the fewest tiles still to come after (x, y), which joins no network road: one at least */
  const left = (x: number, y: number) =>
    Math.max(1, Math.min(...goals.map(([gx, gy]) => Math.abs(gx - x) + Math.abs(gy - y))) - 1);
  let best = Infinity;
  const on = new Set<string>();
  const visit = (x: number, y: number, n: number) => {
    if (joins(x, y)) {
      best = Math.min(best, n);
      return;
    }
    if (n + left(x, y) >= best || n + left(x, y) > bound) return;
    on.add(at(x, y));
    for (const d of DIRS) {
      const nx = x + DIR_DX[d];
      const ny = y + DIR_DY[d];
      const clear = DIRS.every(
        (e) => !on.has(at(nx + DIR_DX[e], ny + DIR_DY[e])) || across(nx, ny, e),
      );
      if (open(nx, ny) && !on.has(at(nx, ny)) && clear) visit(nx, ny, n + 1);
    }
    on.delete(at(x, y));
  };
  visit(c.from.x, c.from.y, 1);
  return best;
}

/** What is wrong with a spur `findSpur` gave for the patch, '' when nothing is. */
function spurFault(c: SpurPatch, spur: { x: number; y: number }[]): string {
  const { at, across, joins, open } = patchRules(c);
  if (!spur.length) return 'an empty spur';
  if (at(spur[0].x, spur[0].y) !== at(c.from.x, c.from.y))
    return `starts at ${at(spur[0].x, spur[0].y)}`;
  if (spur.length > SPUR_REACH) return `${spur.length} tiles, more than ${SPUR_REACH}`;
  const seen = new Set([at(c.from.x, c.from.y)]);
  for (let i = 1; i < spur.length; i++) {
    const { x, y } = spur[i];
    const p = spur[i - 1];
    if (!open(x, y)) return `${at(x, y)} is a road, closed or off the patch`;
    if (seen.has(at(x, y))) return `${at(x, y)} twice`;
    seen.add(at(x, y));
    const d = DIRS.find((s) => p.x + DIR_DX[s] === x && p.y + DIR_DY[s] === y);
    if (d === undefined) return `${at(p.x, p.y)} and ${at(x, y)} share no side`;
    if (!across(p.x, p.y, d)) return `${at(p.x, p.y)} to ${at(x, y)} runs along rails`;
  }
  // judged whole: no two tiles of it share a side either one's rails run through
  for (const { x, y } of spur)
    for (const d of DIRS)
      if (seen.has(at(x + DIR_DX[d], y + DIR_DY[d])) && !across(x, y, d))
        return `${at(x, y)} and ${at(x + DIR_DX[d], y + DIR_DY[d])} share a side rails run through`;
  const last = spur[spur.length - 1];
  if (!joins(last.x, last.y)) return `ends at ${at(last.x, last.y)}, joining no network road`;
  return '';
}

/** The sides a path's steps leave through, in turn. */
const stepsOf = (path: { x: number; y: number }[]): Dir[] =>
  path
    .slice(1)
    .map((t, i) =>
      DIRS.find((d) => path[i].x + DIR_DX[d] === t.x && path[i].y + DIR_DY[d] === t.y)!,
    );

/**
 * The first of the spurs with the fewest tiles from the patch's start, by exhaustive search over
 * every simple path of at most `bound` tiles, and how many spurs have that many tiles. Of spurs
 * alike in length the first is the one whose steps come first, compared in turn, a step's side
 * ranked N, E, S, W. `whole` judges a path as `fewestByHand` does: no tile of it shares a side
 * either tile's rails run through with any other tile of it. Otherwise only each step is judged,
 * across a side no rails of either tile run through, the rule `findSpur` kept before it judged a
 * spur whole. A path that could not end within the bound, or in as few tiles as the best found, is
 * cut by the Manhattan distance to the nearest network road. Null and 0 when there is none.
 */
function firstShortestByHand(c: SpurPatch, bound: number, whole: boolean) {
  const { at, net, across, joins, open } = patchRules(c);
  const goals = [...net].map((k) => k.split(',').map(Number));
  /** the fewest tiles still to come after (x, y), which joins no network road: one at least */
  const left = (x: number, y: number) =>
    Math.max(1, Math.min(...goals.map(([gx, gy]) => Math.abs(gx - x) + Math.abs(gy - y))) - 1);
  /** `a` comes before `b`, both of one length, by their steps in turn */
  const before = (a: { x: number; y: number }[], b: { x: number; y: number }[]) => {
    const sa = stepsOf(a);
    const sb = stepsOf(b);
    const i = sa.findIndex((d, j) => d !== sb[j]);
    return i >= 0 && sa[i] < sb[i];
  };
  let first: { x: number; y: number }[] | null = null;
  let count = 0;
  const path: { x: number; y: number }[] = [];
  const on = new Set<string>();
  const visit = (x: number, y: number) => {
    path.push({ x, y });
    on.add(at(x, y));
    const n = path.length;
    if (joins(x, y)) {
      if (!first || n < first.length) {
        first = [...path];
        count = 1;
      } else if (n === first.length) {
        count++;
        if (before(path, first)) first = [...path];
      }
    } else if (n + left(x, y) <= bound && (!first || n + left(x, y) <= first.length)) {
      for (const d of DIRS) {
        const nx = x + DIR_DX[d];
        const ny = y + DIR_DY[d];
        if (!open(nx, ny) || on.has(at(nx, ny)) || !across(x, y, d)) continue;
        const clear = DIRS.every(
          (e) => !on.has(at(nx + DIR_DX[e], ny + DIR_DY[e])) || across(nx, ny, e),
        );
        if (!whole || clear) visit(nx, ny);
      }
    }
    path.pop();
    on.delete(at(x, y));
  };
  if (goals.length) visit(c.from.x, c.from.y);
  return { first: first as { x: number; y: number }[] | null, count };
}

/** Ask `findSpur` for the patch's spur, its rails laid as regular straights. */
function patchSpur(c: SpurPatch) {
  const track = new TrackGraph(c.w, c.h);
  for (const r of c.rails) track.place(r.x, r.y, 'straight', r.ns ? NS : EW, 'regular');
  const roads = new Roads(track);
  for (const r of c.roads) roads.add(r.x, r.y);
  const { at, net } = patchRules(c);
  const closed = new Set(c.closed.map((t) => at(t.x, t.y)));
  const free = (x: number, y: number) => !closed.has(at(x, y));
  return c.anyRoad
    ? findSpur(roads, c.from, free)
    : findSpur(roads, c.from, free, (x, y) => net.has(at(x, y)));
}

describe('the spur search', () => {
  it('finds as few tiles as an exhaustive search, and none exactly when no spur is within SPUR_REACH', () => {
    /** spurs exactly SPUR_REACH long; patches whose network is only further; spurs over rails */
    const seen = { atBound: 0, beyond: 0, crossings: 0 };
    forAll(
      genPatch,
      (c) => {
        const track = new TrackGraph(c.w, c.h);
        for (const r of c.rails) track.place(r.x, r.y, 'straight', r.ns ? NS : EW, 'regular');
        // the patch's rails are the track's
        for (const r of c.rails)
          expect([...track.get(r.x, r.y)!.links[0]].sort()).toEqual(
            (r.ns ? [Dir.N, Dir.S] : [Dir.E, Dir.W]).sort(),
          );
        const roads = new Roads(track);
        for (const r of c.roads) roads.add(r.x, r.y);
        const { at, net } = patchRules(c);
        const closed = new Set(c.closed.map((t) => at(t.x, t.y)));
        const free = (x: number, y: number) => !closed.has(at(x, y));
        const spur = c.anyRoad
          ? findSpur(roads, c.from, free)
          : findSpur(roads, c.from, free, (x, y) => net.has(at(x, y)));
        const fewest = fewestByHand(c, SPUR_REACH);
        if (fewest === Infinity) {
          expect(spur, 'a spur where an exhaustive search finds none').toBeNull();
          if (fewestByHand(c, SPUR_REACH + 3) < Infinity) seen.beyond++;
          return;
        }
        expect(spur, `no spur where one of ${fewest} tiles is`).not.toBeNull();
        expect(spurFault(c, spur!)).toBe('');
        expect(spur!.length).toBe(fewest);
        if (fewest === SPUR_REACH) seen.atBound++;
        if (spur!.some((t) => track.has(t.x, t.y))) seen.crossings++;
      },
      { shrink: shrinkPatch, seeds: PATCH_SEEDS },
    );
    // not vacuous: the bound was met and passed, and spurs went over rails
    expect(seen.atBound).toBeGreaterThanOrEqual(8);
    expect(seen.beyond).toBeGreaterThanOrEqual(20);
    expect(seen.crossings).toBeGreaterThanOrEqual(20);
  });

  // slow because each seeded patch and hook is searched for its spur and the search compared with
  // the rule: 0.39 s alone, so a limit of 30 s
  it('gives, of the spurs with the fewest tiles, the first by its steps, a step’s side ranked N, E, S, W', () => {
    // each generator with what its cases must show at least, so the property is not vacuous: the
    // patches break ties, and the hooks often need the spur judged whole, at times to SPUR_REACH
    for (const [name, gen, least] of [
      ['patch', genPatch, { ties: 20 }],
      ['hook', genHookPatch, { ties: 100, whole: 70, longer: 10, atBound: 2, none: 5 }],
    ] as const) {
      /**
       * patches with more than one spur of the fewest tiles; patches where the first of the
       * shortest ways judged step by step breaks the rule whole, the case judging a spur whole
       * changes, and of those where the spur is longer, where it is SPUR_REACH tiles, and where
       * there is none
       */
      const seen = { ties: 0, whole: 0, longer: 0, atBound: 0, none: 0 };
      forAll(
        gen,
        (c) => {
          const spur = patchSpur(c);
          const want = firstShortestByHand(c, SPUR_REACH, true);
          expect(spur, `${name}: ${want.count} spurs of the fewest tiles`).toEqual(want.first);
          if (want.count > 1) seen.ties++;
          // a spur judged whole is one judged step by step: with no way that keeps the steps, none
          const stepwise = firstShortestByHand(c, SPUR_REACH, false).first;
          if (!stepwise) return;
          // where the first way judged step by step keeps the rule whole, it is the spur
          if (!spurFault(c, stepwise)) {
            expect(spur, `${name}: the first way judged step by step`).toEqual(stepwise);
            return;
          }
          seen.whole++;
          if (!spur) seen.none++;
          else if (spur.length > stepwise.length) seen.longer++;
          if (spur?.length === SPUR_REACH) seen.atBound++;
        },
        { shrink: shrinkPatch, seeds: PATCH_SEEDS },
      );
      for (const [what, n] of Object.entries(least))
        expect(seen[what as keyof typeof seen], `${name}: ${what}`).toBeGreaterThanOrEqual(n);
    }
  }, 30_000);

  it('gives the same spur every time it is asked, and leaves the roads as they were', () => {
    forAll(genPatch, (c) => {
      const track = new TrackGraph(c.w, c.h);
      for (const r of c.rails) track.place(r.x, r.y, 'straight', r.ns ? NS : EW, 'regular');
      const roads = new Roads(track);
      for (const r of c.roads) roads.add(r.x, r.y);
      const before = { list: roads.toJSON(), version: roads.version };
      const ask = () => findSpur(roads, c.from, () => true);
      const first = ask();
      expect(ask()).toEqual(first);
      expect({ list: roads.toJSON(), version: roads.version }).toEqual(before);
    });
  });
});
