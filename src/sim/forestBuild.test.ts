import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { TERRAIN_NAMES, Terrain, type GameMap, type PropKind } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { content } from '../data/content';
import { Builder, DECOR_DEFS } from './build';
import { BUILDING_DEFS } from './buildings';
import { Economy } from './economy';
import { Stockpile } from './stockpile';
import {
  HARVEST_CEIL,
  HARVEST_FLOOR,
  HARVEST_RADIUS,
  STATION_DEFS,
  stationFootprint,
  terrainFactorAt,
} from './stations';
import { DEFAULT_RULES, rules } from './rules';
import { LAST_AGE } from './ages';
import { setSupplyMode } from './supply';
import { STR } from '../strings';

// the build rules play a sound when a piece goes down
vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode(undefined);
});

const SIZE = 32;
const X = 12;
const Y = 12;

/** A builder on level ground of `fill`, every chunk owned; in editor mode unless `game`. */
function world(fill: Terrain, game = false) {
  const map = emptyMap(7, SIZE, SIZE, fill);
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  const stock = new Stockpile();
  const economy = new Economy();
  const builder = new Builder(map, regions, new TrackGraph(SIZE, SIZE), economy, stock);
  builder.groundCheck = () => true;
  builder.free = !game;
  if (game) {
    economy.tier = LAST_AGE;
    for (const c of content.cargo) stock.add(c.id, 1e6);
  }
  return { map, builder };
}
const at = (map: GameMap, x: number, y: number) => map.terrain[y * map.w + x] as Terrain;

/** Everything a station, works or decor needs besides the ground, laid around (X, Y). */
function meetOtherRules(
  map: GameMap,
  builder: Builder,
  kind: 'station' | 'works' | 'decor',
  id: string,
) {
  if (kind === 'station') {
    const def = STATION_DEFS.find((d) => d.id === id)!;
    if (!def.depot) builder.track.place(X - 1, Y, 'straight', 1, 'regular');
    // water on the side away from the track, for a station that asks for it
    if (def.needsWater) map.terrain[Y * map.w + X + 1] = Terrain.Water;
  } else if (kind === 'works') {
    const def = BUILDING_DEFS.find((d) => d.id === id)!;
    if (def.deposit)
      map.props.set(Y * map.w + X, [{ kind: def.deposit as PropKind, variant: 0, ox: 0, oy: 0 }]);
    if (def.needsWater) map.terrain[Y * map.w + X + 1] = Terrain.Water;
  } else {
    const def = DECOR_DEFS.find((d) => d.id === id)!;
    // a signal stands on the rails, which may be laid on forest
    if (def.onTrack && !def.anyTile) builder.track.place(X, Y, 'straight', 1, 'regular');
  }
}

