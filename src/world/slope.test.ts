import { describe, it, expect } from 'vitest';
import { generateMap, DEFAULT_MAP_PARAMS, type MapGenParams } from './mapgen';
import { tileLevels } from './elevation';
import { groundAllowsAt, groundAllowsOn, type GroundNeed } from './slope';
import { Terrain, startRegion, type GameMap } from './tiles';
import { buildRelief, groundAllows } from '../render/terrainRelief';
import { Rng } from '../engine/rng';
import { forAll, shrinkInt } from '../testing/property';

const NEEDS: GroundNeed[] = ['straight', 'level'];

/** Levels from rows of digits, one string per row. */
function grid(...rows: string[]) {
  const w = rows[0].length;
  return { w, h: rows.length, levels: Uint8Array.from(rows.join(''), Number) };
}
/** Whether `level` fits, over the whole grid, one string of 0/1 per row. */
function levelFits(g: ReturnType<typeof grid>) {
  const rows: string[] = [];
  for (let y = 0; y < g.h; y++) {
    let row = '';
    for (let x = 0; x < g.w; x++) row += groundAllowsAt(g, g.levels, x, y, 'level') ? '1' : '0';
    rows.push(row);
  }
  return rows;
}

describe('groundAllowsAt', () => {
  const plateau = grid('0000000', '0111110', '0122210', '0122210', '0122210', '0111110', '0000000');

  it('lets a plateau tile carry a level piece, and a tile beside a bank not', () => {
    // the 3 x 3 summit has one tile with all four sides at level 2; the foot's corners are flat
    // ground, and every other tile has a side one level up or down
    expect(levelFits(plateau)).toEqual([
      '1000001',
      '0000000',
      '0000000',
      '0001000',
      '0000000',
      '0000000',
      '1000001',
    ]);
  });

  it('lets a straight climb any tile of the map and nothing off it', () => {
    const fits = levelFits(plateau);
    for (let y = -2; y < plateau.h + 2; y++)
      for (let x = -2; x < plateau.w + 2; x++) {
        const inside = x >= 0 && y >= 0 && x < plateau.w && y < plateau.h;
        expect(groundAllowsAt(plateau, plateau.levels, x, y, 'straight')).toBe(inside);
        expect(groundAllowsAt(plateau, plateau.levels, x, y, 'level')).toBe(
          inside && fits[y][x] === '1',
        );
      }
  });

  it('refuses level on a tile with a lower neighbour and allows straight there', () => {
    // (2, 2) is the summit's corner: level 2, its west and north sides level 1
    expect(plateau.levels[2 * plateau.w + 2]).toBe(2);
    expect(groundAllowsAt(plateau, plateau.levels, 2, 2, 'level')).toBe(false);
    expect(groundAllowsAt(plateau, plateau.levels, 2, 2, 'straight')).toBe(true);
    // (1, 2) is the foot of the slope: its west side is lower, its east side higher
    expect(groundAllowsAt(plateau, plateau.levels, 1, 2, 'level')).toBe(false);
    expect(groundAllowsAt(plateau, plateau.levels, 1, 2, 'straight')).toBe(true);
  });

  it('counts only the four sides, not the diagonals', () => {
    // the middle tile is level 1 with a diagonal one level up, or one level down
    const up = grid('212', '111', '212'),
      down = grid('010', '111', '010');
    expect(groundAllowsAt(up, up.levels, 1, 1, 'level')).toBe(true);
    expect(groundAllowsAt(down, down.levels, 1, 1, 'level')).toBe(true);
    // while one side one level off is enough
    const side = grid('111', '211', '111');
    expect(groundAllowsAt(side, side.levels, 1, 1, 'level')).toBe(false);
  });

  it('counts a side off the map as level 0', () => {
    const flat = grid('000', '000', '000');
    const raised = grid('111', '111', '111');
    // ground at sea level fits a level piece to the very corner of the map
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++)
        expect(groundAllowsAt(flat, flat.levels, x, y, 'level')).toBe(true);
    // level 1 on the border has a side at level 0 off the map, and only the middle is smooth
    expect(levelFits(raised)).toEqual(['000', '010', '000']);
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++)
        expect(groundAllowsAt(raised, raised.levels, x, y, 'straight')).toBe(true);
  });

  it('works on a strip one tile wide', () => {
    const strip = grid('0121');
    expect(levelFits(strip)).toEqual(['0000']);
    const flat = grid('0000');
    expect(levelFits(flat)).toEqual(['1111']);
    expect(groundAllowsAt(strip, strip.levels, 4, 0, 'straight')).toBe(false);
    expect(groundAllowsAt(strip, strip.levels, 0, 1, 'straight')).toBe(false);
  });

  it('rises one level per tile into a mountain and fits level pieces only on its summit', () => {
    const map = { w: 15, h: 15, terrain: new Uint8Array(15 * 15).fill(Terrain.Mountain) };
    const levels = tileLevels(map);
    let summit = 0;
    for (let y = 0; y < 15; y++)
      for (let x = 0; x < 15; x++) {
        const edge = Math.min(x, y, 14 - x, 14 - y);
        expect(levels[y * 15 + x]).toBe(Math.min(4, edge + 1));
        // a summit tile has four neighbours at level 4: at least 4 tiles in from the border
        const fits = edge >= 4;
        expect(groundAllowsAt(map, levels, x, y, 'level')).toBe(fits);
        expect(groundAllowsOn(map, x, y, 'level')).toBe(fits);
        expect(groundAllowsAt(map, levels, x, y, 'straight')).toBe(true);
        if (fits) summit++;
      }
    expect(summit).toBe(7 * 7);
  });

  it('keeps Rock at level 0, so a level piece fits Rock away from a mountain and not beside one', () => {
    // a 9-tile mountain block in rock: rock is level 0, the block's rim level 1, its middle 2
    const map = { w: 9, h: 9, terrain: new Uint8Array(81).fill(Terrain.Rock) };
    for (let y = 3; y < 6; y++)
      for (let x = 3; x < 6; x++) map.terrain[y * 9 + x] = Terrain.Mountain;
    const levels = tileLevels(map);
    expect(levels[4 * 9 + 4]).toBe(2);
    expect(levels[3 * 9 + 3]).toBe(1);
    expect(groundAllowsAt(map, levels, 0, 0, 'level')).toBe(true);
    expect(groundAllowsAt(map, levels, 1, 4, 'level')).toBe(true);
    // beside the block: a side at level 1
    expect(groundAllowsAt(map, levels, 2, 4, 'level')).toBe(false);
    expect(groundAllowsAt(map, levels, 2, 4, 'straight')).toBe(true);
    // the block's own tiles all touch a lower or higher side
    for (let y = 3; y < 6; y++)
      for (let x = 3; x < 6; x++) expect(groundAllowsAt(map, levels, x, y, 'level')).toBe(false);
  });
});

