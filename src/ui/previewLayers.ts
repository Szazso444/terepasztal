import type { AtlasRegistry } from '../engine/atlas';
import type { LocoDef, WagonDef } from '../data/content';
import { bogieFrame, bogieStyleOf, locoFrame, ownModelStem, wagonFrame } from '../art/frames';
import { itemKind, locoDef, wagonDef } from '../gacha/items';
import {
  vehicleSpec,
  poseVehicle,
  Polyline,
  facingOf,
  facingAngle,
  DRAWN_FACINGS,
  mirrorFacing,
} from '../sim/body';

type Layer = { key: string; x: number; y: number; flip: boolean; z: number };
/** The frames that make up a whole vehicle: articulated parts and separate wheel groups. */
export function previewLayers(atlas: Pick<AtlasRegistry, 'has'>, id: string, facing = 0): Layer[] {
  const loco = itemKind(id) === 'loco',
    def = loco ? locoDef(id) : wagonDef(id),
    spec = vehicleSpec(def),
    // its own rendered sprites (`rolling/loco_<id>`, `rolling/wagon_<id>`); null for a procedural wagon
    stem = ownModelStem(loco ? 'loco' : 'wagon', def);
  const angle = facingAngle(facing),
    u = { x: Math.cos(angle), y: Math.sin(angle) };
  const pl = new Polyline([
    { x: -u.x * 8, y: -u.y * 8 },
    { x: u.x * 8, y: u.y * 8 },
  ]);
  const pose = poseVehicle(pl, 8 + spec.L / 2, spec);
  const layers: Layer[] = [];
  const add = (key: (f: number) => string, x: number, y: number, a: number, z: number) => {
    const f = facingOf(a),
      flip = !DRAWN_FACINGS.has(f);
    layers.push({
      key: key(flip ? mirrorFacing(f) : f),
      x: (x - y) * 32,
      y: (x + y) * 16,
      flip,
      z,
    });
  };
  const narrow = def.gauge === 'narrow';
  for (const s of pose.segments) {
    if (spec.drawBogies)
      s.bogies.forEach((b, k) => {
        // a mirrored segment meets its bogies back to front, like the train renderer
        const n = s.bogies.length;
        const style = bogieStyleOf(def.bogieStyle, s.part, s.mirror ? n - 1 - k : k);
        if (style === 'none' || b.hidden) return;
        // a rendered model's own truck, with its wheels as they stand at rest
        const own =
          stem && b.truck !== undefined && b.truck >= 0 ? `${stem}_${s.part}-t${b.truck}` : null;
        const heading = b.angle + (s.mirror ? Math.PI : 0);
        add(
          (f) =>
            own && atlas.has(`${own}_f${f}`)
              ? `${own}_f${f}`
              : bogieFrame(atlas, style, b.kind, f, narrow),
          b.drawX,
          b.drawY,
          heading,
          -1000,
        );
        if (own && atlas.has(`${own}_w0_f0`))
          add((f) => `${own}_w0_f${f}`, b.drawX, b.drawY, heading, -999);
      });
    add(
      (f) =>
        loco
          ? locoFrame(atlas, def as LocoDef, f, s.part)
          : wagonFrame(atlas, def as WagonDef, f, s.part),
      s.x,
      s.y,
      s.angle + (s.mirror ? Math.PI : 0),
      (s.x + s.y) * 100,
    );
    // its wheels fixed in the part at rest: an integrated part's phase 0 (the whole part again), or
    // the part's own wheel layer, which has no frame at a heading where the body hides them all
    const layer = def.wheels?.[s.part]?.layer;
    const fixed = stem ? `${stem}_${layer ?? s.part}_w0` : null;
    if (fixed && (layer || atlas.has(`${fixed}_f0`))) {
      add(
        (f) => `${fixed}_f${f}`,
        s.x,
        s.y,
        s.angle + (s.mirror ? Math.PI : 0),
        (s.x + s.y) * 100 + 0.5,
      );
      if (layer && !atlas.has(layers[layers.length - 1].key)) layers.pop();
    }
  }
  return layers.sort((a, b) => a.z - b.z);
}
