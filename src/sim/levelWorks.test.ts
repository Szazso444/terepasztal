import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Editor } from '../editor/editor';
import {
  EDITOR_DRAFT_KEY,
  isLevel,
  levelFromMap,
  listLevels,
  type LevelBuilding,
  type LevelData,
} from '../world/level';
import { Terrain } from '../world/tiles';
import { BUILDING_DEFS, buildingFromLevel, buildingToLevel, type Building } from './buildings';
import { BUILDING_ROTATIONS } from './rotation';
import { Station, type StationJSON } from './stations';
import { rules, DEFAULT_RULES } from './rules';
import { toolRotations } from '../ui/toolRotation';
import type { Rng } from '../engine/rng';
import { simWorld, type SimWorld } from '../testing/simWorld';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';

/** A value as it reads back from JSON. */
const asStored = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
/** Every rotation, r0 to r3. */
const ROTATIONS = Array.from({ length: BUILDING_ROTATIONS }, (_, r) => r);
/** Every works definition that turns: all but the bridge platforms, which are placed at r0. */
const WORKS = BUILDING_DEFS.filter((d) => !d.bridge);
const BRIDGES = BUILDING_DEFS.filter((d) => d.bridge);
/** Side of the square grass map the cases stand on. */
const SIZE = 32;

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
});

describe('a works in a level file', () => {
  it('comes back at its turn after the editor writes it and the game reads it', () => {
    const w = simWorld({ terrain: 'grass', size: 32 });
    w.builder.free = true;
    const placed = [
      w.builder.placeBuilding(4, 4, 'kiln', 3)!,
      w.builder.placeBuilding(8, 4, 'windmill', 1)!,
      w.builder.placeBuilding(12, 4, 'grinder')!,
    ];
    expect(placed.map((b) => b.rot)).toEqual([3, 1, 0]);

    // the editor takes no renderer for this: collect() reads the map and the builder only
    const before = levelFromMap(w.map, 'x', 'x');
    const editor = new Editor(w.map, w.builder, {} as never, before);
    // collect() sets trackFormat on a level and adds nothing else to what levelFromMap makes
    const keys = [...Object.keys(before), 'trackFormat'].sort();
    const file = asStored(editor.collect()) as LevelData;

    expect(isLevel(file)).toBe(true);
    expect(Object.keys(file).sort(), 'no new top-level key').toEqual(keys);
    const back = (file.buildings ?? []).map(buildingFromLevel);
    expect(back.length, 'as many works as were standing').toBe(placed.length);
    expect(back.map((b) => [b.id, b.x, b.y, b.rot])).toEqual(
      placed.map((b) => [b.id, b.x, b.y, b.rot]),
    );
  });

  it('is read from a level written before turns as unturned, with the other fields it always had', () => {
    const w = simWorld({ terrain: 'grass', size: 32 });
    const old = asStored({
      ...levelFromMap(w.map, 'old', 'old'),
      buildings: [
        [4, 4, 'kiln'],
        [8, 4, 'windmill'],
      ],
    }) as LevelData;

    expect(isLevel(old)).toBe(true);
    for (const [i, tuple] of (old.buildings ?? []).entries()) {
      expect(tuple.length, 'a tuple of three').toBe(3);
      const b = buildingFromLevel(tuple);
      expect(b, `works ${i}`).toEqual({
        id: tuple[2],
        x: tuple[0],
        y: tuple[1],
        acc: 0,
        active: false,
        rate: 0,
        rot: 0,
      });
      expect(b, `works ${i}`).not.toHaveProperty('level');
      expect(b, `works ${i}`).not.toHaveProperty('work');
    }
  });

  it('is written without a fourth element while it is unturned, as an older file held it', () => {
    const w = simWorld({ terrain: 'grass', size: 32 });
    w.builder.free = true;
    const flat: LevelBuilding = buildingToLevel(w.builder.placeBuilding(4, 4, 'kiln')!);
    const turned: LevelBuilding = buildingToLevel(w.builder.placeBuilding(8, 4, 'kiln', 2)!);
    expect(flat).toEqual([4, 4, 'kiln']);
    expect(turned).toEqual([8, 4, 'kiln', 2]);
  });
});

