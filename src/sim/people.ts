import { Terrain, type GameMap } from '../world/tiles';
import type { Builder } from './build';
import type { Station } from './stations';
import { decorDef } from './build';
import { buildingDef } from './buildings';

export interface Place {
  x: number;
  y: number;
  key: string;
  /** what the crew here goes out to gather */
  gathers: Terrain | null;
}
export type PersonState =
  'inside' | 'idle' | 'walk' | 'gather' | 'toStation' | 'waiting' | 'return';
export interface Person {
  id: number;
  x: number;
  y: number;
  home: string;
  outfit: number;
  state: PersonState;
  /** seconds left in the current state */
  timer: number;
  path: { x: number; y: number }[];
  step: number;
  /** transient walkers (boarding / alighting) vanish at the end of their path */
  transient: boolean;
  /** station a traveller waits at */
  stationId: number | null;
}

const WALK_SPEED = 1.1;
/** furthest a person walks from home on foot */
const ROAM = 6;
/** furthest station a traveller walks to */
const STATION_REACH = 14;
/** day fraction window when people are outside */
const WAKE = 0.27;
const SLEEP = 0.85;

export function walkable(map: GameMap, x: number, y: number) {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
  const t = map.terrain[y * map.w + x];
  return t !== Terrain.Water && t !== Terrain.Rock && t !== Terrain.Mountain;
}

/** Breadth-first walk between two tiles over walkable ground (8 directions) inside a small box. */
export function findWalk(
  map: GameMap,
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number }[] | null {
  const margin = 4;
  const x0 = Math.max(0, Math.min(from.x, to.x) - margin);
  const y0 = Math.max(0, Math.min(from.y, to.y) - margin);
  const x1 = Math.min(map.w - 1, Math.max(from.x, to.x) + margin);
  const y1 = Math.min(map.h - 1, Math.max(from.y, to.y) + margin);
  const W = x1 - x0 + 1;
  const H = y1 - y0 + 1;
  const prev = new Int32Array(W * H).fill(-2);
  const key = (x: number, y: number) => (y - y0) * W + (x - x0);
  const sk = key(from.x, from.y);
  const tk = key(to.x, to.y);
  prev[sk] = -1;
  const queue = [sk];
  let qi = 0;
  while (qi < queue.length) {
    const k = queue[qi++];
    if (k === tk) break;
    const cx = (k % W) + x0;
    const cy = Math.floor(k / W) + y0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
        const nk = key(nx, ny);
        if (prev[nk] !== -2) continue;
        if (!walkable(map, nx, ny) && !(nx === to.x && ny === to.y)) continue;
        prev[nk] = k;
        queue.push(nk);
      }
  }
  if (prev[tk] === -2) return null;
  const out: { x: number; y: number }[] = [];
  for (let k = tk; k >= 0; k = prev[k]) out.push({ x: (k % W) + x0, y: Math.floor(k / W) + y0 });
  return out.reverse();
}

/**
 * The population as a few quiet walkers: everyone belongs to a station, works or service and
 * spends most of the day inside; now and then someone steps out to idle by the door, walks to a
 * nearby resource tile to gather, or goes to the closest station to catch a train with a coach.
 * Nobody is outside at night. Nothing here changes the map.
 */
export class PeopleSim {
  persons: Person[] = [];
  private nextId = 1;
  private rnd = Math.random;
  private gatherTerrain: Record<string, Terrain | null> = {
    farm: Terrain.Grass,
    lumber: Terrain.Forest,
    quarry: Terrain.Hill,
    pump: Terrain.Water,
  };
  constructor(
    readonly map: GameMap,
    private readonly builder: Builder,
  ) {}

  places(): Place[] {
    const out: Place[] = [];
    for (const s of this.builder.stations)
      out.push({ x: s.x, y: s.y, key: `s${s.id}`, gathers: this.gatherTerrain[s.def.id] ?? null });
    for (const b of this.builder.buildings.values())
      if (buildingDef(b.id).crew > 0)
        out.push({ x: b.x, y: b.y, key: `b${b.x},${b.y}`, gathers: null });
    for (const d of this.builder.decor.values())
      if (decorDef(d.id).crew > 0 || decorDef(d.id).residents)
        out.push({ x: d.x, y: d.y, key: `d${d.x},${d.y}`, gathers: null });
    return out;
  }

