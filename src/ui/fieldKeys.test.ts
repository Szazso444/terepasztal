import { describe, expect, it, vi } from 'vitest';
import { guardNumberField } from './fieldKeys';

/** A number field and what a key does to it. */
function field() {
  const target = Object.assign(new EventTarget(), { blur: vi.fn() });
  guardNumberField(target);
  const press = (key: string) => {
    const e = Object.assign(new Event('keydown', { cancelable: true }), { key });
    const stop = vi.spyOn(e, 'stopPropagation');
    target.dispatchEvent(e);
    return { stepped: !e.defaultPrevented, reachedGame: stop.mock.calls.length === 0 };
  };
  return { target, press };
}

describe('a number field of the stop editor', () => {
  it.each(['ArrowUp', 'ArrowDown'])('%s pans nothing and steps nothing', (key) => {
    expect(field().press(key)).toEqual({ stepped: false, reachedGame: false });
  });

  it('takes digits as typing, and keeps them from the game', () => {
    expect(field().press('5')).toEqual({ stepped: true, reachedGame: false });
  });

  it.each(['Enter', 'Escape'])('%s gives the keys back to the game', (key) => {
    const f = field();
    f.press(key);
    expect(f.target.blur).toHaveBeenCalledOnce();
  });

  it('holds on to the keys for anything else', () => {
    const f = field();
    f.press('1');
    expect(f.target.blur).not.toHaveBeenCalled();
  });
});
