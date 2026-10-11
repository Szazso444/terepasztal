// Scratch prototype: locomotive parts as real meshes in a PixiJS 8 scene, no other runtime dependency.
//  - loadPart(url): minimal GLB reader (positions, normals, uvs, indices, base colour texture or factor)
//  - PartMesh: a Pixi Mesh whose vertex shader does the game's fixed isometric projection (elevation 30,
//    azimuth 45; 64x32 tile) from model metres, with heading, pitch, yaw offset, lift and per-axis scale as
//    uniforms, the pipeline's "painted" light, and a depth buffer.
//  - ImpostorCache: render a PartMesh into a cached texture for a quantized pose; show it as a Sprite.
import {
  Geometry,
  Mesh,
  Shader,
  GlProgram,
  GpuProgram,
  State,
  Texture,
  ImageSource,
  RenderTexture,
  RenderTarget,
  Container,
  UniformGroup,
} from 'pixi.js';

export const TILE_M = 6.235064799811727; // pipeline [grid] metre = human: tile side in metres
export const K = 64 / (TILE_M * Math.SQRT2); // logical px per metre at zoom 1
// pipeline render.light_cam (-0.5, 0.7, 0.5) in camera axes (right, up, back) -> Blender world
const R = [Math.SQRT1_2, Math.SQRT1_2, 0],
  U = [-0.35355339, 0.35355339, 0.8660254],
  B = [0.61237244, -0.61237244, 0.5];
const lc = [-0.5, 0.7, 0.5];
const Lw = [0, 1, 2].map((i) => lc[0] * R[i] + lc[1] * U[i] + lc[2] * B[i]);
const ll = Math.hypot(...Lw);
export const LIGHT = Lw.map((v) => v / ll);