// Properties over seeded cases (docs/process/verification.md). A failure names its seed and the
// smallest case found; `{ seeds: [n] }` replays it alone.

/** A works as a case: what it is, where it stands and the turn it stands at. */
interface Stand {
  id: string;
  x: number;
  y: number;
  rot: number;
}

/**
 * Stands a works in the builder the way the editor has it: placed (free mode) where the rules
 * allow, and set in as `Game.placeLevelContent` sets one in where terrain, a deposit or water
 * beside it refuses it (a hydro plant on bare grass).
 */
function stand(w: SimWorld, s: Stand): Building {
  w.builder.free = true;
  const placed = w.builder.placeBuilding(s.x, s.y, s.id, s.rot);
  if (placed) return placed;
  const b: Building = { id: s.id, x: s.x, y: s.y, acc: 0, active: false, rate: 0, rot: s.rot };
  w.builder.buildings.set(s.y * w.map.w + s.x, b);
  return b;
}

/**
 * What the editor writes for the world as it stands, as a file holds it after JSON. `keys` are the
 * top-level keys the level had before, which collect() may set but not add to: `trackFormat`.
 */
function saved(w: SimWorld): { file: LevelData; keys: string[] } {
  const level = levelFromMap(w.map, 'case', 'case');
  const keys = [...Object.keys(level), 'trackFormat'].sort();
  const editor = new Editor(w.map, w.builder, {} as never, level);
  return { file: asStored(editor.collect()) as LevelData, keys };
}

/** The works a file holds, read the way `Game.placeLevelContent` reads them. */
const readWorks = (file: LevelData): Building[] => (file.buildings ?? []).map(buildingFromLevel);

/** Works as lines, `x,y id rN`, so two lists that hold the same works compare equal in any order. */
const lines = (bs: { x: number; y: number; id: string; rot?: number }[]): string[] =>
  bs.map((b) => `${b.x},${b.y} ${b.id} r${b.rot}`).sort();

/** `n` distinct tiles drawn from `rng` in rows `y0` to `y1` and columns 0 to `x1`. */
function tiles(rng: Rng, n: number, y0 = 0, y1 = SIZE - 1, x1 = SIZE - 1) {
  const seen = new Set<number>();
  const out: { x: number; y: number }[] = [];
  while (out.length < n) {
    const x = rng.int(0, x1);
    const y = rng.int(y0, y1);
    if (seen.has(y * SIZE + x)) continue;
    seen.add(y * SIZE + x);
    out.push({ x, y });
  }
  return out;
}

/** A case of works with the turns toward r0: works taken away, then each turn shrunk. */
function shrinkStands(stands: Stand[]): Iterable<Stand[]> {
  return shrinkArray(stands, function* (s) {
    for (const rot of shrinkInt(s.rot)) yield { ...s, rot };
  });
}

/** One works toward r0 and the corner: the turn first, then the tile. */
function* shrinkOne(s: Stand): Iterable<Stand> {
  for (const rot of shrinkInt(s.rot)) yield { ...s, rot };
  for (const x of shrinkInt(s.x)) yield { ...s, x };
  for (const y of shrinkInt(s.y)) yield { ...s, y };
}

