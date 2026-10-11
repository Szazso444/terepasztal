// "Stand the model on its own wheel contacts": from the part's vertices and the game's axle positions
// (src/data/gear.json), find where each wheel touches down, and solve pitch, roll, yaw, height and
// sideways offset that put those contacts on the two rails. Verified by perturbing the mesh by a
// known pose and recovering it.
import fs from 'node:fs';
import { readGlb } from './glb-info.mjs';
const CT = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array };
export function positions(path) {
  const { json, bin } = readGlb(path);
  const out = [];
  for (const node of json.nodes) if (node.mesh != null) for (const p of json.meshes[node.mesh].primitives) {
    const a = json.accessors[p.attributes.POSITION], bv = json.bufferViews[a.bufferView];
    const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    out.push(new Float32Array(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + a.count * 12)));
  }
  const P = new Float32Array(out.reduce((s, o) => s + o.length, 0)); let o = 0; for (const x of out) { P.set(x, o); o += x.length; }
  return P;
}
import { axlesOf, solve, perturb } from './contact.js';
export { axlesOf, solve, perturb };
if (process.argv[1].endsWith('wheel-contact.mjs')) {
  const gear = JSON.parse(fs.readFileSync('../../src/data/gear.json', 'utf8')).black_five;
  const parts = JSON.parse(fs.readFileSync('export/black_five.parts.json', 'utf8')).parts;
  const fmt = (r) => `contacts ${r.contacts}  height ${(r.height_m * 1000).toFixed(0)} mm  pitch ${r.pitch_deg.toFixed(2)} deg  roll ${r.roll_deg.toFixed(2)} deg  yaw ${r.yaw_deg.toFixed(2)} deg  lateral ${(r.lateral_m * 1000).toFixed(0)} mm  gauge ${r.gauge_m.toFixed(2)} m  worst residual ${r.residual_mm.toFixed(0)} mm  (${r.ms.toFixed(0)} ms)`;
  for (const name of ['engine', 'tender']) for (const suffix of ['', '_r025']) {
    const info = parts.find((p) => p.part === name), gp = gear.parts.find((p) => p.part === name);
    const P = positions(`export/black_five_${name}${suffix}.glb`);
    const axles = axlesOf(gp, info.lo[0], info.hi[0]);
    console.log(`\n${name}${suffix}: ${P.length / 3} verts, axles at x = ${axles.map((a) => a.toFixed(2)).join(', ')} m; lowest vertex z ${(Math.min(...Array.from({ length: P.length / 3 }, (_, i) => P[i * 3 + 2])) * 1000).toFixed(0)} mm`);
    const r0 = solve(P, axles, { yMin: 0.45, yMax: 0.95 });
    console.log('  as exported     :', fmt(r0));
    if (!suffix && name === 'engine') console.log('   contacts z (mm):', r0.detail.map((c) => `${c.ax.toFixed(1)}${c.side > 0 ? 'L' : 'R'}:${(c.z * 1000).toFixed(0)}`).join(' '));
    const known = { pitch: 2.6, roll: -1.2, yaw: 1.5, lift: 0.21, lateral: 0.3 };
    const r1 = solve(perturb(P, known), axles, { yMin: 0.15, yMax: 1.25, win: 0.3 });
    console.log('  perturbed by', JSON.stringify(known));
    console.log('  recovered       :', fmt(r1));
    console.log(`  error vs exported+perturbation: pitch ${(r1.pitch_deg - r0.pitch_deg - known.pitch).toFixed(2)} deg, roll ${(r1.roll_deg - r0.roll_deg - known.roll).toFixed(2)} deg, yaw ${(r1.yaw_deg - r0.yaw_deg - known.yaw).toFixed(2)} deg, lateral ${((r1.lateral_m - r0.lateral_m - known.lateral) * 1000).toFixed(0)} mm, height ${((r1.height_m - r0.height_m - known.lift) * 1000).toFixed(0)} mm`);
  }
}
