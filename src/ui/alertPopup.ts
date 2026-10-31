import type { Notice } from '../sim/notices';
import { STR } from '../strings';
import { withAgeIcons } from './ageIcon';
import { btn, el } from './dom';
import type { Screen, ScreenManager } from './modal';

/**
 * The Popup channel: a small message on the screen frame, with Go to when it has somewhere to go.
 * It takes its turn: it waits while another screen or a dialog is up, and one comes after the
 * other. It leaves the build tool in the player's hand.
 */
export class AlertPopup implements Screen {
  readonly id = 'alert-popup';
  readonly frameSize = 'small';
  readonly keepsTool = true;
  title = '';
  readonly root = el('div', { class: 'alert-popup' });
  private queue: Notice[] = [];

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
    this.title = STR.alerts.type[n.type];
    const goTo = () => {
      this.screens.close();
      this.look(n);
    };
    this.root.replaceChildren(
      el('div', { class: 'alert-popup-text' }, ...withAgeIcons(n.text)),
      el(
        'div',
        { class: 'nt-foot' },
        n.target ? btn(STR.alerts.goTo, goTo, 'accent') : null,
        btn(STR.alerts.close, () => this.screens.close()),
      ),
    );
    this.screens.open(this);
  }
}
