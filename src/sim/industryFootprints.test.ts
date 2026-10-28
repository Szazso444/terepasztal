import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT, validateContent } from '../data/content';
import { content } from '../data/content';
import { DIRS, DIR_DX, DIR_DY } from '../engine/iso';
import { STR } from '../strings';
import { Terrain } from '../world/tiles';
import { simWorld, type SimWorld } from '../testing/simWorld';
import { buildingDef, buildingFootprint, buildingSpan, buildingToJSON } from './buildings';
import { doorsOf, placeSpan, spanProblems } from './doors';
import { DEFAULT_RULES, rules } from './rules';
import { PowerGrid } from './power';

// Industries take the footprint the author chose (2026-10-18, F6; 2026-10-27, the 3D models at
// their real size: the grinder, the substation and the ironworks on one tile, the diesel refinery
// on 3 x 2): tiles are where it may stand, how much room it takes and where it sits in that room.
// At rotation 0 a footprint's long axis is the picture's, which is x for every one of the six (the
// foot of each r0 frame in src/art/buildingGround.json), so the author's "1 x 2", "2 x 3" are
// w 2 x h 1 and w 3 x h 2 here. A size class is named by its tiles, long side first.
interface Case {
  id: string;
  /** the footprint class: the size the author named */
  size: '1x2' | '2x2' | '2x3' | '3x2';
  /** width along x and depth along y at rotation 0 */
  w: number;
  h: number;
}
const CASES: Case[] = [
  { id: 'oil_derrick', size: '1x2', w: 2, h: 1 },
  { id: 'refinery', size: '2x2', w: 2, h: 2 },
  { id: 'wire_mill', size: '2x2', w: 2, h: 2 },
  { id: 'power_plant', size: '2x3', w: 3, h: 2 },
  { id: 'diesel_refinery', size: '3x2', w: 3, h: 2 },
  { id: 'colliery', size: '3x2', w: 3, h: 2 },
];

const ROTS = [0, 1, 2, 3];
const key = (t: { x: number; y: number }) => `${t.x},${t.y}`;
const keys = (ts: { x: number; y: number }[]) => ts.map(key).sort();

/** The corner every test stands a building on, with room all round it on a flat grass map. */
const X = 20;
const Y = 20;

/**
 * A free world of flat grass. With a case given, its corner tile also holds what the works needs
 * under it (a hill for the colliery, an oil seep for the derrick), so only the footprint is in
 * question.
 */
function world(c?: Case, x = X, y = Y): SimWorld {
  const w = simWorld({ terrain: 'grass', size: 48 });
  w.builder.free = true;
  const def = c ? buildingDef(c.id) : undefined;
  if (def?.terrain === 'hill') paint(w, x, y, Terrain.Hill);
  if (def?.deposit)
    w.map.props.set(y * w.map.w + x, [{ kind: def.deposit as 'oil', variant: 0, ox: 0, oy: 0 }]);
  return w;
}
function paint(w: SimWorld, x: number, y: number, t: Terrain) {
  w.map.terrain[y * w.map.w + x] = t;
}
/** The tiles beside a footprint, outside it. */
function ring(cover: { x: number; y: number }[]) {
  const inside = new Set(cover.map(key));
  const out = new Map<string, { x: number; y: number }>();
  for (const c of cover)
    for (const d of DIRS) {
      const t = { x: c.x + DIR_DX[d], y: c.y + DIR_DY[d] };
      if (!inside.has(key(t))) out.set(key(t), t);
    }
  return [...out.values()];
}

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
});

describe('the footprints the author chose', () => {
  it('lists the six, with the long side along x as the pictures have it', () => {
    for (const c of CASES) {
      expect(placeSpan(buildingDef(c.id)), c.id).toEqual({ w: c.w, h: c.h });
    }
    // the four classes all appear
    expect(new Set(CASES.map((c) => c.size))).toEqual(new Set(['1x2', '2x2', '2x3', '3x2']));
  });

  it('leaves every other works on its one tile', () => {
    const wide = new Set(CASES.map((c) => c.id));
    for (const d of content.buildings)
      if (!wide.has(d.id)) expect(placeSpan(d), d.id).toEqual({ w: 1, h: 1 });
  });

  it('passes the content check, and refuses spans that are not whole tiles of 1 to 3', () => {
    expect(validateContent(structuredClone(DEFAULT_CONTENT))).toEqual([]);
    const base = buildingDef('grinder');
    for (const span of [
      { w: 1, h: 1 },
      { w: 3, h: 3 },
      { w: 1, h: 3 },
      { w: 3, h: 2 },
    ])
      expect(spanProblems({ ...base, span }), JSON.stringify(span)).toEqual([]);
    for (const span of [{ w: 4, h: 1 }, { w: 0, h: 1 }, { w: 1.5, h: 1 }, { w: 2 }, 'x', 2])
      expect(spanProblems({ ...base, span } as never), JSON.stringify(span)).not.toEqual([]);
    // the tables go through the same check
    const bad = structuredClone(DEFAULT_CONTENT);
    bad.buildings.find((b) => b.id === 'grinder')!.span = { w: 4, h: 1 };
    expect(validateContent(bad).join('\n')).toMatch(/grinder.*span/);
  });

  it('keeps every street door on a tile of the footprint, facing out of it', () => {
    const bad = (id: string) => {
      const c = structuredClone(DEFAULT_CONTENT);
      return validateContent(c).filter((p) => p.includes(id));
    };
    for (const c of CASES) expect(bad(c.id), c.id).toEqual([]);
  });
});

