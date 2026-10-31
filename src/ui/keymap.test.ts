import { describe, it, expect, afterEach, vi } from 'vitest';
import { Input } from '../engine/input';
import {
  KEYMAP,
  handlePlayKeys,
  keyContext,
  type KeyAction,
  type KeyBinding,
  type KeyContext,
  type KeyHost,
  type KeyInput,
} from './keymap';

/** What the keymap reads from its host; every method of `KeyHost` is logged instead. */
type StateKey =
  | 'menuOpen'
  | 'pauseMenuOpen'
  | 'mode'
  | 'viewTarget'
  | 'overviewSettled'
  | 'screenOpen'
  | 'building'
  | 'categoryOpen'
  | 'recording'
  | 'overviewTrain'
  | 'tooltipsOpen';
type State = { -readonly [K in StateKey]: KeyHost[K] };

const CONTEXTS: KeyContext[] = ['menu', 'play', 'overview'];
const SHIFT = [false, true];

/** A host in `context` with nothing open or picked, and the log of what the keys called on it. */
function fakeHost(context: KeyContext, over: Partial<State> = {}) {
  const calls: string[] = [];
  const log =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(args.length ? `${name}(${args.join(',')})` : name);
    };
  const state: State = {
    menuOpen: context === 'menu',
    pauseMenuOpen: context === 'menu',
    mode: 'play',
    viewTarget: context === 'overview' ? 1 : 0,
    overviewSettled: context === 'overview',
    screenOpen: false,
    building: false,
    categoryOpen: false,
    recording: false,
    overviewTrain: false,
    tooltipsOpen: false,
    ...over,
  };
  const host: KeyHost = {
    ...state,
    toggleDebug: log('toggleDebug'),
    closeTooltips: log('closeTooltips'),
    closeScreen: log('closeScreen'),
    closeMenus: log('closeMenus'),
    openPauseMenu: log('openPauseMenu'),
    toggleScreen: log('toggleScreen'),
    toggleOverview: log('toggleOverview'),
    cycleTool: log('cycleTool'),
    toggleReclass: log('toggleReclass'),
    cycleType: log('cycleType'),
    selectPiece: log('selectPiece'),
    openCategory: log('openCategory'),
    closeCategory: log('closeCategory'),
    cycleCategory: log('cycleCategory'),
    toggleDemolish: log('toggleDemolish'),
    stepSpeed: log('stepSpeed'),
    togglePause: log('togglePause'),
    toggleRecording: log('toggleRecording'),
    finishRecording: log('finishRecording'),
    cancelRecording: log('cancelRecording'),
    dropOverviewTrain: log('dropOverviewTrain'),
    leaveOverview: log('leaveOverview'),
    undo: log('undo'),
    redo: log('redo'),
  };
  return { host, calls };
}

/** These keys pressed this frame, with Shift held or not. */
function keys(codes: string[], shift: boolean | 'ShiftRight' = false): KeyInput {
  const held = new Set(codes);
  if (shift) held.add(shift === true ? 'ShiftLeft' : shift);
  return { wasPressed: (c) => codes.includes(c), isDown: (c) => held.has(c) };
}

/** One situation a binding is pressed in and what it must call there. */
interface Case {
  state?: Partial<State>;
  calls: string[];
}
const screenCases = (name: string): Case[] => [
  { calls: [`toggleScreen(${name})`] },
  // the level editor has no depot, board or market
  { state: { mode: 'editor' }, calls: [] },
];
const digit = (b: KeyBinding) => Number(b.code.replace('Digit', ''));
/** + steps the speed up and − down: the typed character, wherever the layout puts it (`Input`). */
const STEP_KEYS: [string, 1 | -1][] = [
  ['Char+', 1],
  ['Char-', -1],
];
const stepDir = (b: KeyBinding) => STEP_KEYS.find(([code]) => code === b.code)![1];

const historyCases = (way: 'undo' | 'redo'): Case[] => [
  { calls: [way] },
  // nothing is recorded in the level editor, and a screen stands in front of the world
  { state: { mode: 'editor' }, calls: [] },
  { state: { screenOpen: true }, calls: [] },
  // a recording could hold a stop at a station the undo takes away
  { state: { recording: true }, calls: [] },
];

