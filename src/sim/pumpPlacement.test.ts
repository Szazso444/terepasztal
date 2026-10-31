import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap, generateMap } from '../world/mapgen';
import { TERRAIN_NAMES, Terrain, startRegion, type GameMap } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph, type TrackItem } from '../world/track';
import { DIRS, DIR_DX, DIR_DY } from '../engine/iso';
import { buildRelief, groundAllows } from '../render/terrainRelief';
import { repairBuiltTiles } from '../engine/loadRepair';
import {
  DEFAULT_CONTENT,
  content,
  validateContent,
  type ContentBundle,
  type StationDef,
} from '../data/content';
import { forAll, shrinkArray } from '../testing/property';
import type { Rng } from '../engine/rng';
import { LAST_AGE } from './ages';
import { Builder, unbuildable } from './build';
import { BIOME_DEFS } from './biomes';
import { Economy } from './economy';
import {
  HARVEST_FLOOR,
  STATION_DEFS,
  Station,
  stationDef,
  stationFootprint,
  terrainFactorAt,
} from './stations';
import { SAVE_MIN_VERSION, SAVE_VERSION, parseSave, type SaveGame } from './save';
import { pruneUnknownContent } from './saveContent';
import { DEFAULT_RULES, rules, weekSeconds } from './rules';
import { mapParams } from '../testing/simWorld';
import { STR } from '../strings';
import { storeWith } from '../testing/storeFixtures';

// the build rules play a sound when a piece goes down
vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => Object.assign(rules, DEFAULT_RULES));

const SIZE = 24;
const X = 10;
const Y = 10;
/** the refusals the approved demo gives, word for word */
const GROUND = 'A water pump goes only on grass or forest.';
const WATER = 'A water pump needs water right beside it.';
const STRAIGHT: TrackItem = { kind: 'straight', cls: 'branch', cls2: 'branch' };

/** A builder in editor mode (no cost, no age or chunk lock) on level grass, every chunk owned. */
function grassWorld() {
  const map = emptyMap(7, SIZE, SIZE, Terrain.Grass);
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  const builder = new Builder(
    map,
    regions,
    new TrackGraph(SIZE, SIZE),
    new Economy(),
    storeWith({}).stores,
  );
  builder.free = true;
  return { map, builder };
}
function paint(map: GameMap, x: number, y: number, t: Terrain) {
  map.terrain[y * map.w + x] = t;
}
/**
 * A pump site at (X, Y) on `ground`: water on the side `water` (a `DIRS` entry) or on none, and
 * the platform track on the side opposite it.
 */
function site(ground: Terrain, water: number | null) {
  const w = grassWorld();
  paint(w.map, X, Y, ground);
  const side = water ?? DIRS[0];
  if (water !== null) paint(w.map, X + DIR_DX[water], Y + DIR_DY[water], Terrain.Water);
  w.builder.track.place(X - DIR_DX[side], Y - DIR_DY[side], 'straight', DIR_DX[side] ? 1 : 0);
  return w;
}

