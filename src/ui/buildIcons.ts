/**
 * The icons of the build bar (its categories, its Q and E arrows, the lock, the Upgrade and
 * Downgrade arrows and the build card's close mark) and of the outliner and the train panel (their
 * tabs, the status chips and the eye). They are the design mock's own, with the road added in their
 * style, in `currentColor` on a 24 px grid, in the manner of `ageIcon.ts`.
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
  | 'drill'
  | 'lock'
  | 'close'
  | 'train'
  | 'scroll'
  | 'eye'
  | 'clock'
  | 'alert'
  | 'play'
  | 'cargo'
  | 'fuel';

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
  drill: '<path d="M4 4l5 5M3 10l7-7 5 5-7 7zM12 12l9 9-5-1-5-3z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  train:
    '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 10.5h14M8.5 21l2-4M15.5 21l-2-4"/><circle cx="9" cy="13.8" r=".6"/><circle cx="15" cy="13.8" r=".6"/>',
  scroll:
    '<path d="M7 3h11v14.5a3.5 3.5 0 0 1-3.5 3.5H7.5A3.5 3.5 0 0 1 4 17.5V17h10v.5a3.5 3.5 0 0 0 3.5 3.5M7 3a2.5 2.5 0 0 0-2.5 2.5V8H7M10 8h5M10 12h5"/>',
  eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
  alert: '<path d="M12 3.5L21.5 20h-19zM12 10v4.5M12 17.2v.3"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  cargo: '<path d="M3 7.5l9-4.5 9 4.5v9l-9 4.5-9-4.5z"/><path d="M3 7.5l9 4.5 9-4.5M12 12v9"/>',
  fuel: '<path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3.5 21h13M15 9h2a2 2 0 0 1 2 2v5.5a1.5 1.5 0 0 0 3 0V8l-3-3M7.5 7h5"/>',
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
