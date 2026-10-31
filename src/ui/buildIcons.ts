/**
 * The icons of the build bar: its categories, its Q and E arrows, the lock, the Upgrade and
 * Downgrade arrows and the build card's close mark. Drawn for the game in `currentColor` on a 24 px
 * grid, in the manner of `ageIcon.ts`; none comes from an icon set, so none has a credit.
 */
import type { AtlasRegistry } from '../engine/atlas';
import { el } from './dom';
import { spriteImg } from './spritePreview';

export type BuildIcon =
  | 'rail'
  | 'station'
  | 'gear'
  | 'factory'
  | 'road'
  | 'mountain'
  | 'demolish'
  | 'chevl'
  | 'chevr'
  | 'up'
  | 'down'
  | 'lock'
  | 'close';

/** The inside of each icon. */
export const BUILD_ICON: Record<BuildIcon, string> = {
  rail: '<path d="M8.5 3L6 21M15.5 3L18 21M6.8 7.5h10.4M6.2 12h11.6M5.6 16.5h12.8"/>',
  station: '<path d="M3 10l9-6 9 6M5 10v10h14V10M10 20v-5h4v5M3 20h18"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  factory: '<path d="M3 21V10l5 3v-3l5 3V6h3l1-3h2l1 3v15zM3 21h18"/>',
  road: '<path d="M8 3L4 21M16 3l4 18M12 4v3M12 10.5v3M12 17v3.5"/>',
  mountain: '<path d="M2 20l7-12 4 6.5 3-4 6 9.5z"/>',
  demolish: '<path d="M14 3.5l6.5 6.5-3 3L11 6.5zM11.5 7L3 15.5 6.5 19 15 10.5"/>',
  chevl: '<path d="M15 5l-7 7 7 7"/>',
  chevr: '<path d="M9 5l7 7-7 7"/>',
  up: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 4v15M6 13l6 6 6-6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};

/** An icon as SVG markup; DOM-free so it runs under Node. */
export function buildIconSvg(id: BuildIcon, size: number): string {
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
    `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `${BUILD_ICON[id]}</svg>`
  );
}

/** An icon as an element: fixed markup from this file, never from data. */
export function buildIcon(id: BuildIcon, size: number): HTMLElement {
  const s = el('span', { class: 'build-icon' });
  s.innerHTML = buildIconSvg(id, size);
  return s;
}

/**
 * What stands for an item of the bar, in the tile and on the build card: its sprite, or its inline
 * icon. `size` is the icon's; a sprite takes its size from `cls`.
 */
export function itemPicture(
  atlas: AtlasRegistry,
  item: { frame: string; icon?: BuildIcon },
  cls: string,
  size: number,
): HTMLElement {
  if (!item.icon) return spriteImg(atlas, item.frame, 1, `sprite-preview ${cls}`);
  const icon = buildIcon(item.icon, size);
  icon.classList.add(cls);
  return icon;
}