describe('groundAllowsOn', () => {
  it('answers as the stored levels do on a drawn map, and reads the terrain as it is now', () => {
    const map = { w: 12, h: 12, terrain: new Uint8Array(144).fill(Terrain.Grass) };
    for (let y = 3; y < 9; y++) for (let x = 3; x < 9; x++) map.terrain[y * 12 + x] = Terrain.Hill;
    const before = tileLevels(map);
    for (const need of NEEDS)
      for (let y = -1; y <= 12; y++)
        for (let x = -1; x <= 12; x++)
          expect(groundAllowsOn(map, x, y, need)).toBe(groundAllowsAt(map, before, x, y, need));
    // painting the terrain changes the answer with no levels to rebuild
    const was = groundAllowsOn(map, 6, 6, 'level');
    map.terrain[6 * 12 + 7] = Terrain.Grass;
    expect(was).toBe(true);
    expect(groundAllowsOn(map, 6, 6, 'level')).toBe(false);
    expect(groundAllowsAt(map, before, 6, 6, 'level')).toBe(true);
  });
});

/** Seeded maps: the default size, a shifted origin, a long one and a small one. */
const MAPS: { name: string; seed: number; p: Partial<MapGenParams> }[] = [
  { name: 'default size', seed: 7412, p: {} },
  { name: 'another seed', seed: 20260912, p: {} },
  { name: 'shifted origin', seed: 5, p: { w: 128, h: 96, originX: -32, originY: -32 } },
  { name: 'rocky', seed: 31, p: { w: 96, h: 96, rockLevel: 0.5, hillLevel: 0.5 } },
  { name: 'small', seed: 99, p: { w: 40, h: 33 } },
];

