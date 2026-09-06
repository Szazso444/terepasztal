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
  private trainGlows = new Map<number, Sprite>();
  constructor(
    private readonly atlas: AtlasRegistry,
    private readonly layer: Container,
    private readonly surface: (x: number, y: number) => { x: number; y: number },
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
      s.alpha = night;
      s.visible = night > 0.02;
      s.scale.set(1.1 + st.level * 0.15);
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
      let s = this.trainGlows.get(t.id);
      if (!s) {
        s = this.make('fx/glow_small');
        this.trainGlows.set(t.id, s);
      }
      const dir = pose.heading + (t.reversed ? Math.PI : 0);
      const fx = pose.x + Math.cos(dir) * 0.36;
      const fy = pose.y + Math.sin(dir) * 0.36;
      const w = tileToWorld(fx, fy);
      s.position.set(Math.round(w.x), Math.round(w.y) - 8);
      s.alpha = night * 0.9;
      s.visible = night > 0.02;
    }
    for (const [id, s] of this.trainGlows)
      if (!seenT.has(id)) {
        s.destroy();
        this.trainGlows.delete(id);
      }
  }
}

/** Additive light diamonds on the tiles around lanterns and in front of locomotives. */
export class GroundLights {
  private pool = new Map<string, Sprite>();
  constructor(
    private readonly atlas: AtlasRegistry,
    private readonly layer: Container,
    private readonly surface: (x: number, y: number) => { x: number; y: number },
    private readonly inBounds: (x: number, y: number) => boolean,
  ) {}
  private get(key: string) {
    let s = this.pool.get(key);
    if (!s) {
      const f = this.atlas.get('fx/light_tile');
      s = new Sprite(f.texture);
      s.anchor.set(f.anchorX, f.anchorY);
      s.blendMode = 'add';
      s.cullable = true;
      this.layer.addChild(s);
      this.pool.set(key, s);
    }
    return s;
  }
  update(stations: Station[], trains: Train[], night: number) {
    const seen = new Set<string>();
    if (night > 0.02) {
      const R = 2;
      for (const st of stations)
        for (let dy = -R; dy <= R; dy++)
          for (let dx = -R; dx <= R; dx++) {
            const d = Math.abs(dx) + Math.abs(dy);
            if (d > R) continue;
            const x = st.x + dx;
            const y = st.y + dy;
            if (!this.inBounds(x, y)) continue;
            const key = `${x},${y}`;
            const s = this.get(key);
            const p = this.surface(x, y);
            s.position.set(p.x, p.y);
            const a = night * (1 - d / (R + 1)) * (0.55 + st.level * 0.08);
            s.alpha = seen.has(key) ? Math.min(1, s.alpha + a * 0.5) : a;
            s.visible = true;
            seen.add(key);
          }
      for (const t of trains) {
        const pose = t.poses[0];
        if (!pose) continue;
        const dir = pose.heading + (t.reversed ? Math.PI : 0);
        const x = Math.floor(pose.x + Math.cos(dir) * 1.1 + 0.5);
        const y = Math.floor(pose.y + Math.sin(dir) * 1.1 + 0.5);
        if (!this.inBounds(x, y)) continue;
        const key = `${x},${y}`;
        const s = this.get(key);
        const p = this.surface(x, y);
        s.position.set(p.x, p.y);
        s.alpha = seen.has(key) ? Math.min(1, s.alpha + 0.4 * night) : 0.75 * night;
        s.visible = true;
        seen.add(key);
      }
    }
    for (const [key, s] of this.pool)
      if (!seen.has(key)) {
        s.destroy();
        this.pool.delete(key);
      }
  }
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
    this.root.alpha = Math.min(1, intensity * 1.2);
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
  ) {}
  update(trains: Train[], dt: number, enabled: boolean) {
    if (enabled)
      for (const t of trains) {
        if (t.locoDef.body !== 'steam' || t.state !== 'moving' || t.speed < 0.05) continue;
        const acc = (this.acc.get(t.id) ?? 0) + dt * (0.6 + t.speed);
        if (acc >= 0.35) {
          this.acc.set(t.id, 0);
          const pose = t.poses[0];
          const dir = pose.heading + (t.reversed ? Math.PI : 0);
          const cx = pose.x + Math.cos(dir) * 0.24;
          const cy = pose.y + Math.sin(dir) * 0.24;
          const w = tileToWorld(cx, cy);
          const f = this.atlas.get(`fx/smoke_${Math.floor(Math.random() * 3)}`);
          const s = new Sprite(f.texture);
          s.anchor.set(0.5);
          s.position.set(w.x, w.y - 30);
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
