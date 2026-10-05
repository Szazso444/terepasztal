import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { FOOTPRINTS, ROTATIONS, project, wallBase } from './building-kit.mjs';
import { blockOf, boxFaces, fillPoly } from './building-guides.mjs';
import { fitGroup, fitPicture, normalisePicture } from './building-fit.mjs';

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

  it('says where the camera stood: how high, and how far turned', () => {
    // the game's camera looks down at 30 degrees on a building turned 45 degrees
    const game = fitPicture(building('t1', 0), 't1', 0).camera;
    expect(Math.abs(game.elevation - 30)).toBeLessThan(0.6);
    expect(Math.abs(game.turn)).toBeLessThan(0.6);
    // a lower camera flattens both ground lines: 0.5 x 0.8 = 0.4 is 23.6 degrees
    const low = fitPicture(
      building('t1', 0, { map: ([x, y]) => [x, 832 + (y - 832) * 0.8] }),
      't1',
      0,
    );
    expect(Math.abs(low.camera.elevation - 23.6)).toBeLessThan(0.6);
    expect(Math.abs(low.camera.turn)).toBeLessThan(0.6);
    // a building turned towards its lower-right wall: that wall's foot flatter, the other steeper
    const turned = fitPicture(
      building('t1', 0, { map: ([x, y]) => [x, y + (x - 512) * 0.08] }),
      't1',
      0,
    );
    expect(turned.measured.map((v) => Math.round(v * 100) / 100)).toEqual([0.58, -0.42]);
    expect(turned.camera.turn).toBeGreaterThan(4);
    expect(turned.camera.turn).toBeLessThan(6);
    // a foot that is not two straight walls says nothing about the camera
    const round = new PNG({ width: 1024, height: 1024 });
    fillPoly(
      round,
      Array.from({ length: 48 }, (_, i) => [
        512 + 200 * Math.cos((i / 48) * 2 * Math.PI),
        600 + 100 * Math.sin((i / 48) * 2 * Math.PI),
      ]),
      [200, 180, 150],
    );
    expect(fitPicture(round, 't1', 0).camera).toBeNull();
  });

  it('can lay a picture down without correcting its camera', () => {
    // for looking at what the generator drew: scale and place only
    const png = building('t1', 3, {
      map: ([x, y]) => [x, 832 + (y - 832) * 0.78 + (x - 512) * 0.03],
    });
    const f = fitPicture(png, 't1', 3, { rectify: false });
    expect(f.slopes).toEqual([0.5, -0.5]);
    expect([f.vertical, f.shear]).toEqual([1, 0]);
    expect(Math.abs(f.measured[0] - 0.42)).toBeLessThan(0.02);
  });

  /** how large the building is once laid onto its footprint: the root of the area it covers */
  const sizeOf = (f) => Math.sqrt(f.area * f.vertical) * f.scale;
  /** a barn with a silo beside its lower-left wall, the silo seen (`true`) or hidden behind it */
  const barn = (rot, silo, k = 1) =>
    building('t1', rot, {
      map: ([x, y]) => [512 + (x - 512) * k, 832 + (y - 832) * k],
      extra: (png, fp, map) => {
        if (!silo) return;
        const b = blockOf('t1', rot);
        const box = { x0: b.x0 - 0.5, x1: b.x0, y0: b.y1 - 0.3, y1: b.y1, z0: 0, z1: 30 };
        for (const [name, pts] of Object.entries(boxFaces(fp, box)))
          fillPoly(png, pts.map(map), SHADE[name]);
      },
    });

  it('brings the views of one building to one size', () => {
    // a generator fills its canvas: the same barn comes back larger where its silo is hidden,
    // and where the silo shows it widens the wall base, so the barn would be laid down smaller
    const views = [barn(0, true, 0.8), barn(1, false, 1.2), barn(2, false, 0.9), barn(3, true, 1)];
    const each = views.map((png, rot) => fitPicture(png, 't1', rot));
    const spread = (fits) => Math.max(...fits.map(sizeOf)) / Math.min(...fits.map(sizeOf));
    expect(spread(each)).toBeGreaterThan(1.15);
    const group = fitGroup(views, 't1');
    expect(spread(group)).toBeLessThan(1.02);
    // together they are as large as their wall bases said: only the differences are evened out
    const mean = (fits) => Math.exp(fits.reduce((a, f) => a + Math.log(f.scale), 0) / fits.length);
    expect(Math.abs(mean(group) / mean(each) - 1)).toBeLessThan(0.02);
    // each still stands with the middle of its foot on the footprint's centre
    for (const [i, f] of group.entries()) expect([f.cx, f.cy]).toEqual([each[i].cx, each[i].cy]);
  });

  it('skips the views that are not made, and leaves a single view as it is', () => {
    const one = barn(0, true);
    const group = fitGroup([one, null, null, null], 't1');
    expect(group.slice(1)).toEqual([null, null, null]);
    expect(group[0].scale).toBe(fitPicture(one, 't1', 0).scale);
  });

  it('gives a family its size on the tile', () => {
    // a depot stands a little larger than its footprint, so that the rails fit its portals
    const views = [0, 1, 2, 3].map((rot) => building('t2x2', rot));
    const plain = fitGroup(views, 't2x2');
    const larger = fitGroup(views, 't2x2', { size: 1.15 });
    for (const [i, f] of larger.entries()) {
      expect(Math.abs(f.scale / plain[i].scale - 1.15)).toBeLessThan(0.001);
      // it grows about the footprint's centre
      const c = FOOTPRINTS.t2x2.centre;
      expect(Math.abs((f.box.left - c[0]) / (plain[i].box.left - c[0]) - 1.15)).toBeLessThan(0.01);
      expect(Math.abs((f.box.top - c[1]) / (plain[i].box.top - c[1]) - 1.15)).toBeLessThan(0.01);
    }
  });

  it('has nothing to say about an empty picture', () => {
    expect(fitPicture(new PNG({ width: 1024, height: 1024 }), 't1', 0)).toBeNull();
  });
});
