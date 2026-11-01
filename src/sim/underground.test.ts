import { describe, it, expect } from 'vitest';
import {
  Underground,
  groundLevelFromJSON,
  groundLevelToJSON,
  settleGroundLevel,
  shiftGroundLevel,
  shiftUnderground,
} from './underground';
import { NO_LEVEL, levelAt, tileLevels } from '../world/elevation';
import { Terrain } from '../world/tiles';

describe('Underground', () => {
  it('starts empty', () => {
    const u = new Underground(8, 8);
    expect(u.isDug(1, 1)).toBe(false);
    expect(u.isCut(1, 1)).toBe(false);
    expect(u.floorAt(1, 1)).toBeUndefined();
    expect(u.portals()).toEqual([]);
    expect(u.empty).toBe(true);
  });

  it('answers for the tiles it holds, and for none off the map', () => {
    const u = new Underground(8, 6);
    u.dig(2, 3, 0);
    u.cut(4, 5);
    expect(u.isDug(2, 3)).toBe(true);
    expect(u.floorAt(2, 3)).toBe(0);
    expect(u.isCut(4, 5)).toBe(true);
    expect(u.floorAt(4, 5)).toBeUndefined();
    expect(u.dig(8, 0, 0)).toBe(false);
    expect(u.cut(0, 6)).toBe(false);
    expect(u.isDug(-1, 0)).toBe(false);
    expect(u.isDug(8, 0)).toBe(false);
  });

  it('keeps a tile dug or cut, never both, and back-fills either', () => {
    const u = new Underground(8, 8);
    u.dig(1, 1, 0);
    u.cut(1, 1);
    expect([u.isDug(1, 1), u.isCut(1, 1)]).toEqual([false, true]);
    u.dig(1, 1, 0);
    expect([u.isDug(1, 1), u.isCut(1, 1)]).toEqual([true, false]);
    expect(u.fill(1, 1)).toBe(true);
    expect(u.fill(1, 1)).toBe(false);
    expect(u.empty).toBe(true);
  });

  it('refuses a portal off the map, with a bad face or floor, or a second on the same face', () => {
    const u = new Underground(8, 8);
    expect(u.addPortal({ x: 2, y: 2, face: 'N', floor: 0 })).toBe(true);
    expect(u.addPortal({ x: 2, y: 2, face: 'N', floor: 0 })).toBe(false);
    expect(u.addPortal({ x: 2, y: 2, face: 'S', floor: 0 })).toBe(true);
    expect(u.addPortal({ x: 9, y: 2, face: 'N', floor: 0 })).toBe(false);
    expect(u.addPortal({ x: 3, y: 2, face: 'Q' as 'N', floor: 0 })).toBe(false);
    expect(u.addPortal({ x: 3, y: 2, face: 'N', floor: 99 })).toBe(false);
    expect(u.portals()).toHaveLength(2);
    expect(u.removePortals(2, 2)).toBe(true);
    expect(u.portals()).toEqual([]);
  });

  it('round-trips dug tiles, cuts, portals and groundLevel', () => {
    const w = 10;
    const h = 7;
    const u = new Underground(w, h);
    u.dig(6, 5, 0);
    u.dig(2, 1, 0);
    u.dig(3, 1, 0);
    u.cut(8, 5);
    u.addPortal({ x: 3, y: 1, face: 'W', floor: 0 });
    u.addPortal({ x: 6, y: 5, face: 'E', floor: 0 });
    const plane = new Uint8Array(w * h).fill(NO_LEVEL);
    plane[3 * w + 2] = 5;
    plane[0] = 0;
    plane[h * w - 1] = 16;

    const text = JSON.stringify({
      underground: u.toJSON(),
      groundLevel: groundLevelToJSON(plane, w),
    });
    const back = JSON.parse(text) as { underground: unknown; groundLevel: unknown };
    const loaded = Underground.fromJSON(back.underground, w, h);
    expect(loaded.toJSON()).toEqual(u.toJSON());
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        expect(loaded.isDug(x, y), `dug ${x},${y}`).toBe(u.isDug(x, y));
        expect(loaded.isCut(x, y), `cut ${x},${y}`).toBe(u.isCut(x, y));
        expect(loaded.floorAt(x, y), `floor ${x},${y}`).toBe(u.floorAt(x, y));
      }
    expect(loaded.portals()).toEqual(u.portals());
    expect(groundLevelFromJSON(back.groundLevel, w, h)).toEqual(plane);
    // the same store writes the same text, whatever order its tiles were dug in
    expect(JSON.stringify(loaded.toJSON())).toBe(JSON.stringify(u.toJSON()));
  });

  it('junk in underground loads as empty', () => {
    for (const junk of [
      undefined,
      null,
      7,
      'dug',
      [],
      {},
      { dug: 5, cuts: 'x', portals: {} },
      { dug: [null, 3, 'a', [1], [1, 'b'], [NaN, 2], [1.5, 2], [-1, 0], [99, 0]] },
      {
        dug: [
          [1, 1, -2],
          [1, 1, 99],
          [1, 1, 'deep'],
        ],
      },
      { cuts: [null, [0.5, 1], [8, 8], ['a', 1]] },
      {
        portals: [
          null,
          5,
          {},
          { x: 1, y: 1 },
          { x: 1, y: 1, face: 'X', floor: 0 },
          { x: 99, y: 1, face: 'N', floor: 0 },
        ],
      },
    ]) {
      const u = Underground.fromJSON(junk, 8, 8);
      expect(u.empty, JSON.stringify(junk)).toBe(true);
      expect(u.toJSON()).toEqual({ dug: [], cuts: [], portals: [] });
    }
  });

  it('keeps the good entries among the junk, and a tile listed as dug and cut stays dug', () => {
    const u = Underground.fromJSON(
      {
        dug: [[1, 1, 0], 'x', [2, 2, 0]],
        cuts: [[2, 2], [3, 3], null],
        portals: [{ x: 1, y: 1, face: 'N', floor: 0 }, 4],
      },
      8,
      8,
    );
    expect(u.toJSON()).toEqual({
      dug: [
        [1, 1, 0],
        [2, 2, 0],
      ],
      cuts: [[3, 3]],
      portals: [{ x: 1, y: 1, face: 'N', floor: 0 }],
    });
  });
});

