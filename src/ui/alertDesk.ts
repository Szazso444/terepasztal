import { AlertTracker, type AlertSettings } from '../sim/alerts';
import type { Notice } from '../sim/notices';
import type { GameClock } from '../sim/time';
import type { AlertBar } from './alertBar';
import type { AlertPopup } from './alertPopup';
import { noticeToastKind, noticeToastText } from './alertView';
import type { Toasts } from './toast';

/** Who the desk tells: only what it calls on each. */
export interface AlertDeskParts {
  settings: { alerts: AlertSettings };
  clock: Pick<GameClock, 'setSpeed' | 'time'>;
  toasts: Pick<Toasts, 'push'>;
  bar: Pick<AlertBar, 'update'>;
  popup: Pick<AlertPopup, 'show' | 'pump'>;
  /** a game is running and on screen: not in the editor, under a menu or the loading screen */
  live: () => boolean;
}

/** Hands the notices on, at each refresh: the bar shows them, new ones fire their channels. */
export class AlertDesk {
  private tracker = new AlertTracker();
  constructor(private readonly d: AlertDeskParts) {}

  update(list: readonly Notice[]) {
    const { settings, clock, toasts, bar, popup, live } = this.d;
    bar.update(list, settings.alerts);
    // what comes up behind a menu waits: the menu's resume would undo a pause
    if (!live()) return;
    for (const f of this.tracker.update(list, settings.alerts, clock.time)) {
      if (f.pause) clock.setSpeed(0);
      if (f.toast) toasts.push(noticeToastText(f.notice), noticeToastKind(f.notice.type));
      if (f.popup) popup.show(f.notice);
    }
    popup.pump();
  }
}
