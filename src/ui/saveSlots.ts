import { STR } from '../strings';
import { ageDef } from '../sim/ages';
import { SAVE_VERSION, type SlotMeta } from '../sim/save';
import { fmtMoney } from './dom';

/**
 * What a list of saves says about one save, as text: the Continue button, the menus' named saves
 * and the settings screen show the same lines. DOM-free, so it is tested under Node.
 */
export interface SlotText {
  /** day, age and money */
  detail: string;
  /**
   * how long ago it was written, null when the file does not say; for the game being played, that
   * it is in progress and when it was last stored
   */
  saved: string | null;
  /** the date and time it was written, for the title of the `saved` line */
  savedAt: string | null;
  /** the file's format when it is not this build's; null when it is */
  format: string | null;
}

/** The name of the age a save reached (`economy.tier`). */
export function ageName(tier: number): string {
  return STR.ages.name[ageDef(tier).id] ?? '';
}

/** Says when a save's format is older or newer than this build's; null when it is the same. */
export function formatNote(version: number): string | null {
  if (version < SAVE_VERSION) return STR.saves.olderFormat(version);
  if (version > SAVE_VERSION) return STR.saves.newerFormat(version);
  return null;
}

/** The lines shown for one save at time `now` (ms, `Date.now()`). */
export function slotText(meta: SlotMeta, now: number): SlotText {
  // a file without a save time reads 0: there is nothing to say about when it was written
  const known = meta.savedAt > 0;
  return {
    detail: STR.saves.detail(meta.day, ageName(meta.age), fmtMoney(meta.money)),
    saved: known ? STR.saves.saved(STR.saves.ago(now - meta.savedAt)) : null,
    savedAt: known ? new Date(meta.savedAt).toLocaleString() : null,
    format: formatNote(meta.version),
  };
}

/**
 * What Continue says when the title screen was opened over a game being played: Continue goes back
 * to that game, so its lines are the game's own now (`meta` describes it like a save, with
 * `savedAt` 0 when it has not been stored), never the older stored save's.
 */
export function liveText(meta: SlotMeta, now: number): SlotText {
  const known = meta.savedAt > 0;
  return {
    detail: STR.saves.detail(meta.day, ageName(meta.age), fmtMoney(meta.money)),
    saved: STR.saves.inProgress(known ? STR.saves.ago(now - meta.savedAt) : null),
    savedAt: known ? new Date(meta.savedAt).toLocaleString() : null,
    // the game in memory has no file; it is written in this build's format
    format: null,
  };
}

/**
 * What Continue goes back to, null when it has nothing to go back to (and is disabled): over a game
 * being played (`overGame`, the title screen opened from the pause menu) that game, described by
 * `live` like a save, whether or not it was ever stored; otherwise the stored game, which is the
 * game under the title screen at boot.
 */
export function continueTargetFor(
  overGame: boolean,
  live: () => SlotMeta,
  stored: () => SlotMeta | null,
): { meta: SlotMeta; live: boolean } | null {
  if (overGame) return { meta: live(), live: true };
  const meta = stored();
  return meta && { meta, live: false };
}

/**
 * What Continue says, from what it goes back to: with `live` the game being played under the title
 * screen, otherwise the stored game. The stored game is the one the minute autosave and the pause
 * menu's Save write, so its time line says `last autosave`; a named save's row (`slotText`) says
 * `saved`. A game never stored, or a file without a save time, has no time to give.
 */
export function continueText(target: { meta: SlotMeta; live: boolean }, now: number): SlotText {
  if (target.live) return liveText(target.meta, now);
  const { meta } = target;
  const t = slotText(meta, now);
  return {
    ...t,
    saved: meta.savedAt > 0 ? STR.saves.lastAutosave(STR.saves.ago(now - meta.savedAt)) : null,
  };
}

/** The autosave line of the settings screen: on or off, and when the game was last stored. */
export function autosaveText(on: boolean, savedAt: number | null, now: number): string {
  return STR.saves.autosaveStatus(on, savedAt ? STR.saves.ago(now - savedAt) : null);
}

/**
 * What an action that replaces or leaves a game may have to ask about. `overwrite` writes over the
 * stored game (New game, Play level, loading a named save, the editor's play test); `leave` only
 * walks away from the game being played (Edit level, New level, Settings' Load last save).
 */
export type Replacement = 'overwrite' | 'leave';

/** What `panels.ts` knows when the player picks such an action. */
export interface ReplaceSituation {
  mode: 'play' | 'editor';
  /** the title screen is up */
  titleShown: boolean;
  /** the title screen was opened from the pause menu, over the game being played */
  titleOverGame: boolean;
  /** the stored game exists and can be read; a damaged file does not count */
  stored: boolean;
}

