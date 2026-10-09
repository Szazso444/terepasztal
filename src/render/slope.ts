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

/**
 * Places `s` (anchored at its ground contact) at world (x, y) on a rail at screen offset `dz`
 * that climbs `along` per tile in the tile-space direction (cos, sin): an upright body pitched
 * along its heading, which keeps its height on a grade (pitchShear). Keeps the sprite's own scale
 * (mirroring) and rotation.
 */
export function pitchOnRail(
  s: Container,
  x: number,
  y: number,
  dz: number,
  along: number,
  cos: number,
  sin: number,
) {
  s.skew.set(0, 0);
  if (!along) {
    s.position.set(x, y + dz);
    return;
  }
  const { p, q } = pitchShear(along, cos, sin);
  shear(s, x, y + dz, p, q);
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
