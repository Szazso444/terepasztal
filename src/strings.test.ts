import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import { AGE_ORDER, STR } from './strings';
import { AGE_DEFS } from './sim/ages';
import { RULE_META } from './sim/rules';
import { runsOn, withoutInCab } from './sim/compat';
import { content } from './data/content';

/** Every string a group of STR can show, with the functions called on stand-in arguments. */
function texts(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (typeof node === 'function') {
    for (const args of [
      [true, 1, 2, 3],
      [false, 1, 2, 3],
      ['x', 1, 2, 'y'],
    ]) {
      try {
        const r = (node as (...a: unknown[]) => unknown)(...args);
        if (typeof r === 'string') out.push(r);
      } catch {
        // a function that wants other arguments shows nothing here
      }
    }
  } else if (node && typeof node === 'object') for (const v of Object.values(node)) texts(v, out);
  return out;
}

describe('track names the player reads', () => {
  it('calls the regular class wide', () => {
    expect(STR.toolbar.trackClass).toMatchObject({
      regular: 'Wide',
      high_speed: 'High-speed',
      narrow: 'Narrow',
    });
  });

  it('never says regular in the toolbar, the build messages or the train messages', () => {
    for (const group of [STR.toolbar, STR.build, STR.compat, STR.fleet])
      for (const s of texts(group)) expect(s).not.toMatch(/regular/i);
  });

  it('names the tuning value and the track a vehicle runs on', () => {
    expect(RULE_META.find((m) => m.key === 'lineSpeedRegular')!.label).toBe('Wide line speed');
    const boxcar = content.wagons.find((w) => w.id === 'boxcar')!;
    expect(runsOn(boxcar)).toBe('Runs on wide and high-speed track');
    expect(STR.compat.wrongGauge(true)).toBe('Wide gauge: cannot run on narrow track');
  });
});

describe('what the upgrade tool tells the player', () => {
  it('counts the trains that cannot run on high-speed track', () => {
    const loco = (own: boolean, built: boolean) => ({ inCab: own, def: { inCab: built } });
    const trains = [
      { locos: [loco(false, false)] },
      // fitted to one locomotive of the consist, or built into its type: the train may run
      { locos: [loco(false, false), loco(true, false)] },
      { locos: [loco(false, true)] },
      { locos: [loco(false, false), loco(false, false)] },
    ];
    expect(withoutInCab(trains)).toEqual({ barred: 2, total: 4 });
    expect(withoutInCab([])).toEqual({ barred: 0, total: 0 });
  });

  it('says what an upgrade does to trains without in-cab signalling', () => {
    expect(STR.toolbar.upgradeHint).toMatch(/in-cab signalling/);
    expect(STR.build.reclassBarred(2, 5)).toBe(
      '2 of 5 trains have no in-cab signalling and cannot run on high-speed track',
    );
    expect(STR.build.reclassBarred(1, 1)).toBe(
      '1 of 1 train has no in-cab signalling and cannot run on high-speed track',
    );
    // a tool in hand over empty ground still says what it is for
    expect(STR.build.reclassIdle('Upgrade')).toBe('Upgrade: click a piece or drag along the line');
  });

  it('lists the track keys among the controls', () => {
    for (const key of ['Q / E', 'U', 'Shift+U', '1-5'])
      expect(STR.settings.controlsText).toContain(key);
  });
});

describe('the ages the player reads about', () => {
  it('names every age in order, in the order the age data lists them', () => {
    expect(AGE_ORDER).toHaveLength(6);
    for (const id of AGE_ORDER) expect(STR.ages.name[id], id).toBeTruthy();
    // the data may list fewer ages than there are names, never different ones
    AGE_DEFS.forEach((a, i) => expect(a.id).toBe(AGE_ORDER[i]));
  });

  it('labels each age by its index, the editor included', () => {
    for (let t = 0; t < AGE_ORDER.length; t++)
      expect(STR.hud.ageUp(t)).toContain(STR.ages.name[AGE_ORDER[t]]);
    expect(STR.hud.ageUp(3)).toContain('Nuclear Age');
    for (const [t, id] of AGE_ORDER.entries()) expect(STR.editor.startTier).toContain(`${t} ${id}`);
  });
});

