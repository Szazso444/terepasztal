import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { groundOf } from '../src/art/buildingGround';
import LIFE from '../src/art/buildingLife.json';
import { craneFrames, craneOf, potFrames, potsOf } from '../src/art/buildingLife';
import { generateStructuresAtlas } from '../src/art/structures';
import { atlasFrames, solidGap } from './building-ground.mjs';
import {
  CRANE_GROUPS,
  LIFE_FILE,
  MEASURE,
  POT_GROUPS,
  buildLife,
  loadOf,
  potAt,
  serialise,
  spikes,
} from './building-life.mjs';

/**
 * The building life data (tools/building-life.mjs writes src/art/buildingLife.json): every key a
 * frame of the atlas, every pot inside its frame and above its foot, every crane's load a part of
 * the picture that a cut takes out whole. The measurement is held to what the demo measured
 * (issue #492) on the frames it measured.
 */

/** Making the atlas takes seconds, more on a busy machine. */
const SLOW = 120_000;
const PICTURE = /^structures\/(town|townhouse|station|warehouse|lumber|farm|pump|quarry)/;

let frames;
beforeAll(() => {
  frames = atlasFrames(generateStructuresAtlas);
}, SLOW);

const keysOf = (groups) => groups.flatMap((g) => g.keys);
const number = (v) => typeof v === 'number' && Number.isFinite(v);

/** A frame's texel of a world px point: where it falls in the picture. */
const texel = (f, dx, dy) => [dx * f.resolution + f.ax, dy * f.resolution + f.ay];

/** A rectangle of the file in texels, which it must hold as whole numbers. */
function texels(f, rect) {
  const [x0, y0] = texel(f, rect[0], rect[1]);
  const [x1, y1] = texel(f, rect[2], rect[3]);
  const out = [x0, y0, x1, y1];
  for (const v of out) expect(Math.abs(v - Math.round(v)), `${f.key} ${rect}`).toBeLessThan(0.05);
  return out.map(Math.round);
}

const visible = (f, x, y) =>
  x >= 0 && y >= 0 && x < f.w && y < f.h && f.data[(y * f.w + x) * 4 + 3] > 0;

describe('the building life file', () => {
  it('is what the frames give now', async () => {
    const text = await serialise(buildLife(frames));
    expect(readFileSync(LIFE_FILE, 'utf8') === text).toBe(true);
  });

  it('is the same every time it is made', () => {
    expect(buildLife(frames)).toEqual(buildLife(frames));
  });

  it('names only frames the atlas has, each once, and every one a building frame', () => {
    for (const keys of [keysOf(POT_GROUPS), keysOf(CRANE_GROUPS)]) {
      expect(new Set(keys).size).toBe(keys.length);
      for (const key of keys) {
        expect(frames.has(key), key).toBe(true);
        expect(key, key).toMatch(PICTURE);
      }
    }
    expect([...potFrames()].sort()).toEqual([...keysOf(POT_GROUPS)].sort());
    expect([...craneFrames()].sort()).toEqual([...keysOf(CRANE_GROUPS)].sort());
  });

  it('covers every level of the families that have a chimney, and every level of the quarry', () => {
    const levels = [1, 2, 3, 4, 5];
    for (const family of ['town', 'station', 'warehouse', 'lumber', 'farm', 'pump'])
      for (const n of levels)
        expect(potsOf(`structures/${family}_${n}`), `${family}_${n}`).toBeDefined();
    for (const key of ['townhouse', 'townhouse_2', 'townhouse_3', 'townhouse_4'])
      expect(potsOf(`structures/${key}`), key).toBeDefined();
    for (const key of ['townhouse_s0', 'townhouse_s1', 'townhouse_s2'])
      expect(potsOf(`structures/${key}`), key).toBeDefined();
    for (const n of levels) expect(craneOf(`structures/quarry_${n}`), `quarry_${n}`).toBeDefined();
  });

  it('keeps the shape the reader promises', () => {
    expect(Object.keys(LIFE).sort()).toEqual(['cranes', 'pots']);
    for (const [key, list] of Object.entries(LIFE.pots)) {
      expect(list.length, key).toBeGreaterThan(0);
      for (const pot of list) {
        expect(Object.keys(pot).sort(), key).toEqual(['dx', 'dy', 'work']);
        expect(number(pot.dx) && number(pot.dy), key).toBe(true);
        expect(typeof pot.work, key).toBe('boolean');
      }
    }
    for (const [key, crane] of Object.entries(LIFE.cranes)) {
      expect(Object.keys(crane).sort(), key).toEqual(['load', 'pivot']);
      expect(crane.pivot.length === 2 && crane.pivot.every(number), key).toBe(true);
      expect(crane.load.length, key).toBeGreaterThan(0);
      for (const r of crane.load) {
        expect(r.length === 4 && r.every(number), key).toBe(true);
        expect(r[0] < r[2] && r[1] < r[3], `${key} ${r}`).toBe(true);
      }
    }
  });

  it('marks the works chimneys of the sawmill and the pumping station, and no other', () => {
    for (const [key, list] of Object.entries(LIFE.pots))
      for (const pot of list) expect(pot.work, key).toBe(/\/(lumber|pump)_/.test(key));
  });
});

