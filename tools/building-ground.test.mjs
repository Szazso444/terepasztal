import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { structureFrame } from '../src/art/frames';
import { generateStructuresAtlas } from '../src/art/structures';
import { worldToTile } from '../src/engine/iso';
import { Rng } from '../src/engine/rng';
import { structureFamily, unturnedFrame } from '../src/render/assetScale';
import { footContour } from '../src/render/groundFit';
import { doorsOf, placeSpan, streetDoor } from '../src/sim/doors';
import { SEEDS, forAll, shrinkInt } from '../src/testing/property';
import { FIT, measureBase } from './building-fit.mjs';
import { ROTATIONS } from './building-kit.mjs';
import {
  DOOR,
  GROUND_FILE,
  GROUP,
  MEASURE,
  REACH,
  SOLID,
  atlasFrames,
  buildGround,
  classify,
  describe as report,
  generatedFrames,
  measureFoot,
  measureFrame,
  openingsOnWall,
  ownDetail,
  placeDefs,
  serialise,
  sheetOf,
  writeSheets,
} from './building-ground.mjs';

const DIRS = ['N', 'E', 'S', 'W'];
/** Making the atlas and measuring every frame takes seconds, more on a busy machine. */
const SLOW = 120_000;

/** A frame drawn in code: `paint(x, y)` gives [r, g, b, a] for a texel, or null for clear. */
function drawn(w, h, paint, { resolution = 1, ax = 0, ay = 0 } = {}) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = paint(x, y);
      if (c) data.set(c, (y * w + x) * 4);
    }
  return { key: 'test', w, h, ax, ay, resolution, source: 'generated', data };
}

/**
 * A slab on the game's ground lines: its near corner at (50, 70) texels, the left corner at
 * (10, 50) and the right at (90, 50), standing 30 texels high. `extra` draws on top of it.
 */
function slab(extra = () => null, resolution = 1) {
  const k = resolution;
  const bottom = (x) => (x < 50 * k ? 50 * k + (x - 10 * k) * 0.5 : 70 * k - (x - 50 * k) * 0.5);
  // the roof's outline: up to the far corner at 30 texels over the ground there
  const top = (x) => (x < 50 * k ? 20 * k - (x - 10 * k) * 0.5 : (x - 50 * k) * 0.5);
  return drawn(
    100 * k,
    100 * k,
    (x, y) => {
      const over = extra(x, y);
      if (over) return over;
      return x >= 10 * k && x < 90 * k && y < bottom(x) && y >= top(x) ? [120, 110, 90, 255] : null;
    },
    { resolution },
  );
}

/**
 * The file's bytes are the text the tool writes. When they are not, the failure names the frames
 * that differ: a diff of two 200 KB strings is not a message, and takes minutes to compute.
 */
function expectSameBytes(text, file, label) {
  if (text === file) return;
  const now = JSON.parse(text).frames;
  const was = JSON.parse(file).frames;
  const stale = [...new Set([...Object.keys(now), ...Object.keys(was)])].filter(
    (key) => JSON.stringify(now[key]) !== JSON.stringify(was[key]),
  );
  throw new Error(
    `${label}: the file is not what the tool writes: ${stale.length} frames differ` +
      (stale.length ? `, ${stale.slice(0, 5).join(', ')}` : ' (the text only)'),
  );
}

/* ------------------------------------------------ drawn buildings, for the properties below */

const WALL = [150, 120, 90, 255];
const ROOF = [200, 60, 60, 255];
const DARK = [30, 30, 30, 255];
const CORNERS = ['n', 'e', 's', 'w'];

/** [x, y] and [x, y] at most `by` apart, with the case named in the failure. */
function within(p, q, by, label) {
  expect(
    Math.hypot(p[0] - q[0], p[1] - q[1]),
    `${label}: ${p} is not within ${by} of ${q}`,
  ).toBeLessThanOrEqual(by);
}

/**
 * A box standing on the game's ground lines, in a 200 x 200 world px frame at `k` texels per world
 * px: its near corner at (sx, sy), the S wall `a` long to the left of it and the E wall `b` long
 * to the right, `h` high, with a roof of another colour. `slopes` are the two ground lines' slopes
 * left and right of the near corner, where a picture is not on the game's 0.5 and 0.5. `doors`
 * are dark openings on a wall, `{ wall: 'S' | 'E', x, width, height, up }`: the centre column, the
 * size and the rise above the foot, in world px. `extra(x, y, ground)` paints over the box and
 * around it: it gets a texel's centre in world px and returns [r, g, b, a], or nothing to leave
 * the texel. `truth` is the foot the box was drawn on, in texels.
 */
function box({ k = 1, a, b, h, sx, sy, slopes = [0.5, 0.5], doors = [], extra, ax = 0, ay = 0 }) {
  const [sl, sr] = slopes;
  const w = [sx - a, sy - a * sl];
  const e = [sx + b, sy - b * sr];
  const n = [w[0] + b, w[1] - b * sr];
  const low = (x) => (x < sx ? w[1] + (x - w[0]) * sl : sy - (x - sx) * sr);
  const far = (x) => (x < n[0] ? w[1] - (x - w[0]) * sr : n[1] + (x - n[0]) * sl);
  const ground = { low, w, e, n, s: [sx, sy] };
  const frame = drawn(
    200 * k,
    200 * k,
    (tx, ty) => {
      const x = (tx + 0.5) / k;
      const y = (ty + 0.5) / k;
      const over = extra?.(x, y, ground);
      if (over) return over;
      if (x < w[0] || x >= e[0] || y >= low(x) || y < far(x) - h) return null;
      for (const d of doors)
        if ((d.wall === 'S') === x < sx && Math.abs(x - d.x) < d.width / 2) {
          const base = low(x) - d.up;
          if (y < base && y >= base - d.height) return DARK;
        }
      return y < low(x) - h ? ROOF : WALL;
    },
    { resolution: k, ax, ay },
  );
  const texels = (p) => p.map((v) => v * k);
  return { frame, truth: { n: texels(n), e: texels(e), s: texels([sx, sy]), w: texels(w) } };
}

/** The frame with its pixels moved right and down by whole texels. */
function shifted(f, dx, dy) {
  const w = f.w + dx;
  const h = f.h + dy;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++)
      data.set(
        f.data.subarray((y * f.w + x) * 4, (y * f.w + x) * 4 + 4),
        ((y + dy) * w + x + dx) * 4,
      );
  return { ...f, w, h, data };
}

/** The frame as in a mirror, left for right. */
function mirrored(f) {
  const data = new Uint8ClampedArray(f.data.length);
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++)
      data.set(
        f.data.subarray((y * f.w + x) * 4, (y * f.w + x) * 4 + 4),
        (y * f.w + f.w - 1 - x) * 4,
      );
  return { ...f, data };
}

/** The frame with every texel made `m` by `m`: the same picture at `m` times the resolution. */
function upscaled(f, m) {
  const w = f.w * m;
  const h = f.h * m;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const from = (Math.floor(y / m) * f.w + Math.floor(x / m)) * 4;
      data.set(f.data.subarray(from, from + 4), (y * w + x) * 4);
    }
  return { ...f, w, h, data, resolution: f.resolution * m };
}

/**
 * The same picture declared at `m` times the resolution: every texel made `m` by `m`, the anchor
 * with them, the whole moved `by` texels right and down (so that the copies of a texel need not
 * start on a multiple of `m`).
 */
function enlarged(f, m, by = 0) {
  const big = shifted(upscaled(f, m), by, by);
  return { ...big, ax: f.ax * m + by, ay: f.ay * m + by };
}

/** Seeds for the properties that draw a frame per case: enough to cover the cases, in seconds. */
const DRAWN = SEEDS.slice(0, 60);
/** Property calls a failing case may spend shrinking: each draws and measures a frame. */
const SHRINK = 400;

/** The smallest a box, and so a failing case, gets drawn. */
const SMALLEST = { k: 1, a: 16, b: 16, h: 14, sx: 100, sy: 165 };

function genBox(rng, resolutions = [1, 2, 4]) {
  return {
    k: rng.pick(resolutions),
    a: rng.int(16, 64),
    b: rng.int(16, 64),
    h: rng.int(14, 70),
    sx: rng.int(80, 120),
    sy: rng.int(150, 180),
  };
}

function* shrinkBox(c) {
  for (const key of Object.keys(SMALLEST))
    for (const v of shrinkInt(c[key], SMALLEST[key])) yield { ...c, [key]: v };
}

describe('the foot of a frame', () => {
  const near = (p, q, by) => {
    expect(Math.abs(p[0] - q[0])).toBeLessThanOrEqual(by);
    expect(Math.abs(p[1] - q[1])).toBeLessThanOrEqual(by);
  };

  it('finds the corners of a box standing on the ground, at any resolution', () => {
    for (const k of [1, 4]) {
      const foot = measureFoot(slab(undefined, k));
      expect(foot.fit).toBe('walls');
      near(foot.s, [50 * k, 70 * k], k * 1.5);
      near(foot.w, [10 * k, 50 * k], k * 1.5);
      near(foot.e, [90 * k, 50 * k], k * 1.5);
      near(foot.n, [50 * k, 30 * k], k * 2.5);
    }
  });

  it('is not led astray by what stands or lies in front of the walls', () => {
    // a lamp post below the near corner, a bench in front of the left wall, and paint on the
    // ground along the right wall: none of them is a wall
    const lamp = (x, y) => (x >= 31 && x < 33 && y >= 40 && y < 82 ? [40, 40, 40, 255] : null);
    const bench = (x, y) => (x >= 14 && x < 26 && y >= 72 && y < 76 ? [90, 60, 30, 255] : null);
    const paint = (x, y) =>
      x >= 60 && x < 86 && y >= 62 - (x - 60) * 0.5 && y < 66 - (x - 60) * 0.5
        ? [200, 190, 150, 255]
        : null;
    const foot = measureFoot(slab((x, y) => lamp(x, y) ?? bench(x, y) ?? paint(x, y)));
    near(foot.s, [50, 70], 2);
    near(foot.w, [10, 50], 2);
    near(foot.e, [90, 50], 2);
  });

  it('ignores what is only half opaque, such as a shadow on the ground', () => {
    const shadow = (x, y) =>
      y >= 70 && y < 80 && x > 20 && x < 80 ? [30, 40, 30, SOLID - 1] : null;
    near(measureFoot(slab(shadow)).s, [50, 70], 1.5);
  });

  it('takes a texel for the building from the same alpha as building-fit does', () => {
    expect(SOLID).toBe(FIT.alpha);
  });

  it("holds the issue's bound: a foot corner is within 1 world px of the picture, no more", () => {
    // the data test below judges every corner by REACH, so a looser REACH would pass any foot
    expect(REACH).toBe(1);
  });

  it('gives no foot for an empty frame', () => {
    expect(measureFoot(drawn(20, 20, () => null))).toBeNull();
  });
});

describe('the doors of a wall', () => {
  /** the slab with a dark door on its left wall, 3 texels wide and 9 high, standing at x. */
  const withDoor = (x0, k = 1) =>
    slab((x, y) => {
      const bottom = 50 * k + (x - 10 * k) * 0.5;
      return x >= x0 * k && x < (x0 + 3) * k && y < bottom && y >= bottom - 9 * k
        ? [30, 30, 30, 255]
        : null;
    }, k);

  it('finds a door where it stands, and nothing on a bare wall', () => {
    for (const k of [1, 4]) {
      const frame = withDoor(24, k);
      const foot = measureFoot(frame);
      const found = openingsOnWall(frame, foot.w, foot.s);
      expect(found).toHaveLength(1);
      const [door] = found;
      expect((door.from + door.to) / 2 / k).toBeCloseTo(25.5, 0);
      expect((door.hi - door.lo + 1) / k).toBeCloseTo(9, 0);
      const bare = slab(undefined, k);
      expect(openingsOnWall(bare, measureFoot(bare).w, measureFoot(bare).s)).toHaveLength(0);
    }
  });

  it('takes a window high on the wall for no door', () => {
    const k = 1;
    const window = slab((x, y) => {
      const bottom = 50 + (x - 10) * 0.5;
      return x >= 24 && x < 28 && y < bottom - 16 && y >= bottom - 24 ? [30, 30, 30, 255] : null;
    }, k);
    const foot = measureFoot(window);
    expect(openingsOnWall(window, foot.w, foot.s)).toHaveLength(0);
  });

  it('keeps its limits as numbers a door can have', () => {
    expect(DOOR.minWidth).toBeLessThan(DOOR.maxWidth);
    expect(DOOR.minHeight).toBeLessThan(DOOR.maxHeight);
    expect(DOOR.ground).toBeLessThanOrEqual(DOOR.touch);
  });
});

describe('which building a frame is', () => {
  const names = new Set(
    [
      'farm_1',
      'farm_1_r1',
      'depot_r0',
      'depot_r0_r2',
      'depot_r1',
      'depot_r1_r3',
      'depot_r0_lv2',
      'depot_r0_lv2_r2',
      'depot_1',
      'depot_narrow_r1',
      'townhouse_s1',
      'townhouse_s1_r3',
      'refinery_lv3',
      'refinery_lv3_r2',
    ].map((n) => `structures/${n}`),
  );
  const places = placeDefs();
  const of = (n) => classify(`structures/${n}`, names, places);

  it('names the family and the rotation, through levels, stages and turns', () => {
    expect(of('farm_1')).toMatchObject({ family: 'farm', rot: 0 });
    expect(of('farm_1_r1')).toMatchObject({ family: 'farm', rot: 1 });
    expect(of('townhouse_s1_r3')).toMatchObject({ family: 'townhouse', rot: 3 });
    expect(of('refinery_lv3_r2')).toMatchObject({ family: 'refinery', rot: 2 });
    expect(of('depot_1')).toMatchObject({ family: 'depot', rot: 0 });
  });

  it('reads a depot axis as its rotation until a turn says otherwise', () => {
    expect(of('depot_r0')).toMatchObject({ family: 'depot', rot: 0 });
    expect(of('depot_r1')).toMatchObject({ family: 'depot', rot: 1 });
    expect(of('depot_r0_r2')).toMatchObject({ family: 'depot', rot: 2 });
    expect(of('depot_r1_r3')).toMatchObject({ family: 'depot', rot: 3 });
    expect(of('depot_r0_lv2_r2')).toMatchObject({ family: 'depot', rot: 2 });
    expect(of('depot_narrow_r1')).toMatchObject({ family: 'depot_narrow', rot: 1 });
  });

  it('leaves out frames that are not buildings, and refuses one it does not know', () => {
    for (const n of [
      'bridge_wood',
      'span_wood_0_1_0_0_deck',
      'supply_catenary_ew',
      'signal',
      'warn',
    ])
      expect(of(n)).toBeNull();
    expect(classify('props/tree_0', names, places)).toBeNull();
    expect(() => of('mystery_1')).toThrow(/neither a building frame/);
  });

  it('gives every def that shares a frame the same doors, so that the frame has one set', () => {
    for (const { family, def } of places) {
      const same = places.filter((p) => p.family === family);
      for (const rot of [0, 1, 2, 3])
        expect(JSON.stringify(doorsOf(def, 0, 0, rot))).toBe(
          JSON.stringify(doorsOf(same[0].def, 0, 0, rot)),
        );
    }
  });
});

