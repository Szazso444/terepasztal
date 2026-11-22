import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STR } from '../strings';
import { SETTINGS_KEY, readSettings, type Settings, type SlotMeta } from '../sim/save';
import type { LevelData } from '../world/level';
import { ContractsScreen } from './contractsScreen';
import { ScreenFrame, ScreenManager, type Screen } from './modal';
import { NamePrompt } from './namePrompt';
import { SettingsScreen, type SettingsActions } from './settingsScreen';
import { AudioScreen } from './audioScreen';
import { pictureNode } from './guideScreen';
import { signalHint } from './ruleText';
import type { SignalLevel } from '../sim/signals';
import type { AtlasRegistry } from '../engine/atlas';
import { NowPlaying, type MusicDeck } from './nowPlaying';
import { DEFAULT_VOLUMES, heardVolumes, type Volumes } from '../engine/audioGroups';
import { numberField, slider, textField, type ConfirmOptions } from './kit';
import { LevelsScreen, type LevelsActions } from './levelsScreen';
import { MainMenu, PauseMenu, type MainMenuActions, type PauseMenuActions } from './menu';
import { NewGameScreen } from './newGameScreen';
import { SavedGamesScreen, type SavedGamesActions } from './savedGamesScreen';
import type { ReplaceSituation } from './saveSlots';
import { SignalGuideScreen } from './signalGuide';
import { Dir } from '../engine/iso';
import { Inventory } from '../gacha/inventory';
import { Builder } from '../sim/build';
import { Economy } from '../sim/economy';
import { Fleet } from '../sim/fleet';
import { resetStationIds } from '../sim/stations';
import { resetTrainIds, type Train } from '../sim/trains';
import { storeWith } from '../testing/storeFixtures';
import { emptyMap } from '../world/mapgen';
import { RegionState } from '../world/regions';
import { Terrain } from '../world/tiles';
import { TrackGraph, makePiece } from '../world/track';
import { DepotScreen } from './depot';
import type { Confirm } from './menu';

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
  offsetWidth = 0;
  clientWidth = 0;
  attrs = new Map<string, string>();
  props = new Map<string, string>();
  style = {
    display: '',
    visibility: '',
    setProperty: (k: string, v: string) => void this.props.set(k, v),
  };
  parent: FakeEl | null = null;
  children: (FakeEl | string)[] = [];
  dataset: Record<string, string> = {};
  hidden = false;
  private listeners = new Map<string, Listener[]>();
  classList = {
    toggle: (c: string, on = !this.className.split(' ').includes(c)) => {
      const rest = this.className.split(' ').filter((x) => x && x !== c);
      this.className = (on ? [...rest, c] : rest).join(' ');
      return on;
    },
    add: (c: string) => this.classList.toggle(c, true),
    remove: (c: string) => this.classList.toggle(c, false),
    contains: (c: string) => this.className.split(' ').includes(c),
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
  insertBefore(c: FakeEl, ref: FakeEl | null) {
    c.remove();
    const at = ref ? this.children.indexOf(ref) : -1;
    this.children.splice(at < 0 ? this.children.length : at, 0, this.adopt(c));
  }
  private get elements(): FakeEl[] {
    return this.children.filter((c): c is FakeEl => c instanceof FakeEl);
  }
  get firstElementChild(): FakeEl | null {
    return this.elements[0] ?? null;
  }
  get lastElementChild(): FakeEl | null {
    return this.elements.at(-1) ?? null;
  }
  /** The first element of the selector's last tag: `b`, or `.k-bar > i` for its `i`. */
  querySelector(selector: string): FakeEl | null {
    const tag = selector.split(' ').at(-1)?.toUpperCase();
    return this.all.find((e) => e.tagName === tag) ?? null;
  }
  /** What was brought into sight, for a test to read. */
  scrollIntoView() {
    page.scrolledTo = this;
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
  scrolledTo: null as FakeEl | null,
  createElement: (tag: string) => new FakeEl(tag.toUpperCase()),
  createTextNode: (t: string) => t,
  createDocumentFragment: () => new FakeEl('FRAGMENT'),
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

  it('has a Building life switch on Gameplay that says what it switches and applies at once', () => {
    const state = { buildingLife: true } as Settings;
    const onChange = vi.fn();
    const screen = new SettingsScreen(
      state,
      onChange,
      { slots: () => [] } as unknown as SettingsActions,
      () => ({ seed: 1, savedAt: null, version: 'v22', warning: null, saveOff: false }),
      { confirm: () => Promise.resolve(true) },
    );
    screen.onOpen();
    screen.frameTabs().pick('gameplay');
    const row = fake(screen.root).all.find((e) => e.title === STR.settings.buildingLifeHint)!;
    expect(row.text()).toContain(STR.settings.buildingLife);
    row.all.find((e) => e.tagName === 'BUTTON')!.fire('click');
    expect(state.buildingLife).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

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
    } as unknown as PauseMenuActions);
    menu.show({ testing: false, editor: false });
    expect(fake(page.activeElement).text()).toContain(STR.menu.resume);
  });
});

