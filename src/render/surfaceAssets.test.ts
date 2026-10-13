import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Rectangle, Texture, TextureSource } from 'pixi.js';
import type { FrameInfo } from '../engine/atlas';
import { Rng } from '../engine/rng';
import { forAll, shrinkInt } from '../testing/property';
import {
  contactShadow,
  FOOT_RUN,
  footContour,
  footScatter,
  SHADE_ALPHA,
  SOLID,
  type Foot,
  type FootGround,
} from './groundFit';
import { SurfaceAssets } from './surfaceAssets';

/** Node has no ImageData: a stand-in that keeps the pixels. */
class FakeImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  constructor(a: Uint8ClampedArray | number, b: number, c?: number) {
    this.width = typeof a === 'number' ? a : b;
    this.height = typeof a === 'number' ? b : (c ?? a.length / 4 / b);
    this.data = typeof a === 'number' ? new Uint8ClampedArray(a * b * 4) : a;
  }
}

/**
 * A point a stand-in canvas was drawn at, in canvas px through the transform set, with the half
 * extent drawn round it (a stroke's half width, an ellipse's radii) and the point it was given.
 */
interface Mark {
  x: number;
  y: number;
  rx: number;
  ry: number;
  given: { x: number; y: number };
}
/**
 * Node has no canvas: a stand-in whose context copies the texels of an image drawn onto it one to
 * one, hands them out again, keeps what is put into it and records where paths and ellipses are
 * drawn.
 */
interface FakeCanvas {
  width: number;
  height: number;
  /** Its texels as drawImage left them, RGBA rows; null until an image is drawn onto it. */
  pixels: Uint8ClampedArray | null;
  put: FakeImageData | null;
  marks: Mark[];
  getContext: () => unknown;
}
function fakeCanvas(): FakeCanvas {
  let m = [1, 0, 0, 1, 0, 0];
  const canvas: FakeCanvas = {
      width: 0,
      height: 0,
      pixels: null,
      put: null,
      marks: [],
      getContext: () => ctx,
    },
    mark = (x: number, y: number, rx: number, ry: number) =>
      canvas.marks.push({
        x: m[0] * x + m[2] * y + m[4],
        y: m[1] * x + m[3] * y + m[5],
        rx: rx * m[0],
        ry: ry * m[3],
        given: { x, y },
      }),
    ctx = {
      lineWidth: 1,
      lineCap: 'butt',
      strokeStyle: '',
      fillStyle: '',
      imageSmoothingEnabled: true,
      // the image's rectangle (sx, sy, sw, sh) onto (dx, dy), one texel to one texel only
      drawImage: (img: FakeImageData, ...r: number[]) => {
        const [sx, sy, sw, sh, dx, dy, dw, dh] = r;
        if (r.length !== 8 || sw !== dw || sh !== dh) throw new Error('not a one to one copy');
        const to = (canvas.pixels ??= new Uint8ClampedArray(canvas.width * canvas.height * 4));
        for (let j = 0; j < sh; j++)
          for (let i = 0; i < sw; i++) {
            const x = dx + i,
              y = dy + j,
              k = ((sy + j) * img.width + sx + i) * 4;
            if (x >= 0 && y >= 0 && x < canvas.width && y < canvas.height)
              to.set(img.data.subarray(k, k + 4), (y * canvas.width + x) * 4);
          }
      },
      getImageData: (x: number, y: number, w: number, h: number) => {
        const out = new FakeImageData(w, h);
        for (let j = 0; j < h; j++) {
          const k = ((y + j) * canvas.width + x) * 4;
          out.data.set(canvas.pixels!.subarray(k, k + w * 4), j * w * 4);
        }
        return out;
      },
      putImageData: (img: FakeImageData) => (canvas.put = img),
      setTransform: (...t: number[]) => (m = t),
      beginPath: () => {},
      stroke: () => {},
      fill: () => {},
      moveTo: (x: number, y: number) => mark(x, y, ctx.lineWidth / 2, ctx.lineWidth / 2),
      lineTo: (x: number, y: number) => mark(x, y, ctx.lineWidth / 2, ctx.lineWidth / 2),
      ellipse: (x: number, y: number, rx: number, ry: number) => mark(x, y, rx, ry),
    };
  return canvas;
}
const canvasOf = (t: Texture) => t.source.resource as FakeCanvas;

