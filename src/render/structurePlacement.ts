import { structureFrame } from '../art/frames';
import { buildingDef, buildingFrame, buildingSpan, type Building } from '../sim/buildings';
import type { Station } from '../sim/stations';
import { footprintAnchor, type FootprintAnchor, type Span } from './footprintAnchor';

/** What `WorldRenderer.setStructure` is given to stand a building on its footprint. */
export interface Placement extends FootprintAnchor {
  frame: string;
  layer: number;
  span: Span;
}

/** What can say whether a frame exists: the atlas registry, or a set of names in a test. */
interface Frames {
  has(key: string): boolean;
}

/**
 * Where, and as which picture, a station stands: on its footprint's centre as turned, sorted with
 * the tile nearest the camera. A depot has a picture per axis (`_r0`, `_r1`, which the level
 * suffixes follow for the wide one); any other station its level picture, borrowing the plain
 * station's where its family has none, and `structureFrame` turns it where the atlas has the turn.
 */
export function stationPlacement(atlas: Frames, s: Station): Placement {
  const art = s.def.art,
    lv = s.spriteLevel > 1 ? '_lv' + s.spriteLevel : '';
  let key = `structures/${art}_${s.spriteLevel}`;
  if (s.def.depot && s.def.long) key = `structures/${art}_r${s.rot % 2}`;
  else if (s.def.depot && s.size === 2) key = `structures/${art}_r${s.rot % 2}${lv}`;
  else if (!atlas.has(key)) key = `structures/station_${s.spriteLevel}`;
  return {
    ...footprintAnchor(s.x, s.y, s.w, s.h),
    frame: structureFrame(atlas, key, s.rot),
    layer: 20,
    span: { w: s.w, h: s.h },
  };
}

/** Where, and as which picture, a works stands: on its footprint's centre as turned. */
export function buildingPlacement(atlas: Frames, b: Building): Placement {
  const rot = b.rot ?? 0,
    span = buildingSpan(buildingDef(b.id), rot);
  return {
    ...footprintAnchor(b.x, b.y, span.w, span.h),
    frame: structureFrame(atlas, buildingFrame(b), rot),
    layer: 20,
    span,
  };
}