describe('Audio as a row of its own', () => {
  const menuActions = (audio: () => void) =>
    ({
      slots: () => [],
      levels: () => [],
      tunings: () => [],
      asks: () => null,
      audio,
    }) as unknown as MainMenuActions & PauseMenuActions;
  /** The labels of the buttons of the frame's stack, top to bottom. */
  const stack = (root: unknown) =>
    fake(root)
      .find('k-stack')!
      .all.filter((e) => e.tagName === 'BUTTON')
      .map((b) => b.text());
  const follows = (labels: string[]) => labels[labels.indexOf(STR.topbar.settings) + 1];

  it('stands directly under Settings on the title, and opens the screen', () => {
    const audio = vi.fn();
    const menu = new MainMenu(
      menuActions(audio),
      { confirm: () => Promise.resolve(true) },
      { open: () => undefined },
    );
    menu.show(null, { content: false });
    expect(follows(stack(menu.root))).toBe(STR.settings.audio);
    fake(menu.root).button(STR.settings.audio).fire('click');
    expect(audio).toHaveBeenCalledTimes(1);
  });

  it('stands directly under Settings in the pause menu, and opens the screen', () => {
    const audio = vi.fn();
    const menu = new PauseMenu(menuActions(audio));
    menu.show({ testing: false, editor: false });
    expect(follows(stack(menu.root))).toBe(STR.settings.audio);
    fake(menu.root).button(STR.settings.audio).fire('click');
    expect(audio).toHaveBeenCalledTimes(1);
  });

  it('is gone from the tabs of Settings, which opens on Gameplay', () => {
    const screen = new SettingsScreen(
      { autosave: true } as Settings,
      () => undefined,
      { slots: () => [] } as unknown as SettingsActions,
      () => ({ seed: 1, savedAt: null, version: 'v22', warning: null, saveOff: false }),
      { confirm: () => Promise.resolve(true) },
    );
    const tabs = screen.frameTabs();
    expect(tabs.tabs.map((t) => t.id)).not.toContain('audio');
    expect(tabs.current).toBe('gameplay');
  });
});

