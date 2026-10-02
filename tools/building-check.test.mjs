import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { FOOTPRINTS, ROTATIONS } from './building-kit.mjs';
import { blockOf, boxFaces, fillPoly, drawGuide } from './building-guides.mjs';
import { checkPicture, pictureOf, summarise } from './building-check.mjs';

/**
 * A stand-in picture: the guide's block as a building, standing on the ground of its footprint.
 * `dx`, `dy` shift it on the canvas, `k` shrinks it about the footprint centre.
 */
function picture(fpId, rot, o = {}) {
  const fp = FOOTPRINTS[fpId];
  const [w, h] = o.canvas ?? fp.canvas;
  const png = new PNG({ width: w, height: h });
  if (o.background) png.data.fill(200);
  const k = o.k ?? 1;
  const b = blockOf(fpId, rot);
  const box = {
    x0: b.x0 * k,
    y0: b.y0 * k,
    x1: b.x1 * k,
    y1: b.y1 * k,
    z0: 0,
    z1: (o.height ?? b.z1) * k,
  };
  const faces = boxFaces(fp, box);
  const shade = { top: [220, 210, 180], left: [160, 120, 90], right: [110, 80, 60] };
  for (const [name, pts] of Object.entries(faces))
    fillPoly(
      png,
      pts.map(([x, y]) => [x + (o.dx ?? 0), y + (o.dy ?? 0)]),
      shade[name],
      o.alpha ?? 255,
    );
  return png;
}

describe('building check', () => {
  it('passes a building that stands on its footprint, for every footprint and rotation', () => {
    for (const fp of Object.values(FOOTPRINTS))
      for (const r of ROTATIONS)
        expect(
          checkPicture(picture(fp.id, r.index), fp.id, r.index),
          `${fp.id} r${r.index}`,
        ).toEqual({
          ok: true,
          problems: [],
        });
  });

  it('names the canvas it expected', () => {
    const wide = picture('t1', 0, { canvas: [1536, 1024] });
    expect(checkPicture(wide, 't1', 0)).toEqual({
      ok: false,
      problems: ['canvas 1536x1024, expected 1024x1024'],
    });
  });

  it('wants a transparent background', () => {
    const r = checkPicture(picture('t1', 0, { background: true }), 't1', 0);
    expect(r.ok).toBe(false);
    expect(r.problems).toContain('background is not transparent');
  });

  it('says which way the base is off', () => {
    // the distance is measured on the picture, so allow it a pixel or two
    const off = (r, way) => {
      const m = r.problems.map((p) =>
        new RegExp(`^base is ([0-9]+) px ${way} the footprint$`).exec(p),
      );
      const hit = m.find(Boolean);
      return hit ? Number(hit[1]) : null;
    };
    const right = checkPicture(picture('t1', 0, { dx: 80 }), 't1', 0);
    expect(Math.abs(off(right, 'right of') - 80)).toBeLessThanOrEqual(2);
    const left = checkPicture(picture('t2x2', 1, { dx: -64 }), 't2x2', 1);
    expect(Math.abs(off(left, 'left of') - 64)).toBeLessThanOrEqual(2);
    const up = checkPicture(picture('t1', 0, { dy: -80 }), 't1', 0);
    expect(off(up, 'above')).toBeGreaterThan(80);
    const down = checkPicture(picture('t1', 0, { dy: 40 }), 't1', 0);
    expect(off(down, 'below')).toBeGreaterThan(12);
    expect(down.problems).toContain('reaches outside the footprint at the ground');
  });

  it('wants the building to fill its footprint and fit its canvas', () => {
    expect(checkPicture(picture('t1', 0, { k: 0.3 }), 't1', 0).problems).toContain('too small');
    const tall = checkPicture(picture('t1', 0, { height: 110 }), 't1', 0);
    expect(tall.problems.join()).toMatch(/too tall for the canvas|touches the top edge/);
    const edge = checkPicture(picture('t1', 0, { dx: 300 }), 't1', 0);
    expect(edge.problems).toContain('touches the right edge');
    expect(edge.problems).toContain('reaches outside the footprint at the right');
  });

  it('wants solid surfaces and something to look at', () => {
    expect(checkPicture(picture('t1', 0, { alpha: 150 }), 't1', 0).problems).toContain(
      'mostly translucent',
    );
    const empty = new PNG({ width: 1024, height: 1024 });
    expect(checkPicture(empty, 't1', 0)).toEqual({ ok: false, problems: ['empty picture'] });
  });

  it('fails a guide that came back unpainted', () => {
    const r = checkPicture(drawGuide('t1', 0), 't1', 0);
    expect(r.ok).toBe(false);
    expect(r.problems).toContain('still grey: not painted');
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
  });

  it('adds new results to an earlier report', () => {
    const before = summarise({ 'depot-a0-r0': { ok: true, problems: [] } });
    expect(before).toMatchObject({ checked: 1, failed: 0 });
    const after = summarise({ 'depot-a0-r1': { ok: false, problems: ['too small'] } }, before);
    expect(after).toMatchObject({ checked: 2, failed: 1 });
    expect(Object.keys(after.pictures)).toEqual(['depot-a0-r0', 'depot-a0-r1']);
  });
});
