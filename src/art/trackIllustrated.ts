import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import type { Vec2 } from '../engine/iso';
import { hash2 } from '../engine/rng';
import {
  linkPoints,
  unitDef,
  unitIconPaths,
  unitRailPaths,
  type SwitchForm,
} from '../world/trackGeom';
import {
  TRACK_CLASSES,
  TRACK_ITEMS,
  CLASS_N,
  itemKey,
  isUnitKind,
  pieceLinks,
  rotationCount,
  type TrackClass,
  type TrackItem,
} from '../world/track';
import { PAL, css, mix, shade, type RGB } from './palette';
import { NO_MATERIALS, drawSprite, drawStrip, type TrackMaterials } from './trackMaterials';

const R = 4,
  W = 72,
  H = 44,
  OX = 36,
  OY = 20;
/**
 * One rail line on a frame. A line the frame holds whole lays its sleepers over its own length.
 * `run` is for a line that is only part of a longer one drawn in several parts: `start` is the
 * distance along the whole run at which this part begins, `length` the whole run's length and
 * `cls` the line whose spacing the whole run takes, so the sleepers keep one pitch across the parts.
 */
export type RailPath = {
  points: Vec2[];
  cls: TrackClass;
  run?: { start: number; length: number; cls: TrackClass };
};
/**
 * Per line: each rail's offset from the centre line, half a sleeper's length, sleeper spacing,
 * ballast shoulder and colours, sleeper colours, rail line widths and colours. Narrow Gauge puts
 * its rails half as far apart on short, closely spaced timber sleepers laid straight on the
 * ground, with no ballast, like a forest or mine line. Branch Line lies on timber in warm stone;
 * Main Line on concrete sleepers in a wider, cleaner bed; Trunk Line has heavier, darker rail on
 * wide concrete sleepers in deep dark basalt.
 */
interface LineStyle {
  rail: number;
  sleeper: number;
  step: number;
  shoulder: number;
  /** a bed of ballast under the sleepers */
  bed: boolean;
  /** the bed's fill, then its stones: light, dark and the rest */
  ballast: [string, string, string, string];
  tie: string;
  tieHi: string;
  widths: [number, number, number];
  /** the rail's foot, web and head (`RAIL_LINES`) */
  railColors: [string, string, string];
}
const RAIL_STEEL: LineStyle['railColors'] = ['#4c4940', '#827d70', '#d1c7ac'];
const BRANCH: LineStyle = {
  rail: 0.16,
  sleeper: 0.235,
  step: 0.14,
  shoulder: 0.29,
  bed: true,
  ballast: ['#827b69', '#a99c82', '#6f695b', '#918570'],
  tie: '#725039',
  tieHi: '#a17c52',
  widths: [1.25, 0.95, 0.4],
  railColors: RAIL_STEEL,
};
const STYLE: Record<TrackClass, LineStyle> = {
  branch: BRANCH,
  main: {
    ...BRANCH,
    shoulder: 0.35,
    // pale cool granite chips: clearly lighter than Branch's warm stone, far lighter than Trunk
    ballast: ['#a9aaa7', '#d0d2ce', '#8b8d8a', '#babcb8'],
    tie: '#cdc9bd',
    tieHi: '#e6e2d7',
  },
  trunk: {
    ...BRANCH,
    sleeper: 0.255,
    shoulder: 0.38,
    // near-black basalt with darker concrete: the darkest bed of all
    ballast: ['#3c3b3a', '#5a5855', '#2a2a29', '#474644'],
    tie: '#8e8b83',
    tieHi: '#aeaba2',
    widths: [1.5, 1.15, 0.48],
    railColors: ['#35332e', '#67635a', '#c2b89e'],
  },
  // a pale concrete guideway: no ballast, close stator plates, two guide rails
  maglev: {
    ...BRANCH,
        shoulder: 0.3,
    ballast: ['#b8bcbd', '#c9cdce', '#a9adae', '#bfc3c4'],
    tie: '#a4aaac',
    tieHi: '#b4babc',
    widths: [1.1, 0.85, 0.45],
    railColors: ['#59646a', '#7c8a91', '#c3dce4'],
  },
  // Hyperloop has no pieces to draw yet: it takes Branch's look
  hyperloop: BRANCH,
  narrow: {
    rail: 0.08,
    sleeper: 0.14,
    step: 0.115,
    shoulder: 0.19,
    bed: false,
    ballast: BRANCH.ballast,
    tie: '#664631',
    tieHi: '#8f6c47',
    widths: [0.95, 0.72, 0.32],
    railColors: RAIL_STEEL,
  },
};

