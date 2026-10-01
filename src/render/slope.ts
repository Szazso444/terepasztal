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
  const cos = Math.cos(s.rotation),
    sin = Math.sin(s.rotation),
    a = cos * s.scale.x,
    b = sin * s.scale.x,
    c = -sin * s.scale.y,
    d = cos * s.scale.y,
    p = (g.sgx - g.sgy) / 64,
    q = 1 + (g.sgx + g.sgy) / 32;
  matrix.set(a, p * a + q * b, c, p * c + q * d, x, y + g.dz);
  s.setFromMatrix(matrix);
}
