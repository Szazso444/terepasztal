import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { FOOTPRINTS, ROOT, ROTATIONS, project, diamond } from './building-kit.mjs';
import {
  CROSS_AFFINE,
  GREY,
  METRE_PX,
  SAILS_FACE,
  WINDMILL,
  WINDMILL_GREY,
  blockOf,
  drawGuide,
  drawWindmill,
  familyBlocks,
  guideFile,
  openingsOf,
  portalWall,
  windmillFamilies,
  windmillFiles,
  windmillGeometry,
  windmillHub,
  writeGuides,
} from './building-guides.mjs';
import { loadInventory } from './building-kit.mjs';
import { structureScale } from '../src/render/assetScale';

const at = (png, [x, y]) => {
  const o = (Math.round(y) * png.width + Math.round(x)) * 4;
  return [...png.data.subarray(o, o + 4)];
};
const solid = (rgb) => [...rgb, 255];

describe('building guides', () => {
  it('draws each guide on the canvas of its footprint, on a transparent ground', () => {
    for (const fp of Object.values(FOOTPRINTS))
      for (const r of ROTATIONS) {
        const png = drawGuide(fp.id, r.index);
        expect([png.width, png.height]).toEqual(fp.canvas);
        for (const corner of [
          [0, 0],
          [png.width - 1, 0],
          [0, png.height - 1],
          [png.width - 1, png.height - 1],
        ])
          expect(at(png, corner)[3]).toBe(0);
      }
    expect(guideFile('t2x2', 3)).toBe('assets/source/buildings-v2/guides/t2x2-r3.png');
  });

  it('shades the block by the way its faces look: top, lower left, lower right', () => {
    for (const fp of Object.values(FOOTPRINTS))
      for (const r of ROTATIONS) {
        const png = drawGuide(fp.id, r.index);
        const b = blockOf(fp.id, r.index);
        const high = b.z0 + (b.z1 - b.z0) * 0.9;
        expect(at(png, project(fp, 0, 0, b.z1))).toEqual(solid(GREY.top));
        // near the wall's end and above every opening
        expect(at(png, project(fp, b.x1 * 0.9, b.y1, high))).toEqual(solid(GREY.left));
        expect(at(png, project(fp, b.x1, b.y1 * 0.9, high))).toEqual(solid(GREY.right));
      }
  });

  it('shows the front door only where the front can be seen', () => {
    const fp = FOOTPRINTS.t1;
    const b = blockOf('t1', 0);
    const onS = project(fp, 0, b.y1, b.z0 + 10);
    const onE = project(fp, b.x1, 0, b.z0 + 10);
    const seen = ROTATIONS.map((r) => {
      const png = drawGuide('t1', r.index);
      return [at(png, onS), at(png, onE)];
    });
    expect(seen).toEqual([
      [solid(GREY.opening), solid(GREY.right)],
      [solid(GREY.left), solid(GREY.right)],
      [solid(GREY.left), solid(GREY.right)],
      [solid(GREY.left), solid(GREY.opening)],
    ]);
  });

  it("opens the depot's portals in its end walls", () => {
    const fp = FOOTPRINTS.t2x2;
    const b = blockOf('t2x2', 0);
    const z = b.z0 + 15;
    const r0 = drawGuide('t2x2', 0);
    // front on the lower left with the crew door; side A on the lower right with two portals
    expect(at(r0, project(fp, 0, b.y1, b.z0 + 9))).toEqual(solid(GREY.opening));
    expect(at(r0, project(fp, b.x1, -0.5, z))).toEqual(solid(GREY.opening));
    expect(at(r0, project(fp, b.x1, 0.5, z))).toEqual(solid(GREY.opening));
    expect(at(r0, project(fp, b.x1, 0, z))).toEqual(solid(GREY.right));
    // a quarter turn on: side A on the lower left, the blank back on the lower right
    const r1 = drawGuide('t2x2', 1);
    expect(at(r1, project(fp, -0.5, b.y1, z))).toEqual(solid(GREY.opening));
    expect(at(r1, project(fp, 0.5, b.y1, z))).toEqual(solid(GREY.opening));
    expect(at(r1, project(fp, b.x1, -0.5, z))).toEqual(solid(GREY.right));
    expect(at(r1, project(fp, b.x1, 0.5, z))).toEqual(solid(GREY.right));
  });

  it("says which visible wall carries a depot's portals, and where every opening is", () => {
    // 0 the lower-left wall, 1 the lower-right: the end walls come round as the depot turns
    expect(ROTATIONS.map((r) => portalWall('t2x2', r.index))).toEqual([1, 0, 1, 0]);
    expect(ROTATIONS.map((r) => portalWall('t1x2', r.index))).toEqual([1, 0, 1, 0]);
    // a building with a front door only has no such wall
    expect(portalWall('t1', 0)).toBeNull();
    expect(portalWall('t1tall', 2)).toBeNull();
    // the openings as the guide draws them: the crew door in front, two portals in an end wall
    const list = (rot) => openingsOf('t2x2', rot).map((o) => `${o.kind}${o.wall}`);
    expect(list(0)).toEqual(['front0', 'side1', 'side1']);
    expect(list(1)).toEqual(['side0', 'side0']);
    expect(list(2)).toEqual(['side1', 'side1']);
    expect(list(3)).toEqual(['side0', 'side0', 'front1']);
    expect(openingsOf('t1', 1)).toEqual([]);
    // each is the dark quad of the guide
    const fp = FOOTPRINTS.t2x2;
    const b = blockOf('t2x2', 0);
    const door = openingsOf('t2x2', 0)[0];
    expect(door.pts).toHaveLength(4);
    expect(door.pts[0]).toEqual(project(fp, -0.08, b.y1, b.z0));
    expect(door.pts[2]).toEqual(project(fp, 0.08, b.y1, b.z0 + 18));
  });

  it('gives the narrow depot one portal per end and turns its footprint', () => {
    const fp = FOOTPRINTS.t1x2;
    const b0 = blockOf('t1x2', 0);
    const r0 = drawGuide('t1x2', 0);
    expect(b0.x1).toBeGreaterThan(b0.y1);
    expect(at(r0, project(fp, b0.x1, 0, b0.z0 + 12))).toEqual(solid(GREY.opening));
    const b1 = blockOf('t1x2', 1);
    const r1 = drawGuide('t1x2', 1);
    expect(b1.y1).toBeGreaterThan(b1.x1);
    expect(at(r1, project(fp, 0, b1.y1, b1.z0 + 12))).toEqual(solid(GREY.opening));
    expect(at(r1, project(fp, b1.x1, 0, b1.z0 + 12))).toEqual(solid(GREY.right));
  });

  it('stands the block on a plinth that is the footprint', () => {
    for (const fp of Object.values(FOOTPRINTS))
      for (const r of ROTATIONS) {
        const png = drawGuide(fp.id, r.index);
        const s = diamond(fp, r.index).s;
        expect(at(png, [s[0] - 8, s[1] - 12])).toEqual(solid(GREY.plinthLeft));
        expect(at(png, [s[0] + 8, s[1] - 12])).toEqual(solid(GREY.plinthRight));
        expect(at(png, [s[0], s[1] + 8])[3]).toBe(0);
      }
  });

  it('keeps the guide files the repository holds: every footprint, every view, pixel for pixel', () => {
    for (const fp of Object.values(FOOTPRINTS))
      for (const r of ROTATIONS) {
        const kept = PNG.sync.read(readFileSync(guideFile(fp.id, r.index)));
        const drawn = drawGuide(fp.id, r.index);
        expect([drawn.width, drawn.height], `${fp.id}-r${r.index}`).toEqual([
          kept.width,
          kept.height,
        ]);
        expect(Buffer.compare(drawn.data, kept.data), `${fp.id}-r${r.index}`).toBe(0);
      }
  });

  it('names a guide of its own for a family, and the footprint stays the default', () => {
    expect(guideFile('t1', 2)).toBe(`${ROOT}/guides/t1-r2.png`);
    expect(guideFile('t1', 2, 'fuel_stop')).toBe(`${ROOT}/guides/fuel_stop-r2.png`);
    expect(blockOf('t1', 1, 62).z1 - blockOf('t1', 1).z0).toBe(62);
    expect(blockOf('t1', 1)).toEqual(blockOf('t1', 1, 40));
  });

  it('gives the coaling stage the height its family asks for, and keeps the files drawn from it', () => {
    const families = JSON.parse(readFileSync(`${ROOT}/families.json`, 'utf8'));
    const blocks = familyBlocks(loadInventory(), families);
    expect(blocks).toEqual([{ family: 'fuel_stop', footprint: 't1', height: 62 }]);
    const { footprint, height } = blocks[0];
    const fp = FOOTPRINTS[footprint];
    for (const r of ROTATIONS) {
      const png = drawGuide(footprint, r.index, height);
      const b = blockOf(footprint, r.index, height);
      expect(b.z1).toBe(b.z0 + 62);
      // the top face is where the taller block puts it
      expect(at(png, project(fp, 0, 0, b.z1))).toEqual(solid(GREY.top));
      // walls up to that height, nothing above it
      const near = (z) => [project(fp, b.x1 * 0.9, b.y1, z), project(fp, b.x1, b.y1 * 0.9, z)];
      for (const z of [b.z0 + 45, b.z0 + 60]) {
        expect(at(png, near(z)[0])).toEqual(solid(GREY.left));
        expect(at(png, near(z)[1])).toEqual(solid(GREY.right));
      }
      // above the top edge the picture shows the top face, not a wall
      for (const p of near(b.z1 + 6)) {
        expect(at(png, p)).not.toEqual(solid(GREY.left));
        expect(at(png, p)).not.toEqual(solid(GREY.right));
      }
      // the far top corner is on the canvas
      const far = project(fp, b.x0, b.y0, b.z1);
      expect(far[1]).toBeGreaterThan(0);
      expect(far[0]).toBeGreaterThan(0);
      // the committed file is this drawing
      const kept = PNG.sync.read(readFileSync(guideFile(footprint, r.index, 'fuel_stop')));
      expect(Buffer.compare(png.data, kept.data)).toBe(0);
    }
  });
});

