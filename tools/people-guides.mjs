/** Draw the pose guides of the people repaint: a grey mannequin in the walk cycle, in the game's
 * own projection, and the identity crops that go with them.
 *   node tools/people-guides.mjs [output directory]            the 32 guides and manifest.json
 *   node tools/people-guides.mjs identity <strips> [directory]  the 28 identity crops
 *   node tools/people-guides.mjs sheet <directory> <png>        a small contact sheet of a folder
 * The mannequin (capsule limbs, box torso, sphere head) is posed by joint positions in body units
 * (f forward, r to its right, u up, the figure 1 high), put on the ground of the game (a tile is
 * 64 x 32) turned 45 degrees and projected by `project()` of building-kit.mjs, the one camera: 30
 * degrees down, a 2:1 ground. Each pixel is a ray into the figure, so edges, depth and the three
 * greys (light from the upper left) come out exact. The gait is the game's: the walker moves
 * STEP of its height per pose, so a planted foot slides back STEP per pose against the body.
 * README.md in the output folder says what to attach to a painting call and what never to.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { isMain } from './is-main.mjs';
import { project } from './building-kit.mjs';
import { GREY } from './building-guides.mjs';

export const ROOT = 'assets/source/people-v3-guides';
export const CANVAS = [1024, 1536];
/** Figure height in canvas px, the row of the soles and the column of the pelvis. */
export const HEIGHT = 960;
export const SOLE_ROW = 1440;
/**
 * The sole row is the lowest row at least this many px wide (a sole), not the lowest opaque row:
 * every foot box ends, in the picture, in a sharp corner a few px wide, up to 16 px below the sole
 * proper. No painted boot reaches that corner (the R7c-1 paintings stopped 9 to 17 px short of it),
 * and test 2 of that trial measures the lowest opaque row of the painting against row 1440.
 */
export const MIN_SOLE_PX = 36;
export const CENTRE_X = 512;
/** The figure is this many game px tall in the game; its canvas px per game px follow. */
const FIGURE_PX = 9;
/** Height of the figure in tiles along a tile axis: 1 height is 9 px of the 35.8 px diagonal. */
const H_TILE = FIGURE_PX / Math.hypot(32, 16);
/** What the walker advances per pose, in heights: 0.031 tile of PEOPLE_GAIT, 1.11 world px. */
export const STEP = 0.123;

export const VIEWS = ['back', 'front'];
export const ARMS = ['swing', 'shoulder', 'block', 'yoke'];
export const POSES = [1, 2, 3, 4];
export const guideName = (view, arm, pose) => `${view}-${arm}-p${pose}`;
/** Walking direction F and the walker's right R as tile vectors: back up-right, front down-right. */
const DIRECTIONS = { back: { F: [0, -1], R: [1, 0] }, front: { F: [1, 0], R: [0, 1] } };

// ---- the body, in heights ----------------------------------------------------------------------
const LEG = 0.2455; // thigh and shank each, so the stance leg stands with a knee a hair bent
const ARM = { upper: 0.18, fore: 0.165, hand: 0.04 };
const ANKLE = 0.04; // the ankle stands this high on a flat foot
const FOOT = { heel: 0.04, toe: 0.12, down: 0.04, up: 0.02, half: 0.035 }; // box about the ankle
const HIP = 0.07;
const SHOULDER = 0.135;
const HEAD = 0.07;
/**
 * The head's centre height. A sphere's picture reaches r times the length of the camera's
 * vertical gradient above its centre, which is longer than the 1 of an upright line (the ground
 * leans into the picture), so the centre sits low enough for the top of the head to be 1.
 */
const HEAD_C = 1 - HEAD * Math.sqrt(1 + 2 * ((16 * H_TILE) / FIGURE_PX) ** 2);
const PELVIS_PASSING = 0.53;
const PELVIS_CONTACT = 0.52; // 1% of the height lower at contact than at passing
const PITCH = { heelStrike: 15, toeOff: -20, swing: -4 };
const SWING = { thigh: 27.5, knee: 55 }; // passing: thigh forward, knee bent, foot clear by ~5%
const ARM_SWING = {
  // [shoulder angle, elbow flex] in degrees: forward arm, back arm, passing
  fwd: [22, 28],
  back: [-20, 8],
  mid: [1, 14],
};

