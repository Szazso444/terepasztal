import { HALF_H, HALF_W } from '../engine/iso';
import { hash2 } from '../engine/rng';
import { Material } from './landscapeModel';

/**
 * How a building meets the ground, worked out from its picture's alpha: where its walls stand
 * (`footContour`), the darkening at their foot drawn over the picture (`footShade`), the soft
 * shadow it casts on the ground (`contactShadow`) and the weeds and pebbles over the front of its
 * base (`footScatter`). The picture itself is never changed: each of these is a separate layer.
 * Pure, so it runs under Node; surfaceAssets.ts reads the pixels and makes the textures.
 */

/** A picture's pixels in ImageData's layout: RGBA rows, `density` texels per world px. */
export interface Picture {
  data: ArrayLike<number>;
  width: number;
  height: number;
  density: number;
}

/** A texel at least this opaque belongs to the picture (`PixelBuf.outline`'s lower rim is 170). */
export const SOLID = 170;
/**
 * A wall that stands on the ground rises at least this far (world px) in one opaque run from its
 * foot. The lowest pixels of sails, lamps, canopy ends and pipes are thinner than that.
 */
export const FOOT_RUN = 4;
/** On the ground a wall's foot rises at most half a pixel per pixel away from the front corner. */
export const ISO_SLOPE = HALF_H / HALF_W;
/**
 * How far (world px) a foot may stand above that line and still be on the ground: a set-back
 * wall, a round base. A tank between legs or the overhang of a roof stands higher.
 */
export const FOOT_TOLERANCE = 2;

/** The shadow colour: a cool slate dark (palette seed #626B6C, darkened), never olive. */
export const SHADOW_RGB: readonly [number, number, number] = [26, 30, 33];

/** Foot occlusion: strongest at the foot, gone this far (world px) above it. */
export const SHADE_BAND = 2.6;
export const SHADE_ALPHA = 0.32;

/** The cast shadow: how far it reaches along the light (tiles) and how dark it starts. */
export const SHADOW_REACH = 0.2;
export const SHADOW_ALPHA = 0.36;
/**
 * The light comes from the upper left, so a shadow falls toward +x and a little toward +y (in
 * tiles per tile along the light): to the lower right on screen.
 */
export const LIGHT = { x: 1, y: 0.3 } as const;
/** The cast shadow's texels per world px; it is soft, so it needs no more. */
export const SHADOW_RES = 2;
/** The darkening on the ground just under each foot: its reach (world px) and falloff. */
const OCCLUSION = 6;
const OCCLUSION_FALL = 1.5;
/** The shadow's soft edge, as two box blurs of this radius (world px). */
const BLUR = 1.5;

/**
 * The row of each texel column's foot, or -1 where the column does not stand on the ground. A
 * foot is the column's lowest opaque texel, kept when an opaque run of `FOOT_RUN` rises from it
 * and it lies on or below the ground lines through the front corner (the lowest such foot),
 * within `FOOT_TOLERANCE`. A thinner opaque run with translucent paint over it is drawn on the
 * ground, the rim of a baked yard or shadow (`PixelBuf.outline` rims the paint too), so the foot
 * is looked for above the paint; one with nothing over it (a sail, a lamp) has none.
 */
export function footContour({ data, width: w, height: h, density: d }: Picture): Int32Array {
  const foot = new Int32Array(w).fill(-1),
    minRun = FOOT_RUN * d;
  let low = -1;
  for (let x = 0; x < w; x++) {
    const alpha = (y: number) => data[(y * w + x) * 4 + 3];
    let y = h - 1;
    while (y >= 0 && alpha(y) < SOLID) y--;
    while (y >= 0) {
      let run = 0;
      while (run < minRun && y - run >= 0 && alpha(y - run) >= SOLID) run++;
      if (run >= minRun) {
        foot[x] = y;
        low = Math.max(low, y);
        break;
      }
      // a rim drawn on the ground: past it and the paint over it to the next opaque run
      y -= run;
      while (y >= 0 && alpha(y) > 0 && alpha(y) < SOLID) y--;
      if (y >= 0 && alpha(y) === 0) break;
    }
  }
  if (low < 0) return foot;
  const apex = frontCorner(foot),
    tolerance = FOOT_TOLERANCE * d;
  for (let x = 0; x < w; x++)
    if (foot[x] >= 0 && foot[x] < low - ISO_SLOPE * Math.abs(x - apex) - tolerance) foot[x] = -1;
  return foot;
}

/** The column of the front corner: the middle of the columns whose foot is lowest; -1 if none. */
export function frontCorner(foot: Int32Array): number {
  let low = -1,
    first = -1,
    last = -1;
  for (let x = 0; x < foot.length; x++)
    if (foot[x] > low) {
      low = foot[x];
      first = last = x;
    } else if (foot[x] === low && low >= 0) last = x;
  return low < 0 ? -1 : Math.floor((first + last) / 2);
}

