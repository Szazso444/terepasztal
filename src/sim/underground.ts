import { MAX_LEVEL, NO_LEVEL, tileLevels, type Elevated } from '../world/elevation';
import { Terrain } from '../world/tiles';

/**
 * The store of what the Drill has made: the tiles dug inside a mountain, the cuttings that lead
 * down from a portal to open ground, and the portals themselves. It holds no rules; the dig plan
 * that decides what may be dug comes with the Drill. Tiles are map tiles, as the track keys them.
 */

/** The ground over a dug tile stays this many levels above its floor, or higher. */
export const TUNNEL_COVER = 3;

/** The side of a tile a portal looks out of. */
export type Face = 'N' | 'E' | 'S' | 'W';
const FACES: readonly Face[] = ['N', 'E', 'S', 'W'];

/** A portal on tile (x, y), its opening on `face`, the rail inside at level `floor`. */
export interface Portal {
  x: number;
  y: number;
  face: Face;
  floor: number;
}

/** What a save holds of the store: dug tiles [x, y, floor], cut tiles [x, y] and the portals. */
export interface UndergroundJSON {
  dug: [number, number, number][];
  cuts: [number, number][];
  portals: Portal[];
}

/** What a save holds of `GameMap.groundLevel`: the tiles with a level set, [x, y, level]. */
export type GroundLevelJSON = [number, number, number][];

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** A whole number from 0 to `max`, else undefined. */
function levelOf(v: unknown, max: number): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : undefined;
}

export class Underground {
  /** the floor of each dug tile, by tile key (`y * w + x`) */
  private readonly dug = new Map<number, number>();
  private readonly cuts = new Set<number>();
  private list: Portal[] = [];
  /** the portals by tile and face, so adding one does not search the list */
  private readonly portalKeys = new Set<number>();
  /** counts every change, for a reader that keeps something made from the store */
  version = 0;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {}

  private inside(x: number, y: number): boolean {
    return (
      Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.w && y < this.h
    );
  }

  isDug(x: number, y: number): boolean {
    return this.inside(x, y) && this.dug.has(y * this.w + x);
  }
  isCut(x: number, y: number): boolean {
    return this.inside(x, y) && this.cuts.has(y * this.w + x);
  }
  /** The rail level inside a dug tile; undefined for a tile that is not dug. */
  floorAt(x: number, y: number): number | undefined {
    return this.inside(x, y) ? this.dug.get(y * this.w + x) : undefined;
  }
  portals(): readonly Portal[] {
    return this.list;
  }
  /** True when nothing is dug, cut or ported. */
  get empty(): boolean {
    return !this.dug.size && !this.cuts.size && !this.list.length;
  }

  /** Dig (x, y) at `floor`, 0 to MAX_LEVEL. A tile is dug or cut, never both: digging takes the cut away. */
  dig(x: number, y: number, floor: number): boolean {
    const f = levelOf(floor, MAX_LEVEL);
    if (!this.inside(x, y) || f === undefined) return false;
    this.cuts.delete(y * this.w + x);
    this.dug.set(y * this.w + x, f);
    this.version++;
    return true;
  }
  /** Mark (x, y) as a cut. A tile is dug or cut, never both: a cut takes the dug floor away. */
  cut(x: number, y: number): boolean {
    if (!this.inside(x, y)) return false;
    this.dug.delete(y * this.w + x);
    this.cuts.add(y * this.w + x);
    this.version++;
    return true;
  }
  /** Back-fill (x, y): it is neither dug nor cut after. False when it was neither. */
  fill(x: number, y: number): boolean {
    if (!this.inside(x, y)) return false;
    const k = y * this.w + x;
    if (!this.dug.delete(k) && !this.cuts.delete(k)) return false;
    this.version++;
    return true;
  }
  private portalKey(x: number, y: number, face: Face): number {
    return (y * this.w + x) * FACES.length + FACES.indexOf(face);
  }
  /** Add a portal; false for one off the map, with a bad face or floor, or already there. */
  addPortal(p: Portal): boolean {
    const floor = levelOf(p.floor, MAX_LEVEL);
    if (!this.inside(p.x, p.y) || !FACES.includes(p.face) || floor === undefined) return false;
    const key = this.portalKey(p.x, p.y, p.face);
    if (this.portalKeys.has(key)) return false;
    this.portalKeys.add(key);
    this.list.push({ x: p.x, y: p.y, face: p.face, floor });
    this.version++;
    return true;
  }
  /** Take away the portals on (x, y); false when there were none. */
  removePortals(x: number, y: number): boolean {
    const kept = this.list.filter((p) => p.x !== x || p.y !== y);
    if (kept.length === this.list.length) return false;
    this.list = kept;
    this.portalKeys.clear();
    for (const q of kept) this.portalKeys.add(this.portalKey(q.x, q.y, q.face));
    this.version++;
    return true;
  }

  /** In tile order, so the same store always writes the same text. */
  toJSON(): UndergroundJSON {
    const byKey = (a: number[], b: number[]) => a[1] - b[1] || a[0] - b[0];
    const keyed = (k: number): [number, number] => [k % this.w, Math.floor(k / this.w)];
    return {
      dug: [...this.dug]
        .map(([k, floor]): [number, number, number] => [...keyed(k), floor])
        .sort(byKey),
      cuts: [...this.cuts].map(keyed).sort(byKey),
      portals: [...this.list]
        .map((p) => ({ x: p.x, y: p.y, face: p.face, floor: p.floor }))
        .sort((a, b) => a.y - b.y || a.x - b.x || FACES.indexOf(a.face) - FACES.indexOf(b.face)),
    };
  }