const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => V.mul(a, 1 / V.len(a)),
};
const rad = (d) => (d * Math.PI) / 180;

/** The joint between two bones of lengths l1, l2 from `root` reaching for `target`, bent toward `pole`. */
function twoBone(root, target, l1, l2, pole) {
  const d = V.sub(target, root);
  const dist = V.len(d);
  const reach = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-6), l1 + l2 - 1e-6);
  const dir = V.mul(d, 1 / dist);
  const a = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const side = V.norm(V.sub(pole, V.mul(dir, V.dot(pole, dir))));
  return {
    joint: V.add(V.add(root, V.mul(dir, a)), V.mul(side, h)),
    end: V.add(root, V.mul(dir, reach)),
  };
}

/** A limb chain in the sagittal plane: angles from straight down, forward positive. */
function chain(root, l1, a1, l2, a2) {
  const joint = V.add(root, [l1 * Math.sin(rad(a1)), 0, -l1 * Math.cos(rad(a1))]);
  return { joint, end: V.add(joint, [l2 * Math.sin(rad(a2)), 0, -l2 * Math.cos(rad(a2))]) };
}

/** Where a foot of pitch `deg` (toe up positive) has its ankle when its `corner` stands at `at`. */
function ankleFor(corner, at, deg) {
  const c = Math.cos(rad(deg)),
    s = Math.sin(rad(deg));
  const [a, b] = corner; // the corner relative to the ankle, unrotated
  return [at[0] - (a * c - b * s), at[1] - (a * s + b * c)];
}
const HEEL_CORNER = [-FOOT.heel, -FOOT.down];
const TOE_CORNER = [FOOT.toe, -FOOT.down];

/**
 * The stage of a foot in the cycle at `pose`: 1 heel strike, 2 flat under the body, 3 toe off, 4
 * swinging. The right foot is planted in poses 1 to 3, the left in 3, 4 and 1.
 */
export function stageOf(side, pose) {
  return side === 'right' ? pose : ((pose + 1) % 4) + 1;
}

/** One foot at a stage: ankle (f, u) and pitch, and the heel and toe corners that touch down. */
function footAt(stage, pelvis) {
  // the heel of a planted foot stays where it lands, so against the body it slides back STEP a pose
  const heelF = -FOOT.heel + (2 - stage) * STEP;
  if (stage === 1) {
    const ankle = ankleFor(HEEL_CORNER, [heelF, 0], PITCH.heelStrike);
    return { ankle, pitch: PITCH.heelStrike, planted: 'heel' };
  }
  if (stage === 2) return { ankle: [heelF + FOOT.heel, ANKLE], pitch: 0, planted: 'flat' };
  if (stage === 3) {
    const toeF = heelF + FOOT.heel + FOOT.toe;
    return {
      ankle: ankleFor(TOE_CORNER, [toeF, 0], PITCH.toeOff),
      pitch: PITCH.toeOff,
      planted: 'toe',
    };
  }
  const swing = chain([0, 0, pelvis], LEG, SWING.thigh, LEG, SWING.thigh - SWING.knee);
  return { ankle: [swing.end[0], swing.end[2]], pitch: PITCH.swing, planted: null, swing };
}

