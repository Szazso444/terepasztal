import type { Notice } from '../sim/notices';
import { STR } from '../strings';
import { withAgeIcons } from './ageIcon';
import { el } from './dom';
import type { FootSpec } from './kit';
import type { Screen, ScreenManager } from './modal';

/**
 * The Popup channel: a small message on the screen frame, with Go to when it has somewhere to go.
 * It takes its turn: it waits while another screen or a dialog is up, and one comes after the
 * other. It leaves the build tool in the player's hand.
 */
export class AlertPopup implements Screen {
  readonly id = 'alert-popup';
  readonly frameSize = 'S';
  readonly keepsTool = true;
  title = '';
  readonly root = el('div', { class: 'alert-popup' });
  private queue: Notice[] = [];
  /** the message up */
  private notice: Notice | null = null;

  constructor(
    private readonly screens: ScreenManager,
    /** no dialog is in the way: the name prompt stands above the screens */
    private readonly free: () => boolean,
    /** look at what a notice points to */
    private readonly look: (n: Notice) => void,
  ) {}

  show(n: Notice) {
    this.queue.push(n);
  }

  /** Open the next message if nothing is in its way. */
  pump() {
    if (!this.queue.length || this.screens.current || !this.free()) return;
    const n = this.queue.shift()!;
    this.notice = n;
    this.title = STR.alerts.type[n.type];
    this.root.replaceChildren(el('div', { class: 'alert-popup-text' }, ...withAgeIcons(n.text)));
    this.screens.open(this);
  }

  frameFooter(): FootSpec {
    const n = this.notice;
    const goTo = () => {
      this.screens.close();
      if (n) this.look(n);
    };
    // with no target the frame's own Close is the way out
    return {
      actions: n?.target
        ? [
            { label: STR.alerts.close, onClick: () => this.screens.close() },
            { label: STR.alerts.goTo, onClick: goTo, primary: true },
          ]
        : [],
    };
  }
}
