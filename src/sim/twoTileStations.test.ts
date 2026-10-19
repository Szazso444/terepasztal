import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT, validateContent } from '../data/content';
import { groundOf } from '../art/buildingGround';
import { Dir } from '../engine/iso';
import { Terrain } from '../world/tiles';
import { STR } from '../strings';
import { forAll, shrinkInt } from '../testing/property';
import { simWorld, line, station, type SimWorld } from '../testing/simWorld';
import { Builder } from './build';
import { doorsOf, placeSpan } from './doors';
import { DEFAULT_RULES, rules } from './rules';
import {
  resetStationIds,
  stationDef,
  stationFootprint,
  stationGates,
  stationSpan,
  STATION_DEFS,
} from './stations';
import { STATION_REACH } from './people';
import { TOWN_RADIUS } from './towns';

// The town hall, the goods shed and the Big Station lie along x at rotation 0 and the Big Farm Halt
// along y, as their pictures do (the author's decisions of 2026-10-18, #509, and 2026-10-19, F7):
// the span of each shipped def that takes two tiles. The Station and the Farm Halt take one.
const SPANS = {
  town: { w: 2, h: 1 },
  warehouse: { w: 2, h: 1 },
  big_station: { w: 2, h: 1 },
  big_farm: { w: 1, h: 2 },
} as const;
const WIDE = Object.keys(SPANS) as (keyof typeof SPANS)[];

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  resetStationIds(1);
});

const quarter = (rot: number) => ((rot % 4) + 4) % 4;
const key = (t: { x: number; y: number }) => `${t.x},${t.y}`;
const keys = (ts: { x: number; y: number }[]) => ts.map(key).sort();

/** The tiles a footprint is served from, worked out here: beside a tile of it, outside it. */
function sides(cover: { x: number; y: number }[]) {
  const inside = new Set(cover.map(key));
  const out = new Set<string>();
  for (const c of cover)
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const g = { x: c.x + dx, y: c.y + dy };
      if (!inside.has(key(g))) out.add(key(g));
    }
  return [...out].sort();
}

/**
 * Free-building world: flat grass with a row of track along y = 27 and one along y = 30, so a pair
 * with its corner on row 28 (a 2 x 1 one or a 1 x 2 one) has track beside it, and one on row 29
 * too.
 */
function world(): SimWorld {
  const w = simWorld({ terrain: 'grass', size: 64 });
  w.builder.free = true;
  line(w, 2, 27, 50);
  line(w, 2, 30, 50);
  return w;
}

describe('the shipped town hall, goods shed, Big Station and Big Farm Halt', () => {
  it('span the tiles their pictures lie along: x for the hall, the shed and the Big Station, y for the Big Farm Halt', () => {
    for (const id of WIDE) {
      const def = stationDef(id);
      expect(def.span, id).toEqual(SPANS[id]);
      expect(placeSpan(def), id).toEqual(SPANS[id]);
      // the footprint follows the picture's long axis, measured on its ground data at rotation 0:
      // the near-right edge of the foot lies along x, the near-left one along y
      const foot = groundOf(`structures/${def.art}_1`)!.foot;
      const [n, e, s] = foot;
      const alongX = Math.hypot(e[0] - n[0], e[1] - n[1]);
      const alongY = Math.hypot(s[0] - e[0], s[1] - e[1]);
      expect(alongX > alongY, `${id}: the picture's long axis is x`).toBe(
        SPANS[id].w > SPANS[id].h,
      );
    }
  });

  it('keep every other station on one tile or its size', () => {
    for (const def of STATION_DEFS)
      if (!WIDE.includes(def.id as (typeof WIDE)[number])) expect(def.span, def.id).toBeUndefined();
  });

  it('pass the content check with the doors they ship', () => {
    expect(validateContent(structuredClone(DEFAULT_CONTENT))).toEqual([]);
  });
});

