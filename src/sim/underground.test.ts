import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  Underground,
  groundLevelFromJSON,
  groundLevelToJSON,
  settleGroundLevel,
  shiftGroundLevel,
  shiftUnderground,
} from './underground';
import { Builder, type GroundChange } from './build';
import { BUILDING_DEFS } from './buildings';
import { Economy } from './economy';
import { DEFAULT_RULES, rules } from './rules';
import { Station } from './stations';
import { STR } from '../strings';
import { storeWith, storesWith } from '../testing/storeFixtures';
import { NO_LEVEL, levelAt, tileLevels } from '../world/elevation';
import { emptyMap } from '../world/mapgen';
import { RegionState } from '../world/regions';
import { Terrain, type PropKind } from '../world/tiles';
import { TrackGraph } from '../world/track';

// the build rules play a sound when something is dug
vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

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
    expect(u.fill(1, 1)).toEqual({ portals: [] });
    expect(u.fill(1, 1)).toBeNull();
    expect(u.empty).toBe(true);
  });

  it('gives the bed of a dug or cut tile, and none on open ground or off the map', () => {
    const u = new Underground(8, 8);
    u.dig(1, 1, 2);
    u.cut(2, 1);
    expect(u.bedAt(1, 1)).toBe(2);
    expect(u.bedAt(2, 1)).toBe(0);
    expect(u.bedAt(3, 1)).toBeUndefined();
    expect(u.bedAt(-1, 1)).toBeUndefined();
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

describe('the dig plan', () => {
  const SIZE = 24;
  const MID = 12;
  type Tile = { x: number; y: number };
  type Peak = [x: number, y: number, height: number];
  /** Square hills, a level a tile down each side, and level 0 between them. */
  const hills = (peaks: readonly Peak[]) => (x: number, y: number) =>
    Math.max(0, ...peaks.map(([px, py, h]) => h - Math.max(Math.abs(x - px), Math.abs(y - py))));
  /** Grass with `levels` in the player's plane, every chunk owned, $100,000 in hand. */
  function world(levels: (x: number, y: number) => number) {
    const map = emptyMap(7, SIZE, SIZE, Terrain.Grass),
      regions = new RegionState(map);
    for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
    const plane = new Uint8Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) plane[y * SIZE + x] = levels(x, y);
    map.groundLevel = plane;
    const economy = new Economy();
    economy.money = 100_000;
    const { stores, depot } = storeWith({}, { x: MID, y: MID });
    const builder = new Builder(map, regions, new TrackGraph(SIZE, SIZE), economy, stores);
    return { map, regions, economy, depot, builder, under: builder.underground };
  }
  type World = ReturnType<typeof world>;
  /** The same as a generated plane, which may step by up to 4; level 0 on the border. */
  function steep(levels: (x: number, y: number) => number) {
    const w = world((x, y) => (x && y && x < SIZE - 1 && y < SIZE - 1 ? levels(x, y) : 0));
    w.map.generatedLevel = w.map.groundLevel;
    w.map.groundLevel = undefined;
    return w;
  }
  const plan = (
    { map, under }: World,
    tiles: readonly Tile[],
    free: (x: number, y: number) => boolean = () => true,
    railOnly: (x: number, y: number) => boolean = () => true,
  ) => under.plan(map, tileLevels(map), tiles, free, railOnly);
  /** The tiles of row `y` from `from` to `to`, in that order. */
  function row(y: number, from: number, to: number): Tile[] {
    const out: Tile[] = [];
    for (let x = from; ; x += Math.sign(to - from)) {
      out.push({ x, y });
      if (x === to) return out;
    }
  }
  const column = (x: number, from: number, to: number) =>
    row(x, from, to).map((t) => ({ x: t.y, y: t.x }));
  const levelsOf = ({ map }: World, tiles: readonly Tile[]) =>
    tiles.map((t) => levelAt(map, t.x, t.y));
  const prop = (kind: PropKind) => ({ kind, ox: 0, oy: 0, variant: 0 });
  /** One hill of 6 on the middle of the map. */
  const PEAK: readonly Peak[] = [[MID, MID, 6]];
  /** Two hills of 5 with a saddle of 2 at x 11 on the middle row. */
  const SADDLE: readonly Peak[] = [
    [8, MID, 5],
    [14, MID, 5],
  ];
  /** Two hills of 6 with a saddle of 1 at x 11 on the middle row. */
  const LOW_SADDLE: readonly Peak[] = [
    [6, MID, 6],
    [16, MID, 6],
  ];
  /** Two cliffs of 4 with level 0 between them, from x 9 to 11. */
  const VALLEY = (x: number) => (x <= 8 || x >= 12 ? 4 : 0);

  beforeEach(() => {
    Object.assign(rules, DEFAULT_RULES);
  });

  it('digs under ground at rail + 3 or higher', () => {
    const w = world(hills(PEAK));
    const tiles = row(MID, 10, 14);
    expect(levelsOf(w, tiles)).toEqual([4, 5, 6, 5, 4]);
    expect(plan(w, tiles)).toMatchObject({
      ok: true,
      dig: tiles,
      cut: [],
      raise: [],
      portals: [],
      cost: { money: 5 * rules.drillCost },
    });
  });

  it('raises a saddle between dug tiles to rail + 3, at the Raise price', () => {
    const w = world(hills(SADDLE));
    const tiles = row(MID, 9, 13);
    expect(levelsOf(w, tiles)).toEqual([4, 3, 2, 3, 4]);
    const p = plan(w, tiles);
    expect(p.raise).toEqual([{ x: 11, y: MID, to: 3 }]);
    expect(p.dig).toEqual(tiles);
    expect(p.cut).toEqual([]);
    expect(p.cost).toEqual({ money: 5 * rules.drillCost + rules.groundCost });
    expect(p.portals).toEqual([]);
  });

  it('raises the slope round a saddle too, a price a level', () => {
    const w = world(hills(LOW_SADDLE));
    const tiles = row(MID, 8, 14);
    expect(levelsOf(w, tiles)).toEqual([4, 3, 2, 1, 2, 3, 4]);
    const p = plan(w, tiles);
    expect(p.dig).toEqual(tiles);
    expect(p.cut).toEqual([]);
    const levels = tileLevels(w.map);
    const steps = p.raise.reduce((n, m) => n + m.to - levels[m.y * SIZE + m.x], 0);
    expect(p.raise.find((m) => m.x === 11 && m.y === MID)?.to).toBe(3);
    expect(steps).toBeGreaterThan(4);
    expect(p.cost).toEqual({ money: 7 * rules.drillCost + steps * rules.groundCost });
  });

  it('raises level 0 between dug tiles: one drag is one tunnel', () => {
    const p = plan(steep(VALLEY), row(MID, 8, 12));
    expect(p.dig).toEqual(row(MID, 8, 12));
    expect(p.cut).toEqual([]);
    expect(p.portals).toEqual([]);
    expect(p.raise.filter((m) => m.y === MID && m.to === 3).map((m) => m.x)).toEqual([9, 10, 11]);
  });

  it('holds a tile the raise would free to rise, and prices it at nothing', () => {
    const w = world(hills([[MID, MID, 3]]));
    const centre = MID * SIZE + MID;
    // a mountain no plane sets, held at 3 by the sides that are about to come up
    w.map.terrain[centre] = Terrain.Mountain;
    w.map.groundLevel![centre] = NO_LEVEL;
    expect(levelAt(w.map, MID, MID)).toBe(3);
    const sides = [
      { x: MID - 1, y: MID },
      { x: MID, y: MID - 1 },
      { x: MID + 1, y: MID },
      { x: MID, y: MID + 1 },
    ];
    const p = plan(w, sides);
    expect(p.raise).toContainEqual({ x: MID, y: MID, to: 3 });
    const levels = tileLevels(w.map);
    const steps = p.raise.reduce((n, m) => n + m.to - levels[m.y * SIZE + m.x], 0);
    expect(steps).toBeLessThan(p.raise.length);
    expect(p.cost).toEqual({ money: 4 * rules.drillCost + steps * rules.groundCost });
    expect(w.builder.dig(sides)).toBe(true);
    expect(w.map.groundLevel![centre]).toBe(3);
    expect(tileLevels(w.map)[centre]).toBe(3);
    expect(w.map.terrain[centre]).toBe(Terrain.Mountain);
  });

  it('turns a tile on the way down to open ground into a cut', () => {
    const w = world(hills(PEAK));
    const tiles = row(MID, 12, 18);
    expect(levelsOf(w, tiles)).toEqual([6, 5, 4, 3, 2, 1, 0]);
    const p = plan(w, tiles);
    expect(p.dig).toEqual(row(MID, 12, 15));
    expect(p.cut).toEqual(row(MID, 16, 17));
    expect(p.raise).toEqual([]);
  });

  it('raises a tile on the way down when the drag stops before open ground', () => {
    const w = world(hills(PEAK));
    const tiles = row(MID, 12, 16);
    expect(levelsOf(w, row(MID, 12, 17))).toEqual([6, 5, 4, 3, 2, 1]);
    const p = plan(w, tiles);
    expect(p.cut).toEqual([]);
    expect(p.dig).toEqual(tiles);
    expect(p.portals).toEqual([]);
    expect(p.raise.find((m) => m.x === 16 && m.y === MID)?.to).toBe(3);
  });

  it('reads the tile past the end of a drag: level 0 there makes the slope a cut', () => {
    const w = world(hills(PEAK));
    const p = plan(w, row(MID, 12, 17));
    expect(levelAt(w.map, 18, MID)).toBe(0);
    expect(p.dig).toEqual(row(MID, 12, 15));
    expect(p.cut).toEqual(row(MID, 16, 17));
    expect(p.raise).toEqual([]);
    expect(p.portals).toEqual([{ x: 15, y: MID, face: 'E', floor: 0 }]);
  });

  it('starts from rail at the foot of a slope, on the rail or on the bank', () => {
    const w = world(hills([[10, MID, 6]]));
    expect(levelsOf(w, row(MID, 4, 7))).toEqual([0, 1, 2, 3]);
    w.builder.track.place(4, MID, 'straight', 1);
    for (const from of [4, 5]) {
      expect(w.builder.checkDig(row(MID, from, 9)), `from x ${from}`).toMatchObject({
        ok: true,
        cut: row(MID, 5, 6),
        dig: row(MID, 7, 9),
        raise: [],
        portals: [{ x: 7, y: MID, face: 'W', floor: 0 }],
      });
    }
    expect(w.builder.dig(row(MID, 4, 9))).toBe(true);
    expect(w.builder.track.get(4, MID)).toBeTruthy();
    expect(levelAt(w.map, 4, MID)).toBe(0);
  });

  it('starts from rail at the foot of a cliff, on the rail or on the rock', () => {
    const w = steep((x) => (x <= 10 ? 4 : 0));
    w.builder.track.place(11, MID, 'straight', 1);
    for (const from of [11, 10]) {
      expect(w.builder.checkDig(row(MID, from, 8)), `from x ${from}`).toMatchObject({
        ok: true,
        cut: [],
        dig: row(MID, 10, 8),
        portals: [{ x: 10, y: MID, face: 'E', floor: 0 }],
      });
    }
  });

  it('starts from a line along a cliff foot, and leaves that line alone', () => {
    const w = steep((x) => (x <= 10 ? 4 : 0));
    for (let y = 8; y <= 16; y++) w.builder.track.place(11, y, 'straight', 0);
    expect(w.builder.checkDig(row(MID, 11, 8))).toMatchObject({
      ok: true,
      dig: row(MID, 10, 8),
      portals: [{ x: 10, y: MID, face: 'E', floor: 0 }],
    });
    // along the rail itself there is nothing to write, and nothing to refuse
    expect(w.builder.checkDig(column(11, 9, 15))).toMatchObject({ ok: true, dig: [], cut: [] });
  });

  it('still refuses rail the line would run through', () => {
    const w = steep(VALLEY);
    w.builder.track.place(10, MID, 'straight', 0);
    const c = w.builder.checkDig(row(MID, 8, 12));
    expect(c).toMatchObject({ ok: false, reason: STR.build.occupied, dig: [], raise: [] });
    expect(c.refused).toEqual([{ x: 10, y: MID }]);
    // a tile the line cuts is written too, even at the end of the drag
    const slope = world(hills([[10, MID, 6]]));
    slope.builder.track.place(5, MID, 'straight', 1);
    expect(slope.builder.checkDig(row(MID, 5, 9)).reason).toBe(STR.build.occupied);
  });

  describe('the open tile a new portal looks at', () => {
    /** The drag into the east cliff of the valley's west side, level 0 past it at x 9. */
    const DRAG = row(MID, 7, 8);
    const FRONT = { x: 9, y: MID };
    const onFront = (w: World, what: (b: Builder) => void) => {
      what(w.builder);
      return w;
    };
    const SITES: [string, (b: Builder) => void][] = [
      [
        'a building',
        (b) => {
          const def = BUILDING_DEFS.find((d) => !d.bridge)!;
          b.buildings.set(MID * SIZE + 9, {
            id: def.id,
            x: 9,
            y: MID,
            acc: 0,
            rot: 0,
            active: false,
            rate: 0,
          });
        },
      ],
      ['a road', (b) => b.roads.add(FRONT.x, FRONT.y)],
      ['a station', (b) => b.stations.push(new Station('quarry', FRONT.x, FRONT.y))],
      ['a depot', (b) => b.stations.push(new Station('depot', FRONT.x, FRONT.y))],
      ['a coal seam', (b) => b.map.props.set(MID * SIZE + 9, [prop('coal')])],
      ['an oil seep', (b) => b.map.props.set(MID * SIZE + 9, [prop('oil')])],
      ['a tower', (b) => b.decor.set(MID * SIZE + 9, { id: 'water_tower', x: 9, y: MID, rot: 0 })],
      [
        'rail with a road across it',
        (b) => {
          b.track.place(FRONT.x, FRONT.y, 'straight', 1);
          b.roads.add(FRONT.x, FRONT.y);
        },
      ],
    ];

    it('with nothing on it, takes the portal', () => {
      const w = steep(VALLEY);
      expect(w.builder.checkDig(DRAG)).toMatchObject({
        ok: true,
        dig: DRAG,
        portals: [{ x: 8, y: MID, face: 'E', floor: 0 }],
      });
    });

    it.each(SITES)('refuses the dig with %s on it', (_name, what) => {
      const w = onFront(steep(VALLEY), what);
      const money = w.economy.money;
      const c = w.builder.checkDig(DRAG);
      expect(c).toMatchObject({
        ok: false,
        reason: STR.build.occupied,
        refused: [FRONT],
        dig: [],
        cut: [],
        portals: [],
        raise: [],
        stone: 0,
      });
      expect(w.builder.dig(DRAG)).toBe(false);
      expect(w.under.empty).toBe(true);
      expect(w.economy.money).toBe(money);
    });

    it('takes rail, and a signal on it: a portal carries the line out', () => {
      const w = steep(VALLEY);
      w.builder.track.place(FRONT.x, FRONT.y, 'straight', 1);
      expect(w.builder.checkDig(DRAG)).toMatchObject({ ok: true, portals: [{ face: 'E' }] });
      w.builder.decor.set(MID * SIZE + 9, { id: 'signal', x: 9, y: MID, rot: 1 });
      expect(w.builder.dig(DRAG)).toBe(true);
      expect(w.under.portals()).toHaveLength(1);
    });

    it('asks it of the tile past a drag on a cut too, with a cut in front of the portal', () => {
      // on the slope of a hill the tile the portal looks at is a cut, and the plan asks the surface
      const w = world(hills(PEAK));
      expect(w.builder.checkDig(row(MID, 6, 9))).toMatchObject({
        ok: true,
        portals: [{ x: 9, y: MID, face: 'W' }],
        cut: row(MID, 7, 8),
      });
      w.builder.roads.add(8, MID);
      expect(w.builder.checkDig(row(MID, 6, 9))).toMatchObject({
        ok: false,
        reason: STR.build.occupied,
      });
    });

    it('leaves a portal that stands alone: only a new one asks', () => {
      const w = steep(VALLEY);
      expect(w.builder.dig(DRAG)).toBe(true);
      w.builder.roads.add(FRONT.x, FRONT.y);
      const c = w.builder.checkDig(row(MID, 6, 8));
      expect(c).toMatchObject({ ok: true, portals: [] });
    });

    it('asks the plan through its own question, not the surface one', () => {
      const w = steep(VALLEY);
      expect(
        plan(
          w,
          DRAG,
          () => true,
          (x) => x !== FRONT.x,
        ).ok,
      ).toBe(false);
      expect(
        plan(
          w,
          DRAG,
          (x) => x !== FRONT.x,
          () => true,
        ).ok,
      ).toBe(true);
    });
  });

  it('lets a last open tile touch water, and no tile it writes', () => {
    const wet = (x: number, y: number) => {
      const w = world(hills(PEAK));
      const k = y * SIZE + x;
      w.map.terrain[k] = Terrain.Water;
      w.map.groundLevel![k] = NO_LEVEL;
      return w;
    };
    expect(plan(wet(19, MID + 1), row(MID, 12, 18))).toMatchObject({
      ok: true,
      cut: row(MID, 16, 17),
      portals: [{ x: 15, y: MID, face: 'E', floor: 0 }],
    });
    expect(plan(wet(18, MID + 1), row(MID, 12, 18))).toMatchObject({
      ok: false,
      reason: STR.build.digBesideWater,
      refused: [{ x: 17, y: MID }],
    });
  });

  it('gives a dug line its portal from a drag that starts past its end', () => {
    const w = world(hills(PEAK));
    w.under.apply(plan(w, row(MID, 12, 15)));
    const p = plan(w, row(MID, 16, 18));
    expect(p.dig).toEqual([]);
    expect(p.cut).toEqual(row(MID, 16, 17));
    expect(p.portals).toEqual([{ x: 15, y: MID, face: 'E', floor: 0 }]);
  });

  it('counts a cut past the end of a drag as leading out', () => {
    const w = world(hills(PEAK));
    w.under.cut(17, MID);
    const p = plan(w, row(MID, 16, 12));
    expect(p).toMatchObject({ ok: true, raise: [], cut: [{ x: 16, y: MID }] });
    expect(p.dig).toEqual(row(MID, 15, 12));
    expect(p.portals).toEqual([{ x: 15, y: MID, face: 'E', floor: 0 }]);
  });

  it('counts a dug tile past the end of a drag as covered: a saddle up to it is raised', () => {
    const w = world(hills(SADDLE));
    w.under.apply(plan(w, row(MID, 8, 10)));
    const p = plan(w, row(MID, 11, 11));
    expect(p.dig).toEqual([{ x: 11, y: MID }]);
    expect(p.raise).toContainEqual({ x: 11, y: MID, to: 3 });
    const q = plan(w, row(MID, 11, 12));
    expect(q.dig).toEqual(row(MID, 11, 12));
    expect(q.portals).toEqual([]);
  });

  it('reads the four sides for one tile: exactly one that leads out takes the portal', () => {
    const w = world(hills(PEAK));
    expect(w.builder.dig(row(MID, 12, 18))).toBe(true);
    expect(w.builder.fillDug(15, MID)).toBe(true);
    expect(w.under.portals()).toEqual([]);
    expect(w.builder.dig([{ x: 15, y: MID }])).toBe(true);
    expect(w.under.portals()).toEqual([{ x: 15, y: MID, face: 'E', floor: 0 }]);

    const cliff = steep((x) => (x <= 10 ? 4 : 0));
    expect(plan(cliff, [{ x: 10, y: MID }]).portals).toEqual([
      { x: 10, y: MID, face: 'E', floor: 0 },
    ]);
    expect(plan(cliff, [{ x: 9, y: MID }]).portals).toEqual([]);
    const stack = steep((x, y) => (x === MID && y === MID ? 4 : 0));
    expect(plan(stack, [{ x: MID, y: MID }])).toMatchObject({
      dig: [{ x: MID, y: MID }],
      portals: [],
    });
  });

  it('cuts both ends of a line that runs right through', () => {
    const w = world(hills(PEAK));
    const p = plan(w, row(MID, 6, 18));
    expect(p.cut).toEqual([...row(MID, 7, 8), ...row(MID, 16, 17)]);
    expect(p.dig).toEqual(row(MID, 9, 15));
    expect(p.portals).toEqual([
      { x: 9, y: MID, face: 'W', floor: 0 },
      { x: 15, y: MID, face: 'E', floor: 0 },
    ]);
    expect(p.cost).toEqual({ money: 11 * rules.drillCost + 2 * rules.portalCost });
  });

  it('puts a portal on the first tile at rail + 3 going in from the open side', () => {
    const w = world(hills(PEAK));
    const p = plan(w, row(MID, 18, 12));
    expect(p.portals).toEqual([{ x: 15, y: MID, face: 'E', floor: 0 }]);
    expect(levelAt(w.map, 15, MID)).toBe(3);
    // a portal stands on a dug tile at its floor: on a cut the load would drop it
    w.under.apply(p);
    expect(w.under.isDug(15, MID)).toBe(true);
    const back = Underground.fromJSON(JSON.parse(JSON.stringify(w.under)), SIZE, SIZE);
    expect(back.portals()).toEqual(p.portals);
  });

  it('makes a portal for each of the four faces', () => {
    const cases = [
      [row(MID, 12, 18), { x: 15, y: MID }, 'E'],
      [row(MID, 12, 6), { x: 9, y: MID }, 'W'],
      [column(MID, 12, 18), { x: MID, y: 15 }, 'S'],
      [column(MID, 12, 6), { x: MID, y: 9 }, 'N'],
    ] as const;
    for (const [tiles, at, face] of cases) {
      const p = plan(world(hills(PEAK)), tiles);
      expect(p.portals, face).toEqual([{ ...at, face, floor: 0 }]);
      expect(p.dig, face).toContainEqual(at);
    }
  });

  it('a cliff makes a portal with no cut outside it', () => {
    const w = steep((x) => (x <= 10 ? 4 : 0));
    const tiles = row(MID, 8, 12);
    expect(levelsOf(w, tiles)).toEqual([4, 4, 4, 0, 0]);
    const p = plan(w, tiles);
    expect(p.dig).toEqual(row(MID, 8, 10));
    expect(p.cut).toEqual([]);
    expect(p.raise).toEqual([]);
    expect(p.portals).toEqual([{ x: 10, y: MID, face: 'E', floor: 0 }]);
  });

  it('gives a tile open on two sides a portal on each', () => {
    const w = steep((x, y) => (x === MID && y === MID ? 4 : 0));
    const p = plan(w, row(MID, 11, 13));
    expect(p.dig).toEqual([{ x: MID, y: MID }]);
    expect(p.portals.map((q) => q.face)).toEqual(['W', 'E']);
  });

  it('continues what stands: a dug tile is free, and its open side takes the portal', () => {
    const w = world(hills(PEAK));
    w.under.apply(plan(w, row(MID, 12, 15)));
    expect(w.under.portals()).toEqual([]);
    const p = plan(w, row(MID, 14, 18));
    expect(p.dig).toEqual([]);
    expect(p.cut).toEqual(row(MID, 16, 17));
    expect(p.portals).toEqual([{ x: 15, y: MID, face: 'E', floor: 0 }]);
    expect(p.stone).toBe(0);
    expect(p.cost).toEqual({ money: 2 * rules.drillCost + rules.portalCost });
    w.under.apply(p);
    // the same drag again asks for nothing
    expect(plan(w, row(MID, 14, 18))).toMatchObject({
      dig: [],
      cut: [],
      portals: [],
      cost: { money: 0 },
    });
  });

  it('keeps a cut a cut, and carries a cutting on past it', () => {
    const w = world(hills(PEAK));
    w.under.cut(16, MID);
    const p = plan(w, row(MID, 15, 17));
    expect(p.cut).toEqual([{ x: 17, y: MID }]);
    expect(p.dig).toEqual([{ x: 15, y: MID }]);
    expect(p.portals).toEqual([{ x: 15, y: MID, face: 'E', floor: 0 }]);
    expect(p.raise).toEqual([]);
  });

  it('shuts a portal the line now runs on through', () => {
    const w = steep(VALLEY);
    w.under.apply(plan(w, row(MID, 6, 9)));
    const portal = { x: 8, y: MID, face: 'E', floor: 0 };
    expect(w.under.portals()).toEqual([portal]);
    const p = plan(w, row(MID, 8, 12));
    expect(p.dig).toEqual(row(MID, 9, 12));
    expect(p.portals).toEqual([]);
    expect(p.shut).toEqual([portal]);
    w.under.apply(p);
    expect(w.under.portals()).toEqual([]);
    w.under.unapply(p);
    expect(w.under.portals()).toEqual([portal]);
    expect(w.under.isDug(10, MID)).toBe(false);
  });

  it('has nothing to dig on open ground', () => {
    expect(
      plan(
        world(() => 0),
        row(MID, 8, 12),
      ),
    ).toMatchObject({
      ok: true,
      dig: [],
      cut: [],
      raise: [],
      portals: [],
      cost: { money: 0 },
    });
  });

  it('breaks the line where a drag jumps', () => {
    const w = world(hills(PEAK));
    const p = plan(w, [
      { x: MID, y: MID },
      { x: 17, y: MID },
    ]);
    // nothing between the two is dug; alone, the tile at level 1 has one side that leads out
    expect(p.dig).toEqual([{ x: MID, y: MID }]);
    expect(p.cut).toEqual([{ x: 17, y: MID }]);
    expect(p.portals).toEqual([]);
  });

  it('refuses a tile touching water, side or corner', () => {
    for (const [wx, wy] of [
      [14, MID + 1],
      [13, MID + 1],
      [MID, MID],
    ]) {
      const w = world(hills(PEAK));
      const k = wy * SIZE + wx;
      w.map.terrain[k] = Terrain.Water;
      w.map.groundLevel![k] = NO_LEVEL;
      expect(plan(w, row(MID, 12, 13))).toMatchObject({
        ok: false,
        cost: {},
        reason: STR.build.digBesideWater,
        dig: [],
        raise: [],
      });
    }
  });

  it('refuses a tile off the map, and nothing is dug', () => {
    const w = world(hills(PEAK));
    expect(plan(w, row(MID, 22, 24))).toMatchObject({
      ok: false,
      reason: STR.build.offMap,
      refused: [{ x: 24, y: MID }],
    });
    expect(w.under.empty).toBe(true);
  });

  it('refuses a raise that would move something the surface holds', () => {
    const holds = (x: number, y: number) => !(x === 11 && y === MID + 1);
    // the saddle comes up to 3 and leaves the tile beside it at 2: nothing to move there
    expect(plan(world(hills(SADDLE)), row(MID, 9, 13), holds).ok).toBe(true);
    const p = plan(world(hills(LOW_SADDLE)), row(MID, 8, 14), holds);
    expect(p).toMatchObject({ ok: false, reason: STR.build.occupied, dig: [], raise: [], cut: [] });
    expect(p.refused).toContainEqual({ x: 11, y: MID + 1 });
  });

  it('refuses a raise past the limits of the ground', () => {
    const w = world(hills([[MID, 2, 3]]));
    expect(levelsOf(w, row(0, 11, 12))).toEqual([1, 1]);
    expect(plan(w, row(0, 11, 12))).toMatchObject({
      ok: false,
      reason: STR.build.groundLimit,
      raise: [],
    });
  });

  it('refuses the whole drag over a building, road, deposit or surface track', () => {
    const tiles = row(MID, 10, 14);
    const works = BUILDING_DEFS.find(
      (d) => !d.bridge && !d.terrain && !d.deposit && !d.needsWater,
    )!;
    const put: [string, (w: World) => void][] = [
      ['track', (w) => w.builder.track.place(MID, MID, 'straight', 1)],
      ['road', (w) => w.builder.roads.add(MID, MID)],
      ['coal', (w) => w.map.props.set(MID * SIZE + MID, [prop('coal')])],
      ['oil', (w) => w.map.props.set(MID * SIZE + MID, [prop('oil')])],
      ['station', (w) => w.builder.stations.push(new Station('quarry', MID, MID))],
      ['works', (w) => void w.builder.placeBuilding(MID, MID, works.id)],
    ];
    for (const [name, place] of put) {
      const w = world(hills(PEAK));
      w.builder.free = true;
      place(w);
      w.builder.free = false;
      const money = w.economy.money;
      const c = w.builder.checkDig(tiles);
      expect(c, name).toMatchObject({
        ok: false,
        cost: {},
        reason: STR.build.occupied,
        dig: [],
      });
      expect(c.refused, name).toContainEqual({ x: MID, y: MID });
      expect(w.builder.dig(tiles), name).toBe(false);
      expect(w.under.empty, name).toBe(true);
      expect(w.economy.money, name).toBe(money);
    }
    // a tree is scenery: it stays on the ground over the tunnel
    const w = world(hills(PEAK));
    w.map.props.set(MID * SIZE + MID, [prop('tree')]);
    expect(w.builder.dig(tiles)).toBe(true);
    expect(w.map.props.get(MID * SIZE + MID)).toHaveLength(1);
  });

  it('refuses uncharted ground, and a drag the money does not reach', () => {
    const w = world(hills(PEAK));
    w.regions.unlocked.fill(false);
    expect(w.builder.checkDig(row(MID, 11, 13))).toMatchObject({
      ok: false,
      reason: STR.build.locked,
    });
    const poor = world(hills(PEAK));
    poor.economy.money = 2 * rules.drillCost;
    expect(poor.builder.checkDig(row(MID, 11, 13))).toMatchObject({
      ok: false,
      reason: STR.build.funds,
      cost: { money: 3 * rules.drillCost },
    });
    expect(poor.builder.dig(row(MID, 11, 13))).toBe(false);
    expect(poor.under.empty).toBe(true);
    expect(poor.economy.money).toBe(2 * rules.drillCost);
  });

  it('digs on past rail that stands inside', () => {
    const w = world(hills(PEAK));
    expect(w.builder.dig(row(MID, 10, 12))).toBe(true);
    w.builder.track.place(11, MID, 'straight', 1);
    expect(w.builder.checkDig(row(MID, 11, 13))).toMatchObject({ ok: true, dig: [{ x: 13 }] });
    expect(w.builder.dig(row(MID, 11, 13))).toBe(true);
    expect(w.builder.track.get(11, MID)).toBeTruthy();
  });

  it('digs, pays, writes every tile of the raise and tells of the ground', () => {
    const w = world(hills(LOW_SADDLE));
    const heard: GroundChange[][] = [];
    w.builder.onGroundChanged = (c) => heard.push([...c]);
    const tiles = row(MID, 8, 14);
    const c = w.builder.checkDig(tiles);
    expect(w.builder.dig(tiles)).toBe(true);
    expect(w.economy.money).toBe(100_000 - c.cost.money);
    for (const t of tiles) expect(w.under.isDug(t.x, t.y)).toBe(true);
    // every tile written: the two readers of the ground agree with the plan
    const after = tileLevels(w.map);
    for (const m of c.raise) {
      expect(after[m.y * SIZE + m.x]).toBe(m.to);
      expect(levelAt(w.map, m.x, m.y)).toBe(m.to);
      expect(w.map.groundLevel![m.y * SIZE + m.x]).toBe(m.to);
    }
    expect(heard).toHaveLength(1);
    expect(heard[0].map((g) => [g.x, g.y, g.now])).toEqual(c.raise.map((m) => [m.x, m.y, m.to]));
    // the ridge over the tunnel is Rock, the slope beside it keeps its ground
    expect(w.map.terrain[MID * SIZE + 11]).toBe(Terrain.Rock);
    expect(w.map.terrain[(MID + 1) * SIZE + 11]).toBe(Terrain.Grass);
    // and so does a dug tile that did not move
    expect(w.map.terrain[MID * SIZE + 8]).toBe(Terrain.Grass);
  });

  it('tells nothing when a dig moves no ground, and takes nothing for nothing', () => {
    const w = world(hills(PEAK));
    const heard = vi.fn();
    w.builder.onGroundChanged = heard;
    expect(w.builder.dig(row(MID, 11, 13))).toBe(true);
    expect(heard).not.toHaveBeenCalled();
    const money = w.economy.money;
    expect(w.builder.dig(row(MID, 11, 13))).toBe(false);
    expect(w.economy.money).toBe(money);
  });

  it('digs for nothing in the editor, and brings no stone', () => {
    const w = world(hills(PEAK));
    w.builder.free = true;
    expect(w.builder.checkDig(row(MID, 11, 13))).toMatchObject({ ok: true, stone: 0 });
    expect(w.builder.dig(row(MID, 11, 13))).toBe(true);
    expect(w.economy.money).toBe(100_000);
    expect(w.depot.get('stone')).toBe(0);
    expect(w.builder.fillDug(12, MID)).toBe(true);
    expect(w.economy.money).toBe(100_000);
  });

  it('adds 2 stone a dug tile; back-fill refunds half', () => {
    const w = world(hills(PEAK));
    const tiles = row(MID, 10, 14);
    expect(w.builder.checkDig(tiles).stone).toBe(5 * rules.drillStone);
    expect(w.builder.dig(tiles)).toBe(true);
    expect(w.depot.get('stone')).toBe(10);
    expect(w.economy.money).toBe(100_000 - 5 * rules.drillCost);
    const earned = w.economy.earned;
    expect(w.builder.fillDug(14, MID)).toBe(true);
    expect(w.economy.money).toBe(100_000 - 5 * rules.drillCost + rules.drillCost * 0.5);
    expect(w.economy.earned).toBe(earned);
    expect(w.under.isDug(14, MID)).toBe(false);
    expect(w.depot.get('stone')).toBe(10);
  });

  it('a cut costs a tile, brings no stone, and fills like one', () => {
    const w = world(hills(PEAK));
    expect(w.builder.dig(row(MID, 14, 18))).toBe(true);
    expect(w.economy.money).toBe(100_000 - 4 * rules.drillCost - rules.portalCost);
    expect(w.depot.get('stone')).toBe(2 * rules.drillStone);
    const money = w.economy.money;
    expect(w.builder.fillDug(17, MID)).toBe(true);
    expect(w.under.isCut(17, MID)).toBe(false);
    expect(w.economy.money).toBe(money + rules.drillCost * 0.5);
  });

  it('a back-filled portal tile takes its portal; track removal leaves the tile dug', () => {
    const w = world(hills(PEAK));
    expect(w.builder.dig(row(MID, 13, 18))).toBe(true);
    expect(w.under.portals()).toHaveLength(1);
    w.builder.track.place(14, MID, 'straight', 1);
    expect(w.builder.removeTrack(14, MID)).toBe(true);
    expect(w.under.isDug(14, MID)).toBe(true);
    const money = w.economy.money;
    expect(w.builder.fillDug(14, MID)).toBe(true);
    expect(w.under.portals()).toHaveLength(1);
    expect(w.economy.money).toBe(money + rules.drillCost * 0.5);
    expect(w.builder.fillDug(15, MID)).toBe(true);
    expect(w.under.portals()).toEqual([]);
    expect(w.economy.money).toBe(money + rules.drillCost + rules.portalCost * 0.5);
  });

  it('gives back every portal of a tile that has two', () => {
    const u = new Underground(8, 8);
    u.dig(3, 3, 0);
    u.addPortal({ x: 3, y: 3, face: 'E', floor: 0 });
    u.addPortal({ x: 3, y: 3, face: 'W', floor: 0 });
    expect(u.fill(3, 3)?.portals.map((p) => p.face)).toEqual(['E', 'W']);
    expect(u.portals()).toEqual([]);
    expect(u.fill(3, 3)).toBeNull();
  });

  it('filling a cut takes the portal that looks at it, with its refund', () => {
    const w = world(hills(PEAK));
    expect(w.builder.dig(row(MID, 12, 18))).toBe(true);
    expect(w.under.portals()).toEqual([{ x: 15, y: MID, face: 'E', floor: 0 }]);
    const money = w.economy.money;
    expect(w.builder.fillDug(17, MID)).toBe(true);
    expect(w.under.portals()).toHaveLength(1);
    expect(w.builder.fillDug(16, MID)).toBe(true);
    expect(w.under.portals()).toEqual([]);
    expect(w.economy.money).toBe(money + rules.drillCost + rules.portalCost * 0.5);
  });

  it('an unapply leaves a portal that looked at a cut before the cut came', () => {
    const w = world(hills(PEAK));
    const portal = { x: 15, y: MID, face: 'E', floor: 0 } as const;
    w.under.dig(15, MID, 0);
    w.under.addPortal(portal);
    const p = plan(w, row(MID, 16, 18));
    expect(p.portals).toEqual([]);
    w.under.apply(p);
    w.under.unapply(p);
    expect(w.under.portals()).toEqual([portal]);
    expect(w.under.isCut(16, MID)).toBe(false);
  });

  it('holds the ground a portal looks out at, against Raise and against a dig', () => {
    const w = steep((x) => (x <= 10 || x >= 14 ? 4 : 0));
    expect(w.builder.dig(row(MID, 8, 11))).toBe(true);
    expect(w.under.portals()).toEqual([{ x: 10, y: MID, face: 'E', floor: 0 }]);
    expect(levelAt(w.map, 11, MID)).toBe(0);
    expect(w.builder.checkGround([{ x: 11, y: MID }], 1)).toMatchObject({
      ok: false,
      reason: STR.build.occupied,
      refused: [{ x: 11, y: MID }],
    });
    // a tunnel alongside would pull the tile up with its slope
    const c = w.builder.checkDig(row(MID + 1, 10, 14));
    expect(c).toMatchObject({ ok: false, reason: STR.build.occupied, dig: [], raise: [] });
    expect(c.refused).toContainEqual({ x: 11, y: MID });
    // the line running on through it is another matter: that shuts the portal
    expect(w.builder.dig(row(MID, 10, 14))).toBe(true);
    expect(w.under.portals()).toEqual([]);
  });

  it('brings the stone to one store whichever way the drag runs', () => {
    for (const tiles of [row(MID, 10, 14), row(MID, 14, 10)]) {
      const w = world(hills(PEAK));
      const { stores, depots } = storesWith([
        { amounts: {}, at: { x: 2, y: MID } },
        { amounts: {}, at: { x: 22, y: MID } },
      ]);
      const builder = new Builder(w.map, w.regions, new TrackGraph(SIZE, SIZE), w.economy, stores);
      expect(builder.dig(tiles)).toBe(true);
      expect(depots.map((d) => d.get('stone'))).toEqual([10, 0]);
    }
  });

  it('fill refuses a tile with track', () => {
    const w = world(hills(PEAK));
    expect(w.builder.dig(row(MID, 11, 13))).toBe(true);
    w.builder.track.place(12, MID, 'straight', 1);
    const money = w.economy.money;
    expect(w.builder.fillDug(12, MID)).toBe(false);
    expect(w.under.isDug(12, MID)).toBe(true);
    expect(w.economy.money).toBe(money);
    expect(w.builder.fillDug(5, 5)).toBe(false);
    expect(w.economy.money).toBe(money);
  });

  it('holds raised ground at the cover, and a fill leaves it standing', () => {
    const w = world(hills(SADDLE));
    expect(w.builder.dig(row(MID, 9, 13))).toBe(true);
    expect(levelAt(w.map, 11, MID)).toBe(3);
    expect(w.builder.checkGround([{ x: 11, y: MID }], -1).ok).toBe(false);
    expect(w.builder.fillDug(11, MID)).toBe(true);
    expect(levelAt(w.map, 11, MID)).toBe(3);
    expect(w.map.terrain[MID * SIZE + 11]).toBe(Terrain.Rock);
    expect(w.builder.checkGround([{ x: 11, y: MID }], -1).ok).toBe(true);
  });
});
