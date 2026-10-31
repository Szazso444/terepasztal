import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { STR } from '../strings';
import {
  DialogFlow,
  clampToRange,
  footerLayout,
  isShown,
  meterPercent,
  nextIndex,
  parseNumber,
  pickOption,
  rangePercent,
  stepNumber,
  type FootAction,
} from './kit';

// the kit's controls play a sound when pressed; the context that plays it is a browser's
vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

const PERCENT = { min: 0, max: 100, step: 1 };
const DEAL = { min: 0, max: 5000, step: 10, bigStep: 100 };
const STOP_TIME = { min: 0, max: 600, step: 15 };
// a stop's time: any whole second, a press moves 15 and Shift+press 5
const DWELL = { min: 0, max: 600, step: 15, bigStep: 5, free: true };

describe('a slider and a number field keep to their range', () => {
  it('clamps at both ends', () => {
    expect(clampToRange(-3, PERCENT)).toBe(0);
    expect(clampToRange(140, PERCENT)).toBe(100);
    expect(clampToRange(Infinity, PERCENT)).toBe(100);
    expect(clampToRange(-Infinity, PERCENT)).toBe(0);
  });

  it('snaps to the steps, counted from the bottom of the range', () => {
    expect(clampToRange(14, DEAL)).toBe(10);
    expect(clampToRange(16, DEAL)).toBe(20);
    expect(clampToRange(23, { min: 5, max: 100, step: 10 })).toBe(25);
  });

  it('keeps the top reachable when the steps do not land on it', () => {
    const OFF = { min: 0, max: 10, step: 3 };
    expect(clampToRange(5, { min: 0, max: 5, step: 2 })).toBe(5);
    // a third of a step past the last one, which rounds down to it
    expect(clampToRange(10, OFF)).toBe(10);
    expect(clampToRange(99, OFF)).toBe(10);
    // the top is a stop like the others: the nearer one wins
    expect(clampToRange(9.9, OFF)).toBe(10);
    expect(clampToRange(9.4, OFF)).toBe(9);
    expect(stepNumber(9, 1, OFF)).toBe(10);
  });

  it('steps down from a top off the steps to the last step, jumping none', () => {
    expect(stepNumber(10, -1, { min: 0, max: 10, step: 3 })).toBe(9);
  });

  it('steps from a value between two steps to the next stop that way', () => {
    expect(stepNumber(50, 1, STOP_TIME)).toBe(60);
    expect(stepNumber(50, -1, STOP_TIME)).toBe(45);
    expect(stepNumber(105, 1, DEAL, true)).toBe(200);
  });

  it('leaves no float noise on a fractional step', () => {
    expect(clampToRange(0.30000000000000004, { min: 0, max: 1, step: 0.1 })).toBe(0.3);
  });

  it('takes every number with no step, and something that is no number as the bottom', () => {
    expect(clampToRange(1.2345, { min: 0, max: 2 })).toBe(1.2345);
    expect(clampToRange(NaN, { min: 5, max: 9 })).toBe(5);
  });

  it('steps by one press, and stops at the ends', () => {
    expect(stepNumber(45, 1, STOP_TIME)).toBe(60);
    expect(stepNumber(45, -1, STOP_TIME)).toBe(30);
    expect(stepNumber(0, -1, STOP_TIME)).toBe(0);
    expect(stepNumber(600, 1, STOP_TIME)).toBe(600);
    // with no step of its own a press moves by one
    expect(stepNumber(1, 1, { min: 0, max: 3 })).toBe(2);
  });

  it('takes the big step only with Shift, and only when the field has one', () => {
    expect(stepNumber(100, 1, DEAL)).toBe(110);
    expect(stepNumber(100, 1, DEAL, true)).toBe(200);
    expect(stepNumber(100, -1, DEAL, true)).toBe(0);
    expect(stepNumber(30, 1, STOP_TIME, true)).toBe(45);
  });

  it('reads what is typed, clamped; text that is no number leaves the value', () => {
    expect(parseNumber(' 120 ', DEAL, 40)).toBe(120);
    expect(parseNumber('99999', DEAL, 40)).toBe(5000);
    expect(parseNumber('-5', DEAL, 40)).toBe(0);
    expect(parseNumber('abc', DEAL, 40)).toBe(40);
    expect(parseNumber('', DEAL, 40)).toBe(40);
  });

  it('fills a track and a meter by share, whatever it is given', () => {
    expect(rangePercent(25, PERCENT)).toBe(25);
    expect(rangePercent(150, PERCENT)).toBe(100);
    expect(rangePercent(30, { min: 20, max: 40 })).toBe(50);
    expect(rangePercent(3, { min: 3, max: 3 })).toBe(0);
    expect(meterPercent(0.4)).toBe(40);
    expect(meterPercent(1.7)).toBe(100);
    expect(meterPercent(-1)).toBe(0);
    expect(meterPercent(NaN)).toBe(0);
    expect(meterPercent(Infinity)).toBe(0);
  });
});

