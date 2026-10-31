import { describe, expect, it, vi } from 'vitest';
import { Game } from '../game';
import { defaultAlertSettings } from '../sim/alerts';
import type { Notice } from '../sim/notices';
import { STR } from '../strings';
import type { SaveGame } from '../sim/save';

// the age and the upgrade play sounds; the context that plays them is a browser's
vi.mock('./audio', async (original) => ({
  ...(await original<typeof import('./audio')>()),
  sfx: vi.fn(),
  audio: { setAge: vi.fn() },
}));

/**
 * The notices `src/game.ts` pushes itself, on a stand-in that has the prototype and only the fields
 * these methods read (a `Game` cannot be constructed under Node; gameSave.test.ts does the same).
 */
function standIn(more: Record<string, unknown> = {}) {
  const toasts: string[] = [];
  const pushed: Notice[] = [];
  const host: Record<string, unknown> = Object.create(Game.prototype);
  Object.assign(host, {
    mode: 'play',
    settings: { alerts: defaultAlertSettings() },
    clock: { time: 12.5 },
    toasts: { push: (t: string) => toasts.push(t) },
    notices: { list: [] as Notice[], push: (n: Notice) => pushed.push(n) },
    ui: { toolbar: { refresh() {} } },
    halos: { spawn() {} },
    ...more,
  });
  const call = (name: string, ...args: unknown[]) =>
    (host[name] as (...a: unknown[]) => unknown)(...args);
  return { game: host, call, toasts, pushed };
}

describe('the notices the game pushes', () => {
  it('a save from another version is a note, its short line kept for the Toast channel', () => {
    const g = standIn();
    g.call('warnDeprecated', { loadedFrom: 1, migrationNotes: [] } as Partial<SaveGame>);
    expect(g.toasts).toEqual([]);
    expect(g.pushed.map((n) => [n.key, n.type])).toEqual([['save:deprecated', 'note']]);
    expect(g.pushed[0].toast).toBe(STR.settings.olderToast(1));
  });

  it('content a save lost is a note, and no toast of its own', () => {
    const g = standIn();
    g.call('warnPruned', { dropped: [{ id: 'x', count: 1 }], money: 0, tickets: 0 });
    expect(g.toasts).toEqual([]);
    expect(g.pushed.map((n) => [n.key, n.type])).toEqual([['save:pruned', 'note']]);
  });

  it('a new age is the goal row, and its toast comes through that row', () => {
    const g = standIn();
    g.call('onAgeUp', 1);
    expect(g.toasts).toEqual([]);
    expect(g.pushed).toEqual([
      expect.objectContaining({ key: 'age:1', type: 'goal', text: STR.hud.ageUp(1), target: null }),
    ]);
  });

  it('a finished upgrade keeps its own toast and leads to what was upgraded', () => {
    const g = standIn();
    const e = { kind: 'station', name: 'Halt', level: 2, x: 3, y: 4, w: 1, h: 1 };
    g.call('onUpgraded', e);
    const text = STR.upgrade.done('Halt', 2);
    expect(g.toasts).toEqual([text]);
    expect(g.pushed).toEqual([
      expect.objectContaining({
        type: 'note',
        text,
        toast: null,
        target: { kind: 'tile', x: 3, y: 4 },
      }),
    ]);
  });

  describe('a train arriving', () => {
    const train = { id: 7, name: 'Rocket' };
    const station = { name: 'Halt' };

    it('is no notice while its row is off, as it starts', () => {
      const g = standIn();
      g.call('noteArrival', train, station);
      expect(g.pushed).toEqual([]);
    });

    it('is one for each arrival with any cell of its row on', () => {
      const alerts = defaultAlertSettings();
      alerts.channels.arrived.toast = true;
      const g = standIn({ settings: { alerts } });
      g.call('noteArrival', train, station);
      expect(g.pushed).toEqual([
        expect.objectContaining({
          key: 'arrived:7:12.5',
          type: 'arrived',
          text: STR.notice.arrived('Rocket', 'Halt'),
          target: { kind: 'train', id: 7 },
        }),
      ]);
    });
  });
});

describe('the Map pin cells', () => {
  const list = [
    { key: 'a', type: 'nofuel' },
    { key: 'b', type: 'slow' },
  ] as Notice[];

  it('let through the rows that have a pin', () => {
    const g = standIn({ notices: { list } });
    expect(g.call('pinnedNotices')).toEqual([list[0]]);
  });

  it('follow a row turned off or on', () => {
    const alerts = defaultAlertSettings();
    alerts.channels.nofuel.pin = false;
    alerts.channels.slow.pin = true;
    const g = standIn({ notices: { list }, settings: { alerts } });
    expect(g.call('pinnedNotices')).toEqual([list[1]]);
  });
});

describe('looking at a notice (focusNotice)', () => {
  const at: Notice = {
    key: 'a',
    kind: 'bad',
    type: 'noroute',
    text: 'a',
    target: { kind: 'tile', x: 3, y: 4 },
  };

  it('goes there in the field view', () => {
    const returnToRts = vi.fn();
    const g = standIn({ viewTarget: 0, returnToRts });
    g.call('focusNotice', at);
    expect(returnToRts.mock.calls).toEqual([[3, 4]]);
    expect(g.game.overviewFocus).toBeUndefined();
  });

  it('pans the overview and stays in it, the camera following for the way out', () => {
    const returnToRts = vi.fn();
    const centerCamera = vi.fn();
    const g = standIn({ viewTarget: 1, returnToRts, centerCamera });
    g.call('focusNotice', at);
    expect(returnToRts).not.toHaveBeenCalled();
    expect(g.game.overviewFocus).toEqual({ x: 3, y: 4 });
    expect(centerCamera).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a notice with no target', () => {
    const returnToRts = vi.fn();
    const g = standIn({ viewTarget: 0, returnToRts });
    g.call('focusNotice', { ...at, target: null });
    expect(returnToRts).not.toHaveBeenCalled();
  });
});
