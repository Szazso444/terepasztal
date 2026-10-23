/** Draw the building guides: a grey block-out per footprint and rotation, in the game's projection.
 * node tools/building-guides.mjs [output directory]
 * A picture is painted as an edit of its guide, so every picture of a footprint comes out with the
 * same camera, scale and position. The footprint is a low plinth; on it stands a plain block whose
 * front carries a door, and whose end walls carry the portals when it is a depot. Faces are flat
 * greys by the way they look: top light, lower-left wall mid, lower-right wall dark. The block's
 * height is the footprint's, unless a family names its own (`blockHeight` in families.json): that
 * family then has guides of its own, `guides/<family>-r<view>.png`.
 * The windmill has a guide kind of its own (`guideKind: "windmill"` in families.json): a round
 * tower with its windshaft stub on the face the building's front turns to, in each of the four
 * views, a hub file per view that says where the sails turn, and the sail cross seen face on
 * (`windmillFiles`).
 * The coaling stage (the `fuel_stop` family) has an oblong guide of its own for its three turned
 * views, with pier stubs, in the plan the painting must hold (`oblongGuide`, `oblongFiles`).
 * The plan guides of the second review round (`PLAN_JOBS`, `planFiles`) are one per job and view,
 * on the footprint the game gives the building, with a plan file of the numbers a prompt quotes.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';
import { isMain } from './is-main.mjs';
import {
  FOOTPRINTS,
  ROOT,
  ROTATIONS,
  WALL_INSET,
  footprintTiles,
  loadInventory,
  project,
  wallRole,
} from './building-kit.mjs';

export const GREY = {
  top: [222, 222, 222],
  left: [168, 168, 168],
  right: [118, 118, 118],
  line: [40, 40, 40],
  plinthTop: [190, 190, 190],
  plinthLeft: [140, 140, 140],
  plinthRight: [96, 96, 96],
  opening: [56, 56, 56],
};
/** Game px. The plinth is the footprint; the block stands on it, set in from its edge. */
const PLINTH = 4;
const HEIGHT = { t1: 40, t1tall: 40, t1x2: 34, t2x2: 46 };
/** Openings per footprint: `at` is the offset along the wall from its middle, in tiles. */
const OPENINGS = {
  t1: { front: [{ at: 0, width: 0.24, height: 20 }] },
  t1tall: { front: [{ at: 0, width: 0.24, height: 20 }] },
  t1x2: {
    front: [{ at: 0, width: 0.16, height: 18 }],
    side: [{ at: 0, width: 0.44, height: 24 }],
  },
  t2x2: {
    front: [{ at: 0, width: 0.16, height: 18 }],
    side: [
      { at: -0.5, width: 0.5, height: 30 },
      { at: 0.5, width: 0.5, height: 30 },
    ],
  },
};

/**
 * Where a guide is kept: one per footprint and view. A family whose picture needs a taller block
 * than its footprint's (`blockHeight` in families.json) has guides of its own, named by `family`.
 */
export function guideFile(fpId, rot, family = null) {
  return `${ROOT}/guides/${family ?? fpId}-r${rot}.png`;
}

/**
 * The block of a guide: tile offsets from the footprint centre, heights in game px. `height` is
 * the block's own, above the plinth; a footprint's is the default.
 */
export function blockOf(fpId, rot, height = HEIGHT[fpId]) {
  const { w, h } = footprintTiles(FOOTPRINTS[fpId], rot);
  const x1 = w / 2 - WALL_INSET,
    y1 = h / 2 - WALL_INSET;
  return { x0: -x1, y0: -y1, x1, y1, z0: PLINTH, z1: PLINTH + height };
}

/** Fill a polygon given as canvas points (even-odd scanline, pixel centres). */
export function fillPoly(png, pts, rgb, alpha = 255) {
  const ys = pts.map((p) => p[1]);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(png.height - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      if (ay === by || cy < Math.min(ay, by) || cy >= Math.max(ay, by)) continue;
      xs.push(ax + ((cy - ay) * (bx - ax)) / (by - ay));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(png.width - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = from; x <= to; x++) {
        const o = (y * png.width + x) * 4;
        png.data[o] = rgb[0];
        png.data[o + 1] = rgb[1];
        png.data[o + 2] = rgb[2];
        png.data[o + 3] = alpha;
      }
    }
  }
}

/** Outline a polygon with a line `width` px thick. */
export function strokePoly(png, pts, rgb, width = 3) {
  const r = width / 2;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = (-(by - ay) / len) * r,
      ny = ((bx - ax) / len) * r;
    fillPoly(
      png,
      [
        [ax + nx, ay + ny],
        [bx + nx, by + ny],
        [bx - nx, by - ny],
        [ax - nx, ay - ny],
      ],
      rgb,
    );
    fillPoly(
      png,
      [
        [ax - r, ay - r],
        [ax + r, ay - r],
        [ax + r, ay + r],
        [ax - r, ay + r],
      ],
      rgb,
    );
  }
}

/** The three faces of a box the camera sees, as canvas polygons. */
export function boxFaces(fp, b) {
  const p = (x, y, z) => project(fp, x, y, z);
  return {
    top: [p(b.x0, b.y0, b.z1), p(b.x1, b.y0, b.z1), p(b.x1, b.y1, b.z1), p(b.x0, b.y1, b.z1)],
    left: [p(b.x0, b.y1, b.z0), p(b.x1, b.y1, b.z0), p(b.x1, b.y1, b.z1), p(b.x0, b.y1, b.z1)],
    right: [p(b.x1, b.y0, b.z0), p(b.x1, b.y1, b.z0), p(b.x1, b.y1, b.z1), p(b.x1, b.y0, b.z1)],
  };
}

function drawBox(png, fp, b, colours) {
  const faces = boxFaces(fp, b);
  fillPoly(png, faces.top, colours.top);
  fillPoly(png, faces.left, colours.left);
  fillPoly(png, faces.right, colours.right);
  for (const face of Object.values(faces)) strokePoly(png, face, GREY.line);
}

/**
 * The openings a guide shows on the two walls the camera sees: the front door, and a depot's
 * portals. Each has its wall (0 the lower-left, 1 the lower-right), its kind (`front` or `side`)
 * and its outline on the canvas.
 */
export function openingsOf(fpId, rot) {
  const fp = FOOTPRINTS[fpId];
  const b = blockOf(fpId, rot);
  const out = [];
  // the S wall runs along x at y1, the E wall along y at x1
  ['S', 'E'].forEach((wall, i) => {
    const role = wallRole(wall, rot);
    const kind = role === 'front' ? 'front' : role === 'back' ? null : 'side';
    for (const o of (kind && OPENINGS[fpId][kind]) || []) {
      const a = o.at - o.width / 2,
        c = o.at + o.width / 2,
        top = b.z0 + o.height;
      const pts =
        wall === 'S'
          ? [
              project(fp, a, b.y1, b.z0),
              project(fp, c, b.y1, b.z0),
              project(fp, c, b.y1, top),
              project(fp, a, b.y1, top),
            ]
          : [
              project(fp, b.x1, a, b.z0),
              project(fp, b.x1, c, b.z0),
              project(fp, b.x1, c, top),
              project(fp, b.x1, a, top),
            ];
      out.push({ wall: i, kind, pts });
    }
  });
  return out;
}

/**
 * Which of the two visible walls carries a depot's portals: 0 the lower-left, 1 the lower-right.
 * Null for a footprint whose buildings have no portals.
 */
export function portalWall(fpId, rot) {
  return openingsOf(fpId, rot).find((o) => o.kind === 'side')?.wall ?? null;
}

/**
 * One guide: plinth, block, and the openings of the walls the camera sees. The openings stand on
 * the plinth and have their own heights, so `height` (see `blockOf`) changes only the block's top.
 */