const perClass = <T>(pick: (style: (typeof STYLE)[TrackClass]) => T) =>
  Object.fromEntries(TRACK_CLASSES.map((c) => [c, pick(STYLE[c])])) as Record<TrackClass, T>;
/** Each rail's offset from the centre line, per class, in tiles: half the gauge. */
export const RAIL_OFFSET: Readonly<Record<TrackClass, number>> = perClass((s) => s.rail);
/** How far the ballast bed reaches from the centre line, per class, in tiles. */
export const BED_SHOULDER: Readonly<Record<TrackClass, number>> = perClass((s) => s.shoulder);

/** The lines a road crosses on the level (`LineDef.roadCrossing`). */
export const LEVEL_CROSSING_CLASSES = [
  'branch',
  'main',
  'narrow',
] as const satisfies readonly TrackClass[];
export type LevelCrossingClass = (typeof LEVEL_CROSSING_CLASSES)[number];
/** How far a level crossing's deck reaches past each rail, in tiles (item 18). */
export const LEVEL_CROSSING_MARGIN = 0.1;
/**
 * Half a level crossing deck's size across the track, in tiles from the centre line: 0.1 tile
 * outside each rail (0.26 Branch and Main, 0.18 Narrow), inside the line's ballast bed.
 */
export const LEVEL_CROSSING_ACROSS: Readonly<Record<LevelCrossingClass, number>> = {
  branch: RAIL_OFFSET.branch + LEVEL_CROSSING_MARGIN,
  main: RAIL_OFFSET.main + LEVEL_CROSSING_MARGIN,
  narrow: RAIL_OFFSET.narrow + LEVEL_CROSSING_MARGIN,
};
/** Half a level crossing deck's size along the track, in tiles: half the road's 0.32 (#329). */
export const LEVEL_CROSSING_ALONG = 0.16;
/**
 * The frame of the deck a road lays over `straight_<cls>_<rotation>`, anchored as that frame.
 * (`track/crossing_*` already names the track diamonds.)
 */
export const levelCrossingFrame = (cls: LevelCrossingClass, rotation: number) =>
  `track/level_crossing_${cls}_${rotation}`;

/** Length of a polyline, summed segment by segment in order. */
const pathLength = (points: Vec2[]) => {
  let sum = 0;
  for (let i = 1; i < points.length; i++)
    sum += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return sum;
};

/**
 * How the sleepers of one run of track of `length` tiles are spaced, given the class's nominal
 * `step`. The run holds a whole number of pitches, `pitch = length / round(length / step)`, and
 * the first and last sleeper sit half a pitch in from its ends. Two runs that meet at a tile edge
 * therefore leave `(pitch + pitch') / 2` between their nearest sleepers, one pitch to within the
 * difference of the two. The pitch strays from `step` by at most `step / (2 * count)`, and a run
 * shorter than a step still gets one sleeper.
 */
export function sleeperLayout(length: number, step: number) {
  if (!(length > 0) || !(step > 0)) return { count: 0, pitch: step, first: 0 };
  const count = Math.max(1, Math.round(length / step));
  const pitch = length / count;
  return { count, pitch, first: pitch / 2 };
}

/** The distance along a run of `length` tiles of each sleeper's centre, in order. */
export function sleeperPositions(length: number, step: number): number[] {
  const { count, pitch, first } = sleeperLayout(length, step);
  return Array.from({ length: count }, (_, i) => first + i * pitch);
}

/** A class's nominal sleeper spacing in tiles, shrunk a little (not below 3/4) on a small icon. */
export const sleeperStep = (cls: TrackClass, scale = 1) => STYLE[cls].step * Math.max(scale, 0.75);

