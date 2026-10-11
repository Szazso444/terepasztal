// Throwaway probe (scratch/ladder-explore): the Koutetsujou with its four bogies moved out towards its ends.
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
  const spec: VehicleSpec = { L, size: 'small', plan: 'rigid', segments: gearSegments(gear, L), drawBogies: true, maxLateralPlay: 0.35 };
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
// four three-axle bogies, the outer ones centred k from each end, the inner two evenly between
const spread = (k: number): Gear => {
  const c = [k, k + (1 - 2 * k) / 3, 1 - k - (1 - 2 * k) / 3, 1 - k];
  return { parts: [{ part: 'body', from: 0, to: 1, trucks: c.map((x) => [x - 0.031, x, x + 0.031]) }] };
};
test('koutetsujou bogies', { timeout: 600000 }, () => {
  FRAME_FLOAT.on = false;
  const drawn = (gearJson as Record<string, Gear>).koutetsujou;
  const out: Record<string, unknown> = {};
  const variants: [string, Gear][] = [['drawn', drawn], ...[0.06, 0.09, 0.12, 0.125, 0.146, 0.18, 0.22, 0.25, 0.28, 0.32].map((k) => [`k${k}`, spread(k)] as [string, Gear])];
  for (const [name, g] of variants) {
    const r: Record<string, unknown> = {};
    for (const L of [3, 4]) r[L] = { r15: measure(g, L, 1.5), r25: measure(g, L, 2.5), r35: measure(g, L, 3.5) };
    out[name] = r;
  }
  writeFileSync(process.env.PROBE_OUT ?? 'kou.json', JSON.stringify(out, null, 1));
});
