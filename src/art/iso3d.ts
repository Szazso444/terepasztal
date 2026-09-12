import { HALF_W, HALF_H } from '../engine/iso';
import { hash2 } from '../engine/rng';
import { mix, shade, type RGB } from './palette';
import { PixelBuf } from './pixels';

export interface P2 {
  x: number;
  y: number;
}

/** Tile-space point (fractional tiles, z in pixels up) -> sprite pixel space, given the sprite origin. */
export function proj(ox: number, oy: number, tx: number, ty: number, z = 0): P2 {
  return { x: ox + (tx - ty) * HALF_W, y: oy + (tx + ty) * HALF_H - z };
}

/** Even-odd scanline polygon fill with a per-pixel colour callback. */
export function fillPoly(b: PixelBuf, pts: P2[], color: (x: number, y: number) => RGB | null) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(b.h - 1, Math.ceil(maxY)); y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const c = pts[(i + 1) % pts.length];
      if ((a.y <= yc && c.y > yc) || (c.y <= yc && a.y > yc)) {
        xs.push(a.x + ((yc - a.y) * (c.x - a.x)) / (c.y - a.y));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.max(0, Math.round(xs[i])); x < Math.min(b.w, Math.round(xs[i + 1])); x++) {
        const col = color(x, y);
        if (col) b.set(x, y, col);
      }
    }
  }
}

/** Light direction in tile space (unit-ish). Faces whose normal points this way are brightest. */
const LIGHT = { x: -0.6, y: -0.8 };
/** Viewer direction: faces with normal . VIEW > 0 are visible. */
const VIEW = { x: 1, y: 1 };

export interface PrismOpts {
  /** origin pixel of the prism's tile-space (0,0) ground point */
  ox: number;
  oy: number;
  /** footprint centre in tile units */
  cx: number;
  cy: number;
  /** heading angle in tile space (0 = +x) */
  angle: number;
  /** footprint length along heading and width across, in tile units */
  len: number;
  wid: number;
  /** base elevation and height in pixels */
  z0?: number;
  h: number;
  /** colour sets: top face and side face palettes (dithered) */
  top: RGB[];
  side: RGB[];
  seed?: number;
  /** optional roof: draw the top as a pitched roof along the heading with this ridge rise in px */
  ridge?: number;
  roof?: RGB[];
}