/** Every action, what it calls and what keeps it quiet. A new action without cases fails to compile. */
const CASES: Record<KeyAction, (b: KeyBinding) => Case[]> = {
  debug: () => [{ calls: ['toggleDebug'] }],
  menuBack: () => [
    { calls: ['closeMenus'] },
    { state: { screenOpen: true }, calls: ['closeScreen'] },
    // an open tooltip closes first, and that is all
    { state: { tooltipsOpen: true, screenOpen: true }, calls: ['closeTooltips'] },
    // the title screen stays up
    { state: { pauseMenuOpen: false }, calls: [] },
  ],
  pauseOrClose: () => [
    { calls: ['openPauseMenu'] },
    { state: { screenOpen: true }, calls: ['closeScreen'] },
    // a tool in hand or a picked station: Escape is the build controller's
    { state: { building: true }, calls: [] },
    { state: { building: true, categoryOpen: true }, calls: [] },
    // a category with no tool in hand, all its items locked: it closes, no pause menu
    { state: { categoryOpen: true }, calls: ['closeCategory'] },
    { state: { categoryOpen: true, screenOpen: true }, calls: ['closeScreen'] },
    // ...unless a tooltip is open: it closes, and nothing else
    { state: { tooltipsOpen: true, building: true }, calls: ['closeTooltips'] },
    { state: { tooltipsOpen: true, screenOpen: true }, calls: ['closeTooltips'] },
  ],
  overviewBack: () => [
    { calls: ['leaveOverview'] },
    { state: { screenOpen: true, recording: true }, calls: ['closeScreen'] },
    { state: { recording: true, overviewTrain: true }, calls: ['cancelRecording'] },
    { state: { overviewTrain: true }, calls: ['dropOverviewTrain'] },
    { state: { tooltipsOpen: true, recording: true }, calls: ['closeTooltips'] },
  ],
  depot: () => screenCases('depot'),
  contracts: () => screenCases('contracts'),
  crafting: () => screenCases('crafting'),
  roster: () => screenCases('roster'),
  market: () => screenCases('market'),
  overview: () => [{ calls: ['toggleOverview'] }],
  nextTool: () => [{ state: { categoryOpen: true }, calls: ['cycleTool(1)'] }, { calls: [] }],
  prevTool: () => [{ state: { categoryOpen: true }, calls: ['cycleTool(-1)'] }, { calls: [] }],
  upgradeTrack: () => [
    { calls: ['toggleReclass(up)'] },
    { state: { screenOpen: true }, calls: [] },
  ],
  downgradeTrack: () => [
    { calls: ['toggleReclass(down)'] },
    { state: { screenOpen: true }, calls: [] },
  ],
  prevType: () => [{ state: { categoryOpen: true }, calls: ['cycleType(-1)'] }, { calls: [] }],
  nextType: () => [{ state: { categoryOpen: true }, calls: ['cycleType(1)'] }, { calls: [] }],
  prevCategory: () => [
    { state: { categoryOpen: true }, calls: ['cycleCategory(-1)'] },
    { calls: [] },
    { state: { categoryOpen: true, screenOpen: true }, calls: [] },
  ],
  nextCategory: () => [
    { state: { categoryOpen: true }, calls: ['cycleCategory(1)'] },
    { calls: [] },
    { state: { categoryOpen: true, screenOpen: true }, calls: [] },
  ],
  demolish: () => [{ calls: ['toggleDemolish'] }, { state: { screenOpen: true }, calls: [] }],
  pause: () => [{ calls: ['togglePause'] }],
  pieceOrCategory: (b) => [
    { state: { categoryOpen: true }, calls: [`selectPiece(${digit(b) - 1})`] },
    { calls: digit(b) <= 5 ? [`openCategory(${digit(b) - 1})`] : [] },
    // the level editor has the same five, Terrain in the place of Roads
    { state: { mode: 'editor' }, calls: digit(b) <= 5 ? [`openCategory(${digit(b) - 1})`] : [] },
    { state: { screenOpen: true }, calls: [] },
    { state: { screenOpen: true, categoryOpen: true }, calls: [] },
  ],
  speedStep: (b) => [
    { calls: [`stepSpeed(${stepDir(b)})`] },
    // the level editor's clock stays stopped
    { state: { mode: 'editor' }, calls: [] },
  ],
  record: () => [
    { calls: ['toggleRecording'] },
    { state: { recording: true }, calls: ['toggleRecording'] },
    // the overview is still sliding in
    { state: { overviewSettled: false }, calls: [] },
  ],
  finishRoute: () => [
    { state: { recording: true }, calls: ['finishRecording'] },
    { calls: [] },
    { state: { recording: true, overviewSettled: false }, calls: [] },
  ],
  undo: () => historyCases('undo'),
  redo: () => historyCases('redo'),
};

