import type { Rules } from '../sim/rules';
import { weeklyOutput } from '../sim/stations';

/**
 * Units a week the build preview shows for a harvesting station on ground of `factor`
 * (`Builder.harvestFactor`): a level 1 station's `weeklyOutput`, which is also what
 * `Station.productionPerWeek` gives it once placed, before the season and the biome.
 * `LEVELS.production` is already a week's worth, so nothing scales it. `tuning` is the live rules
 * unless a caller holds another.
 */
export function harvestPreviewPerWeek(factor: number, tuning?: Pick<Rules, 'productionMul'>) {
  return weeklyOutput(1, factor, tuning);
}
