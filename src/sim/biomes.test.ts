import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { BIOME_NAMES, TERRAIN_NAMES, Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TRACK_ITEMS, TrackGraph, pieceCost, rotationCount, type TrackItem } from '../world/track';
import { Dir } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { content, type Cost } from '../data/content';
import trackData from '../data/track.json';
import { forAll } from '../testing/property';
import { BIOME_DEFS, type BiomeDef } from './biomes';
import { Builder } from './build';
import { Stockpile, scaleCost } from './stockpile';
import { Economy } from './economy';
import { Fleet } from './fleet';
import { Station, resetStationIds } from './stations';
import { Train, resetTrainIds, type TickCtx } from './trains';
import { lineSpeedCap } from './lineSpeed';
import { setSupplyMode } from './supply';
import { Inventory } from '../gacha/inventory';
import { rules, DEFAULT_RULES } from './rules';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode('simple');
  resetTrainIds();
  resetStationIds();
});

/** Mountain's id: appended after Lake 6, River 7 and Beach 8. */
const MOUNTAIN = 9;
const FIELDS: (keyof BiomeDef)[] = [
  'id',
  'name',
  'desc',
  'production',
  'trackCostMul',
  'waterUseMul',
  'speedMul',
  'snowLevel',
];

/** The six entries as they stood before `snowLevel`, key order included. */
const BEFORE = [
  {
    id: 'plains',
    name: 'Plains',
    desc: 'Open grassland. Farms thrive.',
    production: { farm: 1.25 },
    trackCostMul: 1,
    waterUseMul: 1,
    speedMul: 1,
  },
  {
    id: 'forest',
    name: 'Forest',
    desc: 'Dense woodland. Lumber yards cut more; track costs extra clearing.',
    production: { lumber: 1.3 },
    trackCostMul: 1.2,
    waterUseMul: 1,
    speedMul: 1,
  },
  {
    id: 'desert',
    name: 'Desert',
    desc: 'Hot and dry. Quarries dig more, pumps find little water, steam engines drink more.',
    production: { quarry: 1.3, pump: 0.5, farm: 0.5 },
    trackCostMul: 1,
    waterUseMul: 1.5,
    speedMul: 1,
  },
  {
    id: 'taiga',
    name: 'Taiga',
    desc: 'Cold conifer country. Lumber and pumps do well, farms poorly; trains run a little slower.',
    production: { lumber: 1.15, pump: 1.1, farm: 0.7 },
    trackCostMul: 1.1,
    waterUseMul: 1,
    speedMul: 0.9,
  },
  {
    id: 'swamp',
    name: 'Swamp',
    desc: 'Wet lowland. Pumps overflow; track needs an embankment and trains crawl.',
    production: { pump: 1.4, farm: 0.8 },
    trackCostMul: 2,
    waterUseMul: 1,
    speedMul: 0.8,
  },
  {
    id: 'ocean',
    name: 'Ocean',
    desc: 'Open water with the odd island. Pumps do well on the shore.',
    production: { pump: 1.3 },
    trackCostMul: 1,
    waterUseMul: 1,
    speedMul: 1,
  },
];

describe('the biome table', () => {
  it('holds each biome at its enum id', () => {
    BIOME_NAMES.forEach((name, i) => expect(BIOME_DEFS[i]?.id, `biome ${i}`).toBe(name));
    const ids = BIOME_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every entry every field, and nothing else', () => {
    for (const d of BIOME_DEFS) {
      expect(Object.keys(d).sort(), d.id).toEqual([...FIELDS].sort());
      for (const k of ['id', 'name', 'desc'] as const) expect(d[k], `${d.id}.${k}`).not.toBe('');
      for (const k of ['trackCostMul', 'waterUseMul', 'speedMul'] as const)
        expect(d[k], `${d.id}.${k}`).toBeGreaterThan(0);
      for (const [k, v] of Object.entries(d.production))
        expect(v, `${d.id}.production.${k}`).toBeGreaterThan(0);
      expect(Number.isInteger(d.snowLevel), `${d.id}.snowLevel`).toBe(true);
    }
  });

  it('leaves the six older entries as they were, apart from the snow line', () => {
    BEFORE.forEach((before, i) => {
      const rest = Object.entries(BIOME_DEFS[i]).filter(([k]) => k !== 'snowLevel');
      expect(JSON.stringify(Object.fromEntries(rest)), before.id).toBe(JSON.stringify(before));
    });
  });

  it('starts snow a level lower in taiga and a level higher in desert', () => {
    const lines = Object.fromEntries(BIOME_DEFS.map((d) => [d.id, d.snowLevel]));
    expect(lines).toEqual({
      plains: 4,
      forest: 4,
      desert: 5,
      taiga: 3,
      swamp: 4,
      ocean: 4,
      lake: 4,
      river: 4,
      beach: 4,
      mountain: 4,
    });
  });

  it('appends Lake, River, Beach and Mountain with their approved effects', () => {
    const effects = BIOME_DEFS.slice(6).map((d) => ({
      id: d.id,
      production: Object.entries(d.production),
      trackCostMul: d.trackCostMul,
      waterUseMul: d.waterUseMul,
      speedMul: d.speedMul,
    }));
    expect(effects).toEqual([
      { id: 'lake', production: [['pump', 1.3]], trackCostMul: 1, waterUseMul: 1, speedMul: 1 },
      { id: 'river', production: [['pump', 1.2]], trackCostMul: 1, waterUseMul: 1, speedMul: 1 },
      {
        id: 'beach',
        production: [
          ['quarry', 0.8],
          ['pump', 0.6],
        ],
        trackCostMul: 1,
        waterUseMul: 1,
        speedMul: 1,
      },
      {
        id: 'mountain',
        production: [
          ['quarry', 1.3],
          ['pump', 0.6],
        ],
        trackCostMul: 1.5,
        waterUseMul: 1,
        speedMul: 0.9,
      },
    ]);
    expect(BIOME_DEFS.slice(6).map((d) => d.name)).toEqual(['Lake', 'River', 'Beach', 'Mountain']);
  });
});