const shiftsOf = (b: KeyBinding) => (b.shift === undefined ? SHIFT : [b.shift]);
const binds = (b: KeyBinding, context: KeyContext, code: string, shift: boolean) =>
  b.context === context && b.code === code && (b.shift === undefined || b.shift === shift);
const bound = (context: KeyContext, code: string, shift: boolean) =>
  KEYMAP.some((b) => binds(b, context, code, shift));

/** The keys the game had before the keymap, where they work; no shift given means with or without. */
const DIGITS = (n: number) => Array.from({ length: n }, (_, i) => `Digit${i + 1}`);
const REQUIRED: [KeyContext, string, boolean?][] = [
  ...CONTEXTS.map((c): [KeyContext, string] => [c, 'Backquote']),
  ...CONTEXTS.map((c): [KeyContext, string] => [c, 'Escape']),
  ...['KeyF', 'KeyC', 'KeyG', 'KeyV', 'KeyK', 'KeyM', 'Space'].flatMap(
    (k): [KeyContext, string][] => [
      ['play', k],
      ['overview', k],
    ],
  ),
  ['play', 'Tab', false],
  ['play', 'Tab', true],
  ['play', 'KeyU', false],
  ['play', 'KeyU', true],
  ['play', 'KeyQ'],
  ['play', 'KeyE'],
  ['play', 'KeyX'],
  ...DIGITS(9).map((k): [KeyContext, string] => ['play', k]),
  ['overview', 'KeyR'],
  ['overview', 'Enter'],
  // + and − step the speed in both views
  ...STEP_KEYS.flatMap(([k]): [KeyContext, string][] => [
    ['play', k],
    ['overview', k],
  ]),
];

describe('the play keymap', () => {
  it('binds every hotkey the game has, in the context it works in', () => {
    for (const [context, code, shift] of REQUIRED)
      for (const s of shift === undefined ? SHIFT : [shift])
        expect(bound(context, code, s), `${context} ${s ? 'Shift+' : ''}${code}`).toBe(true);
  });

  it('takes only the debug key and Escape while a menu is up', () => {
    const menu = KEYMAP.filter((b) => b.context === 'menu').map((b) => b.code);
    expect(menu.sort()).toEqual(['Backquote', 'Escape']);
  });

  it('gives a key and shift state one binding per context', () => {
    const seen = new Set<string>();
    for (const b of KEYMAP)
      for (const s of shiftsOf(b)) {
        const key = `${b.context} ${s ? 'Shift+' : ''}${b.code}`;
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
      }
  });

  it('runs each binding in its own context', () => {
    for (const b of KEYMAP)
      for (const c of CASES[b.action](b))
        for (const s of shiftsOf(b)) {
          const { host, calls } = fakeHost(b.context, c.state);
          handlePlayKeys(keys([b.code], s), host);
          expect(
            calls,
            `${b.context} ${s ? 'Shift+' : ''}${b.code} ${JSON.stringify(c.state)}`,
          ).toEqual(c.calls);
        }
  });

  it('does nothing with a key in a context that does not bind it', () => {
    for (const b of KEYMAP)
      for (const context of CONTEXTS)
        for (const s of SHIFT) {
          if (bound(context, b.code, s)) continue;
          for (const c of CASES[b.action](b)) {
            const { host, calls } = fakeHost(context, c.state);
            handlePlayKeys(keys([b.code], s), host);
            expect(calls, `${context} ${s ? 'Shift+' : ''}${b.code}`).toEqual([]);
          }
        }
  });

  it('reads either shift key', () => {
    const { host, calls } = fakeHost('play', { categoryOpen: true });
    handlePlayKeys(keys(['Tab'], 'ShiftRight'), host);
    expect(calls).toEqual(['cycleTool(-1)']);
  });

  it('does nothing with no key pressed', () => {
    for (const context of CONTEXTS) {
      const { host, calls } = fakeHost(context, { categoryOpen: true, recording: true });
      handlePlayKeys(keys([]), host);
      expect(calls).toEqual([]);
    }
  });
});