/** Everything the pose puts in body space: the capsules, spheres and boxes, and the joints. */
export function solvePose(arm, pose) {
  const contact = pose % 2 === 1;
  const hP = contact ? PELVIS_CONTACT : PELVIS_PASSING;
  const parts = [];
  const joints = { pelvis: [0, 0, hP] };
  const capsule = (id, a, b, r) => parts.push({ id, kind: 'capsule', a, b, r });
  const sphere = (id, c, r) => parts.push({ id, kind: 'sphere', c, r });
  const box = (id, c, half, ax) => parts.push({ id, kind: 'box', c, half, ax });
  const IDENT = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  // legs: right is +r
  for (const [side, sign] of [
    ['right', 1],
    ['left', -1],
  ]) {
    const stage = stageOf(side, pose);
    const foot = footAt(stage, hP);
    const hip = [0, sign * HIP, hP];
    const ankle = [foot.ankle[0], sign * HIP, foot.ankle[1]];
    const knee = foot.swing
      ? [foot.swing.joint[0], sign * HIP, foot.swing.joint[2]]
      : twoBone(hip, ankle, LEG, LEG, [1, 0, 0.05]).joint;
    const c = Math.cos(rad(foot.pitch)),
      s = Math.sin(rad(foot.pitch));
    const ef = [c, 0, s],
      eu = [-s, 0, c];
    const mid = (FOOT.toe - FOOT.heel) / 2,
      up = (FOOT.up - FOOT.down) / 2;
    capsule(`${side}Thigh`, hip, knee, 0.052);
    capsule(`${side}Shank`, knee, ankle, 0.04);
    box(
      `${side}Foot`,
      V.add(V.add(ankle, V.mul(ef, mid)), V.mul(eu, up)),
      [(FOOT.toe + FOOT.heel) / 2, FOOT.half, (FOOT.up + FOOT.down) / 2],
      [ef, [0, 1, 0], eu],
    );
    const at = (corner) => V.add(ankle, V.add(V.mul(ef, corner[0]), V.mul(eu, corner[1])));
    Object.assign(joints, {
      [`${side}Hip`]: hip,
      [`${side}Knee`]: knee,
      [`${side}Ankle`]: ankle,
      [`${side}Heel`]: at(HEEL_CORNER),
      [`${side}Toe`]: at(TOE_CORNER),
      [`${side}Stage`]: stage,
    });
  }

  // torso and head stand where the passing pose has them: the 1% the pelvis drops at contact is
  // taken up by the waist, so the figure is as tall in every pose
  const base = PELVIS_PASSING;
  const waistTop = base + 0.13,
    waistBottom = hP - 0.04;
  box(
    'waist',
    [0, 0, (waistTop + waistBottom) / 2],
    [0.07, 0.12, (waistTop - waistBottom) / 2],
    IDENT,
  );
  box('chest', [0, 0, base + 0.215], [0.07, 0.115, 0.095], IDENT);
  capsule('neck', [0, 0, base + 0.3], [0, 0, HEAD_C - 0.03], 0.03);
  sphere('head', [0, 0, HEAD_C], HEAD);
  sphere('nose', [0.072, 0, HEAD_C - 0.005], 0.018);
  joints.head = [0, 0, HEAD_C];

  // arms: swinging against the legs, or holding what is carried
  const shoulder = (sign) => [0, sign * SHOULDER, base + 0.29];
  const swingArm = (side, sign, kind) => {
    const [a, e] = ARM_SWING[kind];
    const sh = shoulder(sign);
    const upper = chain(sh, ARM.upper, a, ARM.fore, a + e);
    return {
      side,
      sh,
      elbow: [upper.joint[0], sign * SHOULDER, upper.joint[2]],
      wrist: [upper.end[0], sign * SHOULDER, upper.end[2]],
      hand: [
        upper.end[0] + ARM.hand * Math.sin(rad(a + e)),
        sign * SHOULDER,
        upper.end[2] - ARM.hand * Math.cos(rad(a + e)),
      ],
    };
  };
  const reachArm = (side, sign, target, pole) => {
    const sh = shoulder(sign);
    const dir = V.norm(V.sub(target, sh));
    const wristTarget = V.sub(target, V.mul(dir, ARM.hand));
    const { joint, end } = twoBone(sh, wristTarget, ARM.upper, ARM.fore, pole);
    return { side, sh, elbow: joint, wrist: end, hand: target };
  };
  // the arms swing against the legs: the arm opposite the leading foot is forward
  const swingKind = {
    right: ['back', 'mid', 'fwd', 'mid'][pose - 1],
    left: ['fwd', 'mid', 'back', 'mid'][pose - 1],
  };
  const arms = [];
  if (arm === 'swing' || arm === 'shoulder') {
    arms.push(swingArm('left', -1, swingKind.left));
    if (arm === 'swing') arms.push(swingArm('right', 1, swingKind.right));
    else {
      arms.push(reachArm('right', 1, [0.12, 0.13, base + 0.335], [-0.4, 0.4, -1]));
      capsule('log', [-0.22, 0.13, base + 0.36], [0.2, 0.13, base + 0.36], 0.045);
    }
  } else if (arm === 'block') {
    for (const [side, sign] of [
      ['right', 1],
      ['left', -1],
    ])
      arms.push(reachArm(side, sign, [0.21, sign * 0.1, base + 0.09], [-0.2, sign, -0.6]));
    box('stone', [0.21, 0, base + 0.09], [0.07, 0.07, 0.07], IDENT);
  } else {
    for (const [side, sign] of [
      ['right', 1],
      ['left', -1],
    ])
      arms.push(reachArm(side, sign, [-0.03, sign * 0.34, base + 0.34], [0, sign, -1]));
    capsule('yoke', [-0.03, -0.42, base + 0.34], [-0.03, 0.42, base + 0.34], 0.025);
  }
  for (const a of arms) {
    capsule(`${a.side}UpperArm`, a.sh, a.elbow, 0.032);
    capsule(`${a.side}Forearm`, a.elbow, a.wrist, 0.028);
    sphere(`${a.side}Hand`, a.hand, 0.032);
    Object.assign(joints, {
      [`${a.side}Shoulder`]: a.sh,
      [`${a.side}Elbow`]: a.elbow,
      [`${a.side}Wrist`]: a.wrist,
      [`${a.side}Hand`]: a.hand,
    });
  }
  return { parts, joints, pelvisHeight: hP };
}

