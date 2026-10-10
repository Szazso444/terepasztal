/** The existing miniature game uses a compressed metre, independent of rail gauge. */
export const HUMAN_HEIGHT_PX = 11;
export const HUMAN_HEIGHT_M = 1.75;
export const DOOR_HEIGHT_M = 2.1;
export const TREE_SCALE = 1.5;
export const DOOR_REFERENCE_PX: Record<string, number> = {
  station: 10.5,
  town: 10,
  townhouse: 18,
  warehouse: 11,
  farm: 12,
  lumber: 12,
  windmill: 13,
  grinder: 12,
};
/** Door aperture / trimmed-frame height, reviewed on the packed illustrated atlas. */
export const DOOR_FRACTION: Record<string, number> = {
  station: 36 / 169,
  town: 43 / 199,
  townhouse: 68 / 251,
  warehouse: 53 / 191,
  farm: 47 / 262,
  windmill: 38 / 240,
};
/** Outdoor equipment has no standard door; these explicit estimates need physical references. */
export const EQUIPMENT_SCALE: Record<string, number> = {
  water_tower: 0.7,
  fuel_stop: 0.65,
  kiln: 0.7,
  refinery: 1.1,
  power_plant: 1.1,
  quarry: 1,
  pump: 1,
  substation: 1,
  hydro_plant: 1,
  colliery: 1,
  ironworks: 1,
  oil_derrick: 1,
  diesel_refinery: 1,
  wire_mill: 1,
};
/** What can say whether a frame exists: the atlas registry, or a set of frame names in a test. */
export interface FrameNames {
  has(key: string): boolean;
}
/**
 * The family an unturned structure frame is measured by: its name without `structures/` and
 * without a level or stage suffix (`_lv<n>`, `_s<n>`, `_<n>`). This is the one family rule; the
 * window lights (surfaceAssets.ts) use it too. A drawn frame may be turned: `scaleReference`
 * takes it back to its unturned frame first.
 */
export function structureFamily(frame: string) {
  return frame.replace('structures/', '').replace(/(_lv\d+|_s\d+|_\d+)$/, '');
}
/**
 * The frame a drawn frame was turned from, else the frame itself. `structureFrame`
 * (src/art/frames.ts) turns a building by appending `_r<turn>`, 1 to 3, after every other suffix
 * and only when the atlas has the result, so a frame is a turn exactly when it ends in such a
 * suffix and the atlas has it without one too. A depot's or long station's axis frame
 * (`depot_r1`, `station_r1_lv2`) has no frame without its `_r<axis>`, so it stays its own.
 */
export function unturnedFrame(atlas: FrameNames, frame: string) {
  const turn = /_r[1-3]$/.exec(frame);
  if (!turn) return frame;
  const base = frame.slice(0, turn.index);
  return atlas.has(base) ? base : frame;
}
export function hasScaleReference(frame: string) {
  if (!frame.startsWith('structures/')) return false;
  const name = structureFamily(frame);
  return name in DOOR_FRACTION || name in DOOR_REFERENCE_PX || name in EQUIPMENT_SCALE;
}
/** Source measurements are visual estimates; new art must supply a measured reference. */
export function structureScale(frame: string, illustratedHeight?: number) {
  const name = structureFamily(frame);
  const door =
    illustratedHeight && DOOR_FRACTION[name]
      ? illustratedHeight * DOOR_FRACTION[name]
      : DOOR_REFERENCE_PX[name];
  if (door) return ((DOOR_HEIGHT_M / HUMAN_HEIGHT_M) * HUMAN_HEIGHT_PX) / door;
  return EQUIPMENT_SCALE[name] ?? 1;
}
/** How a building frame is sized: the family it is measured by and the scale that gives. */
export interface ScaleReference {
  family: string;
  scale: number;
}
/**
 * The scale reference of a frame as the renderer draws it, or null when it has none: it then
 * draws at its own size, with no contact patches and no window lights. A turned frame is
 * measured by its unturned frame's family, so it keeps that frame's size, patches and lights.
 * `illustratedHeight` is the drawn picture's own height when it is illustrated (resolution above
 * 1): a door fraction is measured on the picture that is drawn.
 */
export function scaleReference(
  atlas: FrameNames,
  frame: string,
  illustratedHeight?: number,
): ScaleReference | null {
  const base = unturnedFrame(atlas, frame);
  if (!hasScaleReference(base)) return null;
  return { family: structureFamily(base), scale: structureScale(base, illustratedHeight) };
}
export function isTree(kind: string) {
  return ['tree', 'pine', 'oak', 'spruce', 'birch', 'palm', 'deadtree'].includes(kind);
}
