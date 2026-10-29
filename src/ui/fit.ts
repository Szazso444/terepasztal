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