describe('the build bar keys', () => {
  it('sets the speed with no digit anywhere: Space, + and − and the buttons are left', () => {
    for (const context of CONTEXTS)
      for (const code of DIGITS(9))
        for (const state of [{}, { categoryOpen: true }])
          for (const shift of SHIFT) {
            const { host, calls } = fakeHost(context, state);
            handlePlayKeys(keys([code], shift), host);
            expect(calls.join(), `${context} ${code}`).not.toMatch(/speed/i);
          }
    expect(KEYMAP.some((b) => b.context === 'overview' && b.code.startsWith('Digit'))).toBe(false);
  });

  it('tells the type from the category by Shift on Q and E', () => {
    const steps: [string, boolean, string][] = [
      ['KeyQ', false, 'cycleType(-1)'],
      ['KeyE', false, 'cycleType(1)'],
      ['KeyQ', true, 'cycleCategory(-1)'],
      ['KeyE', true, 'cycleCategory(1)'],
    ];
    for (const [code, shift, call] of steps) {
      const { host, calls } = fakeHost('play', { categoryOpen: true });
      handlePlayKeys(keys([code], shift), host);
      expect(calls).toEqual([call]);
    }
  });

  it('takes X in the field view of a game and of the editor, and not in the overview', () => {
    for (const mode of ['play', 'editor'] as const) {
      const { host, calls } = fakeHost('play', { mode });
      handlePlayKeys(keys(['KeyX']), host);
      expect(calls, mode).toEqual(['toggleDemolish']);
    }
    const { host, calls } = fakeHost('overview');
    handlePlayKeys(keys(['KeyX']), host);
    expect(calls).toEqual([]);
  });

  it('leaves the build controller its Escape with a tool in hand, and ends the frame without one', () => {
    const held = fakeHost('play', { building: true, categoryOpen: true });
    expect(handlePlayKeys(keys(['Escape']), held.host)).toBe(false);
    expect(held.calls).toEqual([]);
    const bare = fakeHost('play', { categoryOpen: true });
    expect(handlePlayKeys(keys(['Escape']), bare.host)).toBe(true);
    expect(bare.calls).toEqual(['closeCategory']);
  });
});

describe('what the keys leave to the camera', () => {
  it('reads a menu over either view as the menu context', () => {
    expect(keyContext({ menuOpen: true, viewTarget: 1 })).toBe('menu');
    expect(keyContext({ menuOpen: false, viewTarget: 1 })).toBe('overview');
    expect(keyContext({ menuOpen: false, viewTarget: 0 })).toBe('play');
  });

  it('holds the camera while a menu is up, and not otherwise', () => {
    for (const context of CONTEXTS)
      expect(handlePlayKeys(keys([]), fakeHost(context).host)).toBe(context === 'menu');
  });

  it('ends the frame when Escape opens or closes something', () => {
    const opened = fakeHost('play');
    expect(handlePlayKeys(keys(['Escape', 'Space']), opened.host)).toBe(true);
    expect(opened.calls).toEqual(['openPauseMenu']);

    const closed = fakeHost('overview', { screenOpen: true });
    expect(handlePlayKeys(keys(['Escape', 'Space']), closed.host)).toBe(true);
    expect(closed.calls).toEqual(['closeScreen']);

    // closing the tooltips is all Escape does, in every context
    for (const context of CONTEXTS) {
      const tips = fakeHost(context, { tooltipsOpen: true, building: true });
      expect(handlePlayKeys(keys(['Escape', 'Space']), tips.host), context).toBe(true);
      expect(tips.calls, context).toEqual(['closeTooltips']);
    }
  });

  it('lets the frame go on when Escape belongs to the build controller or steps back in the overview', () => {
    const building = fakeHost('play', { building: true });
    expect(handlePlayKeys(keys(['Escape', 'Space']), building.host)).toBe(false);
    expect(building.calls).toEqual(['togglePause']);

    const overview = fakeHost('overview', { overviewTrain: true });
    expect(handlePlayKeys(keys(['Escape', 'Space']), overview.host)).toBe(false);
    expect(overview.calls).toEqual(['dropOverviewTrain', 'togglePause']);
  });
});

