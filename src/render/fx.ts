import { Container, Graphics, Sprite } from 'pixi.js';
import type { AtlasRegistry } from '../engine/atlas';
import { tileToWorld } from '../engine/iso';
import type { Station } from '../sim/stations';
import type { Train } from '../sim/trains';

/** 0 = full day, 1 = deep night, from the fraction of the day (0 = midnight). */
export function nightness(dayFraction: number): number {
  const h = dayFraction * 24;
  if (h >= 7 && h <= 18) return 0;
  if (h > 18 && h < 22) return (h - 18) / 4;
  if (h >= 4 && h < 7) return 1 - (h - 4) / 3;
  return 1;
}
/** Warm dusk/dawn weight. */
function duskness(dayFraction: number): number {
  const h = dayFraction * 24;
  const d1 = Math.max(0, 1 - Math.abs(h - 6.5) / 1.5);
  const d2 = Math.max(0, 1 - Math.abs(h - 19) / 1.5);
  return Math.max(d1, d2);
}

/**
 * Multiply-blended tint over the world (map plus its void border) that follows the clock and
 * darkens further in rain. Lives inside the world container so only the world is tinted.
 */
export class DayNight {
  readonly overlay = new Graphics();
  private poly: number[] = [];
  private lastColor = -1;
  get color() {
    return this.overlay.visible ? this.lastColor : 0xffffff;
  }
  constructor() {
    this.overlay.blendMode = 'multiply';
  }
  /** Diamond covering the playable map plus `border` tiles around it, in world pixels. */
  setWorld(w: number, h: number, border: number) {
    const b = border + 0.5;
    const pts = [
      tileToWorld(-b, -b),
      tileToWorld(w - 1 + b, -b),
      tileToWorld(w - 1 + b, h - 1 + b),
      tileToWorld(-b, h - 1 + b),
    ];
    this.poly = pts.flatMap((p) => [p.x, p.y]);
    this.lastColor = -1;
  }
  update(dayFraction: number, enabled: boolean, rain = 0) {
    const n = enabled ? nightness(dayFraction) : 0;
    const d = enabled ? duskness(dayFraction) * (1 - n) : 0;
    const day = [1, 1, 1];
    const night = [0.36, 0.42, 0.68];
    const dusk = [1.0, 0.78, 0.6];
    const c = day.map((v, i) => v * (1 - n - d) + night[i] * n + dusk[i] * d);
    const rainDim = 1 - 0.28 * rain;
    const col =
      (Math.round(c[0] * rainDim * 255) << 16) |
      (Math.round(c[1] * rainDim * 255) << 8) |
      Math.round(c[2] * rainDim * 255);
    this.overlay.visible = n > 0.001 || d > 0.001 || rain > 0.01;
    if (col === this.lastColor || !this.poly.length) return;
    this.lastColor = col;
    this.overlay.clear();
    this.overlay.poly(this.poly).fill({ color: col });
  }
}

