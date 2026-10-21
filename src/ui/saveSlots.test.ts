import { describe, it, expect } from 'vitest';
import { AGE_ORDER, STR } from '../strings';
import { LAST_AGE } from '../sim/ages';
import { SAVE_VERSION, type SlotMeta } from '../sim/save';
import { fmtMoney } from './dom';
import {
  asksBeforeReplacing,
  autosaveText,
  continueTargetFor,
  continueText,
  formatNote,
  gameBeingPlayed,
  liveText,
  loadQuestion,
  replaceQuestion,
  slotText,
  type ReplaceSituation,
  type Replacement,
} from './saveSlots';

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

describe('what Continue says over a game being played', () => {
  it('reads the game as it is now, like a save of it would', () => {
    const live = liveText(meta(), NOW);
    expect(live.detail).toBe(slotText(meta(), NOW).detail);
    expect(liveText(meta({ day: 13 }), NOW).detail).not.toBe(live.detail);
    expect(liveText(meta({ money: 1 }), NOW).detail).toContain(fmtMoney(1));
  });

  it('says it goes back to the game in progress, not to a save written then', () => {
    const live = liveText(meta(), NOW);
    expect(live.saved).not.toBe(slotText(meta(), NOW).saved);
    // when the game was last stored, from the time it is asked, with the date as title
    expect(live.saved).toContain(STR.saves.ago(2 * HOUR));
    expect(liveText(meta(), NOW + HOUR).saved).toContain(STR.saves.ago(3 * HOUR));
    expect(live.savedAt).toBe(slotText(meta(), NOW).savedAt);
  });

  it('still says so for a game never stored, without a time', () => {
    const fresh = liveText(meta({ savedAt: 0 }), NOW);
    expect(fresh.saved).toBeTruthy();
    expect(fresh.saved).not.toBe(liveText(meta(), NOW).saved);
    expect(fresh.savedAt).toBeNull();
  });

  it('never marks a format: the game in memory has no file', () => {
    expect(liveText(meta({ version: SAVE_VERSION - 1 }), NOW).format).toBeNull();
    expect(liveText(meta({ version: SAVE_VERSION + 1 }), NOW).format).toBeNull();
  });
});

describe('what Continue says', () => {
  const stored = (over: Partial<SlotMeta> = {}) =>
    continueText({ meta: meta(over), live: false }, NOW);
  const live = (over: Partial<SlotMeta> = {}) =>
    continueText({ meta: meta(over), live: true }, NOW);

  it('calls the stored game the last autosave at boot, where a named save says saved', () => {
    const t = stored();
    expect(t.saved).toBe(STR.saves.lastAutosave(STR.saves.ago(2 * HOUR)));
    expect(t.saved).not.toBe(slotText(meta(), NOW).saved);
    // the named-save rows keep their own wording
    expect(slotText(meta(), NOW).saved).toBe(STR.saves.saved(STR.saves.ago(2 * HOUR)));
    // from the time it is asked, with the date and time as the title, and the same detail line
    expect(continueText({ meta: meta(), live: false }, NOW + HOUR).saved).toContain(
      STR.saves.ago(3 * HOUR),
    );
    expect(t.savedAt).toBe(slotText(meta(), NOW).savedAt);
    expect(t.detail).toBe(slotText(meta(), NOW).detail);
  });

  it('says the game in progress went on from the same autosave, over a game being played', () => {
    const t = live();
    expect(t.saved).toBe(STR.saves.inProgress(STR.saves.ago(2 * HOUR)));
    // the time reads as it does at boot, so one word names the slot in both places
    expect(t.saved).toContain(STR.saves.lastAutosave(STR.saves.ago(2 * HOUR)));
    expect(t.saved).not.toBe(stored().saved);
    expect(t.savedAt).toBe(stored().savedAt);
  });

  it('gives a game never stored no time, and a stored file without one no time line', () => {
    const fresh = live({ savedAt: 0 });
    expect(fresh.saved).toBe(STR.saves.inProgress(null));
    expect(fresh.saved).not.toContain(STR.saves.ago(0));
    expect(fresh.savedAt).toBeNull();
    const untimed = stored({ savedAt: 0 });
    expect(untimed.saved).toBeNull();
    expect(untimed.savedAt).toBeNull();
    expect(untimed.detail).toBe(stored().detail);
    // the three states read differently
    expect(new Set([stored().saved, live().saved, fresh.saved]).size).toBe(3);
  });

  it('still marks a stored save of another format at boot, never the game in progress', () => {
    expect(stored().format).toBeNull();
    expect(stored({ version: SAVE_VERSION - 1 }).format).toBe(formatNote(SAVE_VERSION - 1));
    expect(stored({ version: SAVE_VERSION + 1 }).format).toBe(formatNote(SAVE_VERSION + 1));
    expect(live({ version: SAVE_VERSION - 1 }).format).toBeNull();
  });
});