describe('a station that spans two tiles', () => {
  it('reads its span from the def, first, and turns it on the odd rotations', () => {
    for (const id of WIDE) {
      const def = stationDef(id);
      expect(placeSpan(def)).toEqual(SPANS[id]);
      // before `long` and `size`
      expect(placeSpan({ ...def, long: true, size: 3 })).toEqual(SPANS[id]);
      for (let rot = -4; rot < 8; rot++) {
        const odd = Math.abs(rot) % 2 === 1;
        const { w, h } = SPANS[id];
        expect(stationSpan(def, rot), `${id} r${rot}`).toEqual(odd ? { w: h, h: w } : { w, h });
      }
    }
  });

  it('covers two adjacent tiles at any corner and any turn, the same at rot + 2', () => {
    forAll(
      (rng) => ({
        x: rng.int(-40, 40),
        y: rng.int(-40, 40),
        rot: rng.int(-9, 12),
        id: rng.pick(WIDE),
      }),
      ({ x, y, rot, id }) => {
        const label = `${id} at ${x},${y} turned ${rot}`;
        const cover = stationFootprint(id, x, y, rot);
        expect(cover, label).toHaveLength(2);
        expect(new Set(keys(cover)).size, label).toBe(2);
        expect(Math.abs(cover[0].x - cover[1].x) + Math.abs(cover[0].y - cover[1].y), label).toBe(
          1,
        );
        // the corner is a tile of it, and the turn picks the axis
        expect(keys(cover), label).toContain(key({ x, y }));
        const along = quarter(rot) % 2 === 0 ? SPANS[id].w === 2 : SPANS[id].h === 2;
        expect(cover[0].y === cover[1].y, label).toBe(along);
        expect(keys(stationFootprint(id, x, y, rot + 2)), label).toEqual(keys(cover));
        expect(keys(stationFootprint(id, x, y, rot + 4)), label).toEqual(keys(cover));
        // served from every side of the pair, and from nowhere inside it
        const gates = stationGates(id, x, y, rot);
        expect(keys(gates), label).toEqual(sides(cover));
        expect(gates, label).toHaveLength(6);
        for (const g of gates) expect(keys(cover), label).not.toContain(key(g));
      },
      {
        shrink: (c) => [
          ...[...shrinkInt(c.rot)].map((rot) => ({ ...c, rot })),
          ...[...shrinkInt(c.x)].map((x) => ({ ...c, x })),
          ...[...shrinkInt(c.y)].map((y) => ({ ...c, y })),
        ],
      },
    );
  });

  it('leaves a depot its shed gates: one at each end of every track through it', () => {
    for (const rot of [0, 1, 2, 3]) {
      const axisX = rot % 2 === 0;
      // the narrow depot: 2 x 1, one track, a gate at each end
      const narrow = stationGates('narrow_depot', 10, 10, rot);
      expect(keys(narrow), `narrow r${rot}`).toEqual(
        keys(
          axisX
            ? [
                { x: 9, y: 10 },
                { x: 12, y: 10 },
              ]
            : [
                { x: 10, y: 9 },
                { x: 10, y: 12 },
              ],
        ),
      );
      // the depot: 2 x 2, two tracks, two gates at each end
      const wide = stationGates('depot', 10, 10, rot);
      expect(keys(wide), `depot r${rot}`).toEqual(
        keys(
          axisX
            ? [
                { x: 9, y: 10 },
                { x: 9, y: 11 },
                { x: 12, y: 10 },
                { x: 12, y: 11 },
              ]
            : [
                { x: 10, y: 9 },
                { x: 11, y: 9 },
                { x: 10, y: 12 },
                { x: 11, y: 12 },
              ],
        ),
      );
    }
  });

  it('is no shed even with the flags of one, unless it is a depot', () => {
    const def = stationDef('warehouse');
    const was = { long: def.long, depot: def.depot };
    try {
      def.long = true;
      // `long` alone no longer makes a shed: a span is read first, and the gates are the sides
      expect(stationGates('warehouse', 10, 10, 0)).toHaveLength(6);
      def.depot = true;
      expect(stationGates('warehouse', 10, 10, 0)).toHaveLength(2);
    } finally {
      def.long = was.long;
      def.depot = was.depot;
    }
  });
});

