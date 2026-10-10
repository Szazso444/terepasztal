/** A single affine map preserves every straight roof ridge and vertical wall edge.
 * Ground directions are estimated from the source walls, not the pitched roof.
 * No independent face stretch: that requires a roof-aware mesh or 3D source.
 */
import { rectifyProjection } from '../../tools/illustrated-sprites.mjs';
export const stationSlopes = [0.324, -0.295];
export function calibrateStation(src) {
  return rectifyProjection(src, ...stationSlopes);
}
