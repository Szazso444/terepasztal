/**
 * Doors (#406). Every place people live in, work in or travel from, as `PeopleSim.places` lists
 * them (a station, a works with a crew, a house, a service stop with a crew), has a street door: a
 * tile of its footprint, the side of that tile it faces, and the tile outside the footprint across
 * that side (`Door.reach`). Walkers come out of the place and go back in there, and a road to the
 * place ends there. A station has a platform door too, on its front, where its platform track
 * runs, and its street door on the side away from it, so a road to it never meets the platform
 * (D1, the author on 2026-10-12). A depot's portals are for trains: its one door is a street door
 * on its front, a long side no track runs through.
 *
 * A def holds its doors for rotation 0 (`DoorDef` in src/data/content.ts), and a def without any
 * has those of its kind (`defDoors`). Each rotation turns them a quarter turn clockwise with the
 * footprint, so the front door faces S, W, N and E at r0 to r3, as src/sim/rotation.ts names the
 * rotations. Nothing here is saved: doors follow from the def and the rotation, which is saved.
 */
import type {
  BuildingDef,
  DecorDef,
  DoorDef,
  DoorKind,
  DoorSide,
  StationDef,
} from '../data/content';
import { DIR_DX, DIR_DY, Dir, rotateDir } from '../engine/iso';
import { wrapRotation } from './rotation';

/** The def of a place: a station, a works, or a decor (a house or a service stop). */
export type PlaceDef = StationDef | BuildingDef | DecorDef;

/** A door of a place where it stands, turned with it. */
export interface Door {
  kind: DoorKind;
  /** the tile of the footprint it is in */
  tile: { x: number; y: number };
  /** the side of that tile it faces, an edge of the footprint */
  side: Dir;
  /**
   * the tile outside the footprint across `side`: where walks to and from the door start and end,
   * and where a road to it ends
   */
  reach: { x: number; y: number };
}

const KINDS: readonly DoorKind[] = ['street', 'platform'];
const SIDES: readonly DoorSide[] = ['N', 'E', 'S', 'W'];
/** The direction each side faces. */
const SIDE_DIR: Readonly<Record<DoorSide, Dir>> = { N: Dir.N, E: Dir.E, S: Dir.S, W: Dir.W };

/** A station's def: the only kind of place that lists the cargo it accepts. */
function isStationDef(def: PlaceDef): def is StationDef {
  return 'accepts' in def;
}

/** A `span` a def may hold: whole tiles, each 1 or 2, two tiles at most (1 x 1, 2 x 1 or 1 x 2). */
function validSpan(span: unknown): span is { w: number; h: number } {
  if (!span || typeof span !== 'object') return false;
  const { w, h } = span as Record<string, unknown>;
  return (
    Number.isInteger(w) &&
    Number.isInteger(h) &&
    (w as number) >= 1 &&
    (h as number) >= 1 &&
    (w as number) * (h as number) <= 2
  );
}

/**
 * Width (along x) and depth (along y) of a place at rotation 0: a station's own `span` when it
 * has a valid one, else a long station 2 × 1, any other station its `size` square, and a works or
 * a decor one tile. A turn of an odd rotation swaps them (`stationSpan`).
 */
export function placeSpan(def: PlaceDef): { w: number; h: number } {
  if (!isStationDef(def)) return { w: 1, h: 1 };
  if (validSpan(def.span)) return { w: def.span.w, h: def.span.h };
  if (def.long) return { w: 2, h: 1 };
  const n = def.size ?? 1;
  return { w: n, h: n };
}

/**
 * The doors of a def at rotation 0: its own, or, for a def with no street door among them (an
 * entry the content editor made, say), those of its kind. A station has a platform door on the
 * front (S) of its front row and a street door on the back (N) of its back row; a depot, a works
 * and a decor a street door on the front of their front row.
 */
export function defDoors(def: PlaceDef): readonly DoorDef[] {
  if (def.doors?.some((d) => d.kind === 'street')) return def.doors;
  const front = placeSpan(def).h - 1;
  if (isStationDef(def) && !def.depot)
    return [
      { kind: 'platform', tile: [0, front], side: 'S' },
      { kind: 'street', tile: [0, 0], side: 'N' },
    ];
  return [{ kind: 'street', tile: [0, front], side: 'S' }];
}

