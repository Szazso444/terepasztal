import { describe, expect, it } from 'vitest';
import { groundFrames, groundOf } from '../art/buildingGround';
import { PAL, type RGB } from '../art/palette';
import type { Rng } from '../engine/rng';
import { forAll } from '../testing/property';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { groundTiles } from './buildingYard';
import { BASE_FROM, BASE_TO, baseColour, footContour } from './groundFit';
import {
  COURSE,
  PLINTH_FROM,
  plinthColour,
  plinthOf,
  plinthShapes,
  type PlinthRun,
  type PlinthShape,
} from './plinth';
import { buildRelief, reliefHeight } from './terrainRelief';

/** The frames a plinth goes under: a straight base found in the picture. */
const WALLED = groundFrames().filter((f) => groundOf(f)!.fit === 'walls');
/** A frame's foot as drawn at `scale`: world px from its anchor. */
const footOf = (frame: string, scale: number) =>
  groundOf(frame)!.foot.map(([x, y]) => [x * scale, y * scale] as const);

/**
 * Ground of any shape round a building at map point (x0, y0): a tilt, and up to three level steps
 * a level (10 px) high or low, each along x or y, eased over a band like a terrace's bank.
 */
function terrain(rng: {
  range(a: number, b: number): number;
  int(a: number, b: number): number;
  chance(p: number): boolean;
}) {
  return {
    tilt: [rng.range(-4, 4), rng.range(-4, 4)] as const,
    steps: Array.from({ length: rng.int(0, 3) }, () => ({
      along: rng.chance(0.5) ? ('x' as const) : ('y' as const),
      at: rng.range(-0.7, 0.7),
      rise: rng.chance(0.5) ? 10 : -10,
      band: rng.range(0.05, 0.5),
    })),
  };
}
type Ground = ReturnType<typeof terrain>;
function heightOf(t: Ground, x0: number, y0: number) {
  const ease = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v));
  return (x: number, y: number) => {
    let h = t.tilt[0] * (x - x0) + t.tilt[1] * (y - y0);
    for (const s of t.steps) {
      const u = (s.along === 'x' ? x - x0 : y - y0) - s.at;
      h += s.rise * ease(u / s.band + 0.5);
    }
    return h;
  };
}
/** The walls the camera sees, w to s and s to e, at about `n` points each. */
function wallPoints(foot: readonly (readonly [number, number])[], n: number) {
  const [, e, s, w] = foot,
    out: { x: number; y: number }[] = [];
  for (const [a, b] of [
    [w, s],
    [s, e],
  ])
    for (let i = 0; i <= n; i++)
      out.push({ x: a[0] + ((b[0] - a[0]) * i) / n, y: a[1] + ((b[1] - a[1]) * i) / n });
  return out;
}