  /** People outside right now. */
  get outside() {
    return this.persons.filter((p) => p.state !== 'inside').length;
  }
  /** Travellers waiting on a station's tile. */
  waitingAt(stationId: number) {
    return this.persons.filter((p) => p.state === 'waiting' && p.stationId === stationId);
  }

  /** A train with a coach loaded `n` passengers here: waiting travellers board (vanish). */
  board(st: Station, n: number) {
    const waiting = this.waitingAt(st.id);
    const take = Math.min(waiting.length, Math.max(1, Math.round(n)));
    for (let k = 0; k < take; k++) {
      const i = this.persons.indexOf(waiting[k]);
      if (i >= 0) this.persons.splice(i, 1);
    }
    // the rest of the load is abstract cargo; show a couple of extra figures stepping aboard
    const plat = this.builder.platformTiles(st)[0];
    if (plat)
      for (let k = take; k < Math.min(3, Math.round(n)); k++) this.spawnTransient(st, plat, true);
  }
  /** Passengers alighted: a few figures walk from the platform to a nearby building and settle. */
  alight(st: Station, n: number) {
    const plat = this.builder.platformTiles(st)[0];
    if (!plat) return;
    const count = Math.min(3, Math.max(1, Math.round(n)));
    for (let k = 0; k < count; k++) this.spawnTransient(st, plat, false);
  }
  private spawnTransient(st: Station, plat: { x: number; y: number }, boarding: boolean) {
    const from = boarding ? st : plat;
    const to = boarding ? plat : st;
    const path = findWalk(this.map, from, to) ?? [from, to];
    this.persons.push({
      id: this.nextId++,
      x: from.x + (this.rnd() - 0.5) * 0.4,
      y: from.y + (this.rnd() - 0.5) * 0.4,
      home: '',
      outfit: Math.floor(this.rnd() * 4),
      state: 'walk',
      timer: 0,
      path,
      step: 0,
      transient: true,
      stationId: null,
    });
  }

