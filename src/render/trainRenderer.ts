import { Container, Sprite } from 'pixi.js';
import type { AtlasRegistry } from '../engine/atlas';
import { tileToWorld, depthKey } from '../engine/iso';
import type { Train } from '../sim/trains';
import { cargoDef } from '../sim/cargo';
import { PAL, hex, type RGB } from '../art/palette';
import { locoFrame, wagonFrame, loadKind } from '../art/frames';
import {
  facingOf,
  DRAWN_FACINGS,
  mirrorFacing,
  residualRotation,
  ROTATION_SHARE,
  type VehicleSpec,
  type VehiclePose,
} from '../sim/body';

interface VehicleSprites {
  parts: Sprite[];
  bogies: Sprite[];
  load: Sprite | null;
  spec: VehicleSpec;
}

/**
 * Draws every train as depth-sorted sprites: one body sprite per rigid segment, bogie sprites
 * under medium and large bodies, a cargo overlay on loaded wagons. Bodies use 24 facings; the
 * remainder of the true angle is applied as a small runtime rotation so motion stays continuous.
 */
export class TrainRenderer {
  private cars = new Map<number, VehicleSprites[]>();
  /** train under the cursor (bright outline pulse) and the selected one (steady tint) */
  hoverId: number | null = null;
  selectedId: number | null = null;
  /** vehicles standing inside an engine shed are not drawn */
  hideAt: ((x: number, y: number) => boolean) | null = null;
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

  private make(): Sprite {
    const s = new Sprite();
    s.cullable = true;
    this.layer.addChild(s);
    return s;
  }

  private ensure(train: Train): VehicleSprites[] {
    let list = this.cars.get(train.id);
    const specs = train.vehicleSpecs;
    const n = specs.length;
    if (!list) {
      list = [];
      this.cars.set(train.id, list);
    }
    // rebuild when the consist changed shape
    if (
      list.length !== n ||
      list.some((c, i) => c.spec.plan !== specs[i].plan || c.spec.L !== specs[i].L)
    ) {
      for (const c of list) this.destroyCar(c);
      list.length = 0;
      for (let i = 0; i < n; i++) {
        const spec = specs[i];
        const parts = spec.segments.map(() => this.make());
        const bogies: Sprite[] = [];
        if (spec.drawBogies)
          for (const s of spec.segments) for (let b = 0; b < s.nb; b++) bogies.push(this.make());
        let load: Sprite | null = null;
        if (
          i >= train.locos.length &&
          loadKind(train.wagons[i - train.locos.length].def) !== 'none'
        )
          load = this.make();
        list.push({ parts, bogies, load, spec });
      }
    }
    return list;
  }
  private destroyCar(c: VehicleSprites) {
    for (const s of c.parts) s.destroy();
    for (const s of c.bogies) s.destroy();
    c.load?.destroy();
  }

  remove(trainId: number) {
    for (const c of this.cars.get(trainId) ?? []) this.destroyCar(c);
    this.cars.delete(trainId);
  }

  /** Place a sprite for a tile-space heading: pick the facing, mirror when needed, rotate the rest. */
  private pose(
    s: Sprite,
    frameFor: (f: number) => string,
    x: number,
    y: number,
    angle: number,
    layer: number,
  ) {
    const f = facingOf(angle);
    const drawn = DRAWN_FACINGS.has(f);
    const fr = this.atlas.get(frameFor(drawn ? f : mirrorFacing(f)));
    s.texture = fr.texture;
    s.anchor.set(fr.anchorX, fr.anchorY);
    s.scale.set(drawn ? 1 : -1, 1);
    s.rotation = residualRotation(angle, f) * ROTATION_SHARE;
    const wp = tileToWorld(x, y);
    s.position.set(Math.round(wp.x), Math.round(wp.y));
    s.zIndex = depthKey(x, y, layer);
    s.visible = !(this.hideAt && this.hideAt(Math.floor(x + 0.5), Math.floor(y + 0.5)));
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
      const flip = t.reversed ? Math.PI : 0;
      for (let i = 0; i < list.length; i++) {
        const cur: VehiclePose | undefined = t.vehiclePoses[i];
        if (!cur) continue;
        const prev = t.prevVehiclePoses[i];
        const c = list[i];
        const isLoco = i < t.locos.length;
        let bi = 0;
        cur.segments.forEach((seg, si) => {
          const ps = prev?.segments[si];
          const x = ps ? ps.x + (seg.x - ps.x) * alpha : seg.x;
          const y = ps ? ps.y + (seg.y - ps.y) * alpha : seg.y;
          const angle = ps ? lerpAngle(ps.angle, seg.angle, alpha) : seg.angle;
          const shown = angle + flip + (seg.mirror ? Math.PI : 0);
          const s = c.parts[si];
          const frameFor = isLoco
            ? (f: number) => locoFrame(this.atlas, t.locos[i].def, f, seg.part)
            : (f: number) => wagonFrame(this.atlas, t.wagons[i - t.locos.length].def, f);
          this.pose(s, frameFor, x, y, shown, 15);
          s.tint = tint;
          if (c.spec.drawBogies)
            seg.bogies.forEach((b, k) => {
              const pb = ps?.bogies[k];
              const bx = pb ? pb.x + (b.x - pb.x) * alpha : b.x;
              const by = pb ? pb.y + (b.y - pb.y) * alpha : b.y;
              const ba = pb ? lerpAngle(pb.angle, b.angle, alpha) : b.angle;
              const bs = c.bogies[bi++];
              if (!bs) return;
              const name = b.kind === 'engine_unit' ? 'engine_unit' : 'bogie';
              this.pose(bs, (f) => `rolling/${name}_f${f}`, bx, by, ba, 14);
              bs.tint = tint;
            });
          if (c.load && si === 0) {
            const w = t.wagons[i - t.locos.length];
            if (w.cargo && w.amount > 0.5) {
              const kind = loadKind(w.def, w.cargo);
              this.pose(c.load, (f) => `rolling/load_${kind}_f${f}`, x, y, shown, 16);
              const col =
                (PAL as unknown as Record<string, RGB>)[cargoDef(w.cargo).color] ?? PAL.white;
              c.load.tint = hex(col);
            } else c.load.visible = false;
          }
        });
      }
    }
    for (const id of [...this.cars.keys()]) if (!seen.has(id)) this.remove(id);
  }
}

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function mix(a: number, b: number, t: number) {
  const ch = (v: number, sh: number) => (v >> sh) & 0xff;
  const r = Math.round(ch(a, 16) + (ch(b, 16) - ch(a, 16)) * t);
  const g = Math.round(ch(a, 8) + (ch(b, 8) - ch(a, 8)) * t);
  const bl = Math.round(ch(a, 0) + (ch(b, 0) - ch(a, 0)) * t);
  return (r << 16) | (g << 8) | bl;
}