describe('what an upgrade shows', () => {
  const cost = '60 wood, 40 stone';

  it('rounds the time up on the button and leaves it out with none', () => {
    expect(STR.upgrade.button(3, cost, 9)).toContain(cost);
    expect(STR.upgrade.button(3, cost, 9)).toMatch(/\b3\b.*· 9 h$/);
    expect(STR.upgrade.button(3, cost, 8.2)).toBe(STR.upgrade.button(3, cost, 9));
    expect(STR.upgrade.button(3, cost, 0)).toMatch(new RegExp(`\\b3\\b.*${cost}$`));
  });

  it('never says no time is left while it runs', () => {
    expect(STR.upgrade.running(3, 3.2)).toBe(STR.upgrade.running(3, 4));
    expect(STR.upgrade.running(3, 3.2)).toContain('4 h left');
    expect(STR.upgrade.running(3, 0.2)).toContain('1 h left');
    expect(STR.upgrade.running(3, 0)).toContain('1 h left');
  });
});

describe('what the save list shows', () => {
  const sec = 1000;
  const min = 60 * sec;
  const hour = 60 * min;
  const day = 24 * hour;

  it('says how long ago in whole units, rounded down', () => {
    expect(STR.saves.ago(0)).toBe(STR.saves.ago(59 * sec));
    expect(STR.saves.ago(0)).not.toMatch(/\d/);
    expect(STR.saves.ago(61 * sec)).toMatch(/^1 min\b/);
    expect(STR.saves.ago(59 * min)).toMatch(/^59 min\b/);
    expect(STR.saves.ago(2 * hour)).toMatch(/^2 h\b/);
    expect(STR.saves.ago(1 * day)).toMatch(/^1 day\b/);
    expect(STR.saves.ago(3 * day)).toMatch(/^3 days\b/);
    // a clock that moved backwards is still "just now", not a negative count
    expect(STR.saves.ago(-5 * min)).toBe(STR.saves.ago(0));
  });

  it('names what was refunded and leaves out what was not', () => {
    const money = '$1,200';
    expect(STR.saves.refund(money, 2)).toMatch(/^\$1,200 .*\b2 tickets$/);
    expect(STR.saves.refund(money, 1)).toMatch(/^\$1,200 .*\b1 ticket$/);
    expect(STR.saves.refund(money, 0)).toBe(money);
    expect(STR.saves.refund('', 2)).toBe('2 tickets');
    expect(STR.saves.refund('', 1)).toBe('1 ticket');
    expect(STR.saves.refund('', 0)).toBe('');
  });

  it('says what was removed and what came back, without an empty refund', () => {
    const refund = STR.saves.refund('$50', 1);
    expect(STR.saves.pruned('Old loco', refund)).toContain('Old loco');
    expect(STR.saves.pruned('Old loco', refund)).toContain(refund);
    expect(STR.saves.pruned('Old loco', '')).not.toMatch(/Refunded/);
  });

  it('tells the three autosave states apart', () => {
    const states = [
      STR.saves.autosaveStatus(true, STR.saves.ago(2 * min)),
      STR.saves.autosaveStatus(true, null),
      STR.saves.autosaveStatus(false, null),
    ];
    expect(new Set(states).size).toBe(3);
    expect(states[0]).toContain(STR.saves.ago(2 * min));
    expect(STR.saves.autosaveStatus(false, 'x')).toBe(states[2]);
  });
});

describe('what the tuning presets say', () => {
  const t = STR.tuning;
  const messages = [
    t.confirmOverwritePreset,
    t.confirmDeletePreset,
    t.presetSaved,
    t.presetSaveFailed,
    t.presetLoaded,
    t.presetDeleted,
  ];

  it('names the preset in every question and status, and tells them apart', () => {
    for (const m of messages) expect(m('Hilly 2')).toContain('Hilly 2');
    expect(new Set(messages.map((m) => m('Hilly 2'))).size).toBe(messages.length);
  });

  it('labels the block, the input and every button', () => {
    const labels = [t.presets, t.presetName, t.savePreset, t.loadPreset, t.deletePreset];
    for (const s of [...labels, t.noPresets, t.scope]) expect(s.trim()).not.toBe('');
    expect(new Set(labels).size).toBe(labels.length);
  });
});

