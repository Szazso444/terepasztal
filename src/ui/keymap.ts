import type { Input } from '../engine/input';
import type { WideClass } from '../world/reclass';

/**
 * The play keymap: every hotkey of the game in one table, and the handler that runs it each
 * frame. Camera keys (pan, edge scroll, middle drag, wheel zoom) are not here: they stay with the
 * camera in `src/game.ts`. DOM-free, so it is tested under Node.
 */

/** Where a key is pressed: over a menu, in the field view or in the overview. */
export type KeyContext = 'menu' | 'play' | 'overview';

/** The screens a letter key opens and closes. */
export type KeyScreen = 'depot' | 'contracts' | 'crafting' | 'roster' | 'market';

/** What the keys read and do. `PlayUi.keys` is the game's; a test passes a fake. */
export interface KeyHost {
  /** the title or the pause menu is up */
  readonly menuOpen: boolean;
  readonly pauseMenuOpen: boolean;
  readonly mode: 'play' | 'editor';
  /** 0 the field view, 1 the overview */
  readonly viewTarget: 0 | 1;
  /** the overview has finished sliding in: its pointer and route keys work from then on */
  readonly overviewSettled: boolean;
  /** a modal screen is open */
  readonly screenOpen: boolean;
  /** a build tool is in hand or a station is picked: Escape is the build controller's then */
  readonly building: boolean;
  /** a toolbar category is open */
  readonly categoryOpen: boolean;
  /** a route is being recorded in the overview */
  readonly recording: boolean;
  /** a train is picked in the overview */
  readonly overviewTrain: boolean;
  toggleDebug(): void;
  closeScreen(): void;
  closeMenus(): void;
  openPauseMenu(): void;
  toggleScreen(screen: KeyScreen): void;
  toggleOverview(): void;
  /** the next (1) or the previous (-1) tool of the open category */
  cycleTool(dir: 1 | -1): void;
  /** take up or put down the tool that turns wide track into `target` */
  toggleReclass(target: WideClass): void;
  /** the next (1) or the previous (-1) type of the open category (track by gauge) */
  cycleType(dir: 1 | -1): void;
  /** the piece in slot `index` (0-based) of the open category */
  selectPiece(index: number): void;
  setSpeed(speed: number): void;
  togglePause(): void;
  /** start recording stops for the picked train, or finish the recording */
  toggleRecording(): void;
  finishRecording(): void;
  /** drop the recording without changing the train's schedule */
  cancelRecording(): void;
  /** forget the train picked in the overview */
  dropOverviewTrain(): void;
  /** back to the field view where the camera stands */
  leaveOverview(): void;
}

/** The input the keymap reads: a key pressed this frame, a key held. */
export type KeyInput = Pick<Input, 'wasPressed' | 'isDown'>;

/** What a binding does; the name says it, `ACTIONS` holds the code. */
export type KeyAction =
  | 'debug'
  | 'menuBack'
  | 'pauseOrClose'
  | 'overviewBack'
  | KeyScreen
  | 'overview'
  | 'nextTool'
  | 'prevTool'
  | 'upgradeTrack'
  | 'downgradeTrack'
  | 'prevType'
  | 'nextType'
  | 'pause'
  | 'pieceOrSpeed'
  | 'speed'
  | 'record'
  | 'finishRoute';

export interface KeyBinding {
  /** `KeyboardEvent.code` */
  readonly code: string;
  /** true: only with Shift held; false: only without; absent: either */
  readonly shift?: boolean;
  readonly context: KeyContext;
  readonly action: KeyAction;
}

/** The slot or the speed a digit key stands for: 1 for Digit1. */
const digitOf = (code: string) => Number(code.slice('Digit'.length));

/**
 * Each action returns true when the rest of the frame's input is left alone: Escape opened or
 * closed something.
 */
