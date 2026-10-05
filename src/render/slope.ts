import { Matrix, type Container } from 'pixi.js';

/**
 * The ground under a sprite, in screen terms: `dz` is the screen y offset of the surface (negative
 * is up), `sgx`/`sgy` how that offset changes per tile along +x and +y.
 */
export interface Ground {
  dz: number;
  sgx: number;
  sgy: number;
}
export const LEVEL_GROUND: Ground = { dz: 0, sgx: 0, sgy: 0 };

const matrix = new Matrix();
/**
 * Places `s` (anchored at its ground contact) at world (x, y) standing on `g`: lifted by the
 * surface height and sheared so a flat-drawn footprint follows the slope. Keeps the sprite's own
 * scale (mirroring) and rotation. A local pixel (px, py) sits over ground offset
 * tx = px/64 + py/32, ty = py/32 - px/64, which the slope lifts by sgx·tx + sgy·ty.
 */
export function standOnGround(s: Container, x: number, y: number, g: Ground) {
  s.skew.set(0, 0);
  if (!g.sgx && !g.sgy) {
    s.position.set(x, y + g.dz);
    return;
  }
  shear(s, x, y + g.dz, (g.sgx - g.sgy) / 64, 1 + (g.sgx + g.sgy) / 32);
}

/**
 * How an upright body pitched along its own heading is drawn: screen y gains `p` per pixel of
 * screen x and is scaled by `q`. `along` is how the rail's screen offset changes per tile in the
 * tile-space direction (cos, sin).
 *
 * A point t tiles along the body is lifted by along·t whatever its height. Seen from the side
 * (the heading along a tile axis, the only way rails climb) its screen x tells how far along the
 * body it is, so a shear down x pitches the body and keeps its height: q = 1. A heading that runs
 * up the screen has no such x; there the body lies on the slope like a footprint (standOnGround),
 * its height scaled with the grade. Between the two the terms blend, and every blend keeps the
 * body's centre line on the rail.
 */
export function pitchShear(along: number, cos: number, sin: number): { p: number; q: number } {
  // screen x and y of one tile along the heading, in half tile widths and heights
  const sx = cos - sin,
    sy = cos + sin,
    // the footprint's terms, exact for points on the ground
    fp = (along * sx) / 64,
    fq = 1 + (along * sy) / 32,
    upright = Math.min(1, Math.max(0, (Math.abs(sx) - 0.25) / 0.5));
  if (!upright) return { p: fp, q: fq };
  return { p: fp + (along / (32 * sx) - fp) * upright, q: fq + (1 - fq) * upright };
}

/** Screen pixels a height of one tile side spans (terrainRelief's TILE_SIDE_PX; a level is a quarter). */
const UP_PX = (32 * Math.SQRT2 * Math.sqrt(3)) / 2;

/**
 * A body pitched along its own heading as a whole: the screen-space map [x', y'] =
 * [a·x + c·y, b·x + d·y] that carries the picture of a level body to the picture of the same
 * body tilted nose-up or nose-down on the grade. `along` is how the rail's screen offset changes
 * per tile in the tile-space direction (cos, sin).
 *
 * In the world the pitch turns "one tile forward" F into F + t·U and "one tile up" U into
 * U − t·F, with t the grade (tiles of height per tile; the body keeps its length over the ground,
 * so it grows by 1/cos of the pitch, a few percent at most). On screen F is (32·(cos − sin),
 * 16·(cos + sin)) and U is (0, −UP_PX); the map is the one that takes those two pictures to the
 * pictures of the turned vectors. So uprights lean with the body, as on a real climb, where
 * pitchShear keeps them upright and only slides the body along its length. Exact for the body's
 * centre plane; a point half a body-width to the side is off by about two pixels on the steepest
 * grade. A heading that runs up the screen has no screen x to tilt about: there the body lies on
 * the slope like a footprint, and between the two the maps blend (rails only climb along the tile
 * axes, where the tilt is whole).
 */
export function pitchTilt(
  along: number,
  cos: number,
  sin: number,
): { a: number; b: number; c: number; d: number } {
  const sx = cos - sin,
    sy = cos + sin,
    // the footprint's map, exact for points on the ground
    fp = (along * sx) / 64,
    fq = 1 + (along * sy) / 32,
    upright = Math.min(1, Math.max(0, (Math.abs(sx) - 0.25) / 0.5));
  if (!upright) return { a: 1, b: fp, c: 0, d: fq };
  const fx = 32 * sx,
    fy = 16 * sy,
    t = -along / UP_PX,
    lean = (t * fy) / UP_PX;
  return {
    a: 1 - lean * upright,
    b: fp + ((-t * (UP_PX * UP_PX + fy * fy)) / (UP_PX * fx) - fp) * upright,
    c: ((t * fx) / UP_PX) * upright,
    d: fq + (1 + lean - fq) * upright,
  };
}

/**
 * Places `s` (anchored at its ground contact) at world (x, y) on a rail at screen offset `dz`
 * that climbs `along` per tile in the tile-space direction (cos, sin): the body tilted along its
 * heading as a whole (pitchTilt). Keeps the sprite's own scale (mirroring) and rotation, or takes
 * the sprite's own map `local` in their place (mirroring and the swing between two facings).
 */
export function pitchOnRail(
  s: Container,
  x: number,
  y: number,
  dz: number,
  along: number,
  cos: number,
  sin: number,
  local?: { a: number; b: number; c: number; d: number },
) {
  s.skew.set(0, 0);
  if (!along && !local) {
    s.position.set(x, y + dz);
    return;
  }
  const rc = Math.cos(s.rotation),
    rs = Math.sin(s.rotation),
    a = local ? local.a : rc * s.scale.x,
    b = local ? local.b : rs * s.scale.x,
    c = local ? local.c : -rs * s.scale.y,
    d = local ? local.d : rc * s.scale.y;
  if (!along) {
    matrix.set(a, b, c, d, x, y + dz);
    s.setFromMatrix(matrix);
    return;
  }
  const m = pitchTilt(along, cos, sin);
  matrix.set(m.a * a + m.c * b, m.b * a + m.d * b, m.a * c + m.c * d, m.b * c + m.d * d, x, y + dz);
  s.setFromMatrix(matrix);
}

/** Sets `s` at (x, y) with its own scale and rotation, then screen y sheared by p·x and scaled by q. */
function shear(s: Container, x: number, y: number, p: number, q: number) {
  const cos = Math.cos(s.rotation),
    sin = Math.sin(s.rotation),
    a = cos * s.scale.x,
    b = sin * s.scale.x,
    c = -sin * s.scale.y,
    d = cos * s.scale.y;
  matrix.set(a, p * a + q * b, c, p * c + q * d, x, y);
  s.setFromMatrix(matrix);
}
