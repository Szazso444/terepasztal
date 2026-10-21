import { STR } from '../strings';
import { GROUND_KEY, SAVE_KEY, SLOTS_KEY, type FreezeReport, type SaveRefusal } from '../sim/save';
import type { BuiltMap } from '../world/chunks';
import type { SaveOutcome } from './saveRefusal';

/**
 * What the game says about the writes it makes on its own and the saves it finds at start-up: the
 * end of a load, a chunk purchase and the start-up pass. Each decision is a function of what
 * happened (the ground a load built, the outcome of a write, the start-up pass's report), so a
 * headless test can ask it; `Game` and `main.ts` only make the writes and show what it answers.
 */

/** A toast to show (`Toasts.push`). */
export interface Toast {
  text: string;
  kind: 'info' | 'warn' | 'good';
}

/** A warning kept in the notices list for `ttl` seconds (`Notices.push`, with no target). */
export interface WarnNotice {
  key: string;
  text: string;
  ttl: number;
}

/** What to show: the toasts in order, and the notices. */
export interface Said {
  toasts: Toast[];
  notices: WarnNotice[];
}

/**
 * What became of a write the game made on its own: the outcome of the write (`SaveOutcome`), or
 * `held` when nothing was written now (a reload into a stored save, a loop error).
 */
export type ImplicitWrite = SaveOutcome['kind'] | 'held';

// ------------------------------------------------------------------ the end of a load

/**
 * What building a generated world's map from its stored ground did (`groundOf`): the keys of the
 * chunks it generated, and of those whose stored text it could not read. Null for a level, which
 * keeps no ground.
 */
export type GroundReport = Pick<BuiltMap, 'added' | 'unreadable'> | null;

/** How long the notice about stored ground that could not be read stays, in seconds. */
export const UNREADABLE_NOTICE_TTL = 180;

/**
 * Whether the end of a load stores the game: when the load generated ground (a save from before
 * saves kept their ground, land the map grew), so that ground is kept from now on. Ground stored
 * but unreadable is not generated in this sense: its text is kept as it was, never replaced.
 */
export function loadStoresGround(ground: GroundReport): boolean {
  return (ground?.added.length ?? 0) > 0;
}

/**
 * What the end of a load says about the ground of its map. `write` is what became of the write
 * `loadStoresGround` asked for, or null when it asked for none.
 *
 * Stored ground that could not be read is one warning with the number of chunks, as a toast and
 * as a notice. A write that did not store the game is one warning, worded for the ground, whatever
 * stopped it (storage, a broken number, nothing written now): that ground is stored with the next
 * save that goes through. It stands in for the autosave's warning, which tells of progress not
 * kept, and none has been made since the load; so the write feeds no autosave latch, and the first
 * autosave refused after it still warns with its own text.
 */
export function groundAfterLoad(ground: GroundReport, write: ImplicitWrite | null): Said {
  const said: Said = { toasts: [], notices: [] };
  const unreadable = ground?.unreadable.length ?? 0;
  if (unreadable > 0) {
    const text = STR.saves.groundUnreadable(unreadable);
    said.toasts.push({ text, kind: 'warn' });
    said.notices.push({ key: 'save:ground', text, ttl: UNREADABLE_NOTICE_TTL });
  }
  if (write !== null && write !== 'stored')
    said.toasts.push({ text: STR.saves.groundUnsaved, kind: 'warn' });
  return said;
}

// ------------------------------------------------------------------ a chunk purchase

/** What a purchase finds once its chunk is owned and paid for. */
export interface PurchaseFacts {
  /**
   * the world is generated and an owned chunk now touches its grid's edge where another ring of
   * chunks fits (`ownsBorderChunk`): the map grows
   */
  edge: boolean;
  /** the game may store itself now (`AutosavePause`: no loop error since the page loaded) */
  implicitWrites: boolean;
  /** the autosave stores the game now: it is on, and a game is being played */
  autosaves: boolean;
}

/**
 * Whether the purchase grows the map: on the edge, unless a loop error holds the write growing
 * makes first. Growing stores the grown game and reloads into it.
 */
export function purchaseGrows(f: PurchaseFacts): boolean {
  return f.edge && f.implicitWrites;
}

/** What a purchase does and says once growing has been tried or not. */
export interface AfterPurchase {
  said: Said;
  /** the grown game is stored: the page reloads into it */
  reload: boolean;
  /** store the game as the autosave stores (`Game.save(true)`, with every refusal of it) */
  store: boolean;
}

/**
 * What a purchase does and says after `purchaseGrows`: `grown` is whether the grown game was
 * stored, or null when growing was not tried.
 *
 * - Stored: the map is growing, and the page reloads into the grown game, which holds the purchase.
 * - Otherwise the chunk is bought. A refused growth write says first that the map did not grow
 *   (`growRefused`); growth held by a loop error says after it that the map grows once the player
 *   saves and reloads (`growHeld`).
 * - An inner purchase is stored at once, as the autosave stores and where it would. A purchase on
 *   the edge is not: its growth write was refused or held, and a second write would meet the same.
 */
export function afterPurchase(f: PurchaseFacts, grown: boolean | null): AfterPurchase {
  if (grown === true)
    return {
      said: { toasts: [{ text: STR.overview.growing, kind: 'info' }], notices: [] },
      reload: true,
      store: false,
    };
  const toasts: Toast[] = [];
  if (grown === false) toasts.push({ text: STR.overview.growRefused, kind: 'warn' });
  toasts.push({ text: STR.overview.bought, kind: 'good' });
  if (f.edge && !f.implicitWrites) toasts.push({ text: STR.overview.growHeld, kind: 'warn' });
  return { said: { toasts, notices: [] }, reload: false, store: !f.edge && f.autosaves };
}

// ------------------------------------------------------------------ start-up

/**
 * Whether the start-up pass (`freezeStoredSaves`) has work to do, read from storage without
 * parsing a save: the pass has not run (`GROUND_KEY`) and a game is stored, as the one Continue
 * loads or among the named ones. False when storage cannot be read, as the pass then does nothing.
 * A yes may still find every stored save with its ground; a no never misses one the pass would
 * give its ground to.
 */
export function groundPassPending(): boolean {
  try {
    return (
      localStorage.getItem(GROUND_KEY) === null &&
      (localStorage.getItem(SAVE_KEY) !== null || localStorage.getItem(SLOTS_KEY) !== null)
    );
  } catch {
    return false;
  }
}

/**
 * What start-up says. `frozen` is the start-up pass's report (`freezeStoredSaves`); `refused` is
 * why the stored game Continue loads was refused, or null when it loaded, there is none, or
 * start-up did not read it (a new game, a level, the editor, a dev reload).
 *
 * Saves the pass could not store with their ground are counted in one warning. A stored game
 * refused for the size of its map is named, since the menu opens without it; another refusal says
 * nothing here.
 */
export function startupToasts(
  frozen: Pick<FreezeReport, 'refused'>,
  refused: SaveRefusal | null,
): Toast[] {
  const toasts: Toast[] = [];
  if (frozen.refused > 0)
    toasts.push({ text: STR.saves.groundRefused(frozen.refused), kind: 'warn' });
  if (refused === 'tooLarge') toasts.push({ text: STR.saves.refused.tooLarge, kind: 'warn' });
  return toasts;
}
