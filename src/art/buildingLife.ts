import LIFE from './buildingLife.json';

/**
 * What a building's picture shows that Rendering cannot measure at run time: where the chimney
 * pots are (smoke rises from them) and what the quarry crane lets hang (its load swings). Measured
 * from the frame's pixels by tools/building-life.mjs and kept in `buildingLife.json` beside the
 * generators. Pure data, importable without a DOM. Everything is in world px from the frame's
 * anchor: texels over the atlas's `resolution`, before the renderer's scale reference
 * (`scaleReference`, src/render/assetScale.ts), so a frame drawn at scale k puts a point at k
 * times these numbers, like `buildingGround.json`.
 *
 * The file is `{ pots: { <frame>: Pot[] }, cranes: { <frame>: Crane }, mills: { <frame>: Mill } }`.
 * A frame that shows none of them is not in it; so are the placeholder turns (`_r1` to `_r3`) that
 * draw none.
 */

/** [x, y]: world px right and down from the frame's anchor. */
export type Point = readonly [number, number];
/** [x0, y0, x1, y1]: left and top edges inclusive, right and bottom edges not. */
export type Rect = readonly [number, number, number, number];

/** One chimney stack. */
export interface Pot {
  /** the top of the stack's pots: the highest top, and the middle of the pot tops */
  dx: number;
  dy: number;
  /** a works chimney, which always smokes; a house chimney smokes when it is lit */
  work: boolean;
}

/** The part of the picture that hangs from the quarry's pulley and the point it hangs from. */
export interface Crane {
  /** where the rope leaves the pulley's wheel, on the top edge of the load */
  pivot: Point;
  /**
   * The rope, the hook, the slings and the crate, as rectangles. Every visible texel inside them
   * is the load, and it touches no other texel of the picture but at the pivot, above, and where
   * the crate stands on the cart, below: cut out, it leaves no hole in the building.
   */
  load: Rect[];
}

/** Where a windmill's sails turn. */
export interface Mill {
  /** the sails' hub */
  hub: Point;
  /** the sails' plane: the matrix [[a, b], [c, d]] that lays the face-on cross into it */
  plane: readonly [readonly [number, number], readonly [number, number]];
}

const FILE = LIFE as unknown as {
  pots: Record<string, Pot[]>;
  cranes: Record<string, Crane>;
  mills: Record<string, Mill>;
};

/** The pots of an atlas frame key (`structures/farm_2`), or undefined for a frame with none. */
export function potsOf(frame: string): readonly Pot[] | undefined {
  return Object.hasOwn(FILE.pots, frame) ? FILE.pots[frame] : undefined;
}

/** The crane of an atlas frame key (`structures/quarry_2`), or undefined for a frame without. */
export function craneOf(frame: string): Crane | undefined {
  return Object.hasOwn(FILE.cranes, frame) ? FILE.cranes[frame] : undefined;
}

/** The sails of an atlas frame key (`structures/windmill_lv2`), or undefined for a frame without. */
export function millOf(frame: string): Mill | undefined {
  return Object.hasOwn(FILE.mills, frame) ? FILE.mills[frame] : undefined;
}

/** Every frame that has pots. */
export function potFrames(): string[] {
  return Object.keys(FILE.pots);
}

/** Every frame that has a crane. */
export function craneFrames(): string[] {
  return Object.keys(FILE.cranes);
}
