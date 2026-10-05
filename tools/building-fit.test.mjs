import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { FOOTPRINTS, ROTATIONS, project, wallBase } from './building-kit.mjs';
import { blockOf, boxFaces, fillPoly } from './building-guides.mjs';
import { fitPicture, normalisePicture } from './building-fit.mjs';

const SHADE = { top: [220, 210, 180], left: [160, 120, 90], right: [110, 80, 60] };

/**
 * A box building as an image generator returns it: the guide's block standing on the ground, every
 * canvas point moved by `map`, on a canvas of any size.
 */
function building(fpId, rot, { canvas, map = (p) => p, extra } = {}) {
  const fp = FOOTPRINTS[fpId];
  const [w, h] = canvas ?? fp.canvas;
  const png = new PNG({ width: w, height: h });
  const faces = boxFaces(fp, { ...blockOf(fpId, rot), z0: 0 });
  for (const [name, pts] of Object.entries(faces)) fillPoly(png, pts.map(map), SHADE[name]);
  extra?.(png, fp, map);
  return png;
}

/** Where the building stands in a picture: its outermost columns and the middle of its lowest row. */
function stands(png) {
  let left = null,
    right = null,
    lowY = -1,
    lowXs = [];
  for (let x = 0; x < png.width; x++)
    for (let y = png.height - 1; y >= 0; y--)
      if (png.data[(y * png.width + x) * 4 + 3] > 128) {
        left ??= [x, y];
        right = [x, y];
        if (y > lowY) {
          lowY = y;
          lowXs = [];
        }
        if (y === lowY) lowXs.push(x);
        break;
      }
  return { left, right, low: [(lowXs[0] + lowXs[lowXs.length - 1]) / 2, lowY] };
}
const near = (p, q, by) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= by;

