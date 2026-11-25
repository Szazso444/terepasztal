import { PAL, type RGB } from '../art/palette';
import { groundTiles } from './buildingYard';

/**
 * The plinth under a building (#436, step 4 of the ground fit the author approved on the art demo,
 * 2026-10-13): where the ground under its footprint is not level (a bank, a level step), a footing
 * of the building's own base colour fills from the foot of its walls down to the ground, so no
 * base floats; where the ground under it stands higher than its base, the building is lifted onto
 * it first, so none sinks. The heights are the relief's own, read through `height`. The plinth is
 * drawn under the building's picture, never over it; the picture is never changed.
 *
 * Points are world px from the building's anchor as it is drawn (the foot data of
 * src/art/buildingGround.json times the picture's scale), x right and y down; heights are world px
 * up. Pure, so it runs under Node; the world renderer draws the shapes.
 */

/** Ground more than this (world px) below a building's base, or above it, counts. */
export const PLINTH_FROM = 0.6;
/** Its courses are this high (world px). */
export const COURSE = 2.5;
/** The plinth's top tucks this far (world px) under the foot of the walls, so no seam shows. */
const TUCK = 0.4;

/** A point of a wall's foot, and how far the ground lies below it there (world px). */
export interface PlinthPoint {
  x: number;
  y: number;
  drop: number;
}
/** One stretch of a wall the ground drops away from; `lit` on the left, sunlit wall. */
export interface PlinthRun {
  lit: boolean;
  points: PlinthPoint[];
}
export interface Plinth {
  /** How far (world px) the building is lifted, so no ground under its foot stands above it. */
  lift: number;
  runs: PlinthRun[];
}

/**
 * The plinth of a building whose foot (`foot`: the corners n, e, s, w) stands at map point
 * (x, y) on ground `base` world px high, with `height` the ground's height at any map point.
 * The building is lifted to the highest ground under its foot (to half a world px) when that is
 * more than PLINTH_FROM above its base; the walls the camera sees (the S wall from w to s, lit,
 * and the E wall from s to e) are then read about one world px apart, and each stretch where the
 * ground lies more than PLINTH_FROM below the lifted foot is a run of the plinth.
 */
export function plinthOf(
  foot: readonly (readonly [number, number])[],
  x: number,
  y: number,
  base: number,
  height: (x: number, y: number) => number,
): Plinth {
  const [n, e, s, w] = foot;
  const at = (px: number, py: number) => {
    const [tx, ty] = groundTiles(px, py);
    return height(x + tx, y + ty);
  };
  let high = -Infinity;
  for (let i = 0; i <= 4; i++)
    for (let j = 0; j <= 4; j++) {
      const u = i / 4,
        v = j / 4,
        a = (1 - u) * (1 - v),
        b = u * (1 - v),
        c = u * v,
        d = (1 - u) * v;
      high = Math.max(
        high,
        at(n[0] * a + e[0] * b + s[0] * c + w[0] * d, n[1] * a + e[1] * b + s[1] * c + w[1] * d),
      );
    }
  const lift = high - base > PLINTH_FROM ? Math.round((high - base) * 2) / 2 : 0;
  const runs: PlinthRun[] = [];
  for (const [a, b, lit] of [
    [w, s, true],
    [s, e, false],
  ] as const) {
    const steps = Math.max(2, Math.ceil(Math.abs(b[0] - a[0])));
    let run: PlinthRun | null = null;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps,
        px = a[0] + (b[0] - a[0]) * t,
        py = a[1] + (b[1] - a[1]) * t,
        drop = base + lift - at(px, py);
      if (drop > PLINTH_FROM) {
        if (!run) runs.push((run = { lit, points: [] }));
        run.points.push({ x: px, y: py, drop });
      } else run = null;
    }
  }
  return { lift, runs: runs.filter((r) => r.points.length > 1) };
}

/** The limestone a plinth is built of (palette seed #BCA98B), the base colour it is mixed from. */
const LIMESTONE = PAL.stone[0];
/** The plinth's colour: limestone, toward the colour of the building's own base (`wall`). */
export function plinthColour(wall: RGB | null): RGB {
  if (!wall) return LIMESTONE;
  return [0, 1, 2].map((c) => LIMESTONE[c] * 0.7 + wall[c] * 0.3) as unknown as RGB;
}

/** A shape of a plinth's drawing: a filled polygon, or a line along `points` (x, y pairs). */
export interface PlinthShape {
  points: number[];
  colour: number;
  alpha: number;
  /** a line of this width (world px); a filled polygon without one */
  width?: number;
}
/** The face light: the left wall faces the light, the right one is in its own shade. */
const LIT = 0.95,
  SHADED = 0.74;
/** The dark line where the plinth meets the ground (the selective contour). */
const FOOT_LINE = 0x2e2820;

const hex = (rgb: readonly number[], k: number) =>
  (Math.round(Math.min(255, rgb[0] * k)) << 16) |
  (Math.round(Math.min(255, rgb[1] * k)) << 8) |
  Math.round(Math.min(255, rgb[2] * k * 0.97));

/**
 * What a plinth is drawn with, in order: each run's face in the building's base colour `colour`,
 * lit on the left wall and shaded on the right; its courses, COURSE apart and parallel to the foot,
 * with joints staggered from course to course; a light top edge; and a dark line at its foot.
 */
export function plinthShapes(plinth: Plinth, colour: RGB): PlinthShape[] {
  const out: PlinthShape[] = [];
  for (const run of plinth.runs) {
    const P = run.points,
      f = run.lit ? LIT : SHADED;
    const face: number[] = [];
    for (const p of P) face.push(p.x, p.y - TUCK);
    for (let i = P.length - 1; i >= 0; i--) face.push(P[i].x, P[i].y + P[i].drop);
    out.push({ points: face, colour: hex(colour, f), alpha: 1 });
    // the courses: a line wherever the plinth is deeper than it
    const deepest = Math.max(...P.map((p) => p.drop));
    for (let q = COURSE; q < deepest - 0.3; q += COURSE) {
      let line: number[] = [];
      const flush = () => {
        if (line.length >= 4)
          out.push({ points: line, colour: hex(colour, f * 0.8), alpha: 1, width: 0.45 });
        line = [];
      };
      for (const p of P)
        if (p.drop > q + 0.3) line.push(p.x, p.y + q);
        else flush();
      flush();
    }
    // the joints, staggered: one every six world px along a course, half a block over the next
    for (let c = 0; c * COURSE < deepest; c++)
      for (const p of P) {
        const top = c * COURSE,
          bottom = Math.min(top + COURSE, p.drop);
        if (bottom - top < 0.8) continue;
        if ((((Math.round(p.x) + c * 3) % 6) + 6) % 6 !== 0) continue;
        out.push({
          points: [p.x, p.y + top, p.x, p.y + bottom],
          colour: hex(colour, f * 0.8),
          alpha: 1,
          width: 0.45,
        });
      }
    // the light catches the top course; the foot is in the dark
    out.push({
      points: P.flatMap((p) => [p.x, p.y + 0.3]),
      colour: hex(colour, run.lit ? 1.08 : 0.86),
      alpha: 1,
      width: 0.6,
    });
    out.push({
      points: P.flatMap((p) => [p.x, p.y + p.drop]),
      colour: FOOT_LINE,
      alpha: 0.6,
      width: 0.8,
    });
  }
  return out;
}