describe('the plinth under a building', () => {
  it('is not there on level ground, and the building is not lifted', () => {
    for (const frame of WALLED)
      for (const base of [0, 7.3, 19.6]) {
        const p = plinthOf(footOf(frame, 1), 5, 5, base, () => base);
        expect([p.lift, p.runs.length], frame).toEqual([0, 0]);
      }
  });

  // Slow: reads the ground at about two hundred points under each of 100 buildings (about 0.4 s
  // alone; the limit is 10 s).
  it('fills from the foot of each wall the camera sees down to the ground, wherever that drops away', () => {
    forAll(
      (rng) => ({
        frame: rng.pick(WALLED),
        scale: rng.range(0.6, 1.5),
        base: rng.range(0, 30),
        ground: terrain(rng),
      }),
      ({ frame, scale, base, ground }) => {
        const foot = footOf(frame, scale),
          height = heightOf(ground, 9, 9),
          at = (x: number, y: number) => {
            const [tx, ty] = groundTiles(x, y);
            return height(9 + tx, 9 + ty);
          };
        // it stands on the ground at its anchor
        const h0 = height(9, 9),
          p = plinthOf(foot, 9, 9, base + h0, (x, y) => base + height(x, y));
        expect(p.lift % 0.5).toBe(0);
        expect(p.lift).toBeGreaterThanOrEqual(0);
        // each point of a run reaches from the foot exactly down to the ground under it
        for (const run of p.runs) {
          expect(run.points.length).toBeGreaterThan(1);
          for (const q of run.points) {
            expect(q.drop).toBeGreaterThan(PLINTH_FROM);
            expect(q.drop).toBeCloseTo(h0 + p.lift - at(q.x, q.y), 9);
          }
        }
        // and wherever the ground lies more than a hair below a wall's foot, a run is there
        const all = p.runs.flatMap((r) => r.points);
        for (const q of wallPoints(foot, 40)) {
          const drop = h0 + p.lift - at(q.x, q.y);
          if (drop < PLINTH_FROM + 0.8) continue;
          const nearest = Math.min(...all.map((r) => Math.hypot(r.x - q.x, r.y - q.y)));
          expect(nearest, `${frame} at ${q.x}, ${q.y}, ${drop} px over the ground`).toBeLessThan(
            1.5,
          );
        }
        // lifted onto the highest ground under its foot: nothing under it stands above its base
        const [n, e, s, w] = foot;
        for (let i = 0; i <= 8; i++)
          for (let j = 0; j <= 8; j++) {
            const u = i / 8,
              v = j / 8,
              x = n[0] * (1 - u) * (1 - v) + e[0] * u * (1 - v) + s[0] * u * v + w[0] * (1 - u) * v,
              y = n[1] * (1 - u) * (1 - v) + e[1] * u * (1 - v) + s[1] * u * v + w[1] * (1 - u) * v;
            expect(at(x, y), `${frame} under its foot at ${u}, ${v}`).toBeLessThan(
              h0 + p.lift + PLINTH_FROM + 2,
            );
          }
      },
    );
  }, 10_000);

  it('stands a house at the edge of a terrace on its own relief, its bank side on a plinth', () => {
    // a hill whose levels climb a level a tile in from its edges (src/world/elevation.ts)
    const map = emptyMap(5, 14, 14, Terrain.Grass);
    for (let y = 1; y < 13; y++)
      for (let x = 1; x <= 6; x++) map.terrain[y * 14 + x] = Terrain.Hill;
    const relief = buildRelief(map, new Set()),
      level = (x: number, y: number) => relief.tiles![y * 14 + x],
      height = (x: number, y: number) => reliefHeight(map, relief, x, y);
    // tile 5, 6 is level with everything round it but its east neighbours, a level down
    for (const [dx, dy] of [
      [-1, -1],
      [0, -1],
      [-1, 0],
      [-1, 1],
      [0, 1],
    ])
      expect(level(5 + dx, 6 + dy)).toBe(level(5, 6));
    for (const dy of [-1, 0, 1]) expect(level(6, 6 + dy)).toBe(level(5, 6) - 1);
    const foot = footOf('structures/townhouse', 1),
      p = plinthOf(foot, 5, 6, height(5, 6), height);
    expect(p.lift).toBe(0);
    // its right wall (s to e), toward the fall, stands on the plinth, filled down to the ground
    expect(p.runs.some((r) => !r.lit)).toBe(true);
    for (const r of p.runs)
      for (const q of r.points) {
        const [tx, ty] = groundTiles(q.x, q.y);
        expect(q.drop).toBeCloseTo(height(5, 6) - height(5 + tx, 6 + ty), 9);
      }
    // a tile in, level all round, none
    expect(level(4, 6)).toBe(level(5, 6));
    expect(plinthOf(foot, 4, 6, height(4, 6), height).runs).toEqual([]);
  });

  it('is drawn in courses of its own stone, lit on the left, from the foot of its walls down', () => {
    const p = {
      lift: 0,
      runs: [
        {
          lit: true,
          points: [
            { x: -10, y: 2, drop: 3 },
            { x: -9, y: 2.5, drop: 6 },
            { x: -8, y: 3, drop: 8 },
          ],
        },
        {
          lit: false,
          points: [
            { x: 0, y: 6, drop: 8 },
            { x: 1, y: 5.5, drop: 7 },
          ],
        },
      ],
    };
    const wall = [150, 110, 90] as const,
      colour = plinthColour(wall),
      shapes = plinthShapes(p, colour);
    // its stone: limestone toward the building's own base colour
    for (let c = 0; c < 3; c++) {
      expect(colour[c]).toBeGreaterThanOrEqual(Math.min(PAL.stone[0][c], wall[c]));
      expect(colour[c]).toBeLessThanOrEqual(Math.max(PAL.stone[0][c], wall[c]));
    }
    expect(plinthColour(null)).toEqual(PAL.stone[0]);
    const faces = shapes.filter((s) => s.width === undefined);
    expect(faces).toHaveLength(2);
    p.runs.forEach((run, i) => {
      const face = faces[i].points,
        n = run.points.length;
      // its top tucks under the foot of the wall; its bottom is the ground under each point
      run.points.forEach((q, j) => {
        expect([face[j * 2], face[j * 2 + 1]]).toEqual([q.x, q.y - 0.4]);
        expect([face[(2 * n - 1 - j) * 2], face[(2 * n - 1 - j) * 2 + 1]]).toEqual([
          q.x,
          q.y + q.drop,
        ]);
      });
    });
    const tone = (c: number) => (c >> 16) + ((c >> 8) & 255) + (c & 255);
    expect(tone(faces[0].colour)).toBeGreaterThan(tone(faces[1].colour));
    // courses every COURSE px, only where the plinth is deeper than they lie
    const lines = shapes.filter((s) => s.width !== undefined && s.points.length > 4);
    for (const line of lines)
      for (let j = 1; j < line.points.length; j += 2) expect(line.points[j]).toBeLessThan(14);
    expect(COURSE).toBeGreaterThan(1);
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });
});

