import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
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
import { standOnGround, LEVEL_GROUND, type Ground } from './slope';
import { groundSliceKey, ridingKey, tileColumns } from './bridgeDepth';
import {
  facingOf,
  DRAWN_FACINGS,
  mirrorFacing,
  residualRotation,
  ROTATION_SHARE,
  type VehicleSpec,
  type VehiclePose,
} from '../sim/body';

/** Bridge decks as the train renderer needs them: they sort with the scenery, trains ride them. */
export interface DeckSorting {
  /** A bridge deck lies under the tile position. */
  onDeck(x: number, y: number): boolean;
}

interface VehicleSprites {
  parts: Sprite[];
  undercarriage: Container;
  bogies: Sprite[];
  load: Sprite | null;
  spec: VehicleSpec;
  /** Copies of its sprites cut to the tiles it is over, while it rides a bridge deck. */
  slices: Sprite[];
}
/** A sprite of a vehicle that rides a deck, to be drawn in slices (bridgeDepth.ts). */
interface Sliced {
  s: Sprite;
  /** Depth key its position alone gives it, its layer among the vehicle's sprites, and a nudge. */
  own: number;
  layer: number;
  nudge: number;
}

/**
 * Depth-sorted rigid segments, with independently swivelling bogies beneath the raised decks
 * and cargo overlays above loaded wagons. Bodies use 48 facings and a small residual rotation.
 */
