/**
 * Which bridge platforms a road change at (x, y) can touch (#496). A road laid on or taken off a
 * platform changes the span of the road platforms beside it along their axis (`bridgeSpan`,
 * `roadDeckAxis`), and a road beside a platform can change that platform's axis; so the tile and
 * its four neighbours are the ones to look at. Pure, so a headless test can call it; `Game` only
 * marks the bridges dirty when this says some are touched.
 */
export function bridgeTilesTouched(
  hasBridge: (x: number, y: number) => boolean,
  x: number,
  y: number,
): boolean {
  return (
    hasBridge(x, y) ||
    hasBridge(x + 1, y) ||
    hasBridge(x - 1, y) ||
    hasBridge(x, y + 1) ||
    hasBridge(x, y - 1)
  );
}