describe('what Continue goes back to', () => {
  const liveMeta = meta({ name: '', savedAt: 0 });
  const storedMeta = meta({ name: '' });

  it('is the game being played over a game, stored or never stored', () => {
    for (const stored of [storedMeta, null])
      expect(
        continueTargetFor(
          true,
          () => liveMeta,
          () => stored,
        ),
      ).toEqual({ meta: liveMeta, live: true });
  });

  it('is the stored game at boot, and nothing when there is none: Continue is disabled', () => {
    expect(
      continueTargetFor(
        false,
        () => liveMeta,
        () => storedMeta,
      ),
    ).toEqual({ meta: storedMeta, live: false });
    expect(
      continueTargetFor(
        false,
        () => liveMeta,
        () => null,
      ),
    ).toBeNull();
  });

  it('reads only the one it goes back to', () => {
    let reads = 0;
    const count =
      <T>(v: T) =>
      () => (reads++, v);
    continueTargetFor(true, count(liveMeta), count(storedMeta));
    expect(reads).toBe(1);
    continueTargetFor(false, count(liveMeta), count(storedMeta));
    expect(reads).toBe(2);
  });
});

describe('when a replacement asks first', () => {
  /** Where the player can be when they pick an action, and whether a game is being played there. */
  const WHERE: { name: string; at: Omit<ReplaceSituation, 'stored'>; played: boolean }[] = [
    {
      name: 'under the pause menu',
      at: { mode: 'play', titleShown: false, titleOverGame: false },
      played: true,
    },
    {
      name: 'at the title screen opened over the game',
      at: { mode: 'play', titleShown: true, titleOverGame: true },
      played: true,
    },
    {
      name: 'at the title screen at boot',
      at: { mode: 'play', titleShown: true, titleOverGame: false },
      played: false,
    },
    {
      name: 'in the editor',
      at: { mode: 'editor', titleShown: false, titleOverGame: false },
      played: false,
    },
  ];
  const pause = WHERE[0];
  const boot = WHERE[2];
  const at = (w: (typeof WHERE)[number], stored: boolean): ReplaceSituation => ({
    ...w.at,
    stored,
  });
  const KINDS: Replacement[] = ['overwrite', 'leave'];

  it('plays a game under the pause menu and under a title screen opened over it only', () => {
    for (const w of WHERE)
      for (const stored of [false, true])
        expect(gameBeingPlayed(at(w, stored)), w.name).toBe(w.played);
    // the editor plays no game, whatever else is up
    for (const titleShown of [false, true])
      for (const titleOverGame of [false, true])
        expect(gameBeingPlayed({ mode: 'editor', titleShown, titleOverGame, stored: true })).toBe(
          false,
        );
  });

  // [kind, a game is being played, a stored game exists, asks]
  const TABLE: [Replacement, boolean, boolean, boolean][] = [
    ['overwrite', false, false, false],
    ['overwrite', false, true, true],
    ['overwrite', true, false, true],
    ['overwrite', true, true, true],
    ['leave', false, false, false],
    ['leave', false, true, false],
    ['leave', true, false, true],
    ['leave', true, true, true],
  ];

  it('asks for every combination of a game being played and a stored game, for both kinds', () => {
    for (const [kind, played, stored, asks] of TABLE)
      for (const w of WHERE.filter((x) => x.played === played))
        expect(asksBeforeReplacing(kind, at(w, stored)), `${kind} ${w.name} stored=${stored}`).toBe(
          asks,
        );
  });

  it('never lets a stored game decide for a game that only leaves, nor silence an overwrite', () => {
    for (const w of WHERE) {
      expect(asksBeforeReplacing('leave', at(w, true))).toBe(
        asksBeforeReplacing('leave', at(w, false)),
      );
      for (const stored of [false, true]) {
        // a game in play asks for an overwrite with or without a stored game
        if (w.played) expect(asksBeforeReplacing('overwrite', at(w, stored))).toBe(true);
        // what only leaves never asks where an overwrite stays quiet
        if (!asksBeforeReplacing('overwrite', at(w, stored)))
          expect(asksBeforeReplacing('leave', at(w, stored))).toBe(false);
      }
    }
  });

  it('asks nothing at first start: nothing played, nothing stored', () => {
    for (const w of WHERE.filter((x) => !x.played))
      for (const kind of KINDS) {
        expect(asksBeforeReplacing(kind, at(w, false))).toBe(false);
        expect(replaceQuestion(kind, at(w, false))).toBeNull();
      }
    expect(loadQuestion('Line one', at(boot, false))).toBeNull();
  });

  it('has a question exactly when it asks', () => {
    for (const w of WHERE)
      for (const stored of [false, true]) {
        for (const kind of KINDS)
          expect(replaceQuestion(kind, at(w, stored)) !== null).toBe(
            asksBeforeReplacing(kind, at(w, stored)),
          );
        expect(loadQuestion('Line one', at(w, stored)) !== null).toBe(
          asksBeforeReplacing('overwrite', at(w, stored)),
        );
      }
  });

  it('names the game in progress over one and the stored game at boot, never a game not stored', () => {
    const never = replaceQuestion('overwrite', at(pause, false));
    const both = replaceQuestion('overwrite', at(pause, true));
    const onlyStored = replaceQuestion('overwrite', at(boot, true));
    const leave = replaceQuestion('leave', at(pause, false));
    expect(never).toBe(STR.menu.confirmReplaceGame(false));
    expect(both).toBe(STR.menu.confirmReplaceGame(true));
    expect(onlyStored).toBe(STR.menu.confirmReplace);
    expect(leave).toBe(STR.menu.confirmLeaveGame);
    expect(new Set([never, both, onlyStored, leave]).size).toBe(4);
    // only a stored game is called saved
    for (const w of WHERE)
      for (const kind of KINDS)
        expect(replaceQuestion(kind, at(w, false)) ?? '').not.toMatch(/\bsaved game\b/i);
    expect(both).toMatch(/\bsaved game\b/i);
    expect(onlyStored).toMatch(/\bsaved game\b/i);
    // leaving keeps the stored game, so it does not say that one is replaced
    expect(replaceQuestion('leave', at(pause, true))).toBe(leave);
  });

  it('says what is lost over a game being played, and calls that game what Continue calls it', () => {
    const inProgress = STR.saves.inProgress(null);
    expect(inProgress.length).toBeGreaterThan(0);
    for (const w of WHERE)
      for (const stored of [false, true]) {
        const asked = [
          ...KINDS.map((k) => replaceQuestion(k, at(w, stored))),
          loadQuestion('Line one', at(w, stored)),
        ].filter((q): q is string => q !== null);
        // the question over a game being played says its progress is lost; the ones that only
        // protect the stored game name that instead
        for (const q of asked)
          expect(q, `${w.name} stored=${stored}`).toMatch(
            w.played ? /\blost\b/i : /\bsaved game\b/i,
          );
        // the replace and leave questions name the game in progress as Continue does
        for (const k of KINDS) {
          const q = replaceQuestion(k, at(w, stored));
          if (q !== null)
            expect(q.includes(inProgress), `${k} ${w.name} stored=${stored}`).toBe(w.played);
        }
      }
  });

  it('asks a load over a game as before, and otherwise says the stored game is replaced', () => {
    const name = 'Line one';
    for (const stored of [false, true])
      for (const w of WHERE.filter((x) => x.played))
        expect(loadQuestion(name, at(w, stored)), w.name).toBe(STR.menu.confirmLoad(name));
    for (const w of WHERE.filter((x) => !x.played)) {
      const q = loadQuestion(name, at(w, true));
      expect(q, w.name).toBe(STR.menu.confirmLoadStored(name));
      expect(q).toContain(name);
      // the saved game it replaces is the one Continue goes back to
      expect(q).toContain(STR.menu.continue);
      expect(q).not.toBe(STR.menu.confirmLoad(name));
    }
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
