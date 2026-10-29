import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { TRAIN_CLASSES } from '../sim/compat';
import { TRACK_CLASSES } from '../world/track';
import {
  ENGINES,
  LINE_LETTER,
  classBadgeSvg,
  classBadgeTitle,
  lineBadgeSvg,
  lineBadgeTitle,
} from './lineBadge';

const letterOf = (svg: string) => svg.match(/<text[^>]*>([^<]*)<\/text>/)?.[1];
/** How far an engine reaches, tender to buffer beam. */
const length = (e: (typeof ENGINES)[keyof typeof ENGINES]) =>
  Math.max(e.boiler[1], e.pony ?? 0) - (e.tender?.[0] ?? e.cab[0]);

describe('track line badges', () => {
  it('marks every line with its own letter', () => {
    const letters = TRACK_CLASSES.map((l) => LINE_LETTER[l]);
    expect(new Set(letters).size).toBe(letters.length);
    expect(letterOf(lineBadgeSvg('narrow'))).toBe('N');
    expect(letterOf(lineBadgeSvg('branch'))).toBe('B');
    expect(letterOf(lineBadgeSvg('main'))).toBe('M');
    expect(letterOf(lineBadgeSvg('trunk'))).toBe('T');
  });

  it("puts the letter of the line a class needs on the class's badge", () => {
    expect(letterOf(classBadgeSvg('corvette'))).toBe('N');
    expect(letterOf(classBadgeSvg('frigate'))).toBe('B');
    expect(letterOf(classBadgeSvg('destroyer'))).toBe('M');
    expect(letterOf(classBadgeSvg('cruiser'))).toBe('T');
    expect(letterOf(classBadgeSvg('carrier'))).toBe('T');
  });

  it('draws a bigger engine for each bigger class', () => {
    const order = ['corvette', 'frigate', 'destroyer', 'cruiser'] as const;
    for (let i = 1; i < order.length; i++) {
      const [a, b] = [ENGINES[order[i - 1]], ENGINES[order[i]]];
      expect(length(b), order[i]).toBeGreaterThan(length(a));
      expect(b.drivers[2], order[i]).toBeGreaterThanOrEqual(a.drivers[2]);
    }
    expect(length(ENGINES.cruiser)).toBeLessThanOrEqual(29);
  });

  it('marks the Carrier with the atom', () => {
    expect(classBadgeSvg('carrier').match(/rotate/g)).toHaveLength(3);
    expect(classBadgeSvg('cruiser')).not.toContain('rotate');
  });

  it('has a colour and an ink for every line in the stylesheet', () => {
    const css = fs.readFileSync('src/ui/style.css', 'utf8');
    for (const line of TRACK_CLASSES) {
      expect(css, line).toContain(`--line-${line}:`);
      expect(css, line).toContain(`--line-${line}-ink:`);
    }
  });

  it('names the line and the class in its tooltip', () => {
    expect(lineBadgeTitle('main')).toBe('Main Line: built for Destroyer class trains');
    expect(classBadgeTitle('frigate')).toBe('Frigate class: needs Branch Line or bigger');
    for (const tc of TRAIN_CLASSES) expect(classBadgeTitle(tc)).not.toContain('undefined');
  });
});
