// Scratch: what a 3D locomotive part has to plug into. The real game with a train over a hill and
// round a curve, a station and trees beside the line, and a stand-in "3D part" (a shaded box) put
// where the engine is, two ways: a depth-tested Mesh straight in the object layer, and a Sprite
// showing a RenderTexture the same Mesh was rendered into.
//   ?sprites=B&ladder=B   the pipeline's sprite set (as in curve-sizes/lineup)
//   qa.frame(progress, zoom)   head `progress` tiles along its run, camera on the engine
//   qa.dump()                  everything the renderer has for each vehicle part this frame
//   qa.objects()               the depth-sorted object layer: who is in it and in what order
//   qa.standin(mode)           'mesh' | 'rt' | 'off'
import { Game } from '/src/game.ts';
import { emptyMap } from '/src/world/mapgen.ts';
import { levelFromMap } from '/src/world/level.ts';
import { Train } from '/src/sim/trains.ts';
import { content } from '/src/data/content.ts';
import { tileToWorld, depthKey } from '/src/engine/iso.ts';
import { findPath } from '/src/world/pathfinding.ts';
import { vehicleSpec, facingOf, DRAWN_FACINGS, residualRotation, ROTATION_SHARE } from '/src/sim/body.ts';
import { vehiclePreview, spriteDataUrl, frameForItem } from '/src/ui/spritePreview.ts';
import { locoFrame } from '/src/art/frames.ts';
import { TILE_SIDE_PX } from '/src/render/terrainRelief.ts';
import { Mesh, Geometry, Shader, GlProgram, State, Sprite, RenderTexture, Rectangle, Container, Texture, Matrix, RenderTarget } from 'pixi.js';

const params = new URLSearchParams(location.search);
const LOCO = params.get('loco') ?? 'black_five';
const WAGONS = (params.get('wagons') ?? 'pullman,steel_hopper').split(',').filter(Boolean);

// a hill across the x line: 0 0 … 1 2 2 … 2 1 0
const HILL = [50, 36, 58, 44];
const map = emptyMap(7412, 112, 112);
for (let y = HILL[1]; y <= HILL[3]; y++) for (let x = HILL[0]; x <= HILL[2]; x++) map.terrain[y * map.w + x] = 2;
const level = levelFromMap(map, '3D integration');
const g = new Game({ kind: 'level', seed: 7412, level });
window.game = g;
await g.init();
g.loop.stop();
g.app.ticker.stop();
g.closeMenus();
g.settings.autosave = false;
g.settings.weather = false;
g.settings.dayNight = false;
g.settings.smoke = false;
g.clock.setSpeed(0);
g.builder.free = true;
for (let i = 0; i < g.regions.unlocked.length; i++) g.regions.own(i);
g.world.rebuildFog();
const SPRITE_SET = params.get('sprites');
const PIPE = SPRITE_SET ? (await (await fetch('/assets/rolling-' + SPRITE_SET + '.json')).json()).frames : {};
if (SPRITE_SET)
  for (const d of content.locomotives)
    if (d.gear && d.gear.parts.every((p) => `rolling/loco_${d.id}_${p.part}_f0` in PIPE)) d.spriteGear = true;

// the line: along +x over the hill, a curve to +y, then along +y
const Y0 = 40, XA = 36, XC = 66, YB = 62;
for (let y = 30; y < 70; y++)
  for (let x = 30; x < 76; x++) {
    const i = y * g.map.w + x;
    if (g.map.props.has(i)) {
      g.map.props.delete(i);
      g.world.removeProps(x, y);
    }
  }
const want = [1, 3];
for (let x = XA; x < XC; x++) {
  let ok = false;
  for (const r of [0, 1]) {
    if (!g.builder.placeTrackKind(x, Y0, 'straight', r)) continue;
    if (want.every((d) => g.track.get(x, Y0).links[0].includes(d))) {
      ok = true;
      break;
    }
    g.builder.removeTrack(x, Y0);
  }
  if (!ok) throw new Error('no track at ' + x);
}
for (const q of g.track.place(XC, Y0, 'curve', 2, 'regular')) g.onTrackChanged(q.x, q.y);
for (let y = Y0 + 2; y <= YB; y++) for (const q of g.track.place(XC + 1, y, 'straight', 0, 'regular')) g.onTrackChanged(q.x, q.y);
for (const k of [...g.builder.decor.keys()]) g.builder.removeDecor(k % g.map.w, Math.floor(k / g.map.w));

