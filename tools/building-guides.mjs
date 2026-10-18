/** Draw the building guides: a grey block-out per footprint and rotation, in the game's projection.
 * node tools/building-guides.mjs [output directory]
 * A picture is painted as an edit of its guide, so every picture of a footprint comes out with the
 * same camera, scale and position. The footprint is a low plinth; on it stands a plain block whose
 * front carries a door, and whose end walls carry the portals when it is a depot. Faces are flat
 * greys by the way they look: top light, lower-left wall mid, lower-right wall dark. The block's
 * height is the footprint's, unless a family names its own (`blockHeight` in families.json): that
 * family then has guides of its own, `guides/<family>-r<view>.png`.
 * The windmill has a guide kind of its own (`guideKind: "windmill"` in families.json): a round
 * tower with its windshaft stub on the lower-left face, a hub file that says where the sails
 * turn, and the sail cross seen face on (`windmillFiles`).
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
 * The windmill: a round tower (a truncated cone) under a cone cap, on the footprint's plinth, with
 * its windshaft stub pointing along tile +y, which is the lower-left face, and a door at the foot
 * of the same face. Lengths in tiles; heights and radii of small parts in game px, heights above
 * the plinth (the `blockHeight` sense of the other guides).
 */
export const WINDMILL = {
  footprint: 't1',
  /** from the plinth to where the cap begins */
  towerHeight: 52,
  baseRadius: 0.3,
  topRadius: 0.2,
  capHeight: 18,
  /** the eave stands a little proud of the tower's top */
  capRadius: 0.23,
  /** the shaft runs from the tower's axis along +y, and the hub is at its end */
  shaftLength: 0.38,
  /** the hub's height above the eave: on the lower part of the cap */
  hubAboveEave: 7,
  doorWidth: 0.12,
  doorHeight: 14,
  /** the stub's radius and the hub plate's, which faces +y */
  stubRadius: 1.5,
  plateRadius: 5,
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
 * The map of the plane of tile x and the vertical (the plane square to the shaft) onto the
 * screen, for a cross of unit scale: (u right, v down) to (screen x, screen y).
 */
export const CROSS_AFFINE = [
  [Math.SQRT1_2, 0],
  [Math.SQRT1_2 / 2, Math.sqrt(3) / 2],
];

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

/** Where the windmill's parts stand on its canvas. */
export function windmillGeometry() {
  const fp = FOOTPRINTS[WINDMILL.footprint];
  const eave = PLINTH + WINDMILL.towerHeight;
  const hubZ = eave + WINDMILL.hubAboveEave;
  const doorZ = PLINTH + WINDMILL.doorHeight / 2;
  return {
    fp,
    eave,
    apex: eave + WINDMILL.capHeight,
    hubZ,
    hub: project(fp, 0, WINDMILL.shaftLength, hubZ),
    axis: project(fp, 0, 0, hubZ),
    door: project(fp, 0, towerRadius(doorZ), doorZ),
    /** a canvas point in game px from the anchor */
    inGame: (p) => [(p[0] - fp.centre[0]) / fp.scale, (p[1] - fp.centre[1]) / fp.scale],
  };
}

/** The windmill's guide: plinth, tower, door, cap, windshaft stub and the hub plate. */
export function drawWindmill({ plinth = true } = {}) {
  const g = windmillGeometry();
  const { fp } = g;
  const W = WINDMILL;
  const png = new PNG({ width: fp.canvas[0], height: fp.canvas[1] });
  // the plinth is the footprint, as for every guide (`plinth: false` for a stand-in picture)
  if (plinth)
    drawBox(
      png,
      fp,
      { x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5, z0: 0, z1: PLINTH },
      { top: GREY.plinthTop, left: GREY.plinthLeft, right: GREY.plinthRight },
    );
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
  // the door: on the +y face at the foot, its sides on the tower's surface
  const door = [
    [-W.doorWidth / 2, PLINTH],
    [W.doorWidth / 2, PLINTH],
    [W.doorWidth / 2, PLINTH + W.doorHeight],
    [-W.doorWidth / 2, PLINTH + W.doorHeight],
  ].map(([x, z]) => project(fp, x, Math.sqrt(towerRadius(z) ** 2 - x * x), z));
  fillPoly(png, door, GREY.opening);
  strokePoly(png, door, GREY.line);
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
  // the windshaft stub, a cylinder along +y from the cap to the hub, and the hub plate
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
    plate.push([
      g.hub[0] + CROSS_AFFINE[0][0] * u + CROSS_AFFINE[0][1] * v,
      g.hub[1] + CROSS_AFFINE[1][0] * u + CROSS_AFFINE[1][1] * v,
    ]);
  }
  fillPoly(png, plate, PLATE);
  strokePoly(png, plate, GREY.line);
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

/** The hub file: where the sails turn, which way the shaft points, how the cross is seen. */
export function windmillHub() {
  const g = windmillGeometry();
  const W = WINDMILL;
  const [dx, dy] = [g.hub[0] - g.axis[0], g.hub[1] - g.axis[1]];
  const len = Math.hypot(dx, dy);
  const A = CROSS_AFFINE;
  // the ellipse a circle of the cross becomes: the singular values of the map
  const p = A[0][0] ** 2 + A[1][0] ** 2,
    q = A[0][0] * A[0][1] + A[1][0] * A[1][1],
    r = A[0][1] ** 2 + A[1][1] ** 2;
  const mean = (p + r) / 2,
    spread = Math.hypot((p - r) / 2, q);
  return {
    guide: 'windmill-r0.png',
    note: 'Written by tools/building-guides.mjs: do not edit by hand.',
    canvas: g.fp.canvas,
    scale: g.fp.scale,
    anchor: g.fp.centre,
    units:
      "canvas px are the guide picture's; game px are canvas px over `scale`, from the anchor (the footprint's centre at ground level), x to the right and y down",
    hub: {
      canvas: pair(g.hub),
      fromAnchorGame: pair(g.inGame(g.hub)),
      tile: [0, W.shaftLength],
      heightAbovePlinth: g.hubZ - PLINTH,
      heightAboveGround: g.hubZ,
    },
    shaft: {
      tileAxis: '+y',
      face: 'lower left',
      lengthTiles: W.shaftLength,
      from: { canvas: pair(g.axis), tile: [0, 0] },
      screenDirection: pair([dx / len, dy / len]),
      screenSlope: round4(Math.abs(dy / dx)),
    },
    door: {
      canvas: pair(g.door),
      fromAnchorGame: pair(g.inGame(g.door)),
      widthTiles: W.doorWidth,
      heightPx: W.doorHeight,
    },
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
      plane: 'the plane of tile x and the vertical, to which the shaft (tile y) stands square',
      affine: A.map((row) => row.map(round4)),
      formula:
        "screen = s * [[0.7071, 0], [0.3536, 0.866]] * (u, v), u to the right and v down in the cross's own px, s game px per cross px",
      ellipseMinorOverMajor: round4(Math.sqrt((mean - spread) / (mean + spread))),
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

/** The windmill's three files, as `[path, bytes]`. */
export function windmillFiles() {
  const dir = `${ROOT}/guides`;
  return [
    [`${dir}/windmill-r0.png`, PNG.sync.write(drawWindmill())],
    [`${dir}/windmill-r0-hub.json`, Buffer.from(JSON.stringify(windmillHub(), null, 2) + '\n')],
    [`${dir}/windmill-sails-face.png`, PNG.sync.write(drawSailsFace())],
  ];
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
 * (read from families.json and the game's data in the working directory), and the windmill's three
 * files when a family asks for that guide kind (`blocks` and `windmill` stand in for them).
 */
export function writeGuides(root = '.', blocks = null, windmill = null) {
  const families = JSON.parse(readFileSync(join(ROOT, 'families.json'), 'utf8'));
  blocks ??= familyBlocks(loadInventory(), families);
  windmill ??= windmillFamilies(families).length > 0;
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
  return out;
}

if (isMain(import.meta.url)) {
  const files = writeGuides(process.argv[2] ?? '.');
  console.log(`${files.length} guides in ${dirname(files[0])}`);
}