/** Additive lantern glows on stations and locomotive headlamps, visible at night. */
export class Glows {
  private stationGlows = new Map<number, Sprite>();
  private trainGlows = new Map<number, Sprite[]>();
  constructor(
    private readonly atlas: AtlasRegistry,
    private readonly layer: Container,
    private readonly surface: (x: number, y: number) => { x: number; y: number },
    /** screen offset of the rail under a tile position (negative is up); level when absent */
    private readonly railDz: (x: number, y: number) => number = () => 0,
  ) {}
  private make(frame: string) {
    const f = this.atlas.get(frame);
    const s = new Sprite(f.texture);
    s.anchor.set(f.anchorX, f.anchorY);
    s.blendMode = 'add';
    s.cullable = true;
    this.layer.addChild(s);
    return s;
  }
  update(stations: Station[], trains: Train[], night: number) {
    const seenS = new Set<number>();
    for (const st of stations) {
      seenS.add(st.id);
      let s = this.stationGlows.get(st.id);
      if (!s) {
        s = this.make('fx/glow');
        this.stationGlows.set(st.id, s);
      }
      const p = this.surface(st.x, st.y);
      s.position.set(p.x + 10, p.y - 6);
      s.alpha = night * 0.4;
      s.visible = night > 0.02;
      s.scale.set(0.7 + st.level * 0.05);
    }
    for (const [id, s] of this.stationGlows)
      if (!seenS.has(id)) {
        s.destroy();
        this.stationGlows.delete(id);
      }
    const seenT = new Set<number>();
    for (const t of trains) {
      const pose = t.poses[0];
      if (!pose) continue;
      seenT.add(t.id);
      const dir = pose.heading + (t.reversed ? Math.PI : 0);
      // a rendered model says where its lamps are; any other engine glows ahead of its middle
      const spots: { x: number; y: number; up: number; size: number; front: number }[] = [];
      for (const lamp of t.locos[0]?.def.lamps ?? []) {
        const seg = t.vehiclePoses[0]?.segments.find((g) => g.part === lamp.part);
        if (!seg) continue;
        const nose = seg.angle + (t.reversed ? Math.PI : 0) + (seg.mirror ? Math.PI : 0);
        const c = Math.cos(nose);
        const sn = Math.sin(nose);
        spots.push({
          x: seg.x + c * lamp.along + sn * lamp.across,
          y: seg.y + sn * lamp.along - c * lamp.across,
          up: lamp.up,
          size: 0.6,
          // a lamp is on the nose: seen while the nose points at the viewer's half
          front: Math.min(1, Math.max(0, (c + sn) * 2.5 + 0.5)),
        });
      }
      if (!spots.length)
        spots.push({
          x: pose.x + Math.cos(dir) * 0.36,
          y: pose.y + Math.sin(dir) * 0.36,
          up: 8,
          size: 1,
          front: 1,
        });
      let glows = this.trainGlows.get(t.id);
      if (!glows) this.trainGlows.set(t.id, (glows = []));
      while (glows.length < spots.length) glows.push(this.make('fx/glow_small'));
      glows.forEach((s, i) => {
        const spot = spots[i];
        if (!spot) {
          s.visible = false;
          return;
        }
        const w = tileToWorld(spot.x, spot.y);
        s.position.set(Math.round(w.x), Math.round(w.y - spot.up + this.railDz(spot.x, spot.y)));
        s.scale.set(spot.size);
        s.alpha = night * 0.9 * spot.front;
        s.visible = night > 0.02 && spot.front > 0;
      });
    }
    for (const [id, glows] of this.trainGlows)
      if (!seenT.has(id)) {
        for (const s of glows) s.destroy();
        this.trainGlows.delete(id);
      }
  }
}

/**
 * Each layer's surface version (`Landscape.surfaceVersion`), by the layer: a ground light stands
 * on the surface of its tile, and stays where it is until this changes.
 */
export const surfaceVersions = new WeakMap<Container, () => number>();

/** A lit tile: where it is and how bright its light is. */
interface Lit {
  x: number;
  y: number;
  alpha: number;
}

/** One number per tile, for a map up to 65536 tiles across. */
const tileKey = (x: number, y: number) => y * 65536 + x;

/**
 * Additive light diamonds on the tiles around lanterns and in front of locomotives. The lights are
 * worked out again only when what they come from changes: the night, the surface, the stations
 * (where they are and their level) or the tiles in front of the trains. A train moving on to a new
 * tile relights only the tiles it left and entered.
 */
