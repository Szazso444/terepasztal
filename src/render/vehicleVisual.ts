import type { SegmentPose, VehiclePose, VehicleSpec } from '../sim/body';

export type BodySlice = 'front' | 'rear';
export interface VisualSegment extends SegmentPose {
  slice?: BodySlice;
}

/** Only the picture articulates. Routing and tolerances still use the original rigid spec. */
export function hingedBody(spec: VehicleSpec) {
  return spec.size === 'large' && spec.segments.length === 1;
}

export function visualSegments(pose: VehiclePose, spec: VehicleSpec): VisualSegment[] {
  if (!hingedBody(spec)) return pose.segments;
  const s = pose.segments[0];
  const middle = s.bogies.length === 3 ? s.bogies[1] : pose;
  return (['front', 'rear'] as const).map((slice, i) => {
    const sign = i === 0 ? 1 : -1;
    const outer = s.bogies[i === 0 ? 0 : s.bogies.length - 1];
    const dx = (outer.x - middle.x) * sign;
    const dy = (outer.y - middle.y) * sign;
    const angle = Math.hypot(dx, dy) < 1e-8 ? s.angle : Math.atan2(dy, dx);
    const bogies = [outer];
    if (i === 0 && s.bogies.length === 3) bogies.push(s.bogies[1]);
    return {
      ...s,
      slice,
      L: s.L / 2,
      x: middle.x + Math.cos(angle) * ((sign * s.L) / 4),
      y: middle.y + Math.sin(angle) * ((sign * s.L) / 4),
      angle,
      bogies: bogies.map((b) => ({ ...b, drawX: b.x, drawY: b.y })),
    };
  });
}