// scenery either side of the level stretch at x = 44..47: a building and a tree behind the line
// (smaller x + y) and in front of it (larger x + y)
const tree = g.atlas.keys('props/').find((k) => /tree|pine|oak|birch/.test(k)) ?? g.atlas.keys('props/')[0];
const scenery = [
  ['probe:far-house', 45, Y0 - 1, 'structures/station_1', 20],
  ['probe:near-house', 45, Y0 + 1, 'structures/station_1', 20],
  ['probe:far-tree', 47, Y0 - 1, tree, 10],
  ['probe:near-tree', 47, Y0 + 1, tree, 10],
];
for (const [id, x, y, frame, layer] of scenery) g.world.setStructure(id, x, y, frame, layer);

let now = 100;
const def = content.locomotives.find((d) => d.id === LOCO);
const t = new Train([{ uid: 87001, def, level: 0 }], 'Probe', 87001);
for (const l of t.locos) l.inCab = true;
t.wagons = WAGONS.map((id, i) => {
  const w = content.wagons.find((d) => d.id === id);
  const mineral = w.carries === 'mineral';
  return { uid: 87101 + i, def: w, level: 0, cargo: mineral ? 'coal' : null, amount: mineral ? 10 : 0 };
});
const SX = XA + 7;
if (!t.spawnAt(g.track, SX, Y0, 3)) throw new Error('spawn failed');
const route = findPath(g.track, { x: SX, y: Y0, in: 3 }, (x, y) => x === XC + 1 && y === YB, 1e6, undefined, () => true);
if (!route) throw new Error('no route');
g.track.resolveRoutes(route);
t.coal = t.coalCap;
t.water = t.waterCap;
t.oil = t.oilCap;
t.battery = t.batteryCap;
t.fuelProblem = () => null;
t.wireCeiling = () => null;
t.refreshModes = () => {
  for (const l of t.locos) l.engaged = true;
};
g.fleet.trains = [t];
t.setPath(route.map((s) => ({ ...s })), g.map, g.track);
t.trackVersion = g.track.version;
t.nextFuelCheck = Infinity;
t.setState('moving');

function draw() {
  g.render(1, 0);
  if (standin.mode !== 'off') placeStandin();
  g.app.renderer.render(g.app.stage);
}
function frame(progress, zoom = 3, part = 0) {
  let k = 0;
  while (t.pathProgress < progress && t.state === 'moving' && k++ < 40000) g.fleet.tick(1 / 60, (now += 1 / 60));
  const p = t.vehiclePoses[0].segments[part] ?? t.vehiclePoses[0].segments[0];
  const at = tileToWorld(p.x, p.y);
  g.camera.centerOn(at.x, at.y + g.world.railAt(p.x, p.y).dz - 10);
  g.camera.zoom = zoom;
  draw();
  return { progress: t.pathProgress, state: t.state, steps: k };
}
function settled() {
  g.render(1, 0);
  return g.world.landscape.ready;
}

