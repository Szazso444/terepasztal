// Preview only: supported curves and switches on bridge platforms over a slope.
import { TrackGraph, pieceFrame, footprintOf } from '/src/world/track.ts';
import { tileToWorld } from '/src/engine/iso.ts';

function ghost(g, x, y, kind, rot, cls) {
  const probe = new TrackGraph(g.map.w, g.map.h);
  probe.place(x, y, kind, rot, cls, cls);
  for (const [k, p] of probe.pieces) {
    const tx = k % g.map.w,
      ty = Math.floor(k / g.map.w),
      s = g.world.makeOverlaySprite(pieceFrame(p)),
      w = tileToWorld(tx, ty);
    s.position.set(w.x, w.y + g.world.elevationOf(tx, ty));
    s.tint = 0xff4a3a;
    s.alpha = 0.8;
  }
}
function attempt(g, label, x, y, kind, cls, rots) {
  let reason = null;
  for (const rot of rots) {
    const c = g.builder.checkTrack(x, y, { kind, cls, cls2: cls }, rot);
    if (c.ok) {
      g.builder.placeTrack(x, y, { kind, cls, cls2: cls }, rot);
      return { label, ok: true, rot };
    }
    reason = c.reason;
  }
  ghost(g, x, y, kind, rots[0], cls);
  return { label, ok: false, reason };
}

export function support(g, site, bridge) {
  const { x0, y } = site,
    out = [];
  // A curve on a level-1 bank tile whose rails meet level-1 ground: allowed at deck level 1.
  g.builder.placeBuilding(x0 + 15, y + 2, bridge);
  out.push(attempt(g, 'Curve on a platform, meeting its rails at one level', x0 + 15, y + 2, 'curve', 'regular', [0, 1, 2, 3]));
  // A curve on a platform whose rails would meet ground at two different levels: refused.
  g.builder.placeBuilding(x0 + 9, y + 2, bridge);
  out.push(attempt(g, 'Curve on a platform, its rails at two levels', x0 + 9, y + 2, 'curve', 'regular', [0, 1, 2, 3]));
  // A high-speed curve with a platform under only one of its tiles: refused.
  const fp = footprintOf(x0 + 12, y + 2, 'curve', 0, 'high_speed');
  g.builder.placeBuilding(fp[0].x, fp[0].y, bridge);
  out.push(attempt(g, 'High-speed curve with a platform under one tile of four', x0 + 12, y + 2, 'curve', 'high_speed', [0]));
  return out;
}
