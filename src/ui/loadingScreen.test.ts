import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const unlock = vi.hoisted(() => vi.fn());
const sfx = vi.hoisted(() => vi.fn());
vi.mock('../engine/audio', () => ({ audio: { unlock }, sfx }));

import { SKIP_GUARD_MS } from './loadingMath';
import { LoadingScreen } from './loadingScreen';

/**
 * Just enough of a browser for the component: elements that hold their listeners, and a window
 * that runs a key press the way the real one does, capture listeners first and then the bubble
 * ones, with `stopImmediatePropagation` ending the run. The audio bus's own listener is a bubble
 * listener on window (`audio.ts`); `reachedAudio` records whether a key got to it.
 */
class FakeElement {
  className = '';
  textContent = '';
  style = { setProperty: () => {} } as unknown as CSSStyleDeclaration;
  classList = { add: () => {}, remove: () => {} };
  private readonly listeners = new Map<string, (() => void)[]>();
  setAttribute() {}
  append() {}
  remove() {}
  getBoundingClientRect() {
    return { width: 800, height: 600 };
  }
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  click() {
    for (const fn of this.listeners.get('click') ?? []) fn();
  }
}

type KeyListener = (e: Record<string, unknown>) => void;

function fakeBrowser() {
  const capture: KeyListener[] = [];
  const bubble: KeyListener[] = [];
  let reachedAudio = false;
  const win = {
    addEventListener: (type: string, fn: KeyListener, useCapture?: boolean) => {
      if (type === 'keydown') (useCapture ? capture : bubble).push(fn);
    },
    removeEventListener: (type: string, fn: KeyListener, useCapture?: boolean) => {
      const list = useCapture ? capture : bubble;
      if (type === 'keydown' && list.includes(fn)) list.splice(list.indexOf(fn), 1);
    },
    matchMedia: () => ({ matches: false }),
  };
  bubble.push(() => (reachedAudio = true));
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', {
    createElement: () => new FakeElement(),
    createTextNode: (text: string) => ({ text }),
    body: new FakeElement(),
  });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});

  return {
    get reachedAudio() {
      return reachedAudio;
    },
    /** A key press; true when the game's own (bubble) listeners would have seen it. */
    press(key: string, mods: Record<string, boolean> = {}) {
      reachedAudio = false;
      let stopped = false;
      const e = {
        key,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        repeat: false,
        ...mods,
        preventDefault: () => {},
        stopImmediatePropagation: () => (stopped = true),
      };
      for (const fn of [...capture]) {
        fn(e);
        if (stopped) return false;
      }
      for (const fn of [...bubble]) fn(e);
      return true;
    },
  };
}

