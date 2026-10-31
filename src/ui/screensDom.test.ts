import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STR } from '../strings';
import type { Settings, SlotMeta } from '../sim/save';
import { ScreenFrame, ScreenManager, type Screen } from './modal';
import { NamePrompt } from './namePrompt';
import { SettingsScreen, type SettingsActions } from './settingsScreen';
import { slider, textField } from './kit';

// the buttons play a sound when clicked; the context that plays it is a browser's
vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

type Listener = (e: FakeEvent) => void;

/** What a key or a click carries through the fake page. */
class FakeEvent {
  stopped = false;
  prevented = false;
  shiftKey = false;
  constructor(
    readonly type: string,
    readonly target: FakeEl,
    readonly key = '',
    readonly code = '',
  ) {}
  stopPropagation() {
    this.stopped = true;
  }
  preventDefault() {
    this.prevented = true;
  }
}

/** The little of an element the frame, the kit and the dialog use. */
class FakeEl {
  className = '';
  textContent = '';
  title = '';
  value = '';
  disabled = false;
  maxLength = -1;
  innerHTML = '';
  attrs = new Map<string, string>();
  style = { display: '', visibility: '', setProperty() {} };
  parent: FakeEl | null = null;
  children: (FakeEl | string)[] = [];
  private listeners = new Map<string, Listener[]>();
  classList = {
    toggle: (c: string, on = !this.className.split(' ').includes(c)) => {
      const rest = this.className.split(' ').filter((x) => x && x !== c);
      this.className = (on ? [...rest, c] : rest).join(' ');
      return on;
    },
  };

  constructor(readonly tagName: string) {}

  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
    if (k === 'value') this.value = v;
  }
  private adopt(c: FakeEl | string) {
    if (c instanceof FakeEl) c.parent = this;
    return c;
  }
  append(...c: (FakeEl | string)[]) {
    this.children.push(...c.map((x) => this.adopt(x)));
  }
  prepend(...c: (FakeEl | string)[]) {
    this.children.unshift(...c.map((x) => this.adopt(x)));
  }
  replaceChildren(...c: (FakeEl | string)[]) {
    for (const old of this.children) if (old instanceof FakeEl) old.parent = null;
    this.children = c.map((x) => this.adopt(x));
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  addEventListener(type: string, f: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), f]);
  }
  /** Fire `type` here and bubble it up, as far as nothing stops it. */
  fire(type: string, key = '', code = key): FakeEvent {
    const e = new FakeEvent(type, this, key, code);
    this.bubble(e);
    return e;
  }
  private bubble(e: FakeEvent) {
    for (const f of this.listeners.get(e.type) ?? []) f(e);
    if (!e.stopped) this.parent?.bubble(e);
  }
  /** A control keeps its label: a test presses it by name. */
  get all(): FakeEl[] {
    return this.children
      .filter((c): c is FakeEl => c instanceof FakeEl)
      .flatMap((c) => [c, ...c.all]);
  }
  text(): string {
    return (
      this.textContent + this.children.map((c) => (c instanceof FakeEl ? c.text() : c)).join('')
    );
  }
  find(cls: string): FakeEl | undefined {
    return this.all.find((e) => e.className.split(' ').includes(cls));
  }
  button(label: string): FakeEl {
    const b = this.all.find((e) => e.tagName === 'BUTTON' && e.text() === label);
    if (!b) throw new Error(`no button ${label}`);
    return b;
  }
  /** The frame asks for its controls: tag names, each maybe with `:not(:disabled)`. */
  querySelectorAll(selector: string): FakeEl[] {
    const parts = selector.split(',').map((s) => s.trim());
    return this.all.filter((e) =>
      parts.some((p) => {
        const [tag, not] = p.split(':not(:disabled)');
        return e.tagName === tag.toUpperCase() && not !== undefined
          ? !e.disabled
          : e.tagName === tag.toUpperCase();
      }),
    );
  }
  getClientRects(): object[] {
    if (this.style.display === 'none') return [];
    return this.parent ? this.parent.getClientRects() : [{}];
  }
  get isConnected(): boolean {
    return this === page.body || !!this.parent?.isConnected;
  }
  focus() {
    if (this.getClientRects().length) page.activeElement = this;
  }
  blur() {
    if (page.activeElement === this) page.activeElement = page.body;
  }
  select() {}
}

