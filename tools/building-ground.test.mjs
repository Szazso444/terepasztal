import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { structureFrame } from '../src/art/frames';
import { generateStructuresAtlas } from '../src/art/structures';
import { Rng } from '../src/engine/rng';
import { structureFamily, unturnedFrame } from '../src/render/assetScale';
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
  generatedFrames,
  measureFoot,
  measureFrame,
  openingsOnWall,
  ownDetail,
  placeDefs,
  serialise,
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

  it('draws the longer side of a footprint as the longer wall of the foot', () => {
    // an oracle for the footprint's orientation that does not share the tool's arithmetic: the S
    // wall runs along x, so a footprint wider than it is deep has the longer S wall, at every turn
    let unequal = 0;
    for (const [key, e] of Object.entries(data)) {
      const w = Math.max(...e.footprint.map((t) => t[0])) + 1;
      const h = Math.max(...e.footprint.map((t) => t[1])) + 1;
      if (w === h) continue;
      unequal++;
      const [, east, south, west] = e.foot;
      const along = { S: south[0] - west[0], E: east[0] - south[0] };
      expect(
        Math.sign(along.S - along.E),
        `${key}: ${w} x ${h} tiles, walls ${along.S} and ${along.E}`,
      ).toBe(Math.sign(w - h));
    }
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
    // side away from it (D1 of #406), every other place has its street door on its front
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
        } else {
          expect(street.side, `${label}: street door`).toBe(front);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(Object.keys(data).length);
  });

  it('lists for #407 exactly the doors the pictures do not show or place off the middle', () => {
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
  });

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
  });

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
            : [[2, 1]];
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
          if (worst > REACH) moved.push(`${key} x${m}${by ? ' moved' : ''} ${worst.toFixed(1)}`);
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
    // longer by what the walls reach that the base's own lines do not.
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
      if ((to - from) / (base.e[0] - base.w[0]) < 0.6) short.push(key);
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
      forAll(
        genScene,
        (c) => {
          const { frame, truth } = box({ ...c, extra: scenery(c) });
          const foot = measureFoot(frame);
          expect(foot?.fit).toBe('walls');
          for (const corner of ['s', 'w', 'e'])
            within(foot[corner], truth[corner], 2 * c.k, corner);
        },
        { shrink: shrinkScene, seeds: DRAWN, shrinkBudget: SHRINK },
      );
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
        (c) => {
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
        },
        { shrink: shrinkPair, seeds: DRAWN, shrinkBudget: SHRINK },
      );
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
  });
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
      doors: doors.map((p) => ({ wall: wall(p.door), x: p.x, width: 6, height: 14, up: 0 })),
    });
    const info = { rot: c.rot, defs: [{ def }] };
    const measured = measureFrame(frame, info, { doorsOf, placeSpan });
    return { ...measured, doors, truth, W: geometry.W, H: geometry.H };
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
  });

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