export function drawGuide(fpId, rot, height = HEIGHT[fpId]) {
  const fp = FOOTPRINTS[fpId];
  const png = new PNG({ width: fp.canvas[0], height: fp.canvas[1] });
  const { w, h } = footprintTiles(fp, rot);
  drawBox(
    png,
    fp,
    { x0: -w / 2, y0: -h / 2, x1: w / 2, y1: h / 2, z0: 0, z1: PLINTH },
    { top: GREY.plinthTop, left: GREY.plinthLeft, right: GREY.plinthRight },
  );
  const b = blockOf(fpId, rot, height);
  drawBox(png, fp, b, GREY);
  for (const o of openingsOf(fpId, rot)) {
    fillPoly(png, o.pts, GREY.opening);
    strokePoly(png, o.pts, GREY.line);
  }
  return png;
}

/**
 * A metre on screen, upright: the 1.75 m person is drawn 9 game px tall (PERSON_PX in
 * src/render/assetScale.ts), so 2.1 m is 10.8 px.
 */
export const METRE_PX = 9 / 1.75;

/**
 * The windmill: a round tower (a truncated cone) under a cone cap, on the footprint's plinth, with
 * its windshaft stub pointing along tile +y, which is the lower-left face, and a door at the foot
 * of the same face. Lengths in tiles; heights and radii of small parts in game px, heights above
 * the plinth (the `blockHeight` sense of the other guides).
 *
 * The size is the game's own windmill picture (`structures/windmill` in the shipped atlas, scaled
 * as src/render/assetScale.ts scales it), measured from the tile centre on the ground: the cone cap
 * reaches 50 px, the tower is 43 px wide at its foot and about 30 px under the cap (radii of 0.475
 * and 0.33 tile: a tile is 64 px wide), and the cap is about 15 px high with an eave of 0.375
 * tile. The apex stands PLINTH + towerHeight + capHeight = 51.4 px above the ground.
 */
export const WINDMILL = {
  footprint: 't1',
  /** from the plinth to where the cap begins */
  towerHeight: 32,
  baseRadius: 0.475,
  topRadius: 0.33,
  capHeight: 15.4,
  /** the eave stands a little proud of the tower's top */
  capRadius: 0.375,
  /** the shaft runs from the tower's axis along +y, and the hub is at its end */
  shaftLength: 0.5,
  /** the hub's height above the eave: on the lower part of the cap */
  hubAboveEave: 6,
  /** 2.1 m: 10.8 px beside the 9 px person */
  doorHeight: 2.1 * METRE_PX,
  /**
   * 1.0 m along the face (tile x): a metre is METRE_PX / (sqrt(3) / 2) in the camera's own length
   * unit (an upright length shrinks to sqrt(3) / 2 of it, see CROSS_AFFINE), and a tile is
   * 32 * sqrt(2) of them.
   */
  doorWidth: METRE_PX / (Math.sqrt(3) / 2) / (32 * Math.SQRT2),
  /** the stub's radius and the hub plate's, which faces +y */
  stubRadius: 1.5,
  plateRadius: 5,
  /**
   * The sails' radius, hub to tip, in the cross's own px (CROSS_AFFINE's unit, game px of the
   * plane the cross turns in): the lowest tip hangs sqrt(3) / 2 of it below the hub, 34.6 px,
   * which leaves 7.4 px (1.4 m) to the ground.
   */
  sailRadius: 40,
};

/**
 * The greys of the round tower by how it faces, in six bands from the right-hand silhouette (the
 * darkest) to the left-hand one; the cap has the same bands, lighter, as it faces up. The stub and
 * the hub plate have a grey of their own, so that a check can find them by it.
 */
const TOWER_BANDS = [113, 125, 137, 149, 161, 172].map((g) => [g, g, g]);
const CAP_BANDS = [153, 165, 177, 189, 201, 212].map((g) => [g, g, g]);
const STUB = [205, 205, 205];
const PLATE = [84, 84, 84];
export const WINDMILL_GREY = { tower: TOWER_BANDS, cap: CAP_BANDS, stub: STUB, plate: PLATE };

/**
 * The windmill's four views. The windshaft, the hub plate and the door are on the building's front
 * (`WALLS[rot]` of building-kit.mjs: S, W, N, E), which is tile direction `shaft`: +y, -x, -y, +x.
 * The first two walls the camera sees are S and E, so the front is on the lower left in `r0`, away
 * from the camera on the upper left in `r1` and on the upper right in `r2` (the shaft, the plate
 * and the sails are then behind the tower), and on the lower right in `r3`. `across` is the tile
 * direction the cross's own u axis lies along: the shaft's, turned with the building.
 */
export const WINDMILL_TURNS = [
  { rot: 0, front: 'S', shaft: [0, 1], across: [1, 0], tileAxis: '+y', face: 'lower left' },
  { rot: 1, front: 'W', shaft: [-1, 0], across: [0, 1], tileAxis: '-x', face: 'upper left' },
  { rot: 2, front: 'N', shaft: [0, -1], across: [-1, 0], tileAxis: '-y', face: 'upper right' },
  { rot: 3, front: 'E', shaft: [1, 0], across: [0, -1], tileAxis: '+x', face: 'lower right' },
];
/** True where the front, and with it the shaft, the plate and the door, is away from the camera. */
export const frontHidden = (rot) => rot === 1 || rot === 2;

/**
 * The map of the plane the cross turns in (the shaft's tile axis stands square to it: the plane of
 * the other tile axis and the vertical) onto the screen, for a cross of unit scale: (u right, v
 * down in the cross's own picture) to (screen x, screen y). u runs along the tile direction
 * `across` of the view, v along the vertical. A view whose front is away from the camera (`r1`,
 * `r2`) sees the cross from behind: the map then reverses the cross's handedness (negative
 * determinant), which a cross that a quarter turn maps onto itself shows only in the order its
 * arms are numbered.
 */
export function crossAffine(rot = 0) {
  const [tx, ty] = WINDMILL_TURNS[rot].across;
  return [
    [(tx - ty) * Math.SQRT1_2, 0],
    [((tx + ty) * Math.SQRT1_2) / 2, Math.sqrt(3) / 2],
  ];
}
/** The view `r0`'s map: the plane of tile x and the vertical. */
export const CROSS_AFFINE = crossAffine(0);

/** The sail cross picture: a square, the hub at its middle, arms at 45 degrees. */
export const SAILS_FACE = {
  size: 1254,
  pivot: [626.5, 626.5],
  /** the farthest painted pixel from the hub, as a share of the side */
  reach: 0.46,
  plate: 80,
  spar: 14,
  frame: { from: 175, halfWidth: 80 },
};

const SLICES = 360;
const azimuth = (i) => (2 * Math.PI * i) / SLICES;
/** A point of the ring of radius `r` at azimuth `a` (0 is +x, a quarter turn is +y). */
const ring = (fp, a, r, z) => project(fp, r * Math.cos(a), r * Math.sin(a), z);

