import { DIR_DX, DIR_DY } from '../engine/iso';
import { STR } from '../strings';
import { MAX_LEVEL, NO_LEVEL, tileLevels, type Elevated } from '../world/elevation';
import { reshape, type Reshape } from '../world/reshape';
import { Terrain, terrainAt, type GameMap } from '../world/tiles';
import type { PlacementCheck } from './build';
import { rules } from './rules';

/**
 * The store of what the Drill has made: the tiles dug inside a mountain, the cuttings that lead
 * down from a portal to open ground, and the portals themselves, with the plan of what a drag of
 * the Drill makes (`Underground.plan`). Nothing else writes the store: `Builder` prices a plan and
 * hands it to `apply`. Tiles are map tiles, as the track keys them.
 */

type Tile = { x: number; y: number };

/** The ground over a dug tile stays this many levels above its floor, or higher. */
export const TUNNEL_COVER = 3;

/** The floor the Drill digs at: one floor in this step of the game. */
const DIG_FLOOR = 0;

/** The side of a tile a portal looks out of. */
export type Face = 'N' | 'E' | 'S' | 'W';
/** In the order of `Dir`, so a face's place in the list is its direction. */
const FACES: readonly Face[] = ['N', 'E', 'S', 'W'];

/** A portal on tile (x, y), its opening on `face`, the rail inside at level `floor`. */
export interface Portal {
  x: number;
  y: number;
  face: Face;
  floor: number;
}

/** What a dig writes in the store, and what its undo takes out: new things only. */
export interface DigWork {
  /** the tiles it digs; a tile dug already is not among them */
  dig: Tile[];
  /** the tiles it cuts; a tile cut already is not among them */
  cut: Tile[];
  portals: Portal[];
  /** portals that stood already and would look into a tile this dig digs */
  shut: Portal[];
}

/**
 * What a drag of the Drill would do. `cost` is in money, before `Builder` applies the build price,
 * and `stone` is what the dug tiles bring in. Refused by the plan, it does nothing: every list but
 * `refused` is empty, and `reason` says why the first refused tile refuses. Refused by
 * `Builder.checkDig` for want of money, `ok` is false and every list stays full, with `cost` and
 * `stone` as they would be: the ghost shows what the drag would do and that it cannot be paid.
 */
export interface DigPlan extends PlacementCheck, DigWork {
  /**
   * Every tile the ground under the drag writes, as `Reshape.moved` holds them: a tile that only
   * keeps its level is among them, so a count or a price compares `to` with the level there.
   */
  raise: Reshape['moved'];
  stone: number;
  refused: Tile[];
}

/** What a tile of a line becomes: under cover, in a cutting, or left as open ground. */
type TileKind = 'dug' | 'cut' | 'open';

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

/** Water on a side or a corner of (x, y), or on the tile itself. */
export function touchesWater(map: GameMap, x: number, y: number) {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if (terrainAt(map, x + dx, y + dy) === Terrain.Water) return true;
  return false;
}

/** A drag cut where it jumps: each list runs from tile to tile by their sides. */
function linesOf(tiles: readonly Tile[]): Tile[][] {
  const out: Tile[][] = [];
  tiles.forEach((t, i) => {
    const b = tiles[i - 1];
    if (b && Math.abs(t.x - b.x) + Math.abs(t.y - b.y) === 1) out[out.length - 1].push(t);
    else out.push([t]);
  });
  return out;
}

/** The tile a portal looks out at. */
function frontOf(p: Portal): Tile {
  const d = FACES.indexOf(p.face);
  return { x: p.x + DIR_DX[d], y: p.y + DIR_DY[d] };
}

/** The face of `from` that looks at the tile beside it, `to`. */
function faceTo(from: Tile, to: Tile): Face {
  return FACES.find((_, d) => from.x + DIR_DX[d] === to.x && from.y + DIR_DY[d] === to.y)!;
}

/**
 * The raise that brings `tiles` up to the cover: Raise's steps, run until they all stand there.
 * `moved` holds every tile any step wrote, at the last level it got, so the whole of it written
 * leaves the map settled, as one `reshape` does. Refused, one step refused and nothing moves.
 */