export class GroundLights {
  private pool = new Map<number, Sprite>();
  /** What the station lights were worked out from: x, y and level of each station, in order. */
  private stationsSeen: number[] = [];
  /** The tile in front of each train when the train lights were worked out, x and y each. */
  private trainsSeen: number[] = [];
  private night = -1;
  private surfaceSeen = -1;
  /** The surface version the pooled sprites were placed on. */
  private placedOn = -1;
  /** The tiles the stations light, in the order they were first lit. */
  private stationLit = new Map<number, Lit>();
  /** The tiles the trains light, with what they show there, the stations' light added. */
  private trainLit = new Map<number, Lit>();
  constructor(
    private readonly atlas: AtlasRegistry,
    private readonly layer: Container,
    private readonly surface: (x: number, y: number) => { x: number; y: number },
    private readonly inBounds: (x: number, y: number) => boolean,
  ) {}
  private get(key: number, x: number, y: number) {
    let s = this.pool.get(key);
    if (!s) {
      const f = this.atlas.get('fx/light_tile');
      s = new Sprite(f.texture);
      s.anchor.set(f.anchorX, f.anchorY);
      s.blendMode = 'add';
      s.cullable = true;
      const p = this.surface(x, y);
      s.position.set(p.x, p.y);
      this.layer.addChild(s);
      this.pool.set(key, s);
    }
    return s;
  }
  private drop(key: number) {
    this.pool.get(key)?.destroy();
    this.pool.delete(key);
  }
  update(stations: Station[], trains: Train[], night: number) {
    if (!(night > 0.02)) {
      if (this.pool.size || this.stationLit.size) this.clear();
      return;
    }
    const surface = surfaceVersions.get(this.layer)?.() ?? 0;
    const stationsChanged = seeStations(this.stationsSeen, stations);
    if (stationsChanged || night !== this.night || surface !== this.surfaceSeen) {
      this.night = night;
      this.surfaceSeen = surface;
      seeTrains(this.trainsSeen, trains);
      this.lightAll(stations, trains, night, surface);
      return;
    }
    if (seeTrains(this.trainsSeen, trains)) this.lightTrains(trains, night);
  }
  /** Every light worked out again; each sprite placed on the surface as it is now. */
  private lightAll(stations: Station[], trains: Train[], night: number, surface: number) {
    this.stationLit = this.stationLights(stations, night);
    this.trainLit = this.trainLights(trains, night);
    const moved = surface !== this.placedOn;
    this.placedOn = surface;
    for (const [key, s] of this.pool)
      if (!this.stationLit.has(key) && !this.trainLit.has(key)) {
        s.destroy();
        this.pool.delete(key);
      }
    for (const lit of [this.stationLit, this.trainLit])
      for (const [key, l] of lit) {
        const s = this.get(key, l.x, l.y);
        if (moved) {
          const p = this.surface(l.x, l.y);
          s.position.set(p.x, p.y);
        }
        s.alpha = (this.trainLit.get(key) ?? l).alpha;
        s.visible = true;
      }
  }
  /** The trains moved on to other tiles: the tiles they left and entered are lit again. */
  private lightTrains(trains: Train[], night: number) {
    const before = this.trainLit;
    this.trainLit = this.trainLights(trains, night);
    for (const key of before.keys())
      if (!this.trainLit.has(key)) {
        const st = this.stationLit.get(key);
        if (st) this.pool.get(key)!.alpha = st.alpha;
        else this.drop(key);
      }
    for (const [key, l] of this.trainLit) {
      const s = this.get(key, l.x, l.y);
      s.alpha = l.alpha;
      s.visible = true;
    }
  }
  /** Each station lights the tiles within two steps of it, the nearer the brighter. */
  private stationLights(stations: Station[], night: number) {
    const lit = new Map<number, Lit>();
    const R = 2;
    for (const st of stations)
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const d = Math.abs(dx) + Math.abs(dy);
          if (d > R) continue;
          const x = st.x + dx;
          const y = st.y + dy;
          if (!this.inBounds(x, y)) continue;
          const key = tileKey(x, y);
          const a = night * (1 - d / (R + 1)) * (0.55 + st.level * 0.08);
          const l = lit.get(key);
          if (l) l.alpha = Math.min(1, l.alpha + a * 0.5);
          else lit.set(key, { x, y, alpha: a });
        }
    return lit;
  }
  /** Each train lights the tile in front of it, over what the stations light there. */
  private trainLights(trains: Train[], night: number) {
    const lit = new Map<number, Lit>();
    for (const t of trains) {
      const at = headTile(t);
      if (!at || !this.inBounds(at.x, at.y)) continue;
      const key = tileKey(at.x, at.y);
      const l = lit.get(key) ?? this.stationLit.get(key);
      const alpha = l ? Math.min(1, l.alpha + 0.4 * night) : 0.75 * night;
      lit.set(key, { x: at.x, y: at.y, alpha });
    }
    return lit;
  }
  private clear() {
    for (const s of this.pool.values()) s.destroy();
    this.pool.clear();
    this.stationLit.clear();
    this.trainLit.clear();
    this.stationsSeen = [];
    this.trainsSeen = [];
    this.night = -1;
  }
}

