import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { FOOTPRINTS, ROTATIONS } from './building-kit.mjs';
import { blockOf, boxFaces, fillPoly, drawGuide } from './building-guides.mjs';
import { checkPicture, pictureOf, summarise } from './building-check.mjs';

/**
 * A stand-in picture: the guide's block as a painted building. By default it stands on the ground
 * of its footprint; `block` takes another box, `map` moves every canvas point, `canvas` is the
 * size of the picture.
 */
function picture(fpId, rot, o = {}) {
  const fp = FOOTPRINTS[fpId];
  const [w, h] = o.canvas ?? fp.canvas;
  const png = new PNG({ width: w, height: h });
  if (o.background) png.data.fill(200);
  const map = o.map ?? ((p) => p);
  const faces = boxFaces(fp, { ...blockOf(fpId, rot), z0: 0, ...o.block });
  const shade = { top: [220, 210, 180], left: [160, 120, 90], right: [110, 80, 60] };
  o.under?.(png, fp, map);
  for (const [name, pts] of Object.entries(faces))
    fillPoly(png, pts.map(map), shade[name], o.alpha ?? 255);
  return png;
}
/** Scale a picture's contents about a point and move them. */
const moved =
  (k, [cx, cy], [dx, dy] = [0, 0]) =>
  ([x, y]) => [cx + (x - cx) * k + dx, cy + (y - cy) * k + dy];