describe('where a water pump stands', () => {
  it('carries its two placement fields, apart from the terrain it draws from', () => {
    const def = stationDef('pump');
    expect(def.standOn).toEqual(['grass', 'forest']);
    expect(def.needsWater).toBe(true);
    expect(def.terrain).toBe('water');
    // the strings are the demo's, and its flavour says where it stands
    expect(STR.build.standOn.pump).toBe(GROUND);
    expect(STR.build.besideWater.pump).toBe(WATER);
    expect(def.flavor).toMatch(/grass or forest/);
    expect(def.flavor).toMatch(/water right beside it/);
  });

  it('stands on level grass or forest with water on any one of its four sides', () => {
    for (const ground of [Terrain.Grass, Terrain.Forest])
      for (const d of DIRS) {
        const { builder } = site(ground, d);
        const c = builder.checkStation(X, Y, 'pump');
        expect(c, `${TERRAIN_NAMES[ground]}, water toward ${d}`).toMatchObject({ ok: true });
        expect(c.reason).toBeUndefined();
      }
  });

  it('is refused with the water reason when the water lies only on a diagonal', () => {
    for (const ground of [Terrain.Grass, Terrain.Forest]) {
      const { map, builder } = site(ground, null);
      for (const [dx, dy] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ])
        paint(map, X + dx, Y + dy, Terrain.Water);
      expect(builder.checkStation(X, Y, 'pump')).toMatchObject({ ok: false, reason: WATER });
    }
  });

  it('is refused with the water reason when the water is a tile further out', () => {
    const { map, builder } = site(Terrain.Grass, null);
    paint(map, X + 2, Y, Terrain.Water);
    paint(map, X, Y + 2, Terrain.Water);
    expect(builder.checkStation(X, Y, 'pump')).toMatchObject({ ok: false, reason: WATER });
  });

  it('is refused on sand or a hill with the ground reason, water beside it or not', () => {
    for (const ground of [Terrain.Sand, Terrain.Hill])
      for (const water of [...DIRS, null]) {
        const { builder } = site(ground, water);
        expect(
          builder.checkStation(X, Y, 'pump'),
          `${TERRAIN_NAMES[ground]}, water toward ${water}`,
        ).toMatchObject({ ok: false, reason: GROUND });
      }
  });

  it('counts the water of any biome: lake, river, sea, swamp and the rest', () => {
    let tried = 0;
    for (let b = 0; b < BIOME_DEFS.length; b++) {
      const { map, builder } = site(Terrain.Grass, DIRS[1]);
      map.biome[(Y + DIR_DY[DIRS[1]]) * map.w + X + DIR_DX[DIRS[1]]] = b;
      expect(builder.checkStation(X, Y, 'pump').ok, BIOME_DEFS[b].id).toBe(true);
      tried++;
    }
    expect(tried).toBeGreaterThanOrEqual(6);
  });

  it('asks its own rules after the ones every station keeps, ground first, then water', () => {
    // no track beside it: the rule every station keeps speaks first
    const bare = grassWorld();
    paint(bare.map, X, Y, Terrain.Sand);
    expect(bare.builder.checkStation(X, Y, 'pump').reason).toBe(STR.build.needTrack);
    // ground that is not level, and an occupied tile, the same
    const slope = site(Terrain.Sand, null);
    slope.builder.groundCheck = (x, y, need) => need !== 'level' || x !== X || y !== Y;
    expect(slope.builder.checkStation(X, Y, 'pump').reason).toBe(STR.build.notLevel);
    const taken = site(Terrain.Sand, null);
    taken.builder.track.place(X, Y, 'straight', 0, 'branch');
    expect(taken.builder.checkStation(X, Y, 'pump').reason).toBe(STR.build.occupied);
    // where nothing can be built, that says so, water beside it or not
    for (const ground of [Terrain.Rock, Terrain.Mountain, Terrain.Water]) {
      const { builder } = site(ground, DIRS[2]);
      expect(builder.checkStation(X, Y, 'pump').reason).toBe(
        STR.build.nothingOn[TERRAIN_NAMES[ground] as 'rock'],
      );
    }
    // then the ground, before the water
    expect(site(Terrain.Sand, null).builder.checkStation(X, Y, 'pump').reason).toBe(GROUND);
  });

  it('asks them before the price', () => {
    for (const [ground, water, want] of [
      [Terrain.Sand, DIRS[0], GROUND],
      [Terrain.Grass, null, WATER],
    ] as const) {
      const { builder } = site(ground, water);
      // a game, not the editor, with nothing in the stock
      builder.free = false;
      expect(builder.checkStation(X, Y, 'pump').reason).toBe(want);
    }
    // where both are met, the price is what is asked next
    const { builder } = site(Terrain.Grass, DIRS[0]);
    builder.free = false;
    const c = builder.checkStation(X, Y, 'pump');
    expect(c.ok).toBe(false);
    expect(c.reason?.startsWith(STR.build.noStoreInReach(rules.buildReach, ''))).toBe(true);
  });

  it('places as checked, with the ground factor its harvest gives it', () => {
    const { builder, map } = site(Terrain.Forest, DIRS[3]);
    const s = builder.placeStation(X, Y, 'pump');
    expect(s).not.toBeNull();
    expect(s!.terrainFactor).toBe(terrainFactorAt(map, X, Y, 'pump'));
    const refused = site(Terrain.Sand, DIRS[3]);
    expect(refused.builder.placeStation(X, Y, 'pump')).toBeNull();
    expect(refused.builder.stations).toEqual([]);
  });

  it('is the only station with ground rules of its own', () => {
    expect(STATION_DEFS.filter((d) => d.standOn || d.needsWater).map((d) => d.id)).toEqual([
      'pump',
    ]);
  });
});

/** The seeds the placement properties run: 1 to 400, one small world each. */
const SEEDS_400: readonly number[] = Array.from({ length: 400 }, (_, i) => i + 1);

