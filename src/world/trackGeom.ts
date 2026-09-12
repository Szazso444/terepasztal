import { Dir, opposite, type Vec2 } from '../engine/iso';

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

/** Length in tile units of a one-tile link path. */
export function linkLength(a: Dir, b: Dir) {
  return isCurveLink(a, b) ? Math.PI / 4 : 1;
}

/**
 * Sample the path through a single tile from edge a to edge b (tile-space, relative to the tile
 * centre). Straights are a line through the centre; curves are quarter circles of radius 0.5
 * around the shared corner.
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

/**
 * Speed factor on a curve of radius R (tiles): `min(1, k * sqrt(R))`. `k` is expressed through the
 * regular-curve factor so the existing tuning value keeps its meaning: R = 0.5 gives exactly
 * `curveSpeed`, R = 1.5 gives about 0.95, straights 1.
 */
export function curveFactor(radius: number | null, curveSpeed: number) {
  if (radius === null) return 1;
  return Math.min(1, curveSpeed * Math.sqrt(2 * radius));
}

// ---------------------------------------------------------------------------- multi-tile pieces

/** One way through one tile of a multi-tile piece. */
export interface MemberLink {
  in: Dir;
  out: Dir;
  /** tile-relative points from the `in` edge to the `out` edge */
  pts: Vec2[];
  len: number;
  radius: number | null;
  /** index into UnitDef.routes */
  route: number;
}
export interface UnitMember {
  dx: number;
  dy: number;
  links: MemberLink[];
}
export interface UnitDef {
  n: number;
  members: UnitMember[];
  /** member index sequence of every route, entry to exit */
  routes: { members: number[]; length: number; diverging: boolean }[];
}

const unitCache = new Map<string, UnitDef>();

/**
 * Geometry of an `n × n` curve or switch. Rotation 0 enters the anchor tile (0,0) from the north;
 * the curve leaves eastward with radius `n - 0.5` centred on the block corner, the switch also
 * runs straight through to the south. Switch rotations 4..7 are the mirror family (diverging
 * west). Every route is sampled densely, then clipped to the tiles it crosses so each member tile
 * gets its own polyline and edge pair.
 */
export function unitDef(kind: 'curve' | 'switch', n: number, rot: number): UnitDef {
  const key = `${kind}:${n}:${rot}`;
  const hit = unitCache.get(key);
  if (hit) return hit;
  const R = n - 0.5;
  const mirror = kind === 'switch' && rot >= 4;
  const steps = rot % 4;
  const c = (n - 1) / 2;
  const xf = (p: Vec2): Vec2 => {
    let x = mirror ? n - 1 - p.x : p.x;
    let y = p.y;
    for (let s = 0; s < steps; s++) {
      const rx = x - c;
      const ry = y - c;
      x = -ry + c;
      y = rx + c;
    }
    return { x, y };
  };
  const SAMPLES = 96;
  const routes: { pts: Vec2[]; radius: number | null; diverging: boolean }[] = [];
  const arc: Vec2[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = Math.PI - (Math.PI / 2) * (i / SAMPLES);
    arc.push(xf({ x: n - 0.5 + R * Math.cos(t), y: -0.5 + R * Math.sin(t) }));
  }
  if (kind === 'switch') {
    const straight: Vec2[] = [];
    for (let i = 0; i <= SAMPLES; i++) straight.push(xf({ x: 0, y: -0.5 + n * (i / SAMPLES) }));
    routes.push({ pts: straight, radius: null, diverging: false });
    routes.push({ pts: arc, radius: R, diverging: true });
  } else routes.push({ pts: arc, radius: null, diverging: false });
  if (kind === 'curve') routes[0].radius = R;

  const members: UnitMember[] = [];
  for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) members.push({ dx, dy, links: [] });
  const memberIndex = (dx: number, dy: number) => dy * n + dx;
  const def: UnitDef = { n, members, routes: [] };
  routes.forEach((r, ri) => {
    const clipped = clipRoute(r.pts);
    const seq: number[] = [];
    let length = 0;
    for (const ct of clipped) {
      const mi = memberIndex(ct.tx, ct.ty);
      let len = 0;
      for (let i = 1; i < ct.pts.length; i++)
        len += Math.hypot(ct.pts[i].x - ct.pts[i - 1].x, ct.pts[i].y - ct.pts[i - 1].y);
      members[mi].links.push({
        in: ct.in,
        out: ct.out,
        pts: ct.pts.map((p) => ({ x: p.x - ct.tx, y: p.y - ct.ty })),
        len,
        radius: r.radius,
        route: ri,
      });
      seq.push(mi);
      length += len;
    }
    def.routes.push({ members: seq, length, diverging: r.diverging });
  });
  unitCache.set(key, def);
  return def;
}

interface ClippedTile {
  tx: number;
  ty: number;
  in: Dir;
  out: Dir;
  pts: Vec2[];
}

/** Split a dense polyline (block coordinates, tile centres at integers) into per-tile runs. */
function clipRoute(pts: Vec2[]): ClippedTile[] {
  const out: ClippedTile[] = [];
  const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  let tx = Math.round(mid.x);
  let ty = Math.round(mid.y);
  let cur: ClippedTile = { tx, ty, in: edgeOf(pts[0], tx, ty), out: Dir.N, pts: [pts[0]] };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    // bias the rounding towards the previous point so points on an edge stay in the tile they came from
    const bx = Math.round(b.x + (a.x - b.x) * 1e-6);
    const by = Math.round(b.y + (a.y - b.y) * 1e-6);
    if (bx === tx && by === ty) {
      cur.pts.push(b);
      continue;
    }
    // crossing into a neighbouring tile: handle one axis at a time
    let p = a;
    while (bx !== tx || by !== ty) {
      let d: Dir;
      let q: Vec2;
      if (bx !== tx) {
        const edge = bx > tx ? tx + 0.5 : tx - 0.5;
        const t = (edge - p.x) / (b.x - p.x);
        q = { x: edge, y: p.y + (b.y - p.y) * t };
        d = bx > tx ? Dir.E : Dir.W;
      } else {
        const edge = by > ty ? ty + 0.5 : ty - 0.5;
        const t = (edge - p.y) / (b.y - p.y);
        q = { x: p.x + (b.x - p.x) * t, y: edge };
        d = by > ty ? Dir.S : Dir.N;
      }
      cur.pts.push(q);
      cur.out = d;
      out.push(cur);
      tx += d === Dir.E ? 1 : d === Dir.W ? -1 : 0;
      ty += d === Dir.S ? 1 : d === Dir.N ? -1 : 0;
      cur = { tx, ty, in: opposite(d), out: Dir.N, pts: [q] };
      p = q;
    }
    cur.pts.push(b);
  }
  cur.out = edgeOf(pts[pts.length - 1], tx, ty);
  out.push(cur);
  return out;
}

/** Which edge of tile (tx,ty) a point lies on. */
function edgeOf(p: Vec2, tx: number, ty: number): Dir {
  const dx = p.x - tx;
  const dy = p.y - ty;
  if (Math.abs(Math.abs(dx) - 0.5) < 1e-6 && Math.abs(dy) < 0.5 - 1e-6)
    return dx > 0 ? Dir.E : Dir.W;
  if (Math.abs(Math.abs(dy) - 0.5) < 1e-6) return dy > 0 ? Dir.S : Dir.N;
  return dx > 0 ? Dir.E : Dir.W;
}