describe('building check', () => {
  it('passes a building that stands on its footprint, for every footprint and rotation', () => {
    for (const fp of Object.values(FOOTPRINTS))
      for (const r of ROTATIONS)
        expect(
          checkPicture(picture(fp.id, r.index), fp.id, r.index),
          `${fp.id} r${r.index}`,
        ).toMatchObject({ ok: true, problems: [], notes: [] });
  });

  it("passes the guide's own block, painted where the guide draws it", () => {
    // on the plinth, as every guide shows it: a picture that keeps its guide's place must pass
    for (const fp of Object.values(FOOTPRINTS))
      for (const r of ROTATIONS) {
        const kept = picture(fp.id, r.index, { block: blockOf(fp.id, r.index) });
        expect(checkPicture(kept, fp.id, r.index), `${fp.id} r${r.index}`).toMatchObject({
          ok: true,
          problems: [],
        });
      }
  });

  it('passes a building drawn larger, off centre and on a canvas of its own', () => {
    // the pilot: generators fill the canvas and choose its size themselves
    const big = picture('t2x2', 0, { map: moved(1.5, FOOTPRINTS.t2x2.centre, [20, -20]) });
    const r = checkPicture(big, 't2x2', 0);
    expect(r).toMatchObject({ ok: true, problems: [] });
    expect(Math.abs(r.fit.scale - 1 / 1.5)).toBeLessThan(0.01);
    const square = picture('t1x2', 0, {
      canvas: [1254, 1254],
      map: moved(1.3, FOOTPRINTS.t1x2.centre, [110, 60]),
    });
    expect(checkPicture(square, 't1x2', 0)).toMatchObject({ ok: true, problems: [] });
  });

  it('wants a picture large enough to work from', () => {
    const small = picture('t1', 0, {
      canvas: [600, 900],
      map: moved(0.55, [512, 832], [-212, -300]),
    });
    expect(checkPicture(small, 't1', 0)).toEqual({
      ok: false,
      problems: ['picture is 600x900; its short side must be at least 768 px'],
    });
  });

  it('wants a transparent background, and says only that', () => {
    expect(checkPicture(picture('t1', 0, { background: true }), 't1', 0)).toEqual({
      ok: false,
      problems: ['background is not transparent'],
    });
  });

  it('wants the building large enough in its picture', () => {
    const r = checkPicture(picture('t1', 0, { map: moved(0.3, [512, 832]) }), 't1', 0);
    expect(r.ok).toBe(false);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(
      /^too small in the picture: its foot is 13[0-9] px wide, at least 226 px are needed$/,
    );
  });

  it('wants the whole building inside the picture', () => {
    const r = checkPicture(picture('t1', 0, { map: moved(1, [512, 832], [290, 0]) }), 't1', 0);
    expect(r.problems).toContain('touches the right edge');
    const tall = picture('t1', 0, { block: { z1: 110 } });
    expect(checkPicture(tall, 't1', 0).problems).toContain('touches the top edge');
  });

  it('wants solid surfaces and something to look at', () => {
    expect(checkPicture(picture('t1', 0, { alpha: 150 }), 't1', 0).problems).toContain(
      'mostly translucent',
    );
    const empty = new PNG({ width: 1024, height: 1024 });
    expect(checkPicture(empty, 't1', 0)).toEqual({ ok: false, problems: ['empty picture'] });
  });

  it('fails a shadow or glow on the ground around the building', () => {
    // a soft shadow spilling out of the footprint to the lower right
    const under = (png, fp, map) =>
      fillPoly(
        png,
        [
          [512, 800],
          [900, 800],
          [900, 990],
          [512, 990],
        ].map(map),
        [20, 20, 20],
        100,
      );
    const r = checkPicture(picture('t1', 0, { under }), 't1', 0);
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/^a translucent shadow or glow surrounds the building/);
  });

  it('fails a guide that came back unpainted', () => {
    const r = checkPicture(drawGuide('t1', 0), 't1', 0);
    expect(r.ok).toBe(false);
    expect(r.problems).toContain('still grey: not painted');
  });

  it("fails a picture that is not in the game's view", () => {
    // seen straight from the front: the foot is one level line
    const front = new PNG({ width: 1024, height: 1024 });
    fillPoly(
      front,
      [
        [262, 400],
        [762, 400],
        [762, 880],
        [262, 880],
      ],
      [160, 120, 90],
    );
    expect(checkPicture(front, 't1', 0).problems).toEqual([
      "not the game's view: the building's foot is a level line, as if seen from the front",
    ]);
    // far too flat a camera: ground lines at 0.2 instead of 0.5
    const flat = picture('t1', 0, { map: ([x, y]) => [x, 832 + (y - 832) * 0.4] });
    expect(checkPicture(flat, 't1', 0).problems).toEqual([
      "not the game's view: the lower-left wall's ground line slopes 0.20, the game's 0.50",
      "not the game's view: the lower-right wall's ground line slopes -0.20, the game's -0.50",
    ]);
  });

  /** a picture of the block with every point moved: how a camera that is off draws it */
  const seen = (map, o = {}) => checkPicture(picture('t1', 0, { map, ...o }), 't1', 0, o.check);
  const lower = ([x, y]) => [x, 832 + (y - 832) * 0.8];

  it("fails a picture whose camera is not the game's, and says what to ask for next", () => {
    // seen from too low, both wall feet too flat: 0.5 x 0.8 = 0.4 is 23.6 degrees
    const low = seen(lower);
    expect(low.ok).toBe(false);
    expect(low.problems).toEqual([
      "camera off by 6.4°: it looks down from 23.6° where the game looks down from 30° (the wall feet slope 0.40 and -0.40, the game's 0.50 and -0.50)",
    ]);
    expect(low.camera.by).toBe(6.4);
    expect(low.camera.say).toMatch(/^The camera is too low: /);
    // seen from too high: 0.5 x 1.2 = 0.6 is 36.9 degrees
    const high = seen(([x, y]) => [x, 832 + (y - 832) * 1.2], { block: { z1: 30 } });
    expect(high.problems).toEqual([
      "camera off by 6.9°: it looks down from 36.9° where the game looks down from 30° (the wall feet slope 0.60 and -0.60, the game's 0.50 and -0.50)",
    ]);
    expect(high.camera.say).toMatch(/^The camera is too high: /);
    // turned towards its lower-right wall: that wall's foot flatter, the other steeper
    const right = seen(([x, y]) => [x, y + (x - 512) * 0.08]);
    expect(right.problems).toHaveLength(1);
    expect(right.problems[0]).toMatch(
      /^camera off by 4\.\d°: the building is turned 4\.\d° towards its lower-right wall \(the wall feet slope 0\.58 and -0\.42, the game's 0\.50 and -0\.50\)$/,
    );
    expect(right.camera.say).toMatch(
      /^The building is turned: its lower-right wall faces the viewer/,
    );
    const left = seen(([x, y]) => [x, y - (x - 512) * 0.08]);
    expect(left.problems[0]).toMatch(/the building is turned 4\.\d° towards its lower-left wall/);
    expect(left.camera.say).toMatch(
      /^The building is turned: its lower-left wall faces the viewer/,
    );
    // both at once: said in one line, and both asked for
    const both = seen(([x, y]) => [x, 832 + (y - 832) * 0.8 + (x - 512) * 0.08]);
    expect(both.problems).toHaveLength(1);
    expect(both.problems[0]).toMatch(
      /^camera off by 6\.\d°: it looks down from 23\.\d° where the game looks down from 30° and the building is turned 5\.\d° towards its lower-right wall \(/,
    );
    expect(both.camera.say).toMatch(/^The camera is too low: .* The building is turned: /);
  });

  it("passes a camera within three degrees of the game's", () => {
    // 0.5 x 0.93 = 0.465 is 27.7 degrees; and one wall's foot a little flat
    for (const map of [
      ([x, y]) => [x, 832 + (y - 832) * 0.93],
      ([x, y]) => [x, y - Math.max(0, 512 - x) * 0.05],
    ]) {
      const r = seen(map);
      expect(r).toMatchObject({ ok: true, problems: [], notes: [] });
      expect(r.camera).toBeUndefined();
    }
  });

  it('keeps a picture whose camera is off when told to, and says so', () => {
    // the closest of a picture's attempts: recorded, corrected by the tools, and marked
    const kept = seen(lower, { check: { camera: false } });
    expect(kept).toMatchObject({ ok: true, problems: [] });
    expect(kept.notes).toEqual([
      "camera off by 6.4°: it looks down from 23.6° where the game looks down from 30° (the wall feet slope 0.40 and -0.40, the game's 0.50 and -0.50); kept, and corrected by the tools",
    ]);
    expect(kept.camera.by).toBe(6.4);
    // further off than the tools correct: said too
    const far = seen(([x, y]) => [x, 832 + (y - 832) * 0.6], { check: { camera: false } });
    expect(far.notes[0]).toMatch(
      /^camera off by 12\.\d°: .*; kept, and corrected part of the way by the tools$/,
    );
    // a view that is no isometric picture at all is never kept
    const flat = seen(([x, y]) => [x, 832 + (y - 832) * 0.4], { check: { camera: false } });
    expect(flat.ok).toBe(false);
    expect(flat.problems[0]).toMatch(/^not the game's view/);
  });

  /** a straight wall on the lower left and a round bay on the lower right: one straight foot */
  const bay = (slope) => {
    const png = new PNG({ width: 1024, height: 1024 });
    const rise = 250 * slope;
    fillPoly(
      png,
      [
        [262, 800 - rise],
        [512, 800],
        [512, 400],
        [262, 400 - rise],
      ],
      [160, 120, 90],
    );
    const arc = Array.from({ length: 64 }, (_, i) => [
      512 + 250 * Math.cos((i / 64) * 2 * Math.PI),
      600 + 200 * Math.sin((i / 64) * 2 * Math.PI),
    ]);
    fillPoly(
      png,
      arc.filter(([x]) => x >= 511.5),
      [110, 80, 60],
    );
    return png;
  };

  it('judges the camera by one wall foot where only one is straight', () => {
    const fine = checkPicture(bay(0.5), 't1', 0);
    expect(fine).toMatchObject({ ok: true, problems: [] });
    expect(fine.fit.sure).toEqual([true, false]);
    expect(fine.notes).toEqual(['placed by its outline: no straight wall base was found']);
    // no camera near the game's draws a wall foot at 0.65
    const steep = checkPicture(bay(0.65), 't1', 0);
    expect(steep.ok).toBe(false);
    expect(steep.problems).toEqual([
      "camera off: the lower-left wall's foot slopes 0.65 where the game's slopes 0.50",
    ]);
    expect(steep.camera).toEqual({
      by: null,
      say: "The lower-left wall's foot runs too steep: it must run parallel to the plinth's lower-left edge, two pixels across for one down.",
    });
  });

  it('notes what a person should look at without failing the picture', () => {
    // a round tower: placed by its outline
    const tower = new PNG({ width: 1024, height: 1024 });
    const ring = (cy) =>
      Array.from({ length: 48 }, (_, i) => [
        512 + 200 * Math.cos((i / 48) * 2 * Math.PI),
        cy + 100 * Math.sin((i / 48) * 2 * Math.PI),
      ]);
    fillPoly(tower, ring(760), [200, 180, 150]);
    fillPoly(
      tower,
      [
        [312, 760],
        [712, 760],
        [712, 300],
        [312, 300],
      ],
      [200, 180, 150],
    );
    fillPoly(tower, ring(300), [230, 220, 200]);
    const t = checkPicture(tower, 't1', 0);
    expect(t.ok).toBe(true);
    expect(t.notes).toEqual(['placed by its outline: no straight wall base was found']);
    expect(t.fit.method).toBe('outline');
  });

  it('records how the picture is laid onto its footprint', () => {
    const r = checkPicture(picture('t2x2', 1), 't2x2', 1);
    expect(r.fit).toMatchObject({ method: 'base', vertical: 1, shear: 0 });
    expect(Object.keys(r.fit)).toEqual([
      'method',
      'sure',
      'measured',
      'slopes',
      'base',
      'scale',
      'vertical',
      'shear',
      'cx',
      'cy',
      'box',
      'camera',
      'area',
    ]);
  });

  it('knows a picture by its file name', () => {
    expect(pictureOf('assets/source/buildings-v2/power_plant/power_plant-a3-r2.png')).toEqual({
      id: 'power_plant-a3-r2',
      family: 'power_plant',
      age: 3,
      rot: 2,
    });
    expect(pictureOf('C:\\x\\depot_narrow-a0-r1.png').family).toBe('depot_narrow');
    expect(pictureOf('notes.png')).toBeNull();
    // a picture set aside after a rejection is not a picture of the list
    expect(pictureOf('depot/depot-a0-r1.rejected.png')).toBeNull();
  });

  it('adds new results to an earlier report', () => {
    const before = summarise({ 'depot-a0-r0': { ok: true, problems: [] } });
    expect(before).toMatchObject({ checked: 1, failed: 0 });
    const after = summarise({ 'depot-a0-r1': { ok: false, problems: ['too small'] } }, before);
    expect(after).toMatchObject({ checked: 2, failed: 1 });
    expect(Object.keys(after.pictures)).toEqual(['depot-a0-r0', 'depot-a0-r1']);
  });
});