describe('for any works, turn and position', () => {
  // slow because each seed stands every works at all four turns in a 32 x 32 world and takes the
  // lot through the editor and back: 2.1 s alone (7 to 9 s on the author's machine in #458), so a
  // limit of 120 s
  it('every works definition at every rotation comes back from the editor at the same tile and turn', () => {
    // each turning definition at each rotation in one level, each at a tile drawn from the seed
    expect(WORKS.length, 'works definitions to sweep').toBeGreaterThan(0);
    forAll(
      (rng) => {
        const combos = WORKS.flatMap((d) => ROTATIONS.map((rot) => ({ id: d.id, rot })));
        const at = tiles(rng, combos.length);
        return rng.shuffle(combos.map((c, i): Stand => ({ ...c, ...at[i] })));
      },
      (stands) => {
        const w = simWorld({ terrain: 'grass', size: SIZE });
        const standing = stands.map((s) => stand(w, s));
        expect(lines(standing), 'the builder holds what was asked').toEqual(lines(stands));
        expect(w.builder.buildings.size, 'works standing').toBe(stands.length);

        const { file, keys } = saved(w);
        expect(isLevel(file), 'isLevel').toBe(true);
        expect(Object.keys(file).sort(), 'no new top-level key').toEqual(keys);
        const back = readWorks(file);
        expect(back.length, 'as many works as were standing').toBe(standing.length);
        expect(lines(back), 'same id, tile and turn').toEqual(lines(standing));
        for (const b of back) {
          expect(Number.isInteger(b.rot), `${b.id} rot is whole`).toBe(true);
          expect(b.rot! >= 0 && b.rot! < BUILDING_ROTATIONS, `${b.id} rot is 0 to 3`).toBe(true);
        }
      },
      { shrink: shrinkStands },
    );
  }, 120_000);

  it('one works of any definition, bridge platforms included, comes back at its tile and turn', () => {
    forAll(
      (rng): Stand => ({
        id: rng.pick(BUILDING_DEFS).id,
        x: rng.int(0, SIZE - 1),
        y: rng.int(0, SIZE - 1),
        rot: rng.int(0, BUILDING_ROTATIONS - 1),
      }),
      (s) => {
        const w = simWorld({ terrain: 'grass', size: SIZE });
        const b = stand(w, s);
        expect(b.rot, 'the builder keeps the turn').toBe(s.rot);
        expect(lines(readWorks(saved(w).file))).toEqual(lines([s]));
      },
      { shrink: shrinkOne },
    );
  });

  it('a tuple written, read and written again is the tuple it was, turned or not', () => {
    forAll(
      (rng): Stand => ({
        id: rng.pick(BUILDING_DEFS).id,
        x: rng.int(0, SIZE - 1),
        y: rng.int(0, SIZE - 1),
        rot: rng.int(0, BUILDING_ROTATIONS - 1),
      }),
      (s) => {
        const once = asStored(
          buildingToLevel({ ...s, acc: 0, active: false, rate: 0 }),
        ) as LevelBuilding;
        const twice = asStored(buildingToLevel(buildingFromLevel(once)));
        expect(twice).toEqual(once);
        // a tuple holds the tile, the id and, where there is one, the turn: nothing else
        expect(once.length === 3 || once.length === 4, 'three or four elements').toBe(true);
        expect(once.slice(0, 3)).toEqual([s.x, s.y, s.id]);
        expect(once[3] ?? 0, 'the turn it carries').toBe(s.rot);
      },
      { shrink: shrinkOne },
    );
  });
});

describe('a bridge platform and an unturned works', () => {
  /** The turn the build tool places a building at when the player has turned the tool to `held`. */
  const toolTurn = (defId: string, held: number) =>
    toolRotations({ kind: 'building', defId }) > 1 ? held : 0;

  it('the build tool turns a works with R and never a bridge platform', () => {
    // the fact the next test rests on: BuildController places at `turns() ? this.rot : 0`
    for (const d of WORKS) expect(toolTurn(d.id, 3), d.id).toBe(3);
    expect(BRIDGES.length, 'bridge definitions').toBeGreaterThan(0);
    for (const d of BRIDGES) expect(toolTurn(d.id, 3), d.id).toBe(0);
  });

  // slow because each seed stands every works and bridge platform in a 32 x 32 world and takes the
  // lot through the editor: 0.56 s alone, so a limit of 30 s
  it('come back at r0, however the player had the tool turned', () => {
    forAll(
      (rng) => {
        const ids = [...BRIDGES, ...WORKS].map((d) => d.id);
        const at = tiles(rng, ids.length);
        return {
          held: rng.int(0, BUILDING_ROTATIONS - 1),
          stands: rng.shuffle(ids.map((id, i) => ({ id, ...at[i] }))),
        };
      },
      ({ held, stands }) => {
        const w = simWorld({ terrain: 'grass', size: SIZE });
        for (const s of stands) {
          const bridge = !!BUILDING_DEFS.find((d) => d.id === s.id)!.bridge;
          // a bridge platform stands on water, so the tile is water first; a works is unturned
          if (bridge) w.map.terrain[s.y * SIZE + s.x] = Terrain.Water;
          const b = stand(w, { ...s, rot: bridge ? toolTurn(s.id, held) : 0 });
          if (bridge) expect(w.builder.bridgeAt(s.x, s.y), `${s.id} placed on water`).toBe(b);
          expect(b.rot, `${s.id} stands at r0`).toBe(0);
        }
        const back = readWorks(saved(w).file);
        expect(back.length, 'as many works as were standing').toBe(stands.length);
        expect(lines(back)).toEqual(lines(stands.map((s) => ({ ...s, rot: 0 }))));
      },
      {
        shrink: function* (c) {
          for (const stands of shrinkArray(c.stands)) yield { ...c, stands };
        },
      },
    );
  }, 30_000);
});

