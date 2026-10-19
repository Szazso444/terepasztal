import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT, behavesAs, validateContent } from '../data/content';
import { groundOf } from '../art/buildingGround';
import { Dir } from '../engine/iso';
import { STR } from '../strings';
import { simWorld, line, station, type SimWorld } from '../testing/simWorld';
import { buildingDef, buildingFootprint } from './buildings';
import { doorsOf, placeSpan } from './doors';
import { stationProfession } from './people';
import { DEFAULT_RULES, rules } from './rules';
import {
  resetStationIds,
  stationDef,
  stationFootprint,
  stationGates,
  stationSpan,
  STATION_DEFS,
} from './stations';
import { productionMul } from './weather';

// The author's second review round of sizes and footprints (2026-10-19, F7): the Station and the
// Farm Halt come small (one tile) and big (two), and four works take another footprint.

/** What a def keeps of its own: the rest of it (stats, cost, produce, ground) is the def it copies. */
const OWN = ['id', 'name', 'art', 'span', 'doors', 'like'];
const stats = (id: string) =>
  Object.fromEntries(Object.entries(stationDef(id)).filter(([k]) => !OWN.includes(k)));

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  resetStationIds(1);
});

const key = (t: { x: number; y: number }) => `${t.x},${t.y}`;
const keys = (ts: { x: number; y: number }[]) => ts.map(key).sort();

/** Flat grass with a row of track along y = 27 and one along y = 30: a pair on row 28 has track beside it. */
function world(): SimWorld {
  const w = simWorld({ terrain: 'grass', size: 64 });
  w.builder.free = true;
  line(w, 2, 27, 50);
  line(w, 2, 30, 50);
  return w;
}

describe('the small and the big station', () => {
  it('is one tile, the Station, and a 2 x 1 Big Station of the same kind', () => {
    const small = stationDef('station');
    const big = stationDef('big_station');
    expect(small.name).toBe('Station');
    expect(big.name).toBe('Big Station');
    expect(placeSpan(small)).toEqual({ w: 1, h: 1 });
    expect(placeSpan(big)).toEqual({ w: 2, h: 1 });
    expect(small.span).toBeUndefined();
    expect(big.span).toEqual({ w: 2, h: 1 });
  });

  it('draws the old pictures station_1 to station_5: the small one until new art, the big one for good', () => {
    // the Big Station keeps the old picture under a name of its own, so that the Station's can
    // be replaced when the buildings-v2 pictures are packed (a separate Art task)
    expect(stationDef('station').art).toBe('station');
    expect(stationDef('big_station').art).toBe('big_station');
  });

  it('has the Station’s stats and cost, as the author asked for now', () => {
    expect(stats('big_station')).toEqual(stats('station'));
    expect(stats('station').cost).toEqual({ wood: 35, stone: 25, iron: 5 });
  });

  it('behaves as a Station for passengers, in the sim and in the cap on its output', () => {
    expect(behavesAs(stationDef('big_station'))).toBe('station');
    expect(behavesAs(stationDef('station'))).toBe('station');
    expect(stationProfession(stationDef('big_station'))).toBe('passenger');
    const w = world();
    for (const [id, x] of [
      ['station', 10],
      ['big_station', 20],
    ] as const) {
      const s = station(w, id, x, 28);
      s.passengerPopulation = 5;
      // 0.4 passengers a week per person round it, under the rate the level gives
      expect(s.productionPerWeek, id).toBeCloseTo(2, 9);
    }
  });

  it('stands on one tile, or on two along x, and on the other axis turned', () => {
    const w = world();
    const small = station(w, 'station', 10, 28);
    expect(keys(small.footprint())).toEqual(['10,28']);
    expect([small.w, small.h]).toEqual([1, 1]);
    for (const rot of [1, 2, 3]) expect(stationFootprint('station', 10, 28, rot)).toHaveLength(1);

    const v = world();
    const big = station(v, 'big_station', 10, 28);
    expect(keys(big.footprint())).toEqual(['10,28', '11,28']);
    expect([big.w, big.h]).toEqual([2, 1]);
    for (const t of big.footprint()) expect(v.builder.stationAt(t.x, t.y)).toBe(big);
    expect(keys(stationFootprint('big_station', 10, 28, 1))).toEqual(['10,28', '10,29']);
    expect(keys(stationFootprint('big_station', 10, 28, 2))).toEqual(['10,28', '11,28']);
    expect(keys(stationFootprint('big_station', 10, 28, 3))).toEqual(['10,28', '10,29']);
    const turned = station(world(), 'big_station', 10, 28, 1);
    expect([turned.w, turned.h]).toEqual([1, 2]);
    // served from the six tiles beside the pair, from one beside the small one's tile
    expect(stationGates('station', 10, 28, 0)).toHaveLength(4);
    expect(stationGates('big_station', 10, 28, 0)).toHaveLength(6);
  });

  it('refuses the Big Station when its second tile is taken, and the small one on one tile only', () => {
    const w = world();
    station(w, 'lumber', 11, 28);
    expect(w.builder.checkStation(10, 28, 'big_station', 0).reason).toBe(STR.build.occupied);
    expect(w.builder.checkStation(10, 28, 'station', 0).ok).toBe(true);
    expect(w.builder.checkStation(11, 28, 'station', 0).reason).toBe(STR.build.occupied);
  });
});

