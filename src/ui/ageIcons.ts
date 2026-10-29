/**
 * One line icon per age, for the era widget by the date (src/ui/hud.ts): 24 × 24 stroke SVG in the
 * current colour, the shapes of the UI workshop's `ICONS.age_*`. The markup is fixed here, never
 * built from data, so the widget can put it in as HTML.
 */

/** Shapes in a 24 × 24 box, stroked in the current colour; CSS sets the size. */
function svg(shapes: string): string {
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes}</svg>`
  );
}

/** By age id (`src/data/ages.json`). */
export const AGE_ICONS: Record<string, string> = {
  // a chimney with puffs
  steam: svg(
    '<path d="M5 20h14M7 20v-5h10v5M9 15V10h4v5"/>' +
      '<path d="M10 7c0-1.6 1.6-1.6 1.6-3.2M14 8c0-1.6 1.6-1.6 1.6-3.2"/>',
  ),
  // a drop
  diesel: svg(
    '<path d="M12 3c3.2 4.2 5.5 7.2 5.5 10.2a5.5 5.5 0 0 1-11 0C6.5 10.2 8.8 7.2 12 3z"/>' +
      '<path d="M9.5 14a2.5 2.5 0 0 0 2.5 2.5"/>',
  ),
  // a lightning bolt
  electric: svg('<path d="M13 2.5L5.5 13.5h5.5l-1 8 7.5-11h-5.5z"/>'),
  // an atom
  nuclear: svg(
    '<circle cx="12" cy="12" r="1.4"/>' +
      '<ellipse cx="12" cy="12" rx="9" ry="3.5"/>' +
      '<ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(60 12 12)"/>' +
      '<ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(120 12 12)"/>',
  ),
  // a horseshoe magnet
  magnetic: svg(
    '<path d="M5 3.5v8.5a7 7 0 0 0 14 0V3.5h-4V12a3 3 0 0 1-6 0V3.5z"/>' +
      '<path d="M5 7.5h4M15 7.5h4"/>',
  ),
  // a ring tube
  hyper: svg(
    '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3.5"/>' +
      '<path d="M1.5 12h3M19.5 12h3"/>',
  ),
};

/** An age with no icon of its own: a clock face. */
const GENERIC = svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>');

/** The icon of an age by id, or the generic one. */
export function ageIcon(id: string): string {
  // own keys only: an id such as `constructor` is no icon
  return Object.hasOwn(AGE_ICONS, id) ? AGE_ICONS[id] : GENERIC;
}