describe('the loading screen and the audio bus', () => {
  let browser: ReturnType<typeof fakeBrowser>;
  let log: string[];
  let screen: LoadingScreen;

  beforeEach(() => {
    vi.useFakeTimers();
    unlock.mockReset();
    sfx.mockReset();
    log = [];
    unlock.mockImplementation(() => log.push('unlock'));
    sfx.mockImplementation((name: string) => log.push(`sfx ${name}`));
    browser = fakeBrowser();
    screen = new LoadingScreen({
      random: () => 0,
      onLoaded: () => log.push('loaded'),
      onRevealStart: () => log.push('reveal start'),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Ready for the click, with the order of what happens after it recorded in `log`. */
  function ready() {
    void screen.waitForClick().then(() => log.push('begun'));
  }

  /** A click on the screen, as the browser delivers it to the root. */
  const click = () => (screen.root as unknown as FakeElement).click();

  describe('loading finished', () => {
    it('fires onLoaded once, at done(), before "Click to begin" is shown', async () => {
      screen.setProgress(0.5);
      expect(log).toEqual([]);
      screen.done();
      expect(log).toEqual(['loaded']);
      screen.done();
      ready();
      await vi.advanceTimersByTimeAsync(0);
      expect(log).toEqual(['loaded']);
    });

    it('fires it from waitForClick when the boot did not call done()', async () => {
      ready();
      expect(log).toEqual(['loaded']);
      click();
      await vi.advanceTimersByTimeAsync(0);
      expect(log).toEqual(['loaded', 'unlock', 'sfx ui.click', 'begun']);
    });

    it('fires a hook set after the screen was made', () => {
      const late = new LoadingScreen({ random: () => 0 });
      late.onLoaded = () => log.push('late loaded');
      late.done();
      expect(log).toEqual(['late loaded']);
    });
  });

  describe('begin', () => {
    // the keys stop at the screen, so the bus's own listener never hears them
    it.each(['Enter', ' '])(
      'unlocks the bus, then plays the click sound, before %j begins, which the key cannot',
      async (key) => {
        ready();
        expect(browser.press(key)).toBe(false);
        expect(browser.reachedAudio).toBe(false);
        await vi.advanceTimersByTimeAsync(0);
        expect(log).toEqual(['loaded', 'unlock', 'sfx ui.click', 'begun']);
      },
    );

    it('unlocks the bus, then plays the click sound, before a click begins', async () => {
      ready();
      click();
      await vi.advanceTimersByTimeAsync(0);
      expect(log).toEqual(['loaded', 'unlock', 'sfx ui.click', 'begun']);
    });

    it('leaves the bus alone for a key that does not begin, and does not begin', async () => {
      ready();
      for (const key of ['a', 'Escape', 'ArrowRight', 'Tab'])
        expect(browser.press(key)).toBe(false);
      await vi.advanceTimersByTimeAsync(0);
      expect(unlock).not.toHaveBeenCalled();
      expect(sfx).not.toHaveBeenCalled();
      expect(log).toEqual(['loaded']);
    });

    it('leaves a chord to the browser: no begin, no unlock, still seen by the page', async () => {
      ready();
      expect(browser.press('Enter', { ctrlKey: true })).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(unlock).not.toHaveBeenCalled();
      expect(sfx).not.toHaveBeenCalled();
      expect(log).toEqual(['loaded']);
    });

    it('unlocks and clicks once for a key held down, not once per repeat', async () => {
      ready();
      browser.press('Enter');
      browser.press('Enter', { repeat: true });
      browser.press('Enter', { repeat: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(unlock).toHaveBeenCalledTimes(1);
      expect(sfx).toHaveBeenCalledTimes(1);
    });

    it('clicks once for a second click that lands before the reveal', async () => {
      ready();
      click();
      click();
      await vi.advanceTimersByTimeAsync(0);
      expect(sfx).toHaveBeenCalledTimes(1);
    });
  });

  describe('the reveal', () => {
    it('does not unlock the bus when the boot starts it without a gesture', async () => {
      void screen.reveal();
      await vi.advanceTimersByTimeAsync(0);
      expect(log).toEqual(['reveal start']);
      expect(unlock).not.toHaveBeenCalled();
    });

    it('unlocks the bus for a key that skips it, so a skip never costs the music', async () => {
      void screen.reveal();
      await vi.advanceTimersByTimeAsync(SKIP_GUARD_MS);
      expect(browser.press('x')).toBe(false);
      expect(browser.reachedAudio).toBe(false);
      expect(log).toEqual(['reveal start', 'unlock']);
    });

    it('unlocks the bus for a click that skips it, which is no begin and plays no click', async () => {
      void screen.reveal();
      await vi.advanceTimersByTimeAsync(SKIP_GUARD_MS);
      click();
      expect(log).toEqual(['reveal start', 'unlock']);
      expect(sfx).not.toHaveBeenCalled();
    });

    it('hands the keys back to the game once it is gone', async () => {
      const gone = screen.reveal();
      await vi.advanceTimersByTimeAsync(SKIP_GUARD_MS);
      browser.press('x');
      await gone;
      expect(browser.press('x')).toBe(true);
      expect(browser.reachedAudio).toBe(true);
    });
  });
});