describe('the Audio screen', () => {
  function open() {
    const volumes: Volumes = {
      ...DEFAULT_VOLUMES,
      soundGroups: { ...DEFAULT_VOLUMES.soundGroups },
      soundOff: {},
    };
    const onChange = vi.fn();
    const screen = new AudioScreen(volumes, onChange);
    screen.onOpen();
    const root = fake(screen.root);
    const rows = root.all.filter((e) => e.className.split(' ').includes('k-row'));
    const row = (label: string) => rows.find((r) => r.find('k-lab')?.text().startsWith(label))!;
    const sliderOf = (label: string) => row(label).all.find((e) => e.tagName === 'INPUT')!;
    const switchOf = (label: string) => row(label).find('k-sw')!;
    const drag = (label: string, value: number) => {
      const input = sliderOf(label);
      input.value = String(value);
      input.fire('input');
    };
    return { volumes, onChange, screen, rows, row, sliderOf, switchOf, drag };
  }
  const G = STR.settings.soundGroups;

  it('lists one group under another, each with a slider and a switch', () => {
    const { rows } = open();
    const says = rows.map((r) => r.find('k-lab')!.all[0].text());
    expect(says).toEqual([
      STR.settings.master,
      STR.settings.music,
      STR.settings.sfx,
      G.weather.label,
      G.environment.label,
      G.ui.label,
      G.building.label,
      G.trains.label,
      G.events.label,
    ]);
    const depths = rows.map((r) => /au-depth(\d)/.exec(r.className)?.[1]);
    expect(depths).toEqual(['0', '1', '1', '2', '2', '2', '2', '2', '2']);
    for (const r of rows) {
      expect(r.all.filter((e) => e.tagName === 'INPUT')).toHaveLength(1);
      expect(r.find('k-sw')).toBeDefined();
    }
  });

  it('is an M frame, with a way out and the words that it applies at once', () => {
    const { screen } = open();
    expect(screen.frameSize).toBe('M');
    expect(screen.frameFooter()).toEqual({ note: STR.settings.appliesAtOnce, done: true });
  });

  it('writes a level where it belongs, and tells the game', () => {
    const { volumes, onChange, drag } = open();
    drag(STR.settings.master, 50);
    drag(STR.settings.sfx, 40);
    drag(G.trains.label, 30);
    expect(volumes.master).toBe(0.5);
    expect(volumes.sfx).toBe(0.4);
    expect(volumes.soundGroups.trains).toBe(0.3);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('turns a group off without losing its level, and back on', () => {
    const { volumes, onChange, switchOf, sliderOf } = open();
    expect(sliderOf(G.ui.label).value).toBe('100');
    switchOf(G.ui.label).fire('click');
    expect(heardVolumes(volumes).groups.ui).toBe(0);
    expect(volumes.soundGroups.ui).toBe(1);
    expect(sliderOf(G.ui.label).value).toBe('100');
    switchOf(G.ui.label).fire('click');
    expect(heardVolumes(volumes).groups.ui).toBe(1);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('marks what a row switched off silences, and nothing else', () => {
    const { row, switchOf } = open();
    const silenced = (label: string) => row(label).className.includes('au-silenced');
    switchOf(STR.settings.sfx).fire('click');
    expect(silenced(STR.settings.sfx)).toBe(false);
    expect(silenced(G.trains.label)).toBe(true);
    expect(silenced(STR.settings.music)).toBe(false);
    switchOf(STR.settings.sfx).fire('click');
    expect(silenced(G.trains.label)).toBe(false);
    switchOf(STR.settings.master).fire('click');
    expect(silenced(STR.settings.music)).toBe(true);
    expect(silenced(G.events.label)).toBe(true);
  });

  it('shows a level rounded, and keeps the exact one until it is moved', () => {
    const { volumes, sliderOf } = open();
    expect(sliderOf(G.weather.label).value).toBe('44');
    expect(volumes.soundGroups.weather).toBe(DEFAULT_VOLUMES.soundGroups.weather);
  });
});

describe('the now-playing widget', () => {
  /** A deck as the bus is one: `view` is a new reading each time. */
  function deck(over: Partial<MusicDeck['view']> = {}) {
    const state: MusicDeck['view'] = {
      title: 'Pastoral Pulse',
      paused: false,
      silent: false,
      held: false,
      canGoBack: false,
      canGoForward: true,
      ...over,
    };
    return {
      state,
      get view() {
        return { ...state };
      },
      togglePause: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
    };
  }
  function widget(d: ReturnType<typeof deck>) {
    const tips: (() => string)[] = [];
    const w = new NowPlaying(d, (text) => {
      tips.push(text);
      return () => null as never;
    });
    w.update();
    const root = fake(w.root);
    const [back, toggle, forward] = root.all.filter((e) => e.tagName === 'BUTTON');
    return { w, root, back, toggle, forward, tips };
  }

  it('shows the title, and works the three buttons', () => {
    const d = deck({ canGoBack: true });
    const { root, back, toggle, forward } = widget(d);
    expect(root.find('np-text')!.textContent).toBe('Pastoral Pulse');
    back.fire('click');
    toggle.fire('click');
    forward.fire('click');
    expect([d.back, d.togglePause, d.forward].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('says each button in its tooltip, the full title too, and why Back is off', () => {
    const { tips, back } = widget(deck());
    expect(back.disabled).toBe(true);
    expect(tips.map((t) => t())).toEqual([
      STR.nowPlaying.noBack,
      STR.nowPlaying.pause,
      STR.nowPlaying.forward,
      'Pastoral Pulse',
    ]);
  });

  it('follows the music: a new title, Back on, and play in place of pause', () => {
    const d = deck();
    const { w, root, back, tips } = widget(d);
    Object.assign(d.state, { title: 'Sparse Pulse', canGoBack: true, paused: true });
    w.update();
    expect(root.find('np-text')!.textContent).toBe('Sparse Pulse');
    expect(back.disabled).toBe(false);
    expect(tips[0]()).toBe(STR.nowPlaying.back);
    expect(tips[1]()).toBe(STR.nowPlaying.play);
    expect(root.find('np-title')!.className).toContain('paused');
  });

  it('says what plays when no file is left, and offers nothing to skip to', () => {
    const { root, forward, tips } = widget(deck({ title: null, canGoForward: false }));
    expect(root.find('np-text')!.textContent).toBe(STR.nowPlaying.noTrack);
    expect(forward.disabled).toBe(true);
    expect(tips[3]()).toBe(STR.nowPlaying.noTrack);
  });

  it('rolls a title wider than its room, and lets one that fits stand', () => {
    const d = deck();
    const { w, root } = widget(d);
    const box = root.find('np-title')!;
    const text = root.find('np-text')!;
    box.clientWidth = 100;
    text.offsetWidth = 160;
    d.state.title = 'Pastoral Pulse (Liquid DnB)';
    w.update();
    expect(box.className).toContain('roll');
    expect(text.props.get('--np-shift')).toBe('-60px');
    text.offsetWidth = 90;
    d.state.title = 'Sparse Pulse';
    w.update();
    expect(box.className).not.toContain('roll');
  });

  it('writes nothing while nothing changes, as it runs every frame', () => {
    const { w, root } = widget(deck());
    const box = vi.spyOn(root.find('np-title')!.classList, 'toggle');
    const self = vi.spyOn(root.classList, 'toggle');
    for (let i = 0; i < 5; i++) w.update();
    expect(box).not.toHaveBeenCalled();
    expect(self).not.toHaveBeenCalled();
  });

  it("names each button for a screen reader in the tooltip's words, with no browser title beside the tooltip", () => {
    const d = deck();
    const { w, back, toggle, forward } = widget(d);
    const named = (b: FakeEl) => [b.title, b.attrs.get('aria-label')];
    expect(named(back)).toEqual(['', STR.nowPlaying.noBack]);
    expect(named(toggle)).toEqual(['', STR.nowPlaying.pause]);
    expect(named(forward)).toEqual(['', STR.nowPlaying.forward]);
    Object.assign(d.state, { paused: true, canGoBack: true });
    w.update();
    expect(named(back)).toEqual(['', STR.nowPlaying.back]);
    expect(named(toggle)).toEqual(['', STR.nowPlaying.play]);
  });

  it('gives the keys back after a press: Enter finishes a route, and must not toggle the music', () => {
    const d = deck({ canGoBack: true });
    const { back, toggle, forward } = widget(d);
    for (const b of [back, toggle, forward]) {
      b.focus();
      expect(page.activeElement).toBe(b);
      b.fire('click');
      expect(page.activeElement).not.toBe(b);
    }
  });

  it('says plainly that nothing can be heard, with its buttons off and saying why', () => {
    const d = deck({ silent: true, canGoBack: true });
    const { w, root, back, toggle, forward, tips } = widget(d);
    expect(root.find('np-text')!.textContent).toBe(STR.nowPlaying.silent);
    expect(root.find('np-title')!.className).toContain('paused');
    for (const b of [back, toggle, forward]) {
      expect(b.disabled).toBe(true);
      expect(b.attrs.get('aria-label')).toBe(STR.nowPlaying.silentTip);
    }
    expect(tips.slice(0, 3).map((t) => t())).toEqual(Array(3).fill(STR.nowPlaying.silentTip));
    // the tooltip still has the track, whose words the row gave up
    expect(tips[3]()).toBe('Pastoral Pulse');
    const off = toggle.find('k-ic')!.innerHTML;
    d.state.silent = false;
    w.update();
    expect(root.find('np-text')!.textContent).toBe('Pastoral Pulse');
    expect(root.find('np-title')!.className).not.toContain('paused');
    expect(toggle.find('k-ic')!.innerHTML).not.toBe(off);
    expect([back, toggle, forward].map((b) => b.disabled)).toEqual([false, false, false]);
  });

  it('marks the music held, for the title to leave it out', () => {
    const d = deck({ held: true });
    const { w, root } = widget(d);
    expect(root.className).toContain('held');
    d.state.held = false;
    w.update();
    expect(root.className).not.toContain('held');
  });
});

describe('the screens that read something and use nothing', () => {
  it('keeps the tool in hand while the semaphore guide is up', () => {
    expect(new SignalGuideScreen({} as Settings, () => undefined).keepsTool).toBe(true);
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

/** A Contracts screen over a board with nothing on it, its Settings tab on `settings`. */
function contractsOver(settings: Settings, onChange = () => {}) {
  const board = {
    offers: [],
    active: [],
    contracts: [],
    stats: { completed: 0, failed: 0 },
    activeFull: () => false,
    limit: () => 3,
    canGenerate: () => true,
    byId: () => undefined,
  };
  const screen = new ContractsScreen(
    board as never,
    {} as never,
    { time: 0 } as never,
    () => undefined,
    { confirm: () => Promise.resolve(true) },
  );
  screen.policy = { settings, onChange };
  screen.autoAccept = { state: () => 'prompt', set: () => undefined };
  return screen;
}

describe('the Contracts screen and its Settings tab', () => {
  it('has a tab called Settings, after the three of cards', () => {
    expect(
      contractsOver({} as Settings)
        .frameTabs()
        .tabs.map((t) => t.label),
    ).toEqual([
      STR.contracts.offers,
      STR.contracts.active,
      STR.contracts.history,
      STR.contracts.settingsTab,
    ]);
  });

  it('opens on it when asked, as the Economy menu asks, with a row for each rarity', () => {
    const screen = contractsOver({} as Settings);
    screen.show('settings');
    screen.onOpen();
    expect(screen.frameTabs().current).toBe('settings');
    expect(fake(screen.root).text()).toContain(STR.settings.contractPolicy);
    expect(fake(screen.root).all.filter((e) => e.className === 'k-row')).toHaveLength(5);
  });

  it('goes there from Per rarity on the Offers tab, in the same screen', () => {
    const screen = contractsOver({} as Settings);
    const redraw = vi.fn();
    screen.redraw = redraw;
    screen.onOpen();
    expect(screen.frameTabs().current).toBe('offers');
    fake(screen.root).button(STR.contracts.perRarity).fire('click');
    expect(screen.frameTabs().current).toBe('settings');
    expect(redraw).toHaveBeenCalled();
  });

  it('stores a choice for one rarity and tells the game', () => {
    const settings = { contractPolicy: { common: 'prompt' } } as Settings;
    const onChange = vi.fn();
    const screen = contractsOver(settings, onChange);
    screen.show('settings');
    fake(screen.root).button(STR.settings.policy.deny).fire('click');
    expect(settings.contractPolicy?.common).toBe('deny');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('is back on the offers the next time it opens', () => {
    const screen = contractsOver({} as Settings);
    screen.show('settings');
    screen.onClose();
    expect(screen.frameTabs().current).toBe('offers');
  });

  it('builds the tab once: a refresh swaps no button away', () => {
    const screen = contractsOver({} as Settings);
    screen.show('settings');
    const button = fake(screen.root).button(STR.settings.policy.deny);
    screen.refresh();
    expect(fake(screen.root).button(STR.settings.policy.deny)).toBe(button);
  });
});

describe('the Signals screen', () => {
  const level = (screen: SignalGuideScreen, name: string) =>
    fake(screen.root).all.find(
      (e) => e.tagName === 'BUTTON' && e.text().startsWith(STR.settings.signalLevel[name]),
    );

  it('heads the guide with the signalling level, each level with what it does', () => {
    const screen = new SignalGuideScreen({} as Settings, () => undefined);
    screen.onOpen();
    const text = fake(screen.root).text();
    expect(text.indexOf(STR.settings.signalling)).toBeLessThan(
      text.indexOf(STR.signals.guidePlace),
    );
    for (const id of Object.keys(STR.settings.signalLevel)) {
      expect(text).toContain(STR.settings.signalLevel[id]);
      expect(text).toContain(signalHint(id as SignalLevel));
    }
    expect(text).toContain(STR.settings.signallingNote);
    expect(level(screen, 'auto')?.attrs.get('aria-checked')).toBe('true');
  });

  it('stores the level picked and tells the game', () => {
    const settings = {} as Settings;
    const onChange = vi.fn();
    const screen = new SignalGuideScreen(settings, onChange);
    screen.onOpen();
    level(screen, 'ctc')?.fire('click');
    expect(settings.signalling).toBe('ctc');
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('the pictures of the Guide', () => {
  it('draws a vehicle from its portrait file, not from its id', () => {
    const img = fake(
      pictureNode({ of: 'vehicle', id: 'rocket', caption: '' }, {} as AtlasRegistry),
    );
    expect(img.attrs.get('src')).toContain('assets/portraits/rocket.png');
  });

  it('has none for a vehicle with no portrait', () => {
    expect(
      pictureNode({ of: 'vehicle', id: 'no_such_model', caption: '' }, {} as AtlasRegistry),
    ).toBeNull();
  });
});

describe('an old settings file', () => {
  /** Written when Contracts and Signalling were tabs of Settings. */
  const OLD = {
    master: 0.4,
    signalling: 'in_cab',
    contractPolicyVersion: 2,
    contractPolicy: {
      common: 'accept',
      uncommon: 'prompt',
      rare: 'deny',
      epic: 'prompt',
      legendary: 'accept',
    },
  };
  const stored = () => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k === SETTINGS_KEY ? JSON.stringify(OLD) : null),
      setItem() {},
      removeItem() {},
    });
    return readSettings();
  };

  it('keeps its signalling level, and the Signals screen shows it', () => {
    const settings = stored();
    expect(settings.signalling).toBe('in_cab');
    const screen = new SignalGuideScreen(settings, () => undefined);
    screen.onOpen();
    const picked = fake(screen.root).all.filter((e) => e.attrs.get('aria-checked') === 'true');
    expect(picked.map((e) => e.text())).toEqual([
      STR.settings.signalLevel.in_cab + signalHint('in_cab'),
    ]);
  });

  it('keeps its policy for each rarity, and the Contracts Settings tab shows it', () => {
    const settings = stored();
    expect(settings.contractPolicy).toEqual(OLD.contractPolicy);
    const screen = contractsOver(settings);
    screen.show('settings');
    const picked = fake(screen.root).all.filter((e) => e.attrs.get('aria-checked') === 'true');
    const { accept, prompt, deny } = STR.settings.policy;
    expect(picked.map((e) => e.text())).toEqual([accept, prompt, deny, prompt, accept]);
  });

  it('finds Settings without the three tabs that left', () => {
    const { gameplay, controls, saves } = STR.settings;
    const screen = new SettingsScreen(
      stored(),
      () => undefined,
      { slots: () => [] } as unknown as SettingsActions,
      () => ({ seed: 1, savedAt: null, version: 'v24', warning: null, saveOff: false }),
      { confirm: () => Promise.resolve(true) },
    );
    expect(screen.frameTabs().tabs.map((t) => t.label)).toEqual([gameplay, controls, saves]);
  });
});

describe('the Depot', () => {
  const ROCKET = 'rocket';
  const TUB = 'mine_tub';

  /** A narrow depot with a line to two stations, two engines and three wagons free. */
  function world() {
    resetTrainIds();
    resetStationIds();
    const map = emptyMap(4242, 64, 64, Terrain.Grass);
    const track = new TrackGraph(64, 64);
    const economy = new Economy();
    const regions = new RegionState(map);
    for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
    const builder = new Builder(map, regions, track, economy, storeWith({}).stores);
    builder.free = true;
    const inventory = new Inventory();
    const fleet = new Fleet(track, builder, map, inventory, economy);
    const depot = builder.placeStation(20, 20, 'narrow_depot', 0)!;
    const ew = [0, 1].find((r) => makePiece('straight', r, 'narrow').links[0].includes(Dir.E))!;
    for (let x = 22; x < 34; x++) track.place(x, 20, 'straight', ew, 'narrow');
    builder.placeStation(24, 21, 'quarry', 0);
    builder.placeStation(26, 21, 'farm', 0);
    for (const id of [ROCKET, ROCKET, TUB, TUB, TUB]) inventory.add(id, 0);
    return { builder, fleet, inventory, depot, track };
  }

  function open() {
    const w = world();
    const confirm = vi.fn(async () => true);
    const atlas = { has: () => false } as unknown as AtlasRegistry;
    const prompt = { confirm } as unknown as Confirm;
    const screen = new DepotScreen(w.inventory, w.fleet, w.builder, atlas, prompt);
    inPage(screen.root);
    screen.onOpen();
    return { ...w, screen, confirm, root: fake(screen.root) };
  }
  type Open = ReturnType<typeof open>;

  const stockRow = (root: FakeEl, name: string) => {
    const row = root.all.find(
      (e) =>
        e.classList.contains('dp-li') &&
        !e.classList.contains('dp-train') &&
        e.text().includes(name),
    );
    if (!row) throw new Error(`no row ${name}`);
    return row;
  };
  const plus = (root: FakeEl, name: string) => stockRow(root, name).button('+');
  const nameInput = (root: FakeEl) => root.find('dp-dock')?.all.find((e) => e.tagName === 'INPUT');
  const dock = (root: FakeEl) => root.find('dp-dock')?.text() ?? '';
  const action = (o: Open, label: string) => {
    const a = o.screen.frameFooter().actions?.find((x) => x.label === label);
    if (!a) throw new Error(`no action ${label}`);
    return a;
  };
  const cars = (root: FakeEl) => root.all.filter((e) => e.classList.contains('dp-car'));
  /** A train out with an engine and a wagon, picked, as a Dispatch leaves it. */
  function dispatched(o: Open) {
    plus(o.root, "Stephenson's Rocket").fire('click');
    plus(o.root, 'Mine Tub').fire('click');
    action(o, STR.depot.dispatch).onClick();
    return o.fleet.trains[0];
  }

  it('sends nothing on Enter in the name field: it commits the name and gives the keys back', () => {
    const o = open();
    plus(o.root, "Stephenson's Rocket").fire('click');
    const field = nameInput(o.root)!;
    field.value = 'Half built';
    field.focus();
    field.fire('keydown', 'Enter', 'Enter');
    expect(o.fleet.trains).toHaveLength(0);
    expect(page.activeElement).not.toBe(field);
    expect(field.value).toBe('Half built');
  });

  it('picks the train that went out, with Build another a press away, and shows its row', () => {
    const o = open();
    const t = dispatched(o);
    expect(o.fleet.trains).toHaveLength(1);
    expect(action(o, STR.depot.again)).toBeDefined();
    expect(fake(page.scrolledTo).text()).toContain(t.name);
    expect(fake(page.scrolledTo).classList.contains('on')).toBe(true);
  });

  it('builds another straight off an empty draft, asking nothing', async () => {
    const o = open();
    dispatched(o);
    action(o, STR.depot.again).onClick();
    await tick();
    expect(o.confirm).not.toHaveBeenCalled();
    expect(cars(o.root)).toHaveLength(2);
    expect(o.fleet.trains).toHaveLength(1);
  });

  /** A train out, and a new draft begun, with the train picked again. */
  async function draftBeside(o: Open, t: Train) {
    o.root.find('dp-new')?.fire('click');
    plus(o.root, 'Mine Tub').fire('click');
    plus(o.root, 'Mine Tub').fire('click');
    expect(cars(o.root)).toHaveLength(2);
    o.root.all.find((e) => e.classList.contains('dp-train'))?.fire('click');
    expect(o.screen.frameFooter().actions?.some((a) => a.label === STR.depot.again)).toBe(true);
    expect(t).toBeDefined();
  }

  it('asks before Build another replaces a draft, and keeps it on no', async () => {
    const o = open();
    const t = dispatched(o);
    await draftBeside(o, t);
    o.confirm.mockResolvedValueOnce(false);
    action(o, STR.depot.again).onClick();
    await tick();
    expect(o.confirm).toHaveBeenCalledOnce();
    // the question was declined: the train stays picked and the draft is as it was
    expect(action(o, STR.depot.again)).toBeDefined();
    o.root.find('dp-new')?.fire('click');
    expect(cars(o.root)).toHaveLength(2);
    expect(stockRow(o.root, 'Mine Tub').all.find((e) => e.tagName === 'INPUT')?.value).toBe('2');
  });

  it('replaces the draft on yes, with the train it was asked of', async () => {
    const o = open();
    const t = dispatched(o);
    await draftBeside(o, t);
    action(o, STR.depot.again).onClick();
    await tick();
    expect(o.confirm).toHaveBeenCalledOnce();
    // like the train: the engine it has, and its one wagon, not the two of the draft
    expect(stockRow(o.root, 'Mine Tub').all.find((e) => e.tagName === 'INPUT')?.value).toBe('1');
    expect(
      stockRow(o.root, "Stephenson's Rocket").all.find((e) => e.tagName === 'INPUT')?.value,
    ).toBe('1');
  });

  it('does nothing for a train recalled while the question stood', async () => {
    const o = open();
    const t = dispatched(o);
    await draftBeside(o, t);
    let answer: (yes: boolean) => void = () => {};
    o.confirm.mockReturnValueOnce(new Promise<boolean>((r) => (answer = r)));
    action(o, STR.depot.again).onClick();
    o.fleet.recall(t);
    answer(true);
    await tick();
    o.root.find('dp-new')?.fire('click');
    expect(stockRow(o.root, 'Mine Tub').all.find((e) => e.tagName === 'INPUT')?.value).toBe('2');
  });

  it('keeps the focus on the stepper pressed, as its row is drawn again', () => {
    const o = open();
    const press = plus(o.root, 'Mine Tub');
    press.focus();
    press.fire('click');
    const again = plus(o.root, 'Mine Tub');
    expect(again).not.toBe(press);
    expect(page.activeElement).toBe(again);
    const down = stockRow(o.root, 'Mine Tub').button('−');
    down.focus();
    down.fire('click');
    expect(page.activeElement).toBe(stockRow(o.root, 'Mine Tub').button('−'));
  });

  it('leaves the focus alone on a click on the row itself', () => {
    const o = open();
    const before = page.activeElement;
    stockRow(o.root, 'Mine Tub').fire('click');
    expect(cars(o.root)).toHaveLength(1);
    expect(page.activeElement).toBe(before);
  });

  it('says in its dock line what a train built like another could not get', async () => {
    const o = open();
    dispatched(o);
    // the only other engine goes: nothing of that model is free
    o.inventory.free('loco')[0].assigned = 99;
    action(o, STR.depot.again).onClick();
    await tick();
    expect(dock(o.root)).toContain(STR.depot.likeMissing("Stephenson's Rocket"));
    // it stands until the draft changes
    o.screen.refresh();
    expect(dock(o.root)).toContain(STR.depot.likeMissing("Stephenson's Rocket"));
    plus(o.root, 'Mine Tub').fire('click');
    expect(dock(o.root)).not.toContain(STR.depot.likeMissing("Stephenson's Rocket"));
  });

  it('says a full list in its dock line', () => {
    const o = open();
    for (let i = 0; i < 16; i++) o.inventory.add(TUB, 0);
    o.screen.refresh();
    const input = stockRow(o.root, 'Mine Tub').all.find((e) => e.tagName === 'INPUT')!;
    input.value = '19';
    input.fire('change');
    expect(dock(o.root)).toContain(STR.fleet.tooManyWagons(16));
  });

  it('moves no camera and leaves the list as it was on a press of a depot', () => {
    const o = open();
    const seen = vi.fn();
    o.screen.onFocusDepot = seen;
    const standard = o.builder.placeStation(40, 40, 'depot', 0)!;
    o.screen.refresh();
    o.root.button(STR.depot.scopeAll(0)).fire('click');
    const chips = o.root.all.filter((e) => e.classList.contains('dp-dep'));
    chips.find((e) => e.text().includes(standard.name))?.fire('click');
    expect(seen).not.toHaveBeenCalled();
    expect(o.root.all.find((e) => e.text() === STR.depot.scopeAll(0))?.className).toContain('on');
  });

  it('calls a custom route too short to run what it will do', () => {
    const o = open();
    const routeTab = () =>
      o.root
        .find('k-tabs')
        ?.all.find((e) => e.tagName === 'BUTTON' && e.text().startsWith(STR.depot.routeTab));
    routeTab()?.fire('click');
    o.root.button(STR.depot.routeMode.custom).fire('click');
    expect(routeTab()?.text()).toContain(STR.depot.routeMode.auto);
    expect(o.root.find('dp-short')?.textContent).toBe(STR.depot.customShort);
  });
});
