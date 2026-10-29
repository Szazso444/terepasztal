import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { CLASS_LINE, TRAIN_CLASSES } from '../sim/compat';
import { TRACK_CLASSES } from '../world/track';
import { badgeLook, badgeSvg, classBadgeTitle, lineBadgeTitle } from './lineBadge';

const bars = (svg: string) => (svg.match(/<rect /g) ?? []).length - 1;

describe('track line badges', () => {
  it('gives the standard lines one to three bars and the separate networks an icon', () => {
    expect(badgeLook('branch')).toMatchObject({ bars: 1, icon: null });
    expect(badgeLook('main')).toMatchObject({ bars: 2, icon: null });
    expect(badgeLook('trunk')).toMatchObject({ bars: 3, icon: null });
    expect(badgeLook('narrow')).toMatchObject({ bars: 0, icon: 'rails' });
    expect(badgeLook('maglev')).toMatchObject({ bars: 0, icon: 'wave' });
    expect(badgeLook('hyperloop')).toMatchObject({ bars: 0, icon: 'ring' });
    for (const line of ['branch', 'main', 'trunk'] as const)
      expect(bars(badgeSvg(badgeLook(line))), line).toBe(badgeLook(line).bars);
  });

  it('marks the Carrier with the atom on the Trunk Line badge', () => {
    const svg = badgeSvg(badgeLook(CLASS_LINE.carrier, true));
    expect(bars(svg)).toBe(3);
    expect(svg).toContain('<ellipse');
    expect(badgeSvg(badgeLook('trunk'))).not.toContain('<ellipse');
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
