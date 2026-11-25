import { tileToWorld, depthKey } from '../engine/iso';
import type { LandmarkStage } from '../sim/landmarks';

/** The depth layer of a landmark's picture: the one buildings stand in. */
export const LANDMARK_LAYER = 20;

/** What the renderer needs of a landmark: where it stands and how far along it is. */
export interface DrawnLandmark {
  id: number;
  def: string;
  x: number;
  y: number;
  stage: LandmarkStage;
}

/** What a stage looks like (spec section 7). */
export interface Treatment {
  /** the picture is drawn at all: a hidden landmark has no sprite */
  picture: boolean;
  /** the `?` marker stands over it */
  marker: boolean;
  /** darkened and desaturated */
  worn: boolean;
  /** window lights come on at night */
  lit: boolean;
}

export function treatmentOf(stage: LandmarkStage): Treatment {
  return {
    picture: stage !== 'hidden',
    marker: stage === 'spotted',
    worn: stage === 'salvaged',
    lit: stage === 'restored',
  };
}

/**
 * Where a landmark of footprint `w` x `d` with its corner of least x and y on tile (x, y) is
 * drawn: the picture's anchor is the footprint's centre, and it sorts with the footprint's front
 * tile, as the multi-tile stations do (`front` and the world px offset `dx`, `dy` from it to the
 * centre, as `setStructure` takes them).
 */
export function landmarkPlacement(x: number, y: number, w: number, d: number) {
  const off = tileToWorld(-(w - 1) / 2, -(d - 1) / 2);
  return { front: { x: x + w - 1, y: y + d - 1 }, dx: off.x, dy: off.y };
}

/** The depth key a landmark's picture sorts by. */
export function landmarkDepth(x: number, y: number, w: number, d: number) {
  const { front } = landmarkPlacement(x, y, w, d);
  return depthKey(front.x, front.y, LANDMARK_LAYER);
}

/** The map tiles under the footprint, as `y * mapWidth + x` indices. */
export function footprintIndices(x: number, y: number, w: number, d: number, mapW: number) {
  const out: number[] = [];
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) out.push((y + j) * mapW + x + i);
  return out;
}

/**
 * A pixel the picture already lights: the warm lamp yellow of a lit window or lantern. Roofs
 * and autumn leaves are red or orange, with less green, so they stay dark.
 */
export function isLampPixel(r: number, g: number, b: number, a: number) {
  return a > 128 && r >= 205 && g >= 165 && b <= 120 && g - b >= 70;
}

/** The lamp pixels of RGBA texels, in the window light's own colour; every other pixel clear. */
export function lampMask(data: Uint8ClampedArray) {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4)
    if (isLampPixel(data[i], data[i + 1], data[i + 2], data[i + 3])) {
      out[i] = 255;
      out[i + 1] = 187;
      out[i + 2] = 91;
      out[i + 3] = 255;
    }
  return out;
}

/** How much colour a salvaged landmark keeps, and how much of its light. */
export const WORN_SATURATION = 0.3;
export const WORN_LIGHT = 0.62;

/** RGBA texels darkened and desaturated, alpha as it was. */
export function wornPixels(data: Uint8ClampedArray) {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const grey = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    for (let c = 0; c < 3; c++)
      out[i + c] = (grey + (data[i + c] - grey) * WORN_SATURATION) * WORN_LIGHT;
    out[i + 3] = data[i + 3];
  }
  return out;
}