/**
 * Is a game being played: in play mode, under the pause menu or under a title screen opened over
 * it. Not at the title screen at boot (the game under it is the stored one or a world not yet
 * played) and not in the editor.
 */
export function gameBeingPlayed(s: ReplaceSituation): boolean {
  return s.mode === 'play' && (!s.titleShown || s.titleOverGame);
}

/**
 * Does the action ask first. An `overwrite` asks when a game is being played or a stored game
 * exists, and stays quiet only when neither is (first start, nothing played). A `leave` loses only
 * the game being played, so it asks exactly when one is.
 */
export function asksBeforeReplacing(kind: Replacement, s: ReplaceSituation): boolean {
  return kind === 'overwrite' ? gameBeingPlayed(s) || s.stored : gameBeingPlayed(s);
}

/**
 * The question before New game, Play level, Edit level or New level, null when it asks nothing.
 * Only a stored game is called saved: over a game never stored the question says it is in progress.
 */
export function replaceQuestion(kind: Replacement, s: ReplaceSituation): string | null {
  if (!asksBeforeReplacing(kind, s)) return null;
  if (kind === 'leave') return STR.menu.confirmLeaveGame;
  return gameBeingPlayed(s) ? STR.menu.confirmReplaceGame(s.stored) : STR.menu.confirmReplace;
}

/**
 * The question before loading the named save `name`, null when it asks nothing. Over a game being
 * played its unsaved progress is lost; otherwise it is the stored game that is replaced.
 */
export function loadQuestion(name: string, s: ReplaceSituation): string | null {
  if (!asksBeforeReplacing('overwrite', s)) return null;
  return gameBeingPlayed(s) ? STR.menu.confirmLoad(name) : STR.menu.confirmLoadStored(name);
}

// ------------------------------------------------------------------ the Saved games screen

/** The longest name a save has (`writeSlot` cuts a longer one). */
export const SLOT_NAME_MAX = 32;

/** The name a save is stored under: trimmed, at most `SLOT_NAME_MAX` characters (`writeSlot`'s own). */
export function slotNameOf(text: string): string {
  return text.trim().slice(0, SLOT_NAME_MAX).trimEnd();
}

/**
 * The Save tab's name field: what is typed (`null`: nothing yet, so the default offered, as
 * "Day N · seed"), the name it is stored under, whether there is a name to save and whether it
 * replaces a save of that name.
 */
export interface SaveNameState {
  /** what the field shows */
  shown: string;
  /** the name the save is stored under */
  name: string;
  canSave: boolean;
  /** a named save of that name exists: saving replaces it (and asks first) */
  clash: boolean;
}

export function saveNameState(
  typed: string | null,
  fallback: string,
  existing: readonly string[],
): SaveNameState {
  const shown = typed ?? fallback;
  const name = slotNameOf(shown);
  return { shown, name, canSave: name.length > 0, clash: existing.includes(name) };
}

/** What loading a save does where it is picked: it replaces the game in play, the stored game, or nothing. */
export type LoadEffect = 'game' | 'stored' | 'none';

export function loadEffect(s: ReplaceSituation): LoadEffect {
  if (!asksBeforeReplacing('overwrite', s)) return 'none';
  return gameBeingPlayed(s) ? 'game' : 'stored';
}

/** Saving needs a game being played: at the title at boot there is none. */
export function canSaveHere(s: ReplaceSituation): boolean {
  return gameBeingPlayed(s);
}

/** The tabs of Saved games: Save is off, with its reason, where there is no game to save. */
export interface SavedTab {
  id: 'save' | 'load';
  label: string;
  /** the count of named saves, on the Load tab */
  count: number | null;
  off: string | null;
}

export function savedGamesTabs(canSave: boolean, named: number): SavedTab[] {
  return [
    {
      id: 'save',
      label: STR.savedGames.save,
      count: null,
      off: canSave ? null : STR.savedGames.saveOff,
    },
    { id: 'load', label: STR.savedGames.load, count: named, off: null },
  ];
}

/**
 * What a replacement is about to lose, for the tip of the button that starts it: the game being
 * played, the stored game, or nothing (`null`: it asks nothing).
 */
export type ReplaceEffect = 'game' | 'stored';

export function replaceEffect(kind: Replacement, s: ReplaceSituation): ReplaceEffect | null {
  if (!asksBeforeReplacing(kind, s)) return null;
  return gameBeingPlayed(s) ? 'game' : 'stored';
}
