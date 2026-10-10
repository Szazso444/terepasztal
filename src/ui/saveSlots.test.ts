import { describe, it, expect } from 'vitest';
import { AGE_ORDER, STR } from '../strings';
import { LAST_AGE } from '../sim/ages';
import { SAVE_VERSION, type SlotMeta } from '../sim/save';
import { fmtMoney } from './dom';
import { autosaveText, formatNote, slotText } from './saveSlots';

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);

const meta = (over: Partial<SlotMeta> = {}): SlotMeta => ({
  name: 'Line one',
  savedAt: NOW - 2 * HOUR,
  version: SAVE_VERSION,
  seed: 7,
  day: 12,
  age: 1,
  money: 45_250,
  ...over,
});

describe('what a save list says about one save', () => {
  it('names the age the save reached, the last one past the end', () => {
    for (let age = 0; age <= LAST_AGE; age++)
      expect(slotText(meta({ age }), NOW).detail).toContain(STR.ages.name[AGE_ORDER[age]]);
    expect(slotText(meta({ age: LAST_AGE + 3 }), NOW).detail).toBe(
      slotText(meta({ age: LAST_AGE }), NOW).detail,
    );
    // a file without a tier reads 0, the first age
    expect(slotText(meta({ age: 0 }), NOW).detail).toContain(STR.ages.name[AGE_ORDER[0]]);
  });

  it('shows the money as the rest of the game does, and the day', () => {
    const t = slotText(meta(), NOW);
    expect(t.detail).toContain(fmtMoney(45_250));
    expect(t.detail).toMatch(/\b12\b/);
    expect(slotText(meta({ day: 13 }), NOW).detail).not.toBe(t.detail);
  });

  it('says how long ago from the time it is asked, with the date and time beside it', () => {
    const t = slotText(meta(), NOW);
    expect(t.saved).toBe(STR.saves.saved(STR.saves.ago(2 * HOUR)));
    expect(t.savedAt).toBeTruthy();
    // the same save read an hour later is an hour older; its date does not move
    const later = slotText(meta(), NOW + HOUR);
    expect(later.saved).toBe(STR.saves.saved(STR.saves.ago(3 * HOUR)));
    expect(later.savedAt).toBe(t.savedAt);
  });

  it('says nothing about when for a file that does not carry the time', () => {
    const t = slotText(meta({ savedAt: 0 }), NOW);
    expect(t.saved).toBeNull();
    expect(t.savedAt).toBeNull();
    expect(t.detail).toBe(slotText(meta(), NOW).detail);
  });

  it('marks only a save of another format, older and newer apart', () => {
    expect(slotText(meta(), NOW).format).toBeNull();
    expect(formatNote(SAVE_VERSION)).toBeNull();
    const older = formatNote(SAVE_VERSION - 1);
    const newer = formatNote(SAVE_VERSION + 1);
    expect(older).toContain(String(SAVE_VERSION - 1));
    expect(newer).toContain(String(SAVE_VERSION + 1));
    expect(older).not.toBe(newer?.replace(String(SAVE_VERSION + 1), String(SAVE_VERSION - 1)));
    expect(slotText(meta({ version: SAVE_VERSION - 1 }), NOW).format).toBe(older);
    // a file without a version reads 0: older than any build
    expect(formatNote(0)).toBe(STR.saves.olderFormat(0));
  });
});

describe('the autosave line of the settings screen', () => {
  it('tells on, on without a save yet, and off apart', () => {
    const on = autosaveText(true, NOW - 5 * MIN, NOW);
    const fresh = autosaveText(true, null, NOW);
    const off = autosaveText(false, NOW - 5 * MIN, NOW);
    expect(new Set([on, fresh, off]).size).toBe(3);
    expect(on).toContain(STR.saves.ago(5 * MIN));
    // off reads the same whether or not the game was stored
    expect(autosaveText(false, null, NOW)).toBe(off);
  });
});