/**
 * Where the sleepers of one rail line fall, as distances along `path.points`. A line that is a
 * part of a longer run takes the sleepers of the whole run that fall on it; a sleeper exactly on
 * the seam between two parts belongs to the later one.
 */
export function railSleepers(path: RailPath, scale = 1): number[] {
  const own = pathLength(path.points),
    start = path.run?.start ?? 0,
    length = path.run?.length ?? own,
    last = start + own >= length - 1e-9;
  return sleeperPositions(length, sleeperStep(path.run?.cls ?? path.cls, scale))
    .filter((d) => d >= start && (last || d < start + own))
    .map((d) => d - start);
}

const project = (p: Vec2) => ({ x: OX + (p.x - p.y) * 32, y: OY + (p.x + p.y) * 16 });
/** The painted materials the frames are drawn with (`generateIllustratedTrackAtlas`). */
let MATERIALS: TrackMaterials = NO_MATERIALS;
/** How far the shoulder's solid paint reaches in under the bed's solid edge, in tiles. */
const EDGE_TUCK = 0.02;
/** Spacing of the places a tuft may grow along the track, and the share of them that get one. */
const TUFT_STEP = 0.07,
  TUFT_SHARE = 0.32;
const offset = (p: Vec2, n: Vec2, d: number) => ({ x: p.x + n.x * d, y: p.y + n.y * d });

/**
 * The three strokes of a rail, bottom to top: the dark foot dropped a little, the web, the lit
 * head raised a little. `width` indexes the line's `widths` and `railColors`, `dy` is in world px.
 */
const RAIL_LINES: { width: 0 | 1 | 2; dy: number }[] = [
  { width: 0, dy: 0.35 },
  { width: 1, dy: 0 },
  { width: 2, dy: -0.3 },
];

/**
 * A canvas for one frame at R texels per world pixel, clipped to the tile's diamond, and helpers
 * that fill a polygon and stroke a line given in tile coordinates (the tile centre is the origin).
 */
function tileCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = W * R;
  canvas.height = H * R;
  const c = canvas.getContext('2d')!;
  c.scale(R, R);
  const polygon = (points: Vec2[], color: string) => {
    c.beginPath();
    points.forEach((p, i) => {
      const q = project(p);
      if (i) c.lineTo(q.x, q.y);
      else c.moveTo(q.x, q.y);
    });
    c.closePath();
    c.fillStyle = color;
    c.fill();
  };
  const line = (points: Vec2[], color: string, width: number, dy = 0) => {
    c.beginPath();
    points.forEach((p, i) => {
      const q = project(p);
      if (i) c.lineTo(q.x, q.y + dy);
      else c.moveTo(q.x, q.y + dy);
    });
    c.strokeStyle = color;
    c.lineWidth = width;
    c.lineJoin = 'round';
    c.stroke();
  };
  c.beginPath();
  c.moveTo(OX, OY - 16.3);
  c.lineTo(OX + 32.6, OY);
  c.lineTo(OX, OY + 16.3);
  c.lineTo(OX - 32.6, OY);
  c.closePath();
  c.clip();
  return { c, polygon, line, image: () => c.getImageData(0, 0, W * R, H * R) };
}