// ---- the camera --------------------------------------------------------------------------------
/** Body units to screen: the affine map of the game's `project()`, `mirror` swapping the tile axes. */
export function camera(view, { mirror = false, scale = 1, dy = 0 } = {}) {
  const fp = { centre: [CENTRE_X, SOLE_ROW], scale: (HEIGHT / FIGURE_PX) * scale };
  const { F, R } = DIRECTIONS[view];
  const tile = (f, r, u) => {
    const x = H_TILE * (F[0] * f + R[0] * r),
      y = H_TILE * (F[1] * f + R[1] * r);
    return mirror ? [y, x, FIGURE_PX * u] : [x, y, FIGURE_PX * u];
  };
  const to = (p) => {
    const q = project(fp, ...tile(p[0], p[1], p[2]));
    return [q[0], q[1] + dy];
  };
  const o = to([0, 0, 0]);
  const col = (p) => {
    const q = to(p);
    return [q[0] - o[0], q[1] - o[1]];
  };
  const [cf, cr, cu] = [col([1, 0, 0]), col([0, 1, 0]), col([0, 0, 1])];
  return {
    to,
    M: [
      [cf[0], cr[0], cu[0]],
      [cf[1], cr[1], cu[1]],
    ],
    t: o,
    mirror,
  };
}

/** The unit direction along which the camera sees one pixel, toward the camera, and the light. */
function viewing(cam) {
  const [a, b, c] = cam.M[0],
    [d, e, f] = cam.M[1];
  const dir = V.norm([b * f - c * e, c * d - a * f, a * e - b * d]);
  const toCamera = dir[2] < 0 ? V.mul(dir, -1) : dir;
  const right = V.norm([a, b, c]);
  const up = V.norm([-d, -e, -f]);
  const side = cam.mirror ? 1 : -1; // the light comes from the upper left, a mirror's from the right
  return {
    toCamera,
    light: V.norm(V.add(V.add(V.mul(right, 0.55 * side), V.mul(up, 0.6)), V.mul(toCamera, 0.55))),
  };
}
const BANDS = [0.55, 0.28]; // n . light above: top grey, left grey, else right grey
const SHADES = [GREY.top, GREY.left, GREY.right];

