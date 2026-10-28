import { beforeAll, describe, expect, it } from 'vitest';
import LIFE from '../src/art/buildingLife.json';
import { generateStructuresAtlas } from '../src/art/structures';
import { atlasFrames } from './building-ground.mjs';

/**
 * Properties of src/art/buildingLife.json that hold without the measuring tool: they read only
 * the file and the atlas's pixels, and use none of tools/building-life.mjs (its detector, seeds
 * and thresholds), so the tool cannot agree with itself. Beside tools/building-life.test.mjs,
 * which holds the file to the tool's output and to the demo's numbers (issue #492).
 *
 * Each property is a function that returns its problems and is also run on data broken on purpose,
 * so that a test which could not fail shows itself.
 */

/** Making the atlas takes seconds, more on a busy machine. */
const SLOW = 120_000;
const SOLID = 128;
/**
 * The cut checks flood-fill a 271 x 346 frame a few times per cut: 0.8 s and 0.65 s alone, so a
 * limit of 20 s each.
 */
const CUT = 20_000;

let frames;
beforeAll(() => {
  frames = atlasFrames(generateStructuresAtlas);
}, SLOW);

const alpha = (f, x, y) =>
  x < 0 || y < 0 || x >= f.w || y >= f.h ? 0 : f.data[(y * f.w + x) * 4 + 3];
const visible = (f, x, y) => alpha(f, x, y) > 0;
const toTexel = (f, dx, dy) => [dx * f.resolution + f.ax, dy * f.resolution + f.ay];

/* ------------------------------------------------------------------------------------ pots */

const WINDOW = 1.5; // world px either side of a pot, across which its top is looked for
const HEIGHT = 3; // a stack stands at least this tall (world px) under its top
const APART = 4; // two pots of a frame are at least this far apart (world px)

/**
 * What is wrong with a pot, judged on the pixels alone. Its point must be the top of the picture
 * in the columns around it (no opaque texel more than half a world px above it, the first opaque
 * one no more than half a world px under it) and a stack must stand under that top.
 */
function potProblems(f, pot) {
  const r = f.resolution;
  const slack = Math.max(1, Math.round(0.5 * r));
  const [px, py] = toTexel(f, pot.dx, pot.dy);
  if (!(px >= 0 && px < f.w && py >= 0 && py < f.h)) return ['outside its frame'];
  const x0 = Math.floor(px - WINDOW * r);
  const x1 = Math.ceil(px + WINDOW * r);
  let top = Infinity;
  for (let y = 0; y < f.h && top === Infinity; y++)
    for (let x = x0; x <= x1; x++) if (alpha(f, x, y) >= SOLID) top = y;
  if (top === Infinity) return ['no opaque texel in its columns'];
  const out = [];
  if (top < py - slack) out.push(`the picture is ${(py - top) / r} world px higher`);
  if (top > py + slack) out.push(`the picture's top is ${(top - py) / r} world px lower`);
  // the stack: some column of the window is opaque for HEIGHT world px under the top
  const need = Math.round(HEIGHT * r);
  let stands = false;
  for (let x = x0; x <= x1 && !stands; x++) {
    let d = 0;
    while (d < need && alpha(f, x, top + d) >= SOLID) d++;
    stands = d >= need;
  }
  if (!stands) out.push(`no stack of ${HEIGHT} world px under it`);
  return out;
}

