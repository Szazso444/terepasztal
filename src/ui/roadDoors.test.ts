import { describe, expect, it } from 'vitest';
import { content, type BuildingDef, type DecorDef } from '../data/content';
import { streetDoors, type Door, type PlaceAt } from '../sim/doors';
import { BUILDING_ROTATIONS } from '../sim/rotation';
import { Dir } from '../engine/iso';
import { doorReachTiles } from './roadDoors';

const door = (reach: { x: number; y: number }): Door => ({
  kind: 'street',
  tile: { x: reach.x, y: reach.y + 1 },
  side: Dir.N,
  reach,
});
const anywhere = () => true;

describe('doorReachTiles', () => {
  it('marks a reach tile shared by two doors once, in the doors order', () => {
    const tiles = doorReachTiles(
      [door({ x: 3, y: 3 }), door({ x: 5, y: 3 }), door({ x: 3, y: 3 })],
      anywhere,
    );
    expect(tiles).toEqual([
      { x: 3, y: 3 },
      { x: 5, y: 3 },
    ]);
  });

  it('drops a reach tile off the map', () => {
    const onMap = (x: number, y: number) => x >= 0 && y >= 0 && x < 8 && y < 8;
    const tiles = doorReachTiles(
      [door({ x: -1, y: 2 }), door({ x: 2, y: 8 }), door({ x: 0, y: 0 })],
      onMap,
    );
    expect(tiles).toEqual([{ x: 0, y: 0 }]);
  });

  it('marks nothing for no doors', () => {
    expect(doorReachTiles([], anywhere)).toEqual([]);
  });

  const house = content.decor.find((d) => d.id === 'townhouse') as DecorDef;
  const works = content.buildings.find((d) => d.id === 'windmill') as BuildingDef;
  for (const [name, def] of [
    ['a house', house],
    ['a works', works],
  ] as const)
    it(`gives ${name} one mark beside it at each of its four rotations`, () => {
      const at = { x: 10, y: 10 };
      const seen = new Set<string>();
      for (let rot = 0; rot < BUILDING_ROTATIONS; rot++) {
        const place: PlaceAt = { def, x: at.x, y: at.y, rot };
        const doors = streetDoors(place);
        expect(doors, `r${rot}`).toHaveLength(1);
        const tiles = doorReachTiles(doors, anywhere);
        expect(tiles, `r${rot}`).toHaveLength(1);
        // the tile outside the one-tile footprint, beside it
        const t = tiles[0];
        expect(Math.abs(t.x - at.x) + Math.abs(t.y - at.y), `r${rot}`).toBe(1);
        seen.add(`${t.x},${t.y}`);
      }
      expect(seen.size).toBe(BUILDING_ROTATIONS);
    });
});