/** The tile a train's lamp lights, just in front of it; null for a train not on the map yet. */
function headTile(t: Train) {
  const pose = t.poses[0];
  if (!pose) return null;
  const dir = pose.heading + (t.reversed ? Math.PI : 0);
  // a rendered model's nose is where its measured length puts it; other engines reach a fixed way
  const reach = t.locos?.[0]?.def.spriteGear ? (t.vehicleSpecs[0]?.L ?? 1) / 2 + 0.6 : 1.1;
  return {
    x: Math.floor(pose.x + Math.cos(dir) * reach + 0.5),
    y: Math.floor(pose.y + Math.sin(dir) * reach + 0.5),
  };
}

/**
 * Have the stations changed (in number, order, place or level) since `seen` was taken? `seen`
 * holds x, y and level of each and takes the stations' when they have.
 */
function seeStations(seen: number[], stations: Station[]) {
  let same = seen.length === stations.length * 3;
  for (let i = 0; same && i < stations.length; i++) {
    const st = stations[i];
    same = seen[3 * i] === st.x && seen[3 * i + 1] === st.y && seen[3 * i + 2] === st.level;
  }
  if (same) return false;
  seen.length = 0;
  for (const st of stations) seen.push(st.x, st.y, st.level);
  return true;
}

/**
 * Has any train's lamp tile (`headTile`) changed since `seen` was taken, or a train come or gone?
 * `seen` holds x and y of each (-1 for none) and takes the trains' when they have.
 */
function seeTrains(seen: number[], trains: Train[]) {
  let same = seen.length === trains.length * 2;
  for (let i = 0; same && i < trains.length; i++) {
    const at = headTile(trains[i]);
    same = seen[2 * i] === (at ? at.x : -1) && seen[2 * i + 1] === (at ? at.y : -1);
  }
  if (same) return false;
  seen.length = 0;
  for (const t of trains) {
    const at = headTile(t);
    seen.push(at ? at.x : -1, at ? at.y : -1);
  }
  return true;
}

/** Screen-space rain streaks; density follows the weather intensity. */
export class Rain {
  readonly root = new Container();
  private drops: { s: Sprite; vx: number; vy: number }[] = [];
  constructor(private readonly atlas: AtlasRegistry) {}
  update(dt: number, intensity: number, w: number, h: number) {
    const want = Math.round(intensity * 260);
    while (this.drops.length < want) {
      const f = this.atlas.get('fx/rain');
      const s = new Sprite(f.texture);
      s.anchor.set(f.anchorX, f.anchorY);
      s.position.set(Math.random() * (w + 200) - 100, Math.random() * h);
      s.scale.set(1 + Math.random() * 0.6);
      this.root.addChild(s);
      this.drops.push({ s, vx: -140 - Math.random() * 60, vy: 560 + Math.random() * 220 });
    }
    while (this.drops.length > want) this.drops.pop()!.s.destroy();
    this.root.visible = this.drops.length > 0;
    this.root.alpha = Math.min(0.7, intensity * 0.8);
    for (const d of this.drops) {
      d.s.x += d.vx * dt;
      d.s.y += d.vy * dt;
      if (d.s.y > h + 12 || d.s.x < -20) {
        d.s.x = Math.random() * (w + 240) - 60;
        d.s.y = -12 - Math.random() * 40;
      }
    }
  }
}

