import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT, validateContent } from '../data/content';
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
} from './stations';
import { TOWN_RADIUS } from './towns';

// No shipped def has a span yet (the data flips later), so these tests give three of them one for
// the length of this file: the town hall and the goods shed lie along x, the farm halt along y,
// as the data will have them. Each test file has its own copy of the content.
const SPANS = { town: { w: 2, h: 1 }, warehouse: { w: 2, h: 1 }, farm: { w: 1, h: 2 } } as const;
const WIDE = Object.keys(SPANS) as (keyof typeof SPANS)[];

beforeAll(() => {
  for (const id of WIDE) stationDef(id).span = { ...SPANS[id] };
});
afterAll(() => {
  for (const id of WIDE) delete stationDef(id).span;
});
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
      // the doors of the shipped def are for its one tile (the data flip gives it its own)
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
        // the doors of its kind: the data flip gives the three their own, now one tile's
        const def = { ...stationDef(id), doors: undefined };
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
        // two rows deep (the farm halt, turned or not) it has the platform door on its front row
        // and the street door on its back row; one row deep (the hall, the shed) both are on it
        if (id === 'farm') expect(key(platform.tile), label).not.toBe(key(street.tile));
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

  it('answers as it did for a hall of one tile', () => {
    const w = world();
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
      stationDef('town').span = { ...SPANS.town };
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