  private nearestTile(from: Place, t: Terrain): { x: number; y: number } | null {
    let best: { x: number; y: number; d: number } | null = null;
    for (let dy = -ROAM; dy <= ROAM; dy++)
      for (let dx = -ROAM; dx <= ROAM; dx++) {
        const x = from.x + dx;
        const y = from.y + dy;
        if (x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) continue;
        const tt = this.map.terrain[y * this.map.w + x];
        if (tt !== t && !(t === Terrain.Hill && tt === Terrain.Rock)) continue;
        const d = Math.abs(dx) + Math.abs(dy) + this.rnd() * 2;
        if (!best || d < best.d) best = { x, y, d };
      }
    if (!best) return null;
    // stand next to water / rock rather than on it
    if (!walkable(this.map, best.x, best.y)) {
      for (const [ox, oy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        if (walkable(this.map, best.x + ox, best.y + oy)) return { x: best.x + ox, y: best.y + oy };
      }
      return null;
    }
    return best;
  }

  private startWalk(
    p: Person,
    from: { x: number; y: number },
    to: { x: number; y: number },
    state: PersonState,
  ) {
    const path = findWalk(this.map, from, to);
    if (!path || path.length < 2) return false;
    p.path = path;
    p.step = 0;
    p.x = from.x;
    p.y = from.y;
    p.state = state;
    return true;
  }

  tick(gdt: number, population: number, dayFraction: number) {
    const places = this.places();
    const byKey = new Map(places.map((p) => [p.key, p]));
    const regular = this.persons.filter((p) => !p.transient);
    while (regular.length < population && places.length) {
      const home = places[Math.floor(this.rnd() * places.length)];
      const p: Person = {
        id: this.nextId++,
        x: home.x,
        y: home.y,
        home: home.key,
        outfit: Math.floor(this.rnd() * 4),
        state: 'inside',
        timer: 5 + this.rnd() * 40,
        path: [],
        step: 0,
        transient: false,
        stationId: null,
      };
      regular.push(p);
      this.persons.push(p);
    }
    while (regular.length > population) {
      const p = regular.pop()!;
      const i = this.persons.indexOf(p);
      if (i >= 0) this.persons.splice(i, 1);
    }
    const daytime = dayFraction > WAKE && dayFraction < SLEEP;
    for (let i = this.persons.length - 1; i >= 0; i--) {
      const p = this.persons[i];
      if (p.transient) {
        if (!this.advance(p, gdt)) this.persons.splice(i, 1);
        continue;
      }
      const home = byKey.get(p.home) ?? places[Math.floor(this.rnd() * places.length)];
      if (!home) continue;
      p.home = home.key;
      switch (p.state) {
        case 'inside': {
          p.timer -= gdt;
          if (p.timer > 0 || !daytime) break;
          // step outside: mostly idling, sometimes gathering, rarely a train trip
          const r = this.rnd();
          if (r < 0.65) {
            p.x = home.x + (this.rnd() - 0.5) * 0.8;
            p.y = home.y + 0.3 + this.rnd() * 0.4;
            p.state = 'idle';
            p.timer = 6 + this.rnd() * 14;
          } else if (r < 0.92 && home.gathers !== null) {
            const spot = this.nearestTile(home, home.gathers);
            if (!spot || !this.startWalk(p, home, spot, 'gather')) p.timer = 10;
          } else {
            const st = this.builder.stations
              .filter((s) => Math.abs(s.x - home.x) + Math.abs(s.y - home.y) <= STATION_REACH)
              .sort(
                (a, b) =>
                  Math.abs(a.x - home.x) +
                  Math.abs(a.y - home.y) -
                  (Math.abs(b.x - home.x) + Math.abs(b.y - home.y)),
              )[0];
            if (st && this.startWalk(p, home, st, 'toStation')) p.stationId = st.id;
            else p.timer = 10;
          }
          break;
        }
        case 'idle':
          p.timer -= gdt;
          if (p.timer <= 0 || !daytime) {
            p.state = 'inside';
            p.timer = 20 + this.rnd() * 60;
          }
          break;
        case 'gather':
        case 'toStation':
        case 'return':
          if (!this.advance(p, gdt)) {
            if (p.state === 'gather') {
              p.state = 'idle';
              p.timer = 8 + this.rnd() * 10;
              // walk back afterwards
              const back = findWalk(this.map, { x: Math.round(p.x), y: Math.round(p.y) }, home);
              if (back && back.length >= 2) {
                p.path = back;
                p.step = 0;
                p.state = 'return';
                p.timer = 0;
              }
            } else if (p.state === 'toStation') {
              p.state = 'waiting';
              p.timer = 60 + this.rnd() * 90;
            } else {
              p.state = 'inside';
              p.timer = 20 + this.rnd() * 60;
            }
          }
          break;
        case 'waiting':
          p.timer -= gdt;
          if (p.timer <= 0 || !daytime) {
            // no train came: walk home
            const st = this.builder.stationById(p.stationId ?? -1);
            if (st && this.startWalk(p, st, home, 'return')) break;
            p.state = 'inside';
            p.timer = 30;
          }
          break;
        case 'walk':
          if (!this.advance(p, gdt)) {
            p.state = 'inside';
            p.timer = 20 + this.rnd() * 40;
          }
          break;
      }
    }
  }

  /** Move along the path; returns false once the end is reached. */
  private advance(p: Person, gdt: number) {
    const next = p.path[p.step + 1];
    if (!next) return false;
    const speed = WALK_SPEED * (p.transient ? 1.5 : 1);
    const dx = next.x - p.x;
    const dy = next.y - p.y;
    const d = Math.hypot(dx, dy);
    const stepLen = speed * gdt;
    if (d <= stepLen) {
      p.x = next.x;
      p.y = next.y;
      p.step++;
    } else {
      p.x += (dx / d) * stepLen;
      p.y += (dy / d) * stepLen;
    }
    return true;
  }
}
