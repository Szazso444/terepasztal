import { describe, it, expect, vi } from 'vitest';
import { gearSegments, type Gear } from './gear';
import { vehicleSpec, poseVehicle, Polyline } from './body';
import { content } from '../data/content';
import { CLASS_LINE, classOf, referencePath, vehicleAccess, verdictOf } from './compat';

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
  // hinged on 2026-10-24, rigid again on 2026-10-25: the user wants to see it whole on larger curves
  it('is one rigid body on two four-axle trucks', () => {
    const spec = vehicleSpec(def);
    expect(spec.segments.map((s) => s.part)).toEqual(['body']);
    const [body] = spec.segments;
    expect(body.hinge).toBeUndefined();
    expect(body.L).toBeCloseTo(def.lengthTiles!, 6);
    expect(body.kinds).toEqual(['bogie4', 'bogie4']);
    expect(body.hidden).toEqual([false, false]);
  });
  it('keeps both trucks in their sockets through the tightest curve', () => {
    const spec = vehicleSpec(def);
    const path = referencePath('branch');
    let worst = 0;
    for (let front = spec.L; front <= path.length; front += 0.05)
      for (const b of poseVehicle(path, front, spec).segments[0].bogies)
        worst = Math.max(worst, b.foreAft, b.lateral);
    expect(worst).toBeLessThan(0.005);
  });
  it('may run on the line of its class', () => {
    expect(vehicleAccess(def, CLASS_LINE[classOf(def)])).toBeNull();
  });
});

describe('the Big Boy', () => {
  const def = content.locomotives.find((d) => d.id === 'big_boy')!;
  const spec = vehicleSpec(def);
  const engine = spec.segments.find((s) => s.part === 'engine')!;
  it('rides on two engine units, each set of drivers a bogie of its own', () => {
    expect(spec.segments.map((s) => s.part)).toEqual(['engine', 'tender']);
    // no drivers fixed in the boiler: leading bogie, front unit, rear unit, trailing truck
    expect(engine.rigid).toBeUndefined();
    expect(engine.kinds).toEqual(['bogie', 'bogie4', 'bogie4', 'bogie']);
    expect(engine.hidden).toEqual([false, false, false, false]);
  });
  it('turns without a jolt on the tightest curve, its units under the boiler', () => {
    const path = referencePath('branch');
    let prev: number[] | null = null,
      step = 0,
      off = 0;
    for (let front = spec.L + 0.2; front <= path.length - 0.3; front += 0.01) {
      const v = poseVehicle(path, front, spec);
      const a = v.segments.flatMap((s) => [s.angle, ...s.bogies.map((b) => b.angle)]);
      if (prev) a.forEach((x, i) => (step = Math.max(step, Math.abs(x - prev![i]))));
      prev = a;
      const e = v.segments.find((s) => s.part === 'engine')!;
      for (const b of e.bogies) off = Math.max(off, b.foreAft, b.lateral);
    }
    // a hundredth of a tile on a 1.5 tile radius turns the track 0.38 degrees
    expect((step * 180) / Math.PI).toBeLessThan(0.6);
    // a 4.2-tile boiler straddling the whole quarter curve: its wheel groups share the misfit (all
    // four in the plain best fit stood up to 0.42 tiles beside their sockets)
    expect(off).toBeLessThan(0.3);
  });
});

describe('every engine', () => {
  it('may run on the line of its class, and fits its curves', () => {
    // a length or a bogie moved can bar an engine from every curve: each one is measured on its line
    const barred = content.locomotives
      .map((def) => {
        const line = CLASS_LINE[classOf(def)];
        return { id: def.id, why: vehicleAccess(def, line) ?? verdictOf(def, line).reason };
      })
      .filter((x) => x.why !== null);
    expect(barred).toEqual([]);
  });
});
