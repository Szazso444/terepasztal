import { MAX_LEVEL, NO_LEVEL } from '../world/elevation';

/**
 * The store of what the Drill has made: the tiles dug inside a mountain, the cuttings that lead
 * down from a portal to open ground, and the portals themselves. It holds no rules; the dig plan
 * that decides what may be dug comes with the Drill. Tiles are map tiles, as the track keys them.
 */

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

  /** Dig (x, y) at `floor`. A tile is dug or cut, never both: digging takes the cut away. */
  dig(x: number, y: number, floor = 0): boolean {
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
  /** Add a portal; false for one off the map, with a bad face or floor, or already there. */
  addPortal(p: Portal): boolean {
    const floor = levelOf(p.floor, MAX_LEVEL);
    if (!this.inside(p.x, p.y) || !FACES.includes(p.face) || floor === undefined) return false;
    if (this.list.some((q) => q.x === p.x && q.y === p.y && q.face === p.face)) return false;
    this.list = [...this.list, { x: p.x, y: p.y, face: p.face, floor }];
    this.version++;
    return true;
  }
  /** Take away the portals on (x, y); false when there were none. */
  removePortals(x: number, y: number): boolean {
    const kept = this.list.filter((p) => p.x !== x || p.y !== y);
    if (kept.length === this.list.length) return false;
    this.list = kept;
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
   * numbers; a tile listed as both dug and cut stays dug.
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
        if (isRecord(p)) u.addPortal(p as unknown as Portal);
      }
    u.version = 0;
    return u;
  }
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
