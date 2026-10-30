import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { TRAIN_CLASSES } from '../sim/compat';
import { TRACK_CLASSES } from '../world/track';
import {
  CLASS_ICON,
  CLASS_STEP,
  ENGINES,
  LINE_LETTER,
  classBadgeSvg,
  classBadgeTip,
  engineLength,
  engineReach,
  lineBadgeSvg,
  lineBadgeTip,
  linesOf,
} from './lineBadge';

const letterOf = (svg: string) => svg.match(/<text[^>]*>([^<]*)<\/text>/)?.[1];
const filledPips = (svg: string) => svg.match(/class="pip on"/g)?.length ?? 0;
const allPips = (svg: string) => svg.match(/class="pip/g)?.length ?? 0;

describe('track line labels', () => {
  it('marks every line with its own letter', () => {
    const letters = TRACK_CLASSES.map((l) => LINE_LETTER[l]);
    expect(new Set(letters).size).toBe(letters.length);
    expect(letterOf(lineBadgeSvg('narrow'))).toBe('N');
    expect(letterOf(lineBadgeSvg('branch'))).toBe('B');
    expect(letterOf(lineBadgeSvg('main'))).toBe('M');
    expect(letterOf(lineBadgeSvg('trunk'))).toBe('T');
  });

  it('has a colour and an ink for every line in the stylesheet', () => {
    const css = fs.readFileSync('src/ui/style.css', 'utf8');
    for (const line of TRACK_CLASSES) {
      expect(css, line).toContain(`--line-${line}:`);
      expect(css, line).toContain(`--line-${line}-ink:`);
    }
  });

  it('lists every line a class may run on', () => {
    expect(linesOf('corvette')).toEqual(['narrow']);
    expect(linesOf('frigate')).toEqual(['branch', 'main', 'trunk']);
    expect(linesOf('destroyer')).toEqual(['main', 'trunk']);
    expect(linesOf('cruiser')).toEqual(['trunk']);
    expect(linesOf('hydrofoil')).toEqual(['maglev']);
  });
});

describe('train class icons', () => {
  it('has one size for every class', () => {
    for (const tc of TRAIN_CLASSES)
      expect(classBadgeSvg(tc), tc).toContain(`width="${CLASS_ICON.w}" height="${CLASS_ICON.h}"`);
  });

  it('fills as many of the four pips as the step of the class', () => {
    const order = ['corvette', 'frigate', 'destroyer', 'cruiser'] as const;
    order.forEach((tc, i) => {
      expect(filledPips(classBadgeSvg(tc)), tc).toBe(i + 1);
      expect(allPips(classBadgeSvg(tc)), tc).toBe(4);
    });
  });

  it('grows the engine in equal steps, in the middle of the icon', () => {
    const lengths = [1, 2, 3, 4].map(engineLength);
    for (let i = 1; i < 4; i++) expect(lengths[i] - lengths[i - 1]).toBe(lengths[1] - lengths[0]);
    expect(lengths[3]).toBeLessThan(CLASS_ICON.w);
    for (const tc of ['corvette', 'frigate', 'destroyer', 'cruiser'] as const) {
      const [, tx, sx] =
        classBadgeSvg(tc).match(/translate\(([-\d.]+) -0\.4\) scale\(([\d.]+) 1\)/) ?? [];
      const [x0, x1] = engineReach(ENGINES[tc]);
      const left = Number(tx) + x0 * Number(sx);
      const right = Number(tx) + x1 * Number(sx);
      expect(left, tc).toBeCloseTo(CLASS_ICON.w - right, 6);
    }
  });

  it('marks the Carrier with the atom', () => {
    expect(classBadgeSvg('carrier').match(/rotate/g)).toHaveLength(3);
    expect(classBadgeSvg('cruiser')).not.toContain('rotate');
    expect(CLASS_STEP.carrier).toBe(CLASS_STEP.cruiser);
  });

  it('keeps the separate fast networks off the scale', () => {
    expect(allPips(classBadgeSvg('hydrofoil'))).toBe(0);
    expect(allPips(classBadgeSvg('submarine'))).toBe(0);
  });

  it('has its colours in the stylesheet', () => {
    const css = fs.readFileSync('src/ui/style.css', 'utf8');
    for (const t of ['plate', 'edge', 'ink', 'pip', 'pip-off'])
      expect(css, t).toContain(`--class-${t}:`);
  });

  it('has one colour for every rarity, of models and contracts alike', () => {
    const css = fs.readFileSync('src/ui/style.css', 'utf8');
    const rule = (cls: string, token: string) =>
      new RegExp(`\\.${cls} \\{\\s+color: var\\(--rarity-${token}\\)`);
    const models = { N: 'common', R: 'uncommon', SR: 'rare', SSR: 'epic', L: 'legendary' };
    for (const [r, token] of Object.entries(models)) {
      expect(css, token).toContain(`--rarity-${token}:`);
      expect(css, r).toMatch(rule(`rarity-${r}`, token));
      expect(css, token).toMatch(rule(`crarity-${token}`, token));
    }
  });

  it('says in its tooltip what it is', () => {
    expect(lineBadgeTip('main')).toEqual(['Main Line', 'Built for Destroyer class trains.']);
    expect(classBadgeTip('frigate')).toEqual([
      'Frigate class',
      'Size 2 of 4. Needs Branch Line or bigger.',
    ]);
    for (const tc of TRAIN_CLASSES) expect(classBadgeTip(tc).join(' ')).not.toContain('undefined');
  });
});