describe('the small and the big farm halt', () => {
  it('is one tile, the Farm Halt, and a 1 x 2 Big Farm Halt of the same kind', () => {
    const small = stationDef('farm');
    const big = stationDef('big_farm');
    expect(small.name).toBe('Farm Halt');
    expect(big.name).toBe('Big Farm Halt');
    expect(placeSpan(small)).toEqual({ w: 1, h: 1 });
    expect(placeSpan(big)).toEqual({ w: 1, h: 2 });
    expect(small.span).toBeUndefined();
    expect(big.span).toEqual({ w: 1, h: 2 });
    expect(stationDef('farm').art).toBe('farm');
    expect(stationDef('big_farm').art).toBe('big_farm');
  });

  it('has the Farm Halt’s stats and cost, and behaves as one on the land and in the seasons', () => {
    expect(stats('big_farm')).toEqual(stats('farm'));
    expect(behavesAs(stationDef('big_farm'))).toBe('farm');
    expect(stationProfession(stationDef('big_farm'))).toBe('farmer');
    // the season's and the biome's say on a farm halt reach the big one through the kind
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const)
      expect(productionMul(behavesAs(stationDef('big_farm')), season)).toBe(
        productionMul('farm', season),
      );
    expect(productionMul('farm', 'winter')).toBeLessThan(1);
  });

  it('keeps F2’s doors on the Big Farm Halt: the platform door on the front row, the street door on the back row', () => {
    const big = stationDef('big_farm');
    expect(big.doors).toEqual([
      { kind: 'platform', tile: [0, 1], side: 'S' },
      { kind: 'street', tile: [0, 0], side: 'N' },
    ]);
    const FRONT = [Dir.S, Dir.W, Dir.N, Dir.E];
    for (const rot of [0, 1, 2, 3]) {
      const doors = doorsOf(big, 10, 7, rot);
      const platform = doors.find((d) => d.kind === 'platform')!;
      const street = doors.find((d) => d.kind === 'street')!;
      const inside = new Set(keys(stationFootprint('big_farm', 10, 7, rot)));
      const gates = new Set(keys(stationGates('big_farm', 10, 7, rot)));
      const label = `r${rot}`;
      expect(platform.side, label).toBe(FRONT[rot]);
      expect(street.side, label).toBe((platform.side + 2) % 4);
      expect(key(platform.tile), label).not.toBe(key(street.tile));
      for (const d of doors) {
        expect(inside.has(key(d.tile)), label).toBe(true);
        expect(inside.has(key(d.reach)), label).toBe(false);
        expect(gates.has(key(d.reach)), label).toBe(true);
      }
    }
    // at rotation 0 the platform door is on the second row's tile and the street door on the first's
    const r0 = doorsOf(big, 10, 7, 0);
    expect(key(r0.find((d) => d.kind === 'platform')!.tile)).toBe('10,8');
    expect(key(r0.find((d) => d.kind === 'street')!.tile)).toBe('10,7');
  });

  it('gives the small Farm Halt the default doors: both on its one tile', () => {
    const small = stationDef('farm');
    for (const rot of [0, 1, 2, 3]) {
      const doors = doorsOf(small, 10, 7, rot);
      expect(
        doors.map((d) => key(d.tile)),
        `r${rot}`,
      ).toEqual(['10,7', '10,7']);
      expect(
        doors.map((d) => d.kind),
        `r${rot}`,
      ).toEqual(['platform', 'street']);
    }
  });

  it('stands on one tile, or on two along y, and on the other axis turned', () => {
    const w = world();
    const small = station(w, 'farm', 10, 28);
    expect(keys(small.footprint())).toEqual(['10,28']);
    const v = world();
    const big = station(v, 'big_farm', 10, 28);
    expect(keys(big.footprint())).toEqual(['10,28', '10,29']);
    expect([big.w, big.h]).toEqual([1, 2]);
    expect(keys(stationFootprint('big_farm', 10, 28, 1))).toEqual(['10,28', '11,28']);
    expect(stationSpan(big.def, 3)).toEqual({ w: 2, h: 1 });
  });

  it('is told apart from the small one in the names a built halt carries', () => {
    const w = world();
    expect(station(w, 'farm', 10, 28).name).toMatch(/^Farm Halt/);
    expect(station(w, 'big_farm', 20, 28).name).toMatch(/^Big Farm Halt/);
  });
});

