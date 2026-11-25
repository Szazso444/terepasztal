import {
  ALERT_CHANNELS,
  ALERT_DEFS,
  ALERT_SEVERITIES,
  ALERT_TYPES,
  defaultAlertSettings,
  type AlertSeverity,
  type AlertSettings,
} from '../sim/alerts';
import { STR } from '../strings';
import { el } from './dom';
import { formRow, gridCell, toggleSwitch, well, type FootSpec } from './kit';
import type { Screen, ScreenManager } from './modal';

/** The mark of a severity: its colour comes from `.sev-<severity>`. */
const MARK: Record<AlertSeverity, string> = {
  critical: '!',
  problem: '!',
  attention: '?',
  info: 'i',
};

function mark(s: AlertSeverity): HTMLElement {
  return el('i', { class: `u-sv sev-${s}`, text: MARK[s] });
}

/**
 * What each kind of alert does: one row for each and a column for each channel, then the two
 * switches. Every change is stored at once. Opened from Settings it stands on it and goes back.
 */
export class NotificationsScreen implements Screen {
  readonly id = 'notifications';
  readonly title = STR.alerts.title;
  readonly frameSize = 'M';
  readonly formKeys = true;
  readonly root = el('div', { class: 'k-page' });
  private first: HTMLElement | null = null;

  constructor(
    private readonly settings: { alerts: AlertSettings },
    private readonly screens: ScreenManager,
    /** store the settings */
    private readonly save: () => void,
  ) {}

  /** Open it, over `from` or, with null, on its own. */
  openFrom(from: Screen | null) {
    if (from) this.screens.push(this);
    else this.screens.open(this);
  }
  onOpen() {
    this.render();
    // on the first cell, for the keys to start from
    this.first?.focus();
  }
  frameFooter(): FootSpec {
    return {
      actions: [
        {
          label: STR.alerts.defaults,
          title: STR.alerts.defaultsHint,
          onClick: () => {
            this.settings.alerts = defaultAlertSettings();
            this.save();
            this.render();
          },
        },
      ],
      done: true,
    };
  }

  private matrix(): HTMLElement {
    const legend = el(
      'span',
      { class: 'u-sevs' },
      ...ALERT_SEVERITIES.map((s) => el('span', {}, mark(s), STR.alerts.severity[s])),
    );
    const head = el(
      'div',
      { class: 'nt-r nt-h' },
      el('span'),
      ...ALERT_CHANNELS.map((c) => el('b', { text: STR.alerts.channel[c] })),
    );
    const rows = ALERT_TYPES.map((type) => {
      const name = STR.alerts.type[type];
      return el(
        'div',
        { class: 'nt-r' },
        el('span', {}, mark(ALERT_DEFS[type].severity), name),
        ...ALERT_CHANNELS.map((c) =>
          el(
            'b',
            {},
            gridCell(
              `${name} · ${STR.alerts.channel[c]}`,
              () => this.settings.alerts.channels[type][c],
              (v) => {
                this.settings.alerts.channels[type][c] = v;
                this.save();
              },
            ),
          ),
        ),
      );
    });
    return well(
      { title: STR.alerts.matrix, right: legend },
      el('div', { class: 'nt-grid' }, head, ...rows),
    );
  }

  private switchRow(label: string, key: 'criticalPause' | 'group'): HTMLElement {
    return formRow(
      label,
      toggleSwitch(
        label,
        () => this.settings.alerts[key],
        (v) => {
          this.settings.alerts[key] = v;
          this.save();
        },
      ),
    );
  }

  private render() {
    this.root.replaceChildren(
      this.matrix(),
      well(
        null,
        this.switchRow(STR.alerts.criticalPause, 'criticalPause'),
        this.switchRow(STR.alerts.group, 'group'),
      ),
    );
    this.first = this.root.querySelector('.k-cell');
  }
}
