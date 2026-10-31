/**
 * Small parts the economy screens (Contracts, Market, Crafting, Roster, Inspect 3D) share and the
 * kit does not have: a resource's icon, a model's picture, a meter whose numbers change in place,
 * and the scroll a screen keeps when another one has covered it.
 */
import type { AtlasRegistry } from '../engine/atlas';
import { el } from './dom';
import { meter } from './kit';
import { portraitImg } from './rosterPortraits';
import { frameForItem, spriteImg } from './spritePreview';

type Content = Node | string | null | undefined;

/** Nodes side by side with no element around them, for a place that takes one `Content`. */
export function fragment(...parts: Content[]): DocumentFragment {
  const f = document.createDocumentFragment();
  for (const p of parts) if (p !== null && p !== undefined) f.append(p);
  return f;
}

/** The painted icon of a resource, `icons/<id>` of the atlas; empty when the atlas has none. */
export function resIcon(atlas: AtlasRegistry, id: string): HTMLElement {
  return spriteImg(atlas, `icons/${id}`, 1, 'sprite-preview ec-res');
}

/** The picture of a model: its portrait where it has one, the atlas sprite otherwise. */
export function vehicleArt(atlas: AtlasRegistry, defId: string, scale = 2): HTMLElement {
  return (
    portraitImg(defId, 'ec-portrait') ??
    spriteImg(atlas, frameForItem(defId), scale, 'sprite-preview ec-sprite')
  );
}

/** A kit meter whose value and fill are set again as the numbers change, without a rebuild. */
export interface LiveMeter {
  root: HTMLElement;
  set(value: string, share: number, tone: string): void;
}

export function liveMeter(label: string): LiveMeter {
  const root = meter(label, '', 0);
  const value = root.querySelector('b') as HTMLElement;
  const fill = root.querySelector('.k-bar > i') as HTMLElement;
  return {
    root,
    set(text, share, tone) {
      if (value.textContent !== text) value.textContent = text;
      const w = `${Math.min(100, Math.max(0, share * 100))}%`;
      if (fill.style.width !== w) fill.style.width = w;
      root.className = `k-meter ${tone}`.trim();
    },
  };
}

/**
 * Keeps where an element was scrolled to across a rebuild of what it holds, and across its being
 * taken out of the page while another screen covers it (which resets it to the top).
 */
export class ScrollKeep {
  private saved = 0;

  constructor(private readonly box: HTMLElement) {
    box.addEventListener('scroll', () => (this.saved = box.scrollTop));
    // put back in the page it is laid out again: the scroll comes back before it is painted
    if (typeof ResizeObserver !== 'undefined')
      new ResizeObserver(() => this.restore()).observe(box);
  }
  /** Back to the top: a filter or a tab starts its list again. */
  top() {
    this.saved = 0;
    this.box.scrollTop = 0;
  }
  /** Run `rebuild`, then put the scroll back as far as the new content allows. */
  around(rebuild: () => void) {
    const at = this.box.scrollTop || this.saved;
    rebuild();
    this.box.scrollTop = at;
  }
  /** Once the element is back in the page, put the scroll back (call at every refresh). */
  restore() {
    if (this.box.isConnected && this.box.scrollTop === 0 && this.saved > 0)
      this.box.scrollTop = this.saved;
  }
}

/** A text node's worth of text, replaced only when it differs (no repaint for the same). */
export function setText(e: HTMLElement, text: string) {
  if (e.textContent !== text) e.textContent = text;
}

/** A tab or filter whose label a decoration (an icon, stars) goes before. */
export function decorateSegmented(seg: HTMLElement, marks: readonly (Node | null)[]) {
  const buttons = [...seg.querySelectorAll('button')];
  marks.forEach((m, i) => {
    if (m) buttons[i]?.prepend(m, ' ');
  });
}

/** A labelled switch laid on one line, the label to its right. */
export function switchLine(sw: HTMLElement, label: string): HTMLElement {
  return el('label', { class: 'ec-sw' }, sw, el('span', { text: label }));
}