/** The convex hull of canvas points: the outline of a round solid. */
function hull(points) {
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

/** The tower's radius at height z (game px above the ground; the plinth's top is `PLINTH`). */
const towerRadius = (z) =>
  WINDMILL.baseRadius +
  ((WINDMILL.topRadius - WINDMILL.baseRadius) * (z - PLINTH)) / WINDMILL.towerHeight;

/** Where the windmill's parts stand on its canvas, for the view `rot`. */
export function windmillGeometry(rot = 0) {
  const fp = FOOTPRINTS[WINDMILL.footprint];
  const [sx, sy] = WINDMILL_TURNS[rot].shaft;
  const eave = PLINTH + WINDMILL.towerHeight;
  const hubZ = eave + WINDMILL.hubAboveEave;
  const doorZ = PLINTH + WINDMILL.doorHeight / 2;
  const R = towerRadius(PLINTH);
  return {
    fp,
    rot,
    eave,
    apex: eave + WINDMILL.capHeight,
    hubZ,
    hub: project(fp, sx * WINDMILL.shaftLength, sy * WINDMILL.shaftLength, hubZ),
    axis: project(fp, 0, 0, hubZ),
    door: project(fp, sx * R, sy * R, doorZ),
    /** a canvas point in game px from the anchor */
    inGame: (p) => [(p[0] - fp.centre[0]) / fp.scale, (p[1] - fp.centre[1]) / fp.scale],
  };
}

/**
 * The windmill's guide for the view `rot`: plinth, tower, door, cap, windshaft stub and the hub
 * plate. Where the front is away from the camera (`r1`, `r2`) there is no door in the picture,
 * and the stub and the plate stand behind the tower and its cap.
 */
export function drawWindmill({ plinth = true, rot = 0 } = {}) {
  const g = windmillGeometry(rot);
  const { fp } = g;
  const W = WINDMILL;
  const turn = WINDMILL_TURNS[rot];
  const hidden = frontHidden(rot);
  const A = crossAffine(rot);
  const png = new PNG({ width: fp.canvas[0], height: fp.canvas[1] });
  // the plinth is the footprint, as for every guide (`plinth: false` for a stand-in picture)
  if (plinth)
    drawBox(
      png,
      fp,
      { x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5, z0: 0, z1: PLINTH },
      { top: GREY.plinthTop, left: GREY.plinthLeft, right: GREY.plinthRight },
    );
  // the windshaft stub, a cylinder along the shaft from the cap to the hub, and the hub plate
  const shaft = () => {
    const [dx, dy] = [g.hub[0] - g.axis[0], g.hub[1] - g.axis[1]];
    const len = Math.hypot(dx, dy);
    const nx = (-dy / len) * W.stubRadius * fp.scale,
      ny = (dx / len) * W.stubRadius * fp.scale;
    // the stub comes out of the cap's surface, at the shaft's height
    const out = (W.capRadius * (g.apex - g.hubZ)) / W.capHeight / W.shaftLength;
    const start = [g.axis[0] + dx * out, g.axis[1] + dy * out];
    const stub = [
      [start[0] + nx, start[1] + ny],
      [g.hub[0] + nx, g.hub[1] + ny],
      [g.hub[0] - nx, g.hub[1] - ny],
      [start[0] - nx, start[1] - ny],
    ];
    fillPoly(png, stub, STUB);
    strokePoly(png, stub, GREY.line);
    const plate = [];
    for (let i = 0; i < 72; i++) {
      const t = (2 * Math.PI * i) / 72;
      const u = W.plateRadius * Math.cos(t) * fp.scale,
        v = W.plateRadius * Math.sin(t) * fp.scale;
      plate.push([g.hub[0] + A[0][0] * u + A[0][1] * v, g.hub[1] + A[1][0] * u + A[1][1] * v]);
    }
    fillPoly(png, plate, PLATE);
    strokePoly(png, plate, GREY.line);
  };
  // away from the camera, the shaft and the plate are behind the tower: drawn first
  if (hidden) shaft();
  // slices, the far ones first: a slice's grey is how far its normal turns to the screen's left
  const order = [...Array(SLICES).keys()].sort(
    (i, j) => Math.cos(azimuth(i) - Math.PI / 4) - Math.cos(azimuth(j) - Math.PI / 4),
  );
  const band = (a, bands) => {
    const sx = Math.cos(a + Math.PI / 4);
    const i = Math.floor(((1 - sx) / 2) * bands.length);
    return bands[Math.min(bands.length - 1, Math.max(0, i))];
  };
  for (const i of order) {
    const a0 = azimuth(i),
      a1 = azimuth(i + 1);
    fillPoly(
      png,
      [
        ring(fp, a0, W.baseRadius, PLINTH),
        ring(fp, a1, W.baseRadius, PLINTH),
        ring(fp, a1, W.topRadius, g.eave),
        ring(fp, a0, W.topRadius, g.eave),
      ],
      band((a0 + a1) / 2, TOWER_BANDS),
    );
  }
  const body = [];
  for (let i = 0; i < SLICES; i++)
    body.push(
      ring(fp, azimuth(i), W.baseRadius, PLINTH),
      ring(fp, azimuth(i), W.topRadius, g.eave),
    );
  strokePoly(png, hull(body), GREY.line);
  // the door: on the front's face at the foot, plumb as a door hangs (the wall leans back from it
  // by a pixel and a half at its head), its sides on the tower's surface at the sill. Not in the
  // views whose front is away from the camera.
  if (!hidden) {
    const [dx, dy] = turn.shaft,
      [tx, ty] = turn.across;
    const door = [
      [-W.doorWidth / 2, PLINTH],
      [W.doorWidth / 2, PLINTH],
      [W.doorWidth / 2, PLINTH + W.doorHeight],
      [-W.doorWidth / 2, PLINTH + W.doorHeight],
    ].map(([a, z]) => {
      const out = Math.sqrt(towerRadius(PLINTH) ** 2 - a * a);
      return project(fp, dx * out + tx * a, dy * out + ty * a, z);
    });
    fillPoly(png, door, GREY.opening);
    strokePoly(png, door, GREY.line);
  }
  // the cap
  const apex = project(fp, 0, 0, g.apex);
  for (const i of order) {
    const a0 = azimuth(i),
      a1 = azimuth(i + 1);
    fillPoly(
      png,
      [ring(fp, a0, W.capRadius, g.eave), ring(fp, a1, W.capRadius, g.eave), apex],
      band((a0 + a1) / 2, CAP_BANDS),
    );
  }
  const cap = [apex];
  for (let i = 0; i < SLICES; i++) cap.push(ring(fp, azimuth(i), W.capRadius, g.eave));
  strokePoly(png, hull(cap), GREY.line);
  // the eave's near edge: the half of its ring that faces the camera
  const near = [];
  for (let i = 0; i <= SLICES / 2; i++)
    near.push(ring(fp, -Math.PI / 4 + azimuth(i), W.capRadius, g.eave));
  for (let i = 0; i + 1 < near.length; i++) strokePoly(png, [near[i], near[i + 1]], GREY.line);
  if (!hidden) shaft();
  return png;
}

/** The sail cross seen face on along the shaft: four arms at 45 degrees round a plate. */
export function drawSailsFace() {
  const S = SAILS_FACE;
  const png = new PNG({ width: S.size, height: S.size });
  // pixel centres sit at +0.5, so the middle in picture px (626.5) is S.size / 2 here
  const c = S.size / 2;
  const reach = S.reach * S.size;
  const line = 1.5;
  // the end corners of a frame, with their outline, are the farthest painted points
  const end = Math.sqrt(reach ** 2 - (S.frame.halfWidth + line) ** 2) - line;
  const bar = (angle, from, to, half, rgb) => {
    const d = [Math.cos(angle), Math.sin(angle)],
      n = [-d[1], d[0]];
    const p = (t, w) => [c + d[0] * t + n[0] * w, c + d[1] * t + n[1] * w];
    const quad = [p(from, -half), p(to, -half), p(to, half), p(from, half)];
    fillPoly(png, quad, rgb);
    strokePoly(png, quad, GREY.line);
  };
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    bar(a, S.plate * 0.5, end, S.spar, [150, 150, 150]);
    bar(a, S.frame.from, end, S.frame.halfWidth, GREY.left);
    // a cross bar in the middle of the frame: the sail's bays
    const mid = (S.frame.from + end) / 2;
    bar(a, mid - 6, mid + 6, S.frame.halfWidth - 6, [150, 150, 150]);
  }
  const plate = [0, 1, 2, 3].map((k) => {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    return [c + S.plate * Math.cos(a), c + S.plate * Math.sin(a)];
  });
  fillPoly(png, plate, PLATE);
  strokePoly(png, plate, GREY.line);
  return png;
}

