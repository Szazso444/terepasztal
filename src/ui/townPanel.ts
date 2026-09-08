import { el, btn } from './dom';
import { STR } from '../strings';
import { TOWN_COLORS, type Town, type TownRegistry } from '../sim/towns';
import { cargoDef } from '../sim/cargo';

/**
 * Left-hand list of towns, shown with the survey overview: colour, name, population, what the
 * town makes and uses per day, and what it still needs to be founded.
 */
export class TownPanel {
  readonly root = el('div', { id: 'town-panel', class: 'panel' });
  private body = el('div', { class: 'panel-body' });
  private lastKey = '';
  onGo: ((t: Town) => void) | null = null;
  onRename: ((t: Town) => void) | null = null;

  constructor(private readonly towns: TownRegistry) {
    this.root.append(el('div', { class: 'panel-title', text: STR.town.title }), this.body);
    this.root.style.display = 'none';
  }
  show(v: boolean) {
    this.root.style.display = v ? '' : 'none';
    if (v) this.render(true);
  }
  private fmt(rec: Record<string, number>) {
    const parts = Object.entries(rec)
      .filter(([, v]) => v >= 0.5)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${Math.round(v)} ${cargoDef(k).name.toLowerCase()}`);
    return parts.length ? parts.join(', ') : '-';
  }
  render(force = false) {
    if (this.root.style.display === 'none') return;
    const list = this.towns.towns;
    const key = list
      .map((t) => {
        const m = this.towns.members(t);
        return `${t.id}:${t.name}:${t.color}:${this.towns.population(t, m)}:${m.houses}:${m.warehouses}:${m.stations.length}:${m.buildings.length}`;
      })
      .join('|');
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    const b = this.body;
    b.innerHTML = '';
    if (!list.length) {
      b.append(el('div', { class: 'dim', text: STR.town.none }));
      return;
    }
    for (const t of list) {
      const m = this.towns.members(t);
      const founded = m.houses > 0 && m.warehouses > 0;
      const col = `#${TOWN_COLORS[t.color % TOWN_COLORS.length].toString(16).padStart(6, '0')}`;
      const card = el(
        'div',
        { class: `town-card ${founded ? '' : 'unfounded'}` },
        el(
          'div',
          { class: 'town-head' },
          el('span', { class: 'town-swatch', style: `background:${col}` }),
          el('span', { class: 'name', text: t.name }),
          el('span', { class: 'num', text: `${this.towns.population(t, m)} ${STR.town.people}` }),
        ),
        el('div', {
          class: 'sub',
          text: founded
            ? STR.town.summary(m.stations.length, m.buildings.length, m.houses)
            : STR.town.needs(m.houses === 0, m.warehouses === 0),
        }),
        el('div', {
          class: 'sub',
          text: `${STR.town.makes}: ${this.fmt(this.towns.production(t, m))}`,
        }),
        el('div', {
          class: 'sub',
          text: `${STR.town.uses}: ${this.fmt(this.towns.consumption(t, m))}`,
        }),
        el(
          'div',
          { class: 'row', style: 'margin:4px 0 0 0' },
          btn(STR.town.go, () => this.onGo?.(t), 'small'),
          btn(STR.town.rename, () => this.onRename?.(t), 'small'),
        ),
      );
      b.append(card);
    }
  }
}