describe('the ground level plane in a save', () => {
  it('lists only the tiles with a level, and none for a map without the plane', () => {
    expect(groundLevelToJSON(undefined, 4)).toEqual([]);
    expect(groundLevelToJSON(new Uint8Array(12).fill(NO_LEVEL), 4)).toEqual([]);
    const plane = new Uint8Array(12).fill(NO_LEVEL);
    plane[5] = 0;
    expect(groundLevelToJSON(plane, 4)).toEqual([[1, 1, 0]]);
  });

  it('loads no plane from junk, and skips the entries that are not tiles with a level', () => {
    for (const junk of [
      undefined,
      null,
      3,
      {},
      'x',
      [],
      [null, [1], [1, 1], [1, 1, 17], [1, 1, -1]],
    ])
      expect(groundLevelFromJSON(junk, 4, 3), JSON.stringify(junk)).toBeUndefined();
    expect(groundLevelFromJSON([[4, 0, 2], [0, 3, 2], [1.5, 0, 2], [3, 2, 16], 'x'], 4, 3)).toEqual(
      new Uint8Array([...Array(11).fill(NO_LEVEL), 16]),
    );
  });
});

describe('a dug entry or a portal that does not hold together', () => {
  it('refuses a dug tile with no floor, or a floor off the range', () => {
    const u = Underground.fromJSON(
      {
        dug: [
          [2, 2],
          [3, 2, 17],
          [4, 2, -1],
          [5, 2, 0],
        ],
      },
      8,
      8,
    );
    expect(u.toJSON().dug).toEqual([[5, 2, 0]]);
    expect(new Underground(8, 8).dig(1, 1, undefined as unknown as number)).toBe(false);
  });

  it('drops a portal that is not on a dug tile, or not at its floor', () => {
    const u = Underground.fromJSON(
      {
        dug: [
          [2, 2, 0],
          [3, 2, 1],
        ],
        cuts: [[4, 2]],
        portals: [
          { x: 2, y: 2, face: 'N', floor: 0 },
          { x: 2, y: 2, face: 'S', floor: 1 },
          { x: 3, y: 2, face: 'E', floor: 0 },
          { x: 3, y: 2, face: 'W', floor: 1 },
          { x: 4, y: 2, face: 'W', floor: 0 },
          { x: 6, y: 6, face: 'W', floor: 0 },
        ],
      },
      8,
      8,
    );
    expect(u.portals()).toEqual([
      { x: 2, y: 2, face: 'N', floor: 0 },
      { x: 3, y: 2, face: 'W', floor: 1 },
    ]);
  });

  it('loads many portals without searching the list for each', () => {
    const n = 200;
    const portals = Array.from({ length: n * n }, (_, i) => ({
      x: i % n,
      y: Math.floor(i / n),
      face: 'N',
      floor: 0,
    }));
    const dug = portals.map((p) => [p.x, p.y, 0]);
    const t = performance.now();
    const u = Underground.fromJSON({ dug, portals }, n, n);
    expect(u.portals()).toHaveLength(n * n);
    expect(performance.now() - t).toBeLessThan(5000);
    expect(u.addPortal({ x: 0, y: 0, face: 'N', floor: 0 })).toBe(false);
    expect(u.addPortal({ x: 0, y: 0, face: 'E', floor: 0 })).toBe(true);
  });
});