/** An RGBA layer `rows` texels high whose top row is the picture's row `top`. */
export interface Band {
  top: number;
  rows: number;
  data: Uint8ClampedArray;
}

/**
 * The darkening over the picture's foot: the shadow colour, masked by the picture's own alpha,
 * `SHADE_ALPHA` at each foot and fading out over `SHADE_BAND` above it. The picture's width, its
 * rows from the highest foot's band to the lowest foot; null when nothing stands on the ground.
 */
export function footShade(p: Picture, foot: Int32Array): Band | null {
  const { data, width: w, density: d } = p,
    band = SHADE_BAND * d;
  let top = Infinity,
    bottom = -1;
  for (let x = 0; x < w; x++)
    if (foot[x] >= 0) {
      top = Math.min(top, Math.floor(foot[x] - band));
      bottom = Math.max(bottom, foot[x]);
    }
  if (bottom < 0) return null;
  top = Math.max(0, top);
  const rows = bottom - top + 1,
    out = new Uint8ClampedArray(w * rows * 4);
  for (let x = 0; x < w; x++) {
    const f = foot[x];
    if (f < 0) continue;
    for (let y = f; y >= top && f - y < band; y--) {
      const a = data[(y * w + x) * 4 + 3] / 255;
      if (!a) continue;
      const k = ((y - top) * w + x) * 4;
      out[k] = SHADOW_RGB[0];
      out[k + 1] = SHADOW_RGB[1];
      out[k + 2] = SHADOW_RGB[2];
      out[k + 3] = Math.round(SHADE_ALPHA * Math.pow(1 - (f - y) / band, 1.6) * a * 255);
    }
  }
  return { top, rows, data: out };
}

/** Where a picture is drawn: its anchor in texels and the scale it is drawn at. */
export interface Placement {
  anchorX: number;
  anchorY: number;
  scale: number;
}

/**
 * A layer on the ground in world px around the building's anchor: its top left corner at
 * (`x`, `y`), `width` x `height` texels at `resolution` texels per world px.
 */
export interface GroundLayer {
  x: number;
  y: number;
  width: number;
  height: number;
  resolution: number;
  data: Uint8ClampedArray;
}

/** One foot in world px from the anchor; `right` on the shaded side of the front corner. */
export interface Foot {
  x: number;
  y: number;
  right: boolean;
}

/** World px from the anchor of texel column `c`'s foot (the bottom edge of its foot texel). */
function footAt(p: Picture, at: Placement, foot: Int32Array, c: number) {
  const k = at.scale / p.density;
  return { x: (c + 0.5 - at.anchorX) * k, y: (foot[c] + 1 - at.anchorY) * k };
}

/** The feet about one world px apart, for what stands along them. */
export function feetOf(p: Picture, foot: Int32Array, at: Placement): Foot[] {
  const front = frontCorner(foot);
  if (front < 0) return [];
  const step = Math.max(1, Math.round(p.density / at.scale)),
    frontX = footAt(p, at, foot, front).x,
    out: Foot[] = [];
  for (let c = front % step; c < foot.length; c += step)
    if (foot[c] >= 0) {
      const q = footAt(p, at, foot, c);
      out.push({ x: q.x, y: q.y, right: q.x > frontX });
    }
  return out;
}

/**
 * The ground under a building as world px from its anchor, per picture column from `first` to
 * `last`: from its far side (`back`) down to its feet (`front`). The feet are joined straight
 * across columns that have none; the far side is the feet turned half round the footprint's centre
 * (midway between the outermost feet), which closes a box or a round base by its own shape.
 */
export function footprint(p: Picture, foot: Int32Array, at: Placement) {
  let first = -1,
    last = -1;
  for (let c = 0; c < foot.length; c++)
    if (foot[c] >= 0) {
      if (first < 0) first = c;
      last = c;
    }
  const front = new Float64Array(foot.length),
    back = new Float64Array(foot.length);
  if (first < 0) return { first, last, front, back };
  let prev = -1;
  for (let c = first; c <= last; c++) {
    if (foot[c] < 0) continue;
    const y = footAt(p, at, foot, c).y;
    if (prev >= 0)
      for (let g = prev + 1; g < c; g++)
        front[g] = front[prev] + ((y - front[prev]) * (g - prev)) / (c - prev);
    front[c] = y;
    prev = c;
  }
  const centre = front[first] + front[last];
  for (let c = first; c <= last; c++)
    back[c] = Math.min(front[c], centre - front[first + last - c]);
  return { first, last, front, back };
}

