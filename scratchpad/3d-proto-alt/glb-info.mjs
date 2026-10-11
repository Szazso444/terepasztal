// Describe a GLB: meshes, primitives, materials, images; and estimate a quantized custom payload.
import fs from 'node:fs';
import zlib from 'node:zlib';
export function readGlb(path) {
  const b = fs.readFileSync(path);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  const bin = b.subarray(20 + jsonLen + 8);
  return { json, bin, size: b.length };
}
export function info(path) {
  const { json, bin, size } = readGlb(path);
  let verts = 0, tris = 0, prims = 0;
  for (const m of json.meshes) for (const p of m.primitives) {
    prims++; verts += json.accessors[p.attributes.POSITION].count; tris += json.accessors[p.indices].count / 3;
  }
  const imgBytes = (json.images ?? []).reduce((a, im) => a + json.bufferViews[im.bufferView].byteLength, 0);
  // quantized payload: pos 3x u16, normal 2x i8 (oct), uv 2x u16 = 12 B/vert; indices u16 when they fit else u32
  const q = verts * 12 + tris * 3 * (verts < 65536 ? 2 : 4);
  const geomBuf = bin.subarray(0, bin.length - imgBytes);
  return { path: path.split('/').pop(), size, verts, tris, prims, imgBytes, geomBytes: size - imgBytes, geomGzip: zlib.gzipSync(geomBuf, { level: 9 }).length, quantBytes: q,
    mats: (json.materials ?? []).map((m) => m.name + (m.pbrMetallicRoughness?.baseColorTexture ? ':tex' : ':' + JSON.stringify(m.pbrMetallicRoughness?.baseColorFactor?.map((x) => +x.toFixed(2))) ) + (m.doubleSided ? ':2s' : '')),
    nodes: json.nodes.map((n) => n.name) };
}
if (process.argv[1].endsWith('glb-info.mjs')) for (const p of process.argv.slice(2)) console.log(JSON.stringify(info(p)));