/** `scale` shrinks the rails, sleepers and bed with the path: an icon of a piece drawn small. */
function draw(paths: RailPath[], seed: number, bridge = false, scale = 1) {
  const { c, polygon, line, image } = tileCanvas();
  const rows = paths.map(({ points, cls, run }) => ({
    points,
    cls,
    run,
    normals: points.map((p, i) => {
      const a = points[Math.max(0, i - 1)],
        b = points[Math.min(points.length - 1, i + 1)];
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
    }),
  }));
  for (const { points, normals, cls, run } of rows) {
    const mat = bridge ? undefined : MATERIALS.lines[cls];
    if (mat?.bed) {
      paintedBed(c, points, normals, cls, run, seed, scale);
      continue;
    }
    if (!STYLE[cls].bed && !bridge) continue;
    const [, light, dark, rest] = STYLE[cls].ballast;
    const shoulder = STYLE[cls].shoulder * scale;
    for (const [extra, alpha] of bridge
      ? [[0, 1]]
      : [
          [0.06, 0.07],
          [0.035, 0.12],
          [0, 0.23],
          [-0.04, 0.35],
        ]) {
      c.globalAlpha = alpha;
      polygon(
        [
          ...points.map((p, i) => offset(p, normals[i], shoulder + extra)),
          ...points.map((p, i) => offset(p, normals[i], -shoulder - extra)).reverse(),
        ],
        bridge ? '#826446' : STYLE[cls].ballast[0],
      );
    }
    c.globalAlpha = 1;
    // Fine warm stone texture, with a quieter shoulder, instead of checkerboard one-pixel ballast.
    for (let i = 0; i < points.length; i++)
      for (let j = -8; j <= 8; j++) {
        const k = hash2(i, j, seed);
        c.globalAlpha = bridge ? 1 : 0.25 + 0.45 * (1 - Math.abs(j) / 9);
        const p = project(offset(points[i], normals[i], (j * shoulder) / 8));
        c.fillStyle = bridge
          ? k > 0.5
            ? '#997958'
            : '#72573e'
          : k > 0.72
            ? light
            : k < 0.28
              ? dark
              : rest;
        c.beginPath();
        c.ellipse(
          p.x + (k - 0.5) * 0.8,
          p.y,
          (bridge ? 0.9 : 0.3) + k * 0.32,
          0.18 + k * 0.14,
          0,
          0,
          Math.PI * 2,
        );
        c.fill();
      }
  }
  for (const { points, normals, cls, run } of rows) {
    c.globalAlpha = 1;
    const base = STYLE[cls];
    const st = {
      ...base,
      rail: base.rail * scale,
      sleeper: base.sleeper * scale,
    };
    const sleepers = railSleepers({ points, cls, run }, scale);
    let distance = 0,
      k = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        len = Math.hypot(b.x - a.x, b.y - a.y);
      while (k < sleepers.length && sleepers[k] <= distance + len + 1e-9) {
        const t = Math.min(1, (sleepers[k] - distance) / (len || 1)),
          p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const n = normals[i],
          along = { x: n.y, y: -n.x },
          half = st.sleeper;
        const painted = MATERIALS.lines[cls]?.sleeper;
        if (painted && !bridge) {
          const px = MATERIALS.pxPerTile;
          drawSprite(
            c,
            { ox: OX, oy: OY },
            painted,
            p,
            along,
            n,
            (painted.width / px) * scale,
            (painted.height / px) * scale,
          );
          k++;
          continue;
        }
        const corners = [
          offset(offset(p, n, -half), along, -0.028),
          offset(offset(p, n, half), along, -0.028),
          offset(offset(p, n, half), along, 0.028),
          offset(offset(p, n, -half), along, 0.028),
        ];
        polygon(corners, st.tie);
        line(corners.slice(0, 2), st.tieHi, 0.38, -0.22);
        for (const side of [-st.rail, st.rail]) {
          const q = project(offset(p, n, side));
          c.fillStyle = '#554f43';
          c.fillRect(q.x - 0.45, q.y - 0.35, 0.9, 0.7);
        }
        k++;
      }
      distance += len;
    }
  }
  // rails last, over every road's sleepers: where two roads meet, neither rail is cut
  for (const { points, normals, cls } of rows) {
    const st = STYLE[cls];
    const widths = st.widths.map((w) => w * Math.max(scale, 0.75));
    for (const side of [-st.rail * scale, st.rail * scale]) {
      const rail = points.map((p, i) => offset(p, normals[i], side));
      for (const { width, dy } of RAIL_LINES) line(rail, st.railColors[width], widths[width], dy);
    }
  }
  return image();
}

/**
 * The painted bed of one rail line: the ballast strip, the shoulder along both its edges and, on
 * lines that have them, grass tufts. Along the line the strips repeat a whole number of times over
 * the run, so every piece starts and ends on a repeat and meets the next one seamlessly.
 */