export async function loadPart(url, { textureSize = 0, textureUrl = null, mipmaps = true } = {}) {
  const buf = await (await fetch(url)).arrayBuffer();
  const dv = new DataView(buf);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const binStart = 20 + jsonLen + 8;
  const acc = (i, Type, n) => {
    const a = json.accessors[i],
      bv = json.bufferViews[a.bufferView];
    const off = binStart + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    if (bv.byteStride && bv.byteStride !== Type.BYTES_PER_ELEMENT * n)
      throw new Error('interleaved GLB not supported');
    return new Type(buf.slice(off, off + a.count * n * Type.BYTES_PER_ELEMENT));
  };
  let nv = 0,
    ni = 0;
  const prims = [];
  for (const node of json.nodes) {
    if (node.mesh == null) continue;
    if (node.rotation || node.scale || node.translation || node.matrix)
      console.warn('node transform ignored', node.name);
    for (const p of json.meshes[node.mesh].primitives) {
      const pos = acc(p.attributes.POSITION, Float32Array, 3),
        nor = acc(p.attributes.NORMAL, Float32Array, 3);
      const uv = p.attributes.TEXCOORD_0 != null ? acc(p.attributes.TEXCOORD_0, Float32Array, 2) : null;
      const ia = json.accessors[p.indices];
      const idx =
        ia.componentType === 5125
          ? acc(p.indices, Uint32Array, 1)
          : ia.componentType === 5123
            ? acc(p.indices, Uint16Array, 1)
            : acc(p.indices, Uint8Array, 1);
      const mat = json.materials?.[p.material]?.pbrMetallicRoughness ?? {};
      prims.push({ pos, nor, uv, idx, tex: mat.baseColorTexture?.index, color: mat.baseColorFactor ?? [1, 1, 1, 1] });
      nv += pos.length / 3;
      ni += idx.length;
    }
  }
  // one geometry for the whole part: colour.rgb is a flat colour (linear -> sRGB), colour.a the texture weight
  const P = new Float32Array(nv * 3),
    N = new Float32Array(nv * 3),
    T = new Float32Array(nv * 2),
    C = new Uint8Array(nv * 4);
  // WebGPU: a buffer mapped at creation must be a multiple of 4 bytes, so a u16 index list gets an even
  // count (one degenerate triangle of zeros when the count is odd)
  const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni + (ni % 2 ? 3 : 0));
  let vo = 0,
    io = 0,
    texIndex = null;
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  const s = (v) => Math.round(255 * Math.pow(Math.max(0, v), 1 / 2.2));
  for (const p of prims) {
    const n = p.pos.length / 3;
    P.set(p.pos, vo * 3);
    N.set(p.nor, vo * 3);
    if (p.uv) T.set(p.uv, vo * 2);
    const textured = p.tex != null && !!p.uv;
    if (textured) texIndex = p.tex;
    for (let k = 0; k < n; k++) {
      const o = (vo + k) * 4;
      C[o] = textured ? 255 : s(p.color[0]);
      C[o + 1] = textured ? 255 : s(p.color[1]);
      C[o + 2] = textured ? 255 : s(p.color[2]);
      C[o + 3] = textured ? 255 : 0;
    }
    for (let k = 0; k < p.idx.length; k++) I[io + k] = p.idx[k] + vo;
    for (let k = 0; k < n; k++)
      for (let a = 0; a < 3; a++) {
        const v = p.pos[k * 3 + a];
        if (v < lo[a]) lo[a] = v;
        if (v > hi[a]) hi[a] = v;
      }
    vo += n;
    io += p.idx.length;
  }
  let texture = Texture.WHITE,
    texBytes = 0,
    texDim = 0;
  if (textureUrl || texIndex != null) {
    let blob;
    if (textureUrl) blob = await (await fetch(textureUrl)).blob();
    else {
      const im = json.images[json.textures[texIndex].source],
        bv = json.bufferViews[im.bufferView];
      blob = new Blob([new Uint8Array(buf, binStart + (bv.byteOffset ?? 0), bv.byteLength)], { type: im.mimeType });
    }
    texBytes = blob.size;
    let bmp = await createImageBitmap(blob);
    if (textureSize && bmp.width > textureSize)
      bmp = await createImageBitmap(bmp, { resizeWidth: textureSize, resizeHeight: textureSize, resizeQuality: 'high' });
    texDim = bmp.width;
    texture = new Texture({
      source: new ImageSource({
        resource: bmp,
        scaleMode: 'linear',
        autoGenerateMipmaps: mipmaps,
        mipmapFilter: 'linear',
        maxAnisotropy: 4,
        addressMode: 'repeat',
      }),
    });
  }
  const geometry = new Geometry({
    attributes: {
      aPosition: { buffer: P, format: 'float32x3' },
      aNormal: { buffer: N, format: 'float32x3' },
      aUV: { buffer: T, format: 'float32x2' },
      aColor: { buffer: C, format: 'unorm8x4' },
    },
    indexBuffer: I,
  });
  return { geometry, texture, positions: P, verts: nv, tris: ni / 3, lo, hi, glbBytes: buf.byteLength, texBytes, texDim, url };
}

