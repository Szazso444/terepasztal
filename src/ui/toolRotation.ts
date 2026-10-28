import type { Tool } from './toolbar';
import type { StationDef } from '../data/content';
import { structureFrame } from '../art/frames';
import { BUILDING_ROTATIONS, nextRotation, rotationAxis } from '../sim/rotation';
import { stationDef } from '../sim/stations';
import { decorDef } from '../sim/build';
import { rotationCount } from '../world/track';

/** A station with a picture per axis (`_r0`, `_r1`): a depot of two tiles or a long station. */
export function hasAxisPictures(def: StationDef) {
  return (def.size ?? 1) > 1 || !!def.long;
}

/**
 * How many rotations R steps the tool in hand through: a track piece and a decor as many as they
 * have, a station with a picture per axis (`hasAxisPictures`) the four building rotations. Any
 * other station and every works do not turn for now (the author, 2026-10-27): each has one
 * picture, and a turned footprint under an unturned picture stood it wrong. A bridge platform
 * does not turn, nor does any other tool; 1 means R keeps the tool at rotation 0.
 */
export function toolRotations(tool: Tool): number {
  switch (tool.kind) {
    case 'track':
      return rotationCount(tool.item.kind);
    case 'decor':
      return decorDef(tool.defId).rotations;
    case 'station':
      return hasAxisPictures(stationDef(tool.defId)) ? BUILDING_ROTATIONS : 1;
    default:
      return 1;
  }
}

/** The rotation R turns the tool in hand to from `rot`: one step on, after the last back to 0. */
export function nextToolRotation(tool: Tool, rot: number): number {
  const n = toolRotations(tool);
  // a station or a works turns a quarter turn clockwise, as `rotation.ts` counts the turns
  if (n === BUILDING_ROTATIONS && (tool.kind === 'station' || tool.kind === 'building'))
    return nextRotation(rot);
  return (rot + 1) % n;
}

/**
 * The frame a station's ghost shows turned to `rot`. A depot or a long station has a picture per
 * axis (`_r0`, `_r1`), any other station its level 1 picture; a station without its own family
 * borrows the plain station's. `structureFrame` then turns it, where the atlas has the turn.
 */
export function stationGhostFrame(
  atlas: { has(key: string): boolean },
  def: StationDef,
  rot: number,
): string {
  const fam = hasAxisPictures(def)
    ? `structures/${def.art}_r${rotationAxis(rot)}`
    : `structures/${def.art}_1`;
  return structureFrame(atlas, atlas.has(fam) ? fam : 'structures/station_1', rot);
}