const ACTIONS: Record<KeyAction, (h: KeyHost, b: KeyBinding) => boolean> = {
  debug: (h) => {
    h.toggleDebug();
    return false;
  },
  // over a menu: a screen opened from it closes first, then the pause menu
  menuBack: (h) => {
    if (h.screenOpen) h.closeScreen();
    else if (h.pauseMenuOpen) h.closeMenus();
    return true;
  },
  // the field view: a screen closes; with nothing in hand the pause menu opens
  pauseOrClose: (h) => {
    if (h.screenOpen) h.closeScreen();
    else if (!h.building) h.openPauseMenu();
    else return false;
    return true;
  },
  // the overview: a screen closes; else a recording stops, the picked train goes, the view leaves
  overviewBack: (h) => {
    if (h.screenOpen) {
      h.closeScreen();
      return true;
    }
    if (h.recording) h.cancelRecording();
    else if (h.overviewTrain) h.dropOverviewTrain();
    else h.leaveOverview();
    return false;
  },
  depot: (h) => screen(h, 'depot'),
  contracts: (h) => screen(h, 'contracts'),
  crafting: (h) => screen(h, 'crafting'),
  roster: (h) => screen(h, 'roster'),
  market: (h) => screen(h, 'market'),
  overview: (h) => {
    h.toggleOverview();
    return false;
  },
  nextTool: (h) => {
    if (h.categoryOpen) h.cycleTool(1);
    return false;
  },
  prevTool: (h) => {
    if (h.categoryOpen) h.cycleTool(-1);
    return false;
  },
  upgradeTrack: (h) => {
    if (!h.screenOpen) h.toggleReclass('high_speed');
    return false;
  },
  downgradeTrack: (h) => {
    if (!h.screenOpen) h.toggleReclass('regular');
    return false;
  },
  prevType: (h) => {
    if (h.categoryOpen) h.cycleType(-1);
    return false;
  },
  nextType: (h) => {
    if (h.categoryOpen) h.cycleType(1);
    return false;
  },
  pause: (h) => {
    h.togglePause();
    return false;
  },
  // a piece of the open category, else game speed 1 to 3
  pieceOrSpeed: (h, b) => {
    const n = digitOf(b.code);
    if (h.categoryOpen) h.selectPiece(n - 1);
    else if (n <= 3) h.setSpeed(n);
    return false;
  },
  speed: (h, b) => {
    h.setSpeed(digitOf(b.code));
    return false;
  },
  record: (h) => {
    if (h.overviewSettled) h.toggleRecording();
    return false;
  },
  finishRoute: (h) => {
    if (h.overviewSettled && h.recording) h.finishRecording();
    return false;
  },
};

/** The letter keys open their screens in a game, not in the level editor. */
function screen(h: KeyHost, s: KeyScreen) {
  if (h.mode === 'play') h.toggleScreen(s);
  return false;
}

const SCREEN_KEYS: [string, KeyScreen][] = [
  ['KeyF', 'depot'],
  ['KeyC', 'contracts'],
  ['KeyG', 'crafting'],
  ['KeyV', 'roster'],
  ['KeyK', 'market'],
];
const digits = (n: number) => Array.from({ length: n }, (_, i) => `Digit${i + 1}`);

/** Every hotkey, in the order a frame runs them. */
export const KEYMAP: readonly KeyBinding[] = [
  { code: 'Backquote', context: 'menu', action: 'debug' },
  { code: 'Escape', context: 'menu', action: 'menuBack' },

  { code: 'Backquote', context: 'play', action: 'debug' },
  { code: 'Escape', context: 'play', action: 'pauseOrClose' },
  ...SCREEN_KEYS.map(([code, action]) => ({ code, context: 'play' as const, action })),
  { code: 'KeyM', context: 'play', action: 'overview' },
  { code: 'Tab', shift: false, context: 'play', action: 'nextTool' },
  { code: 'Tab', shift: true, context: 'play', action: 'prevTool' },
  { code: 'KeyU', shift: false, context: 'play', action: 'upgradeTrack' },
  { code: 'KeyU', shift: true, context: 'play', action: 'downgradeTrack' },
  { code: 'KeyQ', context: 'play', action: 'prevType' },
  { code: 'KeyE', context: 'play', action: 'nextType' },
  { code: 'Space', context: 'play', action: 'pause' },
  ...digits(9).map((code) => ({ code, context: 'play' as const, action: 'pieceOrSpeed' as const })),

  { code: 'Backquote', context: 'overview', action: 'debug' },
  ...SCREEN_KEYS.map(([code, action]) => ({ code, context: 'overview' as const, action })),
  { code: 'Escape', context: 'overview', action: 'overviewBack' },
  { code: 'KeyM', context: 'overview', action: 'overview' },
  { code: 'Space', context: 'overview', action: 'pause' },
  ...digits(3).map((code) => ({ code, context: 'overview' as const, action: 'speed' as const })),
  { code: 'KeyR', context: 'overview', action: 'record' },
  { code: 'Enter', context: 'overview', action: 'finishRoute' },
];

/** The context the keys of this frame belong to. */
export function keyContext(h: Pick<KeyHost, 'menuOpen' | 'viewTarget'>): KeyContext {
  return h.menuOpen ? 'menu' : h.viewTarget === 1 ? 'overview' : 'play';
}

/**
 * Run this frame's hotkeys. Returns true when the rest of the frame's input (the camera) is left
 * alone: a menu is open, or Escape opened or closed something.
 */
export function handlePlayKeys(input: KeyInput, host: KeyHost): boolean {
  const context = keyContext(host);
  const shift = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
  for (const b of KEYMAP) {
    if (b.context !== context || !input.wasPressed(b.code)) continue;
    if (b.shift !== undefined && b.shift !== shift) continue;
    if (ACTIONS[b.action](host, b)) return true;
  }
  return context === 'menu';
}