describe('a level written before works had a turn', () => {
  /** A file as that build wrote it: every works `[x, y, id]`. */
  function before(rng: Rng): LevelData {
    const w = simWorld({ terrain: 'grass', size: SIZE });
    const at = tiles(rng, rng.int(0, 24));
    const buildings = at.map(({ x, y }) => [x, y, rng.pick(BUILDING_DEFS).id]);
    return asStored({ ...levelFromMap(w.map, 'old', 'old'), buildings }) as LevelData;
  }

  it('passes isLevel, and every works reads at r0 with the fields it always had', () => {
    forAll(before, (file) => {
      expect(isLevel(file), 'isLevel').toBe(true);
      for (const tuple of file.buildings ?? []) {
        expect(tuple.length, 'a tuple of three').toBe(3);
        const b = buildingFromLevel(tuple);
        expect(b).toEqual({
          id: tuple[2],
          x: tuple[0],
          y: tuple[1],
          acc: 0,
          active: false,
          rate: 0,
          rot: 0,
        });
        // toEqual passes over a field left undefined, so say that there are no others
        expect(Object.keys(b).sort(), tuple[2]).toEqual(
          ['acc', 'active', 'id', 'rate', 'rot', 'x', 'y'].sort(),
        );
      }
    });
  });

  it('is saved again from the editor as the same works, still unturned', () => {
    forAll(before, (file) => {
      // load it as placeLevelContent does, then save it from the editor
      const w = simWorld({ terrain: 'grass', size: SIZE });
      for (const tuple of file.buildings ?? []) {
        const b = buildingFromLevel(tuple);
        w.builder.buildings.set(b.y * w.map.w + b.x, b);
      }
      const again = saved(w).file;
      expect(isLevel(again), 'isLevel').toBe(true);
      expect(lines(readWorks(again))).toEqual(lines(readWorks(file)));
      for (const b of readWorks(again)) expect(b.rot, `${b.id} at ${b.x},${b.y}`).toBe(0);
    });
  });
});