// ------------------------------------------------------------------ (a) data per part
const round = (v, n = 4) => (typeof v === 'number' ? Math.round(v * 10 ** n) / 10 ** n : v);
function dump() {
  const cars = g.trainRenderer.cars.get(t.id);
  return {
    reversed: t.reversed,
    speed: t.speed,
    samePoseObjects: t.vehiclePoses.map((v, i) => v === t.prevVehiclePoses[i]),
    vehicles: t.vehiclePoses.map((v, i) => {
      const isLoco = i < t.locos.length;
      const d = isLoco ? t.locos[i].def : t.wagons[i - t.locos.length].def;
      const spec = t.vehicleSpecs[i];
      return {
        id: d.id,
        isLoco,
        spec: { L: spec.L, size: spec.size, plan: spec.plan, drawBogies: spec.drawBogies },
        centre: { x: round(v.x), y: round(v.y), heading: round(v.heading) },
        segments: v.segments.map((s, si) => {
          const prev = t.prevVehiclePoses[i]?.segments[si];
          const sprite = cars[i].parts[si];
          const rail = g.world.railAt(s.x, s.y);
          const body = g.trainRenderer.bodyGround(s, prev, 1, s.x, s.y);
          const shown = s.angle + (t.reversed ? Math.PI : 0) + (s.mirror ? Math.PI : 0);
          const f = facingOf(shown);
          const along = body.sgx * Math.cos(shown) + body.sgy * Math.sin(shown);
          return {
            part: s.part,
            spec: spec.segments[si],
            pose: { x: round(s.x), y: round(s.y), angle: round(s.angle), L: s.L, mirror: s.mirror, delta: round(s.delta), residualGap: round(s.residualGap), wheelGap: round(s.wheelGap) },
            bogies: s.bogies.map((b) => ({ x: round(b.drawX), y: round(b.drawY), angle: round(b.angle), kind: b.kind, hidden: !!b.hidden, foreAft: round(b.foreAft), lateral: round(b.lateral) })),
            railUnderCentre: { dz: round(rail.dz, 2), sgx: round(rail.sgx, 2), sgy: round(rail.sgy, 2) },
            bodyGround: { dz: round(body.dz, 2), sgx: round(body.sgx, 2), sgy: round(body.sgy, 2) },
            // what a 3D part needs instead of the shear: height in tiles and pitch in degrees
            heightTiles: round(-body.dz / TILE_SIDE_PX),
            pitchDeg: round((Math.atan2(-along, TILE_SIDE_PX) * 180) / Math.PI, 2),
            sprite: {
              facing: f,
              mirrored: !DRAWN_FACINGS.has(f),
              residualDeg: round((residualRotation(shown, f) * 180) / Math.PI, 2),
              appliedDeg: round((residualRotation(shown, f) * ROTATION_SHARE * 180) / Math.PI, 2),
              x: sprite.x,
              y: round(sprite.y, 2),
              zIndex: round(sprite.zIndex, 2),
              scaleX: sprite.scale.x,
              rotation: round(sprite.rotation),
              skew: [round(sprite.skew.x), round(sprite.skew.y)],
              visible: sprite.visible,
              tint: sprite.tint.toString(16),
              texel: sprite.texture.frame.width + 'x' + sprite.texture.frame.height,
              logical: sprite.texture.width + 'x' + sprite.texture.height,
              windowLight: g.trainRenderer.windowLights.has(sprite) && g.trainRenderer.windowLights.get(sprite).visible,
            },
          };
        }),
        bogieSprites: cars[i].bogies.map((b) => ({ visible: b.visible, zIndex: round(b.zIndex, 2) })),
        load: cars[i].load ? { visible: cars[i].load.visible, zIndex: round(cars[i].load.zIndex, 2), tint: cars[i].load.tint.toString(16) } : null,
      };
    }),
  };
}

// ------------------------------------------------------------------ (b) the object layer
function objects() {
  const layer = g.world.objects;
  layer.sortChildren();
  const kinds = {};
  for (const c of layer.children) {
    const k = c.label === 'emissive' ? 'emissive' : c.constructor.name;
    kinds[k] = (kinds[k] ?? 0) + 1;
  }
  const cars = g.trainRenderer.cars.get(t.id);
  const mine = new Map();
  cars.forEach((c, i) => {
    c.parts.forEach((s, k) => mine.set(s, `train car${i} part${k}`));
    mine.set(c.undercarriage, `train car${i} undercarriage(${c.bogies.length} bogies)`);
    if (c.load) mine.set(c.load, `train car${i} load`);
  });
  for (const [s, l] of g.trainRenderer.windowLights) mine.set(l, 'train window light');
  for (const [id] of scenery) mine.set(g.world.getStructure(id), id);
  if (standin.mesh) mine.set(standin.mesh, 'STANDIN mesh');
  if (standin.sprite) mine.set(standin.sprite, 'STANDIN rt sprite');
  const order = layer.children.filter((c) => mine.has(c)).map((c) => ({ who: mine.get(c), zIndex: round(c.zIndex, 2), visible: c.visible, culled: c.culled }));
  return {
    children: layer.children.length,
    kinds,
    sortableChildren: layer.sortableChildren,
    cullableChildren: layer.cullableChildren,
    isRenderGroup: layer.isRenderGroup,
    rootIsRenderGroup: g.world.root.isRenderGroup,
    stageLayers: g.world.root.children.map((c) => `${c.constructor.name}(${c.children?.length ?? 0})`),
    order,
  };
}