describe('every pot', () => {
  it('lies inside its frame, above its foot, and on the picture', () => {
    for (const [key, list] of Object.entries(LIFE.pots)) {
      const f = frames.get(key);
      const ground = groundOf(key);
      expect(ground, `${key} has no ground data to put the pot above`).toBeDefined();
      const footTop = Math.min(...ground.foot.map((p) => p[1]));
      for (const pot of list) {
        const [x, y] = texel(f, pot.dx, pot.dy);
        expect(x >= 0 && x < f.w && y >= 0 && y < f.h, `${key} ${JSON.stringify(pot)}`).toBe(true);
        expect(pot.dy, `${key} pot is not above the foot`).toBeLessThan(footTop);
        expect(solidGap(f, x, y), `${key} pot is not on the picture`).not.toBe(Infinity);
      }
    }
  });

  it('is the top of its stack: no pot top of the stack is higher', () => {
    for (const [key, list] of Object.entries(LIFE.pots)) {
      const f = frames.get(key);
      for (const pot of list) {
        const [x, y] = texel(f, pot.dx, pot.dy);
        // the stack's own tops, within the seed's reach, are as high as the point or higher
        const tops = spikes(f).filter(
          ([sx, sy]) => Math.hypot(sx - x, sy - y) <= MEASURE.reach * f.resolution,
        );
        expect(tops.length, key).toBeGreaterThan(0);
        expect(Math.min(...tops.map((t) => t[1])), key).toBeGreaterThanOrEqual(Math.floor(y) - 1);
      }
    }
  });

  it('is what the demo measured, where it measured it, to within a world px and a half', () => {
    let measured = 0;
    for (const g of POT_GROUPS.filter((g) => g.exact))
      for (const key of g.keys)
        for (const seed of g.at) {
          const [x, y] = potAt(frames.get(key), seed);
          expect(Math.hypot(x - seed[0], y - seed[1]), key).toBeLessThanOrEqual(
            1.5 * frames.get(key).resolution,
          );
          measured++;
        }
    expect(measured).toBeGreaterThanOrEqual(15);
  });

  it('is the same on frames that share a picture', () => {
    for (const g of POT_GROUPS) {
      const [first, ...rest] = g.keys.map((k) => frames.get(k));
      for (const f of rest) {
        if (f.w !== first.w || f.h !== first.h || f.ax !== first.ax || f.ay !== first.ay) continue;
        if (!Buffer.from(f.data).equals(Buffer.from(first.data))) continue;
        expect(potsOf(f.key), f.key).toEqual(potsOf(first.key));
      }
    }
  });

  it('reads the issue as written on its frames', () => {
    // issue #492: pot tops in picture pixels, [x, y], from the frame's own top-left
    const asked = {
      'structures/town_2': [
        [54.5, 24],
        [231, 95],
      ],
      'structures/town_3': [
        [54.1, 23],
        [228, 94],
      ],
      'structures/townhouse': [[175.5, 6]],
      'structures/townhouse_3': [[175.5, 6]],
      'structures/townhouse_s0': [[121.5, 4]],
      'structures/townhouse_s2': [[142.4, 5]],
      'structures/station_2': [
        [64, 3],
        [135, 24],
        [200, 50],
      ],
      'structures/warehouse_1': [
        [37, 3],
        [138, 43],
      ],
      'structures/lumber_2': [[52.5, 4]],
      'structures/farm_2': [[192.3, 6]],
      'structures/pump_1': [[120.3, 6]],
    };
    for (const [key, list] of Object.entries(asked)) {
      const f = frames.get(key);
      const got = potsOf(key);
      expect(got.length, key).toBe(list.length);
      list.forEach(([x, y], i) => {
        expect(got[i].dx, key).toBeCloseTo((x - f.ax) / f.resolution, 1);
        expect(got[i].dy, key).toBeCloseTo((y - f.ay) / f.resolution, 1);
      });
    }
  });
});