/** Drifting fog patches in world space around the camera plus a light screen haze. */
export class Fog {
  readonly patches = new Container();
  readonly haze = new Graphics();
  private items: { s: Sprite; ox: number; oy: number; vx: number; vy: number; phase: number }[] =
    [];
  private readonly clip = new Graphics();
  constructor(private readonly atlas: AtlasRegistry) {
    this.patches.addChild(this.clip);
    this.patches.mask = this.clip;
  }
  /** Clip fog to the map plus its void ring so patches never float over the page background. */
  setWorld(w: number, h: number, border: number) {
    const b = border + 0.5;
    const pts = [
      tileToWorld(-b, -b),
      tileToWorld(w - 1 + b, -b),
      tileToWorld(w - 1 + b, h - 1 + b),
      tileToWorld(-b, h - 1 + b),
    ];
    this.clip
      .clear()
      .poly(pts.flatMap((p) => [p.x, p.y]))
      .fill(0xffffff);
  }
  update(
    dt: number,
    intensity: number,
    view: { x: number; y: number; w: number; h: number },
    screenW: number,
    screenH: number,
  ) {
    const want = intensity > 0.02 ? 18 : 0;
    while (this.items.length < want) {
      const f = this.atlas.get(`fx/fog_${this.items.length % 3}`);
      const s = new Sprite(f.texture);
      s.anchor.set(f.anchorX, f.anchorY);
      s.scale.set(3 + Math.random() * 2, 2.5 + Math.random() * 2);
      this.patches.addChild(s);
      this.items.push({
        s,
        ox: Math.random(),
        oy: Math.random(),
        vx: 6 + Math.random() * 8,
        vy: 1 + Math.random() * 2,
        phase: Math.random() * 6.28,
      });
    }
    while (this.items.length > want) this.items.pop()!.s.destroy();
    this.patches.visible = this.items.length > 0;
    this.patches.alpha = Math.min(1, intensity) * 0.6;
    for (const it of this.items) {
      it.ox = (it.ox + (it.vx * dt) / Math.max(1, view.w)) % 1;
      it.oy = (it.oy + (it.vy * dt) / Math.max(1, view.h)) % 1;
      it.phase += dt * 0.4;
      it.s.position.set(view.x + it.ox * view.w, view.y + it.oy * view.h + Math.sin(it.phase) * 8);
    }
    this.haze.clear();
    if (intensity > 0.02)
      this.haze.rect(0, 0, screenW, screenH).fill({ color: 0x9aa4b4, alpha: intensity * 0.16 });
    this.haze.visible = intensity > 0.02;
  }
}

interface Puff {
  s: Sprite;
  vx: number;
  vy: number;
  life: number;
  max: number;
}

/** Smoke puffs from steam locomotives that are moving. */
export class Smoke {
  private puffs: Puff[] = [];
  private acc = new Map<number, number>();
  constructor(
    private readonly atlas: AtlasRegistry,
    private readonly layer: Container,
    /** screen offset of the rail under a tile position (negative is up); level when absent */
    private readonly railDz: (x: number, y: number) => number = () => 0,
  ) {}
  update(trains: Train[], dt: number, enabled: boolean) {
    if (enabled)
      for (const t of trains) {
        if (!t.hasSteam || t.state !== 'moving' || t.speed < 0.05) continue;
        const acc = (this.acc.get(t.id) ?? 0) + dt * (0.6 + t.speed);
        if (acc >= 0.35) {
          this.acc.set(t.id, 0);
          const pose = t.poses[0];
          const dir = pose.heading + (t.reversed ? Math.PI : 0);
          let cx = pose.x + Math.cos(dir) * 0.24;
          let cy = pose.y + Math.sin(dir) * 0.24;
          let up = 30;
          // a rendered model says where its chimney is: on its own part, ahead of that part's centre
          const outlet = t.locos[0]?.def.smoke?.[0];
          const seg = outlet && t.vehiclePoses[0]?.segments.find((g) => g.part === outlet.part);
          if (outlet && seg) {
            const nose = seg.angle + (t.reversed ? Math.PI : 0) + (seg.mirror ? Math.PI : 0);
            cx = seg.x + Math.cos(nose) * outlet.along;
            cy = seg.y + Math.sin(nose) * outlet.along;
            up = outlet.up;
          }
          const w = tileToWorld(cx, cy);
          const f = this.atlas.get(`fx/smoke_${Math.floor(Math.random() * 3)}`);
          const s = new Sprite(f.texture);
          s.anchor.set(0.5);
          s.position.set(w.x, w.y - up + this.railDz(cx, cy));
          s.alpha = 0.8;
          this.layer.addChild(s);
          this.puffs.push({
            s,
            vx: (Math.random() - 0.5) * 6 - 4,
            vy: -14 - Math.random() * 6,
            life: 0,
            max: 1.6 + Math.random() * 0.6,
          });
        } else this.acc.set(t.id, acc);
      }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life += dt;
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      p.vy *= 0.98;
      const k = p.life / p.max;
      p.s.alpha = 0.8 * (1 - k);
      p.s.scale.set(1 + k * 1.6);
      if (k >= 1) {
        p.s.destroy();
        this.puffs.splice(i, 1);
      }
    }
  }
}
