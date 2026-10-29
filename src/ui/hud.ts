import { el, btn, fmtInt } from './dom';
import { STR } from '../strings';
import { SPEED_ORDER, type GameClock } from '../sim/time';
import type { AgeStatus } from '../sim/ages';
import type { AtlasRegistry } from '../engine/atlas';
import { ttTerm, type Tooltip } from './tooltip';
import { tipBuild } from './tooltipRender';
import { ageTip, eraView } from './ageTooltip';
import { ageIcon } from './ageIcons';

export interface HudModel {
  tickets: number;
  /** current age index (0 steam, 1 diesel, 2 electric, 3 nuclear, 4 magnetic, 5 hyper) */
  tier: number;
}

/**
 * Top bar: title, menu and screen buttons on the left; on the right the weather/day toggles, the
 * season, the era widget (the current age's icon and name, and a bar toward the next age; resting
 * on it lists every age with its goals), then day, clock and speed as the last block. Tickets live
 * in `funds`, which the game places at the right end of the resource row (the money itself is the
 * resource bar's first cell).
 */
export class Hud {
  readonly root: HTMLElement;
  private tickets = el('span', { class: 'value' });
  /** the era widget: the age's icon and name, the bar toward the next age and its percent */
  private eraIcon = el('span', { class: 'era-icon' });
  private eraName = el('span', { class: 'era-name' });
  private eraFill = el('div', { class: 'era-fill' });
  private eraBar = el('div', { class: 'era-bar' }, this.eraFill);
  private eraPct = el('span', { class: 'era-pct' });
  /** the age whose icon is drawn */
  private eraId: string | null = null;
  private day = el('span', { class: 'value' });
  private clockEl = el('span', { class: 'value' });
  private speedBtns: HTMLButtonElement[] = [];
  readonly actions = el('div', { class: 'stat actions', style: 'gap:4px' });
  readonly menuBtn = btn(STR.menu.menuButton, () => this.onMenu?.(), 'small');
  /** the tickets block for the resource row */
  readonly funds: HTMLElement;
  /** slot for the advisor button and other top-right controls */
  readonly rightActions = el('div', { class: 'stat', style: 'gap:4px' });
  readonly weatherBtn = btn(STR.hud.weatherToggle, () => this.onToggleWeather?.(), 'small');
  readonly dayBtn = btn(STR.hud.dayToggle, () => this.onToggleDay?.(), 'small');
  onMenu: (() => void) | null = null;
  onToggleWeather: (() => void) | null = null;
  onToggleDay: (() => void) | null = null;
  private locked = false;
  private fps = el('span', { class: 'value dim' });
  private weather = el('span', { class: 'value' });

  constructor(
    private readonly clock: GameClock,
    /** progress towards every age: read on every update, and when the era tooltip opens */
    private readonly ages: () => AgeStatus[],
    atlas: AtlasRegistry,
    tooltip: Tooltip,
  ) {
    const stat = (label: string, v: HTMLElement) =>
      el('div', { class: 'stat' }, el('span', { class: 'label', text: label }), v);
    const time = el('div', { class: 'time' });
    // the buttons read in SPEED_ORDER; speedBtns stays by real index, as clock.speedIndex is
    for (const i of SPEED_ORDER) {
      const s = STR.hud.speed[i];
      const b =
        i === 0
          ? btn(s, () => this.clock.togglePause(), 'pause')
          : btn(s, () => this.clock.setSpeed(i), 'small');
      // pause keeps its own title (update); the digits 1-3 set indexes 1-3, ½× has only + and −
      if (i !== 0) b.title = STR.hud.speedKey(s, i <= 3 ? `${i}, + / −` : '+ / −');
      this.speedBtns[i] = b;
      time.append(b);
    }
    this.weatherBtn.title = STR.hud.weatherToggleHint;
    this.dayBtn.title = STR.hud.dayToggleHint;
    this.funds = el('div', { class: 'funds' }, stat(STR.hud.tickets, this.tickets));
    // the whole widget is the term: resting on it opens the ages tooltip
    const era = ttTerm(
      el('div', { class: 'stat era' }, this.eraIcon, this.eraName, this.eraBar, this.eraPct),
      tipBuild(atlas, () => ageTip(this.ages())),
    );
    this.root = el(
      'div',
      { id: 'topbar', class: 'panel' },
      el('div', { class: 'title', text: STR.title }),
      el('div', { class: 'stat' }, this.menuBtn),
      this.actions,
      el('div', { class: 'spacer' }),
      el('div', { class: 'stat' }, this.fps),
      this.rightActions,
      el('div', { class: 'stat toggles' }, this.weatherBtn, this.dayBtn),
      el('div', { class: 'stat weather' }, this.weather),
      era,
      // one block at the right end, the era widget just before it
      el('div', { class: 'stat datespeed' }, this.day, this.clockEl, time),
    );
    tooltip.bindTerms(this.root);
  }

  setToggles(weather: boolean, day: boolean) {
    this.weatherBtn.classList.toggle('active', weather);
    this.dayBtn.classList.toggle('active', day);
  }

  /** Editor: hide the game screens and freeze the clock controls. */
  setEditor(on: boolean) {
    this.actions.style.display = on ? 'none' : '';
    this.locked = on;
    for (const b of this.speedBtns) b.disabled = on;
  }

  setWeather(text: string) {
    if (this.weather.textContent !== text) {
      this.weather.textContent = text;
      (this.weather.parentElement as HTMLElement).style.display = text ? '' : 'none';
    }
  }

  setFps(v: number | null) {
    this.fps.textContent = v === null ? '' : `${v} fps`;
    (this.fps.parentElement as HTMLElement).style.display = v === null ? 'none' : '';
  }

  /** The era widget: written only where it changed, as this runs every frame. */
  private updateEra(tier: number) {
    const v = eraView(this.ages(), tier);
    if (v.id !== this.eraId) {
      this.eraId = v.id;
      // fixed markup from ageIcons.ts, never from data
      this.eraIcon.innerHTML = ageIcon(v.id);
    }
    if (this.eraName.textContent !== v.name) this.eraName.textContent = v.name;
    // the last age has no next one: no bar, and the label says it is the current one
    const bar = v.percent === undefined ? 'none' : '';
    if (this.eraBar.style.display !== bar) this.eraBar.style.display = bar;
    const width = `${v.percent ?? 100}%`;
    if (this.eraFill.style.width !== width) this.eraFill.style.width = width;
    const label = v.percent === undefined ? STR.ages.current : STR.hud.agePercent(v.percent);
    if (this.eraPct.textContent !== label) this.eraPct.textContent = label;
  }

  update(m: HudModel) {
    this.tickets.textContent = fmtInt(m.tickets);
    this.updateEra(m.tier);
    this.day.textContent = STR.hud.day(this.clock.day);
    this.clockEl.textContent = this.clock.formatClock();
    this.speedBtns.forEach((b, i) =>
      b.classList.toggle('active', !this.locked && i === this.clock.speedIndex),
    );
    const paused = this.clock.speedIndex === 0;
    const pb = this.speedBtns[0];
    const glyph = paused ? '▶' : '❚❚';
    if (pb.textContent !== glyph) pb.textContent = glyph;
    pb.classList.toggle('paused', paused);
    pb.title = paused ? STR.hud.resume : STR.hud.pause;
  }
}
