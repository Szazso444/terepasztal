// A reader for the GLB subset export_mesh.py writes. No dependencies; ~90 lines.
// parseGlb(ArrayBuffer) -> { json, manifest, parts: [{ name, mesh, mirror, matrix(16, column-major),
//   positions: Uint16Array(4 per vertex), normals: Int8Array(4 per vertex), uvs: Uint16Array(2 per vertex),
//   indices: Uint16Array|Uint32Array, vertexCount, indexCount }], image: { mimeType, bytes: Uint8Array } }
// The node matrix dequantizes: world = matrix * (uint16 position). A node with a negative determinant
// (the mirrored half) must be drawn with the winding flipped (gl.frontFace(gl.CW)) or with culling off.
const TYPES = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export function parseGlb(buffer) {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2) throw new Error('not a GLB 2 file');
  const jsonLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a) throw new Error('first chunk is not JSON');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLen)));
  const binStart = 20 + jsonLen + 8;
  if (dv.getUint32(20 + jsonLen + 4, true) !== 0x004e4942) throw new Error('second chunk is not BIN');
  const known = ['KHR_mesh_quantization', 'KHR_materials_unlit', 'EXT_texture_webp'];
  for (const e of json.extensionsRequired ?? []) if (!known.includes(e)) throw new Error(`extension ${e}`);

  // An accessor as a typed array over the file's own bytes. Vertex attributes are padded to 4-byte
  // rows (byteStride), so the array has `stride / elementSize` numbers per vertex.
  const accessor = (i) => {
    const a = json.accessors[i];
    const v = json.bufferViews[a.bufferView];
    const T = TYPES[a.componentType];
    const per = (v.byteStride ?? WIDTH[a.type] * T.BYTES_PER_ELEMENT) / T.BYTES_PER_ELEMENT;
    const offset = binStart + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    return { array: new T(buffer, offset, a.count * per), per, count: a.count, normalized: !!a.normalized };
  };
  const parts = [];
  for (const node of json.nodes) {
    if (node.mesh === undefined) continue;
    const prim = json.meshes[node.mesh].primitives[0];
    const p = accessor(prim.attributes.POSITION);
    const n = accessor(prim.attributes.NORMAL);
    const t = accessor(prim.attributes.TEXCOORD_0);
    const ix = accessor(prim.indices);
    const s = node.scale ?? [1, 1, 1];
    const tr = node.translation ?? [0, 0, 0];
    parts.push({
      name: node.name, mesh: node.mesh, mirror: s[0] * s[1] * s[2] < 0,
      matrix: new Float32Array([s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, tr[0], tr[1], tr[2], 1]),
      positions: p.array, positionStride: p.per, normals: n.array, normalStride: n.per,
      uvs: t.array, uvStride: t.per, indices: ix.array, vertexCount: p.count, indexCount: ix.count,
    });
  }
  let image = null;
  const img = json.images?.[0];
  if (img && img.bufferView !== undefined) {
    const v = json.bufferViews[img.bufferView];
    image = { mimeType: img.mimeType, bytes: new Uint8Array(buffer, binStart + (v.byteOffset ?? 0), v.byteLength) };
  }
  return { json, manifest: json.extras?.terepasztal ?? null, parts, image };
}

// Browser only: the embedded texture as an ImageBitmap (what a PixiJS Texture or texImage2D takes).
export function glbImage(glb) {
  return createImageBitmap(new Blob([glb.image.bytes], { type: glb.image.mimeType }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}
