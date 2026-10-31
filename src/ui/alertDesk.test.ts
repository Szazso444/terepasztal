import { describe, expect, it, vi } from 'vitest';
import { GameClock } from '../sim/time';
import { defaultAlertSettings } from '../sim/alerts';
import type { AlertType } from '../sim/alerts';
import type { Notice } from '../sim/notices';
import { STR } from '../strings';
import { AlertDesk } from './alertDesk';

function notice(key: string, type: AlertType, more: Partial<Notice> = {}): Notice {
  return { key, kind: 'bad', type, text: `says ${key}`, target: null, ...more };
}

function desk(live = () => true) {
  const clock = new GameClock();
  const toasts: [string, string | undefined][] = [];
  const parts = {
    settings: { alerts: defaultAlertSettings() },
    clock,
    toasts: { push: (t: string, k?: string) => void toasts.push([t, k]) },
    bar: { update: vi.fn() },
    popup: { show: vi.fn(), pump: vi.fn() },
    live,
  };
  const d = new AlertDesk(parts as never);
  // the first look only learns what stands
  d.update([]);
  parts.bar.update.mockClear();
  return { ...parts, d, clock, toasts };
}

describe('AlertDesk', () => {
  it('stops the clock for a new critical alert, and a resume stays resumed', () => {
    const { d, clock } = desk();
    clock.setSpeed(2);
    const list = [notice('t1:stuck', 'stuck')];
    d.update(list);
    expect(clock.speedIndex).toBe(0);
    clock.togglePause();
    expect(clock.speedIndex).toBe(2);
    d.update(list);
    expect(clock.speedIndex).toBe(2);
  });

  it('toasts in the words the notice brought, in the colour of its type', () => {
    const { d, toasts } = desk();
    d.update([notice('c', 'ctfail', { toast: 'fined' }), notice('d', 'done')]);
    expect(toasts).toEqual([
      ['fined', 'warn'],
      ['says d', 'good'],
    ]);
  });

  it('asks for a popup for a goal, which also pauses', () => {
    const { d, popup, clock } = desk();
    const goal = notice('age:1', 'goal', { text: STR.hud.ageUp(1) });
    d.update([goal]);
    expect(popup.show.mock.calls).toEqual([[goal]]);
    expect(popup.pump).toHaveBeenCalled();
    expect(clock.speedIndex).toBe(0);
  });

  it('keeps the bar up to date every time, whatever fires', () => {
    const { d, bar, settings } = desk();
    const list = [notice('a', 'jam')];
    d.update(list);
    d.update(list);
    expect(bar.update.mock.calls).toEqual([
      [list, settings.alerts],
      [list, settings.alerts],
    ]);
  });

  it('holds everything back behind a menu and fires it after', () => {
    let open = false;
    const { d, clock, toasts, bar } = desk(() => !open);
    open = true;
    clock.setSpeed(2);
    const list = [notice('t1:stuck', 'stuck'), notice('c', 'ctfail')];
    d.update(list);
    expect(clock.speedIndex).toBe(2);
    expect(toasts).toEqual([]);
    expect(bar.update).toHaveBeenCalledTimes(1);
    open = false;
    d.update(list);
    expect(clock.speedIndex).toBe(0);
    expect(toasts).toHaveLength(1);
  });
});
