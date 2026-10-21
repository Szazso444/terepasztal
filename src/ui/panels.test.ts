import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { STR } from '../strings';
import { SAVE_KEY, SAVE_MIN_VERSION, readSave, type SaveGame } from '../sim/save';
import { confirmReplaceSave } from './panels';

/** An in-memory `localStorage` that counts its writes, so a test can see nothing was written. */
class MemoryStorage {
  items = new Map<string, string>();
  writes = 0;
  getItem(k: string) {
    return this.items.has(k) ? this.items.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.writes++;
    this.items.set(k, String(v));
  }
  removeItem(k: string) {
    this.writes++;
    this.items.delete(k);
  }
}

/** The smallest stored game `readSave` takes: the oldest shape the migration chain accepts. */
const STORED_GAME: SaveGame = {
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

describe('the editor play test asks before replacing the stored game (confirmReplaceSave)', () => {
  let store: MemoryStorage;
  let asked: string[];
  let answer: boolean;
  beforeEach(() => {
    store = new MemoryStorage();
    asked = [];
    answer = true;
    vi.stubGlobal('localStorage', store);
    vi.stubGlobal('confirm', (question: string) => {
      asked.push(question);
      return answer;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Texts `readSave` refuses: not JSON, not a game, a game of a format newer than this build. */
  const REFUSED = ['{oops', 'null', '{}', '{"seed":1,"version":99}'];

  it('goes ahead without a question when nothing is stored (first start)', () => {
    expect(readSave()).toBeNull();
    expect(confirmReplaceSave()).toBe(true);
    expect(asked).toEqual([]);
  });

  it('asks the stored-game question when a readable game is stored, and does what the player says', () => {
    store.items.set(SAVE_KEY, JSON.stringify(STORED_GAME));
    expect(readSave()).not.toBeNull();
    for (const yes of [true, false]) {
      answer = yes;
      asked = [];
      expect(confirmReplaceSave(), `answer ${yes}`).toBe(yes);
      expect(asked, `answer ${yes}`).toEqual([STR.menu.confirmReplace]);
    }
  });

  it('does not call a stored file that readSave refuses a stored game', () => {
    for (const raw of REFUSED) {
      store.items.set(SAVE_KEY, raw);
      expect(readSave(), raw).toBeNull();
      expect(confirmReplaceSave(), raw).toBe(true);
    }
    expect(asked).toEqual([]);
  });

  it('does not call storage that cannot be read a stored game', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    expect(confirmReplaceSave()).toBe(true);
    expect(asked).toEqual([]);
  });

  it('changes nothing in storage whatever the answer: it only asks', () => {
    store.items.set(SAVE_KEY, JSON.stringify(STORED_GAME));
    const before = new Map(store.items);
    for (const yes of [true, false]) {
      answer = yes;
      confirmReplaceSave();
    }
    expect(store.writes).toBe(0);
    expect(store.items).toEqual(before);
  });
});

// ------------------------------------------------------------------ what each action is wired to
//
// The wiring in `createPlayUi` needs a DOM, so it is checked in the source: every call that
// replaces or leaves a game sits behind the rule of `saveSlots.ts`, with the kind the author chose
// for it. A new call site, or one that loses its question, fails here until it is classified.

/** The `host` methods that replace the game being played or the stored game, or leave the game. */
const REPLACING = new Set([
  'newGame',
  'playLevel',
  'editLevel',
  'newLevel',
  'loadSlot',
  'loadSave',
]);

/** How a call to the host is held back until the player says yes. */
type Guard =
  /** `if (confirmReplacement('<kind>')) host.x()`, or `if (!confirmReplacement(..)) return;` before */
  | { by: 'if'; kind: string }
  /** `askBeforeLoad(<question>, () => host.x())`: the question as the source writes it */
  | { by: 'ask'; question: string }
  | { by: 'none' };

interface Site {
  /** `<owner>.<action> -> host.<method>`: the menu or helper, the property, the host call */
  id: string;
  guard: Guard;
}

const parse = (file: string, text: string) =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
const source = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');

/** The menu (`new MainMenu(`) or helper (`function slotActions`) and the property `n` sits in. */
function ownerOf(n: ts.Node): { owner: string; action: string } {
  let action = '';
  for (let p = n.parent; p; p = p.parent) {
    if (!action && ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) action = p.name.text;
    if (ts.isNewExpression(p) && ts.isIdentifier(p.expression))
      return { owner: p.expression.text, action };
    if (ts.isFunctionDeclaration(p) && p.name) return { owner: p.name.text, action };
  }
  return { owner: '', action };
}

/** The kind of `confirmReplacement('<kind>')`, null when `e` is not that call. */
function confirmKind(e: ts.Expression, sf: ts.SourceFile): string | null {
  if (!ts.isCallExpression(e) || e.expression.getText(sf) !== 'confirmReplacement') return null;
  const kind = e.arguments[0];
  return kind && ts.isStringLiteral(kind) ? kind.text : '?';
}

/** Does `s` leave the function it is in: `return;` or a block of just that. */
function leaves(s: ts.Statement): boolean {
  if (ts.isReturnStatement(s)) return true;
  return ts.isBlock(s) && s.statements.length === 1 && leaves(s.statements[0]);
}

/** What `askBeforeLoad` is given to ask, as the source writes it, looking through one `const`. */
function questionOf(arg: ts.Expression, scope: ts.Node, sf: ts.SourceFile): string {
  if (ts.isCallExpression(arg)) return arg.expression.getText(sf);
  if (!ts.isIdentifier(arg)) return '?';
  let found = '?';
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === arg.text) {
      const init = n.initializer;
      if (init && ts.isConditionalExpression(init) && ts.isCallExpression(init.condition)) {
        const k = init.condition.arguments[0];
        found = `${init.condition.expression.getText(sf)}(${k ? k.getText(sf) : ''}) ? ${init.whenTrue.getText(sf)} : ${init.whenFalse.getText(sf)}`;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(scope);
  return found;
}

function guardOf(call: ts.Node, sf: ts.SourceFile): Guard {
  for (let c: ts.Node = call, p = call.parent; p; c = p, p = p.parent) {
    if (ts.isIfStatement(p) && p.thenStatement === c) {
      const kind = confirmKind(p.expression, sf);
      if (kind !== null) return { by: 'if', kind };
    }
    if (ts.isBlock(p)) {
      // `if (!confirmReplacement(k)) return;` earlier in the same block
      for (const s of p.statements) {
        if (s === c) break;
        if (
          ts.isIfStatement(s) &&
          ts.isPrefixUnaryExpression(s.expression) &&
          s.expression.operator === ts.SyntaxKind.ExclamationToken &&
          leaves(s.thenStatement)
        ) {
          const kind = confirmKind(s.expression.operand, sf);
          if (kind !== null) return { by: 'if', kind };
        }
      }
    }
    if (
      ts.isArrowFunction(p) &&
      ts.isCallExpression(p.parent) &&
      p.parent.expression.getText(sf) === 'askBeforeLoad' &&
      p.parent.arguments[1] === p
    ) {
      // the helper's own scope: the function the `askBeforeLoad` call is in
      let outer: ts.Node = p.parent;
      while (outer.parent && !ts.isFunctionLike(outer)) outer = outer.parent;
      return { by: 'ask', question: questionOf(p.parent.arguments[0], outer, sf) };
    }
  }
  return { by: 'none' };
}

/** Every `host.<method>(..)` that replaces or leaves a game, with what holds it back. */
function replacingSites(sf: ts.SourceFile): Site[] {
  const sites: Site[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.expression.getText(sf) === 'host' &&
      REPLACING.has(n.expression.name.text)
    ) {
      const { owner, action } = ownerOf(n);
      sites.push({
        id: `${owner}.${action} -> host.${n.expression.name.text}`,
        guard: guardOf(n, sf),
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return sites;
}

/** Does every `applyRulePreset(..)` in `sf` come after an `if (!confirm(<preset question>)) return`. */
function presetLoadsAsk(sf: ts.SourceFile): boolean[] {
  const out: boolean[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.getText(sf) === 'applyRulePreset') {
      let fn: ts.Node | undefined = n.parent;
      while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
      const body = fn ? (fn as ts.FunctionLikeDeclaration).body : undefined;
      const first = body && ts.isBlock(body) ? body.statements[0] : undefined;
      out.push(
        !!first &&
          ts.isIfStatement(first) &&
          ts.isPrefixUnaryExpression(first.expression) &&
          ts.isCallExpression(first.expression.operand) &&
          first.expression.operand.expression.getText(sf) === 'confirm' &&
          !!first.expression.operand.arguments[0]
            ?.getText(sf)
            .startsWith('STR.tuning.confirmLoadPreset(') &&
          leaves(first.thenStatement),
      );
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

interface Staging extends Site {
  file: string;
}

/** Every use of `stageNewGameTuning` in `sf`, bar its import, with what holds it back. */
function stagingIn(sf: ts.SourceFile, file: string): Staging[] {
  const found: Staging[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) && n.text === 'stageNewGameTuning' && !ts.isImportSpecifier(n.parent)) {
      const { owner, action } = ownerOf(n);
      found.push({ file, id: `${owner}.${action}`, guard: guardOf(n, sf) });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** Every use of `stageNewGameTuning` in a panel, menu or screen of `src/ui`. */
function stagingUses(): Staging[] {
  const dir = new URL('./', import.meta.url);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .flatMap((f) => stagingIn(parse(f, source(f)), f));
}

describe('what each action that replaces or leaves a game is wired to', () => {
  const OVERWRITE: Guard = { by: 'if', kind: 'overwrite' };
  const LEAVE: Guard = { by: 'if', kind: 'leave' };

  it('puts the rule in front of New game, Play level, Edit level and New level on the title screen', () => {
    const sites = replacingSites(parse('panels.ts', source('panels.ts')));
    const byId = new Map(sites.map((s) => [s.id, s.guard]));
    // New game and Play level overwrite the stored game; Edit level and New level only leave a game
    expect(byId.get('MainMenu.newGame -> host.newGame')).toEqual(OVERWRITE);
    expect(byId.get('MainMenu.playLevel -> host.playLevel')).toEqual(OVERWRITE);
    expect(byId.get('MainMenu.editLevel -> host.editLevel')).toEqual(LEAVE);
    expect(byId.get('MainMenu.newLevel -> host.newLevel')).toEqual(LEAVE);
  });

  it('asks before a named save loads, and before Load last save only over a game being played', () => {
    const sites = replacingSites(parse('panels.ts', source('panels.ts')));
    const byId = new Map(sites.map((s) => [s.id, s.guard]));
    // the question is the rule's own: over a game, or over a stored game at boot
    expect(byId.get('slotActions.loadSlot -> host.loadSlot')).toEqual({
      by: 'ask',
      question: 'loadQuestion',
    });
    // it loads the stored game itself and replaces none: the 'leave' kind, the unchanged text
    expect(byId.get('SettingsScreen.load -> host.loadSave')).toEqual({
      by: 'ask',
      question: "asksBeforeReplacing('leave') ? STR.saves.confirmLoadLast : null",
    });
  });

  it('has no other call that replaces or leaves a game unasked, bar the settings New game that asks itself', () => {
    const sites = replacingSites(parse('panels.ts', source('panels.ts')));
    expect(sites.map((s) => s.id).sort()).toEqual(
      [
        'MainMenu.newGame -> host.newGame',
        'MainMenu.playLevel -> host.playLevel',
        'MainMenu.editLevel -> host.editLevel',
        'MainMenu.newLevel -> host.newLevel',
        'slotActions.loadSlot -> host.loadSlot',
        'SettingsScreen.load -> host.loadSave',
        // asks in the settings screen's own button: `if (confirm(STR.settings.confirmNew))`
        'SettingsScreen.newGame -> host.newGame',
      ].sort(),
    );
    for (const s of sites.filter((x) => x.id !== 'SettingsScreen.newGame -> host.newGame'))
      expect(s.guard.by, s.id).not.toBe('none');
    // the exception keeps its question where it is
    const settings = parse('settingsScreen.ts', source('settingsScreen.ts'));
    const newGames: boolean[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && n.expression.getText(settings) === 'this.actions.newGame') {
        let asked = false;
        for (let c: ts.Node = n, p = n.parent; p; c = p, p = p.parent)
          if (
            ts.isIfStatement(p) &&
            p.thenStatement === c &&
            ts.isCallExpression(p.expression) &&
            p.expression.expression.getText(settings) === 'confirm'
          )
            asked = true;
        newGames.push(asked);
      }
      ts.forEachChild(n, visit);
    };
    visit(settings);
    expect(newGames).toEqual([true]);
  });

  // slow because it parses every source file of src/ui with the TypeScript compiler: 0.43 s alone,
  // so a limit of 30 s
  it("stages a tuning only from the title screen's New game, after the question and nowhere else", () => {
    const uses = stagingUses().map((u) => `${u.file}: ${u.id}`);
    // the settings screen's New game, the debug panel's Regenerate and the level actions stage none
    expect(uses).toEqual(['panels.ts: MainMenu.newGame']);
    const [use] = stagingUses();
    expect(use.guard).toEqual(OVERWRITE);
    // what the title screen reads of the stored tuning is gone: nothing marks it as modified
    for (const f of ['panels.ts', 'menu.ts'])
      expect(source(f), f).not.toMatch(/\b(readRules|rulesDiffer)\b|custom\.rules/);
  }, 30_000);

  it('sees a staging behind the question, one before it, and none at all', () => {
    const staged = (body: string) =>
      stagingIn(
        parse(
          'sample.ts',
          `function f() { const m = new MainMenu({ newGame: (seed) => { ${body} } }); }`,
        ),
        'sample.ts',
      );
    expect(
      staged(
        "if (!confirmReplacement('overwrite')) return; startNewGame(t, stageNewGameTuning, go);",
      ),
    ).toEqual([{ file: 'sample.ts', id: 'MainMenu.newGame', guard: OVERWRITE }]);
    expect(
      staged("startNewGame(t, stageNewGameTuning, go); if (confirmReplacement('overwrite')) go();"),
    ).toEqual([{ file: 'sample.ts', id: 'MainMenu.newGame', guard: { by: 'none' } }]);
    expect(staged('go();')).toEqual([]);
  });

  it('asks before loading a tuning preset, and returns before anything is applied on a no', () => {
    const loads = presetLoadsAsk(parse('tuningScreen.ts', source('tuningScreen.ts')));
    expect(loads).toEqual([true]);
  });

  it('sees an unguarded call, a wrong kind, a lost question and a preset load that does not ask', () => {
    const sample = `
      function slotActions() {
        return {
          loadSlot: (n) => { askBeforeLoad(loadQuestion(n, replaceSituation()), () => { host.loadSlot(n); }); },
        };
      }
      function createPlayUi() {
        const m = new MainMenu({
          newGame: (seed) => { if (confirmReplacement('overwrite')) host.newGame(seed); },
          playLevel: (id) => host.playLevel(id),
          editLevel: (id) => { if (confirmReplacement('overwrite')) host.editLevel(id); },
          newLevel: (a) => { if (!confirmReplacement('leave')) return; host.newLevel(a); },
        });
        const s = new SettingsScreen({
          load: () => {
            const question = asksBeforeReplacing('overwrite', replaceSituation()) ? STR.x : null;
            askBeforeLoad(question, () => { host.loadSave(); });
          },
        });
        const other = host.importLevel(json);
      }`;
    const found = Object.fromEntries(
      replacingSites(parse('sample.ts', sample)).map((s) => [s.id, s.guard]),
    );
    expect(found).toEqual({
      'slotActions.loadSlot -> host.loadSlot': { by: 'ask', question: 'loadQuestion' },
      'MainMenu.newGame -> host.newGame': { by: 'if', kind: 'overwrite' },
      'MainMenu.playLevel -> host.playLevel': { by: 'none' },
      'MainMenu.editLevel -> host.editLevel': { by: 'if', kind: 'overwrite' },
      'MainMenu.newLevel -> host.newLevel': { by: 'if', kind: 'leave' },
      'SettingsScreen.load -> host.loadSave': {
        by: 'ask',
        question: "asksBeforeReplacing('overwrite') ? STR.x : null",
      },
    });
    const presets = `
      const a = () => { if (!confirm(STR.tuning.confirmLoadPreset(p.name))) return; applyRulePreset(p.name); };
      const b = () => { const loaded = applyRulePreset(p.name); };
      const c = () => { this.render(); if (!confirm(STR.tuning.confirmLoadPreset(p.name))) return; applyRulePreset(p.name); };
      const d = () => { if (!confirm(STR.tuning.confirmDeletePreset(p.name))) return; applyRulePreset(p.name); };
      const e = () => { if (confirm(STR.tuning.confirmLoadPreset(p.name))) applyRulePreset(p.name); };`;
    expect(presetLoadsAsk(parse('sample.ts', presets))).toEqual([true, false, false, false, false]);
  });
});

// -------------------------------------------------------- what the Tuning choice is wired to
//
// The title screen's New game choice is built from DOM nodes, so what is built in `MainMenu`,
// `TuningScreen` and `createPlayUi` is read from the source here; the choice's entries, pick and
// start are tested in `newGameTuning.test.ts`.

/** The initializer of `<action>:` in the `new <owner>({..})` of `sf`. */
function actionOf(sf: ts.SourceFile, owner: string, action: string): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (n: ts.Node) => {
    if (
      ts.isPropertyAssignment(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === action &&
      ownerOf(n.initializer).owner === owner
    )
      found = n.initializer;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** The body of method `name` of class `cls`. */
function methodOf(sf: ts.SourceFile, cls: string, name: string): ts.Block | undefined {
  let found: ts.Block | undefined;
  const visit = (n: ts.Node) => {
    if (ts.isClassDeclaration(n) && n.name?.text === cls)
      for (const m of n.members)
        if (ts.isMethodDeclaration(m) && m.name.getText(sf) === name) found = m.body;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** How each `this.tuningPick` in `sf` is used: `write`, `read`, or the call it is an argument of. */
function pickUses(sf: ts.SourceFile): string[] {
  const uses: string[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isPropertyAccessExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ThisKeyword &&
      n.name.text === 'tuningPick'
    ) {
      const p = n.parent;
      if (
        ts.isBinaryExpression(p) &&
        p.left === n &&
        p.operatorToken.kind === ts.SyntaxKind.EqualsToken
      )
        uses.push('write');
      else if (ts.isCallExpression(p) && p.arguments.includes(n))
        uses.push(`argument of ${p.expression.getText(sf)}`);
      else uses.push(`read in ${p.getText(sf)}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return uses;
}

describe("what the title screen's Tuning choice is wired to", () => {
  const menu = () => parse('menu.ts', source('menu.ts'));
  const panels = () => parse('panels.ts', source('panels.ts'));
  const statements = (b: ts.Block | undefined, sf: ts.SourceFile) =>
    (b?.statements ?? []).map((s) => s.getText(sf));

  it('hands the pick to New game and to nothing else: Play level, Edit level and Continue ignore it', () => {
    const reads = pickUses(menu()).filter((u) => u !== 'write');
    expect(reads).not.toEqual([]);
    expect(new Set(reads)).toEqual(
      new Set([
        'argument of keepPick',
        'argument of pickIndex',
        'argument of this.actions.newGame',
      ]),
    );
  });

  it('starts the pick over each time the title screen is drawn, before the choice is built', () => {
    const sf = menu();
    const draw = statements(methodOf(sf, 'MainMenu', 'render'), sf);
    const reset = draw.indexOf('this.tuningPick = null;');
    const build = draw.indexOf('this.refreshTunings();');
    expect(reset).toBeGreaterThanOrEqual(0);
    expect(build).toBeGreaterThan(reset);
  });

  it('refreshes the choice alone: not the seed, the production chain or the rest of the screen', () => {
    const sf = menu();
    const refresh = methodOf(sf, 'MainMenu', 'refreshTunings');
    expect(refresh).toBeDefined();
    const text = refresh!.getText(sf);
    expect(text).not.toMatch(/this\.(render|show|left|right)\b|\bseedInput\b|\bsupply\b/);
    // it is not the drawing of the title screen, which would start the pick over
    expect(text).not.toContain('this.tuningPick = null');
  });

  it("refreshes the choice when the Game tuning screen closes, from the screen's own close", () => {
    const sf = panels();
    let made: ts.NewExpression | undefined;
    const visit = (n: ts.Node) => {
      if (ts.isNewExpression(n) && n.expression.getText(sf) === 'TuningScreen') made = n;
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(made?.arguments).toHaveLength(2);
    expect(made!.arguments![1].getText(sf)).toMatch(/\bmainMenu\.refreshTunings\(\)/);
    // and the screen runs it when it is closed, or replaced by another screen
    const screen = parse('tuningScreen.ts', source('tuningScreen.ts'));
    const closing = statements(methodOf(screen, 'TuningScreen', 'onClose'), screen);
    expect(closing).toEqual(['this.onClosed();']);
  });

  it('lists the tunings saved in Game tuning', () => {
    const sf = panels();
    expect(actionOf(sf, 'MainMenu', 'tunings')?.getText(sf)).toMatch(/\blistRulePresets\(\)/);
  });

  it('toasts what startNewGame says when the pick could not be used', () => {
    const sf = panels();
    const action = actionOf(sf, 'MainMenu', 'newGame');
    expect(action).toBeDefined();
    const text = action!.getText(sf);
    const said = /\bconst (\w+) = startNewGame\(/.exec(text)?.[1];
    expect(said, 'the result of startNewGame is kept').toBeDefined();
    expect(text).toMatch(new RegExp(`if \\(${said}\\) [\\w.]*toasts\\.push\\(${said}\\b`));
  });

  it('sees a pick handed to Play level, a choice built by drawing the screen again, and a close that does not refresh', () => {
    const sample = `
      class MainMenu {
        render() { this.refreshTunings(); this.tuningPick = null; this.actions.playLevel(this.tuningPick); }
        refreshTunings() { this.render(); }
      }
      class TuningScreen { onClose() { this.onChanged(); } }
      const t = new TuningScreen(() => {}, () => {});`;
    const sf = parse('sample.ts', sample);
    expect(pickUses(sf)).toContain('argument of this.actions.playLevel');
    const draw = statements(methodOf(sf, 'MainMenu', 'render'), sf);
    expect(draw.indexOf('this.refreshTunings();')).toBeLessThan(
      draw.indexOf('this.tuningPick = null;'),
    );
    expect(methodOf(sf, 'MainMenu', 'refreshTunings')!.getText(sf)).toMatch(/this\.render\b/);
    expect(statements(methodOf(sf, 'TuningScreen', 'onClose'), sf)).not.toEqual([
      'this.onClosed();',
    ]);
    expect(methodOf(sf, 'MainMenu', 'missing')).toBeUndefined();
  });
});
