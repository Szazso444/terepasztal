import { beforeEach, describe, expect, it } from 'vitest';
import { content } from '../data/content';
import { forAll, shrinkArray } from '../testing/property';
import { mapParams, simWorld } from '../testing/simWorld';
import { BIOME_DEFS } from '../sim/biomes';
import { DEFAULT_RULES, rules } from '../sim/rules';
import { STATION_DEFS, harvestBreakdown, weeklyOutput } from '../sim/stations';
import { STR } from '../strings';
import { tileLevels } from '../world/elevation';
import { emptyMap, generateMap } from '../world/mapgen';
import { TRACK_ITEMS } from '../world/track';
import { Biome, TERRAIN_NAMES, Terrain, type GameMap } from '../world/tiles';
import { Dir } from '../engine/iso';
import { Headwater, fallFeature, withHeadwater } from '../world/waterfalls';
import { tileTip, type TileSnapshot } from './tileTooltip';
import { blockText, plain, type Block, type Parts, type TermPart } from './tooltipDoc';

beforeEach(() => Object.assign(rules, DEFAULT_RULES));

/** The names the author chose (the decision board, 2026-10-11): Grass and Rock, not the old ones. */
const NAMES: Record<string, string> = {
  grass: 'Grass',
  forest: 'Forest',
  hill: 'Hill',
  water: 'Water',
  rock: 'Rock',
  sand: 'Sand',
  mountain: 'Mountain',
  ice: 'Glacier',
};

const bare = (map: GameMap, x: number, y: number): TileSnapshot => ({
  map,
  x,
  y,
  charted: true,
  track: null,
  decor: null,
  props: [],
  powered: false,
  trackCostFactor: 1,
  weeklyAtLevel1: weeklyOutput(1, 1, { productionMul: 1 }),
});
const partsOf = (b: Block): Parts => (b.kind === 'row' ? [...b.label, ...b.value] : b.parts);
const labelOf = (b: Block) => (b.kind === 'row' ? plain(b.label) : '');
const valueOf = (b: Block) => (b.kind === 'row' ? plain(b.value) : '');
const termOf = (b: Block) =>
  partsOf(b).find((p): p is TermPart => typeof p !== 'string' && 'term' in p);

/**
 * The tile tooltip of every tile of `map` against an oracle that shares none of its code: the
 * levels come from the whole-grid fixed point (`tileLevels`, not the builder's per-tile
 * `levelAt`), the snow line from the biome table read at the climate plane, and the words from
 * the issue. `seen` collects the kinds of tile it met, so a caller can see it ran on each.
 */
function checkEveryTile(map: GameMap, seen: Set<string>): void {
  const levels = tileLevels(map);
  const climate = map.climate ?? map.biome;
  for (let y = 0; y < map.h; y++)
    for (let x = 0; x < map.w; x++) {
      const i = y * map.w + x;
      const terrain = map.terrain[i];
      const name = NAMES[TERRAIN_NAMES[terrain]];
      const snowLevel = BIOME_DEFS[climate[i]].snowLevel;
      const snow = terrain !== Terrain.Water && terrain !== Terrain.Ice && levels[i] >= snowLevel;
      // a river's own tiles are checked apart below, where their planes are made by hand
      if (map.flow?.[i]) continue;
      const doc = tileTip(bare(map, x, y));
      const snowRow = doc.find((b) => labelOf(b) === 'Snow line');
      // one line a tile: block kinds; title; Biome row; Elevation row; Snow line row; the dim line
      const got = [
        doc.map((b) => b.kind).join(),
        blockText(doc[0]),
        `${labelOf(doc[1])}: ${termOf(doc[1])?.term}`,
        `${labelOf(doc[2])}: ${valueOf(doc[2])}`,
        snowRow ? `${labelOf(snowRow)}: ${valueOf(snowRow)}` : '-',
        blockText(doc[doc.length - 1]),
      ];
      const want = [
        `title,row,row,${snow ? 'row,' : ''}dim`,
        snow ? `${name}, snow` : name,
        `Biome: ${BIOME_DEFS[map.biome[i]].name}`,
        `Elevation: level ${levels[i]}`,
        snow ? `Snow line: above level ${snowLevel - 1}` : '-',
        terrain === Terrain.Water ? STR.tile.water : STR.tile.about[TERRAIN_NAMES[terrain]],
      ];
      if (got.join('\n') !== want.join('\n')) {
        const at = `${name} at ${x},${y}, level ${levels[i]}, biome ${BIOME_DEFS[map.biome[i]].id}`;
        expect(
          got,
          `${at} over climate ${BIOME_DEFS[climate[i]].id} (snow from ${snowLevel})`,
        ).toEqual(want);
      }

      seen.add(TERRAIN_NAMES[terrain]);
      if (snow) seen.add('snow');
      else if (terrain === Terrain.Mountain) seen.add('mountain without snow');
      if (snow && climate[i] !== map.biome[i]) seen.add('snow by climate, not biome');
      if (terrain === Terrain.Mountain && levels[i] === 4) seen.add('summit');
    }
}