/**
 * The doors of a place of `def` with its footprint's corner at (x, y), turned to `rot` (one of the
 * four, `wrapRotation`): each door of `defDoors` turned a quarter turn clockwise per step with the
 * footprint, in their order there.
 */
export function doorsOf(def: PlaceDef, x: number, y: number, rot: number): Door[] {
  const span = placeSpan(def);
  const turns = wrapRotation(rot);
  return defDoors(def).map((d) => {
    let [dx, dy] = d.tile;
    let { w, h } = span;
    let side = SIDE_DIR[d.side];
    // a quarter turn clockwise: the column from the left becomes the row from the top, and the
    // row from the bottom the column from the left
    for (let i = 0; i < turns; i++) {
      [dx, dy] = [h - 1 - dy, dx];
      [w, h] = [h, w];
      side = rotateDir(side, 1);
    }
    const tile = { x: x + dx, y: y + dy };
    return {
      kind: d.kind,
      tile,
      side,
      reach: { x: tile.x + DIR_DX[side], y: tile.y + DIR_DY[side] },
    };
  });
}

/** The street door of a place (`doorsOf`): the first of them, when it has more than one. */
export function streetDoor(def: PlaceDef, x: number, y: number, rot: number): Door {
  return doorsOf(def, x, y, rot).find((d) => d.kind === 'street')!;
}

/** A place where it stands: its def, its footprint's corner and its rotation. */
export interface PlaceAt {
  def: PlaceDef;
  x: number;
  y: number;
  rot: number;
}

/** Every street door of a place where it stands (`doorsOf`), in their order there. */
export function streetDoors(p: PlaceAt): Door[] {
  return doorsOf(p.def, p.x, p.y, p.rot).filter((d) => d.kind === 'street');
}

/**
 * Whether what stands of `def` is a place, with doors: every station, a works with a crew and a
 * decor with a crew or residents (a service stop, a house), the kinds `PeopleSim.places` lists. A
 * bridge platform, a signal or a power pole has no door.
 */
export function hasDoors(def: PlaceDef): boolean {
  if (isStationDef(def)) return true;
  return def.crew > 0 || ('residents' in def && !!def.residents);
}

/** What is wrong with a station def's `span`, for the content check; nothing when it has none. */
export function spanProblems(def: PlaceDef): string[] {
  const span: unknown = isStationDef(def) ? def.span : undefined;
  if (span === undefined || validSpan(span)) return [];
  return ['span must be { w, h } of whole tiles, 1 to 2 each, two tiles at most'];
}

/**
 * What is wrong with a def's doors, for the content check; nothing when it has none. Each is a
 * street or a platform door on a tile of the footprint at rotation 0 (`placeSpan`), facing out of
 * it, and one of them is a street door.
 */
export function doorProblems(def: PlaceDef): string[] {
  const doors: unknown = def.doors;
  if (doors === undefined) return [];
  if (!Array.isArray(doors) || !doors.length) return ['doors must be a list of doors'];
  const { w, h } = placeSpan(def);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const out: string[] = [];
  let street = false;
  doors.forEach((d: unknown, i) => {
    const at = `door ${i + 1}`;
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      out.push(`${at} must be an object`);
      return;
    }
    const { kind, tile, side } = d as Record<string, unknown>;
    if (!KINDS.includes(kind as DoorKind)) out.push(`${at}: kind must be street or platform`);
    if (kind === 'street') street = true;
    const dir = SIDES.includes(side as DoorSide) ? SIDE_DIR[side as DoorSide] : null;
    if (dir === null) out.push(`${at}: side must be N, E, S or W`);
    const [dx, dy] = Array.isArray(tile) && tile.length === 2 ? (tile as unknown[]) : [];
    if (!Number.isInteger(dx) || !Number.isInteger(dy) || !inside(dx as number, dy as number))
      out.push(`${at}: tile must be [dx, dy] within the ${w} x ${h} footprint`);
    else if (dir !== null && inside((dx as number) + DIR_DX[dir], (dy as number) + DIR_DY[dir]))
      out.push(`${at}: side ${side as string} faces into the footprint`);
  });
  if (!street) out.push('doors need a street door');
  return out;
}
