import type { SupplyMode } from './sim/supply';

/**
 * Boot intents. Menus store what the next page load should do (start a new map, play or edit a
 * level, continue) and reload; `main.ts` consumes the intent once.
 */
export type Intent =
  | { action: 'continue' }
  | { action: 'menu' }
  | { action: 'new'; seed: number; supply?: SupplyMode }
  | { action: 'play'; levelId: string; testing?: boolean }
  | { action: 'edit'; levelId: string | null; seed?: number; blank?: boolean; size?: number };

export const INTENT_KEY = 'terepasztal.intent';
export const TESTING_KEY = 'terepasztal.testing';

export function takeIntent(): Intent | null {
  try {
    const raw = sessionStorage.getItem(INTENT_KEY);
    sessionStorage.removeItem(INTENT_KEY);
    return raw ? (JSON.parse(raw) as Intent) : null;
  } catch {
    return null;
  }
}
export function setIntentAndReload(i: Intent) {
  try {
    sessionStorage.setItem(INTENT_KEY, JSON.stringify(i));
  } catch {
    /* ignore */
  }
  location.hash = '';
  location.reload();
}
/** Level id currently being play-tested from the editor, if any. */
export function testingLevel(): string | null {
  try {
    return sessionStorage.getItem(TESTING_KEY);
  } catch {
    return null;
  }
}
export function setTestingLevel(id: string | null) {
  try {
    if (id) sessionStorage.setItem(TESTING_KEY, id);
    else sessionStorage.removeItem(TESTING_KEY);
  } catch {
    /* ignore */
  }
}
