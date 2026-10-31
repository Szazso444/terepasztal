import { describe, it, expect } from 'vitest';
import { STR } from '../strings';
import { titleEntries, type TitleState } from './titleModel';

const state = (over: Partial<TitleState> = {}): TitleState => ({
  canContinue: true,
  overGame: false,
  named: 3,
  levels: 4,
  contentModified: false,
  ...over,
});
const byId = (s: TitleState) => Object.fromEntries(titleEntries(s).map((e) => [e.id, e]));

describe('the title screen stack', () => {
  it('has every way out of the title the game had, in one order', () => {
    expect(titleEntries(state()).map((e) => e.id)).toEqual([
      'continue',
      'newGame',
      'saved',
      'levels',
      'settings',
      'audio',
      'controls',
      'tuning',
      'content',
      'credits',
    ]);
  });

  it('makes only Continue the accent: the title has one forward action', () => {
    expect(
      titleEntries(state())
        .filter((e) => e.primary)
        .map((e) => e.id),
    ).toEqual(['continue']);
  });

  it('is off with its reason where there is no game to go back to, and says where it goes otherwise', () => {
    const none = byId(state({ canContinue: false })).continue;
    expect(none.off).toBe(STR.menu.continueNone);
    expect(none.tip).toBeUndefined();
    expect(byId(state()).continue.off).toBeUndefined();
    expect(byId(state()).continue.tip).toBe(STR.menu.continueStored);
    // over a game it goes back to that game, as it was left, not to a save
    expect(byId(state({ overGame: true })).continue.tip).toBe(STR.menu.continueLive);
  });

  it('counts the named saves and the levels on the buttons that open them, and nothing else', () => {
    const e = byId(state({ named: 7, levels: 2 }));
    expect(e.saved.count).toBe(7);
    expect(e.levels.count).toBe(2);
    expect(e.saved.label).toBe(STR.menu.savedGames);
    for (const id of [
      'continue',
      'newGame',
      'settings',
      'audio',
      'controls',
      'tuning',
      'content',
      'credits',
    ] as const)
      expect(e[id].count, id).toBeUndefined();
    // a count of none is still shown: Levels 0
    expect(byId(state({ levels: 0 })).levels.count).toBe(0);
  });

  it('marks the content editor only when it runs on a stored edit', () => {
    expect(byId(state()).content.mark).toBeUndefined();
    expect(byId(state({ contentModified: true })).content.mark).toBe(STR.menu.modified);
  });

  it('keeps the Credits button the title always had, and Controls opens the keys', () => {
    const e = byId(state());
    expect(e.credits.label).toBe(STR.menu.credits);
    expect(e.controls.label).toBe(STR.menu.controls);
  });

  it('never gives two buttons one icon, so each is told apart at a glance', () => {
    const icons = titleEntries(state()).map((e) => e.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
});