function raiseToCover(
  map: GameMap,
  levels: Uint8Array,
  tiles: readonly Tile[],
  fixed: (x: number, y: number) => boolean,
): Reshape {
  const now = Uint8Array.from(levels),
    plane = map.groundLevel
      ? Uint8Array.from(map.groundLevel)
      : new Uint8Array(map.w * map.h).fill(NO_LEVEL),
    ground = { ...map, groundLevel: plane },
    moved = new Map<number, Reshape['moved'][number]>();
  for (;;) {
    const low = tiles.filter((t) => now[t.y * map.w + t.x] < TUNNEL_COVER);
    if (!low.length) break;
    const step = reshape(ground, now, low, 1, fixed, () => 0);
    if (step.refused.length) return step;
    for (const m of step.moved) {
      const k = m.y * map.w + m.x;
      now[k] = plane[k] = m.to;
      moved.set(k, m);
    }
  }
  return { moved: [...moved].sort(([a], [b]) => a - b).map(([, m]) => m), refused: [] };
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
  /** Make (x, y) neither dug nor cut, and leave the portals be. False when it was neither. */
  private clear(x: number, y: number): boolean {
    if (!this.inside(x, y)) return false;
    const k = y * this.w + x;
    if (!this.dug.delete(k) && !this.cuts.delete(k)) return false;
    this.version++;
    return true;
  }
  /**
   * Back-fill (x, y): it is neither dug nor cut after, and the portals on it and the portal that
   * looks out at it go with it. The answer holds those portals, as a tile open on two sides has
   * two; null when the tile was neither.
   */
  fill(x: number, y: number): { portals: Portal[] } | null {
    const portals = this.portalsOf(x, y);
    if (!this.clear(x, y)) return null;
    this.keepPortals((p) => !portals.includes(p));
    return { portals };
  }
  /** The portals a back-fill of (x, y) takes: those on the tile and those looking out at it. */
  portalsOf(x: number, y: number): Portal[] {
    return this.list.filter((p) => {
      const front = frontOf(p);
      return (p.x === x && p.y === y) || (front.x === x && front.y === y);
    });
  }
  /** A portal looks out at (x, y): the ground there has to stay as it is. */
  fronted(x: number, y: number): boolean {
    return this.list.some((p) => {
      const front = frontOf(p);
      return front.x === x && front.y === y;
    });
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
    return this.keepPortals((p) => p.x !== x || p.y !== y);
  }
  /** Take away the portal on one face; false when it was not there. */
  private removePortal(p: Portal): boolean {
    return this.keepPortals((q) => q.x !== p.x || q.y !== p.y || q.face !== p.face);
  }
  private keepPortals(keep: (p: Portal) => boolean): boolean {
    const kept = this.list.filter(keep);
    if (kept.length === this.list.length) return false;
    this.list = kept;
    this.portalKeys.clear();
    for (const q of kept) this.portalKeys.add(this.portalKey(q.x, q.y, q.face));
    this.version++;
    return true;
  }

  /**
   * `line` with the tile past each end, along the drag, where that tile has a say: it is dug, or
   * it leads out, being level 0 or a cut. These are read and never written. A drag from the foot of
   * a slope, or into the mountain from a tile beside rail, leads out this way. One tile has no
   * direction: it takes one from its four sides when exactly one of them leads out.
   */
  private withEnds(line: readonly Tile[], levels: Uint8Array): Tile[] {
    const leadsOut = (t: Tile) =>
      this.inside(t.x, t.y) && (!levels[t.y * this.w + t.x] || this.isCut(t.x, t.y));
    const counts = (t: Tile) => this.isDug(t.x, t.y) || leadsOut(t);
    const past = (t: Tile, from: Tile) => ({ x: 2 * t.x - from.x, y: 2 * t.y - from.y });
    const [a] = line,
      z = line[line.length - 1];
    let before: Tile | undefined, after: Tile | undefined;
    if (line.length > 1) {
      before = past(a, line[1]);
      after = past(z, line[line.length - 2]);
    } else {
      const open = FACES.map((_, d) => ({ x: a.x + DIR_DX[d], y: a.y + DIR_DY[d] })).filter(
        leadsOut,
      );
      if (open.length !== 1) return [a];
      [before] = open;
      after = past(a, before);
    }
    return [...[before].filter(counts), ...line, ...[after].filter(counts)];
  }

  /**
   * What each tile of `line` becomes. A tile dug already or at rail + 3 or higher is dug. Past the
   * last of these at each end, or along the whole of a line with none, the tiles lead out to open
   * ground when that end comes to level 0 or to a cut: they are cuts, and level 0 stays open
   * ground. An end that does not, and every tile between two dug tiles, level 0 too, is raised and
   * dug: one drag is one tunnel. A cut that stands stays a cut.
   */
  private kindsOf(line: readonly Tile[], levels: Uint8Array): TileKind[] {
    const level = (t: Tile) => levels[t.y * this.w + t.x];
    const covered = (t: Tile) =>
      this.isDug(t.x, t.y) || (!this.isCut(t.x, t.y) && level(t) >= TUNNEL_COVER);
    const first = line.findIndex(covered);
    const last = line.length - 1 - [...line].reverse().findIndex(covered);
    const ends = first < 0 ? [line] : [line.slice(0, first), line.slice(last + 1)];
    const leadsOut = new Set(
      ends.filter((end) => end.some((t) => !level(t) || this.isCut(t.x, t.y))).flat(),
    );
    return line.map((t) => {
      if (covered(t)) return 'dug';
      if (this.isCut(t.x, t.y)) return 'cut';
      if (!leadsOut.has(t)) return 'dug';
      return level(t) ? 'cut' : 'open';
    });
  }

  /**
   * What the Drill would do with the drag `tiles`, in the order they were dragged, on ground that
   * stands at `levels` (tileLevels(map)). The whole drag refuses if any tile it would dig or cut
   * touches water or has something on the surface (`surfaceFree`), or if a tile the ground would
   * lift may not move. Water and the surface are not asked of a tile the plan leaves as it is: a
   * tile dug or cut already, or open ground, so a drag from rail on open ground starts from that
   * rail. A tile a portal looks out at does not move, unless this dig digs it.
   *
   * A portal stands on the dug tile where a line comes out: beside a cut or open ground, along the
   * drag and the one tile past each of its ends (`withEnds`). A portal costs `portalCost` on top of
   * its tile. A cut costs a tile and brings no stone, and a raise is priced by the levels that
   * really change, at Raise's price.
   */
  plan(
    map: GameMap,
    levels: Uint8Array,
    tiles: readonly Tile[],
    surfaceFree: (x: number, y: number) => boolean,
  ): DigPlan {
    const nothing = { dig: [], cut: [], raise: [], portals: [], shut: [], stone: 0 };
    const refused: Tile[] = [],
      seen = new Set<number>(),
      drag: Tile[] = [];
    let reason = '';
    const refuse = (t: Tile, why: string) => {
      refused.push({ x: t.x, y: t.y });
      reason ||= why;
    };
    for (const t of tiles) {
      if (!this.inside(t.x, t.y)) {
        refuse(t, STR.build.offMap);
        continue;
      }
      const k = t.y * this.w + t.x;
      if (seen.has(k)) continue;
      seen.add(k);
      drag.push(t);
    }
    if (refused.length) return { ok: false, cost: {}, reason, ...nothing, refused };

    const dig: Tile[] = [],
      cut: Tile[] = [],
      low: Tile[] = [],
      portals: Portal[] = [];
    const portal = (at: Tile, out: Tile) => {
      const face = faceTo(at, out);
      if (this.portalKeys.has(this.portalKey(at.x, at.y, face))) return;
      portals.push({ x: at.x, y: at.y, face, floor: this.floorAt(at.x, at.y) ?? DIG_FLOOR });
    };
    for (const line of linesOf(drag)) {
      const walk = this.withEnds(line, levels),
        kinds = this.kindsOf(walk, levels);
      walk.forEach((t, i) => {
        const written =
          line.includes(t) && !this.isDug(t.x, t.y) && !this.isCut(t.x, t.y) && kinds[i] !== 'open';
        if (written && touchesWater(map, t.x, t.y)) refuse(t, STR.build.digBesideWater);
        else if (written && !surfaceFree(t.x, t.y)) refuse(t, STR.build.occupied);
        else if (written && kinds[i] === 'cut') cut.push(t);
        else if (written) dig.push(t);
        if (written && kinds[i] === 'dug' && levels[t.y * this.w + t.x] < TUNNEL_COVER) low.push(t);
        if (i === walk.length - 1 || (kinds[i] === 'dug') === (kinds[i + 1] === 'dug')) return;
        if (kinds[i] === 'dug') portal(t, walk[i + 1]);
        else portal(walk[i + 1], t);
      });
    }
    if (refused.length) return { ok: false, cost: {}, reason, ...nothing, refused };

    const shut = this.list.filter((p) => {
      const front = frontOf(p);
      return dig.some((t) => t.x === front.x && t.y === front.y);
    });
    // the ground comes up round a tile as a Raise brings it, and leaves lying open a cut and the
    // ground a portal looks out at
    const open = [...this.list.filter((p) => !shut.includes(p)), ...portals].map(frontOf);
    const held = new Set(
      [...cut, ...open].filter((t) => this.inside(t.x, t.y)).map((t) => t.y * this.w + t.x),
    );
    const stays = (x: number, y: number) =>
      this.isCut(x, y) || held.has(y * this.w + x) || !surfaceFree(x, y);
    const { moved, refused: stopped } = raiseToCover(map, levels, low, stays);
    if (stopped.length) {
      const [{ x, y }] = stopped;
      const why =
        map.terrain[y * this.w + x] === Terrain.Water
          ? STR.build.groundMovesWater
          : stays(x, y)
            ? STR.build.occupied
            : STR.build.groundLimit;
      return { ok: false, cost: {}, reason: why, ...nothing, refused: stopped };
    }
    let steps = 0;
    for (const m of moved) steps += m.to - levels[m.y * this.w + m.x];
    const money =
      rules.drillCost * (dig.length + cut.length) +
      rules.portalCost * portals.length +
      rules.groundCost * steps;
    return {
      ok: true,
      cost: { money },
      dig,
      cut,
      raise: moved,
      portals,
      shut,
      stone: rules.drillStone * dig.length,
      refused: [],
    };
  }

  /** Write what a dig makes; the ground under it is `Builder.setGround`'s. */
  apply(work: DigWork) {
    for (const p of work.shut) this.removePortal(p);
    for (const t of work.dig) this.dig(t.x, t.y, DIG_FLOOR);
    for (const t of work.cut) this.cut(t.x, t.y);
    for (const p of work.portals) this.addPortal(p);
  }
  /** Take a dig back out, as an undo does: what stood before it stays. */
  unapply(work: DigWork) {
    for (const p of work.portals) this.removePortal(p);
    for (const t of [...work.dig, ...work.cut]) this.clear(t.x, t.y);
    for (const p of work.shut) this.addPortal(p);
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