function paintedBed(
  c: CanvasRenderingContext2D,
  points: Vec2[],
  normals: Vec2[],
  cls: TrackClass,
  run: RailPath['run'],
  seed: number,
  scale: number,
) {
  const mat = MATERIALS.lines[cls]!;
  const px = MATERIALS.pxPerTile;
  const pr = { ox: OX, oy: OY };
  const own = pathLength(points),
    start = run?.start ?? 0,
    length = run?.length ?? own;
  const repeats = Math.max(1, Math.round(length / scale));
  const stretch = repeats / length;
  const strip = (img: NonNullable<typeof mat.bed>, from: number, to: number) => {
    // drawStrip starts its repeats at the start of `points`: shift them to the run's start
    const shift = (start * stretch * px) % img.width;
    drawStrip(c, pr, img, points, normals, from, to, px, stretch, 1.6, shift);
  };
  const bed = mat.bed!;
  const half = (bed.height / px / 2) * scale;
  const row = scale / px;
  // the shoulders first, their solid paint butted in under the bed's, so the bed's own soft edge
  // runs out over them instead of over the ground
  if (mat.edge) {
    const [bedTop, bedBottom] = mat.solid?.bed ?? [0, bed.height - 1];
    const [, edgeInner] = mat.solid?.edge ?? [0, mat.edge.height - 1];
    const tuck = EDGE_TUCK * scale;
    const top = half - bedTop * row - tuck,
      bottom = half - (bedBottom + 1) * row + tuck;
    const reach = (edgeInner + 1) * row,
      depth = mat.edge.height * row;
    strip(mat.edge, top + reach, top + reach - depth);
    strip(mat.edge, bottom - reach, bottom - reach + depth);
  }
  strip(bed, half, -half);
  if (!mat.tufts) return;
  const cells = Math.max(1, Math.floor(mat.tufts.width / mat.tufts.height));
  const cell = mat.tufts.height;
  const size = (cell / px) * scale;
  const sites = Math.floor(own / (TUFT_STEP * scale));
  let distance = 0,
    i = 1;
  for (let s = 0; s < sites; s++) {
    const d = (s + 0.5) * TUFT_STEP * scale;
    const k = hash2(Math.floor((start + d) * 100), 7, seed + 31);
    if (k > TUFT_SHARE) continue;
    while (i < points.length - 1 && distance + segLen(points, i) < d)
      distance += segLen(points, i++);
    const a = points[i - 1],
      b = points[i],
      t = (d - distance) / (segLen(points, i) || 1);
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const n = normals[i];
    const along = { x: n.y, y: -n.x };
    // narrow gauge grows grass anywhere across; branch line mostly in its shoulders
    const u = hash2(s, 11, seed + 53) * 2 - 1;
    const across =
      cls === 'narrow' ? u * half * 0.95 : Math.sign(u || 1) * half * (0.55 + 0.4 * Math.abs(u));
    const cellIndex = Math.floor(hash2(s, 17, seed + 71) * cells) % cells;
    drawSprite(
      c,
      pr,
      mat.tufts,
      offset(p, n, across),
      along,
      n,
      size,
      size,
      cellIndex * cell,
      cell,
    );
  }
}
const segLen = (points: Vec2[], i: number) =>
  Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);

/**
 * The rail lines of a piece that fits one tile, in tile coordinates (the tile centre is the
 * origin), as `generateIllustratedTrackAtlas` draws them.
 */
export function tilePaths(it: TrackItem, rotation: number): RailPath[] {
  const paths: RailPath[] = pieceLinks(it.kind, rotation).map((link, i) => ({
    points: linkPoints(link[0], link[1], 96),
    cls: it.kind === 'crossing' && i === 1 ? (it.cls2 ?? it.cls) : it.cls,
  }));
  return paths;
}

