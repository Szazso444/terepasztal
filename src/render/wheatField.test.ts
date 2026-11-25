import { describe, expect, it } from 'vitest';
import { forAll } from '../testing/property';
import { surfaceNoise } from './terrainMaterials';
import {
  CELL_BLOCKED,
  CELL_FIELD,
  CELL_OPEN,
  FIELD_RES,
  FieldModel,
  LatticeNoise,
  RUN_S,
  RUN_W,
  amberStrong,
  fieldPicture,
  overWhite,
  readSite,
  siteKey,
  type FieldCell,
  type FieldFrame,
  type FieldPicture,
} from './wheatField';

/**
 * A little world of tiles, in world tile coordinates: fields with their variants, blocked tiles
 * (some of them a building's footprint, with the sides a field may run up to), levels, and the
 * map's edge.
 */
interface Ground {
  w: number;
  h: number;
  fields: Map<string, number>;
  blocked: Map<string, number>;
  levels: Map<string, number>;
}
function ground(w = 16, h = 16): Ground {
  return { w, h, fields: new Map(), blocked: new Map(), levels: new Map() };
}
const at = (x: number, y: number) => `${x},${y}`;
function cells(g: Ground) {
  return (x: number, y: number): FieldCell => {
    const level = g.levels.get(at(x, y)) ?? 0;
    if (x < 0 || y < 0 || x >= g.w || y >= g.h)
      return { kind: CELL_BLOCKED, variant: 0, level: 0, run: 0 };
    const run = g.blocked.get(at(x, y));
    if (run !== undefined) return { kind: CELL_BLOCKED, variant: 0, level, run };
    const v = g.fields.get(at(x, y));
    return v === undefined
      ? { kind: CELL_OPEN, variant: 0, level, run: 0 }
      : { kind: CELL_FIELD, variant: v, level, run: 0 };
  };
}
/** Fields on the tiles of a rectangle, their variants mixed. */
function field(g: Ground, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) g.fields.set(at(x, y), (x * 7 + y * 5) % 3);
  return g;
}
const site = (g: Ground, x: number, y: number) => readSite(x, y, cells(g));
const model = (g: Ground, x: number, y: number) => new FieldModel(site(g, x, y));
const tiles = (g: Ground) => [...g.fields.keys()].map((k) => k.split(',').map(Number));

/** A variant's picture: rows of two shades, like a field's, solid over its whole frame. */
function frame(r: number, g: number, b: number): FieldFrame {
  const width = 216,
    height = 120,
    data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const k = (x + 2 * y) % 16 < 8 ? 1 : 0.8;
      data.set([r * k, g * k, b * k, 255], (y * width + x) * 4);
    }
  return { data, width, height, density: 4, anchorX: 108, anchorY: 63 };
}
const FRAMES = [frame(190, 150, 70), frame(176, 150, 64), frame(200, 160, 80)];

/** Where a picture's texel lies on the world's texel grid: its column and row. */
function texels(x: number, y: number, p: FieldPicture) {
  return {
    col: ((x - y) * 32 + p.left) * FIELD_RES,
    row: ((x + y) * 16 + p.top) * FIELD_RES,
  };
}

/** The highest stalks and whether any ground is covered, over the points `pts` of a model. */
function scan(m: FieldModel, pts: [number, number][]) {
  let tallest = 0,
    covered = 0;
  for (const [x, y] of pts) {
    m.read(x, y);
    if (m.cover > 0) covered++;
    tallest = Math.max(tallest, m.height);
  }
  return { tallest, covered };
}
/** Points on a grid over the box from (x0, y0) to (x1, y1), `n` along each side. */
function grid(x0: number, y0: number, x1: number, y1: number, n = 40): [number, number][] {
  const out: [number, number][] = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) out.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * j) / n]);
  return out;
}

describe('the noise the fields read', () => {
  it("is the game's own surface noise, to the bit, wherever it is read from", () => {
    forAll(
      (rng) =>
        Array.from({ length: 50 }, () => [rng.range(-500, 500), rng.range(-500, 500)] as const),
      (points) => {
        const n = new LatticeNoise(4441);
        for (const [x, y] of points) expect(n.at(x, y)).toBe(surfaceNoise(x, y, 4441));
        // read again in reverse, from another cell
        for (const [x, y] of [...points].reverse())
          expect(n.at(x, y)).toBe(surfaceNoise(x, y, 4441));
      },
    );
  });
});

