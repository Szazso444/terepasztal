import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import { STR } from '../strings';
import type { LevelData } from '../world/level';
import { LEVEL_SIZES, levelIdOf, levelOfText, levelRows, newLevelRequest } from './levelsScreen';
import { startTip } from './newGameScreen';

const level = (over: Partial<LevelData> = {}): LevelData => ({
  id: 'lvl_a',
  name: 'Alföld',
  description: '',
  createdAt: 1,
  updatedAt: Date.UTC(2026, 9, 21),
  w: 64,
  h: 64,
  seed: 1,
  terrain: '',
  variant: '',
  track: [],
  stations: [],
  decor: [],
  start: { money: 40000, tickets: 0, tier: 0 },
  ...over,
});

const date = (ms: number) => `d${ms}`;

describe('the Levels list', () => {
  it('says the size, the stations and the date, as the game always wrote them', () => {
    const [row] = levelRows(
      [level({ stations: [{ defId: 's', x: 0, y: 0, level: 1, name: 'A' }] })],
      date,
    );
    expect(row.line).toBe(`64x64 · ${STR.menu.levelStations(1)} · d${Date.UTC(2026, 9, 21)}`);
    expect(row.id).toBe('lvl_a');
    expect(row.name).toBe('Alföld');
  });

  it('keeps the order it is given (newest first) and has a row for every level', () => {
    const rows = levelRows(
      [level({ id: 'b', name: 'B' }), level({ id: 'a', name: 'A' }), level({ id: 'c' })],
      date,
    );
    expect(rows.map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(levelRows([], date)).toEqual([]);
  });

  it('gives the first 80 characters of the description, and none for a level without one', () => {
    const long = 'x'.repeat(120);
    expect(levelRows([level({ description: long })], date)[0].description).toBe('x'.repeat(80));
    expect(levelRows([level({ description: 'Flat plains.' })], date)[0].description).toBe(
      'Flat plains.',
    );
    expect(levelRows([level({ description: '' })], date)[0].description).toBeNull();
  });
});

describe('New level', () => {
  it('offers the four sizes the game has', () => {
    expect([...LEVEL_SIZES]).toEqual([32, 64, 96, 128]);
  });

  it('asks the game for a generated map only when Generated is picked, with the seed text trimmed', () => {
    expect(newLevelRequest(96, 'blank', ' 12 ')).toEqual({
      size: 96,
      generated: false,
      seed: '12',
    });
    expect(newLevelRequest(32, 'generated', '')).toEqual({ size: 32, generated: true, seed: '' });
  });
});

describe('Import level', () => {
  it('picks out the level an import added by its id', () => {
    expect(levelIdOf(JSON.stringify(level({ id: 'lvl_x' })))).toBe('lvl_x');
  });

  it('has no id for text that is no JSON object, no level, or carries none', () => {
    for (const text of ['', 'not json', '5', 'null', '[]', '{}', '{"id":3}', '{"id":"x"}'])
      expect(levelIdOf(text), text).toBeNull();
  });

  it('reads a level by the rule the game stores one by, and nothing less', () => {
    const l = level({ id: 'lvl_y' });
    expect(levelOfText(JSON.stringify(l))?.id).toBe('lvl_y');
    expect(levelOfText(JSON.stringify({ ...l, terrain: 5 }))).toBeNull();
    expect(levelOfText(JSON.stringify({ ...l, start: null }))).toBeNull();
    expect(levelOfText(JSON.stringify({ ...l, track: 'none' }))).toBeNull();
  });
});

describe('the New game button says when it asks first', () => {
  it('names what the start replaces, and says nothing of asking when it asks nothing', () => {
    expect(startTip(null)).toBe(STR.newGameScreen.startHint);
    expect(startTip('stored')).toBe(STR.newGameScreen.startAsks);
    expect(startTip('game')).toBe(STR.newGameScreen.startAsksOver);
    expect(new Set([startTip(null), startTip('stored'), startTip('game')]).size).toBe(3);
  });
});

// ------------------------------------------------------------------ the screen's source

describe('Delete level asks before it deletes', () => {
  const sf = ts.createSourceFile(
    'levelsScreen.ts',
    readFileSync(new URL('./levelsScreen.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );

  it('answers a red question in the game dialog, and deletes only on a yes', () => {
    let body = '';
    const visit = (n: ts.Node) => {
      if (ts.isMethodDeclaration(n) && n.name.getText(sf) === 'delete' && n.body)
        body = n.body.getText(sf);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(body).toMatch(/this\.prompt\s*\.confirm\(STR\.menu\.deleteLevelTitle/);
    expect(body).toContain('danger: true');
    // the delete is after the answer, behind `if (!ok) return`
    expect(body.indexOf('if (!ok) return;')).toBeGreaterThan(0);
    expect(body.indexOf('this.actions.deleteLevel(')).toBeGreaterThan(
      body.indexOf('if (!ok) return;'),
    );
    // and it is the only place a level is deleted
    const source = readFileSync(new URL('./levelsScreen.ts', import.meta.url), 'utf8');
    expect(source.match(/actions\.deleteLevel\(/g)).toHaveLength(1);
  });
});
