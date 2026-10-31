import { describe, expect, it, vi } from 'vitest';
import { STR } from '../strings';
import { ScreenStack } from './modal';

// the frame's buttons play a sound when clicked; the context that plays it is a browser's
vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

/** A screen that writes its life down. */
function screen(id: string, log: string[]) {
  return {
    id,
    onOpen: () => log.push(`open ${id}`),
    onClose: () => log.push(`close ${id}`),
  };
}

function setup() {
  const log: string[] = [];
  const stack = new ScreenStack<ReturnType<typeof screen>>({
    show: (s) => log.push(`show ${s?.id ?? 'none'}`),
    changed: (s) => log.push(`changed ${s?.id ?? 'none'}`),
  });
  return {
    log,
    stack,
    settings: screen('settings', log),
    notifications: screen('notifications', log),
    depot: screen('depot', log),
  };
}

describe('the screen stack', () => {
  it('opens one screen at a time: the next takes its place', () => {
    const { stack, settings, depot, log } = setup();
    stack.open(settings);
    stack.open(depot);
    expect(stack.current).toBe(depot);
    expect(stack.depth).toBe(1);
    expect(log).toEqual([
      'show settings',
      'open settings',
      'changed settings',
      'close settings',
      'show depot',
      'open depot',
      'changed depot',
    ]);
  });

  it('puts a screen up before its onOpen, for it to take the focus', () => {
    const { stack, settings, log } = setup();
    stack.open(settings);
    expect(log.indexOf('show settings')).toBeLessThan(log.indexOf('open settings'));
  });

  it('does nothing when the screen on top is opened again', () => {
    const { stack, settings, log } = setup();
    stack.open(settings);
    log.length = 0;
    stack.open(settings);
    stack.push(settings);
    expect(log).toEqual([]);
  });

  it('stacks a pushed screen, and Back returns to the one under it', () => {
    const { stack, settings, notifications, log } = setup();
    stack.open(settings);
    stack.push(notifications);
    expect(stack.current).toBe(notifications);
    expect(stack.depth).toBe(2);
    log.length = 0;
    stack.back();
    expect(stack.current).toBe(settings);
    expect(stack.depth).toBe(1);
    expect(log).toEqual(['close notifications', 'show settings', 'changed settings']);
  });

  it('keeps the screen under another open: no onClose for it, no onOpen on the return', () => {
    const { stack, settings, notifications, log } = setup();
    stack.open(settings);
    stack.push(notifications);
    stack.back();
    expect(log.filter((l) => l === 'close settings')).toEqual([]);
    expect(log.filter((l) => l === 'open settings')).toHaveLength(1);
  });

  it('pairs every onOpen with one onClose, whichever way the screens leave', () => {
    const { stack, settings, notifications, depot, log } = setup();
    stack.open(settings);
    stack.push(notifications);
    stack.open(depot);
    stack.push(settings);
    stack.close();
    for (const id of ['settings', 'notifications', 'depot'])
      expect(log.filter((l) => l === `open ${id}`).length, id).toBe(
        log.filter((l) => l === `close ${id}`).length,
      );
  });

  it('Back on the last screen leaves none, and Back on none does nothing', () => {
    const { stack, settings, log } = setup();
    stack.open(settings);
    stack.back();
    expect(stack.current).toBeNull();
    log.length = 0;
    stack.back();
    stack.close();
    expect(log).toEqual([]);
  });

  it('closes every screen from the top down, and says so once', () => {
    const { stack, settings, notifications, log } = setup();
    stack.open(settings);
    stack.push(notifications);
    log.length = 0;
    stack.close();
    expect(stack.current).toBeNull();
    expect(log).toEqual(['close notifications', 'close settings', 'show none', 'changed none']);
  });

  it('pushes on nothing like opening', () => {
    const { stack, settings } = setup();
    stack.push(settings);
    expect(stack.current).toBe(settings);
    expect(stack.depth).toBe(1);
  });

  it('opening over a stack replaces all of it', () => {
    const { stack, settings, notifications, depot } = setup();
    stack.open(settings);
    stack.push(notifications);
    stack.open(depot);
    expect(stack.depth).toBe(1);
    stack.back();
    expect(stack.current).toBeNull();
  });

  it('goes back to a screen already in the stack, not on top of itself', () => {
    const { stack, settings, notifications, log } = setup();
    stack.open(settings);
    stack.push(notifications);
    log.length = 0;
    stack.push(settings);
    expect(stack.depth).toBe(1);
    expect(stack.current).toBe(settings);
    expect(log).toEqual(['close notifications', 'show settings', 'changed settings']);
  });

  it('opening one deep in the stack leaves it alone on top, open all along', () => {
    const { stack, settings, notifications, log } = setup();
    stack.open(settings);
    stack.push(notifications);
    log.length = 0;
    stack.open(settings);
    expect(stack.depth).toBe(1);
    expect(log).toEqual(['close notifications', 'show settings', 'changed settings']);
  });

  it('the same hotkey closes the top screen and only that', () => {
    const { stack, settings, notifications } = setup();
    stack.toggle(settings);
    expect(stack.current).toBe(settings);
    stack.push(notifications);
    stack.toggle(notifications);
    expect(stack.current).toBe(settings);
    stack.toggle(settings);
    expect(stack.current).toBeNull();
  });

  it('another hotkey over a stack takes the place of everything up', () => {
    const { stack, settings, notifications, depot } = setup();
    stack.open(settings);
    stack.push(notifications);
    stack.toggle(depot);
    expect(stack.current).toBe(depot);
    expect(stack.depth).toBe(1);
  });
});

describe('the naming rules', () => {
  it("a screen's title equals its menu label", () => {
    expect(STR.depot.title).toBe(STR.topbar.depot);
    expect(STR.contracts.title).toBe(STR.topbar.contracts);
    expect(STR.craft.title).toBe(STR.topbar.craft);
    expect(STR.roster.title).toBe(STR.topbar.roster);
    expect(STR.market.title).toBe(STR.topbar.market);
    expect(STR.settings.title).toBe(STR.topbar.settings);
    expect(STR.tuning.title).toBe(STR.menu.tuning);
    expect(STR.content.title).toBe(STR.menu.content);
  });
});
