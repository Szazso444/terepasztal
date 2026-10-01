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
  let gap = 0, truck = 0, wheel = 0, delta = 0;
  for (let front = L; front <= pl.length; front += 0.04) {
    for (const rev of [false, true]) {
      const v = poseVehicle(pl, front, spec, rev);
      for (const s of v.segments) {
        gap = Math.max(gap, s.residualGap);
        wheel = Math.max(wheel, s.wheelGap);
        delta = Math.max(delta, Math.abs(s.delta));
        for (const b of s.bogies) if (!b.hidden) truck = Math.max(truck, b.lateral);
      }
    }
  }
  return { gap, truck, wheel, delta };
}
test('sweep', { timeout: 600000 }, () => {
  const out: Record<string, unknown> = {};
  const lengths = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6];
  for (const [id, g] of Object.entries(gearJson as Record<string, Gear & { dbSize: number; gauge: string }>)) {
    const r: Record<string, unknown> = {};
    for (const L of lengths) {
      FRAME_FLOAT.on = false;
      const stand = measure(g, L, 1.5);
      const narrow = measure(g, L, 0.5);
      FRAME_FLOAT.on = true;
      const float = measure(g, L, 1.5);
      FRAME_FLOAT.on = false;
      r[L] = { stand, float, narrow };
    }
    out[id] = { dbSize: g.dbSize, gauge: g.gauge, by: r };
  }
  writeFileSync('C:/Users/Zso/AppData/Local/Temp/claude/G--DEV-Terepasztal/1f6f1184-a7d7-4846-a5bb-edfe004ef3d4/scratchpad/sweep.json', JSON.stringify(out));
});
