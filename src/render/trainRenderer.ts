import { Container, Graphics, Sprite } from 'pixi.js';
import { SurfaceAssets, windowSprite } from './surfaceAssets';
import { setOwnTint } from './atmosphere';
import { SwingSprite } from './swingSprite';
import type { AtlasRegistry, FrameInfo } from '../engine/atlas';
import { tileToWorld, depthKey } from '../engine/iso';
import type { Train } from '../sim/trains';
import { cargoDef } from '../sim/cargo';
import type { WheelFit } from '../data/content';
import { PAL, hex, type RGB } from '../art/palette';
import {
  locoFrame,
  wagonFrame,
  loadKind,
  loadFrame,
  bogieFrame,
  bogieStyleOf,
} from '../art/frames';
import { FrameKeys, type KeysByFacing } from './frameKeys';
import { pitchOnRail, tiltOnRail, LEVEL_GROUND, type Ground } from './slope';
import { PhaseCounter, WheelRolls, phaseIndex, phaseKey } from './runningGear';
import { advanceSpin, spinPhase } from './wheelSpin';
import { spriteFacing, snapTrainPixel } from './spriteFacing';
import {
  facingOf,
  DRAWN_FACINGS,
  mirrorFacing,
  residualRotation,
  ROTATION_SHARE,
  UP_TILE_PX,
  type VehicleSpec,
  type VehiclePose,
} from '../sim/body';

interface Sprites<S> {
  parts: S[];
  undercarriage: Container;
  bogies: S[];
  load: S | null;
  spec: VehicleSpec;
}
/** A vehicle on the generated or painted sprites: 48 facings, wheel phases by `_w<k>` frames. */
interface PlainVehicle extends Sprites<Sprite> {
  stem: null;
}
/** A vehicle with a rendered model: it draws its own sprite sets, `stem` being what they start with. */
interface ModelVehicle extends Sprites<SwingSprite> {
  stem: string;
}
type VehicleSprites = PlainVehicle | ModelVehicle;

/** Where a drawn body part stood this frame: its centre on the rail, axis, length and depth. */
interface DrawnEnd {
  x: number;
  y: number;
  angle: number;
  L: number;
  z: number;
  visible: boolean;
}

/** How a rendered model's sprite was last placed: what its window light is placed like. */
interface Placed {
  key: string;
  frame: FrameInfo;
  flip: boolean;
}

/** One of a train's vehicles by its place in the consist. */
function vehicleDef(t: Train, i: number) {
  return i < t.locos.length ? t.locos[i].def : t.wagons[i - t.locos.length].def;
}
/**
 * The stem of a vehicle's rendered model (`rolling/loco_<id>`, `rolling/wagon_<id>`), or null for
 * a vehicle without one (no row in gear.json and locoFit.json): every model branch hangs on it.
 */
function modelStem(t: Train, i: number): string | null {
  const def = vehicleDef(t, i);
  if (!def.spriteGear) return null;
  return `rolling/${i < t.locos.length ? 'loco' : 'wagon'}_${def.id}`;
}

/**
 * Depth-sorted rigid segments, with independently swivelling bogies beneath the raised decks
 * and cargo overlays above loaded wagons. Bodies use 48 facings and a small residual rotation; a
 * rendered model instead shows its nearest rendered heading intact, with trucks and turning wheels
 * of its own, and tilts as a whole on a grade.
 */
