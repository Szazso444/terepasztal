import { describe, it, expect } from 'vitest';
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
  | 'overviewTrain';
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
    ...over,
  };
  const host: KeyHost = {
    ...state,
    toggleDebug: log('toggleDebug'),
    closeScreen: log('closeScreen'),
    closeMenus: log('closeMenus'),
    openPauseMenu: log('openPauseMenu'),
    toggleScreen: log('toggleScreen'),
    toggleOverview: log('toggleOverview'),
    cycleTool: log('cycleTool'),
    toggleReclass: log('toggleReclass'),
    cycleType: log('cycleType'),
    selectPiece: log('selectPiece'),
    setSpeed: log('setSpeed'),
    togglePause: log('togglePause'),
    toggleRecording: log('toggleRecording'),
    finishRecording: log('finishRecording'),
    cancelRecording: log('cancelRecording'),
    dropOverviewTrain: log('dropOverviewTrain'),
    leaveOverview: log('leaveOverview'),
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

/** Every action, what it calls and what keeps it quiet. A new action without cases fails to compile. */
const CASES: Record<KeyAction, (b: KeyBinding) => Case[]> = {
  debug: () => [{ calls: ['toggleDebug'] }],
  menuBack: () => [
    { calls: ['closeMenus'] },
    { state: { screenOpen: true }, calls: ['closeScreen'] },
    // the title screen stays up
    { state: { pauseMenuOpen: false }, calls: [] },
  ],
  pauseOrClose: () => [
    { calls: ['openPauseMenu'] },
    { state: { screenOpen: true }, calls: ['closeScreen'] },
    // a tool in hand or a picked station: Escape is the build controller's
    { state: { building: true }, calls: [] },
  ],
  overviewBack: () => [
    { calls: ['leaveOverview'] },
    { state: { screenOpen: true, recording: true }, calls: ['closeScreen'] },
    { state: { recording: true, overviewTrain: true }, calls: ['cancelRecording'] },
    { state: { overviewTrain: true }, calls: ['dropOverviewTrain'] },
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
    { calls: ['toggleReclass(high_speed)'] },
    { state: { screenOpen: true }, calls: [] },
  ],
  downgradeTrack: () => [
    { calls: ['toggleReclass(regular)'] },
    { state: { screenOpen: true }, calls: [] },
  ],
  prevType: () => [{ state: { categoryOpen: true }, calls: ['cycleType(-1)'] }, { calls: [] }],
  nextType: () => [{ state: { categoryOpen: true }, calls: ['cycleType(1)'] }, { calls: [] }],
  pause: () => [{ calls: ['togglePause'] }],
  pieceOrSpeed: (b) => [
    { state: { categoryOpen: true }, calls: [`selectPiece(${digit(b) - 1})`] },
    { calls: digit(b) <= 3 ? [`setSpeed(${digit(b)})`] : [] },
  ],
  speed: (b) => [{ calls: [`setSpeed(${digit(b)})`] }],
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
  ...DIGITS(9).map((k): [KeyContext, string] => ['play', k]),
  ...DIGITS(3).map((k): [KeyContext, string] => ['overview', k]),
  ['overview', 'KeyR'],
  ['overview', 'Enter'],
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