describe('the tooltip of water and glacier tiles', () => {
  const tile = (set: (m: GameMap, i: number) => void) => {
    const map = emptyMap(1, 8, 8);
    map.climate = new Uint8Array(64);
    map.waterSurface = new Uint8Array(64);
    map.flow = new Uint16Array(64);
    map.flowDir = new Uint8Array(64);
    map.feature = new Uint8Array(64);
    const i = 3 * 8 + 3;
    set(map, i);
    return tileTip(bare(map, 3, 3));
  };
  const river = (m: GameMap, i: number) => {
    m.terrain[i] = Terrain.Water;
    m.biome[i] = Biome.River;
    m.flowDir![i] = 2;
    m.flow![i] = 57;
  };
  const rows = (doc: readonly Block[]) =>
    doc.filter((b) => b.kind === 'row').map((b) => `${labelOf(b)}: ${valueOf(b)}`);
  const about = (doc: readonly Block[]) => blockText(doc[doc.length - 1]);

  it('names a waterfall before a headwater, with its drop as a term', () => {
    const doc = tile((m, i) => {
      river(m, i);
      m.feature![i] = withHeadwater(fallFeature(2, Dir.E), Headwater.Spring);
    });
    expect(blockText(doc[0])).toBe('Waterfall');
    expect(rows(doc)).toEqual([
      'Biome: River',
      'Elevation: level 0',
      'Drop: 2 levels',
      'Source: a spring on high ground',
      'Flow: gathers 57 tiles of rain',
    ]);
    expect(about(doc)).toBe('Bridges only; pumps draw from it.');
    const drop = doc.find((b) => labelOf(b) === 'Drop')!;
    const tip = termOf(drop)!.tip();
    expect(blockText(tip[0])).toBe('Waterfall');
    expect(blockText(tip[1])).toBe(
      'A river falls 2 levels here, from 1 to 4. Track crosses it on a bridge at the upper ' +
        'level; nothing is built on it.',
    );
  });

  it('says level for a drop of one', () => {
    const doc = tile((m, i) => {
      river(m, i);
      m.feature![i] = fallFeature(1, Dir.E);
    });
    expect(rows(doc)).toContain('Drop: 1 level');
    const tip = termOf(doc.find((b) => labelOf(b) === 'Drop')!)!.tip();
    expect(blockText(tip[1])).toContain('falls 1 level here');
  });

  it('names a headwater, melt or spring', () => {
    const doc = tile((m, i) => {
      river(m, i);
      m.feature![i] = withHeadwater(0, Headwater.Melt);
    });
    expect(blockText(doc[0])).toBe('Headwater');
    expect(rows(doc)).toContain('Source: melt below a glacier');
    expect(about(doc)).toBe('Where a river starts. Bridges cross it; pumps draw from it.');
  });

  it('reads Glacier / Mountain with no snow in its title', () => {
    const doc = tile((m, i) => {
      for (let k = 0; k < 64; k++) m.terrain[k] = Terrain.Mountain;
      m.terrain[i] = Terrain.Ice;
      m.biome[i] = Biome.Mountain;
    });
    expect(blockText(doc[0])).toBe('Glacier');
    expect(valueOf(doc[1])).toBe('Mountain');
    expect(about(doc)).toBe('Glacier ice. Nothing is built on it; its melt starts a river below.');
  });

  it("reads Water for a lake and for an old chunk's river, Sand on a beach", () => {
    const lake = tile((m, i) => {
      m.terrain[i] = Terrain.Water;
      m.biome[i] = Biome.Lake;
    });
    expect([blockText(lake[0]), valueOf(lake[1])]).toEqual(['Water', 'Lake']);
    expect(rows(lake)).toHaveLength(2);
    const beach = tile((m, i) => {
      m.terrain[i] = Terrain.Sand;
      m.biome[i] = Biome.Beach;
    });
    expect([blockText(beach[0]), valueOf(beach[1])]).toEqual(['Sand', 'Beach']);
  });
});