const round4 = (v) => Math.round(v * 1e4) / 1e4;
const pair = (p) => p.map(round4);

/**
 * The hub file of the view `rot`: where the sails turn, which way the shaft points, how the cross
 * is seen.
 */
export function windmillHub(rot = 0) {
  const g = windmillGeometry(rot);
  const W = WINDMILL;
  const turn = WINDMILL_TURNS[rot];
  const hidden = frontHidden(rot);
  const [dx, dy] = [g.hub[0] - g.axis[0], g.hub[1] - g.axis[1]];
  const len = Math.hypot(dx, dy);
  const A = crossAffine(rot);
  // the ellipse a circle of the cross becomes: the singular values of the map
  const p = A[0][0] ** 2 + A[1][0] ** 2,
    q = A[0][0] * A[0][1] + A[1][0] * A[1][1],
    r = A[0][1] ** 2 + A[1][1] ** 2;
  const mean = (p + r) / 2,
    spread = Math.hypot((p - r) / 2, q);
  const letter = (v) => (v[0] !== 0 ? 'x' : 'y');
  const sign = (v) => (v[0] + v[1] > 0 ? '+' : '-');
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  const door = {
    visible: !hidden,
    tileAxis: turn.tileAxis,
    canvas: hidden ? null : pair(g.door),
    fromAnchorGame: hidden ? null : pair(g.inGame(g.door)),
    widthTiles: round4(W.doorWidth),
    heightPx: round4(W.doorHeight),
    heightMetres: 2.1,
    widthMetres: 1,
    note: hidden
      ? 'the front is away from the camera: there is no door in this view, on either visible wall'
      : 'the person is 9 px for 1.75 m, so a metre stands 5.1429 px upright; the sill is the top of the plinth, the tower foot',
  };
  return {
    guide: `windmill-r${rot}.png`,
    view: `r${rot}`,
    rotation: rot,
    front: turn.front,
    note: 'Written by tools/building-guides.mjs: do not edit by hand.',
    canvas: g.fp.canvas,
    scale: g.fp.scale,
    anchor: g.fp.centre,
    units:
      "canvas px are the guide picture's; game px are canvas px over `scale`, from the anchor (the footprint's centre at ground level), x to the right and y down",
    hub: {
      canvas: pair(g.hub),
      fromAnchorGame: pair(g.inGame(g.hub)),
      tile: [turn.shaft[0] * W.shaftLength + 0, turn.shaft[1] * W.shaftLength + 0],
      heightAbovePlinth: g.hubZ - PLINTH,
      heightAboveGround: g.hubZ,
    },
    shaft: {
      tileAxis: turn.tileAxis,
      face: turn.face,
      lengthTiles: W.shaftLength,
      from: { canvas: pair(g.axis), tile: [0, 0] },
      screenDirection: pair([dx / len, dy / len]),
      screenSlope: round4(Math.abs(dy / dx)),
      behindTower: hidden,
    },
    door,
    tower: {
      baseRadiusTiles: W.baseRadius,
      topRadiusTiles: W.topRadius,
      heightPx: W.towerHeight,
      capHeightPx: W.capHeight,
      capRadiusTiles: W.capRadius,
      footEllipse: {
        centre: pair(project(g.fp, 0, 0, PLINTH)),
        semiMajor: round4(g.fp.scale * 32 * Math.SQRT2 * W.baseRadius),
        semiMinor: round4(g.fp.scale * 16 * Math.SQRT2 * W.baseRadius),
        minorOverMajor: 0.5,
      },
    },
    cross: {
      plane: `the plane of tile ${letter(turn.across)} and the vertical, to which the shaft (tile ${letter(turn.shaft)}) stands square`,
      uTileAxis: `${sign(turn.across)}${letter(turn.across)}`,
      seenFrom: hidden ? 'behind (the front is away from the camera)' : 'the front',
      determinantSign: det > 0 ? '+' : '-',
      affine: A.map((row) => row.map(round4)),
      formula: `screen = s * [[${A[0].map(round4).join(', ')}], [${A[1].map(round4).join(', ')}]] * (u, v), u to the right and v down in the cross's own px, s game px per cross px`,
      ellipseMinorOverMajor: round4(Math.sqrt((mean - spread) / (mean + spread))),
      sails: {
        radiusGamePx: W.sailRadius,
        gamePxPerCrossPx:
          Math.round((W.sailRadius / (SAILS_FACE.reach * SAILS_FACE.size)) * 1e6) / 1e6,
        lowestTipDropPx: round4(W.sailRadius * A[1][1]),
        lowestTipAboveGroundPx: round4(g.hubZ - W.sailRadius * A[1][1]),
        lowestTipAboveGroundMetres: round4((g.hubZ - W.sailRadius * A[1][1]) / METRE_PX),
        note: 'the radius is in the cross plane, hub to tip of the longest painted point; the lowest tip of a turning cross hangs sqrt(3)/2 of it below the hub',
      },
      sailsFace: {
        picture: 'windmill-sails-face.png',
        size: [SAILS_FACE.size, SAILS_FACE.size],
        pivot: SAILS_FACE.pivot,
        reachShare: SAILS_FACE.reach,
        armsDegrees: 45,
      },
    },
  };
}

/**
 * The windmill's files, as `[path, bytes]`: each view's guide and hub file, the sail cross after
 * the first view's.
 */
export function windmillFiles() {
  const dir = `${ROOT}/guides`;
  const view = (rot) => [
    [`${dir}/windmill-r${rot}.png`, PNG.sync.write(drawWindmill({ rot }))],
    [
      `${dir}/windmill-r${rot}-hub.json`,
      Buffer.from(JSON.stringify(windmillHub(rot), null, 2) + '\n'),
    ],
  ];
  return [
    ...view(0),
    [`${dir}/windmill-sails-face.png`, PNG.sync.write(drawSailsFace())],
    ...view(1),
    ...view(2),
    ...view(3),
  ];
}

/**
 * The coaling stage's oblong guide. The square block of the family's own guides (`blockHeight`) let
 * the painter spread the stage 15 to 26 per cent wider than its plinth (the review of the fourth
 * round, 2026-10-18: the pier feet spanned 794, 737 and 725 px of a 1254 px picture where the
 * plinth spans 631), and the fit, which scales a picture by that span, then shrank it low. This
 * guide has the stage's own plan instead: an oblong plinth of the footprint's width, six pier
 * stubs on it, and the oblong block above, the height the family asks for. The views are `r1`,
 * `r2` and `r3`: `r0` is painted and stays.
 *
 * The plan is the finished front view's (r0): the walls' two visible feet stand 0.423 : 0.577 of
 * their span (the short side on the lower left in r0), the long side carries three piers and the
 * short side two. The walls' two sides add up to what the square guide's do, so that the near
 * corner's row, the walls' span and the height the fit measures keep the square guide's numbers;
 * the plinth stands WALL_INSET outside the walls, as the footprint's does, so its width is the
 * footprint's, 64 game px.
 */