describe('every crane', () => {
  it('has a load inside its frame that is one piece of the picture and touches the rest only at the pivot and the cart', () => {
    for (const [key, crane] of Object.entries(LIFE.cranes)) {
      const f = frames.get(key);
      const rects = crane.load.map((r) => texels(f, r));
      for (const [x0, y0, x1, y1] of rects) {
        expect(x0 >= 0 && y0 >= 0 && x1 <= f.w && y1 <= f.h, `${key} ${[x0, y0, x1, y1]}`).toBe(
          true,
        );
      }
      const inside = (x, y) =>
        rects.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);
      const top = Math.min(...rects.map((r) => r[1]));
      const bottom = Math.max(...rects.map((r) => r[3])) - 1;

      // the texels the cut takes
      const taken = [];
      for (const [x0, y0, x1, y1] of rects)
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) if (visible(f, x, y)) taken.push([x, y]);
      expect(taken.length, key).toBeGreaterThan(100);

      // no texel of the rest of the picture is next to one of them, but from above at the pivot's
      // row and from below at the crate's foot
      const where = new Set(taken.map(([x, y]) => `${x},${y}`));
      const stray = [];
      for (const [x, y] of taken)
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (inside(x + dx, y + dy) || !visible(f, x + dx, y + dy)) continue;
            const above = dy < 0 && y === top;
            const below = dy > 0 && y === bottom;
            if (!above && !below) stray.push([x, y, x + dx, y + dy]);
          }
      expect(stray.slice(0, 5), `${key} touches the rest of the body`).toEqual([]);

      // one piece: everything the cut takes is joined to the rope
      const seen = new Set();
      const todo = [taken[0]];
      while (todo.length) {
        const [x, y] = todo.pop();
        const id = `${x},${y}`;
        if (seen.has(id) || !where.has(id)) continue;
        seen.add(id);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) todo.push([x + dx, y + dy]);
      }
      expect(seen.size, `${key} is more than one piece`).toBe(taken.length);
    }
  });

  it('hangs from a pivot that lies on the top of the load', () => {
    for (const [key, crane] of Object.entries(LIFE.cranes)) {
      const [rope] = crane.load;
      expect(crane.pivot[0], key).toBeGreaterThanOrEqual(rope[0]);
      expect(crane.pivot[0], key).toBeLessThanOrEqual(rope[2]);
      expect(Math.abs(crane.pivot[1] - rope[1]), key).toBeLessThanOrEqual(MEASURE.margin);
    }
  });

  it('takes nothing of the building with it: what stays is the rest of the picture', () => {
    // the pulley above the pivot and the cart below the crate stay where they are
    for (const [key, crane] of Object.entries(LIFE.cranes)) {
      const f = frames.get(key);
      const rects = crane.load.map((r) => texels(f, r));
      const top = Math.min(...rects.map((r) => r[1]));
      const bottom = Math.max(...rects.map((r) => r[3]));
      let above = 0;
      let below = 0;
      for (let x = 0; x < f.w; x++) {
        if (visible(f, x, top - 1)) above++;
        if (visible(f, x, bottom)) below++;
      }
      expect(above, `${key} wheel`).toBeGreaterThan(0);
      expect(below, `${key} cart`).toBeGreaterThan(0);
    }
  });

  it('is the region the demo lifted out, to within a few texels, on the frame it measured', () => {
    // issue #492: quarry_2 (271 x 346), pulley at (44.5, 41), the region
    // (y 42-87, x 40-49) and (y 88-169, x 15-78), inclusive, in picture pixels
    const f = frames.get('structures/quarry_2');
    expect([f.w, f.h]).toEqual([271, 346]);
    const demo = [
      [40, 42, 50, 88],
      [15, 88, 79, 170],
    ];
    const crane = craneOf('structures/quarry_2');
    expect(crane.pivot[0]).toBeCloseTo((44.5 - f.ax) / f.resolution, 1);
    expect(crane.pivot[1]).toBeCloseTo((41 - f.ay) / f.resolution, 1);
    const mine = crane.load.map((r) => texels(f, r));
    const within = (x, y, [x0, y0, x1, y1], slack) =>
      x >= x0 - slack && x < x1 + slack && y >= y0 - slack && y < y1 + slack;
    // every texel of the cut is the demo's, or within 4 texels of it: the demo's region cuts
    // the cart's rim at its right edge, which this one leaves out
    for (const [x0, y0, x1, y1] of mine)
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++)
          if (!demo.some((r) => within(x, y, r, 4))) expect([x, y]).toEqual('inside the demo');
    // and it holds the demo's rope, hook and crate: every visible texel of the demo's region that
    // is not the cart's (from row 161 down) is in the cut
    const taken = (x, y) => mine.some((r) => within(x, y, r, 0));
    const missed = [];
    for (const r of demo)
      for (let y = r[1]; y < r[3]; y++)
        for (let x = r[0]; x < r[2]; x++) if (visible(f, x, y) && !taken(x, y)) missed.push([x, y]);
    expect(missed.filter(([, y]) => y < 161)).toEqual([]);
  });

  it('finds the rope of a crane or says it is not one', () => {
    const f = frames.get('structures/quarry_2');
    expect(() => loadOf(f, [200, 60])).toThrow(/not on the rope/);
    expect(loadOf(f, [45, 60]).rects.length).toBeGreaterThan(2);
  });
});

describe('the reader', () => {
  it('gives every frame of the file its own entry and nothing for any other', () => {
    for (const key of potFrames()) expect(potsOf(key), key).toBe(LIFE.pots[key]);
    for (const key of craneFrames()) expect(craneOf(key), key).toBe(LIFE.cranes[key]);
    for (const key of [
      'structures/town_2_r1',
      'structures/farm_2_r1',
      'props/tree_0',
      '',
      'structures/',
    ])
      expect(potsOf(key), key).toBeUndefined();
    for (const key of ['structures/quarry_2_r1', 'structures/farm_2', ''])
      expect(craneOf(key), key).toBeUndefined();
  });

  it('gives nothing for a name every object has, as a frame key never is one', () => {
    for (const key of Object.getOwnPropertyNames(Object.prototype).concat(['__proto__'])) {
      expect(potsOf(key), key).toBeUndefined();
      expect(craneOf(key), key).toBeUndefined();
    }
  });
});
