import { el } from './dom';
import { STR } from '../strings';
import { note, page, well, type FootSpec } from './kit';
import type { Screen } from './modal';

/**
 * The semaphore guide: how signals and track blocks work, as a screen in the frame, so Esc, the ×
 * and Done close it and a letter key does not reach the game behind it.
 */
export class SignalGuideScreen implements Screen {
  readonly id = 'signals';
  readonly title = STR.signals.guideTitle;
  readonly frameSize = 'M';
  readonly icon = 'scroll';
  readonly root = page();

  constructor() {
    const S = STR.signals;
    this.root.append(
      well(
        null,
        note(S.guidePlace, 'k-guide'),
        el('pre', { class: 'signal-diagram', text: S.guideDiagram }),
        note(S.guideAspects, 'k-guide'),
        note(S.guideFence, 'k-guide'),
        note(S.guideJunction, 'k-guide'),
        note(S.guideSingleLine, 'k-guide'),
      ),
    );
  }

  frameFooter(): FootSpec {
    return { done: true };
  }
}
