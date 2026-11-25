import { describe, expect, it } from 'vitest';
import { Bindings, type ClassNode, type StyleNode, type TextNode } from './liveView';

/** An element as far as a binding touches it, counting what it writes. */
function node() {
  const classes = new Set<string>();
  const n = {
    textContent: '' as string | null,
    writes: 0,
    style: { width: '' },
    classes,
    classList: {
      toggle(name: string, on?: boolean) {
        const set = on ?? !classes.has(name);
        if (set) classes.add(name);
        else classes.delete(name);
        return set;
      },
    },
  };
  // count the writes of the text
  let text: string | null = '';
  Object.defineProperty(n, 'textContent', {
    get: () => text,
    set: (v: string | null) => {
      text = v;
      n.writes++;
    },
  });
  return n as typeof n & TextNode & ClassNode & StyleNode;
}

describe('bindings', () => {
  it('write what they say once they are added, and again at each run', () => {
    const b = new Bindings();
    const n = node();
    let v = 'a';
    b.text(n, () => v);
    expect(n.textContent).toBe('a');
    v = 'b';
    expect(n.textContent).toBe('a');
    b.run();
    expect(n.textContent).toBe('b');
  });

  it('write nothing when the value is what the element shows', () => {
    const b = new Bindings();
    const n = node();
    b.text(n, () => 'same');
    b.run();
    b.run();
    expect(n.writes).toBe(1);
  });

  it('keep a class on while their answer is yes', () => {
    const b = new Bindings();
    const n = node();
    let on = true;
    b.toggle(n, 'dim', () => on);
    expect(n.classes.has('dim')).toBe(true);
    on = false;
    b.run();
    expect(n.classes.has('dim')).toBe(false);
  });

  it('keep the one tone that is asked for and no other', () => {
    const b = new Bindings();
    const n = node();
    let tone = 'bad';
    b.tone(n, ['warn', 'bad'], () => tone);
    expect([...n.classes]).toEqual(['bad']);
    tone = 'warn';
    b.run();
    expect([...n.classes]).toEqual(['warn']);
    tone = '';
    b.run();
    expect([...n.classes]).toEqual([]);
  });

  it('set a width in percent, held between 0 and 100', () => {
    const b = new Bindings();
    const n = node();
    let share = 0.25;
    b.width(n, () => share);
    expect(n.style.width).toBe('25%');
    share = 3;
    b.run();
    expect(n.style.width).toBe('100%');
    share = -1;
    b.run();
    expect(n.style.width).toBe('0%');
  });

  it('are forgotten by clear, which a part built again needs', () => {
    const b = new Bindings();
    const n = node();
    let v = 'a';
    b.text(n, () => v);
    expect(b.size).toBe(1);
    b.clear();
    expect(b.size).toBe(0);
    v = 'b';
    b.run();
    expect(n.textContent).toBe('a');
  });
});