describe('settling a loaded plane', () => {
  const w = 33;
  const h = 33;
  const flat = () => ({ w, h, terrain: new Uint8Array(w * h) });
  const block = () => {
    const plane = new Uint8Array(w * h).fill(NO_LEVEL);
    for (let y = 15; y <= 17; y++) for (let x = 15; x <= 17; x++) plane[y * w + x] = 16;
    return plane;
  };

  it('lowers a block of 16 on flat ground to the levels the map settles to', () => {
    const loaded = {
      ...flat(),
      groundLevel: groundLevelFromJSON(groundLevelToJSON(block(), w), w, h),
    };
    const centre = 16 * w + 16;
    // as loaded, the plane is trusted and reads far above what its neighbours allow
    expect(tileLevels(loaded)[centre]).toBe(2);
    expect(levelAt(loaded, 16, 16)).toBe(16);
    const settled = settleGroundLevel(loaded)!;
    expect(settled[centre]).toBe(2);
    expect(settled[15 * w + 15]).toBe(1);
    expect(settled[15 * w + 16]).toBe(1);
    expect(settled[0]).toBe(NO_LEVEL);
    const map = { ...flat(), groundLevel: settled };
    expect(levelAt(map, 16, 16)).toBe(2);
    expect(Array.from(tileLevels(map))).toEqual(Array.from(tileLevels(loaded)));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        expect(levelAt(map, x, y), `${x},${y}`).toBe(tileLevels(map)[y * w + x]);
  });

  it('comes back unchanged when the plane is settled already', () => {
    const once = settleGroundLevel({ ...flat(), groundLevel: block() })!;
    expect(settleGroundLevel({ ...flat(), groundLevel: once })).toEqual(once);
  });

  it('clears a level on a water tile, and leaves the rest as it was', () => {
    const terrain = new Uint8Array(w * h);
    terrain[16 * w + 16] = Terrain.Water;
    const plane = new Uint8Array(w * h).fill(NO_LEVEL);
    plane[16 * w + 16] = 5;
    plane[16 * w + 17] = 1;
    const settled = settleGroundLevel({ w, h, terrain, groundLevel: plane })!;
    expect(settled[16 * w + 16]).toBe(NO_LEVEL);
    expect(settled[16 * w + 17]).toBe(1);
  });

  it('gives none for a map without the plane, or when nothing is left of it', () => {
    expect(settleGroundLevel(flat())).toBeUndefined();
    const terrain = new Uint8Array(w * h).fill(Terrain.Water);
    const plane = new Uint8Array(w * h).fill(NO_LEVEL);
    plane[10] = 3;
    expect(settleGroundLevel({ w, h, terrain, groundLevel: plane })).toBeUndefined();
  });
});

describe('moving a saved underground and plane with the map', () => {
  it('shifts every tile by the same amount and keeps the sparse form', () => {
    const u = {
      dug: [[1, 2, 0]] as [number, number, number][],
      cuts: [[3, 4]] as [number, number][],
      portals: [{ x: 1, y: 2, face: 'E' as const, floor: 0 }],
    };
    expect(shiftUnderground(u, 32)).toEqual({
      dug: [[33, 34, 0]],
      cuts: [[35, 36]],
      portals: [{ x: 33, y: 34, face: 'E', floor: 0 }],
    });
    expect(shiftGroundLevel([[1, 2, 5]], 32)).toEqual([[33, 34, 5]]);
    expect(u.dug).toEqual([[1, 2, 0]]);
  });

  it('leaves what is not a list of tiles as it is', () => {
    expect(shiftUnderground({} as never, 32)).toEqual({});
    expect(shiftUnderground('x' as never, 32)).toBe('x');
    expect(shiftGroundLevel('x' as never, 32)).toBe('x');
    expect(shiftGroundLevel([5, null] as never, 32)).toEqual([5, null]);
  });
});
