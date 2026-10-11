// Throwaway probe (scratch/ladder-explore): body overhang of every regular loco at 2-4 tiles on curves of
// radius 1.5 (2x2), 2.5 (3x3) and 3.5 (4x4), and of the Koutetsujou and DDA40X as two hinged halves.
import { test } from 'vitest';
import { writeFileSync } from 'fs';
import gearJson from '../data/gear.json';
import { gearSegments, type Gear } from '../sim/gear';
import { Polyline, poseVehicle, FRAME_FLOAT, type VehicleSpec } from '../sim/body';

function path(R: number, step = 0.04) {
  const pts: { x: number; y: number }[] = [];
  const lead = 7;
  for (let s = 0; s <= lead + 1e-9; s += step) pts.push({ x: s, y: 0 });
  const n = Math.max(4, Math.ceil(((Math.PI / 2) * R) / step));
  for (let i = 1; i <= n; i++) {
    const t = ((Math.PI / 2) * i) / n;
    pts.push({ x: lead + R * Math.sin(t), y: R - R * Math.cos(t) });
  }
  for (let s = step; s <= lead + 1e-9; s += step) pts.push({ x: lead + R, y: R + s });
  return new Polyline(pts);
}
function measure(gear: Gear, L: number, R: number) {
  const spec: VehicleSpec = {
    L, size: 'small', plan: 'rigid', segments: gearSegments(gear, L), drawBogies: true, maxLateralPlay: 0.35,
  };
  const pl = path(R);
  let gap = 0, truck = 0;
  for (let front = L; front <= pl.length; front += 0.04)
    for (const rev of [false, true]) {
      const v = poseVehicle(pl, front, spec, rev);
      for (const s of v.segments) {
        gap = Math.max(gap, s.residualGap);
        for (const b of s.bogies) if (!b.hidden) truck = Math.max(truck, b.lateral);
      }
    }
  return { gap: +gap.toFixed(3), truck: +truck.toFixed(3) };
}
// two halves on two trucks each (at a fifth of the half from each end), coupled where they meet
const halves = (k = 0.2): Gear => ({
  parts: [
    { part: 'body', from: 0, to: 0.5, trucks: [[0.5 * k], [0.5 * (1 - k)]] },
    { part: 'engine', from: 0.5, to: 1, trucks: [[0.5 + 0.5 * k], [0.5 + 0.5 * (1 - k)]] },
  ],
});
test('big curves', { timeout: 600000 }, () => {
  FRAME_FLOAT.on = false;
  const out: Record<string, unknown> = {};
  const all = gearJson as Record<string, Gear & { dbSize: number; gauge: string }>;
  const lengths = [1.5, 2, 2.5, 3, 3.5, 4];
  for (const [id, g] of Object.entries(all)) {
    if (g.gauge !== 'regular') continue;
    const r: Record<string, unknown> = {};
    for (const L of lengths) r[L] = { r15: measure(g, L, 1.5), r25: measure(g, L, 2.5), r35: measure(g, L, 3.5) };
    out[id] = { dbSize: g.dbSize, by: r };
  }
  for (const L of lengths)
    (out.halves ??= { dbSize: 0, by: {} } as never as Record<string, unknown>) &&
      ((out.halves as { by: Record<number, unknown> }).by[L] = {
        r15: measure(halves(), L, 1.5), r25: measure(halves(), L, 2.5), r35: measure(halves(), L, 3.5),
      });
  writeFileSync(process.env.PROBE_OUT ?? 'bigcurves.json', JSON.stringify(out));
});
