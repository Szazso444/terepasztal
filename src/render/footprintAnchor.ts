import { tileToWorld } from '../engine/iso';

/**
 * Where a building's picture stands on its footprint. Tiles decide gameplay only (where a building
 * may be placed, how much room it takes and where it sits in that room); they never decide the
 * size of the picture, which `assetScale.ts` does. A picture is anchored at the middle of its
 * footprint on the ground (`FrameGround`), and sorted with the footprint's tile nearest the camera,
 * so a train passing in front of it is drawn over it and one behind it under.
 *
 * `x`, `y` is the tile the picture is placed on (`WorldRenderer.setStructure`), `dx`, `dy` the world
 * px from that tile's centre back to the footprint's centre. A footprint is its corner tile (lowest
 * x and y) and its width (along x) and depth (along y) as turned, so a quarter turn swaps them.
 */
export interface FootprintAnchor {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

/** A footprint's width (along x) and depth (along y) in tiles, as turned. */
export interface Span {
  w: number;
  h: number;
}

/** The anchor of the picture of a `w` x `h` footprint whose corner is (x, y). */
export function footprintAnchor(x: number, y: number, w: number, h: number): FootprintAnchor {
  const off = tileToWorld(-(w - 1) / 2, -(h - 1) / 2);
  // + 0 turns a -0 (a one-tile footprint) into 0
  return { x: x + w - 1, y: y + h - 1, dx: off.x + 0, dy: off.y + 0 };
}

/** The footprint's centre, in tile units. */
export function footprintCentre(x: number, y: number, w: number, h: number) {
  return { x: x + (w - 1) / 2, y: y + (h - 1) / 2 };
}

/** Every tile of the footprint, row by row from its corner. */
export function footprintTileList(x: number, y: number, w: number, h: number) {
  const out: { x: number; y: number }[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: x + dx, y: y + dy });
  return out;
}

/**
 * The radius of a circle about a footprint's centre that stands for the tiles within `radius`
 * (Chebyshev) of its edge: the radius plus the half-width of its longer side beyond one tile.
 */
export function footprintReachRadius(w: number, h: number, radius: number) {
  return radius + (Math.max(w, h) - 1) / 2;
}