// ------------------------------------------------------------------ stand-in 3D part
// A box L x W x H tiles in body space (x forward, y left, z up), bottom on the rail.
function boxGeometry(L, W, H) {
  const x = L / 2, y = W / 2;
  const faces = [
    // corners (counter-clockwise seen from outside), colour
    [[x, -y, 0], [x, y, 0], [x, y, H], [x, -y, H], [0.9, 0.25, 0.2]], // front: red
    [[-x, y, 0], [-x, -y, 0], [-x, -y, H], [-x, y, H], [0.2, 0.3, 0.8]], // rear: blue
    [[x, y, 0], [-x, y, 0], [-x, y, H], [x, y, H], [0.85, 0.8, 0.3]], // left (+y): yellow
    [[-x, -y, 0], [x, -y, 0], [x, -y, H], [-x, -y, H], [0.3, 0.7, 0.35]], // right (-y): green
    [[-x, -y, H], [x, -y, H], [x, y, H], [-x, y, H], [0.9, 0.9, 0.9]], // roof: white
  ];
  // a chimney near the front, so the nose end and self-occlusion show
  const c = [x * 0.6, 0, H], r = W * 0.22, ch = H * 0.5;
  const ring = [[c[0] - r, c[1] - r], [c[0] + r, c[1] - r], [c[0] + r, c[1] + r], [c[0] - r, c[1] + r]];
  for (let i = 0; i < 4; i++) {
    const a = ring[i], b = ring[(i + 1) % 4];
    faces.push([[a[0], a[1], H], [b[0], b[1], H], [b[0], b[1], H + ch], [a[0], a[1], H + ch], [0.15 + 0.1 * i, 0.15, 0.15]]);
  }
  const pos = [], col = [], idx = [];
  for (const f of faces) {
    const n = pos.length / 3;
    for (let k = 0; k < 4; k++) pos.push(...f[k]), col.push(...f[4]);
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
  }
  return new Geometry({
    attributes: { aPosition: { buffer: new Float32Array(pos), size: 3 }, aColor: { buffer: new Float32Array(col), size: 3 } },
    indexBuffer: new Uint16Array(idx),
  });
}
const vertex = `
  in vec3 aPosition;
  in vec3 aColor;
  out vec3 vColor;
  out float vAlong;
  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;
  uniform mat3 uModel;
  uniform float uSidePx;
  uniform float uNear0;
  uniform float uDepthScale;
  void main() {
    vec3 p = uModel * aPosition;                       // tile units: x, y on the ground, z up
    vec2 s = vec2((p.x - p.y) * 32.0, (p.x + p.y) * 16.0 - p.z * uSidePx);
    vec3 clip = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(s, 1.0);
    float near = (p.x + p.y) * 0.6124 + p.z * 0.5;      // towards the camera (elev 30, az 45)
    gl_Position = vec4(clip.xy, 0.9 - (uNear0 + near) * uDepthScale, 1.0);
    vColor = aColor;
    vAlong = aPosition.x;
  }`;
const fragment = `
  in vec3 vColor;
  in float vAlong;
  uniform vec4 uColor;
  uniform vec2 uClip;
  void main() {
    if (vAlong < uClip.x || vAlong >= uClip.y) discard;   // one slice of the part along its length
    gl_FragColor = vec4(vColor, 1.0) * uColor;
  }`;
