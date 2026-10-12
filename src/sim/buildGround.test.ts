import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { TERRAIN_NAMES, Terrain, type GameMap, type PropKind } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Builder, DECOR_DEFS, unbuildable } from './build';
import { BUILDING_DEFS } from './buildings';
import { Economy } from './economy';
import { Stockpile } from './stockpile';
import { STATION_DEFS, stationFootprint, stationGates } from './stations';
import { depotSiteBlocked } from './startDepot';
import { DEFAULT_RULES, rules } from './rules';
import { STAND_ON } from '../data/content';
import { STR } from '../strings';

// the build rules play a sound when a piece goes down
vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => Object.assign(rules, DEFAULT_RULES));

const SIZE = 24;
/** where each object is tried: far enough in that every footprint, gate and neighbour fits */
const X = 10;
const Y = 10;
const ALL = TERRAIN_NAMES.map((_, i) => i as Terrain);
const name = (t: Terrain) => TERRAIN_NAMES[t];

/**
 * The terrain rule as it stood before one helper served every check, written out per kind: the
 * terrains each refused (all with one reason then). The checks are held to it, so a terrain
 * refused before is refused still and one accepted is accepted still.
 */
const REFUSED_BEFORE: Record<string, readonly Terrain[]> = {
  station: [Terrain.Water, Terrain.Rock, Terrain.Mountain],
  works: [Terrain.Water, Terrain.Rock, Terrain.Mountain],
  decor: [Terrain.Water, Terrain.Rock, Terrain.Mountain],
  platform: [Terrain.Rock, Terrain.Mountain],
  depot: [Terrain.Water, Terrain.Rock, Terrain.Mountain],
};

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
    new Stockpile(),
  );
  builder.free = true;
  builder.groundCheck = () => true;
  return { map, builder };
}
function paint(map: GameMap, tiles: readonly { x: number; y: number }[], t: Terrain) {
  for (const p of tiles) map.terrain[p.y * map.w + p.x] = t;
}

/**
 * What the check must answer for a kind on terrain `t` when nothing but the ground is in
 * question: the terrain's own refusal where the kind was refused before, else `otherwise`.
 */
function expected(kind: keyof typeof REFUSED_BEFORE, t: Terrain, otherwise: string | undefined) {
  return REFUSED_BEFORE[kind].includes(t) ? STR.build.nothingOn[name(t) as 'water'] : otherwise;
}

describe('unbuildable', () => {
  it('names the ground in each refusal, with the tile titles the tooltip uses', () => {
    const said = ALL.map(unbuildable).filter((r): r is string => r !== null);
    // one refusal for each terrain nothing stands on, each its own
    expect(new Set(said).size).toBe(said.length);
    for (const t of ALL) {
      const r = unbuildable(t);
      if (r === null) continue;
      expect(r.toLowerCase(), name(t)).toContain(STR.tile.terrain[name(t)].toLowerCase());
      expect(r, name(t)).not.toMatch(/stone field|grassland/i);
    }
    expect(Object.values(STR.build.nothingOn).sort()).toEqual([...said].sort());
  });

  it('refuses exactly the terrains every kind refused before', () => {
    for (const t of ALL)
      expect(unbuildable(t) !== null, name(t)).toBe(REFUSED_BEFORE.station.includes(t));
  });

  it('leaves open exactly the ground a station may be held to', () => {
    // `standOn` takes its terrains from STAND_ON, which is meant to be the ground something can be
    // built on: a terrain in it that the helper refuses would make a station held to it unplaceable,
    // and a terrain the helper opens that it lacks could never be listed
    const open = ALL.filter((t) => unbuildable(t) === null).map(name);
    expect([...STAND_ON].sort()).toEqual(open.sort());
  });
});