/**
 * The soft shadow a building casts on the ground: back along the light from each point to the
 * ground under the building (`footprint`), the nearer the darker, reaching `SHADOW_REACH` tiles;
 * a darker seam just under each foot (more on the shaded right); blurred; and erased under the
 * picture's own pixels (whole under a `SOLID` texel), so a wall that is not quite opaque does not
 * let it through. Null when nothing stands on the ground.
 */
export function contactShadow(p: Picture, foot: Int32Array, at: Placement): GroundLayer | null {
  const apex = frontCorner(foot);
  if (apex < 0) return null;
  const { data, width: w, height: h, density: d } = p,
    R = SHADOW_RES,
    // the light's step on screen, per tile along it
    vx = (LIGHT.x - LIGHT.y) * HALF_W,
    vy = (LIGHT.x + LIGHT.y) * HALF_H,
    pad = 2 * BLUR + 1,
    k = at.scale / d,
    ground = footprint(p, foot, at);
  let y0 = Infinity,
    y1 = -Infinity;
  for (let c = ground.first; c <= ground.last; c++) {
    y0 = Math.min(y0, ground.back[c]);
    y1 = Math.max(y1, ground.front[c]);
  }
  const x0 = (ground.first - at.anchorX) * k,
    x1 = (ground.last + 1 - at.anchorX) * k,
    frontX = footAt(p, at, foot, apex).x,
    left = Math.floor(x0 - pad),
    top = Math.floor(y0 - pad),
    width = Math.ceil((x1 + vx * SHADOW_REACH + pad - left) * R),
    height = Math.ceil((y1 + Math.max(vy * SHADOW_REACH, OCCLUSION) + pad - top) * R),
    A = new Float32Array(width * height);
  /** The picture column over world x, or -1 past its edges. */
  const column = (x: number) => {
    const c = Math.floor(x / k + at.anchorX);
    return c >= 0 && c < w ? c : -1;
  };
  /** On the ground under the building. */
  const under = (x: number, y: number) => {
    const c = column(x);
    return c >= ground.first && c <= ground.last && y <= ground.front[c] && y >= ground.back[c];
  };
  const steps = Math.ceil(SHADOW_REACH * Math.hypot(vx, vy) * R * 2);
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      const x = left + (i + 0.5) / R,
        y = top + (j + 0.5) / R;
      for (let s = 0; s < steps; s++) {
        const t = (s / steps) * SHADOW_REACH;
        if (!under(x - t * vx, y - t * vy)) continue;
        A[j * width + i] = SHADOW_ALPHA * Math.pow(1 - t / SHADOW_REACH, 1.5);
        break;
      }
    }
  // the seam just under each foot
  for (let i = 0; i < width; i++) {
    const x = left + (i + 0.5) / R,
      c = column(x);
    if (c < 0 || foot[c] < 0) continue;
    const strength = x > frontX ? 0.4 : 0.3,
      from = Math.round(((foot[c] + 1 - at.anchorY) * k - top) * R);
    for (let dy = 0; dy < OCCLUSION * R; dy++) {
      const j = from + dy;
      if (j < 0 || j >= height) continue;
      const a = strength * Math.exp(-dy / (OCCLUSION_FALL * R));
      A[j * width + i] = 1 - (1 - A[j * width + i]) * (1 - a);
    }
  }
  boxBlur(A, width, height, Math.round(BLUR * R));
  boxBlur(A, width, height, Math.round(BLUR * R));
  const out = new Uint8ClampedArray(width * height * 4);
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      const n = j * width + i,
        px = Math.floor((left + (i + 0.5) / R) / k + at.anchorX),
        py = Math.floor((top + (j + 0.5) / R) / k + at.anchorY),
        own = px >= 0 && py >= 0 && px < w && py < h ? data[(py * w + px) * 4 + 3] : 0,
        // a wall's texel hides the shadow whole, a soft edge in its measure
        cover = own >= SOLID ? 1 : own / 255;
      out[n * 4] = SHADOW_RGB[0];
      out[n * 4 + 1] = SHADOW_RGB[1];
      out[n * 4 + 2] = SHADOW_RGB[2];
      out[n * 4 + 3] = Math.round(Math.min(1, A[n]) * (1 - cover) * 255);
    }
  return { x: left, y: top, width, height, resolution: R, data: out };
}

/** One horizontal and one vertical box blur of radius `r`, in place. */
function boxBlur(A: Float32Array, w: number, h: number, r: number) {
  const T = new Float32Array(A.length),
    n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x < w + r; x++) {
      if (x + r < w) s += A[y * w + x + r];
      if (x - r - 1 >= 0) s -= A[y * w + x - r - 1];
      if (x >= 0 && x < w) T[y * w + x] = s / n;
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y < h + r; y++) {
      if (y + r < h) s += T[(y + r) * w + x];
      if (y - r - 1 >= 0) s -= T[(y - r - 1) * w + x];
      if (y >= 0 && y < h) A[y * w + x] = s / n;
    }
  }
}