describe('the content with the two new defs', () => {
  it('passes the content check', () => {
    expect(validateContent(structuredClone(DEFAULT_CONTENT))).toEqual([]);
  });

  it('keeps the ids of every def that was there, in their order, and adds the two', () => {
    const ids = STATION_DEFS.map((d) => d.id);
    for (const id of [
      'farm',
      'lumber',
      'quarry',
      'pump',
      'town',
      'warehouse',
      'depot',
      'narrow_depot',
      'station',
    ])
      expect(ids).toContain(id);
    expect(ids).toContain('big_station');
    expect(ids).toContain('big_farm');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has a written-out plural for the Big Farm Halt, as for every harvesting station', () => {
    expect(STR.station.plural.big_farm).toBe('big farm halts');
  });

  it('has pictures for the big ones: copies of the old frames, level by level', async () => {
    const atlas = (await import('../../public/assets/structures.json')).default as {
      frames: Record<
        string,
        { x: number; y: number; w: number; h: number; ax: number; ay: number }
      >;
    };
    for (const [from, to] of [
      ['station', 'big_station'],
      ['farm', 'big_farm'],
    ])
      for (let l = 1; l <= 5; l++) {
        expect(atlas.frames[`structures/${to}_${l}`], `${to}_${l}`).toEqual(
          atlas.frames[`structures/${from}_${l}`],
        );
        // measured on the ground: the picture of the big one stands on its two tiles, the old
        // name's on the one it is drawn for until new art
        expect(groundOf(`structures/${to}_${l}`)?.footprint, `${to}_${l}`).toHaveLength(2);
        expect(groundOf(`structures/${from}_${l}`)?.footprint, `${from}_${l}`).toHaveLength(1);
      }
  });
});

