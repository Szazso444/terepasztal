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
  OBLONG,
  PIER_GREY,
  PLAN_CANVAS,
  PLAN_JOBS,
  SAILS_FACE,
  WINDMILL,
  WINDMILL_GREY,
  WINDMILL_TURNS,
  blockOf,
  crossAffine,
  drawGuide,
  drawOblong,
  drawWindmill,
  familyBlocks,
  frontHidden,
  guideFile,
  oblongFiles,
  oblongPlan,
  oblongPlanFile,
  openingsOf,
  planBase,
  planFileOf,
  planFiles,
  planGuideFile,
  drawPlan,
  portalWall,
  windmillFamilies,
  windmillFiles,
  windmillGeometry,
  windmillHub,
  winchOpening,
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

describe("the coaling stage's oblong guides", { timeout: 30_000 }, () => {
  const dir = `${ROOT}/guides`;
  const fp = FOOTPRINTS.t1;
  const families = JSON.parse(readFileSync(`${ROOT}/families.json`, 'utf8'));
  const height = families.families.fuel_stop.blockHeight;
  const png = (rot) => PNG.sync.read(readFileSync(`${dir}/fuel_stop-oblong-r${rot}.png`));
  const plan = (rot) =>
    JSON.parse(readFileSync(`${dir}/fuel_stop-oblong-r${rot}-plan.json`, 'utf8'));
  const opaque = (img, x, y) => img.data[(y * img.width + x) * 4 + 3] > 0;
  /** The pixels of one grey, as [x, y]. */
  const pixelsOf = (img, rgb) => {
    const out = [];
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const o = (y * img.width + x) * 4;
        if (img.data[o + 3] && rgb.every((v, i) => img.data[o + i] === v)) out.push([x, y]);
      }
    return out;
  };
  /** The columns, and the rows, that hold an opaque pixel: [first, last]. */
  const extent = (img) => {
    let x0 = img.width,
      x1 = -1,
      y0 = img.height,
      y1 = -1;
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++)
        if (opaque(img, x, y)) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
    return { x0, x1, y0, y1 };
  };

  it('is asked for the three turned views of the coaling stage, at the height its family asks for', () => {
    expect(OBLONG.family).toBe('fuel_stop');
    expect(OBLONG.views).toEqual([1, 2, 3]);
    expect(familyBlocks(loadInventory(), families).map((b) => b.family)).toContain(OBLONG.family);
    expect(height).toBe(62);
  });

  it('keeps the files the repository holds: a picture and a plan file per view, as the tool draws them', () => {
    const drawn = oblongFiles(height);
    expect(drawn.map(([file]) => file)).toEqual(
      OBLONG.views.flatMap((r) => [
        `${dir}/fuel_stop-oblong-r${r}.png`,
        `${dir}/fuel_stop-oblong-r${r}-plan.json`,
      ]),
    );
    for (const [file, bytes] of drawn)
      expect(Buffer.compare(bytes, readFileSync(file)), file).toBe(0);
    const root = mkdtempSync(join(tmpdir(), 'oblong-'));
    try {
      const written = writeGuides(
        root,
        [{ family: 'fuel_stop', footprint: 't1', height }],
        false,
        false,
      );
      // the footprints' 16, the family's own 4, and the oblong guides' six files
      expect(written).toHaveLength(16 + 4 + 6);
      const names = written.slice(20).map((f) => f.slice(root.length + 1).replaceAll('\\', '/'));
      expect(names).toEqual(oblongFiles(height).map(([f]) => f));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("has the finished front view's plan: the walls' feet 0.423 : 0.577, the long side lower left in r1 and r3", () => {
    for (const r of OBLONG.views) {
      const j = plan(r);
      expect(j.plan.lowerLeftShare + j.plan.lowerRightShare).toBeCloseTo(1, 3);
      const long = r % 2 === 1 ? 'lowerLeftShare' : 'lowerRightShare';
      expect(j.plan[long], `r${r}`).toBeCloseTo(0.577, 3);
      // r0's plan, 1 : 1.364, turned over where the long side is on the left
      expect(j.plan.lowerLeftOverLowerRight, `r${r}`).toBeCloseTo(
        r % 2 === 1 ? 1.364 : 1 / 1.364,
        2,
      );
      expect(j.plan.longSide).toBe(r % 2 === 1 ? 'lower left' : 'lower right');
      // the measured feet agree with the plan file: the near corner splits the walls' span
      const { w, s, e } = j.walls.corners;
      expect((s[0] - w[0]) / (e[0] - w[0])).toBeCloseTo(j.plan.lowerLeftShare, 3);
      // the 2:1 lines: the near corner is below both ends
      expect(s[1]).toBeGreaterThan(Math.max(w[1], e[1]));
    }
  });

  it("keeps the footprint's width and the square guide's rows, so that the fit's height is the same number", () => {
    const square = drawGuide('t1', 1, height);
    const sq = extent(square);
    for (const r of OBLONG.views) {
      const j = plan(r);
      const img = png(r);
      const { block } = oblongPlan(r);
      // the walls' span and the near corner's row are the square guide's: (x + y) is the same
      expect(2 * (block.x1 + block.y1)).toBeCloseTo(2 * 2 * (0.5 - 0.06), 9);
      expect(j.walls.spanPx).toBeCloseTo(450.56, 6);
      expect(j.block.wallSpanPx).toBeCloseTo(450.56, 6);
      expect(j.block.nearCornerRow).toBeCloseTo(944.64, 6);
      // the highest painted pixel is the block's far corner, as in the square guide (3 px outline)
      expect(extent(img).y0).toBe(sq.y0);
      expect(Math.abs(j.block.topFarCornerRow - (sq.y0 + 1.5))).toBeLessThan(1);
      expect(j.block.heightPx).toBe(62);
      expect(extent(img).y1).toBe(sq.y1);
      // the plinth is as wide as the footprint's: the corners' span is 64 game px
      expect(j.plinth.spanPx).toBe(64 * fp.scale);
      expect(j.plinth.spanPx).toBe(512);
    }
  });

  it("states the plinth's width that the painting must hold, measured on the drawn picture", () => {
    for (const r of OBLONG.views) {
      const j = plan(r);
      const img = png(r);
      // the opaque width of the plinth (its corners w and e, the 3 px outline included): the
      // picture's own width, since nothing stands wider, and the piers are inside it
      const e = extent(img);
      const width = e.x1 - e.x0 + 1;
      expect(j.paintedWidth.mustHoldPx[0]).toBe(width);
      expect(width).toBe(516);
      // in a 1254 px return: 632 px (the review of 2026-10-18 took 631 for it)
      expect(j.toReturn).toBeCloseTo(1254 / 1024, 4);
      expect(Math.round(j.paintedWidth.mustHoldPx[1])).toBe(632);
      // the painted stage may be 5% wider at most; the painter's 15 to 26% is far outside that
      const { minPx, maxPx, tolerance } = j.paintedWidth;
      expect(tolerance).toBe(0.05);
      expect(maxPx[0] / width).toBeCloseTo(1.05, 4);
      expect(minPx[0] / width).toBeCloseTo(0.95, 4);
      expect(maxPx[1] / j.paintedWidth.mustHoldPx[1]).toBeCloseTo(1.05, 4);
      for (const over of OBLONG.painted.overshoot) expect(1 + over).toBeGreaterThan(1.05);
      expect(OBLONG.painted.overshoot).toEqual([0.15, 0.26]);
      // the words a prompt quotes carry the same numbers
      for (const n of [width, 632, Math.round(maxPx[0]), Math.round(maxPx[1])])
        expect(j.paintedWidth.words, `r${r} ${n}`).toContain(`${n} px`);
    }
  });

  it('stands six pier stubs on the plinth, three along the long side, in the stub greys, nothing outside it', () => {
    for (const r of OBLONG.views) {
      const j = plan(r);
      const img = png(r);
      const p = oblongPlan(r);
      expect(p.piers).toHaveLength(6);
      expect(j.piers).toHaveLength(6);
      // three along the long side, two along the short one
      const along = p.longX ? 0 : 1;
      const across = 1 - along;
      for (const side of [-1, 1]) {
        const row = p.piers.filter((q) => Math.sign(q[across]) === side);
        expect(row.map((q) => q[along]).sort((a, b) => a - b)).toEqual([
          -Math.max(...row.map((q) => q[along])),
          0,
          Math.max(...row.map((q) => q[along])),
        ]);
      }
      expect(new Set(p.piers.map((q) => q[across])).size).toBe(2);
      // a stub stands at every visible pier's foot: its stub grey is just above the foot
      const stub = new Set(
        [PIER_GREY.top, PIER_GREY.left, PIER_GREY.right].map((c) => c.join(',')),
      );
      for (const q of j.piers) {
        if (q.wall === 'hidden') continue;
        const [fx, fy] = q.foot;
        const o = (Math.round(fy - 16) * img.width + Math.round(fx - 10)) * 4;
        expect(stub.has([...img.data.subarray(o, o + 3)].join(',')), `r${r} pier ${q.id}`).toBe(
          true,
        );
      }
      // four stand where the camera sees them: the near corner's, the two walls' and the far ends'
      expect(j.piers.filter((q) => q.wall !== 'hidden').length).toBe(4);
      // the stubs are inside the plinth's width: its corners w and e are the picture's extremes
      const { w, e, s } = j.plinth.corners;
      for (const [x, y] of pixelsOf(img, PIER_GREY.top)) {
        expect(x).toBeGreaterThanOrEqual(w[0]);
        expect(x).toBeLessThanOrEqual(e[0]);
        expect(y).toBeLessThanOrEqual(s[1]);
      }
    }
  });

  it('shades the stage as the other guides do, and marks the winch where the front is seen', () => {
    for (const r of OBLONG.views) {
      const img = png(r);
      const j = plan(r);
      const b = oblongPlan(r).block;
      const top = project(fp, 0, 0, 4 + 62);
      expect(at(img, top)).toEqual(solid(GREY.top));
      expect(at(img, project(fp, b.x1 * 0.5, b.y1, 4 + 30))).toEqual(solid(GREY.left));
      expect(at(img, project(fp, b.x1, b.y1 * 0.5, 4 + 30))).toEqual(solid(GREY.right));
      expect(j.winch.visible).toBe(r === 3);
      expect(winchOpening(r) !== null).toBe(r === 3);
    }
    // r3: the winch opening is on the lower-right wall, at its near (bottom) end, 20 px high
    const img = png(3);
    const pts = plan(3).winch.outline;
    const mid = [
      pts.reduce((sum, q) => sum + q[0], 0) / 4,
      pts.reduce((sum, q) => sum + q[1], 0) / 4,
    ];
    expect(at(img, mid)).toEqual(solid(GREY.opening));
    const b = oblongPlan(3).block;
    const nearEnd = project(fp, b.x1, b.y1, 4);
    const farEnd = project(fp, b.x1, -b.y1, 4);
    expect(Math.hypot(mid[0] - nearEnd[0], mid[1] - nearEnd[1])).toBeLessThan(
      Math.hypot(mid[0] - farEnd[0], mid[1] - farEnd[1]),
    );
    expect(mid[0]).toBeGreaterThan(fp.centre[0]);
    // the plan file and the drawing say the same of every view
    for (const r of OBLONG.views) expect(plan(r)).toEqual(oblongPlanFile(r, height));
    expect(Buffer.compare(drawOblong(3, height).data, png(3).data)).toBe(0);
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

  it('keeps the files the repository holds: every view and the sail cross, as the tool draws them', () => {
    const drawn = windmillFiles();
    expect(drawn.map(([file]) => file)).toEqual([
      `${dir}/windmill-r0.png`,
      `${dir}/windmill-r0-hub.json`,
      `${dir}/windmill-sails-face.png`,
      ...[1, 2, 3].flatMap((r) => [`${dir}/windmill-r${r}.png`, `${dir}/windmill-r${r}-hub.json`]),
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
      // the footprints' guides (16) and then the windmill's nine, as written to disk
      const written = writeGuides(root, [], true, false);
      expect(written).toHaveLength(16 + 9);
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

  describe('in each of its four views', () => {
    const views = [0, 1, 2, 3];
    const hubOf = (r) => JSON.parse(kept(`windmill-r${r}-hub.json`));
    const tower = (r) => png(`windmill-r${r}.png`);
    /** The slope of the stub's middle line, over the columns that hold its full width. */
    const stubSlope = (stub) => {
      const columns = new Map();
      for (const [x, y] of stub) columns.set(x, [...(columns.get(x) ?? []), y]);
      const spans = [...columns].map(([x, ys]) => ({
        x,
        mid: (Math.min(...ys) + Math.max(...ys)) / 2,
        n: ys.length,
      }));
      const widest = Math.max(...spans.map((c) => c.n));
      const full = spans.filter((c) => c.n >= widest - 1);
      const mx = full.reduce((sum, c) => sum + c.x, 0) / full.length,
        my = full.reduce((sum, c) => sum + c.mid, 0) / full.length;
      return (
        full.reduce((sum, c) => sum + (c.x - mx) * (c.mid - my), 0) /
        full.reduce((sum, c) => sum + (c.x - mx) ** 2, 0)
      );
    };

    it('has a hub file and a picture for every view, and the hub file names its own picture', () => {
      for (const r of views) {
        const h = hubOf(r);
        expect(h.guide).toBe(`windmill-r${r}.png`);
        expect([h.view, h.rotation, h.front]).toEqual([`r${r}`, r, 'SWNE'[r]]);
        expect(h).toEqual(windmillHub(r));
        expect([tower(r).width, tower(r).height]).toEqual(fp.canvas);
      }
      // the front turns S, W, N, E as the building's does (WALLS in building-kit.mjs)
      expect(WINDMILL_TURNS.map((t) => t.front)).toEqual(ROTATIONS.map((t) => t.front));
    });

    it('turns the shaft with the front: +y, -x, -y, +x, so the hub is on the lower left, upper left, upper right, lower right', () => {
      const want = [
        { tile: [0, 0.5], game: [-16, -34], face: 'lower left' },
        { tile: [-0.5, 0], game: [-16, -50], face: 'upper left' },
        { tile: [0, -0.5], game: [16, -50], face: 'upper right' },
        { tile: [0.5, 0], game: [16, -34], face: 'lower right' },
      ];
      for (const r of views) {
        const h = hubOf(r);
        expect(h.hub.tile).toEqual(want[r].tile);
        expect(h.hub.fromAnchorGame).toEqual(want[r].game);
        expect(h.shaft.face).toBe(want[r].face);
        expect(h.hub.canvas).toEqual([
          fp.centre[0] + want[r].game[0] * fp.scale,
          fp.centre[1] + want[r].game[1] * fp.scale,
        ]);
        // the shaft's screen direction: the same 2:1 slope, the way the hub lies from the axis
        expect(h.shaft.screenSlope).toBeCloseTo(0.5, 3);
        const [dx, dy] = h.shaft.screenDirection;
        expect(Math.sign(dx)).toBe(Math.sign(want[r].game[0]));
        expect(Math.sign(dy)).toBe(r === 0 || r === 3 ? 1 : -1);
        // the height is the same in every view: at the cap
        expect(h.hub.heightAboveGround).toBe(g.hubZ);
      }
    });

    it("draws the hub plate at the hub file's position in every view, to a pixel", () => {
      for (const r of views) {
        const h = hubOf(r);
        const plate = pixelsOf(tower(r), WINDMILL_GREY.plate);
        expect(plate.length, `r${r}`).toBeGreaterThan(1000);
        const [px, py] = centroid(plate);
        expect(Math.abs(px - h.hub.canvas[0]), `r${r}`).toBeLessThan(1);
        expect(Math.abs(py - h.hub.canvas[1]), `r${r}`).toBeLessThan(1);
        // the plate's size is the cross plane's circle, seen as the view's own affine has it
        const R = WINDMILL.plateRadius * fp.scale;
        const [A, B] = h.cross.affine;
        expect(Math.abs(extent(plate, 0) + 3 - 2 * R * Math.hypot(A[0], A[1]))).toBeLessThan(3);
        expect(Math.abs(extent(plate, 1) + 3 - 2 * R * Math.hypot(B[0], B[1]))).toBeLessThan(3);
        // the stub's own line meets the hub within a game px
        const stub = pixelsOf(tower(r), WINDMILL_GREY.stub);
        expect(stub.length, `r${r}`).toBeGreaterThan(200);
        const slope = stubSlope(stub);
        const mx = stub.reduce((sum, q) => sum + q[0], 0) / stub.length,
          my = stub.reduce((sum, q) => sum + q[1], 0) / stub.length;
        expect(Math.abs(Math.abs(slope) - 0.5), `r${r}`).toBeLessThan(0.03);
        // down to the left (r0), up to the left (r1), up to the right (r2), down to the right (r3)
        expect(Math.sign(slope)).toBe(r === 0 || r === 2 ? -1 : 1);
        const yAtHub = my + slope * (h.hub.canvas[0] - mx);
        expect(Math.abs(yAtHub - h.hub.canvas[1]), `r${r}`).toBeLessThan(fp.scale);
      }
    });

    it('puts the shaft and the plate behind the tower where the front is away from the camera', () => {
      expect(views.map(frontHidden)).toEqual([false, true, true, false]);
      for (const r of views) {
        const h = hubOf(r);
        expect(h.shaft.behindTower).toBe(frontHidden(r));
        // the hidden stub starts behind the cap: its root is covered, so fewer of its pixels show
        // than where it is in front
        const stub = pixelsOf(tower(r), WINDMILL_GREY.stub).length;
        expect(stub, `r${r}`).toBeGreaterThan(200);
        // the cap's colours, not the stub's, are at the shaft's root on the axis side
        const [ax, ay] = h.shaft.from.canvas;
        const rootX = ax + (h.hub.canvas[0] - ax) * 0.25,
          rootY = ay + (h.hub.canvas[1] - ay) * 0.25;
        const root = at(tower(r), [rootX, rootY]);
        if (frontHidden(r)) expect(root).not.toEqual(solid(WINDMILL_GREY.stub));
      }
      // behind the cap the stub is covered at its root: less of it shows than the stub in front
      const shown = (r) => pixelsOf(tower(r), WINDMILL_GREY.stub).length;
      expect(shown(1)).toBeLessThan(shown(0));
      expect(shown(2)).toBeLessThan(shown(3));
    });

    it('has a door only where the front can be seen: r0 on the lower left, r3 on the lower right', () => {
      for (const r of views) {
        const h = hubOf(r);
        const dark = pixelsOf(tower(r), GREY.opening);
        expect(h.door.visible).toBe(!frontHidden(r));
        if (frontHidden(r)) {
          expect(dark.length, `r${r}`).toBe(0);
          expect(h.door.canvas).toBeNull();
          continue;
        }
        expect(dark.length, `r${r}`).toBeGreaterThan(300);
        const [dx, dy] = h.door.canvas;
        expect(at(tower(r), [dx, dy]), `r${r}`).toEqual(solid(GREY.opening));
        expect(r === 0 ? dx < fp.centre[0] - 40 : dx > fp.centre[0] + 40).toBe(true);
        // 2.1 m high up its middle column, the same in both views
        const column = dark.filter(([x]) => Math.abs(x + 0.5 - dx) < 1);
        expect(Math.abs((extent(column, 1) + 3) / fp.scale - 10.8)).toBeLessThan(0.7);
      }
    });

    it('is one tower in four views: the tower and its cap are the same pixels, whichever way the front turns', () => {
      const grey = new Set([...WINDMILL_GREY.tower, ...WINDMILL_GREY.cap].map((c) => c[0]));
      const count = (r) => {
        const img = tower(r);
        let n = 0;
        for (let i = 0; i < img.data.length; i += 4)
          if (img.data[i + 3] && img.data[i] === img.data[i + 1] && grey.has(img.data[i])) n++;
        return n;
      };
      // the door takes a few hundred pixels of the tower's grey where it is drawn
      const base = count(1);
      expect(Math.abs(count(2) - base)).toBeLessThan(5);
      expect(base - count(0)).toBeGreaterThan(300);
      expect(Math.abs(count(0) - count(3))).toBeLessThan(60);
      // the foot's ellipse: the same in every view
      const foot = views.map((r) => hubOf(r).tower.footEllipse);
      for (const f of foot) expect(f).toEqual(foot[0]);
    });

    it("gives each view's affine of the cross: the plane square to its shaft, the same 0.612 ellipse", () => {
      expect(crossAffine(0)).toEqual(CROSS_AFFINE);
      for (const r of views) {
        const h = hubOf(r);
        const A = crossAffine(r);
        expect(h.cross.affine).toEqual(A.map((row) => row.map((v) => Math.round(v * 1e4) / 1e4)));
        expect(A[0][1]).toBe(0);
        // u runs along the tile axis the file names, which the camera draws at the slope 0.5,
        // and v along the vertical
        const [tx, ty] = WINDMILL_TURNS[r].across;
        const u = project(fp, tx, ty);
        expect((u[0] - fp.centre[0]) / (fp.scale * 32 * Math.SQRT2)).toBeCloseTo(A[0][0], 6);
        expect((u[1] - fp.centre[1]) / (fp.scale * 32 * Math.SQRT2)).toBeCloseTo(A[1][0], 6);
        expect(A[1][1]).toBeCloseTo(Math.sqrt(3) / 2, 9);
        // the shaft is square to the plane: u is across the shaft's tile direction
        const [sx, sy] = WINDMILL_TURNS[r].shaft;
        expect(sx * tx + sy * ty + 0).toBe(0);
        // a circle becomes the 0.612 ellipse, in every view
        expect(h.cross.ellipseMinorOverMajor).toBeCloseTo(0.612, 3);
        // seen from the front where the front is in view, from behind where it is not: the
        // determinant's sign says which
        const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
        expect(Math.sign(det)).toBe(h.cross.determinantSign === '+' ? 1 : -1);
        expect(h.cross.determinantSign).toBe(r === 0 || r === 3 ? '+' : '-');
        expect(h.cross.seenFrom.startsWith('behind')).toBe(frontHidden(r));
        expect(Math.abs(Math.abs(det) - ((Math.SQRT1_2 * Math.sqrt(3)) / 2) * 1)).toBeLessThan(
          1e-9,
        );
        // the sails clear the ground by the same metre and a bit in every view
        expect(h.cross.sails.lowestTipAboveGroundMetres).toBeGreaterThanOrEqual(1);
      }
      // the view's affine is the first's turned with the building: a quarter turn of the cross's
      // axis along the tiles (+x, +y, -x, -y)
      expect(WINDMILL_TURNS.map((t) => t.across)).toEqual([
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ]);
    });

    it('keeps the sail cross picture, one for all four views, and says so in each hub file', () => {
      for (const r of views) expect(hubOf(r).cross.sailsFace).toEqual(hub.cross.sailsFace);
      expect(WINDMILL_TURNS).toHaveLength(4);
    });
  });
});

describe('the plan guides of review 2 (#535)', { timeout: 60_000 }, () => {
  const png = (id, rot) => PNG.sync.read(readFileSync(planGuideFile(id, rot)));
  const plan = (id, rot) => JSON.parse(readFileSync(planFileOf(id, rot), 'utf8'));
  const job = (id) => PLAN_JOBS.find((j) => j.id === id);
  const all = PLAN_JOBS.flatMap((j) => j.views.map((r) => [j, r]));
  const opaque = (img, x, y) => img.data[(y * img.width + x) * 4 + 3] > 0;
  const rgbAt = (img, [x, y]) => {
    const o = (Math.round(y) * img.width + Math.round(x)) * 4;
    return [...img.data.subarray(o, o + 3)];
  };
  const round4 = (v) => Math.round(v * 1e4) / 1e4;
  /** The first and last column and row that hold a pixel `pick` accepts (any opaque pixel by default). */
  const extent = (img, pick = () => true) => {
    let x0 = img.width,
      x1 = -1,
      y0 = img.height,
      y1 = -1;
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const o = (y * img.width + x) * 4;
        if (img.data[o + 3] && pick([...img.data.subarray(o, o + 3)])) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
      }
    return { x0, x1, y0, y1 };
  };
  const isGrey = (list) => (rgb) => list.some((g) => g.every((v, i) => v === rgb[i]));

  it('is asked for what the review asks for: each job, its footprint and its views', () => {
    expect(
      PLAN_JOBS.map((j) => [j.id, j.span.join('x'), j.views.map((r) => `r${r}`).join(' ')]),
    ).toEqual([
      ['big_station', '2x1', 'r1 r2 r3'],
      ['town', '2x1', 'r1 r2 r3'],
      ['warehouse', '2x1', 'r1 r2 r3'],
      ['farm', '1x1', 'r1 r3'],
      ['big_farm', '1x2', 'r1 r2 r3'],
      ['quarry', '1x1', 'r2'],
      ['pump', '1x1', 'r1 r2 r3'],
      ['grinder', '1x1', 'r1 r2 r3'],
      ['refinery', '1x1', 'r1 r2 r3'],
      ['power_plant', '3x2', 'r1 r2 r3'],
      ['substation', '2x2', 'r0 r1 r2 r3'],
      ['hydro_plant', '1x1', 'r0 r1 r2 r3'],
      ['colliery', '2x2', 'r0 r1 r2 r3'],
      ['ironworks', '2x2', 'r0 r1 r2 r3'],
      ['oil_derrick', '2x1', 'r1 r2 r3'],
      ['townhouse', '1x1', 'r1 r2 r3'],
      ['fuel_pump', '1x1', 'r1 r2 r3'],
    ]);
    // the coaling stage has its oblong guides from #524 and gets nothing new here
    expect(PLAN_JOBS.map((j) => j.id)).not.toContain('fuel_stop');
    for (const r of OBLONG.views) {
      expect(readFileSync(`${ROOT}/guides/fuel_stop-oblong-r${r}.png`).length).toBeGreaterThan(0);
      expect(
        JSON.parse(readFileSync(`${ROOT}/guides/fuel_stop-oblong-r${r}-plan.json`, 'utf8')).view,
      ).toBe(`r${r}`);
    }
    // every job names a canvas, and an oblong plan is only for one tile
    for (const j of PLAN_JOBS) {
      expect(PLAN_CANVAS[j.canvas], j.id).toBeDefined();
      if (j.shares) expect(j.span, j.id).toEqual([1, 1]);
      expect(j.height, j.id).toBeGreaterThanOrEqual(20);
      expect(j.height, j.id).toBeLessThanOrEqual(100);
    }
  });

  it('keeps the files the repository holds: a picture and a plan file per job and view, as the tool draws them', () => {
    const drawn = planFiles();
    expect(all).toHaveLength(52);
    expect(drawn).toHaveLength(2 * all.length);
    expect(drawn.map(([file]) => file)).toEqual(
      all.flatMap(([j, r]) => [planGuideFile(j.id, r), planFileOf(j.id, r)]),
    );
    for (const [file, bytes] of drawn)
      expect(Buffer.compare(bytes, readFileSync(file)), file).toBe(0);
    expect(planGuideFile('town', 2)).toBe(`${ROOT}/guides/review2/town-r2.png`);
    expect(planFileOf('town', 2)).toBe(`${ROOT}/guides/review2/town-r2-plan.json`);
    const root = mkdtempSync(join(tmpdir(), 'plans-'));
    try {
      const written = writeGuides(root, [], false, true);
      expect(written).toHaveLength(16 + drawn.length);
      expect(written.slice(16).map((f) => f.slice(root.length + 1).replaceAll('\\', '/'))).toEqual(
        drawn.map(([f]) => f),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('leaves the files the repository already held as they are: the footprints, the families, the earlier guides', () => {
    const root = mkdtempSync(join(tmpdir(), 'plans-'));
    try {
      const written = writeGuides(root, [], false, false);
      expect(written).toHaveLength(16);
      for (const file of written) {
        const name = file.slice(root.length + 1);
        expect(Buffer.compare(readFileSync(file), readFileSync(name)), name).toBe(0);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('turns the footprint a quarter at a time: the sides swap, the plinth is the footprint', () => {
    for (const [j, r] of all) {
      const p = plan(j.id, r);
      const fp = PLAN_CANVAS[j.canvas];
      const [w0, h0] = j.span;
      const tiles = r % 2 === 0 ? [w0, h0] : [h0, w0];
      expect(p.footprint.tilesAtR0, `${j.id} r${r}`).toEqual(j.span);
      expect(p.footprint.tiles, `${j.id} r${r}`).toEqual(tiles);
      // its corners are the projected diamond, the near corner the lowest
      const [w, h] = tiles;
      const c = p.footprint.corners;
      const corner = (x, y) => project(fp, x, y).map(round4);
      expect(c.w).toEqual(corner(-w / 2, h / 2));
      expect(c.s).toEqual(corner(w / 2, h / 2));
      expect(c.e).toEqual(corner(w / 2, -h / 2));
      expect(c.n).toEqual(corner(-w / 2, -h / 2));
      expect(c.s[1]).toBeGreaterThan(Math.max(c.w[1], c.e[1]));
      // 2:1 lines
      expect((c.s[1] - c.w[1]) / (c.s[0] - c.w[0])).toBeCloseTo(0.5, 9);
      expect(p.footprint.lowerLeftFootPx).toBeCloseTo(w * 32 * fp.scale, 6);
      expect(p.footprint.lowerRightFootPx).toBeCloseTo(h * 32 * fp.scale, 6);
      expect(p.footprint.longSide).toBe(w === h ? 'equal' : w > h ? 'lower left' : 'lower right');
      // the canvas, the anchor and the ground line say what the drawing has
      expect(p.canvas).toEqual(fp.canvas);
      expect(p.anchor).toEqual(fp.centre);
      expect(p.scale).toBe(fp.scale);
      expect(p.groundLine.anchorRow).toBe(fp.centre[1]);
      expect(p.groundLine.nearCornerRow).toBe(c.s[1]);
      expect(p.groundLine.farCornerRow).toBe(c.n[1]);
      expect(p.groundLine.lowerLeft).toEqual([c.w, c.s]);
      expect(p.groundLine.lowerRight).toEqual([c.s, c.e]);
      // the picture: the plinth's corners w and e are its extremes, with the 3 px outline
      const img = png(j.id, r);
      expect([img.width, img.height]).toEqual(fp.canvas);
      const e = extent(img);
      expect(e.x1 - e.x0 + 1).toBe(p.paintedWidth.footprintWidthPx[0]);
      expect(Math.abs(e.x1 - e.x0 + 1 - (c.e[0] - c.w[0] + 3))).toBeLessThanOrEqual(1);
      // the whole drawing stands inside the canvas with room to spare
      for (const k of ['w', 's', 'e', 'n']) {
        expect(c[k][0]).toBeGreaterThan(40);
        expect(c[k][0]).toBeLessThan(fp.canvas[0] - 40);
        expect(c[k][1]).toBeGreaterThan(40);
        expect(c[k][1]).toBeLessThan(fp.canvas[1] - 16);
      }
      expect(p.base.topFarCornerRow).toBeGreaterThan(16);
      // the returned picture is the image tool's
      expect(p.returnSize).toEqual(fp.returned);
      expect(p.toReturn).toBeCloseTo(fp.returned[0] / fp.canvas[0], 4);
    }
  });

  it("fills 90 per cent of the footprint's long side and stays inside it", () => {
    for (const [j, r] of all) {
      const p = plan(j.id, r);
      const fp = PLAN_CANVAS[j.canvas];
      const [w, h] = p.footprint.tiles;
      const [bx, by] = p.plan.baseTiles;
      expect(p.plan.fillOfLongSide, `${j.id} r${r}`).toBeCloseTo(0.9, 4);
      expect(p.paintedWidth.shareOfFootprintLongSide, `${j.id} r${r}`).toBeCloseTo(0.9, 4);
      // inside: no side of the base is longer than the footprint's, the feet lie within its edges
      expect(bx).toBeLessThanOrEqual(w);
      expect(by).toBeLessThanOrEqual(h);
      const f = p.footprint.corners,
        b = p.base.corners;
      expect(b.w[0]).toBeGreaterThan(f.w[0]);
      expect(b.e[0]).toBeLessThan(f.e[0]);
      expect(b.s[1]).toBeLessThan(f.s[1]);
      expect(b.n[1]).toBeGreaterThan(f.n[1]);
      // a plain box fills 90 per cent of both sides; an oblong plan of one tile has the short one in its share
      if (!j.shares) expect(p.plan.fillOfShortSide).toBeCloseTo(0.9, 4);
      else expect(p.plan.fillOfShortSide).toBeLessThan(0.9);
      // the base's own feet run parallel to the plinth's edges: both 2:1
      expect((b.s[1] - b.w[1]) / (b.s[0] - b.w[0])).toBeCloseTo(0.5, 5);
      expect((b.s[1] - b.e[1]) / (b.s[0] - b.e[0])).toBeCloseTo(-0.5, 5);
      expect(p.base.lowerLeftFootPx).toBeCloseTo(planBase(j, r).x * 32 * fp.scale, 3);
      expect(p.base.lowerRightFootPx).toBeCloseTo(planBase(j, r).y * 32 * fp.scale, 3);
    }
  });

  it("states the width the painted base must hold, measured on the drawn picture, and keeps it inside the footprint's", () => {
    const faces = [GREY.top, GREY.left, GREY.right];
    for (const [j, r] of all) {
      const p = plan(j.id, r);
      const img = png(j.id, r);
      const { mustHoldPx, minPx, maxPx, tolerance, footprintWidthPx } = p.paintedWidth;
      // the base's faces as the picture has them: the outline adds about 3 px
      const f = extent(img, isGrey(faces));
      expect(Math.abs(mustHoldPx[0] - (p.base.spanPx + 3)), `${j.id} r${r}`).toBeLessThanOrEqual(1);
      expect(mustHoldPx[0] - (f.x1 - f.x0 + 1)).toBeLessThanOrEqual(10);
      expect(mustHoldPx[0]).toBeGreaterThanOrEqual(f.x1 - f.x0 + 1);
      const alone = extent(drawPlan(j, r, { plinth: false }));
      expect(mustHoldPx[0]).toBe(alone.x1 - alone.x0 + 1);
      // in the picture the image tool returns
      for (const q of [mustHoldPx, minPx, maxPx, footprintWidthPx])
        expect(q[1] / q[0]).toBeCloseTo(p.toReturn, 3);
      expect(tolerance).toBe(0.05);
      expect(minPx[0] / mustHoldPx[0]).toBeCloseTo(0.95, 3);
      expect(maxPx[0]).toBeGreaterThan(mustHoldPx[0]);
      expect(maxPx[0]).toBeLessThanOrEqual(mustHoldPx[0] * 1.05 + 1e-3);
      // never wider than the footprint
      expect(maxPx[0], `${j.id} r${r}`).toBeLessThanOrEqual(footprintWidthPx[0]);
      expect(mustHoldPx[0]).toBeLessThan(footprintWidthPx[0]);
      expect(p.paintedWidth.insideFootprint).toBe(true);
      // the words a prompt quotes carry the same numbers
      for (const n of [footprintWidthPx[0], footprintWidthPx[1], mustHoldPx[0], mustHoldPx[1]])
        expect(p.paintedWidth.words, `${j.id} r${r} ${n}`).toContain(`${Math.round(n)} px`);
      for (const n of maxPx)
        expect(p.paintedWidth.words, `${j.id} r${r} ${n}`).toContain(`${Math.round(n)} px`);
      expect(p.paintedWidth.words).toContain('per cent of its long side');
    }
  });

  it('shows the front door on the front wall where the camera sees it, and nowhere else', () => {
    for (const [j, r] of all) {
      const p = plan(j.id, r);
      const img = png(j.id, r);
      const dark = extent(img, isGrey([GREY.opening]));
      expect(p.front.wall).toBe(['S', 'W', 'N', 'E'][r]);
      expect(p.front.visible).toBe(r === 0 || r === 3);
      expect(p.door.visible).toBe(r === 0 || r === 3);
      if (r === 0 || r === 3) {
        const pts = p.door.outline;
        const mid = [pts.reduce((s, q) => s + q[0], 0) / 4, pts.reduce((s, q) => s + q[1], 0) / 4];
        expect(rgbAt(img, mid)).toEqual(GREY.opening);
        // on the wall the front is on, in the middle of it
        expect(p.front.visibleOn).toBe(r === 0 ? 'lower left' : 'lower right');
        const b = p.base.corners;
        const wall = r === 0 ? [b.w, b.s] : [b.s, b.e];
        expect(mid[0]).toBeCloseTo((wall[0][0] + wall[1][0]) / 2, 0);
        expect(dark.x1).toBeGreaterThan(dark.x0);
      } else {
        // no opening grey at all in a view whose front is away from the camera
        expect(dark.x1).toBe(-1);
        expect(p.door.note).toContain('away from the camera');
      }
    }
  });

  it("keeps the finished r0's plan where the turned views must match it, turned with the building", () => {
    // the base's two sides at r0, lower left : lower right, as measured of the finished r0
    const shares = {
      farm: [0.557, 0.443],
      quarry: [0.547, 0.453],
      fuel_pump: [0.562, 0.438],
      hydro_plant: [0.59, 0.41],
    };
    for (const [id, [ll, lr]] of Object.entries(shares)) {
      expect(job(id).shares).toEqual([ll, lr]);
      for (const r of job(id).views) {
        const p = plan(id, r);
        const even = r % 2 === 0;
        // a quarter turn puts the short side where the long one was
        expect(p.plan.lowerLeftShare, `${id} r${r}`).toBeCloseTo(even ? ll : lr, 3);
        expect(p.plan.lowerRightShare, `${id} r${r}`).toBeCloseTo(even ? lr : ll, 3);
        expect(p.plan.longSide).toBe(even ? 'lower left' : 'lower right');
        // the same total width whatever the turn
        expect(p.base.spanPx).toBeCloseTo((0.9 + (0.9 * lr) / ll) * 32 * PLAN_CANVAS.t1.scale, 2);
        expect(p.plan.basis.length).toBeGreaterThan(20);
      }
    }
    // the fuel pump's r1 of today (187 : 447, lower left over lower right) was too thin
    expect(plan('fuel_pump', 1).plan.lowerLeftOverLowerRight).toBeGreaterThan(0.7);
    expect(plan('fuel_pump', 1).plan.lowerLeftOverLowerRight).toBeLessThan(0.8);
    expect(plan('fuel_pump', 2).plan.lowerLeftOverLowerRight).toBeCloseTo(1.2831, 3);
    // the hydro plant is not the water pump's square
    expect(job('pump').shares).toBeUndefined();
    expect(plan('pump', 1).plan.longSide).toBe('equal');
    expect(plan('hydro_plant', 0).plan.longSide).toBe('lower left');
  });

  it('puts the larger buildings on their tiles: the long side along the front at r0, across it at r1', () => {
    for (const id of ['big_station', 'town', 'warehouse', 'oil_derrick']) {
      expect(plan(id, 1).footprint.tiles).toEqual([1, 2]);
      expect(plan(id, 1).footprint.longSide).toBe('lower right');
      expect(plan(id, 2).footprint.tiles).toEqual([2, 1]);
      expect(plan(id, 3).footprint.longSide).toBe('lower right');
      expect(plan(id, 2).plan.baseTiles).toEqual([1.8, 0.9]);
    }
    // the farm is one tile wide and two long at r0
    expect(plan('big_farm', 1).footprint.tiles).toEqual([2, 1]);
    expect(plan('big_farm', 2).footprint.tiles).toEqual([1, 2]);
    expect(plan('big_farm', 2).footprint.longSide).toBe('lower right');
    // the 2 x 2: 4 tiles of diamond on a 1536 x 1024 canvas at 6 px per game px
    for (const id of ['substation', 'colliery', 'ironworks'])
      for (const r of [0, 1, 2, 3]) {
        expect(plan(id, r).footprint.tiles).toEqual([2, 2]);
        expect(plan(id, r).plan.baseTiles).toEqual([1.8, 1.8]);
        expect(plan(id, r).footprint.spanPx).toBe(768);
      }
    // the 3 x 2 has a canvas of its own: 5 tiles of diamond at 5 px per game px
    expect(plan('power_plant', 1).footprint.tiles).toEqual([2, 3]);
    expect(plan('power_plant', 1).footprint.longSide).toBe('lower right');
    expect(plan('power_plant', 2).footprint.tiles).toEqual([3, 2]);
    expect(plan('power_plant', 2).plan.baseTiles).toEqual([2.7, 1.8]);
    expect(plan('power_plant', 2).canvas).toEqual([1536, 1024]);
    expect(plan('power_plant', 2).footprint.spanPx).toBe(800);
    // one tile, on the square canvas, and the house's tall one
    expect(plan('pump', 1).footprint.spanPx).toBe(512);
    expect(plan('townhouse', 1).canvas).toEqual([1024, 1536]);
  });

  it('shades the base as the other guides do and stands it on the plinth that is the footprint', () => {
    for (const [j, r] of all) {
      const fp = PLAN_CANVAS[j.canvas];
      const img = png(j.id, r);
      const base = planBase(j, r);
      const z1 = 4 + j.height;
      expect(rgbAt(img, project(fp, 0, 0, z1))).toEqual(GREY.top);
      expect(rgbAt(img, project(fp, base.x * 0.25, base.y / 2, z1 - 3))).toEqual(GREY.left);
      expect(rgbAt(img, project(fp, base.x / 2, base.y * 0.25, z1 - 3))).toEqual(GREY.right);
      // the plinth: its near corner is the lowest thing drawn, nothing is below it
      const [w, h] = plan(j.id, r).footprint.tiles;
      const s = project(fp, w / 2, h / 2);
      expect(opaque(img, Math.round(s[0]), Math.round(s[1]) - 2)).toBe(true);
      expect(opaque(img, Math.round(s[0]), Math.round(s[1]) + 6)).toBe(false);
    }
  });

  it('draws the base alone for a stand-in picture, at the same place', () => {
    const j = job('town');
    const fp = PLAN_CANVAS[j.canvas];
    const withPlinth = drawPlan(j, 1);
    const alone = drawPlan(j, 1, { plinth: false });
    const top = project(fp, 0, 0, 4 + j.height);
    for (const img of [withPlinth, alone]) expect(at(img, top)).toEqual(solid(GREY.top));
    // the plinth is the only thing that differs below the base's foot
    const s = project(fp, 0.5, 1);
    expect(at(withPlinth, [s[0], s[1] - 2])[3]).toBe(255);
    expect(at(alone, [s[0], s[1] + 2])[3]).toBe(0);
    expect(at(alone, [s[0], s[1] - 8])[3]).toBe(0);
  });
});
