import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateStructuresAtlas } from '../src/art/structures';
import { doorsOf, placeSpan } from '../src/sim/doors';
import { ROTATIONS } from './building-kit.mjs';
import {
  DOOR,
  GROUND_FILE,
  GROUP,
  REACH,
  SOLID,
  atlasFrames,
  buildGround,
  classify,
  generatedFrames,
  measureFoot,
  openingsOnWall,
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

  it("lays the foot on the game's ground lines, near corner lowest", () => {
    for (const [key, e] of Object.entries(data)) {
      const [n, ee, s, w] = e.foot;
      // a parallelogram whose sides run at 1 to 2 across and down, as the ground does
      expect(n[0] + s[0], key).toBeCloseTo(ee[0] + w[0], 1);
      expect(n[1] + s[1], key).toBeCloseTo(ee[1] + w[1], 1);
      expect(w[0], key).toBeLessThan(s[0]);
      expect(s[0], key).toBeLessThan(ee[0]);
      expect((s[1] - w[1]) / (s[0] - w[0]), key).toBeCloseTo(0.5, 1);
      expect((s[1] - ee[1]) / (s[0] - ee[0]), key).toBeCloseTo(-0.5, 1);
      expect(n[1], key).toBeLessThan(s[1]);
    }
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
        expect(Math.abs(door.offset), key).toBeLessThanOrEqual(DOOR.near);
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
      expect(await serialise(again)).toBe(file);
      // and generating the frames twice gives the same pixels
      const first = generatedFrames(generateStructuresAtlas);
      const second = generatedFrames(generateStructuresAtlas);
      expect([...first.keys()]).toEqual([...second.keys()]);
      for (const [key, f] of first)
        expect(Buffer.from(f.data).equals(Buffer.from(second.get(key).data)), key).toBe(true);
    },
    SLOW,
  );
});
