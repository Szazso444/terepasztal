import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STR } from '../strings';
import type { Settings, SlotMeta } from '../sim/save';
import type { LevelData } from '../world/level';
import { ScreenFrame, ScreenManager, type Screen } from './modal';
import { NamePrompt } from './namePrompt';
import { SettingsScreen, type SettingsActions } from './settingsScreen';
import { numberField, slider, textField, type ConfirmOptions } from './kit';
import { LevelsScreen, type LevelsActions } from './levelsScreen';
import { MainMenu, PauseMenu, type MainMenuActions, type PauseMenuActions } from './menu';
import { NewGameScreen } from './newGameScreen';
import { SavedGamesScreen, type SavedGamesActions } from './savedGamesScreen';
import type { ReplaceSituation } from './saveSlots';
import { SignalGuideScreen } from './signalGuide';

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
    add: (c: string) => this.classList.toggle(c, true),
    remove: (c: string) => this.classList.toggle(c, false),
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

  function settings(saveOff: boolean, slots: SlotMeta[] = [], saveOffWhy?: string) {
    const saveAs = vi.fn();
    const actions = { saveAs, slots: () => slots } as unknown as SettingsActions;
    const screen = new SettingsScreen(
      { autosave: true } as Settings,
      () => undefined,
      actions,
      () => ({ seed: 1, savedAt: null, version: 'v22', warning: null, saveOff, saveOffWhy }),
      { confirm: () => Promise.resolve(true) },
    );
    return { screen, saveAs };
  }
  /** Open it on the Saves tab, and give the button that opens Saved games. */
  function saveAsButton(screen: SettingsScreen) {
    screen.onOpen();
    screen.frameTabs().pick('saves');
    return fake(screen.root).button(STR.menu.saveAs);
  }

  it('opens Saved games from Save as over a game: the name is typed there', () => {
    const { screen, saveAs } = settings(false);
    const button = saveAsButton(screen);
    expect(button.disabled).toBe(false);
    expect(button.title).toBe(STR.settings.saveAsOpens);
    button.fire('click');
    expect(saveAs).toHaveBeenCalledTimes(1);
    expect(saveAs).toHaveBeenCalledWith();
  });

  it('turns Save as off at the boot title, with the reason as its tip', () => {
    const { screen } = settings(true);
    const button = saveAsButton(screen);
    expect(button.disabled).toBe(true);
    expect(button.title).toBe(STR.settings.saveOff);
  });

  it('says why Save as is off where that is the level editor, not that no game has begun', () => {
    const { screen } = settings(true, [], STR.savedGames.saveOffEditor);
    const button = saveAsButton(screen);
    expect(button.disabled).toBe(true);
    expect(button.title).toBe(STR.savedGames.saveOffEditor);
    expect(button.title).not.toBe(STR.settings.saveOff);
  });

  it('has no name field of its own: a save is named in Saved games only', () => {
    const { screen } = settings(false);
    screen.onOpen();
    screen.frameTabs().pick('saves');
    const placeholders = fake(screen.root).all.map((e) => e.attrs.get('placeholder'));
    expect(placeholders).not.toContain(STR.savedGames.nameField);
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

// ------------------------------------------------------------------ PR 12d: the title, Saved games, Levels

describe('a number typed beside a slider, or in a number field', () => {
  /** The slider of a rule that rounds what it is given to a multiple of 32, as the map size does. */
  function mapSize(extra: Partial<Parameters<typeof slider>[0]> = {}) {
    const given: number[] = [];
    const control = fake(
      slider({
        value: 96,
        label: 'Map size',
        min: 32,
        max: 256,
        step: 32,
        field: true,
        onInput: (v) => {
          given.push(v);
          return Math.round(v / 32) * 32;
        },
        ...extra,
      }),
    );
    const typed = control.all.find((e) => e.tagName === 'INPUT' && e.attrs.get('type') === 'text')!;
    return { given, control, typed };
  }
  const key = (e: FakeEl, k: string, shift = false) => {
    const ev = new FakeEvent('keydown', e, k, k);
    ev.shiftKey = shift;
    (e as unknown as { bubble(e: FakeEvent): void }).bubble(ev);
    return ev;
  };

  it('shows what the rule kept, not what was typed: 100 is 96 on the map size', () => {
    const { given, typed } = mapSize();
    typed.value = '100';
    typed.fire('change');
    expect(given).toEqual([100]);
    expect(typed.value).toBe('96');
  });

  it('takes a decimal comma, and keeps the digits of a value no rule rounds', () => {
    const given: number[] = [];
    const { typed } = mapSize({ min: 0, max: 5, step: 0.05, onInput: (v) => void given.push(v) });
    typed.value = '0,3';
    typed.fire('change');
    typed.value = '1.234';
    typed.fire('change');
    expect(given).toEqual([0.3, 1.234]);
    expect(typed.value).toBe('1.234');
  });

  it('gives nothing on and shows the value again for text that is no number', () => {
    const { given, typed } = mapSize();
    typed.value = 'big';
    typed.fire('change');
    expect(given).toEqual([]);
    expect(typed.value).toBe('96');
  });

  it('has a stepper: − and + move by the step, Shift by the big step, and show what was kept', () => {
    const { given, control, typed } = mapSize({ bigStep: 64 });
    control.button('+').fire('click');
    expect(typed.value).toBe('128');
    control.button('−').fire('click');
    control.button('−').fire('click');
    expect(typed.value).toBe('64');
    expect(given).toEqual([128, 96, 64]);
    const shifted = new FakeEvent('click', control.button('+'));
    shifted.shiftKey = true;
    (control.button('+') as unknown as { bubble(e: FakeEvent): void }).bubble(shifted);
    expect(typed.value).toBe('128');
  });

  it('steps on the up and down keys too, and the keys stay in the field', () => {
    const { given, typed } = mapSize();
    const up = key(typed, 'ArrowUp');
    expect(up.prevented).toBe(true);
    expect(up.stopped).toBe(true);
    key(typed, 'ArrowDown');
    key(typed, 'ArrowDown');
    expect(given).toEqual([128, 96, 64]);
    expect(typed.value).toBe('64');
  });

  it('lets a number field show what was stored too', () => {
    const field = fake(
      numberField({
        value: 10,
        label: 'Buy per cycle',
        min: 0,
        max: 5000,
        step: 10,
        onChange: () => 70,
      }),
    );
    const input = field.all.find((e) => e.tagName === 'INPUT')!;
    input.value = '55';
    input.fire('change');
    expect(input.value).toBe('70');
    field.button('+').fire('click');
    expect(input.value).toBe('70');
  });
});

describe('the Saved games screen', () => {
  const meta = (name: string): SlotMeta => ({
    name,
    savedAt: 1,
    version: 22,
    seed: 1,
    day: 2,
    age: 0,
    money: 3,
  });
  const play: ReplaceSituation = {
    mode: 'play',
    titleShown: false,
    titleOverGame: false,
    stored: true,
  };

  function saved(over: Partial<SavedGamesActions> = {}, answer = true) {
    const saveAs = vi.fn(() => true);
    const confirm = vi.fn((_t: string, _q: string, _o?: ConfirmOptions) => Promise.resolve(answer));
    const actions = {
      slots: () => [meta('Szeged'), meta('Baranya')],
      loadSlot: () => undefined,
      deleteSlot: () => undefined,
      autosave: () => null,
      savedAt: () => null,
      autosaveOn: () => true,
      loadLast: () => undefined,
      situation: () => play,
      defaultName: () => 'Day 3 · 9',
      exists: () => false,
      saveAs,
      ...over,
    } as SavedGamesActions;
    const screen = new SavedGamesScreen(actions, { confirm });
    const onSaved = vi.fn();
    screen.onSaved = onSaved;
    return { screen, saveAs, confirm, onSaved };
  }
  const open = (screen: SavedGamesScreen, tab: 'save' | 'load') => {
    screen.show(tab);
    screen.onOpen();
  };
  const press = async (screen: SavedGamesScreen) => {
    screen.frameFooter().actions![0].onClick();
    await tick();
  };

  it('keeps the name in view on the Save tab: the saves scroll in a well under it', () => {
    const { screen } = saved();
    open(screen, 'save');
    const root = fake(screen.root);
    expect(root.className.split(' ')).toContain('sg-pinned');
    const scroll = root.find('sg-scroll')!;
    expect(scroll.all.filter((e) => e.className.split(' ').includes('k-li'))).toHaveLength(2);
    const field = root.all.find((e) => e.attrs.get('placeholder') === STR.savedGames.nameField)!;
    expect(scroll.all).not.toContain(field);
    // the Load tab is the old page that scrolls as a whole
    screen.frameTabs().pick('load');
    expect(root.className.split(' ')).not.toContain('sg-pinned');
  });

  it('asks of the store at the click whether it replaces a save, not of the list it drew', async () => {
    // the list does not show a save of that name; the store has one by now
    const { screen, saveAs, confirm, onSaved } = saved(
      { slots: () => [], exists: () => true },
      false,
    );
    open(screen, 'save');
    await press(screen);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][2]).toMatchObject({ danger: true, yes: STR.prompt.replace });
    expect(saveAs).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('saves on a yes, and asks nothing for a name that is free', async () => {
    const yes = saved({ slots: () => [], exists: () => true }, true);
    open(yes.screen, 'save');
    await press(yes.screen);
    expect(yes.saveAs).toHaveBeenCalledWith('Day 3 · 9');
    expect(yes.onSaved).toHaveBeenCalledTimes(1);
    const free = saved();
    open(free.screen, 'save');
    await press(free.screen);
    expect(free.confirm).not.toHaveBeenCalled();
    expect(free.saveAs).toHaveBeenCalledTimes(1);
  });

  it('turns Save off in the level editor, with the editor reason, and opens on Load', () => {
    const { screen } = saved({ situation: () => ({ ...play, mode: 'editor' }) });
    open(screen, 'save');
    const tabs = screen.frameTabs();
    expect(tabs.current).toBe('load');
    expect(tabs.tabs[0].off).toBe(STR.savedGames.saveOffEditor);
  });

  it('reads storage when the tab is drawn, not at every refresh', () => {
    const slots = vi.fn(() => [meta('Szeged')]);
    const situation = vi.fn(() => play);
    const { screen } = saved({ slots, situation });
    open(screen, 'load');
    const reads = [slots.mock.calls.length, situation.mock.calls.length];
    for (let i = 0; i < 5; i++) {
      screen.refresh();
      screen.frameTabs();
      screen.frameFooter();
    }
    expect([slots.mock.calls.length, situation.mock.calls.length]).toEqual(reads);
  });
});

describe('the Levels screen', () => {
  const level = (id: string, name: string) =>
    ({
      id,
      name,
      description: '',
      createdAt: 1,
      updatedAt: 2,
      w: 32,
      h: 32,
      seed: 1,
      terrain: '',
      variant: '',
      track: [],
      stations: [],
      decor: [],
      start: { money: 1, tier: 0 },
    }) as unknown as LevelData;

  function levels(existing: LevelData[], answer = true, keeps = true) {
    const importLevel = vi.fn(() => keeps);
    const confirm = vi.fn((_t: string, _q: string, _o?: ConfirmOptions) => Promise.resolve(answer));
    const screen = new LevelsScreen(
      {
        levels: () => existing,
        playLevel: () => undefined,
        editLevel: () => undefined,
        newLevel: () => undefined,
        deleteLevel: () => undefined,
        importLevel,
        asks: () => null,
      },
      { confirm },
    );
    screen.onOpen();
    const root = fake(screen.root);
    const box = root.all.find((e) => e.tagName === 'TEXTAREA')!;
    const error = () => root.find('k-err')!.text();
    /** Paste `text` and press Import level. */
    const paste = async (text: string) => {
      box.value = text;
      box.fire('input');
      root.button(STR.menu.importLevel).fire('click');
      await tick();
    };
    return { screen, importLevel, confirm, paste, error, box };
  }
  const text = (l: LevelData) => JSON.stringify(l);

  it('says a text that is no level is none, and imports nothing', async () => {
    const { importLevel, paste, error } = levels([]);
    await paste('{"id":"x"}');
    expect(importLevel).not.toHaveBeenCalled();
    expect(error()).toBe(STR.editor.badLevel);
  });

  it('adds a level that is new without a question, and empties the box', async () => {
    const { importLevel, confirm, paste, error, box } = levels([level('a', 'A')]);
    await paste(text(level('b', 'B')));
    expect(confirm).not.toHaveBeenCalled();
    expect(importLevel).toHaveBeenCalledTimes(1);
    expect(error()).toBe('');
    expect(box.value).toBe('');
  });

  it('asks, red, before a level takes the place of one of the same id, and a no imports nothing', async () => {
    const { importLevel, confirm, paste, box } = levels([level('a', 'Alföld')], false);
    await paste(text(level('a', 'Other')));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][1]).toBe(STR.menu.confirmReplaceLevel('Alföld'));
    expect(confirm.mock.calls[0][2]).toMatchObject({ danger: true, yes: STR.prompt.replace });
    expect(importLevel).not.toHaveBeenCalled();
    // what was pasted stays, to be changed
    expect(box.value).not.toBe('');
  });

  it('replaces it on a yes', async () => {
    const { importLevel, paste } = levels([level('a', 'Alföld')], true);
    await paste(text(level('a', 'Other')));
    expect(importLevel).toHaveBeenCalledTimes(1);
  });

  it('says so when the store would not keep the level, and does not say it is no level', async () => {
    const { paste, error, box } = levels([], true, false);
    await paste(text(level('b', 'B')));
    expect(error()).toBe(STR.menu.importFailed);
    expect(error()).not.toBe(STR.editor.badLevel);
    expect(box.value).not.toBe('');
  });
});