describe('the content check of a span', () => {
  it('passes the shipped defs and any span of one or two tiles', () => {
    const of = (span: unknown) => {
      const b = structuredClone(DEFAULT_CONTENT);
      const def = b.stations.defs[0] as unknown as Record<string, unknown>;
      // the doors of the shipped def are for its own footprint
      delete def.doors;
      def.span = span;
      return validateContent(b);
    };
    expect(of(undefined)).toEqual([]);
    for (const span of [
      { w: 1, h: 1 },
      { w: 2, h: 1 },
      { w: 1, h: 2 },
      { w: 2, h: 2 },
      { w: 3, h: 2 },
      { w: 3, h: 3 },
    ])
      expect(of(span), JSON.stringify(span)).toEqual([]);
    for (const span of [
      { w: 4, h: 1 },
      { w: 1, h: 4 },
      { w: 1.5, h: 1 },
      { w: 0, h: 1 },
      { w: -1, h: 2 },
      { w: 2 },
      { w: '2', h: 1 },
      [2, 1],
      'wide',
      null,
      7,
    ])
      expect(
        of(span).filter((p) => p.includes('span')),
        JSON.stringify(span),
      ).not.toEqual([]);
  });
});

describe('placing a station of two tiles', () => {
  it('stands on both tiles at rotation 0 and on the other axis turned', () => {
    for (const id of WIDE) {
      const w = world();
      const flat = SPANS[id].w === 2;
      const s = station(w, id, 10, 28);
      expect(keys(s.footprint()), id).toEqual(
        keys(
          flat
            ? [
                { x: 10, y: 28 },
                { x: 11, y: 28 },
              ]
            : [
                { x: 10, y: 28 },
                { x: 10, y: 29 },
              ],
        ),
      );
      expect([s.w, s.h], id).toEqual(flat ? [2, 1] : [1, 2]);
      for (const t of s.footprint()) expect(w.builder.stationAt(t.x, t.y), id).toBe(s);
      const v = world();
      const turned = station(v, id, 10, 28, 1);
      expect([turned.w, turned.h], `${id} turned`).toEqual(flat ? [1, 2] : [2, 1]);
      for (const t of turned.footprint()) expect(v.builder.stationAt(t.x, t.y), id).toBe(turned);
      // a half turn more covers the same tiles
      const back = v.builder.checkStation(10, 28, id, 3);
      expect(back.ok, id).toBe(false);
      expect(back.reason).toBe(STR.build.occupied);
    }
  });

  it('is refused when either of its tiles is blocked, and says why', () => {
    const blockers: [string, (w: SimWorld, x: number, y: number) => void, string][] = [
      ['a station', (w, x, y) => void station(w, 'lumber', x, y), STR.build.occupied],
      ['a house', (w, x, y) => void w.builder.spawnDecor(x, y, 'townhouse', 0), STR.build.occupied],
      ['a works', (w, x, y) => void w.builder.placeBuilding(x, y, 'windmill'), STR.build.occupied],
      ['a track', (w, x, y) => line(w, x, y, x), STR.build.occupied],
      ['a road', (w, x, y) => void w.builder.placeRoad(x, y), STR.build.roadInWay],
      ['water', (w, x, y) => void (w.map.terrain[y * w.map.w + x] = Terrain.Water), ''],
    ];
    for (const id of WIDE)
      for (const rot of [0, 1])
        for (const [what, block, reason] of blockers)
          for (const second of [false, true]) {
            const w = world();
            const free = w.builder.checkStation(10, 28, id, rot);
            expect(free.ok, `${id} r${rot} free: ${free.reason}`).toBe(true);
            const tiles = stationFootprint(id, 10, 28, rot);
            const at = tiles[second ? 1 : 0];
            block(w, at.x, at.y);
            const c = w.builder.checkStation(10, 28, id, rot);
            const label = `${id} r${rot} with ${what} on its ${second ? 'second' : 'first'} tile`;
            expect(c.ok, label).toBe(false);
            if (reason) expect(c.reason, label).toBe(reason);
            expect(w.builder.placeStation(10, 28, id, rot), label).toBeNull();
            expect(
              w.builder.stations.filter((s) => s.def.id === id),
              label,
            ).toHaveLength(0);
          }
  });

  it('is refused at the map edge, when its second tile falls off', () => {
    for (const id of WIDE) {
      const w = world();
      const [x, y] = [63, 29];
      // a corner on the last column: the pair lies along x or y, and one of the turns falls off
      const off = (rot: number) => stationFootprint(id, x, y, rot).some((t) => t.x >= w.map.w);
      expect([0, 1].filter(off), id).toHaveLength(1);
      for (const rot of [0, 1])
        expect(
          w.builder.checkStation(x, y, id, rot).reason === STR.build.offMap,
          `${id} r${rot}`,
        ).toBe(off(rot));
    }
  });

  it('needs track beside either tile, and none beside both is refused', () => {
    for (const id of WIDE)
      for (const rot of [0, 1, 2, 3]) {
        const w = simWorld({ terrain: 'grass', size: 64 });
        w.builder.free = true;
        const cover = stationFootprint(id, 20, 20, rot);
        expect(w.builder.checkStation(20, 20, id, rot).reason, `${id} r${rot} bare`).toBe(
          STR.build.needTrack,
        );
        // a single track tile beside each tile of the pair in turn, never beside the other
        for (const [i, tile] of cover.entries()) {
          const other = cover[1 - i];
          const near = sides([tile]).filter((k) => !sides([other]).includes(k) && k !== key(other));
          expect(near.length, `${id} r${rot} tile ${i}`).toBeGreaterThan(0);
          const [nx, ny] = near[0].split(',').map(Number);
          const v = simWorld({ terrain: 'grass', size: 64 });
          v.builder.free = true;
          line(v, nx, ny, nx);
          const c = v.builder.checkStation(20, 20, id, rot);
          expect(c.ok, `${id} r${rot} track beside tile ${i}: ${c.reason}`).toBe(true);
          const s = v.builder.placeStation(20, 20, id, rot)!;
          expect(s, `${id} r${rot} track beside tile ${i}`).not.toBeNull();
          // served by that track, from the right tile
          expect(v.builder.isOrphaned(s)).toBe(false);
          expect(keys(v.builder.platformTiles(s))).toEqual([near[0]]);
          expect(v.builder.stationForTrackTile(nx, ny)).toBe(s);
        }
      }
  });

  it('asks the corner alone as before for a track piece (the old call)', () => {
    const w = world();
    expect(w.builder.hasAdjacentTrack(10, 29)).toBe(true);
    expect(w.builder.hasAdjacentTrack(10, 22)).toBe(false);
    // asked of a footprint: a pair whose only neighbour touches its second tile
    expect(w.builder.hasAdjacentTrack(9, 28, 'town', 0)).toBe(true);
    expect(w.builder.hasAdjacentTrack(9, 20, 'town', 0)).toBe(false);
  });
});