const vertex = /* glsl */ `
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUV;
in vec4 aColor;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform mat3 uModel;      // model metres (x nose, y left, z up) -> Blender-world metres (yaw, pitch, scale applied)
uniform mat3 uNormalMat;
uniform vec3 uShift;      // metres, world
uniform vec3 uKD;         // px per metre, depth scale, depth bias
out vec2 vUV;
out vec3 vN;
out vec4 vColor;
out float vFace;
void main() {
  // Pixi flips Y when a WebGL render texture is the target, which inverts the winding gl_FrontFacing sees
  vFace = uProjectionMatrix[1][1] > 0.0 ? -1.0 : 1.0;
  vec3 w = uModel * aPosition + uShift;
  float sx = (w.x + w.y) * 0.70710678 * uKD.x;
  float sy = -((w.y - w.x) * 0.35355339 + w.z * 0.8660254) * uKD.x;
  float d = (w.x - w.y) * 0.61237244 + w.z * 0.5;   // metres towards the camera
  vec3 p = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(sx, sy, 1.0);
  gl_Position = vec4(p.xy, uKD.z - d * uKD.y, 1.0);
  vUV = aUV;
  vN = uNormalMat * aNormal;
  vColor = aColor;
}`;
const fragment = /* glsl */ `
in vec2 vUV;
in vec3 vN;
in vec4 vColor;
in float vFace;
uniform sampler2D uTexture;
uniform vec3 uLight;
uniform vec3 uShade;  // ambient, light, 1/gamma
uniform vec4 uColor;
out vec4 finalColor;
void main() {
  vec3 n = normalize(vN);
  if (gl_FrontFacing != (vFace > 0.0)) n = -n;
  // the pipeline multiplies in linear light and writes sRGB: the factor goes through the transfer curve
  float f = pow(uShade.x + uShade.y * max(0.0, dot(n, uLight)), uShade.z);
  vec3 base = mix(vColor.rgb, texture(uTexture, vUV).rgb, vColor.a);
  finalColor = vec4(min(base * f, 1.0), 1.0) * uColor;
}`;
// WebGPU twin of the same shader (Pixi's fallback renderer when WebGL is unavailable)
const wgsl = /* wgsl */ `
struct GlobalUniforms { uProjectionMatrix: mat3x3<f32>, uWorldTransformMatrix: mat3x3<f32>, uWorldColorAlpha: vec4<f32>, uResolution: vec2<f32> }
struct LocalUniforms { uTransformMatrix: mat3x3<f32>, uColor: vec4<f32>, uRound: f32 }
struct Loco { uModel: mat3x3<f32>, uNormalMat: mat3x3<f32>, uShift: vec3<f32>, uKD: vec3<f32>, uLight: vec3<f32>, uShade: vec3<f32> }
@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;
@group(2) @binding(0) var<uniform> loco: Loco;
@group(2) @binding(1) var uTexture: texture_2d<f32>;
@group(2) @binding(2) var uSampler: sampler;
struct VSOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) n: vec3<f32>, @location(2) color: vec4<f32> }
@vertex fn mainVert(@location(0) aPosition: vec3<f32>, @location(1) aNormal: vec3<f32>, @location(2) aUV: vec2<f32>, @location(3) aColor: vec4<f32>) -> VSOut {
  let w = loco.uModel * aPosition + loco.uShift;
  let sx = (w.x + w.y) * 0.70710678 * loco.uKD.x;
  let sy = -((w.y - w.x) * 0.35355339 + w.z * 0.8660254) * loco.uKD.x;
  let d = (w.x - w.y) * 0.61237244 + w.z * 0.5;
  let p = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix * vec3<f32>(sx, sy, 1.0);
  // WebGPU clip z is 0..1
  return VSOut(vec4<f32>(p.xy, (loco.uKD.z - d * loco.uKD.y) * 0.5 + 0.5, 1.0), aUV, loco.uNormalMat * aNormal, aColor);
}
@fragment fn mainFrag(in: VSOut, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
  var n = normalize(in.n);
  if (!front) { n = -n; }
  let f = pow(loco.uShade.x + loco.uShade.y * max(0.0, dot(n, loco.uLight)), loco.uShade.z);
  let base = mix(in.color.rgb, textureSample(uTexture, uSampler, in.uv).rgb, in.color.a);
  return vec4<f32>(min(base * f, vec3<f32>(1.0)), 1.0) * localUniforms.uColor;
}`;

let glProgram, gpuProgram;
export function makeShader(texture) {
  glProgram ??= GlProgram.from({ vertex, fragment, name: 'loco3d' });
  gpuProgram ??= GpuProgram.from({
    vertex: { source: wgsl, entryPoint: 'mainVert' },
    fragment: { source: wgsl, entryPoint: 'mainFrag' },
    name: 'loco3d',
  });
  return new Shader({
    glProgram,
    gpuProgram,
    resources: {
      loco: new UniformGroup({
        uModel: { value: new Float32Array(9), type: 'mat3x3<f32>' },
        uNormalMat: { value: new Float32Array(9), type: 'mat3x3<f32>' },
        uShift: { value: new Float32Array(3), type: 'vec3<f32>' },
        uKD: { value: new Float32Array([K, 1 / 64, 0]), type: 'vec3<f32>' },
        uLight: { value: new Float32Array(LIGHT), type: 'vec3<f32>' },
        uShade: { value: new Float32Array([0.8, 0.4, 1 / 2.2]), type: 'vec3<f32>' },
      }),
      uTexture: texture.source,
      uSampler: texture.source.style,
    },
  });
}