/** Dressed limestone setts, a little greyer than the masonry: base, lit, shadow. */
const SETT: RGB[] = PAL.stone.map((s) => shade(mix(s, PAL.rock[0], 0.4), 0.96));
const SETT_JOINT = shade(SETT[2], 0.66);
/** Packed earth, browner and darker than a dirt road: base, lit, shadow. */
const EARTH: RGB[] = [mix(PAL.furrow, PAL.hill[0], 0.5), PAL.hill[0], shade(PAL.furrow, 0.85)];
/** Weathered check planks, paler than the earth they lie in: base, lit, shadow. */
const PLANK: RGB[] = [
  mix(PAL.timber[1], PAL.stone[0], 0.4),
  mix(PAL.timber[1], PAL.stone[1], 0.55),
  shade(PAL.timber[2], 0.85),
];
/** The flangeway inside each rail, where the wheel flanges run: a narrow dark groove. */
const FLANGEWAY = mix(PAL.outline, PAL.sleeperDark, 0.45);
/** How much of the flangeway shows past the rail's own strokes, in tiles. */
const FLANGE = 0.013;

/** The screen direction, in world px, of a step `d` in tile coordinates. */
const screen = (d: Vec2) => ({ x: (d.x - d.y) * 32, y: (d.x + d.y) * 16 });

/**
 * How squarely a face whose outward normal is `d` (tile coordinates) turns to the upper-left
 * light, from 1 (straight at it) to -1 (straight away).
 */
function towardLight(d: Vec2) {
  const s = screen(d);
  return -(s.x + s.y) / (Math.hypot(s.x, s.y) * Math.SQRT2);
}

/**
 * How far a straight rail of class `cls` running along `along` is painted from its centre line
 * towards `side` (a unit tile vector across the track), in tiles: the farthest any of its
 * strokes, `RAIL_LINES`, reaches once each is dropped or raised by its `dy`. The deck keeps clear
 * of it.
 */
export function railReach(cls: TrackClass, along: Vec2, side: Vec2) {
  const t = screen(along),
    d = screen(side),
    k = (d.x * t.x + d.y * t.y) / (t.x * t.x + t.y * t.y);
  // the part of `side` square to the rail on screen: world px per tile, and how much of it is down
  const p = { x: d.x - k * t.x, y: d.y - k * t.y },
    perTile = Math.hypot(p.x, p.y),
    down = p.y / perTile;
  const px = Math.max(
    ...RAIL_LINES.map(({ width, dy }) => STYLE[cls].widths[width] / 2 + dy * down),
  );
  return px / perTile;
}

/**
 * The deck a road lays over straight track of class `cls` at `rotation`, drawn on the straight's
 * own canvas so it lies exactly over that frame: `LEVEL_CROSSING_ACROSS` either side of the centre
 * line and `LEVEL_CROSSING_ALONG` either way along it. Regular track gets dressed setts, narrow
 * packed earth with timber check planks along both sides of each rail. Neither is laid within
 * `railReach` of a rail, and last the rails' own strokes are cut out of the deck, so the track's
 * railheads show through it.
 */
