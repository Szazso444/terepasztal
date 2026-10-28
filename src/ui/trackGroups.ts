import { BUILDABLE_CLASSES, LINES, type TrackClass, type TrackItem } from '../world/track';
import { STR } from '../strings';

/**
 * The toolbar lists track by type. One type is open at a time; inside it each shape has a fixed
 * slot (the number key that picks it), so a key means the same shape in every type.
 */
export type TrackGroupId = TrackClass | 'bridges';
export const TRACK_GROUPS: TrackGroupId[] = [...BUILDABLE_CLASSES, 'bridges'];

/** A bigger standard line, or a separate network, claims the pieces it shares with a smaller line. */
const rank = (cls: TrackClass) => (LINES[cls].network === 'standard' ? LINES[cls].tier : 10);

/** The type a piece is listed under: for a piece of two lines, the bigger or separate one. */
export function trackGroupOf(item: TrackItem): TrackClass {
  const other = item.cls2 ?? item.cls;
  return rank(other) > rank(item.cls) ? other : item.cls;
}

const SHAPE_SLOT: Partial<Record<TrackItem['kind'], number>> = { straight: 0, curve: 1, switch: 2 };
/** Slot in its type: 0 straight, 1 curve, 2 switch, 3 its own crossing, 4 a crossing with another line. */
export function trackSlot(item: TrackItem): number {
  const shape = SHAPE_SLOT[item.kind];
  if (shape !== undefined) return shape;
  if (item.kind === 'crossing' && (item.cls2 ?? item.cls) === item.cls) return 3;
  return 4;
}

/** A piece's name on its button: the type is on the row above, so only what sets it apart stays. */
export function shortName(item: TrackItem, base: string): string {
  const other = item.cls2 ?? item.cls;
  if (item.kind !== 'crossing' || other === item.cls) return base;
  const group = trackGroupOf(item);
  return `${base} × ${STR.toolbar.trackClass[group === item.cls ? other : item.cls]}`;
}

/** The type after (or before) `current` that has something to offer; `current` when none has. */
export function stepGroup(
  groups: readonly string[],
  current: string,
  dir: 1 | -1,
  has: (group: string) => boolean,
): string {
  const at = groups.indexOf(current);
  if (at < 0) return groups.find(has) ?? current;
  for (let n = 1; n <= groups.length; n++) {
    const g = groups[(at + dir * n + groups.length * n) % groups.length];
    if (has(g)) return g;
  }
  return current;
}

/** The piece in `slot`, or the type's first piece when it has no such slot. */
export function slotMate<T extends { slot?: number }>(items: T[], slot: number): T | undefined {
  return items.find((i) => i.slot === slot) ?? items[0];
}