/**
 * Tunable per-locomotive (per part) data: what the owner drags in the tuner. Metres and radians.
 *  sx, sy, sz      length, width, height factors
 *  yaw, pitch0, roll0   the model's own error against its wheel contacts (removed before anything else)
 *  fore, lateral, lift  where the corrected model sits on the rail (applied before the scale, so a
 *                       height factor never lifts the wheels off the rail)
 */
export const defaultTune = () => ({ sx: 1, sy: 1, sz: 1, yaw: 0, pitch0: 0, roll0: 0, lift: 0, lateral: 0, fore: 0 });

const mul = (a, b) => a.map((r) => [0, 1, 2].map((c) => r[0] * b[0][c] + r[1] * b[1][c] + r[2] * b[2][c]));
const Rz = (t) => [[Math.cos(t), -Math.sin(t), 0], [Math.sin(t), Math.cos(t), 0], [0, 0, 1]];
/** lifts the nose (+x) for a positive angle */
const Rp = (t) => [[Math.cos(t), 0, -Math.sin(t)], [0, 1, 0], [Math.sin(t), 0, Math.cos(t)]];
/** lifts the left side (+y) for a positive angle */
const Rr = (t) => [[1, 0, 0], [0, Math.cos(t), -Math.sin(t)], [0, Math.sin(t), Math.cos(t)]];
/** the correction that removes the model's measured yaw, pitch and roll error */
export function correction(tune) {
  return mul(Rz(-tune.yaw), mul(Rp(-(tune.pitch0 ?? 0)), Rr(-(tune.roll0 ?? 0))));
}
/**
 * column-major 3x3s for M = Rz(-heading) * Rp(pitch) * diag(scale) * correction, its inverse transpose,
 * and the shift M0 * diag(scale) * (fore, lateral, lift).
 */
export function modelMatrix(out, nrm, shift, heading, pitch, tune) {
  const A = mul(Rz(-heading), Rp(pitch)),
    C = correction(tune),
    s = [tune.sx, tune.sy, tune.sz];
  const AS = A.map((r) => r.map((v, c) => v * s[c])),
    ASi = A.map((r) => r.map((v, c) => v / s[c]));
  const M = mul(AS, C),
    Nm = mul(ASi, C);
  for (let c = 0; c < 3; c++)
    for (let r = 0; r < 3; r++) {
      out[c * 3 + r] = M[r][c];
      nrm[c * 3 + r] = Nm[r][c];
    }
  const t = [tune.fore ?? 0, tune.lateral ?? 0, tune.lift ?? 0];
  for (let r = 0; r < 3; r++) shift[r] = AS[r][0] * t[0] + AS[r][1] * t[1] + AS[r][2] * t[2];
}

export class PartMesh extends Mesh {
  constructor(part) {
    super({ geometry: part.geometry, shader: makeShader(part.texture) });
    this.part = part;
    const st = new State();
    st.blend = false;
    st.depthTest = true;
    st.depthMask = true;
    st.culling = false;
    this.state = st;
    this.cullable = false;
    this.u = this.shader.resources.loco.uniforms;
  }
  /** heading: tile-space angle; pitch: radians nose up; depthBias: clip-space depth of the anchor */
  setPose(heading, pitch = 0, tune = defaultTune(), depthScale = 1 / 64, depthBias = 0) {
    modelMatrix(this.u.uModel, this.u.uNormalMat, this.u.uShift, heading, pitch, tune);
    this.u.uKD[1] = depthScale;
    this.u.uKD[2] = depthBias;
    this.shader.resources.loco.update();
  }
}