const page = {
  body: new FakeEl('BODY'),
  activeElement: null as FakeEl | null,
  createElement: (tag: string) => new FakeEl(tag.toUpperCase()),
  createTextNode: (t: string) => t,
};
/** A timer of 0 has run: the dialog puts the focus on its answer in one. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  page.body = new FakeEl('BODY');
  page.activeElement = page.body;
  vi.stubGlobal('document', page);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
});
afterEach(() => vi.unstubAllGlobals());

/** Put what the test builds in the fake page, so it counts as drawn. */
const inPage = <T>(e: T) => {
  page.body.append(e as unknown as FakeEl);
  return e;
};
const fake = (e: unknown) => e as FakeEl;

function formScreen(root: unknown, o: Partial<Screen> = {}): Screen {
  return { id: 'sample', title: 'Sample', root: root as HTMLElement, formKeys: true, ...o };
}

describe('the keys of a frame', () => {
  function frameOf(...controls: FakeEl[]) {
    const root = new FakeEl('DIV');
    root.append(...controls);
    const frame = new ScreenFrame(() => undefined);
    frame.show(formScreen(root), { stacked: false, paused: false });
    inPage(frame.root);
    return fake(frame.root);
  }
  const button = (name: string) => {
    const b = new FakeEl('BUTTON');
    b.textContent = name;
    return b;
  };

  it('Tab walks past what a folded list holds, both ways round', () => {
    const load = button('Load game');
    const list = new FakeEl('DIV');
    const row = button('Load');
    list.append(row);
    list.style.display = 'none';
    const settings = button('Settings');
    const f = frameOf(load, list, settings);
    load.focus();
    f.fire('keydown', 'Tab', 'Tab');
    expect(page.activeElement).toBe(settings);
    const back = settings.fire('keydown', 'Tab', 'Tab');
    expect(back.prevented).toBe(true);
    expect(page.activeElement).not.toBe(row);
  });

  it('Tab goes to a list once it is unfolded', () => {
    const load = button('Load game');
    const list = new FakeEl('DIV');
    const row = button('Load');
    list.append(row);
    const f = frameOf(load, list);
    load.focus();
    f.fire('keydown', 'Tab', 'Tab');
    expect(page.activeElement).toBe(row);
  });

  it('Tab skips a control that is off', () => {
    const a = button('a');
    const off = button('off');
    off.disabled = true;
    const b = button('b');
    frameOf(a, off, b);
    a.focus();
    a.fire('keydown', 'Tab', 'Tab');
    expect(page.activeElement).toBe(b);
  });

  it('Tab skips a field that is off', () => {
    const a = button('a');
    const off = new FakeEl('INPUT');
    off.disabled = true;
    const b = button('b');
    frameOf(a, off, b);
    a.focus();
    a.fire('keydown', 'Tab', 'Tab');
    expect(page.activeElement).toBe(b);
  });

  it('Tab stays in the frame from a slider or a text field, at the end of it too', () => {
    const name = fake(textField().root);
    const volume = fake(slider({ label: 'Music', value: 30, onInput: () => undefined }));
    const f = frameOf(name, volume);
    const [first] = f.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea');
    const inputs = f.all.filter((e) => e.tagName === 'INPUT');
    inputs[1].focus();
    const e = inputs[1].fire('keydown', 'Tab', 'Tab');
    expect(e.prevented).toBe(true);
    expect(page.activeElement).toBe(first);
  });

  it('Enter stays in the frame, for the focused control to take', () => {
    const a = button('a');
    frameOf(a);
    expect(a.fire('keydown', 'Enter', 'Enter').stopped).toBe(true);
  });

  it('Space goes on to the game, and presses nothing here', () => {
    const a = button('a');
    const f = frameOf(a);
    const heard: string[] = [];
    page.body.addEventListener('keydown', (e) => heard.push(e.code));
    a.focus();
    const down = a.fire('keydown', ' ', 'Space');
    expect(down.prevented).toBe(true);
    expect(heard).toEqual(['Space']);
    expect(a.fire('keyup', ' ', 'Space').prevented).toBe(true);
    expect(f).toBeDefined();
  });

  it('leaves the keys alone on a screen that does not ask for them', () => {
    const root = new FakeEl('DIV');
    const a = button('a');
    root.append(a);
    const frame = new ScreenFrame(() => undefined);
    frame.show(formScreen(root, { formKeys: false }), { stacked: false, paused: false });
    inPage(frame.root);
    for (const code of ['Tab', 'Enter', 'Space']) {
      const e = a.fire('keydown', code, code);
      expect(e.stopped, code).toBe(false);
      expect(e.prevented, code).toBe(false);
    }
  });
});

