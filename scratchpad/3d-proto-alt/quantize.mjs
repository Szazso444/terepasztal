// Real game payload for a part: quantized positions (u16 x3 in the part's bounds), octahedral normals (i8 x2),
// uvs (u16 x2), colour+texture weight (u8 x4), u16/u32 indices. Reports raw / gzip / brotli bytes.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { readGlb } from './glb-info.mjs';
const CT = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array };
export function quantize(path) {
  const { json, bin } = readGlb(path);
  const acc = (i, n) => { const a = json.accessors[i], bv = json.bufferViews[a.bufferView]; const T = CT[a.componentType]; const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0); return new T(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + a.count * n * T.BYTES_PER_ELEMENT)); };
  const prims = [];
  for (const node of json.nodes) if (node.mesh != null) for (const p of json.meshes[node.mesh].primitives) prims.push({ pos: acc(p.attributes.POSITION, 3), nor: acc(p.attributes.NORMAL, 3), uv: p.attributes.TEXCOORD_0 != null ? acc(p.attributes.TEXCOORD_0, 2) : null, idx: acc(p.indices, 1), mat: json.materials[p.material].pbrMetallicRoughness });
  const nv = prims.reduce((a, p) => a + p.pos.length / 3, 0), ni = prims.reduce((a, p) => a + p.idx.length, 0);
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const p of prims) for (let i = 0; i < p.pos.length; i++) { const a = i % 3; lo[a] = Math.min(lo[a], p.pos[i]); hi[a] = Math.max(hi[a], p.pos[i]); }
  const P = new Uint16Array(nv * 3), N = new Int8Array(nv * 2), T = new Uint16Array(nv * 2), C = new Uint8Array(nv * 4), I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const p of prims) {
    const n = p.pos.length / 3;
    for (let k = 0; k < n; k++) {
      for (let a = 0; a < 3; a++) P[(vo + k) * 3 + a] = Math.round(((p.pos[k * 3 + a] - lo[a]) / (hi[a] - lo[a])) * 65535);
      let [x, y, z] = [p.nor[k * 3], p.nor[k * 3 + 1], p.nor[k * 3 + 2]]; const s = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1; x /= s; y /= s; z /= s;
      if (z < 0) { const ox = (1 - Math.abs(y)) * Math.sign(x || 1), oy = (1 - Math.abs(x)) * Math.sign(y || 1); x = ox; y = oy; }
      N[(vo + k) * 2] = Math.round(x * 127); N[(vo + k) * 2 + 1] = Math.round(y * 127);
      if (p.uv) { T[(vo + k) * 2] = Math.round(Math.min(1, Math.max(0, p.uv[k * 2])) * 65535); T[(vo + k) * 2 + 1] = Math.round(Math.min(1, Math.max(0, p.uv[k * 2 + 1])) * 65535); }
      const tex = p.mat.baseColorTexture && p.uv, c = p.mat.baseColorFactor ?? [1, 1, 1, 1];
      for (let a = 0; a < 3; a++) C[(vo + k) * 4 + a] = tex ? 255 : Math.round(255 * Math.pow(c[a], 1 / 2.2));
      C[(vo + k) * 4 + 3] = tex ? 255 : 0;
    }
    for (let k = 0; k < p.idx.length; k++) I[io + k] = p.idx[k] + vo;
    vo += n; io += p.idx.length;
  }
  const raw = Buffer.concat([P, N, T, C, I].map((a) => Buffer.from(a.buffer)));
  return { path: path.split('/').pop(), verts: nv, tris: ni / 3, raw: raw.length, gzip: zlib.gzipSync(raw, { level: 9 }).length, brotli: zlib.brotliCompressSync(raw).length, gpuBytes: nv * 16 + ni * (nv > 65535 ? 4 : 2), buf: raw };
}
if (process.argv[1].endsWith('quantize.mjs')) {
  let tot = { raw: 0, gzip: 0, brotli: 0 };
  for (const p of process.argv.slice(2)) { const r = quantize(p); fs.writeFileSync('payload/' + r.path.replace('.glb', '.bin'), r.buf); delete r.buf; console.log(JSON.stringify(r)); }
}