describe('the Mountain biome on grass', () => {
  it('charges the grass price × 1.5 for track', () => {
    const map = emptyMap(4242, 48, 48, Terrain.Grass),
      track = new TrackGraph(48, 48),
      stock = new Stockpile();
    const regions = new RegionState(map);
    for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
    const builder = new Builder(map, regions, track, new Economy(), stock);
    for (const k of ['wood', 'stone', 'iron']) stock.amounts.set(k, 1000);
    map.biome[24 * map.w + 20] = MOUNTAIN;
    const item: TrackItem = { kind: 'straight', cls: 'branch' };
    const grass = builder.terrainMul(20, 20);
    expect(builder.terrainMul(20, 24)).toBe(grass * 1.5);
    const list = pieceCost(item.kind, item.cls);
    expect(builder.checkTrack(20, 20, item, 1).cost).toEqual(
      scaleCost(list, grass * rules.buildCostMul),
    );
    const there = builder.checkTrack(20, 24, item, 1);
    expect(there.ok).toBe(true);
    expect(there.cost).toEqual(scaleCost(list, grass * 1.5 * rules.buildCostMul));
  });

  it('runs a train whose head stands there at ×0.9', () => {
    /** The speed a diesel would run at, its head on a tile of the given biome. */
    function freeSpeed(biome: number) {
      const map = emptyMap(4242, 96, 96, Terrain.Grass),
        track = new TrackGraph(96, 96),
        stock = new Stockpile(),
        economy = new Economy();
      const builder = new Builder(map, new RegionState(map), track, economy, stock);
      builder.free = true;
      const fleet = new Fleet(track, builder, map, new Inventory(), economy, stock);
      for (let x = 2; x < 90; x++) track.place(x, 30, 'straight', 1);
      const t = new Train([
        { uid: 1, level: 0, def: content.locomotives.find((d) => d.id === 'f7')! },
      ]);
      t.spawnAt(track, 40, 30, Dir.W);
      const st = new Station('quarry', 15, 29);
      builder.stations.push(st);
      t.route = [st.id];
      t.oil = t.oilCap;
      fleet.trains.push(t);
      expect(t.dispatch(track, builder, map)).toBe(true);
      const ctx = (fleet as unknown as { ctx(n: number, s: number): TickCtx }).ctx(0, 1);
      t.onPathReady(ctx);
      const head = t.headTile!;
      map.biome[head.y * map.w + head.x] = biome;
      t.tick(0.05, ctx);
      return t.freeSpeed;
    }
    const plains = freeSpeed(0);
    expect(plains).toBeGreaterThan(0);
    expect(freeSpeed(MOUNTAIN)).toBeCloseTo(plains * 0.9, 9);
  });
});

/** A piece of track on ground of one terrain; `buildCost` is `rules.buildCostMul` in hundredths. */
interface PriceCase {
  terrain: Terrain;
  item: TrackItem;
  rot: number;
  buildCost: number;
}
/** The land terrains track may be laid on; water takes a bridge. */
const LAND = [Terrain.Grass, Terrain.Sand, Terrain.Forest, Terrain.Hill];

/** Any palette piece on land, or a bridge on water, at any rotation and build cost slider step. */
function priceCase(rng: Rng): PriceCase {
  const bridge = rng.chance(0.15);
  const item: TrackItem = bridge ? { kind: 'bridge', cls: 'branch' } : { ...rng.pick(TRACK_ITEMS) };
  return {
    terrain: bridge ? Terrain.Water : rng.pick(LAND),
    item,
    rot: rng.int(0, rotationCount(item.kind) - 1),
    // the slider runs 0 to 5 in steps of 0.05
    buildCost: rng.int(0, 100) * 5,
  };
}
/** Simpler cases first: build cost ×1, rotation 0, grass, a regular straight. */
function* shrinkPrice(c: PriceCase): Iterable<PriceCase> {
  if (c.buildCost !== 100) yield { ...c, buildCost: 100 };
  if (c.rot !== 0) yield { ...c, rot: 0 };
  if (c.terrain !== Terrain.Grass && c.terrain !== Terrain.Water)
    yield { ...c, terrain: Terrain.Grass };
  if (c.item.kind !== 'bridge' && (c.item.kind !== 'straight' || c.item.cls !== 'branch'))
    yield { ...c, item: { kind: 'straight', cls: 'branch' }, rot: 0 };
}

