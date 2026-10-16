import { ImageSource, Rectangle, Sprite, Texture } from 'pixi.js';
import type { FrameInfo } from '../engine/atlas';
import { PAL } from '../art/palette';
import { structureFamily } from './assetScale';
import {
  bakedShadow,
  baseColour,
  contactShadow,
  feetOf,
  footContour,
  footShade,
  PEBBLE_COLOURS,
  TUFT_COLOURS,
  type Foot,
  type FootGround,
  type Pebble,
  type Tuft,
} from './groundFit';

// Reviewed regions on the packed, rectified source frames: x/y/width/height.
// The colour selector is deliberately restricted to these windows, so blue roof
// outlines, open warehouse bays and water-tower pipes cannot become lamps.
const WINDOW_REGIONS: Record<string, number[][]> = {
  station: [
    [0.185, 0.54, 0.08, 0.16],
    [0.545, 0.68, 0.065, 0.14],
    [0.78, 0.74, 0.06, 0.15],
    [0.77, 0.5, 0.05, 0.13],
    [0.34, 0.63, 0.035, 0.08],
  ],
  townhouse: [
    [0.115, 0.535, 0.085, 0.14],
    [0.43, 0.665, 0.08, 0.14],
    [0.77, 0.47, 0.052, 0.12],
  ],
  town: [
    [0.12, 0.43, 0.07, 0.105],
    [0.13, 0.59, 0.07, 0.09],
    [0.56, 0.59, 0.09, 0.1],
    [0.57, 0.765, 0.08, 0.09],
    [0.79, 0.62, 0.06, 0.085],
    [0.79, 0.78, 0.06, 0.09],
    [0.89, 0.58, 0.045, 0.07],
    [0.89, 0.75, 0.045, 0.09],
    [0.34, 0.49, 0.06, 0.09],
  ],
  warehouse: [
    [0.06, 0.45, 0.05, 0.14],
    [0.74, 0.43, 0.035, 0.06],
  ],
  farm: [
    [0.515, 0.61, 0.065, 0.115],
    [0.25, 0.395, 0.045, 0.075],
    [0.59, 0.31, 0.055, 0.095],
  ],
  windmill: [[0.4, 0.57, 0.055, 0.11]],
};

/** Frame `f`'s size in world px over `canvas`, filtered linearly with no mipmaps. */
function texture(canvas: HTMLCanvasElement, f: FrameInfo) {
  return canvasTexture(canvas, f.w, f.h, false);
}
/** Frame `f`'s texels copied one to one onto a canvas of their own. */
function copy(f: FrameInfo) {
  const rect = f.texture.frame,
    canvas = document.createElement('canvas');
  canvas.width = rect.width;
  canvas.height = rect.height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(f.image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  return { canvas, ctx };
}
function read(f: FrameInfo) {
  const { canvas, ctx } = copy(f);
  return { canvas, ctx, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height) };
}
/**
 * A texture of RGBA texels `w` x `h`, drawn `ow` x `oh` world px and filtered linearly, through
 * mipmaps when `mipmaps` is set.
 */
function layer(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  ow: number,
  oh: number,
  mipmaps: boolean,
) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
  return canvasTexture(canvas, ow, oh, mipmaps);
}
/** Weeds and pebbles are drawn at this many texels per world px. */
const WEED_RES = 3;
/** A colour `0xRRGGBB` at alpha `a`, for a canvas. */
const css = (c: number, a = 1) => `rgba(${c >> 16},${(c >> 8) & 255},${c & 255},${a})`;
function canvasTexture(canvas: HTMLCanvasElement, ow: number, oh: number, mipmaps: boolean) {
  return new Texture({
    source: new ImageSource({
      resource: canvas,
      scaleMode: 'linear',
      autoGenerateMipmaps: mipmaps,
    }),
    orig: new Rectangle(0, 0, ow, oh),
  });
}
/** A layer drawn with a building, placed by its anchor (0..1 of its size). */
export interface AnchoredTexture {
  texture: Texture;
  anchorX: number;
  anchorY: number;
}
/** What fits a building to the ground (groundFit.ts), for one picture at one scale. */
export interface GroundFitArt {
  /** The darkening over the picture's foot, drawn over it at its place and scale. */
  foot: AnchoredTexture | null;
  /**
   * The soft shadow it casts on the ground, at scale 1; null when nothing stands on the ground or
   * the picture has its own ground shadow baked in.
   */
  shadow: AnchoredTexture | null;
  /** Its feet about one world px apart, in world px from its anchor at that scale. */
  feet: Foot[];
  /** The colour of its walls just above their foot (`baseColour`), for a plinth under them. */
  base: readonly [number, number, number] | null;
}
/**
 * Colour statistics measured from the atlases (terrain/mountain_* frames, and the rock material
 * of assets/terrain-surfaces.png); re-measure if either is regenerated.
 */