/** A small world around a pump site: every tile's terrain and relief, and what stands on it. */
interface PumpCase {
  w: number;
  h: number;
  /** `Terrain` of each tile, row by row */
  terrain: number[];
  /** whether each tile is level */
  level: boolean[];
  /** straights laid directly, as [x, y, rot] */
  track: [number, number, number][];
  /** tiles a townhouse stands on */
  taken: [number, number][];
  /** a game (prices, chunk lock) rather than the editor */
  game: boolean;
  /** the one chunk is owned */
  owned: boolean;
  /** the depot can pay for anything */
  stocked: boolean;
  x: number;
  y: number;
}

/** Terrains drawn for a tile, the ones a pump turns on drawn more often. */
const DRAWN = [
  Terrain.Grass,
  Terrain.Grass,
  Terrain.Forest,
  Terrain.Forest,
  Terrain.Water,
  Terrain.Water,
  Terrain.Water,
  Terrain.Sand,
  Terrain.Hill,
  Terrain.Rock,
  Terrain.Mountain,
];
/** Terrains drawn for the site itself besides `DRAWN`: the ground something can be built on. */
const SITE = [Terrain.Grass, Terrain.Forest, Terrain.Sand, Terrain.Hill];
/** The four sides of a tile, written out rather than read from `DIRS`. */
const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

function genPumpCase(rng: Rng): PumpCase {
  const w = rng.int(3, 7),
    h = rng.int(3, 7);
  const x = rng.int(0, w - 1),
    y = rng.int(0, h - 1);
  const terrain = Array.from({ length: w * h }, () => rng.pick(DRAWN));
  // the site itself is mostly ground something can be built on, so the pump's rules are reached
  terrain[y * w + x] = rng.pick([...SITE, ...DRAWN]);
  const level = Array.from({ length: w * h }, () => rng.chance(0.9));
  const track: [number, number, number][] = [];
  // most sites get a rail on a side or two; now and then one lies on the site itself
  for (const [dx, dy] of SIDES) {
    const tx = x + dx,
      ty = y + dy;
    if (tx >= 0 && ty >= 0 && tx < w && ty < h && rng.chance(0.5)) track.push([tx, ty, dx ? 1 : 0]);
  }
  if (rng.chance(0.08)) track.push([x, y, rng.int(0, 1)]);
  const taken: [number, number][] = rng.chance(0.08) ? [[x, y]] : [];
  const game = rng.chance(0.5);
  return {
    w,
    h,
    terrain,
    level,
    track,
    taken,
    game,
    owned: !game || rng.chance(0.85),
    stocked: rng.chance(0.6),
    x,
    y,
  };
}

function* shrinkPumpCase(c: PumpCase): Iterable<PumpCase> {
  if (c.game) yield { ...c, game: false, owned: true };
  if (!c.owned) yield { ...c, owned: true };
  if (c.taken.length) yield { ...c, taken: [] };
  for (const track of shrinkArray(c.track)) yield { ...c, track };
  for (let i = 0; i < c.level.length; i++)
    if (!c.level[i]) yield { ...c, level: c.level.map((l, j) => l || j === i) };
  for (let i = 0; i < c.terrain.length; i++)
    if (c.terrain[i] !== Terrain.Grass)
      yield { ...c, terrain: c.terrain.map((t, j) => (j === i ? Terrain.Grass : t)) };
}

/** The case as rows of terrain letters (the site in brackets, a slope lower-case), then the rest. */
function formatPumpCase(c: PumpCase): string {
  const rows: string[] = [];
  for (let y = 0; y < c.h; y++) {
    let row = '';
    for (let x = 0; x < c.w; x++) {
      const i = y * c.w + x;
      const ch = 'GFHWRSM'[c.terrain[i]];
      const t = c.level[i] ? ch : ch.toLowerCase();
      row += x === c.x && y === c.y ? `[${t}]` : ` ${t} `;
    }
    rows.push(row);
  }
  const { track, taken, game, owned, stocked, x, y } = c;
  return `\n${rows.join('\n')}\n${JSON.stringify({ x, y, track, taken, game, owned, stocked })}`;
}

