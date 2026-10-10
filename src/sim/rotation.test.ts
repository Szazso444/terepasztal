import { describe, it, expect, beforeEach } from 'vitest';
import { BUILDING_ROTATIONS, nextRotation, rotationAxis, wrapRotation } from './rotation';
import {
  STATION_DEFS,
  Station,
  stationFootprint,
  stationGates,
  stationSpan,
  type StationJSON,
} from './stations';
import { buildingFromJSON, buildingToJSON, type BuildingJSON } from './buildings';
import { MIGRATIONS, SAVE_VERSION, migrate, readSaveText, type SaveGame } from './save';
import { decorDef } from './build';
import { rules, DEFAULT_RULES } from './rules';
import type { LevelStation } from '../world/level';
import { line, simWorld, station } from '../testing/simWorld';

/** A value as it reads back from JSON. */
const asStored = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
/** Every rotation, r0 to r3. */
const ROTATIONS = Array.from({ length: BUILDING_ROTATIONS }, (_, r) => r);
/** The rotation opposite `rot`: the same axis, the front the other way. */
const opposite = (rot: number) => (rot + 2) % BUILDING_ROTATIONS;

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
});

describe('building rotations', () => {
  it('are four, each step a quarter turn on, coming back to r0 after four', () => {
    expect(BUILDING_ROTATIONS).toBe(4);
    expect(ROTATIONS.map(nextRotation)).toEqual([1, 2, 3, 0]);
    for (const rot of ROTATIONS) {
      let r = rot;
      for (let i = 0; i < BUILDING_ROTATIONS; i++) r = nextRotation(r);
      expect(r, `four steps from r${rot}`).toBe(rot);
    }
  });

  it('have the axis rot mod 2, shared by each rotation and the one opposite it', () => {
    expect(ROTATIONS.map(rotationAxis)).toEqual([0, 1, 0, 1]);
    for (const rot of ROTATIONS) expect(rotationAxis(opposite(rot))).toBe(rotationAxis(rot));
  });

  it('wrap any whole number into r0 to r3, and anything else to r0', () => {
    for (let n = -9; n <= 9; n++) {
      const r = wrapRotation(n);
      expect(ROTATIONS, String(n)).toContain(r);
      expect(Math.abs((n - r) % BUILDING_ROTATIONS), String(n)).toBe(0);
    }
    for (const odd of [undefined, null, '3', 1.5, Number.NaN, Infinity, {}])
      expect(wrapRotation(odd), String(odd)).toBe(0);
  });
});