export const OBLONG = {
  family: 'fuel_stop',
  views: [1, 2, 3],
  /** the long and the short wall's share of the walls' span (r0's plan, 1 : 1.364) */
  longShare: 0.577,
  shortShare: 0.423,
  /** a pier stub's side in tiles, and its height above the plinth in game px */
  pier: { side: 0.12, height: 10 },
  /** the winch's opening on the front wall: width in tiles, height in game px */
  winch: { width: 0.16, height: 20 },
  /**
   * What the review measured of the painter, and what the painting may be: the stage's foot over
   * the plinth's width, 1.15 to 1.26, and the largest overshoot a painting may have to be
   * measured at all.
   */
  painted: { overshoot: [0.15, 0.26], tolerance: 0.05 },
  /** the size the painter's pictures came back in, and the guide's own */
  returnSize: 1254,
};

/** The pier stubs' own greys, apart from every other grey of the guides, so that a check can find them. */
export const PIER_GREY = { top: [200, 200, 200], left: [150, 150, 150], right: [104, 104, 104] };

/**
 * The coaling stage's plan for the view `rot`, in tiles from the footprint's centre: the plinth
 * (`slab`: its extent along x and along y), the block's half extents (the walls stand
 * WALL_INSET inside the plinth's edge), and the six pier centres, on the walls' lines. The long
 * side runs along y where the lower-left wall is the short one (`r0`, `r2`) and along x where it
 * is the long one (`r1`, `r3`).
 */
export function oblongPlan(rot) {
  const longX = rot % 2 === 1;
  // the walls' two sides add up to what the square guide's do: 2 * (1 - 2 * WALL_INSET) tiles
  const total = 2 * (1 - 2 * WALL_INSET);
  const long = total * OBLONG.longShare,
    short = total * OBLONG.shortShare;
  const [x1, y1] = (longX ? [long, short] : [short, long]).map((v) => v / 2);
  const slab = { x: 2 * (x1 + WALL_INSET), y: 2 * (y1 + WALL_INSET) };
  const piers = [];
  for (const y of longX ? [-y1, y1] : [-y1, 0, y1])
    for (const x of longX ? [-x1, 0, x1] : [-x1, x1]) piers.push([x, y]);
  return { longX, slab, block: { x1, y1 }, piers };
}

/** The oblong guide of the view `rot`; `height` is the family's blockHeight (game px above the plinth). */
export function drawOblong(rot, height) {
  const fp = FOOTPRINTS.t1;
  const plan = oblongPlan(rot);
  const { slab, block } = plan;
  const png = new PNG({ width: fp.canvas[0], height: fp.canvas[1] });
  drawBox(
    png,
    fp,
    { x0: -slab.x / 2, y0: -slab.y / 2, x1: slab.x / 2, y1: slab.y / 2, z0: 0, z1: PLINTH },
    { top: GREY.plinthTop, left: GREY.plinthLeft, right: GREY.plinthRight },
  );
  const pier = ([x, y]) => {
    const h = OBLONG.pier.side / 2;
    drawBox(
      png,
      fp,
      { x0: x - h, y0: y - h, x1: x + h, y1: y + h, z0: PLINTH, z1: PLINTH + OBLONG.pier.height },
      PIER_GREY,
    );
  };
  // the piers on the two far walls are behind the block, the rest stand in front of its walls
  const onNear = ([x, y]) => x === block.x1 || y === block.y1;
  const order = (a, b) => a[0] + a[1] - (b[0] + b[1]);
  plan.piers
    .filter((q) => !onNear(q))
    .sort(order)
    .forEach(pier);
  drawBox(
    png,
    fp,
    { x0: -block.x1, y0: -block.y1, x1: block.x1, y1: block.y1, z0: PLINTH, z1: PLINTH + height },
    GREY,
  );
  const winch = winchOpening(rot, plan);
  if (winch) {
    fillPoly(png, winch, GREY.opening);
    strokePoly(png, winch, GREY.line);
  }
  plan.piers.filter(onNear).sort(order).forEach(pier);
  return png;
}

/**
 * The opening that marks where the winch drum and its chain go, on the front wall when the camera
 * sees it: at the front's left end, seen from outside (the stage's own layout, r0's). That is the
 * west end of the lower-left wall in `r0` and the near end of the lower-right wall in `r3`.
 * Null where the front is away from the camera. A canvas outline.
 */
export function winchOpening(rot, plan = oblongPlan(rot)) {
  const fp = FOOTPRINTS.t1;
  const { x1, y1 } = plan.block;
  const { width, height } = OBLONG.winch;
  // the end pier takes half its side, and a gap of 0.05 tile stands between it and the opening
  const edge = OBLONG.pier.side / 2 + 0.05;
  const z0 = PLINTH,
    z1 = PLINTH + height;
  if (rot === 0) {
    const a = -x1 + edge,
      c = a + width;
    return [
      project(fp, a, y1, z0),
      project(fp, c, y1, z0),
      project(fp, c, y1, z1),
      project(fp, a, y1, z1),
    ];
  }
  if (rot === 3) {
    const c = y1 - edge,
      a = c - width;
    return [
      project(fp, x1, a, z0),
      project(fp, x1, c, z0),
      project(fp, x1, c, z1),
      project(fp, x1, a, z1),
    ];
  }
  return null;
}

/** The columns and rows that hold an opaque pixel: the first and the last of each. */
function drawnExtent(png) {
  let x0 = png.width,
    x1 = -1,
    y0 = png.height,
    y1 = -1;
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++)
      if (png.data[(y * png.width + x) * 4 + 3] > 0) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  return { x0, x1, y0, y1 };
}

/**
 * The plan file of the view `rot`: the numbers a prompt quotes, in canvas px of the guide (and for
 * the picture the painter returns, at `returnSize`). The plinth's width is what the painting
 * must hold: the piers stand on its corners, so the stage's own foot spans the same.
 */