describe('building on forest', () => {
  it('takes every station, works and decor on a level forest tile meeting the other rules', () => {
    // the one exception: a works held to a terrain of its own (the colliery: hill)
    const ownTerrain = BUILDING_DEFS.filter((d) => d.terrain && d.terrain !== 'forest');
    expect(ownTerrain.map((d) => d.id)).toEqual(['colliery']);
    const cases = [
      ...STATION_DEFS.map((d) => ({ kind: 'station' as const, id: d.id })),
      ...BUILDING_DEFS.map((d) => ({ kind: 'works' as const, id: d.id })),
      ...DECOR_DEFS.map((d) => ({ kind: 'decor' as const, id: d.id })),
    ];
    for (const c of cases) {
      const { map, builder } = world(Terrain.Forest);
      meetOtherRules(map, builder, c.kind, c.id);
      const check =
        c.kind === 'station'
          ? builder.checkStation(X, Y, c.id)
          : c.kind === 'works'
            ? builder.checkBuilding(X, Y, c.id)
            : builder.checkDecor(X, Y, c.id);
      if (ownTerrain.some((d) => d.id === c.id))
        expect(check.reason, c.id).toBe(STR.build.needTerrain('hill'));
      else expect(check, `${c.kind} ${c.id}: ${check.reason}`).toMatchObject({ ok: true });
    }
    expect(cases.length).toBe(STATION_DEFS.length + BUILDING_DEFS.length + DECOR_DEFS.length);
  });

  it('leaves the tile forest under what stands on it', () => {
    const { map, builder } = world(Terrain.Forest);
    meetOtherRules(map, builder, 'station', 'farm');
    const farm = builder.placeStation(X, Y, 'farm');
    expect(builder.placeBuilding(X + 3, Y + 3, 'windmill')).not.toBeNull();
    expect(builder.placeDecor(X + 5, Y, 'townhouse', 0)).not.toBeNull();
    expect(farm).not.toBeNull();
    for (const t of [
      ...stationFootprint('farm', X, Y, 0),
      { x: X + 3, y: Y + 3 },
      { x: X + 5, y: Y },
    ])
      expect(at(map, t.x, t.y), `${t.x},${t.y}`).toBe(Terrain.Forest);
  });

  it("keeps a lumber yard's factor when a building stands on forest in its radius", () => {
    // a lumber yard on grass at the edge of a forest patch that reaches into its radius
    const { map, builder } = world(Terrain.Grass);
    for (let y = Y - HARVEST_RADIUS; y <= Y + HARVEST_RADIUS; y++)
      for (let x = X + 1; x <= X + HARVEST_RADIUS; x++) {
        map.terrain[y * map.w + x] = Terrain.Forest;
        map.props.set(y * map.w + x, [{ kind: 'tree', variant: 0, ox: 0, oy: 0 }]);
      }
    builder.track.place(X - 1, Y, 'straight', 1, 'regular');
    const yard = builder.placeStation(X, Y, 'lumber')!;
    expect(yard).not.toBeNull();
    const factor = yard.terrainFactor;
    expect(factor).toBe(terrainFactorAt(map, X, Y, 'lumber'));
    // within the bounds, so one forest tile more or less would show
    expect(factor).toBeGreaterThan(HARVEST_FLOOR);
    expect(factor).toBeLessThan(HARVEST_CEIL);

    // a farm, a works and a decor on forest tiles within its radius, the trees cleared under them
    // as the game clears them
    builder.track.place(X + 2, Y - 3, 'straight', 1, 'regular');
    const built = [
      builder.placeStation(X + 3, Y - 3, 'farm'),
      builder.placeBuilding(X + 2, Y + 2, 'windmill'),
      builder.placeDecor(X + 4, Y + 1, 'townhouse', 0),
    ];
    expect(built.every(Boolean)).toBe(true);
    for (const t of [
      { x: X + 3, y: Y - 3 },
      { x: X + 2, y: Y + 2 },
      { x: X + 4, y: Y + 1 },
    ]) {
      expect(Math.max(Math.abs(t.x - X), Math.abs(t.y - Y))).toBeLessThanOrEqual(HARVEST_RADIUS);
      expect(at(map, t.x, t.y)).toBe(Terrain.Forest);
      map.props.delete(t.y * map.w + t.x);
    }
    builder.refreshHarvest();
    expect(yard.terrainFactor).toBe(factor);
    expect(terrainFactorAt(map, X, Y, 'lumber')).toBe(factor);
  });

  it('prices as before: a station pays the clearing, a works and a decor pay what they do on grass', () => {
    const priced = (fill: Terrain) => {
      const out = new Map<string, Record<string, number>>();
      for (const def of STATION_DEFS.filter((d) => !d.supply)) {
        const { map, builder } = world(fill, true);
        meetOtherRules(map, builder, 'station', def.id);
        const c = builder.checkStation(X, Y, def.id);
        expect(c.ok, `${def.id}: ${c.reason}`).toBe(true);
        out.set(`station ${def.id}`, c.cost);
      }
      for (const def of BUILDING_DEFS.filter((d) => !d.terrain && !d.supply)) {
        const { map, builder } = world(fill, true);
        meetOtherRules(map, builder, 'works', def.id);
        const c = builder.checkBuilding(X, Y, def.id);
        expect(c.ok, `${def.id}: ${c.reason}`).toBe(true);
        out.set(`works ${def.id}`, c.cost);
      }
      for (const def of DECOR_DEFS) {
        const { map, builder } = world(fill, true);
        meetOtherRules(map, builder, 'decor', def.id);
        const c = builder.checkDecor(X, Y, def.id);
        expect(c.ok, `${def.id}: ${c.reason}`).toBe(true);
        out.set(`decor ${def.id}`, c.cost);
      }
      return out;
    };
    const grass = priced(Terrain.Grass);
    const forest = priced(Terrain.Forest);
    expect([...forest.keys()]).toEqual([...grass.keys()]);
    let stations = 0;
    for (const [what, cost] of forest) {
      const base = grass.get(what)!;
      // the clearing factor is paid by every station that costs anything, on every resource
      if (what.startsWith('station') && Object.values(base).some((v) => v > 0)) {
        for (const [k, v] of Object.entries(base))
          expect(cost[k], `${what} ${k}`).toBeGreaterThan(v);
        stations++;
      } else expect(cost, what).toEqual(base);
    }
    expect(stations).toBeGreaterThanOrEqual(6);
  });
});