describe(`the ground data of the ${GROUP} frames`, () => {
  let frames, places, file, data;
  beforeAll(() => {
    frames = atlasFrames(generateStructuresAtlas);
    places = placeDefs();
    file = readFileSync(GROUND_FILE, 'utf8');
    data = JSON.parse(file).frames;
  }, SLOW);

  /** the nearest opaque texel to a point (world px from the anchor), in world px */
  const gap = (frame, p) => {
    const d = frame.resolution;
    const px = frame.ax + p[0] * d,
      py = frame.ay + p[1] * d;
    let best = Infinity;
    const reach = Math.ceil((REACH + 2) * d);
    for (let y = Math.floor(py) - reach; y <= Math.floor(py) + reach; y++)
      for (let x = Math.floor(px) - reach; x <= Math.floor(px) + reach; x++) {
        if (x < 0 || y < 0 || x >= frame.w || y >= frame.h) continue;
        if (frame.data[(y * frame.w + x) * 4 + 3] < SOLID) continue;
        // the texel is the square [x, x + 1] x [y, y + 1]
        const dx = Math.max(x - px, 0, px - (x + 1)),
          dy = Math.max(y - py, 0, py - (y + 1));
        best = Math.min(best, Math.hypot(dx, dy) / d);
      }
    return best;
  };
  const building = (key) => {
    const info = classify(key, new Set(frames.keys()), places);
    return info && { key, ...info };
  };

  it('has an entry for every building frame of the atlas, and for nothing else', () => {
    const buildings = [...frames.keys()].filter(building).sort();
    expect(buildings.length).toBeGreaterThan(300);
    const missing = buildings.filter((k) => !data[k]);
    expect(missing, `frames without an entry: ${missing.slice(0, 5)}`).toEqual([]);
    const stale = Object.keys(data).filter((k) => !buildings.includes(k));
    expect(stale, `entries without a frame: ${stale.slice(0, 5)}`).toEqual([]);
    // from the generator and from the file pair, as the game builds them
    for (const k of buildings) expect(data[k].source, k).toBe(frames.get(k).source);
    expect(new Set(buildings.map((k) => data[k].source))).toEqual(
      new Set(['generated', 'illustrated']),
    );
  });

  it("keeps each foot on its frame's opaque pixels, within a world px", () => {
    const off = [];
    for (const [key, e] of Object.entries(data)) {
      const frame = frames.get(key);
      for (const [i, p] of e.foot.entries())
        if (gap(frame, p) > REACH) off.push(`${key} ${'nesw'[i]} ${p}`);
      for (const p of e.front.edge) if (gap(frame, p) > REACH) off.push(`${key} front ${p}`);
    }
    expect(off, `${off.length} corners off the picture: ${off.slice(0, 5)}`).toEqual([]);
  });

  it("lays the foot on ground lines near the game's, near corner lowest", () => {
    // each wall's slope as the picture draws it, within the range building-fit trusts (the game's
    // ground is 0.5); a frame whose base the game's own lines fit is on them exactly
    let sloped = 0;
    for (const [key, e] of Object.entries(data)) {
      const [n, ee, s, w] = e.foot;
      // a parallelogram, so that two opposite walls are as long and as steep as each other
      expect(n[0] + s[0], key).toBeCloseTo(ee[0] + w[0], 1);
      expect(n[1] + s[1], key).toBeCloseTo(ee[1] + w[1], 1);
      expect(w[0], key).toBeLessThan(s[0]);
      expect(s[0], key).toBeLessThan(ee[0]);
      for (const slope of [(s[1] - w[1]) / (s[0] - w[0]), (s[1] - ee[1]) / (ee[0] - s[0])]) {
        // to the rounding of the two decimals the corners are written in
        expect(slope, key).toBeGreaterThanOrEqual(MEASURE.slope[0] - 0.02);
        expect(slope, key).toBeLessThanOrEqual(MEASURE.slope[1] + 0.02);
        if (Math.abs(slope - 0.5) > 0.02) sloped++;
      }
      expect(n[1], key).toBeLessThan(s[1]);
    }
    // most pictures are drawn on the game's lines, and some are not
    expect(sloped).toBeGreaterThan(0);
    expect(sloped).toBeLessThan(Object.keys(data).length);
  });

  it('passes over walls on stilts: no foot has its near corner above the anchor', () => {
    // the anchor is the footprint's centre on the ground (docs/art-direction/README.md): a base
    // whose near corner stands more than 2 world px above it is on legs or a roof, and the foot is
    // what it stands on (the generated coal stand, `fuel_stop_r1` to `_r3`)
    const above = Object.entries(data)
      .filter(([, e]) => e.foot[2][1] < -2)
      .map(([key, e]) => `${key} ${e.foot[2][1]}`);
    expect(above, `near corners above the anchor: ${above.slice(0, 5)}`).toEqual([]);
  });

  it('names the front wall for the rotation, and whether the camera sees it', () => {
    for (const [key, e] of Object.entries(data)) {
      const r = ROTATIONS[e.rot];
      expect(e.front.side, key).toBe(r.front);
      expect(e.front.visible, key).toBe(r.front === 'S' || r.front === 'E');
      const corner = { S: [3, 2], E: [1, 2], N: [0, 1], W: [0, 3] }[r.front];
      expect(e.front.edge, key).toEqual(corner.map((i) => e.foot[i]));
    }
  });

  it("covers the footprint of its def at its rotation, and the tiles of the def's doors", () => {
    for (const [key, e] of Object.entries(data)) {
      const { defs } = building(key);
      const span = placeSpan(defs[0].def);
      const w = e.rot % 2 ? span.h : span.w,
        h = e.rot % 2 ? span.w : span.h;
      expect(e.footprint, key).toHaveLength(w * h);
      for (const door of doorsOf(defs[0].def, 0, 0, e.rot))
        expect(e.footprint, key).toContainEqual([door.tile.x, door.tile.y]);
    }
  });

  it("carries only doors the data has, on the walls the camera sees, near their tile's middle", () => {
    let seen = 0;
    for (const [key, e] of Object.entries(data)) {
      const { defs } = building(key);
      for (const { def } of defs) {
        const from = doorsOf(def, 0, 0, e.rot);
        for (const door of e.doors) {
          const match = from.filter(
            (d) =>
              d.kind === door.kind &&
              DIRS[d.side] === door.side &&
              d.tile.x === door.tile[0] &&
              d.tile.y === door.tile[1] &&
              d.reach.x === door.reach[0] &&
              d.reach.y === door.reach[1],
          );
          expect(match, `${key}: ${door.kind} door at ${door.tile} on ${door.side}`).toHaveLength(
            1,
          );
        }
      }
      for (const door of e.doors) {
        seen++;
        expect(['S', 'E'], key).toContain(door.side);
        // within 0.3 tile of the middle of its tile, the window docs/art-direction/README.md gives
        expect(Math.abs(door.offset), key).toBeLessThanOrEqual(0.3);
        expect(gap(frames.get(key), door.point), `${key} door point`).toBeLessThanOrEqual(REACH);
      }
      // at most one picture door for each door of the data
      expect(e.doors.length, key).toBeLessThanOrEqual(doorsOf(defs[0].def, 0, 0, e.rot).length);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it(
    'is what the tool writes now, to the byte',
    async () => {
      const mods = { doorsOf, placeSpan };
      const again = buildGround(frames, places, mods).data;
      expectSameBytes(await serialise(again), file, 'the tool now');
      // and generating the frames twice gives the same pixels
      const first = generatedFrames(generateStructuresAtlas);
      const second = generatedFrames(generateStructuresAtlas);
      expect([...first.keys()]).toEqual([...second.keys()]);
      for (const [key, f] of first)
        expect(Buffer.from(f.data).equals(Buffer.from(second.get(key).data)), key).toBe(true);
    },
    SLOW,
  );

  // Two more runs of the tool, each about 2.5 s alone; the file is checked against each.
  it(
    'is the same bytes whatever order the frames and the defs come in',
    async () => {
      for (const seed of [1, 2]) {
        const rng = new Rng(seed);
        const inOrder = new Map(rng.shuffle([...frames.keys()]).map((k) => [k, frames.get(k)]));
        const written = buildGround(inOrder, rng.shuffle(places.slice()), { doorsOf, placeSpan });
        expectSameBytes(await serialise(written.data), file, `seed ${seed}`);
      }
    },
    SLOW,
  );

  // the tool's own command, which loads the game's code through a Vite server rather than
  // through vitest: about 5 s alone
  it(
    'is what `node tools/building-ground.mjs --check` finds, from the command line, and leaves alone',
    () => {
      const said = execFileSync(process.execPath, ['tools/building-ground.mjs', '--check'], {
        encoding: 'utf8',
      });
      expect(said).toContain(`${Object.keys(data).length} frames`);
      expect(readFileSync(GROUND_FILE, 'utf8')).toBe(file);
    },
    SLOW,
  );

  it('writes plain numbers: finite, to two decimals, no negative zero', () => {
    const bad = [];
    const walk = (v, path) => {
      if (typeof v === 'number') {
        if (
          !Number.isFinite(v) ||
          Object.is(v, -0) ||
          Math.abs(v * 100 - Math.round(v * 100)) > 1e-6
        )
          bad.push(`${path} = ${v}`);
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === 'object')
        for (const [key, x] of Object.entries(v)) walk(x, `${path}.${key}`);
    };
    walk(data, 'frames');
    expect(bad, `${bad.length} numbers: ${bad.slice(0, 5)}`).toEqual([]);
    expect(file).not.toMatch(/-0(?![.\d])/);
    expect(JSON.parse(file).version).toBe(1);
  });

  it('is documented where the issue asks: where the data lives, how it is written and read', () => {
    // docs/art-direction/README.md says where the data lives and how to regenerate it (#435)
    const readme = readFileSync('docs/art-direction/README.md', 'utf8');
    const from = readme.indexOf('\n## Building ground data\n');
    expect(from, 'the section "Building ground data"').toBeGreaterThan(-1);
    const to = readme.indexOf('\n## ', from + 1);
    const section = readme.slice(from, to < 0 ? undefined : to);
    for (const file of [
      GROUND_FILE,
      'tools/building-ground.mjs',
      'tools/building-ground.test.mjs',
      'src/art/buildingGround.ts',
    ]) {
      expect(section, `${file} is named`).toContain(file);
      expect(existsSync(file), `${file} exists`).toBe(true);
    }
    // the commands it gives are the commands the tool takes
    const tool = readFileSync('tools/building-ground.mjs', 'utf8');
    expect(section).toContain('node tools/building-ground.mjs ');
    for (const flag of ['--check', '--all', '--sheets']) {
      expect(section, `${flag} is explained`).toContain(flag);
      expect(tool, `the tool takes ${flag}`).toContain(`args.includes('${flag}')`);
    }
    // the frames it names (a name ending in a number, a level or a turn) are in the data
    const named = [
      ...section.matchAll(/`((?:structures\/)?[a-z]+(?:_[a-z]+)*_(?:\d+|lv\d+|r\d)(?:_r\d)?)`/g),
    ].map((m) => m[1]);
    expect(new Set(named).size, `frames named: ${named}`).toBeGreaterThanOrEqual(5);
    for (const name of named)
      expect(
        data[name.includes('/') ? name : `${GROUP}/${name}`],
        `${name} is a frame`,
      ).toBeDefined();
    // and every field of an entry is explained, as a bullet of its own or after a semicolon
    for (const field of Object.keys(Object.values(data)[0]))
      expect(section, `the field ${field} is explained`).toMatch(
        new RegExp(`(^- |; )\`${field}\`:`, 'm'),
      );
  });

  it('has an entry for exactly the frames of the places in src/data, by the renderer family rule', () => {
    // read from src/data and public/assets directly, and the family by the renderer's own rule
    const read = (name) => JSON.parse(readFileSync(`src/data/${name}`, 'utf8'));
    const placed = new Set([
      ...[...read('stations.json').defs, ...read('stations_full.json')].map((d) => d.art),
      ...['buildings.json', 'buildings_full.json'].flatMap((f) =>
        read(f)
          .filter((d) => !d.bridge)
          .map((d) => d.id),
      ),
      ...read('decor.json')
        .filter((d) => !d.onTrack && !d.power)
        .map((d) => d.id),
    ]);
    const atlas = { has: (key) => frames.has(key) };
    const illustrated = new Set(
      Object.keys(JSON.parse(readFileSync(`public/assets/${GROUP}.json`, 'utf8')).frames),
    );
    const families = new Set();
    for (const key of frames.keys()) {
      if (!key.startsWith(`${GROUP}/`)) continue;
      // a depot's frame carries its gate axis: depot_r1, depot_narrow_r0
      const family = structureFamily(unturnedFrame(atlas, key)).replace(
        /^(depot|depot_narrow)_r[01]$/,
        '$1',
      );
      expect(Boolean(data[key]), `${key} (family ${family})`).toBe(placed.has(family));
      if (data[key]) {
        families.add(family);
        expect(data[key].source, key).toBe(illustrated.has(key) ? 'illustrated' : 'generated');
      }
    }
    expect([...families].sort(), 'a def of the data has no frame at all').toEqual(
      [...placed].sort(),
    );
  });

  it('has the whole grid of its footprint, once, and one footprint for every turn of a family', () => {
    const unturned = new Map();
    for (const [key, e] of Object.entries(data)) {
      const w = Math.max(...e.footprint.map((t) => t[0])) + 1;
      const h = Math.max(...e.footprint.map((t) => t[1])) + 1;
      const grid = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grid.push([x, y]);
      expect(e.footprint, key).toEqual(grid);
      // a quarter turn swaps the sides: turned back, every frame of a family is the same size
      const { family } = building(key);
      const size = (e.rot % 2 ? [h, w] : [w, h]).join('x');
      expect(size, `${key} is ${size}, its family ${family} is ${unturned.get(family)}`).toBe(
        unturned.get(family) ?? size,
      );
      unturned.set(family, size);
    }
  });

  it('gives the frame the game draws at a rotation the data of that rotation', () => {
    // as src/game.ts asks: a depot for `structures/<art>_r<rot % 2>` (and `_lv<n>`), anything
    // else for its own frame, then `structureFrame` turns the key to the rotation
    const atlas = { has: (key) => frames.has(key) };
    let asked = 0;
    for (const key of Object.keys(data)) {
      if (unturnedFrame(atlas, key) !== key) continue;
      const axis = /^structures\/depot(?:_narrow)?_r([01])(?:_lv\d+)?$/.exec(key);
      // the toolbar's icon of a depot (`depot_1`) is never drawn on the ground, so never turned
      if (!axis && /^structures\/depot(?:_narrow)?_\d+$/.test(key)) continue;
      for (const want of [0, 1, 2, 3]) {
        if (axis && Number(axis[1]) !== want % 2) continue;
        const drawn = structureFrame(atlas, key, want);
        asked++;
        expect(data[drawn], `${key} turned to ${want} is ${drawn}`).toBeDefined();
        expect(data[drawn].rot, `${key} turned to ${want} is ${drawn}`).toBe(want);
      }
    }
    expect(asked).toBeGreaterThan(300);
  });

  it('puts every door on a point of its wall, inside its tile, where it says', () => {
    let seen = 0;
    for (const [key, e] of Object.entries(data)) {
      const [, east, south, west] = e.foot;
      const w = Math.max(...e.footprint.map((t) => t[0])) + 1;
      const h = Math.max(...e.footprint.map((t) => t[1])) + 1;
      for (const door of e.doors) {
        seen++;
        const [a, b] = door.side === 'S' ? [west, south] : [south, east];
        // how far along the wall from its left end
        const along = (door.point[0] - a[0]) / (b[0] - a[0]);
        expect(along, `${key} door off its wall`).toBeGreaterThan(0);
        expect(along, `${key} door off its wall`).toBeLessThan(1);
        // the offset runs along the tile axis: tile x on the S wall, left to right on the picture,
        // tile y on the E wall, right to left, from the far corner to the near one
        const offset =
          door.side === 'S'
            ? along * w - (door.tile[0] + 0.5)
            : (1 - along) * h - (door.tile[1] + 0.5);
        expect(offset, `${key} door offset`).toBeCloseTo(door.offset, 1);
        // on the wall's foot line, or above it by the step an opening may start on
        const line = a[1] + ((door.point[0] - a[0]) * (b[1] - a[1])) / (b[0] - a[0]);
        expect(line - door.point[1], `${key} door height above its foot`).toBeGreaterThan(-1.5);
        expect(line - door.point[1], `${key} door height above its foot`).toBeLessThan(
          DOOR.touch + 1.5,
        );
        expect(door.width, key).toBeGreaterThanOrEqual(DOOR.minWidth - 0.1);
        expect(door.width, key).toBeLessThanOrEqual(DOOR.maxWidth + 0.1);
      }
      // no two doors of a frame are the same opening
      const points = e.doors.map((d) => d.point.join());
      expect(new Set(points).size, key).toBe(points.length);
    }
    expect(seen).toBeGreaterThan(0);
  });

  /**
   * Frames whose foot is not the shape of their footprint yet: the footprint of eight works grew
   * (F6, #525: tiles are the room a works takes, not the size of its model) while their pictures
   * stayed as they were. The one-tile pictures of a works are near square, and their turned
   * placeholders (`_r1` to `_r3`) are no better. They are repainted to the footprint with the
   * rest of the work on how a picture sits in it (F3, #510); the entry goes with its repaint. The
   * Town Hall and the warehouse stand on 2 x 1 since their 3D models (2026-10-27) and do not turn
   * for now; their old turned placeholders stay in the atlas, square.
   */
  const NOT_THE_FOOTPRINTS_SHAPE = [
    'structures/colliery_lv2_r1',
    'structures/colliery_lv2_r2',
    'structures/colliery_lv2_r3',
    'structures/colliery_r1',
    'structures/colliery_r2',
    'structures/colliery_r3',
    'structures/oil_derrick_r1',
    'structures/oil_derrick_r2',
    'structures/oil_derrick_r3',
    'structures/town_1_r1',
    'structures/town_1_r2',
    'structures/town_1_r3',
    'structures/warehouse_2_r1',
    'structures/warehouse_2_r2',
    'structures/warehouse_2_r3',
    'structures/warehouse_3_r1',
    'structures/warehouse_3_r2',
    'structures/warehouse_3_r3',
    'structures/warehouse_4_r1',
    'structures/warehouse_4_r2',
    'structures/warehouse_4_r3',
    'structures/warehouse_5_r1',
    'structures/warehouse_5_r2',
    'structures/warehouse_5_r3',
  ];

  it('draws the longer side of a footprint as the longer wall of the foot', () => {
    // an oracle for the footprint's orientation that does not share the tool's arithmetic: the S
    // wall runs along x, so a footprint wider than it is deep has the longer S wall, at every turn
    let unequal = 0;
    const stale = new Set(NOT_THE_FOOTPRINTS_SHAPE);
    for (const [key, e] of Object.entries(data)) {
      const w = Math.max(...e.footprint.map((t) => t[0])) + 1;
      const h = Math.max(...e.footprint.map((t) => t[1])) + 1;
      if (w === h) continue;
      unequal++;
      const [, east, south, west] = e.foot;
      const along = { S: south[0] - west[0], E: east[0] - south[0] };
      if (stale.delete(key)) {
        // listed: it must still be wrong, or the list is out of date
        expect(
          Math.sign(along.S - along.E),
          `${key} is listed but now has the footprint's shape: take it off`,
        ).not.toBe(Math.sign(w - h));
        continue;
      }
      expect(
        Math.sign(along.S - along.E),
        `${key}: ${w} x ${h} tiles, walls ${along.S} and ${along.E}`,
      ).toBe(Math.sign(w - h));
    }
    expect([...stale], 'listed frames that are not in the data').toEqual([]);
    expect(unequal).toBeGreaterThan(0);
  });

  it('names each door once, on a tile of its own wall, with the tile across it as `reach`', () => {
    // from the entry alone, so that a door cannot agree with doorsOf and still be misfiled: the S
    // wall is the footprint's last row, the E wall its last column, and `reach` is the tile
    // beyond it, outside the footprint
    const STEP = { S: [0, 1], E: [1, 0] };
    let seen = 0;
    for (const [key, e] of Object.entries(data)) {
      const w = Math.max(...e.footprint.map((t) => t[0])) + 1;
      const h = Math.max(...e.footprint.map((t) => t[1])) + 1;
      const named = new Set();
      for (const door of e.doors) {
        seen++;
        const [x, y] = door.tile;
        const label = `${key}: ${door.kind} door at ${x},${y} on ${door.side}`;
        expect(e.footprint, `${label} is not in the footprint`).toContainEqual([x, y]);
        expect(door.side === 'S' ? y === h - 1 : x === w - 1, `${label} is not on that wall`).toBe(
          true,
        );
        const [dx, dy] = STEP[door.side];
        expect(door.reach, `${label}: reach`).toEqual([x + dx, y + dy]);
        expect(e.footprint, `${label}: reach is inside the footprint`).not.toContainEqual(
          door.reach,
        );
        const id = `${door.kind} ${door.tile} ${door.side}`;
        expect(named.has(id), `${key}: ${id} listed twice`).toBe(false);
        named.add(id);
      }
    }
    expect(seen).toBeGreaterThan(50);
  });

  it("has the front wall where #406's doors are: a platform door on it, a street door on it or across", () => {
    // the front the pictures are made for (S, W, N, E for r0 to r3) and the doors the game has
    // come from two places; a station's platform door is on its front and its street door on the
    // side away from it (D1 of #406), as has a fuel building, whose front stands on the track;
    // every other place has its street door on its front
    let checked = 0;
    for (const [key, e] of Object.entries(data)) {
      const front = DIRS.indexOf(e.front.side);
      for (const { id, kind, def } of building(key).defs) {
        const label = `${key} (${id}, ${kind}) at rotation ${e.rot}`;
        const doors = doorsOf(def, 0, 0, e.rot);
        const street = streetDoor(def, 0, 0, e.rot);
        expect(street, label).toEqual(doors.find((d) => d.kind === 'street'));
        if (kind === 'station') {
          const platform = doors.find((d) => d.kind === 'platform');
          expect(platform?.side, `${label}: platform door`).toBe(front);
          expect(street.side, `${label}: street door`).toBe((front + 2) % 4);
        } else if (def.facesTrack) {
          expect(street.side, `${label}: street door`).toBe((front + 2) % 4);
        } else {
          expect(street.side, `${label}: street door`).toBe(front);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(Object.keys(data).length);
  });

  // slow because it measures every building frame of the atlas again for its findings: 4.3 s alone,
  // so a limit of 120 s
  it(
    'lists for #407 exactly the doors the pictures do not show or place off the middle',
    () => {
      // the findings are what the door art is redone from; here they are derived again from the
      // data and doorsOf alone: a door of the data on a wall the camera sees is either in the
      // entry, off the middle of its tile by more than 0.05 or not, or it is "not seen"
      const { data: made, findings } = buildGround(frames, places, { doorsOf, placeSpan });
      expect(Object.keys(made.frames)).toEqual(Object.keys(data));
      let listed = 0;
      for (const [key, e] of Object.entries(data)) {
        const expected = [];
        for (const door of doorsOf(building(key).defs[0].def, 0, 0, e.rot)) {
          const side = DIRS[door.side];
          if (side !== 'S' && side !== 'E') continue;
          const label = `${door.kind} door at tile ${door.tile.x},${door.tile.y} on ${side}`;
          const found = e.doors.find(
            (d) =>
              d.kind === door.kind &&
              d.side === side &&
              d.tile.join() === `${door.tile.x},${door.tile.y}`,
          );
          if (!found) expected.push(`${label}: not seen`);
          else if (Math.abs(found.offset) > 0.05)
            expected.push(
              `${label}: the picture's door is ${found.offset > 0 ? '+' : ''}${found.offset} tile off the middle`,
            );
        }
        const doorNotes = (findings[key] ?? []).filter((n) => /^(street|platform) door /.test(n));
        expect(doorNotes.sort(), key).toEqual(expected.sort());
        listed += doorNotes.length;
      }
      expect(listed).toBeGreaterThan(100);
    },
    SLOW,
  );

  it("keeps most of each visible wall's foot on the picture, not only its corners", () => {
    // a foot whose corners touch the silhouette but whose walls float over it would pass the
    // corner check; here the columns along the S and E feet each need opaque texels on or just
    // above the line (a bench or a post in front can hide a stretch of the base, not most of it)
    const bare = [];
    for (const [key, e] of Object.entries(data)) {
      if (e.fit !== 'walls') continue;
      const frame = frames.get(key);
      const d = frame.resolution;
      const solid = (x, y) =>
        x >= 0 &&
        y >= 0 &&
        x < frame.w &&
        y < frame.h &&
        frame.data[(y * frame.w + x) * 4 + 3] >= FIT.alpha;
      const [, east, south, west] = e.foot.map((p) => [frame.ax + p[0] * d, frame.ay + p[1] * d]);
      let on = 0;
      let columns = 0;
      for (const [a, b] of [
        [west, south],
        [south, east],
      ])
        for (let x = Math.ceil(a[0]); x < b[0]; x++) {
          const y = Math.floor(a[1] + ((x + 0.5 - a[0]) * (b[1] - a[1])) / (b[0] - a[0]));
          columns++;
          for (let up = -Math.round(0.5 * d); up <= Math.round(1.5 * d); up++)
            if (solid(x, y - up)) {
              on++;
              break;
            }
        }
      if (on < columns / 2) bare.push(`${key} ${on}/${columns}`);
    }
    expect(bare, `feet mostly off the picture: ${bare.slice(0, 5)}`).toEqual([]);
  });

  // slow because it recounts the texels below the foot of every frame of the atlas: 0.38 s alone,
  // so a limit of 30 s
  it('counts what lies below the foot between two counts of the texels, a texel of slack apart', () => {
    // `baked` is the opaque texels below the foot by 1.5 world px, in whole columns from the
    // outer corners. Counted again here by texel centres in world px, the line a texel further
    // down and the columns inside the corners is the least it can be, and the line a texel
    // further up and a column more at each end the most: a bracket as wide as the counting's own
    // rounding, not a tolerance of the foot's width (the flag is at MEASURE.baked, 40)
    const BELOW = 1.5;
    const off = [];
    for (const [key, e] of Object.entries(data)) {
      const frame = frames.get(key);
      const d = frame.resolution;
      const t = 1 / d;
      const [, east, south, west] = e.foot;
      // each wall's own slope, from its corners
      const left = (south[1] - west[1]) / (south[0] - west[0]);
      const right = (south[1] - east[1]) / (east[0] - south[0]);
      const count = (below, from, to) => {
        let texels = 0;
        for (let y = 0; y < frame.h; y++)
          for (let x = 0; x < frame.w; x++) {
            if (frame.data[(y * frame.w + x) * 4 + 3] < FIT.alpha) continue;
            const wx = (x + 0.5 - frame.ax) / d;
            const wy = (y + 0.5 - frame.ay) / d;
            if (wx < from || wx >= to) continue;
            const line =
              wx < south[0] ? west[1] + (wx - west[0]) * left : south[1] - (wx - south[0]) * right;
            if (wy > line + below) texels++;
          }
        return texels / (d * d);
      };
      const least = count(BELOW + t, west[0], east[0]);
      const most = count(BELOW - t, west[0] - t, east[0] + t);
      // and a world px squared for the corners' two decimals
      if (e.baked < least - 1 || e.baked > most + 1)
        off.push(`${key} ${e.baked} / ${least} to ${most}`);
    }
    expect(off, `baked outside a recount's bracket: ${off.slice(0, 5)}`).toEqual([]);
  }, 30_000);

  // measures every frame of the atlas twice: about 5 s alone
  it(
    'is the mirror image of its own foot on the mirror image of every frame',
    () => {
      // the game's turns `_r1` and `_r3` are mirrors of `_r2` and of the generator's own; a foot
      // that picked another volume once mirrored would put a yard on the wrong one
      const flipped = [];
      for (const key of Object.keys(data)) {
        const frame = frames.get(key);
        const foot = measureFoot(frame);
        const back = measureFoot(mirrored(frame));
        let worst = foot.fit === back.fit ? 0 : Infinity;
        for (const [corner, other] of [
          ['n', 'n'],
          ['e', 'w'],
          ['s', 's'],
          ['w', 'e'],
        ])
          worst = Math.max(
            worst,
            Math.hypot(
              back[other][0] - (frame.w - foot[corner][0]),
              back[other][1] - foot[corner][1],
            ) / frame.resolution,
          );
        if (worst > 0.5) flipped.push(`${key} ${worst.toFixed(1)}`);
      }
      expect(
        flipped,
        `${flipped.length} feet change with the mirror: ${flipped.slice(0, 5)}`,
      ).toEqual([]);
    },
    SLOW,
  );

  // measures every frame of the atlas at two or three sizes: about 15 s alone
  it(
    'gives every frame the same foot, in world px, when the same picture is declared at 2 or 3 times its resolution',
    () => {
      // a frame redrawn at another resolution (#407) must not stand on another volume only
      // because its texels are smaller: structures/windmill_r3 at twice its resolution once took
      // the longer of two bases that fit nearly as well and moved 20 world px
      const world = (f, p) => [(p[0] - f.ax) / f.resolution, (p[1] - f.ay) / f.resolution];
      const moved = [];
      for (const key of Object.keys(data)) {
        const frame = frames.get(key);
        const foot = measureFoot(frame);
        // [times, texels moved]: the generated frames at 2 and 3 times and moved by a texel; the
        // illustrated, already at 4, at 8 and moved
        const cases =
          frame.source === 'generated'
            ? [
                [2, 0],
                [3, 0],
                [2, 1],
              ]
            : [
                [2, 0],
                [2, 1],
              ];
        for (const [m, by] of cases) {
          const big = enlarged(frame, m, by);
          const again = measureFoot(big);
          let worst = again?.fit === foot.fit ? 0 : Infinity;
          for (const corner of CORNERS)
            if (again) {
              const [x, y] = world(big, again[corner]);
              const [x0, y0] = world(frame, foot[corner]);
              worst = Math.max(worst, Math.hypot(x - x0, y - y0));
            }
          // a copy that starts where the picture does is measured on the same texels: the same foot
          // to the float; moved by a texel, within the 1 world px the issue allows
          if (worst > (by ? REACH : 1e-6))
            moved.push(`${key} x${m}${by ? ' moved' : ''} ${worst.toFixed(3)}`);
        }
      }
      expect(moved, `${moved.length} feet move: ${moved.slice(0, 5)}`).toEqual([]);
    },
    SLOW,
  );

  it('covers most of the base that building-fit measures for each illustrated picture, and no more', () => {
    // the pipeline lays a picture on its footprint by this base (tools/building-fit.mjs), so it is
    // the independent measure of how much of the picture stands on the ground. The wall foot may
    // be shorter where a picture has stretches that are not walls (a conveyor, a cage), and
    // longer by what the walls reach that the base's own lines do not. The 3D models of the
    // refinery, the diesel refinery and the ironworks (2026-10-27) stand their tanks, pipes and
    // hoppers beside their walls on the ground, which the base takes in and the walls do not.
    const machinery = /^structures\/(refinery|diesel_refinery|ironworks)(_lv\d)?$/;
    const short = [];
    const long = [];
    let illustrated = 0;
    for (const [key, e] of Object.entries(data)) {
      if (e.source !== 'illustrated') continue;
      illustrated++;
      const frame = frames.get(key);
      const base = measureBase({ width: frame.w, height: frame.h, data: frame.data });
      const d = frame.resolution;
      const [from, to] = [e.foot[3][0], e.foot[1][0]].map((x) => frame.ax + x * d);
      if ((to - from) / (base.e[0] - base.w[0]) < 0.6 && !machinery.test(key)) short.push(key);
      if (to - base.e[0] > 20 * d || base.w[0] - from > 20 * d) long.push(key);
    }
    expect(illustrated).toBeGreaterThan(50);
    expect(short.length, `feet under 0.6 of the base: ${short}`).toBeLessThanOrEqual(
      illustrated * 0.1,
    );
    expect(long, 'feet reaching 20 world px past the base').toEqual([]);
  });
});

/* ------------------------------------------------ properties of the measurement */

describe('the foot of a drawn box', () => {
  // each case draws a frame of up to 800 x 800 texels and measures it: about 20 ms alone
  it(
    'is found wherever the box stands, at any size and resolution',
    () => {
      forAll(
        genBox,
        (c) => {
          const { frame, truth } = box(c);
          const foot = measureFoot(frame);
          expect(foot?.fit).toBe('walls');
          for (const corner of ['s', 'w', 'e'])
            within(foot[corner], truth[corner], 1.5 * c.k, corner);
          within(foot.n, truth.n, 2.5 * c.k, 'n');
        },
        { shrink: shrinkBox, seeds: DRAWN, shrinkBudget: SHRINK },
      );
    },
    SLOW,
  );

  it(
    'is found with a lamp post, a bench, ground paint, a shadow and a chimney about it',
    () => {
      const genScene = (rng) => {
        const c = genBox(rng);
        const left = c.sx - c.a;
        const right = c.sx + c.b;
        return {
          ...c,
          lamp: rng.chance(0.6)
            ? { x: rng.int(left + 4, right - 6), drop: rng.int(2, 14), tall: rng.int(30, 50) }
            : null,
          bench: rng.chance(0.6)
            ? { x: rng.int(left + 2, right - 14), drop: rng.int(3, 10) }
            : null,
          strip: rng.chance(0.6) ? { drop: rng.int(3, 6), thick: rng.int(2, 4) } : null,
          shadow: rng.chance(0.6),
          chimney: rng.chance(0.6)
            ? { x: rng.int(left + 10, right - 14), rise: rng.int(10, 20) }
            : null,
        };
      };
      // what a picture has besides walls: none of it is one (a wall rises at least MEASURE.run)
      const scenery =
        (c) =>
        (x, y, { low }) => {
          const { lamp, bench, strip, shadow, chimney } = c;
          const onBox = x >= c.sx - c.a && x < c.sx + c.b;
          if (lamp && x >= lamp.x && x < lamp.x + 2) {
            const bottom = low(lamp.x) + lamp.drop;
            if (y < bottom && y >= bottom - lamp.tall) return [40, 40, 40, 255];
          }
          if (bench && x >= bench.x && x < bench.x + 12) {
            const bottom = low(bench.x) + bench.drop + 4;
            if (y < bottom && y >= bottom - 4) return [90, 60, 30, 255];
          }
          if (strip && onBox) {
            const top = low(x) + strip.drop;
            if (y >= top && y < top + strip.thick) return [200, 190, 150, 255];
          }
          if (shadow && onBox && y >= low(x) && y < low(x) + 10) return [30, 40, 30, FIT.alpha - 1];
          if (chimney && x >= chimney.x && x < chimney.x + 4) {
            const roof = low(chimney.x) - c.h - 20;
            if (y < roof && y >= roof - chimney.rise) return [160, 60, 40, 255];
          }
          return undefined;
        };
      function* shrinkScene(c) {
        for (const key of ['lamp', 'bench', 'strip', 'shadow', 'chimney'])
          if (c[key]) yield { ...c, [key]: null };
        yield* shrinkBox(c);
      }
      const found = (c) => {
        const { frame, truth } = box({ ...c, extra: scenery(c) });
        const foot = measureFoot(frame);
        expect(foot?.fit).toBe('walls');
        for (const corner of ['s', 'w', 'e']) within(foot[corner], truth[corner], 2 * c.k, corner);
      };
      forAll(genScene, found, { shrink: shrinkScene, seeds: DRAWN, shrinkBudget: SHRINK });
      // found by review past these seeds (seed 151 of 1 to 400): a lamp post and a bench against
      // the S wall next to the near corner hide its base there, and the line through the bench's
      // underside pulled the near corner 2.1 px along the E wall
      const reviewed = {
        k: 1,
        a: 16,
        b: 16,
        h: 14,
        sx: 114,
        sy: 165,
        lamp: { x: 107, drop: 3, tall: 49 },
        bench: { x: 101, drop: 5 },
        strip: null,
        shadow: false,
        chimney: null,
      };
      expect(() => found(reviewed), JSON.stringify(reviewed)).not.toThrow();
    },
    SLOW,
  );

  // three measurements of each case, one of them on a frame twice the size
  it(
    'moves with the picture: shifted, mirrored and drawn at twice the resolution',
    () => {
      forAll(
        (rng) => genBox(rng, [1, 2]),
        (c) => {
          const { frame } = box(c);
          const foot = measureFoot(frame);
          // shifted by whole texels, every corner is exactly as far on
          const dx = 3 + (c.a % 7);
          const dy = 2 + (c.b % 5);
          const moved = measureFoot(shifted(frame, dx, dy));
          for (const corner of CORNERS) {
            expect(moved[corner][0], `shifted ${corner}`).toBeCloseTo(foot[corner][0] + dx, 6);
            expect(moved[corner][1], `shifted ${corner}`).toBeCloseTo(foot[corner][1] + dy, 6);
          }
          // mirrored, the left corner is the right one, as far from the other edge of the frame
          const flipped = measureFoot(mirrored(frame));
          for (const [corner, other] of [
            ['n', 'n'],
            ['e', 'w'],
            ['s', 's'],
            ['w', 'e'],
          ])
            within(
              flipped[other],
              [frame.w - foot[corner][0], foot[corner][1]],
              1.5 * c.k,
              `mirrored ${corner}`,
            );
          // the same picture at twice the resolution is the same foot, in world px
          const big = measureFoot(upscaled(frame, 2));
          for (const corner of CORNERS)
            within(
              [big[corner][0] / 2, big[corner][1] / 2],
              foot[corner],
              c.k,
              `doubled ${corner}`,
            );
        },
        { shrink: shrinkBox, seeds: DRAWN, shrinkBudget: SHRINK },
      );
    },
    SLOW,
  );

  // a picture enlarged without new detail is the picture it was made from: the foot is measured
  // on its own texels, so that two volumes that fit nearly as well are not chosen between by the
  // size of the copies (a box drawn at its resolution has detail of its own and is measured as is)
  // 60 cases, each draws a frame, enlarges it and measures both: about 7 s alone
  it(
    'is measured on the texels a picture has: enlarged 2 or 3 times at any offset, the same foot',
    () => {
      forAll(
        (rng) => ({ ...genBox(rng, [1, 2]), m: rng.int(2, 3), by: rng.int(0, 2) }),
        (c) => {
          const { frame } = box(c);
          expect(ownDetail(frame).m, 'a drawn box').toBe(1);
          const foot = measureFoot(frame);
          const by = c.by % c.m;
          const big = shifted(upscaled(frame, c.m), by, by);
          expect(ownDetail(big).m, 'the box enlarged').toBe(c.m);
          const again = measureFoot(big);
          expect(again?.fit, 'fit').toBe(foot.fit);
          for (const corner of CORNERS) {
            expect(again[corner][0], corner).toBeCloseTo(foot[corner][0] * c.m + by, 6);
            expect(again[corner][1], corner).toBeCloseTo(foot[corner][1] * c.m + by, 6);
          }
        },
        {
          shrink: function* (c) {
            if (c.by) yield { ...c, by: 0 };
            if (c.m > 2) yield { ...c, m: 2 };
            yield* shrinkBox(c);
          },
          seeds: DRAWN,
          shrinkBudget: SHRINK,
        },
      );
    },
    SLOW,
  );

  // two equal volumes tie in everything but their place: which one the foot is on must not depend
  // on which end of the picture is looked at first
  it(
    'is the same foot on a picture and on its mirror image, where two volumes look alike',
    () => {
      /** two equal boxes `gap` apart, the second `lift` further back */
      const pair = (c) => {
        const one = box(c).frame;
        const two = box({ ...c, sx: c.sx + c.a + c.b + c.gap, sy: c.sy - c.lift }).frame;
        const data = new Uint8ClampedArray(one.data);
        for (let i = 0; i < data.length; i += 4)
          if (two.data[i + 3] >= SOLID && data[i + 3] < SOLID)
            data.set(two.data.subarray(i, i + 4), i);
        return { ...one, data };
      };
      const least = { k: 1, a: 16, b: 16, h: 14, gap: 2, lift: 0 };
      function* shrinkPair(c) {
        for (const key of Object.keys(least))
          for (const v of shrinkInt(c[key], least[key])) yield { ...c, [key]: v };
      }
      const mirrorsIt = (c) => {
        const frame = pair(c);
        const foot = measureFoot(frame);
        const flipped = measureFoot(mirrored(frame));
        expect(flipped.fit, 'fit of the mirror image').toBe(foot.fit);
        for (const [corner, other] of [
          ['n', 'n'],
          ['e', 'w'],
          ['s', 's'],
          ['w', 'e'],
        ])
          within(
            flipped[other],
            [frame.w - foot[corner][0], foot[corner][1]],
            1.5 * c.k,
            `mirrored ${corner}`,
          );
      };
      // the standard seeds: two equal boxes side by side are rare among the cases, and a cut list
      // missed seed 66
      forAll(
        (rng) => {
          const a = rng.int(16, 40);
          return {
            k: rng.pick([1, 2]),
            a,
            b: rng.int(16, 40),
            h: rng.int(14, 60),
            sx: a + 4,
            sy: rng.int(150, 180),
            gap: rng.int(2, 30),
            lift: rng.pick([0, 0, 4, 10]),
          };
        },
        mirrorsIt,
        { shrink: shrinkPair, seeds: SEEDS, shrinkBudget: SHRINK },
      );
      // found by review (seeds 66 and 160): the near corners of two equal boxes differ by float
      // noise (3e-14 texels) between the picture and its mirror image, which once chose the box
      for (const c of [
        { k: 1, a: 19, b: 19, h: 14, sx: 23, sy: 168, gap: 4, lift: 0 },
        { k: 1, a: 37, b: 37, h: 14, sx: 43, sy: 178, gap: 3, lift: 0 },
      ])
        expect(() => mirrorsIt(c), JSON.stringify(c)).not.toThrow();
    },
    SLOW,
  );

  // an image generator keeps a camera only near the game's: the picture's own ground lines count
  it(
    "finds the whole base of a building drawn on ground lines a little off the game's own",
    () => {
      forAll(
        (rng) => ({
          ...genBox(rng, [1, 2, 4]),
          a: rng.int(28, 64),
          b: rng.int(28, 64),
          slopes: [rng.int(38, 62) / 100, rng.int(38, 62) / 100],
        }),
        (c) => {
          const { frame, truth } = box(c);
          const foot = measureFoot(frame);
          expect(foot?.fit).toBe('walls');
          for (const corner of ['w', 's', 'e'])
            within(foot[corner], truth[corner], 2.5 * c.k, `${corner} of ${c.slopes}`);
        },
        {
          shrink: function* (c) {
            for (const key of ['k', 'a', 'b', 'h'])
              for (const v of shrinkInt(c[key], { k: 1, a: 28, b: 28, h: 14 }[key]))
                yield { ...c, [key]: v };
            if (c.slopes.some((s) => s !== 0.5)) yield { ...c, slopes: [0.5, 0.5] };
          },
          seeds: DRAWN,
          shrinkBudget: SHRINK,
        },
      );
    },
    SLOW,
  );

  it(
    'takes a row of piers for one base, not for one pier',
    () => {
      forAll(
        (rng) => ({
          k: rng.pick([1, 2]),
          a: rng.int(30, 60),
          b: rng.int(30, 60),
          sx: rng.int(90, 110),
          sy: rng.int(150, 170),
          pitch: rng.int(8, 14),
          tall: rng.int(14, 30),
        }),
        (c) => {
          // posts 3 wide on both ground lines, from the far ends in towards a post at the near
          // corner, and one at the far corner; nothing else is drawn
          const posts = [c.sx - 1];
          for (let x = c.sx - c.a; x < c.sx - 4; x += c.pitch) posts.push(x);
          for (let x = c.sx + c.b - 3; x > c.sx + 1; x -= c.pitch) posts.push(x);
          const { frame, truth } = box({
            ...c,
            h: 20,
            extra: (x, y, { low, n }) => {
              const front = posts.some((p) => x >= p && x < p + 3) && y < low(x);
              const back = x >= n[0] - 1 && x < n[0] + 2 && y < n[1];
              const bottom = back ? n[1] : low(x);
              return (front || back) && y >= bottom - c.tall ? [120, 90, 60, 255] : [0, 0, 0, 0];
            },
          });
          const foot = measureFoot(frame);
          expect(foot?.fit).toBe('walls');
          // from the first post to the last, not one stretch of them
          expect(foot.w[0] / c.k, 'left end').toBeLessThanOrEqual(truth.w[0] / c.k + 2);
          expect(foot.e[0] / c.k, 'right end').toBeGreaterThanOrEqual(truth.e[0] / c.k - 2);
          within(foot.s, truth.s, 3 * c.k, 'near corner');
        },
        { seeds: DRAWN, shrinkBudget: SHRINK },
      );
    },
    SLOW,
  );

  // the anchor is the footprint's centre on the ground: walls whose near corner stands above it
  // are on stilts or a roof, and what they stand on is the foot, if the picture shows it
  it(
    'gives no foot to walls that stand above the footprint centre, and one to the same walls on it',
    () => {
      forAll(
        genBox,
        (c) => {
          const above = measureFoot(box({ ...c, ay: (c.sy + MEASURE.floor + 4) * c.k }).frame);
          expect(above, 'walls above the anchor').toBeNull();
          const on = measureFoot(box({ ...c, ay: (c.sy - 8) * c.k }).frame);
          expect(on?.fit, 'the same walls below it').toBe('walls');
        },
        { shrink: shrinkBox, seeds: DRAWN, shrinkBudget: SHRINK },
      );
    },
    SLOW,
  );

  // slow because a stand is drawn and measured at three resolutions: 0.31 s alone, so a limit
  // of 30 s
  it('stands a coal stand on its legs, not on its underside', () => {
    // a body on four legs 3 wide, its underside `lift` above the ground, the anchor on the ground
    for (const k of [1, 2, 4]) {
      const c = { k, a: 14, b: 14, h: 24, sx: 100, sy: 140, lift: 18 };
      const { frame, truth } = box({
        ...c,
        ax: c.sx * k,
        ay: (c.sy + c.lift - 7) * k,
        extra: (x, y, { low, n }) => {
          // the far leg stands behind the near one when the walls are as long
          const legs = [
            [c.sx - c.a, low(x)],
            [c.sx - 1, low(x)],
            [c.sx + c.b - 3, low(x)],
            [n[0] - 1, n[1]],
          ];
          return legs.some(
            ([left, under]) => x >= left && x < left + 3 && y < under + c.lift && y >= under - 2,
          )
            ? [90, 70, 50, 255]
            : undefined;
        },
      });
      const foot = measureFoot(frame);
      // the near corner on the ground, a lift below the body's own
      within(foot.s, [truth.s[0], truth.s[1] + c.lift * k], 2 * k, `near corner at ${k}`);
    }
  }, 30_000);
});

describe('the detail a picture has', () => {
  const opaque = (f, x, y) =>
    x >= 0 && y >= 0 && x < f.w && y < f.h && f.data[(y * f.w + x) * 4 + 3] >= SOLID;

  /**
   * The largest m, up to the resolution, for which the picture is made of m by m blocks, each all
   * opaque or all clear (texels outside the frame are clear), found by trying every m and every
   * place the blocks can start. The slow, obvious answer for what `ownDetail` gets from the gaps
   * between the picture's edges; 1 when no m does.
   */
  function blockSize(f) {
    for (let m = Math.floor(f.resolution); m >= 2; m--)
      for (let ox = 0; ox < m; ox++)
        for (let oy = 0; oy < m; oy++) {
          let blocks = true;
          for (let y = -m; y < f.h + m && blocks; y++)
            for (let x = -m; x < f.w + m && blocks; x++)
              blocks =
                opaque(f, x, y) ===
                opaque(f, ox + Math.floor((x - ox) / m) * m, oy + Math.floor((y - oy) / m) * m);
          if (blocks) return m;
        }
    return 1;
  }

  /**
   * A picture of rectangles on a grid of `w0` by `h0` blocks, each block `q` by `q` texels, the
   * whole `bx`, `by` texels in from the top left and cut `cx`, `cy` short at the right and the
   * bottom, declared at `r` texels per world px. Opaque texels have any alpha from SOLID up and
   * any colour, clear ones sometimes a weaker alpha (a shadow): none of that is in the mask.
   */
  function blocky(c) {
    const noise = new Rng(c.noise);
    return drawn(
      c.w0 * c.q + c.bx - c.cx,
      c.h0 * c.q + c.by - c.cy,
      (x, y) => {
        const lx = Math.floor((x - c.bx) / c.q);
        const ly = Math.floor((y - c.by) / c.q);
        const rgb = [noise.int(0, 255), noise.int(0, 255), noise.int(0, 255)];
        const on = c.rects.some(([x0, y0, x1, y1]) => lx >= x0 && lx < x1 && ly >= y0 && ly < y1);
        return [
          ...rgb,
          on ? noise.int(SOLID, 255) : noise.chance(0.3) ? noise.int(1, SOLID - 1) : 0,
        ];
      },
      { resolution: c.r, ax: c.ax, ay: c.ay },
    );
  }
  const MANY = Array.from({ length: 300 }, (_, i) => i + 1);
  const genBlocky = (rng) => {
    const q = rng.int(1, 4);
    const w0 = rng.int(3, 10);
    const h0 = rng.int(3, 10);
    const rects = [];
    for (let i = rng.int(1, 3); i > 0; i--) {
      const x0 = rng.int(0, w0 - 1);
      const y0 = rng.int(0, h0 - 1);
      rects.push([x0, y0, rng.int(x0 + 1, w0), rng.int(y0 + 1, h0)]);
    }
    const cut = () => (q > 1 && rng.chance(0.3) ? rng.int(1, q - 1) : 0);
    return {
      q,
      w0,
      h0,
      rects,
      bx: rng.int(0, q - 1),
      by: rng.int(0, q - 1),
      cx: cut(),
      cy: cut(),
      r: rng.pick([1, 2, 3, 4, 5, 1.5, 2.5]),
      ax: rng.int(0, 20),
      ay: rng.int(0, 20),
      noise: rng.int(1, 1_000_000),
    };
  };
  function* shrinkBlocky(c) {
    for (const key of ['bx', 'by', 'cx', 'cy'])
      for (const v of shrinkInt(c[key], 0)) yield { ...c, [key]: v };
    for (const [key, least] of [
      ['q', 1],
      ['w0', 3],
      ['h0', 3],
    ])
      for (const v of shrinkInt(c[key], least))
        yield {
          ...c,
          [key]: v,
          // the blocks stay inside the grid and the offsets inside a block
          rects: c.rects
            .map(([x0, y0, x1, y1]) => [
              x0,
              y0,
              Math.min(x1, key === 'w0' ? v : x1),
              Math.min(y1, key === 'h0' ? v : y1),
            ])
            .filter(([x0, y0, x1, y1]) => x1 > x0 && y1 > y0),
          bx: Math.min(c.bx, key === 'q' ? v - 1 : c.bx),
          by: Math.min(c.by, key === 'q' ? v - 1 : c.by),
          cx: Math.min(c.cx, key === 'q' ? v - 1 : c.cx),
          cy: Math.min(c.cy, key === 'q' ? v - 1 : c.cy),
        };
    if (c.rects.length > 1)
      for (let i = 0; i < c.rects.length; i++)
        yield { ...c, rects: c.rects.filter((_, j) => j !== i) };
    yield { ...c, r: 1 };
    yield { ...c, ax: 0, ay: 0 };
  }

  it('is the largest block size the picture is made of, and loses none of the picture', () => {
    forAll(
      genBlocky,
      (c) => {
        const f = blocky(c);
        const own = ownDetail(f);
        const m = own.m;
        expect(m, 'the largest m the picture is made of').toBe(blockSize(f));
        expect(m).toBeLessThanOrEqual(Math.max(1, Math.floor(f.resolution)));
        // declared at exactly the enlargement it has, the picture is found whole
        if (c.r === c.q && !c.cx && !c.cy) expect(m, 'declared at its enlargement').toBe(c.q);
        if (m === 1) {
          expect(own.frame, 'a picture without blocks is measured as it is').toBe(f);
          expect(own.origin).toEqual([0, 0]);
          return;
        }
        const [ox, oy] = own.origin;
        const s = own.frame;
        // the smaller picture starts at or before the corner, less than a block back
        expect(ox <= 0 && ox > -m && oy <= 0 && oy > -m, `origin ${ox},${oy}`).toBe(true);
        expect(s.w, 'width').toBe(Math.ceil((f.w - ox) / m));
        expect(s.h, 'height').toBe(Math.ceil((f.h - oy) / m));
        // the same places in world px: the anchor, the resolution and the middle move with it
        expect(s.resolution * m, 'resolution').toBeCloseTo(f.resolution, 9);
        expect(s.ax * m + ox, 'anchor x').toBeCloseTo(f.ax, 9);
        expect(s.ay * m + oy, 'anchor y').toBeCloseTo(f.ay, 9);
        expect(s.middle * m + ox, 'middle').toBeCloseTo(f.w / 2, 9);
        // every texel of the picture is the texel of its block
        let wrong = null;
        for (let y = 0; y < f.h; y++)
          for (let x = 0; x < f.w; x++)
            if (opaque(s, Math.floor((x - ox) / m), Math.floor((y - oy) / m)) !== opaque(f, x, y))
              wrong ??= `${x},${y}`;
        expect(wrong, 'a texel the smaller picture does not give back').toBeNull();
      },
      { shrink: shrinkBlocky, seeds: MANY, shrinkBudget: SHRINK },
    );
  });

  /**
   * Two boxes side by side on one ground: the second `gap` to the right of the first and `lift`
   * further back, of the first's size when `clone` (two volumes that tie in everything but their
   * place, which is where the foot's choice between them is made), else its own `a2`, `b2`, `h2`.
   * `centred` puts the pair on the frame's middle line (the ties the middle itself cannot break).
   */
  function twin(c) {
    const first = { k: 1, a: c.a, b: c.b, h: c.h, sx: c.sx, sy: c.sy };
    const second = c.clone ? first : { ...first, a: c.a2, b: c.b2, h: c.h2 };
    const sx = c.centred ? 100 - c.b - c.gap / 2 : c.sx;
    const one = box({ ...first, sx }).frame;
    const two = box({
      ...second,
      sx: sx + c.a + c.b + c.gap + (second.a - first.a),
      sy: c.sy - c.lift,
    }).frame;
    const data = new Uint8ClampedArray(one.data);
    for (let i = 0; i < data.length; i += 4)
      if (two.data[i + 3] >= SOLID && data[i + 3] < SOLID) data.set(two.data.subarray(i, i + 4), i);
    return { ...one, data };
  }
  const leastTwin = { a: 16, b: 16, h: 14, gap: 2, lift: 0, a2: 16, b2: 16, h2: 14 };
  const genTwin = (rng) => {
    const a = rng.int(16, 36);
    const centred = rng.chance(0.3);
    return {
      a,
      b: rng.int(16, 36),
      h: rng.int(14, 60),
      sx: a + 4,
      sy: rng.int(150, 180),
      gap: centred ? 2 * rng.int(1, 12) : rng.int(2, 24),
      lift: rng.pick([0, 0, 4, 10]),
      clone: rng.chance(0.5),
      centred,
      a2: rng.int(16, 36),
      b2: rng.int(16, 36),
      h2: rng.int(14, 60),
    };
  };
  function* shrinkTwin(c) {
    if (c.centred) yield { ...c, centred: false };
    if (!c.clone) yield { ...c, clone: true };
    for (const key of Object.keys(leastTwin))
      for (const v of shrinkInt(c[key], leastTwin[key])) yield { ...c, [key]: v };
  }

  // of two volumes that tie in everything else, the foot stands on the one nearer the middle of the
  // picture; a picture that was a crop of a larger one (`ownDetail` makes one) names its own middle
  it("stands on the volume nearer the middle the frame names, the frame's own unless it names another", () => {
    // two equal boxes, their near corners at x 60 and 116 on the same line of the picture's pixels
    const pair = twin({ clone: true, a: 16, b: 16, h: 30, sx: 60, sy: 165, gap: 24, lift: 0 });
    const stands = (middle) => Math.round(measureFoot({ ...pair, middle }).s[0]);
    expect(stands(undefined), "the frame's own middle, 100").toBe(116);
    expect(stands(100)).toBe(116);
    expect(stands(40), 'nearer the left one').toBe(60);
    expect(stands(160), 'nearer the right one').toBe(116);
  });

  /** The picture with every texel made `m` by `m`, moved `bx`, `by` texels in, anchor with it. */
  const declaredAt = (f, m, bx, by) => {
    const big = shifted(upscaled(f, m), bx, by);
    return { ...big, ax: f.ax * m + bx, ay: f.ay * m + by };
  };

  // the choice between two volumes is made on the picture's own texels: it does not change with
  // the size they are copied to, where they start or what is in their alpha and colour
  // 60 cases, each draws a pair of boxes, enlarges it and measures both: about 3 s alone
  it(
    'stands on the same one of two volumes when the picture is declared at 2 or 3 times its resolution',
    () => {
      forAll(
        (rng) => ({ ...genTwin(rng), m: rng.int(2, 3), bx: rng.int(0, 2), by: rng.int(0, 2) }),
        (c) => {
          const frame = twin(c);
          const foot = measureFoot(frame);
          const bx = c.bx % c.m;
          const by = c.by % c.m;
          const again = measureFoot(declaredAt(frame, c.m, bx, by));
          expect(again?.fit, 'fit').toBe(foot.fit);
          for (const corner of CORNERS) {
            expect(again[corner][0], `${corner} x`).toBeCloseTo(foot[corner][0] * c.m + bx, 6);
            expect(again[corner][1], `${corner} y`).toBeCloseTo(foot[corner][1] * c.m + by, 6);
          }
        },
        {
          shrink: function* (c) {
            if (c.bx || c.by) yield { ...c, bx: 0, by: 0 };
            if (c.m > 2) yield { ...c, m: 2 };
            yield* shrinkTwin(c);
          },
          seeds: DRAWN,
          shrinkBudget: SHRINK,
        },
      );
    },
    SLOW,
  );

  /** how far (texels) the foot of the mirror image is from the mirror image of the foot */
  function mirrorGap(frame) {
    const foot = measureFoot(frame);
    const flipped = measureFoot(mirrored(frame));
    if (!foot || !flipped || foot.fit !== flipped.fit) return Infinity;
    let worst = 0;
    for (const [corner, other] of [
      ['n', 'n'],
      ['e', 'w'],
      ['s', 's'],
      ['w', 'e'],
    ])
      worst = Math.max(
        worst,
        Math.hypot(
          flipped[other][0] - (frame.w - foot[corner][0]),
          flipped[other][1] - foot[corner][1],
        ),
      );
    return worst;
  }

  // a picture that is its own mirror image, or nearly (two equal boxes about its middle), has no
  // mirrored foot to find: it stands on one of two volumes that look the same. Of the others, the
  // picture declared at another resolution has the mirrored feet its own texels give.
  // 60 cases, each measures a pair of boxes and its mirror image, enlarged and not: about 4 s alone
  it(
    'is the mirror image of its foot on the mirror image of a picture declared at 2 or 3 times its resolution',
    () => {
      let checked = 0;
      forAll(
        (rng) => ({ ...genTwin(rng), m: rng.int(2, 3), bx: rng.int(0, 2), by: rng.int(0, 2) }),
        (c) => {
          const frame = twin(c);
          if (mirrorGap(frame) > 1.5) return;
          checked++;
          const big = declaredAt(frame, c.m, c.bx % c.m, c.by % c.m);
          expect(mirrorGap(big) / c.m, 'texels of the picture it is made from').toBeLessThanOrEqual(
            1.5,
          );
        },
        {
          shrink: function* (c) {
            if (c.bx || c.by) yield { ...c, bx: 0, by: 0 };
            if (c.m > 2) yield { ...c, m: 2 };
            yield* shrinkTwin(c);
          },
          seeds: DRAWN,
          shrinkBudget: SHRINK,
        },
      );
      expect(checked, 'cases that had a mirrored foot to keep').toBeGreaterThan(DRAWN.length / 2);
    },
    SLOW,
  );
});

describe('the doors of a drawn wall', () => {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  /** a door `width` wide, as tall as its width says a door is, `up` above the foot */
  const doorSize = (rng) => {
    const width = rng.int(3, 9);
    return { width, height: clamp(Math.round(width * rng.range(1.8, 3.2)), 8, 18) };
  };
  /** the wall a door is on, from its left end (`from`) for `length`: the foot's wall for the call */
  const wallOf = (frame, wall) => {
    const foot = measureFoot(frame);
    return wall === 'S' ? [foot.w, foot.s] : [foot.s, foot.e];
  };
  const openings = (frame, wall) => openingsOnWall(frame, ...wallOf(frame, wall));
  /** the opening of a case's size standing on its wall at the column `x` */
  const door = (c, x) => ({ wall: c.wall, x, width: c.width, height: c.height, up: c.up });
  /** the column a door at `at` (0 to 1) along a wall stands on, in world px */
  const columnOf = (c, wall, at) => (wall === 'S' ? c.sx - c.a + at * c.a : c.sx + (1 - at) * c.b);

  const genWall = (rng) => ({
    k: rng.pick([1, 2, 4]),
    a: rng.int(40, 64),
    b: rng.int(40, 64),
    h: rng.int(50, 70),
    sx: rng.int(90, 110),
    sy: rng.int(150, 170),
    wall: rng.pick(['S', 'E']),
  });
  function* shrinkWall(c) {
    for (const key of ['k', 'a', 'b', 'h'])
      for (const v of shrinkInt(c[key], { k: 1, a: 40, b: 40, h: 50 }[key]))
        yield { ...c, [key]: v };
    for (const [key, least] of [
      ['width', 3],
      ['up', 0],
    ])
      if (c[key] !== undefined) for (const v of shrinkInt(c[key], least)) yield { ...c, [key]: v };
  }

  // each case draws a frame of up to 800 x 800 texels, measures its foot and reads a wall
  it(
    'finds a door where it stands, on either wall, up to a step above the foot',
    () => {
      forAll(
        (rng) => ({
          ...genWall(rng),
          ...doorSize(rng),
          at: rng.int(30, 70) / 100,
          up: rng.int(0, 6),
        }),
        (c) => {
          const x = columnOf(c, c.wall, c.at);
          const { frame } = box({ ...c, doors: [door(c, x)] });
          const found = openings(frame, c.wall);
          expect(found, 'openings found').toHaveLength(1);
          const centre = (found[0].from + found[0].to) / 2 / c.k;
          within([centre, 0], [x, 0], 1, 'door centre');
          expect(
            Math.abs((found[0].to - found[0].from) / c.k - c.width),
            'width',
          ).toBeLessThanOrEqual(1.5);
        },
        { shrink: shrinkWall, seeds: DRAWN, shrinkBudget: SHRINK },
      );
    },
    SLOW,
  );

  it(
    'finds two doors on a wall, side by side, in order',
    () => {
      forAll(
        (rng) => ({ ...genWall(rng), ...doorSize(rng) }),
        (c) => {
          const first = columnOf(c, c.wall, 0.3);
          const second = columnOf(c, c.wall, 0.7);
          const doors = [first, second].map((x) => door({ ...c, up: 0 }, x));
          const found = openings(box({ ...c, doors }).frame, c.wall);
          expect(found, 'openings found').toHaveLength(2);
          // left to right on the picture: the S wall's first door is its left one, the E wall's its right
          const centres = found.map((o) => (o.from + o.to) / 2 / c.k);
          const expected = [first, second].sort((p, q) => p - q);
          centres.forEach((centre, i) => within([centre, 0], [expected[i], 0], 1, `door ${i}`));
        },
        { shrink: shrinkWall, seeds: DRAWN, shrinkBudget: SHRINK },
      );
    },
    SLOW,
  );

  it(
    'takes an opening high on the wall for a window, not a door',
    () => {
      forAll(
        (rng) => ({
          ...genWall(rng),
          ...doorSize(rng),
          at: rng.int(30, 70) / 100,
          up: rng.int(14, 22),
        }),
        (c) => {
          const x = columnOf(c, c.wall, c.at);
          const { frame } = box({ ...c, doors: [door(c, x)] });
          expect(openings(frame, c.wall), 'openings found').toHaveLength(0);
        },
        { shrink: shrinkWall, seeds: DRAWN, shrinkBudget: SHRINK },
      );
    },
    SLOW,
  );

  // sixteen frames of up to 800 x 800 texels, drawn and measured
  it(
    'takes an opening too wide, too squat, too low or too tall for a door',
    () => {
      const shapes = {
        wide: [DOOR.maxWidth + 3, 14],
        squat: [10, Math.round(10 * DOOR.aspect[0]) - 3],
        low: [5, DOOR.minHeight - 2],
        tall: [6, DOOR.maxHeight + 6],
      };
      for (const [name, [width, height]] of Object.entries(shapes))
        for (const wall of ['S', 'E'])
          for (const k of [1, 4]) {
            const c = { k, a: 64, b: 64, h: 60, sx: 100, sy: 165, wall };
            const { frame } = box({
              ...c,
              doors: [{ wall, x: columnOf(c, wall, 0.5), width, height, up: 0 }],
            });
            expect(
              openings(frame, wall),
              `${name} ${width}x${height} on ${wall} at ${k}`,
            ).toHaveLength(0);
          }
    },
    SLOW,
  );
});

describe('the data of a drawn building', () => {
  const FOOTPRINTS = [
    { w: 1, h: 1 },
    { w: 2, h: 1, long: true },
    { w: 2, h: 2, size: 2 },
  ];
  /** a place def with the doors given, as src/data holds them: tile [dx, dy] and side, at rotation 0 */
  const defOf = (fp, doors) => ({
    accepts: [],
    ...(fp.long && { long: true }),
    ...(fp.size && { size: fp.size }),
    doors,
  });
  /** a tile on the edge of a footprint that faces `side` */
  const edgeTile = (fp, side, rng) => {
    const x = rng.int(0, fp.w - 1);
    const y = rng.int(0, fp.h - 1);
    return { N: [x, 0], S: [x, fp.h - 1], W: [0, y], E: [fp.w - 1, y] }[side];
  };
  const genPlace = (rng) => {
    const fp = rng.pick(FOOTPRINTS);
    const street = rng.pick(DIRS);
    const doors = [{ kind: 'street', tile: edgeTile(fp, street, rng), side: street }];
    const other = rng.pick(DIRS);
    const platform = { kind: 'platform', tile: edgeTile(fp, other, rng), side: other };
    if (
      rng.chance(0.5) &&
      (platform.side !== street || platform.tile.join() !== doors[0].tile.join())
    )
      doors.push(platform);
    // how far each door stands from the middle of its tile, in tiles, along the tile axis
    const shifts = doors.map(() => rng.int(-20, 20) / 100);
    return { fp, doors, shifts, rot: rng.int(0, 3), k: rng.pick([1, 2]) };
  };
  function* shrinkPlace(c) {
    if (c.doors.length > 1)
      yield { ...c, doors: c.doors.slice(0, 1), shifts: c.shifts.slice(0, 1) };
    yield { ...c, shifts: c.shifts.map(() => 0) };
    for (const rot of shrinkInt(c.rot, 0)) yield { ...c, rot };
    for (const k of shrinkInt(c.k, 1)) yield { ...c, k };
  }

  const ANCHOR = [100, 160];
  /**
   * Where the picture of a place has a door on its wall, in world px, from the isometric ground
   * alone: on the S wall, running left to right, tile x goes with the screen; on the E wall, whose
   * left end is the near corner, tile y runs against it. `shift` is in tiles along the tile axis.
   */
  const standsAt = (door, shift, { W, H, sx, a, b }) =>
    DIRS[door.side] === 'S'
      ? sx - a + ((door.tile.x + 0.5 + shift) / W) * a
      : sx + (1 - (door.tile.y + 0.5 + shift) / H) * b;
  /** The place drawn with its doors where `place(door, index, geometry)` says, and measured. */
  const draw = (c, place) => {
    const odd = c.rot % 2;
    const geometry = { W: odd ? c.fp.h : c.fp.w, H: odd ? c.fp.w : c.fp.h, sx: 100 };
    geometry.a = geometry.W * 30;
    geometry.b = geometry.H * 30;
    const def = defOf(c.fp, c.doors);
    const wall = (door) => DIRS[door.side];
    const doors = doorsOf(def, 0, 0, c.rot)
      .map((door, i) => ({ door, i, x: place(door, i, geometry) }))
      .filter((p) => wall(p.door) === 'S' || wall(p.door) === 'E');
    const { frame, truth } = box({
      k: c.k,
      a: geometry.a,
      b: geometry.b,
      h: 60,
      sx: geometry.sx,
      sy: 170,
      ax: ANCHOR[0] * c.k,
      ay: ANCHOR[1] * c.k,
      doors: doors.map((p) => ({
        wall: wall(p.door),
        x: p.x,
        width: 6,
        height: 14,
        up: c.up ?? 0,
      })),
    });
    const info = { rot: c.rot, defs: [{ def }] };
    const measured = measureFrame(frame, info, { doorsOf, placeSpan });
    return { ...measured, frame, info, doors, truth, W: geometry.W, H: geometry.H };
  };

  // each case draws a frame of up to 400 x 400 texels and measures it
  it(
    'has the footprint, the foot from the anchor and each visible door in its own tile',
    () => {
      forAll(
        genPlace,
        (c) => {
          const { entry, doors, truth, W, H } = draw(c, (door, i, g) =>
            standsAt(door, c.shifts[i], g),
          );
          expect(entry, 'an entry').not.toBeNull();
          // the foot in world px from the anchor
          CORNERS.forEach((corner, i) =>
            within(
              entry.foot[i],
              [truth[corner][0] / c.k - ANCHOR[0], truth[corner][1] / c.k - ANCHOR[1]],
              1.5,
              `foot ${corner}`,
            ),
          );
          const tiles = [];
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) tiles.push([x, y]);
          expect(entry.footprint).toEqual(tiles);
          expect(entry.front.side).toBe(['S', 'W', 'N', 'E'][c.rot]);
          // the front wall's two foot corners in tile order, and whether the camera sees it
          const edge = { S: [3, 2], W: [0, 3], N: [0, 1], E: [1, 2] }[entry.front.side];
          expect(entry.front.edge, 'front edge').toEqual(edge.map((i) => entry.foot[i]));
          expect(entry.front.visible).toBe(['S', 'E'].includes(entry.front.side));
          // nothing is painted below the foot
          expect(entry.baked, 'baked').toBe(0);
          // one door for each door of the data on a wall the camera sees, in its own tile
          expect(
            entry.doors.map((d) => [d.kind, d.tile, d.side, d.reach]),
            'doors found',
          ).toEqual(
            doors.map(({ door }) => [
              door.kind,
              [door.tile.x, door.tile.y],
              DIRS[door.side],
              [door.reach.x, door.reach.y],
            ]),
          );
          entry.doors.forEach((found, j) => {
            // where it stands, and how far from its tile's middle, along the tile axis
            const painted = doors[j];
            expect(
              Math.abs(found.point[0] - (painted.x - ANCHOR[0])),
              `point of door ${j}`,
            ).toBeLessThanOrEqual(1);
            expect(found.offset, `offset of door ${j}`).toBeCloseTo(c.shifts[painted.i], 1);
          });
        },
        { shrink: shrinkPlace, seeds: SEEDS, shrinkBudget: SHRINK },
      );
    },
    SLOW,
  );

  // the entry of a picture is in world px, so the same picture declared at 2 or 3 times its
  // resolution, at any offset, has the same entry: the foot to its two decimals, the doors where
  // they were, to within the texel they are found on
  // 60 cases, each draws a place, enlarges it and measures its entry twice: about 3 s alone
  it(
    'gives the picture declared at 2 or 3 times its resolution the entry it has',
    () => {
      let compared = 0;
      forAll(
        (rng) => ({ ...genPlace(rng), k: 1, m: rng.int(2, 3), by: rng.int(0, 2) }),
        (c) => {
          const { entry, frame, info } = draw(c, (door, i, g) => standsAt(door, c.shifts[i], g));
          const by = c.by % c.m;
          const again = measureFrame(enlarged(frame, c.m, by), info, { doorsOf, placeSpan }).entry;
          expect(again, 'an entry').not.toBeNull();
          for (const key of ['source', 'rot', 'footprint', 'fit'])
            expect(again[key], key).toEqual(entry[key]);
          expect(again.front.side).toBe(entry.front.side);
          expect(again.front.visible).toBe(entry.front.visible);
          for (const [i, corner] of entry.foot.entries()) {
            expect(again.foot[i][0], `foot ${CORNERS[i]} x`).toBeCloseTo(corner[0], 1);
            expect(again.foot[i][1], `foot ${CORNERS[i]} y`).toBeCloseTo(corner[1], 1);
          }
          entry.front.edge.forEach((p, i) => {
            expect(again.front.edge[i][0], `front edge ${i} x`).toBeCloseTo(p[0], 1);
            expect(again.front.edge[i][1], `front edge ${i} y`).toBeCloseTo(p[1], 1);
          });
          expect(again.baked, 'baked').toBeCloseTo(entry.baked, 0);
          expect(
            again.doors.map((d) => [d.kind, d.tile, d.side, d.reach]),
            'doors found',
          ).toEqual(entry.doors.map((d) => [d.kind, d.tile, d.side, d.reach]));
          entry.doors.forEach((door, j) => {
            compared++;
            const other = again.doors[j];
            within(other.point, door.point, 1, `point of door ${j}`);
            expect(Math.abs(other.width - door.width), `width of door ${j}`).toBeLessThanOrEqual(1);
            expect(other.offset, `offset of door ${j}`).toBeCloseTo(door.offset, 1);
          });
        },
        {
          shrink: function* (c) {
            if (c.by) yield { ...c, by: 0 };
            if (c.m > 2) yield { ...c, m: 2 };
            yield* shrinkPlace(c);
          },
          seeds: DRAWN,
          shrinkBudget: SHRINK,
        },
      );
      expect(compared, 'doors compared').toBeGreaterThan(30);
    },
    SLOW,
  );

  // a door that stands on a step has its point where the step meets the ground, `up` above the foot
  // 100 cases, each draws a place of up to 400 x 400 texels and measures it: about 2 s alone
  it(
    'puts the point of a door at the foot of its opening, up to a step above the foot of its wall',
    () => {
      let seen = 0;
      forAll(
        (rng) => ({ ...genPlace(rng), up: rng.int(0, 6) }),
        (c) => {
          const { entry } = draw(c, (door, i, g) => standsAt(door, c.shifts[i], g));
          for (const found of entry.doors) {
            seen++;
            const [a, b] =
              found.side === 'S' ? [entry.foot[3], entry.foot[2]] : [entry.foot[2], entry.foot[1]];
            const line = a[1] + ((found.point[0] - a[0]) * (b[1] - a[1])) / (b[0] - a[0]);
            expect(line - found.point[1], `rise above the foot, up ${c.up}`).toBeGreaterThanOrEqual(
              c.up - 1,
            );
            expect(line - found.point[1], `rise above the foot, up ${c.up}`).toBeLessThanOrEqual(
              c.up + 1,
            );
          }
        },
        {
          shrink: function* (c) {
            for (const up of shrinkInt(c.up, 0)) yield { ...c, up };
            yield* shrinkPlace(c);
          },
          seeds: SEEDS,
          shrinkBudget: SHRINK,
        },
      );
      expect(seen, 'doors measured').toBeGreaterThan(30);
    },
    SLOW,
  );

  // slow because boxes are drawn and measured at three resolutions: 0.46 s alone, so a limit
  // of 30 s
  it('counts what is painted below the foot in world px squared, at any resolution', () => {
    const def = defOf(FOOTPRINTS[0], [{ kind: 'street', tile: [0, 0], side: 'S' }]);
    const info = { rot: 0, defs: [{ def }] };
    // two benches of 12 x 4 world px, a few px under the near corner, and a clean box
    const bench = (x0) => (x, y) =>
      x >= x0 && x < x0 + 12 && y >= 169 && y < 173 ? [90, 60, 30, 255] : undefined;
    for (const k of [1, 2, 4]) {
      const baked = (extra) => {
        const { frame } = box({ k, a: 40, b: 40, h: 50, sx: 100, sy: 165, extra });
        return measureFrame(frame, info, { doorsOf, placeSpan }).entry.baked;
      };
      expect(baked(undefined), `clean at ${k}`).toBe(0);
      expect(baked(bench(94)), `one bench at ${k}`).toBe(48);
      expect(
        baked((x, y) => bench(80)(x, y) ?? bench(108)(x, y)),
        `two benches at ${k}`,
      ).toBe(96);
    }
  }, 30_000);

  it(
    'does not take a door in the next tile along the wall for the one in its own',
    () => {
      forAll(
        (rng) => {
          const fp = rng.pick(FOOTPRINTS);
          const side = rng.pick(DIRS);
          return {
            fp,
            side,
            tile: edgeTile(fp, side, rng),
            rot: rng.int(0, 3),
            k: rng.pick([1, 2]),
          };
        },
        (c) => {
          const doors = [{ kind: 'street', tile: c.tile, side: c.side }];
          const [door] = doorsOf(defOf(c.fp, doors), 0, 0, c.rot);
          const wall = DIRS[door.side];
          const tiles = c.rot % 2 ? [c.fp.h, c.fp.w] : [c.fp.w, c.fp.h];
          // only the walls the camera sees, and only when the wall has another tile
          const along = wall === 'S' ? tiles[0] : tiles[1];
          if ((wall !== 'S' && wall !== 'E') || along < 2) return;
          // painted in the middle of the next tile of the same wall instead
          const axis = wall === 'S' ? 'x' : 'y';
          const next = { ...door, tile: { ...door.tile, [axis]: (door.tile[axis] + 1) % along } };
          const { entry } = draw({ ...c, doors }, (_, __, g) => standsAt(next, 0, g));
          expect(entry.doors, `door ${door.tile.x},${door.tile.y} on ${wall}`).toEqual([]);
        },
        { seeds: SEEDS, shrinkBudget: SHRINK },
      );
    },
    SLOW,
  );
});

describe('the sheets that show what was measured', () => {
  // the colours docs/art-direction/README.md names: walls the camera sees in magenta, the two it
  // does not in cyan, the front wall in orange, doors in green, the anchor in red
  const INK = {
    wall: [255, 0, 255],
    hidden: [0, 230, 230],
    front: [255, 140, 0],
    door: [0, 255, 0],
    anchor: [255, 0, 0],
  };
  const AT = [100, 160];
  const drawnPlace = (rot) => {
    const def = { accepts: [], doors: [{ kind: 'street', tile: [0, 0], side: 'S' }] };
    const { frame } = box({
      k: 1,
      a: 40,
      b: 40,
      h: 50,
      sx: 100,
      sy: 165,
      ax: AT[0],
      ay: AT[1],
      doors: [{ wall: 'S', x: 80, width: 6, height: 14, up: 0 }],
    });
    const { entry } = measureFrame(frame, { rot, defs: [{ def }] }, { doorsOf, placeSpan });
    return { frame, entry };
  };
  /** the pixels of a sheet that are exactly this colour, [x, y] each */
  const inked = (sheet, rgb) => {
    const out = [];
    for (let y = 0; y < sheet.height; y++)
      for (let x = 0; x < sheet.width; x++) {
        const i = (y * sheet.width + x) * 4;
        if (rgb.every((v, c) => sheet.data[i + c] === v)) out.push([x, y]);
      }
    return out;
  };
  /** how far a pixel is from the segment a-b (the ends included), in px */
  const toSegment = ([x, y], a, b) => {
    const long = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
    const t = Math.max(
      0,
      Math.min(1, ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / long),
    );
    return Math.hypot(x - (a[0] + t * (b[0] - a[0])), y - (a[1] + t * (b[1] - a[1])));
  };
  /** the pixels all lie on the segment, and there are as many as it is wide */
  const lineOf = (pixels, a, b, label) => {
    expect(pixels.length, `${label}: pixels`).toBeGreaterThanOrEqual(Math.abs(b[0] - a[0]));
    for (const p of pixels)
      expect(toSegment(p, a, b), `${label}: ${p} is off the line`).toBeLessThanOrEqual(1);
  };

  it('draws the foot, the front wall, the door and the anchor where the entry says', () => {
    // one frame to a sheet at scale 1: the frame's corner is 3 px in from the sheet's
    const { frame, entry } = drawnPlace(0);
    const sheet = sheetOf(new Map([['k', frame]]), { k: entry }, ['k'], { scale: 1, cols: 1 });
    const at = (p) => [3 + AT[0] + p[0], 3 + AT[1] + p[1]];
    const [n, e, s, w] = entry.foot.map(at);
    // the front is the S wall at rotation 0: orange over the wall's own colour
    lineOf(inked(sheet, INK.front), w, s, 'front');
    lineOf(inked(sheet, INK.wall), s, e, 'E wall');
    // each of the two is as many pixels as it is wide, less the corners that others cover
    expect(
      inked(sheet, INK.hidden).length,
      'the walls the camera does not see',
    ).toBeGreaterThanOrEqual(Math.abs(e[0] - n[0]) + Math.abs(n[0] - w[0]) - 5);
    for (const p of inked(sheet, INK.hidden))
      expect(Math.min(toSegment(p, n, e), toSegment(p, n, w)), `hidden ${p}`).toBeLessThanOrEqual(
        1,
      );
    // the door: a green line up from its point
    expect(entry.doors, 'the door was found').toHaveLength(1);
    const [dx, dy] = at(entry.doors[0].point);
    const green = inked(sheet, INK.door);
    expect(green, 'the door line').toContainEqual([Math.round(dx), Math.round(dy)]);
    expect(green.length).toBe(10);
    for (const [x, y] of green) {
      expect(x).toBe(Math.round(dx));
      expect(y).toBeLessThanOrEqual(Math.round(dy));
    }
    // the anchor: a cross of five px, on top of everything else
    const cross = [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].map(([x, y]) => [3 + AT[0] + x, 3 + AT[1] + y]);
    expect(inked(sheet, INK.anchor).sort()).toEqual(cross.sort());
  });

  it('draws the front wall over a hidden wall when the building faces away', () => {
    // at rotation 1 the front is W, the n-w edge
    const { frame, entry } = drawnPlace(1);
    const sheet = sheetOf(new Map([['k', frame]]), { k: entry }, ['k'], { scale: 1, cols: 1 });
    const at = (p) => [3 + AT[0] + p[0], 3 + AT[1] + p[1]];
    const [n, , s, w] = entry.foot.map(at);
    expect(entry.front.visible).toBe(false);
    lineOf(inked(sheet, INK.front), n, w, 'front');
    // the S wall keeps its own colour
    expect(inked(sheet, INK.wall).length).toBeGreaterThan(Math.abs(s[0] - w[0]));
  });

  it('pages the frames of each source: 60 generated and 40 illustrated to a sheet', () => {
    const tiny = drawn(24, 24, (x, y) =>
      y > 6 && y < 20 && x > 3 && x < 20 ? [90, 90, 90, 255] : null,
    );
    const entry = (source) => ({
      source,
      foot: [
        [0, -6],
        [8, -2],
        [0, 2],
        [-8, -2],
      ],
      front: {
        side: 'S',
        edge: [
          [-8, -2],
          [0, 2],
        ],
        visible: true,
      },
      doors: [],
    });
    const frames = new Map();
    const data = {};
    for (const [source, count] of [
      ['generated', 72],
      ['illustrated', 41],
    ])
      for (let i = 0; i < count; i++) {
        frames.set(`${source}/${i}`, { ...tiny, source });
        data[`${source}/${i}`] = entry(source);
      }
    const dir = mkdtempSync(join(tmpdir(), 'building-ground-sheets-'));
    try {
      writeSheets(frames, data, join(dir, 'sheets'));
      const names = [
        'generated-1.png',
        'generated-2.png',
        'illustrated-1.png',
        'illustrated-2.png',
      ];
      expect(readdirSync(join(dir, 'sheets')).sort()).toEqual(names);
      // a page is `cols` cells wide and as many rows as its frames need; a cell is the biggest
      // frame at the source's scale and 6 px
      const size = (name) => {
        const png = PNG.sync.read(readFileSync(join(dir, 'sheets', name)));
        return [png.width, png.height];
      };
      expect(size('generated-1.png')).toEqual([12 * (24 * 3 + 6), 5 * (24 * 3 + 6)]);
      expect(size('generated-2.png')).toEqual([12 * (24 * 3 + 6), 24 * 3 + 6]);
      expect(size('illustrated-1.png')).toEqual([10 * (24 * 0.5 + 6), 4 * (24 * 0.5 + 6)]);
      expect(size('illustrated-2.png')).toEqual([10 * (24 * 0.5 + 6), 24 * 0.5 + 6]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------ the data against measures the tool does not make */

describe(`the ground data of the ${GROUP} frames against measures of their own`, () => {
  let frames, places, data;
  beforeAll(() => {
    frames = atlasFrames(generateStructuresAtlas);
    places = placeDefs();
    data = JSON.parse(readFileSync(GROUND_FILE, 'utf8')).frames;
  }, SLOW);

  /** the footprint's size in tiles, at the entry's rotation */
  const sizeOf = (e) => ({
    W: Math.max(...e.footprint.map((t) => t[0])) + 1,
    H: Math.max(...e.footprint.map((t) => t[1])) + 1,
  });
  /**
   * A point in world px from the anchor as tiles from the footprint's corner, on the game's own
   * projection (`worldToTile`, src/engine/iso.ts). The anchor is the footprint's centre, so the
   * footprint is 0 to W by 0 to H there, whatever the tool measured.
   */
  const inTiles = (p, { W, H }) => {
    const t = worldToTile(p[0], p[1]);
    return [t.x + W / 2, t.y + H / 2];
  };

  it("keeps each foot corner near its footprint and each door in its own tile, on the game's projection", () => {
    // a picture is never exactly its footprint (the README: the foot can be off the anchor by what
    // the picture is off its footprint), but a foot corner more than half a tile out stands past
    // the middle of the next tile, and a door more than a quarter tile out of its tile is in
    // another one. Today's widest are 0.37 (the illustrated station_4) and 0.0 (a door).
    const far = [];
    let doors = 0;
    for (const [key, e] of Object.entries(data)) {
      const size = sizeOf(e);
      for (const [i, p] of e.foot.entries()) {
        const [u, v] = inTiles(p, size);
        const out = Math.max(-u, u - size.W, -v, v - size.H);
        if (out > 0.5) far.push(`${key} ${'nesw'[i]} corner ${out.toFixed(2)} tiles out`);
      }
      for (const door of e.doors) {
        doors++;
        const [u, v] = inTiles(door.point, size);
        const [x, y] = door.tile;
        const out = Math.max(x - u, u - (x + 1), y - v, v - (y + 1));
        if (out > 0.25)
          far.push(
            `${key} ${door.kind} door at ${door.tile} on ${door.side} ${out.toFixed(2)} out`,
          );
      }
    }
    expect(far, `${far.length} points out of place: ${far.slice(0, 5)}`).toEqual([]);
    expect(doors).toBeGreaterThan(50);
  });

  /**
   * How far (world px) the foot's walls stand below the lowest foot the renderer finds in each
   * column of the picture (`footContour`, src/render/groundFit.ts: Rendering's own reading of
   * where walls meet the ground, from the alpha alone), sorted, over the columns the contour has
   * between the foot's outer corners. Negative where the foot is above the contour.
   */
  function belowContour(key, e) {
    const f = frames.get(key);
    const d = f.resolution;
    const contour = footContour({ data: f.data, width: f.w, height: f.h, density: d });
    const [, east, south, west] = e.foot.map((p) => [f.ax + p[0] * d, f.ay + p[1] * d]);
    const left = (south[1] - west[1]) / (south[0] - west[0]);
    const right = (south[1] - east[1]) / (east[0] - south[0]);
    const out = [];
    for (let x = 0; x < f.w; x++) {
      const at = x + 0.5;
      if (contour[x] < 0 || at < west[0] || at > east[0]) continue;
      const line =
        at < south[0] ? west[1] + (at - west[0]) * left : south[1] - (at - south[0]) * right;
      out.push((line - (contour[x] + 1)) / d);
    }
    return out.sort((p, q) => p - q);
  }

  it("never stands lower than the renderer's foot contour, and on it where no ground is baked in", () => {
    // two measures of one thing, made by different code on the same alpha (the contour is the
    // lowest wall run of each column, the foot the base of the walls): the walls cannot stand
    // below the lowest of them. Where the picture has no ground painted under its walls
    // (`baked` under MEASURE.baked) the two are the same line, and a foot that drifted up into
    // the wall face, or onto another volume, would leave it. Where ground is painted in, the
    // contour is the painted edge and the foot is above it by design.
    const below = [];
    const off = [];
    let columns = 0;
    let clean = 0;
    for (const [key, e] of Object.entries(data)) {
      const devs = belowContour(key, e);
      if (devs.length < 8) continue;
      columns++;
      const signed = devs[Math.floor(devs.length / 2)];
      // today's highest is 1.25 (the generated townhouse_s2 turns)
      if (signed > 2) below.push(`${key} ${signed.toFixed(2)} below`);
      if (e.fit !== 'walls' || e.baked >= MEASURE.baked) continue;
      clean++;
      const apart = devs.map(Math.abs).sort((p, q) => p - q)[Math.floor(devs.length / 2)];
      // today's widest is 1.5 (the illustrated ironworks, the generated quarry turns)
      if (apart > 3) off.push(`${key} ${apart.toFixed(2)} apart (baked ${e.baked})`);
    }
    expect(below, `${below.length} feet below the contour: ${below.slice(0, 5)}`).toEqual([]);
    expect(off, `${off.length} feet off the contour: ${off.slice(0, 5)}`).toEqual([]);
    // not vacuous: most frames have a contour to compare with, and most are clean
    expect(columns).toBeGreaterThan(350);
    expect(clean).toBeGreaterThan(250);
  });

  it('gives the placeholder turn that is another frame mirrored the mirror image of its foot', () => {
    // src/art/structures.ts `addTurns`: `_r1` is `_r2` mirrored and `_r3` is the unturned frame
    // mirrored, the anchor mirrored with the picture so that it stands on the same footprint
    // point. Where the two pictures are mirror images (the alpha, the size and the anchor), their
    // entries must be as well: the corners in the mirror's order, the fit, the ground baked in.
    const mirrorImages = (a, b) => {
      if (a.w !== b.w || a.h !== b.h || a.resolution !== b.resolution) return false;
      if (a.ax + b.ax !== a.w || a.ay !== b.ay) return false;
      for (let y = 0; y < a.h; y++)
        for (let x = 0; x < a.w; x++)
          if (
            a.data[(y * a.w + x) * 4 + 3] >= SOLID !==
            b.data[(y * b.w + (b.w - 1 - x)) * 4 + 3] >= SOLID
          )
            return false;
      return true;
    };
    const off = [];
    let pairs = 0;
    for (const key of Object.keys(data)) {
      const turn = /^(.*)_r([13])$/.exec(key);
      if (!turn) continue;
      const other = turn[2] === '1' ? `${turn[1]}_r2` : turn[1];
      if (!data[other] || !mirrorImages(frames.get(key), frames.get(other))) continue;
      pairs++;
      const [n, e, s, w] = data[other].foot;
      const mirror = [n, w, s, e].map((p) => [-p[0], p[1]]);
      let worst = 0;
      for (const [i, p] of data[key].foot.entries())
        worst = Math.max(worst, Math.hypot(p[0] - mirror[i][0], p[1] - mirror[i][1]));
      const label = `${key} and ${other}`;
      if (worst > 0.05) off.push(`${label}: corners ${worst.toFixed(2)} px from mirrored`);
      if (data[key].fit !== data[other].fit) off.push(`${label}: fit ${data[key].fit}`);
      if (Math.abs(data[key].baked - data[other].baked) > 1)
        off.push(`${label}: baked ${data[key].baked} and ${data[other].baked}`);
    }
    expect(off, `${off.length} pairs differ: ${off.slice(0, 5)}`).toEqual([]);
    // most of the generated families' turns are such pairs (a depot's turns are half turns)
    expect(pairs).toBeGreaterThan(60);
  });

  // runs the tool over every frame of the atlas once more: about 4 s alone
  it(
    'lists each finding once, under its kind, with a count for each kind',
    () => {
      const mods = { doorsOf, placeSpan };
      const { data: made, findings } = buildGround(frames, places, mods);
      const frameCount = Object.keys(made.frames).length;
      const lines = report(findings, frameCount).split('\n');
      const gap = lines.indexOf('');
      const head = lines.slice(0, gap);
      const listed = lines.slice(gap + 1);
      const all = Object.entries(findings).flatMap(([key, notes]) =>
        notes.map((n) => `${key}: ${n}`),
      );
      expect(listed, 'every finding, in order, once').toEqual(all);
      expect(all.length, 'findings').toBeGreaterThan(100);
      expect(head[0]).toBe(
        `${frameCount} building frames, ${Object.keys(findings).length} with findings`,
      );
      const counted = head.slice(1).map((line) => Number(line.trim().split(/\s+/)[0]));
      expect(
        counted.every((n) => Number.isInteger(n) && n > 0),
        'a count for each kind',
      ).toBe(true);
      expect(
        counted.reduce((sum, n) => sum + n, 0),
        'the kinds count every finding',
      ).toBe(all.length);
      // and a finding is what the data says: ground baked in, a silhouette for a foot, and nothing
      // for a frame without an entry
      for (const [key, e] of Object.entries(data)) {
        const notes = findings[key] ?? [];
        expect(
          notes.some((n) => n.startsWith('baked ground')),
          `${key}: baked ${e.baked}`,
        ).toBe(e.baked >= MEASURE.baked);
        expect(
          notes.some((n) => n.startsWith('foot: no straight base')),
          `${key}: fit ${e.fit}`,
        ).toBe(e.fit === 'outline');
        expect(
          notes.some((n) => n.startsWith('no foot')),
          `${key}: no foot`,
        ).toBe(false);
      }
      expect(Object.keys(findings).filter((key) => !data[key])).toEqual([]);
    },
    SLOW,
  );

  it('leaves no stand-ins for the DOM behind it, after a run or a failed one', () => {
    // generatedFrames puts an ImageData and a document in the global scope to run the generators:
    // left there, they would tell every later test in the process that it has a DOM
    const tiny = () => {
      const { document, ImageData } = globalThis;
      const context = document.createElement('canvas').getContext('2d');
      context.putImageData(new ImageData(new Uint8ClampedArray(2 * 2 * 4).fill(255), 2, 2), 0, 0);
      return { frames: { 'structures/tiny': { x: 0, y: 0, w: 2, h: 2, ax: 1, ay: 1 } } };
    };
    const names = ['ImageData', 'document'];
    const was = names.map((n) => [n, n in globalThis, globalThis[n]]);
    const same = () =>
      was.every(([n, had, value]) => n in globalThis === had && globalThis[n] === value);
    expect(generatedFrames(tiny).get('structures/tiny'), 'the frame it made').toMatchObject({
      w: 2,
      h: 2,
      source: 'generated',
    });
    expect(same(), 'after a run').toBe(true);
    expect(() =>
      generatedFrames(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(same(), 'after a failed run').toBe(true);
    // a stand-in of the test's own is put back as it was, not removed
    const marker = { marker: true };
    globalThis.document = marker;
    try {
      generatedFrames(tiny);
      expect(globalThis.document, 'a document that was there').toBe(marker);
    } finally {
      delete globalThis.document;
    }
    expect(same()).toBe(true);
  });

  it('gives the limits the README states as the numbers the tool keeps', () => {
    // docs say what is true now: a limit changed in the tool and not in the doc is a doc bug
    const readme = readFileSync('docs/art-direction/README.md', 'utf8');
    const from = readme.indexOf('\n## Building ground data\n');
    const to = readme.indexOf('\n## ', from + 1);
    const section = readme.slice(from, to < 0 ? undefined : to).replace(/\s+/g, ' ');
    for (const phrase of [
      `a slope of ${MEASURE.slope[0]} to ${MEASURE.slope[1]}`,
      `(up to ${MEASURE.gap} world px)`,
      `within ${REACH} world px`,
      `within ${DOOR.near} tile`,
      `more than ${MEASURE.tolerance} world px and half a texel`,
    ])
      expect(section, `the README says "${phrase}"`).toContain(phrase);
  });
});
