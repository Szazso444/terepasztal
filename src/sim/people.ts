import { Terrain, type GameMap } from '../world/tiles';
import type { Builder } from './build';
import type { Station } from './stations';
import { decorDef } from './build';
import { buildingDef } from './buildings';

export interface Place {
  x: number;
  y: number;
  key: string;
}
export interface Person {
  id: number;
  x: number;
  y: number;
  /** current tile path and progress along it */
  path: { x: number; y: number }[];
  step: number;
  /** seconds left inside a building */
  inside: number;
  home: string;
  outfit: number;
  walking: boolean;
  /** boarding/alighting extra that disappears when its path ends */
  transient: boolean;
}

export type RoadKind = 'none' | 'dirt' | 'stone';
/** footsteps needed for a trodden path, and for it to be paved over */
export const PATH_WEAR = 6;
export const ROAD_WEAR = 45;
const WALK_SPEED = 1.3;
const MAX_TRIP = 48;

export function roadKind(wear: number): RoadKind {
  return wear >= ROAD_WEAR ? 'stone' : wear >= PATH_WEAR ? 'dirt' : 'none';
}
export function walkable(map: GameMap, x: number, y: number) {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
  const t = map.terrain[y * map.w + x];
  return t !== Terrain.Water && t !== Terrain.Rock;
}

/**
 * Breadth-first walk between two tiles over walkable ground (8 directions), limited to a
 * box around the pair. Roads count as cheaper so people converge on them.
 */
export function findWalk(
  map: GameMap,
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number }[] | null {
  const margin = 6;
  const x0 = Math.max(0, Math.min(from.x, to.x) - margin);
  const y0 = Math.max(0, Math.min(from.y, to.y) - margin);
  const x1 = Math.min(map.w - 1, Math.max(from.x, to.x) + margin);
  const y1 = Math.min(map.h - 1, Math.max(from.y, to.y) + margin);
  const W = x1 - x0 + 1;
  const H = y1 - y0 + 1;
  const dist = new Float32Array(W * H).fill(Infinity);
  const prev = new Int32Array(W * H).fill(-1);
  const key = (x: number, y: number) => (y - y0) * W + (x - x0);
  // Dijkstra with a tiny heap substitute: the box is small, so a sorted insert list is fine
  const open: { k: number; d: number }[] = [];
  const sk = key(from.x, from.y);
  dist[sk] = 0;
  open.push({ k: sk, d: 0 });
  const tk = key(to.x, to.y);
  let guard = 0;
  while (open.length && guard++ < 20000) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].d < open[bi].d) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.d > dist[cur.k]) continue;
    if (cur.k === tk) break;
    const cx = (cur.k % W) + x0;
    const cy = Math.floor(cur.k / W) + y0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
        if (!walkable(map, nx, ny) && !(nx === to.x && ny === to.y)) continue;
        const wear = map.wear[ny * map.w + nx];
        const cost =
          (dx && dy ? 1.41 : 1) * (wear >= ROAD_WEAR ? 0.55 : wear >= PATH_WEAR ? 0.75 : 1);
        const nk = key(nx, ny);
        const nd = cur.d + cost;
        if (nd < dist[nk]) {
          dist[nk] = nd;
          prev[nk] = cur.k;
          open.push({ k: nk, d: nd });
        }
      }
  }
  if (dist[tk] === Infinity) return null;
  const out: { x: number; y: number }[] = [];
  for (let k = tk; k >= 0; k = prev[k]) out.push({ x: (k % W) + x0, y: Math.floor(k / W) + y0 });
  return out.reverse();
}

/**
 * The population as walkers: everyone not on a train belongs to a station, works or service and
 * wanders to another one now and then. Every step wears the ground; worn tiles become paths,
 * busy paths become stone roads. Passengers boarding or alighting appear as short-lived walkers.
 */
export class PeopleSim {
  persons: Person[] = [];
  private nextId = 1;
  private rnd = Math.random;
  onRoadChanged: ((x: number, y: number, kind: RoadKind) => void) | null = null;
  constructor(
    readonly map: GameMap,
    private readonly builder: Builder,
  ) {}

  places(): Place[] {
    const out: Place[] = [];
    for (const s of this.builder.stations) out.push({ x: s.x, y: s.y, key: `s${s.id}` });
    for (const b of this.builder.buildings.values())
      if (buildingDef(b.id).crew > 0) out.push({ x: b.x, y: b.y, key: `b${b.x},${b.y}` });
    for (const d of this.builder.decor.values())
      if (decorDef(d.id).crew > 0) out.push({ x: d.x, y: d.y, key: `d${d.x},${d.y}` });
    return out;
  }

  /** People outside a building right now. */
  get walking() {
    return this.persons.filter((p) => p.walking).length;
  }

  private wearTile(x: number, y: number) {
    const i = y * this.map.w + x;
    const before = roadKind(this.map.wear[i]);
    if (this.map.wear[i] < 65000) this.map.wear[i]++;
    const after = roadKind(this.map.wear[i]);
    if (before !== after) this.onRoadChanged?.(x, y, after);
  }