describe('the placement hints', () => {
  it('name grass, forest, sand and a level hill for stations, buildings and works', () => {
    const hints = {
      station: STR.toolbar.place.station,
      town: STR.toolbar.place.town,
      building: STR.toolbar.place.building,
      works: STR.toolbar.place.works,
      plant: STR.toolbar.place.plant,
    };
    for (const [k, h] of Object.entries(hints)) {
      for (const ground of ['grass', 'forest', 'sand', 'level hill'])
        expect(h, `${k} names ${ground}`).toContain(ground);
      expect(h, k).not.toMatch(/buildable|grassland|stone field/i);
    }
  });

  it('hold for what they are shown for: level grass, forest, sand or hill, and not off level', () => {
    // the items each of those hints is shown for, picked as src/ui/toolbar.ts picks them: stations
    // but depots, works but platforms and deposit works, decor that is no pole, signal or service
    const items: { kind: 'station' | 'works' | 'decor'; id: string; only?: readonly string[] }[] = [
      ...STATION_DEFS.filter((d) => !d.depot).map((d) => ({
        kind: 'station' as const,
        id: d.id,
        only: d.standOn as readonly string[] | undefined,
      })),
      ...BUILDING_DEFS.filter((d) => !d.bridge && !d.deposit).map((d) => ({
        kind: 'works' as const,
        id: d.id,
        only: d.terrain ? [d.terrain] : undefined,
      })),
      ...DECOR_DEFS.filter((d) => !d.power && !d.onTrack && !d.radius).map((d) => ({
        kind: 'decor' as const,
        id: d.id,
        only: undefined,
      })),
    ];
    // the ones whose own ground narrows the hint, which their hints do not say: the pump (#320,
    // its tool hint is #336's) and the colliery, held to hills
    expect(items.filter((c) => c.only).map((c) => c.id)).toEqual(['pump', 'colliery']);
    expect(items.length).toBeGreaterThan(10);
    const grounds = [Terrain.Grass, Terrain.Forest, Terrain.Sand, Terrain.Hill];
    for (const ground of grounds)
      for (const c of items)
        for (const level of [true, false]) {
          const { map, builder } = world(ground);
          meetOtherRules(map, builder, c.kind, c.id);
          // off level: the tile itself slopes, everything around it is level
          if (!level) builder.groundCheck = (x, y, need) => need !== 'level' || x !== X || y !== Y;
          const check =
            c.kind === 'station'
              ? builder.checkStation(X, Y, c.id)
              : c.kind === 'works'
                ? builder.checkBuilding(X, Y, c.id)
                : builder.checkDecor(X, Y, c.id);
          const what = `${c.kind} ${c.id} on ${level ? 'level' : 'sloping'} ${TERRAIN_NAMES[ground]}`;
          if (!level) expect(check.reason, what).toBe(STR.build.notLevel);
          else
            expect(check.ok, `${what}: ${check.reason}`).toBe(
              !c.only || c.only.includes(TERRAIN_NAMES[ground]),
            );
        }
  });
});