export function oblongPlanFile(rot, height) {
  const fp = FOOTPRINTS.t1;
  const plan = oblongPlan(rot);
  const { slab, block } = plan;
  const toReturn = OBLONG.returnSize / fp.canvas[0];
  const corner = (x, y) => project(fp, x, y);
  const [w, n, e, sc] = [
    corner(-slab.x / 2, slab.y / 2),
    corner(-slab.x / 2, -slab.y / 2),
    corner(slab.x / 2, -slab.y / 2),
    corner(slab.x / 2, slab.y / 2),
  ];
  const span = e[0] - w[0];
  // the opaque width of the drawn plinth, outline included: the picture's own width
  const ext = drawnExtent(drawOblong(rot, height));
  const drawn = ext.x1 - ext.x0 + 1;
  const lowerLeft = sc[0] - w[0],
    lowerRight = e[0] - sc[0];
  // the walls' own feet, which the fit measures
  const [ww, wn, we, ws] = [
    corner(-block.x1, block.y1),
    corner(-block.x1, -block.y1),
    corner(block.x1, -block.y1),
    corner(block.x1, block.y1),
  ];
  const wallLeft = ws[0] - ww[0],
    wallRight = we[0] - ws[0];
  const [lo, hi] = [1 - OBLONG.painted.tolerance, 1 + OBLONG.painted.tolerance];
  const at = (v) => [round4(v), round4(v * toReturn)];
  const top = project(fp, -block.x1, -block.y1, PLINTH + height);
  const nearRow = project(fp, block.x1, block.y1)[1];
  const wallSpan = (block.x1 + block.y1) * 2 * 32 * fp.scale;
  const winch = winchOpening(rot, plan);
  const words = `Keep the plinth's width: the grey plinth is ${Math.round(drawn)} px wide in the guide (${Math.round(drawn * toReturn)} px in a ${OBLONG.returnSize} px picture), the stage's piers stand at its corners and on it, and the painted stage is no wider than ${Math.round(drawn * hi)} px of the guide (${Math.round(drawn * hi * toReturn)} px of ${OBLONG.returnSize}): the painter has made it ${Math.round(OBLONG.painted.overshoot[0] * 100)} to ${Math.round(OBLONG.painted.overshoot[1] * 100)} per cent wider before, and the fit then shrinks the whole stage.`;
  return {
    guide: `fuel_stop-oblong-r${rot}.png`,
    view: `r${rot}`,
    rotation: rot,
    family: OBLONG.family,
    note: 'Written by tools/building-guides.mjs: do not edit by hand.',
    canvas: fp.canvas,
    scale: fp.scale,
    anchor: fp.centre,
    units:
      "canvas px are the guide picture's; the picture the painter returns is `returnSize` px square, `toReturn` times as large",
    returnSize: OBLONG.returnSize,
    toReturn: round4(toReturn),
    plan: {
      longSide: plan.longX ? 'lower left' : 'lower right',
      shortSide: plan.longX ? 'lower right' : 'lower left',
      /** the walls' feet, as the fit measures them: the lower-left over the lower-right foot */
      lowerLeftOverLowerRight: round4(wallLeft / wallRight),
      lowerLeftShare: round4(wallLeft / (wallLeft + wallRight)),
      lowerRightShare: round4(wallRight / (wallLeft + wallRight)),
      slabTiles: [round4(slab.x), round4(slab.y)],
      blockTiles: [round4(2 * block.x1), round4(2 * block.y1)],
      pierSide: OBLONG.pier.side,
      pierHeightPx: OBLONG.pier.height,
    },
    walls: {
      corners: { w: pair(ww), s: pair(ws), e: pair(we), n: pair(wn) },
      spanPx: round4(we[0] - ww[0]),
      lowerLeftFootPx: round4(wallLeft),
      lowerRightFootPx: round4(wallRight),
    },
    plinth: {
      corners: { w: pair(w), s: pair(sc), e: pair(e), n: pair(n) },
      /** the corners' span: the width the fit measures */
      spanPx: round4(span),
      /** the opaque width of the drawn plinth, its 3 px outline included, as a painted stage is measured */
      drawnWidthPx: at(drawn),
      lowerLeftFootPx: round4(lowerLeft),
      lowerRightFootPx: round4(lowerRight),
    },
    paintedWidth: {
      mustHoldPx: at(drawn),
      minPx: at(drawn * lo),
      maxPx: at(drawn * hi),
      tolerance: OBLONG.painted.tolerance,
      measuredOvershoot: OBLONG.painted.overshoot,
      note: 'the painter kept the block-out height but painted the stage 15 to 26 per cent wider than the plinth (review 2026-10-18): the numbers are [guide px, returned-picture px]',
      words,
    },
    piers: plan.piers.map(([x, y], i) => ({
      id: i + 1,
      tile: [round4(x), round4(y)],
      foot: pair(project(fp, x, y, PLINTH)),
      wall:
        y === block.y1 && x === block.x1
          ? 'both: the near corner'
          : y === block.y1
            ? 'lower left'
            : x === block.x1
              ? 'lower right'
              : 'hidden',
    })),
    block: {
      heightPx: height,
      topFarCornerRow: round4(top[1]),
      nearCornerRow: round4(nearRow),
      wallSpanPx: round4(wallSpan),
      note: 'the fit measures height as (nearCornerRow - box.top) / wallSpanPx: the same rows and span as the square guide, since the two sides of the walls add up to the same two tiles',
    },
    winch: winch
      ? {
          visible: true,
          outline: winch.map(pair),
          note: 'where the winch drum and its chain stand: the front wall, at its left end seen from outside',
        }
      : {
          visible: false,
          note: 'the front is away from the camera: no winch, chain or chute in this view',
        },
  };
}

/** The oblong guide's files, as `[path, bytes]`: for each view the picture, then its plan file. */
export function oblongFiles(height) {
  const dir = `${ROOT}/guides`;
  return OBLONG.views.flatMap((rot) => [
    [`${dir}/${OBLONG.family}-oblong-r${rot}.png`, PNG.sync.write(drawOblong(rot, height))],
    [
      `${dir}/${OBLONG.family}-oblong-r${rot}-plan.json`,
      Buffer.from(JSON.stringify(oblongPlanFile(rot, height), null, 2) + '\n'),
    ],
  ]);
}

/**
 * The plan guides of the second review round (issue #535): a camera and pose guide for each
 * turned view that a repaint is wanted for, drawn on the footprint the game gives the building
 * (gameplay room, in tiles at rotation 0: a quarter turn swaps its sides). Each is a flat plinth
 * that is the footprint at that rotation, with a plain grey base on it that fills `PLAN.fill`
 * (90 per cent) of the footprint's long side and stays inside it, and the front door marked on
 * the front wall where the camera sees it. The painter spread the coaling stage 15 to 26 per
 * cent wider than its plinth, and the fit then shrinks what is painted too wide, so each guide has
 * a plan file with the numbers a prompt quotes: the canvas, the ground line, the footprint's
 * corners and the width the painted base may have (`paintedWidth`, worded as the coaling stage's).
 * The files are `guides/review2/<job>-r<view>.png` and `-plan.json`.
 */
export const PLAN = {
  /** the base's share of the footprint's long side (and of its short side, for a plain box) */
  fill: 0.9,
  /** the painted base may be this much wider or narrower than the drawn one */
  tolerance: 0.05,
  /** the front door's mark: width in tiles along the wall, height in game px above the plinth */
  door: { width: 0.2, height: 18 },
  dir: `${ROOT}/guides/review2`,
};

/**
 * The canvases: the sizes the painter is asked for, as the footprints' own, and one more, for a
 * footprint of 3 x 2 tiles. `returned` is the size the image tool gives back (the 1024 px square
 * came back 1254 px square, the 1536 x 1024 canvas of the depot came back as it was asked for; a
 * tall house's canvas is taken to do the same).
 */
export const PLAN_CANVAS = {
  t1: { ...FOOTPRINTS.t1, returned: [1254, 1254] },
  t1x2: { ...FOOTPRINTS.t1x2, returned: [1254, 1254] },
  t2x2: { ...FOOTPRINTS.t2x2, returned: [1536, 1024] },
  t1tall: { ...FOOTPRINTS.t1tall, returned: [1024, 1536] },
  t3x2: {
    id: 't3x2',
    canvas: [1536, 1024],
    scale: 5,
    centre: [768, 740],
    tiles: [3, 2],
    returned: [1536, 1024],
  },
};

/**
 * The jobs, in the order of the review: `id` (the family's or the building's own), `span` the
 * footprint in tiles at rotation 0 (width along x, depth along y; the front is the S wall, along
 * x), `canvas` one of PLAN_CANVAS, `height` the base's own height in game px above the plinth,
 * `views` the rotations that are asked for, and `shares` (a 1 x 1 footprint only) the base's two
 * sides at r0, lower left over lower right, where the finished r0 has an oblong plan that the
 * turned views must keep: the long side then fills `PLAN.fill` and the short one its share of it.
 */
