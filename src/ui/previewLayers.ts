import type { AtlasRegistry } from '../engine/atlas';
import type { LocoDef, WagonDef } from '../data/content';
import { bogieFrame, bogieStyleOf, locoFrame, wagonFrame } from '../art/frames';
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
    spec = vehicleSpec(def);
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
        add(
          (f) => bogieFrame(atlas, style, b.kind, f, narrow),
          b.drawX,
          b.drawY,
          b.angle + (s.mirror ? Math.PI : 0),
          -1000,
        );
      });
    add(
      (f) =>
        loco ? locoFrame(atlas, def as LocoDef, f, s.part) : wagonFrame(atlas, def as WagonDef, f),
      s.x,
      s.y,
      s.angle + (s.mirror ? Math.PI : 0),
      (s.x + s.y) * 100,
    );
  }
  return layers.sort((a, b) => a.z - b.z);
}
