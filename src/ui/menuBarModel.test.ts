import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KEYMAP, type KeyAction } from './keymap';
import {
  MENU_BAR,
  MenuBarState,
  PICK_GRACE_MS,
  entriesFor,
  type MenuAction,
  type MenuId,
  type MenuMode,
} from './menuBarModel';

const ids = (mode: MenuMode) => entriesFor(mode).map((e) => e.id);
const items = (mode: MenuMode, id: MenuId) =>
  entriesFor(mode)
    .find((e) => e.id === id)
    ?.items.map((i) => i.action);
/** Every action a player can reach in a mode: the rows, and the entries that do one thing. */
const reachable = (mode: MenuMode) =>
  entriesFor(mode).flatMap((e) => [...(e.run ? [e.run] : []), ...e.items.map((i) => i.action)]);

/** Compile-time: a new action fails here until it is listed, and the test then wants it on the bar. */
const EVERY_ACTION: Record<MenuAction, true> = {
  pause: true,
  save: true,
  savedGames: true,
  settings: true,
  quit: true,
  depot: true,
  roster: true,
  signals: true,
  contracts: true,
  market: true,
  crafting: true,
  cheat: true,
  overview: true,
  weather: true,
  dayNight: true,
  advisor: true,
  notifications: true,
};

describe('the menu bar in a game', () => {
  it('reads Menu, Game, Fleet, Economy, View, Notifications', () => {
    expect(ids('play')).toEqual(['menu', 'game', 'fleet', 'economy', 'view', 'notifications']);
  });

  it('holds what each menu holds, in order', () => {
    expect(items('play', 'game')).toEqual(['save', 'savedGames', 'settings', 'quit']);
    expect(items('play', 'fleet')).toEqual(['depot', 'roster', 'signals']);
    expect(items('play', 'economy')).toEqual(['contracts', 'market', 'crafting', 'cheat']);
    expect(items('play', 'view')).toEqual(['overview', 'weather', 'dayNight', 'advisor']);
  });

  it('keeps every button the top bar had', () => {
    const old: MenuAction[] = [
      // the screen buttons
      'depot',
      'contracts',
      'crafting',
      'roster',
      'market',
      'cheat',
      'settings',
      // the right of the bar
      'advisor',
      'signals',
      // the toggles
      'weather',
      'dayNight',
      // the Menu button, and the alert bar's screen
      'pause',
      'notifications',
    ];
    expect(reachable('play')).toEqual(expect.arrayContaining(old));
  });

  it('reaches every action exactly once', () => {
    expect(reachable('play').sort()).toEqual(Object.keys(EVERY_ACTION).sort());
  });

  it('opens the pause menu and the Notifications screen from the bar itself, with no pane', () => {
    const direct = MENU_BAR.filter((e) => e.run);
    expect(direct.map((e) => [e.id, e.run, e.items.length])).toEqual([
      ['menu', 'pause', 0],
      ['notifications', 'notifications', 0],
    ]);
  });

  it('names the key of the Menu entry in its tooltip', () => {
    expect(MENU_BAR[0].tip).toBe('Menu · Esc');
  });

  it('says what the toggles do, and counts the advisor', () => {
    const rows = entriesFor('play').flatMap((e) => e.items);
    const row = (a: MenuAction) => rows.find((i) => i.action === a);
    expect(row('weather')?.hint).toBeTruthy();
    expect(row('dayNight')?.hint).toBeTruthy();
    expect(rows.filter((i) => i.badge).map((i) => i.action)).toEqual(['advisor']);
  });
});

