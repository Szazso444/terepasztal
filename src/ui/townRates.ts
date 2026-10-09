import { STR } from '../strings';
import { CARGO } from '../sim/cargo';

/** Display names of the cargo, by id. */
const CARGO_NAMES = new Map(CARGO.map((c) => [c.id, c.name]));

/** What the town panel calls an id in its makes and uses lists, or null for one it skips. */
export function rateLabel(id: string): string | null {
  if (id === 'power') return STR.town.power;
  const name = CARGO_NAMES.get(id);
  return name === undefined ? null : name.toLowerCase();
}

/**
 * A town's weekly production or consumption as the town panel lists it: largest first, in whole
 * units, leaving out anything under half a unit and any id that is neither power nor a cargo.
 * `-` when nothing is left.
 */
export function formatRates(rec: Record<string, number>): string {
  const parts = Object.entries(rec)
    .filter(([, v]) => v >= 0.5)
    .sort((a, b) => b[1] - a[1])
    .flatMap(([k, v]) => {
      const label = rateLabel(k);
      return label === null ? [] : [`${Math.round(v)} ${label}`];
    });
  return parts.length ? parts.join(', ') : '-';
}
