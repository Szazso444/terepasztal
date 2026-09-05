import { Dir, type Vec2 } from '../engine/iso';

/** Edge midpoints in tile space relative to the tile centre. */
export const EDGE_MID: Record<Dir, Vec2> = {
  [Dir.N]: { x: 0, y: -0.5 },
  [Dir.E]: { x: 0.5, y: 0 },
  [Dir.S]: { x: 0, y: 0.5 },
  [Dir.W]: { x: -0.5, y: 0 },
};

export function isCurveLink(a: Dir, b: Dir) {
  return (a + 2) % 4 !== b;
}

/** Length in tile units of a link path. */
export function linkLength(a: Dir, b: Dir) {
  return isCurveLink(a, b) ? Math.PI / 4 : 1;
}

/**
 * Sample the path through a tile from edge a to edge b (tile-space, relative to tile centre).
 * Straights are a line through the centre; curves are quarter circles around the shared corner.
 */
export function linkPoints(a: Dir, b: Dir, samples = 8): Vec2[] {
  const A = EDGE_MID[a];
  const B = EDGE_MID[b];
  const out: Vec2[] = [];
  if (!isCurveLink(a, b)) {
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      out.push({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t });
    }
    return out;
  }
  const corner = { x: A.x + B.x, y: A.y + B.y };
  const a0 = Math.atan2(A.y - corner.y, A.x - corner.x);
  let a1 = Math.atan2(B.y - corner.y, B.x - corner.x);
  let d = a1 - a0;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  a1 = a0 + d;
  for (let i = 0; i <= samples; i++) {
    const t = a0 + (a1 - a0) * (i / samples);
    out.push({ x: corner.x + 0.5 * Math.cos(t), y: corner.y + 0.5 * Math.sin(t) });
  }
  return out;
}