describe('a wheat field tile', () => {
  it('reads the same site from the same map, and another from a changed one', () => {
    const g = field(ground(), 4, 4, 6, 6),
      before = siteKey(site(g, 5, 5));
    expect(siteKey(site(g, 5, 5))).toBe(before);
    // track three tiles off changes what its picture reads
    g.blocked.set(at(8, 5), 0);
    expect(siteKey(site(g, 5, 5))).not.toBe(before);
  });

  // slow because two fields' tiles are painted texel by texel, alone, in reverse and a column at a
  // time by turns: 2.8 s alone, so a limit of 60 s
  it('gives the same bytes for the same inputs, whatever was painted before or alongside it', () => {
    const g = field(ground(), 3, 3, 5, 5),
      other = field(ground(), 9, 9, 11, 10),
      alone = new Map(tiles(g).map(([x, y]) => [at(x, y), fieldPicture(site(g, x, y), FRAMES)]));
    // another field first, then this one's tiles in another order
    for (const [x, y] of tiles(other)) fieldPicture(site(other, x, y), FRAMES);
    for (const [x, y] of tiles(g).reverse())
      expect(fieldPicture(site(g, x, y), FRAMES), at(x, y)).toEqual(alone.get(at(x, y)));
    // two pictures painted a column at a time, by turns
    const a = model(g, 4, 4).job(FRAMES),
      b = model(g, 5, 3).job(FRAMES);
    let done = false;
    while (!done) {
      const da = a.run(() => false),
        db = b.run(() => false);
      done = da && db;
    }
    expect(a.result).toEqual(alone.get(at(4, 4)));
    expect(b.result).toEqual(alone.get(at(5, 3)));
  }, 60_000);

  // slow because a field's tiles are painted and every texel of every picture is matched to its
  // neighbours': 0.75 s alone, so a limit of 30 s
  it('divides a field with its neighbours texel by texel: no texel twice, no doubled alpha', () => {
    const g = field(ground(), 3, 3, 6, 5);
    g.fields.delete(at(6, 5));
    g.blocked.set(at(7, 4), 0);
    const pictures = tiles(g).map(([x, y]) => ({ x, y, p: fieldPicture(site(g, x, y), FRAMES)! }));
    // every texel each picture shows, on the world's grid
    const seen = new Map<string, { own: number; rgba: number[]; tile: string }[]>();
    for (const { x, y, p } of pictures) {
      const { col, row } = texels(x, y, p);
      for (let r = 0; r < p.height; r++)
        for (let c = 0; c < p.width; c++) {
          const k = (r * p.width + c) * 4;
          if (!p.data[k + 3]) continue;
          const key = `${col + c},${row + r}`,
            list = seen.get(key) ?? [];
          list.push({
            own: p.own[r * p.width + c],
            rgba: [...p.data.subarray(k, k + 4)],
            tile: at(x, y),
          });
          seen.set(key, list);
        }
    }
    let skirt = 0;
    for (const [key, list] of seen) {
      const owners = list.filter((t) => t.own);
      // each texel shown is one tile's own
      expect(owners.length, key).toBe(1);
      // and a neighbour's skirt repeats it exactly, only where it is opaque
      for (const t of list)
        if (!t.own) {
          skirt++;
          expect(t.rgba, `${key} in ${t.tile}'s skirt`).toEqual(owners[0].rgba);
          expect(t.rgba[3]).toBe(255);
        }
    }
    expect(skirt).toBeGreaterThan(0);
  }, 30_000);

  it('gives a point deep inside a field to exactly one tile, fully covered', () => {
    const g = field(ground(), 3, 3, 5, 5);
    for (const [x, y] of tiles(g)) {
      const m = model(g, x, y);
      for (const [px, py] of grid(x - 0.05, y - 0.05, x + 0.05, y + 0.05, 6)) {
        m.read(px, py);
        expect(m.ownerOffset(), at(px, py)).toEqual([0, 0]);
        expect(m.cover).toBe(1);
      }
    }
  });

  it('feathers an open edge, its stalks lower than inside, and ragged', () => {
    const g = field(ground(), 5, 5, 5, 5),
      m = model(g, 5, 5);
    const band: number[] = [],
      inside: number[] = [];
    for (const [x, y] of grid(4, 4, 6, 6, 120)) {
      m.read(x, y);
      if (m.cover >= 1) inside.push(m.height);
      else if (m.cover > 0) band.push(m.height);
    }
    expect(band.length).toBeGreaterThan(100);
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(band)).toBeLessThan(mean(inside) - 1);
    expect(Math.min(...inside)).toBeGreaterThanOrEqual(2.6);
    expect(Math.max(...inside)).toBeLessThanOrEqual(3.5);
    // the outermost stalks are down to the ground, stalk by stalk
    expect(band.filter((h) => h === 0).length).toBeGreaterThan(0);
    expect(band.filter((h) => h > 0 && h < 1).length).toBeGreaterThan(0);
    // its picture has a feather band of translucent texels
    const p = fieldPicture(site(g, 5, 5), FRAMES)!;
    let translucent = 0;
    for (let k = 3; k < p.data.length; k += 4) if (p.data[k] > 0 && p.data[k] < 255) translucent++;
    expect(translucent).toBeGreaterThan(50);
  });

  it("draws an open edge's line off the tile's edge, by varying amounts along it", () => {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const g = field(ground(), 6, 6, 6, 6),
        m = model(g, 6, 6),
        reach: number[] = [];
      for (let t = -0.4; t <= 0.4; t += 0.02) {
        let far = 0;
        for (let s = 0; s <= 1.2; s += 0.005) {
          m.read(6 + dx * s + dy * t, 6 + dy * s + dx * t);
          if (m.cover >= 0.5) far = s;
        }
        reach.push(far);
      }
      // half-covered at no single distance from the centre: the warp moves it along the side
      expect(Math.max(...reach) - Math.min(...reach), `${dx},${dy}`).toBeGreaterThan(0.05);
    }
  });

  it('never reaches onto a blocked neighbour: track, paving, a building, another level, the edge', () => {
    const DIRS = [-1, 0, 1]
      .flatMap((dy) => [-1, 0, 1].map((dx) => [dx, dy]))
      .filter(([a, b]) => a || b);
    for (const [dx, dy] of DIRS)
      for (const kind of ['blocked', 'level', 'field level', 'edge'] as const) {
        // a field tile, the neighbour beside it; at the map's edge, in the corner or on the side
        const g = ground(5, 5),
          edge = (d: number) => (kind !== 'edge' ? 2 : d < 0 ? 0 : d > 0 ? 4 : 2),
          fx = edge(dx),
          fy = edge(dy),
          nx = fx + dx,
          ny = fy + dy;
        g.fields.set(at(fx, fy), 1);
        if (kind === 'blocked') g.blocked.set(at(nx, ny), 0);
        if (kind === 'level') g.levels.set(at(nx, ny), 1);
        if (kind === 'field level') {
          g.levels.set(at(nx, ny), 1);
          g.fields.set(at(nx, ny), 0);
        }
        const tile = grid(nx - 0.5, ny - 0.5, nx + 0.5, ny + 0.5);
        expect(scan(model(g, fx, fy), tile).covered, `${kind} at ${dx},${dy}`).toBe(0);
        // where open land there takes a little of it
        if (kind === 'blocked' && (!dx || !dy)) {
          const open = field(ground(), 2, 2, 2, 2);
          expect(scan(model(open, 2, 2), tile).covered).toBeGreaterThan(0);
        }
      }
  });

  // slow because a field is painted in three palettes and every texel of every picture is checked:
  // 0.89 s alone, so a limit of 30 s
  it('keeps every texel under the cursor white and short of the selection amber', () => {
    for (const frames of [
      [frame(255, 255, 250), frame(240, 236, 220), frame(255, 250, 240)],
      [frame(232, 170, 72), frame(250, 190, 60), frame(240, 175, 50)],
      FRAMES,
    ]) {
      const g = field(ground(), 3, 3, 4, 4);
      for (const [x, y] of tiles(g)) {
        const p = fieldPicture(site(g, x, y), frames)!;
        for (let k = 0; k < p.data.length; k += 4) {
          if (!p.data[k + 3]) continue;
          const [r, gr, b] = p.data.subarray(k, k + 3);
          expect(overWhite(r, gr, b), `${r},${gr},${b}`).toBe(false);
          expect(amberStrong(r, gr, b), `${r},${gr},${b}`).toBe(false);
        }
      }
    }
  }, 30_000);
});