describe('every pot, judged on the pixels alone', () => {
  it('stands at the top of the picture, on a stack', () => {
    for (const [key, list] of Object.entries(LIFE.pots))
      for (const pot of list)
        expect(potProblems(frames.get(key), pot), `${key} ${JSON.stringify(pot)}`).toEqual([]);
  });

  it('is caught when it is moved, lowered or put beside the stack', () => {
    const f = frames.get('structures/town_2');
    const [pot] = LIFE.pots['structures/town_2'];
    expect(potProblems(f, pot)).toEqual([]);
    expect(potProblems(f, { ...pot, dy: pot.dy - 3 })).not.toEqual([]); // above the picture
    expect(potProblems(f, { ...pot, dy: pot.dy + 3 })).not.toEqual([]); // inside the chimney
    expect(potProblems(f, { ...pot, dx: pot.dx + 10 })).not.toEqual([]); // beside it
    expect(potProblems(f, { ...pot, dx: -1000 })).toEqual(['outside its frame']);
  });

  it('is told apart from the others of its frame, and finite', () => {
    for (const [key, list] of Object.entries(LIFE.pots)) {
      list.forEach((a, i) => {
        expect(Number.isFinite(a.dx) && Number.isFinite(a.dy), key).toBe(true);
        for (const b of list.slice(i + 1))
          expect(Math.hypot(a.dx - b.dx, a.dy - b.dy), `${key} has a pot twice`).toBeGreaterThan(
            APART,
          );
      });
    }
  });

  it('is in the file for the frames the issue names, with the issue marking of work chimneys', () => {
    // issue #492: pots per frame, `work` for lumber_2 and pump_1 only; the town hall, station,
    // warehouse, sawmill and farm show their 3D models since 2026-10-27, one picture for every
    // level: their stacks are this file's own (`POT_GROUPS`), the issue's numbers no longer theirs
    const named = {
      'structures/town_2': [2, false],
      'structures/town_3': [2, false],
      'structures/townhouse': [1, false],
      'structures/townhouse_2': [1, false],
      'structures/townhouse_3': [1, false],
      'structures/townhouse_s0': [1, false],
      'structures/townhouse_s1': [1, false],
      'structures/townhouse_s2': [1, false],
      'structures/station_2': [1, false],
      'structures/warehouse_1': [2, false],
      'structures/lumber_2': [1, true],
      'structures/farm_2': [1, false],
      'structures/pump_1': [1, true],
    };
    for (const [key, [count, work]] of Object.entries(named)) {
      const list = LIFE.pots[key];
      expect(list?.length, key).toBe(count);
      for (const pot of list) expect(pot.work, key).toBe(work);
    }
  });

  it('sits where the issue measured it on the frames its picture shares', () => {
    // townhouse_2, townhouse_4 and townhouse_s1 are not in the other test's table
    const asked = {
      'structures/townhouse_2': [175.5, 6],
      'structures/townhouse_4': [175.5, 6],
      'structures/townhouse_s1': [142.4, 5],
    };
    for (const [key, [x, y]] of Object.entries(asked)) {
      const f = frames.get(key);
      const [pot] = LIFE.pots[key];
      expect(Math.abs(pot.dx - (x - f.ax) / f.resolution), key).toBeLessThan(0.05);
      expect(Math.abs(pot.dy - (y - f.ay) / f.resolution), key).toBeLessThan(0.05);
    }
  });

  it('is in world px: inside the frame’s box measured from the anchor, not in texels', () => {
    for (const [key, list] of Object.entries(LIFE.pots)) {
      const f = frames.get(key);
      const r = f.resolution;
      for (const pot of list) {
        expect(pot.dx, key).toBeGreaterThanOrEqual(-f.ax / r);
        expect(pot.dx, key).toBeLessThan((f.w - f.ax) / r);
        expect(pot.dy, key).toBeGreaterThanOrEqual(-f.ay / r);
        expect(pot.dy, key).toBeLessThan((f.h - f.ay) / r);
      }
    }
  });
});

/* ----------------------------------------------------------------------------------- cranes */

/** The number of 8-connected pieces of the visible texels that `skip` does not hold. */
function pieces(f, skip = () => false) {
  const seen = new Uint8Array(f.w * f.h);
  let n = 0;
  for (let y0 = 0; y0 < f.h; y0++)
    for (let x0 = 0; x0 < f.w; x0++) {
      if (seen[y0 * f.w + x0] || !visible(f, x0, y0) || skip(x0, y0)) continue;
      n++;
      const todo = [[x0, y0]];
      while (todo.length) {
        const [x, y] = todo.pop();
        if (x < 0 || y < 0 || x >= f.w || y >= f.h) continue;
        if (seen[y * f.w + x] || !visible(f, x, y) || skip(x, y)) continue;
        seen[y * f.w + x] = 1;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) todo.push([x + dx, y + dy]);
      }
    }
  return n;
}

const inRects = (rects, x, y) =>
  rects.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);

/** The most of the picture a hanging load can be. */
const LOAD_SHARE = 0.1;

/**
 * What is wrong with a load cut, in texels. A cut that is right takes something, takes it from
 * inside the frame, leaves the rest of the picture in no more pieces than it was in, and touches
 * the rest only above its top row and below its bottom row.
 */
function cutProblems(f, rects) {
  const out = [];
  for (const [x0, y0, x1, y1] of rects)
    if (x0 < 0 || y0 < 0 || x1 > f.w || y1 > f.h)
      out.push(`outside the frame: ${[x0, y0, x1, y1]}`);
  let taken = 0;
  let all = 0;
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++)
      if (visible(f, x, y)) {
        all++;
        if (inRects(rects, x, y)) taken++;
      }
  if (taken === 0) return [...out, 'takes nothing'];
  // a hanging load is a small part of the building, not the building
  if (taken > all * LOAD_SHARE) out.push(`takes ${taken} of ${all} texels, more than a load`);
  const top = Math.min(...rects.map((r) => r[1]));
  const bottom = Math.max(...rects.map((r) => r[3])) - 1;
  const before = pieces(f);
  const after = pieces(f, (x, y) => inRects(rects, x, y));
  if (after > before) out.push(`splits the picture: ${before} pieces became ${after}`);
  const sides = new Set();
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      if (!inRects(rects, x, y) || !visible(f, x, y)) continue;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (inRects(rects, x + dx, y + dy) || !visible(f, x + dx, y + dy)) continue;
          if (!((dy < 0 && y === top) || (dy > 0 && y === bottom)))
            sides.add(`${x + dx},${y + dy}`);
        }
    }
  if (sides.size) out.push(`touches the rest at ${sides.size} texels, first ${[...sides][0]}`);
  return out;
}