describe('taking a station of two tiles away', () => {
  it('frees both tiles for something else, and refunds it once', () => {
    for (const id of WIDE) {
      const w = world();
      const s = station(w, id, 10, 28);
      const tiles = s.footprint();
      expect(w.builder.removeStation(s), id).toBe(true);
      expect(w.builder.stations, id).toHaveLength(0);
      for (const t of tiles) {
        expect(w.builder.stationAt(t.x, t.y), `${id} ${key(t)}`).toBeUndefined();
        expect(w.builder.canPlaceDecor(t.x, t.y, 'townhouse'), `${id} ${key(t)}`).toBeNull();
      }
      // and the pair can stand there again, either way round
      expect(w.builder.checkStation(10, 28, id, 0).ok, id).toBe(true);
      expect(w.builder.checkStation(10, 28, id, 1).ok, id).toBe(true);
      expect(w.builder.removeStation(s), `${id} twice`).toBe(false);
    }
  });

  it('is found from either tile, so a bulldozer on the second removes the whole', () => {
    const w = world();
    const s = station(w, 'warehouse', 10, 28);
    const second = s.footprint()[1];
    expect(w.builder.stationAt(second.x, second.y)).toBe(s);
    expect(w.builder.removeStation(w.builder.stationAt(second.x, second.y)!)).toBe(true);
    expect(w.builder.stationAt(10, 28)).toBeUndefined();
    expect(w.builder.stationAt(second.x, second.y)).toBeUndefined();
  });
});

