import { describe, it, expect, beforeEach } from 'vitest';
import { Editor } from '../editor/editor';
import { isLevel, levelFromMap, type LevelBuilding, type LevelData } from '../world/level';
import { buildingFromLevel, buildingToLevel } from './buildings';
import { rules, DEFAULT_RULES } from './rules';
import { simWorld } from '../testing/simWorld';

/** A value as it reads back from JSON. */
const asStored = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

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
    const before = levelFromMap(w.map, 'x');
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
      ...levelFromMap(w.map, 'old'),
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