// ---- the rays ----------------------------------------------------------------------------------
function hitSphere(ro, rd, c, r) {
  const oc = V.sub(ro, c);
  const b = V.dot(rd, oc),
    h = b * b - (V.dot(oc, oc) - r * r);
  if (h < 0) return null;
  const t = -b - Math.sqrt(h);
  return { t, n: V.norm(V.add(oc, V.mul(rd, t))) };
}
function hitCapsule(ro, rd, pa, pb, r) {
  const ba = V.sub(pb, pa),
    oa = V.sub(ro, pa);
  const baba = V.dot(ba, ba),
    bard = V.dot(ba, rd),
    baoa = V.dot(ba, oa);
  const rdoa = V.dot(rd, oa),
    oaoa = V.dot(oa, oa);
  const a = baba - bard * bard;
  const b = baba * rdoa - baoa * bard;
  const c = baba * oaoa - baoa * baoa - r * r * baba;
  const h = b * b - a * c;
  if (h < 0) return null;
  const t = (-b - Math.sqrt(h)) / a;
  const y = baoa + t * bard;
  if (y > 0 && y < baba) {
    const p = V.add(oa, V.mul(rd, t));
    return { t, n: V.norm(V.sub(p, V.mul(ba, y / baba))) };
  }
  return hitSphere(ro, rd, y <= 0 ? pa : pb, r);
}
function hitBox(ro, rd, c, half, ax) {
  const o = V.sub(ro, c);
  let tNear = -Infinity,
    tFar = Infinity,
    n = null;
  for (let i = 0; i < 3; i++) {
    const p = V.dot(o, ax[i]),
      d = V.dot(rd, ax[i]);
    if (Math.abs(d) < 1e-12) {
      if (Math.abs(p) > half[i]) return null;
      continue;
    }
    let t0 = (-half[i] - p) / d,
      t1 = (half[i] - p) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    if (t0 > tNear) {
      tNear = t0;
      n = V.mul(ax[i], d > 0 ? -1 : 1);
    }
    tFar = Math.min(tFar, t1);
  }
  return tNear > tFar || tFar < 0 || !n ? null : { t: tNear, n };
}
const reach = (part) =>
  part.kind === 'sphere'
    ? { c: part.c, r: part.r }
    : part.kind === 'capsule'
      ? { c: V.mul(V.add(part.a, part.b), 0.5), r: V.len(V.sub(part.b, part.a)) / 2 + part.r }
      : { c: part.c, r: V.len(part.half) };

/** Draw the parts through the camera: a PNG, and for every pixel the part that shows and how near. */
function raster(parts, cam) {
  const [W, H] = CANVAS;
  const png = new PNG({ width: W, height: H });
  const depth = new Float32Array(W * H).fill(Infinity);
  const ids = new Int16Array(W * H).fill(-1);
  const { M, t } = cam;
  const det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
  const { toCamera, light } = viewing(cam);
  const norms = [V.len(M[0]), V.len(M[1])];
  const shade = new Uint8Array(W * H);
  parts.forEach((part, id) => {
    const { c, r } = reach(part);
    const sx = M[0][0] * c[0] + M[0][1] * c[1] + M[0][2] * c[2] + t[0];
    const sy = M[1][0] * c[0] + M[1][1] * c[1] + M[1][2] * c[2] + t[1];
    const x0 = Math.max(0, Math.floor(sx - r * norms[0] - 1));
    const x1 = Math.min(W - 1, Math.ceil(sx + r * norms[0] + 1));
    const y0 = Math.max(0, Math.floor(sy - r * norms[1] - 1));
    const y1 = Math.min(H - 1, Math.ceil(sy + r * norms[1] + 1));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - t[0],
          dy = y + 0.5 - t[1];
        const p0 = [(M[1][1] * dx - M[0][1] * dy) / det, (M[0][0] * dy - M[1][0] * dx) / det, 0];
        const ro = V.add(p0, V.mul(toCamera, 3));
        const rd = V.mul(toCamera, -1);
        const hit =
          part.kind === 'sphere'
            ? hitSphere(ro, rd, part.c, part.r)
            : part.kind === 'capsule'
              ? hitCapsule(ro, rd, part.a, part.b, part.r)
              : hitBox(ro, rd, part.c, part.half, part.ax);
        const i = y * W + x;
        if (!hit || hit.t >= depth[i]) continue;
        depth[i] = hit.t;
        ids[i] = id;
        const lit = V.dot(hit.n, light);
        shade[i] = lit > BANDS[0] ? 0 : lit > BANDS[1] ? 1 : 2;
      }
  });
  // a dark line where a nearer part overlaps a farther one, so crossing limbs stay apart
  const line = new Uint8Array(W * H);
  for (let y = 2; y < H - 2; y++)
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      if (ids[i] < 0) continue;
      for (const [ox, oy] of [
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2],
      ]) {
        const j = i + oy * W + ox;
        if (ids[j] >= 0 && ids[j] !== ids[i] && depth[j] < depth[i] - 0.04) line[i] = 1;
      }
    }
  for (let i = 0; i < W * H; i++) {
    if (ids[i] < 0) continue;
    const rgb = line[i] ? GREY.line : SHADES[shade[i]];
    png.data[i * 4] = rgb[0];
    png.data[i * 4 + 1] = rgb[1];
    png.data[i * 4 + 2] = rgb[2];
    png.data[i * 4 + 3] = 255;
  }
  return png;
}