describe('the renderer and the simulation share one slope rule', () => {
  // 5 maps, about 40 000 tiles with the margin round them, checked three ways: well under a
  // second alone
  it('agrees with groundAllows tile for tile on seeded maps', () => {
    const seen = new Set<string>();
    for (const { name, seed, p } of MAPS) {
      const map = generateMap(seed, p),
        relief = buildRelief(map, new Set()),
        levels = tileLevels(map);
      // the relief must be the shipped terraces, whose rule this is
      expect(relief.tiles, name).toBeDefined();
      expect(relief.tiles, name).toEqual(levels);
      for (const need of NEEDS)
        for (let y = -2; y < map.h + 2; y++)
          for (let x = -2; x < map.w + 2; x++) {
            const want = groundAllows(map, relief, x, y, need);
            expect(groundAllowsAt(map, levels, x, y, need), `${name}: ${need} at ${x},${y}`).toBe(
              want,
            );
            expect(groundAllowsOn(map, x, y, need), `${name}: ${need} on ${x},${y}`).toBe(want);
            if (x >= 0 && y >= 0 && x < map.w && y < map.h)
              seen.add(`${need} ${want} at level ${levels[y * map.w + x]}`);
          }
    }
    // not vacuous: ground that takes a level piece and ground that does not, raised or not
    expect(seen).toContain('level true at level 0');
    expect(seen).toContain('level false at level 0');
    expect(seen).toContain('level false at level 1');
    expect(seen).toContain('level false at level 2');
    expect(seen).toContain('straight true at level 0');
    expect(seen).toContain('straight true at level 2');
  }, 20_000);

  // which generated ground above sea level takes a level piece: the plateaus, and nothing else
  it('fits level pieces above sea level only where the four sides stand at the same level', () => {
    let plateaus = 0;
    for (const { seed, p } of MAPS) {
      const map = generateMap(seed, p),
        relief = buildRelief(map, new Set()),
        levels = tileLevels(map);
      for (let y = 0; y < map.h; y++)
        for (let x = 0; x < map.w; x++) {
          const at = y * map.w + x;
          if (!levels[at]) continue;
          const flat =
            x > 0 &&
            y > 0 &&
            x < map.w - 1 &&
            y < map.h - 1 &&
            [1, -1, map.w, -map.w].every((d) => levels[at + d] === levels[at]);
          expect(groundAllows(map, relief, x, y, 'level')).toBe(flat);
          if (flat) plateaus++;
        }
    }
    expect(plateaus).toBeGreaterThan(0);
  }, 20_000);
});

