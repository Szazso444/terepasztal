import { describe, it, expect, beforeEach, vi } from 'vitest';
import { STR } from '../strings';
import { levelLocked, type PlacementCheck } from '../sim/build';
import { LAST_AGE } from '../sim/ages';
import { MAX_LEVEL } from '../sim/levels';
import { rules, DEFAULT_RULES } from '../sim/rules';
import { fmtCost } from '../sim/stockpile';
import { UPGRADE_HOURS, hoursLeft, startWork, workProgress } from '../sim/upgrade';
import { upgradeHours, upgradeView } from './upgradeView';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
});

const cost = { wood: 60, stone: 40 };
const ok: PlacementCheck = { ok: true, cost };

describe('what an upgrade shows in a panel', () => {
  it('takes its time from the upgrade table, and none when it is instant', () => {
    for (let to = 2; to <= MAX_LEVEL; to++) {
      expect(upgradeHours(to, false)).toBeCloseTo(UPGRADE_HOURS[to - 2]);
      expect(upgradeHours(to, true)).toBe(0);
    }
    rules.upgradeTimeMul = 0.5;
    expect(upgradeHours(3, false)).toBeCloseTo(UPGRADE_HOURS[1] / 2);
    rules.upgradeTimeMul = 0;
    expect(upgradeHours(3, false)).toBe(0);
  });

  it('puts the next level, the cost and the time on a button that can be pressed', () => {
    const v = upgradeView({ check: ok, level: 2, instant: false });
    expect(v).toEqual({
      kind: 'button',
      label: STR.upgrade.button(3, fmtCost(cost), upgradeHours(3, false)),
      enabled: true,
      title: '',
    });
  });

  it('leaves the time out for a depot, the editor and upgrades the rules make instant', () => {
    const instant = STR.upgrade.button(3, fmtCost(cost), 0);
    expect(upgradeView({ check: ok, level: 2, instant: true })).toMatchObject({ label: instant });
    expect(upgradeView({ check: ok, level: 2, instant: false }).label).not.toBe(instant);
    rules.upgradeTimeMul = 0;
    expect(upgradeView({ check: ok, level: 2, instant: false })).toMatchObject({ label: instant });
  });

  it('turns the button off and names the age that opens every level an age keeps shut', () => {
    let seen = 0;
    for (let first = 0; first <= LAST_AGE; first++)
      for (let age = 0; age <= LAST_AGE; age++)
        for (let level = 1; level < MAX_LEVEL; level++) {
          const reason = levelLocked(first, level + 1, age);
          if (!reason) continue;
          const v = upgradeView({ check: { ok: false, cost, reason }, level, instant: false });
          if (reason === STR.station.maxed) {
            expect(v).toEqual({ kind: 'top', label: reason });
            continue;
          }
          seen++;
          // the hover still says what it will cost and take once the age comes
          const full = STR.upgrade.button(level + 1, fmtCost(cost), upgradeHours(level + 1, false));
          expect(v).toEqual({ kind: 'button', label: reason, enabled: false, title: full });
        }
    expect(seen).toBeGreaterThan(0);
  });

  it('keeps the cost and time on a button the player cannot pay for, with the reason as its hover', () => {
    const reason = STR.build.needResources('20 wood');
    const v = upgradeView({ check: { ok: false, cost, reason }, level: 2, instant: false });
    expect(v).toEqual({
      kind: 'button',
      label: STR.upgrade.button(3, fmtCost(cost), upgradeHours(3, false)),
      enabled: false,
      title: reason,
    });
  });

  it('shows the top level as a line, not a button', () => {
    for (const reason of [STR.station.maxed, STR.house.maxed])
      expect(
        upgradeView({ check: { ok: false, cost: {}, reason }, level: MAX_LEVEL, instant: false }),
      ).toEqual({ kind: 'top', label: reason });
  });

  it('shows a work under way with the level it brings, its time left and how far it has come', () => {
    const w = startWork(3)!;
    const busy: PlacementCheck = { ok: false, cost: {}, reason: STR.build.upgradingNow };
    for (const share of [0, 0.25, 0.5, 0.99]) {
      w.left = w.total * (1 - share);
      const v = upgradeView({ check: busy, level: 2, work: w, instant: false });
      expect(v).toEqual({
        kind: 'work',
        label: STR.upgrade.running(3, hoursLeft(w)),
        progress: workProgress(w),
      });
      if (v.kind === 'work') expect(v.progress).toBeCloseTo(share);
    }
  });
});
