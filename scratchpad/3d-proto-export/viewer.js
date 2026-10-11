// Draws an exported locomotive GLB from the game camera with plain WebGL2 (no dependencies), at the
// pixel size and anchor of the Blender reference renders, so the two can be compared pixel for pixel.
//   index.html?id=black_five&dir=data/black_five
//     &cull=1        back-face culling on (the mirrored half is drawn with the winding flipped)
//     &pitch=3       the whole vehicle pitched 3 degrees nose up (a slope), about the rail under its middle
//     &fitx=0.6      every part's length factor replaced (the length is data, not a re-render)
//     &round=1       wheel nodes keep their height scale along the track too: round wheels under a short body
//     &spin=40       wheel nodes turned by 40 degrees about their axles
//     &onrails=1     wheel nodes moved across onto the rails, whatever the body's width
//     &ss=1          draw at 1 device pixel per pixel (256 px per tile, no anti-aliasing: the game on a 1x display)
//     &rails=1       the rails drawn under the vehicle (0.16 tile either side, scaled by the manifest's gauge)
import { parseGlb, glbImage } from './glb.js';

const q = new URLSearchParams(location.search);
const id = q.get('id') ?? 'black_five';
const dir = q.get('dir') ?? `data/${id}`;
const cull = q.get('cull') === '1';
const pitchDeg = Number(q.get('pitch') ?? 0);
const fitX = q.get('fitx') ? Number(q.get('fitx')) : null;
const roundWheels = q.get('round') === '1';
const spinDeg = Number(q.get('spin') ?? 0);
const rails = q.get('rails') === '1';
const onRails = q.get('onrails') === '1';

const VS = `#version 300 es
in vec3 aPos; in vec3 aNormal; in vec2 aUv;
uniform mat4 uModel;     // quantized position -> world metres (glTF axes: x along the track at heading 0, y up)
uniform mat3 uNormal;    // inverse transpose of uModel's 3x3
uniform vec3 uRight, uUp, uBack; uniform vec3 uView; // px per m, anchor x, anchor y
uniform vec2 uSize;
out vec3 vN; out vec2 vUv;
void main() {
  vec3 w = (uModel * vec4(aPos, 1.0)).xyz;
  vN = uNormal * aNormal;
  vUv = aUv;
  float px = uView.y + dot(w, uRight) * uView.x;
  float py = uView.z - dot(w, uUp) * uView.x;
  gl_Position = vec4(px / uSize.x * 2.0 - 1.0, 1.0 - py / uSize.y * 2.0, -dot(w, uBack) / 200.0, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
in vec3 vN; in vec2 vUv;
uniform sampler2D uTex; uniform vec3 uLight; uniform vec2 uShade; // ambient, light
out vec4 o;
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  float f = uShade.x + uShade.y * max(0.0, dot(normalize(vN), uLight));
  o = vec4(toSrgb(clamp(toLinear(texture(uTex, vUv).rgb) * f, 0.0, 1.0)), 1.0);
}`;

function program(gl) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, VS));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

// 4x4 matrices, column-major
const mul = (a, b) => {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
};
const translate = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
const scale = (x, y, z) => new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);
const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); };
const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); };
const normalMatrix = (m) => { // inverse transpose of the upper 3x3 (cofactors; the determinant's sign kept)
  const [a, b, c, , d, e, f, , g, h, i] = m;
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  const s = 1 / det;
  return new Float32Array([(e * i - f * h) * s, (c * h - b * i) * s, (b * f - c * e) * s, (f * g - d * i) * s, (a * i - c * g) * s, (c * d - a * f) * s, (d * h - e * g) * s, (b * g - a * h) * s, (a * e - b * d) * s]);
};
const toGltf = (v) => [v[0], v[2], -v[1]]; // Blender (x, y, z up) -> glTF (x, y up, z)
const norm = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };

