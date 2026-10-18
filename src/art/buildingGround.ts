import GROUND from './buildingGround.json';

/**
 * Where a building frame stands on the ground, measured from the frame's pixels by
 * tools/building-ground.mjs and kept in `buildingGround.json` beside the generators. Pure data,
 * importable without a DOM. Everything is in world px from the frame's anchor: texels over the
 * atlas's `resolution`, before the renderer's scale reference (`scaleReference`,
 * src/render/assetScale.ts), so a frame drawn at scale k puts a point at k times these numbers.
 * The anchor is the footprint's centre on the ground. docs/art-direction/README.md has the rules.
 */

/** [x, y]: world px right and down from the anchor, or tiles `[dx, dy]` where it says so. */
export type Point = readonly [number, number];
export type Side = 'N' | 'E' | 'S' | 'W';

/** A door the picture shows, on a wall the camera sees (S or E). */
export interface GroundDoor {
  kind: 'street' | 'platform';
  /** its tile, [dx, dy] from the footprint's corner tile, and the side of it that it opens onto */
  tile: Point;
  side: Side;
  /** the tile outside the footprint across `side`, [dx, dy] from the same corner tile */
  reach: Point;
  /** where the door meets the ground (a step, if it has one), in world px */
  point: Point;
  /** the opening's width, world px */
  width: number;
  /** from the middle of its tile's share of the wall along the wall, in tiles */
  offset: number;
}

export interface FrameGround {
  /** `generated` by src/art, or `illustrated` from public/assets/structures.png */
  source: 'generated' | 'illustrated';
  /** the rotation the frame shows, 0 to 3 */
  rot: 0 | 1 | 2 | 3;
  /** the tiles it covers, [dx, dy] from the footprint's corner tile (lowest x and y) */
  footprint: Point[];
  /**
   * where its walls meet the ground: the far, right, near and left corners (n, e, s, w) of a
   * parallelogram on the picture's own ground lines, a slope of 0.33 to 0.67 (the game's is 0.5),
   * as far along the base as the base goes
   */
  foot: [Point, Point, Point, Point];
  /** `walls` for a straight base found in the picture, `outline` for the silhouette's lowest stand */
  fit: 'walls' | 'outline';
  /**
   * world px squared of opaque pixels below the foot between its outer corners: ground painted into
   * the picture (a yard, a pond, a field) and what stands in front of the walls; 0 for a clean cut-out
   */
  baked: number;
  /** the wall the building's front faces, its two foot corners in tile order, and whether the camera sees it */
  front: { side: Side; edge: [Point, Point]; visible: boolean };
  /** only the doors the picture shows; a door on a hidden wall, or not seen, is not here */
  doors: GroundDoor[];
}

const FRAMES = (GROUND as unknown as { frames: Record<string, FrameGround> }).frames;

/**
 * The ground data of an atlas frame key (`structures/farm_1`), or undefined for any other frame:
 * only the file's own keys count, not the names every object has (`constructor`, `toString`).
 */
export function groundOf(frame: string): FrameGround | undefined {
  return Object.hasOwn(FRAMES, frame) ? FRAMES[frame] : undefined;
}

/** Every frame that has ground data. */
export function groundFrames(): string[] {
  return Object.keys(FRAMES);
}