const SPRITE_ROCK = { mean: [118, 116, 109], std: [47.1, 37, 26] };
const TERRAIN_ROCK = { mean: [138, 133, 119], std: [45.6, 36.5, 26.7] };
const SPRITE_SNOW = [229, 219, 202];
/** The painter's snow (landscape.worker.ts SNOW). */
const TERRAIN_SNOW = [234, 239, 246];
const unit = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class SurfaceAssets {
  private pictures = new Map<string, Texture>();
  private windows = new Map<string, Texture>();
  private groundFits = new Map<string, GroundFitArt>();
  private summits = new Map<string, Texture>();
  /**
   * Building `key`'s picture as it is drawn: a copy of its atlas frame, texel for texel, filtered
   * linearly with no mipmaps. The atlas draws an illustrated frame through its mipmaps, which
   * softens a building at the scales the view shows it at, and a generated one nearest; the copy
   * keeps each as crisp as it has always been drawn. Nothing is ever written over it.
   */
  picture(key: string, f: FrameInfo) {
    let result = this.pictures.get(key);
    if (!result) {
      result = texture(copy(f).canvas, f);
      this.pictures.set(key, result);
    }
    return result;
  }
  /**
   * `match` (0..1) recolours the illustration toward the terrain's own rock and snow, `light`
   * multiplies it like the painter's height light, so the summit reads as the same stone as the
   * banks under it.
   */
  summit(key: string, f: FrameInfo, match = 0, light = 1) {
    const id = `${key}|${match}|${light.toFixed(3)}`,
      cached = this.summits.get(id);
    if (cached) return cached;
    const { canvas, ctx, pixels } = read(f),
      { width: w, height: h, data: p } = pixels;
    if (match > 0 || light !== 1)
      for (let k = 0; k < p.length; k += 4) {
        if (!p[k + 3]) continue;
        const r = p[k],
          g = p[k + 1],
          b = p[k + 2],
          lum = (r + g + b) / 3,
          sat = Math.max(r, g, b) - Math.min(r, g, b),
          // Snow: bright and nearly grey. It takes the painter's snow colour, shading kept.
          snow = unit((lum - 175) / 25) * (1 - unit((sat - 35) / 20));
        for (let c = 0; c < 3; c++) {
          const v = p[k + c],
            rock =
              ((v - SPRITE_ROCK.mean[c]) * TERRAIN_ROCK.std[c]) / SPRITE_ROCK.std[c] +
              TERRAIN_ROCK.mean[c],
            ice = (v * TERRAIN_SNOW[c]) / SPRITE_SNOW[c],
            target = rock + (ice - rock) * snow;
          p[k + c] = Math.max(0, Math.min(255, (v + (target - v) * match) * light));
        }
      }
    // A wide fade so the cap rises out of the rocky mountain top instead of sitting on it.
    const band = (w / f.w) * 16;
    for (let x = 0; x < w; x++) {
      let bottom = h - 1;
      while (bottom > h * 0.45 && p[(bottom * w + x) * 4 + 3] < 100) bottom--;
      for (let d = 0; d < band && bottom - d >= 0; d++) {
        const t = Math.min(1, d / band),
          k = ((bottom - d) * w + x) * 4;
        p[k + 3] *= t * t * (3 - 2 * t);
      }
    }
    ctx.putImageData(pixels, 0, 0);
    const result = texture(canvas, f);
    this.summits.set(id, result);
    return result;
  }
  private shafts = new Map<string, { texture: Texture; anchorY: number }>();
  /**
   * A bridge pier shaft cut `length` logical px below the centre of its top face, its foot a V
   * following the ground under a square footprint `half` px wide on each side. `fade` px at the
   * foot fade out (a pier entering water). Lengths past the drawn shaft stretch its lowest row.
   */
  shaft(key: string, f: FrameInfo, length: number, half: number, fade = 0) {
    const L = Math.round(length),
      id = `${key}|${L}|${fade}`,
      cached = this.shafts.get(id);
    if (cached) return cached;
    const { canvas: source } = read(f),
      d = source.width / f.w,
      top = f.anchorY * f.h,
      height = Math.min(f.h, top + L + half / 2 + 1),
      canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = Math.ceil((top + L + half / 2 + 1) * d);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(source, 0, 0, source.width, height * d, 0, 0, source.width, height * d);
    // Past the drawn shaft, repeat its last row down to the foot.
    for (let y = Math.floor(height * d); y < canvas.height; y++)
      ctx.drawImage(canvas, 0, Math.floor(height * d) - 2, source.width, 1, 0, y, source.width, 1);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height),
      p = pixels.data,
      cx = f.anchorX * f.w;
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < canvas.width; x++) {
        const lx = x / d - cx,
          foot = top + L + (half / 2) * Math.max(0, 1 - Math.abs(lx) / half),
          below = foot - y / d,
          k = (y * canvas.width + x) * 4;
        if (below < 0) p[k + 3] = 0;
        else if (fade && below < fade) p[k + 3] *= below / fade;
      }
    ctx.putImageData(pixels, 0, 0);
    const texture = new Texture({
        source: new ImageSource({ resource: canvas, scaleMode: 'linear' }),
        orig: new Rectangle(0, 0, f.w, canvas.height / d),
      }),
      result = { texture, anchorY: top / (canvas.height / d) };
    this.shafts.set(id, result);
    return result;
  }
  /**
   * The ground fit of picture `key` drawn at `scale`: read from its pixels once, never written
   * back to them; the picture stays its atlas frame's texels (`picture`).
   */
  groundFit(key: string, f: FrameInfo, scale: number): GroundFitArt {
    const id = `${key}|${scale}`,
      cached = this.groundFits.get(id);
    if (cached) return cached;
    const { pixels } = read(f),
      { width: w, height: h } = pixels,
      density = w / f.w,
      picture = { data: pixels.data, width: w, height: h, density },
      foot = footContour(picture),
      at = { anchorX: f.anchorX * w, anchorY: f.anchorY * h, scale },
      band = footShade(picture, foot),
      // a generated works or station has its own ground shadow: a second one would double it
      cast = bakedShadow(picture) ? null : contactShadow(picture, foot, at);
    let shade: AnchoredTexture | null = null;
    if (band) {
      // Sampled as the picture is (no mipmaps), with a clear row under the band where the picture
      // goes on below it, so the filter fades the shade at its lower edge as it fades the picture.
      const rows = Math.min(band.rows + 1, h - band.top),
        data = new Uint8ClampedArray(w * rows * 4);
      data.set(band.data);
      shade = {
        texture: layer(data, w, rows, f.w, rows / density, false),
        anchorX: f.anchorX,
        anchorY: (f.anchorY * h - band.top) / rows,
      };
    }
    const result: GroundFitArt = {
      foot: shade,
      shadow: cast && {
        texture: layer(
          cast.data,
          cast.width,
          cast.height,
          cast.width / cast.resolution,
          cast.height / cast.resolution,
          true,
        ),
        anchorX: (-cast.x * cast.resolution) / cast.width,
        anchorY: (-cast.y * cast.resolution) / cast.height,
      },
      feet: feetOf(picture, foot, at),
      base: baseColour(picture, foot),
    };
    this.groundFits.set(id, result);
    return result;
  }
  /**
   * Weeds and pebbles (groundFit.ts `footScatter`, world px from a building's anchor) drawn once
   * into a texture of their own, so they are one sprite in the building's depth rather than a
   * shape drawn every frame. Each building has its own: the caller owns and destroys it. Null when
   * nothing grows.
   */
  weeds(items: readonly (Tuft | Pebble)[], ground: FootGround): AnchoredTexture | null {
    if (!items.length || ground === 'none') return null;
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const it of items) {
      x0 = Math.min(x0, it.x - 3);
      x1 = Math.max(x1, it.x + 3);
      y0 = Math.min(y0, it.y - (it.kind === 'tuft' ? it.h : it.s) - 1);
      y1 = Math.max(y1, it.y + 2.5);
    }
    const R = WEED_RES,
      canvas = document.createElement('canvas');
    canvas.width = Math.ceil((x1 - x0) * R);
    canvas.height = Math.ceil((y1 - y0) * R);
    const ctx = canvas.getContext('2d')!,
      { blade, highlight } = TUFT_COLOURS[ground];
    ctx.setTransform(R, 0, 0, R, -x0 * R, -y0 * R);
    ctx.lineCap = 'round';
    for (const it of items) {
      if (it.kind === 'tuft') {
        const tone = it.dark ? 0 : 1;
        ctx.lineWidth = 0.65;
        ctx.strokeStyle = css(blade[tone], 0.95);
        ctx.beginPath();
        for (let q = 0; q < 4; q++) {
          const o = (q - 1.5) * 0.5;
          ctx.moveTo(it.x + o, it.y);
          ctx.lineTo(it.x + o * 1.8 + it.lean[q], it.y - it.h * (q === 1 || q === 2 ? 1 : 0.7));
        }
        ctx.stroke();
        ctx.lineWidth = 0.4;
        ctx.strokeStyle = css(highlight[tone], 0.85);
        ctx.beginPath();
        ctx.moveTo(it.x - 0.2, it.y - it.h * 0.4);
        ctx.lineTo(it.x - 0.4, it.y - it.h * 0.95);
        ctx.stroke();
      } else {
        const s = it.s,
          dot = (x: number, y: number, rx: number, ry: number, fill: string) => {
            ctx.fillStyle = fill;
            ctx.beginPath();
            ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
            ctx.fill();
          };
        dot(
          it.x + 0.35 * s,
          it.y + 0.3 * s,
          1.1 * s,
          0.5 * s,
          css(PEBBLE_COLOURS.shadow, PEBBLE_COLOURS.alpha),
        );
        dot(it.x, it.y - 0.2 * s, s, 0.62 * s, css(PEBBLE_COLOURS.body));
        dot(it.x - 0.25 * s, it.y - 0.42 * s, 0.45 * s, 0.28 * s, css(PEBBLE_COLOURS.top));
      }
    }
    return {
      texture: canvasTexture(canvas, canvas.width / R, canvas.height / R, true),
      anchorX: (-x0 * R) / canvas.width,
      anchorY: (-y0 * R) / canvas.height,
    };
  }
  /**
   * Existing glass pixels become emissive; masks inherit the owner's depth/pose. `family` picks
   * the reviewed window regions; a turned frame passes its unturned frame's (assetScale.ts
   * `scaleReference`).
   */
  window(key: string, f: FrameInfo, procedural = false, family = structureFamily(key)) {
    let result = this.windows.get(key);
    if (!result) {
      const { canvas, ctx, pixels } = read(f),
        { width: w, height: h, data: p } = pixels;
      const regions = WINDOW_REGIONS[family] ?? [];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4,
            r = p[i],
            g = p[i + 1],
            b = p[i + 2];
          const amber = [PAL.amber, PAL.amberDark].some(
            (c) => r === c[0] && g === c[1] && b === c[2],
          );
          const inside = regions.some(
            ([rx, ry, rw, rh]) => x / w >= rx && x / w < rx + rw && y / h >= ry && y / h < ry + rh,
          );
          const glass = inside && r < 85 && g < 105 && b < 110 && b > r - 12;
          if (procedural ? amber : glass) {
            p[i] = 255;
            p[i + 1] = 187;
            p[i + 2] = 91;
          } else p[i + 3] = 0;
        }
      ctx.putImageData(pixels, 0, 0);
      result = texture(canvas, f);
      this.windows.set(key, result);
    }
    return result;
  }
  destroy() {
    for (const t of [
      ...this.pictures.values(),
      ...this.windows.values(),
      ...[...this.groundFits.values()].flatMap((g) =>
        [g.foot, g.shadow].flatMap((l) => (l ? [l.texture] : [])),
      ),
      ...this.summits.values(),
      ...[...this.shafts.values()].map((v) => v.texture),
    ])
      t.destroy(true);
    this.pictures.clear();
    this.windows.clear();
    this.groundFits.clear();
    this.summits.clear();
    this.shafts.clear();
  }
}
export function windowSprite() {
  const sprite = new Sprite({ cullable: true, label: 'emissive' });
  sprite.blendMode = 'add';
  sprite.alpha = 0;
  return sprite;
}