for (const c of CASES) {
  describe(`${c.id}, a ${c.size} footprint (w ${c.w} x h ${c.h})`, () => {
    it('covers w x h tiles from its corner, swaps them turned, and is the same at rot + 2', () => {
      for (const rot of [-5, -1, ...ROTS, 5, 6]) {
        const odd = Math.abs(rot) % 2 === 1;
        const span = buildingSpan(buildingDef(c.id), rot);
        expect(span, `r${rot}`).toEqual(odd ? { w: c.h, h: c.w } : { w: c.w, h: c.h });
        const cover = buildingFootprint(c.id, X, Y, rot);
        expect(cover, `r${rot}`).toHaveLength(c.w * c.h);
        expect(new Set(keys(cover)).size, `r${rot}`).toBe(c.w * c.h);
        expect(keys(cover), `r${rot}`).toContain(key({ x: X, y: Y }));
        for (const t of cover) {
          expect(t.x, `r${rot}`).toBeGreaterThanOrEqual(X);
          expect(t.x, `r${rot}`).toBeLessThan(X + span.w);
          expect(t.y, `r${rot}`).toBeGreaterThanOrEqual(Y);
          expect(t.y, `r${rot}`).toBeLessThan(Y + span.h);
        }
        expect(keys(buildingFootprint(c.id, X, Y, rot + 2)), `r${rot} vs r${rot + 2}`).toEqual(
          keys(cover),
        );
      }
    });

    it('is placed on every tile of its footprint, at each rotation, and nowhere else', () => {
      for (const rot of ROTS) {
        const w = world(c);
        const b = w.builder.placeBuilding(X, Y, c.id, rot);
        expect(b, `r${rot}`).not.toBeNull();
        const cover = buildingFootprint(c.id, X, Y, rot);
        for (const t of cover) expect(w.builder.buildingAt(t.x, t.y), `r${rot} ${key(t)}`).toBe(b);
        for (const t of ring(cover))
          expect(w.builder.buildingAt(t.x, t.y), `r${rot} beside ${key(t)}`).toBeUndefined();
        // one works, kept at its corner: the save holds that and nothing more
        expect([...w.builder.buildings.values()]).toEqual([b]);
        expect(buildingToJSON(b!).slice(0, 3)).toEqual([X, Y, c.id]);
        expect(w.builder.kindCount(c.id), `r${rot}`).toBe(1);
      }
    });

    it('is refused when any one footprint tile is blocked, and nothing is laid or paid', () => {
      for (const rot of [0, 1]) {
        const cover = buildingFootprint(c.id, X, Y, rot);
        const blockers: [string, (w: SimWorld, t: { x: number; y: number }) => void][] = [
          ['water', (w, t) => paint(w, t.x, t.y, Terrain.Water)],
          ['rock', (w, t) => paint(w, t.x, t.y, Terrain.Rock)],
          ['mountain', (w, t) => paint(w, t.x, t.y, Terrain.Mountain)],
          ['a road', (w, t) => w.builder.roads.add(t.x, t.y)],
          ['a works', (w, t) => void w.builder.placeBuilding(t.x, t.y, 'windmill', 0)],
          ['decor', (w, t) => void w.builder.placeDecor(t.x, t.y, 'water_tower', 0)],
          [
            'track',
            (w, t) =>
              void w.builder.placeTrack(
                t.x,
                t.y,
                { kind: 'straight', cls: 'regular', cls2: 'regular' },
                1,
              ),
          ],
        ];
        for (const [what, put] of blockers)
          for (const t of cover) {
            const w = world(c);
            put(w, t);
            const before = [...w.builder.buildings.values()].length;
            const check = w.builder.checkBuilding(X, Y, c.id, rot);
            const label = `r${rot}: ${what} on ${key(t)}`;
            expect(check.ok, label).toBe(false);
            expect(check.reason, label).toBeTruthy();
            expect(w.builder.placeBuilding(X, Y, c.id, rot), label).toBeNull();
            expect([...w.builder.buildings.values()].length, label).toBe(before);
          }
        // a tile beside the footprint changes nothing
        for (const t of ring(cover)) {
          const w = world(c);
          paint(w, t.x, t.y, Terrain.Rock);
          expect(w.builder.checkBuilding(X, Y, c.id, rot).ok, `r${rot} rock beside ${key(t)}`).toBe(
            true,
          );
        }
      }
    });

    it('is refused when part of it hangs off the map, whichever the corner', () => {
      for (const rot of ROTS) {
        const { w: sw, h: sh } = buildingSpan(buildingDef(c.id), rot);
        const w = world(c);
        const n = w.map.w;
        for (const [x, y] of [
          [n - sw + 1, 10],
          [10, n - sh + 1],
          [-1, 10],
          [10, -1],
        ])
          expect(w.builder.checkBuilding(x, y, c.id, rot).ok, `r${rot} at ${x},${y}`).toBe(false);
        const flush = world(c, n - sw, n - sh);
        expect(flush.builder.checkBuilding(n - sw, n - sh, c.id, rot).ok, `r${rot} flush`).toBe(
          true,
        );
      }
    });

    it('is refused where another works already covers one of its tiles, and only that', () => {
      const w = world(c);
      expect(w.builder.placeBuilding(X, Y, c.id, 0)).not.toBeNull();
      // the same works again on any footprint tile, or on a corner that reaches into it
      for (const t of buildingFootprint(c.id, X, Y, 0)) {
        expect(w.builder.checkBuilding(t.x, t.y, c.id, 0).ok, key(t)).toBe(false);
        expect(w.builder.checkBuilding(t.x, t.y, 'windmill', 0).ok, `windmill ${key(t)}`).toBe(
          false,
        );
      }
      expect(w.builder.checkBuilding(X + c.w, Y, 'windmill', 0).ok).toBe(true);
      expect(w.builder.checkBuilding(X, Y + c.h, 'windmill', 0).ok).toBe(true);
      // a station, a signal and a road keep off it as well
      for (const t of buildingFootprint(c.id, X, Y, 0)) {
        expect(w.builder.checkStation(t.x, t.y, 'town', 0).ok, `station ${key(t)}`).toBe(false);
        expect(w.builder.checkRoad(t.x, t.y).ok, `road ${key(t)}`).toBe(false);
      }
    });

    it('comes down whole from any one of its tiles, and refunds once', () => {
      for (const rot of [0, 1, 3]) {
        const cover = buildingFootprint(c.id, X, Y, rot);
        for (const t of cover) {
          const w = world(c);
          const b = w.builder.placeBuilding(X, Y, c.id, rot)!;
          // pay and refund as in a game: not the editor
          w.builder.free = false;
          expect(b.id).toBe(c.id);
          const cost = buildingDef(c.id).cost;
          const before = Object.fromEntries(Object.keys(cost).map((k) => [k, w.stock.get(k)]));
          expect(w.builder.removeBuilding(t.x, t.y), `r${rot} from ${key(t)}`).toBe(true);
          for (const [k, v] of Object.entries(cost))
            expect(w.stock.get(k) - before[k], `${k} refunded once`).toBe(
              Math.floor(v * rules.refundRate),
            );
          for (const f of cover)
            expect(w.builder.buildingAt(f.x, f.y), `r${rot} ${key(f)} freed`).toBeUndefined();
          expect(w.builder.buildings.size).toBe(0);
          // nothing is left to take off, and a second try pays nothing
          const after = Object.fromEntries(Object.keys(cost).map((k) => [k, w.stock.get(k)]));
          expect(w.builder.removeBuilding(t.x, t.y)).toBe(false);
          expect(Object.fromEntries(Object.keys(cost).map((k) => [k, w.stock.get(k)]))).toEqual(
            after,
          );
          // the room is free to build in again
          w.builder.free = true;
          expect(w.builder.checkBuilding(X, Y, c.id, rot).ok, `r${rot} rebuilt`).toBe(true);
        }
      }
    });

    it('has its street door on the footprint and its road spur beyond it, turned with it', () => {
      for (const rot of ROTS) {
        const cover = buildingFootprint(c.id, X, Y, rot);
        const doors = doorsOf(buildingDef(c.id), X, Y, rot);
        expect(doors.length, `r${rot}`).toBeGreaterThan(0);
        for (const d of doors) {
          expect(keys(cover), `r${rot} door tile`).toContain(key(d.tile));
          expect(keys(cover), `r${rot} reach outside`).not.toContain(key(d.reach));
          expect(Math.abs(d.reach.x - d.tile.x) + Math.abs(d.reach.y - d.tile.y)).toBe(1);
        }
        // the front door is on the front row of the unturned footprint: S at r0
        if (rot === 0) expect(doors[0].tile.y).toBe(Y + c.h - 1);
        // a road already standing at the door gets its spur (connectPlace), and a placed works
        // joins it: the reach tile is on the road network after placing
        const w = world(c);
        w.builder.roads.add(doors[0].reach.x, doors[0].reach.y);
        const b = w.builder.placeBuilding(X, Y, c.id, rot);
        expect(b, `r${rot}`).not.toBeNull();
        expect(w.builder.roads.has(doors[0].reach.x, doors[0].reach.y)).toBe(true);
        for (const t of cover)
          expect(w.builder.roads.has(t.x, t.y), `r${rot} road under`).toBe(false);
      }
    });

    it('is beside water when water touches any one tile of its footprint, not only the corner', () => {
      // `needsWater` is read for any works: give this one the flag for the length of the test
      const def = buildingDef(c.id);
      const had = def.needsWater;
      def.needsWater = true;
      try {
        for (const rot of ROTS) {
          const cover = buildingFootprint(c.id, X, Y, rot);
          // none: refused with the pump-style reason
          const dry = world(c);
          expect(dry.builder.checkBuilding(X, Y, c.id, rot).reason, `r${rot} dry`).toBe(
            STR.build.needWaterside,
          );
          // water beside each tile of the ring in turn, outside the footprint
          for (const t of ring(cover)) {
            const w = world(c);
            paint(w, t.x, t.y, Terrain.Water);
            expect(w.builder.checkBuilding(X, Y, c.id, rot).ok, `r${rot} water ${key(t)}`).toBe(
              true,
            );
          }
          // water two tiles off is not beside it
          const far = world(c);
          paint(far, X + buildingSpan(def, rot).w + 1, Y, Terrain.Water);
          expect(far.builder.checkBuilding(X, Y, c.id, rot).ok, `r${rot} far`).toBe(false);
        }
      } finally {
        if (had === undefined) delete def.needsWater;
        else def.needsWater = had;
      }
    });

    it('is met by a deposit or a terrain on any one tile of its footprint', () => {
      const def = buildingDef(c.id);
      const saved = { deposit: def.deposit, terrain: def.terrain };
      def.deposit = 'coal';
      def.terrain = 'sand';
      try {
        for (const rot of [0, 1]) {
          const cover = buildingFootprint(c.id, X, Y, rot);
          const none = world(c);
          expect(none.builder.checkBuilding(X, Y, c.id, rot).ok, `r${rot} none`).toBe(false);
          for (const t of cover) {
            const w = world(c);
            w.map.props.set(t.y * w.map.w + t.x, [{ kind: 'coal', variant: 0, ox: 0, oy: 0 }]);
            // the deposit alone is not enough: the ground is grass
            expect(w.builder.checkBuilding(X, Y, c.id, rot).ok, `r${rot} coal only`).toBe(false);
            paint(w, t.x, t.y, Terrain.Sand);
            expect(
              w.builder.checkBuilding(X, Y, c.id, rot).ok,
              `r${rot} coal and sand on ${key(t)}`,
            ).toBe(true);
          }
        }
      } finally {
        if (saved.deposit === undefined) delete def.deposit;
        else def.deposit = saved.deposit;
        if (saved.terrain === undefined) delete def.terrain;
        else def.terrain = saved.terrain;
      }
    });
  });
}

