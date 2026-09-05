import { Container, Sprite } from 'pixi.js';
import type { AtlasRegistry } from '../engine/atlas';
import { tileToWorld, depthKey } from '../engine/iso';
import type { Train } from '../sim/trains';
import { cargoDef } from '../sim/cargo';
import { PAL, hex, type RGB } from '../art/palette';

interface CarSprites {
  body: Sprite;
  load: Sprite | null;
}

/** Draws every train's cars as depth-sorted sprites in the world object layer. */
export class TrainRenderer {
  private cars = new Map<number, CarSprites[]>();
  constructor(
    private readonly atlas: AtlasRegistry,
    private readonly layer: Container,
  ) {}

  private frameFor(train: Train, car: number, facing: number) {
    if (car === 0) return `rolling/loco_${train.locoDef.body}_${train.locoDef.paint}_f${facing}`;
    const w = train.wagons[car - 1];
    return `rolling/wagon_${w.def.body}_${w.def.paint}_f${facing}`;
  }

  private ensure(train: Train): CarSprites[] {
    let list = this.cars.get(train.id);
    const n = 1 + train.wagons.length;
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
      if (idx > 0 && train.wagons[idx - 1].def.load !== 'none') {
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
  update(trains: Iterable<Train>, alpha: number) {
    const seen = new Set<number>();
    for (const t of trains) {
      seen.add(t.id);
      const list = this.ensure(t);
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
        c.body.visible = true;
        if (c.load) {
          const w = t.wagons[i - 1];
          if (w.cargo && w.amount > 0.5) {
            const lf = this.atlas.get(`rolling/load_${w.def.load}_f${facing}`);
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
