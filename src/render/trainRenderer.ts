import { Container, Sprite } from 'pixi.js';
import type { AtlasRegistry } from '../engine/atlas';
import { tileToWorld, depthKey } from '../engine/iso';
import type { Train } from '../sim/trains';
import { cargoDef } from '../sim/cargo';
import { PAL, hex, type RGB } from '../art/palette';
import { locoFrame, wagonFrame, loadKind } from '../art/frames';

interface CarSprites {
  body: Sprite;
  load: Sprite | null;
}

/** Draws every train's cars as depth-sorted sprites in the world object layer. */
export class TrainRenderer {
  private cars = new Map<number, CarSprites[]>();
  /** train under the cursor (bright outline pulse) and the selected one (steady tint) */
  hoverId: number | null = null;
  selectedId: number | null = null;
  private hoverSince = 0;
  private clock = 0;
  setHover(id: number | null) {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.hoverSince = this.clock;
  }
  constructor(
    private readonly atlas: AtlasRegistry,
    private readonly layer: Container,
  ) {}

  private frameFor(train: Train, car: number, facing: number) {
    const nl = train.locos.length;
    if (car < nl) return locoFrame(this.atlas, train.locos[car].def, facing);
    const w = train.wagons[car - nl];
    return wagonFrame(this.atlas, w.def, facing);
  }

  private ensure(train: Train): CarSprites[] {
    let list = this.cars.get(train.id);
    const n = train.locos.length + train.wagons.length;
    if (!list) {
      list = [];
      this.cars.set(train.id, list);
    }
    while (list.length < n) {
      const body = new Sprite();
      body.cullable = true;
      this.layer.addChild(body);
      const idx = list.length;
      let load: Sprite | null = null;
      if (
        idx >= train.locos.length &&
        loadKind(train.wagons[idx - train.locos.length].def) !== 'none'
      ) {
        load = new Sprite();
        load.cullable = true;
        this.layer.addChild(load);
      }
      list.push({ body, load });
    }
    while (list.length > n) {
      const c = list.pop()!;
      c.body.destroy();
      c.load?.destroy();
    }
    return list;
  }

  remove(trainId: number) {
    for (const c of this.cars.get(trainId) ?? []) {
      c.body.destroy();
      c.load?.destroy();
    }
    this.cars.delete(trainId);
  }

  /** Update sprites; alpha interpolates between the last two sim poses. */
  update(trains: Iterable<Train>, alpha: number, dt = 0) {
    this.clock += dt;
    const seen = new Set<number>();
    for (const t of trains) {
      seen.add(t.id);
      const list = this.ensure(t);
      // a hovered train flashes bright for a moment; the selected one stays lit
      let tint = 0xffffff;
      if (t.id === this.hoverId) {
        const age = this.clock - this.hoverSince;
        const pulse = age < 0.9 ? 0.5 + 0.5 * Math.abs(Math.sin(age * 9)) : 0.25;
        tint = mix(0xffffff, 0x9be8ff, pulse);
      } else if (t.id === this.selectedId) tint = 0xc8f0ff;
      for (let i = 0; i < list.length; i++) {
        const cur = t.poses[i];
        const prev = t.prevPoses[i] ?? cur;
        if (!cur) continue;
        const x = prev.x + (cur.x - prev.x) * alpha;
        const y = prev.y + (cur.y - prev.y) * alpha;
        const facing = t.facingOf(i, cur);
        const frame = this.frameFor(t, i, facing);
        const f = this.atlas.get(frame);
        const c = list[i];
        c.body.texture = f.texture;
        c.body.anchor.set(f.anchorX, f.anchorY);
        const wp = tileToWorld(x, y);
        c.body.position.set(Math.round(wp.x), Math.round(wp.y));
        c.body.zIndex = depthKey(x, y, 15);
        c.body.tint = tint;
        c.body.visible = true;
        if (c.load) {
          const w = t.wagons[i - t.locos.length];
          if (w.cargo && w.amount > 0.5) {
            const lf = this.atlas.get(`rolling/load_${loadKind(w.def, w.cargo)}_f${facing}`);
            c.load.texture = lf.texture;
            c.load.anchor.set(lf.anchorX, lf.anchorY);
            c.load.position.set(Math.round(wp.x), Math.round(wp.y));
            c.load.zIndex = depthKey(x, y, 16);
            const col =
              (PAL as unknown as Record<string, RGB>)[cargoDef(w.cargo).color] ?? PAL.white;
            c.load.tint = hex(col);
            c.load.visible = true;
          } else c.load.visible = false;
        }
      }
    }
    for (const id of [...this.cars.keys()]) if (!seen.has(id)) this.remove(id);
  }
}

function mix(a: number, b: number, t: number) {
  const ch = (v: number, sh: number) => (v >> sh) & 0xff;
  const r = Math.round(ch(a, 16) + (ch(b, 16) - ch(a, 16)) * t);
  const g = Math.round(ch(a, 8) + (ch(b, 8) - ch(a, 8)) * t);
  const bl = Math.round(ch(a, 0) + (ch(b, 0) - ch(a, 0)) * t);
  return (r << 16) | (g << 8) | bl;
}