describe('a works with no span keeps its one tile', () => {
  it('covers a single tile at every rotation, a bridge platform included', () => {
    const w = world();
    for (const id of ['windmill', 'kiln', 'hydro_plant', 'bridge_wood', 'bridge_stone']) {
      const def = buildingDef(id);
      expect(buildingFootprint(id, 3, 4, 1), id).toEqual([{ x: 3, y: 4 }]);
      expect(buildingSpan(def, 3), id).toEqual({ w: 1, h: 1 });
    }
    expect(w.builder.placeBuilding(3, 4, 'windmill')).not.toBeNull();
    expect(w.builder.buildingAt(3, 4)).toBeDefined();
  });
});

describe('power and the wire reach the whole footprint', () => {
  it('joins a pole two tiles from the far side of a power plant, and powers beyond the far side', () => {
    for (const rot of ROTS) {
      const w = world();
      const plant = w.builder.placeBuilding(X, Y, 'power_plant', rot)!;
      const { w: sw, h: sh } = buildingSpan(buildingDef('power_plant'), rot);
      // a pole two tiles past the far edge: four or five tiles from the corner, joined all the same
      const pole = { x: X + sw + 1, y: Y + sh - 1 };
      w.builder.placeDecor(pole.x, pole.y, 'power_line', 0);
      const grid = new PowerGrid(w.map);
      grid.rebuild(w.builder.decor.values(), w.builder.buildings.values());
      expect(grid.edges().length, `r${rot} wired`).toBe(1);
      expect(grid.edges()[0].live, `r${rot} live`).toBe(true);
      // the tile beside the far edge is powered, as one beside the corner is
      expect(grid.isPowered(X + sw, Y + sh - 1), `r${rot} far side`).toBe(true);
      expect(grid.isPowered(X - 1, Y), `r${rot} corner side`).toBe(true);
      expect(grid.isPowered(X + sw + 3, Y), `r${rot} out of reach`).toBe(false);
      expect(plant.x).toBe(X);
    }
  });

  it('lets a Battery feed wire its radius from its edge, on every side of its footprint', () => {
    for (const rot of [0, 1]) {
      const w = world();
      // a plant, and a Battery a gap of two tiles past its far side (one free tile between)
      w.builder.placeBuilding(X, Y, 'power_plant', 0);
      const battery = w.builder.placeBuilding(X + 4, Y, 'substation', rot)!;
      const { w: bw, h: bh } = buildingSpan(buildingDef('substation'), rot);
      const reach = buildingDef('substation').substation!.radius;
      // a rail along the row below the Battery's footprint, laid out well past its reach
      const row = Y + bh;
      for (let x = X + 4 - reach - 4; x <= X + 4 + bw + reach + 4; x++)
        w.catenary.set(x, row, 'catenary');
      w.catenary.rebuild(w.builder.buildings.values(), w.power);
      const sub = w.catenary.substations.find((s) => s.x === battery.x)!;
      expect([sub.w, sub.h], `r${rot}`).toEqual([bw, bh]);
      expect(sub.powered, `r${rot} powered`).toBe(true);
      // live from `reach` tiles past either edge of the footprint, dead one tile further
      const first = X + 4 - reach;
      const last = X + 4 + bw - 1 + reach;
      expect(w.catenary.isLive(first, row), `r${rot} west edge`).toBe(true);
      expect(w.catenary.isLive(last, row), `r${rot} east edge`).toBe(true);
      expect(w.catenary.isLive(first - 1, row), `r${rot} past west`).toBe(false);
      expect(w.catenary.isLive(last + 1, row), `r${rot} past east`).toBe(false);
    }
  });
});

