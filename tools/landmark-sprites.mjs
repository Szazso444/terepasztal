/** Calibrate the twelve rare-landmark pictures and pack them into the `landmarks` atlas group.
 *
 *   node tools/landmark-sprites.mjs [output directory]
 *
 * Only the pictures `manifest.json` lists are read, never the folder. Each is measured against the
 * game's 64x32 grid and drawn by the door rule (src/render/assetScale.ts): scaled uniformly so that
 * its door is DOOR_PX tall. Nothing here warps a picture: one that does not lie on the grid is
 * still exported at its uniform scale, and marked `regenerate` in `calibration.json` for a repaint.
 *
 * What it writes: `calibration.json` beside the pictures, and public/assets/landmarks.{png,json}.
 * A frame's anchor is the footprint's centre on the ground, so a landmark with its min corner on
 * tile (x, y) stands at tileToWorld(x + (W - 1) / 2, y + (D - 1) / 2).
 *
 * Uses pngjs (existing dev dependency); no model call or runtime dependency.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { capFrame } from './atlas-cap.mjs';
import { FIT, cameraOff, measureBase, roundCamera } from './building-fit.mjs';
import { packFrames } from './illustrated-sprites.mjs';
import { isMain } from './is-main.mjs';

export const FINAL = 'assets/source/rare-landmarks-v1/final';
const FOOTPRINTS = 'src/art/landmarkFootprints.json';
/** Texels per world px, as the structures and props: one texel per screen px at the closest zoom. */
export const RESOLUTION = 4;
/** The longest side of the packed sheet. */
const SHEET = 2048;
/** A wall counts as the long side when it is this much longer than the other. */
const LONG = 1.15;

/**
 * What was read off each picture by eye, at 3x to 5x, in source px. `door` is the opening's
 * [x, top, bottom] on a jamb, or at the apex of an arch, without the trim round it; the median of
 * them is the door. No `door`: the picture has none and takes the median ratio. `base` replaces
 * what `measureBase` reads where that is not the ground; `slopes` replaces the slopes the camera is
 * read from.
 */
const MEASURED = {
  '01-merchants-last-stop': {
    id: 'merchants_last_stop',
    door: [
      [564, 654, 768],
      [606, 675, 787],
    ],
  },
  '02-overgrown-bathhouse': {
    id: 'overgrown_bathhouse',
    door: [
      [431, 781, 867],
      [445, 788, 875],
    ],
  },
  '03-bellkeepers-refuge': {
    id: 'bellkeepers_refuge',
    door: [[547, 966, 1102]],
    // the steps reach past the tower: its walls, with the left foot behind them taken at 0.5
    base: { w: [455, 1088], s: [638, 1179], e: [802, 1101], sure: [false, true] },
    note: 'base read from the walls: measureBase takes the steps for the lower-left wall',
  },
  '04-flooded-archive': { id: 'flooded_archive' },
  '05-rootbound-workshop': {
    id: 'rootbound_workshop',
    door: [
      [361, 582, 747],
      [418, 607, 772],
    ],
    // roots have no straight foot, so the camera is read from the deck's rails
    slopes: [0.51, -0.42],
    note: 'stands on its roots: base is the root tips, camera read from the deck rails',
  },
  '06-cliffside-cable-station': {
    id: 'cliffside_cable_station',
    door: [
      [412, 682, 797],
      [463, 708, 825],
    ],
    // the undersides of the outer footings; measureBase's right corner is the hanging basket
    base: { w: [165, 872], s: [640, 1138], e: [1052, 998], sure: [true, true] },
    note: 'base read from the footings: measureBase takes the hanging basket for a corner',
  },
  '07-stormglass-observatory': {
    id: 'stormglass_observatory',
    door: [[485, 921, 1068]],
    // a round tower on a plinth with one real corner: its near corner and right side, the left
    // behind the steps and the bush
    base: { w: [300, 1040], s: [622, 1203], e: [985, 1023], sure: [false, true] },
    round: true,
    note: 'round: base is its plinth, camera read from the ellipse of its foot',
  },
  '08-ashen-conservatory': {
    id: 'ashen_conservatory',
    door: [
      [583, 595, 722],
      [625, 619, 743],
    ],
  },
  '09-inverted-manor': {
    id: 'inverted_manor',
    door: [
      [908, 523, 639],
      [853, 547, 662],
    ],
    // the point of its upturned roof, in the rubble; the body is read from its upper deck
    ground: [638, 1095],
    note: "stands on the point of its roof: anchor is that point, tiles and camera are the body's",
  },
  '10-sleeping-foundry': {
    id: 'sleeping_foundry',
    door: [
      [587, 910, 996],
      [615, 924, 1011],
    ],
  },
  '11-moonwell-pavilion': { id: 'moonwell_pavilion' },
  '12-house-between-seasons': {
    id: 'house_between_seasons',
    // its three doors differ
    door: [
      [694, 478, 587],
      [807, 490, 591],
      [957, 645, 768],
    ],
  },
};