/** Draw a box (or a pitched-roof box) aligned to an arbitrary tile-space heading. */
export function drawPrism(b: PixelBuf, o: PrismOpts) {
  const z0 = o.z0 ?? 0;
  const seed = o.seed ?? 1;
  const ca = Math.cos(o.angle);
  const sa = Math.sin(o.angle);
  // footprint corners in tile space, CCW
  const hl = o.len / 2;
  const hw = o.wid / 2;
  const corners = [
    { x: o.cx + ca * hl - sa * hw, y: o.cy + sa * hl + ca * hw },
    { x: o.cx + ca * hl + sa * hw, y: o.cy + sa * hl - ca * hw },
    { x: o.cx - ca * hl + sa * hw, y: o.cy - sa * hl - ca * hw },
    { x: o.cx - ca * hl - sa * hw, y: o.cy - sa * hl + ca * hw },
  ];
  // side faces
  const faces: { pts: P2[]; light: number; depth: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const p = corners[i];
    const q = corners[(i + 1) % 4];
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    // outward normal for CCW polygon (in tile space, y down-left) -> (ey, -ex) or (-ey, ex); pick the one pointing away from centre
    let nx = ey;
    let ny = -ex;
    const mx = (p.x + q.x) / 2 - o.cx;
    const my = (p.y + q.y) / 2 - o.cy;
    if (nx * mx + ny * my < 0) {
      nx = -nx;
      ny = -ny;
    }
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl;
    ny /= nl;
    const vis = nx * VIEW.x + ny * VIEW.y;
    if (vis <= 0.01) continue;
    const light = 0.62 + 0.38 * Math.max(0, (nx * LIGHT.x + ny * LIGHT.y + 1) / 2);
    const pts = [
      proj(o.ox, o.oy, p.x, p.y, z0),
      proj(o.ox, o.oy, q.x, q.y, z0),
      proj(o.ox, o.oy, q.x, q.y, z0 + o.h),
      proj(o.ox, o.oy, p.x, p.y, z0 + o.h),
    ];
    faces.push({ pts, light, depth: (p.x + q.x + p.y + q.y) / 2 });
  }
  faces.sort((a, c) => a.depth - c.depth);
  for (const f of faces) {
    const colours = o.side.map((c) => shade(mix(o.side[0], c, 0.22), f.light));
    fillPoly(b, f.pts, (x, y) => {
      const n = hash2(x >> 1, y >> 1, seed);
      const idx = Math.min(o.side.length - 1, Math.floor(n * o.side.length));
      return colours[idx];
    });
  }
  // top
  if (o.ridge && o.roof) {
    // pitched roof: ridge runs along heading through the centre
    const r = o.roof;
    const ridgeA = { x: o.cx + ca * hl, y: o.cy + sa * hl };
    const ridgeB = { x: o.cx - ca * hl, y: o.cy - sa * hl };
    const zTop = z0 + o.h;
    // Close the triangular end walls before laying the roof. Leaving these empty made
    // terrain and bogies show through pitched cabs and building gables.
    for (const [ia, ib, ridge, sign] of [
      [0, 1, ridgeA, 1],
      [2, 3, ridgeB, -1],
    ] as const) {
      if ((ca + sa) * sign <= 0.01) continue;
      fillPoly(
        b,
        [
          proj(o.ox, o.oy, corners[ia].x, corners[ia].y, zTop),
          proj(o.ox, o.oy, corners[ib].x, corners[ib].y, zTop),
          proj(o.ox, o.oy, ridge.x, ridge.y, zTop + o.ridge),
        ],
        () => shade(o.side[0], 0.8),
      );
    }
    const slopes = [
      [corners[0], corners[3]], // +wid side (index 0 and 3 are +sa/+ca side)
      [corners[1], corners[2]],
    ];
    slopes.forEach((s, si) => {
      const pts = [
        proj(o.ox, o.oy, s[0].x, s[0].y, zTop),
        proj(o.ox, o.oy, ridgeA.x, ridgeA.y, zTop + o.ridge!),
        proj(o.ox, o.oy, ridgeB.x, ridgeB.y, zTop + o.ridge!),
        proj(o.ox, o.oy, s[1].x, s[1].y, zTop),
      ];
      // normal of the slope in tile space is the outward side normal
      const nx = si === 0 ? -sa : sa;
      const ny = si === 0 ? ca : -ca;
      const light = 0.7 + 0.3 * Math.max(0, (nx * LIGHT.x + ny * LIGHT.y + 1) / 2);
      const colours = r.map((c) => shade(mix(r[0], c, 0.22), light));
      const seams = r.map((c) => shade(mix(r[0], c, 0.22), light * 0.94));
      fillPoly(b, pts, (x, y) => {
        const n = hash2(x >> 1, y >> 2, seed + 7);
        const idx = Math.min(r.length - 1, Math.floor(n * r.length));
        // slate rows
        return (y + Math.floor(x / 2)) % 5 === 0 ? seams[idx] : colours[idx];
      });
    });
  } else {
    const pts = corners.map((c) => proj(o.ox, o.oy, c.x, c.y, z0 + o.h));
    const colours = o.top.map((c) => mix(o.top[0], c, 0.22));
    fillPoly(b, pts, (x, y) => {
      const n = hash2(x >> 1, y >> 1, seed + 3);
      const idx = Math.min(o.top.length - 1, Math.floor(n * o.top.length));
      return colours[idx];
    });
    // A restrained bevel follows the actual projected edges, never a screen-space box.
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const c = pts[(i + 1) % pts.length];
      const lit = corners[i].x + corners[(i + 1) % 4].x < o.cx * 2;
      b.line(a.x, a.y, c.x, c.y, shade(o.top[0], lit ? 1.14 : 0.84));
    }
  }
}

/** Draw a vertical cylinder (chimney, tank) approximated by a thin prism ring. */
export function drawCylinder(
  b: PixelBuf,
  ox: number,
  oy: number,
  cx: number,
  cy: number,
  r: number,
  z0: number,
  h: number,
  side: RGB[],
  top: RGB,
  seed = 1,
) {
  const c = proj(ox, oy, cx, cy, z0);
  const rx = r * HALF_W;
  const ry = r * HALF_H;
  // body
  for (let x = Math.floor(c.x - rx); x <= Math.ceil(c.x + rx); x++) {
    const nx = (x + 0.5 - c.x) / rx;
    if (Math.abs(nx) > 1) continue;
    const dy = Math.sqrt(1 - nx * nx) * ry;
    const light = 0.55 + 0.45 * (1 - (nx + 1) / 2) * (0.7 + 0.3 * hash2(x, seed, seed));
    for (let y = Math.floor(c.y - h + dy); y <= Math.ceil(c.y + dy); y++) {
      const n = hash2(x >> 1, y >> 1, seed);
      const idx = Math.min(side.length - 1, Math.floor(n * side.length));
      b.set(x, y, shade(side[idx], light));
    }
  }
  // top ellipse
  for (let y = Math.floor(c.y - h - ry); y <= Math.ceil(c.y - h + ry); y++)
    for (let x = Math.floor(c.x - rx); x <= Math.ceil(c.x + rx); x++) {
      const nx = (x + 0.5 - c.x) / rx;
      const ny = (y + 0.5 - (c.y - h)) / ry;
      if (nx * nx + ny * ny <= 1) b.set(x, y, top);
    }
}
