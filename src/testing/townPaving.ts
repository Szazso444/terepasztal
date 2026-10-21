// What the painter takes from a town's paving, for the tests that compare two pavings point by
// point (the paving's own properties in townPaving.test.ts, the landscape's repainting in
// worldRenderer.test.ts). Plain TypeScript with no test framework.

import { PAVING_FRINGE, type TownPaving } from '../render/townPaving';

/** What the painter takes from the paving at map point (x, y): its distance and colour there. */
export function picture(p: TownPaving, x: number, y: number) {
  const d = p.near(Math.round(y) * p.w + Math.round(x)) ? p.distance(x, y) : -9;
  if (d <= -PAVING_FRINGE) return [];
  if (d <= 0) return [d, p.fringe(x, y, d)];
  const out = [0, 0, 0];
  p.paint(x, y, d, [70, 190, 60], 1, out);
  return [d, ...out];
}