export class TrainRenderer {
  private surfaces = new SurfaceAssets();
  private windowLights = new Map<Sprite, Sprite>();
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
  /** Bridge decks under the trains (the world renderer); absent, trains sort by position alone. */
  decks: DeckSorting | null = null;
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
        list.push({ parts, undercarriage, bogies, load, spec, slices: [] });
      }
    }
    return list;
  }
  private destroyCar(c: VehicleSprites) {
    for (const s of c.parts) {
      this.windowLights.get(s)?.destroy();
      this.windowLights.delete(s);
      s.destroy();
    }
    c.undercarriage.destroy({ children: true });
    c.load?.destroy();
    for (const s of c.slices) {
      const texture = s.texture;
      s.destroy();
      texture.destroy();
    }
  }

  /**
   * Draw the sprites of a vehicle that rides a bridge deck on straight track in slices, one per
   * tile it is over, each sorted with that tile (bridgeDepth.ts): above the deck under it, below
   * the parapet beside it and whatever stands in front. The sprites themselves are not drawn
   * while their slices are. `axis` is the tile axis the track runs along and `line` its row
   * (axis x) or column (axis y). Without `sprites` the vehicle is drawn whole again.
   */
  private slice(c: VehicleSprites, sprites: Sliced[], axis: 'x' | 'y' = 'x', line = 0) {
    let n = 0;
    for (const { s, own, layer, nudge } of sprites) {
      s.renderable = false;
      if (!s.visible) continue;
      const base = s.texture,
        w = base.orig.width,
        res = base.frame.width / w,
        // Standing square on the track the sprite is not turned: only mirrored, and sheared up
        // or down along a climb. Its screen columns are its texture columns.
        mirrored = Math.cos(s.rotation + s.skew.y) * s.scale.x < 0,
        left = s.x - (mirrored ? 1 - s.anchor.x : s.anchor.x) * w;
      for (const col of tileColumns(axis, line, left, left + w)) {
        const t0 = mirrored ? left + w - col.to : col.from - left,
          t1 = mirrored ? left + w - col.from : col.to - left;
        if (t1 - t0 < 0.01) continue;
        let piece = c.slices[n];
        if (!piece) {
          piece = new Sprite({
            texture: new Texture({
              source: base.source,
              frame: new Rectangle(),
              orig: new Rectangle(),
              dynamic: true,
            }),
            cullable: true,
          });
          this.layer.addChild(piece);
          c.slices.push(piece);
        }
        n++;
        const texture = piece.texture;
        if (texture.source !== base.source) texture.source = base.source;
        texture.frame.x = base.frame.x + t0 * res;
        texture.frame.y = base.frame.y;
        texture.frame.width = (t1 - t0) * res;
        texture.frame.height = base.frame.height;
        texture.orig.width = t1 - t0;
        texture.orig.height = base.orig.height;
        texture.update();
        piece.anchor.set((s.anchor.x * w - t0) / (t1 - t0), s.anchor.y);
        piece.position.copyFrom(s.position);
        piece.scale.copyFrom(s.scale);
        piece.skew.copyFrom(s.skew);
        piece.rotation = s.rotation;
        piece.tint = s.tint;
        piece.alpha = s.alpha;
        piece.blendMode = s.blendMode;
        piece.label = s.label;
        piece.visible = true;
        const tile = depthKey(col.x, col.y);
        piece.zIndex =
          (this.decks?.onDeck(col.x, col.y)
            ? ridingKey(tile, own, layer)
            : groundSliceKey(tile, own, layer)) + nudge;
      }
    }
    for (let k = n; k < c.slices.length; k++) c.slices[k].visible = false;
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
    ground = this.ground(x, y),
    /** The vehicle rides a bridge deck askew: the depth key of the front-most deck under it. */
    front?: number,
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
    // (the rail is level across the track).
    const g = ground,
      cos = Math.cos(angle),
      sin = Math.sin(angle),
      along = g.sgx * cos + g.sgy * sin;
    standOnGround(s, Math.round(wp.x), Math.round(wp.y), {
      dz: g.dz,
      sgx: along * cos,
      sgy: along * sin,
    });
    s.zIndex =
      front === undefined ? depthKey(x, y, layer) : ridingKey(front, depthKey(x, y, 15), layer);
    s.visible = !(this.hideAt && this.hideAt(Math.floor(x + 0.5), Math.floor(y + 0.5)));
    s.renderable = true;
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
        // Bridge decks sort with the scenery around them, so a vehicle over one cannot sort by
        // its centre alone (bridgeDepth.ts). On straight track it is drawn in slices, one per
        // tile under it; askew (on a curve carried by platforms) it takes the depth of the
        // front-most deck under it, wheels included.
        let deck: number | undefined,
          axis: 'x' | 'y' | null | undefined,
          line = 0;
        if (this.decks)
          segments.forEach((seg, si) => {
            const ps = previous?.[si],
              x = ps ? ps.x + (seg.x - ps.x) * alpha : seg.x,
              y = ps ? ps.y + (seg.y - ps.y) * alpha : seg.y,
              angle = ps ? lerpAngle(ps.angle, seg.angle, alpha) : seg.angle,
              cos = Math.cos(angle),
              sin = Math.sin(angle),
              // The body ends a little short of its nominal length: a buffer over the next tile
              // does not put the vehicle on it.
              half = c.spec.segments[si].L / 2 - 0.06,
              steps = Math.max(2, Math.ceil(half * 4));
            for (let k = -steps; k <= steps; k++) {
              const px = x + (cos * half * k) / steps,
                py = y + (sin * half * k) / steps;
              if (this.decks!.onDeck(px, py))
                deck = Math.max(deck ?? -Infinity, depthKey(Math.round(px), Math.round(py)));
            }
            // Square on a line of tile centres, as straight track runs; every part on one line.
            const along = Math.abs(sin) < 1e-4 ? 'x' : Math.abs(cos) < 1e-4 ? 'y' : null,
              at = along === 'x' ? y : x,
              square =
                along !== null &&
                Math.abs(at - Math.round(at)) < 0.02 &&
                seg.bogies.every((b, k) => {
                  const pb = ps?.bogies[k],
                    ba = pb ? lerpAngle(pb.angle, b.angle, alpha) : b.angle;
                  return Math.abs(along === 'x' ? Math.sin(ba) : Math.cos(ba)) < 1e-4;
                });
            if (!square || (axis !== undefined && (axis !== along || line !== Math.round(at))))
              axis = null;
            else {
              axis = along;
              line = Math.round(at);
            }
          });
        const riding = deck !== undefined,
          straight = riding && !!axis,
          front = straight ? undefined : deck,
          sliced: Sliced[] = [];
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
            front,
          );
          const own = depthKey(x, y, 15);
          if (straight) sliced.push({ s, own, layer: 15, nudge: 0 });
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
            light.renderable = true;
            if (straight) sliced.push({ s: light, own, layer: 15, nudge: 0.01 });
          } else {
            const light = this.windowLights.get(s);
            if (light) light.visible = false;
          }
          s.tint = tint;
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
              this.pose(
                bs,
                (f) => bogieFrame(this.atlas, style, b.kind, f, narrow),
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
              if (straight) sliced.push({ s: bs, own, layer: 15, nudge: -0.03 });
            });
          if (c.load && si === 0) {
            const w = t.wagons[i - t.locos.length];
            if (w.cargo && w.amount > 0.5) {
              const kind = loadKind(w.def, w.cargo);
              const thin = w.def.gauge === 'narrow';
              this.pose(c.load, (f) => loadFrame(kind, f, thin), x, y, shown, 16, undefined, front);
              const col =
                (PAL as unknown as Record<string, RGB>)[cargoDef(w.cargo).color] ?? PAL.white;
              c.load.tint = hex(col);
              if (straight) sliced.push({ s: c.load, own, layer: 16, nudge: 0 });
            } else c.load.visible = false;
          }
        });
        if (straight) this.slice(c, sliced, axis!, line);
        else if (c.slices.length) this.slice(c, []);
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