/** Screen box (logical px, relative to the anchor) that holds the part at any heading and a moderate pitch. */
export function partCanvas(part, tune = defaultTune(), pad = 3) {
  const hx = Math.max(Math.abs(part.lo[0]), Math.abs(part.hi[0])) * tune.sx + Math.abs(tune.fore);
  const hy = Math.max(Math.abs(part.lo[1]), Math.abs(part.hi[1])) * tune.sy + Math.abs(tune.lateral);
  const r = Math.hypot(hx, hy) * 1.04,
    top = part.hi[2] * tune.sz + tune.lift + r * 0.26,
    bot = Math.min(0, part.lo[2] * tune.sz + tune.lift) - r * 0.26;
  const w = Math.ceil(r * K) + pad,
    up = Math.ceil((r * 0.5 + top * 0.8660254) * K) + pad,
    down = Math.ceil((r * 0.5 - bot * 0.8660254) * K) + pad;
  return { w: 2 * w, h: up + down, ax: w, ay: up };
}

/**
 * Impostor cache: one texture per (part, quantized heading, quantized pitch, texel scale, tune version).
 * Rendering one is a single indexed draw into an offscreen target with a depth buffer.
 */
export class ImpostorCache {
  constructor(renderer, { yawSteps = 256, pitchStep = Math.PI / 180, maxEntries = 512, antialias = false } = {}) {
    this.renderer = renderer;
    this.yawSteps = yawSteps;
    this.pitchStep = pitchStep;
    this.maxEntries = maxEntries;
    this.antialias = antialias;
    this.map = new Map();
    this.meshes = new Map();
    this.renders = 0;
    this.texels = 0;
    this.holder = new Container();
    this.pool = new Map();
  }
  quantize(heading, pitch) {
    const step = (Math.PI * 2) / this.yawSteps;
    const qi = ((Math.round(heading / step) % this.yawSteps) + this.yawSteps) % this.yawSteps;
    const pi = Math.round(pitch / this.pitchStep);
    return { qi, pi, qHeading: qi * step, qPitch: pi * this.pitchStep };
  }
  /** scale: texels per logical px (zoom * devicePixelRatio * supersample, bucketed by the caller) */
  get(part, heading, pitch, tune, tuneVersion, scale) {
    const { qi, pi, qHeading, qPitch } = this.quantize(heading, pitch);
    const key = `${part.url}|${qi}|${pi}|${scale}|${tuneVersion}`;
    let e = this.map.get(key);
    if (e) {
      this.map.delete(key);
      this.map.set(key, e);
      return e;
    }
    let mesh = this.meshes.get(part);
    if (!mesh) {
      mesh = new PartMesh(part);
      this.meshes.set(part, mesh);
    }
    const cv = partCanvas(part, tune);
    // evicted targets of the same size are reused: steady state allocates nothing
    const poolKey = cv.w + 'x' + cv.h + '@' + scale;
    const pooled = this.pool.get(poolKey)?.pop();
    const rt =
      pooled?.texture ??
      RenderTexture.create({
        width: cv.w,
        height: cv.h,
        resolution: scale,
        scaleMode: 'linear',
        antialias: this.antialias,
      });
    const target = pooled?.target ?? new RenderTarget({ colorTextures: [rt.source], depth: true });
    mesh.setPose(qHeading, qPitch, tune);
    mesh.position.set(cv.ax, cv.ay);
    this.holder.removeChildren();
    this.holder.addChild(mesh);
    this.renderer.render({ container: this.holder, target, clear: true, clearColor: [0, 0, 0, 0] });
    e = {
      poolKey,
      texture: rt,
      target,
      ax: cv.ax / cv.w,
      ay: cv.ay / cv.h,
      w: cv.w,
      h: cv.h,
      qHeading,
      qPitch,
      texels: cv.w * cv.h * scale * scale,
    };
    this.renders++;
    this.texels += e.texels;
    this.map.set(key, e);
    while (this.map.size > this.maxEntries) {
      const [k, old] = this.map.entries().next().value;
      this.map.delete(k);
      this.texels -= old.texels;
      let list = this.pool.get(old.poolKey);
      if (!list) this.pool.set(old.poolKey, (list = []));
      list.push(old);
    }
    return e;
  }
  clear() {
    for (const e of this.map.values()) {
      e.target.destroy();
      e.texture.destroy(true);
    }
    this.map.clear();
    this.texels = 0;
  }
}