describe('a free number field keeps every whole number', () => {
  it('shows a stored value as it is, and keeps a typed one to the second', () => {
    for (const v of [0, 1, 7, 12, 14, 16, 599, 600]) expect(clampToRange(v, DWELL)).toBe(v);
    expect(parseNumber('7', DWELL, 30)).toBe(7);
    expect(parseNumber(' 45 ', DWELL, 30)).toBe(45);
  });

  it('rounds a fraction to the second and holds the ends', () => {
    expect(clampToRange(7.6, DWELL)).toBe(8);
    expect(clampToRange(-4, DWELL)).toBe(0);
    expect(clampToRange(9000, DWELL)).toBe(600);
    expect(parseNumber('abc', DWELL, 30)).toBe(30);
  });

  it('moves by a step from wherever it stands, and by the big step with Shift', () => {
    expect(stepNumber(7, 1, DWELL)).toBe(22);
    expect(stepNumber(7, -1, DWELL)).toBe(0);
    expect(stepNumber(7, 1, DWELL, true)).toBe(12);
    expect(stepNumber(12, -1, DWELL, true)).toBe(7);
    expect(stepNumber(590, 1, DWELL)).toBe(600);
    expect(stepNumber(600, 1, DWELL)).toBe(600);
    expect(stepNumber(0, -1, DWELL, true)).toBe(0);
  });

  it('leaves a range that is not free as it was', () => {
    expect(clampToRange(7, STOP_TIME)).toBe(0);
    expect(stepNumber(7, 1, STOP_TIME)).toBe(15);
  });
});

describe('a segmented control', () => {
  const POLICY = [{ id: 'accept' }, { id: 'prompt' }, { id: 'deny' }];

  it('takes the option pressed', () => {
    expect(pickOption(POLICY, 'deny', 'accept')).toBe('deny');
  });

  it('keeps its value on something that is not one of its options', () => {
    expect(pickOption(POLICY, 'maybe', 'prompt')).toBe('prompt');
  });
});

describe('Tab goes round the controls of a frame', () => {
  it('starts at the first, or the last going back', () => {
    expect(nextIndex(4, -1, false)).toBe(0);
    expect(nextIndex(4, -1, true)).toBe(3);
  });

  it('wraps round at both ends', () => {
    expect(nextIndex(4, 3, false)).toBe(0);
    expect(nextIndex(4, 0, true)).toBe(3);
    expect(nextIndex(4, 1, false)).toBe(2);
  });
});

describe('what Tab counts as a control that shows', () => {
  it('skips what is not drawn: it has no boxes', () => {
    expect(isShown({ getClientRects: () => [{}] })).toBe(true);
    expect(isShown({ getClientRects: () => [] })).toBe(false);
  });
});

