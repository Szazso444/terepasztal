import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MenuBar } from './menuBar';
import { PICK_GRACE_MS, type MenuAction } from './menuBarModel';

vi.mock('../engine/audio', () => ({ sfx: () => {} }));

/** As much of an element as `MenuBar` touches. */
class FakeElement {
  className = '';
  textContent = '';
  title = '';
  innerHTML = '';
  readonly style: Record<string, string> = {};
  readonly kids: FakeElement[] = [];
  readonly classList = { toggle: () => {} };
  private attrs = new Set<string>();
  private handlers = new Map<string, ((e: unknown) => void)[]>();

  setAttribute(k: string) {
    this.attrs.add(k);
  }
  hasAttribute(k: string) {
    return this.attrs.has(k);
  }
  append(...kids: FakeElement[]) {
    this.kids.push(...kids);
  }
  prepend(...kids: FakeElement[]) {
    this.kids.unshift(...kids);
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  getBoundingClientRect() {
    return { left: 0 };
  }
  fire(type: string) {
    for (const fn of this.handlers.get(type) ?? []) fn({ stopPropagation() {} });
  }
}

/** Where an event lands: the selectors `closest` finds around it. */
const on = (...around: string[]) => ({
  closest: (s: string) => (s.split(', ').some((x) => around.includes(x)) ? {} : null),
});
const MAP = on();
const UI = on('#ui-root');
const ENTRY = on('.mb-entry', '#ui-root');
const PANE = on('#menu-pane', '#ui-root');
const [LEFT, MIDDLE, RIGHT] = [0, 1, 2];

describe('the menu bar and the document', () => {
  let now = 1000;
  const listeners = new Map<string, (e: unknown) => void>();
  let ran: string[];
  let bar: MenuBar;

  const element = (e: HTMLElement) => e as unknown as FakeElement;
  /** A child of `parent` by its text. */
  const named = (parent: HTMLElement, text: string) =>
    element(parent).kids.find((k) => k.textContent === text)!;
  const openView = () => named(bar.root, 'View').fire('click');
  const pickWeather = () => named(bar.pane, 'Weather').fire('click');

  /** A mouse press; true when the page under the target gets it. */
  function press(target: unknown, button = LEFT) {
    let goesOn = true;
    listeners.get('mousedown')!({ target, button, stopPropagation: () => (goesOn = false) });
    return goesOn;
  }

  beforeEach(() => {
    listeners.clear();
    ran = [];
    vi.stubGlobal('document', {
      createElement: () => new FakeElement(),
      addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, fn),
    });
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    bar = new MenuBar(() => () => []);
    bar.actions = new Proxy({} as Record<MenuAction, () => void>, {
      get: (_, action: string) => () => ran.push(action),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps a left press on the map from the map, and closes the menu', () => {
    openView();
    expect(press(MAP, LEFT)).toBe(false);
    expect(bar.isOpen).toBe(false);
    expect(press(MAP, LEFT), 'the next press is the map’s').toBe(true);
  });

  it('closes the menu on a right or middle press on the map, and the map gets it', () => {
    for (const button of [RIGHT, MIDDLE]) {
      openView();
      expect(press(MAP, button), `button ${button}`).toBe(true);
      expect(bar.isOpen, `button ${button}`).toBe(false);
    }
  });

  it('closes the menu on a press over the rest of the UI, and the press goes on', () => {
    openView();
    expect(press(UI)).toBe(true);
    expect(bar.isOpen).toBe(false);
  });

  it('leaves a press on an entry or on the pane to the click that follows', () => {
    openView();
    for (const target of [ENTRY, PANE]) {
      expect(press(target)).toBe(true);
      expect(bar.isOpen).toBe(true);
    }
  });

  it('keeps the second press of a double-click on a row from the map', () => {
    openView();
    pickWeather();
    expect(ran).toEqual(['weather']);
    expect(bar.isOpen).toBe(false);
    now += PICK_GRACE_MS - 1;
    expect(press(MAP)).toBe(false);
  });

  it('gives the map its press once the grace is over, and right away to the other buttons', () => {
    openView();
    pickWeather();
    expect(press(MAP, RIGHT)).toBe(true);
    now += PICK_GRACE_MS;
    expect(press(MAP)).toBe(true);
  });
});