describe('the tile tooltip on whole maps', () => {
  interface Patch {
    terrain: Terrain;
    biome: number;
    climate: number;
    x: number;
    y: number;
    w: number;
    h: number;
  }
  interface Case {
    size: number;
    patches: Patch[];
  }
  /** Mountains weighted up: a summit needs a mountain block seven tiles across. */
  const GROUND = [
    Terrain.Grass,
    Terrain.Forest,
    Terrain.Hill,
    Terrain.Water,
    Terrain.Rock,
    Terrain.Sand,
    Terrain.Mountain,
    Terrain.Mountain,
    Terrain.Mountain,
  ];
  const mapOf = (c: Case): GameMap => {
    const map = emptyMap(7, c.size, c.size, Terrain.Grass);
    map.climate = new Uint8Array(map.biome);
    for (const p of c.patches)
      for (let y = p.y; y < Math.min(c.size, p.y + p.h); y++)
        for (let x = p.x; x < Math.min(c.size, p.x + p.w); x++) {
          map.terrain[y * c.size + x] = p.terrain;
          map.biome[y * c.size + x] = p.biome;
          map.climate[y * c.size + x] = p.climate;
        }
    return map;
  };
  const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

  it('titles, rows and snow of every tile follow the terrain, level, biome and climate', () => {
    const seen = new Set<string>();
    forAll<Case>(
      (rng) => {
        const size = rng.int(12, 24);
        return {
          size,
          patches: Array.from({ length: rng.int(1, 6) }, () => ({
            terrain: rng.pick(GROUND),
            biome: rng.int(0, BIOME_DEFS.length - 1),
            climate: rng.int(0, BIOME_DEFS.length - 1),
            x: rng.int(0, size - 1),
            y: rng.int(0, size - 1),
            w: rng.int(3, 12),
            h: rng.int(3, 12),
          })),
        };
      },
      (c) => checkEveryTile(mapOf(c), seen),
      {
        seeds: SEEDS,
        shrink: (c) => [...shrinkArray(c.patches)].map((patches) => ({ ...c, patches })),
      },
    );
    // the property ran on every kind of tile it is about
    for (const kind of [
      // the cases paint the terrains a player can; ice comes only from generation
      ...Object.keys(NAMES).filter((k) => k !== 'ice'),
      'snow',
      'mountain without snow',
      'snow by climate, not biome',
      'summit',
    ])
      expect(seen.has(kind), `no ${kind} tile in any case`).toBe(true);
  });

  /**
   * One world at the sizes the cases draw: a new world plans the rivers of the chunks around its
   * start (#341), most of half a second on a busy machine, and a map of the same world whose start
   * chunk stands where the last one's did reads that plan again (all of 65 to 80 tiles do).
   */
  const WORLD_SEED = 20260912;

  // a world's river plan and every tile of six maps checked: 1.4 to 1.7 s alone on a busy machine
  it('does the same on maps the generator makes, which have no climate plane yet', () => {
    const seen = new Set<string>();
    forAll(
      (rng) => ({ mapSeed: WORLD_SEED, size: rng.int(65, 80) }),
      (c) => {
        const map = generateMap(c.mapSeed, mapParams(c.size));
        checkEveryTile(map, seen);
      },
      { seeds: [1, 2, 3, 4, 5, 6] },
    );
    // a map has the ground it was generated with: most of the seven terrains show up
    expect([...seen].filter((k) => k in NAMES).length).toBeGreaterThanOrEqual(5);
  }, 20_000);

  it('never calls water snow, however low the snow line is', () => {
    const saved = BIOME_DEFS.map((d) => d.snowLevel);
    try {
      for (const d of BIOME_DEFS) d.snowLevel = 0;
      for (const t of [Terrain.Grass, Terrain.Forest, Terrain.Hill, Terrain.Sand, Terrain.Rock]) {
        const doc = tileTip(bare(emptyMap(7, 5, 5, t), 2, 2));
        expect(blockText(doc[0]), TERRAIN_NAMES[t]).toBe(`${NAMES[TERRAIN_NAMES[t]]}, snow`);
      }
      const water = tileTip(bare(emptyMap(7, 5, 5, Terrain.Water), 2, 2));
      expect(blockText(water[0])).toBe('Water');
      expect(water.map((b) => b.kind)).toEqual(['title', 'row', 'row', 'dim']);
    } finally {
      BIOME_DEFS.forEach((d, i) => (d.snowLevel = saved[i]));
    }
  });
});

