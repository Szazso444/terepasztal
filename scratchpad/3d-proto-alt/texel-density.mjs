import { readGlb } from './glb-info.mjs';
const CT = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array };
for (const path of process.argv.slice(2)) {
  const { json, bin } = readGlb(path);
  const acc = (i, n) => { const a = json.accessors[i], bv = json.bufferViews[a.bufferView]; const T = CT[a.componentType]; const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0); return new T(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + a.count * n * T.BYTES_PER_ELEMENT)); };
  let A3 = 0, AUV = 0; const ratios = [];
  for (const node of json.nodes) if (node.mesh != null) for (const p of json.meshes[node.mesh].primitives) {
    if (p.attributes.TEXCOORD_0 == null || !json.materials[p.material].pbrMetallicRoughness.baseColorTexture) continue;
    const pos = acc(p.attributes.POSITION, 3), uv = acc(p.attributes.TEXCOORD_0, 2), idx = acc(p.indices, 1);
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
      const e1 = [0, 1, 2].map((k) => pos[b * 3 + k] - pos[a * 3 + k]), e2 = [0, 1, 2].map((k) => pos[c * 3 + k] - pos[a * 3 + k]);
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const a3 = Math.hypot(...cr) / 2;
      const u1 = [uv[b * 2] - uv[a * 2], uv[b * 2 + 1] - uv[a * 2 + 1]], u2 = [uv[c * 2] - uv[a * 2], uv[c * 2 + 1] - uv[a * 2 + 1]];
      const auv = Math.abs(u1[0] * u2[1] - u1[1] * u2[0]) / 2;
      A3 += a3; AUV += auv; if (a3 > 1e-8) ratios.push([Math.sqrt(auv / a3), a3]);
    }
  }
  ratios.sort((x, y) => x[0] - y[0]); let accA = 0; let med = 0; for (const [r, a] of ratios) { accA += a; if (accA >= A3 / 2) { med = r; break; } }
  const K = 64 / (6.235064799811727 * Math.SQRT2);
  console.log(path.split('/').pop(), 'surface', A3.toFixed(1), 'm2; uv coverage', (AUV * 100).toFixed(0) + '%');
  for (const s of [512, 1024, 2048]) console.log('  tex', s, 'median', (med * s).toFixed(0), 'texels/m =', (med * s / K).toFixed(1), 'texels per logical px (screen px/m at zoom 1 =', K.toFixed(2) + ')');
}
