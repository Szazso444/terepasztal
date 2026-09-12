import { el, btn, fmtMoney, fmtInt } from './dom';
import { STR } from '../strings';
import type { GameClock } from '../sim/time';
import type { AgeStatus, GoalKind } from '../sim/ages';

export interface HudModel {
  money: number;
  tickets: number;
  /** current age index (0 steam, 1 diesel, 2 electric) */
  tier: number;
}

/** Display name of an age by data id. */
export function ageName(id: string) {
  return STR.ages.name[id] ?? id;
}

/**
 * Top bar: title, menu and screen buttons on the left; weather/day toggles, season, clock and
 * speed on the right. Funds, tickets and the current age live in `funds`, which the game places
 * at the right end of the resource row; hovering the age shows the goals of every age.
 */
export class Hud {
  readonly root: HTMLElement;
  private money = el('span', { class: 'value' });
  private tickets = el('span', { class: 'value' });
  private age = el('span', { class: 'value' });
  private ageCard = el('div', { id: 'age-card', class: 'panel' });
  private ageHover = false;
  private day = el('span', { class: 'value' });
  private clockEl = el('span', { class: 'value' });
  private speedBtns: HTMLButtonElement[] = [];
  readonly actions = el('div', { class: 'stat actions', style: 'gap:4px' });
  readonly menuBtn = btn(STR.menu.menuButton, () => this.onMenu?.(), 'small');
  /** funds / tickets / age block for the resource row */
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
    /** progress towards every age, read while the age card is open */
    private readonly ages: () => AgeStatus[],
  ) {
    const stat = (label: string, v: HTMLElement) =>
      el('div', { class: 'stat' }, el('span', { class: 'label', text: label }), v);
    const time = el('div', { class: 'time' });
    STR.hud.speed.forEach((s, i) => {
      const b =
        i === 0
          ? btn(s, () => this.clock.togglePause(), 'pause')
          : btn(s, () => this.clock.setSpeed(i), 'small');
      this.speedBtns.push(b);
      time.append(b);
    });
    this.weatherBtn.title = STR.hud.weatherToggleHint;
    this.dayBtn.title = STR.hud.dayToggleHint;
    const ageStat = stat(STR.hud.age, this.age);
    ageStat.classList.add('age');
    ageStat.addEventListener('mouseenter', () => {
      this.ageHover = true;
      const r = ageStat.getBoundingClientRect();
      this.ageCard.style.left = `${Math.max(4, Math.min(window.innerWidth - 290, r.right - 280))}px`;
      this.ageCard.style.top = `${r.bottom + 4}px`;
      this.ageCard.style.display = '';
      this.renderAges();
    });
    ageStat.addEventListener('mouseleave', () => {
      this.ageHover = false;
      this.ageCard.style.display = 'none';
    });
    this.ageCard.style.display = 'none';
    document.body.append(this.ageCard);
    this.funds = el(
      'div',
      { class: 'funds' },
      stat(STR.hud.money, this.money),
      stat(STR.hud.tickets, this.tickets),
      ageStat,
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
      el('div', { class: 'stat' }, this.day, this.clockEl),
      time,
    );
  }

  /** The age card: every age with its goals as progress bars. */
  private renderAges() {
    const c = this.ageCard;
    c.innerHTML = '';
    const body = el('div', { class: 'panel-body' });
    const fmt = (kind: GoalKind, v: number) =>
      kind === 'earned' ? fmtMoney(Math.floor(v)) : fmtInt(Math.floor(v));
    for (const a of this.ages()) {
      const state = a.current ? STR.ages.current : a.unlocked ? STR.ages.reached : STR.ages.locked;
      body.append(
        el(
          'div',
          { class: `kv ${a.current ? 'amber' : a.unlocked ? 'dim' : ''}` },
          el('span', { class: 'k', text: ageName(a.id) }),
          el('span', { class: 'v', text: state }),
        ),
      );
      if (!a.goals.length) {
        body.append(el('div', { class: 'sub dim', text: STR.ages.start }));
        continue;
      }
      for (const g of a.goals) {
        const pct = Math.max(0, Math.min(100, (g.current / g.target) * 100));
        body.append(
          el(
            'div',
            { class: 'bar' },
            el('div', { class: `bar-fill ${g.done ? 'good' : ''}`, style: `width:${pct}%` }),
            el('div', {
              class: 'bar-label',
              text: `${STR.ages.goal[g.kind]}: ${fmt(g.kind, g.current)} / ${fmt(g.kind, g.target)}`,
            }),
          ),
        );
      }
    }
    body.append(el('div', { class: 'sub dim', text: STR.ages.hint }));
    c.append(el('div', { class: 'panel-title', text: STR.ages.title }), body);
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

  update(m: HudModel) {
    this.money.textContent = fmtMoney(m.money);
    this.tickets.textContent = fmtInt(m.tickets);
    const ages = this.ages();
    const cur = ages[Math.min(m.tier, ages.length - 1)];
    const label = cur ? ageName(cur.id) : String(m.tier);
    if (this.age.textContent !== label) this.age.textContent = label;
    if (this.ageHover) this.renderAges();
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