describe('a station turned', () => {
  it('spans, covers and is served from the same tiles at rot as at rot + 2, for every kind', () => {
    for (const def of STATION_DEFS)
      for (const rot of ROTATIONS) {
        const label = `${def.id} r${rot}`;
        const back = opposite(rot);
        expect(stationSpan(def, back), label).toEqual(stationSpan(def, rot));
        expect(stationFootprint(def.id, 10, 7, back), label).toEqual(
          stationFootprint(def.id, 10, 7, rot),
        );
        expect(stationGates(def.id, 10, 7, back), label).toEqual(stationGates(def.id, 10, 7, rot));
        const a = new Station(def.id, 10, 7);
        const b = new Station(def.id, 10, 7);
        a.rot = rot;
        b.rot = back;
        expect([b.w, b.h, b.cx, b.cy], label).toEqual([a.w, a.h, a.cx, a.cy]);
        expect(b.footprint(), label).toEqual(a.footprint());
        expect(b.gateTiles(), label).toEqual(a.gateTiles());
      }
  });

  it('is served along the other axis a quarter turn on, for a shed', () => {
    // so the comparison above is between turns that could differ
    for (const id of ['depot', 'narrow_depot'])
      expect(stationGates(id, 10, 7, 1), id).not.toEqual(stationGates(id, 10, 7, 0));
  });

  it('meets the same placement check at rot as at rot + 2, wherever it is tried', () => {
    const w = simWorld({ terrain: 'grass', size: 32 });
    line(w, 4, 10, 20);
    station(w, 'depot', 22, 3, 1);
    for (const free of [true, false]) {
      w.builder.free = free;
      for (const def of STATION_DEFS)
        for (let y = 1; y <= 13; y++)
          for (let x = 2; x <= 24; x += 2)
            for (const rot of [0, 1]) {
              const label = `${def.id} at ${x},${y} r${rot}${free ? ' (editor)' : ''}`;
              expect(w.builder.checkStation(x, y, def.id, opposite(rot)), label).toEqual(
                w.builder.checkStation(x, y, def.id, rot),
              );
            }
    }
  });

  it('keeps all four rotations when placed, standing on the tiles of its axis', () => {
    for (const rot of ROTATIONS) {
      const w = simWorld({ terrain: 'grass', size: 32 });
      const s = station(w, 'depot', 8, 8, rot);
      expect(s.rot).toBe(rot);
      expect(s.footprint()).toEqual(stationFootprint('depot', 8, 8, rotationAxis(rot)));
    }
  });

  it('comes back at rot 3 through the save and through a level file', () => {
    const w = simWorld({ terrain: 'grass', size: 32 });
    line(w, 2, 10, 12);
    for (const id of ['depot', 'farm']) {
      const s = station(w, id, id === 'depot' ? 4 : 6, id === 'depot' ? 4 : 9, 3);
      const j = s.toJSON();
      expect(j.rot, id).toBe(3);
      const back = Station.fromJSON(asStored(j) as StationJSON);
      expect(back.rot, id).toBe(3);
      expect(back.toJSON(), id).toEqual(j);
      expect(back.footprint(), id).toEqual(s.footprint());
      expect(back.gateTiles(), id).toEqual(s.gateTiles());
      const level = Station.fromLevel(asStored(s.toLevel()) as LevelStation);
      expect(level.rot, `${id} level`).toBe(3);
    }
  });
});

describe('a works turned', () => {
  it('keeps the rotation it was placed in, and comes back with it through the save', () => {
    for (const rot of ROTATIONS) {
      const w = simWorld({ terrain: 'grass', size: 32 });
      w.builder.free = true;
      const b = w.builder.placeBuilding(5, 5, 'kiln', rot);
      expect(b?.rot, `r${rot}`).toBe(rot);
      const j = buildingToJSON(b!);
      expect(j[6], `r${rot}`).toBe(rot);
      // a new works is at level 1, which a save writes out
      expect(buildingFromJSON(asStored(j) as BuildingJSON), `r${rot}`).toEqual({
        ...b,
        level: 1,
        active: false,
        rate: 0,
      });
    }
    const w = simWorld({ terrain: 'grass', size: 32 });
    w.builder.free = true;
    const b = w.builder.placeBuilding(5, 5, 'windmill', 2)!;
    b.level = 3;
    b.acc = 0.5;
    const back = buildingFromJSON(asStored(buildingToJSON(b)) as BuildingJSON);
    expect([back.rot, back.level, back.acc, back.id, back.x, back.y]).toEqual([
      2,
      3,
      0.5,
      'windmill',
      5,
      5,
    ]);
  });

  it('is checked the same way at every rotation', () => {
    const w = simWorld({ terrain: 'grass', size: 32 });
    line(w, 2, 6, 10);
    for (let x = 1; x <= 11; x++)
      for (const rot of ROTATIONS)
        expect(w.builder.checkBuilding(x, 6, 'kiln', rot), `${x} r${rot}`).toEqual(
          w.builder.checkBuilding(x, 6, 'kiln'),
        );
  });
});