/**
 * A generated test building: walls `height` px tall standing on the ground lines through its front
 * corner, `left` and `right` px to each side, with a soft edge of translucent texels beside them
 * and `margin` blank px round it all, drawn at `density` texels per px and anchored `anchorUp` px
 * above the front corner; the renderer draws it at `scale`.
 */
interface Building {
  density: number;
  left: number;
  right: number;
  height: number;
  margin: number;
  anchorUp: number;
  scale: number;
}
function building(rng: Rng): Building {
  return {
    density: rng.pick([1, 2, 4]),
    left: rng.int(3, 14),
    right: rng.int(3, 14),
    height: rng.int(FOOT_RUN + 2, 24),
    margin: rng.int(1, 6),
    anchorUp: rng.int(0, 8),
    scale: rng.pick([0.5, 0.7, 1, 1.2, 1.5]),
  };
}
function* shrinkBuilding(b: Building): Iterable<Building> {
  if (b.density !== 1) yield { ...b, density: 1 };
  if (b.scale !== 1) yield { ...b, scale: 1 };
  for (const left of shrinkInt(b.left, 3)) yield { ...b, left };
  for (const right of shrinkInt(b.right, 3)) yield { ...b, right };
  for (const height of shrinkInt(b.height, FOOT_RUN + 2)) yield { ...b, height };
  for (const margin of shrinkInt(b.margin, 1)) yield { ...b, margin };
  for (const anchorUp of shrinkInt(b.anchorUp)) yield { ...b, anchorUp };
}

const SOURCE = new TextureSource({ width: 1024, height: 1024 });

/** Its atlas frame: the picture as the atlas image, its anchor, its size in world px. */
function frameOf(b: Building): FrameInfo {
  const d = b.density,
    fx = b.margin + 1 + b.left,
    fy = b.margin + b.height + Math.ceil(Math.max(b.left, b.right) / 2),
    W = fx + b.right + 2 + b.margin,
    H = fy + 1 + b.margin,
    foot = (X: number) => fy - Math.floor(Math.abs(X - fx) / 2),
    data = new Uint8ClampedArray(W * d * H * d * 4);
  for (let y = 0; y < H * d; y++)
    for (let x = 0; x < W * d; x++) {
      const X = Math.floor(x / d),
        Y = Math.floor(y / d),
        wall = X >= fx - b.left && X <= fx + b.right,
        edge = X === fx - b.left - 1 || X === fx + b.right + 1,
        bottom = foot(Math.min(Math.max(X, fx - b.left), fx + b.right));
      if ((!wall && !edge) || Y > bottom || Y < bottom - b.height) continue;
      data.set(
        wall ? [200, 180, 150, 200 + ((x * 7 + y * 13) % 56)] : [190, 170, 140, 90],
        (y * W * d + x) * 4,
      );
    }
  return {
    image: new FakeImageData(data, W * d, H * d) as never,
    texture: new Texture({
      source: SOURCE,
      frame: new Rectangle(0, 0, W * d, H * d),
      orig: new Rectangle(0, 0, W, H),
    }),
    anchorX: (fx + 0.5) / W,
    anchorY: (fy + 1 - b.anchorUp) / H,
    w: W,
    h: H,
  };
}
const pixelsOf = (f: FrameInfo) => f.image as unknown as FakeImageData;

/**
 * Where a sprite showing `t` from (`ax`, `ay`) at `scale` draws the centre of its texel (i, j):
 * world px from the sprite's position.
 */
function texelAt(t: Texture, ax: number, ay: number, scale: number, i: number, j: number) {
  return {
    x: ((i + 0.5) * (t.orig.width / t.frame.width) - ax * t.orig.width) * scale,
    y: ((j + 0.5) * (t.orig.height / t.frame.height) - ay * t.orig.height) * scale,
  };
}
/** The texel of frame `f`, drawn at `scale`, under world px (x, y) from the building's position. */
function pictureAt(f: FrameInfo, scale: number, x: number, y: number) {
  const { width: w, height: h } = f.texture.frame,
    px = Math.floor((x / scale / f.w + f.anchorX) * w),
    py = Math.floor((y / scale / f.h + f.anchorY) * h),
    inside = px >= 0 && py >= 0 && px < w && py < h;
  return { px, py, alpha: inside ? pixelsOf(f).data[(py * w + px) * 4 + 3] : 0 };
}