/** First and last opaque row of a picture, or null. */
export function rowsOf(png) {
  let top = -1,
    bottom = -1;
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++)
      if (png.data[(y * png.width + x) * 4 + 3] > 0) {
        if (top < 0) top = y;
        bottom = y;
        break;
      }
  return top < 0 ? null : { top, bottom };
}

/** The lowest row with at least MIN_SOLE_PX opaque pixels (the sole proper), or null. */
export function soleRowOf(png) {
  for (let y = png.height - 1; y >= 0; y--) {
    let n = 0;
    for (let x = 0; x < png.width; x++) if (png.data[(y * png.width + x) * 4 + 3] > 0) n++;
    if (n >= MIN_SOLE_PX) return y;
  }
  return null;
}

/** A picture moved `dy` rows down (up for a negative one), whole rows, so nothing is resampled. */
function shiftRows(png, dy) {
  const out = new PNG({ width: png.width, height: png.height });
  for (let y = 0; y < png.height; y++) {
    const to = y + dy;
    if (to < 0 || to >= png.height) continue;
    png.data.copy(out.data, to * png.width * 4, y * png.width * 4, (y + 1) * png.width * 4);
  }
  return out;
}

/**
 * One guide, at the true size of the game's figure: its scale is the same in every pose, so the
 * 1% of bob and the stagger of depth (the foot toward the camera stands lower on the screen) are
 * the walk's own. The figure is moved up or down until its sole row (soleRowOf) is on SOLE_ROW; the
 * sharp corner of a heel-strike foot may stand a few px lower, and flat soles end on SOLE_ROW itself.
 */
export function drawGuideFor(view, arm, pose, { mirror = false } = {}) {
  const { parts, joints } = solvePose(arm, pose);
  const png = raster(parts, camera(view, { mirror }));
  const dy = SOLE_ROW - soleRowOf(png);
  const cam = camera(view, { mirror, dy });
  const screen = {};
  for (const [k, v] of Object.entries(joints))
    screen[k] = Array.isArray(v) ? cam.to(v).map((n) => Math.round(n * 10) / 10) : v;
  // the top of the head: its centre less the sphere's radius in screen px
  const head = cam.to(joints.head);
  const headTop = Math.round((head[1] - HEAD * Math.hypot(...cam.M[1])) * 10) / 10;
  return { png: shiftRows(png, dy), cam, joints, screen, headTop };
}

/** Every guide: name, picture and what the manifest records of it. */
export function allGuides() {
  const list = [];
  for (const view of VIEWS)
    for (const arm of ARMS)
      for (const pose of POSES) {
        const g = drawGuideFor(view, arm, pose);
        const rows = rowsOf(g.png);
        list.push({
          name: guideName(view, arm, pose),
          view,
          arm,
          pose,
          png: g.png,
          headTop: g.headTop,
          groundPoint: g.cam.to([0, 0, 0]).map((n) => Math.round(n * 10) / 10),
          rows,
          joints: g.joints,
          screen: g.screen,
        });
      }
  return list;
}

const round3 = (v) => (Array.isArray(v) ? v.map((n) => Math.round(n * 1000) / 1000) : v);

export function manifestOf(guides) {
  return {
    canvas: CANVAS,
    figureHeight: HEIGHT,
    soleRow: SOLE_ROW,
    centreColumn: CENTRE_X,
    step: STEP,
    units: 'joints: body units (f forward, r to the walker right, u up, height 1) and canvas px',
    guides: guides.map((g) => ({
      file: `${g.name}.png`,
      view: g.view,
      arm: g.arm,
      pose: g.pose,
      top: g.rows.top,
      bottom: g.rows.bottom,
      headTop: g.headTop,
      groundPoint: g.groundPoint,
      body: Object.fromEntries(Object.entries(g.joints).map(([k, v]) => [k, round3(v)])),
      canvas: g.screen,
    })),
  };
}

