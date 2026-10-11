import { test } from 'vitest';
import { writeFileSync } from 'fs';
import { gearSegments, type Gear } from '../sim/gear';
import { Polyline, poseVehicle, type VehicleSpec } from '../sim/body';
function path(R: number, step = 0.04) {
  const pts: { x: number; y: number }[] = [];
  for (let s = 0; s <= 7 + 1e-9; s += step) pts.push({ x: s, y: 0 });
  const n = Math.ceil(((Math.PI / 2) * R) / step);
  for (let i = 1; i <= n; i++) { const t = ((Math.PI / 2) * i) / n; pts.push({ x: 7 + R * Math.sin(t), y: R - R * Math.cos(t) }); }
  for (let s = step; s <= 7 + 1e-9; s += step) pts.push({ x: 7 + R, y: R + s });
  return new Polyline(pts);
}
test('kout', { timeout: 60000 }, () => {
  const tri = (c: number) => [c - 0.03, c, c + 0.03];
  const variants: Record<string, Gear> = {
    asDrawn: { parts: [{ part: 'body', from: 0, to: 1, trucks: [tri(0.054), tri(0.227), tri(0.379), tri(0.524)] }] },
    asDesigned: { parts: [{ part: 'body', from: 0, to: 1, trucks: [tri(0.08), tri(0.36), tri(0.64), tri(0.9)] }] },
    twoHalves: { parts: [
      { part: 'tender', from: 0, to: 0.49, trucks: [tri(0.08), tri(0.4)] },
      { part: 'engine', from: 0.51, to: 1, trucks: [tri(0.6), tri(0.9)] } ] },
  };
  const out: Record<string, unknown> = {};
  for (const [k, g] of Object.entries(variants)) {
    const L = 3;
    const spec: VehicleSpec = { L, size: 'small', plan: 'rigid', segments: gearSegments(g, L), drawBogies: true, maxLateralPlay: 0.35 };
    const pl = path(1.5);
    let gap = 0, truck = 0;
    for (let f = L; f <= pl.length; f += 0.04) for (const rev of [false, true]) {
      const v = poseVehicle(pl, f, spec, rev);
      for (const s of v.segments) { gap = Math.max(gap, s.residualGap); for (const b of s.bogies) truck = Math.max(truck, b.lateral); }
    }
    out[k] = { gap: +gap.toFixed(2), truck: +truck.toFixed(2) };
  }
  writeFileSync('C:/Users/Zso/AppData/Local/Temp/claude/G--DEV-Terepasztal/1f6f1184-a7d7-4846-a5bb-edfe004ef3d4/scratchpad/kout.json', JSON.stringify(out));
});
