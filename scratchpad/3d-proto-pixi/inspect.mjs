import { readFileSync } from 'node:fs';
const buf = readFileSync(process.argv[2]);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
console.log('magic', dv.getUint32(0, true).toString(16), 'ver', dv.getUint32(4, true), 'len', dv.getUint32(8, true));
let off = 12; let json, bin;
while (off < buf.byteLength) {
  const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
  if (type === 0x4e4f534a) json = JSON.parse(buf.subarray(off + 8, off + 8 + len).toString('utf8'));
  else if (type === 0x004e4942) bin = buf.subarray(off + 8, off + 8 + len);
  off += 8 + len;
}
const j = json;
console.log(JSON.stringify({ asset: j.asset, scenes: j.scenes, nodes: j.nodes, meshes: j.meshes, materials: j.materials, textures: j.textures, samplers: j.samplers, images: j.images, extensionsUsed: j.extensionsUsed }, null, 1));
console.log('accessors', JSON.stringify(j.accessors));
console.log('bufferViews', JSON.stringify(j.bufferViews));
console.log('bin bytes', bin.length);