/** The builder of a case: its map, chunk, relief, track, townhouses, mode and stock. */
function pumpCaseWorld(c: PumpCase) {
  const map = emptyMap(7, c.w, c.h, Terrain.Grass);
  c.terrain.forEach((t, i) => (map.terrain[i] = t));
  const regions = new RegionState(map);
  regions.unlocked[0] = c.owned;
  const economy = new Economy();
  // a depot in reach of the whole case
  const { stores, depot } = storeWith({});
  const builder = new Builder(map, regions, new TrackGraph(c.w, c.h), economy, stores);
  builder.free = !c.game;
  builder.groundCheck = (x, y) => c.level[y * c.w + x];
  economy.tier = LAST_AGE;
  if (c.stocked) for (const k of content.cargo) depot.amounts.set(k.id, 1e6);
  for (const [x, y, rot] of c.track) builder.track.place(x, y, 'straight', rot, 'branch');
  for (const [x, y] of c.taken) builder.decor.set(y * c.w + x, { id: 'townhouse', x, y, rot: 0 });
  return { map, builder };
}

describe("the water pump's check, against a plain station's and the ground around it", () => {
  /**
   * The station the pump is held against: one tile at every turn, no ground rules of its own, no
   * gauge, depot or spacing rule, of the pump's age and chain. What refuses it refuses the pump.
   */
  const pump = stationDef('pump');
  const plain = STATION_DEFS.find(
    (d) =>
      !d.standOn &&
      !d.needsWater &&
      !d.depot &&
      !d.gauge &&
      d.id !== 'town' &&
      d.tier === pump.tier &&
      d.supply === pump.supply &&
      [0, 1].every((rot) => stationFootprint(d.id, 0, 0, rot).length === 1),
  ) as StationDef;

  it('is refused first for what refuses a plain station, then ground, then water, then price', () => {
    expect(plain, 'a plain one-tile station to hold the pump against').toBeDefined();
    const seen = { general: 0, ground: 0, water: 0, ok: 0, price: 0 };
    const priced = (r: string | undefined) =>
      !!r?.startsWith(STR.build.noStoreInReach(rules.buildReach, ''));
    forAll(
      genPumpCase,
      (c) => {
        const { map, builder } = pumpCaseWorld(c);
        const base = builder.checkStation(c.x, c.y, plain.id);
        const got = builder.checkStation(c.x, c.y, 'pump');
        // a refusal every station keeps comes first, whatever the ground around
        if (base.reason !== undefined && !priced(base.reason)) {
          seen.general++;
          expect(got.reason, `as ${plain.id}`).toBe(base.reason);
          return;
        }
        // then the ground the issue names, then water on a side inside the map, then the price
        const own = TERRAIN_NAMES[map.terrain[c.y * c.w + c.x]];
        const wet = SIDES.some(([dx, dy]) => {
          const x = c.x + dx,
            y = c.y + dy;
          return x >= 0 && y >= 0 && x < c.w && y < c.h && c.terrain[y * c.w + x] === Terrain.Water;
        });
        if (own !== 'grass' && own !== 'forest') {
          seen.ground++;
          expect(got).toMatchObject({ ok: false, reason: GROUND });
        } else if (!wet) {
          seen.water++;
          expect(got).toMatchObject({ ok: false, reason: WATER });
        } else if (!c.game || c.stocked) {
          seen.ok++;
          expect(got.ok, got.reason).toBe(true);
        } else {
          seen.price++;
          expect(got.ok).toBe(false);
          expect(priced(got.reason), got.reason).toBe(true);
        }
      },
      { seeds: SEEDS_400, shrink: shrinkPumpCase, format: formatPumpCase },
    );
    // every branch was reached, so the property is not empty
    for (const [branch, n] of Object.entries(seen)) expect(n, branch).toBeGreaterThan(4);
  });

  it('holds any station the content gives the fields to, on every tile and on every side', () => {
    // the content editor may give them to any station: here a two-by-two one with no line of its
    // own, so the fallback reasons speak
    const wide: StationDef = {
      ...stationDef('farm'),
      id: 'test_wide_pump',
      size: 2,
      standOn: ['grass', 'forest'],
      needsWater: true,
    };
    STATION_DEFS.push(wide);
    const seen = { unbuildable: 0, ground: 0, water: 0, ok: 0 };
    try {
      expect(STR.build.standOn[wide.id]).toBeUndefined();
      forAll(
        (rng) => {
          // most footprints are of the ground it takes, and the water around is often missing
          const groundOnly = rng.chance(0.6);
          const wet = rng.pick([0, 0.08, 0.3]);
          const terrain = Array.from({ length: 36 }, (_, i) => {
            const x = i % 6,
              y = Math.floor(i / 6);
            const inFoot = x >= 2 && x <= 3 && y >= 2 && y <= 3;
            if (inFoot && groundOnly) return rng.pick([Terrain.Grass, Terrain.Forest]);
            if (inFoot) return rng.pick(DRAWN);
            return rng.chance(wet) ? Terrain.Water : rng.pick(SITE);
          });
          return { terrain, rot: rng.int(0, 3) };
        },
        (c) => {
          const map = emptyMap(7, 6, 6, Terrain.Grass);
          c.terrain.forEach((t, i) => (map.terrain[i] = t));
          const regions = new RegionState(map);
          const builder = new Builder(
            map,
            regions,
            new TrackGraph(6, 6),
            new Economy(),
            storeWith({}).stores,
          );
          builder.free = true;
          builder.track.place(1, 2, 'straight', 1, 'branch');
          // the footprint is (2, 2) to (3, 3); the ring is the eight tiles beside it, outside it
          const foot = [
            [2, 2],
            [3, 2],
            [2, 3],
            [3, 3],
          ];
          const ring = [
            [1, 2],
            [1, 3],
            [4, 2],
            [4, 3],
            [2, 1],
            [3, 1],
            [2, 4],
            [3, 4],
          ];
          const at = ([x, y]: readonly number[]) => c.terrain[y * 6 + x] as Terrain;
          const got = builder.checkStation(2, 2, wide.id, c.rot).reason;
          const bad = foot.map((f) => unbuildable(at(f))).filter((r) => r !== null);
          if (bad.length) {
            seen.unbuildable++;
            expect(bad).toContain(got);
          } else if (foot.some((f) => at(f) !== Terrain.Grass && at(f) !== Terrain.Forest)) {
            seen.ground++;
            expect(got).toBe(STR.build.needGround(['grass', 'forest']));
          } else if (!ring.some((r) => at(r) === Terrain.Water)) {
            seen.water++;
            expect(got).toBe(STR.build.needWaterside);
          } else {
            seen.ok++;
            expect(got).toBeUndefined();
          }
        },
        {
          seeds: SEEDS_400,
          format: (c) =>
            `rot ${c.rot}\n` +
            Array.from({ length: 6 }, (_, y) =>
              c.terrain
                .slice(y * 6, y * 6 + 6)
                .map((t) => 'GFHWRSM'[t])
                .join(' '),
            ).join('\n'),
        },
      );
    } finally {
      STATION_DEFS.splice(STATION_DEFS.indexOf(wide), 1);
    }
    expect(STATION_DEFS.some((d) => d.id === wide.id)).toBe(false);
    // every branch was reached, so the property is not empty
    for (const [branch, n] of Object.entries(seen)) expect(n, branch).toBeGreaterThan(4);
  });
});

