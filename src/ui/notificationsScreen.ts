import { sfx } from '../engine/audio';
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
import { btn, el } from './dom';
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

/** A cell or a switch: it shows `get()`, and a click turns it over. */
function flip(
  cls: string,
  role: string,
  label: string,
  get: () => boolean,
  set: (v: boolean) => void,
): HTMLElement {
  const e = el('button', { type: 'button', class: cls, role, title: label, 'aria-label': label });
  const show = () => {
    e.classList.toggle('on', get());
    e.setAttribute('aria-checked', String(get()));
  };
  e.addEventListener('click', (ev) => {
    ev.stopPropagation();
    sfx('ui.click');
    set(!get());
    show();
  });
  show();
  return e;
}

/**
 * What each kind of alert does: one row for each and a column for each channel, then the two
 * switches. Every change is stored at once. Opened over another screen, it goes back to it.
 */
export class NotificationsScreen implements Screen {
  readonly id = 'notifications';
  readonly title = STR.alerts.title;
  readonly frameSize = 'medium';
  readonly root = el('div', { class: 'nt-screen' });
  /** the screen it was opened from, which Back returns to */
  private from: Screen | null = null;
  private first: HTMLElement | null = null;

  constructor(
    private readonly settings: { alerts: AlertSettings },
    private readonly screens: ScreenManager,
    /** store the settings */
    private readonly save: () => void,
  ) {
    this.root.addEventListener('keydown', (e) => this.onKey(e));
  }

  /**
   * The keys that work the buttons stay here: the game takes Tab and Space for itself. Tab goes
   * round the buttons of this screen, and Escape carries on to the game, which closes it.
   */
  private onKey(e: KeyboardEvent) {
    if (e.code !== 'Tab' && e.code !== 'Space' && e.code !== 'Enter') return;
    e.stopPropagation();
    if (e.code !== 'Tab') return;
    e.preventDefault();
    const all = [...this.root.querySelectorAll('button')];
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(at + (e.shiftKey ? all.length - 1 : 1)) % all.length].focus();
  }

  /** Open it, from `from` or, with null, on its own. */
  openFrom(from: Screen | null) {
    this.from = from;
    this.screens.open(this);
  }
  onOpen() {
    this.render();
    // on the first cell, for the keys to start from
    this.first?.focus();
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
            flip(
              'k-cell',
              'checkbox',
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
    return el(
      'div',
      { class: 'nt-well' },
      el('div', { class: 'nt-head' }, el('span', { text: STR.alerts.matrix }), legend),
      el('div', { class: 'nt-grid' }, head, ...rows),
    );
  }

  private switchRow(label: string, key: 'criticalPause' | 'group'): HTMLElement {
    return el(
      'div',
      { class: 'nt-opt' },
      el('span', { text: label }),
      flip(
        'k-sw',
        'switch',
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
    const defaults = btn(STR.alerts.defaults, () => {
      this.settings.alerts = defaultAlertSettings();
      this.save();
      this.render();
    });
    defaults.title = STR.alerts.defaultsHint;
    const { from } = this;
    const leave = from
      ? btn(STR.alerts.back, () => this.screens.open(from))
      : btn(STR.alerts.done, () => this.screens.close(), 'accent');
    this.root.replaceChildren(
      this.matrix(),
      el(
        'div',
        { class: 'nt-well nt-opts' },
        this.switchRow(STR.alerts.criticalPause, 'criticalPause'),
        this.switchRow(STR.alerts.group, 'group'),
      ),
      // the one Back rule: Back stands on the left, Done on the right
      from
        ? el('div', { class: 'nt-foot left' }, leave, defaults)
        : el('div', { class: 'nt-foot apart' }, defaults, leave),
    );
    this.first = this.root.querySelector('.k-cell');
  }
}
