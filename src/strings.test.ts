import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import { STR } from './strings';
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