describe('Escape and the tooltip stack, in every state the keys read', () => {
  const FLAGS = [
    'pauseMenuOpen',
    'overviewSettled',
    'screenOpen',
    'building',
    'categoryOpen',
    'recording',
    'overviewTrain',
  ] as const;

  /** Every host state a context can be in: each flag on and off, in play and in the editor. */
  function* states(): Generator<Partial<State>> {
    for (let bits = 0; bits < 1 << FLAGS.length; bits++)
      for (const mode of ['play', 'editor'] as const) {
        const s: Partial<State> = { mode };
        FLAGS.forEach((f, i) => (s[f] = (bits & (1 << i)) !== 0));
        yield s;
      }
  }
  const codes = [...new Set(KEYMAP.map((b) => b.code))];

  it('closes the tooltips and does nothing else when they are open, whatever else is', () => {
    for (const context of CONTEXTS)
      for (const s of states()) {
        const { host, calls } = fakeHost(context, { ...s, tooltipsOpen: true });
        const at = `${context} ${JSON.stringify(s)}`;
        expect(handlePlayKeys(keys(['Escape']), host), at).toBe(true);
        expect(calls, at).toEqual(['closeTooltips']);
      }
  });

  it('leaves every other key, and Escape with no tooltip open, as they were', () => {
    for (const context of CONTEXTS)
      for (const s of states())
        for (const code of codes)
          for (const shift of SHIFT) {
            const closed = fakeHost(context, { ...s, tooltipsOpen: false });
            const ended = handlePlayKeys(keys([code], shift), closed.host);
            const at = () => `${context} ${shift ? 'Shift+' : ''}${code} ${JSON.stringify(s)}`;
            if (closed.calls.includes('closeTooltips')) expect(closed.calls, at()).toEqual([]);
            if (code === 'Escape') continue;
            const open = fakeHost(context, { ...s, tooltipsOpen: true });
            const openEnded = handlePlayKeys(keys([code], shift), open.host);
            // compared by hand: a matcher per case is most of the time this takes
            if (openEnded !== ended || open.calls.join() !== closed.calls.join())
              expect({ ended: openEnded, calls: open.calls }, at()).toEqual({
                ended,
                calls: closed.calls,
              });
          }
  });
});