describe("the colour of a building's base", () => {
  it('is the colour of its walls just above their foot, a door or a post not counted', () => {
    // a 20 x 30 picture: a wall of one colour standing on row 25, a darker door in columns 4 to 6
    const w = 20,
      h = 30,
      data = new Uint8ClampedArray(w * h * 4);
    for (let y = 5; y <= 25; y++)
      for (let x = 0; x < w; x++) {
        const door = x >= 4 && x <= 6 && y > 12;
        data.set(door ? [40, 50, 40, 255] : [180, 160, 130, 255], (y * w + x) * 4);
      }
    const picture = { data, width: w, height: h, density: 1 },
      foot = footContour(picture);
    expect(baseColour(picture, foot)).toEqual([180, 160, 130]);
    expect(baseColour(picture, new Int32Array(w).fill(-1))).toBeNull();
  });
});

/** The plinth's top tucks this far (world px) under the foot of the walls (`TUCK`, plinth.ts). */
const TUCK = 0.4;
/** A building of any walled frame at any scale on ground of any shape, with its walls' colour. */
function standingOn(rng: Rng) {
  return {
    frame: rng.pick(WALLED),
    scale: rng.range(0.6, 1.5),
    base: rng.range(0, 30),
    ground: terrain(rng),
    wall: [rng.int(0, 255), rng.int(0, 255), rng.int(0, 255)] as RGB,
  };
}
/** The plinth of a building `standingOn` gave, standing on the ground at its anchor (9, 9). */
function plinthFor(c: ReturnType<typeof standingOn>) {
  const foot = footOf(c.frame, c.scale),
    height = heightOf(c.ground, 9, 9),
    base = c.base + height(9, 9);
  return {
    foot,
    base,
    /** the ground's height under a point of the picture (world px from the anchor) */
    at: (x: number, y: number) => {
      const [tx, ty] = groundTiles(x, y);
      return c.base + height(9 + tx, 9 + ty);
    },
    plinth: plinthOf(foot, 9, 9, base, (x, y) => c.base + height(x, y)),
  };
}
/** The run's top and its ground at x, between its points, as its face is filled between them. */
function faceAt(run: PlinthRun, x: number) {
  const P = run.points;
  for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i],
      b = P[i + 1];
    if ((x - a.x) * (x - b.x) > 1e-12) continue;
    const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x),
      y = a.y + (b.y - a.y) * t;
    return { top: y - TUCK, ground: y + a.drop + (b.drop - a.drop) * t, y };
  }
  return null;
}
const tone = (c: number) => (c >> 16) + ((c >> 8) & 255) + (c & 255);
const isLine = (s: PlinthShape) => s.width !== undefined;
/** A joint: one vertical stroke. */
const isJoint = (s: PlinthShape) =>
  isLine(s) && s.points.length === 4 && s.points[0] === s.points[2];

