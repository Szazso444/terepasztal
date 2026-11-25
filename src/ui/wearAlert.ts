import { STR } from '../strings';
import { el } from './dom';
import type { FootSpec } from './kit';
import type { Screen, ScreenManager } from './modal';

/**
 * The window of the first piece of track to wear out (spec section 5): what happened and what
 * traffic does now, with the two ways to mend it. The game stops behind it (`Game` pauses and
 * pans to the piece); closing it, by any way out, tells `onDismiss`, which resumes.
 */
export class WearAlertScreen implements Screen {
  readonly id = 'wear-alert';
  readonly frameSize = 'S';
  readonly keepsTool = true;
  readonly title = STR.wear.title;
  readonly root = el(
    'div',
    { class: 'alert-popup' },
    el('div', { class: 'alert-popup-text', text: STR.wear.what }),
    el('div', { class: 'alert-popup-text', text: STR.wear.traffic }),
    el('div', { class: 'alert-popup-text dim', text: STR.wear.help }),
  );
  /** the Repair button: pick the Repair tool (wired by the game) */
  onRepair: (() => void) | null = null;
  /** the Depot button: open the depot, on the maintenance wagon */
  onDepot: ((x: number, y: number) => void) | null = null;
  /** the window left the screen, by a button, Close, Esc or another screen */
  onDismiss: (() => void) | null = null;
  /** the piece that failed */
  private at = { x: 0, y: 0 };

  constructor(private readonly screens: ScreenManager) {}

  /** Open the window for the piece at (x, y). */
  show(x: number, y: number) {
    this.at = { x, y };
    this.screens.open(this);
  }
  /** Leave the window and pick the Repair tool. */
  repair() {
    this.screens.close();
    this.onRepair?.();
  }
  /** Leave the window and open the depot. */
  depot() {
    this.screens.close();
    this.onDepot?.(this.at.x, this.at.y);
  }
  onClose() {
    this.onDismiss?.();
  }

  frameFooter(): FootSpec {
    return {
      actions: [
        { label: STR.wear.depot, title: STR.wear.depotHint, onClick: () => this.depot() },
        {
          label: STR.wear.repair,
          title: STR.wear.repairHint,
          onClick: () => this.repair(),
          primary: true,
        },
      ],
    };
  }
}
