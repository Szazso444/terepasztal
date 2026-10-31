import { describe, expect, it } from 'vitest';
import { STR } from '../strings';
import { KEYMAP } from './keymap';

/** How the key table writes a key of the keymap. */
function label(code: string, shift?: boolean): string {
  const name: Record<string, string> = {
    Backquote: '`',
    Escape: 'Esc',
    Space: 'Space',
    Tab: 'Tab',
    Enter: 'Enter',
    'Char+': '+',
    'Char-': '−',
  };
  if (name[code]) return name[code];
  if (code.startsWith('Ctrl+')) return code;
  if (code.startsWith('Digit')) return Number(code.slice(5)) <= 5 ? '1–5' : '1–9';
  const letter = code.slice('Key'.length);
  return shift ? `Shift+${letter}` : letter;
}

interface Row {
  keys: readonly string[];
  text: string;
}

/** The rows of a group that take half a line. */
const shortRows = (g: (typeof STR.settings.keyGroups)[number]): readonly Row[] =>
  'short' in g ? g.short : [];

describe('the key table of the Controls tab', () => {
  const shown: Row[] = STR.settings.keyGroups.flatMap((g) => [...g.rows, ...shortRows(g)]);
  const keys = new Set(shown.flatMap((r) => r.keys));

  it('shows every key of the keymap', () => {
    for (const b of KEYMAP) expect(keys, b.code).toContain(label(b.code, b.shift));
  });

  it('holds no group without a key, and no row without a meaning', () => {
    for (const r of shown) {
      expect(r.keys.length).toBeGreaterThan(0);
      expect(r.text).not.toBe('');
    }
  });

  it('names the screens as their titles do', () => {
    const short = STR.settings.keyGroups.flatMap(shortRows);
    const say = (k: string) => short.find((r) => r.keys.includes(k))?.text;
    expect(say('F')).toBe(STR.depot.title);
    expect(say('C')).toBe(STR.contracts.title);
    expect(say('G')).toBe(STR.craft.title);
    expect(say('V')).toBe(STR.roster.title);
    expect(say('K')).toBe(STR.market.title);
  });
});
