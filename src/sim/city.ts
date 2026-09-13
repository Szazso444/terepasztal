import type { House } from './houses';
import type { GameMap } from '../world/tiles';
import { Terrain } from '../world/tiles';

/** Any sliding 6×6 neighbourhood with 200 housed residents receives cosmetic city paving. */
export function cityTiles(
  map: GameMap,
  houses: Iterable<House>,
  inTown: (x: number, y: number) => boolean = () => true,
): Set<number> {
  const stride = map.w + 1,
    sums = new Float64Array(stride * (map.h + 1));
  for (const h of houses)
    if (h.progress >= 1 && inTown(h.x, h.y)) sums[(h.y + 1) * stride + h.x + 1] += h.residents;
  for (let y = 1; y <= map.h; y++)
    for (let x = 1; x <= map.w; x++)
      sums[y * stride + x] +=
        sums[y * stride + x - 1] + sums[(y - 1) * stride + x] - sums[(y - 1) * stride + x - 1];
  const out = new Set<number>();
  for (let y = 0; y + 6 <= map.h; y++)
    for (let x = 0; x + 6 <= map.w; x++) {
      const n =
        sums[(y + 6) * stride + x + 6] -
        sums[y * stride + x + 6] -
        sums[(y + 6) * stride + x] +
        sums[y * stride + x];
      if (n < 200) continue;
      for (let dy = 0; dy < 6; dy++)
        for (let dx = 0; dx < 6; dx++) {
          const k = (y + dy) * map.w + x + dx,
            t = map.terrain[k];
          if (t !== Terrain.Water && t !== Terrain.Rock && t !== Terrain.Mountain) out.add(k);
        }
    }
  return out;
}