describe('houses and services', () => {
  it('take four rotations, signals keep four and power poles one', () => {
    for (const id of ['townhouse', 'water_tower', 'fuel_stop', 'signal'])
      expect(decorDef(id).rotations, id).toBe(BUILDING_ROTATIONS);
    expect(decorDef('power_line').rotations).toBe(1);
  });

  it('keep the rotation they were placed in', () => {
    const w = simWorld({ terrain: 'grass', size: 32 });
    w.builder.free = true;
    for (const [i, id] of ['townhouse', 'water_tower', 'fuel_stop'].entries())
      expect(w.builder.placeDecor(4 + 3 * i, 4, id, 3)?.rot, id).toBe(3);
  });
});

describe('a save from before rotations', () => {
  /** A file of the format before this one, as that build wrote it: works without a rotation. */
  function previous(buildings: unknown[] | undefined): SaveGame {
    const depot = { ...new Station('depot', 3, 3, 'Depot', 1).toJSON(), rot: 1 };
    const file: SaveGame = {
      version: SAVE_VERSION - 1,
      savedAt: 1700000000000,
      seed: 99,
      clock: { time: 10, speedIndex: 1 },
      economy: { money: 500, tickets: 0, tier: 0, granted: [] },
      track: [],
      stations: [asStored(depot) as StationJSON],
      trains: [],
      contracts: { contracts: [] },
      inventory: { items: [] },
      gacha: {},
      camera: { x: 0, y: 0, zoomIndex: 2 },
      lastDay: 0,
    };
    if (buildings) file.buildings = buildings as BuildingJSON[];
    return file;
  }
  const work = { to: 2, left: 10, total: 60 };

  it('gives every works rotation 0, says so, and loads each one at r0', () => {
    const step = MIGRATIONS.find((m) => m.from === SAVE_VERSION - 1)!;
    expect(step.note).toMatch(/rotation 0/);
    const j = migrate(
      previous([
        [7, 7, 'windmill', 0.5, 2, null],
        [9, 7, 'kiln', 0, 1, work],
      ]),
    );
    expect(j.version).toBe(SAVE_VERSION);
    expect(j.migrationNotes).toEqual([`v${step.from}→v${SAVE_VERSION}: ${step.note}`]);
    expect(j.buildings).toEqual([
      [7, 7, 'windmill', 0.5, 2, null, 0],
      [9, 7, 'kiln', 0, 1, work, 0],
    ]);
    for (const b of j.buildings!) expect(buildingFromJSON(b).rot).toBe(0);
    // and the work under way survives the step
    expect(buildingFromJSON(j.buildings![1]).work).toEqual(work);
  });

  it('fills a level and a work left out before the rotation, and nothing else', () => {
    const odd = [null, 'kiln', [1, 2], {}];
    const j = migrate(
      previous([[1, 1, 'kiln', 0], [2, 1, 'kiln', 0, 3], [3, 1, 'kiln', 0, 2, work, 3], ...odd]),
    );
    expect(j.buildings).toEqual([
      [1, 1, 'kiln', 0, 1, null, 0],
      [2, 1, 'kiln', 0, 3, null, 0],
      // a rotation already there is kept
      [3, 1, 'kiln', 0, 2, work, 3],
      ...odd,
    ]);
    // the stations keep the turn they had
    expect(j.stations.map((s) => s.rot)).toEqual([1]);
    expect(migrate(previous(undefined)).buildings).toBeUndefined();
  });

  it('changes nothing when run again, and loads through the save reader', () => {
    const step = MIGRATIONS.find((m) => m.from === SAVE_VERSION - 1)!;
    const file = previous([
      [7, 7, 'windmill', 0.5, 2, null],
      [9, 7, 'kiln', 0],
    ]);
    step.run(file);
    const once = asStored(file);
    step.run(file);
    expect(asStored(file)).toEqual(once);

    const read = readSaveText(
      JSON.stringify(previous([[7, 7, 'windmill', 0.5, 2, null, undefined]])),
    );
    if (!('save' in read)) throw new Error(`refused as ${read.error}`);
    expect(read.save.buildings).toEqual([[7, 7, 'windmill', 0.5, 2, null, 0]]);
  });
});