describe('the keys the rows show', () => {
  /** The keymap action a row with a key stands for: it names its key, and it does the same. */
  const SAME: Partial<Record<MenuAction, KeyAction>> = {
    depot: 'depot',
    roster: 'roster',
    contracts: 'contracts',
    market: 'market',
    crafting: 'crafting',
    overview: 'overview',
  };
  const shown = MENU_BAR.flatMap((e) => e.items).filter((i) => i.key);

  it('are the keys the game binds, in the field view and in the overview', () => {
    expect(shown.map((i) => i.action).sort()).toEqual(Object.keys(SAME).sort());
    for (const i of shown)
      for (const context of ['play', 'overview'] as const) {
        const b = KEYMAP.find((k) => k.context === context && k.code === `Key${i.key}`);
        expect(b?.action, `${i.action} ${context}`).toBe(SAME[i.action]);
      }
  });

  it('name every screen and view a letter key opens', () => {
    const actions = Object.values(SAME);
    const letters = KEYMAP.filter((b) => b.context === 'play' && actions.includes(b.action));
    expect(letters.map((b) => b.code.slice('Key'.length)).sort()).toEqual(
      shown.map((i) => i.key).sort(),
    );
  });
});

describe('the menu bar in the level editor', () => {
  it('leaves out what the editor has closed, and a menu left empty with it', () => {
    expect(ids('editor')).toEqual(['menu', 'game', 'fleet', 'view']);
    expect(items('editor', 'game')).toEqual(['quit']);
    expect(items('editor', 'fleet')).toEqual(['signals']);
    expect(items('editor', 'view')).toEqual(['overview', 'weather', 'dayNight', 'advisor']);
  });

  it('hides exactly the screens and saves the editor has no use for', () => {
    const editor = new Set(reachable('editor'));
    const gone = reachable('play').filter((a) => !editor.has(a));
    expect(gone.sort()).toEqual(
      [
        'cheat',
        'contracts',
        'crafting',
        'depot',
        'market',
        'notifications',
        'roster',
        'save',
        'savedGames',
        'settings',
      ].sort(),
    );
  });
});

describe('opening and closing a menu', () => {
  const opened = (id: MenuId) => {
    const s = new MenuBarState();
    s.click(id);
    return s;
  };

  it('starts closed', () => {
    const s = new MenuBarState();
    expect(s.open).toBeNull();
    expect(s.items).toEqual([]);
  });

  it('opens on a click and shows the rows of that menu', () => {
    const s = new MenuBarState();
    expect(s.click('game')).toBeNull();
    expect(s.open).toBe('game');
    expect(s.items.map((i) => i.action)).toEqual(['save', 'savedGames', 'settings', 'quit']);
  });

  it('closes on a second click on its entry', () => {
    const s = opened('fleet');
    expect(s.click('fleet')).toBeNull();
    expect(s.open).toBeNull();
  });

  it('closes when the pointer comes to another entry and clicks it, as on a native bar', () => {
    const s = opened('fleet');
    s.hover('view');
    expect(s.click('view')).toBeNull();
    expect(s.open).toBeNull();
  });

  it('closes when told to: a click elsewhere, Escape, a screen opening', () => {
    const s = opened('view');
    expect(s.close()).toBe(true);
    expect(s.open).toBeNull();
    expect(s.close()).toBe(false);
  });

  it('closes when a row is picked, and hands back what to run', () => {
    const s = opened('economy');
    expect(s.pick('market', 0)).toBe('market');
    expect(s.open).toBeNull();
  });

  it('runs nothing for a row the open menu does not have', () => {
    const s = opened('economy');
    expect(s.pick('depot', 0)).toBeNull();
    expect(s.open).toBeNull();
    expect(new MenuBarState().pick('depot', 0)).toBeNull();
  });

  it('does what an entry with no menu does, closing the open menu', () => {
    for (const [id, run] of [
      ['menu', 'pause'],
      ['notifications', 'notifications'],
    ] as const) {
      const s = opened('game');
      expect(s.click(id)).toBe(run);
      expect(s.open).toBeNull();
      expect(new MenuBarState().click(id)).toBe(run);
    }
  });

  it('switches on hover only with a menu open', () => {
    const closed = new MenuBarState();
    expect(closed.hover('fleet')).toBe(false);
    expect(closed.open).toBeNull();

    const s = opened('game');
    expect(s.hover('fleet')).toBe(true);
    expect(s.open).toBe('fleet');
    expect(s.hover('fleet')).toBe(false);
  });

  it('leaves the open menu alone over an entry with no menu', () => {
    const s = opened('view');
    expect(s.hover('notifications')).toBe(false);
    expect(s.hover('menu')).toBe(false);
    expect(s.open).toBe('view');
  });
});