function makeMesh(L, W, H, depth = true) {
  const shader = Shader.from({
    gl: { vertex, fragment },
    resources: { model: { uModel: { value: new Float32Array(9), type: 'mat3x3<f32>' }, uSidePx: { value: TILE_SIDE_PX, type: 'f32' }, uNear0: { value: 0, type: 'f32' }, uDepthScale: { value: 0.1, type: 'f32' }, uClip: { value: new Float32Array([-1e6, 1e6]), type: 'vec2<f32>' } } },
  });
  const state = State.for2d();
  state.depthTest = depth;
  state.depthMask = depth;
  state.culling = false;
  const mesh = new Mesh({ geometry: boxGeometry(L, W, H), shader, state });
  // the geometry's own bounds are model space; give the culler the screen box of the part
  const r = Math.hypot(L, W) / 2;
  mesh.cullArea = null;
  mesh.boundsArea = new Rectangle(-r * 64, -r * 32 - H * 1.5 * TILE_SIDE_PX, r * 128, r * 64 + H * 1.5 * TILE_SIDE_PX);
  mesh.cullable = true;
  return mesh;
}
/** Body axes in tile space for a heading and a pitch (nose up positive), column-major mat3. */
function modelMatrix(heading, pitch) {
  const c = Math.cos(heading), s = Math.sin(heading), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // forward = (c cp, s cp, sp), left = (-s, c, 0) -> tile +y is "right" on a y-down map; up = forward x left
  return new Float32Array([c * cp, s * cp, sp, -s, c, 0, -c * sp, -s * sp, cp]);
}
const standin = { mode: 'off', mesh: null, sprite: null, rt: null, rtMesh: null, part: 0, hideSprite: true, log: [] };
function placeStandin() {
  const seg = t.vehiclePoses[0].segments[standin.part];
  const spec = t.vehicleSpecs[0].segments[standin.part];
  const cars = g.trainRenderer.cars.get(t.id);
  const sprite = cars[0].parts[standin.part];
  const body = g.trainRenderer.bodyGround(seg, undefined, 1, seg.x, seg.y);
  const shown = seg.angle + (t.reversed ? Math.PI : 0) + (seg.mirror ? Math.PI : 0);
  const along = body.sgx * Math.cos(shown) + body.sgy * Math.sin(shown);
  const pitch = Math.atan2(-along, TILE_SIDE_PX);
  const wp = tileToWorld(seg.x, seg.y);
  const L = spec.L, W = 0.32 * 1.3, H = 0.42;
  sprite.renderable = !standin.hideSprite;
  if (standin.mode === 'mesh') {
    if (!standin.mesh) {
      standin.mesh = makeMesh(L, W, H);
      g.world.objects.addChild(standin.mesh);
    }
    const m = standin.mesh;
    m.shader.resources.model.uniforms.uModel = modelMatrix(shown, pitch);
    m.position.set(wp.x, wp.y + body.dz);
    m.zIndex = depthKey(seg.x, seg.y, 15);
    m.tint = sprite.tint;
    m.visible = true;
    if (standin.sprite) standin.sprite.visible = false;
  } else if (standin.mode === 'rt') {
    const res = Math.min(4, Math.max(1, Math.ceil(g.camera.zoom * g.app.renderer.resolution)));
    const size = Math.ceil(Math.hypot(L, W) * 64) + 8, h = Math.ceil(size / 2 + H * 1.6 * TILE_SIDE_PX) + 8;
    if (!standin.rt || standin.rt.source.resolution !== res || standin.rt.width !== size) {
      standin.rt?.destroy(true);
      standin.rt = RenderTexture.create({ width: size, height: h, resolution: res, antialias: false });
      standin.target = new RenderTarget({ colorTextures: [standin.rt], depth: true, stencil: true });
      standin.log.push(`rt ${size}x${h} @${res}`);
    }
    if (!standin.rtMesh) {
      standin.rtMesh = makeMesh(L, W, H);
      standin.rtHolder = new Container();
      standin.rtHolder.addChild(standin.rtMesh);
    }
    const key = `${shown.toFixed(4)}|${pitch.toFixed(4)}|${res}`;
    if (key !== standin.key) {
      standin.key = key;
      standin.renders = (standin.renders ?? 0) + 1;
      standin.rtMesh.shader.resources.model.uniforms.uModel = modelMatrix(shown, pitch);
      standin.rtMesh.position.set(size / 2, h - size / 4 - 4);
      g.app.renderer.render({ container: standin.rtHolder, target: standin.target, clear: true, clearColor: [0, 0, 0, 0] });
    }
    if (!standin.sprite) {
      standin.sprite = new Sprite({ texture: standin.rt, cullable: true });
      g.world.objects.addChild(standin.sprite);
    }
    const s = standin.sprite;
    s.texture = standin.rt;
    s.anchor.set(0.5, (h - size / 4 - 4) / h);
    s.position.set(Math.round(wp.x), Math.round(wp.y) + body.dz);
    s.zIndex = depthKey(seg.x, seg.y, 15);
    s.tint = sprite.tint;
    s.visible = true;
    if (standin.mesh) standin.mesh.visible = false;
  }
}
function setStandin(mode, part = 0, hideSprite = true) {
  standin.mode = mode;
  standin.part = part;
  standin.hideSprite = hideSprite;
  if (mode === 'off') {
    if (standin.mesh) standin.mesh.visible = false;
    if (standin.sprite) standin.sprite.visible = false;
    for (const c of g.trainRenderer.cars.get(t.id)) for (const s of c.parts) s.renderable = true;
  }
  draw();
  return { mode, renders: standin.renders ?? 0, log: standin.log };
}