/** Attributes and properties whose value the player reads. */
const SHOWN = new Set(['text', 'title', 'placeholder', 'aria-label', 'textContent']);
/** A literal that reads as English: a capital letter, then a lowercase one. */
const ENGLISH = /^[A-Z][a-z]/;

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text;
  return null;
}

/** The literals an expression can show: through parentheses, conditionals, fallbacks and `+`. */
function shownLiterals(e: ts.Expression, out: ts.Expression[] = []): ts.Expression[] {
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) shownLiterals(e.expression, out);
  else if (ts.isConditionalExpression(e)) {
    shownLiterals(e.whenTrue, out);
    shownLiterals(e.whenFalse, out);
  } else if (
    ts.isBinaryExpression(e) &&
    [
      ts.SyntaxKind.QuestionQuestionToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.PlusToken,
    ].includes(e.operatorToken.kind)
  ) {
    shownLiterals(e.left, out);
    shownLiterals(e.right, out);
  } else if (literalText(e) !== null) out.push(e);
  return out;
}

function nameOf(name: ts.Node): string {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : '';
}

/**
 * `file:line: text` for every English literal a panel hands the player directly: the text, title,
 * placeholder or aria-label it sets, the label of `btn()`, a child of `el()`, or a toast.
 */
function hardcodedText(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const check = (e: ts.Expression | undefined) => {
    if (!e) return;
    for (const lit of shownLiterals(e)) {
      const text = literalText(lit)!;
      if (!ENGLISH.test(text)) continue;
      const line = sf.getLineAndCharacterOfPosition(lit.getStart(sf)).line + 1;
      found.push(`${file}:${line}: ${text.split('\n')[0]}`);
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const fn = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : '';
      if (fn === 'btn' || fn === 'toast') check(node.arguments[0]);
      else if (fn === 'el') node.arguments.slice(2).forEach(check);
      else if (
        fn === 'push' &&
        ts.isPropertyAccessExpression(callee) &&
        /toasts$/i.test(callee.expression.getText(sf))
      )
        check(node.arguments[0]);
    } else if (
      (ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) &&
      SHOWN.has(nameOf(node.name))
    )
      check(node.initializer);
    else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      SHOWN.has(node.left.name.text)
    )
      check(node.right);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('text the panels show', () => {
  const dir = new URL('./ui/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  it('comes from STR in every src/ui file', () => {
    expect(files).toContain('dom.ts');
    const found = files.flatMap((f) =>
      hardcodedText(`src/ui/${f}`, readFileSync(new URL(f, dir), 'utf8')),
    );
    expect(found, 'move these into src/strings.ts').toEqual([]);
  });

  it('catches a hardcoded label, child, attribute or toast, and leaves classes and keys alone', () => {
    const panel = [
      "btn('Foo', () => {});",
      "el('div', {}, 'Foo bar');",
      "el('div', { class: 'k', text: on ? 'Shown' : `Hidden ${n}` });",
      "input.placeholder = 'Type here';",
      "this.toast('Done', 'good');",
      "el('div', { class: 'Panel title', id: 'Root' }, STR.title, '×');",
      "if (inp.wasPressed('Escape')) close();",
      "btn('x', close, 'small');",
    ].join('\n');
    expect(hardcodedText('panel.ts', panel)).toEqual([
      'panel.ts:1: Foo',
      'panel.ts:2: Foo bar',
      'panel.ts:3: Shown',
      'panel.ts:3: Hidden ',
      'panel.ts:4: Type here',
      'panel.ts:5: Done',
    ]);
  });

  it('names a direction for every signal rotation', () => {
    expect(STR.signals.directions).toHaveLength(4);
  });
});