describe('the doors of a station of two tiles', () => {
  it('are on its footprint, face out of it, and the platform one faces the front', () => {
    const FRONT = [Dir.S, Dir.W, Dir.N, Dir.E];
    const opposite = (d: Dir) => (d + 2) % 4;
    for (const id of WIDE)
      for (const rot of [0, 1, 2, 3]) {
        // the doors the def ships with, rewritten for its footprint
        const def = stationDef(id);
        const cover = stationFootprint(id, 10, 7, rot);
        const inside = new Set(keys(cover));
        const gates = new Set(keys(stationGates(id, 10, 7, rot)));
        const doors = doorsOf(def, 10, 7, rot);
        const platform = doors.find((d) => d.kind === 'platform')!;
        const street = doors.find((d) => d.kind === 'street')!;
        const label = `${id} r${rot}`;
        for (const d of doors) {
          expect(inside.has(key(d.tile)), `${label} ${d.kind} tile`).toBe(true);
          // the tile outside it is one track or a road may reach: a gate of the station
          expect(inside.has(key(d.reach)), `${label} ${d.kind} reach`).toBe(false);
          expect(gates.has(key(d.reach)), `${label} ${d.kind} reach is a gate`).toBe(true);
        }
        expect(platform.side, label).toBe(FRONT[rot]);
        expect(street.side, label).toBe(opposite(platform.side));
        // two rows deep (the Big Farm Halt, turned or not) it has the platform door on its front row
        // and the street door on its back row; one row deep (the hall, the shed) both are on it
        if (id === 'big_farm') expect(key(platform.tile), label).not.toBe(key(street.tile));
        else expect(key(platform.tile), label).toBe(key(street.tile));
      }
  });
});

describe('a town hall of two tiles', () => {
  /** A hall at (20, 29) rot 0 on the track of y = 30, so it covers (20, 29) and (21, 29). */
  function hall() {
    const w = world();
    const s = station(w, 'town', 20, 29);
    w.towns.refresh();
    return { w, s, t: w.towns.byStation(s.id)! };
  }

  it('reaches TOWN_RADIUS from the nearest tile of its footprint, on every side', () => {
    const { w, s, t } = hall();
    expect(keys(s.footprint())).toEqual(['20,29', '21,29']);
    // a tile at the radius from either tile of the pair is in; one more is out
    for (const [x, y] of [
      [20 - TOWN_RADIUS, 29],
      [21 + TOWN_RADIUS, 29],
      [20, 29 - TOWN_RADIUS],
      [21, 29 + TOWN_RADIUS],
      [21 + TOWN_RADIUS, 29 + TOWN_RADIUS],
      [20 - TOWN_RADIUS, 29 - TOWN_RADIUS],
    ])
      expect(w.towns.townAt(x, y)?.id, `${x},${y}`).toBe(t.id);
    for (const [x, y] of [
      [20 - TOWN_RADIUS - 1, 29],
      [21 + TOWN_RADIUS + 1, 29],
      [20, 29 - TOWN_RADIUS - 1],
      [21, 29 + TOWN_RADIUS + 1],
    ])
      expect(w.towns.townAt(x, y), `${x},${y}`).toBeNull();
  });

  it('counts a house at the far end of its reach among its members', () => {
    const { w, t } = hall();
    // 7 beyond the second tile: 8 from the corner, so out of reach of it, in reach of the pair
    const far = 21 + TOWN_RADIUS;
    expect(w.builder.spawnDecor(far, 25, 'townhouse', 0)).not.toBeNull();
    expect(w.builder.spawnDecor(20 - TOWN_RADIUS - 1, 25, 'townhouse', 0)).not.toBeNull();
    const m = w.towns.members(t);
    expect(m.decor.map((d) => d.x)).toEqual([far]);
    expect(m.houses).toBe(1);
  });

  it('keeps a new town hall TOWN_SPACING from its footprint, not its corner', () => {
    const { w } = hall();
    // 24 beyond the second tile, 25 from the corner: far enough from the corner, too close to the pair
    const x = 21 + Builder.TOWN_SPACING - 1;
    expect(w.builder.checkStation(x, 29, 'town', 0)).toMatchObject({
      ok: false,
      reason: STR.build.townTooClose(Builder.TOWN_SPACING),
    });
    expect(w.builder.checkStation(x + 1, 29, 'town', 0).reason).not.toBe(
      STR.build.townTooClose(Builder.TOWN_SPACING),
    );
  });

  it('keeps the same gap to a hall on every side of it, turned either way', () => {
    // room all round the hall, and no track in the way of the new one
    const w = simWorld({ terrain: 'grass', size: 100 });
    w.builder.free = true;
    line(w, 30, 44, 50);
    station(w, 'town', 40, 45);
    const tooClose = STR.build.townTooClose(Builder.TOWN_SPACING);
    const reason = (x: number, y: number, rot: number) =>
      w.builder.checkStation(x, y, 'town', rot).reason;
    // the tile gap between the footprints: the new hall's far edge and the hall's near one
    for (const rot of [0, 1]) {
      const { w: nw, h: nh } = stationSpan(stationDef('town'), rot);
      const gaps = {
        east: (x: number) => x - 41,
        west: (x: number) => 40 - (x + nw - 1),
        south: (y: number) => y - 45,
        north: (y: number) => 45 - (y + nh - 1),
      };
      const at = {
        east: (g: number) => [41 + g, 45],
        west: (g: number) => [40 - g - nw + 1, 45],
        south: (g: number) => [40, 45 + g],
        north: (g: number) => [40, 45 - g - nh + 1],
      } as const;
      for (const side of Object.keys(at) as (keyof typeof at)[]) {
        const [x, y] = at[side](Builder.TOWN_SPACING);
        expect(reason(x, y, rot), `${side} r${rot} at the spacing`).not.toBe(tooClose);
        const [cx, cy] = at[side](Builder.TOWN_SPACING - 1);
        expect(reason(cx, cy, rot), `${side} r${rot} one short`).toBe(tooClose);
        expect(gaps[side](side === 'east' || side === 'west' ? cx : cy)).toBe(
          Builder.TOWN_SPACING - 1,
        );
      }
    }
  });

  it('answers as it did for a hall of one tile', () => {
    const w = world();
    const shipped = stationDef('town').span;
    stationDef('town').span = { w: 1, h: 1 };
    try {
      const s = station(w, 'town', 20, 29);
      w.towns.refresh();
      const t = w.towns.byStation(s.id)!;
      for (let dy = -10; dy <= 10; dy++)
        for (let dx = -10; dx <= 10; dx++) {
          const want = Math.max(Math.abs(dx), Math.abs(dy)) <= TOWN_RADIUS;
          expect(w.towns.townAt(20 + dx, 29 + dy)?.id === t.id, `${dx},${dy}`).toBe(want);
        }
    } finally {
      stationDef('town').span = shipped;
    }
  });

  it('keeps houses off its second tile', () => {
    const { w, s } = hall();
    for (const t of s.footprint()) {
      expect(w.builder.canPlaceDecor(t.x, t.y, 'townhouse'), key(t)).toBe(STR.build.occupied);
      expect(w.builder.spawnDecor(t.x, t.y, 'townhouse', 0), key(t)).toBeNull();
      expect(w.builder.placeDecor(t.x, t.y, 'townhouse', 0), key(t)).toBeNull();
    }
    // the tiles beside the pair are free for them
    for (const t of [
      { x: 22, y: 29 },
      { x: 19, y: 29 },
      { x: 20, y: 28 },
      { x: 21, y: 28 },
    ])
      expect(w.builder.canPlaceDecor(t.x, t.y, 'townhouse'), key(t)).toBeNull();
    // and the registry, counting a house in reach, never counts one that is not there
    w.houses.finishAll();
    expect(w.towns.members(w.towns.towns[0]).houses).toBe(0);
  });
});

