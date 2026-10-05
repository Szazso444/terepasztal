import { describe, it, expect, vi } from 'vitest';
import {
  FACINGS,
  facingAngle,
  facingOf,
  headingShear,
  poseVehicle,
  vehicleSpec,
  type SegmentSpec,
} from './body';
import { referencePath } from './compat';
import type { Gear } from './gear';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

/** Screen picture of one tile along a tile-space heading (2:1 projection, in half-tile widths). */
function picture(angle: number) {
  return { x: Math.cos(angle) - Math.sin(angle), y: (Math.cos(angle) + Math.sin(angle)) / 2 };
}

describe('headingShear', () => {
  const step = (Math.PI * 2) / FACINGS;

  it('leaves a sprite alone on its own facing', () => {
    for (let f = 0; f < FACINGS; f++) {
      const m = headingShear(facingAngle(f), f);
      expect(m.a).toBeCloseTo(1, 9);
      expect(m.b).toBeCloseTo(0, 9);
      expect(m.c).toBeCloseTo(0, 9);
      expect(m.d).toBeCloseTo(1, 9);
    }
  });

  it('takes the drawn heading to the true one and keeps uprights upright along a tile axis', () => {
    // straight track runs along the tile axes: the facings there and their neighbours shear fully
    for (const base of [0, Math.PI / 2, Math.PI, -Math.PI / 2])
      for (const d of [-0.49, -0.2, 0.2, 0.49]) {
        const angle = base + d * step;
        const f = facingOf(angle);
        const m = headingShear(angle, f);
        const from = picture(facingAngle(f));
        const to = picture(angle);
        expect(m.a * from.x + m.c * from.y).toBeCloseTo(to.x, 9);
        expect(m.b * from.x + m.d * from.y).toBeCloseTo(to.y, 9);
        // the screen's vertical is untouched
        expect(m.c).toBeCloseTo(0, 9);
        expect(m.d).toBeCloseTo(1, 9);
      }
  });

  it('turns instead where the heading runs up the screen, and never by much', () => {
    for (let f = 0; f < FACINGS; f++)
      for (const d of [-0.5, 0.5]) {
        const m = headingShear(facingAngle(f) + d * step, f);
        // close to the identity everywhere: no facing is squeezed or flipped
        expect(Math.abs(m.a - 1)).toBeLessThan(0.3);
        expect(Math.abs(m.d - 1)).toBeLessThan(0.01);
        expect(Math.abs(m.b)).toBeLessThan(0.2);
        expect(Math.abs(m.c)).toBeLessThan(0.08);
      }
  });
});

describe('a body pinned on its trucks', () => {
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
  const pinned = vehicleSpec({
    gear,
    lengthTiles: 3,
    spriteGear: true,
    truckSprites: { body: [0, 1] },
  });
  const loose = vehicleSpec({ gear, lengthTiles: 3 });
  const path = referencePath('regular');

  it('is marked so only when the model brings its own trucks', () => {
    expect(pinned.segments.every((s: SegmentSpec) => s.pinned)).toBe(true);
    expect(loose.segments.some((s: SegmentSpec) => s.pinned)).toBe(false);
  });

  it('keeps each truck exactly under its socket through the curve', () => {
    let worstPinned = 0;
    let worstLoose = 0;
    for (let front = 3.5; front <= path.length - 0.5; front += 0.1) {
      for (const b of poseVehicle(path, front, pinned).segments[0].bogies)
        worstPinned = Math.max(worstPinned, b.foreAft, b.lateral);
      for (const b of poseVehicle(path, front, loose).segments[0].bogies)
        worstLoose = Math.max(worstLoose, b.foreAft, b.lateral);
    }
    expect(worstPinned).toBeLessThan(0.005);
    // the same body centred on the track instead slides its trucks visibly
    expect(worstLoose).toBeGreaterThan(0.08);
  });

  it('stands where it stood before on straight track', () => {
    const a = poseVehicle(path, 3.2, pinned).segments[0];
    const b = poseVehicle(path, 3.2, loose).segments[0];
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.y).toBeCloseTo(b.y, 9);
    expect(a.angle).toBeCloseTo(b.angle, 9);
  });
});

describe('a hinged half', () => {
  const gear: Gear = {
    parts: [
      { part: 'rear', from: 0, to: 0.47, trucks: [[0.06, 0.12, 0.18]], hinge: 'front' },
      {
        part: 'body',
        from: 0.47,
        to: 1,
        trucks: [
          [0.51, 0.57, 0.63],
          [0.81, 0.87, 0.93],
        ],
      },
    ],
  };
  const spec = vehicleSpec({
    gear,
    lengthTiles: 4.3,
    spriteGear: true,
    truckSprites: { rear: [0], body: [0, 1] },
  });
  const path = referencePath('regular');

  it('stays joined to the part that carries it through the curve', () => {
    let worst = 0;
    for (let front = 4.8; front <= path.length - 0.5; front += 0.1) {
      const [body, rear] = poseVehicle(path, front, spec).segments;
      // the front half's rear end and the rear half's front end
      const bx = body.x - (Math.cos(body.angle) * body.L) / 2;
      const by = body.y - (Math.sin(body.angle) * body.L) / 2;
      const rx = rear.x + (Math.cos(rear.angle) * rear.L) / 2;
      const ry = rear.y + (Math.sin(rear.angle) * rear.L) / 2;
      worst = Math.max(worst, Math.hypot(bx - rx, by - ry));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('runs tail first joined as well', () => {
    let worst = 0;
    for (let front = 4.8; front <= path.length - 0.5; front += 0.1) {
      const [body, rear] = poseVehicle(path, front, spec, true).segments;
      const ends = (s: { x: number; y: number; angle: number; L: number }) =>
        [1, -1].map((k) => ({
          x: s.x + (k * Math.cos(s.angle) * s.L) / 2,
          y: s.y + (k * Math.sin(s.angle) * s.L) / 2,
        }));
      let gap = Infinity;
      for (const a of ends(body))
        for (const b of ends(rear)) gap = Math.min(gap, Math.hypot(a.x - b.x, a.y - b.y));
      worst = Math.max(worst, gap);
    }
    expect(worst).toBeLessThan(1e-6);
  });
});

describe('a pinned steam engine', () => {
  // drivers fixed in the frame, a leading bogie well ahead of them and a trailing axle behind
  const gear: Gear = {
    parts: [
      {
        part: 'engine',
        from: 0,
        to: 1,
        rigid: [0.35, 0.47, 0.59],
        trucks: [[0.18], [0.8, 0.92]],
      },
    ],
  };
  const spec = vehicleSpec({
    gear,
    lengthTiles: 2.2,
    spriteGear: true,
    truckSprites: { engine: [0, 1] },
  });
  const path = referencePath('regular');

  it('keeps every wheel group near the body: none runs far beside its place', () => {
    let truck = 0;
    let wheels = 0;
    for (let front = 2.6; front <= path.length - 0.5; front += 0.1) {
      const seg = poseVehicle(path, front, spec).segments[0];
      for (const b of seg.bogies) truck = Math.max(truck, b.lateral, b.foreAft);
      wheels = Math.max(wheels, seg.wheelGap);
    }
    // standing on its drivers alone, the leading bogie ran 0.2 tile beside its socket here
    expect(truck).toBeLessThan(0.12);
    // the drivers share the misfit: a tenth of a tile off the rail at most
    expect(wheels).toBeLessThan(0.1);
  });
});
