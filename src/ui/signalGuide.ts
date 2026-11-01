import { el } from './dom';
import { STR } from '../strings';
import { choiceRows, note, page, well, type FootSpec } from './kit';
import type { Screen } from './modal';
import { signalHint } from './ruleText';
import type { Settings } from '../sim/save';
import { SIGNAL_LEVELS, type SignalLevel } from '../sim/signals';

/**
 * Fleet > Signals: the signalling level at the head, then the semaphore guide, how signals and
 * track blocks work, as a screen in the frame, so Esc, the × and Done close it and a letter key
 * does not reach the game behind it.
 */
export class SignalGuideScreen implements Screen {
  readonly id = 'signals';
  readonly title = STR.signals.guideTitle;
  readonly frameSize = 'M';
  readonly icon = 'semaphore';
  /** it is read, not used on the map: the tool in hand stays in hand while it is up */
  readonly keepsTool = true;
  /** the levels are controls, as they were in Settings: Tab goes round them */
  readonly formKeys = true;
  readonly root = page();

  constructor(
    private readonly settings: Settings,
    private readonly onChange: () => void,
  ) {}

  /** Drawn as it opens: the level may have been changed since, by a load of settings. */
  onOpen() {
    const S = STR.signals;
    this.root.replaceChildren(
      well(
        STR.settings.signalling,
        choiceRows({
          options: SIGNAL_LEVELS.map((lv) => ({
            id: lv,
            label: STR.settings.signalLevel[lv],
            hint: signalHint(lv),
          })),
          value: this.settings.signalling ?? 'auto',
          onChange: (id) => {
            this.settings.signalling = id as SignalLevel;
            this.onChange();
          },
        }),
        note(STR.settings.signallingNote),
      ),
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