describe('the stations of a town, a pair of tiles each', () => {
  /** A hall at (20, 29), covering (20, 29) and (21, 29), with a house in reach. */
  function hallWithHouse() {
    const w = world();
    const hall = station(w, 'town', 20, 29);
    expect(w.builder.spawnDecor(20, 25, 'townhouse', 0)).not.toBeNull();
    w.towns.refresh();
    return { w, hall, t: w.towns.byStation(hall.id)! };
  }

  it('counts a shed whose far tile is in reach, though its corner is not', () => {
    const { w, hall, t } = hallWithHouse();
    // corner 8 from the hall's footprint, second tile 7
    const shed = station(w, 'warehouse', 12, 29);
    expect(hall.distTo(shed.x, shed.y), 'the corner').toBe(8);
    expect(hall.distTo(shed.x + 1, shed.y), 'the far tile').toBe(7);
    expect(w.towns.members(t).stations).toContain(shed);
    expect(w.towns.townOfStation(shed)?.id).toBe(t.id);
    expect(w.towns.members(t).warehouses).toBe(1);
    expect(w.towns.founded(t)).toBe(true);
  });

  it('leaves out a shed with both tiles out of reach', () => {
    const { w, hall, t } = hallWithHouse();
    const shed = station(w, 'warehouse', 11, 29);
    expect(hall.distTo(shed.x + 1, shed.y), 'the far tile').toBe(8);
    expect(w.towns.members(t).stations).not.toContain(shed);
    expect(w.towns.townOfStation(shed)).toBeNull();
    expect(w.towns.members(t).warehouses).toBe(0);
    expect(w.towns.founded(t)).toBe(false);
  });

  it('counts a halt along y by its nearer tile, and leaves it out when neither is in reach', () => {
    const { w, hall, t } = hallWithHouse();
    line(w, 15, 20, 26);
    line(w, 15, 17, 26);
    // above the hall: its lower tile, on row 22, is 7 rows from the hall's row, its corner 8
    const near = station(w, 'big_farm', 20, 21);
    expect(near.footprint().map((c) => c.y)).toEqual([21, 22]);
    expect(hall.distTo(near.x, near.y), 'its corner').toBe(8);
    expect(hall.distTo(near.x, near.y + 1), 'its lower tile').toBe(7);
    // and three rows up: 10 and 11 rows
    const far = station(w, 'big_farm', 20, 18);
    expect(hall.distTo(far.x, far.y + 1)).toBe(10);
    const m = w.towns.members(t);
    expect(m.stations).toContain(near);
    expect(m.stations).not.toContain(far);
    expect(w.towns.townOfStation(near)?.id).toBe(t.id);
    expect(w.towns.townOfStation(far)).toBeNull();
  });

  it('names a station of a founded town after it by the same count', () => {
    const { w, t } = hallWithHouse();
    const shed = station(w, 'warehouse', 12, 29);
    w.towns.refresh();
    expect(shed.name).toBe(`${t.name} ${shed.def.name}`);
  });
});

