/**
 * When a bar tightens its spacing (its `compact` class): the resource bar (src/ui/resourceBar.ts)
 * and the top bar (src/ui/hud.ts) measure themselves with compact off and ask these. DOM-free, so
 * Node tests read them.
 */

/** A box's content width and its own, as `scrollWidth` and `clientWidth` give them. */
export interface Measured {
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

/** The content overflows its box: tighten the spacing. */
export const needsCompact = (scrollWidth: number, clientWidth: number) => scrollWidth > clientWidth;

/**
 * Whether the top bar takes its compact spacing, from boxes measured with compact off: the bar
 * itself, and the boxes that give way when it is short of room (the screen buttons, the weather
 * text), each cut once its content is wider than it is. A hidden box measures 0 and fits. Null
 * while the bar is not laid out (hidden, or before its first layout): keep the last answer.
 */
export function topbarCompact(bar: Measured, giving: readonly Measured[]): boolean | null {
  if (!bar.clientWidth) return null;
  return [bar, ...giving].some((b) => needsCompact(b.scrollWidth, b.clientWidth));
}

/**
 * How tight the top bar's spacing is: 0 normal, 1 compact (tighter spacing, the weather text in
 * its toggle's tooltip), 2 compact without the era's name as well.
 */
export type CompactLevel = 0 | 1 | 2;

/**
 * The first level, from the loosest, at which the bar fits. `overflows(level)` lays the bar out
 * at that level and says whether it is still short of room (`topbarCompact`), or null while it is
 * not laid out (keep the last answer). Each level is measured on its own, from level 0 up and no
 * further than needed, so the answer never depends on the one before and cannot flip back and
 * forth; the last level is the answer when even it is short, as there is nothing tighter.
 */
export function compactLevel(
  overflows: (level: CompactLevel) => boolean | null,
): CompactLevel | null {
  for (const level of [0, 1] as const) {
    const short = overflows(level);
    if (short === null) return null;
    if (!short) return level;
  }
  return 2;
}
