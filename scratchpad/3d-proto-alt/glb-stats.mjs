// Parse every raw GLB: file size, vertex/triangle counts, attribute set, embedded image bytes + dims.
import fs from 'node:fs';
import path from 'node:path';
const dir = 'G:/DEV/Terepasztal/pipeline-out/models_raw';
const out = [];
function pngDims(buf) { return buf.readUInt32BE(0) === 0x89504e47 ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : null; }
function jpgDims(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.glb')).sort()) {
  const b = fs.readFileSync(path.join(dir, f));
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  let verts = 0, tris = 0, prims = 0; const attrs = new Set(); let idxType = '';
  for (const m of json.meshes ?? []) for (const p of m.primitives) {
    prims++;
    for (const a of Object.keys(p.attributes)) attrs.add(a + ':' + json.accessors[p.attributes[a]].componentType);
    verts += json.accessors[p.attributes.POSITION].count;
    if (p.indices != null) { tris += json.accessors[p.indices].count / 3; idxType = json.accessors[p.indices].componentType; }
    else tris += json.accessors[p.attributes.POSITION].count / 3;
  }
  const images = (json.images ?? []).map((im) => {
    const bv = json.bufferViews[im.bufferView];
    const buf = b.subarray(binStart + (bv.byteOffset ?? 0), binStart + (bv.byteOffset ?? 0) + bv.byteLength);
    const d = pngDims(buf) ?? jpgDims(buf);
    return { mime: im.mimeType, bytes: bv.byteLength, dims: d };
  });
  const imgBytes = images.reduce((a, i) => a + i.bytes, 0);
  out.push({ id: f.replace('.glb', ''), size: b.length, verts, tris, prims, attrs: [...attrs].join(','), idxType, images, imgBytes, geomBytes: b.length - imgBytes - jsonLen,
    mats: (json.materials ?? []).map((m) => ({ base: m.pbrMetallicRoughness?.baseColorTexture?.index, mr: m.pbrMetallicRoughness?.metallicRoughnessTexture?.index, n: m.normalTexture?.index, metallic: m.pbrMetallicRoughness?.metallicFactor, rough: m.pbrMetallicRoughness?.roughnessFactor })),
    ext: json.extensionsUsed });
}
fs.writeFileSync('scratchpad/3d-proto-alt/glb-stats.json', JSON.stringify(out, null, 1));
const mb = (n) => (n / 1048576).toFixed(2);
for (const o of out) console.log(o.id.padEnd(18), mb(o.size).padStart(7), 'MB', String(o.verts).padStart(7), 'v', String(o.tris).padStart(7), 't', o.prims, 'prim', o.images.map((i) => `${i.mime.split('/')[1]} ${i.dims?.join('x')} ${mb(i.bytes)}MB`).join(' | '), o.attrs);
const sum = (k) => out.reduce((a, o) => a + o[k], 0);
console.log('TOTAL', out.length, 'glb', mb(sum('size')), 'MB; verts', sum('verts'), 'tris', sum('tris'), 'imgMB', mb(sum('imgBytes')), 'geomMB', mb(sum('geomBytes')));
console.log(JSON.stringify(out[2].mats), out[2].ext);