describe("a wheat field at a building's foot", () => {
  /**
   * A field tile at (5, 5) beside a footprint tile one step (dx, dy) from it, whose sides run
   * `run`; `band` gives the points `a0` to `a1` tiles from the field tile's centre toward the
   * building, across the shared edge's length (`c` either side of its middle).
   */
  function beside(dx: number, dy: number, run: number) {
    const g = field(ground(), 5, 5, 5, 5);
    g.blocked.set(at(5 + dx, 5 + dy), run);
    const band = (a0: number, a1: number, c = 0.45) =>
      grid(0, 0, 1, 1).map(([i, j]): [number, number] => {
        const a = a0 + (a1 - a0) * i,
          t = -c + 2 * c * j;
        return [5 + dx * a + Math.abs(dy) * t, 5 + dy * a + Math.abs(dx) * t];
      });
    return { m: model(g, 5, 5), bx: 5 + dx, by: 5 + dy, band };
  }

  it('runs up to it from its W or S side, past the shared edge, its stalks up to 1.8 px taller', () => {
    // the building is at +x of a field on its W side, at -y of one on its S side
    for (const [dx, dy] of [
      [1, 0],
      [0, -1],
    ]) {
      const { m, band } = beside(dx, dy, RUN_W | RUN_S),
        at = `${dx},${dy}`;
      // onto the building's tile, but no further than its run-up reaches (0.62 tile and its feather)
      expect(scan(m, band(0.5, 0.6)).covered, at).toBeGreaterThan(0);
      expect(scan(m, band(0.75, 1.5)).covered, at).toBe(0);
      // taller along its foot than stalks stand anywhere else, but never more than 1.8 px taller
      expect(scan(m, band(0.3, 0.6)).tallest, at).toBeGreaterThan(3.5 + 0.8);
      expect(scan(m, band(-1, 1, 1)).tallest, at).toBeLessThanOrEqual(2.6 + 0.9 + 1.8);
      // and only near it
      expect(scan(m, band(-0.6, -0.1)).tallest, at).toBeLessThanOrEqual(3.5);
    }
  });

  it('keeps its margin and its height on the N and E sides, and on a side with a door path', () => {
    for (const [dx, dy, run, why] of [
      [-1, 0, RUN_W | RUN_S, 'E of it'],
      [0, 1, RUN_W | RUN_S, 'N of it'],
      [1, 0, RUN_S, 'W of it, a door path on its W side'],
      [0, -1, RUN_W, 'S of it, a door path on its S side'],
    ] as const) {
      const { m, bx, by, band } = beside(dx, dy, run);
      expect(scan(m, grid(bx - 0.5, by - 0.5, bx + 0.5, by + 0.5)).covered, why).toBe(0);
      expect(scan(m, band(-1, 1, 1)).tallest, why).toBeLessThanOrEqual(3.5);
    }
  });

  it('runs on along a long building past the joint of two field tiles, without a notch', () => {
    // a building two tiles long at x + 1, y and y + 1, fields W of both; in many places, so the
    // warp's own bays even out
    let joint = 0,
      along = 0,
      n = 0;
    for (let k = 0; k < 40; k++) {
      const x = 5 + 4 * k,
        y = 5 + 3 * k,
        g = field(ground(200, 200), x, y, x, y + 1);
      g.blocked.set(at(x + 1, y), RUN_W | RUN_S);
      g.blocked.set(at(x + 1, y + 1), RUN_W | RUN_S);
      const a = model(g, x, y),
        b = model(g, x, y + 1);
      // 0.03 tile onto the building's tiles, along its foot
      for (let t = -0.4; t <= 1.4; t += 0.02) {
        a.read(x + 0.53, y + t);
        const ca = a.cover;
        b.read(x + 0.53, y + t);
        // both tiles read the same point the same
        expect(ca).toBe(b.cover);
        if (Math.abs(t - 0.5) < 0.1) joint += ca > 0 ? 1 : 0;
        else {
          along += ca > 0 ? 1 : 0;
          n++;
        }
      }
    }
    // the joint is covered about as often as the rest of the foot
    const share = joint / (40 * 10),
      elsewhere = along / n;
    expect(elsewhere).toBeGreaterThan(0.3);
    expect(share).toBeGreaterThan(elsewhere * 0.6);
  });
});
