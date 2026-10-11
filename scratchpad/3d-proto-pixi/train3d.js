// Prototype: a textured, depth-tested, back-face-culled 3D mesh in PixiJS 8.20.1 (WebGL renderer),
// projected with the game's fixed isometric orthographic camera in the vertex shader.
import { Geometry, GlProgram, ImageSource, Mesh, Rectangle, Shader, State, Texture } from 'pixi.js';
import { loadGLB } from './glb.js';

// ---------------- the game's camera ----------------
export const TILE_W = 64;
export const HALF_W = 32;
export const HALF_H = 16;
export const ELEVATION = Math.PI / 6; // 30 deg above the horizon
/** Screen pixels one tile-length of height rises: the tile side is 64/sqrt(2) px before foreshortening. */
export const UP_PX = (TILE_W / Math.SQRT2) * Math.cos(ELEVATION); // 39.19
/** Nearness to the camera of a point (tile x, tile y, height in tile lengths); bigger = nearer. */
export const NEAR_XY = Math.cos(ELEVATION) / Math.SQRT2; // 0.6124
export const NEAR_H = Math.sin(ELEVATION); // 0.5
export const nearOf = (tx, ty, h = 0) => NEAR_XY * (tx + ty) + NEAR_H * h;
export const tileToWorld = (tx, ty) => ({ x: (tx - ty) * HALF_W, y: (tx + ty) * HALF_H });

/** The pipeline's painted light, given in camera axes (right, up, back), as a tile-space unit vector. */
export function lightInTileSpace(lightCam = [-0.5, 0.7, 0.5]) {
  const c = Math.cos(ELEVATION);
  const s = Math.sin(ELEVATION);
  const r = [Math.SQRT1_2, -Math.SQRT1_2, 0];
  const u = [-s * Math.SQRT1_2, -s * Math.SQRT1_2, c];
  const b = [c * Math.SQRT1_2, c * Math.SQRT1_2, s];
  const v = [0, 1, 2].map((i) => lightCam[0] * r[i] + lightCam[1] * u[i] + lightCam[2] * b[i]);
  const n = Math.hypot(...v);
  return new Float32Array(v.map((x) => x / n));
}

