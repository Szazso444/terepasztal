import { ImageSource, Texture } from 'pixi.js';
import {
  BRICK_FRAMES,
  BRICK_W,
  COPING_FRAME,
  COPING_W,
  OPEN_CROWN,
  OPEN_W,
  PORTAL_FRAMES,
  ROCK,
  TUNNEL_R,
} from '../art/tunnelArt';
import { mix } from '../art/palette';
import type { AtlasRegistry, FrameInfo } from '../engine/atlas';
import { HALF_H, HALF_W } from '../engine/iso';

/*
 * The pictures of a portal, drawn at run time from the atlas's swatches: the face cut to the ground
 * as it stands, so a bank in front of the plane hides it where it should and the end of the cutting
 * is the only face seen; the far wall of the cutting, down to the foot of the bank; the gravel
 * between that wall and the ballast. The ring and throat are the atlas's own picture. Node has no
 * canvas, so there `blankPortalArt` stands in.
 */

export interface Pt {
  x: number;
  y: number;
}
/**
 * A point of the plane of an E face, from the rail under the middle of the opening, in world px:
 * `u` tiles along the plane toward +y, `z` px up, `d` tiles into the mountain. An S face is the
 * same picture mirrored in x.
 */
export function planePoint(u: number, z: number, d = 0): Pt {
  return { x: (-d - u) * HALF_W, y: (u - d) * HALF_H - z };
}
const q = planePoint;

/** How a face on +x or +y meets the ground as it stands. All heights are px over the rail. */
export interface FaceFit {
  /** an S face: the picture of an E face, mirrored */
  mirror: boolean;
  /** which of the brick pictures it is laid from */
  bricks: number;
  /** along the plane: the bottom and the top of the face, on the ground */
  us: number[];
  base: number[];
  top: number[];
  /** how many tiles of cutting run out from the plane, and along them the top of the far wall */
  run: number;
  ds: number[];
  wall: number[];
  /** the opening's outline (`openingOutline`) */
  opening: Pt[];
}

/** A picture to stand at a portal: its top left from the rail under the opening, in world px. */
export interface Picture {
  texture: Texture;
  x: number;
  y: number;
  /** World px of one texel. */
  scale: number;
}
export interface PortalArt {
  /** Under the train: face, wall, ring and throat. */
  back(fit: FaceFit): Picture;
  /** Over rail and train alike: the dark of the tunnel. */
  dark(fit: FaceFit): Picture;
}
/** Where nothing can be drawn. */
export const blankPortalArt: PortalArt = {
  back: () => ({ texture: Texture.EMPTY, x: 0, y: 0, scale: 1 }),
  dark: () => ({ texture: Texture.EMPTY, x: 0, y: 0, scale: 1 }),
};

const K = TUNNEL_R;
/** The width of the floor of a cutting: from under the wall to the edge of the ballast. */
const WALL = 0.45,
  BALLAST = 0.27;
/** How light each face stands: the S face takes the sun, the E face less, the wall between. */
const E_LIGHT = 0.82,
  WALL_LIGHT = 0.92;

