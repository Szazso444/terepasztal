import { describe, it, expect, vi } from 'vitest';
import { gearSegments, type Gear } from './gear';
import { vehicleSpec, poseVehicle, Polyline } from './body';
import { content } from '../data/content';
import { gaugeOf, vehicleAccess } from './compat';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

const straight = new Polyline([
  { x: 0, y: 0 },
  { x: 40, y: 0 },
]);

describe('running gear from the table', () => {
  it('names the truck under each pivot, front to rear', () => {
    // rear truck listed first in the table, as measured on the picture (0 = rear end)
    const gear: Gear = {
      parts: [
        {
          part: 'body',
          from: 0,
          to: 1,
          trucks: [
            [0.1, 0.2],
            [0.8, 0.9],
          ],
        },
      ],
    };
    const [seg] = gearSegments(gear, 2);
    expect(seg.at).toEqual([expect.closeTo(0.3, 9), expect.closeTo(1.7, 9)]);
    // pivots run from the part's front: the front truck is the table's second
    expect(seg.truck).toEqual([1, 0]);
  });

  it('marks a single fixed axle as no truck', () => {
    const gear: Gear = {
      parts: [{ part: 'engine', from: 0, to: 1, rigid: [0.3], trucks: [[0.8, 0.9]] }],
    };
    const [seg] = gearSegments(gear, 2);
    expect(seg.truck).toEqual([0, -1]);
    expect(seg.nb).toBe(2);
  });

  it('carries a hinged half on the part next to it, without a truck there', () => {
    const gear: Gear = {
      parts: [
        { part: 'rear', from: 0, to: 0.5, trucks: [[0.1, 0.2]], hinge: 'front' },
        {
          part: 'body',
          from: 0.5,
          to: 1,
          trucks: [
            [0.55, 0.65],
            [0.85, 0.95],
          ],
        },
      ],
    };
    const segs = gearSegments(gear, 4);
    const rear = segs.find((s) => s.part === 'rear')!;
    // its front end (the hinge) and its own truck
    expect(rear.at).toEqual([0, expect.closeTo(1.4, 9)]);
    expect(rear.truck).toEqual([-1, 0]);
    expect(rear.hidden).toEqual([true, false]);
    const body = segs.find((s) => s.part === 'body')!;
    expect(body.hidden).toBeUndefined();
    expect(body.truck).toEqual([1, 0]);
  });

  it('keeps the halves end to end on straight track', () => {
    const gear: Gear = {
      parts: [
        { part: 'rear', from: 0, to: 0.5, trucks: [[0.1, 0.2]], hinge: 'front' },
        {
          part: 'body',
          from: 0.5,
          to: 1,
          trucks: [
            [0.55, 0.65],
            [0.85, 0.95],
          ],
        },
      ],
    };
    const spec = vehicleSpec({ gear, lengthTiles: 4 });
    const pose = poseVehicle(straight, 20, spec);
    const [front, rear] = pose.segments;
    expect(front.part).toBe('body');
    expect(front.x).toBeCloseTo(19, 6);
    expect(rear.x).toBeCloseTo(17, 6);
    expect(rear.angle).toBeCloseTo(0, 6);
  });
});

describe('trucks drawn as sprites of their own', () => {
  const gear: Gear = {
    parts: [
      { part: 'engine', from: 0.4, to: 1, rigid: [0.5, 0.6, 0.7], trucks: [[0.45], [0.9, 0.95]] },
      { part: 'tender', from: 0, to: 0.38, rigid: [0.1, 0.2, 0.3] },
    ],
  };
  it('draws no truck under a rendered model that brings none', () => {
    const spec = vehicleSpec({ gear, lengthTiles: 2, spriteGear: true });
    expect(spec.drawBogies).toBe(false);
  });
  it('draws exactly the trucks the model brings', () => {
    const spec = vehicleSpec({
      gear,
      lengthTiles: 2,
      spriteGear: true,
      truckSprites: { engine: [1] },
    });
    expect(spec.drawBogies).toBe(true);
    const engine = spec.segments.find((s) => s.part === 'engine')!;
    // front to rear: the leading bogie (the table's truck 1), then the trailing axle (truck 0)
    expect(engine.truck).toEqual([1, 0]);
    expect(engine.hidden).toEqual([false, true]);
    const pose = poseVehicle(straight, 20, spec);
    const shown = pose.segments.flatMap((s) => s.bogies.filter((b) => !b.hidden));
    expect(shown.map((b) => b.truck)).toEqual([1]);
  });
});

describe('the DDA40X', () => {
  const def = content.locomotives.find((d) => d.id === 'dda40x')!;
  it('is two hinged halves', () => {
    const spec = vehicleSpec(def);
    expect(spec.segments.map((s) => s.part)).toEqual(['body', 'rear']);
    expect(spec.segments.reduce((n, s) => n + s.L, 0)).toBeCloseTo(def.lengthTiles!, 6);
  });
  it('may run on regular track', () => {
    expect(vehicleAccess(def, 'regular')).toBeNull();
  });
});

describe('every engine', () => {
  it('may run on the track of its own gauge', () => {
    // a length or a bogie moved can bar an engine from every curve: the rail rules measure each one
    const barred = content.locomotives
      .map((def) => ({
        id: def.id,
        why: vehicleAccess(def, gaugeOf(def) === 'narrow' ? 'narrow' : 'regular'),
      }))
      .filter((x) => x.why !== null);
    expect(barred).toEqual([]);
  });
});
