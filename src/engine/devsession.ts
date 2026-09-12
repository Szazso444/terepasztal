/**
 * Dev-only session carry-over.
 *
 * Vite full-reloads the page on every source change, which throws away the world you were
 * looking at: a one-line tweak to a train rule costs a new game, a map, some track and a few
 * minutes. This snapshots the running game just before the reload and puts it back afterwards,
 * so a code change lands where you were standing.
 *
 * The snapshot lives in `sessionStorage` under its own key, so the player's real save in
 * `localStorage` is never touched and closing the tab ends the dev session. Everything is
 * stripped from production builds by the `import.meta.env.DEV` guards.
 */
import { migrate, SAVE_MIN_VERSION, type SaveGame } from '../sim/save';

const KEY = 'terepasztal.dev-reload';

/** Send bounded diagnostic snapshots over Vite's existing local connection. */
export function reportDevTraffic(take: () => unknown) {
  if (!import.meta.env.DEV || !import.meta.hot) return;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return;
  const id = crypto.randomUUID();
  const timer = window.setInterval(() => {
    import.meta.hot?.send('traffic:report', { id, report: take() });
  }, 2000);
  import.meta.hot.dispose(() => window.clearInterval(timer));
}

/**
 * Snapshot the game whenever Vite is about to reload the page. `take` returns the save to carry
 * over, or null when there is nothing worth carrying (the menu, the level editor). No-op outside
 * the dev server.
 */
export function armDevReload(take: () => SaveGame | null) {
  if (!import.meta.env.DEV || !import.meta.hot) return;
  import.meta.hot.on('vite:beforeFullReload', () => {
    try {
      const save = take();
      if (save) sessionStorage.setItem(KEY, JSON.stringify(save));
    } catch {
      // A save too large for sessionStorage, or a game mid-teardown: fall back to a cold boot.
      try {
        sessionStorage.removeItem(KEY);
      } catch {
        /* nothing left to do */
      }
    }
  });
}

/**
 * The save left by the last dev reload, if any. Reading it clears it, so it is used once.
 *
 * It goes through the migration chain like any other save: the edit that caused the reload may
 * have been a save format change, and this snapshot was written by the code from before it.
 */
export function takeDevSession(): SaveGame | null {
  if (!import.meta.env.DEV) return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const save = JSON.parse(raw) as SaveGame;
    if (!save || typeof save.seed !== 'number') return null;
    if (typeof save.version !== 'number') save.version = SAVE_MIN_VERSION;
    return migrate(save);
  } catch {
    return null;
  }
}