export function writeGuides(dir = ROOT) {
  mkdirSync(dir, { recursive: true });
  const guides = allGuides();
  for (const g of guides) writeFileSync(join(dir, `${g.name}.png`), PNG.sync.write(g.png));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifestOf(guides), null, 1) + '\n');
  return guides;
}

// ---- identity crops ----------------------------------------------------------------------------
/** The strip's nominal figure: 360 px tall on the baseline row 480 of a 512 px strip. */
const STRIP = { height: 360, baseline: 480 };
/** The hip line, in heights above the sole, and the fade that takes the legs away below it. */
export const HIP_LINE = 0.52;
export const FADE = 0.06;

const alphaAt = (png, x, y) => png.data[(y * png.width + x) * 4 + 3];

/** A frame (column) of a strip as the mask of what it draws above the hip line. */
function upperMask(strip, frame) {
  const cw = strip.width / 4;
  const rowMax = STRIP.baseline - Math.round(HIP_LINE * STRIP.height);
  const mask = new Uint8Array(cw * rowMax);
  for (let y = 0; y < rowMax; y++)
    for (let x = 0; x < cw; x++) mask[y * cw + x] = alphaAt(strip, frame * cw + x, y) > 128 ? 1 : 0;
  return mask;
}

/**
 * The frame whose upper body is the most typical of the four (the best intersection over union
 * with the other three): the arms in their commonest place, so the identity is the person's.
 */
export function bestFrame(strip) {
  const masks = [0, 1, 2, 3].map((f) => upperMask(strip, f));
  const score = masks.map((a, i) => {
    let sum = 0;
    masks.forEach((b, j) => {
      if (i === j) return;
      let inter = 0,
        union = 0;
      for (let k = 0; k < a.length; k++) {
        inter += a[k] & b[k];
        union += a[k] | b[k];
      }
      sum += union ? inter / union : 0;
    });
    return sum;
  });
  return score.indexOf(Math.max(...score));
}

/**
 * The upper body of one frame on the guides' layout at 1 / IDENTITY_SHRINK of its size (the
 * pictures are then small enough to commit): the strip's nominal figure scaled to HEIGHT / 2 with
 * its baseline on SOLE_ROW / 2 and its centre column on CENTRE_X / 2, the legs faded to nothing
 * between the hip line and FADE below it. Bilinear on premultiplied colour.
 */
export const IDENTITY_SHRINK = 2;
export const IDENTITY_CANVAS = CANVAS.map((n) => n / IDENTITY_SHRINK);
export function identityCrop(strip, frame) {
  const cw = strip.width / 4;
  const k = HEIGHT / IDENTITY_SHRINK / STRIP.height;
  const [W, H] = IDENTITY_CANVAS;
  const out = new PNG({ width: W, height: H });
  const hipRow = STRIP.baseline - HIP_LINE * STRIP.height;
  const fadeRows = FADE * STRIP.height;
  const sample = (sx, sy) => {
    const x0 = Math.floor(sx - 0.5),
      y0 = Math.floor(sy - 0.5);
    const fx = sx - 0.5 - x0,
      fy = sy - 0.5 - y0;
    const acc = [0, 0, 0, 0];
    for (const [ox, oy, w] of [
      [0, 0, (1 - fx) * (1 - fy)],
      [1, 0, fx * (1 - fy)],
      [0, 1, (1 - fx) * fy],
      [1, 1, fx * fy],
    ]) {
      const x = x0 + ox,
        y = y0 + oy;
      if (x < 0 || x >= cw || y < 0 || y >= strip.height) continue;
      const o = (y * strip.width + frame * cw + x) * 4;
      const a = strip.data[o + 3] / 255;
      acc[0] += strip.data[o] * a * w;
      acc[1] += strip.data[o + 1] * a * w;
      acc[2] += strip.data[o + 2] * a * w;
      acc[3] += a * w;
    }
    return acc;
  };
  for (let y = 0; y < H; y++) {
    const sy = STRIP.baseline + 0.5 + (y + 0.5 - (SOLE_ROW / IDENTITY_SHRINK + 0.5)) / k;
    if (sy < 0 || sy >= strip.height) continue;
    const fade = Math.min(1, Math.max(0, 1 - (sy - hipRow) / fadeRows));
    if (fade === 0) continue;
    for (let x = 0; x < W; x++) {
      const sx = cw / 2 + (x + 0.5 - CENTRE_X / IDENTITY_SHRINK) / k;
      if (sx < 0 || sx >= cw) continue;
      const [r, g, b, a] = sample(sx, sy);
      if (a <= 0) continue;
      const o = (y * W + x) * 4;
      out.data[o] = Math.round(r / a);
      out.data[o + 1] = Math.round(g / a);
      out.data[o + 2] = Math.round(b / a);
      out.data[o + 3] = Math.round(255 * Math.min(1, a) * fade);
    }
  }
  return out;
}