describe('the placement fields in the content', () => {
  /** The shipped bundle with the pump's entry changed by `edit`. */
  function withPump(edit: (pump: Record<string, unknown>) => void): ContentBundle {
    const b = JSON.parse(JSON.stringify(DEFAULT_CONTENT)) as ContentBundle;
    edit(b.stations.defs.find((d) => d.id === 'pump') as unknown as Record<string, unknown>);
    return b;
  }

  it('ships valid, and takes any ground something can be built on', () => {
    expect(validateContent(DEFAULT_CONTENT)).toEqual([]);
    expect(validateContent(withPump((p) => (p.standOn = ['hill', 'sand'])))).toEqual([]);
    expect(validateContent(withPump((p) => delete p.standOn))).toEqual([]);
    expect(validateContent(withPump((p) => (p.needsWater = false)))).toEqual([]);
  });

  it('reports a standOn that lists no such ground, and a needsWater that is no flag', () => {
    for (const bad of [[], ['water'], ['rock'], ['grass', 'lava'], 'grass', 3, null])
      expect(validateContent(withPump((p) => (p.standOn = bad))), JSON.stringify(bad)).toEqual([
        expect.stringContaining('station pump: standOn'),
      ]);
    for (const bad of ['yes', 1, null])
      expect(validateContent(withPump((p) => (p.needsWater = bad))), JSON.stringify(bad)).toEqual([
        expect.stringContaining('station pump: needsWater'),
      ]);
  });
});

