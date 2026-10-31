import type { Input } from '../engine/input';
import type { ReclassDir } from '../world/reclass';

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
  /** the train panel is open: Escape closes it before the pause menu */
  readonly trainOpen: boolean;
  /** a route is being recorded in the overview */
  readonly recording: boolean;
  /** a train is picked in the overview */
  readonly overviewTrain: boolean;
  /** a tooltip is open: Escape closes the stack and does nothing else */
  readonly tooltipsOpen: boolean;
  toggleDebug(): void;
  /** close every tooltip */
  closeTooltips(): void;
  closeScreen(): void;
  /** close the train panel */
  closeTrain(): void;
  closeMenus(): void;
  openPauseMenu(): void;
  toggleScreen(screen: KeyScreen): void;
  toggleOverview(): void;
  /** the next (1) or the previous (-1) tool of the open category */
  cycleTool(dir: 1 | -1): void;
  /** take up or put down the tool that moves track one standard line up or down */
  toggleReclass(dir: ReclassDir): void;
  /** the next (1) or the previous (-1) type of the open category (track by gauge) */
  cycleType(dir: 1 | -1): void;
  /** the item at place `index` (0-based) of the open list; a locked one does nothing */
  selectPiece(index: number): void;
  /** the category at place `index` (0-based) of the category row */
  openCategory(index: number): void;
  /** close the category that is open with no tool in hand */
  closeCategory(): void;
  /** the next (1) or the previous (-1) category of the row, while one is open */
  cycleCategory(dir: 1 | -1): void;
  /** take up or put down Demolish */
  toggleDemolish(): void;
  /** one speed up (1) or down (-1), from pause one step from the speed it had */
  stepSpeed(dir: 1 | -1): void;
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
  /** take back the player's last building action, or do it again */
  undo(): void;
  redo(): void;
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
  | 'prevCategory'
  | 'nextCategory'
  | 'demolish'
  | 'pause'
  | 'pieceOrCategory'
  | 'speedStep'
  | 'record'
  | 'finishRoute'
  | 'undo'
  | 'redo';

export interface KeyBinding {
  /**
   * `KeyboardEvent.code`, or for the keys bound by the character they type `Char+`, `Char-`,
   * `Ctrl+Z`, `Ctrl+Y` and `Ctrl+Shift+Z` (`Input`)
   */
  readonly code: string;
  /** true: only with Shift held; false: only without; absent: either */
  readonly shift?: boolean;
  readonly context: KeyContext;
  readonly action: KeyAction;
}

/** What a digit key stands for: 1 for Digit1. */
const digitOf = (code: string) => Number(code.slice('Digit'.length));
/** The digits that open a category: the row never has more than five on show. */
const CATEGORY_KEYS = 5;

/**
 * + steps the speed up and − down. They are bound by the character they type (`Input` names them
 * `Char+` and `Char-`), as layouts move them: Shift+3 and the Slash key on a Hungarian keyboard,
 * Shift+Equal and Minus on a US one, the numpad's keys on every one.
 */
const SPEED_STEP = new Map<string, 1 | -1>([
  ['Char+', 1],
  ['Char-', -1],
]);
const SPEED_STEP_KEYS = [...SPEED_STEP.keys()];

/**
 * Each action returns true when the rest of the frame's input is left alone: Escape opened or
 * closed something. In every context Escape closes an open tooltip stack first, and then nothing
 * else.
 */