async function main() {
  const t0 = performance.now();
  const buf = await (await fetch(`${dir}/${id}.glb`)).arrayBuffer();
  const glb = parseGlb(buf);
  const tParse = performance.now() - t0;
  const bitmap = await glbImage(glb);
  const man = glb.manifest;
  const report = await (await fetch(`${dir}/view.json`)).json(); // { yaws, size, anchor, ss, px_per_tile, hi, low }
  const ss = Number(q.get('ss') ?? report.ss); // device pixels per reference pixel (the references are rendered at 2)
  const [W, H] = [report.size[0] * ss, report.size[1] * ss];
  const k = (report.px_per_tile * ss) / (man.tile_m * Math.SQRT2);
  const c45 = Math.SQRT1_2, s60 = Math.sin(Math.PI / 3), c60 = 0.5;
  // the game camera (elevation 30, azimuth 45) as Blender has it, in glTF axes
  const right = toGltf([c45, c45, 0]);
  const up = toGltf([-c45 * c60, c45 * c60, s60]);
  const back = toGltf([c45 * s60, -c45 * s60, c60]);
  const light = norm(toGltf(man.shading.light_world_blender));
  const parts = Object.fromEntries(man.parts.map((p) => [p.node, p]));
  const stats = { id, bytes: buf.byteLength, parseMs: +tParse.toFixed(2), tris: 0, verts: 0, draws: 0, frames: [] };

  const glCanvas = document.createElement('canvas');
  glCanvas.width = W; glCanvas.height = H;
  glCanvas.addEventListener('webglcontextlost', () => { window.failed = 'WebGL context lost'; });
  const gl = glCanvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, depth: true });
  if (!gl) throw new Error('no WebGL2');
  const prog = program(gl);
  gl.useProgram(prog);
  const U = (n) => gl.getUniformLocation(prog, n);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // one vertex array per mesh (a mirrored part draws the same buffers again)
  const vaos = new Map();
  for (const p of glb.parts) {
    if (vaos.has(p.mesh)) continue;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const attr = (name, data, size, type, normalized, stride) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, type, normalized, stride * data.BYTES_PER_ELEMENT, 0);
    };
    attr('aPos', p.positions, 3, gl.UNSIGNED_SHORT, false, p.positionStride);
    attr('aNormal', p.normals, 3, gl.BYTE, true, p.normalStride);
    attr('aUv', p.uvs, 2, gl.UNSIGNED_SHORT, true, p.uvStride);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, p.indices, gl.STATIC_DRAW);
    vaos.set(p.mesh, vao);
  }
  gl.uniform3fv(U('uRight'), right); gl.uniform3fv(U('uUp'), up); gl.uniform3fv(U('uBack'), back);
  gl.uniform3f(U('uView'), k, report.anchor[0] * ss, report.anchor[1] * ss);
  gl.uniform2f(U('uSize'), W, H);
  gl.uniform3fv(U('uLight'), light);
  gl.uniform2f(U('uShade'), man.shading.ambient, man.shading.light);
  gl.uniform1i(U('uTex'), 0);

  // every part's matrix: heading * pitch * place on the track * the part's scale (* wheel) * the file's node
  const bodies = man.parts.filter((p) => p.kind === 'body');
  const fx = (p) => fitX ?? p.fit[0];
  // the bodies end to end again when the length factor is overridden
  const lengths = bodies.map((p) => (fitX ? (p.bounds_m[1][0] - p.bounds_m[0][0]) * fitX + 0.4 : (p.slot_tiles ?? 0) * man.tile_m));
  const total = lengths.reduce((a, c) => a + c, 0);
  const placeOf = {};
  let acc = 0;
  bodies.forEach((p, i) => { placeOf[p.node] = fitX ? total / 2 - (acc + lengths[i] / 2) : p.place_m; acc += lengths[i]; });

  const draw = (yaw) => {
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    if (cull) gl.enable(gl.CULL_FACE);
    // Blender yaw about +Z is the same angle about glTF +Y; pitch is about the vehicle's own z (across)
    const turn = mul(rotY((yaw * Math.PI) / 180), rotZ((pitchDeg * Math.PI) / 180));
    const t1 = performance.now();
    let tris = 0, verts = 0, draws = 0;
    for (const p of glb.parts) {
      const part = parts[p.name.replace(/\.mirror$/, '')];
      const body = part.of && parts[part.of]?.kind === 'body' ? parts[part.of] : part;
      // fit is (along, across, up) in Blender's axes -> glTF (x, up, across)
      let local = scale(fx(part), part.fit[2], part.fit[1]);
      if (part.kind === 'wheel') {
        const piv = toGltf(part.pivot_m);
        const s = roundWheels ? scale(part.fit[2], part.fit[2], part.fit[1]) : local;
        // the axle keeps its place along the shortened body; the wheel turns about it before it is scaled
        // &onrails=1: the wheel moved across until its tread stands on the rail (the stored half is the
        // glTF +z side; its mirror goes the other way)
        const tread = parts[part.of]?.stance?.tread?.y_m;
        const halfRail = 0.16 * man.tile_m * ((man.gauge?.half_rail_centres_m ?? 0.7525) / 0.7525);
        const out = onRails && tread ? (halfRail - tread * part.fit[1]) * (p.mirror ? -1 : 1) : 0;
        local = mul(translate(piv[0] * fx(part), piv[1] * part.fit[2], piv[2] * part.fit[1] + out), mul(s, rotZ((-spinDeg * Math.PI) / 180)));
      }
      const model = mul(turn, mul(translate(placeOf[body.node] ?? body.place_m, 0, 0), mul(local, p.matrix)));
      gl.uniformMatrix4fv(U('uModel'), false, model);
      gl.uniformMatrix3fv(U('uNormal'), false, normalMatrix(model));
      if (cull) gl.frontFace(p.mirror ? gl.CW : gl.CCW);
      gl.bindVertexArray(vaos.get(p.mesh));
      gl.drawElements(gl.TRIANGLES, p.indexCount, p.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
      tris += p.indexCount / 3; verts += p.vertexCount; draws++;
    }
    gl.finish();
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    stats.frames.push(+(performance.now() - t1).toFixed(2));
    Object.assign(stats, { tris, verts, draws, glError: gl.getError() });
    return px;
  };

  for (const yaw of report.yaws) {
    const px = draw(yaw);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H; canvas.dataset.yaw = yaw;
    canvas.style.width = `${W / ss}px`;
    const img = new ImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    const ctx = canvas.getContext('2d');
    ctx.putImageData(img, 0, 0);
    if (rails) {
      // rails and sleepers on the plane z = 0, under what was drawn
      ctx.globalCompositeOperation = 'destination-over';
      const a = (yaw * Math.PI) / 180, b = (pitchDeg * Math.PI) / 180;
      const P = (x, z) => { // track coordinates (along, across) -> pixel
        const w = [Math.cos(a) * Math.cos(b) * x + Math.sin(a) * z, Math.sin(b) * x, -Math.sin(a) * Math.cos(b) * x + Math.cos(a) * z];
        const d = (v) => w[0] * v[0] + w[1] * v[1] + w[2] * v[2];
        return [report.anchor[0] * ss + d(right) * k, report.anchor[1] * ss - d(up) * k];
      };
      const half = 0.16 * man.tile_m * ((man.gauge?.half_rail_centres_m ?? 0.7525) / 0.7525);
      const L = total / 2 + 1.5;
      ctx.strokeStyle = '#d8d8d8'; ctx.lineWidth = 1.5 * ss;
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(...P(-L, s * half)); ctx.lineTo(...P(L, s * half)); ctx.stroke(); }
      ctx.strokeStyle = '#5b4a3a'; ctx.lineWidth = 2 * ss;
      for (let x = -L; x <= L; x += 0.7) { ctx.beginPath(); ctx.moveTo(...P(x, -half * 1.45)); ctx.lineTo(...P(x, half * 1.45)); ctx.stroke(); }
    }
    const row = document.createElement('div');
    row.className = 'row';
    const ref = (src, label) => {
      const f = document.createElement('figure');
      const im = new Image();
      im.src = `${dir}/${src}`;
      im.style.width = `${W / ss}px`;
      f.append(im, Object.assign(document.createElement('figcaption'), { textContent: label }));
      return f;
    };
    const f = document.createElement('figure');
    f.append(canvas, Object.assign(document.createElement('figcaption'), { textContent: `WebGL2, this GLB, heading ${yaw}` }));
    const i = report.yaws.indexOf(yaw);
    row.append(ref(report.hi[i], 'Blender: the pipeline model, stood on its wheels'), f, ref(report.low[i], 'Blender: this GLB re-imported'));
    if (report.raw) row.append(ref(report.raw[i], 'Blender: the pipeline model as the sprites show it'));
    document.body.append(row);
  }
  document.getElementById('info').textContent = `${id}: ${stats.bytes} bytes, parsed in ${stats.parseMs} ms, ${stats.tris} triangles, ${stats.verts} vertices, ${stats.draws} draw calls; texture ${bitmap.width}x${bitmap.height} ${glb.image.mimeType}`;
  window.stats = stats;
  window.done = true;
}
main().catch((e) => { document.getElementById('info').textContent = String(e.stack ?? e); window.failed = String(e.stack ?? e); });
