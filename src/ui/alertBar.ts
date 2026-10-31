import type { AtlasRegistry } from '../engine/atlas';
import { sfx } from '../engine/audio';
import type { AlertSettings } from '../sim/alerts';
import type { Notice } from '../sim/notices';
import { STR } from '../strings';
import {
  ALERT_ICON,
  BELL_ICON,
  alertGroups,
  alertIconSvg,
  alertTip,
  fitGroups,
  hiddenGroup,
  hiddenTip,
  nextInstance,
  type AlertGroup,
  type CyclePlace,
} from './alertView';
import { btn, el } from './dom';
import type { Toasts } from './toast';
import { ttTerm, type Tooltip } from './tooltip';
import { tipBuild } from './tooltipRender';

interface AlertIcon {
  root: HTMLElement;
  count: HTMLElement;
  /** what it shows now; its tooltip and its click read this */
  group: AlertGroup;
}

/**
 * The row of alert icons under the resource bar, the worst first: one for each type (or, with the
 * Group switch off, each instance), a click going through its instances. The elements stay while
 * their icon does, so a refresh does not take a tooltip away from under the pointer. The button at
 * its end opens the Notifications screen, and is all that shows when there is nothing to tell.
 */
export class AlertBar {
  readonly root = el('div', { id: 'alert-bar' });
  private row = el('div', { class: 'al-row' });
  private drawn = new Map<string, AlertIcon>();
  /** the slot that speaks for the icons there is no room for */
  private more: HTMLElement;
  private hidden: AlertGroup[] = [];
  /** where each icon's clicks have got to */
  private places = new Map<string, CyclePlace>();
  /** look at what a notice points to */
  onLook: ((n: Notice) => void) | null = null;
  /** the button: open the Notifications screen */
  onSettings: (() => void) | null = null;

  constructor(
    private readonly atlas: AtlasRegistry,
    private readonly tooltip: Tooltip,
    private readonly toasts: Toasts,
  ) {
    this.more = ttTerm(
      el('b'),
      tipBuild(atlas, () => hiddenTip(this.hidden)),
    );
    this.more.classList.add('al', 'al-more');
    this.more.style.display = 'none';
    this.more.addEventListener('click', () => this.cycle(hiddenGroup(this.hidden)));
    this.row.append(this.more);
    const settings = btn('', () => this.onSettings?.(), 'small al-set');
    settings.title = STR.alerts.title;
    settings.innerHTML = alertIconSvg(BELL_ICON, 14);
    this.root.append(this.row, settings);
    tooltip.bindTerms(this.root);
  }

  private make(g: AlertGroup): AlertIcon {
    const mark = el('span', { class: 'al-mark' });
    mark.innerHTML = alertIconSvg(ALERT_ICON[g.type], 18);
    const count = el('b');
    const icon: AlertIcon = {
      root: ttTerm(
        el('span', { class: 'al-face' }, mark, count),
        tipBuild(this.atlas, () => alertTip(icon.group)),
      ),
      count,
      group: g,
    };
    icon.root.classList.add('al', `sev-${g.severity}`);
    icon.root.addEventListener('click', () => this.cycle(icon.group));
    return icon;
  }

  /** The camera to the next instance of an icon, and a toast naming it. */
  private cycle(group: AlertGroup) {
    const step = nextInstance(group, this.places.get(group.id) ?? null);
    if (!step) return;
    sfx('ui.click');
    this.places.set(group.id, { key: step.notice.key, at: step.at });
    this.onLook?.(step.notice);
    this.toasts.push(step.line);
  }

  private drop(id: string, icon: AlertIcon) {
    // no mouseleave comes from an element that goes
    if (icon.root.matches(':hover')) this.tooltip.stack.termLeave(-1);
    icon.root.remove();
    this.drawn.delete(id);
    this.places.delete(id);
  }

  update(list: readonly Notice[], s: AlertSettings) {
    const { shown, hidden } = fitGroups(alertGroups(list, s));
    const live = new Set(shown.map((g) => g.id));
    for (const [id, icon] of this.drawn) if (!live.has(id)) this.drop(id, icon);
    let added = false;
    shown.forEach((g, i) => {
      let icon = this.drawn.get(g.id);
      if (!icon) {
        icon = this.make(g);
        this.drawn.set(g.id, icon);
        added = true;
      }
      icon.group = g;
      const n = g.notices.length;
      icon.count.textContent = n > 1 ? String(n) : '';
      icon.root.classList.toggle(
        'al-still',
        g.notices.every((m) => !m.target),
      );
      // only what is out of place moves: a moved element loses the pointer
      if (this.row.children[i] !== icon.root)
        this.row.insertBefore(icon.root, this.row.children[i]);
    });
    this.hidden = hidden;
    this.more.style.display = hidden.length ? '' : 'none';
    this.more.firstElementChild!.textContent = STR.alerts.plus(hidden.length);
    this.more.classList.toggle(
      'al-still',
      hidden.every((g) => g.notices.every((m) => !m.target)),
    );
    if (added) this.tooltip.bindTerms(this.root);
  }
}