describe("a plinth's drawing", () => {
  // Slow: draws the plinth of each of 100 buildings and checks every point of it (about a second
  // alone).
  it('stays inside its face, from the tucked foot of the wall down to the ground', () => {
    const seen = { runs: 0, courses: 0, joints: 0 };
    forAll(standingOn, (c) => {
      const { foot, plinth } = plinthFor(c),
        [, e, s, w] = foot;
      for (const run of plinth.runs) {
        seen.runs++;
        // on the wall it stands under: the lit one from w to s, the shaded one from s to e
        const [a, b] = run.lit ? [w, s] : [s, e];
        for (const q of run.points) {
          const cross = (b[0] - a[0]) * (q.y - a[1]) - (b[1] - a[1]) * (q.x - a[0]);
          expect(Math.abs(cross) / Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThan(1e-9);
          expect((q.x - a[0]) * (q.x - b[0])).toBeLessThanOrEqual(1e-9);
        }
        const shapes = plinthShapes({ lift: plinth.lift, runs: [run] }, plinthColour(c.wall));
        for (const shape of shapes)
          for (let i = 0; i < shape.points.length; i += 2) {
            const [x, y] = [shape.points[i], shape.points[i + 1]],
              face = faceAt(run, x);
            expect(face, `${c.frame}: a point at x ${x} past the run's ends`).not.toBeNull();
            expect(y, `${c.frame} at ${x}: above the tucked foot`).toBeGreaterThanOrEqual(
              face!.top - 1e-9,
            );
            expect(y, `${c.frame} at ${x}: below the ground`).toBeLessThanOrEqual(
              face!.ground + 1e-9,
            );
          }
        // the courses: lines a whole number of courses under the foot, never as deep as the
        // ground under them
        const courses = shapes.filter((x) => isLine(x) && !isJoint(x)).slice(0, -2);
        seen.courses += courses.length;
        for (const line of courses)
          for (let i = 0; i < line.points.length; i += 2) {
            const q = run.points.find((p) => p.x === line.points[i])!,
              depth = line.points[i + 1] - q.y;
            expect(depth / COURSE, `${c.frame}: a course at ${depth}`).toBeCloseTo(
              Math.round(depth / COURSE),
              9,
            );
            expect(depth).toBeGreaterThan(0);
            expect(depth).toBeLessThan(q.drop);
          }
        // the joints: within one course each, staggered from the course above
        const joints = shapes.filter(isJoint).map((j) => {
          const q = run.points.find((p) => p.x === j.points[0])!;
          return { x: j.points[0], course: Math.round((j.points[1] - q.y) / COURSE) };
        });
        seen.joints += joints.length;
        for (const j of shapes.filter(isJoint))
          expect(j.points[3] - j.points[1]).toBeLessThanOrEqual(COURSE + 1e-9);
        for (const j of joints)
          expect(
            joints.some((k) => k.x === j.x && k.course === j.course + 1),
            `${c.frame}: joints over each other at x ${j.x}, courses ${j.course} and ${j.course + 1}`,
          ).toBe(false);
        // its last line is its foot, on the ground at every point
        const footLine = shapes[shapes.length - 1];
        expect(footLine.points).toEqual(run.points.flatMap((q) => [q.x, q.y + q.drop]));
      }
    });
    // about 180 runs, 420 courses and 2100 joints
    expect(seen.runs).toBeGreaterThan(100);
    expect(seen.courses).toBeGreaterThan(200);
    expect(seen.joints).toBeGreaterThan(1000);
  }, 30_000);

  it('is of its own stone, lit on the left, with a light top, darker joints and a dark foot', () => {
    // a plinth deep enough for courses and joints on both walls
    const deep = (lit: boolean, x0: number): PlinthRun => ({
      lit,
      points: Array.from({ length: 13 }, (_, i) => ({ x: x0 + i, y: 5 + i / 2, drop: 9 })),
    });
    const semantic = Math.min(PAL.amber[0], PAL.white[0]);
    forAll(
      (rng) =>
        rng.chance(0.1) ? null : ([rng.int(0, 255), rng.int(0, 255), rng.int(0, 255)] as RGB),
      (wall) => {
        const colour = plinthColour(wall),
          stone = PAL.stone[0];
        for (let c = 0; c < 3; c++) {
          expect(colour[c]).toBeGreaterThanOrEqual(Math.min(stone[c], (wall ?? stone)[c]) - 1e-9);
          expect(colour[c]).toBeLessThanOrEqual(Math.max(stone[c], (wall ?? stone)[c]) + 1e-9);
        }
        const faces: number[] = [];
        for (const run of [deep(true, -12), deep(false, 0)]) {
          const shapes = plinthShapes({ lift: 0, runs: [run] }, colour),
            face = shapes[0].colour,
            top = shapes[shapes.length - 2].colour,
            foot = shapes[shapes.length - 1].colour;
          faces.push(face);
          expect(shapes.filter(isJoint).length).toBeGreaterThan(0);
          for (const s of shapes.slice(1, -2)) expect(tone(s.colour)).toBeLessThan(tone(face));
          expect(tone(top)).toBeGreaterThan(tone(face));
          expect(tone(foot)).toBeLessThan(tone(face));
          // all of it below the semantic colours, the selection amber and the cursor white
          for (const s of shapes)
            expect(Math.max(s.colour >> 16, (s.colour >> 8) & 255, s.colour & 255)).toBeLessThan(
              semantic,
            );
        }
        // the left wall faces the light
        expect(tone(faces[0])).toBeGreaterThan(tone(faces[1]));
      },
    );
  });
});

describe('the lift onto the ground under a foot', () => {
  it('is never more than the highest ground under the foot, nor any where none is high', () => {
    forAll(standingOn, (c) => {
      const { foot, base, at, plinth } = plinthFor(c),
        [n, e, s, w] = foot;
      // the highest ground under the foot, read at 33 x 33 points over it
      let high = -Infinity;
      for (let i = 0; i <= 32; i++)
        for (let j = 0; j <= 32; j++) {
          const u = i / 32,
            v = j / 32;
          high = Math.max(
            high,
            at(
              n[0] * (1 - u) * (1 - v) + e[0] * u * (1 - v) + s[0] * u * v + w[0] * (1 - u) * v,
              n[1] * (1 - u) * (1 - v) + e[1] * u * (1 - v) + s[1] * u * v + w[1] * (1 - u) * v,
            ),
          );
        }
      // to the half px it is rounded to
      expect(plinth.lift, c.frame).toBeLessThanOrEqual(Math.max(0, high - base) + 0.25 + 1e-9);
      if (high - base <= PLINTH_FROM) expect(plinth.lift, c.frame).toBe(0);
    });
  });
});

describe("the colour of a building's base, against a count", () => {
  /** A picture of a few colours, some texels see-through, with a foot row for some columns. */
  function picture(rng: Rng) {
    const density = rng.int(1, 3),
      width = rng.int(1, 12),
      height = rng.int(4, 40),
      colours = Array.from({ length: rng.int(1, 4) }, () => [
        rng.int(0, 255),
        rng.int(0, 255),
        rng.int(0, 255),
      ]),
      data = new Uint8ClampedArray(width * height * 4);
    for (let k = 0; k < width * height; k++)
      data.set([...rng.pick(colours), rng.pick([0, 150, 200, 201, 255])], k * 4);
    const foot = Int32Array.from({ length: width }, () =>
      rng.chance(0.2) ? -1 : rng.int(0, height - 1),
    );
    return { picture: { data, width, height, density }, foot };
  }

  it('is the median of each channel of the opaque texels BASE_FROM to BASE_TO px over the foot', () => {
    forAll(picture, ({ picture: p, foot }) => {
      // every texel of the band, counted
      const channels: number[][] = [[], [], []];
      for (let x = 0; x < p.width; x++) {
        if (foot[x] < 0) continue;
        for (let y = 0; y < p.height; y++) {
          const up = foot[x] - y,
            k = (y * p.width + x) * 4;
          if (up < BASE_FROM * p.density || up > BASE_TO * p.density || p.data[k + 3] <= 200)
            continue;
          for (let c = 0; c < 3; c++) channels[c].push(p.data[k + c]);
        }
      }
      const got = baseColour(p, foot);
      if (!channels[0].length) return expect(got).toBeNull();
      // the median: the least value that more than half of the texels are at or below
      const median = channels.map((list) => {
        for (let v = 0; v <= 255; v++)
          if (list.filter((x) => x <= v).length > list.length / 2) return v;
        return 255;
      });
      expect(got).toEqual(median);
    });
  });
});
