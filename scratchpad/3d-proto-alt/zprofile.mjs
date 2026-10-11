import { readGlb } from './glb-info.mjs';
const path = process.argv[2];
const { json, bin } = readGlb(path);
for (const node of json.nodes) if (node.mesh != null) for (const p of json.meshes[node.mesh].primitives) {
  const a = json.accessors[p.attributes.POSITION], bv = json.bufferViews[a.bufferView];
  const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const P = new Float32Array(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + a.count * 12));
  let lo = [9, 9, 9], hi = [-9, -9, -9];
  for (let i = 0; i < P.length; i++) { lo[i % 3] = Math.min(lo[i % 3], P[i]); hi[i % 3] = Math.max(hi[i % 3], P[i]); }
  console.log(node.name, json.materials[p.material].name, 'verts', a.count, 'x', lo[0].toFixed(2), hi[0].toFixed(2), 'y', lo[1].toFixed(2), hi[1].toFixed(2), 'z', lo[2].toFixed(3), hi[2].toFixed(3));
  // lowest z per 0.25 m of x, for |y| in three bands
  const bands = [[0, 0.45], [0.45, 0.9], [0.9, 1.6]];
  for (const [b0, b1] of bands) {
    const bins = new Map();
    for (let i = 0; i < P.length; i += 3) { const y = Math.abs(P[i + 1]); if (y < b0 || y >= b1) continue; const k = Math.floor(P[i] / 0.25); bins.set(k, Math.min(bins.get(k) ?? 9, P[i + 2])); }
    const ks = [...bins.keys()].sort((x, y) => x - y);
    console.log(`  |y| ${b0}-${b1}:`, ks.map((k) => `${(k * 0.25).toFixed(2)}:${(bins.get(k) * 1000).toFixed(0)}`).join(' '));
  }
}
