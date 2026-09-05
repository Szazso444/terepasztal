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

/** Multiply-blended full-screen tint that follows the clock. */
export class DayNight {
  readonly overlay = new Graphics();
  constructor() {
    this.overlay.blendMode = 'multiply';
  }
  update(dayFraction: number, w: number, h: number, enabled: boolean) {
    const n = enabled ? nightness(dayFraction) : 0;
    const d = enabled ? duskness(dayFraction) * (1 - n) : 0;
    const day = [1, 1, 1];
    const night = [0.36, 0.42, 0.68];
    const dusk = [1.0, 0.78, 0.6];
    const c = day.map((v, i) => v * (1 - n - d) + night[i] * n + dusk[i] * d);
    const col =
      (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);
    this.overlay.clear();
    this.overlay.rect(0, 0, w, h).fill({ color: col });
    this.overlay.visible = n > 0.001 || d > 0.001;
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
