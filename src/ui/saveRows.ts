import { withAgeIcons } from './ageIcon';
import { el } from './dom';
import { actionButton, emptyState, listRow } from './kit';
import { STR } from '../strings';
import type { SlotMeta } from '../sim/save';
import type { NamePrompt } from './namePrompt';
import { slotText, type SlotText } from './saveSlots';

/** Shared by the screens that list named saves: load and delete. */
export interface SlotActions {
  slots(): SlotMeta[];
  loadSlot(name: string): void;
  deleteSlot(name: string): void;
}

/** The game's own dialog, which the menus and the screens ask their questions in. */
export type Confirm = Pick<NamePrompt, 'confirm'>;

/**
 * A line whose words change with the clock ("saved 2 h ago") is handed here, with what it says
 * now: the screen puts the new words in the line it has, so nothing is built again.
 */
export type Track = (line: HTMLElement, text: () => string) => void;

/**
 * What one save holds and when it was written, one `cls` line each: day, age and money; how long
 * ago, with the date and time as its title; the format, when it is not this build's.
 */
export function slotLines(meta: SlotMeta, now: number, cls = 'sub', track?: Track): HTMLElement[] {
  return textLines(slotText(meta, now), cls, track && ((t) => track(t, () => lineOf(meta))));
}

/** The time line of a save, as it reads now. */
const lineOf = (meta: SlotMeta) => slotText(meta, Date.now()).saved ?? '';

/** One `cls` line each of what `slotText` or `continueText` says, the date as the time line's title. */
export function textLines(
  t: SlotText,
  cls: string,
  tracked?: (timeLine: HTMLElement) => void,
): HTMLElement[] {
  const lines = [el('div', { class: cls }, ...withAgeIcons(t.detail))];
  if (t.saved) {
    const time = el('div', { class: cls, text: t.saved, title: t.savedAt ?? '' });
    tracked?.(time);
    lines.push(time);
  }
  if (t.format) lines.push(el('div', { class: cls, text: t.format }));
  return lines;
}

/** Delete a named save once the player says yes in the game's dialog. */
export function confirmDeleteSlot(
  prompt: Confirm,
  actions: Pick<SlotActions, 'deleteSlot'>,
  meta: SlotMeta,
  onDeleted: () => void,
) {
  const { detail, saved } = slotText(meta, Date.now());
  void prompt
    .confirm(STR.saves.deleteTitle, STR.settings.confirmDelete(meta.name), {
      yes: STR.prompt.delete,
      danger: true,
      detail: saved ? `${detail} · ${saved}` : detail,
    })
    .then((ok) => {
      if (!ok) return;
      actions.deleteSlot(meta.name);
      onDeleted();
    });
}

export interface SlotRowOptions {
  /** the Load button's tooltip: what a load does here */
  loadTitle?: string;
  /** a click on the row, instead of Load and Delete buttons: the row is picked */
  pick?: { on: (name: string) => boolean; onPick: (name: string) => void };
  track?: Track;
}

/**
 * The named saves as kit rows in the order `slots()` gives them (newest first): the Saved games
 * screen's and the Saves tab's one list. `empty` says there are none.
 */
export function slotRows(
  actions: SlotActions,
  prompt: Confirm,
  onDeleted: () => void,
  empty: string,
  o: SlotRowOptions = {},
): HTMLElement[] {
  const slots = actions.slots();
  if (!slots.length) return [emptyState({ icon: 'folder', text: empty })];
  const now = Date.now();
  return slots.map((sl) =>
    listRow({
      title: sl.name,
      sub: [el('span', {}, ...slotLines(sl, now, 'k-sub', o.track))],
      on: o.pick?.on(sl.name),
      onClick: o.pick && (() => o.pick?.onPick(sl.name)),
      right: o.pick
        ? undefined
        : [
            actionButton(STR.settings.loadSlot, () => actions.loadSlot(sl.name), {
              cls: 'small',
              icon: 'folder',
              title: o.loadTitle,
            }),
            actionButton(
              STR.settings.deleteSlot,
              () => confirmDeleteSlot(prompt, actions, sl, onDeleted),
              { cls: 'small danger', title: STR.savedGames.deleteHint },
            ),
          ],
    }),
  );
}