describe('+ and − as the browser types them', () => {
  /** A real `Input` on stand-ins for the window, the document and the canvas. */
  function browserInput() {
    const handlers = new Map<string, ((e: unknown) => void)[]>();
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: (e: unknown) => void) =>
        handlers.set(type, [...(handlers.get(type) ?? []), fn]),
    });
    vi.stubGlobal('document', { addEventListener: () => {} });
    const input = new Input({ addEventListener: () => {} } as unknown as HTMLElement);
    /** a key event with this `code` (where the key sits) and `key` (what it types) */
    const fire = (
      type: 'keydown' | 'keyup',
      code: string,
      key: string,
      shiftKey = false,
      mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {},
    ) => {
      for (const fn of handlers.get(type) ?? [])
        fn({ code, key, shiftKey, ...mods, target: null, preventDefault() {} });
    };
    return { input, fire };
  }
  afterEach(() => vi.unstubAllGlobals());

  /** What one key press calls in `context`, with Shift held first when `shift`. */
  function press(context: KeyContext, code: string, key: string, shift: boolean, state = {}) {
    const { input, fire } = browserInput();
    if (shift) fire('keydown', 'ShiftLeft', 'Shift', true);
    fire('keydown', code, key, shift);
    const { host, calls } = fakeHost(context, state);
    handlePlayKeys(input, host);
    return calls;
  }

  // [layout, code, key, Shift held, the step]
  const TYPED: [string, string, string, boolean, 1 | -1][] = [
    ['Hungarian +', 'Digit3', '+', true, 1],
    ['Hungarian −', 'Slash', '-', false, -1],
    ['US +', 'Equal', '+', true, 1],
    ['US −', 'Minus', '-', false, -1],
    ['numpad +', 'NumpadAdd', '+', false, 1],
    ['numpad −', 'NumpadSubtract', '-', false, -1],
  ];
  it.each(TYPED)('%s (%s typing %s) steps the speed in both views', (_, code, key, shift, dir) => {
    for (const context of ['play', 'overview'] as const)
      for (const state of [{}, { categoryOpen: true }])
        expect(
          press(context, code, key, shift, state),
          `${context} ${JSON.stringify(state)}`,
        ).toEqual([`stepSpeed(${dir})`]);
  });

  it('a − typed by an unshifted digit (Digit6 on AZERTY) is that digit: piece 6, no step', () => {
    expect(press('play', 'Digit6', '-', false, { categoryOpen: true })).toEqual(['selectPiece(5)']);
    expect(press('play', 'Digit6', '-', false)).toEqual([]);
    expect(press('overview', 'Digit6', '-', false)).toEqual([]);
    // and Shift+Digit6 types '6' there: the same piece
    expect(press('play', 'Digit6', '6', true, { categoryOpen: true })).toEqual(['selectPiece(5)']);
  });

  it.each(['ctrlKey', 'metaKey', 'altKey'] as const)(
    'Ctrl, Meta or Alt (%s) with + or − zooms the browser, and is no speed step',
    (mod) => {
      for (const [, code, key, shift] of TYPED) {
        const { input, fire } = browserInput();
        fire('keydown', code, key, shift, { [mod]: true });
        expect(input.wasPressed('Char+'), `${code} ${key}`).toBe(false);
        expect(input.wasPressed('Char-'), `${code} ${key}`).toBe(false);
        const { host, calls } = fakeHost('play');
        handlePlayKeys(input, host);
        expect(calls, `${mod} ${code} ${key}`).not.toContain('stepSpeed(1)');
        expect(calls, `${mod} ${code} ${key}`).not.toContain('stepSpeed(-1)');
      }
    },
  );

  it('a + typed as Shift+3 is no digit 3: it picks no piece and opens no category', () => {
    expect(press('play', 'Digit3', '+', true, { categoryOpen: true })).not.toContain(
      'selectPiece(2)',
    );
    expect(press('play', 'Digit3', '+', true)).toEqual(['stepSpeed(1)']);
    expect(press('overview', 'Digit3', '+', true)).toEqual(['stepSpeed(1)']);
  });

  it('the 3 key still picks piece 3 or category 3 when it types a 3, after a + on it was let go', () => {
    const { input, fire } = browserInput();
    fire('keydown', 'Digit3', '+', true);
    input.endFrame();
    fire('keyup', 'Digit3', '+', true);
    fire('keydown', 'Digit3', '3');
    expect(input.isDown('Digit3')).toBe(true);
    const plain = fakeHost('play');
    handlePlayKeys(input, plain.host);
    expect(plain.calls).toEqual(['openCategory(2)']);
    const piece = fakeHost('play', { categoryOpen: true });
    handlePlayKeys(input, piece.host);
    expect(piece.calls).toEqual(['selectPiece(2)']);
  });

  it('holds the key that typed + down by where it sits, until it is let go', () => {
    const { input, fire } = browserInput();
    fire('keydown', 'Digit3', '+', true);
    expect(input.wasPressed('Char+')).toBe(true);
    expect(input.wasPressed('Digit3')).toBe(false);
    expect(input.isDown('Digit3')).toBe(true);
    // a held key repeats: no second press
    input.endFrame();
    fire('keydown', 'Digit3', '+', true);
    expect(input.wasPressed('Char+')).toBe(false);
    fire('keyup', 'Digit3', '+', true);
    expect(input.isDown('Digit3')).toBe(false);
  });
});