// ------------------------------------------------------------------ (c) the 2D places
function previews() {
  const out = [];
  for (const d of content.locomotives) {
    const url = vehiclePreview(g.atlas, d.id, 0, 2);
    const own = `rolling/loco_${d.id}_${vehicleSpec(d).segments[0].part}_f0`;
    const used = vehicleSpec(d).segments.map((s) => `rolling/loco_${d.body}_${vehicleSpec(d).size}_${d.paint}_${s.part}_f0`);
    out.push({
      id: d.id,
      urlBytes: url.length,
      previewFrames: used.map((k) => `${k} ${g.atlas.has(k) ? 'ok' : 'MISSING'}`),
      ownFrame: own,
      ownInAtlas: g.atlas.has(own),
      ownResolution: g.atlas.has(own) ? g.atlas.get(own).texture.frame.width / g.atlas.get(own).w : null,
      locoFrameF3: locoFrame(g.atlas, d, 3),
    });
  }
  return out;
}
/** Extract what the renderer drew for a container into a data URL: the route a 3D UI thumbnail would take. */
async function extractStandin() {
  if (!standin.rt) return null;
  const canvas = g.app.renderer.extract.canvas(standin.rt);
  return { w: canvas.width, h: canvas.height, url: canvas.toDataURL() };
}
function previewUrl(id, facing = 0, scale = 2) {
  return spriteDataUrl(g.atlas, frameForItem(id, facing), scale);
}

