import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MenuBar } from './menuBar';
import { MENU_BAR, PICK_GRACE_MS, type MenuAction } from './menuBarModel';
import type { TipDoc } from './tooltipDoc';

vi.mock('../engine/audio', () => ({ sfx: () => {} }));

/** As much of an element as `MenuBar` touches. */
class FakeElement {
  className = '';
  textContent = '';
  title = '';
  innerHTML = '';
  readonly style: Record<string, string> = {};
  readonly kids: FakeElement[] = [];
  readonly on = new Set<string>();
  /** how many times it let go of the keys */
  blurred = 0;
  readonly classList = {
    toggle: (c: string, on: boolean) => (on ? this.on.add(c) : this.on.delete(c)),
  };
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
  replaceChildren(...kids: FakeElement[]) {
    this.kids.splice(0, this.kids.length, ...kids);
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  blur() {
    this.blurred++;
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
  /** A row of the pane by its text. */
  const row = (text: string) => element(bar.pane).kids.find((k) => k.textContent === text)!;
  /** An entry's button: in its cell, its label beside the icon. */
  const entry = (text: string) =>
    element(bar.root)
      .kids.map((cell) => cell.kids[0])
      .find((b) => b.kids.some((k) => k.textContent === text))!;
  const openView = () => entry('View').fire('click');
  const pickWeather = () => row('Weather').fire('click');

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

  it('closes the menu on the wheel over the map, which zooms there', () => {
    openView();
    listeners.get('wheel')!({ target: MAP });
    expect(bar.isOpen).toBe(false);
  });

  it('stays open under the wheel over the UI, which zooms nothing', () => {
    openView();
    listeners.get('wheel')!({ target: UI });
    expect(bar.isOpen).toBe(true);
  });

  it('draws every entry with its icon and its label', () => {
    const shown = element(bar.root).kids.filter((cell) => cell.style.display !== 'none');
    expect(shown).toHaveLength(10);
    for (const cell of shown) expect(cell.kids[0].kids[0].className).toContain('k-ic');
    expect(entry('Save').kids[1].textContent).toBe('Save');
  });

  it('runs Save at once, with no pane', () => {
    entry('Save').fire('click');
    expect(ran).toEqual(['save']);
    expect(bar.isOpen).toBe(false);
  });

  it('lets go of an entry that ran, after it ran: Enter must not save again', () => {
    const save = entry('Save');
    let blurredAtRun = -1;
    bar.actions = new Proxy({} as Record<MenuAction, () => void>, {
      get: () => () => (blurredAtRun = save.blurred),
    });
    save.fire('click');
    expect(blurredAtRun, 'not before it ran').toBe(0);
    expect(save.blurred).toBe(1);
  });

  it('keeps the keys on an entry with a menu, whose rows are next', () => {
    openView();
    expect(entry('View').blurred).toBe(0);
  });

  it('folds the entries asked for, in the order, and gives the labels back', () => {
    const folded = () => element(bar.root).kids.filter((c) => c.kids[0].on.has('folded'));
    bar.setFolded(2);
    expect(folded().map((c) => c.kids[0].kids[1].textContent)).toEqual([
      'Saved games',
      'Notifications',
    ]);
    bar.setFolded(0);
    expect(folded()).toEqual([]);
  });

  it('lists the depots as Fleet opens, and a pick hands over the one picked', () => {
    let reads = 0;
    const picked: number[] = [];
    bar.depots = () => {
      reads++;
      return [
        { id: 4, name: 'Eastgate', gauge: 'regular', trains: 2, shown: true },
        { id: 9, name: 'Narrow Depot', gauge: 'narrow', trains: 0, shown: false },
      ];
    };
    bar.onDepot = (id) => picked.push(id);
    entry('Fleet').fire('click');
    expect(reads).toBe(1);
    const box = element(bar.pane).kids.find((k) => k.className === 'mb-depots')!;
    expect(box.kids.map((k) => k.textContent)).toEqual(['Eastgate', 'Narrow Depot']);
    expect(box.kids.map((k) => k.on.has('on'))).toEqual([true, false]);
    box.kids[1].fire('click');
    expect(picked).toEqual([9]);
    expect(bar.isOpen).toBe(false);
  });

  describe('with Fleet left open', () => {
    const depot = (trains: number, shown = false) => ({
      id: 4,
      name: 'Eastgate',
      gauge: 'regular' as const,
      trains,
      shown,
    });
    const box = () => element(bar.pane).kids.find((k) => k.className === 'mb-depots')!;
    /** A row's line right of its name. */
    const detail = () => box().kids[0].kids.at(-1)!.textContent;

    it('tells what changed since it opened', () => {
      let now = [depot(0)];
      bar.depots = () => now;
      entry('Fleet').fire('click');
      expect(detail()).toContain('0');
      now = [depot(2)];
      bar.update();
      expect(detail()).toContain('2');
      now = [depot(2, true)];
      bar.update();
      expect(box().kids[0].on.has('on')).toBe(true);
    });

    it('leaves the rows alone while nothing changed, so one is not lost under a press', () => {
      bar.depots = () => [depot(2)];
      entry('Fleet').fire('click');
      const was = box().kids[0];
      bar.update();
      bar.update();
      expect(box().kids[0]).toBe(was);
    });

    it('reads nothing with Fleet shut', () => {
      let reads = 0;
      bar.depots = () => {
        reads++;
        return [];
      };
      bar.update();
      openView();
      bar.update();
      expect(reads).toBe(0);
    });
  });

  it('names an entry in its tooltip, and says nothing over its own open menu', () => {
    const docs: (() => TipDoc)[] = [];
    bar = new MenuBar((doc) => {
      docs.push(doc);
      return () => [];
    });
    const fleet = docs[MENU_BAR.findIndex((e) => e.id === 'fleet')];
    expect(fleet()).toEqual([{ kind: 'title', parts: [{ glyph: 'train' }, 'Fleet'] }]);
    entry('Fleet').fire('click');
    expect(fleet()).toEqual([]);
  });

  it('stands the depots right under the Depot row', () => {
    const kids = element(bar.pane).kids;
    const at = kids.findIndex((k) => k.textContent === 'Depot');
    expect(kids[at + 1].className).toBe('mb-depots');
  });
});
