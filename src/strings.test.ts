import { describe, it, expect } from 'vitest';
import { STR } from './strings';
import { RULE_META } from './sim/rules';
import { runsOn } from './sim/compat';
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
