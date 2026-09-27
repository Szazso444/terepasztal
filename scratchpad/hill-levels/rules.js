// Preview only: the track placement rules on the stamped incline site. Straights and crossings
// climb; curves and switches (regular and high speed) need smooth tiles unless a bridge platform
// supports them. Refused pieces are drawn as red ghosts.
import { TrackGraph, pieceFrame } from '/src/world/track.ts';
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

/** Try every rotation; keep the first that is accepted, or report the refusal and ghost it. */
function attempt(g, label, x, y, kind, cls = 'regular', rots = [0, 1, 2, 3, 4, 5, 6, 7]) {
  let reason = null;
  for (const rot of rots) {
    const c = g.builder.checkTrack(x, y, { kind, cls, cls2: cls }, rot);
    if (c.ok) {
      g.builder.placeTrack(x, y, { kind, cls, cls2: cls }, rot);
      return { label, ok: true };
    }
    reason = c.reason;
  }
  ghost(g, x, y, kind, rots[0], cls);
  return { label, ok: false, reason };
}

export function rules(g, site) {
  const { x0, y } = site,
    out = [];
  // A north-south line crossing the climb on its first bank, with a crossing where they meet.
  let laid = 0;
  for (let yy = y - 3; yy <= y + 4; yy++) {
    if (yy === y) continue;
    if (g.builder.placeTrackKind(x0 + 6, yy, 'straight', 0)) laid++;
  }
  out.push({ label: `Straight rail climbing the bank north-south (${laid} tiles)`, ok: laid === 7 });
  out.push(attempt(g, 'Crossing on a slope tile', x0 + 6, y, 'crossing'));
  out.push(attempt(g, 'Curve on a slope', x0 + 9, y + 2, 'curve'));
  out.push(attempt(g, 'Switch on a slope', x0 + 10, y, 'switch'));
  out.push(attempt(g, 'Switch on a smooth tile', x0 + 2, y, 'switch'));
  out.push(attempt(g, 'High-speed curve on smooth ground', x0 + 1, y + 3, 'curve', 'high_speed', [0, 1, 2, 3]));
  out.push(attempt(g, 'High-speed curve on a slope', x0 + 9, y + 1, 'curve', 'high_speed', [0, 1, 2, 3]));
  const bridge = g.builder.placeBuilding(x0 + 15, y + 2, 'bridge_stone');
  out.push({ label: 'Bridge platform on the slope', ok: !!bridge });
  out.push(attempt(g, 'Curve on the slope, supported by the bridge', x0 + 15, y + 2, 'curve'));
  return out;
}
