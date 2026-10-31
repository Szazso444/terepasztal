/**
 * A screen that is refreshed twice a second must not be built again twice a second: what the
 * player points at, scrolls or types in would go with it. A screen builds its parts once and binds
 * the few things that change to functions; a refresh runs them, and each writes only when its
 * value differs from what it shows.
 */

/** The parts of an element a binding writes; a test passes a fake. */
export interface TextNode {
  textContent: string | null;
}
export interface ClassNode {
  classList: { toggle(name: string, on?: boolean): boolean };
}
export interface StyleNode {
  style: { width: string };
}

export class Bindings {
  private updaters: (() => void)[] = [];

  /** Run every binding once now, and again at each `run`. */
  add(update: () => void) {
    this.updaters.push(update);
    update();
  }
  /** The element's text follows `get`. */
  text<E extends TextNode>(node: E, get: () => string): E {
    this.add(() => {
      const s = get();
      if (node.textContent !== s) node.textContent = s;
    });
    return node;
  }
  /** The element holds `name` while `get` says so. */
  toggle<E extends ClassNode>(node: E, name: string, get: () => boolean): E {
    this.add(() => node.classList.toggle(name, get()));
    return node;
  }
  /** The element holds the one of `names` that `get` returns (none for ''), and no other. */
  tone<E extends ClassNode>(node: E, names: readonly string[], get: () => string): E {
    this.add(() => {
      const now = get();
      for (const n of names) node.classList.toggle(n, n === now);
    });
    return node;
  }
  /** The element is as wide as `get` says, 0 to 1 of its parent. */
  width<E extends StyleNode>(node: E, get: () => number): E {
    this.add(() => {
      const w = `${Math.min(100, Math.max(0, get() * 100))}%`;
      if (node.style.width !== w) node.style.width = w;
    });
    return node;
  }
  /** Run every binding. */
  run() {
    for (const u of this.updaters) u();
  }
  /** Forget them all, as the part they belong to is built again. */
  clear() {
    this.updaters = [];
  }
  get size() {
    return this.updaters.length;
  }
}

/** What a meter shows: its value as text, how full it is (0 to 1) and its tone. */
export interface MeterState {
  value: string;
  share: number;
  tone: '' | 'warn' | 'bad';
}

/** Bind a kit meter (its value, its fill and its tone) to what `get` says. */
export function bindMeter(live: Bindings, meter: HTMLElement, get: () => MeterState): HTMLElement {
  const value = meter.querySelector('b');
  const fill = meter.querySelector<HTMLElement>('.k-bar > i');
  // one reading per run, shared by the three parts
  let now: MeterState = { value: '', share: 0, tone: '' };
  live.add(() => (now = get()));
  if (value) live.text(value, () => now.value);
  if (fill) live.width(fill, () => now.share);
  live.tone(meter, ['warn', 'bad'], () => now.tone);
  return meter;
}

/**
 * The scroll positions of a screen's scrolling parts, kept for the time its root is out of the
 * page (a screen over it covers it): the browser resets a scroll to 0 when the element is
 * attached again, and this puts it back at the next resize the page reports.
 */
export function keepScroll(root: HTMLElement): void {
  if (typeof ResizeObserver === 'undefined') return;
  const saved = new Map<Element, number>();
  // a scroll does not bubble, but a capturing listener on the root still hears it
  root.addEventListener(
    'scroll',
    (e) => {
      const part = e.target as Element;
      if (part.scrollTop > 0) saved.set(part, part.scrollTop);
      else saved.delete(part);
    },
    true,
  );
  new ResizeObserver(() => {
    for (const [part, was] of saved) {
      if (!root.contains(part)) saved.delete(part);
      else if (part.scrollTop === 0) part.scrollTop = was;
    }
  }).observe(root);
}
