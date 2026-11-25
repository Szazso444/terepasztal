import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { TRAIN_CLASSES } from '../sim/compat';
import { TRACK_CLASSES } from '../world/track';
import { starsOf } from './labels';
import {
  CLASS_ICON,
  ENGINES,
  LINE_ICON,
  classBadgeSvg,
  classBadgeTip,
  engineLength,
  engineReach,
  lineBadgeSvg,
  lineBadgeTip,
  linesOf,
} from './lineBadge';

const filledPips = (svg: string) => svg.match(/class="pip on"/g)?.length ?? 0;
const allPips = (svg: string) => svg.match(/class="pip/g)?.length ?? 0;

describe('track line labels', () => {
  it('draws every line differently, at one size', () => {
    const icons = TRACK_CLASSES.map(lineBadgeSvg);
    expect(new Set(icons).size).toBe(icons.length);
    for (const svg of icons)
      expect(svg).toContain(`width="${LINE_ICON.w}" height="${LINE_ICON.h}"`);
  });

  it('gives a line as many sleepers as its class has driving wheels, one more each step', () => {
    const ties = (svg: string) => svg.match(/class="tie"/g)?.length ?? 0;
    const lines = ['narrow', 'branch', 'main', 'trunk'] as const;
    const classes = ['corvette', 'frigate', 'destroyer', 'cruiser'] as const;
    expect(lines.map((l) => ties(lineBadgeSvg(l)))).toEqual([2, 3, 4, 5]);
    expect(classes.map((tc) => ENGINES[tc].drivers[2])).toEqual([2, 3, 4, 5]);
    expect(ties(lineBadgeSvg('maglev'))).toBe(0);
    expect(ties(lineBadgeSvg('hyperloop'))).toBe(0);
  });

  it('has the colours of every line in the stylesheet', () => {
    const css = fs.readFileSync('src/ui/style.css', 'utf8');
    for (const line of TRACK_CLASSES) {
      expect(css, line).toContain(`--line-${line}:`);
      expect(css, line).toContain(`--line-${line}-sleeper:`);
      expect(css, line).toContain(`--line-${line}-rail:`);
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

  it('draws the Carrier as the Cruiser', () => {
    expect(classBadgeSvg('carrier')).toBe(classBadgeSvg('cruiser'));
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

  it('gives each rarity one more star, of models and contracts alike', () => {
    expect(['N', 'R', 'SR', 'SSR', 'L'].map(starsOf)).toEqual(['★', '★★', '★★★', '★★★★', '★★★★★']);
    expect(['common', 'uncommon', 'rare', 'epic', 'legendary'].map(starsOf)).toEqual(
      ['N', 'R', 'SR', 'SSR', 'L'].map(starsOf),
    );
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