const cutOf = (f, crane) =>
  crane.load.map(([a, b, c, d]) => {
    const [x0, y0] = toTexel(f, a, b);
    const [x1, y1] = toTexel(f, c, d);
    return [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)];
  });

// the demo's crane (issue #492) hung over the cart of the quarry's painted picture; the quarry
// shows its 3D model since 2026-10-27, whose crate hangs over the stone block and is no crane
// `loadOf` can lift out (`CRANE_GROUPS` is empty). These come back with a crane for that picture.
describe.skip('every crane, judged on the pixels alone', () => {
  it(
    'lifts out without splitting the picture, and touches the rest only at the pulley and the cart',
    () => {
      for (const [key, crane] of Object.entries(LIFE.cranes))
        expect(cutProblems(frames.get(key), cutOf(frames.get(key), crane)), key).toEqual([]);
    },
    CUT,
  );

  it(
    'is caught when the cut is the demo’s region, shifted, empty or the whole body',
    () => {
      const f = frames.get('structures/quarry_2');
      const mine = cutOf(f, LIFE.cranes['structures/quarry_2']);
      expect(cutProblems(f, mine)).toEqual([]);
      // the demo's region, issue #492: it takes the cart's rim at its right edge (x 77-78)
      const demo = [
        [40, 42, 50, 88],
        [15, 88, 79, 170],
      ];
      expect(cutProblems(f, demo)).not.toEqual([]);
      const shift = (dx, dy) => mine.map(([a, b, c, d]) => [a + dx, b + dy, c + dx, d + dy]);
      expect(cutProblems(f, shift(3, 0))).not.toEqual([]);
      expect(cutProblems(f, shift(0, 8))).not.toEqual([]);
      expect(cutProblems(f, [[0, 0, f.w, f.h]])).not.toEqual([]);
      expect(cutProblems(f, [[0, 0, 1, 1]])).toEqual(['takes nothing']);
      expect(cutProblems(f, [[f.w - 2, 0, f.w + 9, 10]])[0]).toMatch(/outside the frame/);
    },
    CUT,
  );

  it('has the pivot the issue gives, on the top of the load, above a rope', () => {
    // issue #492: quarry_2 (271 x 346), pulley at (44.5, 41)
    const q = frames.get('structures/quarry_2');
    expect([q.w, q.h]).toEqual([271, 346]);
    const pivot = LIFE.cranes['structures/quarry_2'].pivot;
    expect(pivot[0]).toBeCloseTo((44.5 - q.ax) / q.resolution, 1);
    expect(pivot[1]).toBeCloseTo((41 - q.ay) / q.resolution, 1);
    for (const [key, c] of Object.entries(LIFE.cranes)) {
      const g = frames.get(key);
      const [px, py] = toTexel(g, c.pivot[0], c.pivot[1]);
      const top = Math.min(...cutOf(g, c).map((r) => r[1]));
      expect(Math.abs(py - top), `${key} pivot is not on the top`).toBeLessThanOrEqual(
        Math.ceil(g.resolution),
      );
      let rope = false;
      for (let x = Math.floor(px) - 1; x <= Math.ceil(px) + 1; x++)
        for (let y = top; y <= top + 2; y++) rope = rope || alpha(g, x, y) >= SOLID;
      expect(rope, `${key} has no rope under its pivot`).toBe(true);
    }
  });

  it('is made of rectangles that do not overlap and leave no row of the load out', () => {
    for (const [key, c] of Object.entries(LIFE.cranes)) {
      const rects = cutOf(frames.get(key), c);
      for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++) {
          const [a, b] = [rects[i], rects[j]];
          const apart = a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1];
          expect(apart, `${key} rectangles ${i} and ${j} overlap`).toBe(true);
        }
      const top = Math.min(...rects.map((r) => r[1]));
      const bottom = Math.max(...rects.map((r) => r[3]));
      for (let y = top; y < bottom; y++)
        expect(
          rects.some((r) => r[1] <= y && y < r[3]),
          `${key} row ${y} is in no rectangle`,
        ).toBe(true);
    }
  });

  it('is on the quarry’s five levels and nothing else', () => {
    expect(Object.keys(LIFE.cranes).sort()).toEqual(
      [1, 2, 3, 4, 5].map((n) => `structures/quarry_${n}`),
    );
  });
});