describe('building fit', () => {
  it('finds a building painted where the guide block stands, for every footprint and rotation', () => {
    for (const fp of Object.values(FOOTPRINTS))
      for (const r of ROTATIONS) {
        const f = fitPicture(building(fp.id, r.index), fp.id, r.index);
        const label = `${fp.id} r${r.index}`;
        expect(f.method, label).toBe('base');
        expect(Math.abs(f.slopes[0] - 0.5), label).toBeLessThan(0.02);
        expect(Math.abs(f.slopes[1] + 0.5), label).toBeLessThan(0.02);
        expect(Math.abs(f.scale - 1), label).toBeLessThan(0.02);
        const b = wallBase(fp, r.index);
        expect(near(f.base.w, b.w, 4), label).toBe(true);
        expect(near(f.base.s, b.s, 4), label).toBe(true);
        expect(near(f.base.e, b.e, 4), label).toBe(true);
      }
  });

  it('finds a building drawn larger, off centre and on another canvas', () => {
    // what the depot pilot returned: half as large again as its guide, and not where the guide is
    const fp = FOOTPRINTS.t2x2;
    const map = ([x, y]) => [
      fp.centre[0] + (x - fp.centre[0]) * 1.5 + 60,
      900 + (y - fp.centre[1]) * 1.5,
    ];
    const png = building('t2x2', 0, { canvas: [1800, 1500], map });
    const f = fitPicture(png, 't2x2', 0);
    expect(f.method).toBe('base');
    expect(Math.abs(f.scale - 1 / 1.5)).toBeLessThan(0.01);
    const b = wallBase(fp, 0);
    const at = stands(normalisePicture(png, f, 't2x2'));
    expect(near(at.left, b.w, 4)).toBe(true);
    expect(near(at.low, b.s, 4)).toBe(true);
    expect(near(at.right, b.e, 4)).toBe(true);
  });

  it("straightens a camera that is not quite the game's", () => {
    // ground lines at 0.42 and -0.36 instead of 0.5 and -0.5, as image generators draw them
    const fp = FOOTPRINTS.t1;
    const map = ([x, y]) => [x, 832 + (y - 832) * 0.78 + (x - 512) * 0.03];
    const png = building('t1', 3, { map });
    const f = fitPicture(png, 't1', 3);
    expect(f.method).toBe('base');
    expect(Math.abs(f.slopes[0] - 0.42)).toBeLessThan(0.02);
    expect(Math.abs(f.slopes[1] + 0.36)).toBeLessThan(0.02);
    const b = wallBase(fp, 3);
    const at = stands(normalisePicture(png, f, 't1'));
    expect(near(at.left, b.w, 4)).toBe(true);
    expect(near(at.low, b.s, 4)).toBe(true);
    expect(near(at.right, b.e, 4)).toBe(true);
  });

  it("corrects a camera only as far as the guide's can be off", () => {
    // a nearly flat view: slopes 0.2 and -0.2 are no isometric picture, and are not stretched to one
    const map = ([x, y]) => [x, 832 + (y - 832) * 0.4];
    const f = fitPicture(building('t1', 0, { map }), 't1', 0);
    expect(f.measured.map((s) => Math.round(s * 10) / 10)).toEqual([0.2, -0.2]);
    expect(f.slopes).toEqual([0.33, -0.33]);
  });

  it('finds the wall base behind doors that stand open in front of it', () => {
    // four door leaves swung out from the lower-right wall, each to its own angle, their feet
    // below the wall's base: as the depot pilot came back
    const leaves = (png, fp, map) => {
      const b = blockOf('t2x2', 0);
      for (const [at, out] of [
        [-0.8, 0.08],
        [-0.35, 0.16],
        [0.15, 0.11],
        [0.62, 0.2],
      ])
        fillPoly(
          png,
          [
            project(fp, b.x1, at, 0),
            project(fp, b.x1 + out, at + 0.2, 0),
            project(fp, b.x1 + out, at + 0.2, 28),
            project(fp, b.x1, at, 28),
          ].map(map),
          [40, 90, 60],
        );
    };
    const f = fitPicture(building('t2x2', 0, { extra: leaves }), 't2x2', 0);
    expect(f.method).toBe('base');
    expect(Math.abs(f.slopes[1] + 0.5)).toBeLessThan(0.03);
    expect(near(f.base.s, wallBase(FOOTPRINTS.t2x2, 0).s, 6)).toBe(true);
  });

  it('places a building without straight wall bases by its outline', () => {
    // a round tower with sails: nothing at its foot is a straight wall
    const fp = FOOTPRINTS.t1;
    const png = new PNG({ width: 1024, height: 1024 });
    const a = 150;
    const ellipse = (cy, rx) =>
      Array.from({ length: 48 }, (_, i) => [
        512 + rx * Math.cos((i / 48) * 2 * Math.PI),
        cy + (rx / 2) * Math.sin((i / 48) * 2 * Math.PI),
      ]);
    fillPoly(png, ellipse(700, a), [200, 180, 150]);
    fillPoly(
      png,
      [
        [512 - a, 700],
        [512 + a, 700],
        [512 + a, 300],
        [512 - a, 300],
      ],
      [200, 180, 150],
    );
    fillPoly(png, ellipse(300, a), [230, 220, 200]);
    // sails far out to both sides, high above the ground
    fillPoly(
      png,
      [
        [60, 200],
        [960, 240],
        [960, 270],
        [60, 230],
      ],
      [120, 90, 60],
    );
    const f = fitPicture(png, 't1', 0);
    expect(f.method).toBe('outline');
    expect(f.slopes).toEqual([0.5, -0.5]);
    // centred on the tower, not on the sails; its foot as wide as the walls of one tile
    const b = wallBase(fp, 0);
    expect(Math.abs((f.base.w[0] + f.base.e[0]) / 2 - 512)).toBeLessThan(6);
    expect(Math.abs(f.scale - (b.e[0] - b.w[0]) / (2 * a))).toBeLessThan(0.15);
    const at = stands(normalisePicture(png, f, 't1'));
    expect(Math.abs(at.low[0] - fp.centre[0])).toBeLessThan(8);
    expect(at.low[1]).toBeLessThan(b.s[1] + 4);
    expect(at.low[1]).toBeGreaterThan(fp.centre[1]);
  });

  it('lays the picture onto a smaller canvas when asked', () => {
    const png = building('t1x2', 1);
    const f = fitPicture(png, 't1x2', 1);
    const small = normalisePicture(png, f, 't1x2', 4);
    expect([small.width, small.height]).toEqual([256, 256]);
    const b = wallBase(FOOTPRINTS.t1x2, 1);
    expect(near(stands(small).low, [b.s[0] / 4, b.s[1] / 4], 3)).toBe(true);
  });

  it('reports the room the building takes on its canvas', () => {
    const fp = FOOTPRINTS.t1;
    const f = fitPicture(building('t1', 0), 't1', 0);
    const top = project(fp, -0.44, -0.44, blockOf('t1', 0).z1)[1];
    expect(Math.abs(f.box.top - top)).toBeLessThan(3);
    expect(Math.abs(f.box.left - wallBase(fp, 0).w[0])).toBeLessThan(3);
    expect(Math.abs(f.box.right - wallBase(fp, 0).e[0])).toBeLessThan(3);
  });

  it('has nothing to say about an empty picture', () => {
    expect(fitPicture(new PNG({ width: 1024, height: 1024 }), 't1', 0)).toBeNull();
  });
});