// ---------------- model preparation (CPU, once per model) ----------------
const rx = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const ry = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const rz = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const mul = (A, B) => A.map((row, i) => B[0].map((_, j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
const rad = (d) => (d * Math.PI) / 180;

/**
 * Raw reconstructed model (glTF frame, the source photo's camera frame) -> the game's model frame:
 * x = nose, y = tile-space lateral (so that heading 0 runs along tile +x), z = up from the rail,
 * all in tile lengths. Follows the pipeline's blender_stage.py: glTF -> Blender axes, Manhattan
 * alignment, the 90-degree step that puts the long axis on X, the refinement, real scale.
 */
export function alignModel(glb, { align, scale, heightM, tileM }) {
  const n = glb.positions.length / 3;
  const P = glb.positions;
  let R = mul(rz(rad(align.yaw)), mul(rx(rad(align.pitch)), ry(rad(align.roll))));
  const ext = (M) => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      // glTF (x, y up, z) -> Blender (x, -z, y up)
      const bx = P[i * 3];
      const by = -P[i * 3 + 2];
      const bz = P[i * 3 + 1];
      for (let k = 0; k < 3; k++) {
        const v = M[k][0] * bx + M[k][1] * by + M[k][2] * bz;
        if (v < lo[k]) lo[k] = v;
        if (v > hi[k]) hi[k] = v;
      }
    }
    return { lo, hi };
  };
  const e0 = ext(R);
  const d0 = [0, 1, 2].map((k) => e0.hi[k] - e0.lo[k]);
  let best = null;
  for (let k = 0; k < 4; k++) {
    const total = ((((align.yaw + 90 * k + 180) % 360) + 360) % 360) - 180;
    const xLong = k % 2 === 0 ? d0[0] >= d0[1] : d0[1] >= d0[0];
    if (xLong && (!best || Math.abs(total) < best.abs)) best = { abs: Math.abs(total), k };
  }
  R = mul(rz(rad(90 * best.k + (align.nose_turned ? 180 : 0))), R);
  R = mul(ry(rad(align.refined_pitch_deg ?? 0)), mul(rz(rad(align.refined_yaw_deg ?? 0)), R));
  const { lo, hi } = ext(R);
  const cx = (lo[0] + hi[0]) / 2;
  const cy = (lo[1] + hi[1]) / 2;
  const rail = hi[2] - heightM / scale; // the prototype's height over the rail sets the rail plane
  const k = scale / tileM;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const N = glb.normals;
  for (let i = 0; i < n; i++) {
    const bx = P[i * 3];
    const by = -P[i * 3 + 2];
    const bz = P[i * 3 + 1];
    positions[i * 3] = (R[0][0] * bx + R[0][1] * by + R[0][2] * bz - cx) * k;
    positions[i * 3 + 1] = -(R[1][0] * bx + R[1][1] * by + R[1][2] * bz - cy) * k; // tile +y is Blender -Y
    positions[i * 3 + 2] = (R[2][0] * bx + R[2][1] * by + R[2][2] * bz - rail) * k;
    if (N) {
      const nx = N[i * 3];
      const ny = -N[i * 3 + 2];
      const nz = N[i * 3 + 1];
      normals[i * 3] = R[0][0] * nx + R[0][1] * ny + R[0][2] * nz;
      normals[i * 3 + 1] = -(R[1][0] * nx + R[1][1] * ny + R[1][2] * nz);
      normals[i * 3 + 2] = R[2][0] * nx + R[2][1] * ny + R[2][2] * nz;
    }
  }
  const dims = [(hi[0] - lo[0]) * k, (hi[1] - lo[1]) * k, (hi[2] - rail) * k];
  return { positions, normals, uvs: glb.uvs, indices: glb.indices, dims, yawStep: best.k, triangles: glb.indices.length / 3 };
}

export function makeGeometry(model) {
  return new Geometry({
    attributes: {
      aPosition: { buffer: model.positions, format: 'float32x3' },
      aNormal: { buffer: model.normals, format: 'float32x3' },
      aUV: { buffer: model.uvs, format: 'float32x2' },
    },
    // Uint16 when it fits: half the index memory, and WebGL1-safe
    indexBuffer: model.positions.length / 3 <= 65535 ? Uint16Array.from(model.indices) : model.indices,
  });
}

/** Model texture: linear + mipmaps (a 2048 px texture lands on ~100 screen px: nearest would sparkle). */
export function makeModelTexture(image, { filter = 'linear', mipmaps = true } = {}) {
  const source = new ImageSource({
    resource: image,
    alphaMode: 'no-premultiply-alpha',
    scaleMode: filter,
    autoGenerateMipmaps: mipmaps,
    mipmapFilter: 'linear',
    addressMode: 'clamp-to-edge',
    maxAnisotropy: 1,
  });
  return new Texture({ source });
}

// ---------------- shader ----------------
const VERT = /* glsl */ `#version 300 es
in vec3 aPosition; // model frame, tile lengths: x nose, y lateral (tile space), z up from the rail
in vec3 aNormal;
in vec2 aUV;

// Pixi's own 2D pipeline (set by the mesh pipe: groups 100 and 101)
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec2 uResolution;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;
uniform float uRound;

// per part
uniform mat3 uSeat;     // per-model correction that stands the model on its wheels: roll, pitch, yaw
uniform vec3 uSeatOffset; // ... and nose-ward, sideways, height shift (tile lengths), applied before the scale
uniform vec3 uScale;    // length, width, height multipliers (proportions as data)
uniform vec2 uYawPitch; // heading in tile space atan2(dy, dx); pitch, nose up positive
uniform vec2 uDepth;    // z = uDepth.x - nearness * uDepth.y
uniform vec3 uPivot;    // model-frame point that sits on the container's origin
uniform vec3 uIso;      // HALF_W, HALF_H, UP_PX

out vec2 vUV;
out vec3 vNormal;
out vec4 vColor;
out float vModelX;

vec2 roundPixels(vec2 position, vec2 targetSize) {
  return (floor(((position * 0.5 + 0.5) * targetSize) + 0.5) / targetSize) * 2.0 - 1.0;
}

void main(void) {
  float cp = cos(uYawPitch.y), sp = sin(uYawPitch.y);
  float cy = cos(uYawPitch.x), sy = sin(uYawPitch.x);

  vec3 p = (uSeat * aPosition + uSeatOffset - uPivot) * uScale;
  p = vec3(p.x * cp - p.z * sp, p.y, p.x * sp + p.z * cp);       // pitch about the lateral axis
  vec3 t = vec3(p.x * cy - p.y * sy, p.x * sy + p.y * cy, p.z);  // yaw about the vertical: tile dx, dy, dh

  vec3 n = (uSeat * aNormal) / uScale;                           // inverse transpose of the scale
  n = vec3(n.x * cp - n.z * sp, n.y, n.x * sp + n.z * cp);
  vNormal = vec3(n.x * cy - n.y * sy, n.x * sy + n.y * cy, n.z);

  // the game's isometric projection, in the container's local pixels
  vec2 local = vec2(uIso.x * (t.x - t.y), uIso.y * (t.x + t.y) - uIso.z * t.z);
  mat3 m = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  vec2 clip = (m * vec3(local, 1.0)).xy;
  if (uRound == 1.0) {
    // snap the origin, not each vertex: the body stays rigid
    vec2 o = (m * vec3(0.0, 0.0, 1.0)).xy;
    clip += roundPixels(o, uResolution) - o;
  }
  float nearness = ${(Math.cos(Math.PI / 6) / Math.SQRT2).toFixed(6)} * (t.x + t.y) + 0.5 * t.z;
  gl_Position = vec4(clip, uDepth.x - nearness * uDepth.y, 1.0);

  vUV = aUV;
  vModelX = aPosition.x;
  vColor = uColor * uWorldColorAlpha;
}
`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
in vec3 vNormal;
in vec4 vColor;
in float vModelX;

uniform sampler2D uTexture;
uniform vec3 uLight;  // towards the light, tile space
uniform vec2 uShade;  // ambient, light
uniform vec2 uClipX;  // keep model x inside [lo, hi]: one model cut into parts without new geometry

out vec4 finalColor;

void main(void) {
  if (vModelX < uClipX.x || vModelX > uClipX.y) discard;
  vec3 base = texture(uTexture, vUV).rgb;
  float lit = uShade.x + uShade.y * max(0.0, dot(normalize(vNormal), uLight));
  // the pipeline multiplies in linear light and writes sRGB ("Standard" view transform)
  vec3 lin = pow(base, vec3(2.2)) * lit;
  vec3 c = pow(clamp(lin, 0.0, 1.0), vec3(1.0 / 2.2));
  finalColor = vec4(c, 1.0) * vColor; // premultiplied: vColor is (rgb * a, a)
}
`;

export const trainProgram = GlProgram.from({ vertex: VERT, fragment: FRAG, name: 'train3d' });

/**
 * One Shader per drawn part (they share the compiled GlProgram). IMPORTANT: Pixi caches the
 * uniform sync function per GlProgram and generates it from the FIRST shader it sees, so every
 * Shader on this program must list its resources in the same order with the same kinds.
 */
export function makeTrainShader(texture, opts = {}) {
  return new Shader({
    glProgram: trainProgram,
    resources: {
      uTexture: texture.source,
      part: {
        uSeat: { value: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), type: 'mat3x3<f32>' }, // column-major
        uSeatOffset: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
        uScale: { value: new Float32Array(opts.scale ?? [1, 1, 1]), type: 'vec3<f32>' },
        uYawPitch: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
        uDepth: { value: new Float32Array([0, 0.25]), type: 'vec2<f32>' },
        uPivot: { value: new Float32Array(opts.pivot ?? [0, 0, 0]), type: 'vec3<f32>' },
        uIso: { value: new Float32Array([HALF_W, HALF_H, UP_PX]), type: 'vec3<f32>' },
        uLight: { value: lightInTileSpace(opts.lightCam), type: 'vec3<f32>' },
        uShade: { value: new Float32Array(opts.shade ?? [0.8, 0.4]), type: 'vec2<f32>' },
        uClipX: { value: new Float32Array(opts.clipX ?? [-1e6, 1e6]), type: 'vec2<f32>' },
      },
    },
  });
}

/**
 * The seat correction as data: degrees of pitch (nose up), roll (about the long axis), yaw (about the
 * vertical), written into the shader's column-major mat3; offset = [along, sideways, up] in tile lengths.
 */
export function setSeat(uniforms, { pitchDeg = 0, rollDeg = 0, yawDeg = 0, offset = [0, 0, 0] } = {}) {
  const P = [[Math.cos(rad(pitchDeg)), 0, -Math.sin(rad(pitchDeg))], [0, 1, 0], [Math.sin(rad(pitchDeg)), 0, Math.cos(rad(pitchDeg))]];
  const M = mul(rz(rad(yawDeg)), mul(P, rx(rad(rollDeg))));
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) uniforms.uSeat[c * 3 + r] = M[r][c];
  uniforms.uSeatOffset.set(offset);
}

/** Depth test + depth write + back-face culling; glTF front faces are counter-clockwise. */
export function makeTrainState() {
  const state = State.for2d(); // blend on (premultiplied "normal"), depth off
  state.depthTest = true;
  state.depthMask = true;
  state.cullMode = 'back';
  return state;
}

/** Depth mapping for the main screen: one scale for the whole map, so meshes sort against each other. */
export const NEAR_MAX = nearOf(512, 512, 8);
export const SCREEN_DEPTH_SCALE = 2 / NEAR_MAX;
export function screenDepth(tx, ty, h = 0) {
  return 1 - nearOf(tx, ty, h) * SCREEN_DEPTH_SCALE;
}

/**
 * A Mesh for the normal display list. Position it like a sprite (container x/y = the world pixel
 * of the part's rail point); `setPose` gives heading, pitch and the tile position the depth needs.
 */
export function makeTrainMesh(geometry, texture, opts = {}) {
  const shader = makeTrainShader(texture, opts);
  const mesh = new Mesh({ geometry, shader, state: makeTrainState() });
  const u = shader.resources.part.uniforms;
  // Mesh bounds come from aPosition's first two floats (model units), useless on screen: give the
  // culler a local pixel rectangle instead (a body up to ~3 tiles long, 1 tile high).
  mesh.cullArea = new Rectangle(-112, -96, 224, 160);
  mesh.setPose = (tx, ty, heading, pitch = 0, h = 0) => {
    u.uYawPitch[0] = heading;
    u.uYawPitch[1] = pitch;
    u.uDepth[0] = screenDepth(tx, ty, h);
    u.uDepth[1] = SCREEN_DEPTH_SCALE;
    const w = tileToWorld(tx, ty);
    mesh.position.set(w.x, w.y - h * UP_PX);
  };
  mesh.uniforms = u;
  return mesh;
}

export async function loadTrainModel(url, meta, { heightM = 4.01, tileM = 6.235064799811727, textureUrl } = {}) {
  const glb = await loadGLB(url);
  if (glb.hasNodeTransform) console.warn('GLB node transform ignored by the minimal reader');
  const t0 = performance.now();
  const model = alignModel(glb, { align: meta.align, scale: meta.scale, heightM, tileM });
  model.alignMs = performance.now() - t0;
  let image = glb.image;
  if (textureUrl || !image) {
    const blob = await (await fetch(textureUrl)).blob();
    image = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  }
  model.image = image;
  model.timing = glb.timing;
  return model;
}
