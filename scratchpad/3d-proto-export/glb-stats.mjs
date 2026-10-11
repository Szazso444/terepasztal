// node glb-stats.mjs file.glb [...]: what the reader sees, and the topology of every part
import fs from 'node:fs';
import { parseGlb } from './glb.js';
for (const f of process.argv.slice(2)) {
  const b = fs.readFileSync(f);
  const glb = parseGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  console.log(f, b.length, 'bytes; image', glb.image?.mimeType, glb.image?.bytes.length, 'bytes; parts', glb.parts.length);
  for (const p of glb.parts) {
    if (p.mirror) { console.log('  ', p.name, '(mirror instance of mesh', p.mesh + ')'); continue; }
    const key = new Map(); const remap = new Int32Array(p.vertexCount); let u = 0;
    for (let i = 0; i < p.vertexCount; i++) {
      const k = p.positions[4 * i] + ',' + p.positions[4 * i + 1] + ',' + p.positions[4 * i + 2];
      let id = key.get(k); if (id === undefined) { id = u++; key.set(k, id); } remap[i] = id;
    }
    const edges = new Map(); const par = Int32Array.from({ length: u }, (_, i) => i);
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    let degenerate = 0;
    for (let t = 0; t < p.indexCount; t += 3) {
      const v = [remap[p.indices[t]], remap[p.indices[t + 1]], remap[p.indices[t + 2]]];
      if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) { degenerate++; continue; }
      for (let e = 0; e < 3; e++) { const a = v[e], c = v[(e + 1) % 3]; const k = a < c ? a * 1e7 + c : c * 1e7 + a; edges.set(k, (edges.get(k) || 0) + 1); }
      par[find(v[1])] = find(v[0]); par[find(v[2])] = find(v[0]);
    }
    const comp = new Map();
    for (let t = 0; t < p.indexCount; t += 3) { const r = find(remap[p.indices[t]]); comp.set(r, (comp.get(r) || 0) + 1); }
    let b1 = 0, b2 = 0, b3 = 0; for (const v of edges.values()) { if (v === 1) b1++; else if (v === 2) b2++; else b3++; }
    const sizes = [...comp.values()].sort((x, y) => y - x);
    console.log('  ', p.name, 'verts', p.vertexCount, 'positions', u, 'tris', p.indexCount / 3, 'degenerate', degenerate,
      'edges open/2/3+', b1, b2, b3, 'components', sizes.length, 'largest', sizes.slice(0, 8).join(' '), 'tris in components < 8:', sizes.filter((s) => s < 8).reduce((a, c) => a + c, 0));
  }
}