const ACTIONS: Record<KeyAction, (h: KeyHost, b: KeyBinding) => boolean> = {
  debug: (h) => {
    h.toggleDebug();
    return false;
  },
  // over a menu: a screen opened from it closes first, then the pause menu
  menuBack: (h) => {
    if (h.tooltipsOpen) h.closeTooltips();
    else if (h.screenOpen) h.closeScreen();
    else if (h.pauseMenuOpen) h.closeMenus();
    return true;
  },
  // the field view: a screen closes; with nothing in hand a category closes, else the pause menu
  // opens. A category whose items are all locked holds no tool for the build controller to drop
  pauseOrClose: (h) => {
    if (h.tooltipsOpen) h.closeTooltips();
    else if (h.screenOpen) h.closeScreen();
    else if (h.building) return false;
    else if (h.categoryOpen) h.closeCategory();
    else if (h.trainOpen) h.closeTrain();
    else h.openPauseMenu();
    return true;
  },
  // the overview: a screen closes; else a recording stops, the picked train goes, the view leaves
  overviewBack: (h) => {
    if (h.tooltipsOpen) {
      h.closeTooltips();
      return true;
    }
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
    if (!h.screenOpen) h.toggleReclass('up');
    return false;
  },
  downgradeTrack: (h) => {
    if (!h.screenOpen) h.toggleReclass('down');
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
  prevCategory: (h) => {
    if (h.categoryOpen && !h.screenOpen) h.cycleCategory(-1);
    return false;
  },
  nextCategory: (h) => {
    if (h.categoryOpen && !h.screenOpen) h.cycleCategory(1);
    return false;
  },
  demolish: (h) => {
    if (!h.screenOpen) h.toggleDemolish();
    return false;
  },
  pause: (h) => {
    h.togglePause();
    return false;
  },
  // an item of the open list, else a category of the row
  pieceOrCategory: (h, b) => {
    if (h.screenOpen) return false;
    const n = digitOf(b.code);
    if (h.categoryOpen) h.selectPiece(n - 1);
    else if (n <= CATEGORY_KEYS) h.openCategory(n - 1);
    return false;
  },
  // the level editor's clock stays stopped
  speedStep: (h, b) => {
    if (h.mode === 'play') h.stepSpeed(SPEED_STEP.get(b.code)!);
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
  undo: (h) => {
    if (historyOpen(h)) h.undo();
    return false;
  },
  redo: (h) => {
    if (historyOpen(h)) h.redo();
    return false;
  },
};

/**
 * Undo and redo work in a game, not in the level editor, with nothing in front of the world, and
 * not during a route recording, which could hold a stop at a station an undo takes away.
 */
function historyOpen(h: KeyHost) {
  return h.mode === 'play' && !h.screenOpen && !h.recording;
}

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
const UNDO_KEYS: [string, 'undo' | 'redo'][] = [
  ['Ctrl+Z', 'undo'],
  ['Ctrl+Y', 'redo'],
  ['Ctrl+Shift+Z', 'redo'],
];

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
  { code: 'KeyQ', shift: false, context: 'play', action: 'prevType' },
  { code: 'KeyE', shift: false, context: 'play', action: 'nextType' },
  // Shift+digit cannot step categories: on a Hungarian keyboard Shift+3 types the speed key +
  { code: 'KeyQ', shift: true, context: 'play', action: 'prevCategory' },
  { code: 'KeyE', shift: true, context: 'play', action: 'nextCategory' },
  { code: 'KeyX', context: 'play', action: 'demolish' },
  { code: 'Space', context: 'play', action: 'pause' },
  ...digits(9).map((code) => ({
    code,
    context: 'play' as const,
    action: 'pieceOrCategory' as const,
  })),
  ...SPEED_STEP_KEYS.map((code) => ({
    code,
    context: 'play' as const,
    action: 'speedStep' as const,
  })),
  ...UNDO_KEYS.map(([code, action]) => ({ code, context: 'play' as const, action })),

  { code: 'Backquote', context: 'overview', action: 'debug' },
  ...SCREEN_KEYS.map(([code, action]) => ({ code, context: 'overview' as const, action })),
  { code: 'Escape', context: 'overview', action: 'overviewBack' },
  { code: 'KeyM', context: 'overview', action: 'overview' },
  { code: 'Space', context: 'overview', action: 'pause' },
  ...SPEED_STEP_KEYS.map((code) => ({
    code,
    context: 'overview' as const,
    action: 'speedStep' as const,
  })),
  ...UNDO_KEYS.map(([code, action]) => ({ code, context: 'overview' as const, action })),
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