/**
 * The generators' ground shadow (`SHADOW` in src/art/industry.ts, under `shadowRect` and
 * `shadowEllipse`): this colour at partial alpha.
 */
const BAKED_RGB = [30, 40, 30];
/** A picture with at least this much of it (world px²) has its ground shadow baked in. */
export const BAKED_AREA = 8;

/**
 * Whether a generated picture has a ground shadow baked in, so the cast shadow would double it.
 * Illustrated pictures (more than one texel per world px) have none: their soft dark edges only
 * look like one, so they are never counted.
 */
export function bakedShadow({ data, width: w, height: h, density: d }: Picture): boolean {
  if (d > 1) return false;
  let n = 0;
  for (let k = 0; k < w * h * 4; k += 4) {
    const a = data[k + 3];
    if (a < 20 || a > 110) continue;
    if (
      Math.abs(data[k] - BAKED_RGB[0]) <= 24 &&
      Math.abs(data[k + 1] - BAKED_RGB[1]) <= 24 &&
      Math.abs(data[k + 2] - BAKED_RGB[2]) <= 24
    )
      n++;
  }
  return n >= BAKED_AREA * d * d;
}

/** What grows at a building's foot: by the ground under it. */
export type FootGround = 'grass' | 'dry' | 'stony' | 'none';
/** Of the feet one world px apart, the share with a tuft and the share with a pebble. */
export const SCATTER: Record<FootGround, { tuft: number; pebble: number }> = {
  grass: { tuft: 0.5, pebble: 0.18 },
  dry: { tuft: 0.12, pebble: 0.3 },
  stony: { tuft: 0.08, pebble: 0.35 },
  none: { tuft: 0, pebble: 0 },
};
/** The ground of a landscape material; paved town ground grows nothing. */
export function footGround(material: number, paved: boolean): FootGround {
  if (paved || material === Material.Water) return 'none';
  if (material === Material.Desert || material === Material.Sand) return 'dry';
  if (material === Material.Rock || material === Material.Mountain) return 'stony';
  return 'grass';
}

export interface Tuft {
  kind: 'tuft';
  x: number;
  y: number;
  /** Height in world px. */
  h: number;
  /** On the shaded right of the front corner. */
  dark: boolean;
  /** Each of the four blades' lean, in world px. */
  lean: [number, number, number, number];
}
export interface Pebble {
  kind: 'pebble';
  x: number;
  y: number;
  /** Size in world px. */
  s: number;
}

/**
 * Short tufts and pebbles over the front of a building's base, so its straight line breaks where
 * it meets the ground: seeded by the building's tile (`tx`, `ty`, world coordinates) and each
 * foot's place along it, never at random, so a building keeps its own.
 */
export function footScatter(
  feet: readonly Foot[],
  tx: number,
  ty: number,
  ground: FootGround,
): (Tuft | Pebble)[] {
  const share = SCATTER[ground],
    out: (Tuft | Pebble)[] = [];
  if (!share.tuft && !share.pebble) return out;
  feet.forEach((f, n) => {
    const r1 = hash2(tx * 131 + n, ty, 77),
      r2 = hash2(tx * 131 + n, ty, 78);
    if (r1 < share.tuft) {
      const lean = [0, 1, 2, 3].map((q) => (hash2(tx * 131 + n, ty * 4 + q, 79) - 0.5) * 1.1);
      out.push({
        kind: 'tuft',
        x: f.x,
        y: f.y + 0.4 + r2 * 1.1,
        h: 1.9 + 1.8 * r2,
        dark: f.right,
        lean: lean as Tuft['lean'],
      });
    } else if (r1 > 1 - share.pebble)
      out.push({ kind: 'pebble', x: f.x, y: f.y + 0.9 + r2 * 0.8, s: 0.7 + 0.7 * r2 });
  });
  return out;
}

/** A pebble's ground shadow (at `alpha`), its body and its lit top. */
export const PEBBLE_COLOURS = { shadow: 0x464838, alpha: 0.35, body: 0xa8a28c, top: 0xc4bea6 };
/** Tuft blades in the dark (shaded) and light shade, with their highlight, by ground. */
export const TUFT_COLOURS: Record<
  Exclude<FootGround, 'none'>,
  { blade: [number, number]; highlight: [number, number] }
> = {
  grass: { blade: [0x5c6a2e, 0x7e8e3a], highlight: [0x828c42, 0xa8b054] },
  dry: { blade: [0x80703e, 0xa89658], highlight: [0x968850, 0xc4b470] },
  stony: { blade: [0x5c6a2e, 0x7e8e3a], highlight: [0x828c42, 0xa8b054] },
};