describe('the in-game dialog', () => {
  function dialog() {
    const prompt = new NamePrompt();
    inPage(prompt.root);
    return { prompt, root: fake(prompt.root) };
  }

  it('opens a plain question on its answer', async () => {
    const { prompt, root } = dialog();
    const answer = prompt.confirm('Load save', 'Load it?', { yes: 'Load' });
    await tick();
    expect(page.activeElement).toBe(root.button('Load'));
    fake(page.activeElement).fire('click');
    expect(await answer).toBe(true);
  });

  it('opens a question that destroys something on its no: Enter there destroys nothing', async () => {
    const { prompt, root } = dialog();
    const answer = prompt.confirm('Delete save', 'Delete it?', { yes: 'Delete', danger: true });
    await tick();
    expect(page.activeElement).toBe(root.button(STR.prompt.no));
    expect(page.activeElement).not.toBe(root.button('Delete'));
    fake(page.activeElement).fire('click');
    expect(await answer).toBe(false);
  });

  it('opens on its own no when the question names one', async () => {
    const { prompt, root } = dialog();
    void prompt.confirm('Cancel', 'Sure?', { yes: 'Cancel it', no: 'Keep', danger: true });
    await tick();
    expect(page.activeElement).toBe(root.button('Keep'));
  });

  it('reaches the red answer with Tab, and only then', async () => {
    const { prompt, root } = dialog();
    const answer = prompt.confirm('Delete save', 'Delete it?', { yes: 'Delete', danger: true });
    await tick();
    fake(page.activeElement).fire('keydown', 'Tab', 'Tab');
    expect(page.activeElement).toBe(root.button('Delete'));
    fake(page.activeElement).fire('click');
    expect(await answer).toBe(true);
  });

  it('lets Space press no answer and reach nothing under it', async () => {
    const { prompt, root } = dialog();
    const heard: string[] = [];
    page.body.addEventListener('keydown', (e) => heard.push(e.code));
    let settled = false;
    void prompt.confirm('Load save', 'Load it?', { yes: 'Load' }).then(() => (settled = true));
    await tick();
    const e = root.button('Load').fire('keydown', ' ', 'Space');
    expect(e.prevented).toBe(true);
    expect(e.stopped).toBe(true);
    expect(heard).toEqual([]);
    await tick();
    expect(settled).toBe(false);
    expect(prompt.open).toBe(true);
  });

  it('says no on Esc, and no key reaches the game while it is up', async () => {
    const { prompt, root } = dialog();
    const heard: string[] = [];
    page.body.addEventListener('keydown', (e) => heard.push(e.code));
    const answer = prompt.confirm('Delete', 'Sure?', { danger: true });
    await tick();
    root.button(STR.prompt.no).fire('keydown', 'f', 'KeyF');
    root.button(STR.prompt.no).fire('keydown', 'Escape', 'Escape');
    expect(await answer).toBe(false);
    expect(heard).toEqual([]);
  });

  it('gives the focus back to what asked', async () => {
    const { prompt, root } = dialog();
    const asker = inPage(new FakeEl('BUTTON'));
    asker.focus();
    const answer = prompt.confirm('Delete', 'Sure?', { danger: true });
    await tick();
    expect(page.activeElement).not.toBe(asker);
    root.button(STR.prompt.no).fire('click');
    await answer;
    expect(page.activeElement).toBe(asker);
  });

  it('leaves the focus alone when what asked has gone, as a deleted row has', async () => {
    const { prompt, root } = dialog();
    const asker = inPage(new FakeEl('BUTTON'));
    asker.focus();
    const answer = prompt.confirm('Delete', 'Sure?', { yes: 'Delete', danger: true });
    await tick();
    asker.remove();
    root.button('Delete').fire('click');
    await answer;
    expect(page.activeElement).not.toBe(asker);
  });

  it('keeps Tab in the frame from the name field, and takes the length it is told', async () => {
    const { prompt, root } = dialog();
    void prompt.ask('Rename station', 'The new name.', 'Old', 24);
    await tick();
    const input = root.all.find((e) => e.tagName === 'INPUT')!;
    expect(input.value).toBe('Old');
    expect(input.maxLength).toBe(24);
    expect(input.fire('keydown', 'Tab', 'Tab').prevented).toBe(true);
    expect(page.activeElement).not.toBe(page.body);
    expect(root.all).toContain(page.activeElement);
  });

  it('answers a name with what was typed, trimmed; blank is no name', async () => {
    const { prompt, root } = dialog();
    const input = () => root.all.find((e) => e.tagName === 'INPUT')!;
    const named = prompt.ask('Rename station', 'hint', 'Old');
    await tick();
    expect(input().maxLength).toBe(20);
    input().value = '  Keleti ';
    // the focus is back on what asked before the key is over: it must not press that as well
    expect(input().fire('keydown', 'Enter', 'Enter').prevented).toBe(true);
    expect(await named).toBe('Keleti');
    const blank = prompt.ask('Rename station', 'hint', 'Old');
    await tick();
    input().value = '   ';
    input().fire('keydown', 'Enter', 'Enter');
    expect(await blank).toBeNull();
  });
});