/** The strips in a folder: name (`lumberjack-back-walk`) to file. */
export function stripFiles(dir) {
  return readdirSync(dir)
    .filter((f) => /^[a-z0-9-]+-(front|back)-(walk|carry)\.png$/.test(f))
    .sort();
}

export function writeIdentity(stripDir, dir = join(ROOT, 'identity')) {
  mkdirSync(dir, { recursive: true });
  const made = [];
  for (const file of stripFiles(stripDir)) {
    const strip = PNG.sync.read(readFileSync(join(stripDir, file)));
    const frame = bestFrame(strip);
    const name = file.replace(/\.png$/, '');
    writeFileSync(join(dir, `${name}-upper.png`), PNG.sync.write(identityCrop(strip, frame)));
    made.push({ strip: name, frame, columns: strip.width / 4 });
  }
  writeFileSync(
    join(dir, 'identity.json'),
    JSON.stringify(
      {
        hipLine: HIP_LINE,
        fade: FADE,
        canvas: IDENTITY_CANVAS,
        shrink: IDENTITY_SHRINK,
        crops: made,
      },
      null,
      1,
    ) + '\n',
  );
  return made;
}

// ---- a contact sheet ---------------------------------------------------------------------------
/** The pictures of a folder in a grid, each cut to its drawn rows and shrunk by `shrink`. */
export function contactSheet(dir, shrink = 4, columns = 8) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .sort();
  const first = PNG.sync.read(readFileSync(join(dir, files[0])));
  const cw = first.width / shrink,
    ch = first.height / shrink;
  const rows = Math.ceil(files.length / columns);
  const sheet = new PNG({ width: cw * columns, height: ch * rows });
  for (let i = 0; i < sheet.data.length; i += 4) sheet.data.set([236, 232, 222, 255], i);
  files.forEach((f, n) => {
    const png = PNG.sync.read(readFileSync(join(dir, f)));
    const ox = (n % columns) * cw,
      oy = Math.floor(n / columns) * ch;
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        const acc = [0, 0, 0, 0];
        for (let sy = 0; sy < shrink; sy++)
          for (let sx = 0; sx < shrink; sx++) {
            const o = ((y * shrink + sy) * png.width + x * shrink + sx) * 4;
            const a = png.data[o + 3] / 255;
            acc[0] += png.data[o] * a;
            acc[1] += png.data[o + 1] * a;
            acc[2] += png.data[o + 2] * a;
            acc[3] += a;
          }
        const o = ((oy + y) * sheet.width + ox + x) * 4;
        const n2 = shrink * shrink;
        const a = acc[3] / n2;
        for (let c = 0; c < 3; c++) {
          const fg = acc[3] ? acc[c] / acc[3] : 0;
          sheet.data[o + c] = Math.round(fg * a + sheet.data[o + c] * (1 - a));
        }
      }
  });
  return sheet;
}

if (isMain(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'identity') {
    const made = writeIdentity(rest[0], rest[1]);
    console.log(`${made.length} identity crops`);
  } else if (cmd === 'sheet') {
    writeFileSync(rest[1], PNG.sync.write(contactSheet(rest[0], Number(rest[2] ?? 4))));
    console.log(rest[1]);
  } else {
    const guides = writeGuides(cmd);
    console.log(`${guides.length} guides in ${cmd ?? ROOT}`);
  }
}
