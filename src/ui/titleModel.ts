import { STR } from '../strings';
import type { IconName } from './kit';

/** What the title screen's stack is made of: pure, so it is tested under Node. */
export type TitleId =
  | 'continue'
  | 'newGame'
  | 'saved'
  | 'levels'
  | 'settings'
  | 'controls'
  | 'tuning'
  | 'content'
  | 'credits';

export interface TitleEntry {
  id: TitleId;
  label: string;
  icon: IconName;
  /** a count at the button's far end */
  count?: number;
  /** a small word after the label: the content editor holds a custom table */
  mark?: string;
  /** why it cannot be pressed; it is off with this as its tip */
  off?: string;
  tip?: string;
  /** the screen's forward action: the accent */
  primary?: boolean;
}

export interface TitleState {
  /** there is a game to continue: the one in play under the title, or the stored one */
  canContinue: boolean;
  /** the title was opened over the game being played */
  overGame: boolean;
  /** the named saves */
  named: number;
  levels: number;
  /** the content editor holds a stored edit */
  contentModified: boolean;
}

/** The buttons, top to bottom. Continue is first and the accent; with nothing to go back to it is off. */
export function titleEntries(s: TitleState): TitleEntry[] {
  const cont: TitleEntry = {
    id: 'continue',
    label: STR.menu.continue,
    icon: 'play',
    primary: true,
    ...(s.canContinue
      ? { tip: s.overGame ? STR.menu.continueLive : STR.menu.continueStored }
      : { off: STR.menu.continueNone }),
  };
  return [
    cont,
    { id: 'newGame', label: STR.menu.newGame, icon: 'plus', tip: STR.menu.newGameHint },
    {
      id: 'saved',
      label: STR.menu.savedGames,
      icon: 'folder',
      count: s.named,
      tip: STR.menu.savedGamesHint,
    },
    {
      id: 'levels',
      label: STR.menu.levels,
      icon: 'mountain',
      count: s.levels,
      tip: STR.menu.levelsHint,
    },
    { id: 'settings', label: STR.topbar.settings, icon: 'gear' },
    { id: 'controls', label: STR.menu.controls, icon: 'keys', tip: STR.menu.controlsHint },
    { id: 'tuning', label: STR.menu.tuning, icon: 'slider' },
    {
      id: 'content',
      label: STR.menu.content,
      icon: 'list',
      ...(s.contentModified ? { mark: STR.menu.modified } : {}),
    },
    { id: 'credits', label: STR.menu.credits, icon: 'scroll' },
  ];
}