describe('a turn in a level file', () => {
  /** The largest whole number the property draws, either side of 0. */
  const REACH = 1000;
  /** The turn a whole number is read as, worked out by flooring rather than by `wrapRotation`. */
  const quarter = (n: number) => n - BUILDING_ROTATIONS * Math.floor(n / BUILDING_ROTATIONS);
  /** What a damaged or hand-edited file may hold in the turn's place: no whole number among them. */
  const ODD: unknown[] = [
    1.5,
    -0.5,
    0.1,
    2.000001,
    '1',
    '',
    'r2',
    null,
    undefined,
    Number.NaN,
    Infinity,
    -Infinity,
    {},
    [],
    [2],
    true,
    false,
  ];

  /** A works with `turn` in the fourth place, as JSON would hand it to the reader or not. */
  const tupleWith = (s: Stand, turn: unknown, viaJson: boolean): LevelBuilding => {
    const t = [s.x, s.y, s.id, turn];
    return (viaJson ? asStored(t) : t) as LevelBuilding;
  };

  it('reads 5 as 1 and -1 as 3, and a fraction, a string, null, NaN or nothing as 0', () => {
    const examples: [unknown, number][] = [
      [5, 1],
      [-1, 3],
      [4, 0],
      [-4, 0],
      [7, 3],
      [-5, 3],
      [1.5, 0],
      ['2', 0],
      [null, 0],
      [Number.NaN, 0],
      [undefined, 0],
    ];
    const s: Stand = { id: 'kiln', x: 3, y: 4, rot: 0 };
    for (const [turn, want] of examples)
      for (const viaJson of [false, true])
        expect(
          buildingFromLevel(tupleWith(s, turn, viaJson)).rot,
          `${String(turn)}${viaJson ? ' after JSON' : ''}`,
        ).toBe(want);
    // no fourth element at all
    expect(buildingFromLevel([3, 4, 'kiln']).rot).toBe(0);
    expect(buildingFromLevel(asStored([3, 4, 'kiln']) as LevelBuilding).rot).toBe(0);
  });

  it('reads any whole number as one of the four, for any definition and tile', () => {
    forAll(
      (rng) => ({
        id: rng.pick(BUILDING_DEFS).id,
        x: rng.int(0, SIZE - 1),
        y: rng.int(0, SIZE - 1),
        rot: 0,
        turn: rng.int(-REACH, REACH),
      }),
      ({ turn, ...s }) => {
        for (const viaJson of [false, true]) {
          const b = buildingFromLevel(tupleWith(s, turn, viaJson));
          const label = `${turn}${viaJson ? ' after JSON' : ''}`;
          expect(b.rot, label).toBe(quarter(turn));
          expect([b.id, b.x, b.y, b.acc, b.active, b.rate], `${label}: the other fields`).toEqual([
            s.id,
            s.x,
            s.y,
            0,
            false,
            0,
          ]);
        }
      },
      {
        shrink: function* (c) {
          for (const turn of shrinkInt(c.turn)) yield { ...c, turn };
        },
      },
    );
  });

  it('reads anything that is not a whole number as r0, never NaN or missing', () => {
    forAll(
      (rng) => ({
        id: rng.pick(BUILDING_DEFS).id,
        x: rng.int(0, SIZE - 1),
        y: rng.int(0, SIZE - 1),
        which: rng.int(0, ODD.length - 1),
      }),
      ({ which, ...s }) => {
        const turn = ODD[which];
        for (const viaJson of [false, true]) {
          const b = buildingFromLevel(tupleWith({ ...s, rot: 0 }, turn, viaJson));
          const label = `${String(turn)}${viaJson ? ' after JSON' : ''}`;
          // Object.is: a plain 0, not -0
          expect(Object.is(b.rot, 0), `${label}: rot ${String(b.rot)}`).toBe(true);
        }
      },
      {
        shrink: function* (c) {
          for (const which of shrinkInt(c.which)) yield { ...c, which };
        },
      },
    );
    // the seeds draw from the list; every value in it is checked whether or not they did
    for (const turn of ODD)
      expect(
        Object.is(
          buildingFromLevel(tupleWith({ id: 'kiln', x: 3, y: 4, rot: 0 }, turn, false)).rot,
          0,
        ),
        String(turn),
      ).toBe(true);
  });

  it('a hand-edited turn in a file the editor wrote is read the same way', () => {
    forAll(
      (rng) => ({
        rot: rng.int(0, BUILDING_ROTATIONS - 1),
        edit: rng.int(-REACH, REACH),
      }),
      ({ rot, edit }) => {
        const w = simWorld({ terrain: 'grass', size: SIZE });
        stand(w, { id: 'kiln', x: 6, y: 6, rot });
        const { file } = saved(w);
        // the turn is the fourth element where there is one; a works unturned gets one written in
        file.buildings![0][3] = edit;
        const b = readWorks(asStored(file) as LevelData)[0];
        expect(b.rot).toBe(quarter(edit));
        expect([b.id, b.x, b.y]).toEqual(['kiln', 6, 6]);
      },
    );
  });
});