describe('the footprints after the review', () => {
  const SPANS: Record<string, { w: number; h: number }> = {
    grinder: { w: 1, h: 1 },
    refinery: { w: 1, h: 1 },
    colliery: { w: 2, h: 2 },
    ironworks: { w: 2, h: 2 },
    // unchanged
    power_plant: { w: 3, h: 2 },
    substation: { w: 2, h: 2 },
    wire_mill: { w: 2, h: 2 },
    diesel_refinery: { w: 2, h: 2 },
    oil_derrick: { w: 2, h: 1 },
  };

  it('gives each works its tiles: the four that changed, and the five that did not', () => {
    for (const [id, span] of Object.entries(SPANS)) {
      expect(placeSpan(buildingDef(id)), id).toEqual(span);
      for (const rot of [0, 1, 2, 3]) {
        const cover = buildingFootprint(id, 20, 20, rot);
        expect(cover, `${id} r${rot}`).toHaveLength(span.w * span.h);
        expect(keys(cover), `${id} r${rot}`).toContain('20,20');
      }
    }
  });

  it('gives the town hall and the warehouse their two tiles, as before', () => {
    expect(placeSpan(stationDef('town'))).toEqual({ w: 2, h: 1 });
    expect(placeSpan(stationDef('warehouse'))).toEqual({ w: 2, h: 1 });
  });

  it('has each street door on a tile of the footprint', () => {
    for (const id of Object.keys(SPANS))
      for (const rot of [0, 1, 2, 3]) {
        const cover = keys(buildingFootprint(id, 20, 20, rot));
        for (const d of doorsOf(buildingDef(id), 20, 20, rot)) {
          expect(cover, `${id} r${rot}`).toContain(key(d.tile));
          expect(cover, `${id} r${rot} reach`).not.toContain(key(d.reach));
        }
      }
  });

  it('places a grinder and a refinery on one tile each', () => {
    const w = simWorld({ terrain: 'grass', size: 48 });
    w.builder.free = true;
    const g = w.builder.placeBuilding(10, 10, 'grinder')!;
    expect(g).not.toBeNull();
    expect(w.builder.buildingAt(11, 10)).toBeUndefined();
    const r = w.builder.placeBuilding(15, 10, 'refinery')!;
    expect(r).not.toBeNull();
    expect(w.builder.buildingAt(16, 10)).toBeUndefined();
    expect(w.builder.buildingAt(15, 11)).toBeUndefined();
  });
});

describe('the repeat-build cost step counts the small and the big one together', () => {
  const step = () => 1 + 2 * DEFAULT_RULES.repeatCostStep;

  for (const [small, big] of [
    ['farm', 'big_farm'],
    ['station', 'big_station'],
  ] as const) {
    it(`${small} twice, then ${big}: the third one costs the third step`, () => {
      const w = world();
      station(w, small, 10, 28);
      station(w, small, 14, 28);
      expect(w.builder.kindCount(big)).toBe(2);
      expect(w.builder.kindMul(big)).toBeCloseTo(step());
      expect(w.builder.kindMul(small)).toBeCloseTo(step());
      w.builder.free = false;
      const cost = w.builder.checkStation(20, 28, big).cost;
      const base = stationDef(big).cost;
      for (const [k, v] of Object.entries(base))
        expect(cost[k as keyof typeof cost], `${big} ${k}`).toBe(
          Math.ceil(v * step() * rules.buildCostMul),
        );
    });

    it(`${big} twice, then ${small}: the third one costs the third step`, () => {
      const w = world();
      station(w, big, 10, 28);
      station(w, big, 16, 28);
      expect(w.builder.kindCount(small)).toBe(2);
      expect(w.builder.kindMul(small)).toBeCloseTo(step());
    });

    it(`${small} and ${big} each count once towards the other`, () => {
      const w = world();
      station(w, small, 10, 28);
      station(w, big, 16, 28);
      expect(w.builder.kindCount(small)).toBe(2);
      expect(w.builder.kindCount(big)).toBe(2);
    });
  }

  it('leaves the refund as the def’s own cost, whichever of the pair is pulled down', () => {
    const w = world();
    const a = station(w, 'farm', 10, 28);
    station(w, 'big_farm', 16, 28);
    expect(w.builder.kindCount('farm')).toBe(2);
    w.builder.removeStation(a);
    expect(w.builder.kindCount('big_farm')).toBe(1);
  });
});