// ------------------------------------------------------------------ plug-in behaviour tests
// Each sets a state, draws, and returns what it measured; probe.mjs takes the screenshot.
const twins = [];
function clearTwins() {
  for (const m of twins.splice(0)) m.destroy();
}
/** Two tall boxes on a heading towards the camera, the second 0.3 tile nearer and drawn later. */
function twinTest(depthMode, swap = false) {
  clearTwins();
  setStandin('off');
  const seg = t.vehiclePoses[0].segments[0];
  const near0 = (x, y) => (depthMode === 'global' ? (x + y) * 0.6124 : 0);
  [0, 1].forEach((k) => {
    const m = makeMesh(1.2, 0.42, 0.8, depthMode !== 'none');
    const x = seg.x + 2 + k * 0.22, y = seg.y - 0.6 + k * 0.22;
    const wp = tileToWorld(x, y);
    const u = m.shader.resources.model.uniforms;
    u.uModel = modelMatrix(Math.PI / 4, 0);
    // 'band': each part owns a slice of the depth range by its place in the draw order, so a
    // later part always wins over an earlier one (as sprites do) and still occludes itself
    const rank = swap ? 1 - k : k;
    u.uNear0 = depthMode === 'band' ? rank * 8 : near0(x, y);
    u.uDepthScale = depthMode === 'global' || depthMode === 'band' ? 0.01 : 0.1;
    m.position.set(wp.x, wp.y);
    m.zIndex = depthKey(x, y, 15) + (swap ? (k ? -100 : 100) : 0);
    m.tint = k ? 0xffffff : 0x9090ff;
    g.world.objects.addChild(m);
    twins.push(m);
  });
  const at = tileToWorld(seg.x + 1, seg.y - 0.3);
  g.camera.centerOn(at.x, at.y - 10);
  g.app.renderer.render(g.app.stage);
  return { depthMode, z: twins.map((m) => m.zIndex) };
}
function tintTest(atmosphere = 0x5c6bad, select = true) {
  clearTwins();
  g.trainRenderer.selectedId = select ? t.id : null;
  // the stand-in stands beside the engine sprite so the two can be compared
  standin.mode = 'mesh';
  standin.part = 0;
  standin.hideSprite = false;
  g.render(1, 0);
  placeStandin();
  const sprite = g.trainRenderer.cars.get(t.id)[0].parts[0];
  standin.mesh.position.x += 40;
  standin.mesh.tint = select ? 0xc8f0ff : 0xffffff; // what TrainRenderer.update gives its parts
  const before = { mesh: standin.mesh.tint.toString(16), sprite: sprite.tint.toString(16) };
  g.world.setAtmosphereTint(atmosphere);
  g.app.renderer.render(g.app.stage);
  return { before, after: { mesh: standin.mesh.tint.toString(16), sprite: sprite.tint.toString(16) } };
}
function alphaTest(alpha) {
  g.world.root.alpha = alpha;
  g.app.renderer.render(g.app.stage);
  g.world.root.alpha = 1;
  return { alpha };
}
function cullTest() {
  setStandin('mesh', 0, true);
  g.app.render();
  const here = { mesh: standin.mesh.culled, sprite: g.trainRenderer.cars.get(t.id)[1].parts[0].culled };
  const keep = { x: g.camera.x, y: g.camera.y };
  g.camera.centerOn(keep.x + 3000, keep.y);
  g.render(1, 0);
  placeStandin();
  g.app.render();
  const lagging = { mesh: standin.mesh.culled, sprite: g.trainRenderer.cars.get(t.id)[1].parts[0].culled };
  // the culler reads the transforms of the frame before: one more frame
  g.app.render();
  const away = { mesh: standin.mesh.culled, sprite: g.trainRenderer.cars.get(t.id)[1].parts[0].culled };
  const moved = g.camera.x - keep.x;
  g.camera.centerOn(keep.x, keep.y);
  draw();
  return { here, lagging, away, moved };
}
/** How often a per-part render texture would have to be redrawn along the whole run. */
function rerenderRun(from, to, step = 0.05) {
  const cars = () => t.vehiclePoses;
  const keys = new Map();
  const out = { frames: 0, partFrames: 0, redraws: 0, byPart: {} };
  const quant = (a, n) => Math.round(a * n) / n;
  for (let p = from; p <= to; p += step) {
    let k = 0;
    while (t.pathProgress < p && t.state === 'moving' && k++ < 40000) g.fleet.tick(1 / 60, (now += 1 / 60));
    out.frames++;
    cars().forEach((v, i) => {
      if (i >= t.locos.length) return;
      v.segments.forEach((s, si) => {
        const body = g.trainRenderer.bodyGround(s, undefined, 1, s.x, s.y);
        const along = body.sgx * Math.cos(s.angle) + body.sgy * Math.sin(s.angle);
        // redraw when the heading moves 0.25 degree or the pitch 0.25 degree
        const key = `${quant((s.angle * 180) / Math.PI, 4)}|${quant((Math.atan2(-along, TILE_SIDE_PX) * 180) / Math.PI, 4)}`;
        const id = `${i}.${s.part}`;
        out.partFrames++;
        if (keys.get(id) !== key) {
          keys.set(id, key);
          out.redraws++;
          out.byPart[id] = (out.byPart[id] ?? 0) + 1;
        }
      });
    });
  }
  return out;
}
/** JS cost of the sprite renderer's update for this consist, and of sorting the object layer. */
function timing(n = 300) {
  const a = performance.now();
  for (let i = 0; i < n; i++) g.trainRenderer.update(g.fleet.trains, 1, 0);
  const b = performance.now();
  const layer = g.world.objects;
  for (let i = 0; i < n; i++) {
    layer.sortDirty = true;
    layer.sortChildren();
  }
  const c = performance.now();
  const cars = g.trainRenderer.cars.get(t.id);
  return {
    updateMsPerCall: (b - a) / n,
    sortMsPerCall: (c - b) / n,
    objectChildren: layer.children.length,
    displayObjectsOfThisTrain: cars.reduce((s, c2) => s + c2.parts.length + c2.bogies.length + 1 + (c2.load ? 1 : 0), 0) + g.trainRenderer.windowLights.size,
  };
}
const TESTS = { twinTest, clearTwins, tintTest, alphaTest, cullTest, rerenderRun, timing };