describe('a works under upgrade reports its footprint', () => {
  it('lists the footprint for the rotation the works stands in, not its corner tile', () => {
    for (const rot of ROTS) {
      const w = world();
      const b = w.builder.placeBuilding(X, Y, 'power_plant', rot)!;
      b.work = { to: 2, left: 10, total: 10 };
      const sites = w.builder.works();
      expect(sites, `r${rot}`).toHaveLength(1);
      const span = buildingSpan(buildingDef('power_plant'), rot);
      expect([span.w, span.h], `r${rot} span`).toEqual(rot % 2 === 1 ? [2, 3] : [3, 2]);
      expect([sites[0].x, sites[0].y, sites[0].w, sites[0].h], `r${rot}`).toEqual([
        X,
        Y,
        span.w,
        span.h,
      ]);
    }
  });
});

describe('the Substation is called a Battery', () => {
  it('shows Battery in the content, keeps its id, and has no Substation left to read', () => {
    const def = buildingDef('substation');
    expect(def.name).toBe('Battery');
    expect(def.id).toBe('substation');
    expect(def.substation).toBeDefined();
    expect(def.flavor).not.toMatch(/ubstation/);
    // every player-facing string (the keys keep their names)
    const strings: string[] = [];
    JSON.stringify(STR, (_k, v) => {
      if (typeof v === 'string') strings.push(v);
      return v;
    });
    expect(strings.filter((v) => /ubstation/.test(v))).toEqual([]);
    for (const d of content.buildings) {
      expect(d.name, d.id).not.toMatch(/ubstation/);
      expect(d.flavor, d.id).not.toMatch(/ubstation/);
    }
    // the quest goal names them
    expect(STR.ages.goal.substations).toMatch(/atter/);
  });
});
