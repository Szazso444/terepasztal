import { describe, it, expect, beforeEach } from 'vitest';
import { BUILDING_ROTATIONS, nextRotation, rotationAxis, wrapRotation } from './rotation';
import {
  STATION_DEFS,
  Station,
  resetStationIds,
  stationFootprint,
  stationGates,
  stationSpan,
  type StationDef,
  type StationJSON,
} from './stations';
import {
  BUILDING_DEFS,
  buildingFromJSON,
  buildingToJSON,
  worksMaxLevel,
  type Building,
  type BuildingJSON,
} from './buildings';
import { MIGRATIONS, SAVE_VERSION, migrate, readSaveText, type SaveGame } from './save';
import { decorDef } from './build';
import { rules, DEFAULT_RULES } from './rules';
import type { LevelStation } from '../world/level';
import { Terrain } from '../world/tiles';
import type { Rng } from '../engine/rng';
import { line, simWorld, station } from '../testing/simWorld';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';

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
  /** The last format without a rotation on works: the step from it gives them one. */
  const BEFORE = 15;
  /** A file of that format, as that build wrote it: works without a rotation. */
  function previous(buildings: unknown[] | undefined): SaveGame {
    const depot = { ...new Station('depot', 3, 3, 'Depot', 1).toJSON(), rot: 1 };
    const file: SaveGame = {
      version: BEFORE,
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
    const step = MIGRATIONS.find((m) => m.from === BEFORE)!;
    expect(step.note).toMatch(/rotation 0/);
    const j = migrate(
      previous([
        [7, 7, 'windmill', 0.5, 2, null],
        [9, 7, 'kiln', 0, 1, work],
      ]),
    );
    expect(j.version).toBe(SAVE_VERSION);
    expect(j.migrationNotes?.[0]).toBe(`v${BEFORE}→v${BEFORE + 1}: ${step.note}`);
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
    const step = MIGRATIONS.find((m) => m.from === BEFORE)!;
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

// Properties over seeded cases (docs/process/verification.md): any corner, any whole turn a caller
// or a file may give, any small world a station is tried in. A failure names its seed and the
// smallest case found.

/** A whole turn as one of the four, worked out here rather than by `wrapRotation`. */
const quarter = (rot: number) => ((rot % 4) + 4) % 4;
/** Tiles as `x,y` in reading order, so lists that hold the same tiles compare equal. */
const sorted = (tiles: { x: number; y: number }[]) =>
  [...tiles].sort((a, b) => a.y - b.y || a.x - b.x).map((t) => `${t.x},${t.y}`);

/**
 * The tiles a station stands on and is served from with its corner at (x, y) on `axis`, worked
 * out from what it is rather than from `stationSpan`: a long station lies two tiles along its
 * axis (x for axis 0, y for axis 1) and any other is `size` by `size`; a shed (a long station or a
 * two-tile depot) is served one step on from either end along its axis, where its tracks leave
 * it, and any other station from every tile beside it.
 */
function expectedTiles(def: StationDef, x: number, y: number, axis: number) {
  const [ax, ay] = axis === 0 ? [1, 0] : [0, 1];
  const n = def.size ?? 1;
  const cover: { x: number; y: number }[] = [];
  if (def.long) for (let i = 0; i < 2; i++) cover.push({ x: x + ax * i, y: y + ay * i });
  else
    for (let dy = 0; dy < n; dy++)
      for (let dx = 0; dx < n; dx++) cover.push({ x: x + dx, y: y + dy });
  const shed = def.long || (def.depot && n === 2);
  const steps = shed
    ? [
        [ax, ay],
        [-ax, -ay],
      ]
    : [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
  const inside = new Set(sorted(cover));
  const gates: { x: number; y: number }[] = [];
  for (const c of cover)
    for (const [dx, dy] of steps) {
      const g = { x: c.x + dx, y: c.y + dy };
      if (!inside.has(`${g.x},${g.y}`)) gates.push(g);
    }
  return { cover: sorted(cover), gates: [...new Set(sorted(gates))] };
}

/** A case with a corner and a whole turn: the turn toward r0 first, then the corner toward 0,0. */
function* shrinkCorner<T extends { x: number; y: number; rot: number }>(c: T): Iterable<T> {
  for (const rot of shrinkInt(c.rot)) yield { ...c, rot };
  for (const x of shrinkInt(c.x)) yield { ...c, x };
  for (const y of shrinkInt(c.y)) yield { ...c, y };
}

describe('for any corner and any whole turn', () => {
  beforeEach(() => resetStationIds(1));

  it('a station covers and is served from the tiles of its axis, the same at rot + 2', () => {
    forAll(
      (rng) => ({ x: rng.int(-40, 40), y: rng.int(-40, 40), rot: rng.int(-9, 12) }),
      ({ x, y, rot }) => {
        for (const def of STATION_DEFS) {
          const label = `${def.id} at ${x},${y} turned ${rot}`;
          const want = expectedTiles(def, x, y, quarter(rot) % 2);
          const cover = stationFootprint(def.id, x, y, rot);
          const gates = stationGates(def.id, x, y, rot);
          expect(sorted(cover), `${label}: footprint`).toEqual(want.cover);
          expect(sorted(gates), `${label}: gates`).toEqual(want.gates);
          // the same lists, in the same order, for every turn on the same axis
          for (const other of [rot + 2, rot - 2, rot + 4, quarter(rot) % 2]) {
            const at = `${label} against ${other}`;
            expect(stationSpan(def, other), at).toEqual(stationSpan(def, rot));
            expect(stationFootprint(def.id, x, y, other), at).toEqual(cover);
            expect(stationGates(def.id, x, y, other), at).toEqual(gates);
          }
        }
      },
      { shrink: shrinkCorner },
    );
  });

  it('a station comes back from the save and a level file turned and standing as it was', () => {
    forAll(
      (rng) => ({
        defId: rng.pick(STATION_DEFS).id,
        x: rng.int(0, 60),
        y: rng.int(0, 60),
        rot: rng.int(0, 3),
        level: rng.int(1, 6),
      }),
      ({ defId, x, y, rot, level }) => {
        const s = new Station(defId, x, y, 'Alder');
        s.rot = rot;
        s.level = level;
        const j = asStored(s.toJSON()) as StationJSON;
        const back = Station.fromJSON(j);
        expect(back.rot, 'save').toBe(rot);
        expect(asStored(back.toJSON()), 'save, written again').toEqual(j);
        expect(back.footprint(), 'save').toEqual(s.footprint());
        expect(back.gateTiles(), 'save').toEqual(s.gateTiles());
        const lv = Station.fromLevel(asStored(s.toLevel()) as LevelStation);
        expect(lv.rot, 'level file').toBe(rot);
        expect(lv.footprint(), 'level file').toEqual(s.footprint());
        expect(lv.gateTiles(), 'level file').toEqual(s.gateTiles());
      },
      { shrink: shrinkCorner },
    );
  });

  it('a station a file holds at any whole turn loads as one of the four, where the file has it', () => {
    // Game clears the ground under a saved station from the file's own turn
    // (`stationFootprint(s.defId, s.x, s.y, s.rot ?? 0)`) before the station loads, so the turn
    // the load keeps must stand on those same tiles and be served from the same gates.
    forAll(
      (rng) => ({
        defId: rng.pick(STATION_DEFS).id,
        x: rng.int(0, 60),
        y: rng.int(0, 60),
        rot: rng.int(-9, 12),
      }),
      ({ defId, x, y, rot }) => {
        const j = { ...(asStored(new Station(defId, x, y, 'A').toJSON()) as StationJSON), rot };
        const s = Station.fromJSON(j);
        expect(s.rot, 'save').toBe(quarter(rot));
        expect(s.footprint(), 'save').toEqual(stationFootprint(defId, x, y, rot));
        expect(s.gateTiles(), 'save').toEqual(stationGates(defId, x, y, rot));
        const lv = Station.fromLevel({ defId, x, y, level: 1, name: 'A', rot });
        expect(lv.rot, 'level file').toBe(quarter(rot));
        expect(lv.footprint(), 'level file').toEqual(stationFootprint(defId, x, y, rot));
        expect(lv.gateTiles(), 'level file').toEqual(stationGates(defId, x, y, rot));
      },
      { shrink: shrinkCorner },
    );
  });

  it('a works comes back from the save at its turn, and a tuple from before turns at r0', () => {
    forAll(
      (rng) => {
        const def = rng.pick(BUILDING_DEFS);
        const b: Building = {
          id: def.id,
          x: rng.int(0, 60),
          y: rng.int(0, 60),
          acc: rng.pick([0, 0.5, rng.next()]),
          level: 1,
          rot: rng.int(0, 3),
          active: false,
          rate: 0,
        };
        b.level = rng.int(1, worksMaxLevel(b));
        if (b.level < worksMaxLevel(b) && rng.chance(0.4))
          b.work = { to: b.level + 1, left: rng.int(0, 60), total: 60 };
        return b;
      },
      (b) => {
        const j = asStored(buildingToJSON(b)) as BuildingJSON;
        expect(j[6], 'the turn is written').toBe(b.rot);
        const back = buildingFromJSON(j);
        expect(back).toEqual(b);
        expect(asStored(buildingToJSON(back)), 'written again').toEqual(j);
        // a tuple as a build before turns wrote it, with or without a level and a work, is at r0
        for (const len of [4, 5, 6]) {
          const old = buildingFromJSON(j.slice(0, len) as BuildingJSON);
          expect(old.rot, `a tuple of ${len}`).toBe(0);
          expect(buildingToJSON(old).slice(0, 4), `a tuple of ${len}`).toEqual(j.slice(0, 4));
          expect(buildingToJSON(old)[6], `a tuple of ${len}, written again`).toBe(0);
        }
        // and any whole turn a file holds loads as one of the four
        for (const rot of [-5, -1, 4, 7, 11]) {
          const t = [...j.slice(0, 6), rot] as unknown as BuildingJSON;
          expect(buildingFromJSON(t).rot, `turn ${rot}`).toBe(quarter(rot));
        }
      },
      {
        shrink: function* (b) {
          for (const rot of shrinkInt(b.rot ?? 0)) yield { ...b, rot };
          if (b.work) yield { ...b, work: undefined };
        },
      },
    );
  });
});

/** What stands in a small grass world before a station is tried in it. */
interface Layout {
  /** straight regular track along row y from x0 to x1; a tile that refuses it is left bare */
  lines: [y: number, x0: number, x1: number][];
  /** water, made before anything is built */
  water: [x: number, y: number][];
  /** stations placed first, where they can stand */
  stations: [defId: string, x: number, y: number, rot: number][];
  /** kilns placed next, where they can stand */
  works: [x: number, y: number][];
  /** the editor's free building, or play with its prices, ages and depot count */
  free: boolean;
}
/** Side of the small world, in tiles. */
const SIDE = 20;
/** A station and a works tried in a world at one turn, and in its twin at another. */
interface Trial {
  layout: Layout;
  defId: string;
  x: number;
  y: number;
  rot: number;
  /** the twin's station turn is `rot` and this many half turns */
  halfTurns: number;
  works: { defId: string; x: number; y: number; rot: number; other: number };
}

function genTrial(rng: Rng): Trial {
  const tile = () => rng.int(0, SIDE - 1);
  const lines = Array.from({ length: rng.int(0, 4) }, () => [tile(), tile(), tile()]);
  const def = rng.pick(STATION_DEFS);
  // mostly beside a line, where a station that needs track can stand (a two-tile shed clear of
  // it); else anywhere, the edges and past them too
  const [ly, x0, x1] = lines.length && rng.chance(0.75) ? rng.pick(lines) : [-9, -9, -9];
  const beside = ly !== -9;
  const offset = def.depot ? rng.pick([-2, 1]) : rng.pick([-1, 1]);
  return {
    layout: {
      lines: lines as Layout['lines'],
      water: Array.from({ length: rng.int(0, 6) }, () => [tile(), tile()]),
      stations: Array.from({ length: rng.int(0, 2) }, () => [
        rng.pick(STATION_DEFS).id,
        tile(),
        tile(),
        rng.int(0, 3),
      ]),
      works: Array.from({ length: rng.int(0, 2) }, () => [tile(), tile()]),
      free: rng.chance(0.5),
    },
    defId: def.id,
    x: beside ? rng.int(Math.min(x0, x1), Math.max(x0, x1)) : rng.int(-1, SIDE),
    y: beside ? ly + offset : rng.int(-1, SIDE),
    rot: rng.int(-5, 8),
    halfTurns: rng.pick([-2, -1, 1, 2]),
    works: {
      defId: rng.pick(BUILDING_DEFS).id,
      x: tile(),
      y: tile(),
      rot: rng.int(-5, 8),
      other: rng.int(-5, 8),
    },
  };
}
/** Fewer things in the world, then the station's turn toward r0 and its twin a half turn on. */
function* shrinkTrial(t: Trial): Iterable<Trial> {
  const l = t.layout;
  for (const lines of shrinkArray(l.lines)) yield { ...t, layout: { ...l, lines } };
  for (const water of shrinkArray(l.water)) yield { ...t, layout: { ...l, water } };
  for (const stations of shrinkArray(l.stations)) yield { ...t, layout: { ...l, stations } };
  for (const works of shrinkArray(l.works)) yield { ...t, layout: { ...l, works } };
  if (!l.free) yield { ...t, layout: { ...l, free: true } };
  for (const rot of shrinkInt(t.rot)) yield { ...t, rot };
  if (t.halfTurns !== 1) yield { ...t, halfTurns: 1 };
}
/** The world a layout describes, built the same way each time it is asked for. */
function worldOf(l: Layout) {
  const w = simWorld({ terrain: 'grass', size: SIDE });
  for (const [x, y] of l.water) w.map.terrain[y * SIDE + x] = Terrain.Water;
  w.builder.free = true;
  const straight = { kind: 'straight', cls: 'regular', cls2: 'regular' } as const;
  for (const [y, x0, x1] of l.lines)
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      w.builder.placeTrack(x, y, straight, 1);
  for (const [defId, x, y, rot] of l.stations) w.builder.placeStation(x, y, defId, rot);
  for (const [x, y] of l.works) w.builder.placeBuilding(x, y, 'kiln');
  w.builder.free = l.free;
  return w;
}
/** The id of the station on every tile of a world and the ring around it, 0 for none. */
function occupancy(w: ReturnType<typeof worldOf>): number[] {
  const out: number[] = [];
  for (let y = -2; y <= SIDE + 1; y++)
    for (let x = -2; x <= SIDE + 1; x++) out.push(w.builder.stationAt(x, y)?.id ?? 0);
  return out;
}

describe('in any small world', () => {
  it('a station a half turn on meets the same check, and stands, costs and is served the same', () => {
    forAll(
      genTrial,
      (t) => {
        const other = t.rot + 2 * t.halfTurns;
        const a = worldOf(t.layout);
        for (const def of STATION_DEFS)
          expect(a.builder.checkStation(t.x, t.y, def.id, other), `${def.id}: the check`).toEqual(
            a.builder.checkStation(t.x, t.y, def.id, t.rot),
          );
        const check = a.builder.checkStation(t.x, t.y, t.defId, t.rot);
        const sa = a.builder.placeStation(t.x, t.y, t.defId, t.rot);
        expect(!!sa, `placed as checked (${check.reason ?? 'ok'})`).toBe(check.ok);
        const b = worldOf(t.layout);
        const sb = b.builder.placeStation(t.x, t.y, t.defId, other);
        expect(!!sb, `placed at turn ${other} as at ${t.rot}`).toBe(!!sa);
        expect(b.economy.money, 'money left').toBe(a.economy.money);
        if (sa && sb) {
          expect(sa.rot, 'the turn kept').toBe(quarter(t.rot));
          expect(sb.rot, 'the twin keeps its own turn').toBe(quarter(other));
          expect(sb.footprint()).toEqual(sa.footprint());
          expect(sb.gateTiles()).toEqual(sa.gateTiles());
          expect(b.builder.platformTiles(sb), 'served from').toEqual(a.builder.platformTiles(sa));
          // the station holds the tiles the check looked at, and no others
          const held = new Set(sorted(stationFootprint(t.defId, t.x, t.y, t.rot)));
          for (let y = -2; y <= SIDE + 1; y++)
            for (let x = -2; x <= SIDE + 1; x++)
              expect(a.builder.stationAt(x, y) === sa, `${x},${y}`).toBe(held.has(`${x},${y}`));
          // and they were clear ground in the world it was placed in
          const clear = worldOf(t.layout);
          for (const { x, y } of sa.footprint()) {
            const at = `${x},${y} under the station`;
            expect(x >= 0 && y >= 0 && x < SIDE && y < SIDE, at).toBe(true);
            expect(clear.map.terrain[y * SIDE + x], at).not.toBe(Terrain.Water);
            expect(clear.track.has(x, y), `${at}: track`).toBe(false);
            expect(clear.builder.stationAt(x, y), `${at}: a station`).toBeUndefined();
            expect(clear.builder.buildingAt(x, y), `${at}: a works`).toBeUndefined();
          }
        }
        expect(occupancy(b), 'every tile held as in the twin').toEqual(occupancy(a));

        // a works stands on its one tile at any turn, and keeps the turn it was given
        const k = t.works;
        expect(a.builder.checkBuilding(k.x, k.y, k.defId, k.other), 'works check').toEqual(
          a.builder.checkBuilding(k.x, k.y, k.defId, k.rot),
        );
        const wa = a.builder.placeBuilding(k.x, k.y, k.defId, k.rot);
        const wb = b.builder.placeBuilding(k.x, k.y, k.defId, k.other);
        expect(!!wb, 'works placed at either turn').toBe(!!wa);
        expect(b.economy.money, 'money left after the works').toBe(a.economy.money);
        if (wa && wb) {
          expect(wa.rot, 'the works turn kept').toBe(quarter(k.rot));
          expect(wb.rot, 'the twin works keeps its own').toBe(quarter(k.other));
          expect(buildingFromJSON(buildingToJSON(wa)).rot, 'and saved').toBe(quarter(k.rot));
        }
      },
      { shrink: shrinkTrial },
    );
  });
});
