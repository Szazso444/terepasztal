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
  // the first look only learns what stands; the quiet after a load is over before the test starts
  d.update([]);
  clock.time = 1000;
  parts.bar.update.mockClear();
  return { ...parts, d, clock, toasts };
}

describe('a save loaded with something already wrong', () => {
  /** A desk just after a load, its first look still to come. */
  function loaded() {
    const clock = new GameClock();
    clock.time = 5000;
    clock.setSpeed(2);
    const toasts: string[] = [];
    const popup = { show: vi.fn(), pump: vi.fn() };
    const bar = { update: vi.fn() };
    const d = new AlertDesk({
      settings: { alerts: defaultAlertSettings() },
      clock,
      toasts: { push: (t: string) => void toasts.push(t) },
      bar,
      popup,
      live: () => true,
    });
    return { d, clock, toasts, popup, bar };
  }

  it('does not pause for a train out of fuel that stood at the load', () => {
    const { d, clock } = loaded();
    const list = [notice('t1:fuel', 'nofuel')];
    d.update(list);
    clock.time += 1;
    d.update(list);
    expect(clock.speedIndex).toBe(2);
  });

  it('does not pause for a stuck train the traffic finds again 30 s in', () => {
    const { d, clock, toasts, popup, bar } = loaded();
    d.update([]);
    clock.time += 30;
    const list = [notice('t7:stuck', 'stuck')];
    for (let i = 0; i < 10; i++) {
      d.update(list);
      clock.time += 10;
    }
    expect(clock.speedIndex).toBe(2);
    expect(toasts).toEqual([]);
    expect(popup.show).not.toHaveBeenCalled();
    // the bar shows it all the same, and the pins read the same list
    expect(bar.update).toHaveBeenLastCalledWith(list, expect.anything());
  });

  it('pauses for what goes wrong after the first 60 s', () => {
    const { d, clock } = loaded();
    d.update([]);
    clock.time += 61;
    d.update([notice('t7:stuck', 'stuck')]);
    expect(clock.speedIndex).toBe(0);
  });

  it('still shows the warning the load pushed, in the colour of a warning', () => {
    const { d, toasts } = loaded();
    d.update([notice('save:ground', 'note', { expires: 100 })]);
    expect(toasts).toEqual(['says save:ground']);
  });
});

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

  it('does not pause again and again for a train that flickers in and out of stuck', () => {
    const { d, clock } = desk();
    clock.setSpeed(1);
    const list = [notice('t1:stuck', 'stuck')];
    d.update(list);
    expect(clock.speedIndex).toBe(0);
    clock.togglePause();
    for (let i = 0; i < 10; i++) {
      clock.time += 20;
      d.update([]);
      clock.time += 20;
      d.update(list);
      expect(clock.speedIndex, `flicker ${i}`).toBe(1);
    }
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
    // the stuck train and the failed contract
    expect(toasts).toHaveLength(2);
  });
});
