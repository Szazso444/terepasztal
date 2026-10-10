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

/** The autosave line of the settings screen: on or off, and when the game was last stored. */
export function autosaveText(on: boolean, savedAt: number | null, now: number): string {
  return STR.saves.autosaveStatus(on, savedAt ? STR.saves.ago(now - savedAt) : null);
}