const rgb = (c: readonly number[], a = 1) =>
  `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

/** A fixed pseudo-random value in 0..1 for `a`, so a portal is the same every time it is cut. */
function noise(a: number) {
  const v = Math.sin(a * 91.7) * 43758.5;
  return v - Math.floor(v);
}

function path(c: CanvasRenderingContext2D, points: readonly Pt[]) {
  c.beginPath();
  points.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
  c.closePath();
}

/** A canvas round `points`, in the frame the picture is drawn in, mirrored for an S face. */
function canvasOver(points: readonly Pt[], mirror: boolean) {
  const flip = mirror ? -1 : 1,
    xs = points.map((p) => p.x * flip),
    ys = points.map((p) => p.y),
    x = Math.floor(Math.min(...xs)) - 3,
    y = Math.floor(Math.min(...ys)) - 3,
    w = Math.ceil(Math.max(...xs)) + 3 - x,
    h = Math.ceil(Math.max(...ys)) + 3 - y,
    canvas = document.createElement('canvas');
  canvas.width = w * K;
  canvas.height = h * K;
  const c = canvas.getContext('2d')!;
  c.setTransform(K * flip, 0, 0, K, -x * K, -y * K);
  return {
    c,
    /** The picture, mipmapped: at a far zoom the brick would shimmer. */
    done: (): Picture => ({
      texture: new Texture({
        source: new ImageSource({
          resource: canvas,
          scaleMode: 'linear',
          autoGenerateMipmaps: true,
        }),
      }),
      x,
      y,
      scale: 1 / K,
    }),
  };
}

/** The texels of an atlas frame on a canvas of their own, for a pattern or a strip. */
function texels(f: FrameInfo) {
  const t = f.texture.frame,
    canvas = document.createElement('canvas');
  canvas.width = t.width;
  canvas.height = t.height;
  canvas.getContext('2d')!.drawImage(f.image, t.x, t.y, t.width, t.height, 0, 0, t.width, t.height);
  return canvas;
}

/**
 * Lay a swatch of brick over the whole clip, on a plane whose tile runs `along` on the canvas, its
 * courses level with the plane and each brick standing upright.
 */
function layBrick(
  c: CanvasRenderingContext2D,
  swatch: HTMLCanvasElement,
  along: Pt,
  light: number,
) {
  const pattern = c.createPattern(swatch, 'repeat')!;
  pattern.setTransform(new DOMMatrix().scale(1 / K));
  c.save();
  c.transform(along.x / BRICK_W, along.y / BRICK_W, 0, 1, 0, 0);
  c.fillStyle = pattern;
  c.fillRect(-2000, -1000, 4000, 2000);
  c.restore();
  c.fillStyle = `rgba(0,0,0,${1 - light})`;
  c.fillRect(-1000, -1000, 2000, 2000);
}

/** A line of dressed stone along `line`, the course following it and each stone upright. */
function layCoping(c: CanvasRenderingContext2D, strip: HTMLCanvasElement, line: readonly Pt[]) {
  const h = strip.height / K;
  let at = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i],
      run = Math.abs(b.x - a.x);
    if (run < 1e-3) continue;
    const from = at % COPING_W,
      span = Math.min(run + 0.35, COPING_W - from);
    c.save();
    c.transform((b.x - a.x) / run, (b.y - a.y) / run, 0, 1, a.x, a.y);
    c.drawImage(strip, from * K, 0, span * K, strip.height, 0, -h / 2, span, h);
    c.restore();
    at += run;
  }
}

/** The dark at the foot of a stretch of wall: `foot` is its line, `up` px of it go dark. */
function shadeFoot(c: CanvasRenderingContext2D, foot: readonly Pt[], up: number, alpha: number) {
  for (let i = 1; i < foot.length; i++) {
    const a = foot[i - 1],
      b = foot[i],
      g = c.createLinearGradient(a.x, a.y, a.x, a.y - up);
    g.addColorStop(0, `rgba(18,12,9,${alpha})`);
    g.addColorStop(1, 'rgba(18,12,9,0)');
    c.fillStyle = g;
    path(c, [a, b, { x: b.x, y: b.y - up }, { x: a.x, y: a.y - up }]);
    c.fill();
  }
}

/** The face of a portal: brick from the bank in front of it to the ground over it. */
function drawFace(c: CanvasRenderingContext2D, fit: FaceFit, swatch: HTMLCanvasElement) {
  const { us, base, top } = fit;
  c.save();
  path(c, [
    ...us.map((u, i) => q(u, top[i])),
    ...[...us].reverse().map((u, i) => q(u, base[us.length - 1 - i])),
  ]);
  c.clip();
  layBrick(c, swatch, q(1, 0), fit.mirror ? 1 : E_LIGHT);
  shadeFoot(
    c,
    us.map((u, i) => q(u, base[i])),
    9,
    0.55,
  );
  c.restore();
}

/** The cutting: gravel between the ballast and the far wall, and the wall down to the bank. */
function drawCutting(c: CanvasRenderingContext2D, fit: FaceFit, swatch: HTMLCanvasElement) {
  const { run, ds, wall } = fit,
    { hi, mid, lo } = ROCK;
  if (!run) return;
  path(c, [q(-WALL - 0.03, 0), q(-BALLAST, 0), q(-BALLAST, 0, -run), q(-WALL - 0.03, 0, -run)]);
  c.fillStyle = rgb(mix(mid, lo, 0.68));
  c.fill();
  for (let i = 0; i < 90 * run; i++) {
    const a = q(-WALL + noise(i + 0.2) * (WALL - BALLAST), 0, -noise(i + 0.7) * run);
    c.fillStyle = rgb(mix(mid, noise(i) < 0.5 ? lo : hi, noise(i + 0.4) * 0.6), 0.8);
    c.fillRect(a.x, a.y, 1.1, 0.7);
  }
  c.save();
  path(c, [
    ...ds.map((d, i) => q(-WALL, wall[i], d)),
    ...[...ds].reverse().map((d) => q(-WALL, 0, d)),
  ]);
  c.clip();
  layBrick(c, swatch, q(0, 0, 1), WALL_LIGHT);
  shadeFoot(
    c,
    ds.map((d) => q(-WALL, 0, d)),
    5,
    0.6,
  );
  c.restore();
}

/** The ring and throat, cut off at the ground in front of the plane. */
function drawArch(c: CanvasRenderingContext2D, fit: FaceFit, f: FrameInfo) {
  const t = f.texture.frame;
  c.save();
  path(c, [
    ...fit.us.map((u, i) => q(u, fit.base[i])),
    q(fit.us[fit.us.length - 1], 200),
    q(fit.us[0], 200),
  ]);
  c.clip();
  // the atlas has the mirrored picture already
  if (fit.mirror) c.scale(-1, 1);
  c.drawImage(f.image, t.x, t.y, t.width, t.height, -f.anchorX * f.w, -f.anchorY * f.h, f.w, f.h);
  c.restore();
}

/** The dark of the tunnel, over rail and train alike, deepening toward the jamb they go behind. */
const DARK_STOPS: [number, number][] = [
  [0, 0],
  [0.3, 0.18],
  [0.6, 0.55],
  [0.85, 0.88],
  [1, 0.97],
];

/** The portals' pictures, from the swatches in `atlas`. */
export function canvasPortalArt(atlas: AtlasRegistry): PortalArt {
  // the swatches once each: they are read back from the atlas's canvas
  const held = new Map<string, HTMLCanvasElement>(),
    swatch = (key: string) => {
      let s = held.get(key);
      if (!s) held.set(key, (s = texels(atlas.get(key))));
      return s;
    };
  return {
    back(fit) {
      const { us, base, top, ds, wall, run } = fit,
        ring = OPEN_W + 0.13,
        { c, done } = canvasOver(
          [
            ...us.map((u, i) => q(u, top[i] + 3)),
            ...us.map((u, i) => q(u, base[i] - 3)),
            ...ds.map((d, i) => q(-WALL, wall[i] + 3, d)),
            q(-WALL - 0.03, -2, -run),
            q(-BALLAST, -2, -run),
            q(-ring, OPEN_CROWN + 8),
            q(ring, OPEN_CROWN + 8),
          ],
          fit.mirror,
        ),
        bricks = swatch(BRICK_FRAMES[fit.bricks]),
        coping = swatch(COPING_FRAME);
      drawFace(c, fit, bricks);
      drawCutting(c, fit, bricks);
      layCoping(
        c,
        coping,
        ds
          .map((d, i) => ({ d, top: wall[i] }))
          .filter((p) => p.top >= 2)
          .map((p) => q(-WALL, p.top, p.d)),
      );
      layCoping(
        c,
        coping,
        us.map((u, i) => q(u, top[i])),
      );
      drawArch(c, fit, atlas.get(PORTAL_FRAMES[fit.mirror ? 'S' : 'E']));
      return done();
    },
    dark(fit) {
      const { c, done } = canvasOver(fit.opening, fit.mirror),
        g = c.createLinearGradient(6, 0, q(OPEN_W, 0).x, 0);
      for (const [at, a] of DARK_STOPS) g.addColorStop(at, `rgba(6,6,9,${a})`);
      c.fillStyle = g;
      path(c, fit.opening);
      c.fill();
      return done();
    },
  };
}