describe('newcomers for a station of two tiles', () => {
  /** A hall at (20, 29) with one finished house in reach, and room in it. */
  function hallWithRoomyHouse() {
    const w = world();
    station(w, 'town', 20, 29);
    expect(w.builder.spawnDecor(20, 25, 'townhouse', 0)).not.toBeNull();
    w.towns.refresh();
    w.houses.finishAll();
    const home = w.houses.at(20, 25)!;
    expect(home.residents).toBeLessThan(w.houses.capacity(home));
    line(w, 15, 20, 26);
    return { w, home };
  }

  it('come to the town when its far tile is in reach, though its corner is not', () => {
    const { w, home } = hallWithRoomyHouse();
    const before = home.residents;
    // the corner is 8 rows from the hall, the lower tile 7
    const halt = w.builder.placeStation(20, 21, 'big_farm');
    expect(halt?.footprint().map((c) => c.y)).toEqual([21, 22]);
    expect(home.residents).toBeGreaterThan(before);
  });

  it('do not come when neither tile is in reach', () => {
    const { w, home } = hallWithRoomyHouse();
    const before = home.residents;
    expect(w.builder.placeStation(20, 18, 'big_farm')).not.toBeNull();
    expect(home.residents).toBe(before);
  });

  it('come for a works too, by the nearest tile of its footprint', () => {
    const { w, home } = hallWithRoomyHouse();
    const before = home.residents;
    // a 2 x 2 Battery on the hall's rows: its corner 8 columns from the hall, its far tile 7
    expect(w.builder.placeBuilding(12, 28, 'substation', 0)).not.toBeNull();
    expect(home.residents).toBeGreaterThan(before);
  });
});