const round = (v, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits + 0;
const readJson = (p) =>
  JSON.parse(readFileSync(p, 'utf8').replace(String.fromCharCode(0xfeff), ''));

/** The renderer's door, `DOOR_PX` in src/render/assetScale.ts, read from there rather than copied. */
export function readDoorPx(file = 'src/render/assetScale.ts') {
  const m = /export const DOOR_PX = ([\d.]+);/.exec(readFileSync(file, 'utf8'));
  if (!m) throw new Error(`No DOOR_PX in ${file}`);
  return Number(m[1]);
}

export function medianOf(values) {
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * The ground corners of a W x D footprint, world px from its centre. `w` to `s` is the lower-left
 * wall, along +x, W tiles; `s` to `e` the lower-right, along +y, D tiles.
 */
export function footprintCorners(W, D) {
  return {
    w: [-(W + D) * 16, (D - W) * 8],
    s: [(W - D) * 16, (W + D) * 8],
    e: [(W + D) * 16, (W - D) * 8],
  };
}

/** How far, in world px, each corner of `base` lands from its corner of the footprint. */
export function cornerErrors(base, anchor, scale, [W, D]) {
  const want = footprintCorners(W, D);
  const by = (k) =>
    round(
      Math.hypot(
        (base[k][0] - anchor[0]) * scale - want[k][0],
        (base[k][1] - anchor[1]) * scale - want[k][1],
      ),
      1,
    );
  const out = { w: by('w'), s: by('s'), e: by('e') };
  return { ...out, max: Math.max(out.w, out.s, out.e) };
}

/** How far, in world px, each outer corner is from the 2:1 line through the near corner. */
function gridErrors({ w, s, e }, scale) {
  const off = (c) => Math.abs(Math.abs(s[1] - c[1]) - Math.abs(s[0] - c[0]) / 2) * scale;
  return { w: round(off(w), 1), e: round(off(e), 1) };
}

/**
 * `fit` or `regenerate`, from the camera a picture was drawn with. A picture is never corrected
 * here, so what is off stays off: past FIT.near, the degrees within which a building's picture is
 * near enough, it is painted again. With one foot to read there is no such number, only whether a
 * camera near the game's draws that foot.
 */
export function verdictOf(camera) {
  const off = camera.by === null ? camera.off : camera.by > FIT.near;
  return off ? 'regenerate' : 'fit';
}

/**
 * `src` shrunk by `f` on both axes, area-sampled in premultiplied alpha. The texel grid is laid so
 * that `anchor` (source px) falls on a texel corner, (ax, ay): the anchor stays exact and no
 * rounding of a frame's width or height can make the two axes differ.
 */
export function shrink(src, f, anchor) {
  const ax = Math.ceil(anchor[0] * f),
    ay = Math.ceil(anchor[1] * f);
  const ox = anchor[0] - ax / f,
    oy = anchor[1] - ay / f;
  const width = Math.ceil((src.width - ox) * f),
    height = Math.ceil((src.height - oy) * f);
  const png = new PNG({ width, height });
  const cell = 1 / f ** 2;
  for (let y = 0; y < height; y++) {
    const top = oy + y / f,
      bottom = top + 1 / f;
    for (let x = 0; x < width; x++) {
      const left = ox + x / f,
        right = left + 1 / f;
      let a = 0,
        r = 0,
        g = 0,
        b = 0;
      for (let yy = Math.max(0, Math.floor(top)); yy < Math.min(src.height, bottom); yy++) {
        const wy = Math.min(yy + 1, bottom) - Math.max(yy, top);
        for (let xx = Math.max(0, Math.floor(left)); xx < Math.min(src.width, right); xx++) {
          const i = (yy * src.width + xx) * 4;
          const alpha =
            (src.data[i + 3] / 255) * wy * (Math.min(xx + 1, right) - Math.max(xx, left));
          a += alpha;
          r += src.data[i] * alpha;
          g += src.data[i + 1] * alpha;
          b += src.data[i + 2] * alpha;
        }
      }
      if (a > 0) {
        const i = (y * width + x) * 4;
        png.data[i] = Math.round(r / a);
        png.data[i + 1] = Math.round(g / a);
        png.data[i + 2] = Math.round(b / a);
        png.data[i + 3] = Math.round((255 * a) / cell);
      }
    }
  }
  return { png, ax, ay };
}

/** `png` cut to its visible texels, and the anchor with it. */
function trimmed(png, ax, ay) {
  let x0 = png.width,
    y0 = png.height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++)
      if (png.data[(y * png.width + x) * 4 + 3]) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  const out = new PNG({ width: x1 - x0 + 1, height: y1 - y0 + 1 });
  PNG.bitblt(png, out, x0, y0, out.width, out.height, 0, 0);
  return { png: out, ax: ax - x0, ay: ay - y0 };
}

/** `png` upside down: the top of a picture becomes what `measureBase` reads. */
function flipped(png) {
  const out = new PNG({ width: png.width, height: png.height });
  for (let y = 0; y < png.height; y++)
    png.data.copy(
      out.data,
      (png.height - 1 - y) * png.width * 4,
      y * png.width * 4,
      (y + 1) * png.width * 4,
    );
  return out;
}

/** The two slopes that join a base's corners. */
const slopesOf = ({ w, s, e }) => [(s[1] - w[1]) / (s[0] - w[0]), (e[1] - s[1]) / (e[0] - s[0])];

/**
 * Where a picture stands: `base`, its corners; `anchor`, the middle of its base, the point that
 * goes on the footprint's centre; `camera`, how far the picture's camera is from the game's;
 * `from`, how each was read.
 */
function groundOf(png, m) {
  if (m.ground) {
    // the far edges of the upper deck run as the near walls do, on the other side of the picture
    const deck = measureBase(flipped(png));
    const half = (deck.e[0] - deck.w[0]) / 2;
    const [x, y] = m.ground;
    return {
      base: { w: [x - half, y], s: [x, y + half / 2], e: [x + half, y] },
      anchor: m.ground,
      camera: cameraOff({ sure: deck.sure, measured: [-deck.slopes[1], -deck.slopes[0]] }),
      from: 'body',
    };
  }
  const auto = measureBase(png);
  const base = m.base ?? { w: auto.w, s: auto.s, e: auto.e };
  const anchor = [(base.w[0] + base.e[0]) / 2, (base.w[1] + base.e[1]) / 2];
  if (m.round) return { base, anchor, camera: roundCamera(png), from: 'plinth' };
  const sure = m.slopes ? [true, true] : (m.base?.sure ?? auto.sure);
  const measured = m.slopes ?? (m.base ? slopesOf(m.base) : auto.slopes);
  return { base, anchor, camera: cameraOff({ sure, measured }), from: m.base ? 'walls' : 'auto' };
}

/** A picture's calibration: everything but its frame, which the export adds. */
function calibrate(asset, png, spec, door) {
  const m = MEASURED[asset.id];
  const ground = groundOf(png, m);
  const heights = (m.door ?? []).map(([, top, bottom]) => bottom - top);
  const px = heights.length ? medianOf(heights) : null;
  const { base } = ground;
  // the size the handoff drew it at: its proposed footprint as wide as its base
  const [hw, hd] = asset.footprint_tiles;
  const own = ((hw + hd) * 32) / (base.e[0] - base.w[0]);
  return {
    asset,
    id: m.id,
    spec,
    ground,
    own,
    door: { px, spans: m.door ?? [], basis: px === null ? 'median' : 'measured' },
    doorPx: door,
    scale: px === null ? null : door / px,
    note: m.note,
  };
}

/** What the picture's base covers at its scale, in tiles, and the record for the file. */
function finish(c) {
  const { ground, spec, scale } = c;
  const { base, anchor, camera } = ground;
  const runs = [base.s[0] - base.w[0], base.e[0] - base.s[0]];
  const tiles = runs.map((run) => round((run * scale) / 32));
  const rounded = tiles.map((t) => Math.max(1, Math.round(t)));
  const long = Math.max(...runs) / Math.min(...runs);
  return {
    id: c.id,
    file: c.asset.file,
    footprint: {
      spec,
      measuredTiles: tiles,
      rounded,
      differs: rounded[0] !== spec[0] || rounded[1] !== spec[1],
      longSide: long < LONG || ground.from === 'plinth' ? 'neither' : runs[0] > runs[1] ? 'W' : 'D',
    },
    anchor: { point: 'footprint centre', source: anchor.map((v) => round(v, 1)) },
    door: { ...c.door, drawnAs: round(c.doorPx / scale, 1) },
    scale: round(scale, 5),
    base: {
      from: ground.from,
      w: base.w.map((v) => round(v, 1)),
      s: base.s.map((v) => round(v, 1)),
      e: base.e.map((v) => round(v, 1)),
    },
    cornerErrorPx: cornerErrors(base, anchor, scale, spec),
    gridErrorPx: ground.from === 'body' ? null : gridErrors(base, scale),
    camera,
    verdict: verdictOf(camera),
    ...(c.note ? { note: c.note } : {}),
  };
}

/** Calibration of every picture the manifest lists, in its order, with the pictures themselves. */
export function calibrateAll() {
  const door = readDoorPx();
  const footprints = readJson(FOOTPRINTS);
  const manifest = readJson(join(FINAL, 'manifest.json'));
  const pictures = manifest.assets.map((asset) =>
    PNG.sync.read(readFileSync(join(FINAL, asset.file))),
  );
  const entries = manifest.assets.map((asset, i) =>
    calibrate(asset, pictures[i], footprints[MEASURED[asset.id].id], door),
  );
  // a picture with no door takes the ratio the others have to their handoff size
  const ratio = medianOf(entries.filter((c) => c.scale).map((c) => c.scale / c.own));
  for (const c of entries) c.scale ??= ratio * c.own;
  return { ratio, pictures, landmarks: entries.map(finish) };
}

/** Every picture through the shrink, the cap pass and the trim, then packed. */
export function build(output = 'public/assets') {
  const { ratio, pictures, landmarks } = calibrateAll();
  const frames = landmarks.map((l, i) => {
    const key = `landmarks/${l.id}`;
    const shrunk = shrink(pictures[i], l.scale * RESOLUTION, l.anchor.source);
    const frame = trimmed(capFrame(key, shrunk.png).png, shrunk.ax, shrunk.ay);
    l.anchor.frame = [frame.ax, frame.ay];
    return { key, ...frame };
  });
  const { sheet, frames: packed } = packFrames(frames, SHEET);
  mkdirSync(output, { recursive: true });
  const ordered = Object.fromEntries(
    Object.keys(packed)
      .sort()
      .map((k) => [k, packed[k]]),
  );
  writeFileSync(join(output, 'landmarks.png'), PNG.sync.write(sheet));
  writeFileSync(
    join(output, 'landmarks.json'),
    `${JSON.stringify({ resolution: RESOLUTION, frames: ordered }, null, 2)}\n`,
  );
  const record = { resolution: RESOLUTION, noDoorRatio: round(ratio, 4), landmarks };
  writeFileSync(join(FINAL, 'calibration.json'), `${JSON.stringify(record, null, 2)}\n`);
  return { record, sheet };
}

function main(output) {
  const { record, sheet } = build(output);
  for (const l of record.landmarks)
    console.log(
      l.id.padEnd(24),
      `door ${String(l.door.px).padEnd(5)} scale ${l.scale.toFixed(4)}`,
      `tiles ${l.footprint.measuredTiles.join('x').padEnd(10)} spec ${l.footprint.spec.join('x')}`,
      `corner ${String(l.cornerErrorPx.max).padEnd(5)} grid ${JSON.stringify(l.gridErrorPx)}`,
      `camera ${l.camera.by}`,
      l.verdict,
    );
  console.log(`landmarks: ${record.landmarks.length} frames -> ${sheet.width}x${sheet.height}`);
}

if (isMain(import.meta.url)) main(process.argv[2]);