describe('the windmill guides', { timeout: 30_000 }, () => {
  const dir = `${ROOT}/guides`;
  const kept = (name) => readFileSync(`${dir}/${name}`);
  const png = (name) => PNG.sync.read(kept(name));
  const hub = JSON.parse(kept('windmill-r0-hub.json'));
  const fp = FOOTPRINTS.t1;
  const g = windmillGeometry();
  const opaque = (img, x, y) => img.data[(y * img.width + x) * 4 + 3] > 0;
  /** The pixels of one grey, as [x, y] of their middles on the canvas. */
  const pixelsOf = (img, rgb) => {
    const out = [];
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const o = (y * img.width + x) * 4;
        if (img.data[o + 3] && rgb.every((v, i) => img.data[o + i] === v))
          out.push([x + 0.5, y + 0.5]);
      }
    return out;
  };
  const centroid = (pts) => [
    pts.reduce((sum, q) => sum + q[0], 0) / pts.length,
    pts.reduce((sum, q) => sum + q[1], 0) / pts.length,
  ];
  const extent = (pts, k) => Math.max(...pts.map((q) => q[k])) - Math.min(...pts.map((q) => q[k]));
  const bands = new Set(WINDMILL_GREY.tower.map((c) => c[0]));
  /** The lowest pixel in a column that is one of the tower's own greys: the foot's front. */
  const footAt = (img, x) => {
    for (let y = img.height - 1; y >= 0; y--) {
      const o = (y * img.width + x) * 4;
      if (img.data[o + 3] && img.data[o] === img.data[o + 1] && bands.has(img.data[o])) return y;
    }
    return -1;
  };
  /** The radius of the tower's surface at height z, as the guide draws it. */
  const surface = (z) =>
    WINDMILL.baseRadius +
    ((WINDMILL.topRadius - WINDMILL.baseRadius) * (z - 4)) / WINDMILL.towerHeight;

  it('keeps the files the repository holds: all three, as the tool draws them', () => {
    const drawn = windmillFiles();
    expect(drawn.map(([file]) => file)).toEqual([
      `${dir}/windmill-r0.png`,
      `${dir}/windmill-r0-hub.json`,
      `${dir}/windmill-sails-face.png`,
    ]);
    for (const [file, bytes] of drawn)
      expect(Buffer.compare(bytes, readFileSync(file)), file).toBe(0);
    expect(hub).toEqual(windmillHub());
  });

  it("is asked for by a family's guide kind", () => {
    const families = JSON.parse(readFileSync(`${ROOT}/families.json`, 'utf8'));
    expect(windmillFamilies(families)).toEqual(['windmill']);
    expect(families.families.windmill.round).toBe(true);
    const root = mkdtempSync(join(tmpdir(), 'guides-'));
    try {
      // the footprints' guides (16) and then the windmill's three, as written to disk
      const written = writeGuides(root, [], true);
      expect(written).toHaveLength(16 + 3);
      const names = written.slice(16).map((f) => f.slice(root.length + 1));
      expect(names.map((f) => f.replaceAll('\\', '/'))).toEqual(windmillFiles().map(([f]) => f));
      for (const [file, bytes] of windmillFiles())
        expect(Buffer.compare(readFileSync(join(root, file)), bytes), file).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("draws the foot as the game's ellipse: minor over major 0.50, on the footprint's centre", () => {
    const img = drawWindmill({ plinth: false });
    expect([img.width, img.height]).toEqual(fp.canvas);
    // the tower is widest at its foot: the columns of its greys are the foot's width
    const cols = [];
    for (let x = 0; x < img.width; x++) if (footAt(img, x) >= 0) cols.push(x);
    // the outline, 3 px thick, takes 1.5 px off each side of the greys
    const a = (cols[cols.length - 1] - cols[0] + 1 + 3) / 2;
    const cx = Math.round((cols[cols.length - 1] + cols[0]) / 2);
    expect(Math.abs(cx + 0.5 - fp.centre[0])).toBeLessThan(1);
    expect(Math.abs(a - hub.tower.footEllipse.semiMajor)).toBeLessThan(3);
    // the foot's front is the middle of the 3 px outline: halfway between the lowest grey of the
    // tower and the lowest painted pixel (nothing is painted below the foot)
    const front = (x) => {
      let y = img.height - 1;
      while (!opaque(img, x, y)) y--;
      return (footAt(img, x) + y) / 2;
    };
    // right of the middle (the door is on the left): at t of the way to the side an ellipse of
    // ratio r stands r * a * (1 - sqrt(1 - t^2)) higher than at the middle, so the ratio is the
    // slope of that rise against its shape, over a
    const y0 = front(cx);
    let sxy = 0,
      sxx = 0;
    for (let x = cx; x <= cx + 0.9 * a; x++) {
      const shape = 1 - Math.sqrt(1 - ((x - cx) / a) ** 2);
      sxy += shape * (y0 - front(x));
      sxx += shape * shape;
    }
    expect(Math.abs(sxy / sxx / a - 0.5)).toBeLessThan(0.02);
    expect(hub.tower.footEllipse.minorOverMajor).toBe(0.5);
    expect(hub.tower.footEllipse.semiMinor / hub.tower.footEllipse.semiMajor).toBeCloseTo(0.5, 4);
  });

  /**
   * The windmill picture the game draws today, measured on the shipped atlas from its anchor (the
   * tile's centre on the ground), in game px as the renderer scales it: `structureScale` of the
   * frame's own height, which is its texels over the atlas's resolution; the texel is that scale
   * over the resolution.
   */
  const current = () => {
    const atlas = JSON.parse(readFileSync('public/assets/structures.json', 'utf8'));
    const f = atlas.frames['structures/windmill'];
    const sheet = PNG.sync.read(readFileSync('public/assets/structures.png'));
    const solidAt = (x, y) => sheet.data[((f.y + y) * sheet.width + f.x + x) * 4 + 3] > 127;
    const perTexel =
      structureScale('structures/windmill', f.h / atlas.resolution) / atlas.resolution;
    // the run of opaque texels through column x of a row, as [from, to]
    const run = (y, x) => {
      if (!solidAt(x, y)) return null;
      let from = x,
        to = x;
      while (from > 0 && solidAt(from - 1, y)) from--;
      while (to < f.w - 1 && solidAt(to + 1, y)) to++;
      return [from, to];
    };
    const width = (y, x) => {
      const r = run(y, x);
      return r ? r[1] - r[0] + 1 : 0;
    };
    // the tower's axis runs through its finial: the highest painted texels in the middle of the
    // frame's width (the sails reach higher, but out at the sides)
    const middle = Array.from(
      { length: Math.round(f.w * 0.16) },
      (_, i) => Math.round(f.w * 0.42) + i,
    );
    let top = 0;
    while (!middle.some((x) => solidAt(x, top))) top++;
    const finial = middle.filter((x) => solidAt(x, top + 4));
    const axis = Math.round(finial.reduce((sum, x) => sum + x, 0) / finial.length);
    // the cone proper starts where the run through the axis is wider than the finial's ball
    let cone = top;
    while (width(cone, axis) <= 20) cone++;
    // the foot: the tower's widest rows a little below the anchor, where no sail reaches
    const foot = [];
    for (let y = Math.round(f.ay) + 13; y <= Math.round(f.ay) + 19; y++)
      foot.push(width(y, axis) * perTexel);
    return {
      capTop: (f.ay - cone) * perTexel,
      footWidth: foot.reduce((sum, w) => sum + w, 0) / foot.length,
    };
  };

  it("is the size of the game's own windmill: the cap's top and the foot's width within 5%", () => {
    const now = current();
    // the reference itself: about 50 px to the cone cap, 43 px across the foot
    expect(now.capTop).toBeGreaterThan(48);
    expect(now.capTop).toBeLessThan(54);
    expect(now.footWidth).toBeGreaterThan(41);
    expect(now.footWidth).toBeLessThan(46);
    // the guide's apex above the ground, and the foot's width at the plinth's top
    expect(Math.abs(g.apex / now.capTop - 1)).toBeLessThan(0.05);
    const width = 2 * WINDMILL.baseRadius * 32 * Math.SQRT2;
    expect(Math.abs(width / now.footWidth - 1)).toBeLessThan(0.05);
    expect(g.apex).toBeCloseTo(51.4, 6);
    // and the drawn picture agrees: its highest painted point is the apex
    const img = png('windmill-r0.png');
    let first = 0;
    while (![...Array(img.width).keys()].some((x) => opaque(img, x, first))) first++;
    expect(Math.abs((fp.centre[1] - first) / fp.scale / now.capTop - 1)).toBeLessThan(0.05);
  });

  it('keeps the shape of a tower mill: a truncated cone under a cone cap, as the picture has it', () => {
    const img = png('windmill-r0.png');
    expect([img.width, img.height]).toEqual(fp.canvas);
    expect(g.eave).toBeCloseTo(4 + WINDMILL.towerHeight, 6);
    expect(g.apex).toBeCloseTo(4 + WINDMILL.towerHeight + WINDMILL.capHeight, 6);
    // the cap's apex is the highest painted point
    let first = 0;
    while (![...Array(img.width).keys()].some((x) => opaque(img, x, first))) first++;
    expect(Math.abs(first - project(fp, 0, 0, g.apex)[1])).toBeLessThan(4);
    const s = diamond(fp, 0).s;
    expect(at(img, [s[0] - 8, s[1] - 12])).toEqual(solid(GREY.plinthLeft));
    expect(at(img, [s[0] + 8, s[1] - 12])).toEqual(solid(GREY.plinthRight));
    // the tower narrows by about a third towards the cap (the picture's 124 texels at the foot,
    // 86 under the cap), the eave stands a little proud, the cap is about half the tower's height,
    // and it is no lighthouse: the foot is wider than three quarters of the height to the apex
    const ratio = WINDMILL.topRadius / WINDMILL.baseRadius;
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(0.8);
    expect(WINDMILL.capRadius).toBeGreaterThan(WINDMILL.topRadius);
    expect(WINDMILL.capHeight / WINDMILL.towerHeight).toBeGreaterThan(0.4);
    expect(WINDMILL.capHeight / WINDMILL.towerHeight).toBeLessThan(0.6);
    expect((2 * WINDMILL.baseRadius * 32 * Math.SQRT2) / g.apex).toBeGreaterThan(0.75);
  });

  it('shades the tower and its cap by the way they face: the lower left lighter than the lower right', () => {
    const img = png('windmill-r0.png');
    const tower = (a) => {
      const r = surface(30);
      return at(img, project(fp, r * Math.cos(a), r * Math.sin(a), 30))[0];
    };
    const cap = (a) => {
      const z = g.eave + 5;
      const r = (WINDMILL.capRadius * (g.apex - z)) / WINDMILL.capHeight;
      return at(img, project(fp, r * Math.cos(a), r * Math.sin(a), z))[0];
    };
    // +y is the lower-left face, +x the lower-right one: a point of each, off the stub and the door
    const [left, right] = [Math.PI * 0.35, -Math.PI * 0.1];
    expect(tower(left)).toBeGreaterThan(tower(right));
    expect(cap(left)).toBeGreaterThan(cap(right));
    expect(cap(left)).toBeGreaterThan(tower(left));
    expect(bands.has(tower(left)) && bands.has(tower(right))).toBe(true);
  });

  it('points the windshaft stub along tile +y: down and to the left, at slope 0.50', () => {
    const img = png('windmill-r0.png');
    const stub = pixelsOf(img, WINDMILL_GREY.stub);
    expect(stub.length).toBeGreaterThan(500);
    // the stub's middle line: the middle of each column's pixels, where the column holds the
    // stub's full width (the plate covers one end, and the cap meets the other)
    const columns = new Map();
    for (const [x, y] of stub) columns.set(x, [...(columns.get(x) ?? []), y]);
    const spans = [...columns].map(([x, ys]) => ({
      x,
      mid: (Math.min(...ys) + Math.max(...ys)) / 2,
      n: ys.length,
    }));
    const widest = Math.max(...spans.map((c) => c.n));
    const full = spans.filter((c) => c.n >= widest - 1);
    expect(full.length).toBeGreaterThan(12);
    const mx = full.reduce((sum, c) => sum + c.x, 0) / full.length,
      my = full.reduce((sum, c) => sum + c.mid, 0) / full.length;
    const slope =
      full.reduce((sum, c) => sum + (c.x - mx) * (c.mid - my), 0) /
      full.reduce((sum, c) => sum + (c.x - mx) ** 2, 0);
    // screen y runs down: a line that falls to the left rises to the right, so the slope is -0.50
    expect(Math.abs(slope + 0.5)).toBeLessThan(0.03);
    expect(hub.shaft.screenSlope).toBeCloseTo(0.5, 3);
    expect(hub.shaft.screenDirection[0]).toBeLessThan(0);
    expect(hub.shaft.screenDirection[1]).toBeGreaterThan(0);
    // it leaves the tower's axis for the hub, which is on the lower left of it
    const [ax, ay] = hub.shaft.from.canvas;
    expect(ax).toBeCloseTo(fp.centre[0], 6);
    expect(hub.hub.canvas[0]).toBeLessThan(ax);
    expect(hub.hub.canvas[1]).toBeGreaterThan(ay);
    expect(hub.hub.tile).toEqual([0, WINDMILL.shaftLength]);
    expect(WINDMILL.shaftLength).toBe(0.5);
    const end = project(fp, 0, WINDMILL.shaftLength, g.hubZ);
    expect(hub.hub.canvas.map((v) => Math.round(v * 100))).toEqual(
      end.map((v) => Math.round(v * 100)),
    );
  });

  it("has the hub file agree with the drawn stub's end to a pixel", () => {
    const img = png('windmill-r0.png');
    const plate = pixelsOf(img, WINDMILL_GREY.plate);
    expect(plate.length).toBeGreaterThan(1000);
    const [px, py] = centroid(plate);
    expect(Math.abs(px - hub.hub.canvas[0])).toBeLessThan(1);
    expect(Math.abs(py - hub.hub.canvas[1])).toBeLessThan(1);
    // in game px from the anchor, where the game places it
    expect(Math.abs(hub.hub.fromAnchorGame[0] - (px - fp.centre[0]) / fp.scale)).toBeLessThan(0.2);
    expect(Math.abs(hub.hub.fromAnchorGame[1] - (py - fp.centre[1]) / fp.scale)).toBeLessThan(0.2);
    expect(hub.anchor).toEqual(fp.centre);
    // the stub's own line, carried to the hub's column, meets the hub within 1 game px
    const stub = pixelsOf(img, WINDMILL_GREY.stub);
    const mx = stub.reduce((sum, q) => sum + q[0], 0) / stub.length,
      my = stub.reduce((sum, q) => sum + q[1], 0) / stub.length;
    const slope =
      stub.reduce((sum, q) => sum + (q[0] - mx) * (q[1] - my), 0) /
      stub.reduce((sum, q) => sum + (q[0] - mx) ** 2, 0);
    const yAtHub = my + slope * (hub.hub.canvas[0] - mx);
    expect(Math.abs(yAtHub - hub.hub.canvas[1])).toBeLessThan(fp.scale);
    // the hub is at the cap: above the eave and below the apex
    expect(hub.hub.heightAboveGround).toBeGreaterThan(g.eave);
    expect(hub.hub.heightAboveGround).toBeLessThan(g.apex);
    expect(hub.hub.heightAboveGround).toBeCloseTo(g.hubZ, 6);
    // the plate is a circle of the cross: its width and height are the affine's, less the outline
    const R = WINDMILL.plateRadius * fp.scale;
    const [A, B] = CROSS_AFFINE;
    expect(Math.abs(extent(plate, 0) + 3 - 2 * R * Math.hypot(A[0], A[1]))).toBeLessThan(3);
    expect(Math.abs(extent(plate, 1) + 3 - 2 * R * Math.hypot(B[0], B[1]))).toBeLessThan(3);
  });

  it('puts a true door on the +y face at the foot: 2.1 m by 1.0 m, 10.8 px beside the 9 px person', () => {
    const img = png('windmill-r0.png');
    const [dx, dy] = hub.door.canvas;
    expect(at(img, [dx, dy])).toEqual(solid(GREY.opening));
    // lower left of the tower's axis
    expect(dx).toBeLessThan(fp.centre[0] - 40);
    // 2.1 m is 2.1 / 1.75 of the person's 9 px
    expect(METRE_PX).toBeCloseTo(9 / 1.75, 9);
    expect(Math.abs(WINDMILL.doorHeight - 10.8)).toBeLessThan(0.5);
    expect(hub.door.heightPx).toBeCloseTo(10.8, 3);
    expect([hub.door.heightMetres, hub.door.widthMetres]).toEqual([2.1, 1]);
    // the opening's height up its middle column, in game px (the outline takes 1.5 px off each end)
    const fill = pixelsOf(img, GREY.opening);
    const column = fill.filter(([x]) => Math.abs(x - dx) < 1);
    expect(Math.abs((extent(column, 1) + 3) / fp.scale - 10.8)).toBeLessThan(0.5);
    // a metre along tile x: an upright metre is METRE_PX, which is sqrt(3) / 2 of the camera's
    // unit length, and a tile is 32 * sqrt(2) of those
    const oneMetre = METRE_PX / (Math.sqrt(3) / 2);
    expect(Math.abs(WINDMILL.doorWidth * 32 * Math.SQRT2 - oneMetre)).toBeLessThan(1e-9);
    expect(hub.door.widthTiles).toBeCloseTo(WINDMILL.doorWidth, 4);
    // its width on the middle row, outline included: the metre's run along x on the screen is
    // 1/sqrt(2) of its length
    let from = Math.round(dx - 0.5),
      to = from;
    const dark = (x) => {
      const o = (Math.round(dy - 0.5) * img.width + x) * 4;
      return [GREY.opening, GREY.line].some((c) => c[0] === img.data[o] && img.data[o + 3] > 0);
    };
    while (dark(from - 1)) from--;
    while (dark(to + 1)) to++;
    expect(Math.abs(to - from + 1 - oneMetre * Math.SQRT1_2 * fp.scale)).toBeLessThan(8);
  });

  it('turns the sails at a radius that clears the ground by a metre at the lowest tip', () => {
    const sails = hub.cross.sails;
    expect(sails.radiusGamePx).toBe(WINDMILL.sailRadius);
    // a cross turning in its plane: the lowest tip hangs R * sqrt(3) / 2 below the hub, whatever the phase
    const drop = WINDMILL.sailRadius * CROSS_AFFINE[1][1];
    expect(sails.lowestTipDropPx).toBeCloseTo(drop, 3);
    expect(hub.hub.heightAboveGround - drop).toBeGreaterThanOrEqual(METRE_PX);
    expect(sails.lowestTipAboveGroundMetres).toBeGreaterThanOrEqual(1);
    expect(sails.lowestTipAboveGroundMetres).toBeCloseTo((g.hubZ - drop) / METRE_PX, 3);
    // the sails picture's farthest painted point is that radius at the scale the file gives
    expect(sails.gamePxPerCrossPx * SAILS_FACE.reach * SAILS_FACE.size).toBeCloseTo(
      WINDMILL.sailRadius,
      3,
    );
  });

  it('says how the cross is seen: the plane of tile x and the vertical, an ellipse of 0.612', () => {
    const A = hub.cross.affine;
    expect(A).toEqual(CROSS_AFFINE.map((row) => row.map((v) => Math.round(v * 1e4) / 1e4)));
    expect(A[0][1]).toBe(0);
    // u runs along tile x, which the camera draws as the slope 0.5, and v along the vertical
    const x1 = project(fp, 1, 0);
    expect((x1[1] - fp.centre[1]) / (x1[0] - fp.centre[0])).toBeCloseTo(A[1][0] / A[0][0], 3);
    // the affine carries a circle to an ellipse whose minor over major is 0.612
    const norms = [];
    for (let i = 0; i < 3600; i++) {
      const t = (i / 3600) * 2 * Math.PI;
      const [u, v] = [Math.cos(t), Math.sin(t)];
      norms.push(
        Math.hypot(
          CROSS_AFFINE[0][0] * u + CROSS_AFFINE[0][1] * v,
          CROSS_AFFINE[1][0] * u + CROSS_AFFINE[1][1] * v,
        ),
      );
    }
    const ratio = Math.min(...norms) / Math.max(...norms);
    expect(Math.abs(ratio - 0.612)).toBeLessThan(0.001);
    expect(hub.cross.ellipseMinorOverMajor).toBeCloseTo(ratio, 3);
    // and takes the sails' square's corners to a parallelogram of the area the ellipse needs
    const map = ([u, v]) => [
      CROSS_AFFINE[0][0] * u + CROSS_AFFINE[0][1] * v,
      CROSS_AFFINE[1][0] * u + CROSS_AFFINE[1][1] * v,
    ];
    const [c0, c1, c2] = [
      [-1, -1],
      [1, -1],
      [1, 1],
    ].map(map);
    const area = Math.abs((c1[0] - c0[0]) * (c2[1] - c1[1]) - (c1[1] - c0[1]) * (c2[0] - c1[0]));
    expect(area).toBeCloseTo(4 * CROSS_AFFINE[0][0] * CROSS_AFFINE[1][1], 6);
  });

  it('draws the sail cross face on: a square, the hub in the middle, arms at 45 degrees', () => {
    const img = png('windmill-sails-face.png');
    expect([img.width, img.height]).toEqual([1254, 1254]);
    expect(hub.cross.sailsFace).toMatchObject({
      picture: 'windmill-sails-face.png',
      size: [1254, 1254],
      pivot: [626.5, 626.5],
    });
    const [cx, cy] = SAILS_FACE.pivot;
    let reach = 0,
      mx = 0,
      my = 0,
      n = 0;
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++)
        if (opaque(img, x, y)) {
          reach = Math.max(reach, Math.hypot(x - cx, y - cy));
          mx += x;
          my += y;
          n++;
        }
    // the farthest painted pixel is 0.46 of the side from the hub, and the cross is centred on it
    expect(Math.abs(reach / img.width - 0.46)).toBeLessThan(0.003);
    expect(Math.abs(mx / n - cx)).toBeLessThan(0.5);
    expect(Math.abs(my / n - cy)).toBeLessThan(0.5);
    // arms on the diagonals, nothing on the axes beyond the plate
    const mid = img.width / 2;
    for (const r of [200, 300, 400, 500]) {
      const d = r * Math.SQRT1_2;
      expect(opaque(img, Math.floor(mid + d), Math.floor(mid - d)), `arm at ${r}`).toBe(true);
      expect(opaque(img, Math.floor(mid + r), Math.floor(mid)), `axis ${r}`).toBe(false);
      expect(opaque(img, Math.floor(mid), Math.floor(mid + r)), `axis ${r}`).toBe(false);
    }
    // a quarter turn maps it onto itself
    for (let y = 0; y < img.height; y += 7)
      for (let x = 0; x < img.width; x += 7)
        expect(opaque(img, x, y)).toBe(opaque(img, img.width - 1 - y, x));
    // the plate is about 80 px from the hub at its corners
    const plate = pixelsOf(img, WINDMILL_GREY.plate);
    const far = Math.max(...plate.map(([x, y]) => Math.hypot(x - 0.5 - cx, y - 0.5 - cy)));
    expect(Math.abs(far - 80)).toBeLessThan(4);
  });
});