describe('the walkers of a station of two tiles', () => {
  const DT = 1;
  const POPULATION = 12;
  const MIDDAY = 0.5;

  it('step off a train onto the platform nearest the platform door, and walk to that door', () => {
    // a halt at (20, 28) covering (20, 28) and (20, 29): its platform door is on the second tile,
    // facing the line along y = 30; the line along y = 27 runs behind the first tile, and one more
    // track tile stands beside the first tile. The first of its platform tiles is not the one
    // its door faces.
    const w = world();
    line(w, 15, 28, 19);
    const halt = station(w, 'big_farm', 20, 28);
    const door = doorsOf(halt.def, halt.x, halt.y, halt.rot).find((d) => d.kind === 'platform')!;
    expect(key(door.tile)).toBe('20,29');
    const platforms = w.builder.platformTiles(halt);
    expect(platforms.length).toBeGreaterThan(2);
    expect(key(platforms[0]), 'the first platform tile').not.toBe(key(door.reach));
    expect(keys(platforms)).toContain(key(door.reach));

    w.people.alight(halt, 3);
    const off = w.people.persons.filter((p) => p.transient);
    expect(off).toHaveLength(3);
    for (const p of off) {
      expect(key(p.path[0]), 'alighting: starts on the platform at the door').toBe(key(door.reach));
      expect(key(p.path.at(-1)!), 'alighting: ends at the door').toBe(key(door.tile));
    }
    w.people.persons.length = 0;
    w.people.board(halt, 3);
    const on = w.people.persons.filter((p) => p.transient);
    expect(on).toHaveLength(3);
    for (const p of on) {
      expect(key(p.path[0]), 'boarding: starts at the door').toBe(key(door.tile));
      expect(key(p.path.at(-1)!), 'boarding: ends on the platform at the door').toBe(
        key(door.reach),
      );
    }
  });

  it('use the one platform tile there is, beside either tile, and start at the door tile', () => {
    for (const id of WIDE)
      for (const rot of [0, 1, 2, 3]) {
        const w = simWorld({ terrain: 'grass', size: 64 });
        w.builder.free = true;
        const cover = stationFootprint(id, 20, 20, rot);
        const outside = sides(cover);
        // a lone piece of track beside each tile of the pair in turn
        for (const [i, tile] of cover.entries()) {
          const other = cover[1 - i];
          const near = outside.filter(
            (k) => !sides([other]).includes(k) && sides([tile]).includes(k) && k !== key(other),
          );
          const v = simWorld({ terrain: 'grass', size: 64 });
          v.builder.free = true;
          const [nx, ny] = near[0].split(',').map(Number);
          line(v, nx, ny, nx);
          const s = station(v, id, 20, 20, rot);
          const door = doorsOf(s.def, s.x, s.y, s.rot).find((d) => d.kind === 'platform')!;
          const label = `${id} r${rot} track beside tile ${i}`;
          v.people.alight(s, 1);
          const p = v.people.persons.find((q) => q.transient)!;
          expect(key(p.path[0]), label).toBe(near[0]);
          expect(key(p.path.at(-1)!), label).toBe(key(door.tile));
          expect(keys(s.footprint()), label).toContain(key(door.tile));
        }
        expect(w.people.persons).toHaveLength(0);
      }
  });

  it('never gather on the tiles under their own halt', () => {
    const w = world();
    const halt = station(w, 'big_farm', 20, 28);
    const under = new Set(keys(halt.footprint()));
    let gathered = 0;
    for (let i = 0; i < 2500; i++) {
      w.people.tick(DT, POPULATION, MIDDAY);
      for (const p of w.people.persons)
        if (p.state === 'gather' && p.path.length) {
          gathered++;
          expect(under.has(key(p.path.at(-1)!)), `tick ${i}: walker ${p.id} gathers under it`).toBe(
            false,
          );
        }
    }
    expect(gathered, 'ticks spent on the way to gather').toBeGreaterThan(0);
  });

  it('set out for a passenger station by the distance to its nearest tile, not its corner', () => {
    // no shipped passenger station covers two tiles yet, so this one gets a span for the test
    const def = stationDef('station');
    def.span = { w: 2, h: 1 };
    try {
      /** The ticks it takes someone from a house `gap` tiles past the far tile to set out for it. */
      const setOut = (gap: number) => {
        const w = world();
        const stop = station(w, 'station', 20, 29);
        expect(keys(stop.footprint())).toEqual(['20,29', '21,29']);
        const home = { x: 21 + gap, y: 29 };
        expect(w.builder.spawnDecor(home.x, home.y, 'townhouse', 0)).not.toBeNull();
        for (let i = 0; i < 6000; i++) {
          w.people.tick(DT, POPULATION, MIDDAY);
          if (
            w.people.persons.some(
              (p) => p.home === `d${home.x},${home.y}` && p.stationId === stop.id,
            )
          )
            return i;
        }
        return null;
      };
      // the corner is one further than the far tile: the walk is 15 from it and 14 from the tile
      expect(setOut(STATION_REACH), 'a house in reach of the far tile').not.toBeNull();
      expect(setOut(STATION_REACH + 1), 'a house just out of reach of it').toBeNull();
    } finally {
      delete def.span;
    }
  });
});