// Mountains rise from stone fields (raiseMountains in mapgen.ts): a Rock tile becomes a Mountain
// when the 8 tiles around it are Rock and each of those has 8 Rock tiles around it. So the 5 x 5
// block around a Mountain is Rock or Mountain: a Mountain stands at least three tiles from any
// tile that is neither, behind two rings of Rock. Tiles off the map are not seen, so a Mountain
// can stand on the border.
//
// One exception holds: the start chunk. Its guarantee of every basic resource and of a pump tile
// (startResources in mapgen.ts) runs after the mountains rise and paints small patches of water,
// forest, hill or grass over whatever lies there, Rock and Mountain included, so a Mountain
// there can stand beside a painted tile. Everywhere else the rings are whole.
describe('mountains sit inside rock', () => {
  interface Case {
    seed: number;
    w: number;
    h: number;
    ox: number;
    oy: number;
    rockLevel: number;
    hillLevel: number;
  }
  const genCase = (rng: Rng): Case => ({
    seed: rng.int(0, 2 ** 31 - 1),
    w: rng.int(32, 128),
    h: rng.int(32, 128),
    ox: rng.chance(0.5) ? -32 * rng.int(0, 2) : rng.int(-100, 100),
    oy: rng.chance(0.5) ? -32 * rng.int(0, 2) : rng.int(-100, 100),
    // low rock levels make big stone fields; the default makes few
    rockLevel: rng.chance(0.5) ? DEFAULT_MAP_PARAMS.rockLevel : rng.int(50, 70) / 100,
    hillLevel: rng.int(45, 90) / 100,
  });
  function* shrinkCase(c: Case): Iterable<Case> {
    if (c.rockLevel !== DEFAULT_MAP_PARAMS.rockLevel)
      yield { ...c, rockLevel: DEFAULT_MAP_PARAMS.rockLevel };
    if (c.hillLevel !== DEFAULT_MAP_PARAMS.hillLevel)
      yield { ...c, hillLevel: DEFAULT_MAP_PARAMS.hillLevel };
    for (const ox of shrinkInt(c.ox)) yield { ...c, ox };
    for (const oy of shrinkInt(c.oy)) yield { ...c, oy };
    for (const w of shrinkInt(c.w, 32)) yield { ...c, w };
    for (const h of shrinkInt(c.h, 32)) yield { ...c, h };
  }
  const mapOf = (c: Case): GameMap =>
    generateMap(c.seed, {
      w: c.w,
      h: c.h,
      originX: c.ox,
      originY: c.oy,
      rockLevel: c.rockLevel,
      hillLevel: c.hillLevel,
    });
  const stone = (t: number) => t === Terrain.Rock || t === Terrain.Mountain;
  const mountainsIn = (m: GameMap) =>
    m.terrain.reduce((n, t) => n + (t === Terrain.Mountain ? 1 : 0), 0);

  /**
   * Mountain tiles with a tile within `reach` of them (Chebyshev distance) that is neither Rock nor
   * Mountain and lies outside the start chunk, each as "mountain beside tile".
   */
  function exposed(m: GameMap, reach: number) {
    const { rx, ry } = startRegion(m),
      rs = m.regionSize,
      bad: string[] = [];
    for (let y = 0; y < m.h; y++)
      for (let x = 0; x < m.w; x++) {
        if (m.terrain[y * m.w + x] !== Terrain.Mountain) continue;
        for (let dy = -reach; dy <= reach; dy++)
          for (let dx = -reach; dx <= reach; dx++) {
            const nx = x + dx,
              ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
            if (stone(m.terrain[ny * m.w + nx])) continue;
            if (Math.floor(nx / rs) === rx && Math.floor(ny / rs) === ry) continue;
            bad.push(`${x},${y} beside ${nx},${ny}`);
          }
      }
    return bad;
  }

  let mountains = 0;
  // 40 maps up to 128 tiles a side: about 0.5 s alone
  it('has only Rock or Mountain on the 8 tiles around a Mountain, and two rings of Rock', () => {
    forAll(
      genCase,
      (c) => {
        const m = mapOf(c);
        mountains += mountainsIn(m);
        // the 8 neighbours are stone, so the nearest other tile is two away ...
        expect(exposed(m, 1)).toEqual([]);
        // ... and in fact the 5 x 5 block is, so the nearest other tile is three away
        expect(exposed(m, 2)).toEqual([]);
      },
      { seeds: Array.from({ length: 40 }, (_, i) => i + 1), shrink: shrinkCase },
    );
    // not vacuous: the cases do grow mountains
    expect(mountains).toBeGreaterThan(0);
  }, 30_000);

  // 8 maps of 160 x 160 tiles at the default sliders: about 0.3 s alone
  it('holds in worlds at the default sliders', () => {
    let found = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const m = generateMap(seed, { w: 160, h: 160 });
      found += mountainsIn(m);
      expect(exposed(m, 2), `seed ${seed}`).toEqual([]);
    }
    expect(found).toBeGreaterThan(0);
  }, 30_000);
});
