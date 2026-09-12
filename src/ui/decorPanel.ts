import { el, btn } from './dom';
import { STR } from '../strings';
import type { Builder, Decor } from '../sim/build';
import { decorDef } from '../sim/build';
import type { PowerGrid } from '../sim/power';
import type { House, HouseRegistry } from '../sim/houses';
import { fmtCost } from '../sim/stockpile';

/** Side panel for a selected service or utility (water tower, coaling stage, signal, pole, townhouse). */
export class DecorPanel {
  readonly root: HTMLElement;
  private body = el('div', { class: 'panel-body' });
  private title = el('span');
  decor: Decor | null = null;
  /** set by the game: townhouse state for house entries */
  houses: HouseRegistry | null = null;

  constructor(
    private readonly builder: Builder,
    private readonly power: PowerGrid,
    private readonly onClose: () => void,
  ) {
    this.root = el(
      'div',
      { id: 'station-panel', class: 'panel' },
      el(
        'div',
        { class: 'panel-title' },
        this.title,
        btn('x', () => this.close(), 'small'),
      ),
      this.body,
    );
    this.root.style.display = 'none';
  }
  open(d: Decor) {
    this.decor = d;
    this.root.style.display = '';
    this.render();
  }
  close() {
    this.decor = null;
    this.root.style.display = 'none';
    this.onClose();
  }

  /** Townhouse lines: level, people, construction or growth. */
  static houseLines(h: House, houses: HouseRegistry): string[] {
    const out: string[] = [];
    const H = STR.house;
    const cap = houses.capacity(h);
    if (!houses.finished(h)) {
      const stage = houses.stage(h);
      out.push(`${H.building}: ${H.stage(H.stages[stage], Math.round(h.progress * 100))}`);
      const left = (1 - h.progress) * houses.cfg.constructionDays;
      out.push(H.finishedIn(Math.max(1, Math.ceil(left))));
      return out;
    }
    out.push(`${H.level(h.level)}, ${H.residents.toLowerCase()} ${h.residents} / ${cap}`);
    const days = houses.growthDaysLeft(h);
    if (days !== null) out.push(`${H.growth}: ${H.growthIn(Math.max(1, Math.ceil(days)))}`);
    else if (h.residents >= cap) {
      out.push(`${H.growth}: ${H.full}`);
      if (h.level < houses.maxLevel) out.push(H.autoUpgrade(houses.cfg.autoUpgradeDays));
    } else out.push(`${H.growth}: ${H.growthNoFood}`);
    return out;
  }

  /** Lines shared with the hover tooltip. */
  static lines(
    d: Decor,
    builder: Builder,
    power: PowerGrid,
    houses?: HouseRegistry | null,
  ): string[] {
    const def = decorDef(d.id);
    const out: string[] = [];
    if (def.radius) {
      const served = builder.stations.filter(
        (s) => Math.max(Math.abs(s.x - d.x), Math.abs(s.y - d.y)) <= def.radius!,
      );
      out.push(STR.decorInfo.reach(def.radius));
      out.push(
        served.length
          ? STR.decorInfo.serves(served.map((s) => s.name).join(', '))
          : STR.decorInfo.servesNone,
      );
    }
    if (def.power) out.push(power.isPowered(d.x, d.y) ? STR.decorInfo.live : STR.decorInfo.dead);
    if (d.id === 'signal') out.push(STR.decorInfo.signal);
    if (def.crew) out.push(`${STR.building.crew}: ${def.crew}`);
    const h = def.residents && houses ? houses.at(d.x, d.y) : undefined;
    if (h && houses) out.push(...DecorPanel.houseLines(h, houses));
    return out;
  }

  render() {
    const d = this.decor;
    if (!d || this.builder.decorAt(d.x, d.y) !== d) {
      if (d) this.close();
      return;
    }
    const def = decorDef(d.id);
    this.title.textContent = def.name;
    const b = this.body;
    b.innerHTML = '';
    b.append(el('div', { class: 'flavor', text: def.flavor }));
    for (const line of DecorPanel.lines(d, this.builder, this.power, this.houses))
      b.append(el('div', { class: 'kv' }, el('span', { class: 'k', text: line })));
    const houses = this.houses;
    const h = def.residents && houses ? houses.at(d.x, d.y) : undefined;
    if (h && houses) {
      const cap = houses.capacity(h);
      const frac = houses.finished(h) ? h.residents / Math.max(1, cap) : h.progress;
      b.append(
        el(
          'div',
          { class: 'bar' },
          el('div', { class: 'bar-fill', style: `width:${Math.round(frac * 100)}%` }),
          el('div', {
            class: 'bar-label',
            text: houses.finished(h)
              ? `${STR.house.residents} ${h.residents} / ${cap}`
              : STR.house.stages[houses.stage(h)],
          }),
        ),
      );
      if (h.level < houses.maxLevel) {
        const c = houses.canUpgrade(h);
        const label = STR.house.upgrade(h.level + 1, fmtCost(c.cost));
        const up = btn(
          label,
          () => {
            houses.upgrade(h);
            this.render();
          },
          'small',
        );
        if (!c.ok) {
          up.disabled = true;
          up.title = c.reason ?? '';
        }
        b.append(el('div', { class: 'row' }, up));
      }
    }
    b.append(
      el(
        'div',
        { class: 'row' },
        btn(
          STR.station.demolish,
          () => {
            this.builder.removeDecor(d.x, d.y);
            this.close();
          },
          'small',
        ),
      ),
    );
  }
}
