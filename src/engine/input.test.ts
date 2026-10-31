import { afterEach, describe, expect, it, vi } from 'vitest';
import { Input } from './input';

/** A real `Input` on stand-ins for the window, the document and the canvas. */
function browserInput() {
  const handlers = new Map<string, ((e: unknown) => void)[]>();
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: (e: unknown) => void) =>
      handlers.set(type, [...(handlers.get(type) ?? []), fn]),
  });
  vi.stubGlobal('document', { addEventListener: () => {} });
  const input = new Input({ addEventListener: () => {} } as unknown as HTMLElement);
  /** A key on an element of this tag; true when the browser's own action of it stays. */
  const press = (tagName: string, code: string, key: string) => {
    let kept = true;
    const e = {
      code,
      key,
      target: { tagName },
      preventDefault: () => (kept = false),
    };
    for (const fn of handlers.get('keydown') ?? []) fn(e);
    return kept;
  };
  return { input, press };
}
afterEach(() => vi.unstubAllGlobals());

describe('a key on a form control', () => {
  it.each([
    ['KeyD', 'd'],
    ['KeyS', 's'],
    ['KeyU', 'u'],
    ['ArrowUp', 'ArrowUp'],
    ['ArrowDown', 'ArrowDown'],
    ['ArrowLeft', 'ArrowLeft'],
    ['ArrowRight', 'ArrowRight'],
    ['Enter', 'Enter'],
    ['Home', 'Home'],
  ])('%s on a select never changes it: the browser keeps its hands off', (code, key) => {
    expect(browserInput().press('SELECT', code, key)).toBe(false);
  });

  it('a pan key on a select still pans', () => {
    const { input, press } = browserInput();
    press('SELECT', 'KeyD', 'd');
    expect(input.isDown('KeyD')).toBe(true);
    expect(input.wasPressed('KeyD')).toBe(true);
  });

  it('a text field keeps its keys, and the game gets none', () => {
    const { input, press } = browserInput();
    expect(press('INPUT', 'KeyD', 'd')).toBe(true);
    expect(press('TEXTAREA', 'KeyD', 'd')).toBe(true);
    expect(input.isDown('KeyD')).toBe(false);
  });

  it('a key on anything else keeps its action', () => {
    expect(browserInput().press('CANVAS', 'KeyD', 'd')).toBe(true);
    expect(browserInput().press('BODY', 'ArrowDown', 'ArrowDown')).toBe(true);
  });
});
