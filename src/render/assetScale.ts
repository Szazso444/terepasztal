/** A walker's height on screen (peopleRenderer.ts); no building is sized by it. */
export const PERSON_PX = 9;
/**
 * A standard door's height on screen: a building is scaled so its door is this tall. It is the
 * 2.1 m door beside the 1.75 m, 11 px person the buildings were calibrated against, and it stays
 * when a walker is drawn smaller. The miniature game uses a compressed metre, independent of rail
 * gauge.
 */
export const DOOR_PX = 13.2;
export const TREE_SCALE = 1.5;
export const DOOR_REFERENCE_PX: Record<string, number> = {
  station: 10.5,
  town: 10,
  townhouse: 18,
  warehouse: 11,
  farm: 12,
  lumber: 12,
  grinder: 12,
};
/** Door aperture / trimmed-frame height, reviewed on the packed illustrated atlas. */
export const DOOR_FRACTION: Record<string, number> = {
  station: 36 / 169,
  town: 43 / 199,
  townhouse: 68 / 251,
  warehouse: 53 / 191,
  farm: 47 / 262,
};
/** Outdoor equipment has no standard door; these explicit estimates need physical references. */
export const EQUIPMENT_SCALE: Record<string, number> = {
  water_tower: 0.7,
  fuel_stop: 0.65,
  // the Fuel Pump: an estimate beside its neighbours until its art brings a measured reference
  fuel_pump: 0.65,
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
/**
 * The author's per-family size pick (2026-10-18, judged on the building scale review page): a
 * multiplier on the size a family is drawn at by the door reference and the equipment table
 * above, for every level, age and turn of the family. It is the one place to tune a family's
 * size by eye; a family not named here is drawn as the references give it. A key that is a whole
 * frame name (`town_1`) overrides its family's multiplier for that frame. Pictures are only ever
 * scaled uniformly. Footprints and where a picture stands on them are not decided here. The
 * families drawn from a 3D model (`MODEL_FAMILIES`) lost their picks on 2026-10-27: they are drawn
 * at their real size.
 */
export const AUTHOR_SCALE: Record<string, number> = {
  colliery: 1.2,
  /** proposal: "taller, increase its size" came with no number */
  water_tower: 1.3,
  /** the Coaling Stage; proposal: "also bigger" came with no number */
  fuel_stop: 1.25,
};
/**
 * Families drawn from their 3D model, painted, at its real size measured against the walker and
 * fitted to its tiles (the author, 2026-10-27 and 10-29; assets/source/models,
 * tools/illustrated-sprites.mjs): the frame is packed at the size it is drawn, so its scale is 1
 * and neither the references above nor the author's pick apply to it. Every level of a family
 * shows the same picture. The windmill has no 3D model, but its painted body comes packed the same
 * way, at the size its door and tower were measured at (assets/source/windmill-2026-10-17).
 */
export const MODEL_FAMILIES: ReadonlySet<string> = new Set([
  'farm',
  'lumber',
  'quarry',
  'town',
  'warehouse',
  'station',
  'kiln',
  'grinder',
  'refinery',
  'power_plant',
  'substation',
  'ironworks',
  'diesel_refinery',
  'wire_mill',
  'windmill',
]);
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
  return (
    MODEL_FAMILIES.has(name) ||
    name in DOOR_FRACTION ||
    name in DOOR_REFERENCE_PX ||
    name in EQUIPMENT_SCALE
  );
}
/**
 * Source measurements are visual estimates; new art must supply a measured reference. The size
 * the reference gives is then multiplied by the author's pick for the family (`AUTHOR_SCALE`).
 */
export function structureScale(frame: string, illustratedHeight?: number) {
  const name = structureFamily(frame);
  if (MODEL_FAMILIES.has(name)) return 1;
  const door =
    illustratedHeight && DOOR_FRACTION[name]
      ? illustratedHeight * DOOR_FRACTION[name]
      : DOOR_REFERENCE_PX[name];
  const own = door ? DOOR_PX / door : (EQUIPMENT_SCALE[name] ?? 1);
  return own * (AUTHOR_SCALE[frame.replace('structures/', '')] ?? AUTHOR_SCALE[name] ?? 1);
}
/** How a building frame is sized: the family it is measured by and the scale that gives. */
export interface ScaleReference {
  family: string;
  scale: number;
}
/**
 * The scale reference of a frame as the renderer draws it, or null when it has none: it then
 * draws at its own size, with no ground fit (groundFit.ts) and no window lights. A turned frame
 * is measured by its unturned frame's family, so it keeps that frame's size and lights.
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
  return [
    'tree',
    'pine',
    'oak',
    'spruce',
    'birch',
    'palm',
    'deadtree',
    'beech',
    'poplar',
    'apple',
    'maple',
    'larch',
    'acacia',
  ].includes(kind);
}
