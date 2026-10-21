import { STR } from '../strings';

/**
 * What the title screen's New game block lets the player start from: the shipped rules or a tuning
 * saved in Game tuning. DOM-free, so it is tested under Node.
 */

/**
 * One entry of the Tuning choice. `name` is the saved tuning's name, `null` for the shipped rules:
 * an entry is told apart by it, never by its label, so a tuning named like the shipped entry
 * stays its own entry.
 */
export interface TuningEntry {
  name: string | null;
  label: string;
}

/**
 * The entries of the choice: "Shipped rules" first, then every saved tuning in the order given
 * (`listRulePresets()`, newest first). None at all when no tuning is saved: there is nothing to
 * choose, so the choice is not shown.
 */
export function tuningEntries(saved: readonly { name: string }[]): TuningEntry[] {
  if (!saved.length) return [];
  return [
    { name: null, label: STR.menu.shippedRules },
    ...saved.map((s) => ({ name: s.name, label: s.name })),
  ];
}

/**
 * The pick that survives a redraw of the choice: the tuning of that name while it is still an
 * entry, the shipped rules (`null`) once it is gone or nothing is saved.
 */
export function keepPick(entries: readonly TuningEntry[], pick: string | null): string | null {
  return pick !== null && entries.some((e) => e.name === pick) ? pick : null;
}

/** The position of the entry a pick names, 0 (the shipped rules) when none does. */
export function pickIndex(entries: readonly TuningEntry[], pick: string | null): number {
  return Math.max(
    0,
    entries.findIndex((e) => e.name === pick),
  );
}

/**
 * Start a new game from the pick: the saved tuning of that name, or the shipped rules for `null`.
 * The tuning is staged first (`stageNewGameTuning`) and the game started (`start`, which clears
 * the stored game and reloads) only when staging worked, so a refused staging leaves everything
 * as it was. Returns what to tell the player when the game was not started, null when it was.
 * The caller has already asked every replacement question and been told yes.
 */
export function startNewGame(
  pick: string | null,
  stage: (name: string | null) => boolean,
  start: () => void,
): string | null {
  if (!stage(pick)) return STR.menu.tuningUnusable(pick ?? STR.menu.shippedRules);
  start();
  return null;
}
