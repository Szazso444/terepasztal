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
export function structureFamily(frame: string) {
  return frame.replace('structures/', '').replace(/(_lv\d+|_s\d+|_\d+)$/, '');
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
export function isTree(kind: string) {
  return ['tree', 'pine', 'oak', 'spruce', 'birch', 'palm', 'deadtree'].includes(kind);
}