describe('the ground each kind stands on, against the rule before the helper', () => {
  it('stations: refused where they were, with the ground named, and accepted elsewhere', () => {
    // The pump alone has ground rules of its own (#320): beside water, it is refused where every
    // station was and, of the rest, takes only the ground it lists. pumpPlacement.test.ts has more.
    expect(STATION_DEFS.filter((d) => d.standOn || d.needsWater).map((d) => d.id)).toEqual([
      'pump',
    ]);
    let tried = 0;
    for (const def of STATION_DEFS.filter((d) => !d.depot))
      for (const t of ALL) {
        const { map, builder } = grassWorld();
        paint(map, stationFootprint(def.id, X, Y, 0), t);
        // the platform track on grass beside the station, and water on the far side
        builder.track.place(X - 1, Y, 'straight', 1, 'regular');
        if (def.needsWater) paint(map, [{ x: X + 1, y: Y }], Terrain.Water);
        const own =
          def.standOn && !(def.standOn as string[]).includes(name(t))
            ? STR.build.standOn[def.id]
            : undefined;
        const c = builder.checkStation(X, Y, def.id, 0);
        expect(c.reason, `${def.id} on ${name(t)}`).toBe(expected('station', t, own));
        expect(c.ok, `${def.id} on ${name(t)}`).toBe(c.reason === undefined);
        tried++;
      }
    expect(tried).toBeGreaterThanOrEqual(6 * ALL.length);
  });

  it('depot sheds, as a station: refused where they were, accepted elsewhere', () => {
    for (const def of STATION_DEFS.filter((d) => d.depot))
      for (const rot of [0, 1])
        for (const t of ALL) {
          const { map, builder } = grassWorld();
          paint(map, stationFootprint(def.id, X, Y, rot), t);
          const c = builder.checkStation(X, Y, def.id, rot);
          expect(c.reason, `${def.id} turned ${rot} on ${name(t)}`).toBe(
            expected('station', t, undefined),
          );
        }
  });

  it('works: refused where they were; a works with its own terrain keeps its own reason', () => {
    let tried = 0;
    for (const def of BUILDING_DEFS.filter((d) => !d.bridge))
      for (const t of ALL) {
        const { map, builder } = grassWorld();
        paint(map, [{ x: X, y: Y }], t);
        // the other rules met: its deposit on the tile, water on one side
        if (def.deposit)
          map.props.set(Y * map.w + X, [
            { kind: def.deposit as PropKind, variant: 0, ox: 0, oy: 0 },
          ]);
        if (def.needsWater) paint(map, [{ x: X + 1, y: Y }], Terrain.Water);
        const own =
          def.terrain && def.terrain !== name(t) ? STR.build.needTerrain(def.terrain) : undefined;
        const c = builder.checkBuilding(X, Y, def.id);
        expect(c.reason, `${def.id} on ${name(t)}`).toBe(expected('works', t, own));
        expect(c.ok, `${def.id} on ${name(t)}`).toBe(c.reason === undefined);
        tried++;
      }
    expect(tried).toBeGreaterThanOrEqual(5 * ALL.length);
  });

  it('bridge platforms: on water still, and refused only on rock and mountain', () => {
    const platforms = BUILDING_DEFS.filter((d) => d.bridge);
    expect(platforms.length).toBeGreaterThan(0);
    for (const def of platforms)
      for (const t of ALL) {
        const { map, builder } = grassWorld();
        paint(map, [{ x: X, y: Y }], t);
        const c = builder.checkBuilding(X, Y, def.id);
        expect(c.reason, `${def.id} on ${name(t)}`).toBe(expected('platform', t, undefined));
      }
  });

  it('decor: refused where it was off the track; a signal never asks the ground', () => {
    for (const def of DECOR_DEFS)
      for (const t of ALL) {
        const { map, builder } = grassWorld();
        paint(map, [{ x: X, y: Y }], t);
        const c = builder.checkDecor(X, Y, def.id);
        const want =
          def.onTrack && !def.anyTile ? STR.build.needTrackHere : expected('decor', t, undefined);
        expect(c.reason, `${def.id} on ${name(t)}`).toBe(want);
      }
  });

  it('the start depot: its shed and each gate refused where they were, accepted elsewhere', () => {
    let gates = 0;
    for (const def of STATION_DEFS.filter((d) => d.depot))
      for (const rot of [0, 1])
        for (const t of ALL) {
          const what = `${def.id} turned ${rot} on ${name(t)}`;
          const shed = grassWorld();
          paint(shed.map, stationFootprint(def.id, X, Y, rot), t);
          expect(depotSiteBlocked(shed.builder, def.id, X, Y, rot), `shed of ${what}`).toBe(
            expected('depot', t, undefined) ?? null,
          );
          for (const g of stationGates(def.id, X, Y, rot)) {
            const gate = grassWorld();
            paint(gate.map, [g], t);
            expect(depotSiteBlocked(gate.builder, def.id, X, Y, rot), `gate of ${what}`).toBe(
              expected('depot', t, undefined) ?? null,
            );
            gates++;
          }
        }
    expect(gates).toBeGreaterThan(0);
  });

  it('asks every tile of a footprint: one tile of a terrain decides as the whole would', () => {
    // a station wider than a tile is refused for any one tile of it where nothing can be built,
    // with that tile's ground named, and one tile of buildable ground changes nothing
    const wide = STATION_DEFS.filter((d) =>
      [0, 1].some((rot) => stationFootprint(d.id, X, Y, rot).length > 1),
    );
    expect(wide.length).toBeGreaterThan(0);
    let tried = 0;
    for (const def of wide)
      for (const rot of [0, 1, 2, 3]) {
        const foot = stationFootprint(def.id, X, Y, rot);
        for (const tile of foot)
          for (const t of ALL) {
            const what = `${def.id} turned ${rot}, ${name(t)} at ${tile.x},${tile.y}`;
            const station = grassWorld();
            paint(station.map, [tile], t);
            if (!def.depot) station.builder.track.place(X - 1, Y, 'straight', 1, 'regular');
            expect(station.builder.checkStation(X, Y, def.id, rot).reason, what).toBe(
              unbuildable(t) ?? undefined,
            );
            if (!def.depot) continue;
            const start = grassWorld();
            paint(start.map, [tile], t);
            expect(depotSiteBlocked(start.builder, def.id, X, Y, rot), `start ${what}`).toBe(
              unbuildable(t),
            );
            tried++;
          }
      }
    expect(tried).toBeGreaterThanOrEqual(4 * ALL.length);
  });

  it('gives one reason for a terrain, whatever is refused on it', () => {
    for (const t of ALL) {
      const { map, builder } = grassWorld();
      paint(map, [{ x: X, y: Y }], t);
      builder.track.place(X - 1, Y, 'straight', 1, 'regular');
      const reasons = new Set([
        builder.checkStation(X, Y, 'farm').reason,
        builder.checkBuilding(X, Y, 'windmill').reason,
        builder.checkDecor(X, Y, 'townhouse').reason,
      ]);
      expect([...reasons], name(t)).toEqual([unbuildable(t) ?? undefined]);
    }
  });
});