  /** Emit road events for every worn tile (after a load). */
  replayRoads() {
    for (let i = 0; i < this.map.wear.length; i++) {
      const k = roadKind(this.map.wear[i]);
      if (k !== 'none') this.onRoadChanged?.(i % this.map.w, Math.floor(i / this.map.w), k);
    }
  }

  /** Boarding: walkers go from the station to the platform tile; alighting: the other way. */
  spawnTransit(st: Station, n: number, boarding: boolean) {
    const plat = this.builder.platformTiles(st)[0];
    if (!plat) return;
    const count = Math.min(5, Math.max(1, Math.round(n)));
    for (let k = 0; k < count; k++) {
      const from = boarding ? st : plat;
      const to = boarding ? plat : st;
      const path = findWalk(this.map, from, to) ?? [from, to];
      this.persons.push({
        id: this.nextId++,
        x: from.x + (this.rnd() - 0.5) * 0.4,
        y: from.y + (this.rnd() - 0.5) * 0.4,
        path,
        step: 0,
        inside: -this.rnd() * 1.5,
        home: '',
        outfit: Math.floor(this.rnd() * 4),
        walking: true,
        transient: true,
      });
    }
  }

  tick(gdt: number, population: number) {
    const places = this.places();
    const regular = this.persons.filter((p) => !p.transient);
    // grow or shrink to the population
    while (regular.length < population && places.length) {
      const home = places[Math.floor(this.rnd() * places.length)];
      const p: Person = {
        id: this.nextId++,
        x: home.x,
        y: home.y,
        path: [],
        step: 0,
        inside: 2 + this.rnd() * 12,
        home: home.key,
        outfit: Math.floor(this.rnd() * 4),
        walking: false,
        transient: false,
      };
      regular.push(p);
      this.persons.push(p);
    }
    while (regular.length > population) {
      const p = regular.pop()!;
      const i = this.persons.indexOf(p);
      if (i >= 0) this.persons.splice(i, 1);
    }
    const byKey = new Map(places.map((p) => [p.key, p]));
    for (let i = this.persons.length - 1; i >= 0; i--) {
      const p = this.persons[i];
      if (!p.walking) {
        p.inside -= gdt;
        if (p.inside > 0) continue;
        // home vanished (demolished): adopt a new one
        const home = byKey.get(p.home) ?? places[Math.floor(this.rnd() * places.length)];
        if (!home) continue;
        p.home = home.key;
        const near = places.filter(
          (q) => q.key !== home.key && Math.abs(q.x - home.x) + Math.abs(q.y - home.y) <= MAX_TRIP,
        );
        if (!near.length) {
          p.inside = 6 + this.rnd() * 10;
          continue;
        }
        // busy places attract: prefer the closest ones a bit
        near.sort(
          (a, b) =>
            Math.abs(a.x - home.x) +
            Math.abs(a.y - home.y) -
            (Math.abs(b.x - home.x) + Math.abs(b.y - home.y)),
        );
        const dest =
          near[Math.min(near.length - 1, Math.floor(this.rnd() * this.rnd() * near.length))];
        const path = findWalk(this.map, home, dest);
        if (!path || path.length < 2) {
          p.inside = 6 + this.rnd() * 10;
          continue;
        }
        p.path = path;
        p.step = 0;
        p.x = home.x;
        p.y = home.y;
        p.walking = true;
        p.home = dest.key; // the destination becomes the new home
        continue;
      }
      if (p.transient && p.inside < 0) {
        p.inside += gdt;
        continue;
      }
      // advance along the path
      const next = p.path[p.step + 1];
      if (!next) {
        if (p.transient) {
          this.persons.splice(i, 1);
          continue;
        }
        p.walking = false;
        p.inside = 8 + this.rnd() * 20;
        continue;
      }
      const onRoad =
        roadKind(this.map.wear[Math.round(p.y) * this.map.w + Math.round(p.x)]) !== 'none';
      const speed = WALK_SPEED * (onRoad ? 1.4 : 1) * (p.transient ? 1.6 : 1);
      const dx = next.x - p.x;
      const dy = next.y - p.y;
      const d = Math.hypot(dx, dy);
      const stepLen = speed * gdt;
      if (d <= stepLen) {
        p.x = next.x;
        p.y = next.y;
        p.step++;
        if (!p.transient && p.step < p.path.length - 1) this.wearTile(next.x, next.y);
      } else {
        p.x += (dx / d) * stepLen;
        p.y += (dy / d) * stepLen;
      }
    }
  }

  toJSON() {
    const wear: [number, number][] = [];
    for (let i = 0; i < this.map.wear.length; i++)
      if (this.map.wear[i] > 0) wear.push([i, this.map.wear[i]]);
    return { wear };
  }
  load(j: { wear?: [number, number][] } | undefined) {
    if (!j?.wear) return;
    for (const [i, v] of j.wear) if (i >= 0 && i < this.map.wear.length) this.map.wear[i] = v;
    this.replayRoads();
  }
}