  /**
   * The store a save holds, on a map of w by h tiles. Anything that is not the shape `toJSON`
   * writes loads as an empty store, and so does each entry that is off the map or is not whole
   * numbers (a dug tile with no floor among them), and so does a portal that is not on a dug
   * tile at that tile's floor; a tile listed as both dug and cut stays dug.
   */
  static fromJSON(j: unknown, w: number, h: number): Underground {
    const u = new Underground(w, h);
    if (!isRecord(j)) return u;
    if (Array.isArray(j.dug))
      for (const e of j.dug as unknown[]) {
        if (!Array.isArray(e)) continue;
        const [x, y, floor] = e as unknown[];
        if (typeof x === 'number' && typeof y === 'number') u.dig(x, y, floor as number);
      }
    if (Array.isArray(j.cuts))
      for (const e of j.cuts as unknown[]) {
        if (!Array.isArray(e)) continue;
        const [x, y] = e as unknown[];
        if (typeof x === 'number' && typeof y === 'number' && !u.isDug(x, y)) u.cut(x, y);
      }
    if (Array.isArray(j.portals))
      for (const p of j.portals as unknown[]) {
        if (isRecord(p) && u.floorAt(p.x as number, p.y as number) === p.floor)
          u.addPortal(p as unknown as Portal);
      }
    u.version = 0;
    return u;
  }
}

/**
 * The plane of a loaded map (`map.groundLevel`) as the map settles it, for the load to call once
 * the map and the plane are both in place. A plane has to hold settled levels (`levelAt` trusts
 * them and looks at four sides only), and a save may hold any level from 0 to MAX_LEVEL: a level
 * on a water tile is cleared, and every other is lowered to what `tileLevels` gives the tile. A
 * settled plane comes back as it was. Undefined when the map has no plane or none of it is left.
 */
export function settleGroundLevel(map: Elevated): Uint8Array | undefined {
  const plane = map.groundLevel;
  if (!plane) return undefined;
  const cleared = Uint8Array.from(plane, (v, i) =>
    map.terrain[i] === Terrain.Water ? NO_LEVEL : v,
  );
  // the levels the map settles to with the water tiles cleared; clamping the plane to them moves no
  // other tile, as they stand under every target already
  const levels = tileLevels({ ...map, groundLevel: cleared });
  let any = false;
  for (let i = 0; i < cleared.length; i++)
    if (cleared[i] !== NO_LEVEL) {
      cleared[i] = Math.min(cleared[i], levels[i]);
      any = true;
    }
  return any ? cleared : undefined;
}

/**
 * The tiles of a ground level plane (`GameMap.groundLevel`, w tiles wide) that have a level set,
 * in tile order; none for a map without the plane.
 */
export function groundLevelToJSON(plane: Uint8Array | undefined, w: number): GroundLevelJSON {
  const out: GroundLevelJSON = [];
  if (!plane) return out;
  for (let i = 0; i < plane.length; i++)
    if (plane[i] !== NO_LEVEL) out.push([i % w, Math.floor(i / w), plane[i]]);
  return out;
}

/**
 * The plane a save holds, w by h, every other tile at NO_LEVEL; undefined when no entry is
 * usable, as a map without the plane has none. An entry off the map or with a level above
 * MAX_LEVEL, or with anything but whole numbers, is skipped.
 */
export function groundLevelFromJSON(j: unknown, w: number, h: number): Uint8Array | undefined {
  if (!Array.isArray(j)) return undefined;
  let plane: Uint8Array | undefined;
  for (const e of j as unknown[]) {
    if (!Array.isArray(e)) continue;
    const [x, y, level] = e as unknown[];
    const lv = levelOf(level, MAX_LEVEL);
    if (lv === undefined || levelOf(x, w - 1) === undefined || levelOf(y, h - 1) === undefined)
      continue;
    plane ??= new Uint8Array(w * h).fill(NO_LEVEL);
    plane[(y as number) * w + (x as number)] = lv;
  }
  return plane;
}

/** The tiles of a saved ground level plane, `d` tiles further along both axes (map growth). */
export function shiftGroundLevel(j: GroundLevelJSON, d: number): GroundLevelJSON {
  if (!Array.isArray(j)) return j;
  return j.map((e) =>
    Array.isArray(e) ? [e[0] + d, e[1] + d, ...e.slice(2)] : e,
  ) as GroundLevelJSON;
}

/**
 * A saved store with every tile `d` tiles further along both axes (map growth). Entries and parts
 * that are not the shape `toJSON` writes are left as they are: the load skips them.
 */
export function shiftUnderground(j: UndergroundJSON, d: number): UndergroundJSON {
  if (!isRecord(j)) return j;
  const tiles = (list: unknown) =>
    Array.isArray(list)
      ? list.map((e: unknown) => (Array.isArray(e) ? [e[0] + d, e[1] + d, ...e.slice(2)] : e))
      : list;
  return {
    ...j,
    dug: tiles(j.dug),
    cuts: tiles(j.cuts),
    portals: Array.isArray(j.portals)
      ? j.portals.map((p: unknown) =>
          isRecord(p) ? { ...p, x: (p.x as number) + d, y: (p.y as number) + d } : p,
        )
      : j.portals,
  } as UndergroundJSON;
}
