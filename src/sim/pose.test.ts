import { describe, it, expect, vi } from 'vitest';
import {
  FACINGS,
  facingAngle,
  poseVehicle,
  swingMesh,
  SWING_FAN,
  SWING_EDGE_ON,
  SWING_FANS,
  SWING_VERTS,
  UP_TILE_PX,
  type PartBox,
  vehicleSpec,
  type SegmentSpec,
} from './body';
import { referencePath } from './compat';
import type { Gear } from './gear';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

/** Screen offset (pixels) of a body point: u tiles along a heading, w across, h up. */
function onScreen(angle: number, u: number, w: number, h: number) {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return {
    x: 32 * (u * (c - s) - w * (s + c)),
    y: 16 * (u * (c + s) + w * (c - s)) - h * UP_TILE_PX,
  };
}

describe('swingMesh', () => {
  const step = (Math.PI * 2) / FACINGS;
  // a three-tile engine's body, and a picture with room round it
  const box: PartBox = { u0: -1.4, u1: 1.5, w: 0.24, h: 0.62 };
  const rect = [-140, -90, 140, 70] as const;
  const mesh = (
    drawn: number,
    angle: number,
    b = box,
    r: readonly [number, number, number, number] = rect,
  ) => {
    const src = new Float32Array(SWING_VERTS * 2),
      dst = new Float32Array(SWING_VERTS * 2);
    swingMesh(b, drawn, angle, r, src, dst);
    return { src, dst };
  };
  /** the fans' triangles: indices of their three points */
  const triangles = () => {
    const out: number[][] = [];
    for (let fan = 0; fan < SWING_FANS; fan++)
      for (let i = 1; i + 1 < SWING_FAN; i++)
        out.push([fan * SWING_FAN, fan * SWING_FAN + i, fan * SWING_FAN + i + 1]);
    return out;
  };
  const area = (m: { src: Float32Array }) =>
    triangles().reduce((sum, [i, j, k]) => {
      const ax = m.src[2 * j] - m.src[2 * i],
        ay = m.src[2 * j + 1] - m.src[2 * i + 1],
        bx = m.src[2 * k] - m.src[2 * i],
        by = m.src[2 * k + 1] - m.src[2 * i + 1];
      return sum + Math.abs(ax * by - ay * bx) / 2;
    }, 0);
  /** where the mesh draws a point of the picture (the triangle it lies in, carried along) */
  const drawnAt = (m: { src: Float32Array; dst: Float32Array }, x: number, y: number) => {
    let best: { x: number; y: number } | null = null,
      worst = -Infinity;
    for (const [i, j, k] of triangles()) {
      const x0 = m.src[2 * i],
        y0 = m.src[2 * i + 1],
        ax = m.src[2 * j] - x0,
        ay = m.src[2 * j + 1] - y0,
        bx = m.src[2 * k] - x0,
        by = m.src[2 * k + 1] - y0,
        det = ax * by - ay * bx;
      if (Math.abs(det) < 1e-6) continue;
      const p = ((x - x0) * by - (y - y0) * bx) / det,
        q = (ax * (y - y0) - ay * (x - x0)) / det,
        inside = Math.min(p, q, 1 - p - q);
      if (inside > worst) {
        worst = inside;
        best = {
          x: m.dst[2 * i] + p * (m.dst[2 * j] - m.dst[2 * i]) + q * (m.dst[2 * k] - m.dst[2 * i]),
          y:
            m.dst[2 * i + 1] +
            p * (m.dst[2 * j + 1] - m.dst[2 * i + 1]) +
            q * (m.dst[2 * k + 1] - m.dst[2 * i + 1]),
        };
      }
    }
    expect(worst).toBeGreaterThan(-1e-3); // the point lies in a triangle
    return best!;
  };
  /**
   * Points of the box's seen faces at a heading: top, near side, near end. A face seen within
   * thirty degrees of edge on is left out: its picture is a sliver in which points far apart on the
   * face fall together, and no map takes one pixel to two places.
   */
  const seen = (angle: number) => {
    const c = Math.cos(angle),
      s = Math.sin(angle),
      un = c + s >= 0 ? box.u1 : box.u0,
      wn = c - s >= 0 ? box.w : -box.w,
      pts: [number, number, number][] = [];
    const sine = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.abs(a.x * b.y - a.y * b.x) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
    const o = onScreen(angle, 0, 0, 0),
      eu = onScreen(angle, 1, 0, 0),
      ew = onScreen(angle, 0, 1, 0),
      ed = { x: 0, y: 1 },
      du = { x: eu.x - o.x, y: eu.y - o.y },
      dw = { x: ew.x - o.x, y: ew.y - o.y },
      well = SWING_EDGE_ON[1] + 1e-6;
    for (const p of [0.07, 0.31, 0.5, 0.83, 0.96])
      for (const q of [0.05, 0.4, 0.77, 0.95]) {
        const u = box.u0 + p * (box.u1 - box.u0);
        if (sine(du, dw) >= well) pts.push([u, -box.w + q * 2 * box.w, box.h]); // top
        if (sine(du, ed) >= well) pts.push([u, wn, q * box.h]); // near side
        if (sine(dw, ed) >= well) pts.push([un, -box.w + p * 2 * box.w, q * box.h]); // near end
      }
    return pts;
  };

  it('leaves a picture alone on its own facing, and covers all of it', () => {
    for (let f = 0; f < FACINGS; f++) {
      const m = mesh(facingAngle(f), facingAngle(f));
      for (let i = 0; i < SWING_VERTS * 2; i++) expect(m.dst[i]).toBeCloseTo(m.src[i], 3);
      expect(area(m)).toBeCloseTo((rect[2] - rect[0]) * (rect[3] - rect[1]), 0);
    }
  });

  it('covers the whole picture at every heading, also where a face is seen edge on', () => {
    for (let f = 0; f < FACINGS; f++)
      for (const d of [-0.5, -0.13, 0.27, 0.5]) {
        const m = mesh(facingAngle(f), facingAngle(f) + d * step);
        expect(area(m)).toBeCloseTo((rect[2] - rect[0]) * (rect[3] - rect[1]), 0);
      }
  });

  it('draws every point of the three seen faces where the box has it at the true heading', () => {
    let worst = 0;
    for (let f = 0; f < FACINGS; f++)
      for (const d of [-0.49, -0.2, 0.2, 0.49]) {
        const drawn = facingAngle(f),
          angle = drawn + d * step,
          m = mesh(drawn, angle);
        for (const [u, w, h] of seen(drawn)) {
          const from = onScreen(drawn, u, w, h),
            want = onScreen(angle, u, w, h),
            got = drawnAt(m, from.x, from.y);
          worst = Math.max(worst, Math.hypot(got.x - want.x, got.y - want.y));
        }
      }
    // a hundredth of a pixel: the body neither leans nor breathes between two facings
    expect(worst).toBeLessThan(0.01);
  });

  it('keeps uprights upright on the side it shows', () => {
    for (const f of [0, 1, 11, 12, 13, 24, 36, 47])
      for (const d of [-0.49, 0.49]) {
        const drawn = facingAngle(f),
          m = mesh(drawn, drawn + d * step),
          wn = Math.cos(drawn) - Math.sin(drawn) >= 0 ? box.w : -box.w;
        for (const u of [-1.2, 0, 1.3]) {
          const foot = onScreen(drawn, u, wn, 0.02),
            head = onScreen(drawn, u, wn, box.h - 0.02),
            a = drawnAt(m, foot.x, foot.y),
            b = drawnAt(m, head.x, head.y);
          expect(a.x).toBeCloseTo(b.x, 2);
        }
      }
  });

  it('does not tear along the box edges, and carries what sticks out little further than the box', () => {
    for (let f = 0; f < FACINGS; f++) {
      const drawn = facingAngle(f),
        angle = drawn + 0.49 * step;
      // a picture as the atlas holds it: the box with a margin of a dozen pixels (chimney, buffers,
      // wheels), and the furthest any corner of the box moves
      let far = 0,
        x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (const u of [box.u0, box.u1])
        for (const w of [-box.w, box.w])
          for (const h of [0, box.h]) {
            const a = onScreen(drawn, u, w, h),
              b = onScreen(angle, u, w, h);
            far = Math.max(far, Math.hypot(b.x - a.x, b.y - a.y));
            x0 = Math.min(x0, a.x);
            y0 = Math.min(y0, a.y);
            x1 = Math.max(x1, a.x);
            y1 = Math.max(y1, a.y);
          }
      const r = [x0 - 12, y0 - 12, x1 + 12, y1 + 12] as const,
        m = mesh(drawn, angle, box, r);
      for (let x = r[0] + 1; x < r[2] - 1; x += 7.3)
        for (let y = r[1] + 1; y < r[3] - 1; y += 5.1) {
          const a = drawnAt(m, x, y),
            b = drawnAt(m, x + 0.05, y + 0.05);
          // neighbours a twentieth of a pixel apart stay neighbours, anywhere in the picture
          expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(0.2);
          // and the margin moves no more than twice as far as the box itself
          expect(Math.hypot(a.x - x, a.y - y)).toBeLessThan(2 * far + 0.5);
        }
    }
  });

  it('swings a truck and a short wagon as well as a long body', () => {
    for (const b of [
      { u0: -0.16, u1: 0.16, w: 0.17, h: 0.12 },
      { u0: -0.4, u1: 0.4, w: 0.15, h: 0.42 },
    ] as PartBox[])
      for (let f = 0; f < FACINGS; f++) {
        const r = [-40, -30, 40, 26] as const,
          m = mesh(facingAngle(f), facingAngle(f) + 0.4 * step, b, r);
        expect(area(m)).toBeCloseTo(80 * 56, 0);
        for (let i = 0; i < SWING_VERTS * 2; i++) expect(Number.isFinite(m.dst[i])).toBe(true);
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

describe('a boiler on two engine units', () => {
  // the Big Boy as the owner wants it: both sets of coupled wheels are trucks under the boiler, the
  // front one with the pilot truck in its frame, the rear one with the trailing axle
  const units = [
    [0.34, 0.42, 0.46, 0.5],
    [0.65, 0.71, 0.75, 0.79, 0.89, 0.94],
  ];
  const gear: Gear = {
    parts: [
      {
        part: 'tender',
        from: 0,
        to: 0.33,
        rigid: [0.04, 0.07, 0.11, 0.15],
        trucks: [[0.21, 0.25]],
      },
      { part: 'engine', from: 0.33, to: 1, trucks: units },
    ],
  };
  const L = 4.2;
  const spec = vehicleSpec({
    gear,
    lengthTiles: L,
    spriteGear: true,
    truckSprites: { engine: [0, 1], tender: [0] },
  });
  const path = referencePath('regular');
  const engine = (front: number) =>
    poseVehicle(path, front, spec).segments.find((g) => g.part === 'engine')!;

  it('keeps both units exactly under their sockets through the curve', () => {
    let worst = 0;
    for (let front = L + 0.2; front <= path.length - 0.3; front += 0.1)
      for (const b of engine(front).bogies) worst = Math.max(worst, b.foreAft, b.lateral);
    expect(worst).toBeLessThan(0.005);
  });

  it('stands a long unit as a chord: no axle of it far from the rail', () => {
    let worst = 0;
    for (let front = L + 0.2; front <= path.length - 0.3; front += 0.1)
      for (const b of engine(front).bogies) {
        const axles = units[b.truck!],
          mid = axles.reduce((p, q) => p + q, 0) / axles.length;
        for (const f of axles) {
          // the axle's place: so far ahead of the unit's middle along the unit
          const d = (f - mid) * L,
            x = b.x + Math.cos(b.angle) * d,
            y = b.y + Math.sin(b.angle) * d,
            n = path.nearest({ x, y }, front - 2, 3.5).p;
          worst = Math.max(worst, Math.hypot(n.x - x, n.y - y));
        }
      }
    // a tangent at the front unit's middle would leave its pilot wheels 0.14 tiles wide
    expect(worst).toBeLessThan(0.08);
    expect(worst).toBeGreaterThan(0.02);
  });

  it('is in line with its units on straight track', () => {
    const e = engine(3.9);
    expect(e.angle).toBeCloseTo(0, 9);
    for (const b of e.bogies) {
      expect(Math.max(b.foreAft, b.lateral)).toBeLessThan(1e-9);
      expect(b.angle).toBeCloseTo(0, 9);
    }
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
