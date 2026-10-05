import { Container, Sprite } from 'pixi.js';
import { SurfaceAssets, windowSprite } from './surfaceAssets';
import type { AtlasRegistry } from '../engine/atlas';
import { tileToWorld, depthKey } from '../engine/iso';
import type { Train } from '../sim/trains';
import { cargoDef } from '../sim/cargo';
import { PAL, hex, type RGB } from '../art/palette';
import {
  locoFrame,
  wagonFrame,
  loadKind,
  loadFrame,
  bogieFrame,
  bogieStyleOf,
} from '../art/frames';
import { advanceSpin, spinPhase } from './wheelSpin';
import { pitchOnRail, LEVEL_GROUND, type Ground } from './slope';
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
  undercarriage: Container;
  bogies: Sprite[];
  load: Sprite | null;
  spec: VehicleSpec;
}

/**
 * Depth-sorted rigid segments, with independently swivelling bogies beneath the raised decks
 * and cargo overlays above loaded wagons. Bodies use 48 facings and a small residual rotation.
 */
export class TrainRenderer {
  private surfaces = new SurfaceAssets();
  private windowLights = new Map<Sprite, Sprite>();
  /** A body part's or a truck's layer of turning wheels, by the sprite that owns it. */
  private wheelLayers = new Map<Sprite, Sprite>();
  /** How far through its cycle each wheel layer is (0..1), by the same owner. */
  private spin = new Map<Sprite, number>();
  /** The distance each train had run when it was last drawn. */
  private ran = new Map<number, number>();
  private night = 0;
  setWindowNight(night: number) {
    this.night = night;
    for (const light of this.windowLights.values()) light.alpha = night * 0.9;
  }
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
    /** The surface under a tile position; trains climb hills on it. Level when absent. */
    private readonly ground: (x: number, y: number) => Ground = () => LEVEL_GROUND,
  ) {
    layer.on('destroyed', () => this.surfaces.destroy());
  }

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
      list.some(
        (c, i) =>
          c.spec.plan !== specs[i].plan ||
          c.spec.L !== specs[i].L ||
          c.spec.segments.some(
            (s, k) => s.nb !== specs[i].segments[k]?.nb || s.bogie !== specs[i].segments[k]?.bogie,
          ),
      )
    ) {
      for (const c of list) this.destroyCar(c);
      list.length = 0;
      for (let i = 0; i < n; i++) {
        const spec = specs[i];
        const parts = spec.segments.map(() => this.make());
        const undercarriage = new Container({ sortableChildren: true });
        this.layer.addChild(undercarriage);

        const bogies: Sprite[] = [];
        if (spec.drawBogies)
          for (const s of spec.segments)
            for (let b = 0; b < s.nb; b++)
              bogies.push(undercarriage.addChild(new Sprite({ cullable: true })));
        let load: Sprite | null = null;
        if (
          i >= train.locos.length &&
          loadKind(train.wagons[i - train.locos.length].def) !== 'none'
        )
          load = this.make();
        list.push({ parts, undercarriage, bogies, load, spec });
      }
    }
    return list;
  }
  private destroyCar(c: VehicleSprites) {
    for (const s of c.parts) {
      this.windowLights.get(s)?.destroy();
      this.windowLights.delete(s);
      this.wheelLayers.get(s)?.destroy();
      this.wheelLayers.delete(s);
      this.spin.delete(s);
      s.destroy();
    }
    for (const b of c.bogies) {
      this.wheelLayers.delete(b);
      this.spin.delete(b);
    }
    c.undercarriage.destroy({ children: true });
    c.load?.destroy();
  }

  remove(trainId: number) {
    for (const c of this.cars.get(trainId) ?? []) this.destroyCar(c);
    this.cars.delete(trainId);
    this.ran.delete(trainId);
  }

  /**
   * The layer of turning wheels over (or under) the sprite that owns them: the frame for how far
   * its wheels have turned, posed exactly as its owner. `rolled` is the track covered since the
   * last frame, towards the owner's own front. A fast train's wheels are held to a third of a cycle
   * a frame, so they never seem to stand or run backwards.
   */
  private turnWheels(
    owner: Sprite,
    parent: Container,
    stem: string,
    w: { phases: number; cycle: number } | undefined,
    rolled: number,
    angle: number,
    place: (s: Sprite, frameFor: (f: number) => string) => void,
  ): Sprite | null {
    let ws = this.wheelLayers.get(owner) ?? null;
    if (!w || !this.atlas.has(`${stem}_w0_f0`)) {
      if (ws) ws.visible = false;
      return null;
    }
    if (!ws) {
      ws = new Sprite({ cullable: true });
      parent.addChild(ws);
      this.wheelLayers.set(owner, ws);
    }
    const u = advanceSpin(this.spin.get(owner) ?? 0, rolled, w.cycle);
    this.spin.set(owner, u);
    const phase = spinPhase(u, w.phases);
    // a facing in which the owner covers its wheels entirely has no frame
    const f0 = facingOf(angle);
    if (!this.atlas.has(`${stem}_w${phase}_f${DRAWN_FACINGS.has(f0) ? f0 : mirrorFacing(f0)}`)) {
      ws.visible = false;
      return ws;
    }
    place(ws, (f) => `${stem}_w${phase}_f${f}`);
    ws.tint = owner.tint;
    ws.visible = owner.visible;
    return ws;
  }

  /** Place a sprite for a tile-space heading: pick the facing, mirror when needed, rotate the rest. */
  private pose(
    s: Sprite,
    frameFor: (f: number) => string,
    x: number,
    y: number,
    angle: number,
    layer: number,
    ground = this.ground(x, y),
  ) {
    const f = facingOf(angle);
    const drawn = DRAWN_FACINGS.has(f);
    const key = frameFor(drawn ? f : mirrorFacing(f));
    const fr = this.atlas.get(key);
    s.texture = fr.texture;
    s.anchor.set(fr.anchorX, fr.anchorY);
    s.scale.set(drawn ? 1 : -1, 1);
    s.rotation = residualRotation(angle, f) * ROTATION_SHARE;
    const wp = tileToWorld(x, y);
    // Each body part and bogie stands on the rail under it, pitched along its own heading only
    // (the rail is level across the track) and upright: its height does not change with the grade.
    const g = ground,
      cos = Math.cos(angle),
      sin = Math.sin(angle),
      along = g.sgx * cos + g.sgy * sin;
    pitchOnRail(s, Math.round(wp.x), Math.round(wp.y), g.dz, along, cos, sin);
    s.zIndex = depthKey(x, y, layer);
    s.visible = !(this.hideAt && this.hideAt(Math.floor(x + 0.5), Math.floor(y + 0.5)));
    return key;
  }

  /**
   * A rigid body rests on its end bogies: its height and pitch are the chord between the rail
   * under the first and the last, so on a vertical curve it follows the rail it rides instead of
   * the slope under its own centre.
   */
  private bodyGround(
    seg: VehiclePose['segments'][number],
    prev: VehiclePose['segments'][number] | undefined,
    alpha: number,
    x: number,
    y: number,
  ): Ground {
    const n = seg.bogies.length;
    if (n < 2) return this.ground(x, y);
    const at = (k: number) => {
      const b = seg.bogies[k],
        p = prev?.bogies[k];
      return [
        p ? lerp(p.drawX, b.drawX, alpha) : b.drawX,
        p ? lerp(p.drawY, b.drawY, alpha) : b.drawY,
      ];
    };
    const [ax, ay] = at(0),
      [bx, by] = at(n - 1),
      ga = this.ground(ax, ay),
      gb = this.ground(bx, by),
      dx = bx - ax,
      dy = by - ay,
      len2 = dx * dx + dy * dy;
    if (len2 < 1e-6) return this.ground(x, y);
    const t = ((x - ax) * dx + (y - ay) * dy) / len2,
      rise = (gb.dz - ga.dz) / len2;
    // Rise per tile along each axis, so the body pitches along the chord.
    return { dz: lerp(ga.dz, gb.dz, t), sgx: rise * dx, sgy: rise * dy };
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
      // track covered since the last frame, nose first (a consist running tail first rolls back)
      const before = this.ran.get(t.id) ?? t.distance;
      this.ran.set(t.id, t.distance);
      const moved = t.distance - before;
      const rolled = Math.abs(moved) < 2 ? (t.reversed ? -moved : moved) : 0;
      for (let i = 0; i < list.length; i++) {
        const cur: VehiclePose | undefined = t.vehiclePoses[i];
        if (!cur) continue;
        const prev = t.prevVehiclePoses[i];
        const c = list[i];
        const isLoco = i < t.locos.length;
        let bi = 0;
        const segments = cur.segments;
        const previous = prev?.segments;
        c.undercarriage.zIndex = Infinity;
        segments.forEach((seg, si) => {
          const ps = previous?.[si];
          const x = ps ? ps.x + (seg.x - ps.x) * alpha : seg.x;
          const y = ps ? ps.y + (seg.y - ps.y) * alpha : seg.y;
          const angle = ps ? lerpAngle(ps.angle, seg.angle, alpha) : seg.angle;
          const shown = angle + flip + (seg.mirror ? Math.PI : 0);
          const s = c.parts[si];
          const frameFor = isLoco
            ? (f: number) => locoFrame(this.atlas, t.locos[i].def, f, seg.part)
            : (f: number) => wagonFrame(this.atlas, t.wagons[i - t.locos.length].def, f);
          const styles = (isLoco ? t.locos[i].def : t.wagons[i - t.locos.length].def).bogieStyle;
          const key = this.pose(
            s,
            frameFor,
            x,
            y,
            shown,
            15,
            this.bodyGround(seg, ps, alpha, x, y),
          );
          const fr = this.atlas.get(key);
          // A rendered model brings its window panes as a frame of its own (`…_lit_f<n>`).
          // Procedural vehicle windows carry explicit amber palette pixels. Any other
          // illustrated replacement stays dark: never light a boiler.
          const litKey = key.replace(/_f(\d+)$/, '_lit_f$1');
          const lit = litKey !== key && this.atlas.has(litKey) ? this.atlas.get(litKey) : null;
          const own = isLoco && key.startsWith(`rolling/loco_${t.locos[i].def.id}_`);
          if (lit || (!own && fr.texture.frame.width / fr.w === 1)) {
            let light = this.windowLights.get(s);
            if (!light) {
              light = windowSprite();
              this.layer.addChild(light);
              this.windowLights.set(s, light);
            }
            light.texture = lit ? lit.texture : this.surfaces.window(key, fr, true);
            light.anchor.set((lit ?? fr).anchorX, (lit ?? fr).anchorY);
            light.alpha = this.night * 0.9;
            light.position.copyFrom(s.position);
            light.scale.copyFrom(s.scale);
            light.rotation = s.rotation;
            light.skew.copyFrom(s.skew);
            light.zIndex = s.zIndex + 0.01;
            light.visible = s.visible;
          } else {
            const light = this.windowLights.get(s);
            if (light) light.visible = false;
          }
          s.tint = tint;
          if (isLoco) {
            // wheels fixed in this part's frame (coupled wheels and their rods, a rigid tender's)
            const def = t.locos[i].def;
            const ground = this.bodyGround(seg, ps, alpha, x, y);
            const ws = this.turnWheels(
              s,
              this.layer,
              `rolling/loco_${def.id}_${seg.part}`,
              def.wheels?.[seg.part],
              seg.mirror ? -rolled : rolled,
              shown,
              (w, frame) => this.pose(w, frame, x, y, shown, 15, ground),
            );
            if (ws) ws.zIndex = s.zIndex + 0.005;
          }
          c.undercarriage.zIndex = Math.min(c.undercarriage.zIndex, s.zIndex - 1);
          if (c.spec.drawBogies)
            seg.bogies.forEach((b, k) => {
              const pb = ps?.bogies[k];
              // Each wheel group follows its own rail point and tangent; the raised body
              // occludes it naturally, leaving the wheels and sideways slide visible.
              const bx = pb ? pb.drawX + (b.drawX - pb.drawX) * alpha : b.drawX;
              const by = pb ? pb.drawY + (b.drawY - pb.drawY) * alpha : b.drawY;
              const ba = pb ? lerpAngle(pb.angle, b.angle, alpha) : b.angle;
              const bs = c.bogies[bi++];
              if (!bs) return;
              if (b.hidden) {
                bs.visible = false;
                return;
              }
              // bogies are posed in track order; a reversed vehicle or a mirrored segment meets
              // them back to front, and its styled trucks (cylinders ahead) must face its own front
              const back = t.reversed !== seg.mirror;
              const nb = seg.bogies.length;
              const style = bogieStyleOf(styles, seg.part, back ? nb - 1 - k : k);
              if (style === 'none') {
                bs.visible = false;
                return;
              }
              const heading = ba + (back ? Math.PI : 0);
              const narrow =
                (isLoco ? t.locos[i].def : t.wagons[i - t.locos.length].def).gauge === 'narrow';
              // a rendered engine brings each of its trucks as a sprite set of its own
              const own =
                isLoco && b.truck !== undefined && b.truck >= 0
                  ? `rolling/loco_${t.locos[i].def.id}_${seg.part}-t${b.truck}`
                  : null;
              const mine = own !== null && this.atlas.has(`${own}_f0`);
              this.pose(
                bs,
                mine
                  ? (f) => `${own}_f${f}`
                  : (f) => bogieFrame(this.atlas, style, b.kind, f, narrow),
                bx,
                by,
                heading,
                14,
              );
              bs.visible &&= s.visible;
              // always just under its own body: the depth key is by position, and a bogie
              // ahead of the body centre (towards the camera) would otherwise paint over it
              bs.zIndex = s.zIndex - 1;
              bs.tint = tint;
              if (mine) {
                const ws = this.turnWheels(
                  bs,
                  c.undercarriage,
                  own,
                  t.locos[i].def.wheels?.[`${seg.part}-t${b.truck}`],
                  seg.mirror ? -rolled : rolled,
                  heading,
                  (w, frame) => this.pose(w, frame, bx, by, heading, 14),
                );
                if (ws) ws.zIndex = bs.zIndex + 0.5;
              } else {
                const ws = this.wheelLayers.get(bs);
                if (ws) ws.visible = false;
              }
            });
          if (c.load && si === 0) {
            const w = t.wagons[i - t.locos.length];
            if (w.cargo && w.amount > 0.5) {
              const kind = loadKind(w.def, w.cargo);
              const thin = w.def.gauge === 'narrow';
              this.pose(c.load, (f) => loadFrame(kind, f, thin), x, y, shown, 16);
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

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
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