describe('the title screen', () => {
  function title(over: Record<string, unknown> = {}) {
    const slots = vi.fn(() => [] as SlotMeta[]);
    const levels = vi.fn(() => [] as LevelData[]);
    const actions = {
      slots,
      levels,
      volume: () => 0.5,
      setVolume: () => undefined,
      tunings: () => [],
      asks: () => null,
      deleteLevel: () => undefined,
      importLevel: () => true,
      ...over,
    } as unknown as MainMenuActions;
    const menu = new MainMenu(
      actions,
      { confirm: () => Promise.resolve(true) },
      {
        open: () => undefined,
      },
    );
    return { menu, slots, levels };
  }
  const save = {
    meta: { name: '', savedAt: 1, version: 22, seed: 1, day: 2, age: 0, money: 3 },
    live: false,
  };

  it('counts the saves and the levels when it shows, and again only after something changed them', () => {
    const { menu, slots, levels } = title();
    menu.show(null, { content: false });
    expect([slots.mock.calls.length, levels.mock.calls.length]).toEqual([1, 1]);
    // a screen over it, and gone: nothing it did changed a count
    menu.setCovered(true);
    menu.setCovered(false);
    menu.setCovered(true);
    menu.setCovered(false);
    expect([slots.mock.calls.length, levels.mock.calls.length]).toEqual([1, 1]);
    menu.changed();
    menu.setCovered(true);
    menu.setCovered(false);
    expect([slots.mock.calls.length, levels.mock.calls.length]).toEqual([2, 2]);
  });

  it('reads the counts again after the levels screen deletes or imports a level', () => {
    // the Levels screen's own actions are wrapped by the title: the deletes and imports it makes count
    const { menu, levels } = title();
    menu.show(null, { content: false });
    const screen = (menu as unknown as { levelsScreen: LevelsScreen }).levelsScreen;
    const actions = (screen as unknown as { actions: LevelsActions }).actions;
    const before = levels.mock.calls.length;
    actions.deleteLevel('x');
    menu.setCovered(false);
    expect(levels.mock.calls.length).toBe(before + 1);
    actions.importLevel('{}');
    menu.setCovered(false);
    expect(levels.mock.calls.length).toBe(before + 2);
  });

  it('puts the focus on its first button that can be pressed, so Tab and Enter work from the start', () => {
    const first = title();
    first.menu.show(save, { content: false });
    expect(fake(page.activeElement).text()).toContain('Continue');
    // with nothing to continue that button is off: the focus is on the next
    const none = title();
    none.menu.show(null, { content: false });
    expect(fake(page.activeElement).text()).toContain('New game');
    expect(fake(page.activeElement).disabled).toBe(false);
  });

  it('hides the game under it while it is up, and shows it again when it goes', () => {
    const { menu } = title();
    menu.show(null, { content: false });
    expect(page.body.className.split(' ')).toContain('title-up');
    menu.hide();
    expect(page.body.className.split(' ')).not.toContain('title-up');
  });

  it('gives the pause menu the focus on Resume as well', () => {
    const menu = new PauseMenu({
      slots: () => [],
      volume: () => 0.5,
      setVolume: () => undefined,
    } as unknown as PauseMenuActions);
    menu.show({ testing: false, editor: false });
    expect(fake(page.activeElement).text()).toContain(STR.menu.resume);
  });
});

describe('the screens that read something and use nothing', () => {
  it('keeps the tool in hand while the semaphore guide is up', () => {
    expect(new SignalGuideScreen().keepsTool).toBe(true);
  });

  it('reads what Start loses once, when New game opens, not at every refresh', () => {
    const asks = vi.fn(() => 'stored' as const);
    const screen = new NewGameScreen({
      newGame: () => undefined,
      tunings: () => [],
      asks,
    });
    screen.onOpen();
    for (let i = 0; i < 6; i++) screen.frameFooter();
    expect(asks).toHaveBeenCalledTimes(1);
    expect(screen.frameFooter().actions![0].title).toBe(STR.newGameScreen.startAsks);
  });
});