// ------------------------------------------------------------------ more plug-in tests (resumed run)
/** hideAt: which display objects of the train go invisible when a tile is declared a shed. */
function hideTest(x0, x1) {
  setStandin('off');
  const keep = g.trainRenderer.hideAt;
  g.trainRenderer.hideAt = (x, y) => y === Y0 && x >= x0 && x <= x1;
  draw();
  const cars = g.trainRenderer.cars.get(t.id);
  const out = t.vehiclePoses.map((v, i) => ({
    parts: v.segments.map((sg, k) => ({ part: sg.part, x: round(sg.x, 2), tile: Math.floor(sg.x + 0.5), L: sg.L, visible: cars[i].parts[k].visible, light: g.trainRenderer.windowLights.get(cars[i].parts[k])?.visible ?? null })),
    bogies: cars[i].bogies.map((b) => b.visible),
    load: cars[i].load ? cars[i].load.visible : null,
  }));
  return { out, restore: () => { g.trainRenderer.hideAt = keep; draw(); } };
}
/** One long box cut in n slices along its length, each sorted by its own centre. */
const slices = [];
function sliceTest(n, hideSprite = true) {
  for (const m of slices.splice(0)) m.destroy();
  setStandin('off');
  if (!n) return draw();
  const seg = t.vehiclePoses[0].segments[0];
  const spec = t.vehicleSpecs[0].segments[0];
  const sprite = g.trainRenderer.cars.get(t.id)[0].parts[0];
  sprite.renderable = !hideSprite;
  const shown = seg.angle + (t.reversed ? Math.PI : 0) + (seg.mirror ? Math.PI : 0);
  const L = spec.L, W = 0.32 * 1.3, H = 0.42;
  const wp = tileToWorld(seg.x, seg.y);
  const res = [];
  for (let k = 0; k < n; k++) {
    const a = -L / 2 + (L * k) / n, b = a + L / n, mid = (a + b) / 2;
    const m = makeMesh(L, W, H);
    const u = m.shader.resources.model.uniforms;
    u.uModel = modelMatrix(shown, 0);
    u.uClip = new Float32Array([k === 0 ? -1e6 : a, k === n - 1 ? 1e6 : b]);
    // depth: all slices share one local depth range, so they interlock like one mesh
    m.position.set(wp.x, wp.y);
    const sx = seg.x + Math.cos(shown) * mid, sy = seg.y + Math.sin(shown) * mid;
    m.zIndex = depthKey(sx, sy, 15);
    res.push({ k, from: round(a, 2), to: round(b, 2), zIndex: round(m.zIndex, 1) });
    g.world.objects.addChild(m);
    slices.push(m);
  }
  g.app.renderer.render(g.app.stage);
  return res;
}
/** A busy field: n trains (1 engine + w wagons) placed along the line; cost of the renderer's update and of the layer sort. */
function busy(n, wagons = 8, reps = 200) {
  const defs = content.locomotives.filter((d) => d.gear);
  const wdefs = content.wagons;
  const list = [];
  for (let i = 0; i < n; i++) {
    const d = defs[i % defs.length];
    const tr = new Train([{ uid: 90000 + i, def: d, level: 0 }], 'B' + i, 90000 + i);
    tr.wagons = Array.from({ length: wagons }, (_, k) => ({ uid: 91000 + i * 20 + k, def: wdefs[(i + k) % wdefs.length], level: 0, cargo: null, amount: 0 }));
    if (!tr.spawnAt(g.track, XA + 20 + (i % 8), Y0, 3)) continue;
    list.push(tr);
  }
  const keep = g.fleet.trains;
  g.fleet.trains = list;
  g.trainRenderer.update(list, 1, 0);
  const a = performance.now();
  for (let i = 0; i < reps; i++) g.trainRenderer.update(list, 1, 0);
  const b = performance.now();
  const layer = g.world.objects;
  for (let i = 0; i < reps; i++) { layer.sortDirty = true; layer.sortChildren(); }
  const c = performance.now();
  for (let i = 0; i < reps; i++) for (const tr of list) tr.updatePoses();
  const d2 = performance.now();
  let parts = 0, locoParts = 0, bogies = 0, loads = 0, lights = g.trainRenderer.windowLights.size, vehicles = 0;
  for (const tr of list) for (const [i, c2] of g.trainRenderer.cars.get(tr.id).entries()) {
    vehicles++; parts += c2.parts.length; bogies += c2.bogies.length; loads += c2.load ? 1 : 0;
    if (i < tr.locos.length) locoParts += c2.parts.length;
  }
  const out = { trains: list.length, vehicles, parts, locoParts, bogies, loads, windowLights: lights, objectChildren: layer.children.length,
    updateMs: (b - a) / reps, sortMs: (c - b) / reps, updatePosesMs: (d2 - c) / reps };
  g.fleet.trains = keep;
  g.trainRenderer.update(keep, 1, 0);
  return out;
}
Object.assign(TESTS, { hideTest, sliceTest, busy });

window.qa = { tests: TESTS, g, t, frame, settled, dump, objects, standin: setStandin, previews, previewUrl, extractStandin, draw, scenery, state: standin };