export const PLAN_JOBS = [
  {
    id: 'big_station',
    name: 'Big station (the old station picture, base-v1 station.png)',
    span: [2, 1],
    canvas: 't1x2',
    height: 36,
    views: [1, 2, 3],
  },
  {
    id: 'town',
    name: 'Town hall (the illustrated r0)',
    span: [2, 1],
    canvas: 't1x2',
    height: 46,
    views: [1, 2, 3],
  },
  {
    id: 'warehouse',
    name: 'Warehouse',
    span: [2, 1],
    canvas: 't1x2',
    height: 34,
    views: [1, 2, 3],
  },
  {
    id: 'farm',
    name: 'Small farm halt (buildings-v2, a0)',
    span: [1, 1],
    canvas: 't1',
    height: 40,
    views: [1, 3],
    shares: [0.557, 0.443],
    basis:
      "farm-a0-r0.png's walls' feet, measured with measureBase of tools/building-fit.mjs: 532 px lower left, 422 px lower right of 954 px in a 1254 px picture",
  },
  {
    id: 'big_farm',
    name: 'Big farm (the old farm picture, base-v1 farm.png)',
    span: [1, 2],
    canvas: 't1x2',
    height: 40,
    views: [1, 2, 3],
  },
  {
    id: 'quarry',
    name: 'Quarry (buildings-v2, a0)',
    span: [1, 1],
    canvas: 't1',
    height: 40,
    views: [2],
    shares: [0.547, 0.453],
    basis:
      "quarry-a0-r0.png's walls' feet, measured with measureBase of tools/building-fit.mjs: 430 px lower left, 357 px lower right of 787 px in a 1254 px picture",
  },
  {
    id: 'pump',
    name: 'Water pump',
    span: [1, 1],
    canvas: 't1',
    height: 30,
    views: [1, 2, 3],
  },
  {
    id: 'grinder',
    name: 'Stone grinder',
    span: [1, 1],
    canvas: 't1',
    height: 40,
    views: [1, 2, 3],
  },
  {
    id: 'refinery',
    name: 'Oil refinery',
    span: [1, 1],
    canvas: 't1',
    height: 50,
    views: [1, 2, 3],
  },
  {
    id: 'power_plant',
    name: 'Power plant',
    span: [3, 2],
    canvas: 't3x2',
    height: 56,
    views: [1, 2, 3],
  },
  {
    id: 'substation',
    name: 'Battery (the `substation` id)',
    span: [2, 2],
    canvas: 't2x2',
    height: 36,
    views: [0, 1, 2, 3],
  },
  {
    id: 'hydro_plant',
    name: 'Hydro plant (a new design: an oblong powerhouse, apart from the square water pump)',
    span: [1, 1],
    canvas: 't1',
    height: 40,
    views: [0, 1, 2, 3],
    shares: [0.59, 0.41],
    basis:
      "a design choice: a powerhouse 1.44 times as long as it is deep, so that its silhouette is not the water pump's square",
  },
  {
    id: 'colliery',
    name: 'Colliery',
    span: [2, 2],
    canvas: 't2x2',
    height: 56,
    views: [0, 1, 2, 3],
  },
  {
    id: 'ironworks',
    name: 'Ironworks',
    span: [2, 2],
    canvas: 't2x2',
    height: 56,
    views: [0, 1, 2, 3],
  },
  {
    id: 'oil_derrick',
    name: 'Oil derrick',
    span: [2, 1],
    canvas: 't1x2',
    height: 24,
    views: [1, 2, 3],
  },
  {
    id: 'townhouse',
    name: 'House (townhouse)',
    span: [1, 1],
    canvas: 't1tall',
    height: 40,
    views: [1, 2, 3],
  },
  {
    id: 'fuel_pump',
    name: 'Fuel pump (the diesel-age tank on a brick house, #325)',
    span: [1, 1],
    canvas: 't1',
    height: 44,
    views: [1, 2, 3],
    shares: [0.562, 0.438],
    basis:
      'fuel_pump-a1-r0.png of origin/art/325-fuel-pump, measured with measureBase of tools/building-fit.mjs: 441 px lower left, 344 px lower right of 785 px in a 1254 px picture; the r1 it has today measures 187 : 447 and is too thin',
  },
];

/** Where a plan guide and its plan file are kept. */
export const planGuideFile = (id, rot) => `${PLAN.dir}/${id}-r${rot}.png`;
export const planFileOf = (id, rot) => `${PLAN.dir}/${id}-r${rot}-plan.json`;

/** The footprint's width along x and depth along y in tiles, turned to `rot`. */
export function planTiles(job, rot) {
  const [w, h] = job.span;
  return rot % 2 === 0 ? { w, h } : { w: h, h: w };
}

/**
 * The base's extents along x and along y in tiles, turned to `rot`. At r0 the long side of the
 * footprint is filled to `PLAN.fill`; for an oblong plan (`shares`) the other side of the base is
 * its share of that, and a quarter turn swaps the sides.
 */
export function planBase(job, rot) {
  const [w0, h0] = job.span;
  let fx = PLAN.fill,
    fy = PLAN.fill;
  if (job.shares) {
    const [a, b] = job.shares;
    if (a >= b) fy = (PLAN.fill * b) / a;
    else fx = (PLAN.fill * a) / b;
  }
  const bx = fx * w0,
    by = fy * h0;
  return rot % 2 === 0 ? { x: bx, y: by } : { x: by, y: bx };
}

/** The front door's mark on the wall the camera sees as the front, as a canvas outline; null where it cannot be seen. */
export function planDoor(job, rot) {
  const fp = PLAN_CANVAS[job.canvas];
  const base = planBase(job, rot);
  const x1 = base.x / 2,
    y1 = base.y / 2;
  const a = -PLAN.door.width / 2,
    c = PLAN.door.width / 2;
  const z0 = PLINTH,
    z1 = PLINTH + PLAN.door.height;
  for (const wall of ['S', 'E']) {
    if (wallRole(wall, rot) !== 'front') continue;
    return wall === 'S'
      ? [
          project(fp, a, y1, z0),
          project(fp, c, y1, z0),
          project(fp, c, y1, z1),
          project(fp, a, y1, z1),
        ]
      : [
          project(fp, x1, a, z0),
          project(fp, x1, c, z0),
          project(fp, x1, c, z1),
          project(fp, x1, a, z1),
        ];
  }
  return null;
}

/** The plan guide of `job` for the view `rot`: the plinth that is the footprint, the base, the front door. */
export function drawPlan(job, rot, { plinth = true } = {}) {
  const fp = PLAN_CANVAS[job.canvas];
  const png = new PNG({ width: fp.canvas[0], height: fp.canvas[1] });
  const { w, h } = planTiles(job, rot);
  if (plinth)
    drawBox(
      png,
      fp,
      { x0: -w / 2, y0: -h / 2, x1: w / 2, y1: h / 2, z0: 0, z1: PLINTH },
      { top: GREY.plinthTop, left: GREY.plinthLeft, right: GREY.plinthRight },
    );
  const base = planBase(job, rot);
  drawBox(
    png,
    fp,
    {
      x0: -base.x / 2,
      y0: -base.y / 2,
      x1: base.x / 2,
      y1: base.y / 2,
      z0: PLINTH,
      z1: PLINTH + job.height,
    },
    GREY,
  );
  const door = planDoor(job, rot);
  if (door) {
    fillPoly(png, door, GREY.opening);
    strokePoly(png, door, GREY.line);
  }
  return png;
}

const sideName = (x, y) =>
  Math.abs(x - y) < 1e-9 ? 'equal' : x > y ? 'lower left' : 'lower right';

/**
 * The plan file of `job` for the view `rot`: the numbers a prompt quotes, in canvas px of the guide
 * and, second, of the picture the image tool returns (`toReturn` times as large).
 */
