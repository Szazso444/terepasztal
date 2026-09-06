import { el, btn, fmtMoney, fmtInt } from './dom';
import { STR } from '../strings';
import type { GameClock } from '../sim/time';

export interface HudModel {
  money: number;
  tickets: number;
  reputation: number;
  tier: number;
}

/** Top bar: resources, clock and speed controls. */
export class Hud {
  readonly root: HTMLElement;
  private money = el('span', { class: 'value' });
  private tickets = el('span', { class: 'value' });
  private rep = el('span', { class: 'value' });
  private day = el('span', { class: 'value' });
  private clockEl = el('span', { class: 'value' });
  private speedBtns: HTMLButtonElement[] = [];
  readonly actions = el('div', { class: 'stat actions', style: 'gap:4px' });
  readonly menuBtn = btn(STR.menu.menuButton, () => this.onMenu?.(), 'small');
  onMenu: (() => void) | null = null;
  private locked = false;
  private fps = el('span', { class: 'value dim' });
  private weather = el('span', { class: 'value' });

  constructor(private readonly clock: GameClock) {
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
    this.root = el(
      'div',
      { id: 'topbar', class: 'panel' },
      el('div', { class: 'title', text: STR.title }),
      el('div', { class: 'stat' }, this.menuBtn),
      stat(STR.hud.money, this.money),
      stat(STR.hud.tickets, this.tickets),
      stat(STR.hud.reputation, this.rep),
      this.actions,
      el('div', { class: 'spacer' }),
      el('div', { class: 'stat' }, this.fps),
      el('div', { class: 'stat weather' }, this.weather),
      el('div', { class: 'stat' }, this.day, this.clockEl),
      time,
    );
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
    this.rep.textContent = `${fmtInt(m.reputation)} (${STR.hud.tier(m.tier)})`;
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