describe('a pump a save holds where it may no longer be placed', () => {
  /** A save of `version` holding one pump at (X, Y), as an older build wrote it. */
  function saveText(version: number): string {
    const save: SaveGame = {
      version,
      savedAt: 1700000000000,
      seed: 12345,
      clock: { time: 0, speedIndex: 1 },
      economy: { money: 1000, tier: 0 },
      track: [[X - 1, Y, 'straight', 1, 'branch', 'branch']],
      stations: [
        { id: 1, defId: 'pump', name: 'Water Pump', x: X, y: Y, level: 2, storage: { water: 5 } },
      ],
      trains: [],
      contracts: { contracts: [] },
      inventory: { items: [] },
      camera: { x: 0, y: 0, zoomIndex: 2 },
      lastDay: 0,
    };
    return JSON.stringify(save);
  }

  it('loads on sand far from water, and makes water on the ground factor it had', () => {
    for (const version of [SAVE_MIN_VERSION, SAVE_VERSION]) {
      // sand everywhere, no water within reach: what an older build placed it on
      const { map, builder } = grassWorld();
      map.terrain.fill(Terrain.Sand);
      const placed = terrainFactorAt(map, X, Y, 'pump');
      expect(placed).toBe(HARVEST_FLOOR);

      // the load as Game.applySave runs it: content pruned, built ground repaired, stations
      // restored, the harvest refreshed
      const save = parseSave(saveText(version));
      expect(save, `v${version}`).not.toBeNull();
      expect(pruneUnknownContent(save!).dropped).toEqual([]);
      expect(repairBuiltTiles(map, save!), `v${version}: the sand stays`).toEqual([]);
      for (const sj of save!.stations) builder.stations.push(Station.fromJSON(sj));
      builder.refreshHarvest();

      const pump = builder.stations[0];
      expect(pump.def.id).toBe('pump');
      expect(pump.level).toBe(2);
      expect(pump.terrainFactor, `v${version}`).toBe(placed);
      const before = pump.stored('water');
      pump.tick(weekSeconds());
      expect(pump.stored('water')).toBeGreaterThan(before);
      // a new pump is refused there, the one standing is not touched
      builder.track.place(X + 2, Y, 'straight', 1, 'branch');
      expect(builder.checkStation(X + 3, Y, 'pump').reason).toBe(GROUND);
      expect(builder.stations).toEqual([pump]);
    }
  });
});

/**
 * Whether a pump may stand somewhere in the start chunk of a new game's map: on a tile of the
 * chunk, with track laid beside it on a tile of the chunk, the builder's own check accepts it.
 * The ground counts as level where the renderer's relief says so, as in the game.
 */
function startChunkPumpTile(map: GameMap): { x: number; y: number } | null {
  const regions = new RegionState(map);
  const builder = new Builder(
    map,
    regions,
    new TrackGraph(map.w, map.h),
    new Economy(),
    storeWith({}).stores,
  );
  // the editor's leave: no cost, so only the ground decides; the chunk is kept to by hand
  builder.free = true;
  const relief = buildRelief(map, new Set());
  builder.groundCheck = (x, y, need) => groundAllows(map, relief, x, y, need);
  const rs = map.regionSize;
  const { rx, ry } = startRegion(map);
  const inChunk = (x: number, y: number) =>
    x >= rx * rs && y >= ry * rs && x < (rx + 1) * rs && y < (ry + 1) * rs;
  const water = (x: number, y: number) =>
    DIRS.some((d) => map.terrain[(y + DIR_DY[d]) * map.w + x + DIR_DX[d]] === Terrain.Water);
  for (let y = ry * rs; y < (ry + 1) * rs; y++)
    for (let x = rx * rs; x < (rx + 1) * rs; x++) {
      // only a tile with water beside it can take one: the builder judges those
      if (!water(x, y)) continue;
      for (const d of DIRS) {
        const tx = x + DIR_DX[d],
          ty = y + DIR_DY[d];
        if (!inChunk(tx, ty)) continue;
        const rot = DIR_DX[d] ? 1 : 0;
        if (!builder.checkTrack(tx, ty, STRAIGHT, rot).ok) continue;
        builder.track.place(tx, ty, 'straight', rot, 'branch');
        const ok = builder.checkStation(x, y, 'pump').ok;
        builder.track.removeAt(tx, ty);
        if (ok) return { x, y };
      }
    }
  return null;
}

describe('the start chunk of a new game', () => {
  // slow: fifty maps generated at the default size, about two seconds alone
  it('has a tile where a pump may stand, over 50 seeds at the default size', () => {
    const size = DEFAULT_RULES.mapSize;
    const missing: number[] = [];
    for (let seed = 1; seed <= 50; seed++) {
      const map = generateMap(seed, mapParams(size));
      if (!startChunkPumpTile(map)) missing.push(seed);
    }
    // map generation guarantees one (`startPump`): a seed listed here is a regression, replayed by
    // generating that seed alone at the default size
    expect(missing, 'seeds whose start chunk has no tile a pump may stand on').toEqual([]);
  }, 120_000);
});
