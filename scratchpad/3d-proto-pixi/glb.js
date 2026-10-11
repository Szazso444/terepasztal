// Minimal GLB (glTF 2.0 binary) reader for the prototype: first primitive of the first mesh.
// Returns typed arrays (positions xyz, normals xyz, uvs, indices as Uint32Array) and the base colour
// image as an ImageBitmap (or null when the file carries no image). No runtime dependency.

const COMPONENT = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export function parseGLB(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');
  if (dv.getUint32(4, true) !== 2) throw new Error('GLB version 2 expected');
  let off = 12;
  let json = null;
  let bin = null;
  while (off < dv.byteLength) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, off + 8, len)));
    else if (type === 0x004e4942) bin = { offset: off + 8, length: len };
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json || !bin) throw new Error('GLB needs a JSON and a BIN chunk');

  // An accessor copied out into its own tightly packed typed array (handles byteStride).
  const read = (index) => {
    const acc = json.accessors[index];
    const view = json.bufferViews[acc.bufferView];
    const Type = COMPONENT[acc.componentType];
    const width = WIDTH[acc.type];
    const start = bin.offset + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const stride = view.byteStride ?? Type.BYTES_PER_ELEMENT * width;
    const out = new Type(acc.count * width);
    if (stride === Type.BYTES_PER_ELEMENT * width && start % Type.BYTES_PER_ELEMENT === 0) {
      out.set(new Type(arrayBuffer, start, acc.count * width));
    } else {
      const src = new DataView(arrayBuffer, start);
      const get = {
        5120: 'getInt8',
        5121: 'getUint8',
        5122: 'getInt16',
        5123: 'getUint16',
        5125: 'getUint32',
        5126: 'getFloat32',
      }[acc.componentType];
      for (let i = 0; i < acc.count; i++)
        for (let k = 0; k < width; k++) out[i * width + k] = src[get](i * stride + k * Type.BYTES_PER_ELEMENT, true);
    }
    return out;
  };

  const prim = json.meshes[0].primitives[0];
  if ((prim.mode ?? 4) !== 4) throw new Error('triangle list expected');
  const positions = read(prim.attributes.POSITION);
  const normals = prim.attributes.NORMAL !== undefined ? read(prim.attributes.NORMAL) : null;
  const uvs = prim.attributes.TEXCOORD_0 !== undefined ? read(prim.attributes.TEXCOORD_0) : null;
  let indices;
  if (prim.indices !== undefined) indices = Uint32Array.from(read(prim.indices));
  else {
    indices = new Uint32Array(positions.length / 3);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
  }

  // base colour image: material -> pbrMetallicRoughness.baseColorTexture -> texture -> image -> bufferView
  let imageBytes = null;
  let imageMime = null;
  const mat = prim.material !== undefined ? json.materials?.[prim.material] : null;
  const texIndex = mat?.pbrMetallicRoughness?.baseColorTexture?.index;
  if (texIndex !== undefined) {
    const img = json.images[json.textures[texIndex].source];
    if (img.bufferView !== undefined) {
      const v = json.bufferViews[img.bufferView];
      imageBytes = new Uint8Array(arrayBuffer, bin.offset + (v.byteOffset ?? 0), v.byteLength);
      imageMime = img.mimeType ?? 'image/png';
    }
  }
  const node = json.nodes?.find((n) => n.mesh === 0);
  const hasNodeTransform = !!(node && (node.matrix || node.rotation || node.scale || node.translation));
  return { positions, normals, uvs, indices, imageBytes, imageMime, hasNodeTransform, json };
}

export async function loadGLB(url) {
  const t0 = performance.now();
  const buf = await (await fetch(url)).arrayBuffer();
  const t1 = performance.now();
  const g = parseGLB(buf);
  let image = null;
  if (g.imageBytes) {
    // premultiplyAlpha none + colorSpaceConversion none: the raw texels, as a 3D texture wants them
    image = await createImageBitmap(new Blob([g.imageBytes], { type: g.imageMime }), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
  }
  g.image = image;
  g.timing = { fetchMs: t1 - t0, parseMs: performance.now() - t1 };
  return g;
}
