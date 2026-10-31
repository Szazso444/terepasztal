import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STR } from '../strings';
import { WearAlertScreen } from './wearAlert';
import type { Screen, ScreenManager } from './modal';

// the buttons play a sound when clicked; the context that plays it is a browser's
vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

/** The little of the DOM `el` uses. */
function fakeElement() {
  return {
    className: '',
    textContent: '',
    style: {},
    setAttribute() {},
    append() {},
    addEventListener() {},
    replaceChildren() {},
  };
}

describe('WearAlertScreen', () => {
  let screens: { current: Screen | null; open: (s: Screen) => void; close: () => void };
  let screen: WearAlertScreen;
  let log: string[];

  beforeEach(() => {
    vi.stubGlobal('document', { createElement: fakeElement, createTextNode: (t: string) => t });
    log = [];
    screens = {
      current: null,
      open(s) {
        this.current = s;
        log.push('open');
      },
      close() {
        // the stack tells the screen it left
        this.current?.onClose?.();
        this.current = null;
        log.push('close');
      },
    };
    screen = new WearAlertScreen(screens as unknown as ScreenManager);
    screen.onDismiss = () => log.push('dismissed');
    screen.onRepair = () => log.push('repair');
    screen.onDepot = (x, y) => log.push(`depot ${x},${y}`);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens by itself and leaves the tool in the hand', () => {
    screen.show(4, 9);
    expect(screens.current).toBe(screen);
    expect(screen.keepsTool).toBe(true);
    expect(screen.title).toBe(STR.wear.title);
  });

  it('Repair leaves the window, which resumes the game, then picks the tool', () => {
    screen.show(4, 9);
    screen.repair();
    expect(log).toEqual(['open', 'dismissed', 'close', 'repair']);
  });

  it('Depot leaves the window, then opens the depot for the piece', () => {
    screen.show(4, 9);
    screen.depot();
    expect(log).toEqual(['open', 'dismissed', 'close', 'depot 4,9']);
  });

  it('offers the two buttons, Repair the primary', () => {
    const actions = screen.frameFooter().actions ?? [];
    expect(actions.map((a) => [a.label, !!a.primary])).toEqual([
      [STR.wear.depot, false],
      [STR.wear.repair, true],
    ]);
    actions[1].onClick();
    expect(log).toEqual(['close', 'repair']);
  });
});
