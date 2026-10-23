import type { Tool } from './toolbar';
import type { StationDef } from '../data/content';
import { structureFrame } from '../art/frames';
import { BUILDING_ROTATIONS, nextRotation, rotationAxis } from '../sim/rotation';
import { buildingDef, buildingFootprint } from '../sim/buildings';
import { stationFootprint } from '../sim/stations';
import { decorDef } from '../sim/build';
import { rotationCount } from '../world/track';

/**
 * How many rotations R steps the tool in hand through: a track piece and a decor as many as they
 * have, every station and works the four building rotations. A bridge platform does not turn,
 * nor does any other tool; 1 means R keeps the tool at rotation 0.
 */
export function toolRotations(tool: Tool): number {
  switch (tool.kind) {
    case 'track':
      return rotationCount(tool.item.kind);
    case 'decor':
      return decorDef(tool.defId).rotations;
    case 'station':
      return BUILDING_ROTATIONS;
    case 'building':
      return buildingDef(tool.defId).bridge ? 1 : BUILDING_ROTATIONS;
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
 * Does a station have a picture per axis (`_r0`, `_r1`)? A shed (a depot) of more than one tile
 * does. Any other station, of one tile or of a span of two, has its level 1 picture, which
 * `structureFrame` turns where the atlas has the turn; its span decides the tiles it covers
 * (`toolFootprint`), never the picture it is drawn from.
 */
export function axisPictured(def: StationDef): boolean {
  return !!def.depot && ((def.size ?? 1) > 1 || !!def.long);
}

/**
 * The frame a station's ghost shows turned to `rot`. A shed has a picture per axis (`_r0`, `_r1`),
 * any other station its level 1 picture; a station without its own family borrows the plain
 * station's. `structureFrame` then turns it, where the atlas has the turn.
 */
export function stationGhostFrame(
  atlas: { has(key: string): boolean },
  def: StationDef,
  rot: number,
): string {
  const fam = axisPictured(def)
    ? `structures/${def.art}_r${rotationAxis(rot)}`
    : `structures/${def.art}_1`;
  return structureFrame(atlas, atlas.has(fam) ? fam : 'structures/station_1', rot);
}

/**
 * The tiles the tool in hand would cover with its corner tile on (x, y), turned to `rot`: a station
 * of its span, a works of its footprint (a bridge platform does not turn). Null for a tool that
 * places nothing on a footprint.
 */
export function toolFootprint(
  tool: Tool,
  x: number,
  y: number,
  rot: number,
): { x: number; y: number }[] | null {
  if (tool.kind === 'station') return stationFootprint(tool.defId, x, y, rot);
  if (tool.kind === 'building')
    return buildingFootprint(tool.defId, x, y, buildingDef(tool.defId).bridge ? 0 : rot);
  return null;
}

/**
 * The tiles within `r` (Chebyshev) of any tile of a footprint, the footprint's own tiles left out:
 * what a service or a power line would cover from the edge of what it stands on.
 */
export function reachTiles(footprint: readonly { x: number; y: number }[], r: number) {
  if (r <= 0 || !footprint.length) return [];
  const own = new Set(footprint.map((t) => `${t.x},${t.y}`));
  const x0 = Math.min(...footprint.map((t) => t.x)) - r,
    x1 = Math.max(...footprint.map((t) => t.x)) + r,
    y0 = Math.min(...footprint.map((t) => t.y)) - r,
    y1 = Math.max(...footprint.map((t) => t.y)) + r;
  const out: { x: number; y: number }[] = [];
  // a footprint is a block, so the tiles within r of it are the block grown by r
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) if (!own.has(`${x},${y}`)) out.push({ x, y });
  return out;
}