describe('what each terrain description says is true of the rules', () => {
  /**
   * The claims the approved descriptions make (issue #360), the only table here that is not read
   * from the game: `buildings` whether a building can stand there (absent: not said), `track` that
   * all track can go there or that it costs extra, `counted` the harvesting stations it feeds.
   */
  const CLAIMS: Record<
    string,
    { buildings?: boolean; track?: 'all' | 'extra'; counted?: string[] }
  > = {
    grass: { buildings: true, track: 'all' },
    forest: { buildings: true, track: 'extra', counted: ['lumber'] },
    hill: { counted: ['quarry'] },
    rock: { buildings: false, counted: ['quarry'] },
    sand: { buildings: true, track: 'all' },
    mountain: { buildings: false },
    ice: {},
  };
  const LAND = Object.keys(CLAIMS);
  const terrainOf = (name: string) => TERRAIN_NAMES.indexOf(name as (typeof TERRAIN_NAMES)[number]);
  /** The middle of the map, twenty tiles across, becomes `name`: room for any piece or station. */
  const paint = (map: GameMap, name: string) => {
    for (let y = 10; y < 30; y++)
      for (let x = 10; x < 30; x++) map.terrain[y * map.w + x] = terrainOf(name);
  };
  const harvesters = STATION_DEFS.filter((d) => d.terrain);

  it('claims something for every land terrain it describes, and nothing else', () => {
    expect(Object.keys(STR.tile.about).sort()).toEqual([...LAND].sort());
  });

  it('puts each claim in its words: buildings, track and the stations that count it', () => {
    for (const t of LAND) {
      const said = STR.tile.about[t];
      const c = CLAIMS[t];
      const can = /\bbuildings?\b[^.;]*\bcan\b|\bcan\b[^.;]*\bbuildings?\b/i;
      const no = /\bno building\b/i;
      if (c.buildings === true) {
        expect(said, `${t} says buildings can stand there`).toMatch(can);
        expect(said, t).not.toMatch(no);
      } else if (c.buildings === false) {
        expect(said, `${t} says no building stands there`).toMatch(no);
        expect(said, t).not.toMatch(can);
      } else expect(said, `${t} says nothing of buildings`).not.toMatch(/\bbuilding/i);
      if (c.track === 'all') expect(said, t).toMatch(/\ball track\b|\btrack\b[^.;]*\bcan go\b/i);
      else if (c.track === 'extra') expect(said, t).toMatch(/\btrack costs extra\b/i);
      // the stations it names are the stations it is claimed to feed
      const named = harvesters
        .filter((d) => said.toLowerCase().includes(STR.station.plural[d.id]))
        .map((d) => d.id);
      expect(named.sort(), `${t} names the stations that count it`).toEqual(
        [...(c.counted ?? [])].sort(),
      );
    }
  });

  it('is built on only where it says a building can stand', () => {
    const w = simWorld({ terrain: 'grass', size: 40 });
    w.builder.free = true;
    const stations = STATION_DEFS.map((d) => ({
      what: `station ${d.id}`,
      reason: (): string | undefined => w.builder.checkStation(20, 20, d.id).reason,
    }));
    const works = content.buildings.map((d) => ({
      what: `building ${d.id}`,
      reason: (): string | undefined => w.builder.checkBuilding(20, 20, d.id).reason,
    }));
    expect(stations.length + works.length).toBeGreaterThan(10);
    // the builder's refusal for the ground, which names it (`unbuildable` in src/sim/build.ts); a
    // station's or works' own ground (the colliery's hill, the pump's grass or forest) is a rule of
    // its own, not the terrain's bar
    const groundRefusals: readonly string[] = Object.values(STR.build.nothingOn);
    for (const t of LAND) {
      paint(w.map, t);
      const named = (STR.build.nothingOn as Record<string, string | undefined>)[t];
      for (const p of [...stations, ...works]) {
        const reason = p.reason();
        const barred = reason !== undefined && groundRefusals.includes(reason);
        const claim = CLAIMS[t].buildings;
        // a terrain that says buildings can stand bars none; one that says none bars every one,
        // naming the ground the description is of
        if (claim === true) expect(barred, `${p.what} on ${t}: ${reason}`).toBe(false);
        if (claim === false) {
          expect(named, `a refusal that names ${t}`).toBeDefined();
          expect(reason, `${p.what} on ${t}`).toBe(named);
        }
      }
    }
  });

  it('lets every piece of track be laid where it says all track can go', () => {
    const w = simWorld({ terrain: 'grass', size: 40 });
    w.builder.free = true;
    for (const t of LAND.filter((l) => CLAIMS[l].track === 'all')) {
      paint(w.map, t);
      for (const item of TRACK_ITEMS)
        for (let rot = 0; rot < 4; rot++) {
          const check = w.builder.checkTrack(20, 20, item, rot);
          expect(
            check.ok,
            `${item.kind} ${item.cls} on ${t}, rotation ${rot}: ${check.reason}`,
          ).toBe(true);
        }
    }
  });

  it('prices track higher where it says clearing costs extra', () => {
    const w = simWorld({ terrain: 'grass', size: 40 });
    const factor = (name: string) => {
      w.map.terrain[20 * w.map.w + 20] = terrainOf(name);
      return w.builder.terrainMul(20, 20);
    };
    const grass = factor('grass');
    for (const t of LAND.filter((l) => CLAIMS[l].track === 'extra'))
      expect(factor(t), t).toBeGreaterThan(grass);
  });

  it('feeds the stations it names from the ground it describes', () => {
    let checked = 0;
    for (const t of LAND) {
      const field = emptyMap(7, 15, 15, terrainOf(t));
      for (const d of harvesters) {
        if (!STR.tile.about[t].toLowerCase().includes(STR.station.plural[d.id])) continue;
        const b = harvestBreakdown(field, 7, 7, d.id, 1, 'spring', { productionMul: 1 });
        expect(b?.sum ?? 0, `${d.id} counts ${t}`).toBeGreaterThan(0);
        checked++;
      }
    }
    // every pairing the claims name was looked at, so the loop is not empty
    expect(checked).toBe(LAND.reduce((n, t) => n + (CLAIMS[t].counted?.length ?? 0), 0));
  });
});
