import { Terrain } from '../world/tiles';
import type { TrackGraph } from '../world/track';
import { DIR_DX, DIR_DY, opposite } from '../engine/iso';
import { content } from '../data/content';

/**
 * Track on rock and mountain (#322): nothing is built on either ground, and the builder lays track
 * there only as the continuation of a line (`Builder.trackRules`). That is a rule of drawing, not
 * of the ground: a load keeps rock and mountain under every piece, and under a signal on one
 * (`repairBuiltTiles` in src/engine/loadRepair.ts), so a piece left alone when the track around it
 * goes keeps its mountain too.
 */

/** Rock and mountain: no building stands on them, and track only continues a line onto them. */
export function stone(t: Terrain): boolean {
  return t === Terrain.Rock || t === Terrain.Mountain;
}

/**
 * Does the piece `piece` holds on `tiles` continue a line of `track`: does one of its ports lead
 * off its footprint onto a tile whose track opens back toward it? Track beside the piece that runs
 * past it (a perpendicular straight) does not join it, and neither do the piece's own tiles.
 * `piece` holds the piece alone, as `TrackGraph.place` lays it.
 */
export function continuesLine(
  track: Pick<TrackGraph, 'opensTo'>,
  piece: Pick<TrackGraph, 'get'>,
  tiles: readonly { x: number; y: number }[],
): boolean {
  return tiles.some((t) =>
    (piece.get(t.x, t.y)?.links ?? []).some((link) =>
      link.some((d) => {
        const nx = t.x + DIR_DX[d],
          ny = t.y + DIR_DY[d];
        if (tiles.some((q) => q.x === nx && q.y === ny)) return false;
        return track.opensTo(nx, ny, opposite(d));
      }),
    ),
  );
}

/**
 * Decor `id` stands on the rails and asks nothing of the ground (a signal): it goes wherever track
 * is, mountain track included. Unknown decor asks the ground.
 */
export function onRails(id: string): boolean {
  const def = content.decor.find((d) => d.id === id);
  return !!def && def.onTrack && !def.anyTile;
}
