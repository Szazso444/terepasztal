import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Notice } from '../sim/notices';
import { STR } from '../strings';
import { AlertPopup } from './alertPopup';
import type { Screen, ScreenManager } from './modal';

// the buttons play a sound when clicked; the context that plays it is a browser's
vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

/** The little of the DOM `el` and `btn` use. */
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

function goal(key: string): Notice {
  return { key, kind: 'info', type: 'goal', text: `says ${key}`, target: null };
}

describe('AlertPopup', () => {
  let free: boolean;
  let screens: { current: Screen | null; open: (s: Screen) => void; close: () => void };
  let popup: AlertPopup;

  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: fakeElement,
      createTextNode: (t: string) => t,
    });
    free = true;
    screens = {
      current: null,
      open(s) {
        this.current = s;
      },
      close() {
        this.current = null;
      },
    };
    popup = new AlertPopup(
      screens as unknown as ScreenManager,
      () => free,
      () => undefined,
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('leaves the build tool in the hand: it opens by itself', () => {
    expect(popup.keepsTool).toBe(true);
  });

  it('opens under the name of its row', () => {
    popup.show(goal('a'));
    popup.pump();
    expect(screens.current).toBe(popup);
    expect(popup.title).toBe(STR.alerts.type.goal);
  });

  it('waits for a dialog above the screens, then opens', () => {
    free = false;
    popup.show(goal('a'));
    popup.pump();
    expect(screens.current).toBeNull();
    free = true;
    popup.pump();
    expect(screens.current).toBe(popup);
  });

  it('waits for another screen, then opens', () => {
    const other = { id: 'x' } as Screen;
    screens.current = other;
    popup.show(goal('a'));
    popup.pump();
    expect(screens.current).toBe(other);
    screens.current = null;
    popup.pump();
    expect(screens.current).toBe(popup);
  });

  it('shows one at a time, the next when the last is closed', () => {
    popup.show({ ...goal('a'), type: 'stuck' });
    popup.show(goal('b'));
    popup.pump();
    expect(popup.title).toBe(STR.alerts.type.stuck);
    popup.pump();
    expect(popup.title).toBe(STR.alerts.type.stuck);
    screens.close();
    popup.pump();
    expect(popup.title).toBe(STR.alerts.type.goal);
  });

  it('does nothing with nothing to say', () => {
    popup.pump();
    expect(screens.current).toBeNull();
  });
});