export function planFile(job, rot) {
  const fp = PLAN_CANVAS[job.canvas];
  const { w, h } = planTiles(job, rot);
  const base = planBase(job, rot);
  const toReturn = fp.returned[0] / fp.canvas[0];
  const at = (v) => [round4(v), round4(v * toReturn)];
  const ring4 = (x, y, z = 0) => ({
    w: pair(project(fp, -x, y, z)),
    s: pair(project(fp, x, y, z)),
    e: pair(project(fp, x, -y, z)),
    n: pair(project(fp, -x, -y, z)),
  });
  const foot = ring4(w / 2, h / 2);
  const feet = ring4(base.x / 2, base.y / 2);
  const baseOnly = drawnExtent(drawPlan(job, rot, { plinth: false }));
  const whole = drawnExtent(drawPlan(job, rot));
  const baseWidth = baseOnly.x1 - baseOnly.x0 + 1;
  const footprintWidth = whole.x1 - whole.x0 + 1;
  const [lo, hi] = [1 - PLAN.tolerance, 1 + PLAN.tolerance];
  const maxWidth = Math.min(baseWidth * hi, footprintWidth);
  const longTiles = Math.max(w, h);
  const baseLong = Math.max(base.x, base.y);
  const turn = ['S', 'W', 'N', 'E'][rot];
  const door = planDoor(job, rot);
  const shown = ['lower left', null, null, 'lower right'][rot];
  const words = `Keep the base to the footprint: the grey plinth is the footprint, ${footprintWidth} px wide in the guide (${Math.round(footprintWidth * toReturn)} px in a ${fp.returned[0]} px wide picture), and the base stands on it and fills ${Math.round((100 * baseLong) / longTiles)} per cent of its long side (${round4(baseLong)} of ${longTiles} tiles). The painted base, the foot of the walls from the left corner to the right corner, is ${baseWidth} px wide in the guide (${Math.round(baseWidth * toReturn)} px), no wider than ${Math.round(maxWidth)} px (${Math.round(maxWidth * toReturn)} px) and never outside the footprint: the painter has spread a building 15 to 26 per cent wider than its plinth before, and the fit then shrinks the whole building.`;
  return {
    guide: `review2/${job.id}-r${rot}.png`,
    job: job.id,
    name: job.name,
    view: `r${rot}`,
    rotation: rot,
    note: 'Written by tools/building-guides.mjs: do not edit by hand.',
    canvas: fp.canvas,
    scale: fp.scale,
    anchor: fp.centre,
    units:
      "canvas px are the guide picture's; the picture the image tool returns is `returnSize` px, `toReturn` times as large; a tile is 64 x 32 game px and a game px is `scale` canvas px",
    returnSize: fp.returned,
    toReturn: round4(toReturn),
    footprint: {
      tilesAtR0: job.span,
      tiles: [w, h],
      note: 'gameplay room: the width along x and the depth along y at rotation 0; a quarter turn swaps them',
      longSide: sideName(w, h),
      longSideTiles: longTiles,
      corners: foot,
      spanPx: round4((w + h) * 32 * fp.scale),
      drawnWidthPx: at(footprintWidth),
      lowerLeftFootPx: round4(w * 32 * fp.scale),
      lowerRightFootPx: round4(h * 32 * fp.scale),
    },
    groundLine: {
      anchorRow: fp.centre[1],
      nearCornerRow: foot.s[1],
      farCornerRow: foot.n[1],
      leftCornerRow: foot.w[1],
      rightCornerRow: foot.e[1],
      lowerLeft: [foot.w, foot.s],
      lowerRight: [foot.s, foot.e],
      slope: 0.5,
      note: "the footprint's two visible edges at ground level, 2:1 lines; the base's feet are parallel to them, inside them",
    },
    front: {
      wall: turn,
      visible: door !== null,
      visibleOn: shown,
    },
    plan: {
      basis: job.basis ?? `a plain box: ${PLAN.fill} of each side of the footprint`,
      baseTiles: [round4(base.x), round4(base.y)],
      fillOfLongSide: round4(baseLong / longTiles),
      fillOfShortSide: round4(Math.min(base.x, base.y) / Math.min(w, h)),
      longSide: sideName(base.x, base.y),
      lowerLeftOverLowerRight: round4(base.x / base.y),
      lowerLeftShare: round4(base.x / (base.x + base.y)),
      lowerRightShare: round4(base.y / (base.x + base.y)),
    },
    base: {
      corners: feet,
      spanPx: round4((base.x + base.y) * 32 * fp.scale),
      lowerLeftFootPx: round4(base.x * 32 * fp.scale),
      lowerRightFootPx: round4(base.y * 32 * fp.scale),
      heightPx: job.height,
      topFarCornerRow: round4(project(fp, -base.x / 2, -base.y / 2, PLINTH + job.height)[1]),
      nearCornerRow: feet.s[1],
    },
    paintedWidth: {
      mustHoldPx: at(baseWidth),
      minPx: at(baseWidth * lo),
      maxPx: at(maxWidth),
      tolerance: PLAN.tolerance,
      footprintWidthPx: at(footprintWidth),
      longSideTiles: round4(baseLong),
      shareOfFootprintLongSide: round4(baseLong / longTiles),
      insideFootprint: true,
      measuredOvershoot: OBLONG.painted.overshoot,
      note: 'the base is measured as the coaling stage was: the opaque width of the drawn base, its 3 px outline included; the numbers are [guide px, returned-picture px]; the painter has made a building 15 to 26 per cent wider than its plinth (review 2026-10-18)',
      words,
    },
    door: door
      ? {
          visible: true,
          outline: door.map(pair),
          widthTiles: PLAN.door.width,
          heightPx: PLAN.door.height,
          note: `the front door, on the ${shown} wall, in the middle of the wall`,
        }
      : {
          visible: false,
          note: `the front (${turn}) is away from the camera: no front door in this view, on either visible wall`,
        },
  };
}

/** The plan guides' files, as `[path, bytes]`: for each job and view the picture, then its plan file. */
export function planFiles() {
  return PLAN_JOBS.flatMap((job) =>
    job.views.flatMap((rot) => [
      [planGuideFile(job.id, rot), PNG.sync.write(drawPlan(job, rot))],
      [planFileOf(job.id, rot), Buffer.from(JSON.stringify(planFile(job, rot), null, 2) + '\n')],
    ]),
  );
}

/** The families that ask for a block of their own: `{ family, footprint, height }`. */
export function familyBlocks(inventory, families) {
  return inventory
    .filter((f) => families.families[f.family]?.blockHeight !== undefined)
    .map((f) => ({
      family: f.family,
      footprint: f.footprint,
      height: families.families[f.family].blockHeight,
    }));
}

/** The families of families.json that ask for the windmill's guide kind. */
export const windmillFamilies = (families) =>
  Object.entries(families.families)
    .filter(([, f]) => f.guideKind === 'windmill')
    .map(([family]) => family);

/**
 * Write a guide for every footprint and rotation, a set for every family with a `blockHeight`
 * (read from families.json and the game's data in the working directory), the windmill's files
 * when a family asks for that guide kind, and the coaling stage's oblong guides (`blocks` and
 * `windmill` stand in for them).
 */
export function writeGuides(root = '.', blocks = null, windmill = null, plans = null) {
  const families = JSON.parse(readFileSync(join(ROOT, 'families.json'), 'utf8'));
  blocks ??= familyBlocks(loadInventory(), families);
  windmill ??= windmillFamilies(families).length > 0;
  plans ??= true;
  const out = [];
  const write = (file, bytes) => {
    file = join(root, file);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    out.push(file);
  };
  for (const fpId of Object.keys(FOOTPRINTS))
    for (const r of ROTATIONS)
      write(guideFile(fpId, r.index), PNG.sync.write(drawGuide(fpId, r.index)));
  for (const b of blocks)
    for (const r of ROTATIONS)
      write(
        guideFile(b.footprint, r.index, b.family),
        PNG.sync.write(drawGuide(b.footprint, r.index, b.height)),
      );
  if (windmill) for (const [file, bytes] of windmillFiles()) write(file, bytes);
  for (const b of blocks)
    if (b.family === OBLONG.family)
      for (const [file, bytes] of oblongFiles(b.height)) write(file, bytes);
  if (plans) for (const [file, bytes] of planFiles()) write(file, bytes);
  return out;
}

if (isMain(import.meta.url)) {
  const files = writeGuides(process.argv[2] ?? '.');
  console.log(`${files.length} guides in ${dirname(files[0])}`);
}