describe('undo and redo as the browser types them', () => {
  /** A real `Input` on stand-ins for the window, the document and the canvas. */
  function browserInput() {
    const handlers = new Map<string, ((e: unknown) => void)[]>();
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: (e: unknown) => void) =>
        handlers.set(type, [...(handlers.get(type) ?? []), fn]),
    });
    vi.stubGlobal('document', { addEventListener: () => {} });
    const input = new Input({ addEventListener: () => {} } as unknown as HTMLElement);
    return { input, handlers };
  }
  afterEach(() => vi.unstubAllGlobals());

  interface Press {
    code: string;
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    /** the element with the focus */
    target?: { tagName: string } | null;
  }
  /** What one key down calls in `context`, and whether the browser's own action was stopped. */
  function press(e: Press, context: KeyContext = 'play', state = {}) {
    const { input, handlers } = browserInput();
    let stopped = false;
    for (const fn of handlers.get('keydown') ?? [])
      fn({ shiftKey: false, target: null, preventDefault: () => (stopped = true), ...e });
    const { host, calls } = fakeHost(context, state);
    handlePlayKeys(input, host);
    return { calls, stopped };
  }

  // [layout, code, key, Shift held, what it does]
  const KEYS: [string, string, string, boolean, 'undo' | 'redo'][] = [
    ['US Ctrl+Z', 'KeyZ', 'z', false, 'undo'],
    ['US Ctrl+Y', 'KeyY', 'y', false, 'redo'],
    ['US Ctrl+Shift+Z', 'KeyZ', 'Z', true, 'redo'],
    ['Hungarian Ctrl+Z, on the key that is Y elsewhere', 'KeyY', 'z', false, 'undo'],
    ['Hungarian Ctrl+Y, on the key that is Z elsewhere', 'KeyZ', 'y', false, 'redo'],
    ['Hungarian Ctrl+Shift+Z', 'KeyY', 'Z', true, 'redo'],
    ['Caps Lock on', 'KeyZ', 'Z', false, 'undo'],
  ];
  it.each(KEYS)('%s (%s typing %s), in both views, Ctrl or Cmd', (_, code, key, shiftKey, call) => {
    for (const context of ['play', 'overview'] as const)
      for (const mod of [{ ctrlKey: true }, { metaKey: true }])
        expect(press({ code, key, shiftKey, ...mod }, context)).toEqual({
          calls: [call],
          stopped: true,
        });
  });

  it('stops the browser only for its own undo and redo', () => {
    expect(press({ code: 'KeyZ', key: 'z' })).toEqual({ calls: [], stopped: false });
    expect(press({ code: 'KeyS', key: 's', ctrlKey: true }).stopped).toBe(false);
    expect(press({ code: 'KeyY', key: 'y', ctrlKey: true, shiftKey: true }).stopped).toBe(false);
  });

  it('is no undo with AltGr, which reports Ctrl and Alt and types', () => {
    const z = { code: 'KeyZ', key: 'z', ctrlKey: true, altKey: true };
    expect(press(z)).toEqual({ calls: [], stopped: false });
  });

  it('stays off while a text input has the focus, where the browser undoes the typing', () => {
    for (const tagName of ['INPUT', 'TEXTAREA'])
      expect(press({ code: 'KeyZ', key: 'z', ctrlKey: true, target: { tagName } })).toEqual({
        calls: [],
        stopped: false,
      });
  });

  it('does nothing over a menu', () => {
    expect(press({ code: 'KeyZ', key: 'z', ctrlKey: true }, 'menu').calls).toEqual([]);
  });

  it('takes a second press with no key up between, as macOS sends none under Cmd', () => {
    const { input, handlers } = browserInput();
    const down = (repeat: boolean) => {
      for (const fn of handlers.get('keydown') ?? [])
        fn({
          code: 'KeyZ',
          key: 'z',
          metaKey: true,
          repeat,
          target: null,
          preventDefault() {},
        });
      const { host, calls } = fakeHost('play');
      handlePlayKeys(input, host);
      input.endFrame();
      return calls;
    };
    expect(down(false)).toEqual(['undo']);
    expect(down(false)).toEqual(['undo']);
    // a key held down repeats, and that is no new press
    expect(down(true)).toEqual([]);
  });
});