/** A multiplier in whole hundredths; any finer value would make the exact oracle below inexact. */
function hundredths(v: number, what: string): number {
  const h = Math.round(v * 100);
  if (Math.abs(h - v * 100) > 1e-9) throw new Error(`${what} = ${v} is not whole hundredths`);
  return h;
}
/**
 * The oracle: each resource of the list price × terrain × biome × build cost, rounded up, in
 * integers (all three multipliers in hundredths). The quotient is exact when it is whole and at
 * least 1e-6 from a whole number otherwise, so float error cannot move `Math.ceil`.
 */
function exactPrice(list: Cost, terrain: number, biome: number, buildCost: number): Cost {
  const out: Cost = {};
  for (const [k, v] of Object.entries(list))
    out[k] = Math.ceil((v * terrain * biome * buildCost) / 1e6);
  return out;
}

describe('every biome in the table', () => {
  it("prices track at the list price × terrain × the biome's trackCostMul, rounded up", () => {
    const terrainCost = trackData.terrainCost as Record<string, number>;
    forAll(
      priceCase,
      (c) => {
        Object.assign(rules, DEFAULT_RULES, { buildCostMul: c.buildCost / 100 });
        const map = emptyMap(4242, 12, 12, c.terrain),
          stock = new Stockpile(),
          regions = new RegionState(map);
        for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
        const builder = new Builder(map, regions, new TrackGraph(12, 12), new Economy(), stock);
        const list = pieceCost(c.item.kind, c.item.cls, c.item.cls2);
        for (const k of Object.keys(list)) stock.amounts.set(k, 1e6);
        const name = TERRAIN_NAMES[c.terrain],
          ground = hundredths(terrainCost[name], `terrainCost.${name}`);
        BIOME_DEFS.forEach((d, b) => {
          // the whole map, so every tile of a wide piece's footprint lies in the biome
          map.biome.fill(b);
          const check = builder.checkTrack(5, 5, c.item, c.rot);
          expect(check.ok, `${d.id}: ${check.reason}`).toBe(true);
          const mul = hundredths(d.trackCostMul, `${d.id}.trackCostMul`);
          expect(check.cost, `${d.id} (biome ${b})`).toEqual(
            exactPrice(list, ground, mul, c.buildCost),
          );
        });
      },
      {
        shrink: shrinkPrice,
        format: (c) => JSON.stringify({ ...c, terrain: TERRAIN_NAMES[c.terrain] }),
      },
    );
  });

  it("runs a train at its Plains speed × the biome's speedMul", () => {
    /** A lone diesel's speed after `seconds` running west along a straight in one biome. */
    function cruise(biome: number, seconds: number) {
      const map = emptyMap(4242, 96, 40, Terrain.Grass),
        track = new TrackGraph(96, 40),
        stock = new Stockpile(),
        economy = new Economy();
      map.biome.fill(biome);
      const builder = new Builder(map, new RegionState(map), track, economy, stock);
      builder.free = true;
      const fleet = new Fleet(track, builder, map, new Inventory(), economy, stock);
      for (let x = 2; x < 94; x++) track.place(x, 20, 'straight', 1);
      const t = new Train([
        { uid: 1, level: 0, def: content.locomotives.find((d) => d.id === 'f7')! },
      ]);
      t.spawnAt(track, 90, 20, Dir.W);
      const st = new Station('quarry', 4, 19);
      builder.stations.push(st);
      t.route = [st.id];
      t.oil = t.oilCap;
      fleet.trains.push(t);
      expect(t.dispatch(track, builder, map)).toBe(true);
      const ctx = (fleet as unknown as { ctx(n: number, s: number): TickCtx }).ctx(0, 1);
      t.onPathReady(ctx);
      for (let i = 0; i < seconds * 20; i++) t.tick(0.05, ctx);
      return { speed: t.speed, freeSpeed: t.freeSpeed, x: t.headTile!.x };
    }
    const plains = cruise(0, 8);
    // the biome shows in the speed only while the line speed leaves the train its own top speed
    expect(plains.speed).toBeGreaterThan(0);
    expect(plains.speed).toBeLessThan(lineSpeedCap('branch'));
    expect(plains.speed).toBe(plains.freeSpeed);
    BIOME_DEFS.forEach((d, b) => {
      const there = cruise(b, 8);
      expect(there.x, `${d.id}: still on the run`).toBeGreaterThan(20);
      expect(there.speed, `${d.id} (biome ${b})`).toBeCloseTo(plains.speed * d.speedMul, 9);
    });
  });

  it('names a producing station for each production multiplier', () => {
    const producers = new Set(
      content.stations.defs.filter((s) => s.produces.length > 0).map((s) => s.id),
    );
    for (const d of BIOME_DEFS)
      for (const k of Object.keys(d.production))
        expect(producers.has(k), `${d.id}.production.${k}`).toBe(true);
  });
});
