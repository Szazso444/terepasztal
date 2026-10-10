import { describe, it, expect } from 'vitest';
import { FOOTPRINTS, ROTATIONS, project, diamond } from './building-kit.mjs';
import { GREY, drawGuide, guideFile, blockOf, openingsOf, portalWall } from './building-guides.mjs';

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
});