/**
 * An atlas image with one frame `w` x `h` world px at `density` texels per px in it, at texel
 * (`x`, `y`) with `right` and `below` texels of other frames past it; every texel is painted, from
 * `seed`, clear, translucent and opaque alike.
 */
interface Sheet {
  density: number;
  w: number;
  h: number;
  x: number;
  y: number;
  right: number;
  below: number;
  seed: number;
}
function atlasOf(s: Sheet) {
  const fw = s.w * s.density,
    fh = s.h * s.density,
    W = s.x + fw + s.right,
    H = s.y + fh + s.below,
    rng = new Rng(s.seed),
    data = new Uint8ClampedArray(W * H * 4);
  for (let k = 0; k < data.length; k++)
    data[k] = rng.pick([0, 1, 169, 170, 254, 255, rng.int(0, 255)]);
  const image = new FakeImageData(data, W, H),
    f: FrameInfo = {
      image: image as never,
      texture: new Texture({
        source: SOURCE,
        frame: new Rectangle(s.x, s.y, fw, fh),
        orig: new Rectangle(0, 0, s.w, s.h),
      }),
      anchorX: 0.5,
      anchorY: 0.9,
      w: s.w,
      h: s.h,
    };
  return { image, f };
}

describe('the picture a building is drawn from', () => {
  beforeEach(() => {
    vi.stubGlobal('ImageData', FakeImageData);
    vi.stubGlobal('document', { createElement: fakeCanvas });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("holds its atlas frame's own texels, every one and nothing else, at the frame's size", () => {
    forAll(
      (rng): Sheet => ({
        density: rng.pick([1, 2, 4]),
        w: rng.int(1, 12),
        h: rng.int(1, 12),
        x: rng.int(0, 9),
        y: rng.int(0, 9),
        right: rng.int(0, 9),
        below: rng.int(0, 9),
        seed: rng.int(1, 1_000_000),
      }),
      (s) => {
        const { image, f } = atlasOf(s),
          atlas = Uint8ClampedArray.from(image.data),
          t = new SurfaceAssets().picture('structures/test', f),
          copy = canvasOf(t),
          wrong: string[] = [];
        expect([copy.width, copy.height]).toEqual([f.texture.frame.width, f.texture.frame.height]);
        expect(copy.put, 'nothing put over the copy').toBeNull();
        for (let j = 0; j < copy.height; j++)
          for (let i = 0; i < copy.width; i++) {
            const k = ((s.y + j) * image.width + s.x + i) * 4,
              texel = [
                ...copy.pixels!.subarray((j * copy.width + i) * 4, (j * copy.width + i + 1) * 4),
              ],
              own = [...atlas.subarray(k, k + 4)];
            if (texel.join() !== own.join()) wrong.push(`${i},${j} is ${texel}, not ${own}`);
          }
        expect(wrong.slice(0, 5), `${wrong.length} in all`).toEqual([]);
        // drawn whole, at the world size the atlas frame is drawn at
        expect([t.frame.x, t.frame.y, t.frame.width, t.frame.height]).toEqual([
          0,
          0,
          copy.width,
          copy.height,
        ]);
        expect([t.orig.width, t.orig.height]).toEqual([
          f.texture.orig.width,
          f.texture.orig.height,
        ]);
        expect(image.data, 'the atlas itself').toEqual(atlas);
      },
    );
  });

  it('is sampled linearly with no mipmaps at any density, and the shade over its foot alike', () => {
    for (const density of [1, 2, 4]) {
      const f = frameOf({
          density,
          left: 6,
          right: 8,
          height: 10,
          margin: 2,
          anchorUp: 3,
          scale: 1,
        }),
        surfaces = new SurfaceAssets(),
        { foot } = surfaces.groundFit('structures/test', f, 1),
        at = `at density ${density}`;
      for (const [name, t] of [
        ['picture', surfaces.picture('structures/test', f)],
        ['foot shade', foot!.texture],
      ] as const)
        expect(
          [t.source.magFilter, t.source.minFilter, t.source.autoGenerateMipmaps],
          `${name} ${at}`,
        ).toEqual(['linear', 'linear', false]);
      // The shade ends on a clear row under the lowest foot, where the picture goes on below: the
      // filter fades it at that edge as it fades the picture, rather than stretching its foot row.
      const { width: w, height: h, data } = pixelsOf(f),
        lowest = Math.max(...footContour({ data, width: w, height: h, density })),
        band = canvasOf(foot!.texture).put!,
        last = Math.round(f.anchorY * h - foot!.anchorY * band.height) + band.height - 1;
      expect(lowest + 1, at).toBeLessThan(h);
      expect(last, at).toBe(lowest + 1);
      expect(
        band.data.subarray((band.height - 1) * band.width * 4).every((v) => v === 0),
        at,
      ).toBe(true);
    }
  });

  it("is copied once per frame and freed with the surfaces, the atlas frame's texture left alone", () => {
    const { f } = atlasOf({ density: 2, w: 5, h: 4, x: 3, y: 2, right: 4, below: 1, seed: 7 }),
      { f: other } = atlasOf({ density: 1, w: 3, h: 6, x: 0, y: 0, right: 0, below: 0, seed: 8 }),
      surfaces = new SurfaceAssets(),
      t = surfaces.picture('structures/a', f),
      u = surfaces.picture('structures/b', other);
    expect(surfaces.picture('structures/a', f)).toBe(t);
    expect(u).not.toBe(t);
    surfaces.destroy();
    expect([t.destroyed, u.destroyed]).toEqual([true, true]);
    expect([f.texture.destroyed, other.texture.destroyed]).toEqual([false, false]);
  });
});

describe('the ground fit drawn with a building', () => {
  beforeEach(() => {
    vi.stubGlobal('ImageData', FakeImageData);
    vi.stubGlobal('document', { createElement: fakeCanvas });
  });
  afterEach(() => vi.unstubAllGlobals());

  // a hundred pictures fitted whole, cast shadow and all, take up to half a second alone
  it("lays the shade on the picture's own texels, darkest on each foot, where the sprites draw them", () => {
    forAll(
      building,
      (b) => {
        const f = frameOf(b),
          { foot: shade } = new SurfaceAssets().groundFit('structures/test', f, b.scale),
          band = canvasOf(shade!.texture).put!,
          { width: w, height: h, data } = pixelsOf(f),
          foot = footContour({ data, width: w, height: h, density: b.density }),
          shaded = new Set<number>(),
          wrong: string[] = [];
        for (let j = 0; j < band.height; j++)
          for (let i = 0; i < band.width; i++) {
            const a = band.data[(j * band.width + i) * 4 + 3],
              p = texelAt(shade!.texture, shade!.anchorX, shade!.anchorY, b.scale, i, j),
              q = pictureAt(f, b.scale, p.x, p.y);
            if (a && (!q.alpha || a > Math.round(SHADE_ALPHA * q.alpha) + 1))
              wrong.push(`${i},${j} at ${a} over ${q.px},${q.py} at ${q.alpha}`);
            if (q.px >= 0 && q.px < w && foot[q.px] === q.py) {
              shaded.add(q.px);
              if (a !== Math.round(SHADE_ALPHA * q.alpha)) wrong.push(`foot ${q.px} at ${a}`);
            }
          }
        for (let x = 0; x < w; x++)
          if (foot[x] >= 0 && !shaded.has(x)) wrong.push(`foot ${x} not under the shade`);
        expect(wrong.slice(0, 5), `${wrong.length} in all`).toEqual([]);
      },
      { shrink: shrinkBuilding },
    );
  }, 10_000);

  // the same hundred pictures fitted whole again
  it('stands its feet on the bottom edge of the picture as it is drawn', () => {
    forAll(
      building,
      (b) => {
        const f = frameOf(b),
          { feet } = new SurfaceAssets().groundFit('structures/test', f, b.scale),
          { width: w, height: h, data } = pixelsOf(f),
          foot = footContour({ data, width: w, height: h, density: b.density }),
          // a tenth of a texel in world px, either side of a foot's edge
          e = (0.1 * b.scale) / b.density,
          wrong: string[] = [];
        expect(feet.length).toBeGreaterThan(0);
        feet.forEach((q: Foot, n) => {
          const above = pictureAt(f, b.scale, q.x, q.y - e),
            below = pictureAt(f, b.scale, q.x, q.y + e);
          if (foot[above.px] !== above.py || below.py !== above.py + 1 || below.px !== above.px)
            wrong.push(`foot ${n} at ${q.x},${q.y}: over ${above.px},${above.py}`);
        });
        expect(wrong.slice(0, 5), `${wrong.length} in all`).toEqual([]);
      },
      { shrink: shrinkBuilding },
    );
  }, 10_000);

  // the same hundred pictures, with each cast shadow made twice and every texel of it mapped back
  it('casts its shadow where it was made for, under no wall of the picture as drawn and to the lower right of its feet', () => {
    forAll(
      building,
      (b) => {
        const f = frameOf(b),
          { shadow, feet } = new SurfaceAssets().groundFit('structures/test', f, b.scale),
          layer = canvasOf(shadow!.texture).put!,
          { width: w, height: h, data } = pixelsOf(f),
          picture = { data, width: w, height: h, density: b.density },
          made = contactShadow(picture, footContour(picture), {
            anchorX: f.anchorX * w,
            anchorY: f.anchorY * h,
            scale: b.scale,
          })!,
          wrong: string[] = [];
        // the layer groundFit.ts made, each texel where it says: (x, y) is its top left corner
        expect([layer.width, layer.height]).toEqual([made.width, made.height]);
        expect(layer.data.findIndex((v, k) => made.data[k] !== v)).toBe(-1);
        for (const [i, j] of [
          [0, 0],
          [made.width - 1, made.height - 1],
        ]) {
          const p = texelAt(shadow!.texture, shadow!.anchorX, shadow!.anchorY, 1, i, j);
          expect(p.x).toBeCloseTo(made.x + (i + 0.5) / made.resolution, 9);
          expect(p.y).toBeCloseTo(made.y + (j + 0.5) / made.resolution, 9);
        }
        let sum = 0,
          sx = 0,
          sy = 0;
        for (let j = 0; j < layer.height; j++)
          for (let i = 0; i < layer.width; i++) {
            const a = layer.data[(j * layer.width + i) * 4 + 3];
            if (!a) continue;
            // the cast shadow is drawn at scale 1: it was made at the building's
            const p = texelAt(shadow!.texture, shadow!.anchorX, shadow!.anchorY, 1, i, j),
              // a centre on the very edge between two picture texels is under the clearer one
              q = [-1e-6, 1e-6]
                .flatMap((dx) =>
                  [-1e-6, 1e-6].map((dy) => pictureAt(f, b.scale, p.x + dx, p.y + dy)),
                )
                .reduce((u, v) => (v.alpha < u.alpha ? v : u));
            if (q.alpha >= SOLID || a > 255 - q.alpha + 1)
              wrong.push(`${i},${j} at ${a} under ${q.px},${q.py} at ${q.alpha}`);
            sum += a;
            sx += a * p.x;
            sy += a * p.y;
          }
        expect(wrong.slice(0, 5), `${wrong.length} in all`).toEqual([]);
        const fx = feet.reduce((s, q) => s + q.x, 0) / feet.length,
          fy = feet.reduce((s, q) => s + q.y, 0) / feet.length;
        expect(sum).toBeGreaterThan(0);
        expect(sx / sum, 'right of the feet').toBeGreaterThan(fx);
        expect(sy / sum, 'below the feet').toBeGreaterThan(fy);
      },
      { shrink: shrinkBuilding },
    );
  }, 10_000);

  it('casts no second shadow from a generated picture with one baked in, and keeps its shade and feet', () => {
    for (const density of [1, 2]) {
      const b = { density, left: 6, right: 8, height: 10, margin: 3, anchorUp: 3, scale: 1 },
        plain = frameOf(b),
        { width: w, height: h, data } = pixelsOf(plain),
        // the generators' ground shadow (src/art/industry.ts) on the ground right of the walls
        baked = Uint8ClampedArray.from(data),
        fx = b.margin + 1 + b.left,
        fy = b.margin + b.height + Math.ceil(Math.max(b.left, b.right) / 2);
      for (let y = (fy - 6) * density; y < (fy + 1) * density; y++)
        for (let x = (fx + b.right + 2) * density; x < w; x++)
          baked.set([30, 40, 30, 70], (y * w + x) * 4);
      const surfaces = new SurfaceAssets(),
        own = surfaces.groundFit('structures/plain', plain, 1),
        fit = surfaces.groundFit(
          'structures/baked',
          { ...plain, image: new FakeImageData(baked, w, h) as never },
          1,
        );
      expect(own.shadow, `density ${density}`).not.toBeNull();
      // one texel per px is a generated picture; an illustrated one bakes no ground shadow
      expect(fit.shadow === null, `density ${density}`).toBe(density === 1);
      expect(fit.foot, `density ${density}`).not.toBeNull();
      expect(fit.feet, `density ${density}`).toEqual(own.feet);
    }
  });

  it('is made once per picture and scale, and freed with the surfaces', () => {
    const f = frameOf({
        density: 2,
        left: 6,
        right: 8,
        height: 10,
        margin: 2,
        anchorUp: 3,
        scale: 1,
      }),
      surfaces = new SurfaceAssets(),
      art = surfaces.groundFit('structures/test', f, 1);
    expect(surfaces.groundFit('structures/test', f, 1)).toBe(art);
    const other = surfaces.groundFit('structures/test', f, 0.5);
    expect(other).not.toBe(art);
    surfaces.destroy();
    for (const t of [art.foot!.texture, art.shadow!.texture, other.foot!.texture])
      expect(t.destroyed).toBe(true);
    expect(f.texture.destroyed, "the atlas frame's own texture").toBe(false);
  });
});

describe('the weeds and pebbles drawn at a building', () => {
  beforeEach(() => {
    vi.stubGlobal('ImageData', FakeImageData);
    vi.stubGlobal('document', { createElement: fakeCanvas });
  });
  afterEach(() => vi.unstubAllGlobals());

  /** A row of feet `n` world px across with a front corner, on the ground `ground`, at a tile. */
  interface Row {
    n: number;
    drop: number;
    tx: number;
    ty: number;
    ground: Exclude<FootGround, 'none'>;
  }
  const feetOf = ({ n, drop }: Row): Foot[] =>
    Array.from({ length: n }, (_, i) => ({
      x: i - n / 2,
      y: drop - Math.abs(i - n / 2) / 2,
      right: i > n / 2,
    }));

  it('draws each one whole inside its texture, at its own place from the anchor', () => {
    forAll(
      (rng): Row => ({
        n: rng.int(1, 120),
        drop: rng.int(-20, 20),
        tx: rng.int(-300, 300),
        ty: rng.int(-300, 300),
        ground: rng.pick(['grass', 'dry', 'stony'] as const),
      }),
      (row) => {
        const items = footScatter(feetOf(row), row.tx, row.ty, row.ground),
          art = new SurfaceAssets().weeds(items, row.ground);
        if (!items.length) {
          expect(art).toBeNull();
          return;
        }
        const t = art!.texture,
          { width: cw, height: ch, marks } = canvasOf(t),
          wrong: string[] = [];
        for (const m of marks) {
          if (m.x - m.rx < 0 || m.y - m.ry < 0 || m.x + m.rx > cw || m.y + m.ry > ch)
            wrong.push(`${m.given.x},${m.given.y} cut at the edge of ${cw}x${ch}`);
          // where the sprite, at the building's position, shows that canvas point
          const x = m.x * (t.orig.width / t.frame.width) - art!.anchorX * t.orig.width,
            y = m.y * (t.orig.height / t.frame.height) - art!.anchorY * t.orig.height;
          if (Math.abs(x - m.given.x) > 1e-9 || Math.abs(y - m.given.y) > 1e-9)
            wrong.push(`${m.given.x},${m.given.y} shown at ${x},${y}`);
        }
        for (const it of items)
          if (!marks.some((m) => Math.hypot(m.given.x - it.x, m.given.y - it.y) <= 1))
            wrong.push(`${it.kind} at ${it.x},${it.y} not drawn`);
        expect(wrong.slice(0, 5), `${wrong.length} in all`).toEqual([]);
      },
    );
  });

  it('are nothing where nothing grows', () => {
    const feet = feetOf({ n: 40, drop: 4, tx: 1, ty: 2, ground: 'grass' }),
      surfaces = new SurfaceAssets();
    expect(surfaces.weeds([], 'grass')).toBeNull();
    expect(surfaces.weeds(footScatter(feet, 1, 2, 'grass'), 'none')).toBeNull();
  });
});