describe('stations and decor in a level', () => {
  // slow because each seed stands works, a station and decor in a 32 x 32 world and takes them
  // through the editor: 0.43 s alone, so a limit of 30 s
  it('keep their turn when the editor writes them beside turned works', () => {
    forAll(
      (rng) => {
        const works = tiles(rng, 4, 0, 19).map((at): Stand => ({
          ...at,
          id: rng.pick(WORKS).id,
          rot: rng.int(0, 3),
        }));
        const [d] = tiles(rng, 1, 22, 24, SIZE - 4);
        const [h] = tiles(rng, 1, 28, 30);
        // two columns or more apart: neither stands on the road the other's door gets (#408)
        const t = { x: (h.x + 2 + rng.int(0, SIZE - 5)) % SIZE, y: rng.int(28, 30) };
        return {
          works,
          depot: { ...d, rot: rng.int(0, 3) },
          house: { ...h, rot: rng.int(0, 3) },
          tower: { ...t, rot: rng.int(0, 3) },
        };
      },
      ({ works, depot, house, tower }) => {
        const w = simWorld({ terrain: 'grass', size: SIZE });
        w.builder.free = true;
        const placedWorks = works.map((s) => stand(w, s));
        const st = w.builder.placeStation(depot.x, depot.y, 'depot', depot.rot);
        const hd = w.builder.placeDecor(house.x, house.y, 'townhouse', house.rot);
        const td = w.builder.placeDecor(tower.x, tower.y, 'water_tower', tower.rot);
        if (!st || !hd || !td) throw new Error('the depot, townhouse or water tower was refused');

        const { file, keys } = saved(w);
        expect(Object.keys(file).sort(), 'no new top-level key').toEqual(keys);
        // the station keeps its turn where it has one, and reads back at it
        expect(file.stations.length).toBe(1);
        expect(file.stations[0]).toMatchObject({ defId: 'depot', x: depot.x, y: depot.y });
        expect(file.stations[0].rot ?? 0, 'station turn').toBe(depot.rot);
        expect(Station.fromLevel(file.stations[0]).rot, 'station turn read back').toBe(depot.rot);
        expect(Station.fromJSON(asStored(st.toJSON()) as StationJSON).rot, 'in the save').toBe(
          depot.rot,
        );
        // the decor is [x, y, id, turn], as it always was
        expect([hd.rot, td.rot], 'decor turn kept by the builder').toEqual([house.rot, tower.rot]);
        expect(file.decor).toEqual([
          [house.x, house.y, 'townhouse', house.rot],
          [tower.x, tower.y, 'water_tower', tower.rot],
        ]);
        // and the works beside them
        expect(lines(readWorks(file))).toEqual(lines(placedWorks));
      },
    );
  }, 30_000);
});

describe('a level saved from the editor', () => {
  /** A localStorage or sessionStorage held in memory. */
  const memory = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, String(v)),
      removeItem: (k: string) => void m.delete(k),
    };
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // slow because each seed saves a level three ways and loads it from the stored list: 0.38 s
  // alone, so a limit of 30 s
  it('keeps the turn through save, save as and the draft, and loads from the stored list', () => {
    forAll(
      (rng) => {
        const combos = rng.shuffle(
          WORKS.flatMap((d) => ROTATIONS.map((rot) => ({ id: d.id, rot }))),
        );
        const at = tiles(rng, 6);
        return combos.slice(0, 6).map((c, i): Stand => ({ ...c, ...at[i] }));
      },
      (stands) => {
        // an empty store for each case, as a new page load has
        vi.stubGlobal('localStorage', memory());
        vi.stubGlobal('sessionStorage', memory());
        const w = simWorld({ terrain: 'grass', size: SIZE });
        const standing = stands.map((s) => stand(w, s));
        const editor = new Editor(w.map, w.builder, {} as never, levelFromMap(w.map, 'x', 'orig'));

        expect(editor.save(), 'save').toBe(true);
        expect(editor.saveAs('copy'), 'save as').toBe(true);
        const stored = listLevels();
        expect(stored.map((l) => l.name).sort(), 'both levels are in the list').toEqual([
          'copy',
          'x',
        ]);
        for (const level of stored)
          expect(lines(readWorks(level)), `level ${level.name}`).toEqual(lines(standing));

        // the draft the editor keeps for a reload
        const draft = JSON.parse(sessionStorage.getItem(EDITOR_DRAFT_KEY)!) as LevelData;
        expect(isLevel(draft), 'draft is a level').toBe(true);
        expect(lines(readWorks(draft)), 'draft').toEqual(lines(standing));
      },
      { shrink: shrinkStands },
    );
  }, 30_000);
});