export class TrainRenderer {
  private surfaces = new SurfaceAssets();
  private windowLights = new Map<Container, Sprite>();
  /** A rendered model's window lights: images posed as its own are, by the part they light. */
  private modelLights = new Map<Container, SwingSprite>();
  /** A body part's or a truck's layer of turning wheels, by the sprite that owns it. */
  private wheelLayers = new Map<Container, SwingSprite>();
  /** How far through its cycle each wheel layer is (0..1), by the same owner. */
  private spin = new Map<Container, number>();
  /** The distance each train had run when it was last drawn. */
  private ran = new Map<number, number>();
  private night = 0;
  setWindowNight(night: number) {
    this.night = night;
    for (const light of this.windowLights.values()) light.alpha = night * 0.9;
    for (const light of this.modelLights.values()) light.alpha = night * 0.9;
  }
  private cars = new Map<number, VehicleSprites[]>();
  /** Each train's couplings: one drawn link per joint between two rendered models, in joint order. */
  private links = new Map<number, Graphics[]>();
  /** train under the cursor (bright outline pulse) and the selected one (steady tint) */
  hoverId: number | null = null;
  selectedId: number | null = null;
  /** vehicles standing inside an engine shed are not drawn */
  hideAt: ((x: number, y: number) => boolean) | null = null;
  private readonly frameKeys: FrameKeys;
  private hoverSince = 0;
  private clock = 0;
  /** wheel-phase frames per still frame, and each train's wheel roll (`runningGear.ts`) */
  private readonly phases: PhaseCounter;
  private readonly rolls = new WheelRolls();
  /** Whether a model's pages were ever asked for: only then is there anything to give back. */
  private pagesAsked = false;
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
    this.frameKeys = new FrameKeys(atlas);
    this.phases = new PhaseCounter(atlas);
    layer.on('destroyed', () => this.surfaces.destroy());
  }

  /** The sprites of vehicle `i`, each made by `blank`: the parts, then the bogies, then the load. */
  private build<S extends Container>(train: Train, i: number, blank: () => S): Sprites<S> {
    const spec = train.vehicleSpecs[i];
    const make = () => this.layer.addChild(blank());
    const parts = spec.segments.map(make);
    const undercarriage = new Container({ sortableChildren: true });
    this.layer.addChild(undercarriage);

    const bogies: S[] = [];
    if (spec.drawBogies)
      for (const s of spec.segments)
        for (let b = 0; b < s.nb; b++) bogies.push(undercarriage.addChild(blank()));
    let load: S | null = null;
    if (i >= train.locos.length && loadKind(train.wagons[i - train.locos.length].def) !== 'none')
      load = make();
    return { parts, undercarriage, bogies, load, spec };
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
          c.stem !== modelStem(train, i) ||
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
        const stem = modelStem(train, i);
        if (stem) list.push({ ...this.build(train, i, () => new SwingSprite()), stem });
        else
          list.push({
            ...this.build(train, i, () => new Sprite({ cullable: true })),
            stem: null,
          });
      }
    }
    return list;
  }
  private destroyCar(c: VehicleSprites) {
    for (const s of c.parts) {
      this.windowLights.get(s)?.destroy();
      this.windowLights.delete(s);
      this.modelLights.get(s)?.destroy();
      this.modelLights.delete(s);
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
    this.rolls.drop(trainId);
    for (const g of this.links.get(trainId) ?? []) g.destroy();
    this.links.delete(trainId);
    this.ran.delete(trainId);
  }

  /**
   * Place a sprite for a tile-space heading: pick the facing, mirror when needed, rotate the rest.
   * With a wheel `roll` (tiles, signed by the part's own nose) it shows the still frame's wheel
   * phase for it, when the atlas has phases. Returns the still frame's key either way.
   */
  private pose(
    s: Sprite,
    keys: KeysByFacing,
    x: number,
    y: number,
    angle: number,
    layer: number,
    roll?: number,
    ground = this.ground(x, y),
  ) {
    const f = facingOf(angle);
    const drawn = DRAWN_FACINGS.has(f);
    const key = keys[drawn ? f : mirrorFacing(f)];
    const fr = this.atlas.get(
      roll === undefined ? key : phaseKey(key, phaseIndex(roll, this.phases.count(key))),
    );
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
   * Place a rendered model's sprite at the nearest rendered heading. Prefer a real rear/other-side
   * frame; a set with 48 headings uses a mirrored twin when that heading is absent. It is placed in
   * sixths of a pixel: each sprite of a vehicle is placed on its own (a body, its trucks, a tender),
   * so on whole pixels they stepped at different moments and jolted against each other.
   */
  private poseModel(
    s: SwingSprite,
    frameFor: (f: number) => string,
    x: number,
    y: number,
    angle: number,
    layer: number,
    ground = this.ground(x, y),
    facings = 48,
  ): Placed {
    const f = spriteFacing(angle, facings);
    const drawn = (facings === 48 && DRAWN_FACINGS.has(f)) || this.atlas.has(frameFor(f));
    const twin = (((facings / 4 - f) % facings) + facings) % facings;
    const key = frameFor(drawn ? f : twin);
    const fr = this.atlas.get(key);
    s.show(fr, !drawn);
    const wp = tileToWorld(x, y);
    // Each body part and truck stands on the rail under it, tilted along its own heading only (the
    // rail is level across the track).
    const g = ground,
      cos = Math.cos(angle),
      sin = Math.sin(angle),
      along = g.sgx * cos + g.sgy * sin;
    tiltOnRail(s, snapTrainPixel(wp.x), snapTrainPixel(wp.y), g.dz, along, cos, sin);
    s.zIndex = depthKey(x, y, layer);
    s.visible = !(this.hideAt && this.hideAt(Math.floor(x + 0.5), Math.floor(y + 0.5)));
    return { key, frame: fr, flip: !drawn };
  }

  /**
   * The layer of turning wheels over (or under) the sprite that owns them: the frame for how far
   * its wheels have turned, posed exactly as its owner. `rolled` is the track covered since the
   * last frame, towards the owner's own front. A fast train's wheels are held to a third of a cycle
   * a frame, so they never seem to stand or run backwards. A wheel layer of its own (`w.layer`, a
   * body's coupled wheels and rods) holds only what shows of them over the body: at a heading where
   * the body hides them all it has no frame and is not drawn.
   */
  private turnWheels(
    owner: SwingSprite,
    parent: Container,
    stem: string,
    w: WheelFit | undefined,
    rolled: number,
    angle: number,
    facings: number,
    tint: number,
    place: (s: SwingSprite, frameFor: (f: number) => string) => void,
  ): SwingSprite | null {
    let ws = this.wheelLayers.get(owner) ?? null;
    if (!w || w.integrated || (!w.layer && !this.atlas.has(`${stem}_w0_f0`))) {
      if (ws) ws.visible = false;
      return null;
    }
    if (!ws) {
      ws = new SwingSprite();
      parent.addChild(ws);
      this.wheelLayers.set(owner, ws);
    }
    const u = advanceSpin(this.spin.get(owner) ?? 0, rolled, w.cycle);
    this.spin.set(owner, u);
    const phase = spinPhase(u, w.phases);
    // a facing in which the owner covers its wheels entirely has no frame
    let f0: number;
    if (facings === 48) {
      f0 = facingOf(angle);
      if (!DRAWN_FACINGS.has(f0)) f0 = mirrorFacing(f0);
    } else f0 = spriteFacing(angle, facings);
    if (!this.atlas.has(`${stem}_w${phase}_f${f0}`)) {
      ws.visible = false;
      return ws;
    }
    place(ws, (f) => `${stem}_w${phase}_f${f}`);
    setOwnTint(ws, tint);
    ws.visible = owner.visible;
    return ws;
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
    const first = seg.bogies[0],
      last = seg.bogies[n - 1],
      pf = prev?.bogies[0],
      pl = prev?.bogies[n - 1],
      ax = pf ? lerp(pf.drawX, first.drawX, alpha) : first.drawX,
      ay = pf ? lerp(pf.drawY, first.drawY, alpha) : first.drawY,
      bx = pl ? lerp(pl.drawX, last.drawX, alpha) : last.drawX,
      by = pl ? lerp(pl.drawY, last.drawY, alpha) : last.drawY,
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

  /**
   * Whether a train's rendered models can be drawn. Their pages load on demand: this asks for
   * them, and a train whose models are not all in yet is not drawn (its sprites, if any, go) until
   * they are, a frame or a few later. A model train not on the map yet asks for nothing.
   */
  private modelsIn(t: Train) {
    const placed = t.vehiclePoses.some(Boolean);
    let ready = true;
    for (let i = 0; i < t.locos.length + t.wagons.length; i++) {
      const stem = modelStem(t, i);
      if (!stem) continue;
      this.pagesAsked = true;
      ready = placed && this.atlas.want(stem) && ready;
    }
    return ready;
  }

  /** Update sprites; alpha interpolates between the last two sim poses. */
  update(trains: Iterable<Train>, alpha: number, dt = 0) {
    this.clock += dt;
    const seen = new Set<number>();
    for (const t of trains) {
      if (!this.modelsIn(t)) continue;
      seen.add(t.id);
      const list = this.ensure(t);
      // a hovered train flashes bright for a moment; the selected one stays lit
      let tint = 0xffffff;
      if (t.id === this.hoverId) {
        const age = this.clock - this.hoverSince;
        const pulse = age < 0.9 ? 0.5 + 0.5 * Math.abs(Math.sin(age * 9)) : 0.25;
        tint = mix(0xffffff, 0x9be8ff, pulse);
      } else if (t.id === this.selectedId) tint = 0xc8f0ff;
      // the wheels turn with the distance run, backwards while the train runs tail first
      const roll = this.rolls.advance(t.id, t.distance, t.reversed);
      // track covered since the last frame, nose first (a consist running tail first rolls back)
      const before = this.ran.get(t.id) ?? t.distance;
      this.ran.set(t.id, t.distance);
      const moved = t.distance - before;
      const rolled = Math.abs(moved) < 2 ? (t.reversed ? -moved : moved) : 0;
      /** each rendered model's drawn parts this frame, for the couplings between them */
      const drawn = list.map((c, i): DrawnEnd[] => {
        if (c.stem !== null) return this.drawModel(t, i, c, alpha, rolled, tint);
        this.drawPlain(t, i, c, alpha, roll, tint);
        return [];
      });
      this.couple(t, drawn, tint);
    }
    for (const id of [...this.cars.keys()]) if (!seen.has(id)) this.remove(id);
    // vehicles no longer shown give their pages back after a while
    if (this.pagesAsked) this.atlas.sweep();
  }

  /** Draw vehicle `i` of a train, one without a rendered model. */
  private drawPlain(
    t: Train,
    i: number,
    c: PlainVehicle,
    alpha: number,
    roll: number | undefined,
    tint: number,
  ) {
    const cur: VehiclePose | undefined = t.vehiclePoses[i];
    if (!cur) return;
    const prev = t.prevVehiclePoses[i];
    const flip = t.reversed ? Math.PI : 0;
    const isLoco = i < t.locos.length;
    let bi = 0;
    const segments = cur.segments;
    const previous = prev?.segments;
    c.undercarriage.zIndex = Infinity;
    for (let si = 0; si < segments.length; si++) {
      const seg = segments[si];
      const ps = previous?.[si];
      const x = ps ? ps.x + (seg.x - ps.x) * alpha : seg.x;
      const y = ps ? ps.y + (seg.y - ps.y) * alpha : seg.y;
      const angle = ps ? lerpAngle(ps.angle, seg.angle, alpha) : seg.angle;
      const shown = angle + flip + (seg.mirror ? Math.PI : 0);
      const s = c.parts[si];
      const keys = isLoco
        ? this.frameKeys.loco(t.locos[i].def, seg.part)
        : this.frameKeys.wagon(t.wagons[i - t.locos.length].def);
      const styles = (isLoco ? t.locos[i].def : t.wagons[i - t.locos.length].def).bogieStyle;
      // a segment drawn back to front turns its gear the other way, and so do its bogies
      const partRoll = roll === undefined ? undefined : seg.mirror ? -roll : roll;
      const key = this.pose(
        s,
        keys,
        x,
        y,
        shown,
        15,
        partRoll,
        this.bodyGround(seg, ps, alpha, x, y),
      );
      const fr = this.atlas.get(key);
      // Procedural vehicle windows carry explicit amber palette pixels.
      // Illustrated replacements need their own authored mask; never light a boiler.
      if (fr.texture.frame.width / fr.w === 1) {
        let light = this.windowLights.get(s);
        if (!light) {
          light = windowSprite();
          this.layer.addChild(light);
          this.windowLights.set(s, light);
        }
        light.texture = this.surfaces.window(key, fr, true);
        light.anchor.set(fr.anchorX, fr.anchorY);
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
      // under the night's colour where the layer has one (atmosphere.ts)
      setOwnTint(s, tint);
      c.undercarriage.zIndex = Math.min(c.undercarriage.zIndex, s.zIndex - 1);
      if (c.spec.drawBogies)
        for (let k = 0; k < seg.bogies.length; k++) {
          const b = seg.bogies[k];
          const pb = ps?.bogies[k];
          // Each wheel group follows its own rail point and tangent; the raised body
          // occludes it naturally, leaving the wheels and sideways slide visible.
          const bx = pb ? pb.drawX + (b.drawX - pb.drawX) * alpha : b.drawX;
          const by = pb ? pb.drawY + (b.drawY - pb.drawY) * alpha : b.drawY;
          const ba = pb ? lerpAngle(pb.angle, b.angle, alpha) : b.angle;
          const bs = c.bogies[bi++];
          if (!bs) continue;
          if (b.hidden) {
            bs.visible = false;
            continue;
          }
          // bogies are posed in track order; a reversed vehicle or a mirrored segment meets
          // them back to front, and its styled trucks (cylinders ahead) must face its own front
          const back = t.reversed !== seg.mirror;
          const nb = seg.bogies.length;
          const style = bogieStyleOf(styles, seg.part, back ? nb - 1 - k : k);
          if (style === 'none') {
            bs.visible = false;
            continue;
          }
          const heading = ba + (back ? Math.PI : 0);
          const narrow =
            (isLoco ? t.locos[i].def : t.wagons[i - t.locos.length].def).gauge === 'narrow';
          this.pose(bs, this.frameKeys.bogie(style, b.kind, narrow), bx, by, heading, 14, partRoll);
          bs.visible &&= s.visible;
          // always just under its own body: the depth key is by position, and a bogie
          // ahead of the body centre (towards the camera) would otherwise paint over it
          bs.zIndex = s.zIndex - 1;
          bs.tint = tint;
        }
      if (c.load && si === 0) {
        const w = t.wagons[i - t.locos.length];
        if (w.cargo && w.amount > 0.5) {
          const kind = loadKind(w.def, w.cargo);
          const thin = w.def.gauge === 'narrow';
          this.pose(c.load, this.frameKeys.load(kind, thin), x, y, shown, 16);
          const col = (PAL as unknown as Record<string, RGB>)[cargoDef(w.cargo).color] ?? PAL.white;
          setOwnTint(c.load, hex(col));
        } else c.load.visible = false;
      }
    }
  }

  /**
   * Draw vehicle `i` of a train, one with a rendered model: its own sprite sets, by its own number
   * of headings, with its trucks and its turning wheels. `rolled` is the track covered since the
   * last frame. Returns where its body parts stood.
   */
  private drawModel(
    t: Train,
    i: number,
    c: ModelVehicle,
    alpha: number,
    rolled: number,
    tint: number,
  ): DrawnEnd[] {
    const ends: DrawnEnd[] = [];
    const cur: VehiclePose | undefined = t.vehiclePoses[i];
    if (!cur) return ends;
    const prev = t.prevVehiclePoses[i];
    const flip = t.reversed ? Math.PI : 0;
    const isLoco = i < t.locos.length;
    const vdef = vehicleDef(t, i);
    const { stem } = c;
    const facings = vdef.spriteFacings ?? 48;
    const narrow = vdef.gauge === 'narrow';
    let bi = 0;
    const previous = prev?.segments;
    c.undercarriage.zIndex = Infinity;
    cur.segments.forEach((seg, si) => {
      const ps = previous?.[si];
      const x = ps ? ps.x + (seg.x - ps.x) * alpha : seg.x;
      const y = ps ? ps.y + (seg.y - ps.y) * alpha : seg.y;
      const angle = ps ? lerpAngle(ps.angle, seg.angle, alpha) : seg.angle;
      const shown = angle + flip + (seg.mirror ? Math.PI : 0);
      const s = c.parts[si];
      const partRolled = seg.mirror ? -rolled : rolled;
      // its own picture of this part, else what a plain vehicle would show
      let frameFor = (f: number) => {
        const own = `${stem}_${seg.part}_f${f}`;
        if (this.atlas.has(own)) return own;
        return isLoco
          ? locoFrame(this.atlas, t.locos[i].def, f, seg.part)
          : wagonFrame(this.atlas, t.wagons[i - t.locos.length].def, f);
      };
      const integrated = vdef.wheels?.[seg.part];
      if (integrated?.integrated) {
        const u = advanceSpin(this.spin.get(s) ?? 0, partRolled, integrated.cycle);
        this.spin.set(s, u);
        const phase = spinPhase(u, integrated.phases);
        frameFor = (f: number) => `${stem}_${seg.part}_w${phase}_f${f}`;
      }
      const ground = this.bodyGround(seg, ps, alpha, x, y);
      const placed = this.poseModel(s, frameFor, x, y, shown, 15, ground, facings);
      const key = placed.key;
      const fr = placed.frame;
      // A rendered model brings its window panes as a frame of its own (`…_lit_f<n>`). Procedural
      // vehicle windows carry explicit amber palette pixels. Any other illustrated replacement
      // stays dark: never light a boiler.
      const litKey = key.replace(/(?:_w\d+)?_f(\d+)$/, '_lit_f$1');
      const lit = litKey !== key && this.atlas.has(litKey) ? this.atlas.get(litKey) : null;
      const own = key.startsWith(`${stem}_`);
      if (lit || (!own && fr.texture.frame.width / fr.w === 1)) {
        let light = this.modelLights.get(s);
        if (!light) {
          light = new SwingSprite('emissive');
          light.blendMode = 'add';
          this.layer.addChild(light);
          this.modelLights.set(s, light);
        }
        // the panes' picture uses exactly the body's anchor and facing
        light.show(lit ?? { ...fr, texture: this.surfaces.window(key, fr, true) }, placed.flip);
        light.alpha = this.night * 0.9;
        light.position.copyFrom(s.position);
        light.scale.copyFrom(s.scale);
        light.rotation = s.rotation;
        light.skew.copyFrom(s.skew);
        light.zIndex = s.zIndex + 0.01;
        light.visible = s.visible;
      } else {
        const light = this.modelLights.get(s);
        if (light) light.visible = false;
      }
      // under the night's colour where the layer has one (atmosphere.ts)
      setOwnTint(s, tint);
      ends.push({ x, y, angle, L: seg.L, z: s.zIndex, visible: s.visible });
      // wheels fixed in this part's frame (coupled wheels and their rods, a rigid tender's, a
      // two-axle wagon's): a layer of their own drawn right over the body, posed as it is
      const wheels = vdef.wheels?.[seg.part];
      const ws = this.turnWheels(
        s,
        this.layer,
        `${stem}_${wheels?.layer ?? seg.part}`,
        wheels,
        partRolled,
        shown,
        facings,
        tint,
        (w, frame) => this.poseModel(w, frame, x, y, shown, 15, ground, facings),
      );
      if (ws) ws.zIndex = s.zIndex + 0.005;
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
          const style = bogieStyleOf(vdef.bogieStyle, seg.part, back ? nb - 1 - k : k);
          if (style === 'none') {
            bs.visible = false;
            return;
          }
          const heading = ba + (back ? Math.PI : 0);
          // a rendered model brings each of its trucks as a sprite set of its own
          const truck = b.truck !== undefined && b.truck >= 0 ? `${seg.part}-t${b.truck}` : null;
          const mine = truck !== null && this.atlas.has(`${stem}_${truck}_f0`);
          const originOffset = mine ? (vdef.truckOffsets?.[truck] ?? 0) : 0;
          const spriteX = bx - Math.cos(heading) * originOffset;
          const spriteY = by - Math.sin(heading) * originOffset;
          const truckWheels = mine ? vdef.wheels?.[truck] : undefined;
          let truckFrame = mine
            ? (f: number) => `${stem}_${truck}_f${f}`
            : (f: number) => bogieFrame(this.atlas, style, b.kind, f, narrow);
          if (truckWheels?.integrated) {
            const u = advanceSpin(this.spin.get(bs) ?? 0, partRolled, truckWheels.cycle);
            this.spin.set(bs, u);
            const phase = spinPhase(u, truckWheels.phases);
            truckFrame = (f: number) => `${stem}_${truck}_w${phase}_f${f}`;
          }
          const headings = mine ? facings : 48;
          this.poseModel(bs, truckFrame, spriteX, spriteY, heading, 14, undefined, headings);
          bs.visible &&= s.visible;
          // always just under its own body: the depth key is by position, and a bogie
          // ahead of the body centre (towards the camera) would otherwise paint over it
          bs.zIndex = s.zIndex - 1;
          bs.tint = tint;
          if (mine) {
            const ws = this.turnWheels(
              bs,
              c.undercarriage,
              `${stem}_${truckWheels?.layer ?? truck}`,
              truckWheels,
              partRolled,
              heading,
              facings,
              tint,
              (w, frame) =>
                this.poseModel(w, frame, spriteX, spriteY, heading, 14, undefined, facings),
            );
            if (ws) ws.zIndex = bs.zIndex + 0.5;
          } else {
            const ws = this.wheelLayers.get(bs);
            if (ws) ws.visible = false;
          }
        });
      // the cargo overlay keeps its procedural place, on a rendered open wagon too (for now: it
      // will need the model's own load box)
      if (c.load && si === 0) {
        const w = t.wagons[i - t.locos.length];
        if (w.cargo && w.amount > 0.5) {
          const kind = loadKind(w.def, w.cargo);
          const thin = w.def.gauge === 'narrow';
          this.poseModel(c.load, (f) => loadFrame(kind, f, thin), x, y, shown, 16);
          const col = (PAL as unknown as Record<string, RGB>)[cargoDef(w.cargo).color] ?? PAL.white;
          setOwnTint(c.load, hex(col));
        } else c.load.visible = false;
      }
    });
    return ends;
  }

  /**
   * The couplings: a short dark drawbar across each gap between two coupled rendered models
   * (consecutive vehicles, and an engine and its tender), from the one's coupling face to the
   * other's, at buffer height over the rail. It stretches and swings with the gap on a curve. Drawn
   * just over the farther body (whose end face is the one the camera sees) and under the nearer
   * one. A vehicle without a rendered model has no coupling drawn: `drawn` holds nothing for it.
   */
  private couple(t: Train, drawn: DrawnEnd[][], tint: number) {
    const pairs: [DrawnEnd[], DrawnEnd[]][] = [];
    const specs = t.vehicleSpecs;
    for (let i = 0; i < drawn.length; i++) {
      const segs = specs[i]?.segments ?? [];
      // an engine and its tender, drawn as two bodies of one vehicle
      for (let k = 0; k + 1 < drawn[i].length; k++) {
        const a = segs[k],
          b = segs[k + 1];
        if (!a || !b || a.hinge || b.hinge) continue;
        const parts = [a.part, b.part];
        if (parts.includes('engine') && parts.includes('tender'))
          pairs.push([[drawn[i][k]], [drawn[i][k + 1]]]);
      }
      if (drawn[i].length && drawn[i + 1]?.length) pairs.push([drawn[i], drawn[i + 1]]);
    }
    let links = this.links.get(t.id);
    if (!links) this.links.set(t.id, (links = []));
    while (links.length > pairs.length) links.pop()!.destroy();
    while (links.length < pairs.length) {
      const g = new Graphics();
      this.layer.addChild(g);
      links.push(g);
    }
    pairs.forEach(([A, B], j) => {
      const g = links[j];
      g.clear();
      // the facing ends: the nearest pair of body ends between the two
      let best: {
        ax: number;
        ay: number;
        bx: number;
        by: number;
        a: DrawnEnd;
        b: DrawnEnd;
      } | null = null;
      let bd = Infinity;
      for (const a of A)
        for (const b of B)
          for (const sa of [-1, 1])
            for (const sb of [-1, 1]) {
              const ax = a.x + (Math.cos(a.angle) * sa * a.L) / 2,
                ay = a.y + (Math.sin(a.angle) * sa * a.L) / 2,
                bx = b.x + (Math.cos(b.angle) * sb * b.L) / 2,
                by = b.y + (Math.sin(b.angle) * sb * b.L) / 2,
                d = (ax - bx) ** 2 + (ay - by) ** 2;
              if (d < bd) {
                bd = d;
                best = { ax, ay, bx, by, a, b };
              }
            }
      if (!best || bd > COUPLER_REACH ** 2 || !best.a.visible || !best.b.visible) {
        g.visible = false;
        return;
      }
      const { ax, ay, bx, by, a, b } = best;
      const far = Math.min(a.z, b.z),
        near = Math.max(a.z, b.z),
        apart = near - far > 1.2;
      // a little way in under each body, so the bar meets its headstock without a seam; further in
      // under the nearer body, which hides it, so it still meets a picture whose facing is a few
      // degrees off the body's axis
      const inward = (px: number, py: number, e: DrawnEnd) => {
        const c = Math.cos(e.angle),
          s = Math.sin(e.angle),
          k = apart && e.z === near ? COUPLER_UNDER : COUPLER_IN,
          u = (px - e.x) * c + (py - e.y) * s > 0 ? -k : k;
        return [px + c * u, py + s * u];
      };
      const lift = COUPLER_H * UP_TILE_PX;
      const screen = ([x, y]: number[]) => {
        const w = tileToWorld(x, y);
        return [w.x, w.y + this.ground(x, y).dz - lift];
      };
      const [x0, y0] = screen(inward(ax, ay, a)),
        [x1, y1] = screen(inward(bx, by, b)),
        [hx0, hy0] = screen([ax, ay]),
        [hx1, hy1] = screen([bx, by]);
      // the bar, a lighter top edge along it, and a heavier coupler head at each face
      g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 1.3, color: 0x1d1b19, cap: 'round' });
      g.moveTo(x0, y0 - 0.4)
        .lineTo(x1, y1 - 0.4)
        .stroke({ width: 0.5, color: 0x7a746c, cap: 'round' });
      const head = (hx: number, hy: number, ox: number, oy: number) => {
        const dx = ox - hx,
          dy = oy - hy,
          k = Math.min(1, HEAD_PX / (Math.hypot(dx, dy) || 1));
        g.moveTo(hx, hy)
          .lineTo(hx + dx * k, hy + dy * k)
          .stroke({ width: 2.1, color: 0x24211e, cap: 'butt' });
      };
      head(hx0, hy0, hx1, hy1);
      head(hx1, hy1, hx0, hy0);
      // under the night's colour where the layer has one (atmosphere.ts)
      setOwnTint(g, tint);
      g.visible = true;
      // just over the farther body and under the nearer body and its trucks; side by side across
      // the screen neither covers the gap
      const mid = depthKey((ax + bx) / 2, (ay + by) / 2, 15);
      g.zIndex = apart ? Math.min(near - 1.05, Math.max(far + 0.02, mid)) : near + 0.02;
    });
  }
}

/** A coupling's height over the rail, tiles of height (about 1.06 m, buffer height). */
const COUPLER_H = 0.17;
/** How far a coupling reaches in under each body from its end, tiles. */
const COUPLER_IN = 0.03;
/** How far it reaches in under the nearer body of the two, which covers it, tiles. */
const COUPLER_UNDER = 0.15;
/** Body ends further apart than this (tiles) are not coupled (a consist being rebuilt). */
const COUPLER_REACH = 0.6;
/** Length of the heavier coupler head at each body face, world pixels. */
const HEAD_PX = 1.8;

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