describe('the footer', () => {
  const leave = vi.fn();
  const action = (label: string, o: Partial<FootAction> = {}): FootAction => ({
    label,
    onClick: () => undefined,
    ...o,
  });
  const labels = (l: FootAction[] | undefined) => l?.map((a) => a.label);

  it('puts the secondary actions on the left in their order, the primary rightmost', () => {
    const l = footerLayout(
      { actions: [action('Go', { primary: true }), action('Locate'), action('Recall')] },
      false,
      leave,
    );
    expect(labels(l?.left)).toEqual(['Locate', 'Recall']);
    expect(labels(l?.right)).toEqual(['Go']);
  });

  it('keeps a destructive action a secondary, red, unless it is the primary too', () => {
    const l = footerLayout(
      {
        actions: [
          action('Delete', { danger: true }),
          action('Sure', { danger: true, primary: true }),
        ],
      },
      false,
      leave,
    );
    expect(l?.left[0]).toMatchObject({ label: 'Delete', danger: true });
    expect(l?.left[0].primary).toBeFalsy();
    expect(l?.right[0]).toMatchObject({ label: 'Sure', danger: true, primary: true });
  });

  it('the Back rule: stacked, Back is the leftmost secondary, never the accent', () => {
    const l = footerLayout(
      { actions: [action('Defaults'), action('Go', { primary: true })], done: true },
      true,
      leave,
    );
    expect(labels(l?.left)).toEqual([STR.kit.back, 'Defaults']);
    expect(l?.left[0].primary).toBeFalsy();
    expect(labels(l?.right)).toEqual(['Go']);
  });

  it('Done is the rightmost accent on its own, and gives way to Back when stacked', () => {
    const alone = footerLayout({ actions: [action('Defaults')], done: true }, false, leave);
    expect(labels(alone?.left)).toEqual(['Defaults']);
    expect(labels(alone?.right)).toEqual([STR.kit.done]);
    expect(alone?.right[0].primary).toBe(true);
    const stacked = footerLayout({ actions: [action('Defaults')], done: true }, true, leave);
    expect(labels(stacked?.left)).toEqual([STR.kit.back, 'Defaults']);
    expect(stacked?.right).toEqual([]);
  });

  it('holds no Done beside a forward action of the screen', () => {
    const l = footerLayout(
      { actions: [action('Go', { primary: true })], done: true },
      false,
      leave,
    );
    expect(labels(l?.right)).toEqual(['Go']);
  });

  it('Back and Done both leave the screen', () => {
    const run = vi.fn();
    footerLayout({}, true, run)?.left[0].onClick();
    footerLayout({ done: true }, false, run)?.right[0].onClick();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('gives a screen that says nothing a footer only when it is stacked', () => {
    expect(footerLayout(null, false, leave)).toBeNull();
    expect(labels(footerLayout(null, true, leave)?.left)).toEqual([STR.kit.back]);
  });

  it('keeps the note, and shows a footer for a note alone', () => {
    expect(footerLayout({ note: 'n', done: true }, true, leave)?.note).toBe('n');
    expect(footerLayout({ note: 'n' }, false, leave)).toEqual({ left: [], note: 'n', right: [] });
  });
});

describe('the confirm flow', () => {
  function fakeHost() {
    const log: string[] = [];
    return {
      log,
      host: {
        show: (q: string) => log.push(`show ${q}`),
        hide: () => log.push('hide'),
      },
    };
  }

  it('shows the question and waits for the answer', async () => {
    const { log, host } = fakeHost();
    const flow = new DialogFlow<string, boolean>(host, false);
    const answer = flow.ask('Delete?');
    expect(flow.open).toBe(true);
    expect(log).toEqual(['show Delete?']);
    flow.answer(true);
    expect(await answer).toBe(true);
    expect(flow.open).toBe(false);
    expect(log).toEqual(['show Delete?', 'hide']);
  });

  it('says no when dismissed, as Esc and a click beside it do', async () => {
    const { host } = fakeHost();
    const flow = new DialogFlow<string, boolean>(host, false);
    const answer = flow.ask('Delete?');
    flow.dismiss();
    expect(await answer).toBe(false);
  });

  it('dismisses the question up when another is asked, and shows the new one', async () => {
    const { log, host } = fakeHost();
    const flow = new DialogFlow<string, boolean>(host, false);
    const first = flow.ask('First?');
    const second = flow.ask('Second?');
    expect(await first).toBe(false);
    expect(flow.open).toBe(true);
    expect(log).toEqual(['show First?', 'hide', 'show Second?']);
    flow.answer(true);
    expect(await second).toBe(true);
  });

  it('counts one answer only: a second press and a press with nothing up do nothing', async () => {
    const { log, host } = fakeHost();
    const flow = new DialogFlow<string, boolean>(host, false);
    flow.answer(true);
    flow.dismiss();
    expect(log).toEqual([]);
    const answer = flow.ask('Delete?');
    flow.answer(true);
    flow.answer(false);
    expect(await answer).toBe(true);
    expect(log).toEqual(['show Delete?', 'hide']);
  });

  it('runs nothing on a no: what follows a question waits for its yes', async () => {
    const { host } = fakeHost();
    const flow = new DialogFlow<string, boolean>(host, false);
    const deleted = vi.fn();
    const asked = flow.ask('Delete?').then((yes) => yes && deleted());
    expect(deleted).not.toHaveBeenCalled();
    flow.answer(false);
    await asked;
    expect(deleted).not.toHaveBeenCalled();
  });
});

describe('the game asks in its own dialog', () => {
  /** Every `.ts` file of `src` bar the tests. */
  function sources(dir: URL): URL[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.isDirectory()) return sources(new URL(`${e.name}/`, dir));
      const file = e.name.endsWith('.ts') && !e.name.endsWith('.test.ts');
      return file ? [new URL(e.name, dir)] : [];
    });
  }

  /**
   * The two `prompt()` of the level editor (Save as, Regenerate), which PR 12d takes out of
   * `game.ts`. Only they pass, and this goes with them.
   */
  const LEFT_TO_12D = /\/src\/game\.ts: prompt\(STR\.(editor\.newName|settings\.seedPlaceholder)\b/;

  /** The calls of the browser's own `confirm`, `alert` and `prompt` in `text`. */
  function nativeDialogs(file: string, text: string): string[] {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const found: string[] = [];
    const visit = (n: ts.Node) => {
      if (
        ts.isCallExpression(n) &&
        /^(window\.)?(confirm|alert|prompt)$/.test(n.expression.getText(sf))
      )
        found.push(`${file}: ${n.getText(sf)}`);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return found;
  }

  it('has no native confirm(), alert() or prompt() left in src', () => {
    const found = sources(new URL('../', import.meta.url)).flatMap((f) =>
      nativeDialogs(f.pathname, readFileSync(f, 'utf8')),
    );
    expect(found.filter((f) => !LEFT_TO_12D.test(f))).toEqual([]);
  }, 30_000);

  it('sees one, and not a method of the same name', () => {
    expect(
      nativeDialogs(
        'sample.ts',
        `confirm('a'); window.alert('b'); prompt('c'); this.prompt.confirm('d', 'e');`,
      ),
    ).toHaveLength(3);
  });

  it('lets through only the two left to PR 12d', () => {
    const passes = (line: string) => LEFT_TO_12D.test(line);
    expect(passes('/x/src/game.ts: prompt(STR.editor.newName, editor.level.name)')).toBe(true);
    expect(passes('/x/src/game.ts: prompt(STR.settings.seedPlaceholder, s)')).toBe(true);
    expect(passes('/x/src/game.ts: prompt(STR.station.rename, s.name)')).toBe(false);
    expect(passes('/x/src/ui/stationPanel.ts: prompt(STR.editor.newName, n)')).toBe(false);
  });
});

describe('the kit section of the stylesheet', () => {
  const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
  const kit = css.slice(css.indexOf('/* ---- the screen frame and the kit'));

  it('changes no disabled button of a screen not redone: its rule stays inside the kit', () => {
    expect(kit).toContain('.k-page .btn:disabled');
    expect(kit).not.toMatch(/^\.btn:disabled/m);
  });
});
