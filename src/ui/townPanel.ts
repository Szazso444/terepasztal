import { el, btn } from './dom';
import { STR } from '../strings';
import { TOWN_COLORS, type Town, type TownRegistry } from '../sim/towns';
import type { HouseRegistry } from '../sim/houses';
import type { StoreRegistry } from '../sim/stores';
import { formatRates } from './townRates';

/**
 * Left-hand list of towns, shown with the survey overview: colour, name, population, housing and
 * growth, how full its store is, what the town makes and uses per week, and what it still needs to
 * be founded. Go looks at the town and shows its store on the top bar.
 */
export class TownPanel {
  readonly root = el('div', { id: 'town-panel', class: 'panel' });
  private body = el('div', { class: 'panel-body' });
  private lastKey = '';
  onGo: ((t: Town) => void) | null = null;
  onRename: ((t: Town) => void) | null = null;

  constructor(
    private readonly towns: TownRegistry,
    private readonly houses: HouseRegistry | null = null,
    private readonly stores: StoreRegistry | null = null,
  ) {
    this.root.append(el('div', { class: 'panel-title', text: STR.town.title }), this.body);
    this.root.style.display = 'none';
  }
  show(v: boolean) {
    this.root.style.display = v ? '' : 'none';
    if (v) this.render(true);
  }
  /** Housing, growth and when the town builds next. */
  private housingLines(t: Town): HTMLElement[] {
    const hs = this.houses?.townHousing(t);
    if (!hs || hs.capacity <= 0) return [];
    const T = STR.town;
    const out = [
      el('div', { class: 'sub', text: T.housing(hs.residents, hs.capacity, hs.building) }),
    ];
    out.push(
      el('div', {
        class: 'sub',
        text:
          hs.growthPerDay > 0 ? T.growth(Math.round(hs.growthPerDay * 70) / 10) : T.growthCapped,
      }),
    );
    out.push(el('div', { class: 'sub', text: T.capacityHint }));
    return out;
  }
  /** The store line of a town that has a store. */
  private storeLines(t: Town): HTMLElement[] {
    const sl = this.storeLine(t);
    return sl ? [el('div', { class: 'sub', text: STR.town.store(sl.fullest, sl.cap) })] : [];
  }
  /** How full the town's store is: its fullest good against the cap per good; none without one. */
  private storeLine(t: Town): { fullest: number; cap: number } | null {
    const store = this.stores?.byKey(`town:${t.id}`);
    if (!store) return null;
    let fullest = 0;
    for (const [, n] of store.held()) fullest = Math.max(fullest, Math.floor(n));
    return { fullest, cap: store.cap('wood') };
  }
  render(force = false) {
    if (this.root.style.display === 'none') return;
    const list = this.towns.towns;
    const key = list
      .map((t) => {
        const m = this.towns.members(t);
        const hs = this.houses?.townHousing(t);
        const hk = hs
          ? `${hs.houses}:${hs.building}:${hs.capacity}:${hs.residents}:${hs.growthPerDay.toFixed(2)}:${hs.mul.toFixed(1)}:${hs.cramped}`
          : '';
        const sl = this.storeLine(t);
        const sk = sl ? `${sl.fullest}:${sl.cap}` : '';
        return `${t.id}:${t.name}:${t.color}:${this.towns.population(t, m)}:${m.houses}:${m.warehouses}:${m.stations.length}:${m.buildings.length}:${hk}:${sk}`;
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
        ...this.housingLines(t),
        ...this.storeLines(t),
        el('div', {
          class: 'sub',
          text: `${STR.town.makes}: ${formatRates(this.towns.production(t, m))}`,
        }),
        el('div', {
          class: 'sub',
          text: `${STR.town.uses}: ${formatRates(this.towns.consumption(t, m))}`,
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