describe('the rules in the level editor', () => {
  const editor = () => {
    const s = new MenuBarState();
    s.setMode('editor');
    return s;
  };

  it('opens only the menus it has, by click or by hover', () => {
    const s = editor();
    expect(s.click('economy')).toBeNull();
    expect(s.open).toBeNull();
    s.click('game');
    expect(s.hover('economy')).toBe(false);
    expect(s.open).toBe('game');
  });

  it('does not run the Notifications entry it hides', () => {
    expect(editor().click('notifications')).toBeNull();
  });

  it('shows the rows of the mode, and picks only those', () => {
    const s = editor();
    s.click('fleet');
    expect(s.items.map((i) => i.action)).toEqual(['signals']);
    expect(s.pick('depot', 0)).toBeNull();
  });

  it('closes a menu when the mode changes', () => {
    const s = new MenuBarState();
    s.click('economy');
    s.setMode('editor');
    expect(s.open).toBeNull();
  });
});

describe('what a press on the map does', () => {
  const [LEFT, MIDDLE, RIGHT] = [0, 1, 2];
  const opened = () => {
    const s = new MenuBarState();
    s.click('view');
    return s;
  };
  const picked = (at: number) => {
    const s = opened();
    s.pick('weather', at);
    return s;
  };

  it('keeps a left press from the map while a menu is open', () => {
    expect(opened().keepsPress(LEFT, 0)).toBe(true);
  });

  it('lets the right and middle buttons act as usual, with a menu open or just after a pick', () => {
    for (const button of [MIDDLE, RIGHT]) {
      expect(opened().keepsPress(button, 0), `open ${button}`).toBe(false);
      expect(picked(1000).keepsPress(button, 1000), `picked ${button}`).toBe(false);
    }
  });

  it('leaves the map its presses with no menu open and none picked', () => {
    expect(new MenuBarState().keepsPress(LEFT, 0)).toBe(false);
  });

  it('keeps the second press of a double-click on a row, for the grace and no longer', () => {
    expect(picked(1000).keepsPress(LEFT, 1000)).toBe(true);
    expect(picked(1000).keepsPress(LEFT, 1000 + PICK_GRACE_MS - 1)).toBe(true);
    expect(picked(1000).keepsPress(LEFT, 1000 + PICK_GRACE_MS)).toBe(false);
  });

  it('starts no grace from a pick that ran nothing', () => {
    const s = opened();
    s.pick('depot', 1000);
    expect(s.keepsPress(LEFT, 1000)).toBe(false);
  });
});

describe('where the pane stands', () => {
  const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  /** The `z-index` of a selector: the last of its own rules that sets one, as the last one wins. */
  const z = (selector: string) => {
    const set = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => m[1].split(',').some((s) => s.trim() === selector))
      .map((m) => /z-index:\s*(\d+)/.exec(m[2]))
      .filter((m) => m !== null);
    return Number(set[set.length - 1]?.[1]);
  };

  it('is over every panel of the HUD and under the menus and the modal screens', () => {
    const pane = z('#menu-pane');
    expect(pane).toBeGreaterThan(0);
    for (const hud of ['#advisor', '#alert-bar', '#outliner', '#train-panel'])
      expect(pane, hud).toBeGreaterThan(z(hud));
    for (const over of ['.menu-root', '#modal-root']) expect(pane, over).toBeLessThan(z(over));
  });

  it('is a child of the UI root, where the input sees the pointer over it', () => {
    const panels = readFileSync(new URL('./panels.ts', import.meta.url), 'utf8');
    expect(panels).toMatch(/d\.uiRoot\.append\([^;]*hud\.menuBar\.pane,/);
  });
});