function drawLevelCrossing(cls: LevelCrossingClass, rotation: number, seed: number) {
  const { c, polygon, line, image } = tileCanvas();
  const [{ points }] = tilePaths({ kind: 'straight', cls }, rotation);
  const a = points[0],
    b = points[points.length - 1],
    length = Math.hypot(b.x - a.x, b.y - a.y);
  // along the track, and across it the way `draw` lays its rails
  const t = { x: (b.x - a.x) / length, y: (b.y - a.y) / length },
    n = { x: -t.y, y: t.x },
    mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const at = (u: number, v: number) => offset(offset(mid, n, u), t, v);
  /** A block `u0..u1` across the track and `v0..v1` along it. */
  const quad = (u0: number, u1: number, v0: number, v1: number, color: RGB, alpha = 1) => {
    c.globalAlpha = alpha;
    polygon([at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], css(color));
    c.globalAlpha = 1;
  };
  /** A block's rims `w` deep: lit on the face to the light, dark on the face away and below. */
  const rims = (
    u0: number,
    u1: number,
    v0: number,
    v1: number,
    w: number,
    lit: RGB,
    dark: RGB,
    alpha = 1,
  ) => {
    const faces: [Vec2, number, number, number, number][] = [
      [n, u1 - w, u1, v0, v1],
      [{ x: -n.x, y: -n.y }, u0, u0 + w, v0, v1],
      [t, u0, u1, v1 - w, v1],
      [{ x: -t.x, y: -t.y }, u0, u1, v0, v0 + w],
    ];
    for (const [d, ...band] of faces) {
      const tone = towardLight(d);
      if (tone > 0.5) quad(...band, lit, alpha);
      else if (tone < -0.5) quad(...band, dark, alpha);
      // the lower face turned from the light: a quieter rim
      else if (screen(d).y > 0) quad(...band, dark, alpha * 0.5);
    }
  };
  const across = LEVEL_CROSSING_ACROSS[cls],
    along = LEVEL_CROSSING_ALONG,
    rail = RAIL_OFFSET[cls];
  /** The reach of the rail on side `s` (-1 or 1) towards the centre line, or away from it. */
  const reach = (s: number, inward: boolean) => {
    const d = inward ? -s : s;
    return railReach(cls, t, { x: n.x * d, y: n.y * d });
  };
  c.beginPath();
  [at(-across, -along), at(across, -along), at(across, along), at(-across, along)].forEach(
    (p, i) => {
      const q = project(p);
      if (i) c.lineTo(q.x, q.y);
      else c.moveTo(q.x, q.y);
    },
  );
  c.closePath();
  c.clip();
  if (cls !== 'narrow') {
    const joint = 0.006,
      pitch = 0.1;
    quad(-across, across, -along, along, SETT_JOINT);
    // courses of setts run beside the rails, half a sett out of step with their neighbours: three
    // between the flangeways, one of edge setts outside each rail
    const zones: [number, number, number][] = [
      [-across, -rail - reach(-1, false), 1],
      [-rail + reach(-1, true) + FLANGE, rail - reach(1, true) - FLANGE, 3],
      [rail + reach(1, false), across, 1],
    ];
    let course = 0;
    for (const [from, to, count] of zones)
      for (let i = 0; i < count; i++, course++) {
        const u0 = from + ((to - from) * i) / count + joint,
          u1 = from + ((to - from) * (i + 1)) / count - joint;
        for (let k = -1; k * pitch < 2 * along; k++) {
          const start = -along + (k + (course % 2) / 2) * pitch,
            v0 = Math.max(-along, start) + joint,
            v1 = Math.min(along, start + pitch) - joint;
          if (v1 - v0 < 0.015) continue;
          const pick = hash2(course, k, seed),
            base = pick > 0.7 ? SETT[1] : pick < 0.25 ? SETT[2] : SETT[0];
          quad(u0, u1, v0, v1, base);
          rims(u0, u1, v0, v1, 0.011, shade(base, 1.07), shade(base, 0.8));
        }
      }
    for (const s of [-1, 1])
      quad(s * (rail - reach(s, true) - FLANGE), s * rail, -along, along, FLANGEWAY);
  } else {
    const plank = 0.026,
      joint = 0.007;
    quad(-across, across, -along, along, EARTH[0]);
    // a few broad worn and darker patches, and two cart ruts along the road
    for (let i = 0; i < 5; i++) {
      const p = project(
        at((hash2(i, 1, seed) - 0.5) * 2 * across, (hash2(i, 2, seed) - 0.5) * 2 * along),
      );
      const rx = 1.6 + hash2(i, 3, seed) * 1.8;
      c.globalAlpha = 0.4;
      c.fillStyle = css(i % 2 ? EARTH[2] : EARTH[1]);
      c.beginPath();
      c.ellipse(p.x, p.y, rx, rx / 2, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    for (const v of [-0.075, 0.075]) quad(-across, across, v - 0.016, v + 0.016, EARTH[2], 0.35);
    // a check plank either side of each rail, each laid as two boards butted at a seeded joint
    for (const s of [-1, 1]) {
      const inner = rail - reach(s, true) - FLANGE,
        outer = rail + reach(s, false) + joint;
      quad(s * inner, s * rail, -along, along, FLANGEWAY);
      [
        [inner - plank, inner],
        [outer, outer + plank],
      ].forEach(([from, to], i) => {
        const u0 = Math.min(s * from, s * to),
          u1 = Math.max(s * from, s * to),
          split = (hash2(s, i, seed) - 0.5) * 0.14;
        for (const [v0, v1] of [
          [-along + joint, split - joint / 2],
          [split + joint / 2, along - joint],
        ]) {
          const grain = hash2(s * 3 + i, v0 > split ? 1 : 0, seed),
            base = mix(PLANK[0], PLANK[2], grain * 0.3);
          quad(u0, u1, v0, v1, base);
          rims(u0, u1, v0, v1, 0.008, PLANK[1], PLANK[2]);
        }
      });
    }
  }
  // the deck's own edge: lit to the light, darker on its lower rims
  rims(-across, across, -along, along, 0.012, PAL.white, PAL.outline, 0.3);
  // last, the rails' own strokes out of the deck, so the railheads under it show
  c.globalCompositeOperation = 'destination-out';
  for (const side of [-rail, rail]) {
    const strokes = points.map((p) => offset(p, n, side));
    for (const { width, dy } of RAIL_LINES) line(strokes, '#000', STYLE[cls].widths[width], dy);
  }
  c.globalCompositeOperation = 'source-over';
  return image();
}

/** Source-inspired timber/steel materials on the real track polylines, in every orientation. */
/**
 * Every track frame. With painted `materials` (`loadTrackMaterials`) the lines that have them are
 * laid with their painted bed, shoulders, sleepers and tufts; the rest, and every line without
 * them, keep the procedural look.
 */
export function generateIllustratedTrackAtlas(
  materials: TrackMaterials = NO_MATERIALS,
): AtlasImage {
  MATERIALS = materials;
  const ab = new AtlasBuilder();
  for (const it of TRACK_ITEMS)
    for (let rotation = 0; rotation < rotationCount(it.kind); rotation++) {
      const key = `track/${itemKey(it)}_${rotation}`;
      if (isUnitKind(it.kind, it.cls)) {
        const forms: SwitchForm[] = it.kind === 'switch' ? ['turn', 'parallel'] : ['turn'];
        for (const form of forms) {
          const def = unitDef(it.kind as 'curve' | 'switch', CLASS_N[it.cls], rotation, form);
          const tag = form === 'parallel' ? 'p' : '';
          // every member draws the whole piece, shifted into its own tile and clipped to it, so
          // rails and ballast run on across tile edges; the empty inner tile shows only the
          // ballast that spills into it. Each road is one unbroken line, so sleepers keep their
          // spacing and rails their direction where tiles meet.
          const roads = unitRailPaths(
            it.kind as 'curve' | 'switch',
            CLASS_N[it.cls],
            rotation,
            form,
          );
          const member = (index: number) => {
            const own = def.members[index];
            return draw(
              roads.map((pts) => ({
                points: pts.map((q) => ({ x: q.x - own.dx, y: q.y - own.dy })),
                cls: it.cls,
              })),
              rotation * 13,
            );
          };
          def.members.forEach((_, i) => ab.add(`${key}${tag}_m${i}`, member(i), OX * R, OY * R));
          // the toolbar icon: the whole piece, small, on one tile
          if (form === 'turn') {
            const n = CLASS_N[it.cls];
            const icon = unitIconPaths(it.kind as 'curve' | 'switch', n, rotation).map(
              (points) => ({ points, cls: it.cls }),
            );
            ab.add(key, draw(icon, rotation * 13, false, 1 / n), OX * R, OY * R);
          }
        }
      } else {
        const paths = tilePaths(it, rotation);
        ab.add(key, draw(paths, rotation * 13, it.kind === 'bridge'), OX * R, OY * R);
      }
    }
  // the deck a road lays over straight track, anchored as the straight it lies on (#309)
  LEVEL_CROSSING_CLASSES.forEach((cls, i) => {
    for (let rotation = 0; rotation < rotationCount('straight'); rotation++)
      ab.add(
        levelCrossingFrame(cls, rotation),
        drawLevelCrossing(cls, rotation, 900 + i * 50 + rotation * 13),
        OX * R,
        OY * R,
      );
  });
  return { ...ab.build(2048), resolution: R };
}
