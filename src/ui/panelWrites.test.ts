import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';

/**
 * Fields of a train, station, signal, roster item or the purse that a panel changes only through
 * `Commands` (`src/sim/commands.ts`): routing mode, signal direction, name, in-cab fitting, fuel
 * preference, stop list, money and tickets.
 */
const COMMANDED = new Set([
  'mode',
  'rot',
  'name',
  'inCab',
  'fuelPreference',
  'schedule',
  'money',
  'tickets',
]);
/**
 * Calls that change the purse, the stockpile or a stop list past the commands: spending, earning,
 * stockpile moves, and a train's stops handed to the fleet as they are.
 */
const MOVES = /\b((economy|stock)\.(spend|earn|add|take)|fleet\.setSchedule)$/;
/** The debug panel's cheats change the game on purpose. */
const CHEATS = 'DebugPanel';
/** Files that edit a level being made, not a running game. */
const LEVEL_EDITORS = new Set(['editorPanel.ts']);

const ASSIGN = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
]);

/** A commanded field of something other than the panel itself (`this.rot` is the panel's own). */
function commandedField(e: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(e) &&
    COMMANDED.has(e.name.text) &&
    e.expression.kind !== ts.SyntaxKind.ThisKeyword
  );
}

/** `file:line: code` for every place a panel changes the simulation without a command. */
function directWrites(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const report = (node: ts.Node) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    found.push(`${file}:${line}: ${node.getText(sf)}`);
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === CHEATS
    )
      return;
    if (
      ts.isBinaryExpression(node) &&
      ASSIGN.has(node.operatorToken.kind) &&
      commandedField(node.left)
    )
      report(node);
    else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      commandedField(node.operand)
    )
      report(node);
    else if (ts.isCallExpression(node) && MOVES.test(node.expression.getText(sf))) report(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('what the panels change', () => {
  const dir = new URL('./', import.meta.url);
  const files = readdirSync(dir).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !LEVEL_EDITORS.has(f),
  );

  it('goes through the commands in every src/ui file', () => {
    expect(files).toContain('trainScreen.ts');
    const found = files.flatMap((f) =>
      directWrites(`src/ui/${f}`, readFileSync(new URL(f, dir), 'utf8')),
    );
    expect(found, 'call a method of Commands instead').toEqual([]);
  }, 20_000); // parses every panel: room for a busy machine

  it('catches a field write, a step, a spend, a stockpile move and a stop list, and leaves panel state alone', () => {
    const panel = [
      'train.mode = m;',
      'signal.rot = (signal.rot + 1) % 4;',
      'this.economy.tickets -= cost;',
      'it.inCab ??= true;',
      'station.name = n;',
      'economy.money++;',
      'if (!this.economy.spend(price)) return;',
      'this.stock.take(id, 5);',
      'this.fleet.setSchedule(t, t.schedule);',
      'this.rot = 0; this.schedule = []; this.mode = "x";',
      "el('div', { name: 'x', mode: 1 }); const same = t.mode === m;",
      'this.commands.setSchedule(t, stops); this.stock.get(id);',
      'new DebugPanel(1, { giveMoney: () => (d.economy.money += 10000) });',
    ].join('\n');
    expect(directWrites('panel.ts', panel)).toEqual([
      'panel.ts:1: train.mode = m',
      'panel.ts:2: signal.rot = (signal.rot + 1) % 4',
      'panel.ts:3: this.economy.tickets -= cost',
      'panel.ts:4: it.inCab ??= true',
      'panel.ts:5: station.name = n',
      'panel.ts:6: economy.money++',
      'panel.ts:7: this.economy.spend(price)',
      'panel.ts:8: this.stock.take(id, 5)',
      'panel.ts:9: this.fleet.setSchedule(t, t.schedule)',
    ]);
  });
});