describe('the Settings screen', () => {
  const SLOT: SlotMeta = {
    name: 'One',
    savedAt: 0,
    version: 22,
    seed: 1,
    day: 1,
    age: 0,
    money: 0,
  };

  function settings(saveOff: boolean, slots: SlotMeta[] = []) {
    const saveAs = vi.fn(() => true);
    const actions = { saveAs, slots: () => slots } as unknown as SettingsActions;
    const screen = new SettingsScreen(
      { autosave: true } as Settings,
      () => undefined,
      actions,
      () => ({ seed: 1, savedAt: null, version: 'v22', warning: null, saveOff }),
      { confirm: () => Promise.resolve(true) },
    );
    return { screen, saveAs };
  }
  /** Open it on the Saves tab, and press Enter in its name field holding `name`. */
  async function typeName(screen: SettingsScreen, name: string) {
    screen.onOpen();
    screen.frameTabs().pick('saves');
    const field = fake(screen.root).all.find(
      (e) => e.attrs.get('placeholder') === STR.settings.slotName,
    )!;
    field.value = name;
    field.fire('keydown', 'Enter', 'Enter');
    await tick();
    return field;
  }

  it('saves from the name field on Enter over a game', async () => {
    const { screen, saveAs } = settings(false);
    const field = await typeName(screen, 'Keleti');
    expect(saveAs).toHaveBeenCalledWith('Keleti');
    expect(field.disabled).toBe(false);
    expect(field.title).toBe('');
  });

  it('saves nothing on Enter at the boot title, where Save as is off', async () => {
    const { screen, saveAs } = settings(true);
    await typeName(screen, 'Keleti');
    expect(saveAs).not.toHaveBeenCalled();
  });

  it('turns the name field off with the same reason as the button', async () => {
    const { screen } = settings(true);
    const field = await typeName(screen, 'Keleti');
    expect(field.disabled).toBe(true);
    expect(field.title).toBe(STR.settings.saveOff);
  });

  it('counts the saves on its tab as it opens, not at the next refresh', () => {
    const { screen } = settings(false, [SLOT]);
    const screens = new ScreenManager();
    screens.open(screen);
    const tabs = fake(screens.root).find('k-tabs');
    expect(tabs?.find('k-cnt')?.text()).toBe('1');
  });

  it('shows a count that onOpen works out, on any screen', () => {
    let count = 0;
    const screens = new ScreenManager();
    screens.open({
      id: 'sample',
      title: 'Sample',
      root: new FakeEl('DIV') as unknown as HTMLElement,
      onOpen: () => (count = 3),
      frameTabs: () => ({
        tabs: [{ id: 'a', label: 'A', count }],
        current: 'a',
        pick: () => undefined,
      }),
    });
    expect(fake(screens.root).find('k-cnt')?.text()).toBe('3');
  });
});
