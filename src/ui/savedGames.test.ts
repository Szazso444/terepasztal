import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { STR } from '../strings';
import { SAVE_MIN_VERSION, hasSlot, listSlots, writeSlot, type SaveGame } from '../sim/save';
import {
  SLOT_NAME_MAX,
  canSaveHere,
  loadEffect,
  replaceEffect,
  saveNameState,
  saveOffReason,
  savedGamesTabs,
  slotNameOf,
  type ReplaceSituation,
  type Replacement,
} from './saveSlots';

/** An in-memory `localStorage`. */
class MemoryStorage {
  items = new Map<string, string>();
  getItem(k: string) {
    return this.items.has(k) ? this.items.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.items.set(k, String(v));
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
}

/** The smallest game `writeSlot` stores: the oldest shape the migration chain accepts. */
const GAME: SaveGame = {
  version: SAVE_MIN_VERSION,
  savedAt: 1700000000000,
  seed: 12345,
  clock: { time: 0, speedIndex: 1 },
  economy: { money: 1000, tickets: 0, tier: 0, granted: [] },
  track: [],
  stations: [],
  trains: [],
  contracts: { contracts: [] },
  inventory: { items: [] },
  gacha: {},
  camera: { x: 0, y: 0, zoomIndex: 2 },
  lastDay: 0,
};

const situation = (over: Partial<ReplaceSituation> = {}): ReplaceSituation => ({
  mode: 'play',
  titleShown: false,
  titleOverGame: false,
  stored: false,
  ...over,
});

describe('the name a save is stored under', () => {
  beforeEach(() => vi.stubGlobal('localStorage', new MemoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('is trimmed and cut at 32 characters, as the store does it', () => {
    expect(slotNameOf('  Szeged  ')).toBe('Szeged');
    expect(slotNameOf('x'.repeat(40))).toBe('x'.repeat(SLOT_NAME_MAX));
    // a cut that lands on a space does not leave it at the end
    expect(slotNameOf(`${'x'.repeat(31)} tail`)).toBe('x'.repeat(31));
    expect(slotNameOf('   ')).toBe('');
  });

  it('is the name writeSlot really stores: what the screen says it replaces is what is replaced', () => {
    for (const typed of ['  plain ', 'y'.repeat(50), `${'z'.repeat(31)} q`, 'Day 9 · 48213']) {
      writeSlot(typed, GAME);
      expect(hasSlot(typed), typed).toBe(true);
      expect(
        listSlots().map((s) => s.name),
        typed,
      ).toContain(slotNameOf(typed));
    }
  });
});

describe('the Save tab: the name, and whether saving replaces a save', () => {
  const existing = ['Szeged', 'Day 9 · 48213'];

  it('offers the default name until something is typed', () => {
    const s = saveNameState(null, 'Day 14 · 7', existing);
    expect(s).toEqual({ shown: 'Day 14 · 7', name: 'Day 14 · 7', canSave: true, clash: false });
  });

  it('takes what is typed, even nothing: an empty name has nothing to save as', () => {
    expect(saveNameState('Mine', 'Day 14 · 7', existing).name).toBe('Mine');
    expect(saveNameState('', 'Day 14 · 7', existing).canSave).toBe(false);
    expect(saveNameState('   ', 'Day 14 · 7', existing).canSave).toBe(false);
  });

  it('says it replaces a save when the stored name is one that exists, whatever is around it', () => {
    expect(saveNameState('Szeged', 'd', existing).clash).toBe(true);
    expect(saveNameState('  Szeged ', 'd', existing).clash).toBe(true);
    expect(saveNameState('Szeged 2', 'd', existing).clash).toBe(false);
    expect(saveNameState(null, 'Day 9 · 48213', existing).clash).toBe(true);
    // a name over the limit clashes by what it is cut to
    expect(saveNameState('Szeged' + ' '.repeat(40) + 'x', 'd', existing).clash).toBe(true);
  });
});

describe('what a load does where it is picked, and whether there is a game to save', () => {
  const cases: [string, ReplaceSituation, string, boolean][] = [
    ['over a game in play', situation(), 'game', true],
    ['over a game in play, a game stored too', situation({ stored: true }), 'game', true],
    ['at boot with a stored game', situation({ titleShown: true, stored: true }), 'stored', false],
    ['at boot with nothing stored', situation({ titleShown: true }), 'none', false],
    [
      'on the title opened over a game',
      situation({ titleShown: true, titleOverGame: true }),
      'game',
      true,
    ],
  ];
  for (const [name, s, effect, save] of cases)
    it(`${name}: it replaces ${effect === 'none' ? 'nothing' : `the ${effect} game`}, and saving is ${save ? 'on' : 'off'}`, () => {
      expect(loadEffect(s)).toBe(effect);
      expect(canSaveHere(s)).toBe(save);
    });

  it('says what a replacement of each kind loses, where the rules say it asks', () => {
    const kinds: Replacement[] = ['overwrite', 'leave'];
    // a leave loses only the game in play; an overwrite also the stored game at boot
    expect(replaceEffect('leave', situation({ titleShown: true, stored: true }))).toBeNull();
    expect(replaceEffect('overwrite', situation({ titleShown: true, stored: true }))).toBe(
      'stored',
    );
    expect(replaceEffect('overwrite', situation({ titleShown: true }))).toBeNull();
    expect(replaceEffect('overwrite', situation())).toBe('game');
    expect(replaceEffect('leave', situation())).toBe('game');
    expect(replaceEffect('overwrite', situation({ titleShown: true, titleOverGame: true }))).toBe(
      'game',
    );
    for (const kind of kinds)
      expect(replaceEffect(kind, situation({ mode: 'editor', titleShown: true }))).toBeNull();
  });

  it('has words for each effect, for the footer and the tips of the Load buttons', () => {
    for (const effect of ['game', 'stored', 'none'] as const) {
      expect(STR.savedGames.loadNote[effect], effect).toBeTruthy();
      expect(STR.savedGames.loadTip[effect], effect).toBeTruthy();
    }
  });
});

describe('why saving is off where it is', () => {
  it('says there is no game yet at the title at boot, and that the editor has none to save', () => {
    expect(saveOffReason(situation({ titleShown: true }))).toBe(STR.savedGames.saveOff);
    expect(saveOffReason(situation({ titleShown: true, stored: true }))).toBe(
      STR.savedGames.saveOff,
    );
    expect(saveOffReason(situation({ mode: 'editor' }))).toBe(STR.savedGames.saveOffEditor);
    expect(saveOffReason(situation({ mode: 'editor', titleShown: true }))).toBe(
      STR.savedGames.saveOffEditor,
    );
  });

  it('says nothing where a game is being played: over it, or under a title opened over it', () => {
    expect(saveOffReason(situation())).toBeNull();
    expect(saveOffReason(situation({ titleShown: true, titleOverGame: true }))).toBeNull();
  });

  it('is off exactly where canSaveHere says so, and the two reasons are told apart', () => {
    for (const mode of ['play', 'editor'] as const)
      for (const titleShown of [false, true])
        for (const titleOverGame of [false, true]) {
          const s = situation({ mode, titleShown, titleOverGame });
          expect(saveOffReason(s) === null, JSON.stringify(s)).toBe(canSaveHere(s));
        }
    expect(STR.savedGames.saveOffEditor).not.toBe(STR.savedGames.saveOff);
  });
});

describe('the tabs of Saved games', () => {
  it('turns Save off with its reason where it is off, and counts the named saves on Load', () => {
    const off = savedGamesTabs(STR.savedGames.saveOff, 3);
    expect(off.map((t) => t.id)).toEqual(['save', 'load']);
    expect(off[0].off).toBe(STR.savedGames.saveOff);
    expect(off[1]).toMatchObject({ off: null, count: 3 });
    expect(savedGamesTabs(STR.savedGames.saveOffEditor, 0)[0].off).toBe(
      STR.savedGames.saveOffEditor,
    );
    expect(savedGamesTabs(null, 0)[0].off).toBeNull();
    // the count sits on Load only: a bare number, as every other tab has it
    expect(savedGamesTabs(null, 0)[0].count).toBeNull();
    expect(savedGamesTabs(null, 0)[1].count).toBe(0);
  });
});

// ------------------------------------------------------------------ the screen's source
//
// The screen is built from DOM nodes: what it must not skip is read from the source.

describe('the Save tab asks before it replaces a save', () => {
  const sf = ts.createSourceFile(
    'savedGamesScreen.ts',
    readFileSync(new URL('./savedGamesScreen.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  /** The statements of `save`, as written. */
  function saveStatements(): string[] {
    let found: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isMethodDeclaration(n) && n.name.getText(sf) === 'save' && n.body)
        found = n.body.statements.map((s) => s.getText(sf));
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return found;
  }

  it('puts the dialog, red and answered Replace, before the call that stores the save', () => {
    const statements = saveStatements();
    const asked = statements.findIndex((t) =>
      /replaces\s*&&\s*!\(await this\.prompt\.confirm\(/.test(t),
    );
    // whether it replaces one is asked of the store at the click, not of the list drawn earlier
    const decided = statements.findIndex((t) =>
      /const replaces = s\.clash \|\| this\.actions\.exists\(s\.name\)/.test(t),
    );
    expect(decided, 'the check at click time').toBeGreaterThanOrEqual(0);
    expect(decided).toBeLessThan(asked);
    const stored = statements.findIndex((t) => t.includes('this.actions.saveAs('));
    expect(asked, 'the question').toBeGreaterThanOrEqual(0);
    expect(stored, 'the save').toBeGreaterThan(asked);
    const question = statements[asked];
    expect(question).toContain('STR.saves.overwriteTitle');
    expect(question).toContain('yes: STR.prompt.replace');
    expect(question).toContain('danger: true');
    // a no leaves: nothing is stored, and the name stays to be changed
    expect(question).toMatch(/\)\s*return;?$/);
  });

  it('stores nothing without a name or where there is no game to save', () => {
    const statements = saveStatements();
    expect(statements.some((t) => /!s\.canSave \|\| !this\.canSave/.test(t))).toBe(true);
    expect(statements.findIndex((t) => /!s\.canSave/.test(t))).toBeLessThan(
      statements.findIndex((t) => t.includes('this.actions.saveAs(')),
    );
  });
});
